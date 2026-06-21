import type { CSSProperties } from 'react'
import { detectAppLanguage, normalizeAppLanguage, translate, type AppLanguage } from '../i18n'
import {
  ANSI_BASIC_COLORS,
  ANSI_BRIGHT_COLORS,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
  DASHBOARD_REFRESH_SECONDS_DEFAULT,
  DASHBOARD_REFRESH_SECONDS_MAX,
  DASHBOARD_REFRESH_SECONDS_MIN,
  DEFAULT_KOINSCAN_URL,
  DEFAULT_NODE_BACKUP_SETTINGS,
  DEFAULT_NODE_SETTINGS,
  DEFAULT_NODE_BASEDIR_BY_NETWORK,
  DEFAULT_NODE_PROFILES_BY_NETWORK,
  DEFAULT_PUBLIC_RPC_URLS,
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  LEGACY_LANGUAGE_STORAGE_KEY,
  LEGACY_NODE_NETWORK_BASEDIRS_STORAGE_KEY,
  LEGACY_NODE_SETTINGS_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  LOCAL_RPC_SOURCE,
  NODE_NETWORK_BASEDIRS_STORAGE_KEY,
  NODE_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY
} from './constants'
import type {
  AnsiStyleState,
  AnsiTextSegment,
  BlockDetail,
  BlockRow,
  BlockStoreItem,
  BlocksByHeightResult,
  BlocksByIdResult,
  ExplorerRpcSource,
  ExplorerSettings,
  HeadInfoResult,
  HeadSnapshot,
  JsonRpcResponse,
  NodeBackupSettings,
  NodeManagerSettings,
  NodeServiceCapabilities,
  OperationDetail,
  RawTransactionReceipt,
  TransactionDetail
} from './types'
import { normalizeKoinosNetworkId, type KoinosNetworkId } from './network'

export function safeParseInt(value: string | undefined, fallback = 0): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function formatDateTime(timestampMs: number, locale: string, emptyLabel: string): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return emptyLabel
  return new Date(timestampMs).toLocaleString(locale)
}

export function formatTime(timestampMs: number, locale: string, emptyLabel = ''): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return emptyLabel
  return new Date(timestampMs).toLocaleTimeString(locale)
}

export function remoteBackupDefaults(network: string) {
  if (network === 'mainnet') {
    return {
      sshHost: 'seed.koinosfoundation.org',
      sshUser: 'teleno_backup',
      remoteDirectory: '/srv/teleno-backups/prodnet/teleno-dev/teleno-ux-mainnet',
      sshPrivateKeyFile: '~/.ssh/id_ed25519',
      sshKnownHostsFile: '~/.ssh/known_hosts'
    }
  }

  if (network === 'testnet') {
    return {
      sshHost: 'testnet.koinosfoundation.org',
      sshUser: 'teleno_backup',
      remoteDirectory: '/srv/teleno-backups/testnet/teleno-dev/teleno-ux-testnet',
      sshPrivateKeyFile: '~/.ssh/id_ed25519',
      sshKnownHostsFile: '~/.ssh/known_hosts'
    }
  }

  return {
    sshHost: '',
    sshUser: '',
    remoteDirectory: '',
    sshPrivateKeyFile: '',
    sshKnownHostsFile: ''
  }
}

