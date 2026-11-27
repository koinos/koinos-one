import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron'
import { parseDocument } from 'yaml'

import { DEFAULT_BASEDIR, resolveMonolithBinaryPath, resolveTelenoConfigRoot } from './constants'
import type {
  KoinosJsonRpcProxyInput,
  KoinosJsonRpcProxyResult,
  TelenoNodeBackupProgressAction,
  TelenoNodeBackupProgressEvent,
  TelenoNodeBackupProgressPhase,
  TelenoNodeBackupRestoreResult,
  TelenoNodeBackupSettings,
  TelenoNodeBackupSettingsInput,
  TelenoNodeBaseDirCopyInput,
  TelenoNodeBaseDirCopyResult,
  TelenoNodeCommandResult,
  TelenoNodeNativeBackupConfigResult,
  TelenoNodeNativeBackupListResult,
  TelenoNodeNativeBackupDryRunResult,
  TelenoNodeNativeBackupPurgeInput,
  TelenoNodeNativeBackupPurgeResult,
  TelenoNodeNativeBackupPreflightResult,
  TelenoNodeNativeBackupRestoreInput,
  TelenoNodeNativeBackupRemoteSpace,
  TelenoNodeNativeBackupSnapshot,
  TelenoNodeSelectDirectoryResult,
  TelenoNodeServicePort,
  TelenoNodeSettings,
  TelenoNodeSettingsInput,
  TelenoNodeStatus,
  TelenoNodeValidateBaseDirResult
} from './main-types'
import { normalizeBackupSettings } from './node-paths'
import { legacyBackupUrlForNetwork, normalizeBlockchainBackupArchiveUrl } from './legacy-backup-url'
import { directoryHasEntries } from './workspace-service'

const BLOCKCHAIN_BACKUP_REQUIRED_DIRS = ['chain', 'block_store'] as const
const LAST_BACKUP_PATH_FILE = '.teleno-last-backup-path'

function readLastBackupPath(): string | null {
  try {
    const filePath = path.join(process.env.HOME || process.env.USERPROFILE || '', LAST_BACKUP_PATH_FILE)
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim() || null
  } catch { /* ignore */ }
  return null
}

function saveLastBackupPath(backupFilePath: string): void {
  try {
    const filePath = path.join(process.env.HOME || process.env.USERPROFILE || '', LAST_BACKUP_PATH_FILE)
    fs.writeFileSync(filePath, path.dirname(backupFilePath), 'utf8')
  } catch { /* ignore */ }
}
const BLOCKCHAIN_BACKUP_RESET_DIRS = ['mempool'] as const
const BLOCKCHAIN_BACKUP_CACHE_DIR = '.teleno-blockchain-backup-cache'
const LEGACY_RESTORE_LOCK = '.teleno-legacy-restore.lock'
const legacyRestoreQueue = new Map<string, Promise<void>>()
const EXCLUSIVE_ARCHIVE_COPY = fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE
class LegacyRestoreRecoveryError extends Error {}
const NATIVE_BACKUP_DIR = '.teleno-native-backups'
const PUBLIC_TESTNET_BOOTSTRAP_URL = 'https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap'
const PUBLIC_MAINNET_BOOTSTRAP_URL = 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap'
const PUBLIC_TESTNET_BOOTSTRAP_KEY_RELATIVE = path.join('public-bootstrap', 'testnet-ed25519.pub')
const PUBLIC_MAINNET_BOOTSTRAP_KEY_RELATIVE = path.join('public-bootstrap', 'prodnet-ed25519.pub')

function publicBootstrapUrlForNetwork(network: TelenoNodeSettings['network']): string {
  if (network === 'testnet') return PUBLIC_TESTNET_BOOTSTRAP_URL
  if (network === 'mainnet') return PUBLIC_MAINNET_BOOTSTRAP_URL
  return ''
}

function publicBootstrapSignaturePublicKeyFileForNetwork(network: TelenoNodeSettings['network']): string {
  const relativePath = network === 'testnet'
    ? PUBLIC_TESTNET_BOOTSTRAP_KEY_RELATIVE
    : network === 'mainnet'
      ? PUBLIC_MAINNET_BOOTSTRAP_KEY_RELATIVE
      : ''
  if (!relativePath) return ''
  const keyFile = path.join(resolveTelenoConfigRoot(), relativePath)
  return fs.existsSync(keyFile) ? keyFile : ''
}

function publicBootstrapCliArgs(settings: TelenoNodeSettings): string[] {
  const publicBootstrapUrl = publicBootstrapUrlForNetwork(settings.network)
  return publicBootstrapUrl ? ['--backup-public-url', publicBootstrapUrl] : []
}

// ── Config.yml verify-blocks helper ──

/**
 * Read or modify the `chain.verify-blocks` setting in the BASEDIR config.yml.
 * Uses the `yaml` library to preserve comments and formatting.
 */
function setConfigVerifyBlocks(baseDir: string, enabled: boolean): { ok: boolean; output: string } {
  const configPath = path.join(baseDir, 'config.yml')
  try {
    if (!fs.existsSync(configPath)) {
      return { ok: false, output: `config.yml not found at ${configPath}` }
    }
    const raw = fs.readFileSync(configPath, 'utf-8')
    const doc = parseDocument(raw)
    doc.setIn(['chain', 'verify-blocks'], enabled)
    fs.writeFileSync(configPath, doc.toString(), 'utf-8')
    return { ok: true, output: `Set chain.verify-blocks=${enabled} in ${configPath}` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: `Failed to set verify-blocks: ${msg}` }
  }
}

function readConfigVerifyBlocks(baseDir: string): boolean | null {
  const configPath = path.join(baseDir, 'config.yml')
  try {
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf-8')
    const doc = parseDocument(raw)
    const value = doc.getIn(['chain', 'verify-blocks'])
    if (typeof value === 'boolean') return value
    return null
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ServiceDefinition = Record<string, unknown>

type BackupServiceDeps = {
  normalizeNodeSettings: (input?: TelenoNodeSettingsInput) => TelenoNodeSettings
  assertRepoReady: (settings: TelenoNodeSettings) => void
  ensureKoinosConfigFiles: (settings: TelenoNodeSettings) => { configReady: boolean; output: string }
  ensureBaseDirKoinosRuntimeFiles: (settings: TelenoNodeSettings) => string
  validateNodeBaseDirAccess: (input?: TelenoNodeSettingsInput) => TelenoNodeValidateBaseDirResult
  restoreWorkspaceParentPath: (baseDir: string) => string
  ensureKoinosBaseDir: (baseDir: string) => string
  readServiceDefinitions: (settings: TelenoNodeSettings) => Map<string, ServiceDefinition>
  selectedManagedComposeServiceIds: (
    settings: TelenoNodeSettings,
    serviceDefinitions: Map<string, ServiceDefinition>
  ) => string[]
  composeServicePortByTarget: (
    definition: ServiceDefinition | undefined,
    targetPort: number
  ) => TelenoNodeServicePort | null
  telenoNodeStatus: (input?: TelenoNodeSettingsInput) => Promise<TelenoNodeStatus>
  telenoNodeAction: (action: 'start' | 'stop', input?: TelenoNodeSettingsInput) => Promise<TelenoNodeCommandResult>
  runCommand: (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ) => Promise<{ ok: boolean; code: number | null; output: string }>
}

export { normalizeBlockchainBackupArchiveUrl } from './legacy-backup-url'

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

function blockchainBackupCachePath(
  restoreWorkspaceParent: string,
  archiveUrl: string,
  checksum: string
): string {
  const archiveKey = createHash('sha1').update(archiveUrl).digest('hex').slice(0, 12)
  const cacheRoot = checkedRestoreChild(restoreWorkspaceParent, BLOCKCHAIN_BACKUP_CACHE_DIR)
  fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 })
  const cacheDir = checkedRestoreChild(cacheRoot, `${archiveKey}-${checksum.slice(0, 12)}`)
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  return checkedRestoreChild(cacheDir, 'backup.tar.gz')
}

function createRestoreAttempt(restoreWorkspaceParent: string): string {
  fs.mkdirSync(restoreWorkspaceParent, { recursive: true })
  return fs.mkdtempSync(path.join(fs.realpathSync(restoreWorkspaceParent), '.teleno-legacy-restore-'))
}

function removeRestoreAttempt(attempt: string): void {
  try {
    fs.rmSync(attempt, { recursive: true, force: true })
  } catch (error) {
    console.warn('Could not remove the legacy restore workspace', attempt, error)
  }
}

async function withLegacyRestoreDestination<T>(
  settings: TelenoNodeSettings,
  restore: (lockedSettings: TelenoNodeSettings) => Promise<T>
): Promise<T> {
  fs.mkdirSync(settings.baseDir, { recursive: true })
  if (fs.lstatSync(settings.baseDir).isSymbolicLink()) throw new Error('Select the real node data directory for restore.')
  const baseDir = fs.realpathSync(settings.baseDir)
  const { dev, ino } = fs.statSync(baseDir, { bigint: true })
  const key = ino === 0n ? baseDir : `${dev}:${ino}`
  const previous = legacyRestoreQueue.get(key)
  let release!: () => void
  const turn = new Promise<void>((resolve) => { release = resolve })
  legacyRestoreQueue.set(key, turn)
  await previous

  try {
    const lockPath = path.join(baseDir, LEGACY_RESTORE_LOCK)
    const lock = await fs.promises.open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new Error('Another legacy restore holds this data folder. Retry after it finishes.')
      throw error
    })
    try {
      return await restore({ ...settings, baseDir })
    } finally {
      try {
        await lock.close()
      } finally {
        await fs.promises.unlink(lockPath)
      }
    }
  } finally {
    release()
    if (legacyRestoreQueue.get(key) === turn) legacyRestoreQueue.delete(key)
  }
}

function nativeBackupRepositoryDir(baseDir: string): string {
  return path.join(baseDir, NATIVE_BACKUP_DIR, 'repository')
}

function nativeBackupWorkspaceDir(baseDir: string): string {
  return path.join(baseDir, NATIVE_BACKUP_DIR, 'workspace')
}

function nativeBackupConfigPath(baseDir: string): string {
  return path.join(baseDir, NATIVE_BACKUP_DIR, 'teleno-native-backup-config.yml')
}

function nativeBackupAdminTokenPath(baseDir: string): string {
  return path.join(baseDir, NATIVE_BACKUP_DIR, 'admin.token')
}

