import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_BASEDIR,
  DEFAULT_BLOCKCHAIN_BACKUP_URL,
  DEFAULT_PUBLIC_RPC_URLS,
  resolveDefaultKoinosRepoPath
} from './constants'

export function expandUserPath(inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed === '~') return process.env.HOME || trimmed
  if (trimmed.startsWith('~/')) return path.join(process.env.HOME || '', trimmed.slice(2))
  return trimmed
}

export function ensureKoinosBaseDir(inputPath: string): string {
  const expanded = expandUserPath(inputPath || DEFAULT_BASEDIR)
  const normalized = expanded.trim() || DEFAULT_BASEDIR
  const trimmedTrailingSeparators = normalized.replace(/[\\/]+$/, '')
  if (!trimmedTrailingSeparators) return DEFAULT_BASEDIR
  return trimmedTrailingSeparators.endsWith('.koinos')
    ? trimmedTrailingSeparators
    : path.join(trimmedTrailingSeparators, '.koinos')
}

export function restoreWorkspaceParentPath(baseDir: string): string {
  return path.dirname(ensureKoinosBaseDir(baseDir || DEFAULT_BASEDIR))
}

export function verifyWritableDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK)
}

export function configDirPath(settings: { repoPath: string }): string {
  return path.join(settings.repoPath, 'config')
}

export function configExampleDirPath(settings: { repoPath: string }): string {
  return path.join(settings.repoPath, 'config-example')
}

export function managedFilePath(
  settings: { repoPath: string },
  kind: 'config'
): string {
  return path.join(configDirPath(settings), 'config.yml')
}

export function baseDirConfigFilePath(settings: { baseDir: string }): string {
  return path.join(settings.baseDir, 'config.yml')
}

export function blockProducerDirectoryPath(settings: { baseDir: string }): string {
  return path.join(settings.baseDir, 'block_producer')
}

export function blockProducerPublicKeyFilePath(settings: { baseDir: string }): string {
  return path.join(blockProducerDirectoryPath(settings), 'public.key')
}

export function blockProducerPrivateKeyFilePath(settings: { baseDir: string }): string {
  return path.join(blockProducerDirectoryPath(settings), 'private.key')
}

export function readTrimmedFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim()
    return value || null
  } catch {
    return null
  }
}

export function normalizePublicRpcUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (!/^https?:$/.test(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function sanitizePublicRpcUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PUBLIC_RPC_URLS]
  }

  const seen = new Set<string>()
  const urls: string[] = []

  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const normalized = normalizePublicRpcUrl(candidate)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  return urls.length > 0 ? urls : [...DEFAULT_PUBLIC_RPC_URLS]
}

const NATIVE_DEFAULT_PROFILES = ['block_producer', 'jsonrpc', 'contract_meta_store']

export function normalizeNodeSettings(
  input?: {
    repoPath?: string
    baseDir?: string
    profiles?: string[]
    blockchainBackupUrl?: string
  }
): {
  repoPath: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
} {
  const repoPath = expandUserPath(input?.repoPath || resolveDefaultKoinosRepoPath())
  const baseDir = ensureKoinosBaseDir(input?.baseDir || DEFAULT_BASEDIR)
  const profiles = Array.isArray(input?.profiles) ? input.profiles : NATIVE_DEFAULT_PROFILES
  const blockchainBackupUrl = (input?.blockchainBackupUrl || DEFAULT_BLOCKCHAIN_BACKUP_URL).trim() || DEFAULT_BLOCKCHAIN_BACKUP_URL

  return {
    repoPath,
    baseDir,
    profiles,
    blockchainBackupUrl
  }
}

export function parsePersistedNodeSettings(input: unknown): {
  repoPath?: string
  baseDir?: string
  profiles?: string[]
  blockchainBackupUrl?: string
} | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = input as Record<string, unknown>
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.map((entry) => `${entry}`.trim()).filter(Boolean)
    : typeof value.profiles === 'string'
      ? value.profiles
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined

  return {
    repoPath: typeof value.repoPath === 'string' ? value.repoPath : undefined,
    baseDir: typeof value.baseDir === 'string' ? value.baseDir : undefined,
    profiles,
    blockchainBackupUrl: typeof value.blockchainBackupUrl === 'string' ? value.blockchainBackupUrl : undefined
  }
}
