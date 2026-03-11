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
  DEFAULT_NODE_SETTINGS,
  DEFAULT_PUBLIC_RPC_URLS,
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  LOCAL_RPC_SOURCE,
  NODE_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY
} from './constants'
import type {
  AnsiStyleState,
  AnsiTextSegment,
  BlockRow,
  BlockStoreItem,
  BlocksByHeightResult,
  ExplorerRpcSource,
  ExplorerSettings,
  HeadInfoResult,
  HeadSnapshot,
  JsonRpcResponse,
  NodeManagerSettings,
  NodeServiceCapabilities
} from './types'

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

export function loadInitialSettings(): ExplorerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
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
      pollMs: clamp(typeof parsed.pollMs === 'number' ? parsed.pollMs : DEFAULT_SETTINGS.pollMs, 1000, 30000),
      rowLimit: clamp(typeof parsed.rowLimit === 'number' ? parsed.rowLimit : DEFAULT_SETTINGS.rowLimit, 5, 50),
      producerAdvancedMode: parsed.producerAdvancedMode === true,
      dashboardProducerWindowBlocks: normalizeDashboardProducerWindowBlocks(parsed.dashboardProducerWindowBlocks),
      dashboardRefreshSeconds: normalizeDashboardRefreshSeconds(parsed.dashboardRefreshSeconds)
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function loadInitialNodeSettings(): NodeManagerSettings {
  try {
    const raw = window.localStorage.getItem(NODE_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NODE_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<NodeManagerSettings>
    const profiles =
      typeof parsed.profiles === 'string'
        ? expandNodeProfiles(parseProfilesCsv(parsed.profiles)).join(',')
        : DEFAULT_NODE_SETTINGS.profiles
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
      profiles,
      blockchainBackupUrl:
        typeof parsed.blockchainBackupUrl === 'string' && parsed.blockchainBackupUrl.trim()
          ? parsed.blockchainBackupUrl
          : DEFAULT_NODE_SETTINGS.blockchainBackupUrl,
      runtimeMode: 'native'
    }
  } catch {
    return { ...DEFAULT_NODE_SETTINGS }
  }
}

export function loadInitialLanguage(): AppLanguage {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
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
  if (segments.at(-1) === '.koinos') return normalized
  return `${normalized}/.koinos`
}

export function toNodeApiSettings(settings: NodeManagerSettings): KnodelKoinosNodeSettings {
  return {
    repoPath: settings.repoPath.trim(),
    composeFile: settings.composeFile.trim(),
    envFile: settings.envFile.trim(),
    baseDir: normalizeNodeBaseDirInput(settings.baseDir),
    profiles: expandNodeProfiles(parseProfilesCsv(settings.profiles)),
    blockchainBackupUrl: settings.blockchainBackupUrl.trim(),
    runtimeMode: 'native'
  }
}

export function getKoinosNodeBridge() {
  return window.knodel?.koinosNode
}

export function getAppConfigBridge() {
  return window.knodel?.appConfig
}

export function getWalletBridge() {
  return window.knodel?.wallet
}

export function looksLikeNodeErrorOutput(output: string): boolean {
  return /cannot connect to the docker daemon|spawn docker ENOENT|repo path not found|compose file not found|env file not found|missing config dir|no se pudo consultar docker compose|error consultando docker compose/i.test(
    output
  )
}

export function nodeServicePortByTarget(
  service: KnodelKoinosNodeServiceStatus | null | undefined,
  targetPort: number
): KnodelKoinosNodeServicePort | null {
  return service?.ports.find((port) => port.targetPort === targetPort) ?? null
}

export function normalizeNodeRpcHost(host: string | null | undefined, fallback = '127.0.0.1'): string {
  const value = host?.trim()
  return value && value !== '0.0.0.0' && value !== '::' ? value : fallback
}

