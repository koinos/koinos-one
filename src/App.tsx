import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { detectAppLanguage, localeForLanguage, normalizeAppLanguage, translate, type AppLanguage } from './i18n'

const SETTINGS_STORAGE_KEY = 'knodel.explorer.settings.v1'
const NODE_SETTINGS_STORAGE_KEY = 'knodel.koinos-node.settings.v1'
const LANGUAGE_STORAGE_KEY = 'knodel.ui.language.v1'
const LOCAL_RPC_SOURCE = 'local'
const DEFAULT_PUBLIC_RPC_URLS = ['https://api.koinos.io/', 'https://api.koinosblocks.com/'] as const
const LOCAL_NODE_RPC_FALLBACK_URL = 'http://127.0.0.1:8080/'
const DEFAULT_SETTINGS = {
  rpcSource: LOCAL_RPC_SOURCE as ExplorerRpcSource,
  publicRpcUrls: [...DEFAULT_PUBLIC_RPC_URLS],
  pollMs: 3000,
  rowLimit: 20,
  producerAdvancedMode: false
} as const
const DEFAULT_NODE_SETTINGS = {
  repoPath: '/Users/pgarcgo/code/koinos_code/koinos',
  composeFile: 'docker-compose.yml',
  envFile: '.env',
  baseDir: '~/.koinos',
  profiles: 'block_producer,jsonrpc',
  blockchainBackupUrl: 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz',
  runtimeMode: 'docker' as KnodelKoinosNodeServiceRuntime
} as const
const SYNC_GAP_BLOCK_THRESHOLD = 50
const SYNC_GAP_TIME_THRESHOLD_MS = 30_000

type ExplorerSettings = {
  rpcSource: ExplorerRpcSource
  publicRpcUrls: string[]
  pollMs: number
  rowLimit: number
  producerAdvancedMode: boolean
}

type ExplorerRpcSource = typeof LOCAL_RPC_SOURCE | string

type NodeManagerSettings = {
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string
  blockchainBackupUrl: string
  runtimeMode: KnodelKoinosNodeServiceRuntime
}

type NodeAction = 'start' | 'stop'
type NodeServiceAction = 'start' | 'stop' | 'restart'
type AppTab = 'explorer' | 'node' | 'producer' | 'settings'
type NodeManagedFileKind = 'compose' | 'env' | 'config'
type NodeServiceContextMenuState = {
  serviceId: string
  x: number
  y: number
}
type NodeServiceActionState = {
  serviceId: string
  action: NodeServiceAction
}
type NodeNativeBuildActionState = 'all' | string
type NodeServiceCapabilities = {
  running: boolean
  dependencyNames: string[]
  missingDependencyNames: string[]
  profileDependentNames: string[]
  conflictReason: string | null
  conflictPids: number[]
  startBlockedReason: string | null
  stopBlockedReason: string | null
  restartBlockedReason: string | null
}

type NodeConflictDialogState = {
  serviceId: string
  serviceName: string
  conflictPids: number[]
  message: string
}

type NodeBackupProgressState = {
  action: 'restore-backup' | 'restore-backup-verify'
  phase: KnodelKoinosNodeBackupProgressEvent['phase']
  progress: number
  message: string
  updatedAt: number
}

type NodeBaseDirValidationState = {
  ok: boolean
  baseDir: string
  restoreWorkspaceParent: string
  message: string
}

type NodeBaseDirChangeDialogState = {
  previousBaseDir: string
  nextBaseDir: string
  nodeWasRunning: boolean
}

type BlockRow = {
  height: number
  blockId: string
  previousId: string
  signer: string
  timestampMs: number
}

type HeadSnapshot = {
  id: string
  height: number
  timestampMs: number
}

type NodeProducerActionState = 'register' | null

type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

type JsonRpcResponse<T> = {
  jsonrpc: string
  id: number | string | null
  result?: T
  error?: JsonRpcError
}

type HeadInfoResult = {
  head_topology?: {
    id?: string
    height?: string
  }
  head_block_time?: string
}

type BlockStoreItem = {
  block_id?: string
  block_height?: string
  block?: {
    id?: string
    header?: {
      previous?: string
      height?: string
      timestamp?: string
      signer?: string
    }
  }
}

type BlocksByHeightResult = {
  block_items?: BlockStoreItem[]
}

type AnsiStyleState = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

type AnsiTextSegment = {
  text: string
  style?: CSSProperties
}

const ANSI_BASIC_COLORS = ['#20272b', '#ff6b6b', '#3ddc97', '#f4b35d', '#5aa8ff', '#d88cff', '#58d7e7', '#d9e3e8']
const ANSI_BRIGHT_COLORS = ['#6a7d86', '#ff9b95', '#7cf3be', '#ffd98a', '#90c3ff', '#f0b7ff', '#93effa', '#ffffff']

function safeParseInt(value: string | undefined, fallback = 0): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatDateTime(timestampMs: number, locale: string, emptyLabel: string): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return emptyLabel
  return new Date(timestampMs).toLocaleString(locale)
}

function formatTime(timestampMs: number, locale: string, emptyLabel = ''): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return emptyLabel
  return new Date(timestampMs).toLocaleTimeString(locale)
}

function formatRelativeAge(timestampMs: number, nowMs: number): string {
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

function formatDecimalValue(
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

function formatUsdValue(value: number | null | undefined, locale: string, emptyLabel = 'N/A'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return emptyLabel
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 6
  }).format(value)
}

function shortHash(value: string, head = 12, tail = 8): string {
  if (!value) return 'N/A'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function joinDisplayPath(basePath: string, childPath: string): string {
  const base = basePath.replace(/[\\/]+$/, '')
  const child = childPath.replace(/^\.?[\\/]+/, '')
  if (!base) return childPath
  if (!child) return base
  return `${base}/${child}`
}

function resolveNodeFileDisplayPath(repoPath: string, filePathValue: string): string {
  const raw = filePathValue.trim()
  if (!raw) return ''
  if (raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)) return raw
  return joinDisplayPath(repoPath.trim(), raw)
}

function normalizeRpcUrl(raw: string, language: AppLanguage): string {
  const value = raw.trim()
  if (!value) throw new Error(translate(language, 'rpc.validation.empty'))
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(translate(language, 'rpc.validation.http'))
  }
  return parsed.toString()
}