function ensureNativeBackupAdminTokenFile(baseDir: string, requestedPath: string): string {
  const tokenPath = expandBackupFilePath(requestedPath) || nativeBackupAdminTokenPath(baseDir)
  if (fs.existsSync(tokenPath)) {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (existing) {
      try { fs.chmodSync(tokenPath, 0o600) } catch { /* best effort */ }
      return tokenPath
    }
  }

  fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
  fs.writeFileSync(tokenPath, `${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 })
  try { fs.chmodSync(tokenPath, 0o600) } catch { /* best effort */ }
  return tokenPath
}

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = `${value || ''}`.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function expandBackupFilePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === '~') return process.env.HOME || process.env.USERPROFILE || trimmed
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (homeDir) return path.join(homeDir, trimmed.slice(2))
  }
  return trimmed
}

function yamlString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function yamlNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function yamlBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readNativeBackupSettingsFromDocument(
  doc: ReturnType<typeof parseDocument>,
  fallback: TelenoNodeBackupSettings
): TelenoNodeBackupSettings {
  const partial: TelenoNodeBackupSettingsInput = {}
  const assign = <K extends keyof TelenoNodeBackupSettingsInput>(
    key: K,
    value: TelenoNodeBackupSettingsInput[K] | undefined
  ) => {
    if (value !== undefined) partial[key] = value
  }

  assign('localEnabled', yamlBoolean(doc.getIn(['backup', 'local', 'enabled'])))
  assign('localDirectory', yamlString(doc.getIn(['backup', 'local', 'directory'])))
  assign('workspace', yamlString(doc.getIn(['backup', 'workspace'])))
  assign('localRetentionCount', yamlNumber(doc.getIn(['backup', 'local', 'retention-count'])))

  const remoteEnabled = yamlBoolean(doc.getIn(['backup', 'remote', 'enabled']))
  assign('remoteEnabled', remoteEnabled ?? yamlBoolean(doc.getIn(['backup', 'ssh', 'enabled'])))
  assign('remoteDirectory', yamlString(doc.getIn(['backup', 'remote', 'directory'])))
  assign('remoteRetentionCount', yamlNumber(doc.getIn(['backup', 'remote', 'retention-count'])))
  assign('remoteRetentionDays', yamlNumber(doc.getIn(['backup', 'remote', 'retention-days'])))
  assign('uploadTempSuffix', yamlString(doc.getIn(['backup', 'remote', 'upload-temp-suffix'])))

  assign('sshHost', yamlString(doc.getIn(['backup', 'ssh', 'host'])))
  assign('sshPort', yamlNumber(doc.getIn(['backup', 'ssh', 'port'])))
  assign('sshUser', yamlString(doc.getIn(['backup', 'ssh', 'user'])))
  assign('sshAuth', yamlString(doc.getIn(['backup', 'ssh', 'auth'])) as TelenoNodeBackupSettingsInput['sshAuth'])
  assign('sshPrivateKeyFile', yamlString(doc.getIn(['backup', 'ssh', 'private-key-file'])))
  assign('sshPasswordFile', yamlString(doc.getIn(['backup', 'ssh', 'password-file'])))
  assign('sshPassphraseFile', yamlString(doc.getIn(['backup', 'ssh', 'passphrase-file'])))
  assign('sshKnownHostsFile', yamlString(doc.getIn(['backup', 'ssh', 'known-hosts-file'])))
  assign('sshStrictHostKeyChecking', yamlBoolean(doc.getIn(['backup', 'ssh', 'strict-host-key-checking'])))
  assign('sshConnectTimeoutSeconds', yamlNumber(doc.getIn(['backup', 'ssh', 'connect-timeout-seconds'])))

  assign('scheduleEnabled', yamlBoolean(doc.getIn(['backup', 'schedule', 'enabled'])))
  assign('scheduleInterval', yamlString(doc.getIn(['backup', 'schedule', 'interval'])))
  assign('scheduleRunOnStartupIfMissed', yamlBoolean(doc.getIn(['backup', 'schedule', 'run-on-startup-if-missed'])))
  assign('scheduleJitterSeconds', yamlNumber(doc.getIn(['backup', 'schedule', 'jitter-seconds'])))
  assign('scheduleMinimumHeadProgress', yamlNumber(doc.getIn(['backup', 'schedule', 'minimum-head-progress'])))
  assign('scheduleSkipIfSyncingFromGenesis', yamlBoolean(doc.getIn(['backup', 'schedule', 'skip-if-syncing-from-genesis'])))
  assign('scheduleMaxConcurrentBackups', yamlNumber(doc.getIn(['backup', 'schedule', 'max-concurrent-backups'])))

  assign('adminEnabled', yamlBoolean(doc.getIn(['backup', 'admin', 'enabled'])))
  assign('adminListen', yamlString(doc.getIn(['backup', 'admin', 'listen'])))
  assign('adminTokenFile', yamlString(doc.getIn(['backup', 'admin', 'token-file'])))
  assign('adminJobs', yamlNumber(doc.getIn(['backup', 'admin', 'jobs'])))

  return normalizeBackupSettings({ ...fallback, ...partial })
}

function applyNativeBackupRemoteEnv(doc: ReturnType<typeof parseDocument>): void {
  if (!envFlagEnabled(process.env.TELENO_BACKUP_REMOTE)) return

  const host = process.env.TELENO_BACKUP_SSH_HOST?.trim()
  const user = process.env.TELENO_BACKUP_SSH_USER?.trim()
  const remoteDir = process.env.TELENO_BACKUP_REMOTE_DIR?.trim()
  if (!host || !user || !remoteDir) {
    throw new Error('TELENO_BACKUP_REMOTE=1 requires TELENO_BACKUP_SSH_HOST, TELENO_BACKUP_SSH_USER, and TELENO_BACKUP_REMOTE_DIR')
  }
  if (!remoteDir.startsWith('/')) {
    throw new Error('TELENO_BACKUP_REMOTE_DIR must be an absolute remote path')
  }

  const auth = process.env.TELENO_BACKUP_SSH_AUTH?.trim() || 'private-key'
  doc.setIn(['backup', 'ssh', 'enabled'], true)
  doc.setIn(['backup', 'ssh', 'transport'], 'native')
  doc.setIn(['backup', 'ssh', 'host'], host)
  doc.setIn(['backup', 'ssh', 'port'], Number(process.env.TELENO_BACKUP_SSH_PORT || 22))
  doc.setIn(['backup', 'ssh', 'user'], user)
  doc.setIn(['backup', 'ssh', 'auth'], auth)
  doc.setIn(['backup', 'ssh', 'strict-host-key-checking'], process.env.TELENO_BACKUP_SSH_STRICT_HOST_KEY_CHECKING !== 'false')
  doc.setIn(['backup', 'ssh', 'connect-timeout-seconds'], Number(process.env.TELENO_BACKUP_SSH_CONNECT_TIMEOUT_SECONDS || 15))

  if (process.env.TELENO_BACKUP_SSH_PRIVATE_KEY_FILE) {
    doc.setIn(['backup', 'ssh', 'private-key-file'], process.env.TELENO_BACKUP_SSH_PRIVATE_KEY_FILE)
  }
  if (process.env.TELENO_BACKUP_SSH_PASSWORD_FILE) {
    doc.setIn(['backup', 'ssh', 'password-file'], process.env.TELENO_BACKUP_SSH_PASSWORD_FILE)
  }
  if (process.env.TELENO_BACKUP_SSH_PASSPHRASE_FILE) {
    doc.setIn(['backup', 'ssh', 'passphrase-file'], process.env.TELENO_BACKUP_SSH_PASSPHRASE_FILE)
  }
  if (process.env.TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE) {
    doc.setIn(['backup', 'ssh', 'known-hosts-file'], process.env.TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE)
  }

  doc.setIn(['backup', 'remote', 'enabled'], true)
  doc.setIn(['backup', 'remote', 'directory'], remoteDir)
  doc.setIn(['backup', 'remote', 'retention-count'], Number(process.env.TELENO_BACKUP_REMOTE_RETENTION_COUNT || 14))
  doc.setIn(['backup', 'remote', 'retention-days'], Number(process.env.TELENO_BACKUP_REMOTE_RETENTION_DAYS || 30))
  doc.setIn(['backup', 'remote', 'upload-temp-suffix'], process.env.TELENO_BACKUP_REMOTE_UPLOAD_TEMP_SUFFIX || '.partial')
}

export function writeNativeBackupConfig(settings: TelenoNodeSettings): {
  configPath: string
  repositoryDir: string
  workspaceDir: string
} {
  const configPath = nativeBackupConfigPath(settings.baseDir)
  const repositoryDir = nativeBackupRepositoryDir(settings.baseDir)
  const workspaceDir = nativeBackupWorkspaceDir(settings.baseDir)
  const backup = settings.backup
  const localEnabled = backup.remoteEnabled || backup.localEnabled
  const localDirectory = expandBackupFilePath(backup.localDirectory) || repositoryDir
  const workspace = expandBackupFilePath(backup.workspace) || workspaceDir
  const sshPrivateKeyFile = expandBackupFilePath(backup.sshPrivateKeyFile)
  const sshPasswordFile = expandBackupFilePath(backup.sshPasswordFile)
  const sshPassphraseFile = expandBackupFilePath(backup.sshPassphraseFile)
  const sshKnownHostsFile = expandBackupFilePath(backup.sshKnownHostsFile)
  const adminTokenFile = backup.adminEnabled
    ? ensureNativeBackupAdminTokenFile(settings.baseDir, backup.adminTokenFile)
    : expandBackupFilePath(backup.adminTokenFile)
  const sourceConfigPath = path.join(settings.baseDir, 'config.yml')
  const raw = fs.existsSync(sourceConfigPath) ? fs.readFileSync(sourceConfigPath, 'utf8') : ''
  const doc = parseDocument(raw || '{}\n')

  doc.setIn(['backup', 'enabled'], true)
  doc.setIn(['backup', 'node-id'], `teleno-ux-${settings.network}`)
  doc.setIn(['backup', 'workspace'], workspace)
  doc.setIn(['backup', 'local', 'enabled'], localEnabled)
  doc.setIn(['backup', 'local', 'directory'], localDirectory)
  doc.setIn(['backup', 'local', 'retention-count'], backup.localRetentionCount)
  doc.setIn(['backup', 'ssh', 'enabled'], backup.remoteEnabled)
  doc.setIn(['backup', 'ssh', 'transport'], 'native')
  doc.setIn(['backup', 'ssh', 'host'], backup.sshHost)
  doc.setIn(['backup', 'ssh', 'port'], backup.sshPort)
  doc.setIn(['backup', 'ssh', 'user'], backup.sshUser)
  doc.setIn(['backup', 'ssh', 'auth'], backup.sshAuth)
  doc.setIn(['backup', 'ssh', 'strict-host-key-checking'], backup.sshStrictHostKeyChecking)
  doc.setIn(['backup', 'ssh', 'connect-timeout-seconds'], backup.sshConnectTimeoutSeconds)
  if (sshPrivateKeyFile) doc.setIn(['backup', 'ssh', 'private-key-file'], sshPrivateKeyFile)
  if (sshPasswordFile) doc.setIn(['backup', 'ssh', 'password-file'], sshPasswordFile)
  if (sshPassphraseFile) doc.setIn(['backup', 'ssh', 'passphrase-file'], sshPassphraseFile)
  if (sshKnownHostsFile) doc.setIn(['backup', 'ssh', 'known-hosts-file'], sshKnownHostsFile)
  doc.setIn(['backup', 'remote', 'enabled'], backup.remoteEnabled)
  doc.setIn(['backup', 'remote', 'directory'], backup.remoteDirectory)
  doc.setIn(['backup', 'remote', 'retention-count'], backup.remoteRetentionCount)
  doc.setIn(['backup', 'remote', 'retention-days'], backup.remoteRetentionDays)
  doc.setIn(['backup', 'remote', 'upload-temp-suffix'], backup.uploadTempSuffix || '.partial')
  doc.setIn(['backup', 'schedule', 'enabled'], backup.scheduleEnabled)
  doc.setIn(['backup', 'schedule', 'interval'], backup.scheduleInterval)
  doc.setIn(['backup', 'schedule', 'run-on-startup-if-missed'], backup.scheduleRunOnStartupIfMissed)
  doc.setIn(['backup', 'schedule', 'jitter-seconds'], backup.scheduleJitterSeconds)
  doc.setIn(['backup', 'schedule', 'minimum-head-progress'], backup.scheduleMinimumHeadProgress)
  doc.setIn(['backup', 'schedule', 'skip-if-syncing-from-genesis'], backup.scheduleSkipIfSyncingFromGenesis)
  doc.setIn(['backup', 'schedule', 'max-concurrent-backups'], backup.scheduleMaxConcurrentBackups)
  doc.setIn(['backup', 'admin', 'enabled'], backup.adminEnabled)
  doc.setIn(['backup', 'admin', 'listen'], backup.adminListen)
  doc.setIn(['backup', 'admin', 'token-file'], adminTokenFile)
  doc.setIn(['backup', 'admin', 'jobs'], backup.adminJobs)
  const publicBootstrapUrl = publicBootstrapUrlForNetwork(settings.network)
  doc.setIn(['backup', 'public-restore', 'enabled'], Boolean(publicBootstrapUrl))
  doc.setIn(['backup', 'public-restore', 'base-url'], publicBootstrapUrl)
  doc.setIn(['backup', 'public-restore', 'network'], settings.network)
  doc.setIn(['backup', 'public-restore', 'require-https'], true)
  doc.setIn(['backup', 'public-restore', 'timeout-seconds'], 30)
  doc.setIn(['backup', 'public-restore', 'retries'], 3)
  const publicBootstrapSignatureKeyFile = publicBootstrapSignaturePublicKeyFileForNetwork(settings.network)
  doc.setIn(['backup', 'public-restore', 'signature-required'], Boolean(publicBootstrapUrl && publicBootstrapSignatureKeyFile))
  doc.setIn(['backup', 'public-restore', 'signature-public-key-file'], publicBootstrapSignatureKeyFile)
  applyNativeBackupRemoteEnv(doc)

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.mkdirSync(localDirectory, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(configPath, doc.toString(), 'utf8')

  return { configPath, repositoryDir: localDirectory, workspaceDir: workspace }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

type NativeBackupRestoreSource = 'local' | 'remote' | 'public' | 'auto'

function nativeBackupRestoreSource(input: TelenoNodeNativeBackupRestoreInput | undefined): NativeBackupRestoreSource {
  const value = input?.backupSource
  return value === 'local' || value === 'remote' || value === 'public' ? value : 'auto'
}

type NativeBackupProgressPayload = {
  phase: string
  backupId: string
  completedBatches: number
  totalBatches: number
  attempt: number
  fileCount: number
  completedBytes: number
  totalBytes: number
}

type BackupProgressTelemetry = Partial<Pick<
  TelenoNodeBackupProgressEvent,
  | 'completedBytes'
  | 'totalBytes'
  | 'bytesPerSecond'
  | 'etaSeconds'
  | 'completedBatches'
  | 'totalBatches'
  | 'phaseProgress'
  | 'progressRangeStart'
  | 'progressRangeEnd'
>>

type TrackedBackupCommandResult = {
  ok: boolean
  code: number | null
  output: string
  stdout: string
  stderr: string
}

function parseNativeBackupProgressLine(line: string): NativeBackupProgressPayload | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>
    if (payload.event !== 'backup-progress') return null
    return {
      phase: stringField(payload.phase),
      backupId: stringField(payload.backup_id),
      completedBatches: numberField(payload.completed_batches),
      totalBatches: numberField(payload.total_batches),
      attempt: numberField(payload.attempt),
      fileCount: numberField(payload.file_count),
      completedBytes: numberField(payload.completed_bytes),
      totalBytes: numberField(payload.total_bytes)
    }
  } catch {
    return null
  }
}

function nativeProgressFraction(progress: NativeBackupProgressPayload): number {
  if (!progress.totalBatches) {
    return progress.totalBytes > 0 ? Math.max(0, Math.min(1, progress.completedBytes / progress.totalBytes)) : 0
  }
  return Math.max(0, Math.min(1, progress.completedBatches / progress.totalBatches))
}

function nativeProgressTelemetry(
  progress: NativeBackupProgressPayload,
  progressRangeStart: number,
  progressRangeEnd: number
): BackupProgressTelemetry {
  const phaseProgress = nativeProgressFraction(progress)
  const totalBytes = progress.totalBytes > 0 ? progress.totalBytes : null
  const completedBytes = progress.completedBytes > 0 ? progress.completedBytes : null
  return {
    completedBytes,
    totalBytes,
    completedBatches: progress.completedBatches || null,
    totalBatches: progress.totalBatches || null,
    phaseProgress,
    progressRangeStart,
    progressRangeEnd
  }
}

function nativeProgressSuffix(progress: NativeBackupProgressPayload): string {
  const unit = progress.phase.includes('stage')
    ? 'files'
    : progress.phase.includes('objects')
      ? 'objects'
      : 'operations'
  const operations = progress.totalBatches
    ? `${progress.completedBatches}/${progress.totalBatches} ${unit}`
    : ''
  const size = progress.totalBytes ? formatByteCount(progress.totalBytes) : ''
  return [operations, size].filter(Boolean).join(' · ')
}

function nativeBackupSnapshotFromPayload(value: unknown): TelenoNodeNativeBackupSnapshot {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const restoreSpace = item.restore_space && typeof item.restore_space === 'object'
    ? item.restore_space as Record<string, unknown>
    : {}
  return {
    backupId: stringField(item.backup_id),
    createdAt: stringField(item.created_at),
    latest: item.latest === true,
    complete: item.complete === true,
    nodeId: stringField(item.node_id),
    nodeVersion: stringField(item.node_version),
    storageLayout: stringField(item.storage_layout),
    publicBootstrap: item.public_bootstrap === true,
    network: stringField(item.network),
    chainId: stringField(item.chain_id),
    publicBaseUrl: stringField(item.public_base_url),
    promotedAt: stringField(item.promoted_at),
    sourceBackupId: stringField(item.source_backup_id),
    sourceCreatedAt: stringField(item.source_created_at),
    sourceNodeVersion: stringField(item.source_node_version),
    sourceHeadHeight: numberField(item.source_head_height),
    sourceLibHeight: numberField(item.source_lib_height),
    repositoryDir: stringField(item.repository_dir),
    snapshotDir: stringField(item.snapshot_dir),
    manifest: stringField(item.manifest),
    files: stringField(item.files),
    fileCount: numberField(item.file_count),
    objectCount: numberField(item.object_count),
    totalBytes: numberField(item.total_bytes),
    restoreSpace: {
      restoredDatabaseBytes: numberField(restoreSpace.restored_database_bytes),
      runtimeFilesBytes: numberField(restoreSpace.runtime_files_bytes),
      objectDownloadBytes: numberField(restoreSpace.object_download_bytes),
      minimumTargetFreeBytes: numberField(restoreSpace.minimum_target_free_bytes),
      recommendedTargetFreeBytes: numberField(restoreSpace.recommended_target_free_bytes)
    }
  }
}

function publicRestorePreflightFromFetchPayload(payload: Record<string, unknown>): Pick<
  TelenoNodeNativeBackupPreflightResult,
  | 'backupId'
  | 'readyToRestore'
  | 'snapshotComplete'
  | 'fileCount'
  | 'missingObjectCount'
  | 'missingObjectBytes'
  | 'restoreSpace'
  | 'spaceCheck'
> {
  const preflight = payload.preflight && typeof payload.preflight === 'object'
    ? payload.preflight as Record<string, unknown>
    : {}
  return {
    backupId: stringField(payload.backup_id),
    readyToRestore: payload.ready_to_stage === true,
    snapshotComplete: preflight.snapshot_complete === true,
    fileCount: numberField(payload.object_file_count),
    missingObjectCount: numberField(preflight.missing_object_count),
    missingObjectBytes: numberField(preflight.missing_object_bytes),
    restoreSpace: {
      restoredDatabaseBytes: 0,
      runtimeFilesBytes: 0,
      objectDownloadBytes: numberField(payload.repository_required_bytes),
      minimumTargetFreeBytes: numberField(preflight.target_minimum_free_bytes),
      recommendedTargetFreeBytes: numberField(preflight.target_recommended_free_bytes)
    },
    spaceCheck: {
      passesMinimum: preflight.target_space_passes_minimum === true,
      belowRecommended: false,
      availableBytes: numberField(preflight.target_available_bytes),
      targetPath: stringField(payload.target_basedir),
      message: stringField(preflight.message)
    }
  }
}

function nativeBackupRemoteSpaceFromPayload(value: unknown): TelenoNodeNativeBackupRemoteSpace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  return {
    ok: item.ok === true,
    availableBytes: numberField(item.available_bytes),
    targetPath: stringField(item.target_path),
    message: stringField(item.message)
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native backup command did not return a JSON object')
  }
  return value as Record<string, unknown>
}

function parseNativeBackupJsonOutput(output: string): Record<string, unknown> {
  const trimmed = output.trim()
  if (!trimmed) throw new Error('Native backup command returned empty output')

  try {
    return parseJsonRecord(JSON.parse(trimmed))
  } catch {
    // Native backup commands may emit JSON progress records before the final
    // JSON result. Fall through and select the last non-progress JSON object.
  }

  const results: Record<string, unknown>[] = []
  for (let start = 0; start < output.length; start += 1) {
    const first = output[start]
    if (first !== '{' && first !== '[') continue

    const stack: string[] = [first === '{' ? '}' : ']']
    let inString = false
    let escaped = false

    for (let index = start + 1; index < output.length; index += 1) {
      const char = output[index]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') {
        stack.push('}')
        continue
      }
      if (char === '[') {
        stack.push(']')
        continue
      }
      if (char !== '}' && char !== ']') continue

      const expected = stack.pop()
      if (char !== expected) break
      if (stack.length > 0) continue

      const fragment = output.slice(start, index + 1)
      try {
        const payload = parseJsonRecord(JSON.parse(fragment))
        if (payload.event !== 'backup-progress') results.push(payload)
      } catch {
        // Keep scanning; logs can contain braces that are not JSON payloads.
      }
      start = index
      break
    }
  }

  const result = results.at(-1)
  if (!result) throw new Error('Native backup command did not return a final JSON result')
  return result
}

function parseNativeBackupListPayload(payload: Record<string, unknown>): Pick<TelenoNodeNativeBackupListResult, 'latestBackupId' | 'remoteSpace' | 'snapshots'> {
  const snapshotPayload = payload.snapshots && typeof payload.snapshots === 'object' && !Array.isArray(payload.snapshots)
    ? payload.snapshots as Record<string, unknown>
    : payload
  const snapshots = Array.isArray(payload.snapshots)
    ? payload.snapshots.map(nativeBackupSnapshotFromPayload).filter((snapshot) => snapshot.backupId)
    : Array.isArray(snapshotPayload.snapshots)
      ? snapshotPayload.snapshots.map(nativeBackupSnapshotFromPayload).filter((snapshot) => snapshot.backupId)
      : []
  return {
    latestBackupId: stringField(snapshotPayload.latest_backup_id),
    remoteSpace: nativeBackupRemoteSpaceFromPayload(snapshotPayload.remote_space),
    snapshots
  }
}

function parseNativeBackupListOutput(output: string): Pick<TelenoNodeNativeBackupListResult, 'latestBackupId' | 'remoteSpace' | 'snapshots'> {
  return parseNativeBackupListPayload(parseNativeBackupJsonOutput(output))
}

function parseNativeBackupPreflightPayload(payload: Record<string, unknown>): Pick<
  TelenoNodeNativeBackupPreflightResult,
  | 'backupId'
  | 'readyToRestore'
  | 'snapshotComplete'
  | 'fileCount'
  | 'missingObjectCount'
  | 'missingObjectBytes'
  | 'restoreSpace'
  | 'spaceCheck'
> {
  const preflightPayload = payload.preflight && typeof payload.preflight === 'object'
    ? payload.preflight as Record<string, unknown>
    : payload
  const restoreSpace = preflightPayload.restore_space && typeof preflightPayload.restore_space === 'object'
    ? preflightPayload.restore_space as Record<string, unknown>
    : {}
  const spaceCheck = preflightPayload.space_check && typeof preflightPayload.space_check === 'object'
    ? preflightPayload.space_check as Record<string, unknown>
    : {}
  return {
    backupId: stringField(preflightPayload.backup_id),
    readyToRestore: preflightPayload.ready_to_restore === true,
    snapshotComplete: preflightPayload.snapshot_complete === true,
    fileCount: numberField(preflightPayload.file_count),
    missingObjectCount: numberField(preflightPayload.missing_object_count),
    missingObjectBytes: numberField(preflightPayload.missing_object_bytes),
    restoreSpace: {
      restoredDatabaseBytes: numberField(restoreSpace.restored_database_bytes),
      runtimeFilesBytes: numberField(restoreSpace.runtime_files_bytes),
      objectDownloadBytes: numberField(restoreSpace.object_download_bytes),
      minimumTargetFreeBytes: numberField(restoreSpace.minimum_target_free_bytes),
      recommendedTargetFreeBytes: numberField(restoreSpace.recommended_target_free_bytes)
    },
    spaceCheck: {
      passesMinimum: spaceCheck.passes_minimum === true,
      belowRecommended: spaceCheck.below_recommended === true,
      availableBytes: numberField(spaceCheck.available_bytes),
      targetPath: stringField(spaceCheck.target_path),
      message: stringField(spaceCheck.message)
    }
  }
}

function parseNativeBackupPreflightOutput(output: string): Pick<
  TelenoNodeNativeBackupPreflightResult,
  | 'backupId'
  | 'readyToRestore'
  | 'snapshotComplete'
  | 'fileCount'
  | 'missingObjectCount'
  | 'missingObjectBytes'
  | 'restoreSpace'
  | 'spaceCheck'
> {
  return parseNativeBackupPreflightPayload(parseNativeBackupJsonOutput(output))
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key]
  return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
}

function restoreBlockedMessage(payload: Record<string, unknown>, fallback: string): string {
  const directMessage = stringField(payload.download_skipped_reason)
  if (directMessage) return directMessage

  const preflight = nestedRecord(payload, 'preflight')
  const preflightMessage = stringField(preflight.message)
  if (preflightMessage) return preflightMessage

  const publicFetch = nestedRecord(payload, 'public_fetch')
  const publicFetchMessage = stringField(publicFetch.download_skipped_reason)
  if (publicFetchMessage) return publicFetchMessage

  const publicFetchPreflight = nestedRecord(publicFetch, 'preflight')
  const publicPreflightMessage = stringField(publicFetchPreflight.message)
  if (publicPreflightMessage) return publicPreflightMessage

  const remoteFetch = nestedRecord(payload, 'remote_fetch')
  const remoteFetchMessage = stringField(remoteFetch.download_skipped_reason)
  if (remoteFetchMessage) return remoteFetchMessage

  const spaceCheck = nestedRecord(preflight, 'space_check')
  const spaceMessage = stringField(spaceCheck.message)
  if (spaceMessage) return spaceMessage

  return fallback
}

function restorePartialStagingDirectoryFromOutput(output: string): string {
  const match = output.match(/restore partial staging directory already exists:\s*([^\r\n]+)/i)
  return match?.[1]?.trim() || ''
}

function restorePartialStagingSolutionMessage(partialDir: string): string {
  const location = partialDir ? ` (${partialDir})` : ''
  return [
    `A previous restore left partial staging data${location}.`,
    'The existing node database was not replaced.',
    'If no restore is currently running, click Restore Backup again; Koinos One will clear only the stale partial restore staging directory and restart the restore safely.',
    'If another restore is still running, use Stop restore first or wait for it to finish.'
  ].join(' ')
}

export function restoreBlockedMessageFromOutput(output: string, fallback: string): string {
  const partialStagingDir = restorePartialStagingDirectoryFromOutput(output)
  if (partialStagingDir) return restorePartialStagingSolutionMessage(partialStagingDir)

  try {
    return restoreBlockedMessage(parseNativeBackupJsonOutput(output), fallback)
  } catch {
    return fallback
  }
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
    const dirName = match[1].replace(/\/+$/, '')
    if (match[1] !== `${dirName}/`) throw new Error(`Invalid blockchain restore directory: ${JSON.stringify(match[1])}`)
    assertBlockchainRestoreDirectory(dirName)
    directories.push(dirName)
  }

  return uniqueStringList(directories)
}

function isBlockchainRestoreDirectory(dirName: string): boolean {
  return (BLOCKCHAIN_BACKUP_REQUIRED_DIRS as readonly string[]).includes(dirName)
}

function assertBlockchainRestoreDirectory(dirName: string): void {
  if (!isBlockchainRestoreDirectory(dirName)) {
    throw new Error(`Unsupported blockchain restore directory: ${JSON.stringify(dirName)}`)
  }
}

function validatedBlockchainRestoreDirectories(directories: string[]): string[] {
  const unique = uniqueStringList(directories)
  for (const dirName of unique) assertBlockchainRestoreDirectory(dirName)
  if (!unique.length) throw new Error('No supported blockchain restore directories')
  return unique
}

// Resolve every path component before a cleanup or copy. A symlink in a cached
// extraction or the selected data directory must never redirect a restore.
function checkedRestoreChild(baseDir: string, dirName: string): string {
  const base = path.resolve(baseDir)
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error(`Restore directory is a symlink: ${base}`)
  const realBase = fs.realpathSync(base)
  const child = path.join(base, dirName)
  if (path.relative(base, child) !== dirName) {
    throw new Error(`Restore path leaves its base: ${child}`)
  }
  try {
    const stat = fs.lstatSync(child)
    if (stat.isSymbolicLink()) throw new Error(`Restore path is a symlink: ${child}`)
    if (fs.realpathSync(child) !== path.join(realBase, dirName)) throw new Error(`Restore path leaves its base: ${child}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return child
}

function assertRestoreTreeHasNoSymlinks(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Backup payload contains a symlink: ${entryPath}`)
    if (entry.isDirectory()) assertRestoreTreeHasNoSymlinks(entryPath)
  }
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
    const response = await fetch(checksumUrl, { redirect: 'error' })
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

async function fetchBlockchainBackupMetadata(archiveUrl: string): Promise<Buffer> {
  const metadataUrl = blockchainBackupMetadataUrl(archiveUrl)
  const response = await fetch(metadataUrl, { redirect: 'error' })
  if (!response.ok) {
    throw new Error(`Legacy backup metadata unavailable (HTTP ${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function loadLegacyBlockchainBackupPublicKey(): KeyObject {
  const publicKeyFile = process.env.TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE
  if (!publicKeyFile) throw new Error('Set TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE to a trusted legacy backup public key')

  let publicKey: KeyObject
  try {
    publicKey = createPublicKey(fs.readFileSync(publicKeyFile))
  } catch {
    throw new Error('Could not read the configured legacy backup public key')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('The legacy backup public key must be Ed25519')
  return publicKey
}

function canonicalBackupSignatureJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBackupSignatureJson).join(',')}]`
  if (value && typeof value === 'object') {
    const fields = Object.keys(value).sort().map((key) => {
      const item = (value as Record<string, unknown>)[key]
      return `${JSON.stringify(key)}:${canonicalBackupSignatureJson(item)}`
    })
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

async function verifyLegacyBlockchainBackupManifest(
  archiveUrl: string,
  metadata: Buffer,
  checksum: string,
  publicKey: KeyObject
): Promise<void> {
  const response = await fetch(`${archiveUrl}.manifest.json`, { redirect: 'error' })
  if (!response.ok) throw new Error(`Legacy backup manifest unavailable (HTTP ${response.status})`)

  const envelope = await response.json() as Record<string, unknown> | null
  const payload = envelope?.payload as Record<string, unknown> | undefined
  const signature = envelope?.signature_hex
  if (envelope?.format !== 'teleno-legacy-backup-signature' || envelope.version !== 1 || envelope.algorithm !== 'ed25519' ||
      !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) {
    throw new Error('Invalid legacy backup signature envelope')
  }
  if (!verify(null, Buffer.from(canonicalBackupSignatureJson(payload)), publicKey, Buffer.from(signature, 'hex'))) {
    throw new Error('Legacy backup signature does not match the trusted key')
  }
  if (payload.archive_url !== archiveUrl || payload.archive_sha256 !== checksum ||
      payload.metadata_sha256 !== createHash('sha256').update(metadata).digest('hex')) {
    throw new Error('Legacy backup signed manifest does not match the archive or metadata')
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

function scanBlockchainBackupArchive(
  archivePath: string,
  onEntry: (entry: string) => boolean | void
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // On Windows, use the built-in bsdtar (System32\tar.exe) which handles
    // Windows paths natively, avoiding MSYS/Git Bash path mangling issues
    const tarCmd = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
    const child = spawn(tarCmd, ['-tzf', archivePath], {
      cwd: process.cwd(),
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
    if (isBlockchainRestoreDirectory(dirName) && !seen.has(dirName)) {
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
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<{ ok: boolean; output: string }> {
  try {
    const response = await fetch(url, { redirect: 'error' })
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
    onProgress?.(downloadedBytes, totalBytes)

    const source = Readable.fromWeb(response.body as never)
    const progressTap = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length
        onProgress?.(downloadedBytes, totalBytes)
        callback(null, chunk)
      }
    })

    await pipeline(source, progressTap, fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }))
    onProgress?.(downloadedBytes, totalBytes)
    return {
      ok: true,
      output:
        totalBytes !== null
          ? `Downloaded ${formatByteCount(downloadedBytes)} of ${formatByteCount(totalBytes)}`
          : `Downloaded ${formatByteCount(downloadedBytes)}`
    }
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'No se pudo descargar el backup blockchain'
    }
  }
}

async function prepareLegacyRestoreArchive(
  archiveUrl: string,
  cachePath: string,
  archivePath: string,
  expectedSha256: string,
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<{ ok: boolean; output: string; downloaded: boolean }> {
  let cacheNote = ''
  try {
    // Verification and TAR both use this attempt's copy.
    await fs.promises.copyFile(cachePath, archivePath, EXCLUSIVE_ARCHIVE_COPY)
    const verification = await verifyBlockchainBackupArchiveFile(archivePath, expectedSha256)
    if (verification.ok) return { ok: true, downloaded: false, output: `Using cached archive. ${verification.output}` }
    cacheNote = `Cached backup archive did not verify. ${verification.output}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cacheNote = 'Could not copy the cached backup archive.'
  }
  fs.rmSync(archivePath, { force: true })

  const download = await downloadBlockchainBackupArchive(archiveUrl, archivePath, onProgress)
  if (!download.ok) return { ok: false, downloaded: false, output: [cacheNote, download.output].filter(Boolean).join('\n') }
  const verification = await verifyBlockchainBackupArchiveFile(archivePath, expectedSha256)
  return {
    ok: verification.ok,
    downloaded: verification.ok,
    output: [cacheNote, download.output, verification.output].filter(Boolean).join('\n')
  }
}

