import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_BASEDIR,
  DEFAULT_PUBLIC_RPC_URLS,
  resolveDefaultKoinosRepoPath
} from './constants'
import { isExistingKoinosNodeBaseDir } from './basedir-identity'
import {
  defaultProfilesForNetwork,
  normalizeKoinosNetworkId,
  resolveNetworkProfile,
  type KoinosNetworkId
} from './network-profiles'

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
  if (isExistingKoinosNodeBaseDir(absoluteCandidate)) return absoluteCandidate

  const existingChildBaseDir = ['basedir', '.koinos']
    .map((childName) => path.join(absoluteCandidate, childName))
    .find((candidate) => isExistingKoinosNodeBaseDir(candidate))
  if (existingChildBaseDir) return existingChildBaseDir

  const withSuffix = trimmedTrailingSeparators.endsWith('.koinos') || trimmedTrailingSeparators.endsWith('.koinosgui')
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
  }
): {
  network: KoinosNetworkId
  repoPath: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
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
    blockchainBackupUrl
  }
}

export function parsePersistedNodeSettings(input: unknown): {
  network?: KoinosNetworkId
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
    network: typeof value.network === 'string' ? normalizeKoinosNetworkId(value.network) : undefined,
    repoPath: typeof value.repoPath === 'string' ? value.repoPath : undefined,
    baseDir: typeof value.baseDir === 'string' ? value.baseDir : undefined,
    profiles,
    blockchainBackupUrl: typeof value.blockchainBackupUrl === 'string' ? value.blockchainBackupUrl : undefined
  }
}
