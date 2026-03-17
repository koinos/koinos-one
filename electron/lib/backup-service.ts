import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron'

import { DEFAULT_BASEDIR } from './constants'
import type {
  BlockchainBackupArchiveState,
  BlockchainBackupExtractState,
  BlockchainBackupWorkspacePaths,
  KoinosJsonRpcProxyInput,
  KoinosJsonRpcProxyResult,
  KoinosNodeBackupProgressAction,
  KoinosNodeBackupProgressEvent,
  KoinosNodeBackupProgressPhase,
  KoinosNodeBackupRestoreResult,
  KoinosNodeBaseDirCopyInput,
  KoinosNodeBaseDirCopyResult,
  KoinosNodeCommandResult,
  KoinosNodeSelectDirectoryResult,
  KoinosNodeServicePort,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeStatus,
  KoinosNodeValidateBaseDirResult
} from './main-types'
import { directoryHasEntries } from './workspace-service'

const BLOCKCHAIN_BACKUP_REQUIRED_DIRS = ['chain', 'block_store'] as const
const BLOCKCHAIN_BACKUP_RESET_DIRS = ['mempool'] as const
const BLOCKCHAIN_BACKUP_CACHE_DIR = '.knodel-blockchain-backup-cache'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ServiceDefinition = Record<string, unknown>

type BackupServiceDeps = {
  normalizeNodeSettings: (input?: KoinosNodeSettingsInput) => KoinosNodeSettings
  assertRepoReady: (settings: KoinosNodeSettings) => void
  ensureKoinosConfigFiles: (settings: KoinosNodeSettings) => { configReady: boolean; output: string }
  ensureBaseDirKoinosRuntimeFiles: (settings: KoinosNodeSettings) => string
  validateNodeBaseDirAccess: (input?: KoinosNodeSettingsInput) => KoinosNodeValidateBaseDirResult
  restoreWorkspaceParentPath: (baseDir: string) => string
  ensureKoinosBaseDir: (baseDir: string) => string
  readServiceDefinitions: (settings: KoinosNodeSettings) => Map<string, ServiceDefinition>
  selectedManagedComposeServiceIds: (
    settings: KoinosNodeSettings,
    serviceDefinitions: Map<string, ServiceDefinition>
  ) => string[]
  composeServicePortByTarget: (
    definition: ServiceDefinition | undefined,
    targetPort: number
  ) => KoinosNodeServicePort | null
  koinosNodeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  koinosNodeAction: (action: 'start' | 'stop', input?: KoinosNodeSettingsInput) => Promise<KoinosNodeCommandResult>
  runCommand: (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ) => Promise<{ ok: boolean; code: number | null; output: string }>
}

export function normalizeBlockchainBackupArchiveUrl(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw new Error('La URL del backup blockchain no puede estar vacia')
  }

  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('La URL del backup blockchain debe usar http o https')
  }
  if (!parsed.pathname.endsWith('.tar.gz')) {
    throw new Error('La URL del backup blockchain debe apuntar a un archivo .tar.gz')
  }

  return parsed.toString()
}

function blockchainBackupMetadataUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl)
  parsed.pathname = `${parsed.pathname}.metadata`
  return parsed.toString()
}

export function blockchainBackupChecksumUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl)
  parsed.pathname = `${parsed.pathname}.sha256`
  return parsed.toString()
}

function blockchainBackupWorkspacePaths(
  restoreWorkspaceParent: string,
  archiveUrl: string,
  checksum: string
): BlockchainBackupWorkspacePaths {
  const archiveKey = createHash('sha1').update(archiveUrl).digest('hex').slice(0, 12)
  const workspaceDir = path.join(
    restoreWorkspaceParent,
    BLOCKCHAIN_BACKUP_CACHE_DIR,
    `${archiveKey}-${checksum.slice(0, 12)}`
  )
  return {
    workspaceDir,
    archivePath: path.join(workspaceDir, 'backup.tar.gz'),
    archiveStatePath: path.join(workspaceDir, 'archive-state.json'),
    extractDir: path.join(workspaceDir, 'extract'),
    extractStatePath: path.join(workspaceDir, 'extract-state.json')
  }
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function uniqueStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function buildBlockchainBackupArchiveState(archivePath: string): BlockchainBackupArchiveState {
  const stats = fs.statSync(archivePath)
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    updatedAt: Date.now()
  }
}

function archiveStateMatchesFile(filePath: string, state: BlockchainBackupArchiveState | null): boolean {
  if (!state || !fs.existsSync(filePath)) return false
  const stats = fs.statSync(filePath)
  return stats.size === state.size && stats.mtimeMs === state.mtimeMs
}

export function parseBlockchainBackupMetadataDirectories(raw: string): string[] {
  const lines = raw.split(/\r?\n/)
  let inSection = false
  const directories: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inSection) {
      if (trimmed === 'Included Directories:') inSection = true
      continue
    }

    if (!trimmed || /^-+$/.test(trimmed)) continue
    if (/^[A-Z][A-Za-z ]+:$/.test(trimmed)) break

    const match = trimmed.match(/^([^\s]+\/)(?:\s|$)/)
    if (!match) continue
    directories.push(match[1].replace(/\/+$/, ''))
  }

  return uniqueStringList(directories)
}