function normalizeBackupTarGzUrl(raw: string, language: AppLanguage): string {
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

function tryNormalizeHttpUrl(raw: string): string | null {
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

function sanitizeStoredPublicRpcUrls(value: unknown): string[] {
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

function normalizeExplorerRpcSource(
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

function formatRpcDisplayUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function formatExplorerRpcSourceKind(source: ExplorerRpcSource, language: AppLanguage): string {
  return source === LOCAL_RPC_SOURCE ? translate(language, 'rpc.mode.local') : translate(language, 'rpc.mode.public')
}

function formatExplorerRpcSourceTarget(source: ExplorerRpcSource, language: AppLanguage): string {
  return source === LOCAL_RPC_SOURCE ? translate(language, 'rpc.mode.local') : formatRpcDisplayUrl(source)
}

function parsePublicRpcUrlsInput(raw: string, language: AppLanguage): string[] {
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

function formatProducerWalletBalanceError(message: string, rpcUrl: string, language: AppLanguage): string {
  if (/context deadline exceeded|timed out|timeout/i.test(message)) {
    return translate(language, 'producer.signingWalletRpcTimeout', { rpcUrl: formatRpcDisplayUrl(rpcUrl) })
  }

  if (/rpc failed|internal server error/i.test(message)) {
    return translate(language, 'producer.signingWalletRpcError', { rpcUrl: formatRpcDisplayUrl(rpcUrl) })
  }

  return message
}

function loadInitialSettings(): ExplorerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ExplorerSettings>
    const publicRpcUrls = sanitizeStoredPublicRpcUrls((parsed as Partial<ExplorerSettings> & { publicRpcUrls?: unknown }).publicRpcUrls)
    const legacyRpcUrl = typeof (parsed as { rpcUrl?: unknown }).rpcUrl === 'string'
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
      pollMs: clamp(typeof parsed.pollMs === 'number' ? parsed.pollMs : DEFAULT_SETTINGS.pollMs, 1000, 30000),
      rowLimit: clamp(typeof parsed.rowLimit === 'number' ? parsed.rowLimit : DEFAULT_SETTINGS.rowLimit, 5, 50),
      producerAdvancedMode: parsed.producerAdvancedMode === true
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function loadInitialNodeSettings(): NodeManagerSettings {
  try {
    const raw = window.localStorage.getItem(NODE_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NODE_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<NodeManagerSettings>
    return {
      repoPath:
        typeof parsed.repoPath === 'string' && parsed.repoPath.trim()
          ? parsed.repoPath
          : DEFAULT_NODE_SETTINGS.repoPath,
      composeFile:
        typeof parsed.composeFile === 'string' && parsed.composeFile.trim()
          ? parsed.composeFile
          : DEFAULT_NODE_SETTINGS.composeFile,
      envFile:
        typeof parsed.envFile === 'string' && parsed.envFile.trim()
          ? parsed.envFile.trim() === 'env.example'
            ? '.env'
            : parsed.envFile
          : DEFAULT_NODE_SETTINGS.envFile,
      baseDir: normalizeNodeBaseDirInput(
        typeof parsed.baseDir === 'string' && parsed.baseDir.trim() ? parsed.baseDir : DEFAULT_NODE_SETTINGS.baseDir
      ),
      profiles: typeof parsed.profiles === 'string' ? parsed.profiles : DEFAULT_NODE_SETTINGS.profiles,
      blockchainBackupUrl:
        typeof parsed.blockchainBackupUrl === 'string' && parsed.blockchainBackupUrl.trim()
          ? parsed.blockchainBackupUrl
          : DEFAULT_NODE_SETTINGS.blockchainBackupUrl,
      runtimeMode: parsed.runtimeMode === 'native' ? 'native' : DEFAULT_NODE_SETTINGS.runtimeMode
    }
  } catch {
    return { ...DEFAULT_NODE_SETTINGS }
  }
}

function loadInitialLanguage(): AppLanguage {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (raw) return normalizeAppLanguage(raw)
  } catch {
    // ignore
  }

  return detectAppLanguage()
}

function parseProfilesCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeNodeBaseDirInput(value: string): string {
  const trimmed = value.trim() || DEFAULT_NODE_SETTINGS.baseDir
  const normalized = trimmed.replace(/[\\/]+$/, '')
  if (!normalized) return DEFAULT_NODE_SETTINGS.baseDir
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  if (segments.at(-1) === '.koinos') return normalized
  return `${normalized}/.koinos`
}

function toNodeApiSettings(settings: NodeManagerSettings): KnodelKoinosNodeSettings {
  return {
    repoPath: settings.repoPath.trim(),
    composeFile: settings.composeFile.trim(),
    envFile: settings.envFile.trim(),
    baseDir: normalizeNodeBaseDirInput(settings.baseDir),
    profiles: parseProfilesCsv(settings.profiles),
    blockchainBackupUrl: settings.blockchainBackupUrl.trim(),
    runtimeMode: settings.runtimeMode
  }
}

function getKoinosNodeBridge() {
  return window.knodel?.koinosNode
}

function getAppConfigBridge() {
  return window.knodel?.appConfig
}

function getWalletBridge() {
  return window.knodel?.wallet
}

function looksLikeNodeErrorOutput(output: string): boolean {
  return /cannot connect to the docker daemon|spawn docker ENOENT|repo path not found|compose file not found|env file not found|missing config dir|no se pudo consultar docker compose|error consultando docker compose/i.test(
    output
  )
}

function nodeServicePortByTarget(
  service: KnodelKoinosNodeServiceStatus | null | undefined,
  targetPort: number
): KnodelKoinosNodeServicePort | null {
  return service?.ports.find((port) => port.targetPort === targetPort) ?? null
}

function normalizeNodeRpcHost(host: string | null | undefined, fallback = '127.0.0.1'): string {
  const value = host?.trim()
  return value && value !== '0.0.0.0' && value !== '::' ? value : fallback
}

function resolveLocalNodeRpcUrl(nodeStatus: KnodelKoinosNodeStatus | null): string {
  const jsonrpcService = nodeStatus?.services.find((service) => service.id === 'jsonrpc') ?? null
  const jsonrpcPort = nodeServicePortByTarget(jsonrpcService, 8080)
  const host = normalizeNodeRpcHost(jsonrpcPort?.host)
  const port = jsonrpcPort?.publishedPort ?? 8080
  return `http://${host}:${port}/`
}

function resolveExplorerRpcUrl(settings: ExplorerSettings, nodeStatus: KnodelKoinosNodeStatus | null): string {
  if (settings.rpcSource !== LOCAL_RPC_SOURCE) return settings.rpcSource
  return resolveLocalNodeRpcUrl(nodeStatus)
}

function isNodeServiceRunning(service: KnodelKoinosNodeServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

function formatNodeServicePorts(service: KnodelKoinosNodeServiceStatus): string {
  if (!service.ports.length) return '-'
  return service.ports.map((port) => port.label || `${port.targetPort ?? '?'}${port.protocol ? `/${port.protocol}` : ''}`).join(', ')
}

function formatNodeServiceType(service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
  return service.runtimeType === 'native'
    ? translate(language, 'common.runtimeNative')
    : translate(language, 'common.runtimeDocker')
}

function formatNodeServiceVersion(service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
  return service.version?.trim() || translate(language, 'common.unknown')
}

function formatNodeRuntimeMode(mode: KnodelKoinosNodeServiceRuntime, language: AppLanguage): string {
  return mode === 'native' ? translate(language, 'common.runtimeNative') : translate(language, 'common.runtimeDocker')
}

function formatNodeServiceTooltip(
  service: KnodelKoinosNodeServiceStatus,
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

function normalizeStringList(values: string[]): string[] {
  return [...values].map((value) => value.trim()).filter(Boolean).sort()
}

function formatNodeServiceRuntimeDetail(service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
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

function canKillNodeConflict(service: KnodelKoinosNodeServiceStatus): boolean {
  return service.runtimeType === 'native' && service.id !== 'amqp' && service.conflictPids.length > 0
}

function normalizeProfiles(profiles: string[]): string[] {
  return normalizeStringList(profiles)
}

function sameStringList(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeStringList(left)
  const normalizedRight = normalizeStringList(right)
  if (normalizedLeft.length !== normalizedRight.length) return false
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sameProfiles(left: string[], right: string[]): boolean {
  return sameStringList(left, right)
}

function formatPresetProfiles(preset: KnodelKoinosNodePreset, language: AppLanguage): string {
  return preset.profiles.length ? preset.profiles.join(', ') : translate(language, 'common.core')
}

function basenameFromPath(input: string | null): string {
  if (!input) return '-'
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || input
}

function formatNativeBuildSystem(buildSystem: KnodelKoinosNativeBuildSystem | null): string {
  if (buildSystem === 'cmake') return 'CMake'
  if (buildSystem === 'go') return 'Go'
  if (buildSystem === 'yarn') return 'Yarn'
  return '-'
}

function formatNativeBuildStatus(
  build: KnodelKoinosNodeNativeBuildStatus,
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

function formatNativeBuildTooltip(build: KnodelKoinosNodeNativeBuildStatus, language: AppLanguage): string {
  const lines = [translate(language, 'node.buildTooltip.service', { value: build.serviceName })]

  if (build.repoPath) lines.push(translate(language, 'node.buildTooltip.repo', { value: build.repoPath }))
  if (build.artifactPath) lines.push(translate(language, 'node.buildTooltip.artifact', { value: build.artifactPath }))
  if (build.note) lines.push(translate(language, 'node.buildTooltip.note', { value: build.note }))
  if (build.buildCommands.length > 0) {
    lines.push(translate(language, 'node.buildTooltip.build', { value: build.buildCommands.join(' && ') }))
  }

  return lines.join('\n')
}

function xterm256Color(value: number): string {
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

function applyAnsiSgrCodes(current: AnsiStyleState, sgrCodes: number[]): AnsiStyleState {
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

function ansiStyleToCss(styleState: AnsiStyleState): CSSProperties | undefined {
  const style: CSSProperties = {}
  if (styleState.fg) style.color = styleState.fg
  if (styleState.bg) style.backgroundColor = styleState.bg
  if (styleState.bold) style.fontWeight = 700
  if (styleState.dim) style.opacity = 0.78
  if (styleState.italic) style.fontStyle = 'italic'
  if (styleState.underline) style.textDecoration = 'underline'
  return Object.keys(style).length ? style : undefined
}

function parseAnsiTextSegments(input: string): AnsiTextSegment[] {
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

function renderAnsiLog(input: string) {
  return parseAnsiTextSegments(input).map((segment, index) => (
    <span key={`${index}-${segment.text.length}`} className="ansi-log-segment" style={segment.style}>
      {segment.text}
    </span>
  ))
}

async function rpcCall<T>(
  language: AppLanguage,
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<T> {
  const bridge = getKoinosNodeBridge()
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

function mapBlockItem(item: BlockStoreItem): BlockRow | null {
  const header = item.block?.header
  const height = safeParseInt(header?.height ?? item.block_height, 0)
  const blockId = item.block?.id ?? item.block_id ?? ''
  const previousId = header?.previous ?? ''
  const signer = header?.signer ?? ''
  const timestampMs = safeParseInt(header?.timestamp, 0)

  if (!height || !blockId) return null
  return { height, blockId, previousId, signer, timestampMs }
}

async function fetchLatestBlocks(
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

async function fetchHeadSnapshot(
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

export function App() {
  const appVersion = window.knodel?.version?.trim() || '0.2.0'
  const [language, setLanguage] = useState<AppLanguage>(() => loadInitialLanguage())
  const [settings, setSettings] = useState<ExplorerSettings>(() => loadInitialSettings())
  const [nodeSettings, setNodeSettings] = useState<NodeManagerSettings>(() => loadInitialNodeSettings())
  const [rows, setRows] = useState<BlockRow[]>([])
  const [head, setHead] = useState<HeadSnapshot | null>(null)
  const [publicChainHead, setPublicChainHead] = useState<HeadSnapshot | null>(null)
  const [localChainHead, setLocalChainHead] = useState<HeadSnapshot | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [freshBlockIds, setFreshBlockIds] = useState<string[]>([])
  const [draftPublicRpcUrls, setDraftPublicRpcUrls] = useState(settings.publicRpcUrls.join('\n'))
  const [publicRpcConfigLoaded, setPublicRpcConfigLoaded] = useState(() => !Boolean(getAppConfigBridge()?.loadPublicRpcUrls))
  const [draftPollMs, setDraftPollMs] = useState(String(settings.pollMs))
  const [draftRowLimit, setDraftRowLimit] = useState(String(settings.rowLimit))
  const [draftNodeRepoPath, setDraftNodeRepoPath] = useState(nodeSettings.repoPath)
  const [draftNodeComposeFile, setDraftNodeComposeFile] = useState(nodeSettings.composeFile)
  const [draftNodeEnvFile, setDraftNodeEnvFile] = useState(nodeSettings.envFile)
  const [draftNodeBaseDir, setDraftNodeBaseDir] = useState(nodeSettings.baseDir)
  const [draftNodeProfiles, setDraftNodeProfiles] = useState(nodeSettings.profiles)
  const [draftNodeBlockchainBackupUrl, setDraftNodeBlockchainBackupUrl] = useState(nodeSettings.blockchainBackupUrl)
  const [draftNodeRuntimeMode, setDraftNodeRuntimeMode] = useState<KnodelKoinosNodeServiceRuntime>(
    nodeSettings.runtimeMode
  )
  const [nodeBaseDirPickerLoading, setNodeBaseDirPickerLoading] = useState(false)
  const [nodeBaseDirValidationLoading, setNodeBaseDirValidationLoading] = useState(false)
  const [nodeBaseDirValidation, setNodeBaseDirValidation] = useState<NodeBaseDirValidationState | null>(null)
  const [nodeStatus, setNodeStatus] = useState<KnodelKoinosNodeStatus | null>(null)
  const [nodeStatusLoading, setNodeStatusLoading] = useState(false)
  const [nodeActionLoading, setNodeActionLoading] = useState<NodeAction | null>(null)
  const [nodeRestoreBackupLoading, setNodeRestoreBackupLoading] = useState(false)
  const [nodeRestoreBackupVerifyLoading, setNodeRestoreBackupVerifyLoading] = useState(false)
  const [nodeServiceActionLoading, setNodeServiceActionLoading] = useState<NodeServiceActionState | null>(null)
  const [nodeCloneLoading, setNodeCloneLoading] = useState(false)
  const [nodeProducerOverview, setNodeProducerOverview] = useState<KnodelKoinosNodeProducerOverviewResult | null>(null)
  const [nodeProducerLoading, setNodeProducerLoading] = useState(false)
  const [nodeProducerError, setNodeProducerError] = useState<string | null>(null)
  const [nodeProducerActionLoading, setNodeProducerActionLoading] = useState<NodeProducerActionState>(null)
  const [nodeProducerAddressDraft, setNodeProducerAddressDraft] = useState('')
  const [producerUnlockPassword, setProducerUnlockPassword] = useState('')
  const [nodePresets, setNodePresets] = useState<KnodelKoinosNodePreset[]>([])
  const [nodePresetsLoading, setNodePresetsLoading] = useState(false)
  const [nodePresetsError, setNodePresetsError] = useState<string | null>(null)
  const [nodePresetActionLoading, setNodePresetActionLoading] = useState<string | null>(null)
  const [nodeNativeBuilds, setNodeNativeBuilds] = useState<KnodelKoinosNodeNativeBuildsResult | null>(null)
  const [nodeNativeBuildsLoading, setNodeNativeBuildsLoading] = useState(false)
  const [nodeNativeBuildsError, setNodeNativeBuildsError] = useState<string | null>(null)
  const [nodeNativeBuildActionLoading, setNodeNativeBuildActionLoading] = useState<NodeNativeBuildActionState | null>(
    null
  )
  const [nodeOutput, setNodeOutput] = useState<string>('')
  const [nodeError, setNodeError] = useState<string | null>(null)
  const [nodeFileEditorOpen, setNodeFileEditorOpen] = useState(false)
  const [nodeFileEditorKind, setNodeFileEditorKind] = useState<NodeManagedFileKind>('compose')
  const [nodeFileEditorPath, setNodeFileEditorPath] = useState('')
  const [nodeFileEditorContent, setNodeFileEditorContent] = useState('')
  const [nodeFileEditorLoading, setNodeFileEditorLoading] = useState(false)
  const [nodeFileEditorSaving, setNodeFileEditorSaving] = useState(false)
  const [nodeFileEditorError, setNodeFileEditorError] = useState<string | null>(null)
  const [nodeFileEditorLastSavedAt, setNodeFileEditorLastSavedAt] = useState<number | null>(null)
  const [nodeBackupProgress, setNodeBackupProgress] = useState<NodeBackupProgressState | null>(null)
  const [nodeLogsService, setNodeLogsService] = useState<string>('')
  const [nodeLogsTail, setNodeLogsTail] = useState<string>('200')
  const [nodeLogsOutput, setNodeLogsOutput] = useState<string>('')
  const [nodeLogsLoading, setNodeLogsLoading] = useState(false)
  const [nodeLogsError, setNodeLogsError] = useState<string | null>(null)
  const [nodeLogsModalOpen, setNodeLogsModalOpen] = useState(false)
  const [nodeLogsLastRefreshAt, setNodeLogsLastRefreshAt] = useState<number | null>(null)
  const [nodeLogsStreamId, setNodeLogsStreamId] = useState<string | null>(null)
  const [nodeServiceContextMenu, setNodeServiceContextMenu] = useState<NodeServiceContextMenuState | null>(null)
  const [nodeConflictDialog, setNodeConflictDialog] = useState<NodeConflictDialogState | null>(null)
  const [nodeConflictKillLoading, setNodeConflictKillLoading] = useState<string | null>(null)
  const [nodeBaseDirChangeDialog, setNodeBaseDirChangeDialog] = useState<NodeBaseDirChangeDialogState | null>(null)
  const [nodeBaseDirCopyLoading, setNodeBaseDirCopyLoading] = useState(false)
  const [nodeBaseDirRestartLoading, setNodeBaseDirRestartLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('explorer')
  const [nodeProfilesModalOpen, setNodeProfilesModalOpen] = useState(false)
  const [walletOverview, setWalletOverview] = useState<KnodelWalletOverviewResult | null>(null)
  const [producerSigningWalletBalance, setProducerSigningWalletBalance] = useState<KnodelWalletBalanceResult | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [producerSigningWalletBalanceLoading, setProducerSigningWalletBalanceLoading] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [producerSigningWalletBalanceError, setProducerSigningWalletBalanceError] = useState<string | null>(null)
  const [walletActionLoading, setWalletActionLoading] = useState<string | null>(null)
  const [walletResultTitle, setWalletResultTitle] = useState('')
  const [walletResultData, setWalletResultData] = useState<unknown>(null)
  const [walletImportPrivateKey, setWalletImportPrivateKey] = useState('')
  const [walletImportPassword, setWalletImportPassword] = useState('')
  const [walletBurnPercentDraft, setWalletBurnPercentDraft] = useState('95')
  const [walletBurnAmountDraft, setWalletBurnAmountDraft] = useState('')
  const [walletBurnDryRun, setWalletBurnDryRun] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const rowsRef = useRef<BlockRow[]>([])
  const nodeOutputRef = useRef(nodeOutput)
  const nodeLogsStreamIdRef = useRef<string | null>(null)
  const nodeLogsPreRef = useRef<HTMLPreElement | null>(null)
  const nodeRepoBootstrapAttemptsRef = useRef<Set<string>>(new Set())
  const locale = localeForLanguage(language)
  const t = useMemo(() => {
    return (key: string, values?: Record<string, string | number>) => translate(language, key, values)
  }, [language])
  const hasNodeControls = Boolean(getKoinosNodeBridge())
  const hasWalletControls = Boolean(getWalletBridge())
  const composeFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, draftNodeComposeFile)
  const envFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, draftNodeEnvFile)
  const configFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, 'config/config.yml')

  useEffect(() => {
    setDraftPublicRpcUrls(settings.publicRpcUrls.join('\n'))
    setDraftPollMs(String(settings.pollMs))
    setDraftRowLimit(String(settings.rowLimit))
  }, [settings.publicRpcUrls, settings.pollMs, settings.rowLimit])

  useEffect(() => {
    const bridge = getAppConfigBridge()
    if (!bridge?.loadPublicRpcUrls) {
      setPublicRpcConfigLoaded(true)
      return
    }

    let disposed = false
    void bridge.loadPublicRpcUrls()
      .then((result) => {
        if (disposed || !result.ok || result.publicRpcUrls.length === 0) return
        setSettings((current) => ({
          ...current,
          publicRpcUrls: result.publicRpcUrls,
          rpcSource: normalizeExplorerRpcSource(current.rpcSource, result.publicRpcUrls, current.rpcSource)
        }))
      })
      .finally(() => {
        if (!disposed) setPublicRpcConfigLoaded(true)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    setDraftNodeRepoPath(nodeSettings.repoPath)
    setDraftNodeComposeFile(nodeSettings.composeFile)
    setDraftNodeEnvFile(nodeSettings.envFile)
    setDraftNodeBaseDir(nodeSettings.baseDir)
    setDraftNodeProfiles(nodeSettings.profiles)
    setDraftNodeBlockchainBackupUrl(nodeSettings.blockchainBackupUrl)
    setDraftNodeRuntimeMode(nodeSettings.runtimeMode)
    setNodeBaseDirValidation(null)
  }, [nodeSettings])

  useEffect(() => {
    if (!settings.producerAdvancedMode) return
    if (nodeProducerAddressDraft.trim()) return
    const nextAddress = nodeProducerOverview?.producerAddress?.trim() || ''
    if (nextAddress) {
      setNodeProducerAddressDraft(nextAddress)
    }
  }, [settings.producerAdvancedMode, nodeProducerOverview, nodeProducerAddressDraft])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const bridge = getAppConfigBridge()
    if (!publicRpcConfigLoaded || !bridge?.savePublicRpcUrls) return
    void bridge.savePublicRpcUrls({ publicRpcUrls: settings.publicRpcUrls })
  }, [publicRpcConfigLoaded, settings.publicRpcUrls])

  useEffect(() => {
    window.localStorage.setItem(NODE_SETTINGS_STORAGE_KEY, JSON.stringify(nodeSettings))
  }, [nodeSettings])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  const effectiveExplorerRpcUrl = useMemo(
    () => resolveExplorerRpcUrl(settings, nodeStatus),
    [settings, nodeStatus]
  )
  const primaryPublicRpcUrl = settings.publicRpcUrls[0] ?? DEFAULT_PUBLIC_RPC_URLS[0]
  const localNodeRpcUrl = useMemo(() => resolveLocalNodeRpcUrl(nodeStatus), [nodeStatus])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!freshBlockIds.length) return
    const timer = window.setTimeout(() => setFreshBlockIds([]), 1400)
    return () => window.clearTimeout(timer)
  }, [freshBlockIds])

  useEffect(() => {
    const services = nodeStatus?.services.map((svc) => svc.id) ?? []
    if (nodeLogsService && !services.includes(nodeLogsService)) {
      setNodeLogsService(services.includes('jsonrpc') ? 'jsonrpc' : '')
      setNodeLogsModalOpen(false)
    }
  }, [nodeStatus, nodeLogsService])

  useEffect(() => {
    if (activeTab !== 'producer') return
    if (!hasNodeControls) return
    void refreshNodeProducerOverview()
  }, [
    activeTab,
    hasNodeControls,
    nodeSettings.repoPath,
    nodeSettings.baseDir,
    nodeSettings.runtimeMode,
    nodeSettings.profiles,
    nodeStatus?.runningServices,
    settings.producerAdvancedMode,
    walletOverview?.walletAddress
  ])

  useEffect(() => {
    if (activeTab !== 'producer') return
    if (!getWalletBridge()) return
    void refreshWalletOverview()
  }, [activeTab, effectiveExplorerRpcUrl])

  useEffect(() => {
    if (activeTab !== 'producer') return
    const signingWalletAddress = walletOverview?.walletAddress?.trim() || ''
    if (!signingWalletAddress) {
      setProducerSigningWalletBalance(null)
      setProducerSigningWalletBalanceError(null)
      setProducerSigningWalletBalanceLoading(false)
      return
    }
    void refreshProducerSigningWalletBalance(signingWalletAddress)
  }, [activeTab, primaryPublicRpcUrl, walletOverview?.walletAddress])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (nodeServiceContextMenu) {
        setNodeServiceContextMenu(null)
        return
      }
      if (nodeFileEditorOpen) {
        setNodeFileEditorOpen(false)
        return
      }
      if (nodeLogsModalOpen) {
        setNodeLogsModalOpen(false)
        return
      }
      if (nodeProfilesModalOpen) {
        setNodeProfilesModalOpen(false)
        return
      }
      if (nodeConflictDialog) {
        setNodeConflictDialog(null)
        return
      }
      if (nodeBaseDirChangeDialog) {
        setNodeBaseDirChangeDialog(null)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [nodeServiceContextMenu, nodeFileEditorOpen, nodeLogsModalOpen, nodeProfilesModalOpen, nodeConflictDialog, nodeBaseDirChangeDialog])

  useEffect(() => {
    nodeLogsStreamIdRef.current = nodeLogsStreamId
  }, [nodeLogsStreamId])

  useEffect(() => {
    nodeOutputRef.current = nodeOutput
  }, [nodeOutput])

  useEffect(() => {
    if (!nodeLogsModalOpen) return
    const pre = nodeLogsPreRef.current
    if (!pre) return
    const frame = window.requestAnimationFrame(() => {
      pre.scrollTop = pre.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nodeLogsModalOpen, nodeLogsOutput])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getKoinosNodeBridge()
    if (!bridge?.onLogsFollowEvent) return

    const unsubscribe = bridge.onLogsFollowEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as KnodelKoinosNodeLogsFollowEvent
      if (!payload.streamId || payload.streamId !== nodeLogsStreamIdRef.current) return

      if (payload.type === 'start') {
        setNodeLogsLoading(false)
        setNodeLogsError(null)
        setNodeLogsLastRefreshAt(Date.now())
        return
      }

      if (payload.type === 'chunk') {
        const chunk = payload.chunk ?? ''
        if (chunk) {
          setNodeLogsOutput((current) => current + chunk)
        }
        setNodeLogsLoading(false)
        setNodeLogsLastRefreshAt(Date.now())
        return
      }

      if (payload.type === 'error') {
        setNodeLogsLoading(false)
        setNodeLogsError(payload.message || t('node.logsStreamError'))
        setNodeLogsStreamId(null)
        return
      }

      if (payload.type === 'end') {
        setNodeLogsLoading(false)
        setNodeLogsStreamId(null)
        if (typeof payload.code === 'number' && payload.code !== 0) {
          setNodeLogsError(t('node.logsStreamEnded', { code: payload.code }))
        }
      }
    })

    return unsubscribe
  }, [hasNodeControls, t])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getKoinosNodeBridge()
    if (!bridge?.onBackupProgressEvent) return

    const unsubscribe = bridge.onBackupProgressEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as KnodelKoinosNodeBackupProgressEvent
      if (!payload.action || typeof payload.progress !== 'number') return

      setNodeBackupProgress({
        action: payload.action,
        phase: payload.phase,
        progress: payload.progress,
        message: payload.message || '',
        updatedAt: Date.now()
      })

      if (payload.phase === 'complete') {
        window.setTimeout(() => {
          setNodeBackupProgress((current) =>
            current?.action === payload.action && current.phase === payload.phase ? null : current
          )
        }, 2500)
      }
    })

    return unsubscribe
  }, [hasNodeControls])

  useEffect(() => {
    if (!hasNodeControls) return

    let disposed = false

    const loadNodePresets = async () => {
      const bridge = getKoinosNodeBridge()
      if (!bridge?.presets) return
      setNodePresetsLoading(true)
      setNodePresetsError(null)
      try {
        const result = await bridge.presets(toNodeApiSettings(nodeSettings))
        if (disposed) return
        setNodePresets(result.presets ?? [])
        if (!result.ok) setNodePresetsError(result.output || t('node.unableReadProfiles'))
      } catch (error) {
        if (disposed) return
        setNodePresetsError(error instanceof Error ? error.message : t('node.unableReadProfiles'))
      } finally {
        if (!disposed) setNodePresetsLoading(false)
      }
    }

    const loadInitialNodeStatus = async () => {
      const bridge = getKoinosNodeBridge()
      if (!bridge) return
      setNodeStatusLoading(true)
      try {
        const status = await bridge.status(toNodeApiSettings(nodeSettings))
        if (disposed) return
        syncNodeStatusState(status)

        if (!status.ok && /repo path not found/i.test(status.output || '')) {
          const repoKey = nodeSettings.repoPath.trim()
          if (repoKey && !nodeRepoBootstrapAttemptsRef.current.has(repoKey)) {
            nodeRepoBootstrapAttemptsRef.current.add(repoKey)
            void cloneKoinosRepo(repoKey)
          }
        }
      } catch (error) {
        if (disposed) return
        setNodeError(error instanceof Error ? error.message : t('node.unableQueryNode'))
      } finally {
        if (!disposed) setNodeStatusLoading(false)
      }
    }

    void loadNodePresets()
    void loadInitialNodeStatus()

    return () => {
      disposed = true
    }
  }, [hasNodeControls, nodeSettings, t])

  useEffect(() => {
    if (!hasNodeControls) return

    let disposed = false

    const loadNativeBuilds = async () => {
      const bridge = getKoinosNodeBridge()
      if (!bridge?.nativeBuilds) return
      setNodeNativeBuildsLoading(true)
      setNodeNativeBuildsError(null)

      try {
        const builds = await bridge.nativeBuilds()
        if (disposed) return
        setNodeNativeBuilds(builds)
        if (!builds.ok) {
          setNodeNativeBuildsError(builds.output || t('node.unableInspectNativeWorkspace'))
        }
      } catch (error) {
        if (disposed) return
        setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.unableInspectNativeWorkspace'))
      } finally {
        if (!disposed) setNodeNativeBuildsLoading(false)
      }
    }

    void loadNativeBuilds()

    return () => {
      disposed = true
    }
  }, [hasNodeControls, t])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getKoinosNodeBridge()
    if (!bridge) return

    let disposed = false
    const timer = window.setInterval(async () => {
      if (
        disposed ||
        nodeActionLoading ||
        nodeRestoreBackupLoading ||
        nodeServiceActionLoading ||
        nodePresetActionLoading ||
        nodeNativeBuildActionLoading
      )
        return
      try {
        const status = await bridge.status(toNodeApiSettings(nodeSettings))
        if (disposed) return
        syncNodeStatusState(status, { preserveOutputOnSuccess: true })
      } catch {
        // keep last known status; manual refresh/start/stop will surface error
      }
    }, 6000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [
    hasNodeControls,
    nodeSettings,
    nodeActionLoading,
    nodeRestoreBackupLoading,
    nodeServiceActionLoading,
    nodePresetActionLoading,
    nodeNativeBuildActionLoading
  ])

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pollTimer: number | null = null
    let controller: AbortController | null = null

    const tick = async (initial: boolean) => {
      if (disposed || inFlight) return
      inFlight = true
      controller = new AbortController()

      if (initial) setIsInitialLoading(true)
      else setIsRefreshing(true)

      try {
        const snapshot = await fetchLatestBlocks(language, effectiveExplorerRpcUrl, settings.rowLimit, controller.signal)
        if (disposed) return

        const previousIds = new Set(rowsRef.current.map((row) => row.blockId))
        const incomingFresh = snapshot.rows
          .filter((row) => !previousIds.has(row.blockId))
          .map((row) => row.blockId)

        rowsRef.current = snapshot.rows
        setRows(snapshot.rows)
        setHead(snapshot.head)
        setLastSuccessAt(Date.now())
        setErrorMessage(null)
        setFreshBlockIds(incomingFresh.slice(0, 3))
      } catch (error) {
        if (disposed) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setErrorMessage(error instanceof Error ? error.message : t('status.connectionError'))
      } finally {
        if (!disposed) {
          setIsInitialLoading(false)
          setIsRefreshing(false)
        }
        inFlight = false
      }
    }

    void tick(true)
    pollTimer = window.setInterval(() => {
      void tick(false)
    }, settings.pollMs)

    return () => {
      disposed = true
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [settings, effectiveExplorerRpcUrl, language, t])

  const statusText = useMemo(() => {
    if (errorMessage) return t('status.rpcError', { message: errorMessage })
    if (isInitialLoading) {
      return t('status.connectingTo', { target: formatExplorerRpcSourceTarget(settings.rpcSource, language) })
    }
    if (isRefreshing) return t('status.updatingBlocks')
    return t('status.liveBlocksVisible', { count: rows.length })
  }, [errorMessage, isInitialLoading, isRefreshing, language, rows.length, settings.rpcSource, t])

  const lastUpdateText = lastSuccessAt ? formatTime(lastSuccessAt, locale, t('common.na')) : t('common.na')
  const headBlockTimeText = head ? formatDateTime(head.timestampMs, locale, t('common.na')) : t('common.na')
  const nodeBusy =
    nodeActionLoading !== null ||
    nodeRestoreBackupLoading ||
    nodeRestoreBackupVerifyLoading ||
    nodeCloneLoading ||
    nodeBaseDirPickerLoading ||
    nodeBaseDirCopyLoading ||
    nodeBaseDirRestartLoading ||
    nodeServiceActionLoading !== null ||
    nodeConflictKillLoading !== null ||
    nodePresetActionLoading !== null ||
    nodeNativeBuildActionLoading !== null
  const nodeRuntimeMode = nodeStatus?.runtimeMode ?? nodeSettings.runtimeMode
  const nodeCurrentProfiles = parseProfilesCsv(nodeSettings.profiles)
  const selectedNodePreset =
    nodePresets.find((preset) => sameProfiles(preset.profiles, nodeCurrentProfiles)) ?? null
  const nodeNativeBuildServices = nodeNativeBuilds?.services ?? []
  const nodeNativeSupportedCount = nodeNativeBuildServices.filter((service) => service.supported).length
  const nodeNativeBuiltCount = nodeNativeBuildServices.filter(
    (service) => service.supported && service.artifactExists
  ).length
  const nodeNativeBlockedCount = nodeNativeBuildServices.filter(
    (service) => service.supported && !service.artifactExists && !service.buildable
  ).length
  const nodeNativePendingCount = nodeNativeBuildServices.filter(
    (service) => service.supported && !service.artifactExists && service.buildable
  ).length
  const nodeNativeBuildSummaryText = nodeNativeBuilds
    ? t('node.nativeBuild.summary', {
        built: nodeNativeBuiltCount,
        supported: nodeNativeSupportedCount,
        blocked:
          nodeNativeBlockedCount > 0 ? t('node.nativeBuild.blockedSuffix', { count: nodeNativeBlockedCount }) : '',
        pending:
          nodeNativePendingCount > 0 ? t('node.nativeBuild.pendingSuffix', { count: nodeNativePendingCount }) : ''
      })
    : nodeNativeBuildsLoading
      ? t('node.nativeBuild.inspecting')
      : t('node.nativeBuild.noState')
  const nodeServices = nodeStatus?.services ?? []
  const nodeServiceById = useMemo(
    () => new Map(nodeServices.map((service) => [service.id, service] as const)),
    [nodeServices]
  )
  const nodeProfileDependentsByServiceId = useMemo(() => {
    const dependents = new Map<string, KnodelKoinosNodeServiceStatus[]>()

    for (const service of nodeServices) {
      for (const dependencyId of service.dependsOn) {
        const current = dependents.get(dependencyId)
        if (current) current.push(service)
        else dependents.set(dependencyId, [service])
      }
    }

    return dependents
  }, [nodeServices])
  const nodeServiceCapabilities = useMemo(() => {
    const capabilities = new Map<string, NodeServiceCapabilities>()
    const serviceLabel = (serviceId: string) => nodeServiceById.get(serviceId)?.name ?? serviceId

    for (const service of nodeServices) {
      const running = isNodeServiceRunning(service)
      const conflictReason =
        service.state === 'conflict' ? service.lastError || t('node.serviceConflictNative') : null
      const restartRequiredReason =
        service.state === 'restart required'
          ? service.lastError || t('node.serviceRestartRequired')
          : null
      const dependencyNames = service.dependsOn.map(serviceLabel)
      const missingDependencyNames = service.dependsOn
        .filter((dependencyId) => {
          const dependency = nodeServiceById.get(dependencyId)
          return !dependency || !isNodeServiceRunning(dependency)
        })
        .map(serviceLabel)
      const profileDependentNames = (nodeProfileDependentsByServiceId.get(service.id) ?? []).map(
        (dependent) => dependent.name
      )

      capabilities.set(service.id, {
        running,
        dependencyNames,
        missingDependencyNames,
        profileDependentNames,
        conflictReason: conflictReason || restartRequiredReason,
        conflictPids: service.conflictPids ?? [],
        startBlockedReason:
          conflictReason ||
          (restartRequiredReason
            ? t('node.serviceRestartUseRestart', { reason: restartRequiredReason })
            : null) ||
          (running
            ? t('node.serviceAlreadyActive')
            : missingDependencyNames.length > 0
              ? t('node.inactiveDependencies', { services: missingDependencyNames.join(', ') })
              : null),
        stopBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : !running
            ? t('node.serviceAlreadyStopped')
            : profileDependentNames.length > 0
              ? t('node.profileDependentServices', { services: profileDependentNames.join(', ') })
              : null),
        restartBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : null) ||
          (!running && missingDependencyNames.length > 0
            ? t('node.inactiveDependencies', { services: missingDependencyNames.join(', ') })
            : null)
      })
    }

    return capabilities
  }, [nodeProfileDependentsByServiceId, nodeServiceById, nodeServices])
  const nodeRunningServiceIds = useMemo(
    () => nodeServices.filter((service) => isNodeServiceRunning(service)).map((service) => service.id),
    [nodeServices]
  )
  const nodeContextService = nodeServiceContextMenu
    ? nodeServices.find((service) => service.id === nodeServiceContextMenu.serviceId) ?? null
    : null
  const nodeLogsTargetService = nodeLogsService ? nodeServiceById.get(nodeLogsService) ?? null : null
  const nodeContextServiceCapabilities = nodeContextService
    ? nodeServiceCapabilities.get(nodeContextService.id) ?? null
    : null
  const nodeServiceCount = nodeServices.length
  const nodeRunningCount = nodeStatus?.runningServices ?? 0
  const nodeStoppedServices = nodeServices.filter((service) => !isNodeServiceRunning(service))
  const nodeHasStoppedServices = nodeStoppedServices.length > 0
  const nodeHasPartialOutage = nodeRunningCount > 0 && nodeHasStoppedServices
  const selectedNodePresetMatchesRunningState = selectedNodePreset
    ? sameStringList(selectedNodePreset.services, nodeRunningServiceIds)
    : false
  const nodePresetSummaryText = selectedNodePreset
    ? t('node.presetSummarySelected', {
        label: selectedNodePreset.label,
        count: selectedNodePreset.services.length,
        pending: selectedNodePresetMatchesRunningState ? '' : t('node.presetSummaryPendingSuffix')
      })
    : t('node.presetSummaryCustom', {
        profiles: nodeCurrentProfiles.length ? nodeCurrentProfiles.join(', ') : t('common.core')
      })
  const nodeStateText = !hasNodeControls
    ? t('status.electronOnly')
    : nodeCloneLoading
      ? t('status.syncingRepo')
    : nodeRestoreBackupLoading
      ? t('status.restoringBackup')
    : nodeNativeBuildActionLoading
      ? nodeNativeBuildActionLoading === 'all'
        ? t('status.compilingNativeAll')
        : t('status.compilingNativeService', { service: nodeNativeBuildActionLoading })
    : nodeStatusLoading
      ? t('status.checkingNode')
    : nodePresetActionLoading
        ? t('status.applyingProfile')
      : nodeActionLoading
        ? nodeActionLoading === 'start'
          ? t('status.startingNode')
          : t('status.stoppingNode')
        : nodeStatus
          ? nodeHasPartialOutage
            ? t('status.degraded', { running: nodeRunningCount, total: nodeServiceCount })
            : nodeRunningCount > 0
              ? t('status.running', { running: nodeRunningCount, total: nodeServiceCount })
              : nodeStatus.ok
                ? t('status.stopped')
                : t('status.error')
          : t('status.noState')
  const nodeStatusClass = nodeError || nodeHasPartialOutage ? 'is-error' : nodeRunningCount > 0 ? 'is-live' : 'is-idle'
  const syncGapBlocks =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.height - localChainHead.height) : null
  const syncGapTimeMs =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.timestampMs - localChainHead.timestampMs) : null
  const showChainSyncProgress = Boolean(
    nodeRunningCount > 0 &&
      publicChainHead &&
      localChainHead &&
      ((syncGapBlocks ?? 0) > SYNC_GAP_BLOCK_THRESHOLD || (syncGapTimeMs ?? 0) > SYNC_GAP_TIME_THRESHOLD_MS)
  )
  const chainSyncPercent = showChainSyncProgress && publicChainHead
    ? clamp((localChainHead!.height / publicChainHead.height) * 100, 0, 100)
    : null
  const walletResultText = walletResultData ? JSON.stringify(walletResultData, null, 2) : ''
  const producerVaultExists = Boolean(walletOverview?.walletExists)
  const producerVaultUnlocked = Boolean(walletOverview?.unlocked)
  const producerUnlockRequired = producerVaultExists && !producerVaultUnlocked
  const producerWalletReady = producerVaultExists && producerVaultUnlocked
  const producerAdvancedMode = settings.producerAdvancedMode
  const signingWalletAddress = walletOverview?.walletAddress?.trim() || ''
  const draftedProducerAddress = nodeProducerAddressDraft.trim()
  const signingWalletManaValue = producerSigningWalletBalance?.mana
    ? Number.parseFloat(producerSigningWalletBalance.mana)
    : null
  const effectiveProducerTargetAddress = producerAdvancedMode
    ? draftedProducerAddress || nodeProducerOverview?.producerAddress?.trim() || ''
    : signingWalletAddress || nodeProducerOverview?.producerAddress?.trim() || ''
  const signingWalletHasRegistrationMana =
    signingWalletManaValue !== null && Number.isFinite(signingWalletManaValue) ? signingWalletManaValue >= 0.5 : null
  const producerAndSigningWalletMatch =
    Boolean(effectiveProducerTargetAddress && signingWalletAddress) &&
    effectiveProducerTargetAddress.toLowerCase() === signingWalletAddress.toLowerCase()
  const producerRegistrationStatusText = (() => {
    switch (nodeProducerOverview?.registrationStatus) {
      case 'match':
        return t('producer.status.match')
      case 'mismatch':
        return t('producer.status.mismatch')
      case 'unregistered':
        return t('producer.status.unregistered')
      case 'missing-local-key':
        return t('producer.status.missingLocalKey')
      case 'missing-address':
      default:
        return t('producer.status.missingAddress')
    }
  })()
  const producerAddressSourceText = (() => {
    if (!producerAdvancedMode) {
      if (signingWalletAddress) return t('producer.source.vault')
      if (nodeProducerOverview?.producerAddress?.trim()) return t('producer.source.config')
      return t('producer.source.walletMissing')
    }
    if (draftedProducerAddress) {
      return t('producer.source.draft')
    }
    switch (nodeProducerOverview?.producerAddressSource) {
      case 'config':
        return t('producer.source.config')
      default:
        return t('producer.source.none')
    }
  })()
  const producerSigningWalletStatusText = (() => {
    if (!signingWalletAddress) return t('producer.signingWalletMissing')
    if (producerSigningWalletBalanceLoading) return t('common.loading')
    if (producerSigningWalletBalanceError) return producerSigningWalletBalanceError
    if (signingWalletHasRegistrationMana === null) return t('producer.signingWalletManaUnknown')
    return signingWalletHasRegistrationMana
      ? t('producer.signingWalletManaReady')
      : t('producer.signingWalletManaLow')
  })()
  const producerSigningWalletRelationText = signingWalletAddress
    ? producerAndSigningWalletMatch
      ? t('producer.signingWalletSame')
      : t('producer.signingWalletDifferent')
    : t('producer.signingWalletMissing')
  const producerRegisterHintText = (() => {
    if (!producerVaultExists) return t('producer.registerNeedsSigningWallet')
    if (!producerVaultUnlocked) return t('producer.registerNeedsUnlock')
    if (!effectiveProducerTargetAddress) return t('producer.registerNeedsAddress')
    if (!nodeProducerOverview?.localPublicKey) return t('producer.registerNeedsLocalKey')
    if (producerSigningWalletBalanceLoading) return t('common.loading')
    if (producerSigningWalletBalanceError) return producerSigningWalletBalanceError
    if (signingWalletHasRegistrationMana === false) return t('producer.registerNeedsMana')
    return t('producer.registerHint')
  })()
  const producerRegisterDisabled =
    !hasNodeControls ||
    nodeProducerActionLoading !== null ||
    nodeProducerLoading ||
    !producerWalletReady ||
    !effectiveProducerTargetAddress ||
    !nodeProducerOverview?.localPublicKey ||
    signingWalletHasRegistrationMana === false
  const producerRegisterHintClass =
    producerSigningWalletBalanceLoading
      ? 'is-busy'
      : producerRegisterDisabled
        ? 'is-error'
        : signingWalletHasRegistrationMana === true
          ? 'is-ok'
          : ''
  const chainSyncPercentLabel = chainSyncPercent === null
    ? ''
    : chainSyncPercent >= 99
      ? chainSyncPercent.toFixed(2)
      : chainSyncPercent >= 90
        ? chainSyncPercent.toFixed(1)
        : chainSyncPercent.toFixed(0)
  const footerStatusClass = !hasNodeControls
    ? errorMessage
      ? 'is-error'
      : 'is-idle'
    : nodeStatusClass
  const footerStatusText = !hasNodeControls
    ? statusText
    : showChainSyncProgress
      ? t('status.syncingChain')
      : nodeRunningCount > 0 && !nodeHasPartialOutage
        ? t('status.live')
        : nodeStateText
  const footerStatusMeta = showChainSyncProgress && publicChainHead && localChainHead
    ? t('status.syncProgress', {
        current: localChainHead.height.toLocaleString(locale),
        target: publicChainHead.height.toLocaleString(locale),
        percent: chainSyncPercentLabel
      })
    : null
  const hasAppOverlayOpen =
    nodeProfilesModalOpen ||
    nodeLogsModalOpen ||
    nodeFileEditorOpen ||
    nodeConflictDialog !== null ||
    nodeBaseDirChangeDialog !== null

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let pollTimer: number | null = null
    const pollMs = Math.max(5000, Math.min(settings.pollMs, 15000))
    const shouldQueryLocalHead =
      hasNodeControls &&
      (nodeRunningCount > 0 ||
        nodeStatusLoading ||
        nodeActionLoading === 'start' ||
        nodeRestoreBackupLoading ||
        nodeRestoreBackupVerifyLoading)

    const tick = async () => {
      controller?.abort()
      controller = new AbortController()

      try {
        const [nextPublicHead, nextLocalHead] = await Promise.all([
          fetchHeadSnapshot(language, primaryPublicRpcUrl, controller.signal).catch(() => null),
          shouldQueryLocalHead
            ? fetchHeadSnapshot(language, localNodeRpcUrl, controller.signal).catch(() => null)
            : Promise.resolve<HeadSnapshot | null>(null)
        ])

        if (disposed) return
        setPublicChainHead(nextPublicHead)
        setLocalChainHead(nextLocalHead)
      } catch {
        if (disposed) return
      }
    }

    void tick()
    pollTimer = window.setInterval(() => {
      void tick()
    }, pollMs)

    return () => {
      disposed = true
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [
    hasNodeControls,
    language,
    localNodeRpcUrl,
    nodeActionLoading,
    nodeRestoreBackupLoading,
    nodeRestoreBackupVerifyLoading,
    nodeRunningCount,
    nodeStatusLoading,
    primaryPublicRpcUrl,
    settings.pollMs
  ])

  const syncNodeStatusState = (
    status: KnodelKoinosNodeStatus,
    options?: { preserveOutputOnSuccess?: boolean }
  ) => {
    setNodeStatus(status)

    if (status.ok) {
      setNodeError(null)
      if (!options?.preserveOutputOnSuccess || looksLikeNodeErrorOutput(nodeOutputRef.current)) {
        setNodeOutput('')
      }
      return
    }

    const output = status.output || t('node.unableQueryNode')
    setNodeError(output)
    setNodeOutput(output)
  }

  const refreshNodeStatus = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge) return
    const effectiveSettings = settingsOverride ?? nodeSettings
    setNodeStatusLoading(true)
    setNodeError(null)
    try {
      const status = await bridge.status(toNodeApiSettings(effectiveSettings))
      syncNodeStatusState(status)
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableQueryNode'))
    } finally {
      setNodeStatusLoading(false)
    }
  }

  const refreshNodeNativeBuilds = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.nativeBuilds) return
    setNodeNativeBuildsLoading(true)
    setNodeNativeBuildsError(null)
    try {
      const builds = await bridge.nativeBuilds()
      setNodeNativeBuilds(builds)
      if (!builds.ok) {
        setNodeNativeBuildsError(builds.output || t('node.unableInspectNativeWorkspace'))
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.unableInspectNativeWorkspace'))
    } finally {
      setNodeNativeBuildsLoading(false)
    }
  }

  const switchNodeRuntimeMode = (runtimeMode: KnodelKoinosNodeServiceRuntime) => {
    const nextSettings = { ...nodeSettings, runtimeMode }
    setNodeSettings(nextSettings)
    setDraftNodeRuntimeMode(runtimeMode)
    setNodeError(null)
    setNodeOutput(t('node.runtimeSelected', { runtime: formatNodeRuntimeMode(runtimeMode, language) }))
    void refreshNodeStatus(nextSettings)
  }

  const applyNodePreset = (preset: KnodelKoinosNodePreset) => {
    const nextProfiles = preset.profiles.join(',')
    const nextSettings = { ...nodeSettings, profiles: nextProfiles }
    setNodeSettings(nextSettings)
    setDraftNodeProfiles(nextProfiles)
    setFormError(null)
    setNodeError(null)
    setNodeOutput(
      t('node.profileSelected', {
        label: preset.label,
        profiles: formatPresetProfiles(preset, language)
      })
    )
    void refreshNodeStatus(nextSettings)
  }

  const reconcileNodePreset = async (preset: KnodelKoinosNodePreset) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.presetReconcile) return

    setNodePresetActionLoading(preset.id)
    setNodeServiceContextMenu(null)
    setNodeError(null)

    try {
      const result = await bridge.presetReconcile({
        ...toNodeApiSettings(nodeSettings),
        presetId: preset.id
      })

      const nextProfiles = preset.profiles.join(',')
      const nextSettings = { ...nodeSettings, profiles: nextProfiles }

      setNodeSettings(nextSettings)
      setDraftNodeProfiles(nextProfiles)
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableApplyProfile', { label: preset.label }))
      } else {
        setNodeError(null)
      }

      if (nodeLogsModalOpen && nodeLogsService) {
        const logsServiceStillRunning = result.status.services.some(
          (service) => service.id === nodeLogsService && isNodeServiceRunning(service)
        )

        if (logsServiceStillRunning) {
          void refreshNodeLogs(nodeLogsService)
        } else {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorApplyingProfile', { label: preset.label }))
    } finally {
      setNodePresetActionLoading(null)
    }
  }

  const cloneKoinosRepo = async (targetRepoPath: string) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.cloneRepo) return

    const repoPath = targetRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
    setNodeCloneLoading(true)
    setNodeError(null)
    setFormError(null)

    try {
      const result = await bridge.cloneRepo({ repoPath })
      setNodeOutput(result.output || '')
      setDraftNodeRepoPath(result.repoPath || repoPath)

      if (result.ok) {
        const nextNodeSettings = { ...nodeSettings, repoPath: result.repoPath || repoPath }
        setNodeSettings(nextNodeSettings)
        // Refresh immediately so the UI picks up services/status if the user cloned or refreshed the repo.
        void refreshNodeStatus(nextNodeSettings)
      } else {
        setNodeError(result.output || t('node.unableSyncRepo'))
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRunningGit'))
    } finally {
      setNodeCloneLoading(false)
    }
  }

  const refreshNodeProducerOverview = async (
    settingsOverride?: NodeManagerSettings,
    producerAddressOverride?: string
  ) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.producerOverview) return

    setNodeProducerLoading(true)
    setNodeProducerError(null)
    try {
      const producerAddress =
        producerAddressOverride !== undefined
          ? producerAddressOverride.trim()
          : producerAdvancedMode
            ? nodeProducerAddressDraft.trim()
            : walletOverview?.walletAddress?.trim() || ''
      const result = await bridge.producerOverview({
        ...toNodeApiSettings(settingsOverride ?? nodeSettings),
        producerAddress: producerAddress || undefined
      })
      setNodeProducerOverview(result)
      if (!result.ok) {
        setNodeProducerError(result.output || t('producer.unableLoadOverview'))
      }
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableLoadOverview'))
    } finally {
      setNodeProducerLoading(false)
    }
  }

  const registerNodeProducer = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.producerRegister) return

    setNodeProducerActionLoading('register')
    setNodeProducerError(null)
    setNodeError(null)

    try {
      const result = await bridge.producerRegister({
        ...toNodeApiSettings(nodeSettings),
        producerAddress: effectiveProducerTargetAddress,
        persistConfig: true
      })

      setNodeProducerOverview(result.overview)
      setNodeOutput(result.output || '')

      if (!result.ok) {
        setNodeProducerError(result.output || t('producer.unableRegister'))
      } else {
        if (producerAdvancedMode) {
          setNodeProducerAddressDraft(result.overview.producerAddress || nodeProducerAddressDraft.trim())
        }
        void refreshNodeStatus()
        void refreshProducerSigningWalletBalance(signingWalletAddress)
      }
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableRegister'))
    } finally {
      setNodeProducerActionLoading(null)
    }
  }

  const unlockProducerAccount = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.unlock) return

    setWalletActionLoading('producer-unlock')
    setWalletError(null)

    try {
      const result = await bridge.unlock({ password: producerUnlockPassword })
      setWalletResultTitle(t('producer.unlockTitle'))
      setWalletResultData(result)

      if (!result.ok) {
        setWalletError(result.output || t('producer.unlockError'))
        return
      }

      setProducerUnlockPassword('')
      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : result.walletAddress || undefined)
      await refreshProducerSigningWalletBalance(result.walletAddress || undefined)
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('producer.unlockError'))
    } finally {
      setWalletActionLoading(null)
    }
  }

  const importProducerAccount = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.importWallet) return

    setWalletActionLoading('producer-import')
    setWalletError(null)

    try {
      const importResult = await bridge.importWallet({
        privateKey: walletImportPrivateKey.trim(),
        password: walletImportPassword
      })

      if (importResult.ok && importResult.address) {
        setWalletImportPrivateKey('')
        setWalletImportPassword('')
      }

      setWalletResultTitle(t('producer.importTitle'))
      setWalletResultData(importResult)

      if (!importResult.ok) {
        setWalletError(importResult.output || t('producer.unableImport'))
        return
      }

      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : importResult.address)
      await refreshProducerSigningWalletBalance(importResult.address)
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('producer.unableImport'))
    } finally {
      setWalletActionLoading(null)
    }
  }

  const refreshWalletOverview = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.overview) return
    setWalletLoading(true)
    setWalletError(null)
    try {
      const result = await bridge.overview({ rpcUrl: effectiveExplorerRpcUrl })
      setWalletOverview(result)
      if (!result.ok) {
        setWalletError(result.output || 'Could not load wallet overview')
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Could not load wallet overview')
    } finally {
      setWalletLoading(false)
    }
  }

  const refreshProducerSigningWalletBalance = async (addressOverride?: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.balance) return
    const address = addressOverride?.trim() || walletOverview?.walletAddress?.trim() || ''
    if (!address) {
      setProducerSigningWalletBalance(null)
      setProducerSigningWalletBalanceError(null)
      setProducerSigningWalletBalanceLoading(false)
      return
    }

    setProducerSigningWalletBalanceLoading(true)
    setProducerSigningWalletBalanceError(null)
    try {
      const result = await bridge.balance({
        rpcUrl: primaryPublicRpcUrl,
        address
      })
      setProducerSigningWalletBalance(result)
      if (!result.ok) {
        setProducerSigningWalletBalanceError(
          formatProducerWalletBalanceError(
            result.output || 'Could not load signing wallet balances',
            primaryPublicRpcUrl,
            language
          )
        )
      }
    } catch (error) {
      setProducerSigningWalletBalance(null)
      setProducerSigningWalletBalanceError(
        formatProducerWalletBalanceError(
          error instanceof Error ? error.message : 'Could not load signing wallet balances',
          primaryPublicRpcUrl,
          language
        )
      )
    } finally {
      setProducerSigningWalletBalanceLoading(false)
    }
  }

  const runWalletAction = async (
    actionId: string,
    title: string,
    runner: () => Promise<unknown>,
    options?: { refreshOverview?: boolean; refreshProducer?: boolean }
  ) => {
    setWalletActionLoading(actionId)
    setWalletError(null)
    try {
      const result = await runner()
      setWalletResultTitle(title)
      setWalletResultData(result)

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setWalletError(
          'output' in result && typeof result.output === 'string' ? result.output : `${title} failed.`
        )
      }

      if (options?.refreshOverview) {
        await refreshWalletOverview()
      }

      if (options?.refreshProducer) {
        await refreshNodeProducerOverview()
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : `${title} failed.`)
    } finally {
      setWalletActionLoading(null)
    }
  }

  const currentDraftNodeApiSettings = (
    overrides?: Partial<KnodelKoinosNodeSettings>
  ): KnodelKoinosNodeSettings => {
    return {
      repoPath: overrides?.repoPath ?? draftNodeRepoPath.trim(),
      composeFile: overrides?.composeFile ?? draftNodeComposeFile.trim(),
      envFile: overrides?.envFile ?? draftNodeEnvFile.trim(),
      baseDir: overrides?.baseDir ?? normalizeNodeBaseDirInput(draftNodeBaseDir),
      profiles: overrides?.profiles ?? parseProfilesCsv(draftNodeProfiles),
      blockchainBackupUrl: overrides?.blockchainBackupUrl ?? draftNodeBlockchainBackupUrl.trim(),
      runtimeMode: overrides?.runtimeMode ?? draftNodeRuntimeMode
    }
  }

  const validateDraftNodeBaseDir = async (baseDirInput: string) => {
    const bridge = getKoinosNodeBridge()
    const normalizedBaseDir = normalizeNodeBaseDirInput(baseDirInput)
    if (!bridge?.validateBaseDir) {
      return {
        ok: true,
        baseDir: normalizedBaseDir,
        restoreWorkspaceParent: normalizedBaseDir.replace(/[\\/]+\.koinos$/, '') || normalizedBaseDir,
        writable: true,
        output: ''
      } satisfies KnodelKoinosNodeValidateBaseDirResult
    }

    setNodeBaseDirValidationLoading(true)
    try {
      const result = await bridge.validateBaseDir(currentDraftNodeApiSettings({ baseDir: normalizedBaseDir }))
      setNodeBaseDirValidation({
        ok: result.ok,
        baseDir: result.baseDir,
        restoreWorkspaceParent: result.restoreWorkspaceParent,
        message: result.output || ''
      })
      return result
    } finally {
      setNodeBaseDirValidationLoading(false)
    }
  }

  const pickNodeBaseDir = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.selectBaseDir) return

    setNodeBaseDirPickerLoading(true)
    setFormError(null)
    setNodeError(null)

    try {
      const result = await bridge.selectBaseDir(currentDraftNodeApiSettings())
      if (!result.ok) {
        setNodeBaseDirValidation({
          ok: false,
          baseDir: result.path,
          restoreWorkspaceParent: result.restoreWorkspaceParent,
          message: result.output || ''
        })
        setFormError(result.output || t('node.unableSelectBaseDir'))
        return
      }

      if (!result.canceled && result.path.trim()) {
        setDraftNodeBaseDir(result.path)
        setNodeBaseDirValidation({
          ok: result.ok,
          baseDir: result.path,
          restoreWorkspaceParent: result.restoreWorkspaceParent,
          message: result.output || ''
        })
        setNodeOutput(result.output || `BASEDIR seleccionado: ${result.path}`)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('node.errorOpeningFolderPicker'))
    } finally {
      setNodeBaseDirPickerLoading(false)
    }
  }

  const loadNodeManagedFile = async (kind: NodeManagedFileKind) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.fileRead) return

    setNodeFileEditorLoading(true)
    setNodeFileEditorSaving(false)
    setNodeFileEditorError(null)
    setNodeFileEditorLastSavedAt(null)

    try {
      const result = await bridge.fileRead({
        ...currentDraftNodeApiSettings(),
        kind
      })

      setNodeFileEditorKind(kind)
      setNodeFileEditorPath(result.filePath)
      setNodeFileEditorContent(result.content ?? '')

      if (!result.ok) {
        setNodeFileEditorError(result.output || t('node.unableReadFile', { kind }))
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : t('node.errorReadingFile', { kind }))
      setNodeFileEditorPath(kind === 'compose' ? composeFileDisplayPath : envFileDisplayPath)
      setNodeFileEditorContent('')
    } finally {
      setNodeFileEditorLoading(false)
    }
  }

  const openNodeFileEditor = async (kind: NodeManagedFileKind) => {
    setNodeFileEditorOpen(true)
    setNodeFileEditorKind(kind)
    setNodeFileEditorPath(
      kind === 'compose' ? composeFileDisplayPath : kind === 'env' ? envFileDisplayPath : configFileDisplayPath
    )
    setNodeFileEditorContent('')
    setNodeFileEditorError(null)
    setNodeFileEditorLastSavedAt(null)
    await loadNodeManagedFile(kind)
  }

  const saveNodeManagedFile = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.fileWrite) return

    setNodeFileEditorSaving(true)
    setNodeFileEditorError(null)
    try {
      const result = await bridge.fileWrite({
        ...currentDraftNodeApiSettings(),
        kind: nodeFileEditorKind,
        content: nodeFileEditorContent
      })

      setNodeFileEditorPath(result.filePath || nodeFileEditorPath)
      if (!result.ok) {
        setNodeFileEditorError(result.output || t('node.unableSaveFile'))
      } else {
        setNodeFileEditorLastSavedAt(Date.now())
        setNodeOutput(result.output || '')
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : t('node.errorSavingFile'))
    } finally {
      setNodeFileEditorSaving(false)
    }
  }

  const openServiceLogsModal = (serviceId: string) => {
    setNodeLogsService(serviceId)
    setNodeLogsModalOpen(true)
    setNodeServiceContextMenu(null)
    setNodeLogsError(null)
    setNodeLogsOutput('')
    setNodeLogsLastRefreshAt(null)
    setNodeLogsStreamId(null)
  }

  const stopNodeLogsStream = async (streamIdOverride?: string | null) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.logsFollowStop) return

    const streamId = (streamIdOverride ?? nodeLogsStreamIdRef.current)?.trim() || ''
    if (!streamId) return

    if (nodeLogsStreamIdRef.current === streamId) {
      nodeLogsStreamIdRef.current = null
      setNodeLogsStreamId(null)
    }

    try {
      await bridge.logsFollowStop({ streamId })
    } catch {
      // best effort stop
    }
  }

  const refreshNodeLogs = async (serviceOverride?: string) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.logsFollowStart || !bridge?.logs) return

    const tail = clamp(Number.parseInt(nodeLogsTail, 10) || 200, 20, 2000)
    const serviceId = (serviceOverride ?? nodeLogsService).trim()
    if (!serviceId) {
      setNodeLogsError(t('node.selectServiceForLogs'))
      return
    }

    setNodeLogsLoading(true)
    setNodeLogsError(null)
    setNodeLogsOutput('')
    setNodeLogsLastRefreshAt(null)
    try {
      await stopNodeLogsStream()
      const logsResult = await bridge.logs({
        ...toNodeApiSettings(nodeSettings),
        service: serviceId || undefined,
        tail
      })
      if (!logsResult.ok) {
        throw new Error(logsResult.output || t('node.unableReadLogs', { service: serviceId }))
      }
      setNodeLogsOutput(logsResult.output ?? '')
      setNodeLogsLastRefreshAt(Date.now())

      const result = await bridge.logsFollowStart({
        ...toNodeApiSettings(nodeSettings),
        service: serviceId || undefined,
        tail
      })
      if (!result.ok) {
        setNodeLogsStreamId(null)
        setNodeLogsLoading(false)
        setNodeLogsError(result.output || t('node.unableOpenLogsStream', { service: serviceId }))
        return
      }
      setNodeLogsService(serviceId)
      setNodeLogsStreamId(result.streamId)
      setNodeLogsLoading(false)
    } catch (error) {
      setNodeLogsStreamId(null)
      setNodeLogsError(error instanceof Error ? error.message : t('node.errorLoadingLogs'))
      setNodeLogsLoading(false)
    } finally {
      // loading ends when "start" or first chunk event arrives
    }
  }

  useEffect(() => {
    if (!nodeLogsModalOpen || !nodeLogsService || !hasNodeControls) {
      void stopNodeLogsStream()
      return
    }

    void refreshNodeLogs(nodeLogsService)

    return () => {
      void stopNodeLogsStream()
    }
  }, [nodeLogsModalOpen, nodeLogsService, nodeLogsTail, nodeSettings, hasNodeControls])

  const renderedNodeLogsOutput = useMemo(
    () => (nodeLogsOutput ? renderAnsiLog(nodeLogsOutput) : null),
    [nodeLogsOutput]
  )

  const runNodeAction = async (action: NodeAction) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge) return
    setNodeActionLoading(action)
    setNodeError(null)
    try {
      const result =
        action === 'start'
          ? await bridge.start(toNodeApiSettings(nodeSettings))
          : await bridge.stop(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')
      if (!result.ok) {
        setNodeError(
          result.output || (action === 'start' ? t('node.unableStartNode') : t('node.unableStopNode'))
        )
      } else if (action === 'start' && nodeLogsModalOpen && nodeLogsService) {
        void refreshNodeLogs(nodeLogsService)
      }
    } catch (error) {
      setNodeError(
        error instanceof Error
          ? error.message
          : action === 'start'
            ? t('node.errorStartingNode')
            : t('node.errorStoppingNode')
      )
    } finally {
      setNodeActionLoading(null)
    }
  }

  const runNodeRestoreBackup = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.restoreBackup) return

    setNodeRestoreBackupLoading(true)
    setNodeError(null)
    setNodeBackupProgress({
      action: 'restore-backup',
      phase: 'prepare',
      progress: 0,
      message: t('node.preparingRestore'),
      updatedAt: Date.now()
    })

    try {
      const result = await bridge.restoreBackup(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableRestoreBackup'))
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRestoringBackup'))
    } finally {
      setNodeRestoreBackupLoading(false)
    }
  }

  const runNodeRestoreBackupVerify = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.restoreBackupVerify) return

    setNodeRestoreBackupVerifyLoading(true)
    setNodeError(null)
    setNodeBackupProgress({
      action: 'restore-backup-verify',
      phase: 'prepare',
      progress: 0,
      message: t('node.preparingRestoreVerify'),
      updatedAt: Date.now()
    })

    try {
      const result = await bridge.restoreBackupVerify(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableRestoreVerify'))
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRestoringVerify'))
    } finally {
      setNodeRestoreBackupVerifyLoading(false)
    }
  }

  const restartNodeForNewBaseDir = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge || !nodeBaseDirChangeDialog) return

    setNodeBaseDirRestartLoading(true)
    setNodeError(null)

    try {
      const stopResult = await bridge.stop(toNodeApiSettings(nodeSettings))
      const startResult = await bridge.start(toNodeApiSettings(nodeSettings))
      setNodeStatus(startResult.status)
      setNodeOutput([stopResult.output, startResult.output].filter(Boolean).join('\n'))

      if (!stopResult.ok || !startResult.ok || !startResult.status.ok) {
        setNodeError(startResult.output || startResult.status.output || t('node.unableRestartBaseDir'))
      } else {
        setNodeError(null)
        setNodeBaseDirChangeDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableRestartBaseDir'))
    } finally {
      setNodeBaseDirRestartLoading(false)
    }
  }

  const copyNodeBaseDirData = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.copyBaseDirData || !nodeBaseDirChangeDialog) return

    setNodeBaseDirCopyLoading(true)
    setNodeError(null)

    try {
      const result = await bridge.copyBaseDirData({
        ...toNodeApiSettings(nodeSettings),
        sourceBaseDir: nodeBaseDirChangeDialog.previousBaseDir,
        targetBaseDir: nodeBaseDirChangeDialog.nextBaseDir,
        stopSourceRuntime: nodeBaseDirChangeDialog.nodeWasRunning
      })
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableCopyBaseDir'))
      } else {
        setNodeError(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableCopyBaseDir'))
    } finally {
      setNodeBaseDirCopyLoading(false)
    }
  }

  const runNodeServiceAction = async (serviceId: string, action: NodeServiceAction) => {
    const bridge = getKoinosNodeBridge()
    if (!serviceId.trim()) return
    if (action === 'start' && !bridge?.serviceStart) return
    if (action === 'stop' && !bridge?.serviceStop) return
    if (action === 'restart' && !bridge?.serviceRestart) return

    setNodeServiceActionLoading({ serviceId, action })
    setNodeServiceContextMenu(null)
    setNodeError(null)

    try {
      const result =
        action === 'start'
          ? await bridge.serviceStart({ ...toNodeApiSettings(nodeSettings), service: serviceId })
          : action === 'stop'
            ? await bridge.serviceStop({ ...toNodeApiSettings(nodeSettings), service: serviceId })
            : await bridge.serviceRestart({ ...toNodeApiSettings(nodeSettings), service: serviceId })

      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(
          result.output ||
            result.status.output ||
            (action === 'start'
              ? t('node.unableStartService', { service: serviceId })
              : action === 'stop'
                ? t('node.unableStopService', { service: serviceId })
                : t('node.unableRestartService', { service: serviceId }))
        )

        const conflictedService =
          result.status.services.find((service) => service.id === serviceId && service.state === 'conflict') ?? null
        if (conflictedService && canKillNodeConflict(conflictedService)) {
          setNodeConflictDialog({
            serviceId: conflictedService.id,
            serviceName: conflictedService.name,
            conflictPids: conflictedService.conflictPids,
            message:
              conflictedService.lastError ||
              t('node.conflictingProcessDetected', { service: conflictedService.name })
          })
        }
      } else {
        setNodeError(null)
      }

      if ((action === 'start' || action === 'restart') && nodeLogsModalOpen && nodeLogsService === serviceId) {
        void refreshNodeLogs(serviceId)
      }
      if (action === 'stop' && nodeLogsModalOpen && nodeLogsService === serviceId) {
        setNodeLogsModalOpen(false)
      }
    } catch (error) {
      setNodeError(
        error instanceof Error
          ? error.message
          : action === 'start'
            ? t('node.errorStartingService', { service: serviceId })
            : action === 'stop'
              ? t('node.errorStoppingService', { service: serviceId })
              : t('node.errorRestartingService', { service: serviceId })
      )
    } finally {
      setNodeServiceActionLoading(null)
    }
  }

  const openNodeConflictDialog = (service: KnodelKoinosNodeServiceStatus) => {
    if (!canKillNodeConflict(service)) return
    setNodeServiceContextMenu(null)
    setNodeConflictDialog({
      serviceId: service.id,
      serviceName: service.name,
      conflictPids: service.conflictPids,
      message: service.lastError || t('node.conflictingProcessDetected', { service: service.name })
    })
  }

  const runNodeKillConflict = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.serviceKillConflict || !nodeConflictDialog) return

    setNodeConflictKillLoading(nodeConflictDialog.serviceId)
    setNodeError(null)

    try {
      const result = await bridge.serviceKillConflict({
        ...toNodeApiSettings(nodeSettings),
        service: nodeConflictDialog.serviceId
      })

      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableKillConflict'))
      } else {
        setNodeError(null)
        setNodeConflictDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorKillingConflict'))
    } finally {
      setNodeConflictKillLoading(null)
    }
  }

  const runNodeNativeBuildAll = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.nativeBuildAll) return

    setNodeNativeBuildActionLoading('all')
    setNodeNativeBuildsError(null)

    try {
      const result = await bridge.nativeBuildAll()
      setNodeNativeBuilds(result.builds)
      setNodeOutput(result.output || result.builds.output || '')

      if (!result.ok || !result.builds.ok) {
        setNodeNativeBuildsError(result.output || result.builds.output || t('node.unableCompileWorkspace'))
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.errorCompilingServices'))
    } finally {
      setNodeNativeBuildActionLoading(null)
    }
  }

  const runNodeNativeBuildService = async (serviceId: string) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.nativeBuildService || !serviceId.trim()) return

    setNodeNativeBuildActionLoading(serviceId)
    setNodeNativeBuildsError(null)

    try {
      const result = await bridge.nativeBuildService({ serviceId })
      setNodeNativeBuilds(result.builds)
      setNodeOutput(result.output || result.builds.output || '')

      if (!result.ok || !result.builds.ok) {
        setNodeNativeBuildsError(
          result.output || result.builds.output || t('node.unableCompileService', { service: serviceId })
        )
      }
    } catch (error) {
      setNodeNativeBuildsError(
        error instanceof Error ? error.message : t('node.errorCompilingService', { service: serviceId })
      )
    } finally {
      setNodeNativeBuildActionLoading(null)
    }
  }

  const applySettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    try {
      const publicRpcUrls = parsePublicRpcUrlsInput(draftPublicRpcUrls, language)
      const pollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
      const rowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)
      const previousBaseDir = normalizeNodeBaseDirInput(nodeSettings.baseDir)
      const repoPath = draftNodeRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
      const composeFile = draftNodeComposeFile.trim() || DEFAULT_NODE_SETTINGS.composeFile
      const envFile = draftNodeEnvFile.trim() || DEFAULT_NODE_SETTINGS.envFile
      const baseDir = normalizeNodeBaseDirInput(draftNodeBaseDir)
      const profiles = parseProfilesCsv(draftNodeProfiles).join(',')
      const blockchainBackupUrl = normalizeBackupTarGzUrl(
        draftNodeBlockchainBackupUrl.trim() || DEFAULT_NODE_SETTINGS.blockchainBackupUrl,
        language
      )
      const runtimeMode = draftNodeRuntimeMode

      if (!repoPath) throw new Error(t('settings.repoRequired'))
      if (!composeFile) throw new Error(t('settings.composeRequired'))
      if (!envFile) throw new Error(t('settings.envRequired'))
      if (!baseDir) throw new Error(t('settings.baseDirRequired'))

      const baseDirValidation = await validateDraftNodeBaseDir(baseDir)
      if (!baseDirValidation.ok) {
        throw new Error(baseDirValidation.output || t('settings.baseDirNotUsable', { baseDir }))
      }

      setSettings((current) => ({
        ...current,
        publicRpcUrls,
        rpcSource: normalizeExplorerRpcSource(current.rpcSource, publicRpcUrls, current.rpcSource),
        pollMs,
        rowLimit
      }))
      setNodeSettings({ repoPath, composeFile, envFile, baseDir, profiles, blockchainBackupUrl, runtimeMode })
      setDraftNodeBaseDir(baseDir)
      const baseDirChanged = previousBaseDir !== baseDir
      const settingsSummary = baseDirChanged
        ? t('settings.savedBaseDirChanged', { previous: previousBaseDir, next: baseDir })
        : t('settings.savedBaseDir', { baseDir })
      setNodeOutput(settingsSummary)
      if (baseDirChanged) {
        setNodeBaseDirChangeDialog({
          previousBaseDir,
          nextBaseDir: baseDir,
          nodeWasRunning: (nodeStatus?.services ?? []).some((service) => service.managedByKnodel || isNodeServiceRunning(service))
        })
      } else {
        setNodeBaseDirChangeDialog(null)
      }
      setRows([])
      rowsRef.current = []
      setHead(null)
      setIsInitialLoading(true)
      setErrorMessage(null)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('settings.invalidConfig'))
    }
  }

  const resetDefaults = () => {
    setDraftPublicRpcUrls(DEFAULT_SETTINGS.publicRpcUrls.join('\n'))
    setDraftPollMs(String(DEFAULT_SETTINGS.pollMs))
    setDraftRowLimit(String(DEFAULT_SETTINGS.rowLimit))
    setDraftNodeRepoPath(DEFAULT_NODE_SETTINGS.repoPath)
    setDraftNodeComposeFile(DEFAULT_NODE_SETTINGS.composeFile)
    setDraftNodeEnvFile(DEFAULT_NODE_SETTINGS.envFile)
    setDraftNodeBaseDir(DEFAULT_NODE_SETTINGS.baseDir)
    setDraftNodeProfiles(DEFAULT_NODE_SETTINGS.profiles)
    setDraftNodeBlockchainBackupUrl(DEFAULT_NODE_SETTINGS.blockchainBackupUrl)
    setDraftNodeRuntimeMode(DEFAULT_NODE_SETTINGS.runtimeMode)
    setNodeBaseDirValidation(null)
    setFormError(null)
  }

  return (
    <div className="app-shell">
      <div className="app-background" aria-hidden="true" />

      <div className="app-chrome">
        <nav className="tabs-bar" aria-label={t('sections.aria')}>
          <div className="tabs-list" role="tablist" aria-label={t('tabs.aria')}>
            <button
              id="tab-explorer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'explorer'}
              aria-controls="panel-explorer"
              className={`tab-button ${activeTab === 'explorer' ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveTab('explorer')}
            >
              {t('tab.explorer')}
            </button>
            <button
              id="tab-node"
              type="button"
              role="tab"
              aria-selected={activeTab === 'node'}
              aria-controls="panel-node"
              className={`tab-button ${activeTab === 'node' ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveTab('node')}
            >
              {t('tab.node')}
            </button>
            <button
              id="tab-producer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'producer'}
              aria-controls="panel-producer"
              className={`tab-button ${activeTab === 'producer' ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveTab('producer')}
            >
              {t('tab.producer')}
            </button>
            <button
              id="tab-settings"
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              aria-controls="panel-settings"
              className={`tab-button ${activeTab === 'settings' ? 'is-active' : ''}`.trim()}
              onClick={() => {
                setActiveTab('settings')
                setFormError(null)
              }}
            >
              {t('tab.settings')}
            </button>
          </div>
        </nav>
      </div>

      <div className={`app-content ${hasAppOverlayOpen ? 'has-overlay' : ''}`.trim()}>

      {activeTab === 'settings' && (
        <section
          id="panel-settings"
          className="settings-panel"
          aria-label={t('settings.panelAria')}
          role="tabpanel"
          aria-labelledby="tab-settings"
        >
          <form className="settings-form" onSubmit={applySettings}>
            <div className="settings-header">
              <h2>{t('settings.title')}</h2>
              <p>{t('settings.description')}</p>
            </div>

            <div className="settings-subheader">
              <h3>{t('settings.interfaceTitle')}</h3>
              <p>{t('settings.interfaceDescription')}</p>
            </div>
            <label>
              {t('settings.language')}
              <select value={language} onChange={(event) => setLanguage(normalizeAppLanguage(event.target.value))}>
                <option value="en">{t('language.english')}</option>
                <option value="es">{t('language.spanish')}</option>
              </select>
            </label>

            <div className="settings-subheader">
              <h3>{t('settings.producerModeTitle')}</h3>
              <p>{t('settings.producerModeDescription')}</p>
            </div>
            <label className="settings-toggle">
          <span className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={settings.producerAdvancedMode}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, producerAdvancedMode: event.target.checked }))
                  }}
                />
                <span>{t('settings.producerAdvancedMode')}</span>
              </span>
              <span className="settings-inline-help">
                {settings.producerAdvancedMode ? t('settings.producerAdvancedHelpOn') : t('settings.producerAdvancedHelpOff')}
              </span>
            </label>

            <div className="settings-subheader">
              <h3>{t('settings.explorerTitle')}</h3>
              <p>{t('settings.explorerDescription')}</p>
            </div>
            <label>
              {t('settings.publicRpcUrls')}
              <textarea
                className="settings-textarea mono"
                value={draftPublicRpcUrls}
                onChange={(event) => setDraftPublicRpcUrls(event.target.value)}
                placeholder={`https://api.koinos.io\nhttps://api.koinosblocks.com`}
                rows={4}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="settings-inline-help">{t('settings.publicRpcUrlsHelp')}</span>
            </label>

            <div className="settings-row">
              <label>
                {t('settings.refreshMs')}
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={500}
                  value={draftPollMs}
                  onChange={(event) => setDraftPollMs(event.target.value)}
                />
              </label>

              <label>
                {t('settings.rows')}
                <input
                  type="number"
                  min={5}
                  max={50}
                  step={1}
                  value={draftRowLimit}
                  onChange={(event) => setDraftRowLimit(event.target.value)}
                />
              </label>
            </div>

            <div className="settings-subheader">
              <h3>{t('settings.nodeTitle')}</h3>
              <p>{t('settings.nodeDescription')}</p>
            </div>

            <label>
              {t('settings.repoPath')}
              <input
                type="text"
                value={draftNodeRepoPath}
                onChange={(event) => setDraftNodeRepoPath(event.target.value)}
                placeholder="/Users/pgarcgo/code/koinos_code/koinos"
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void cloneKoinosRepo(draftNodeRepoPath)
                }}
                disabled={!hasNodeControls || nodeCloneLoading || nodeActionLoading !== null}
              >
                {nodeCloneLoading ? t('node.refreshingRepo') : t('node.refreshRepo')}
              </button>
              <span className="settings-inline-help mono">
                {t('settings.refreshRepoHelp')}
              </span>
            </div>

            <div className="settings-row settings-row-3">
              <label>
                {t('settings.composeFile')}
                <input
                  type="text"
                  value={draftNodeComposeFile}
                  onChange={(event) => setDraftNodeComposeFile(event.target.value)}
                  placeholder="docker-compose.yml"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-path-preview mono" title={composeFileDisplayPath || draftNodeComposeFile}>
                  {composeFileDisplayPath || t('common.emptyPath')}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void openNodeFileEditor('compose')
                  }}
                  disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
                >
                  {t('common.viewEdit')}
                </button>
              </label>

              <label>
                {t('settings.envFile')}
                <input
                  type="text"
                  value={draftNodeEnvFile}
                  onChange={(event) => setDraftNodeEnvFile(event.target.value)}
                  placeholder=".env"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-path-preview mono" title={envFileDisplayPath || draftNodeEnvFile}>
                  {envFileDisplayPath || t('common.emptyPath')}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void openNodeFileEditor('env')
                  }}
                  disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
                >
                  {t('common.viewEdit')}
                </button>
              </label>

              <label>
                {t('settings.profilesCsv')}
                <input
                  type="text"
                  value={draftNodeProfiles}
                  onChange={(event) => setDraftNodeProfiles(event.target.value)}
                  placeholder="block_producer,jsonrpc"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="settings-subheader">
              <h3>{t('settings.blockchainBackupTitle')}</h3>
              <p>{t('settings.blockchainBackupDescription')}</p>
            </div>

            <label>
              {t('settings.backupUrl')}
              <input
                type="url"
                value={draftNodeBlockchainBackupUrl}
                onChange={(event) => setDraftNodeBlockchainBackupUrl(event.target.value)}
                placeholder="http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz"
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void runNodeRestoreBackupVerify()
                }}
                disabled={!hasNodeControls || nodeBusy}
                title={`${nodeSettings.blockchainBackupUrl}\n${t('node.restoreVerifyRequiresJsonrpc')}`}
              >
                {nodeRestoreBackupVerifyLoading ? t('node.restoringVerify') : t('node.restoreVerify')}
              </button>
              <span className="settings-inline-help">
                {t('node.restoreVerifyRequiresJsonrpc')}
              </span>
            </div>

            <label>
              {t('settings.configFile')}
              <span className="settings-path-preview mono" title={configFileDisplayPath || 'config/config.yml'}>
                {configFileDisplayPath || t('common.emptyPath')}
              </span>
              <button
                type="button"
                className="ghost-button settings-inline-button"
                onClick={() => {
                  void openNodeFileEditor('config')
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {t('common.viewEdit')}
              </button>
            </label>

            <label>
              {t('settings.baseDataDir')}
              <div className="settings-input-with-button">
                <input
                  type="text"
                  value={draftNodeBaseDir}
                  onChange={(event) => {
                    setDraftNodeBaseDir(event.target.value)
                    setNodeBaseDirValidation(null)
                  }}
                  onBlur={(event) => {
                    const normalized = normalizeNodeBaseDirInput(event.target.value)
                    setDraftNodeBaseDir(normalized)
                    void validateDraftNodeBaseDir(normalized).then((result) => {
                      if (!result.ok) {
                        setFormError(result.output || t('settings.baseDirNotUsable', { baseDir: normalized }))
                      } else {
                        setFormError(null)
                      }
                    })
                  }}
                  placeholder="~/.koinos"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void pickNodeBaseDir()
                  }}
                  disabled={!hasNodeControls || nodeBusy}
                >
                  {nodeBaseDirPickerLoading ? t('common.opening') : t('common.browse')}
                </button>
              </div>
              <span
                className={`settings-inline-help ${
                  nodeBaseDirValidationLoading
                    ? 'is-busy'
                    : nodeBaseDirValidation
                      ? nodeBaseDirValidation.ok
                        ? 'is-ok'
                        : 'is-error'
                      : ''
                }`.trim()}
              >
                {nodeBaseDirValidationLoading
                  ? t('settings.baseDirChecking')
                  : nodeBaseDirValidation?.message || t('settings.baseDirHelp')}
              </span>
            </label>

            <label>
              {t('common.runtime')}
              <select
                value={draftNodeRuntimeMode}
                onChange={(event) => setDraftNodeRuntimeMode(event.target.value === 'native' ? 'native' : 'docker')}
              >
                <option value="docker">{t('common.runtimeDocker')}</option>
                <option value="native">{t('common.runtimeNative')}</option>
              </select>
              <span className="settings-inline-help">
                {t('settings.runtimeHelp')}
              </span>
            </label>

            {formError && <p className="form-error">{formError}</p>}

            <div className="settings-actions">
              <button type="button" className="ghost-button" onClick={resetDefaults}>
                {t('settings.reset')}
              </button>
              <button type="submit" className="primary-button">
                {t('settings.saveReconnect')}
              </button>
            </div>
          </form>
        </section>
      )}

      {nodeFileEditorOpen && (
        <div
          className="file-editor-backdrop"
          role="presentation"
          onClick={() => setNodeFileEditorOpen(false)}
        >
          <section
            className="file-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-file-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="file-editor-header">
              <div>
                <p className="eyebrow">{t('fileEditor.eyebrow')}</p>
                <h3 id="node-file-editor-title" className="file-editor-title">
                  {nodeFileEditorKind === 'compose'
                    ? t('fileEditor.compose')
                    : nodeFileEditorKind === 'env'
                      ? t('fileEditor.env')
                      : t('fileEditor.config')}
                </h3>
                <p className="file-editor-path mono" title={nodeFileEditorPath}>
                  {nodeFileEditorPath || t('common.emptyPath')}
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setNodeFileEditorOpen(false)}
              >
                {t('common.close')}
              </button>
            </header>

            <div className="file-editor-toolbar">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void loadNodeManagedFile(nodeFileEditorKind)
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {nodeFileEditorLoading ? t('common.loading') : t('common.reload')}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void saveNodeManagedFile()
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {nodeFileEditorSaving ? t('common.saving') : t('common.save')}
              </button>
              <span className="file-editor-meta">
                {nodeFileEditorLastSavedAt
                  ? t('fileEditor.savedAt', { time: formatTime(nodeFileEditorLastSavedAt, locale) })
                  : nodeFileEditorLoading
                    ? t('fileEditor.loadingFile')
                    : ''}
              </span>
            </div>

            {nodeFileEditorError && (
              <div className="node-inline-error file-editor-error" role="alert">
                {nodeFileEditorError}
              </div>
            )}

            <textarea
              className="file-editor-textarea mono"
              value={nodeFileEditorContent}
              onChange={(event) => setNodeFileEditorContent(event.target.value)}
              spellCheck={false}
              disabled={nodeFileEditorLoading || nodeFileEditorSaving}
              aria-label={t('fileEditor.contentAria', { kind: nodeFileEditorKind })}
            />
          </section>
        </div>
      )}

      {activeTab === 'node' && (
      <section id="panel-node" className="node-panel" aria-label={t('node.panelAria')} role="tabpanel" aria-labelledby="tab-node">
        <div className="node-panel-header is-compact">
          <div className="node-panel-actions">
            <div
              className={`status-pill ${nodeStatusClass}`.trim()}
            >
              <span className="status-dot" aria-hidden="true" />
              <span>{nodeStateText}</span>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void refreshNodeStatus()
              }}
              disabled={!hasNodeControls || nodeStatusLoading || nodeBusy}
            >
              {t('common.refresh')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setNodeProfilesModalOpen(true)}
              disabled={!hasNodeControls}
            >
              {t('node.profilesTitle')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void runNodeAction('start')
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeActionLoading === 'start' ? t('common.starting') : t('node.startNode')}
            </button>
            <button
              type="button"
              className="ghost-button danger-button"
              onClick={() => {
                void runNodeAction('stop')
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeActionLoading === 'stop' ? t('common.stopping') : t('node.stopNode')}
            </button>
          </div>
        </div>

        {!hasNodeControls && (
          <div className="node-warning" role="note">
            {t('node.electronOnlyWarning')}
          </div>
        )}

        {hasNodeControls && nodeStatus && !nodeStatus.ok && /repo path not found/i.test(nodeStatus.output) && (
          <div className="node-warning" role="note">
            {t('node.repoMissingWarning', { repoPath: nodeSettings.repoPath })}
          </div>
        )}

        {hasNodeControls && nodeHasPartialOutage && (
          <div className="node-warning" role="note">
            {t('node.partialOutagePrefix')} <strong>{nodeStoppedServices.map((service) => service.name).join(', ')}</strong>.
            {nodeRuntimeMode === 'native' ? t('node.partialOutageNativeDetail') : t('node.partialOutageDockerDetail')}
          </div>
        )}

        {nodeError && (
          <div className="error-banner node-error-banner" role="alert">
            <strong>{formatNodeRuntimeMode(nodeRuntimeMode, language)}:</strong> <span>{nodeError}</span>
          </div>
        )}

        <div className="node-services">
          {nodeServiceCount > 0 ? (
            <div className="node-services-table-wrap">
              <table className="node-services-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.port')}</th>
                    <th>{t('node.col.lastError')}</th>
                    <th>{t('common.type')}</th>
                    <th>{t('common.logs')}</th>
                    <th>{t('common.start')}</th>
                    <th>{t('common.restart')}</th>
                    <th>{t('common.stop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodeServices.map((service) => {
                    const capabilities = nodeServiceCapabilities.get(service.id)
                    if (!capabilities) return null

                    const running = capabilities.running
                    const statusTone =
                      service.state === 'conflict' ? 'is-conflict' : running ? 'is-running' : 'is-stopped'
                    const serviceTooltip = formatNodeServiceTooltip(service, capabilities, language)
                    return (
                      <tr
                        key={`${service.id}-${service.runtimeName}`}
                        className={service.state === 'conflict' ? 'is-stopped' : running ? 'is-running' : 'is-stopped'}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setNodeServiceContextMenu({
                            serviceId: service.id,
                            x: event.clientX,
                            y: event.clientY
                          })
                        }}
                      >
                        <td className="node-service-name-cell" title={serviceTooltip}>
                          <div className="node-service-name-row">
                            <span className="node-service-primary mono">{service.name}</span>
                            <span className="node-service-secondary mono">
                              {formatNodeServiceRuntimeDetail(service, language)}
                            </span>
                          </div>
                          <div className="node-service-meta">
                            <span>
                              <span className="node-service-meta-label">{t('node.serviceVersionLabel')}</span>{' '}
                              <span className="mono">{formatNodeServiceVersion(service, language)}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`node-service-status ${statusTone}`}
                            title={service.status}
                          >
                            <span className="node-service-dot" aria-hidden="true" />
                            {service.state}
                          </span>
                        </td>
                        <td className="mono">{formatNodeServicePorts(service)}</td>
                        <td className={`node-service-error-cell mono ${service.lastError ? 'has-error' : ''}`}>
                          {service.lastError || '-'}
                          {service.state === 'conflict' && canKillNodeConflict(service) && (
                            <button
                              type="button"
                              className="ghost-button node-service-conflict-button"
                              onClick={() => openNodeConflictDialog(service)}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {t('node.resolveConflict')}
                            </button>
                          )}
                        </td>
                        <td>
                          <span className="node-service-runtime-tag">{formatNodeServiceType(service, language)}</span>
                        </td>
                        <td className="node-service-action-cell">
                          <button
                            type="button"
                            className="ghost-button node-service-inline-button"
                            onClick={() => openServiceLogsModal(service.id)}
                            disabled={!hasNodeControls || nodeBusy}
                          >
                            {t('common.logs')}
                          </button>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.startBlockedReason || t('node.startService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'start')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.startBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'start'
                                ? t('common.starting')
                                : t('common.start')}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.restartBlockedReason || t('node.restartService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'restart')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.restartBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'restart'
                                ? t('common.restarting')
                                : t('common.restart')}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.stopBlockedReason || t('node.stopService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button node-service-inline-button-danger"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'stop')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.stopBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'stop'
                                ? t('common.stopping')
                                : t('common.stop')}
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="node-empty">
              {nodeStatusLoading ? t('node.checkingServices') : t('node.noServices')}
            </p>
          )}
        </div>

        {nodeBackupProgress && (
          <div className="node-backup-progress" role="status" aria-live="polite">
            <div className="node-services-header">
              <h3>
                {nodeBackupProgress.action === 'restore-backup'
                  ? t('node.backupProgress.restore')
                  : t('node.backupProgress.verify')}
              </h3>
              <span>{nodeBackupProgress.progress}%</span>
            </div>
            <p className="node-backup-progress-text">{nodeBackupProgress.message}</p>
            <div className="node-backup-progress-bar" aria-hidden="true">
              <span
                className="node-backup-progress-fill"
                style={{ width: `${Math.max(2, nodeBackupProgress.progress)}%` }}
              />
            </div>
            <p className="node-backup-progress-meta mono">
              {t('node.backupPhaseMeta', {
                phase: nodeBackupProgress.phase,
                time: formatTime(nodeBackupProgress.updatedAt, locale)
              })}
            </p>
          </div>
        )}

        {nodeOutput && (
          <div className="node-output">
            <div className="node-services-header">
              <h3>{t('node.commandOutput')}</h3>
            </div>
            <pre>{nodeOutput}</pre>
          </div>
        )}

        {nodeProfilesModalOpen && (
          <div
            className="log-modal-backdrop node-profiles-backdrop"
            role="presentation"
            onClick={() => setNodeProfilesModalOpen(false)}
          >
            <section
              className="log-modal node-profiles-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-profiles-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <h3 id="node-profiles-modal-title" className="log-modal-title">
                    {t('node.profilesTitle')}
                  </h3>
                  <p className="log-modal-meta">{nodePresetSummaryText}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeProfilesModalOpen(false)}
                >
                  {t('common.close')}
                </button>
              </header>

              <div className="node-profiles-modal-body">
                {nodePresetsError && (
                  <div className="node-inline-error node-presets-error" role="alert">
                    {nodePresetsError}
                  </div>
                )}

                {nodePresetsLoading ? (
                  <p className="node-empty">{t('node.loadingProfiles')}</p>
                ) : nodePresets.length > 0 ? (
                  <div className="node-preset-list">
                    {nodePresets.map((preset) => {
                      const selected = selectedNodePreset?.id === preset.id
                      const matchesRunningState = sameStringList(preset.services, nodeRunningServiceIds)
                      return (
                        <article
                          key={preset.id}
                          className={`node-preset-card ${selected ? 'is-selected' : ''}`.trim()}
                          title={preset.description}
                        >
                          <span className="node-preset-label">{preset.label}</span>
                          <span className="node-preset-profiles mono">{formatPresetProfiles(preset, language)}</span>
                          <span className="node-preset-description">{preset.description}</span>
                          <span className="node-preset-services mono">{preset.services.join(', ') || t('common.none')}</span>
                          <span className={`node-preset-state ${matchesRunningState ? 'is-live' : 'is-pending'}`.trim()}>
                            {matchesRunningState ? t('node.profileStateMatch') : t('node.profileStatePending')}
                          </span>
                          <div className="node-preset-actions">
                            <button
                              type="button"
                              className="ghost-button node-preset-button"
                              onClick={() => applyNodePreset(preset)}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {selected ? t('common.selected') : t('node.useProfile')}
                            </button>
                            <button
                              type="button"
                              className="primary-button node-preset-button"
                              onClick={() => {
                                void reconcileNodePreset(preset)
                              }}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {nodePresetActionLoading === preset.id ? t('common.applying') : t('common.apply')}
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="node-empty">{t('node.noProfiles')}</p>
                )}
              </div>
            </section>
          </div>
        )}

        {nodeServiceContextMenu && (
          <>
            <button
              type="button"
              className="context-menu-backdrop"
              aria-label={t('node.closeServiceMenu')}
              onClick={() => setNodeServiceContextMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                setNodeServiceContextMenu(null)
              }}
            />
            <div
              className="service-context-menu"
              role="menu"
              aria-label={t('node.contextMenuAria', {
                service: nodeContextService?.name ?? nodeServiceContextMenu.serviceId
              })}
              style={{ left: nodeServiceContextMenu.x, top: nodeServiceContextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => openServiceLogsModal(nodeServiceContextMenu.serviceId)}
              >
                {t('node.showLogs')}
              </button>
              {nodeContextService?.state === 'conflict' && nodeContextService && canKillNodeConflict(nodeContextService) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openNodeConflictDialog(nodeContextService)}
                >
                  {t('node.killConflictingProcess')}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'start')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.startBlockedReason !== null}
                title={nodeContextServiceCapabilities?.startBlockedReason || t('node.startService')}
              >
                {t('node.startService')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'restart')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.restartBlockedReason !== null}
                title={nodeContextServiceCapabilities?.restartBlockedReason || t('node.restartService')}
              >
                {t('node.restartService')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'stop')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.stopBlockedReason !== null}
                title={nodeContextServiceCapabilities?.stopBlockedReason || t('node.stopService')}
              >
                {t('node.stopService')}
              </button>
            </div>
          </>
        )}

        {nodeConflictDialog && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => {
              if (!nodeConflictKillLoading) setNodeConflictDialog(null)
            }}
          >
            <section
              className="log-modal conflict-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-conflict-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.conflictEyebrow')}</p>
                  <h3 id="node-conflict-modal-title" className="log-modal-title">
                    {nodeConflictDialog.serviceName}
                  </h3>
                  <p className="log-modal-meta">{nodeConflictDialog.message}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeConflictDialog(null)}
                  disabled={Boolean(nodeConflictKillLoading)}
                >
                  {t('common.close')}
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  {t('node.conflictCopy')}
                </p>
                <pre className="conflict-modal-pids mono">{nodeConflictDialog.conflictPids.join(', ')}</pre>
                <div className="conflict-modal-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setNodeConflictDialog(null)}
                    disabled={Boolean(nodeConflictKillLoading)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void runNodeKillConflict()
                    }}
                    disabled={!hasNodeControls || nodeBusy || Boolean(nodeConflictKillLoading)}
                  >
                    {nodeConflictKillLoading === nodeConflictDialog.serviceId
                      ? t('common.loading')
                      : t('node.killConflictingProcess')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {nodeBaseDirChangeDialog && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => {
              if (!nodeBaseDirCopyLoading && !nodeBaseDirRestartLoading) setNodeBaseDirChangeDialog(null)
            }}
          >
            <section
              className="log-modal conflict-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-basedir-change-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.basedirChangedEyebrow')}</p>
                  <h3 id="node-basedir-change-title" className="log-modal-title">
                    {t('node.basedirChangedTitle')}
                  </h3>
                  <p className="log-modal-meta">
                    {t('node.basedirChangedMeta')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeBaseDirChangeDialog(null)}
                  disabled={nodeBaseDirCopyLoading || nodeBaseDirRestartLoading}
                >
                  {t('common.close')}
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  {t('node.basedirPrevious')} <span className="mono">{nodeBaseDirChangeDialog.previousBaseDir}</span>
                  <br />
                  {t('node.basedirNew')} <span className="mono">{nodeBaseDirChangeDialog.nextBaseDir}</span>
                </p>
                <p className="conflict-modal-copy">
                  {nodeBaseDirChangeDialog.nodeWasRunning
                    ? t('node.basedirRunningHelp')
                    : t('node.basedirStoppedHelp')}
                </p>
                <div className="conflict-modal-actions conflict-modal-actions-spread">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void copyNodeBaseDirData()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeBaseDirCopyLoading ? t('common.copying') : t('node.copyLocalState')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setNodeBaseDirChangeDialog(null)
                      void runNodeRestoreBackupVerify()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeRestoreBackupVerifyLoading ? t('node.restoringVerify') : t('node.restoreVerify')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void restartNodeForNewBaseDir()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeBaseDirRestartLoading ? t('common.restarting') : t('node.restartNodeNow')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {nodeLogsModalOpen && nodeLogsService && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => setNodeLogsModalOpen(false)}
          >
            <section
              className="log-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="service-log-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.serviceLogsEyebrow')}</p>
                  <h3 id="service-log-modal-title" className="log-modal-title mono">
                    {nodeLogsTargetService?.name ?? nodeLogsService}
                  </h3>
                  <p className="log-modal-meta">
                    {nodeLogsStreamId
                      ? nodeRuntimeMode === 'native'
                        ? t('node.logsStreamingNative')
                        : t('node.logsStreamingDocker')
                      : t('node.logsConnectingStream')}
                    {nodeLogsLastRefreshAt ? ` · ${t('node.logsLastActivity', { time: formatTime(nodeLogsLastRefreshAt, locale) })}` : ''}
                  </p>
                </div>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeLogsModalOpen(false)}
                >
                  {t('common.close')}
                </button>
              </header>

              <div className="node-logs-controls log-modal-toolbar">
                <label className="node-field node-field-tail">
                  <span>{t('node.tail')}</span>
                  <input
                    type="number"
                    min={20}
                    max={2000}
                    step={10}
                    value={nodeLogsTail}
                    onChange={(event) => setNodeLogsTail(event.target.value)}
                    disabled={nodeLogsLoading}
                  />
                </label>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void refreshNodeLogs(nodeLogsService)
                  }}
                  disabled={!hasNodeControls || nodeLogsLoading}
                >
                  {nodeLogsLoading ? t('common.connecting') : t('node.reconnectStream')}
                </button>
              </div>

              {nodeLogsError && (
                <div className="node-inline-error log-modal-inline-error" role="alert">
                  {nodeLogsError}
                </div>
              )}

              <pre ref={nodeLogsPreRef} className="node-log-pre log-modal-pre ansi-log-pre">
                {nodeLogsOutput
                  ? renderedNodeLogsOutput
                  : nodeLogsLoading
                    ? t('node.connectingLogs')
                    : t('node.waitingLogs')}
              </pre>
            </section>
          </div>
        )}
      </section>
      )}

      {activeTab === 'producer' && (
      <section id="panel-producer" className="producer-panel" aria-label={t('producer.panelAria')} role="tabpanel" aria-labelledby="tab-producer">
        <div className="wallet-header">
          <div>
            <h2>{t('producer.title')}</h2>
            <p>{t('producer.description')}</p>
          </div>
          <div className="wallet-header-meta">
            <span className="status-pill is-idle">
              <span className="status-dot" aria-hidden="true" />
              <span>{effectiveExplorerRpcUrl}</span>
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void Promise.all([
                  refreshNodeProducerOverview(
                    undefined,
                    producerAdvancedMode ? nodeProducerAddressDraft.trim() : signingWalletAddress
                  ),
                  refreshWalletOverview(),
                  refreshProducerSigningWalletBalance(signingWalletAddress)
                ])
              }}
              disabled={!hasNodeControls || nodeProducerLoading || walletLoading || walletActionLoading !== null}
            >
              {nodeProducerLoading || walletLoading ? t('common.loading') : t('common.refresh')}
            </button>
          </div>
        </div>

        {!hasNodeControls && (
          <div className="node-warning" role="note">
            {t('node.electronOnlyWarning')}
          </div>
        )}

        {nodeProducerError && (
          <div className="error-banner node-error-banner" role="alert">
            <span>{nodeProducerError}</span>
          </div>
        )}

        {walletError && (
          <div className="error-banner node-error-banner" role="alert">
            <span>{walletError}</span>
          </div>
        )}

        {nodeProducerOverview && (
          <div className="producer-grid">
            <article className="stat-card">
              <span className="stat-label">{t('producer.address')}</span>
              <p className="stat-value mono" title={effectiveProducerTargetAddress || t('common.na')}>
                {effectiveProducerTargetAddress ? shortHash(effectiveProducerTargetAddress, 16, 12) : t('common.na')}
              </p>
              <p className="stat-note">{producerAddressSourceText}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.registrationStatus')}</span>
              <p className="stat-value">{producerRegistrationStatusText}</p>
              <p className="stat-note">
                {nodeProducerOverview.registeredPublicKey ? shortHash(nodeProducerOverview.registeredPublicKey, 18, 12) : t('common.na')}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.signingWallet')}</span>
              <p className="stat-value mono" title={signingWalletAddress || t('common.na')}>
                {signingWalletAddress ? shortHash(signingWalletAddress, 16, 12) : t('common.na')}
              </p>
              <p className="stat-note">{producerSigningWalletRelationText}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.signingWalletMana')}</span>
              <p className="stat-value">
                {producerSigningWalletBalanceLoading
                  ? '...'
                  : formatDecimalValue(producerSigningWalletBalance?.mana, locale, 4, t('common.na'))}
              </p>
              <p
                className={`stat-note ${
                  signingWalletHasRegistrationMana === true
                    ? 'is-ok'
                    : signingWalletHasRegistrationMana === false
                      ? 'is-error'
                      : ''
                }`}
              >
                {producerSigningWalletStatusText}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.vhpBalance')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.vhpBalance, locale, 2, t('common.na'))}</p>
              <p className="stat-note">{t('producer.estimatedApy')}: {formatDecimalValue(nodeProducerOverview.estimatedApyPercent, locale, 2, t('common.na'))}%</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.koinBalance')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.koinBalance, locale, 2, t('common.na'))}</p>
              <p className="stat-note">{t('producer.koinPrice')}: {formatUsdValue(nodeProducerOverview.koinPriceUsd, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.manaBalance')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.mana, locale, 2, t('common.na'))}</p>
              <p className="stat-note">
                {t('producer.address')}: {nodeProducerOverview.producerAddress ? shortHash(nodeProducerOverview.producerAddress, 16, 12) : t('common.na')}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.producedLast24h')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.producedLast24h, locale, 0, t('common.na'))}</p>
              <p className="stat-note">{t('producer.activeProducers')}: {formatDecimalValue(nodeProducerOverview.activeProducerCount, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.projectedBlocksMonth')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.projectedBlocksPerMonth, locale, 0, t('common.na'))}</p>
              <p className="stat-note">{t('producer.shareLast24h')}: {formatDecimalValue(nodeProducerOverview.shareLast24hPercent, locale, 2, t('common.na'))}%</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedKoinDay')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.estimatedKoinPerDay, locale, 4, t('common.na'))}</p>
              <p className="stat-note">{t('producer.lastProducedAt')}: {formatDateTime(nodeProducerOverview.lastProducedBlockAt ?? 0, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedKoinMonth')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview.estimatedKoinPerMonth, locale, 2, t('common.na'))}</p>
              <p className="stat-note">{t('producer.priceSource')}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedUsdMonth')}</span>
              <p className="stat-value">{formatUsdValue(nodeProducerOverview.estimatedUsdPerMonth, locale, t('common.na'))}</p>
              <p className="stat-note">{t('producer.rpcSource')}</p>
            </article>
          </div>
        )}

        {!nodeProducerLoading && !nodeProducerOverview && !nodeProducerError && (
          <p className="node-empty">{t('producer.noOverview')}</p>
        )}

        <div className="wallet-card-grid">
          {producerUnlockRequired && (
            <article className="wallet-card">
              <h3>{t('producer.unlockTitle')}</h3>
              <p>{t('producer.unlockDescription')}</p>
              <label>
                {t('wallet.password')}
                <input
                  type="password"
                  value={producerUnlockPassword}
                  onChange={(event) => setProducerUnlockPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void unlockProducerAccount()
                }}
                disabled={!hasWalletControls || walletActionLoading !== null}
              >
                {walletActionLoading === 'producer-unlock' ? t('common.loading') : t('producer.unlockAction')}
              </button>
            </article>
          )}

          <article className="wallet-card">
            <h3>{t('producer.importTitle')}</h3>
            <p>{t('producer.importDescription')}</p>
            <label>
              {t('wallet.privateKey')}
              <input
                type="text"
                value={walletImportPrivateKey}
                onChange={(event) => setWalletImportPrivateKey(event.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label>
              {t('wallet.password')}
              <input
                type="password"
                value={walletImportPassword}
                onChange={(event) => setWalletImportPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void importProducerAccount()
              }}
              disabled={!hasWalletControls || walletActionLoading !== null}
            >
              {walletActionLoading === 'producer-import' ? t('common.loading') : t('producer.importAction')}
            </button>
            <p className="stat-note mono" title={walletOverview?.walletAddress || t('common.na')}>
              {t('producer.walletAddress')}: {walletOverview?.walletAddress || t('common.na')}
            </p>
          </article>

          <article className="wallet-card">
            <h3>{t('producer.burnTitle')}</h3>
            <p>{t('producer.burnDescription')}</p>
            <label>
              {t('wallet.burnPercent')}
              <input
                type="number"
                min={0}
                max={100}
                value={walletBurnPercentDraft}
                onChange={(event) => {
                  setWalletBurnPercentDraft(event.target.value)
                  if (event.target.value.trim()) setWalletBurnAmountDraft('')
                }}
              />
            </label>
            <label>
              {t('wallet.burnAmount')}
              <input
                type="number"
                min={0}
                step="0.00000001"
                value={walletBurnAmountDraft}
                onChange={(event) => {
                  setWalletBurnAmountDraft(event.target.value)
                  if (event.target.value.trim()) setWalletBurnPercentDraft('')
                }}
              />
            </label>
            <label className="wallet-checkbox">
              <input
                type="checkbox"
                checked={walletBurnDryRun}
                onChange={(event) => setWalletBurnDryRun(event.target.checked)}
              />
              <span>{t('wallet.dryRun')}</span>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const bridge = getWalletBridge()
                if (!bridge) return
                const percent = walletBurnPercentDraft.trim() ? Number.parseFloat(walletBurnPercentDraft) : undefined
                const amount = walletBurnAmountDraft.trim() ? Number.parseFloat(walletBurnAmountDraft) : undefined
                void runWalletAction('producer-burn', t('producer.burnTitle'), () =>
                  bridge.burn({
                    rpcUrl: effectiveExplorerRpcUrl,
                    percent,
                    amount,
                    dryRun: walletBurnDryRun
                  }), {
                  refreshOverview: true,
                  refreshProducer: true
                })
              }}
              disabled={!hasWalletControls || walletActionLoading !== null || !producerWalletReady}
            >
              {walletActionLoading === 'producer-burn' ? t('common.loading') : t('producer.burnAction')}
            </button>
          </article>
        </div>

        <div className="producer-setup">
          <div className="node-services-header producer-header">
            <div>
              <h3>{t('producer.setupTitle')}</h3>
              <p className="producer-header-copy">{t('producer.setupDescription')}</p>
            </div>
          </div>

          <div className="producer-form">
            {producerAdvancedMode ? (
              <label>
                {t('producer.addressInput')}
                <input
                  type="text"
                  value={nodeProducerAddressDraft}
                  onChange={(event) => setNodeProducerAddressDraft(event.target.value)}
                  onBlur={() => {
                    void refreshNodeProducerOverview(undefined, nodeProducerAddressDraft.trim())
                  }}
                  placeholder="14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            ) : (
              <div className="producer-derived-address">
                <span>{t('producer.addressInput')}</span>
                <span className="mono" title={effectiveProducerTargetAddress || t('common.na')}>
                  {effectiveProducerTargetAddress || t('common.na')}
                </span>
                <p className="settings-inline-help">{t('producer.addressDerived')}</p>
              </div>
            )}
          </div>

          <div className="producer-setup-copy">
            <p className="settings-inline-help">{t('producer.addressHelp')}</p>
            <p className="settings-inline-help">{t('producer.localKeyHelp')}</p>
            <p className="settings-inline-help">{t('producer.signingWalletHelp')}</p>
          </div>

          <div className="producer-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void registerNodeProducer()
              }}
              disabled={producerRegisterDisabled}
            >
              {nodeProducerActionLoading === 'register' ? t('producer.registering') : t('producer.registerAction')}
            </button>
            <span
              className={`settings-inline-help ${producerRegisterHintClass}`}
            >
              {producerRegisterHintText}
            </span>
          </div>

          {nodeProducerOverview ? (
            <div className="producer-details">
              <div className="producer-detail-row">
                <span>{t('producer.addressInput')}</span>
                <span className="mono" title={effectiveProducerTargetAddress || t('common.na')}>
                  {effectiveProducerTargetAddress || t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWallet')}</span>
                <span className="mono" title={signingWalletAddress || t('common.na')}>
                  {signingWalletAddress || t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWalletRelation')}</span>
                <span>{producerSigningWalletRelationText}</span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWalletKoin')}</span>
                <span>{formatDecimalValue(producerSigningWalletBalance?.koin, locale, 4, t('common.na'))}</span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWalletVhp')}</span>
                <span>{formatDecimalValue(producerSigningWalletBalance?.vhp, locale, 4, t('common.na'))}</span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWalletMana')}</span>
                <span>{formatDecimalValue(producerSigningWalletBalance?.mana, locale, 4, t('common.na'))}</span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.signingWalletStatus')}</span>
                <span>{producerSigningWalletStatusText}</span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.localPublicKey')}</span>
                <span className="mono" title={nodeProducerOverview.localPublicKey || t('common.na')}>
                  {nodeProducerOverview.localPublicKey ? shortHash(nodeProducerOverview.localPublicKey, 26, 16) : t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.registeredPublicKey')}</span>
                <span className="mono" title={nodeProducerOverview.registeredPublicKey || t('common.na')}>
                  {nodeProducerOverview.registeredPublicKey ? shortHash(nodeProducerOverview.registeredPublicKey, 26, 16) : t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.configPath')}</span>
                <span className="mono" title={nodeProducerOverview.configFilePath}>
                  {nodeProducerOverview.configFilePath}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.publicKeyPath')}</span>
                <span className="mono" title={nodeProducerOverview.localPublicKeyPath || t('common.na')}>
                  {nodeProducerOverview.localPublicKeyPath || t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.privateKeyPath')}</span>
                <span className="mono" title={nodeProducerOverview.localPrivateKeyPath || t('common.na')}>
                  {nodeProducerOverview.localPrivateKeyPath || t('common.na')}
                </span>
              </div>
              <div className="producer-detail-row">
                <span>{t('producer.dataSources')}</span>
                <span className="mono" title={`${nodeProducerOverview.rpcUrl} | ${nodeProducerOverview.priceSourceUrl}`}>
                  {nodeProducerOverview.rpcUrl} | {nodeProducerOverview.priceSourceUrl}
                </span>
              </div>
              <div className="producer-detail-note">
                {producerSigningWalletBalanceError || nodeProducerOverview.output || t('producer.setupHint')}
              </div>
            </div>
          ) : (
            <p className="node-empty">{nodeProducerLoading ? t('producer.loading') : t('producer.noOverview')}</p>
          )}
        </div>

        {(walletResultData || walletLoading) && (
          <div className="wallet-output">
            <div className="node-services-header">
              <h3>{walletResultTitle || t('producer.outputTitle')}</h3>
              <span>{walletLoading ? t('common.loading') : effectiveExplorerRpcUrl}</span>
            </div>
            <pre className="mono">{walletResultText || t('common.loading')}</pre>
          </div>
        )}
      </section>
      )}

      {activeTab === 'explorer' && (
      <>
      <section id="panel-explorer" className="overview-grid" aria-label={t('explorer.panelAria')} role="tabpanel" aria-labelledby="tab-explorer">
        <article className="stat-card">
          <span className="stat-label">{t('explorer.rpcLabel')}</span>
          <p className="stat-value mono" title={effectiveExplorerRpcUrl}>
            {effectiveExplorerRpcUrl}
          </p>
          <p className="stat-note">{formatExplorerRpcSourceKind(settings.rpcSource, language)}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.headLabel')}</span>
          <p className="stat-value">{head ? `#${head.height.toLocaleString(locale)}` : '...'}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.headTimeLabel')}</span>
          <p className="stat-value">{headBlockTimeText}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.lastSyncLabel')}</span>
          <p className="stat-value">{lastUpdateText}</p>
        </article>
      </section>

      <main className="table-panel" aria-busy={isInitialLoading}>
        <div className="table-panel-header">
          <div>
            <h2>{t('explorer.recentBlocksTitle')}</h2>
            <p>{t('explorer.recentBlocksDescription')}</p>
          </div>
          <div className="table-panel-tools">
            <label className="table-select">
              <span>{t('explorer.rpcSource')}</span>
              <select
                value={settings.rpcSource}
                onChange={(event) => {
                  const nextSource = normalizeExplorerRpcSource(event.target.value, settings.publicRpcUrls, settings.rpcSource)
                  setSettings((current) => ({ ...current, rpcSource: nextSource }))
                }}
              >
                <option value={LOCAL_RPC_SOURCE}>{t('rpc.mode.local')}</option>
                {settings.publicRpcUrls.map((rpcUrl) => (
                  <option key={rpcUrl} value={rpcUrl}>
                    {formatRpcDisplayUrl(rpcUrl)}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-meta">
              <span>{formatExplorerRpcSourceKind(settings.rpcSource, language)}</span>
              <span className="mono" title={effectiveExplorerRpcUrl}>
                {formatRpcDisplayUrl(effectiveExplorerRpcUrl)}
              </span>
              <span>{t('explorer.refreshMeta', { ms: settings.pollMs })}</span>
              <span>{t('explorer.rowsMeta', { count: settings.rowLimit })}</span>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="error-banner" role="alert">
            <strong>{t('explorer.rpcErrorBanner')}</strong> <span>{errorMessage}</span>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('explorer.col.height')}</th>
                <th>{t('explorer.col.blockId')}</th>
                <th>{t('explorer.col.producer')}</th>
                <th>{t('explorer.col.age')}</th>
                <th>{t('explorer.col.timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.blockId}
                  className={freshBlockIds.includes(row.blockId) ? 'is-fresh' : undefined}
                >
                  <td className="mono">#{row.height.toLocaleString(locale)}</td>
                  <td className="mono" title={`${row.blockId}\nPrev: ${row.previousId || t('common.na')}`}>
                    {shortHash(row.blockId, 18, 12)}
                  </td>
                  <td className="mono" title={row.signer || t('common.na')}>
                    {shortHash(row.signer, 14, 10)}
                  </td>
                  <td>{formatRelativeAge(row.timestampMs, nowMs)}</td>
                  <td>{formatDateTime(row.timestampMs, locale, t('common.na'))}</td>
                </tr>
              ))}

              {!isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {t('explorer.noBlocks')}
                  </td>
                </tr>
              )}

              {isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {t('explorer.connectingBlocks')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
      </>
      )}

      </div>

      <footer className="app-footer">
        <div className={`status-pill footer-status ${footerStatusClass}`.trim()} role="status" aria-live="polite">
          <div className="footer-status-main">
            <span className="status-dot" aria-hidden="true" />
            <span className="footer-status-text">{footerStatusText}</span>
          </div>
          {footerStatusMeta && <span className="footer-status-meta mono">{footerStatusMeta}</span>}
          {showChainSyncProgress && chainSyncPercent !== null && (
            <div className="footer-status-progress" aria-hidden="true">
              <span
                className="footer-status-progress-fill"
                style={{ width: `${Math.max(2, chainSyncPercent)}%` }}
              />
            </div>
          )}
        </div>
        <div className="app-version-badge" title={t('app.versionTitle', { version: appVersion })}>
          <span className="app-version-label">{t('common.version')}</span>
          <span className="mono">v{appVersion}</span>
        </div>
      </footer>
    </div>
  )
}