function blockchainBackupPayloadRootPath(extractDir: string, payloadRootRelativePath: string): string {
  let current = path.resolve(extractDir)
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Restore directory is a symlink: ${current}`)
  if (!payloadRootRelativePath) return current
  for (const segment of payloadRootRelativePath.split('/')) {
    if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..') {
      throw new Error(`Invalid archive payload root: ${JSON.stringify(payloadRootRelativePath)}`)
    }
    const next = path.join(current, segment)
    try {
      if (fs.lstatSync(next).isSymbolicLink()) throw new Error(`Restore directory is a symlink: ${next}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    current = next
  }
  return current
}

export async function extractBlockchainBackupDirectories(
  archivePath: string,
  extractDir: string,
  payloadRootRelativePath: string,
  restoreDirectories: string[],
  runCommand: BackupServiceDeps['runCommand'],
  onProgress?: (dirName: string, index: number, total: number) => void,
  /** Called periodically during extraction with (extractedBytes) for incremental progress */
  onExtractPoll?: (extractedBytes: number) => void
): Promise<{ ok: boolean; output: string }> {
  const directories = validatedBlockchainRestoreDirectories(restoreDirectories)
  fs.mkdirSync(extractDir)
  const payloadRoot = blockchainBackupPayloadRootPath(extractDir, payloadRootRelativePath)
  fs.mkdirSync(payloadRoot, { recursive: true })

  for (let index = 0; index < directories.length; index += 1) {
    const dirName = directories[index]
    onProgress?.(dirName, index, directories.length)

    const archiveMemberPath = payloadRootRelativePath ? path.posix.join(payloadRootRelativePath, dirName) : dirName
    const targetPath = checkedRestoreChild(payloadRoot, dirName)

    // Poll extracted directory size for incremental progress
    let pollTimer: NodeJS.Timeout | null = null
    if (onExtractPoll) {
      pollTimer = setInterval(() => {
        try {
          // Quick size estimate: count bytes via statSync on the target dir
          let totalBytes = 0
          const countDir = (dir: string, depth: number) => {
            if (depth > 3) return // limit depth to avoid slow traversal
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true })
              for (const entry of entries) {
                const entryPath = path.join(dir, entry.name)
                if (entry.isFile()) {
                  try { totalBytes += fs.statSync(entryPath).size } catch { /* ignore */ }
                } else if (entry.isDirectory()) {
                  countDir(entryPath, depth + 1)
                }
              }
            } catch { /* ignore */ }
          }
          if (fs.existsSync(targetPath)) countDir(targetPath, 0)
          onExtractPoll(totalBytes)
        } catch { /* ignore */ }
      }, 3000)
    }

    // On Windows, use the built-in bsdtar (System32\tar.exe) which handles
    // Windows paths natively, avoiding MSYS/Git Bash path mangling issues
    const tarExtractCmd = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
    let extractResult: Awaited<ReturnType<BackupServiceDeps['runCommand']>>
    try {
      extractResult = await runCommand(tarExtractCmd, ['-xzf', archivePath, '-C', extractDir, '--', archiveMemberPath], {
        cwd: process.cwd()
      })
    } finally {
      if (pollTimer) clearInterval(pollTimer)
    }

    if (!extractResult.ok) {
      return {
        ok: false,
        output: [`No se pudo extraer ${dirName} desde ${archiveMemberPath}`, extractResult.output].filter(Boolean).join('\n')
      }
    }

  }
  return { ok: true, output: `Extracted backup directories: ${directories.join(', ')}` }
}