export function parseBlockchainBackupSha256Checksum(
  raw: string,
  archiveUrl: string
): { checksum: string; output: string } {
  const checksumUrl = blockchainBackupChecksumUrl(archiveUrl)
  const archiveName = path.posix.basename(new URL(archiveUrl).pathname)
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean)

  if (!line) {
    throw new Error(`El archivo SHA-256 del backup esta vacio: ${checksumUrl}`)
  }

  const match = line.match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i)
  if (!match) {
    throw new Error(`Formato SHA-256 invalido en ${checksumUrl}`)
  }

  const checksum = match[1].toLowerCase()
  const referencedName = match[2]?.trim()
  if (referencedName && path.posix.basename(referencedName) !== archiveName) {
    throw new Error(`El archivo SHA-256 referencia ${referencedName}, no ${archiveName}`)
  }

  return {
    checksum,
    output: `Expected SHA-256 ${checksum} from ${checksumUrl}`
  }
}

async function fetchBlockchainBackupChecksum(archiveUrl: string): Promise<{ ok: boolean; checksum?: string; output: string }> {
  const checksumUrl = blockchainBackupChecksumUrl(archiveUrl)

  try {
    const response = await fetch(checksumUrl)
    if (!response.ok) {
      return {
        ok: false,
        output: `No se pudo descargar el checksum SHA-256 del backup blockchain (HTTP ${response.status})`
      }
    }

    const body = await response.text()
    const parsed = parseBlockchainBackupSha256Checksum(body, archiveUrl)
    return {
      ok: true,
      checksum: parsed.checksum,
      output: parsed.output
    }
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'No se pudo obtener el checksum SHA-256 del backup blockchain'
    }
  }
}

async function fetchBlockchainBackupMetadata(
  archiveUrl: string
): Promise<{ ok: boolean; directories?: string[]; output: string }> {
  const metadataUrl = blockchainBackupMetadataUrl(archiveUrl)

  try {
    const response = await fetch(metadataUrl)
    if (!response.ok) {
      return {
        ok: false,
        output: `No se pudo descargar el metadata del backup blockchain (HTTP ${response.status})`
      }
    }

    const body = await response.text()
    const directories = parseBlockchainBackupMetadataDirectories(body)
    if (!directories.length) {
      return {
        ok: false,
        output: `El metadata del backup blockchain no lista directorios restaurables: ${metadataUrl}`
      }
    }

    return {
      ok: true,
      directories,
      output: `Metadata directories: ${directories.join(', ')}`
    }
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'No se pudo obtener el metadata del backup blockchain'
    }
  }
}

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function normalizeTarEntryPath(entry: string): string {
  return entry.replace(/\\/g, '/').replace(/^\.\//, '')
}

function hasBlockchainBackupPayload(dirPath: string): boolean {
  return BLOCKCHAIN_BACKUP_REQUIRED_DIRS.some((entry) => fs.existsSync(path.join(dirPath, entry)))
}

function findBlockchainBackupPayloadRoot(dirPath: string, depth = 0): string | null {
  if (hasBlockchainBackupPayload(dirPath)) return dirPath
  if (depth >= 4) return null

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = findBlockchainBackupPayloadRoot(path.join(dirPath, entry.name), depth + 1)
    if (candidate) return candidate
  }

  return null
}

