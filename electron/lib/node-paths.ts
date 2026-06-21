import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_BASEDIR,
  DEFAULT_PUBLIC_RPC_URLS,
  resolveDefaultKoinosRepoPath,
  resolveKoinosConfigRoot
} from './constants'
import { isExistingTelenoNodeBaseDir } from './basedir-identity'
import {
  defaultProfilesForNetwork,
  normalizeKoinosNetworkId,
  resolveNetworkProfile,
  type KoinosNetworkId
} from './network-profiles'
import type { TelenoNodeBackupAuthMethod, TelenoNodeBackupSettings, TelenoNodeBackupSettingsInput } from './main-types'

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
  const absoluteCandidate = path.isAbsolute(trimmedTrailingSeparators)
    ? trimmedTrailingSeparators
    : path.join(os.homedir(), trimmedTrailingSeparators)
  if (isExistingTelenoNodeBaseDir(absoluteCandidate)) return absoluteCandidate

  const existingChildBaseDir = ['basedir', '.koinos']
    .map((childName) => path.join(absoluteCandidate, childName))
    .find((candidate) => isExistingTelenoNodeBaseDir(candidate))
  if (existingChildBaseDir) return existingChildBaseDir

  const withSuffix =
    trimmedTrailingSeparators.endsWith('.koinos') ||
    trimmedTrailingSeparators.endsWith('.koinosgui') ||
    trimmedTrailingSeparators.endsWith('.teleno')
    ? trimmedTrailingSeparators
    : path.join(trimmedTrailingSeparators, '.koinos')
  // Always return an absolute path — relative paths cause failures in packaged builds
  // where CWD is the install directory, not the user's home
  return path.isAbsolute(withSuffix) ? withSuffix : path.join(os.homedir(), withSuffix)
}

export function restoreWorkspaceParentPath(baseDir: string): string {
  return path.dirname(ensureKoinosBaseDir(baseDir || DEFAULT_BASEDIR))
}

export function verifyWritableDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK)
}

export function configDirPath(settings: { repoPath: string }): string {
  const repoConfigDir = path.join(settings.repoPath, 'config')
  if (fs.existsSync(path.join(repoConfigDir, 'config.yml'))) return repoConfigDir

  const vendoredConfigDir = path.join(settings.repoPath, 'vendor', 'koinos', 'koinos', 'config')
  if (fs.existsSync(path.join(vendoredConfigDir, 'config.yml'))) return vendoredConfigDir

  const bundledConfigDir = resolveKoinosConfigRoot()
  if (isTelenoRepoRoot(settings.repoPath) && fs.existsSync(path.join(bundledConfigDir, 'config.yml'))) {
    return bundledConfigDir
  }

  return repoConfigDir
}

export function configExampleDirPath(settings: { repoPath: string }): string {
  const repoExampleDir = path.join(settings.repoPath, 'config-example')
  if (fs.existsSync(path.join(repoExampleDir, 'config.yml'))) return repoExampleDir

  const vendoredExampleDir = path.join(settings.repoPath, 'vendor', 'koinos', 'koinos', 'config-example')
  if (fs.existsSync(path.join(vendoredExampleDir, 'config.yml'))) return vendoredExampleDir

  const bundledConfigDir = resolveKoinosConfigRoot()
  if (isTelenoRepoRoot(settings.repoPath) && fs.existsSync(path.join(bundledConfigDir, 'config.yml'))) {
    return bundledConfigDir
  }

  return repoExampleDir
}

export function managedFilePath(
  settings: { repoPath: string },
  kind: 'config'
): string {
  return path.join(configDirPath(settings), 'config.yml')
}

function isTelenoRepoRoot(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, 'node', 'teleno-node')) && fs.existsSync(path.join(repoPath, 'package.json'))
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