export function restoreBlockchainBackupPayload(
  payloadRoot: string,
  restoreDirectories: string[],
  settings: TelenoNodeSettings
): string[] {
  const validated = validatedBlockchainRestoreDirectories(restoreDirectories)
  fs.mkdirSync(settings.baseDir, { recursive: true })

  // Validate the entire plan before moving any installed data.
  const sources = validated.map((dirName) => {
    const sourcePath = checkedRestoreChild(payloadRoot, dirName)
    if (!fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isDirectory()) {
      throw new Error(`El directorio ${dirName} no existe en el backup extraido (${sourcePath})`)
    }
    assertRestoreTreeHasNoSymlinks(sourcePath)
    return { dirName, sourcePath, targetPath: checkedRestoreChild(settings.baseDir, dirName) }
  })
  const resetPaths = BLOCKCHAIN_BACKUP_RESET_DIRS.map((dirName) => checkedRestoreChild(settings.baseDir, dirName))

  const install = fs.mkdtempSync(path.join(settings.baseDir, '.teleno-legacy-install-'))
  const undo: Array<() => void> = []
  let preserveRecovery = false
  try {
    for (const { dirName, sourcePath } of sources) {
      const incoming = path.join(install, `incoming-${dirName}`)
      try {
        fs.renameSync(sourcePath, incoming)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        fs.cpSync(sourcePath, incoming, { recursive: true, force: false, errorOnExist: true })
      }
    }
    for (const target of [...sources.map(({ targetPath }) => targetPath), ...resetPaths]) {
      if (!fs.existsSync(target)) continue
      const previous = path.join(install, `previous-${path.basename(target)}`)
      fs.renameSync(target, previous)
      undo.push(() => fs.renameSync(previous, target))
    }
    for (const { dirName, targetPath } of sources) {
      const incoming = path.join(install, `incoming-${dirName}`)
      fs.renameSync(incoming, targetPath)
      undo.push(() => fs.renameSync(targetPath, incoming))
    }
  } catch (error) {
    for (const rollback of undo.reverse()) {
      try {
        rollback()
      } catch {
        preserveRecovery = true
      }
    }
    if (preserveRecovery) {
      throw new LegacyRestoreRecoveryError(`Legacy restore could not roll back completely. Recover the data retained in ${install}.`)
    }
    throw error
  } finally {
    if (!preserveRecovery) removeRestoreAttempt(install)
  }

  const restored = sources.map(({ dirName }) => dirName)
  // Write marker file so chain knows to run verify-blocks on first startup after restore
  if (restored.includes('chain') || restored.includes('block_store')) {
    try {
      fs.writeFileSync(
        path.join(settings.baseDir, '.backup-just-restored'),
        JSON.stringify({ restoredAt: new Date().toISOString(), directories: restored }),
        'utf-8'
      )
    } catch {
      // Non-critical — worst case user needs to manually set verify-blocks once
    }
  }

  return restored
}

function sendBackupProgressEvent(sender: WebContents | null | undefined, payload: TelenoNodeBackupProgressEvent): void {
  if (!sender || sender.isDestroyed()) return
  sender.send('teleno:node:backup-progress:event', payload)
}

function normalizeBackupProgressValue(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.round(Math.max(0, Math.min(100, progress)) * 10) / 10
}

function createBackupProgressReporter(
  sender: WebContents | null | undefined,
  action: TelenoNodeBackupProgressAction
): (phase: TelenoNodeBackupProgressPhase, progress: number, message: string, telemetry?: BackupProgressTelemetry) => void {
  return (phase, progress, message, telemetry = {}) => {
    sendBackupProgressEvent(sender, {
      action,
      phase,
      progress: normalizeBackupProgressValue(progress),
      message,
      ...telemetry
    })
  }
}