function scanBlockchainBackupArchive(
  archivePath: string,
  onEntry: (entry: string) => boolean | void
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('tar', ['-tzf', archivePath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdoutRemainder = ''
    let stderr = ''
    let stopRequested = false
    let callbackError = ''
    let settled = false

    const finish = (result: { ok: boolean; output: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const handleLine = (line: string) => {
      if (stopRequested) return

      try {
        if (onEntry(line) === true) {
          stopRequested = true
          try {
            child.kill('SIGTERM')
          } catch {
            // ignore scan shutdown errors
          }
        }
      } catch (error) {
        callbackError = error instanceof Error ? error.message : 'No se pudo inspeccionar el backup blockchain'
        stopRequested = true
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore scan shutdown errors
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (stopRequested) return

      stdoutRemainder += String(chunk)
      while (!stopRequested) {
        const newlineIndex = stdoutRemainder.indexOf('\n')
        if (newlineIndex === -1) break
        const line = stdoutRemainder.slice(0, newlineIndex).replace(/\r$/, '')
        stdoutRemainder = stdoutRemainder.slice(newlineIndex + 1)
        if (line) handleLine(line)
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      finish({
        ok: false,
        output: [stderr.trim(), error.message].filter(Boolean).join('\n')
      })
    })

    child.on('close', (code) => {
      if (!stopRequested && stdoutRemainder.trim()) {
        handleLine(stdoutRemainder.trim())
      }

      if (callbackError) {
        finish({
          ok: false,
          output: [stderr.trim(), callbackError].filter(Boolean).join('\n')
        })
        return
      }

      if (stopRequested || code === 0) {
        finish({
          ok: true,
          output: stderr.trim()
        })
        return
      }

      finish({
        ok: false,
        output: [stderr.trim(), `tar -tzf exited with code ${code}`].filter(Boolean).join('\n')
      })
    })
  })
}

async function discoverBlockchainBackupPayloadRootInArchive(
  archivePath: string
): Promise<{ ok: boolean; payloadRootRelativePath?: string; output: string }> {
  const requiredDirs = new Set<string>(BLOCKCHAIN_BACKUP_REQUIRED_DIRS as readonly string[])
  let discoveredRoot: string | null = null

  const scanResult = await scanBlockchainBackupArchive(archivePath, (entry) => {
    const normalized = normalizeTarEntryPath(entry).replace(/\/+$/, '')
    const segments = normalized.split('/').filter(Boolean)
    const requiredDirIndex = segments.findIndex((segment) => requiredDirs.has(segment))
    if (requiredDirIndex === -1) return false

    discoveredRoot = segments.slice(0, requiredDirIndex).join('/')
    return true
  })

  if (!scanResult.ok) {
    return {
      ok: false,
      output: scanResult.output || 'No se pudo inspeccionar el backup blockchain'
    }
  }

  if (discoveredRoot === null) {
    return {
      ok: false,
      output: `El backup no contiene los directorios esperados: ${BLOCKCHAIN_BACKUP_REQUIRED_DIRS.join(', ')}`
    }
  }

  return {
    ok: true,
    payloadRootRelativePath: discoveredRoot,
    output: `Archive payload root: ${discoveredRoot || '.'}`
  }
}

async function listBlockchainBackupPayloadDirectoriesFromArchive(
  archivePath: string,
  payloadRootRelativePath: string
): Promise<{ ok: boolean; directories?: string[]; output: string }> {
  const directories: string[] = []
  const seen = new Set<string>()
  const normalizedRoot = payloadRootRelativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

  const scanResult = await scanBlockchainBackupArchive(archivePath, (entry) => {
    const rawEntry = normalizeTarEntryPath(entry)
    const normalizedEntry = rawEntry.replace(/\/+$/, '')
    if (!normalizedEntry) return false

    let relativeEntry = normalizedEntry
    if (normalizedRoot) {
      if (normalizedEntry === normalizedRoot) return false
      if (!normalizedEntry.startsWith(`${normalizedRoot}/`)) return false
      relativeEntry = normalizedEntry.slice(normalizedRoot.length + 1)
    }

    const segments = relativeEntry.split('/').filter(Boolean)
    if (!segments.length) return false
    if (segments.length === 1 && !rawEntry.endsWith('/')) return false

    const dirName = segments[0]
    if (!seen.has(dirName)) {
      seen.add(dirName)
      directories.push(dirName)
    }

    return false
  })

  if (!scanResult.ok) {
    return {
      ok: false,
      output: scanResult.output || 'No se pudo listar los directorios del backup blockchain'
    }
  }

  if (!directories.length) {
    return {
      ok: false,
      output: 'El backup blockchain no contiene subdirectorios restaurables'
    }
  }

  return {
    ok: true,
    directories,
    output: `Archive directories: ${directories.join(', ')}`
  }
}

async function verifyBlockchainBackupArchiveFile(
  archivePath: string,
  expectedSha256: string
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    const source = fs.createReadStream(archivePath)

    source.on('data', (chunk: Buffer | string) => {
      hash.update(chunk)
    })

    source.on('error', (error) => {
      resolve({
        ok: false,
        output: error.message
      })
    })

    source.on('end', () => {
      const actualSha256 = hash.digest('hex')
      if (actualSha256 !== expectedSha256) {
        resolve({
          ok: false,
          output: `Checksum SHA-256 invalido para el backup blockchain (esperado ${expectedSha256}, recibido ${actualSha256})`
        })
        return
      }

      resolve({
        ok: true,
        output: `Verified SHA-256 ${actualSha256}`
      })
    })
  })
}

async function downloadBlockchainBackupArchive(
  url: string,
  archivePath: string,
  expectedSha256: string,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<{ ok: boolean; output: string }> {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true })

  try {
    const response = await fetch(url)
    if (!response.ok) {
      return {
        ok: false,
        output: `No se pudo descargar el backup blockchain (HTTP ${response.status})`
      }
    }

    if (!response.body) {
      return {
        ok: false,
        output: 'La respuesta del backup blockchain no incluye body'
      }
    }

    const totalHeader = response.headers.get('content-length')
    const parsedTotal = totalHeader ? Number.parseInt(totalHeader, 10) : Number.NaN
    const totalBytes = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null
    let downloadedBytes = 0
    const hash = createHash('sha256')
    onProgress?.(downloadedBytes, totalBytes)

    const source = Readable.fromWeb(response.body as never)
    const progressTap = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        downloadedBytes += chunk.length
        onProgress?.(downloadedBytes, totalBytes)
        callback(null, chunk)
      }
    })

    await pipeline(source, progressTap, fs.createWriteStream(archivePath))
    onProgress?.(downloadedBytes, totalBytes)
    const actualSha256 = hash.digest('hex')

    if (actualSha256 !== expectedSha256) {
      return {
        ok: false,
        output: `Checksum SHA-256 invalido para el backup blockchain (esperado ${expectedSha256}, recibido ${actualSha256})`
      }
    }

    return {
      ok: true,
      output:
        totalBytes !== null
          ? `Downloaded ${formatByteCount(downloadedBytes)} of ${formatByteCount(totalBytes)} and verified SHA-256 ${actualSha256}`
          : `Downloaded ${formatByteCount(downloadedBytes)} and verified SHA-256 ${actualSha256}`
    }
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'No se pudo descargar el backup blockchain'
    }
  }
}