export function sanitizePublicRpcUrls(value: unknown, fallback: string[] = DEFAULT_PUBLIC_RPC_URLS): string[] {
  if (!Array.isArray(value)) {
    return [...fallback]
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

  return urls.length > 0 ? urls : [...fallback]
}

const NATIVE_DEFAULT_PROFILES = ['mainnet_observer']
const DEFAULT_BACKUP_SETTINGS: TelenoNodeBackupSettings = {
  localEnabled: true,
  localDirectory: '',
  workspace: '',
  localRetentionCount: 7,
  remoteEnabled: false,
  remoteDirectory: '',
  remoteRetentionCount: 14,
  remoteRetentionDays: 30,
  uploadTempSuffix: '.partial',
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshAuth: 'private-key',
  sshPrivateKeyFile: '',
  sshPasswordFile: '',
  sshPassphraseFile: '',
  sshKnownHostsFile: '',
  sshStrictHostKeyChecking: true,
  sshConnectTimeoutSeconds: 15,
  scheduleEnabled: false,
  scheduleInterval: '6h',
  scheduleRunOnStartupIfMissed: true,
  scheduleJitterSeconds: 300,
  scheduleMinimumHeadProgress: 1,
  scheduleSkipIfSyncingFromGenesis: true,
  scheduleMaxConcurrentBackups: 1,
  adminEnabled: true,
  adminListen: '127.0.0.1:18088',
  adminTokenFile: '',
  adminJobs: 1
}

function normalizeBackupAuthMethod(value: unknown): TelenoNodeBackupAuthMethod {
  return value === 'password-file' || value === 'env-password' || value === 'private-key'
    ? value
    : DEFAULT_BACKUP_SETTINGS.sshAuth
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  const safe = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(max, Math.max(min, safe))
}

function normalizeBackupRemoteDirectory(value: unknown): string {
  const directory = stringValue(value, DEFAULT_BACKUP_SETTINGS.remoteDirectory)
  if (directory === '/srv/teleno-backups/testnet/teleno-ux-testnet') {
    return '/srv/teleno-backups/testnet/teleno-dev/teleno-ux-testnet'
  }
  return directory
}

export function normalizeBackupSettings(input?: TelenoNodeBackupSettingsInput): TelenoNodeBackupSettings {
  const value = input && typeof input === 'object' ? input : {}
  return {
    localEnabled: value.remoteEnabled === true || value.localEnabled !== false,
    localDirectory: stringValue(value.localDirectory, DEFAULT_BACKUP_SETTINGS.localDirectory),
    workspace: stringValue(value.workspace, DEFAULT_BACKUP_SETTINGS.workspace),
    localRetentionCount: numberValue(value.localRetentionCount, DEFAULT_BACKUP_SETTINGS.localRetentionCount, 1, 365),
    remoteEnabled: value.remoteEnabled === true,
    remoteDirectory: normalizeBackupRemoteDirectory(value.remoteDirectory),
    remoteRetentionCount: numberValue(value.remoteRetentionCount, DEFAULT_BACKUP_SETTINGS.remoteRetentionCount, 1, 365),
    remoteRetentionDays: numberValue(value.remoteRetentionDays, DEFAULT_BACKUP_SETTINGS.remoteRetentionDays, 1, 3650),
    uploadTempSuffix: stringValue(value.uploadTempSuffix, DEFAULT_BACKUP_SETTINGS.uploadTempSuffix) || '.partial',
    sshHost: stringValue(value.sshHost, DEFAULT_BACKUP_SETTINGS.sshHost),
    sshPort: numberValue(value.sshPort, DEFAULT_BACKUP_SETTINGS.sshPort, 1, 65535),
    sshUser: stringValue(value.sshUser, DEFAULT_BACKUP_SETTINGS.sshUser),
    sshAuth: normalizeBackupAuthMethod(value.sshAuth),
    sshPrivateKeyFile: stringValue(value.sshPrivateKeyFile, DEFAULT_BACKUP_SETTINGS.sshPrivateKeyFile),
    sshPasswordFile: stringValue(value.sshPasswordFile, DEFAULT_BACKUP_SETTINGS.sshPasswordFile),
    sshPassphraseFile: stringValue(value.sshPassphraseFile, DEFAULT_BACKUP_SETTINGS.sshPassphraseFile),
    sshKnownHostsFile: stringValue(value.sshKnownHostsFile, DEFAULT_BACKUP_SETTINGS.sshKnownHostsFile),
    sshStrictHostKeyChecking: value.sshStrictHostKeyChecking !== false,
    sshConnectTimeoutSeconds: numberValue(value.sshConnectTimeoutSeconds, DEFAULT_BACKUP_SETTINGS.sshConnectTimeoutSeconds, 1, 300),
    scheduleEnabled: value.scheduleEnabled === true,
    scheduleInterval: stringValue(value.scheduleInterval, DEFAULT_BACKUP_SETTINGS.scheduleInterval) || '6h',
    scheduleRunOnStartupIfMissed: value.scheduleRunOnStartupIfMissed !== false,
    scheduleJitterSeconds: numberValue(value.scheduleJitterSeconds, DEFAULT_BACKUP_SETTINGS.scheduleJitterSeconds, 0, 86400),
    scheduleMinimumHeadProgress: numberValue(value.scheduleMinimumHeadProgress, DEFAULT_BACKUP_SETTINGS.scheduleMinimumHeadProgress, 0, 1000000),
    scheduleSkipIfSyncingFromGenesis: value.scheduleSkipIfSyncingFromGenesis !== false,
    scheduleMaxConcurrentBackups: 1,
    adminEnabled: value.remoteEnabled === true || value.adminEnabled !== false,
    adminListen: stringValue(value.adminListen, DEFAULT_BACKUP_SETTINGS.adminListen) || '127.0.0.1:18088',
    adminTokenFile: stringValue(value.adminTokenFile, DEFAULT_BACKUP_SETTINGS.adminTokenFile),
    adminJobs: numberValue(value.adminJobs, DEFAULT_BACKUP_SETTINGS.adminJobs, 1, 16)
  }
}

export function defaultBaseDirForNetwork(network: KoinosNetworkId): string {
  if (network === 'testnet') return path.join(DEFAULT_BASEDIR, 'testnet', '.koinos')
  if (network === 'custom') return path.join(DEFAULT_BASEDIR, 'custom', '.koinos')
  return DEFAULT_BASEDIR
}

export function normalizeNodeSettings(
  input?: {
    network?: KoinosNetworkId
    repoPath?: string
    baseDir?: string
    profiles?: string[]
    blockchainBackupUrl?: string
    backup?: TelenoNodeBackupSettingsInput
  }
): {
  network: KoinosNetworkId
  repoPath: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
  backup: TelenoNodeBackupSettings
} {
  const repoPath = expandUserPath(input?.repoPath || resolveDefaultKoinosRepoPath())
  const profileFromInput = Array.isArray(input?.profiles) ? input.profiles : undefined
  const network = resolveNetworkProfile(input?.network, profileFromInput).id
  const baseDir = ensureKoinosBaseDir(input?.baseDir || defaultBaseDirForNetwork(network))
  const profiles = profileFromInput ?? defaultProfilesForNetwork(network) ?? NATIVE_DEFAULT_PROFILES
  const networkProfile = resolveNetworkProfile(network, profiles)
  const defaultBackupUrl = networkProfile.blockchainBackupUrl ?? ''
  const blockchainBackupUrl = (input?.blockchainBackupUrl ?? defaultBackupUrl).trim()

  return {
    network,
    repoPath,
    baseDir,
    profiles,
    blockchainBackupUrl,
    backup: normalizeBackupSettings(input?.backup)
  }
}

export function parsePersistedNodeSettings(input: unknown): {
  network?: KoinosNetworkId
  repoPath?: string
  baseDir?: string
  profiles?: string[]
  blockchainBackupUrl?: string
  backup?: TelenoNodeBackupSettingsInput
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
    network: typeof value.network === 'string' ? normalizeKoinosNetworkId(value.network) : undefined,
    repoPath: typeof value.repoPath === 'string' ? value.repoPath : undefined,
    baseDir: typeof value.baseDir === 'string' ? value.baseDir : undefined,
    profiles,
    blockchainBackupUrl: typeof value.blockchainBackupUrl === 'string' ? value.blockchainBackupUrl : undefined,
    backup: value.backup && typeof value.backup === 'object' ? value.backup as TelenoNodeBackupSettingsInput : undefined
  }
}