export function formatRelativeAge(timestampMs: number, nowMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 'N/A'
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

export function formatDecimalValue(
  value: number | string | null | undefined,
  locale: string,
  maximumFractionDigits = 4,
  emptyLabel = 'N/A'
): string {
  if (value === null || value === undefined || value === '') return emptyLabel
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return emptyLabel
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(numeric)
}

export function formatCpuPercent(value: number | null | undefined, locale: string, emptyLabel = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return emptyLabel
  return `${formatDecimalValue(value, locale, value >= 10 ? 1 : 2, emptyLabel)}%`
}

export function formatBytes(value: number | null | undefined, locale: string, emptyLabel = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return emptyLabel
  if (value === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const maximumFractionDigits = size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(size)} ${units[unitIndex]}`
}

export function formatDurationSeconds(value: number | null | undefined, emptyLabel = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return emptyLabel

  const totalSeconds = Math.floor(value)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0 || parts.length > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

  return parts.slice(0, 3).join(' ')
}

export function formatUsdValue(value: number | null | undefined, locale: string, emptyLabel = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return emptyLabel
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 6
  }).format(value)
}

export function shortHash(value: string, head = 12, tail = 8): string {
  if (!value) return 'N/A'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeDashboardProducerWindowBlocks(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT

  return clamp(
    Number.isFinite(numeric) ? Math.round(numeric) : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
    DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
    DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX
  )
}

export function normalizeDashboardRefreshSeconds(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DASHBOARD_REFRESH_SECONDS_DEFAULT

  return clamp(
    Number.isFinite(numeric) ? Math.round(numeric) : DASHBOARD_REFRESH_SECONDS_DEFAULT,
    DASHBOARD_REFRESH_SECONDS_MIN,
    DASHBOARD_REFRESH_SECONDS_MAX
  )
}

export function joinDisplayPath(basePath: string, childPath: string): string {
  const base = basePath.replace(/[\\/]+$/, '')
  const child = childPath.replace(/^\.?[\\/]+/, '')
  if (!base) return childPath
  if (!child) return base
  return `${base}/${child}`
}

export function resolveNodeFileDisplayPath(repoPath: string, filePathValue: string): string {
  const raw = filePathValue.trim()
  if (!raw) return ''
  if (raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)) return raw
  return joinDisplayPath(repoPath.trim(), raw)
}

export function normalizeRpcUrl(raw: string, language: AppLanguage): string {
  const value = raw.trim()
  if (!value) throw new Error(translate(language, 'rpc.validation.empty'))
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(translate(language, 'rpc.validation.http'))
  }
  return parsed.toString()
}

export function normalizeBackupTarGzUrl(raw: string, language: AppLanguage): string {
  const value = raw.trim()
  if (!value) throw new Error(translate(language, 'backup.validation.empty'))
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(translate(language, 'backup.validation.http'))
  }
  if (!parsed.pathname.endsWith('.tar.gz')) {
    throw new Error(translate(language, 'backup.validation.tar'))
  }
  return parsed.toString()
}

export function tryNormalizeHttpUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (!/^https?:$/.test(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function normalizeExternalHttpsUrl(raw: string | undefined, fallback = DEFAULT_KOINSCAN_URL): string {
  const value = `${raw || ''}`.trim()
  const candidate = value || fallback
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`

  try {
    const parsed = new URL(withProtocol)
    if (!/^https?:$/.test(parsed.protocol)) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

export function formatKoinscanBlockUrl(baseUrl: string | undefined, height: number | string): string {
  const parsed = new URL(normalizeExternalHttpsUrl(baseUrl))
  const cleanPath = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = `${cleanPath}/blocks/${height}`.replace(/\/{2,}/g, '/')
  return parsed.toString()
}

export function sanitizeStoredPublicRpcUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PUBLIC_RPC_URLS]
  const seen = new Set<string>()
  const urls: string[] = []

  for (const candidate of value) {
    const normalized = typeof candidate === 'string' ? tryNormalizeHttpUrl(candidate) : null
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  return urls.length > 0 ? urls : [...DEFAULT_PUBLIC_RPC_URLS]
}

export function normalizeExplorerRpcSource(
  value: unknown,
  publicRpcUrls: string[],
  fallback: ExplorerRpcSource = LOCAL_RPC_SOURCE
): ExplorerRpcSource {
  if (value === LOCAL_RPC_SOURCE) return LOCAL_RPC_SOURCE

  if (typeof value === 'string') {
    const normalized = tryNormalizeHttpUrl(value)
    if (normalized && publicRpcUrls.includes(normalized)) return normalized
  }

  if (fallback === LOCAL_RPC_SOURCE) return LOCAL_RPC_SOURCE
  if (typeof fallback === 'string') {
    const normalizedFallback = tryNormalizeHttpUrl(fallback)
    if (normalizedFallback && publicRpcUrls.includes(normalizedFallback)) return normalizedFallback
  }

  return publicRpcUrls[0] ?? LOCAL_RPC_SOURCE
}

export function formatRpcDisplayUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export function formatExplorerRpcSourceKind(source: ExplorerRpcSource, language: AppLanguage): string {
  return source === LOCAL_RPC_SOURCE ? translate(language, 'rpc.mode.local') : translate(language, 'rpc.mode.public')
}

export function formatExplorerRpcSourceTarget(source: ExplorerRpcSource, language: AppLanguage): string {
  return source === LOCAL_RPC_SOURCE ? translate(language, 'rpc.mode.local') : formatRpcDisplayUrl(source)
}

export function parsePublicRpcUrlsInput(raw: string, language: AppLanguage): string[] {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const part of raw.split(/[\n,]+/)) {
    const value = part.trim()
    if (!value) continue
    const normalized = normalizeRpcUrl(value, language)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  if (urls.length === 0) {
    throw new Error(translate(language, 'rpc.validation.publicListEmpty'))
  }

  return urls
}

export function formatProducerWalletBalanceError(message: string, rpcUrl: string, language: AppLanguage): string {
  if (/context deadline exceeded|timed out|timeout/i.test(message)) {
    return translate(language, 'producer.signingWalletRpcTimeout', { rpcUrl: formatRpcDisplayUrl(rpcUrl) })
  }

  if (/rpc failed|internal server error/i.test(message)) {
    return translate(language, 'producer.signingWalletRpcError', { rpcUrl: formatRpcDisplayUrl(rpcUrl) })
  }

  return message
}

function getStoredItemWithLegacyFallback(storage: Storage, primaryKey: string, legacyKey: string): string | null {
  const primary = storage.getItem(primaryKey)
  if (primary !== null) return primary
  return storage.getItem(legacyKey)
}

export function loadInitialSettings(): ExplorerSettings {
  try {
    const raw = getStoredItemWithLegacyFallback(window.localStorage, SETTINGS_STORAGE_KEY, LEGACY_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ExplorerSettings>
    const publicRpcUrls = sanitizeStoredPublicRpcUrls(
      (parsed as Partial<ExplorerSettings> & { publicRpcUrls?: unknown }).publicRpcUrls
    )
    const legacyRpcUrl =
      typeof (parsed as { rpcUrl?: unknown }).rpcUrl === 'string'
        ? tryNormalizeHttpUrl((parsed as { rpcUrl?: string }).rpcUrl ?? '')
        : null

    if (legacyRpcUrl && (parsed as { rpcMode?: unknown }).rpcMode !== LOCAL_RPC_SOURCE && !publicRpcUrls.includes(legacyRpcUrl)) {
      publicRpcUrls.push(legacyRpcUrl)
    }

    const legacyFallback =
      (parsed as { rpcMode?: unknown }).rpcMode === LOCAL_RPC_SOURCE
        ? LOCAL_RPC_SOURCE
        : legacyRpcUrl ?? publicRpcUrls[0] ?? LOCAL_RPC_SOURCE

    return {
      rpcSource: normalizeExplorerRpcSource((parsed as { rpcSource?: unknown }).rpcSource, publicRpcUrls, legacyFallback),
      publicRpcUrls,
      koinscanUrl: normalizeExternalHttpsUrl(typeof parsed.koinscanUrl === 'string' ? parsed.koinscanUrl : DEFAULT_SETTINGS.koinscanUrl),
      pollMs: clamp(typeof parsed.pollMs === 'number' ? parsed.pollMs : DEFAULT_SETTINGS.pollMs, 1000, 30000),
      rowLimit: clamp(typeof parsed.rowLimit === 'number' ? parsed.rowLimit : DEFAULT_SETTINGS.rowLimit, 5, 50),
      producerAdvancedMode: parsed.producerAdvancedMode === true,
      nodeAdvancedMode: parsed.nodeAdvancedMode === true,
      dashboardProducerWindowBlocks: normalizeDashboardProducerWindowBlocks(parsed.dashboardProducerWindowBlocks),
      dashboardRefreshSeconds: normalizeDashboardRefreshSeconds(parsed.dashboardRefreshSeconds)
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function normalizeBackupAuthMethod(value: unknown): NodeBackupSettings['sshAuth'] {
  return value === 'password-file' || value === 'env-password' || value === 'private-key'
    ? value
    : DEFAULT_NODE_BACKUP_SETTINGS.sshAuth
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max)
}

function normalizeBackupRemoteDirectory(value: unknown): string {
  const directory = stringValue(value, DEFAULT_NODE_BACKUP_SETTINGS.remoteDirectory)
  if (directory === '/srv/teleno-backups/testnet/teleno-ux-testnet') {
    return '/srv/teleno-backups/testnet/teleno-dev/teleno-ux-testnet'
  }
  return directory
}

export function normalizeNodeBackupSettings(input?: Partial<NodeBackupSettings> | null): NodeBackupSettings {
  const value = input && typeof input === 'object' ? input : {}
  return {
    localEnabled: value.remoteEnabled === true || value.localEnabled !== false,
    localDirectory: stringValue(value.localDirectory, DEFAULT_NODE_BACKUP_SETTINGS.localDirectory),
    workspace: stringValue(value.workspace, DEFAULT_NODE_BACKUP_SETTINGS.workspace),
    localRetentionCount: numberValue(value.localRetentionCount, DEFAULT_NODE_BACKUP_SETTINGS.localRetentionCount, 1, 365),
    remoteEnabled: value.remoteEnabled === true,
    remoteDirectory: normalizeBackupRemoteDirectory(value.remoteDirectory),
    remoteRetentionCount: numberValue(value.remoteRetentionCount, DEFAULT_NODE_BACKUP_SETTINGS.remoteRetentionCount, 1, 365),
    remoteRetentionDays: numberValue(value.remoteRetentionDays, DEFAULT_NODE_BACKUP_SETTINGS.remoteRetentionDays, 1, 3650),
    uploadTempSuffix: stringValue(value.uploadTempSuffix, DEFAULT_NODE_BACKUP_SETTINGS.uploadTempSuffix) || '.partial',
    sshHost: stringValue(value.sshHost, DEFAULT_NODE_BACKUP_SETTINGS.sshHost),
    sshPort: numberValue(value.sshPort, DEFAULT_NODE_BACKUP_SETTINGS.sshPort, 1, 65535),
    sshUser: stringValue(value.sshUser, DEFAULT_NODE_BACKUP_SETTINGS.sshUser),
    sshAuth: normalizeBackupAuthMethod(value.sshAuth),
    sshPrivateKeyFile: stringValue(value.sshPrivateKeyFile, DEFAULT_NODE_BACKUP_SETTINGS.sshPrivateKeyFile),
    sshPasswordFile: stringValue(value.sshPasswordFile, DEFAULT_NODE_BACKUP_SETTINGS.sshPasswordFile),
    sshPassphraseFile: stringValue(value.sshPassphraseFile, DEFAULT_NODE_BACKUP_SETTINGS.sshPassphraseFile),
    sshKnownHostsFile: stringValue(value.sshKnownHostsFile, DEFAULT_NODE_BACKUP_SETTINGS.sshKnownHostsFile),
    sshStrictHostKeyChecking: value.sshStrictHostKeyChecking !== false,
    sshConnectTimeoutSeconds: numberValue(
      value.sshConnectTimeoutSeconds,
      DEFAULT_NODE_BACKUP_SETTINGS.sshConnectTimeoutSeconds,
      1,
      300
    ),
    scheduleEnabled: value.scheduleEnabled === true,
    scheduleInterval: stringValue(value.scheduleInterval, DEFAULT_NODE_BACKUP_SETTINGS.scheduleInterval) || '6h',
    scheduleRunOnStartupIfMissed: value.scheduleRunOnStartupIfMissed !== false,
    scheduleJitterSeconds: numberValue(value.scheduleJitterSeconds, DEFAULT_NODE_BACKUP_SETTINGS.scheduleJitterSeconds, 0, 86400),
    scheduleMinimumHeadProgress: numberValue(
      value.scheduleMinimumHeadProgress,
      DEFAULT_NODE_BACKUP_SETTINGS.scheduleMinimumHeadProgress,
      0,
      1000000
    ),
    scheduleSkipIfSyncingFromGenesis: value.scheduleSkipIfSyncingFromGenesis !== false,
    scheduleMaxConcurrentBackups: 1,
    adminEnabled: value.remoteEnabled === true || value.adminEnabled !== false,
    adminListen: stringValue(value.adminListen, DEFAULT_NODE_BACKUP_SETTINGS.adminListen) || '127.0.0.1:18088',
    adminTokenFile: stringValue(value.adminTokenFile, DEFAULT_NODE_BACKUP_SETTINGS.adminTokenFile),
    adminJobs: numberValue(value.adminJobs, DEFAULT_NODE_BACKUP_SETTINGS.adminJobs, 1, 16)
  }
}

export function sameNodeBackupSettings(a: NodeBackupSettings, b: NodeBackupSettings): boolean {
  return JSON.stringify(normalizeNodeBackupSettings(a)) === JSON.stringify(normalizeNodeBackupSettings(b))
}

type InitialNodeSettingsInput = {
  network?: unknown
  repoPath?: unknown
  baseDir?: unknown
  profiles?: unknown
  blockchainBackupUrl?: unknown
  backup?: Partial<NodeBackupSettings> | null
}

function normalizeInitialNodeSettings(
  input?: InitialNodeSettingsInput | null,
  options: { preferInputBaseDir?: boolean } = {}
): NodeManagerSettings {
  const parsed = input && typeof input === 'object' ? input : {}
  const rawProfiles =
    Array.isArray(parsed.profiles)
      ? expandNodeProfiles(parsed.profiles.filter((profile): profile is string => typeof profile === 'string')).join(',')
      : typeof parsed.profiles === 'string'
        ? expandNodeProfiles(parseProfilesCsv(parsed.profiles)).join(',')
        : ''
  const storedNetwork = parsed.network
  const network = storedNetwork
    ? normalizeKoinosNetworkId(storedNetwork)
    : rawProfiles.split(',').some((profile) => profile.trim().startsWith('testnet_'))
      ? 'testnet'
      : DEFAULT_NODE_SETTINGS.network
  const profiles = rawProfiles || defaultNodeProfilesForNetwork(network)
  const parsedBaseDir =
    typeof parsed.baseDir === 'string' && parsed.baseDir.trim()
      ? parsed.baseDir
      : defaultNodeBaseDirForNetwork(network)
  const baseDir =
    options.preferInputBaseDir && parsedBaseDir
      ? normalizeNodeBaseDirInput(parsedBaseDir)
      : resolveNodeBaseDirForNetwork(network, parsedBaseDir)
  return {
    network,
    repoPath:
      typeof parsed.repoPath === 'string' && parsed.repoPath.trim()
        ? parsed.repoPath
        : DEFAULT_NODE_SETTINGS.repoPath,
    baseDir,
    profiles,
    blockchainBackupUrl:
      typeof parsed.blockchainBackupUrl === 'string' && parsed.blockchainBackupUrl.trim()
        ? parsed.blockchainBackupUrl
        : DEFAULT_NODE_SETTINGS.blockchainBackupUrl,
    backup: normalizeNodeBackupSettings(parsed.backup)
  }
}

function readLaunchNodeSettingsOverride(): InitialNodeSettingsInput | null {
  try {
    const nodeSettings = window.teleno?.launchDefaults?.nodeSettings
    return nodeSettings && typeof nodeSettings === 'object' ? nodeSettings : null
  } catch {
    return null
  }
}

function applyLaunchNodeSettingsOverride(settings: NodeManagerSettings): NodeManagerSettings {
  const override = readLaunchNodeSettingsOverride()
  if (!override) return settings

  const overrideNetwork = override.network ? normalizeKoinosNetworkId(override.network) : null
  const hasProfiles =
    (typeof override.profiles === 'string' && override.profiles.trim().length > 0) ||
    (Array.isArray(override.profiles) && override.profiles.some((profile) => typeof profile === 'string' && profile.trim()))
  const hasBaseDir = typeof override.baseDir === 'string' && override.baseDir.trim().length > 0
  const networkChanged = Boolean(overrideNetwork && overrideNetwork !== settings.network)
  const overrideBackup = override.backup && typeof override.backup === 'object' ? override.backup : {}

  return normalizeInitialNodeSettings(
    {
      ...settings,
      ...override,
      profiles: hasProfiles
        ? override.profiles
        : networkChanged && overrideNetwork
          ? defaultNodeProfilesForNetwork(overrideNetwork)
          : settings.profiles,
      baseDir: hasBaseDir
        ? override.baseDir
        : networkChanged && overrideNetwork
          ? defaultNodeBaseDirForNetwork(overrideNetwork)
          : settings.baseDir,
      backup: {
        ...settings.backup,
        ...overrideBackup
      }
    },
    { preferInputBaseDir: hasBaseDir }
  )
}

export function loadInitialNodeSettings(): NodeManagerSettings {
  let settings = normalizeInitialNodeSettings()

  try {
    const raw = getStoredItemWithLegacyFallback(
      window.localStorage,
      NODE_SETTINGS_STORAGE_KEY,
      LEGACY_NODE_SETTINGS_STORAGE_KEY
    )
    if (raw) {
      settings = normalizeInitialNodeSettings(JSON.parse(raw) as InitialNodeSettingsInput)
    }
  } catch {
    // Keep default settings when localStorage is unavailable or invalid.
  }

  return applyLaunchNodeSettingsOverride(settings)
}

type NodeBaseDirsByNetwork = Partial<Record<KoinosNetworkId, string>>

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function defaultNodeBaseDirForNetwork(network: KoinosNetworkId): string {
  return DEFAULT_NODE_BASEDIR_BY_NETWORK[network] ?? DEFAULT_NODE_SETTINGS.baseDir
}

export function defaultNodeProfilesForNetwork(network: KoinosNetworkId): string {
  return DEFAULT_NODE_PROFILES_BY_NETWORK[network] ?? DEFAULT_NODE_SETTINGS.profiles
}

export function loadNodeBaseDirsByNetwork(): NodeBaseDirsByNetwork {
  const storage = browserLocalStorage()
  if (!storage) return {}

  try {
    const raw = getStoredItemWithLegacyFallback(
      storage,
      NODE_NETWORK_BASEDIRS_STORAGE_KEY,
      LEGACY_NODE_NETWORK_BASEDIRS_STORAGE_KEY
    )
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Record<KoinosNetworkId, unknown>>
    return {
      mainnet:
        typeof parsed.mainnet === 'string' && parsed.mainnet.trim()
          ? normalizeNodeBaseDirInput(parsed.mainnet)
          : undefined,
      testnet:
        typeof parsed.testnet === 'string' && parsed.testnet.trim()
          ? normalizeNodeBaseDirInput(parsed.testnet)
          : undefined,
      custom:
        typeof parsed.custom === 'string' && parsed.custom.trim()
          ? normalizeNodeBaseDirInput(parsed.custom)
          : undefined
    }
  } catch {
    return {}
  }
}

function knownBaseDirMatchesDifferentNetwork(
  baseDir: string,
  network: KoinosNetworkId,
  baseDirs: NodeBaseDirsByNetwork
): boolean {
  const normalizedBaseDir = normalizeNodeBaseDirInput(baseDir)
  const lowerBaseDir = normalizedBaseDir.toLowerCase()
  if (network === 'mainnet' && /(^|[^a-z0-9])testnet([^a-z0-9]|$)/.test(lowerBaseDir)) return true
  if (network === 'testnet' && /(^|[^a-z0-9])mainnet([^a-z0-9]|$)/.test(lowerBaseDir)) return true

  return (['mainnet', 'testnet', 'custom'] as const).some((candidateNetwork) => {
    if (candidateNetwork === network) return false
    const candidateBaseDir = baseDirs[candidateNetwork] || defaultNodeBaseDirForNetwork(candidateNetwork)
    return normalizeNodeBaseDirInput(candidateBaseDir) === normalizedBaseDir
  })
}

function resolveStoredNodeBaseDir(
  network: KoinosNetworkId,
  fallbackBaseDir: string | undefined,
  baseDirs: NodeBaseDirsByNetwork
): string {
  const storedBaseDir = baseDirs[network]
  if (storedBaseDir && !knownBaseDirMatchesDifferentNetwork(storedBaseDir, network, baseDirs)) {
    return normalizeNodeBaseDirInput(storedBaseDir)
  }

  if (fallbackBaseDir && !knownBaseDirMatchesDifferentNetwork(fallbackBaseDir, network, baseDirs)) {
    return normalizeNodeBaseDirInput(fallbackBaseDir)
  }

  return normalizeNodeBaseDirInput(defaultNodeBaseDirForNetwork(network))
}

export function storeNodeBaseDirForNetwork(network: KoinosNetworkId, baseDir: string): void {
  const storage = browserLocalStorage()
  if (!storage) return

  const storedBaseDirs = loadNodeBaseDirsByNetwork()
  const normalizedBaseDir = normalizeNodeBaseDirInput(baseDir)
  if (knownBaseDirMatchesDifferentNetwork(normalizedBaseDir, network, storedBaseDirs)) return

  const nextBaseDirs = {
    ...storedBaseDirs,
    [network]: normalizedBaseDir
  }

  try {
    storage.setItem(NODE_NETWORK_BASEDIRS_STORAGE_KEY, JSON.stringify(nextBaseDirs))
  } catch {
    // localStorage may be unavailable under strict browser privacy settings.
  }
}

export function resolveNodeBaseDirForNetwork(network: KoinosNetworkId, fallbackBaseDir?: string): string {
  return resolveStoredNodeBaseDir(network, fallbackBaseDir, loadNodeBaseDirsByNetwork())
}

export function loadInitialLanguage(): AppLanguage {
  try {
    const raw = getStoredItemWithLegacyFallback(window.localStorage, LANGUAGE_STORAGE_KEY, LEGACY_LANGUAGE_STORAGE_KEY)
    if (raw) return normalizeAppLanguage(raw)
  } catch {
    // ignore
  }

  return detectAppLanguage()
}

export function parseProfilesCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function normalizeNodeBaseDirInput(value: string): string {
  const trimmed = value.trim() || DEFAULT_NODE_SETTINGS.baseDir
  const normalized = trimmed.replace(/[\\/]+$/, '')
  if (!normalized) return DEFAULT_NODE_SETTINGS.baseDir
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  if (['.koinos', '.koinosgui', '.teleno', 'basedir'].includes(segments.at(-1) ?? '')) return normalized
  return `${normalized}/.koinos`
}

export function toNodeApiSettings(settings: NodeManagerSettings): TelenoNodeSettings {
  return {
    network: settings.network,
    repoPath: settings.repoPath.trim(),
    baseDir: normalizeNodeBaseDirInput(settings.baseDir),
    profiles: expandNodeProfiles(parseProfilesCsv(settings.profiles)),
    blockchainBackupUrl: settings.blockchainBackupUrl.trim(),
    backup: normalizeNodeBackupSettings(settings.backup)
  }
}

export function getTelenoNodeBridge() {
  return window.teleno?.telenoNode
}

export function getAppConfigBridge() {
  return window.teleno?.appConfig
}

export function getWalletBridge() {
  return window.teleno?.wallet
}

export function looksLikeNodeErrorOutput(output: string): boolean {
  return /repo path not found|missing config dir/i.test(output)
}

export function nodeServicePortByTarget(
  service: TelenoNodeServiceStatus | null | undefined,
  targetPort: number
): TelenoNodeServicePort | null {
  return service?.ports.find((port) => port.targetPort === targetPort) ?? null
}

export function normalizeNodeRpcHost(host: string | null | undefined, fallback = '127.0.0.1'): string {
  const value = host?.trim()
  return value && value !== '0.0.0.0' && value !== '::' ? value : fallback
}

export function resolveLocalNodeRpcUrl(nodeStatus: TelenoNodeStatus | null): string {
  const jsonrpcService =
    nodeStatus?.services.find((service) => service.id === 'jsonrpc') ??
    nodeStatus?.services.find((service) => service.id === 'teleno-node') ??
    null
  const jsonrpcPort =
    nodeServicePortByTarget(jsonrpcService, 8080) ??
    jsonrpcService?.ports.find((port) => port.host !== '0.0.0.0' && port.host !== '::') ??
    jsonrpcService?.ports[0] ??
    null
  const host = normalizeNodeRpcHost(jsonrpcPort?.host)
  const port = jsonrpcPort?.publishedPort ?? 8080
  return `http://${host}:${port}/`
}

export function resolveProducerRpcUrl(nodeStatus: TelenoNodeStatus | null, publicRpcUrl: string): string {
  const jsonrpcService = nodeStatus?.services.find((service) => service.id === 'jsonrpc') ?? null
  const contractMetaStoreService = nodeStatus?.services.find((service) => service.id === 'contract_meta_store') ?? null
  return jsonrpcService &&
    isNodeServiceRunning(jsonrpcService) &&
    contractMetaStoreService &&
    isNodeServiceRunning(contractMetaStoreService)
    ? resolveLocalNodeRpcUrl(nodeStatus)
    : publicRpcUrl
}

export function resolveExplorerRpcUrl(settings: ExplorerSettings, nodeStatus: TelenoNodeStatus | null): string {
  if (settings.rpcSource !== LOCAL_RPC_SOURCE) return settings.rpcSource
  return resolveLocalNodeRpcUrl(nodeStatus)
}

export function isNodeServiceRunning(service: TelenoNodeServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

export function formatNodeServicePorts(service: TelenoNodeServiceStatus): string {
  if (!service.ports.length) return '-'
  return service.ports
    .map((port) => port.label || `${port.targetPort ?? '?'}${port.protocol ? `/${port.protocol}` : ''}`)
    .join(', ')
}

export function formatNodeServiceType(_service: TelenoNodeServiceStatus, language: AppLanguage): string {
  return translate(language, 'common.runtimeNative')
}

export function formatNodeServiceVersion(service: TelenoNodeServiceStatus, language: AppLanguage): string {
  return service.version?.trim() || translate(language, 'common.unknown')
}

export function formatNodeServiceTooltip(
  service: TelenoNodeServiceStatus,
  capabilities: NodeServiceCapabilities,
  language: AppLanguage
): string {
  const lines = [
    translate(language, 'node.serviceTooltip.service', { value: service.name }),
    translate(language, 'node.serviceTooltip.runtime', { value: service.runtimeName })
  ]

  if (service.version) {
    lines.push(translate(language, 'node.serviceTooltip.version', { value: service.version }))
  }

  if (service.nativePid) {
    lines.push(translate(language, 'node.serviceTooltip.managedPid', { value: service.nativePid }))
  }

  if (service.conflictPids.length > 0) {
    lines.push(translate(language, 'node.serviceTooltip.conflictingPids', { value: service.conflictPids.join(', ') }))
  }

  lines.push(
    translate(language, 'node.serviceTooltip.dependsOn', {
      value:
        capabilities.dependencyNames.length > 0
          ? capabilities.dependencyNames.join(', ')
          : translate(language, 'common.none')
    })
  )

  if (capabilities.profileDependentNames.length > 0) {
    lines.push(translate(language, 'node.serviceTooltip.usedBy', { value: capabilities.profileDependentNames.join(', ') }))
  }

  if (capabilities.missingDependencyNames.length > 0) {
    lines.push(
      translate(language, 'node.serviceTooltip.missingDependencies', {
        value: capabilities.missingDependencyNames.join(', ')
      })
    )
  }

  if (service.lastError) {
    lines.push(translate(language, 'node.serviceTooltip.issue', { value: service.lastError }))
  }

  return lines.join('\n')
}

export function normalizeStringList(values: string[]): string[] {
  return [...values].map((value) => value.trim()).filter(Boolean).sort()
}

export function expandNodeProfiles(profiles: string[]): string[] {
  return normalizeStringList(profiles)
}

export function formatNodeServiceRuntimeDetail(service: TelenoNodeServiceStatus, language: AppLanguage): string {
  if (service.nativePid) {
    return translate(language, 'node.serviceRuntimeDetail.pid', {
      runtime: service.runtimeName,
      pid: service.nativePid
    })
  }
  if (service.conflictPids.length > 0) {
    return translate(language, 'node.serviceRuntimeDetail.conflict', {
      runtime: service.runtimeName,
      pid: service.conflictPids.join(', ')
    })
  }
  return service.runtimeName
}

export function canKillNodeConflict(service: TelenoNodeServiceStatus): boolean {
  return service.runtimeType === 'native' && service.id !== 'amqp' && service.conflictPids.length > 0
}

export function normalizeProfiles(profiles: string[]): string[] {
  return expandNodeProfiles(profiles)
}

export function sameStringList(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeStringList(left)
  const normalizedRight = normalizeStringList(right)
  if (normalizedLeft.length !== normalizedRight.length) return false
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

export function sameProfiles(left: string[], right: string[]): boolean {
  return sameStringList(expandNodeProfiles(left), expandNodeProfiles(right))
}

export function formatPresetProfiles(preset: TelenoNodePreset, language: AppLanguage): string {
  return preset.profiles.length ? preset.profiles.join(', ') : translate(language, 'common.core')
}

export function basenameFromPath(input: string | null): string {
  if (!input) return '-'
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || input
}

export function formatNativeBuildSystem(buildSystem: TelenoNativeBuildSystem | null): string {
  if (buildSystem === 'cmake') return 'CMake'
  if (buildSystem === 'go') return 'Go'
  if (buildSystem === 'yarn') return 'Yarn'
  return '-'
}

export function formatNativeBuildStatus(
  build: TelenoNodeNativeBuildStatus,
  language: AppLanguage
): { label: string; className: string } {
  if (!build.supported) {
    return { label: translate(language, 'node.buildStatus.unsupported'), className: 'is-unsupported' }
  }

  if (!build.repoExists) {
    return { label: translate(language, 'node.buildStatus.missingRepo'), className: 'is-blocked' }
  }

  if (!build.buildable) {
    return { label: translate(language, 'node.buildStatus.blocked'), className: 'is-blocked' }
  }

  if (build.artifactExists) {
    return { label: translate(language, 'node.buildStatus.built'), className: 'is-built' }
  }

  return { label: translate(language, 'node.buildStatus.pending'), className: 'is-pending' }
}

export function formatNativeBuildTooltip(build: TelenoNodeNativeBuildStatus, language: AppLanguage): string {
  const lines = [translate(language, 'node.buildTooltip.service', { value: build.serviceName })]

  if (build.repoPath) lines.push(translate(language, 'node.buildTooltip.repo', { value: build.repoPath }))
  if (build.artifactPath) lines.push(translate(language, 'node.buildTooltip.artifact', { value: build.artifactPath }))
  if (build.note) lines.push(translate(language, 'node.buildTooltip.note', { value: build.note }))
  if (build.buildCommands.length > 0) {
    lines.push(translate(language, 'node.buildTooltip.build', { value: build.buildCommands.join(' && ') }))
  }

  return lines.join('\n')
}

export function xterm256Color(value: number): string {
  const code = clamp(Math.trunc(value), 0, 255)
  if (code < 16) {
    const palette = [...ANSI_BASIC_COLORS, ...ANSI_BRIGHT_COLORS]
    return palette[code] ?? '#d9e3e8'
  }

  if (code >= 232) {
    const level = 8 + (code - 232) * 10
    return `rgb(${level}, ${level}, ${level})`
  }

  const n = code - 16
  const r = Math.floor(n / 36)
  const g = Math.floor((n % 36) / 6)
  const b = n % 6
  const toChannel = (index: number) => (index === 0 ? 0 : 55 + index * 40)
  return `rgb(${toChannel(r)}, ${toChannel(g)}, ${toChannel(b)})`
}

export function applyAnsiSgrCodes(current: AnsiStyleState, sgrCodes: number[]): AnsiStyleState {
  let next: AnsiStyleState = { ...current }
  const codes = sgrCodes.length ? sgrCodes : [0]

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0

    if (code === 0) {
      next = {}
      continue
    }
    if (code === 1) {
      next.bold = true
      continue
    }
    if (code === 2) {
      next.dim = true
      continue
    }
    if (code === 3) {
      next.italic = true
      continue
    }
    if (code === 4) {
      next.underline = true
      continue
    }
    if (code === 22) {
      next.bold = false
      next.dim = false
      continue
    }
    if (code === 23) {
      next.italic = false
      continue
    }
    if (code === 24) {
      next.underline = false
      continue
    }
    if (code === 39) {
      delete next.fg
      continue
    }
    if (code === 49) {
      delete next.bg
      continue
    }
    if (code >= 30 && code <= 37) {
      next.fg = ANSI_BASIC_COLORS[code - 30]
      continue
    }
    if (code >= 90 && code <= 97) {
      next.fg = ANSI_BRIGHT_COLORS[code - 90]
      continue
    }
    if (code >= 40 && code <= 47) {
      next.bg = ANSI_BASIC_COLORS[code - 40]
      continue
    }
    if (code >= 100 && code <= 107) {
      next.bg = ANSI_BRIGHT_COLORS[code - 100]
      continue
    }

    if ((code === 38 || code === 48) && index + 1 < codes.length) {
      const mode = codes[index + 1]
      if (mode === 5 && index + 2 < codes.length) {
        const color = xterm256Color(codes[index + 2] ?? 0)
        if (code === 38) next.fg = color
        else next.bg = color
        index += 2
        continue
      }
      if (mode === 2 && index + 4 < codes.length) {
        const r = clamp(codes[index + 2] ?? 0, 0, 255)
        const g = clamp(codes[index + 3] ?? 0, 0, 255)
        const b = clamp(codes[index + 4] ?? 0, 0, 255)
        const color = `rgb(${r}, ${g}, ${b})`
        if (code === 38) next.fg = color
        else next.bg = color
        index += 4
      }
    }
  }

  return next
}

export function ansiStyleToCss(styleState: AnsiStyleState): CSSProperties | undefined {
  const style: CSSProperties = {}
  if (styleState.fg) style.color = styleState.fg
  if (styleState.bg) style.backgroundColor = styleState.bg
  if (styleState.bold) style.fontWeight = 700
  if (styleState.dim) style.opacity = 0.78
  if (styleState.italic) style.fontStyle = 'italic'
  if (styleState.underline) style.textDecoration = 'underline'
  return Object.keys(style).length ? style : undefined
}

export function parseAnsiTextSegments(input: string): AnsiTextSegment[] {
  const pattern = /\u001b\[([0-9;]*)m/g
  const segments: AnsiTextSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null = null
  let styleState: AnsiStyleState = {}

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > cursor) {
      segments.push({
        text: input.slice(cursor, match.index),
        style: ansiStyleToCss(styleState)
      })
    }

    const sgrCodes = (match[1] ?? '')
      .split(';')
      .filter((part) => part.length > 0)
      .map((part) => Number.parseInt(part, 10))
      .filter((code) => Number.isFinite(code))

    styleState = applyAnsiSgrCodes(styleState, sgrCodes)
    cursor = match.index + match[0].length
  }

  if (cursor < input.length) {
    segments.push({
      text: input.slice(cursor),
      style: ansiStyleToCss(styleState)
    })
  }

  return segments
}

export function renderAnsiLog(input: string) {
  return parseAnsiTextSegments(input).map((segment, index) => (
    <span key={`${index}-${segment.text.length}`} className="ansi-log-segment" style={segment.style}>
      {segment.text}
    </span>
  ))
}

export async function rpcCall<T>(
  language: AppLanguage,
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<T> {
  const bridge = getTelenoNodeBridge()
  if (bridge?.rpcCall) {
    if (signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    const proxied = await bridge.rpcCall({ rpcUrl, method, params })
    if (signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    if (!proxied.ok) {
      throw new Error(proxied.output || 'RPC error')
    }
    if (proxied.result === undefined) {
      throw new Error(translate(language, 'rpc.resultEmpty'))
    }
    return proxied.result as T
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(translate(language, 'rpc.httpStatus', { status: response.status }))
  }

  const payload = (await response.json()) as JsonRpcResponse<T>
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC error')
  }
  if (payload.result === undefined) {
    throw new Error(translate(language, 'rpc.resultEmpty'))
  }
  return payload.result
}

export function mapBlockItem(item: BlockStoreItem): BlockRow | null {
  const header = item.block?.header
  const height = safeParseInt(header?.height ?? item.block_height, 0)
  const blockId = item.block?.id ?? item.block_id ?? ''
  const previousId = header?.previous ?? ''
  const signer = header?.signer ?? ''
  const timestampMs = safeParseInt(header?.timestamp, 0)

  if (!height || !blockId) return null
  return { height, blockId, previousId, signer, timestampMs }
}

export function filterBlocksByProducer(rows: BlockRow[], producerAddress: string): BlockRow[] {
  const normalizedProducerAddress = producerAddress.trim().toLowerCase()
  if (!normalizedProducerAddress) return []

  return rows.filter((row) => row.signer.trim().toLowerCase() === normalizedProducerAddress)
}

export async function fetchLatestBlocks(
  language: AppLanguage,
  rpcUrl: string,
  rowLimit: number,
  signal: AbortSignal
): Promise<{ head: HeadSnapshot; rows: BlockRow[] }> {
  const head = await fetchHeadSnapshot(language, rpcUrl, signal)

  const ancestorStartHeight = Math.max(1, head.height - rowLimit + 1)

  const blockStore = await rpcCall<BlocksByHeightResult>(
    language,
    rpcUrl,
    'block_store.get_blocks_by_height',
    {
      head_block_id: head.id,
      ancestor_start_height: String(ancestorStartHeight),
      num_blocks: String(rowLimit),
      return_block: true
    },
    signal
  )

  const rows = (blockStore.block_items ?? [])
    .map(mapBlockItem)
    .filter((row): row is BlockRow => row !== null)
    .sort((a, b) => b.height - a.height)

  return {
    head,
    rows
  }
}

export async function fetchHeadSnapshot(
  language: AppLanguage,
  rpcUrl: string,
  signal: AbortSignal
): Promise<HeadSnapshot> {
  const headInfo = await rpcCall<HeadInfoResult>(language, rpcUrl, 'chain.get_head_info', {}, signal)
  const headId = headInfo.head_topology?.id ?? ''
  const headHeight = safeParseInt(headInfo.head_topology?.height, 0)
  const headTimestampMs = safeParseInt(headInfo.head_block_time, 0)

  if (!headId || !headHeight) {
    throw new Error(translate(language, 'rpc.invalidHeadInfo'))
  }

  return { id: headId, height: headHeight, timestampMs: headTimestampMs }
}

export async function fetchBlockDetail(
  language: AppLanguage,
  rpcUrl: string,
  blockId: string,
  signal: AbortSignal
): Promise<BlockDetail> {
  const result = await rpcCall<BlocksByIdResult>(
    language,
    rpcUrl,
    'block_store.get_blocks_by_id',
    {
      block_ids: [blockId],
      return_block: true,
      return_receipt: true
    },
    signal
  )

  const item = result.block_items?.[0]
  if (!item?.block) throw new Error('Block not found')

  const header = item.block.header ?? {}
  const txns = item.block.transactions ?? []
  const receipts = item.receipt?.transaction_receipts ?? []
  const receiptMap = new Map<string, RawTransactionReceipt>()
  for (const r of receipts) {
    if (r.id) receiptMap.set(r.id, r)
  }

  const transactions: TransactionDetail[] = txns.map((tx) => {
    const txReceipt = tx.id ? receiptMap.get(tx.id) ?? null : null
    const ops: OperationDetail[] = (tx.operations ?? []).map((op) => {
      if (op.call_contract) {
        return { type: 'call_contract', contractId: op.call_contract.contract_id ?? '', entryPoint: op.call_contract.entry_point ?? 0, args: op.call_contract.args ?? '' }
      }
      if (op.upload_contract) {
        return { type: 'upload_contract', contractId: op.upload_contract.contract_id ?? '', entryPoint: 0, args: '' }
      }
      if (op.set_system_call) {
        return { type: 'set_system_call', contractId: op.set_system_call.target?.system_call_bundle?.contract_id ?? '', entryPoint: op.set_system_call.target?.system_call_bundle?.entry_point ?? 0, args: '' }
      }
      if (op.set_system_contract) {
        return { type: 'set_system_contract', contractId: op.set_system_contract.contract_id ?? '', entryPoint: 0, args: '' }
      }
      return { type: 'unknown', contractId: '', entryPoint: 0, args: '' }
    })

    return {
      id: tx.id ?? '',
      payer: tx.header?.payer ?? '',
      payee: tx.header?.payee ?? '',
      rcLimit: safeParseInt(tx.header?.rc_limit, 0),
      nonce: tx.header?.nonce ?? '',
      operations: ops,
      signatures: tx.signatures ?? [],
      receipt: txReceipt ? {
        rcUsed: safeParseInt(txReceipt.rc_used, 0),
        rcLimit: safeParseInt(txReceipt.rc_limit, 0),
        diskStorageUsed: safeParseInt(txReceipt.disk_storage_used, 0),
        networkBandwidthUsed: safeParseInt(txReceipt.network_bandwidth_used, 0),
        computeBandwidthUsed: safeParseInt(txReceipt.compute_bandwidth_used, 0),
        reverted: txReceipt.reverted ?? false,
        events: (txReceipt.events ?? []).map((e) => ({
          source: e.source ?? '',
          name: e.name ?? '',
          data: e.data ?? '',
          impacted: e.impacted ?? []
        })),
        logs: txReceipt.logs ?? []
      } : null
    }
  })

  return {
    height: safeParseInt(header.height, 0),
    blockId: item.block_id ?? item.block.id ?? '',
    previousId: header.previous ?? '',
    signer: header.signer ?? '',
    timestampMs: safeParseInt(header.timestamp, 0),
    signature: item.block.signature ?? '',
    transactionMerkleRoot: header.transaction_merkle_root ?? '',
    previousStateMerkleRoot: header.previous_state_merkle_root ?? '',
    approvedProposals: header.approved_proposals ?? [],
    transactions,
    raw: item
  }
}