async function ensureBlockchainBackupArchiveCached(
  archiveUrl: string,
  archivePath: string,
  archiveStatePath: string,
  expectedSha256: string,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<{ ok: boolean; output: string }> {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true })

  let reuseNote = ''
  const cachedState = readJsonFile<BlockchainBackupArchiveState>(archiveStatePath)
  if (fs.existsSync(archivePath)) {
    if (archiveStateMatchesFile(archivePath, cachedState)) {
      return {
        ok: true,
        output: `Using cached backup archive ${archivePath}`
      }
    }

    const verifyResult = await verifyBlockchainBackupArchiveFile(archivePath, expectedSha256)
    if (verifyResult.ok) {
      writeJsonFile(archiveStatePath, buildBlockchainBackupArchiveState(archivePath))
      return {
        ok: true,
        output: `Using existing backup archive ${archivePath}. ${verifyResult.output}`
      }
    }

    reuseNote = `Cached backup archive invalid, re-downloading. ${verifyResult.output}`
    fs.rmSync(archivePath, { force: true })
    fs.rmSync(archiveStatePath, { force: true })
  }

  const downloadResult = await downloadBlockchainBackupArchive(archiveUrl, archivePath, expectedSha256, onProgress)
  if (!downloadResult.ok) {
    fs.rmSync(archivePath, { force: true })
    return {
      ok: false,
      output: [reuseNote, downloadResult.output].filter(Boolean).join('\n')
    }
  }

  writeJsonFile(archiveStatePath, buildBlockchainBackupArchiveState(archivePath))
  return {
    ok: true,
    output: [reuseNote, downloadResult.output].filter(Boolean).join('\n')
  }
}

function blockchainBackupPayloadRootPath(extractDir: string, payloadRootRelativePath: string): string {
  if (!payloadRootRelativePath) return extractDir
  return path.join(extractDir, ...payloadRootRelativePath.split('/').filter(Boolean))
}

function buildBlockchainBackupExtractState(
  payloadRootRelativePath: string,
  restoreDirectories: string[],
  completedDirectories: string[]
): BlockchainBackupExtractState {
  const normalizedRestoreDirectories = uniqueStringList(restoreDirectories)
  const allowed = new Set<string>(normalizedRestoreDirectories)
  return {
    payloadRootRelativePath,
    restoreDirectories: normalizedRestoreDirectories,
    completedDirectories: uniqueStringList(completedDirectories).filter((dirName) => allowed.has(dirName)),
    updatedAt: Date.now()
  }
}