function localNodeJsonRpcUrl(
  settings: TelenoNodeSettings,
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

function directorySizeBytes(dirPath: string): number {
  let total = 0
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    try {
      if (entry.isDirectory()) {
        total += directorySizeBytes(entryPath)
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        total += fs.lstatSync(entryPath).size
      }
    } catch {
      // Staging is being written concurrently; disappearing files are expected.
    }
  }
  return total
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
    settings: TelenoNodeSettings,
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

  async function telenoNodeRestoreBackup(
    input?: TelenoNodeSettingsInput,
    sender?: WebContents,
    progressAction: TelenoNodeBackupProgressAction = 'restore-backup',
    completeOnSuccess = true,
    onRestored?: (settings: TelenoNodeSettings, output: string) => Promise<TelenoNodeBackupRestoreResult>
  ): Promise<TelenoNodeBackupRestoreResult> {
    const settings = deps.normalizeNodeSettings(input)
    const notes: string[] = []
    const reportProgress = createBackupProgressReporter(sender, progressAction)

    try {
      deps.assertRepoReady(settings)
      const backupUrl = normalizeBlockchainBackupArchiveUrl(legacyBackupUrlForNetwork(settings.blockchainBackupUrl, settings.network))
      const publicKey = loadLegacyBlockchainBackupPublicKey()
      reportProgress('checksum', 1, 'Authenticating legacy backup metadata')
      const [checksumResult, metadata] = await Promise.all([
        fetchBlockchainBackupChecksum(backupUrl),
        fetchBlockchainBackupMetadata(backupUrl)
      ])
      if (!checksumResult.ok || !checksumResult.checksum) throw new Error(checksumResult.output)
      const checksum = checksumResult.checksum
      const metadataText = metadata.toString('utf8')
      if (!metadataText.trim()) throw new Error('Signed legacy backup metadata is required')
      await verifyLegacyBlockchainBackupManifest(backupUrl, metadata, checksum, publicKey)
      let restoreDirectories = parseBlockchainBackupMetadataDirectories(metadataText)
      notes.push('Legacy backup signature verified against the configured public key', checksumResult.output)

      return await withLegacyRestoreDestination(settings, async (lockedSettings) => {
        const validation = deps.validateNodeBaseDirAccess(lockedSettings)
        if (!validation.ok) throw new Error(validation.output)

        const attempt = createRestoreAttempt(validation.restoreWorkspaceParent)
        try {
          const archivePath = path.join(attempt, 'backup.tar.gz')
          const extractDir = path.join(attempt, 'extract')
          const cachePath = blockchainBackupCachePath(path.dirname(attempt), backupUrl, checksum)
          reportProgress('download', 20, 'Preparing a private copy of the backup archive')
          const archiveResult = await prepareLegacyRestoreArchive(
            backupUrl,
            cachePath,
            archivePath,
            checksum,
            (downloadedBytes, totalBytes) => {
              const phaseProgress = totalBytes ? Math.min(1, downloadedBytes / totalBytes) : null
              reportProgress(
                'download',
                phaseProgress === null ? 35 : 20 + phaseProgress * 40,
                `Downloading backup archive (${formatByteCount(downloadedBytes)})`,
                { completedBytes: downloadedBytes, totalBytes, phaseProgress, progressRangeStart: 20, progressRangeEnd: 60 }
              )
            }
          )
          if (!archiveResult.ok) throw new Error(archiveResult.output)
          notes.push(archiveResult.output)
          reportProgress('checksum', 64, 'SHA-256 verified for the staged archive')

          const root = await discoverBlockchainBackupPayloadRootInArchive(archivePath)
          if (!root.ok || root.payloadRootRelativePath === undefined) throw new Error(root.output || 'Unable to locate backup data')
          const relativeRoot = root.payloadRootRelativePath
          notes.push(root.output)
          if (!restoreDirectories.length) {
            const contents = await listBlockchainBackupPayloadDirectoriesFromArchive(archivePath, relativeRoot)
            if (!contents.ok || !contents.directories?.length) throw new Error(contents.output || 'Unable to list backup directories')
            restoreDirectories = contents.directories
            notes.push(contents.output)
          }

          const extraction = await extractBlockchainBackupDirectories(
            archivePath, extractDir, relativeRoot, restoreDirectories, deps.runCommand,
            (dirName, index, total) => reportProgress('extract', 65 + Math.round((index + 1) / total * 12), `Extracting ${dirName}`)
          )
          if (!extraction.ok) throw new Error(extraction.output)
          notes.push(extraction.output)

          reportProgress('stop', 79, 'Stopping node before installing backup data')
          const stop = await deps.telenoNodeAction('stop', lockedSettings)
          if (!stop.ok) throw new Error(stop.output || 'Unable to stop the node before restore')
          const config = deps.ensureKoinosConfigFiles(lockedSettings)
          notes.push(stop.output, config.output)

          reportProgress('restore', 80, `Restoring blockchain state into ${lockedSettings.baseDir}`)
          const restored = restoreBlockchainBackupPayload(
            blockchainBackupPayloadRootPath(extractDir, relativeRoot), restoreDirectories, lockedSettings
          )
          notes.push(`Restored blockchain state: ${restored.join(', ')}`)
          if (archiveResult.downloaded) {
            try {
              // TAR is finished. Publish the verified file in one atomic replacement.
              await fs.promises.rename(archivePath, cachePath)
            } catch {
              notes.push('The restore succeeded. The verified download could not be cached.')
            }
          }

          reportProgress('restore', 90, 'Preparing BASEDIR runtime files')
          notes.push(deps.ensureBaseDirKoinosRuntimeFiles(lockedSettings))
          notes.push(setConfigVerifyBlocks(lockedSettings.baseDir, true).output)
          const output = notes.filter(Boolean).join('\n')
          if (onRestored) return await onRestored(lockedSettings, output)

          if (completeOnSuccess) reportProgress('complete', 100, 'Backup restored with verify-blocks enabled')
          return { ok: true, action: progressAction, output, status: await deps.telenoNodeStatus(lockedSettings) }
        } finally {
          removeRestoreAttempt(attempt)
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo restaurar el backup blockchain'
      reportProgress('error', 0, message)
      return {
        ok: false,
        action: progressAction,
        output: [...notes, message].filter(Boolean).join('\n'),
        status: await deps.telenoNodeStatus(settings)
      }
    }
  }

  async function telenoNodeRestoreBackupAndVerify(
    input?: TelenoNodeSettingsInput,
    sender?: WebContents
  ): Promise<TelenoNodeBackupRestoreResult> {
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
          status: await deps.telenoNodeStatus(settings)
        }
      }

      reportProgress('prepare', 0, `Preparing restore + verify for ${settings.baseDir}`)
      return await telenoNodeRestoreBackup(settings, sender, 'restore-backup-verify', false, async (lockedSettings, output) => {
        notes.push(output)
        reportProgress('start', 93, 'Starting node after backup restore')
        const start = await deps.telenoNodeAction('start', lockedSettings)
        notes.push(start.output)
        if (!start.ok) {
          reportProgress('error', 93, start.output || 'No se pudo arrancar el nodo tras restaurar el backup')
          return { ok: false, action: 'restore-backup-verify', output: notes.filter(Boolean).join('\n'), status: start.status }
        }

        reportProgress('verify', 96, 'Verifying local JSON-RPC response from chain.get_head_info')
        const verification = await waitForLocalNodeJsonRpcVerification(lockedSettings, serviceDefinitions)
        notes.push(verification.output)
        const status = await deps.telenoNodeStatus(lockedSettings)
        reportProgress(
          verification.ok ? 'complete' : 'error',
          verification.ok ? 100 : 96,
          verification.ok ? 'Backup restored and local node verified' : verification.output
        )
        return { ok: verification.ok, action: 'restore-backup-verify', output: notes.filter(Boolean).join('\n'), status }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo verificar el restore del backup'
      reportProgress('error', 0, message)
      return {
        ok: false,
        action: 'restore-backup-verify',
        output: [...notes, message].filter(Boolean).join('\n'),
        status: await deps.telenoNodeStatus(settings)
      }
    }
  }

  async function copyNodeBaseDirData(input?: TelenoNodeBaseDirCopyInput): Promise<TelenoNodeBaseDirCopyResult> {
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
        status: await deps.telenoNodeStatus(settings)
      }
    }

    if (path.resolve(sourceBaseDir) === path.resolve(targetBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: 'El origen y destino del BASEDIR son el mismo',
        status: await deps.telenoNodeStatus(settings)
      }
    }

    if (!fs.existsSync(sourceBaseDir) || !fs.statSync(sourceBaseDir).isDirectory()) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `No existe el BASEDIR origen: ${sourceBaseDir}`,
        status: await deps.telenoNodeStatus(settings)
      }
    }

    if (!directoryHasEntries(sourceBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `El BASEDIR origen esta vacio: ${sourceBaseDir}`,
        status: await deps.telenoNodeStatus(settings)
      }
    }

    if (directoryHasEntries(targetBaseDir)) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: `El BASEDIR destino ya contiene datos: ${targetBaseDir}. Usa Restore Backup o vacia la carpeta antes de copiar.`,
        status: await deps.telenoNodeStatus(settings)
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
        status: await deps.telenoNodeStatus(settings)
      }
    } catch (error) {
      return {
        ok: false,
        sourceBaseDir,
        targetBaseDir,
        output: [...outputs, error instanceof Error ? error.message : 'No se pudo copiar el BASEDIR']
          .filter(Boolean)
          .join('\n'),
        status: await deps.telenoNodeStatus(settings)
      }
    }
  }

  async function selectNodeBaseDir(input?: TelenoNodeSettingsInput): Promise<TelenoNodeSelectDirectoryResult> {
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
          localCopy: validation.localCopy,
          output: validation.output
        }
      }

      return {
        ok: true,
        canceled: false,
        path: selectedPath,
        restoreWorkspaceParent: validation.restoreWorkspaceParent,
        writable: true,
        localCopy: validation.localCopy,
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

  async function restoreFromLocalFile(
    input: TelenoNodeSettingsInput | undefined,
    sender: WebContents
  ): Promise<TelenoNodeBackupRestoreResult> {
    const action: TelenoNodeBackupProgressAction = 'restore-backup'
    const reportProgress = createBackupProgressReporter(sender, action)
    const notes: string[] = []

    try {
      const settings = deps.normalizeNodeSettings(input)
      reportProgress('prepare', 2, 'Selecciona el archivo de backup local...')
      const lastBackupDir = readLastBackupPath()
      const dialogOptions: OpenDialogOptions = {
        title: 'Seleccionar backup local (.tar.gz)',
        filters: [{ name: 'tar.gz', extensions: ['tar.gz', 'tgz'] }],
        properties: ['openFile'],
        ...(lastBackupDir ? { defaultPath: lastBackupDir } : {})
      }
      const selected = await dialog.showOpenDialog(dialogOptions)
      if (selected.canceled || !selected.filePaths.length) {
        return { ok: false, action, output: 'Restauracion cancelada por el usuario', status: 'cancelled' }
      }
      const sourceArchive = selected.filePaths[0]
      const source = fs.statSync(sourceArchive)
      if (!source.isFile() || source.size === 0) throw new Error('Selecciona un archivo de backup local no vacío.')
      notes.push(`Restoring from local file: ${sourceArchive}`)

      return await withLegacyRestoreDestination(settings, async (lockedSettings) => {
        const validation = deps.validateNodeBaseDirAccess(lockedSettings)
        if (!validation.ok) throw new Error(validation.output)
        const attempt = createRestoreAttempt(validation.restoreWorkspaceParent)
        let stopped = false

        try {
          const archivePath = path.join(attempt, 'backup.tar.gz')
          const extractDir = path.join(attempt, 'extract')
          await fs.promises.copyFile(sourceArchive, archivePath, EXCLUSIVE_ARCHIVE_COPY)
          const archiveSize = fs.statSync(archivePath).size
          if (!archiveSize) throw new Error('El archivo de backup esta vacio')

          reportProgress('extract', 20, 'Inspeccionando contenido del archivo...')
          const root = await discoverBlockchainBackupPayloadRootInArchive(archivePath)
          if (!root.ok || root.payloadRootRelativePath === undefined) throw new Error(root.output || 'No se pudo localizar el payload del backup')
          const relativeRoot = root.payloadRootRelativePath
          notes.push(root.output)
          const directories = [...BLOCKCHAIN_BACKUP_REQUIRED_DIRS]
          const extraction = await extractBlockchainBackupDirectories(
            archivePath, extractDir, relativeRoot, directories, deps.runCommand,
            (dirName, index, total) => reportProgress('extract', 30 + Math.round((index + 1) / total * 40), `Extrayendo ${dirName}`),
            (extractedBytes) => {
              const progress = Math.min(1, extractedBytes / (archiveSize * 2))
              reportProgress('extract', 30 + Math.round(progress * 39), `Extrayendo backup (${formatByteCount(extractedBytes)})`)
            }
          )
          if (!extraction.ok) throw new Error(extraction.output)
          notes.push(extraction.output)

          reportProgress('stop', 74, 'Parando servicios antes de instalar el backup...')
          const stop = await deps.telenoNodeAction('stop', lockedSettings)
          if (!stop.ok) {
            reportProgress('error', 74, stop.output || 'No se pudieron parar los servicios')
            return { ok: false, action, output: [...notes, stop.output].filter(Boolean).join('\n'), status: stop.status }
          }
          stopped = true
          notes.push(stop.output, deps.ensureKoinosConfigFiles(lockedSettings).output)

          reportProgress('restore', 75, 'Restaurando blockchain state en BASEDIR...')
          const restored = restoreBlockchainBackupPayload(
            blockchainBackupPayloadRootPath(extractDir, relativeRoot), directories, lockedSettings
          )
          notes.push(`Restored: ${restored.join(', ')}`)
          reportProgress('restore', 88, 'Preparando archivos de runtime...')
          notes.push(deps.ensureBaseDirKoinosRuntimeFiles(lockedSettings))
          notes.push(setConfigVerifyBlocks(lockedSettings.baseDir, true).output)

          reportProgress('start', 92, 'Reiniciando servicios...')
          stopped = false
          const start = await deps.telenoNodeAction('start', lockedSettings)
          notes.push(start.output)
          if (!start.ok) {
            reportProgress('error', 92, start.output || 'No se pudo arrancar el nodo tras restaurar el backup')
            return { ok: false, action, output: notes.filter(Boolean).join('\n'), status: start.status }
          }
          reportProgress('complete', 100, `Backup restaurado desde ${path.basename(sourceArchive)}. verify-blocks activado.`)
          return { ok: true, action, output: notes.filter(Boolean).join('\n'), status: await deps.telenoNodeStatus(lockedSettings) }
        } catch (error) {
          try {
            if (stopped && !(error instanceof LegacyRestoreRecoveryError)) {
              await deps.telenoNodeAction('start', lockedSettings)
            }
          } catch { /* best effort after a successful stop */ }
          throw error
        } finally {
          removeRestoreAttempt(attempt)
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error restaurando backup local'
      reportProgress('error', 0, message)
      return { ok: false, action, output: [...notes, message].filter(Boolean).join('\n'), status: 'error' }
    }
  }

  // ── Cancel support for createLocalBackup ──
  let activeBackupProcess: ChildProcess | null = null
  let activeBackupAdminOperation: { baseUrl: string; token: string; operationId: string } | null = null
  let activeBackupCancelled = false

  function isBackupOperationActive(): boolean {
    return Boolean(activeBackupProcess || activeBackupAdminOperation)
  }

  function backupAdminConnection(settings: TelenoNodeSettings): { baseUrl: string; token: string } | null {
    if (!settings.backup.adminEnabled) return null
    const listen = settings.backup.adminListen.trim() || '127.0.0.1:18088'
    const splitAt = listen.lastIndexOf(':')
    if (splitAt <= 0 || splitAt === listen.length - 1) {
      throw new Error(`Invalid backup admin listen address: ${listen}`)
    }
    const host = listen.slice(0, splitAt)
    const port = Number.parseInt(listen.slice(splitAt + 1), 10)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid backup admin port: ${listen}`)
    }
    const tokenPath = expandBackupFilePath(settings.backup.adminTokenFile) || nativeBackupAdminTokenPath(settings.baseDir)
    const token = fs.readFileSync(tokenPath, 'utf8').trim()
    if (!token) throw new Error(`Backup admin token file is empty: ${tokenPath}`)
    return { baseUrl: `http://${host}:${port}`, token }
  }

  async function backupAdminRequest(
    baseUrl: string,
    token: string,
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    timeoutMs = 15_000
  ): Promise<Record<string, unknown>> {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const errorCause = error instanceof Error ? (error as { cause?: unknown }).cause : null
      const cause =
        errorCause instanceof Error && errorCause.message
          ? ` (${errorCause.message})`
          : ''
      const timeoutNote =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
          ? ' The request timed out.'
          : ''
      throw new Error(
        [
          `Backup admin API is not reachable at ${baseUrl}${route}.`,
          'If the node is running, save Backup Admin settings and restart the node so the admin listener is active.',
          'If you do not want to restart, stop the node before creating an offline native backup.',
          `${timeoutNote} Underlying error: ${detail}${cause}`.trim()
        ].join(' ')
      )
    }
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {}
    } catch {
      throw new Error(`Backup admin returned non-JSON response: ${text}`)
    }
    if (!response.ok || payload.ok === false) {
      const error = typeof payload.error === 'string' ? payload.error : response.statusText
      if (response.status === 401 || /unauthorized|forbidden/i.test(error)) {
        throw new Error(
          [
            "The running node rejected Koinos One's local Backup Admin token.",
            'This usually means the node was started with an older backup-admin configuration.',
            'Stop and start the node from Koinos One so it loads the current local token, then try again.',
            'If this folder already has newer local node data, keep the local copy instead of restoring the public backup.'
          ].join(' ')
        )
      }
      throw new Error(`Backup admin ${method} ${route} failed: ${error}`)
    }
    return payload
  }

  function backupStatusPayload(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (record.status && typeof record.status === 'object') return record.status as Record<string, unknown>
      return record
    }
    return {}
  }

  function backupAdminHeaderTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Headers Timeout Error|UND_ERR_HEADERS_TIMEOUT|header[^.]*timeout/i.test(message)
  }

  function nativeRestoreStagePayloadFromDisk(stagingDir: string): Record<string, unknown> {
    const metadataPath = path.join(stagingDir, '.teleno-restore-stage.json')
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
    const skipped = Array.isArray(metadata.skipped_optional_runtime_files)
      ? metadata.skipped_optional_runtime_files.map((item) => stringField(item)).filter(Boolean)
      : []
    return {
      ok: true,
      stage: {
        backup_id: stringField(metadata.backup_id),
        repository_dir: stringField(metadata.repository_dir),
        target_basedir: stringField(metadata.target_basedir),
        staging_dir: stringField(metadata.staging_dir) || stagingDir,
        metadata: metadataPath,
        restored_file_count: numberField(metadata.restored_file_count),
        restored_bytes: numberField(metadata.restored_bytes),
        start_as_observer_first: metadata.start_as_observer_first !== false,
        skipped_optional_runtime_files: skipped
      }
    }
  }

  async function waitForNativeRestoreStageCompletion(
    stagingDir: string,
    timeoutMs: number,
    emitProgress: (phase: TelenoNodeBackupProgressPhase, progress: number, message: string) => void
  ): Promise<Record<string, unknown>> {
    const partialDir = `${stagingDir}.partial`
    const completeMarker = path.join(stagingDir, 'RESTORE_STAGE_COMPLETE')
    const metadataPath = path.join(stagingDir, '.teleno-restore-stage.json')
    const startedAt = Date.now()
    let nextProgressAt = 0

    while (Date.now() - startedAt < timeoutMs) {
      if (fs.existsSync(completeMarker) && fs.existsSync(metadataPath)) {
        return nativeRestoreStagePayloadFromDisk(stagingDir)
      }

      const activeStageDir = fs.existsSync(partialDir)
        ? partialDir
        : fs.existsSync(stagingDir)
          ? stagingDir
          : ''
      if (!activeStageDir) {
        throw new Error(`Native restore staging stopped before completion: ${stagingDir}`)
      }

      const now = Date.now()
      if (
        activeStageDir === stagingDir &&
        !fs.existsSync(partialDir) &&
        !fs.existsSync(completeMarker) &&
        now - startedAt > 10_000 &&
        directorySizeBytes(stagingDir) === 0
      ) {
        throw new Error(`Native restore staging did not leave an active partial directory: ${partialDir}`)
      }

      if (now >= nextProgressAt) {
        const copiedBytes = directorySizeBytes(activeStageDir)
        emitProgress(
          'restore',
          80,
          `Staging native backup restore (${formatByteCount(copiedBytes)} copied so far)`
        )
        nextProgressAt = now + 5000
      }

      await delay(2000)
    }

    throw new Error(`Timed out waiting for native restore staging to complete: ${stagingDir}`)
  }

  function clearStaleRestorePartialStaging(
    stagingDir: string,
    emitProgress: (phase: TelenoNodeBackupProgressPhase, progress: number, message: string) => void
  ): void {
    const partialDir = `${stagingDir}.partial`
    if (!fs.existsSync(partialDir)) return
    if (activeBackupProcess) {
      throw new Error(
        'A native restore is still running. Use Stop restore first, then retry after the restore process has stopped.'
      )
    }

    emitProgress(
      'prepare',
      6,
      'Clearing stale partial restore staging left by a previous interrupted restore'
    )
    fs.rmSync(partialDir, { recursive: true, force: true })
  }

  function nodeStatusLooksRunning(status: unknown): boolean {
    if (!status || typeof status !== 'object') return false
    const services = (status as { services?: unknown }).services
    if (!Array.isArray(services)) return false
    return services.some((service) => {
      if (!service || typeof service !== 'object') return false
      const value = service as { state?: unknown; status?: unknown; managedByTeleno?: unknown }
      const state = `${value.state ?? ''}`.toLowerCase()
      const serviceStatus = `${value.status ?? ''}`.toLowerCase()
      return value.managedByTeleno === true && (state === 'running' || serviceStatus.includes('running') || serviceStatus.includes('up'))
    })
  }

  async function runningBackupAdminConnection(
    settings: TelenoNodeSettings,
    input: TelenoNodeSettingsInput | undefined
  ): Promise<{ baseUrl: string; token: string } | null> {
    if (!settings.backup.adminEnabled) return null
    if (typeof deps.telenoNodeStatus !== 'function') return null
    const status = await deps.telenoNodeStatus(input).catch(() => null)
    if (!nodeStatusLooksRunning(status)) return null
    return backupAdminConnection(settings)
  }

  async function cancelCreateBackup(): Promise<{ ok: boolean; output: string }> {
    if (activeBackupAdminOperation) {
      const operation = activeBackupAdminOperation
      activeBackupCancelled = true
      try {
        await backupAdminRequest(operation.baseUrl, operation.token, 'POST', `/admin/backup/cancel/${encodeURIComponent(operation.operationId)}`)
        return { ok: true, output: 'Backup operation cancel signal sent through the admin API' }
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!activeBackupProcess && !activeBackupCancelled) {
      activeBackupCancelled = true
      return { ok: true, output: 'Cancel requested. The current backup operation will stop at the next safe checkpoint.' }
    }
    activeBackupCancelled = true
    if (activeBackupProcess) {
      try { activeBackupProcess.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        try { activeBackupProcess?.kill('SIGKILL') } catch { /* ignore */ }
      }, 2000)
    }
    return { ok: true, output: 'Cancel signal sent to the native backup operation' }
  }

  function spawnTrackedBackupCommand(
    command: string,
    args: string[],
    cwd: string,
    onProgress?: (progress: NativeBackupProgressPayload) => void
  ): Promise<TrackedBackupCommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      activeBackupProcess = child

      let stdout = ''
      let stderr = ''
      let stderrLineBuffer = ''
      child.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        stderr += text
        stderrLineBuffer += text
        const lines = stderrLineBuffer.split(/\r?\n/)
        stderrLineBuffer = lines.pop() || ''
        for (const line of lines) {
          const progress = parseNativeBackupProgressLine(line)
          if (progress) onProgress?.(progress)
        }
      })

      const cleanup = () => {
        activeBackupProcess = null
      }

      child.on('error', (err) => {
        cleanup()
        resolve({ ok: false, code: null, output: err.message, stdout, stderr })
      })
      child.on('close', (code) => {
        if (stderrLineBuffer) {
          const progress = parseNativeBackupProgressLine(stderrLineBuffer)
          if (progress) onProgress?.(progress)
        }
        cleanup()
        const stdoutOutput = stdout.trim()
        const combinedOutput = (stdout + '\n' + stderr).trim()
        const output = code === 0 && stdoutOutput ? stdoutOutput : combinedOutput
        resolve({ ok: code === 0, code, output, stdout, stderr })
      })
    })
  }

  async function createLocalBackup(
    input: TelenoNodeSettingsInput | undefined,
    sender: WebContents
  ): Promise<TelenoNodeBackupRestoreResult> {
    const action: TelenoNodeBackupProgressAction = 'create-backup'
    activeBackupCancelled = false

    function emitProgress(
      phase: TelenoNodeBackupProgressPhase,
      progress: number,
      message: string,
      telemetry: BackupProgressTelemetry = {}
    ) {
      sender.send('teleno:node:backup-progress:event', {
        action,
        phase,
        progress: normalizeBackupProgressValue(progress),
        message,
        ...telemetry
      } satisfies TelenoNodeBackupProgressEvent)
    }

    function checkCancelled(): boolean {
      return activeBackupCancelled
    }

    function cleanupOnCancel() {
      activeBackupProcess = null
      const message = 'Backup stopped by user. Partial backup data may remain in the backup workspace.'
      emitProgress('cancelled', 0, message)
      return { ok: false, action, output: message, status: 'cancelled' } as TelenoNodeBackupRestoreResult
    }

    try {
      const settings = deps.normalizeNodeSettings(input)
      deps.assertRepoReady(settings)
      const nativeBackup = writeNativeBackupConfig(settings)
      const currentNodeStatus = await deps.telenoNodeStatus(input).catch(() => null)
      const nodeRunning = nodeStatusLooksRunning(currentNodeStatus)
      const runningAdmin = await runningBackupAdminConnection(settings, input)
      if (runningAdmin) {
            emitProgress('prepare', 5, 'Requesting running-node backup through native admin API')
            const createPayload = await backupAdminRequest(
              runningAdmin.baseUrl,
              runningAdmin.token,
              'POST',
              '/admin/backup/create',
              { remote: settings.backup.remoteEnabled }
            )
            let currentStatus = backupStatusPayload(createPayload)
            const operationId = stringField(currentStatus.operation_id)
            if (!operationId) throw new Error('Backup admin did not return an operation id')
            activeBackupAdminOperation = { ...runningAdmin, operationId }

            try {
              const startedAt = Date.now()
              while (Date.now() - startedAt < 6 * 60 * 60 * 1000) {
                if (checkCancelled()) return cleanupOnCancel()
                const state = stringField(currentStatus.state)
                const currentPhase = stringField(currentStatus.phase)
                const message = stringField(currentStatus.message) || `Native admin backup state: ${state || 'unknown'}`
                if (state === 'succeeded') {
                  const snapshot = currentStatus.snapshot && typeof currentStatus.snapshot === 'object'
                    ? currentStatus.snapshot as Record<string, unknown>
                    : {}
                  const remoteUpload = currentStatus.remote_upload && typeof currentStatus.remote_upload === 'object'
                    ? currentStatus.remote_upload as Record<string, unknown>
                    : {}
                  const backupId = stringField(snapshot.backup_id)
                  const totalBytes = numberField(snapshot.total_bytes)
                  const remoteDirectory = stringField(remoteUpload.remote_directory)
                  emitProgress(
                    'complete',
                    100,
                    backupId
                      ? `Native hot backup created: ${backupId}${totalBytes ? ` (${formatByteCount(totalBytes)})` : ''}.${remoteDirectory ? ` Remote uploaded to ${remoteDirectory}` : ''}`
                      : 'Native hot backup created'
                  )
                  return {
                    ok: true,
                    action,
                    output: [
                      'Native backup created through running-node admin API',
                      `Operation ID: ${operationId}`,
                      JSON.stringify(currentStatus, null, 2)
                    ].join('\n'),
                    status: 'complete'
                  }
                }
                if (state === 'failed') {
                  emitProgress('error', 70, message)
                  return { ok: false, action, output: message, status: 'error' }
                }

                const progress = currentStatus.progress && typeof currentStatus.progress === 'object'
                  ? currentStatus.progress as Record<string, unknown>
                  : {}
                if (currentPhase === 'upload' || currentPhase === 'upload-latest') {
                  const completedBatches = numberField(progress.completed_batches)
                  const totalBatches = numberField(progress.total_batches)
                  const totalBytes = numberField(progress.total_bytes)
                  const fraction = totalBatches ? Math.max(0, Math.min(1, completedBatches / totalBatches)) : 0
                  const suffix = nativeProgressSuffix({
                    phase: currentPhase,
                    backupId: '',
                    completedBatches,
                    totalBatches,
                    attempt: numberField(progress.attempt),
                    fileCount: numberField(progress.file_count),
                    completedBytes: numberField(progress.completed_bytes),
                    totalBytes
                  })
                  const telemetry = nativeProgressTelemetry({
                    phase: currentPhase,
                    backupId: '',
                    completedBatches,
                    totalBatches,
                    attempt: numberField(progress.attempt),
                    fileCount: numberField(progress.file_count),
                    completedBytes: numberField(progress.completed_bytes),
                    totalBytes
                  }, 45, 95)
                  emitProgress('upload', Math.min(95, 45 + (fraction * 50)), suffix ? `${message} (${suffix})` : message, telemetry)
                } else {
                  emitProgress('save', currentPhase === 'checkpoint' ? 20 : 35, message)
                }
                await delay(1000)
                try {
                  currentStatus = backupStatusPayload(
                    await backupAdminRequest(runningAdmin.baseUrl, runningAdmin.token, 'GET', `/admin/backup/status/${encodeURIComponent(operationId)}`)
                  )
                } catch (error) {
                  const detail = error instanceof Error ? error.message : String(error)
                  const interruptedMessage = [
                    'The running node stopped while the native backup was in progress.',
                    'The backup did not complete; clear the partial local staging data and start the backup again.',
                    detail
                  ].join(' ')
                  emitProgress('error', 70, interruptedMessage)
                  return { ok: false, action, output: interruptedMessage, status: 'error' }
                }
              }
              throw new Error('Native admin backup timed out')
            } finally {
              activeBackupAdminOperation = null
            }
      }
      if (nodeRunning) {
        const message = settings.backup.adminEnabled
          ? 'The node is already running, but the Backup Admin API is not reachable. Save Backup Admin settings and restart the node, then create the backup again.'
          : 'The node is already running, but Backup Admin is disabled. Enable Backup Admin, save settings, restart the node, then create the backup again.'
        emitProgress('error', 0, message)
        return { ok: false, action, output: message, status: 'error' }
      }
      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        emitProgress('error', 0, `teleno_node binary not found: ${binaryPath}`)
        return { ok: false, action, output: `teleno_node binary not found: ${binaryPath}`, status: 'error' }
      }

      emitProgress('prepare', 5, 'Preparing native hot backup repository')
      emitProgress('save', 20, `Creating hot RocksDB checkpoint in ${nativeBackup.workspaceDir}`)

      const result = await spawnTrackedBackupCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          '--backup-create',
          '--backup-json'
        ],
        settings.repoPath,
        (nativeProgress) => {
          if (nativeProgress.phase !== 'upload-latest') return
          const fraction = nativeProgressFraction(nativeProgress)
          const progress = Math.min(95, 45 + (fraction * 50))
          const suffix = nativeProgressSuffix(nativeProgress)
          emitProgress(
            'upload',
            progress,
            suffix
              ? `Uploading native backup to remote SFTP (${suffix})`
              : 'Uploading native backup to remote SFTP',
            nativeProgressTelemetry(nativeProgress, 45, 95)
          )
        }
      )

      if (checkCancelled()) return cleanupOnCancel()

      if (!result.ok) {
        emitProgress('error', 60, result.output || 'Native backup command failed')
        return { ok: false, action, output: result.output || 'Native backup command failed', status: 'error' }
      }

      let backupId = ''
      let totalBytes = 0
      let remoteSummary = ''
      try {
        const payload = parseNativeBackupJsonOutput(result.output) as {
          backup_id?: string
          total_bytes?: number
          local_snapshot?: { backup_id?: string; total_bytes?: number }
          remote_upload?: { remote_directory?: string; total_bytes?: number; retry_count?: number }
        }
        backupId = payload.local_snapshot?.backup_id || payload.backup_id || ''
        totalBytes =
          typeof payload.local_snapshot?.total_bytes === 'number'
            ? payload.local_snapshot.total_bytes
            : typeof payload.total_bytes === 'number'
              ? payload.total_bytes
              : 0
        if (payload.remote_upload?.remote_directory) {
          remoteSummary = ` Remote uploaded to ${payload.remote_upload.remote_directory}`
        }
      } catch {
        // Keep raw output below when JSON parsing fails.
      }

      emitProgress(
        'complete',
        100,
        backupId
          ? `Native hot backup created: ${backupId}${totalBytes ? ` (${formatByteCount(totalBytes)})` : ''}.${remoteSummary}`
          : 'Native hot backup created'
      )
      return {
        ok: true,
        action,
        output: [
          `Native backup repository: ${nativeBackup.repositoryDir}`,
          `Native backup workspace: ${nativeBackup.workspaceDir}`,
          result.output
        ].filter(Boolean).join('\n'),
        status: 'complete'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitProgress('error', 0, `Error creando backup: ${message}`)
      return { ok: false, action, output: message, status: 'error' }
    }
  }

  async function nativeBackupDryRun(
    input: TelenoNodeSettingsInput | undefined
  ): Promise<TelenoNodeNativeBackupDryRunResult> {
    try {
      const settings = deps.normalizeNodeSettings(input)
      deps.assertRepoReady(settings)
      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        return { ok: false, output: `teleno_node binary not found: ${binaryPath}` }
      }

      const nativeBackup = writeNativeBackupConfig(settings)
      const result = await deps.runCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          '--backup-dry-run',
          '--backup-json'
        ],
        { cwd: settings.repoPath, timeoutMs: 30_000 }
      )

      return {
        ok: result.ok,
        output: result.output,
        configPath: nativeBackup.configPath,
        repositoryDir: nativeBackup.repositoryDir,
        workspaceDir: nativeBackup.workspaceDir
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  }

  async function nativeBackupConfig(
    input: TelenoNodeSettingsInput | undefined
  ): Promise<TelenoNodeNativeBackupConfigResult> {
    try {
      const settings = deps.normalizeNodeSettings(input)
      const configPath = nativeBackupConfigPath(settings.baseDir)
      const defaultRepositoryDir = nativeBackupRepositoryDir(settings.baseDir)
      const defaultWorkspaceDir = nativeBackupWorkspaceDir(settings.baseDir)
      if (!fs.existsSync(configPath)) {
        return {
          ok: false,
          output: `Native backup config not found: ${configPath}`,
          configPath,
          repositoryDir: defaultRepositoryDir,
          workspaceDir: defaultWorkspaceDir
        }
      }

      const doc = parseDocument(fs.readFileSync(configPath, 'utf8'))
      if (doc.errors.length > 0) {
        return {
          ok: false,
          output: `Native backup config parse error: ${doc.errors[0]?.message || 'invalid YAML'}`,
          configPath,
          repositoryDir: defaultRepositoryDir,
          workspaceDir: defaultWorkspaceDir
        }
      }

      const backup = readNativeBackupSettingsFromDocument(doc, settings.backup)
      return {
        ok: true,
        output: `Loaded native backup config: ${configPath}`,
        configPath,
        repositoryDir: expandBackupFilePath(backup.localDirectory) || defaultRepositoryDir,
        workspaceDir: expandBackupFilePath(backup.workspace) || defaultWorkspaceDir,
        backup
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  }

  async function nativeBackupList(
    input: TelenoNodeSettingsInput | undefined
  ): Promise<TelenoNodeNativeBackupListResult> {
    try {
      const listPublic = Boolean((input as { public?: boolean } | undefined)?.public)
      const listRemote = !listPublic && Boolean((input as { remote?: boolean } | undefined)?.remote)
      const listSource = listPublic ? 'public' : listRemote ? 'remote' : 'local'
      const settings = deps.normalizeNodeSettings(input)
      deps.assertRepoReady(settings)
      const nativeBackup = writeNativeBackupConfig(settings)
      let adminListResult: TelenoNodeNativeBackupListResult | null = null
      const runningAdmin = await runningBackupAdminConnection(settings, input)
      if (runningAdmin) {
        try {
          const route = listPublic
            ? '/admin/backup/public/snapshots'
            : listRemote
              ? '/admin/backup/snapshots/remote'
              : '/admin/backup/snapshots/local'
          const payload = await backupAdminRequest(
            runningAdmin.baseUrl,
            runningAdmin.token,
            'GET',
            route,
            undefined,
            listRemote || listPublic ? 120_000 : 30_000
          )
          const parsed = parseNativeBackupListPayload(payload)
          adminListResult = {
            ok: true,
            output: JSON.stringify(payload, null, 2),
            source: listSource,
            configPath: nativeBackup.configPath,
            repositoryDir: nativeBackup.repositoryDir,
            workspaceDir: nativeBackup.workspaceDir,
            latestBackupId: parsed.latestBackupId,
            remoteSpace: parsed.remoteSpace,
            snapshots: parsed.snapshots
          }
          if (listPublic) return adminListResult
          if (!listRemote || adminListResult.remoteSpace) return adminListResult
        } catch {
          // A node started before backup admin was enabled has no admin port.
          // Listing is read-only, so keep the UX usable through the CLI fallback.
        }
      }

      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        return {
          ok: false,
          output: `teleno_node binary not found: ${binaryPath}`,
          source: listSource,
          latestBackupId: '',
          snapshots: []
        }
      }

      const result = await deps.runCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          listPublic ? '--backup-public-list' : listRemote ? '--backup-list-remote' : '--backup-list',
          ...(listPublic ? publicBootstrapCliArgs(settings) : []),
          '--backup-json'
        ],
        { cwd: settings.repoPath, timeoutMs: listRemote || listPublic ? 120_000 : 30_000 }
      )

      let parsed: Pick<TelenoNodeNativeBackupListResult, 'latestBackupId' | 'remoteSpace' | 'snapshots'> = {
        latestBackupId: '',
        snapshots: []
      }
      if (result.ok) parsed = parseNativeBackupListOutput(result.output)

      const cliListResult: TelenoNodeNativeBackupListResult = {
        ok: result.ok,
        output: result.output,
        source: listSource,
        configPath: nativeBackup.configPath,
        repositoryDir: nativeBackup.repositoryDir,
        workspaceDir: nativeBackup.workspaceDir,
        latestBackupId: parsed.latestBackupId,
        remoteSpace: parsed.remoteSpace,
        snapshots: parsed.snapshots
      }
      return cliListResult.ok || !adminListResult ? cliListResult : adminListResult
    } catch (error) {
      const listPublic = Boolean((input as { public?: boolean } | undefined)?.public)
      const listRemote = !listPublic && Boolean((input as { remote?: boolean } | undefined)?.remote)
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        source: listPublic ? 'public' : listRemote ? 'remote' : 'local',
        latestBackupId: '',
        snapshots: []
      }
    }
  }

  async function nativeBackupPurge(
    input: TelenoNodeNativeBackupPurgeInput | undefined
  ): Promise<TelenoNodeNativeBackupPurgeResult> {
    const source = input?.backupSource === 'remote' ? 'remote' : 'local'
    const backupId = typeof input?.backupId === 'string' ? input.backupId.trim() : ''
    try {
      if (!backupId || backupId === 'latest') {
        throw new Error("Native backup purge requires an exact backup ID; 'latest' is not accepted")
      }

      const settings = deps.normalizeNodeSettings(input)
      deps.assertRepoReady(settings)
      const nativeBackup = writeNativeBackupConfig(settings)
      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        return {
          ok: false,
          output: `teleno_node binary not found: ${binaryPath}`,
          backupId,
          source,
          configPath: nativeBackup.configPath,
          repositoryDir: nativeBackup.repositoryDir,
          workspaceDir: nativeBackup.workspaceDir
        }
      }

      const result = await deps.runCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          '--backup-delete',
          '--backup-json',
          `--backup-id=${backupId}`,
          `--backup-scope=${source}`,
          `--backup-delete-confirm=${backupId}`
        ],
        { cwd: settings.repoPath, timeoutMs: source === 'remote' ? 10 * 60_000 : 5 * 60_000 }
      )

      return {
        ok: result.ok,
        output: result.output,
        backupId,
        source,
        configPath: nativeBackup.configPath,
        repositoryDir: nativeBackup.repositoryDir,
        workspaceDir: nativeBackup.workspaceDir
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        backupId,
        source
      }
    }
  }

  async function nativeBackupRestorePreflight(
    input: TelenoNodeNativeBackupRestoreInput | undefined
  ): Promise<TelenoNodeNativeBackupPreflightResult> {
    const empty = {
      backupId: '',
      readyToRestore: false,
      snapshotComplete: false,
      fileCount: 0,
      missingObjectCount: 0,
      missingObjectBytes: 0,
      restoreSpace: {
        restoredDatabaseBytes: 0,
        runtimeFilesBytes: 0,
        objectDownloadBytes: 0,
        minimumTargetFreeBytes: 0,
        recommendedTargetFreeBytes: 0
      },
      spaceCheck: {
        passesMinimum: false,
        belowRecommended: false,
        availableBytes: 0,
        targetPath: '',
        message: ''
      }
    }
    try {
      const settings = deps.normalizeNodeSettings(input)
      const backupId = typeof input?.backupId === 'string' ? input.backupId.trim() : ''
      const restoreSource = nativeBackupRestoreSource(input)
      deps.assertRepoReady(settings)
      const nativeBackup = writeNativeBackupConfig(settings)
      const runningAdmin = await runningBackupAdminConnection(settings, input)
      if (runningAdmin) {
        try {
          const payload = await backupAdminRequest(
            runningAdmin.baseUrl,
            runningAdmin.token,
            'POST',
            restoreSource === 'public' ? '/admin/backup/public/preflight' : '/admin/backup/restore/preflight',
            { backup_id: backupId || 'latest' },
            restoreSource === 'public' ? 120_000 : 30_000
          )
          const parsed = parseNativeBackupPreflightPayload(payload)
          return {
            ok: true,
            output: JSON.stringify(payload, null, 2),
            configPath: nativeBackup.configPath,
            repositoryDir: nativeBackup.repositoryDir,
            workspaceDir: nativeBackup.workspaceDir,
            ...parsed
          }
        } catch {
          // Preflight is read-only against the local repository, so CLI fallback
          // is safe when an already-running node has no backup admin listener.
        }
      }

      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        return { ok: false, output: `teleno_node binary not found: ${binaryPath}`, ...empty }
      }

      if (restoreSource === 'public') {
        const result = await deps.runCommand(
          binaryPath,
          [
            `--basedir=${settings.baseDir}`,
            `--config=${nativeBackup.configPath}`,
            '--backup-public-fetch',
            ...publicBootstrapCliArgs(settings),
            '--backup-json',
            ...(backupId && backupId !== 'latest' ? [`--backup-id=${backupId}`] : [])
          ],
          { cwd: settings.repoPath, timeoutMs: 6 * 60 * 60 * 1000 }
        )
        const parsed = result.output
          ? publicRestorePreflightFromFetchPayload(parseNativeBackupJsonOutput(result.output))
          : empty
        return {
          ok: result.ok,
          output: result.output,
          configPath: nativeBackup.configPath,
          repositoryDir: nativeBackup.repositoryDir,
          workspaceDir: nativeBackup.workspaceDir,
          ...parsed
        }
      }

      const result = await deps.runCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          '--backup-restore-preflight',
          '--backup-json',
          ...(backupId && backupId !== 'latest' ? [`--backup-id=${backupId}`] : [])
        ],
        { cwd: settings.repoPath, timeoutMs: 30_000 }
      )
      const parsed = result.output ? parseNativeBackupPreflightOutput(result.output) : empty
      return {
        ok: result.ok,
        output: result.output,
        configPath: nativeBackup.configPath,
        repositoryDir: nativeBackup.repositoryDir,
        workspaceDir: nativeBackup.workspaceDir,
        ...parsed
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error), ...empty }
    }
  }

  async function restoreNativeBackup(
    input: TelenoNodeNativeBackupRestoreInput | undefined,
    sender: WebContents
  ): Promise<TelenoNodeBackupRestoreResult> {
    const action: TelenoNodeBackupProgressAction = 'restore-backup'
    activeBackupCancelled = false

    function emitProgress(
      phase: TelenoNodeBackupProgressPhase,
      progress: number,
      message: string,
      telemetry: BackupProgressTelemetry = {}
    ) {
      sender.send('teleno:node:backup-progress:event', {
        action,
        phase,
        progress: normalizeBackupProgressValue(progress),
        message,
        ...telemetry
      } satisfies TelenoNodeBackupProgressEvent)
    }

    function checkCancelled(): boolean {
      return activeBackupCancelled
    }

    function cleanupRestoreOnCancel(progress = 0): TelenoNodeBackupRestoreResult {
      activeBackupProcess = null
      activeBackupAdminOperation = null
      const message = 'Restore stopped by user. Partial restore staging data was preserved; start restore again to run a clean restore flow.'
      emitProgress('cancelled', progress, message)
      return { ok: false, action, output: message, status: 'cancelled' }
    }

    try {
      const settings = deps.normalizeNodeSettings(input)
      const requestedBackupId = typeof input?.backupId === 'string' ? input.backupId.trim() : ''
      const restoreSource = nativeBackupRestoreSource(input)
      deps.assertRepoReady(settings)
      const nativeBackup = writeNativeBackupConfig(settings)
      const stagingDir = path.join(settings.baseDir, NATIVE_BACKUP_DIR, 'restore-staging')
      if (restoreSource === 'remote' && !settings.backup.remoteEnabled) {
        throw new Error('Remote native backup restore was requested, but remote backup is disabled in settings')
      }
      if (restoreSource === 'public' && !publicBootstrapUrlForNetwork(settings.network)) {
        throw new Error('Public bootstrap restore is not available for this network.')
      }
      const shouldFetchPublic = restoreSource === 'public'
      const shouldFetchRemote = restoreSource === 'remote' || (restoreSource === 'auto' && settings.backup.remoteEnabled)
      const runningAdmin = await runningBackupAdminConnection(settings, input)
      if (runningAdmin) {
        const backupId = requestedBackupId || 'latest'
        emitProgress('prepare', 5, 'Preparing running-node native restore through admin API')

        if (shouldFetchRemote || shouldFetchPublic) {
          emitProgress(
            'download',
            20,
            shouldFetchPublic
              ? 'Fetching public bootstrap backup metadata and missing objects'
              : 'Fetching remote native backup metadata and missing objects'
          )
          const fetchPayload = await backupAdminRequest(
            runningAdmin.baseUrl,
            runningAdmin.token,
            'POST',
            shouldFetchPublic ? '/admin/backup/public/fetch' : '/admin/backup/restore/fetch',
            { backup_id: backupId },
            30_000
          )
          let currentStatus = backupStatusPayload(fetchPayload)
          const operationId = stringField(currentStatus.operation_id)
          if (!operationId) throw new Error('Backup admin did not return a restore fetch operation id')
          activeBackupAdminOperation = { ...runningAdmin, operationId }

          try {
            const startedAt = Date.now()
            while (Date.now() - startedAt < 6 * 60 * 60 * 1000) {
              if (checkCancelled()) return cleanupRestoreOnCancel(45)
              const state = stringField(currentStatus.state)
              const message = stringField(currentStatus.message) || `Native restore fetch state: ${state || 'unknown'}`
              if (state === 'succeeded') {
                const fetchResultKey = shouldFetchPublic ? 'public_restore_fetch' : 'restore_fetch'
                const restoreFetch = currentStatus[fetchResultKey] && typeof currentStatus[fetchResultKey] === 'object'
                  ? currentStatus[fetchResultKey] as Record<string, unknown>
                  : {}
                if (restoreFetch.ready_to_stage === false) {
                  const blockedMessage = restoreBlockedMessage(restoreFetch, message || 'Native restore fetch did not pass preflight')
                  emitProgress('error', 45, blockedMessage)
                  return { ok: false, action, output: blockedMessage, status: 'error' }
                }
                break
              }
              if (state === 'failed') {
                emitProgress('error', 45, message)
                return { ok: false, action, output: message, status: 'error' }
              }

              const progress = currentStatus.progress && typeof currentStatus.progress === 'object'
                ? currentStatus.progress as Record<string, unknown>
                : {}
              const completedBatches = numberField(progress.completed_batches)
              const totalBatches = numberField(progress.total_batches)
              const totalBytes = numberField(progress.total_bytes)
              const fraction = totalBatches ? Math.max(0, Math.min(1, completedBatches / totalBatches)) : 0
              const nativeLikeProgress = {
                phase: 'download',
                backupId,
                completedBatches,
                totalBatches,
                attempt: numberField(progress.attempt),
                fileCount: numberField(progress.file_count),
                completedBytes: numberField(progress.completed_bytes),
                totalBytes
              }
              const suffix = nativeProgressSuffix(nativeLikeProgress)
              emitProgress(
                'download',
                Math.min(60, 25 + (fraction * 35)),
                suffix ? `${message} (${suffix})` : message,
                nativeProgressTelemetry(nativeLikeProgress, 25, 60)
              )
              await delay(1000)
              if (checkCancelled()) return cleanupRestoreOnCancel(45)
              currentStatus = backupStatusPayload(
                await backupAdminRequest(runningAdmin.baseUrl, runningAdmin.token, 'GET', `/admin/backup/status/${encodeURIComponent(operationId)}`)
              )
            }
          } finally {
            activeBackupAdminOperation = null
          }
        }

        if (checkCancelled()) return cleanupRestoreOnCancel(60)
        emitProgress('verify', 62, 'Verifying selected native backup before staging')
        const preflightPayload = await backupAdminRequest(
          runningAdmin.baseUrl,
          runningAdmin.token,
          'POST',
          shouldFetchPublic ? '/admin/backup/public/preflight' : '/admin/backup/restore/preflight',
          { backup_id: backupId },
          30_000
        )
        const preflight = parseNativeBackupPreflightPayload(preflightPayload)
        if (!preflight.readyToRestore) {
          const message = preflight.spaceCheck.message || 'Native backup is not ready to restore'
          emitProgress('error', 62, message)
          return { ok: false, action, output: JSON.stringify(preflightPayload, null, 2), status: 'error' }
        }

        if (checkCancelled()) return cleanupRestoreOnCancel(62)
        clearStaleRestorePartialStaging(stagingDir, emitProgress)
        fs.rmSync(stagingDir, { recursive: true, force: true })
        fs.mkdirSync(stagingDir, { recursive: true })

        if (checkCancelled()) return cleanupRestoreOnCancel(72)
        emitProgress('restore', 72, 'Staging native backup restore')
        let stagePayload: Record<string, unknown>
        try {
          stagePayload = await backupAdminRequest(
            runningAdmin.baseUrl,
            runningAdmin.token,
            'POST',
            shouldFetchPublic ? '/admin/backup/public/restore/stage' : '/admin/backup/restore/stage',
            { backup_id: backupId, staging_dir: stagingDir },
            6 * 60 * 60 * 1000
          )
      } catch (error) {
          if (!backupAdminHeaderTimeout(error)) throw error
          if (checkCancelled()) return cleanupRestoreOnCancel(78)
          emitProgress(
            'restore',
            78,
            'Native restore staging is still running; waiting for local staging files to finish'
          )
          stagePayload = await waitForNativeRestoreStageCompletion(
            stagingDir,
            6 * 60 * 60 * 1000,
            emitProgress
          )
        }
        if (checkCancelled()) return cleanupRestoreOnCancel(88)
        emitProgress('restore', 88, 'Writing restore activation request')
        const activationPayload = await backupAdminRequest(
          runningAdmin.baseUrl,
          runningAdmin.token,
          'POST',
          shouldFetchPublic ? '/admin/backup/public/restore/activate' : '/admin/backup/restore/activate',
          { backup_id: backupId, staging_dir: stagingDir },
          30_000
        )

        emitProgress('complete', 100, 'Native backup staged. Stop and restart the node to activate the staged restore.')
        return {
          ok: true,
          action,
          output: [
            'Native backup staged through running-node admin API.',
            'The live database was not replaced. Stop and restart the node to activate the staged restore request.',
            `Native backup config: ${nativeBackup.configPath}`,
            `Native backup repository: ${nativeBackup.repositoryDir}`,
            JSON.stringify({ preflight: preflightPayload, stage: stagePayload, activation: activationPayload }, null, 2)
          ].join('\n'),
          status: 'complete'
        }
      }

      const binaryPath = resolveMonolithBinaryPath()
      if (!fs.existsSync(binaryPath)) {
        emitProgress('error', 0, `teleno_node binary not found: ${binaryPath}`)
        return { ok: false, action, output: `teleno_node binary not found: ${binaryPath}`, status: 'error' }
      }

      if (checkCancelled()) return cleanupRestoreOnCancel(5)
      emitProgress('prepare', 5, 'Preparing native backup restore')
      clearStaleRestorePartialStaging(stagingDir, emitProgress)
      fs.rmSync(stagingDir, { recursive: true, force: true })
      fs.mkdirSync(stagingDir, { recursive: true })

      if (checkCancelled()) return cleanupRestoreOnCancel(12)
      emitProgress('stop', 12, 'Stopping node before native restore')
      const stopResult = await deps.telenoNodeAction('stop', input)
      if (!stopResult.ok) {
        emitProgress('error', 12, stopResult.output || 'Could not stop node before native restore')
        return { ok: false, action, output: stopResult.output || 'Could not stop node before native restore', status: 'error' }
      }

      emitProgress('download', 25, 'Fetching and validating latest native backup')
      const backupIdArgs = requestedBackupId && requestedBackupId !== 'latest' ? [`--backup-id=${requestedBackupId}`] : []

      if (!shouldFetchRemote && !shouldFetchPublic) {
        if (checkCancelled()) return cleanupRestoreOnCancel(25)
        emitProgress('verify', 25, 'Verifying selected local native backup')
        const preflightResult = await deps.runCommand(
          binaryPath,
          [
            `--basedir=${settings.baseDir}`,
            `--config=${nativeBackup.configPath}`,
            '--backup-restore-preflight',
            '--backup-json',
            ...backupIdArgs
          ],
          { cwd: settings.repoPath, timeoutMs: 30_000 }
        )
        if (!preflightResult.ok) {
          emitProgress('error', 30, preflightResult.output || 'Native backup preflight failed')
          return { ok: false, action, output: preflightResult.output || 'Native backup preflight failed', status: 'error' }
        }

        if (checkCancelled()) return cleanupRestoreOnCancel(55)
        emitProgress('restore', 55, 'Staging selected local native backup')
        const stageResult = await spawnTrackedBackupCommand(
          binaryPath,
          [
            `--basedir=${settings.baseDir}`,
            `--config=${nativeBackup.configPath}`,
            '--backup-restore-stage',
            '--backup-json',
            `--backup-output=${stagingDir}`,
            ...backupIdArgs
          ],
          settings.repoPath,
          (nativeProgress) => {
            if (nativeProgress.phase !== 'restore-stage') return
            const fraction = nativeProgressFraction(nativeProgress)
            const suffix = nativeProgressSuffix(nativeProgress)
            emitProgress(
              'restore',
              Math.min(88, 55 + (fraction * 33)),
              suffix ? `Staging selected local native backup (${suffix})` : 'Staging selected local native backup',
              nativeProgressTelemetry(nativeProgress, 55, 88)
            )
          }
        )
        if (checkCancelled()) return cleanupRestoreOnCancel(70)
        if (!stageResult.ok) {
          emitProgress('error', 70, stageResult.output || 'Native backup stage failed')
          return { ok: false, action, output: stageResult.output || 'Native backup stage failed', status: 'error' }
        }

        if (checkCancelled()) return cleanupRestoreOnCancel(85)
        emitProgress('restore', 85, 'Writing restore activation request')
        const activationResult = await deps.runCommand(
          binaryPath,
          [
            `--basedir=${settings.baseDir}`,
            `--config=${nativeBackup.configPath}`,
            '--backup-restore-activate',
            '--backup-json',
            `--backup-output=${stagingDir}`
          ],
          { cwd: settings.repoPath, timeoutMs: 30_000 }
        )
        if (!activationResult.ok) {
          emitProgress('error', 90, activationResult.output || 'Native backup activation request failed')
          return { ok: false, action, output: activationResult.output || 'Native backup activation request failed', status: 'error' }
        }

        emitProgress('complete', 100, 'Native backup restored. Start as observer before enabling production.')
        return {
          ok: true,
          action,
          output: [
            `Native backup config: ${nativeBackup.configPath}`,
            `Native backup repository: ${nativeBackup.repositoryDir}`,
            preflightResult.output,
            stageResult.output,
            activationResult.output
          ].filter(Boolean).join('\n'),
          status: 'complete'
        }
      }

      const result = await spawnTrackedBackupCommand(
        binaryPath,
        [
          `--basedir=${settings.baseDir}`,
          `--config=${nativeBackup.configPath}`,
          shouldFetchPublic ? '--backup-public-restore' : '--backup-restore',
          ...(shouldFetchPublic ? publicBootstrapCliArgs(settings) : []),
          '--backup-json',
          `--backup-output=${stagingDir}`,
          ...backupIdArgs
        ],
        settings.repoPath,
        (nativeProgress) => {
          const fraction = nativeProgressFraction(nativeProgress)
          const suffix = nativeProgressSuffix(nativeProgress)
          if (nativeProgress.phase.startsWith('restore-metadata')) {
            emitProgress(
              'download',
              Math.min(35, 25 + (fraction * 10)),
              suffix ? `Fetching remote backup metadata (${suffix})` : 'Fetching remote backup metadata',
              nativeProgressTelemetry(nativeProgress, 25, 35)
            )
            return
          }
          if (nativeProgress.phase.startsWith('public-restore-metadata')) {
            emitProgress(
              'download',
              Math.min(35, 25 + (fraction * 10)),
              suffix ? `Fetching public backup metadata (${suffix})` : 'Fetching public backup metadata',
              nativeProgressTelemetry(nativeProgress, 25, 35)
            )
            return
          }
          if (nativeProgress.phase === 'restore-objects') {
            emitProgress(
              'download',
              Math.min(60, 35 + (fraction * 25)),
              suffix ? `Fetching remote backup objects (${suffix})` : 'Fetching remote backup objects',
              nativeProgressTelemetry(nativeProgress, 35, 60)
            )
          }
          if (nativeProgress.phase === 'public-restore-objects') {
            emitProgress(
              'download',
              Math.min(60, 35 + (fraction * 25)),
              suffix ? `Fetching public backup objects (${suffix})` : 'Fetching public backup objects',
              nativeProgressTelemetry(nativeProgress, 35, 60)
            )
            return
          }
          if (nativeProgress.phase === 'restore-stage' || nativeProgress.phase === 'public-restore-stage') {
            emitProgress(
              'restore',
              Math.min(92, 60 + (fraction * 32)),
              suffix ? `Staging restored database files (${suffix})` : 'Staging restored database files',
              nativeProgressTelemetry(nativeProgress, 60, 92)
            )
          }
        }
      )

      if (checkCancelled()) return cleanupRestoreOnCancel(92)
      if (!result.ok) {
        const fallback = result.output || 'Native restore command failed'
        const blockedMessage = restoreBlockedMessageFromOutput(result.output, fallback)
        emitProgress('error', 60, blockedMessage)
        return { ok: false, action, output: blockedMessage, status: 'error' }
      }

      let restoredBackupId = ''
      try {
        const payload = parseNativeBackupJsonOutput(result.output) as { activation?: { backup_id?: string } }
        restoredBackupId = payload.activation?.backup_id || ''
      } catch {
        // Preserve raw output below when JSON parsing fails.
      }

      emitProgress(
        'complete',
        100,
        restoredBackupId
          ? `Native backup restored: ${restoredBackupId}. Start as observer before enabling production.`
          : 'Native backup restored. Start as observer before enabling production.'
      )

      return {
        ok: true,
        action,
        output: [
          `Native backup config: ${nativeBackup.configPath}`,
          `Native backup repository: ${nativeBackup.repositoryDir}`,
          result.output
        ].filter(Boolean).join('\n'),
        status: 'complete'
      }
    } catch (error) {
      if (checkCancelled()) return cleanupRestoreOnCancel(0)
      const message = error instanceof Error ? error.message : String(error)
      emitProgress('error', 0, `Error restoring native backup: ${message}`)
      return { ok: false, action, output: message, status: 'error' }
    }
  }

  async function restoreNativeBackupLatest(
    input: TelenoNodeSettingsInput | undefined,
    sender: WebContents
  ): Promise<TelenoNodeBackupRestoreResult> {
    return restoreNativeBackup(input, sender)
  }

  function getVerifyBlocks(input?: TelenoNodeSettingsInput): { ok: boolean; enabled: boolean | null; output: string } {
    try {
      const settings = deps.normalizeNodeSettings(input)
      const enabled = readConfigVerifyBlocks(settings.baseDir)
      return { ok: true, enabled, output: enabled === null ? 'verify-blocks not set in config.yml' : `verify-blocks=${enabled}` }
    } catch (error) {
      return { ok: false, enabled: null, output: error instanceof Error ? error.message : String(error) }
    }
  }

  function setVerifyBlocks(input?: TelenoNodeSettingsInput & { enabled?: boolean }): { ok: boolean; output: string } {
    try {
      const settings = deps.normalizeNodeSettings(input)
      const enabled = input?.enabled ?? false
      return setConfigVerifyBlocks(settings.baseDir, enabled)
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    koinosJsonRpcProxy,
    telenoNodeRestoreBackup,
    telenoNodeRestoreBackupAndVerify,
    createLocalBackup,
    nativeBackupDryRun,
    nativeBackupConfig,
    nativeBackupList,
    nativeBackupPurge,
    nativeBackupRestorePreflight,
    restoreNativeBackup,
    restoreNativeBackupLatest,
    cancelCreateBackup,
    isBackupOperationActive,
    restoreFromLocalFile,
    copyNodeBaseDirData,
    selectNodeBaseDir,
    getVerifyBlocks,
    setVerifyBlocks
  }
}