export function resolveLocalNodeRpcUrl(nodeStatus: KnodelKoinosNodeStatus | null): string {
  const jsonrpcService = nodeStatus?.services.find((service) => service.id === 'jsonrpc') ?? null
  const jsonrpcPort = nodeServicePortByTarget(jsonrpcService, 8080)
  const host = normalizeNodeRpcHost(jsonrpcPort?.host)
  const port = jsonrpcPort?.publishedPort ?? 8080
  return `http://${host}:${port}/`
}

export function resolveProducerRpcUrl(nodeStatus: KnodelKoinosNodeStatus | null, publicRpcUrl: string): string {
  const jsonrpcService = nodeStatus?.services.find((service) => service.id === 'jsonrpc') ?? null
  const contractMetaStoreService = nodeStatus?.services.find((service) => service.id === 'contract_meta_store') ?? null
  return jsonrpcService &&
    isNodeServiceRunning(jsonrpcService) &&
    contractMetaStoreService &&
    isNodeServiceRunning(contractMetaStoreService)
    ? resolveLocalNodeRpcUrl(nodeStatus)
    : publicRpcUrl
}

export function resolveExplorerRpcUrl(settings: ExplorerSettings, nodeStatus: KnodelKoinosNodeStatus | null): string {
  if (settings.rpcSource !== LOCAL_RPC_SOURCE) return settings.rpcSource
  return resolveLocalNodeRpcUrl(nodeStatus)
}

export function isNodeServiceRunning(service: KnodelKoinosNodeServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

export function formatNodeServicePorts(service: KnodelKoinosNodeServiceStatus): string {
  if (!service.ports.length) return '-'
  return service.ports
    .map((port) => port.label || `${port.targetPort ?? '?'}${port.protocol ? `/${port.protocol}` : ''}`)
    .join(', ')
}

export function formatNodeServiceType(_service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
  return translate(language, 'common.runtimeNative')
}

export function formatNodeServiceVersion(service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
  return service.version?.trim() || translate(language, 'common.unknown')
}

export function formatNodeRuntimeMode(_mode: KnodelKoinosNodeServiceRuntime, language: AppLanguage): string {
  return translate(language, 'common.runtimeNative')
}

export function formatNodeServiceTooltip(
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

export function normalizeStringList(values: string[]): string[] {
  return [...values].map((value) => value.trim()).filter(Boolean).sort()
}

const IMPLIED_NODE_PROFILES: Record<string, string[]> = {
  block_producer: ['jsonrpc', 'contract_meta_store']
}

export function expandNodeProfiles(profiles: string[]): string[] {
  const pending = normalizeStringList(profiles)
  const expanded: string[] = []
  const seen = new Set<string>()

  while (pending.length > 0) {
    const profile = pending.shift()
    if (!profile || seen.has(profile)) continue
    seen.add(profile)
    expanded.push(profile)

    for (const impliedProfile of IMPLIED_NODE_PROFILES[profile] ?? []) {
      if (!seen.has(impliedProfile)) pending.push(impliedProfile)
    }
  }

  return expanded.sort()
}

export function formatNodeServiceRuntimeDetail(service: KnodelKoinosNodeServiceStatus, language: AppLanguage): string {
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

export function canKillNodeConflict(service: KnodelKoinosNodeServiceStatus): boolean {
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

export function formatPresetProfiles(preset: KnodelKoinosNodePreset, language: AppLanguage): string {
  return preset.profiles.length ? preset.profiles.join(', ') : translate(language, 'common.core')
}

export function basenameFromPath(input: string | null): string {
  if (!input) return '-'
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || input
}

export function formatNativeBuildSystem(buildSystem: KnodelKoinosNativeBuildSystem | null): string {
  if (buildSystem === 'cmake') return 'CMake'
  if (buildSystem === 'go') return 'Go'
  if (buildSystem === 'yarn') return 'Yarn'
  return '-'
}

export function formatNativeBuildStatus(
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

export function formatNativeBuildTooltip(build: KnodelKoinosNodeNativeBuildStatus, language: AppLanguage): string {
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