async function extractBlockchainBackupDirectories(
  archivePath: string,
  extractDir: string,
  extractStatePath: string,
  payloadRootRelativePath: string,
  restoreDirectories: string[],
  runCommand: BackupServiceDeps['runCommand'],
  onProgress?: (dirName: string, index: number, total: number) => void
): Promise<{ ok: boolean; output: string }> {
  fs.mkdirSync(extractDir, { recursive: true })

  const payloadRoot = blockchainBackupPayloadRootPath(extractDir, payloadRootRelativePath)
  const existingState = readJsonFile<BlockchainBackupExtractState>(extractStatePath)
  const currentRestoreDirectories = uniqueStringList(restoreDirectories)
  const extractedDirectories = new Set<string>()

  if (
    existingState &&
    existingState.payloadRootRelativePath === payloadRootRelativePath &&
    existingState.restoreDirectories.every((dirName) => currentRestoreDirectories.includes(dirName))
  ) {
    for (const dirName of existingState.completedDirectories) {
      if (fs.existsSync(path.join(payloadRoot, dirName))) extractedDirectories.add(dirName)
    }
  }

  let extractState = buildBlockchainBackupExtractState(
    payloadRootRelativePath,
    currentRestoreDirectories,
    [...extractedDirectories]
  )
  writeJsonFile(extractStatePath, extractState)

  const pendingDirectories = currentRestoreDirectories.filter((dirName) => !extractedDirectories.has(dirName))
  if (!pendingDirectories.length) {
    return {
      ok: true,
      output: `Using cached extracted backup directories: ${currentRestoreDirectories.join(', ')}`
    }
  }

  const newlyExtracted: string[] = []
  for (let index = 0; index < pendingDirectories.length; index += 1) {
    const dirName = pendingDirectories[index]
    onProgress?.(dirName, index, pendingDirectories.length)

    const archiveMemberPath = payloadRootRelativePath ? path.posix.join(payloadRootRelativePath, dirName) : dirName
    const targetPath = path.join(payloadRoot, dirName)
    fs.rmSync(targetPath, { recursive: true, force: true })

    const extractResult = await runCommand('tar', ['-xzf', archivePath, '-C', extractDir, archiveMemberPath], {
      cwd: process.cwd()
    })
    if (!extractResult.ok) {
      return {
        ok: false,
        output: [`No se pudo extraer ${dirName} desde ${archiveMemberPath}`, extractResult.output].filter(Boolean).join('\n')
      }
    }

    newlyExtracted.push(dirName)
    extractedDirectories.add(dirName)
    extractState = buildBlockchainBackupExtractState(
      payloadRootRelativePath,
      currentRestoreDirectories,
      [...extractedDirectories]
    )
    writeJsonFile(extractStatePath, extractState)
  }

  return {
    ok: true,
    output: [
      extractedDirectories.size > newlyExtracted.length
        ? `Reused extracted directories: ${currentRestoreDirectories.filter((dirName) => !newlyExtracted.includes(dirName)).join(', ')}`
        : '',
      newlyExtracted.length ? `Extracted missing directories: ${newlyExtracted.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function restoreBlockchainBackupPayload(
  payloadRoot: string,
  restoreDirectories: string[],
  settings: KoinosNodeSettings
): string[] {
  fs.mkdirSync(settings.baseDir, { recursive: true })

  for (const dirName of BLOCKCHAIN_BACKUP_RESET_DIRS) {
    fs.rmSync(path.join(settings.baseDir, dirName), { recursive: true, force: true })
  }

  const restored: string[] = []
  for (const dirName of restoreDirectories) {
    const sourcePath = path.join(payloadRoot, dirName)
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
      throw new Error(`El directorio ${dirName} no existe en el backup extraido (${sourcePath})`)
    }

    const targetPath = path.join(settings.baseDir, dirName)
    fs.rmSync(targetPath, { recursive: true, force: true })
    fs.cpSync(sourcePath, targetPath, { recursive: true })
    restored.push(dirName)
  }

  if (restored.length === 0) {
    throw new Error('El backup no contiene ningun subdirectorio restaurable')
  }

  return restored
}

function sendBackupProgressEvent(sender: WebContents | null | undefined, payload: KoinosNodeBackupProgressEvent): void {
  if (!sender || sender.isDestroyed()) return
  sender.send('knodel:koinos-node:backup-progress:event', payload)
}

function createBackupProgressReporter(
  sender: WebContents | null | undefined,
  action: KoinosNodeBackupProgressAction
): (phase: KoinosNodeBackupProgressPhase, progress: number, message: string) => void {
  return (phase, progress, message) => {
    sendBackupProgressEvent(sender, {
      action,
      phase,
      progress: Math.max(0, Math.min(100, Math.trunc(progress))),
      message
    })
  }
}

function localNodeJsonRpcUrl(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, ServiceDefinition>,
  composeServicePortByTarget: BackupServiceDeps['composeServicePortByTarget']
): string {
  const jsonrpcPort = composeServicePortByTarget(serviceDefinitions.get('jsonrpc'), 8080)
  const host =
    jsonrpcPort?.host && jsonrpcPort.host !== '0.0.0.0' && jsonrpcPort.host !== '::' ? jsonrpcPort.host : '127.0.0.1'
  const port = jsonrpcPort?.publishedPort ?? 8080
  return `http://${host}:${port}/`
}

export function extractHeadInfoSummary(
  result: unknown
): { ok: boolean; height: string; headId: string; output: string } {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      height: '',
      headId: '',
      output: 'Respuesta invalida de chain.get_head_info'
    }
  }

  const payload = result as {
    head_topology?: { height?: string; id?: string }
  }
  const height = `${payload.head_topology?.height ?? ''}`.trim()
  const headId = `${payload.head_topology?.id ?? ''}`.trim()

  if (!headId) {
    return {
      ok: false,
      height,
      headId,
      output: 'chain.get_head_info no devolvio head_topology.id'
    }
  }

  return {
    ok: true,
    height,
    headId,
    output: `Verified local node head ${height || 'n/a'} (${headId})`
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createBackupService(deps: BackupServiceDeps) {
  async function koinosJsonRpcProxy(input?: KoinosJsonRpcProxyInput): Promise<KoinosJsonRpcProxyResult> {
    const rpcUrl = input?.rpcUrl?.trim() || ''
    const method = input?.method?.trim() || ''
    const params = input?.params ?? {}

    if (!rpcUrl) {
      return {
        ok: false,
        method,
        output: 'Parametro rpcUrl invalido'
      }
    }

    if (!method) {
      return {
        ok: false,
        method: '',
        output: 'Parametro method invalido'
      }
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)

      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params
          }),
          signal: controller.signal
        })

        if (!response.ok) {
          return {
            ok: false,
            method,
            output: `RPC HTTP ${response.status}`
          }
        }

        const payload = (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } }
        if (payload.error) {
          return {
            ok: false,
            method,
            output:
              typeof payload.error.data === 'string' && payload.error.data
                ? `${payload.error.message || 'RPC error'}: ${payload.error.data}`
                : payload.error.message || 'RPC error'
          }
        }

        return {
          ok: true,
          method,
          result: payload.result,
          output: ''
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RPC request failed'
      return {
        ok: false,
        method,
        output: message
      }
    }
  }

  async function waitForLocalNodeJsonRpcVerification(
    settings: KoinosNodeSettings,
    serviceDefinitions: Map<string, ServiceDefinition>,
    timeoutMs = 120000
  ): Promise<{ ok: boolean; output: string }> {
    const rpcUrl = localNodeJsonRpcUrl(settings, serviceDefinitions, deps.composeServicePortByTarget)
    const startedAt = Date.now()
    let lastOutput = ''

    while (Date.now() - startedAt < timeoutMs) {
      const rpcResult = await koinosJsonRpcProxy({
        rpcUrl,
        method: 'chain.get_head_info',
        params: {}
      })

      if (rpcResult.ok) {
        const summary = extractHeadInfoSummary(rpcResult.result)
        if (summary.ok) {
          return {
            ok: true,
            output: `${summary.output} via ${rpcUrl}`
          }
        }
        lastOutput = summary.output
      } else {
        lastOutput = rpcResult.output || 'chain.get_head_info no responde todavia'
      }

      await delay(2000)
    }

    return {
      ok: false,
      output: `No se pudo verificar chain.get_head_info via ${rpcUrl} en ${timeoutMs}ms${
        lastOutput ? `: ${lastOutput}` : ''
      }`
    }
  }

  async function koinosNodeRestoreBackup(
    input?: KoinosNodeSettingsInput,
    sender?: WebContents,
    progressAction: KoinosNodeBackupProgressAction = 'restore-backup',
    completeOnSuccess = true
  ): Promise<KoinosNodeBackupRestoreResult> {
    const settings = deps.normalizeNodeSettings(input)
    const notes: string[] = []
    const reportProgress = createBackupProgressReporter(sender, progressAction)

    try {
      deps.assertRepoReady(settings)
      const backupUrl = normalizeBlockchainBackupArchiveUrl(settings.blockchainBackupUrl)
      const checksumUrl = blockchainBackupChecksumUrl(backupUrl)
      const baseDirValidation = deps.validateNodeBaseDirAccess(settings)
      if (!baseDirValidation.ok) {
        reportProgress('error', 0, baseDirValidation.output)
        return {
          ok: false,
          action: progressAction,
          output: [...notes, baseDirValidation.output].filter(Boolean).join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }

      reportProgress('prepare', 2, `Preparing backup restore into ${settings.baseDir}`)
      reportProgress(
        'prepare',
        6,
        `Writable BASEDIR confirmed. Temporary restore workspace: ${baseDirValidation.restoreWorkspaceParent}`
      )
      reportProgress('stop', 8, 'Stopping node before restoring backup')
      const stopResult = await deps.koinosNodeAction('stop', input)

      if (stopResult.output) notes.push(stopResult.output)
      if (!stopResult.ok) {
        reportProgress('error', 8, stopResult.output || 'No se pudo detener el nodo antes de restaurar el backup')
        return {
          ok: false,
          action: progressAction,
          output: [...notes, 'No se pudo detener el nodo antes de restaurar el backup'].filter(Boolean).join('\n'),
          status: stopResult.status
        }
      }

      reportProgress('prepare', 15, 'Preparing runtime configuration files')
      const configPrep = deps.ensureKoinosConfigFiles(settings)
      if (configPrep.output) notes.push(configPrep.output)

      const restoreWorkspaceParent = baseDirValidation.restoreWorkspaceParent
      fs.mkdirSync(restoreWorkspaceParent, { recursive: true })
      notes.push(`Restoring blockchain backup from ${backupUrl}`)
      notes.push(`Backup workspace parent: ${restoreWorkspaceParent}`)

      reportProgress('checksum', 18, `Fetching SHA-256 checksum from ${checksumUrl}`)
      const [checksumResult, metadataResult] = await Promise.all([
        fetchBlockchainBackupChecksum(backupUrl),
        fetchBlockchainBackupMetadata(backupUrl)
      ])
      if (!checksumResult.ok || !checksumResult.checksum) {
        reportProgress('error', 18, checksumResult.output || 'No se pudo obtener el checksum SHA-256 del backup blockchain')
        return {
          ok: false,
          action: progressAction,
          output: [...notes, checksumResult.output || 'No se pudo obtener el checksum SHA-256 del backup blockchain']
            .filter(Boolean)
            .join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }
      notes.push(checksumResult.output)

      const workspace = blockchainBackupWorkspacePaths(restoreWorkspaceParent, backupUrl, checksumResult.checksum)
      fs.mkdirSync(workspace.workspaceDir, { recursive: true })
      notes.push(`Backup workspace: ${workspace.workspaceDir}`)

      reportProgress('download', 20, `Checking backup archive cache in ${workspace.workspaceDir}`)
      const archiveResult = await ensureBlockchainBackupArchiveCached(
        backupUrl,
        workspace.archivePath,
        workspace.archiveStatePath,
        checksumResult.checksum,
        (downloadedBytes, totalBytes) => {
          const progress = totalBytes && totalBytes > 0 ? 20 + Math.round((downloadedBytes / totalBytes) * 40) : 35
          const message =
            totalBytes && totalBytes > 0
              ? `Downloading backup archive (${formatByteCount(downloadedBytes)} of ${formatByteCount(totalBytes)})`
              : `Downloading backup archive (${formatByteCount(downloadedBytes)})`
          reportProgress('download', progress, message)
        }
      )
      if (!archiveResult.ok) {
        reportProgress('error', 60, archiveResult.output || 'No se pudo descargar el backup blockchain')
        return {
          ok: false,
          action: progressAction,
          output: [...notes, archiveResult.output || 'No se pudo descargar el backup blockchain'].filter(Boolean).join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }
      reportProgress('checksum', 64, 'SHA-256 checksum verified for backup archive')
      notes.push(archiveResult.output)

      let extractState = readJsonFile<BlockchainBackupExtractState>(workspace.extractStatePath)
      let payloadRootRelativePath = extractState?.payloadRootRelativePath ?? ''
      if (!payloadRootRelativePath) {
        const payloadRootResult = await discoverBlockchainBackupPayloadRootInArchive(workspace.archivePath)
        if (!payloadRootResult.ok || payloadRootResult.payloadRootRelativePath === undefined) {
          reportProgress('error', 64, payloadRootResult.output || 'No se pudo localizar el payload del backup blockchain')
          return {
            ok: false,
            action: progressAction,
            output: [...notes, payloadRootResult.output || 'No se pudo localizar el payload del backup blockchain']
              .filter(Boolean)
              .join('\n'),
            status: await deps.koinosNodeStatus(settings)
          }
        }
        payloadRootRelativePath = payloadRootResult.payloadRootRelativePath
        notes.push(payloadRootResult.output)
      }

      let restoreDirectories = extractState?.restoreDirectories ?? metadataResult.directories ?? []
      if (!restoreDirectories.length) {
        const archiveDirectoriesResult = await listBlockchainBackupPayloadDirectoriesFromArchive(
          workspace.archivePath,
          payloadRootRelativePath
        )
        if (!archiveDirectoriesResult.ok || !archiveDirectoriesResult.directories?.length) {
          reportProgress('error', 64, archiveDirectoriesResult.output || 'No se pudieron listar los directorios del backup')
          return {
            ok: false,
            action: progressAction,
            output: [...notes, archiveDirectoriesResult.output || 'No se pudieron listar los directorios del backup']
              .filter(Boolean)
              .join('\n'),
            status: await deps.koinosNodeStatus(settings)
          }
        }
        restoreDirectories = archiveDirectoriesResult.directories
        notes.push(archiveDirectoriesResult.output)
        if (!metadataResult.ok) {
          notes.push(`Metadata unavailable, inspected archive directly. ${metadataResult.output}`)
        }
      } else if (metadataResult.ok) {
        notes.push(metadataResult.output)
      }

      reportProgress('extract', 65, `Preparing extracted backup directories in ${workspace.extractDir}`)
      const extractResult = await extractBlockchainBackupDirectories(
        workspace.archivePath,
        workspace.extractDir,
        workspace.extractStatePath,
        payloadRootRelativePath,
        restoreDirectories,
        deps.runCommand,
        (dirName, index, total) => {
          const progress = 65 + Math.round(((index + 1) / Math.max(total, 1)) * 14)
          reportProgress('extract', Math.min(progress, 79), `Extracting ${dirName} (${index + 1} of ${total})`)
        }
      )
      if (!extractResult.ok) {
        reportProgress('error', 79, extractResult.output || 'No se pudo extraer el backup blockchain')
        return {
          ok: false,
          action: progressAction,
          output: [...notes, extractResult.output || 'No se pudo descargar o extraer el backup'].filter(Boolean).join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }
      notes.push(extractResult.output)

      reportProgress('restore', 80, `Restoring blockchain state into ${settings.baseDir}`)
      extractState = readJsonFile<BlockchainBackupExtractState>(workspace.extractStatePath)
      const payloadRootCandidate = blockchainBackupPayloadRootPath(
        workspace.extractDir,
        extractState?.payloadRootRelativePath ?? payloadRootRelativePath
      )
      const payloadRoot = fs.existsSync(payloadRootCandidate)
        ? payloadRootCandidate
        : findBlockchainBackupPayloadRoot(workspace.extractDir)
      if (!payloadRoot) {
        const payloadError = `El backup no contiene los directorios esperados (${BLOCKCHAIN_BACKUP_REQUIRED_DIRS.join(', ')})`
        reportProgress('error', 80, payloadError)
        return {
          ok: false,
          action: progressAction,
          output: [...notes, payloadError].filter(Boolean).join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }

      const restoredDirs = restoreBlockchainBackupPayload(payloadRoot, restoreDirectories, settings)
      notes.push(`Restored blockchain state: ${restoredDirs.join(', ')}`)
      if (BLOCKCHAIN_BACKUP_RESET_DIRS.length) {
        notes.push(`Cleared runtime state: ${BLOCKCHAIN_BACKUP_RESET_DIRS.join(', ')}`)
      }
      reportProgress('restore', 92, 'Preparing BASEDIR runtime files')
      notes.push(deps.ensureBaseDirKoinosRuntimeFiles(settings))

      const status = await deps.koinosNodeStatus(settings)
      if (completeOnSuccess) {
        reportProgress('complete', 100, `Backup restored into ${settings.baseDir}`)
      }
      return {
        ok: true,
        action: progressAction,
        output: notes.filter(Boolean).join('\n'),
        status
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo restaurar el backup blockchain'
      reportProgress('error', 0, message)
      return {
        ok: false,
        action: progressAction,
        output: [...notes, message].filter(Boolean).join('\n'),
        status: await deps.koinosNodeStatus(settings)
      }
    }
  }

  async function koinosNodeRestoreBackupAndVerify(
    input?: KoinosNodeSettingsInput,
    sender?: WebContents
  ): Promise<KoinosNodeBackupRestoreResult> {
    const settings = deps.normalizeNodeSettings(input)
    const notes: string[] = []
    const reportProgress = createBackupProgressReporter(sender, 'restore-backup-verify')

    try {
      deps.assertRepoReady(settings)
      const serviceDefinitions = deps.readServiceDefinitions(settings)
      const selectedServiceIds = deps.selectedManagedComposeServiceIds(settings, serviceDefinitions)

      if (!selectedServiceIds.includes('jsonrpc')) {
        const message =
          'Restore + Verify requiere que el profile actual incluya jsonrpc. Añade jsonrpc al profile o usa Restore Backup sin verificacion.'
        reportProgress('error', 0, message)
        return {
          ok: false,
          action: 'restore-backup-verify',
          output: [...notes, message].filter(Boolean).join('\n'),
          status: await deps.koinosNodeStatus(settings)
        }
      }

      reportProgress('prepare', 0, `Preparing restore + verify for ${settings.baseDir}`)
      const restoreResult = await koinosNodeRestoreBackup(settings, sender, 'restore-backup-verify', false)
      if (restoreResult.output) notes.push(restoreResult.output)
      if (!restoreResult.ok) {
        return {
          ok: false,
          action: 'restore-backup-verify',
          output: notes.filter(Boolean).join('\n'),
          status: restoreResult.status
        }
      }

      reportProgress('start', 84, 'Starting node after backup restore')
      const startResult = await deps.koinosNodeAction('start', settings)
      if (startResult.output) notes.push(startResult.output)
      if (!startResult.ok) {
        reportProgress('error', 84, startResult.output || 'No se pudo arrancar el nodo tras restaurar el backup')
        return {
          ok: false,
          action: 'restore-backup-verify',
          output: notes.filter(Boolean).join('\n'),
          status: startResult.status
        }
      }

      reportProgress('verify', 92, 'Verifying local JSON-RPC response from chain.get_head_info')
      const verificationResult = await waitForLocalNodeJsonRpcVerification(settings, serviceDefinitions)
      notes.push(verificationResult.output)
      const status = await deps.koinosNodeStatus(settings)
      reportProgress(
        verificationResult.ok ? 'complete' : 'error',
        verificationResult.ok ? 100 : 96,
        verificationResult.ok ? 'Backup restored and local node verified' : verificationResult.output
      )

      return {
        ok: verificationResult.ok,
        action: 'restore-backup-verify',
        output: notes.filter(Boolean).join('\n'),
        status
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo verificar el restore del backup'
      reportProgress('error', 0, message)
      return {
        ok: false,
        action: 'restore-backup-verify',
        output: [...notes, message].filter(Boolean).join('\n'),
        status: await deps.koinosNodeStatus(settings)
      }
    }
  }

  async function copyNodeBaseDirData(input?: KoinosNodeBaseDirCopyInput): Promise<KoinosNodeBaseDirCopyResult> {
    const settings = deps.normalizeNodeSettings(input)
    const sourceBaseDir = deps.ensureKoinosBaseDir(input?.sourceBaseDir || '')
    const targetBaseDir = deps.ensureKoinosBaseDir(input?.targetBaseDir || settings.baseDir)
    const outputs: string[] = []

    if (!sourceBaseDir) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: 'Parametro sourceBaseDir invalido',
        status: await deps.koinosNodeStatus(settings)
      }
    }

    if (path.resolve(sourceBaseDir) === path.resolve(targetBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: 'El origen y destino del BASEDIR son el mismo',
        status: await deps.koinosNodeStatus(settings)
      }
    }

    if (!fs.existsSync(sourceBaseDir) || !fs.statSync(sourceBaseDir).isDirectory()) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `No existe el BASEDIR origen: ${sourceBaseDir}`,
        status: await deps.koinosNodeStatus(settings)
      }
    }

    if (!directoryHasEntries(sourceBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `El BASEDIR origen esta vacio: ${sourceBaseDir}`,
        status: await deps.koinosNodeStatus(settings)
      }
    }

    if (directoryHasEntries(targetBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `El BASEDIR destino ya contiene datos: ${targetBaseDir}. Usa Restore Backup o vacia la carpeta antes de copiar.`,
        status: await deps.koinosNodeStatus(settings)
      }
    }

    try {
      fs.mkdirSync(path.dirname(targetBaseDir), { recursive: true })
      fs.cpSync(sourceBaseDir, targetBaseDir, { recursive: true, force: false, errorOnExist: true })
      outputs.push(`Copied local state from ${sourceBaseDir} to ${targetBaseDir}`)
      if (!fs.existsSync(path.join(targetBaseDir, 'config.yml'))) {
        outputs.push(deps.ensureBaseDirKoinosRuntimeFiles({ ...settings, baseDir: targetBaseDir }))
      }

      return {
        ok: true,
        sourceBaseDir,
        targetBaseDir,
        output: outputs.filter(Boolean).join('\n'),
        status: await deps.koinosNodeStatus(settings)
      }
    } catch (error) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: [...outputs, error instanceof Error ? error.message : 'No se pudo copiar el BASEDIR']
          .filter(Boolean)
          .join('\n'),
        status: await deps.koinosNodeStatus(settings)
      }
    }
  }

  async function selectNodeBaseDir(input?: KoinosNodeSettingsInput): Promise<KoinosNodeSelectDirectoryResult> {
    const settings = deps.normalizeNodeSettings(input)
    const focusedWindow = BrowserWindow.getFocusedWindow()

    try {
      const dialogOptions = {
        title: 'Select Koinos Base Data Directory',
        defaultPath: settings.baseDir || DEFAULT_BASEDIR,
        properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'] as OpenDialogOptions['properties'],
        buttonLabel: 'Use Folder'
      }
      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return {
          ok: true,
          canceled: true,
          path: settings.baseDir,
          restoreWorkspaceParent: deps.restoreWorkspaceParentPath(settings.baseDir),
          writable: true,
          output: 'Seleccion de carpeta cancelada'
        }
      }

      const selectedPath = deps.ensureKoinosBaseDir(result.filePaths[0])
      const validation = deps.validateNodeBaseDirAccess({ ...input, baseDir: selectedPath })
      if (!validation.ok) {
        return {
          ok: false,
          canceled: false,
          path: validation.baseDir,
          restoreWorkspaceParent: validation.restoreWorkspaceParent,
          writable: false,
          output: validation.output
        }
      }

      return {
        ok: true,
        canceled: false,
        path: selectedPath,
        restoreWorkspaceParent: validation.restoreWorkspaceParent,
        writable: true,
        output: `BASEDIR seleccionado: ${selectedPath} · restore temporal en ${validation.restoreWorkspaceParent}`
      }
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        path: settings.baseDir,
        restoreWorkspaceParent: deps.restoreWorkspaceParentPath(settings.baseDir),
        writable: false,
        output: error instanceof Error ? error.message : 'No se pudo abrir el selector de carpetas'
      }
    }
  }

  return {
    koinosJsonRpcProxy,
    koinosNodeRestoreBackup,
    koinosNodeRestoreBackupAndVerify,
    copyNodeBaseDirData,
    selectNodeBaseDir
  }
}
