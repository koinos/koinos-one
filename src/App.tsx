import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

const SETTINGS_STORAGE_KEY = 'knodel.explorer.settings.v1'
const NODE_SETTINGS_STORAGE_KEY = 'knodel.koinos-node.settings.v1'
const PUBLIC_RPC_URL = 'https://api.koinos.io/'
const LOCAL_NODE_RPC_FALLBACK_URL = 'http://127.0.0.1:8080/'
const DEFAULT_SETTINGS = {
  rpcMode: 'local' as ExplorerRpcMode,
  rpcUrl: PUBLIC_RPC_URL,
  pollMs: 3000,
  rowLimit: 20
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

type ExplorerSettings = {
  rpcMode: ExplorerRpcMode
  rpcUrl: string
  pollMs: number
  rowLimit: number
}

type ExplorerRpcMode = 'local' | 'public' | 'custom'

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
type AppTab = 'explorer' | 'node' | 'settings'
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

function formatDateTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 'N/A'
  return new Date(timestampMs).toLocaleString()
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

function normalizeRpcUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('La URL RPC no puede estar vacia')
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('La URL RPC debe usar http o https')
  }
  return parsed.toString()
}

function normalizeExplorerRpcMode(value: unknown): ExplorerRpcMode {
  return value === 'public' || value === 'custom' ? value : 'local'
}

function formatExplorerRpcMode(mode: ExplorerRpcMode): string {
  return mode === 'local' ? 'Local Node' : mode === 'public' ? 'Public RPC' : 'Custom RPC'
}

function normalizeBackupTarGzUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('La URL del backup no puede estar vacia')
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('La URL del backup debe usar http o https')
  }
  if (!parsed.pathname.endsWith('.tar.gz')) {
    throw new Error('La URL del backup debe apuntar a un archivo .tar.gz')
  }
  return parsed.toString()
}

function loadInitialSettings(): ExplorerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ExplorerSettings>
    return {
      rpcMode: normalizeExplorerRpcMode(parsed.rpcMode),
      rpcUrl: typeof parsed.rpcUrl === 'string' && parsed.rpcUrl ? parsed.rpcUrl : DEFAULT_SETTINGS.rpcUrl,
      pollMs: clamp(typeof parsed.pollMs === 'number' ? parsed.pollMs : DEFAULT_SETTINGS.pollMs, 1000, 30000),
      rowLimit: clamp(typeof parsed.rowLimit === 'number' ? parsed.rowLimit : DEFAULT_SETTINGS.rowLimit, 5, 50)
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
  if (settings.rpcMode === 'public') return PUBLIC_RPC_URL
  if (settings.rpcMode === 'custom') return settings.rpcUrl
  return resolveLocalNodeRpcUrl(nodeStatus)
}

function isNodeServiceRunning(service: KnodelKoinosNodeServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

function formatNodeServicePorts(service: KnodelKoinosNodeServiceStatus): string {
  if (!service.ports.length) return '-'
  return service.ports.map((port) => port.label || `${port.targetPort ?? '?'}${port.protocol ? `/${port.protocol}` : ''}`).join(', ')
}

function formatNodeServiceType(service: KnodelKoinosNodeServiceStatus): string {
  return service.runtimeType === 'native' ? 'Native' : 'Docker'
}

function formatNodeServiceVersion(service: KnodelKoinosNodeServiceStatus): string {
  return service.version?.trim() || 'Unknown'
}

function formatNodeRuntimeMode(mode: KnodelKoinosNodeServiceRuntime): string {
  return mode === 'native' ? 'Native' : 'Docker'
}

function formatNodeServiceTooltip(
  service: KnodelKoinosNodeServiceStatus,
  capabilities: NodeServiceCapabilities
): string {
  const lines = [`Service: ${service.name}`, `Runtime: ${service.runtimeName}`]

  if (service.version) {
    lines.push(`Version: ${service.version}`)
  }

  if (service.nativePid) {
    lines.push(`Managed PID: ${service.nativePid}`)
  }

  if (service.conflictPids.length > 0) {
    lines.push(`Conflicting PIDs: ${service.conflictPids.join(', ')}`)
  }

  lines.push(
    `Depends on: ${capabilities.dependencyNames.length > 0 ? capabilities.dependencyNames.join(', ') : 'none'}`
  )

  if (capabilities.profileDependentNames.length > 0) {
    lines.push(`Used by: ${capabilities.profileDependentNames.join(', ')}`)
  }

  if (capabilities.missingDependencyNames.length > 0) {
    lines.push(`Missing dependencies: ${capabilities.missingDependencyNames.join(', ')}`)
  }

  if (service.lastError) {
    lines.push(`Issue: ${service.lastError}`)
  }

  return lines.join('\n')
}

function normalizeStringList(values: string[]): string[] {
  return [...values].map((value) => value.trim()).filter(Boolean).sort()
}

function formatNodeServiceRuntimeDetail(service: KnodelKoinosNodeServiceStatus): string {
  if (service.nativePid) return `${service.runtimeName} · pid ${service.nativePid}`
  if (service.conflictPids.length > 0) return `${service.runtimeName} · conflict pid ${service.conflictPids.join(', ')}`
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

function formatPresetProfiles(preset: KnodelKoinosNodePreset): string {
  return preset.profiles.length ? preset.profiles.join(', ') : 'core'
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
  build: KnodelKoinosNodeNativeBuildStatus
): { label: string; className: string } {
  if (!build.supported) {
    return { label: 'Unsupported', className: 'is-unsupported' }
  }

  if (!build.repoExists) {
    return { label: 'Missing repo', className: 'is-blocked' }
  }

  if (!build.buildable) {
    return { label: 'Blocked', className: 'is-blocked' }
  }

  if (build.artifactExists) {
    return { label: 'Built', className: 'is-built' }
  }

  return { label: 'Pending', className: 'is-pending' }
}

function formatNativeBuildTooltip(build: KnodelKoinosNodeNativeBuildStatus): string {
  const lines = [`Service: ${build.serviceName}`]

  if (build.repoPath) lines.push(`Repo: ${build.repoPath}`)
  if (build.artifactPath) lines.push(`Artifact: ${build.artifactPath}`)
  if (build.note) lines.push(`Note: ${build.note}`)
  if (build.buildCommands.length > 0) {
    lines.push(`Build: ${build.buildCommands.join(' && ')}`)
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
      throw new Error('RPC result vacio')
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
    throw new Error(`RPC HTTP ${response.status}`)
  }

  const payload = (await response.json()) as JsonRpcResponse<T>
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC error')
  }
  if (payload.result === undefined) {
    throw new Error('RPC result vacio')
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
  settings: ExplorerSettings,
  signal: AbortSignal
): Promise<{ head: HeadSnapshot; rows: BlockRow[] }> {
  const headInfo = await rpcCall<HeadInfoResult>(settings.rpcUrl, 'chain.get_head_info', {}, signal)
  const headId = headInfo.head_topology?.id ?? ''
  const headHeight = safeParseInt(headInfo.head_topology?.height, 0)
  const headTimestampMs = safeParseInt(headInfo.head_block_time, 0)

  if (!headId || !headHeight) {
    throw new Error('Respuesta invalida de chain.get_head_info')
  }

  const ancestorStartHeight = Math.max(1, headHeight - settings.rowLimit + 1)

  const blockStore = await rpcCall<BlocksByHeightResult>(
    settings.rpcUrl,
    'block_store.get_blocks_by_height',
    {
      head_block_id: headId,
      ancestor_start_height: String(ancestorStartHeight),
      num_blocks: String(settings.rowLimit),
      return_block: true
    },
    signal
  )

  const rows = (blockStore.block_items ?? [])
    .map(mapBlockItem)
    .filter((row): row is BlockRow => row !== null)
    .sort((a, b) => b.height - a.height)

  return {
    head: { id: headId, height: headHeight, timestampMs: headTimestampMs },
    rows
  }
}

export function App() {
  const appVersion = window.knodel?.version?.trim() || '0.2.0'
  const [settings, setSettings] = useState<ExplorerSettings>(() => loadInitialSettings())
  const [nodeSettings, setNodeSettings] = useState<NodeManagerSettings>(() => loadInitialNodeSettings())
  const [rows, setRows] = useState<BlockRow[]>([])
  const [head, setHead] = useState<HeadSnapshot | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [freshBlockIds, setFreshBlockIds] = useState<string[]>([])
  const [draftRpcUrl, setDraftRpcUrl] = useState(settings.rpcUrl)
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
  const [nowMs, setNowMs] = useState(() => Date.now())
  const rowsRef = useRef<BlockRow[]>([])
  const nodeOutputRef = useRef(nodeOutput)
  const nodeLogsStreamIdRef = useRef<string | null>(null)
  const nodeLogsPreRef = useRef<HTMLPreElement | null>(null)
  const nodeRepoBootstrapAttemptsRef = useRef<Set<string>>(new Set())
  const hasNodeControls = Boolean(getKoinosNodeBridge())
  const composeFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, draftNodeComposeFile)
  const envFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, draftNodeEnvFile)
  const configFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, 'config/config.yml')

  useEffect(() => {
    setDraftRpcUrl(settings.rpcUrl)
    setDraftPollMs(String(settings.pollMs))
    setDraftRowLimit(String(settings.rowLimit))
  }, [settings.rpcUrl, settings.pollMs, settings.rowLimit])

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
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    window.localStorage.setItem(NODE_SETTINGS_STORAGE_KEY, JSON.stringify(nodeSettings))
  }, [nodeSettings])

  const effectiveExplorerRpcUrl = useMemo(
    () => resolveExplorerRpcUrl(settings, nodeStatus),
    [settings, nodeStatus]
  )

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
  }, [nodeServiceContextMenu, nodeFileEditorOpen, nodeLogsModalOpen, nodeConflictDialog, nodeBaseDirChangeDialog])

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
        setNodeLogsError(payload.message || 'Error en stream de logs')
        setNodeLogsStreamId(null)
        return
      }

      if (payload.type === 'end') {
        setNodeLogsLoading(false)
        setNodeLogsStreamId(null)
        if (typeof payload.code === 'number' && payload.code !== 0) {
          setNodeLogsError(`El stream de logs termino (code ${payload.code})`)
        }
      }
    })

    return unsubscribe
  }, [hasNodeControls])

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
        if (!result.ok) setNodePresetsError(result.output || 'No se pudieron leer los profiles del compose')
      } catch (error) {
        if (disposed) return
        setNodePresetsError(error instanceof Error ? error.message : 'No se pudieron leer los profiles del compose')
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
        setNodeError(error instanceof Error ? error.message : 'Error consultando el nodo local')
      } finally {
        if (!disposed) setNodeStatusLoading(false)
      }
    }

    void loadNodePresets()
    void loadInitialNodeStatus()

    return () => {
      disposed = true
    }
  }, [hasNodeControls, nodeSettings])

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
          setNodeNativeBuildsError(builds.output || 'No se pudo inspeccionar el workspace nativo')
        }
      } catch (error) {
        if (disposed) return
        setNodeNativeBuildsError(
          error instanceof Error ? error.message : 'No se pudo inspeccionar el workspace nativo'
        )
      } finally {
        if (!disposed) setNodeNativeBuildsLoading(false)
      }
    }

    void loadNativeBuilds()

    return () => {
      disposed = true
    }
  }, [hasNodeControls])

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
    const explorerSettings = {
      ...settings,
      rpcUrl: effectiveExplorerRpcUrl
    }

    const tick = async (initial: boolean) => {
      if (disposed || inFlight) return
      inFlight = true
      controller = new AbortController()

      if (initial) setIsInitialLoading(true)
      else setIsRefreshing(true)

      try {
        const snapshot = await fetchLatestBlocks(explorerSettings, controller.signal)
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
        setErrorMessage(error instanceof Error ? error.message : 'Error de conexion RPC')
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
    }, explorerSettings.pollMs)

    return () => {
      disposed = true
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [settings, effectiveExplorerRpcUrl])

  const statusText = useMemo(() => {
    if (errorMessage) return `Error RPC · ${errorMessage}`
    if (isInitialLoading) return `Conectando a ${formatExplorerRpcMode(settings.rpcMode)}...`
    if (isRefreshing) return 'Actualizando bloques...'
    return `Live · ${rows.length} bloques visibles`
  }, [errorMessage, isInitialLoading, isRefreshing, rows.length, settings.rpcMode])

  const lastUpdateText = lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : 'N/A'
  const headBlockTimeText = head ? formatDateTime(head.timestampMs) : 'N/A'
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
  const nodeAvailableRuntimeModes = nodeStatus?.availableRuntimeModes ?? ['docker', 'native']
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
    ? `${nodeNativeBuiltCount}/${nodeNativeSupportedCount} generados${
        nodeNativeBlockedCount > 0 ? ` · ${nodeNativeBlockedCount} bloqueados` : ''
      }${nodeNativePendingCount > 0 ? ` · ${nodeNativePendingCount} pendientes` : ''}`
    : nodeNativeBuildsLoading
      ? 'Inspeccionando repos locales...'
      : 'Sin estado'
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
        service.state === 'conflict' ? service.lastError || 'Hay otro proceso nativo usando este servicio' : null
      const restartRequiredReason =
        service.state === 'restart required'
          ? service.lastError || 'El servicio sigue activo con un BASEDIR distinto'
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
            ? `${restartRequiredReason} Usa Restart para aplicar el nuevo BASEDIR.`
            : null) ||
          (running
            ? 'El servicio ya esta activo'
            : missingDependencyNames.length > 0
              ? `Dependencias no activas: ${missingDependencyNames.join(', ')}`
              : null),
        stopBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : !running
            ? 'El servicio ya esta detenido'
            : profileDependentNames.length > 0
              ? `Servicios dependientes en el profile actual: ${profileDependentNames.join(', ')}`
              : null),
        restartBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : null) ||
          (!running && missingDependencyNames.length > 0
            ? `Dependencias no activas: ${missingDependencyNames.join(', ')}`
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
    ? `${selectedNodePreset.label} · ${selectedNodePreset.services.length} servicios${selectedNodePresetMatchesRunningState ? '' : ' · pendiente de aplicar'}`
    : `Custom · ${nodeCurrentProfiles.length ? nodeCurrentProfiles.join(', ') : 'core'}`
  const nodeStateText = !hasNodeControls
    ? 'Disponible solo en Electron'
    : nodeCloneLoading
      ? 'Sincronizando repo...'
    : nodeRestoreBackupLoading
      ? 'Restaurando backup blockchain...'
    : nodeNativeBuildActionLoading
      ? nodeNativeBuildActionLoading === 'all'
        ? 'Compilando servicios nativos...'
        : `Compilando ${nodeNativeBuildActionLoading}...`
    : nodeStatusLoading
      ? 'Consultando estado del nodo...'
      : nodePresetActionLoading
        ? 'Aplicando profile...'
      : nodeActionLoading
        ? `${nodeActionLoading === 'start' ? 'Iniciando' : 'Deteniendo'} nodo...`
        : nodeStatus
          ? nodeHasPartialOutage
            ? `Degraded (${nodeRunningCount}/${nodeServiceCount})`
            : nodeRunningCount > 0
              ? `Running (${nodeRunningCount}/${nodeServiceCount})`
              : nodeStatus.ok
                ? 'Stopped'
                : 'Error'
          : 'Sin estado'
  const nodeStatusClass = nodeError || nodeHasPartialOutage ? 'is-error' : nodeRunningCount > 0 ? 'is-live' : 'is-idle'
  const topbarStatusClass =
    activeTab === 'settings'
      ? 'is-idle'
      : activeTab === 'node'
      ? nodeStatusClass
      : errorMessage
        ? 'is-error'
        : 'is-live'
  const topbarStatusText =
    activeTab === 'settings' ? 'Settings · Configuracion' : activeTab === 'node' ? `Node · ${nodeStateText}` : statusText

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

    const output = status.output || 'No se pudo consultar el nodo'
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
      setNodeError(error instanceof Error ? error.message : 'Error consultando el nodo local')
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
        setNodeNativeBuildsError(builds.output || 'No se pudo inspeccionar el workspace nativo')
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : 'No se pudo inspeccionar el workspace nativo')
    } finally {
      setNodeNativeBuildsLoading(false)
    }
  }

  const switchNodeRuntimeMode = (runtimeMode: KnodelKoinosNodeServiceRuntime) => {
    const nextSettings = { ...nodeSettings, runtimeMode }
    setNodeSettings(nextSettings)
    setDraftNodeRuntimeMode(runtimeMode)
    setNodeError(null)
    setNodeOutput(`Runtime seleccionado: ${formatNodeRuntimeMode(runtimeMode)}`)
    void refreshNodeStatus(nextSettings)
  }

  const applyNodePreset = (preset: KnodelKoinosNodePreset) => {
    const nextProfiles = preset.profiles.join(',')
    const nextSettings = { ...nodeSettings, profiles: nextProfiles }
    setNodeSettings(nextSettings)
    setDraftNodeProfiles(nextProfiles)
    setFormError(null)
    setNodeError(null)
    setNodeOutput(`Profile seleccionado: ${preset.label} · profiles: ${formatPresetProfiles(preset)} · usa Apply para ajustar servicios`)
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
        setNodeError(result.output || result.status.output || `No se pudo aplicar el profile ${preset.label}`)
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
      setNodeError(error instanceof Error ? error.message : `Error aplicando profile ${preset.label}`)
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
        setNodeError(result.output || 'No se pudo sincronizar el repo de Koinos')
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Error ejecutando git refresh/clone')
    } finally {
      setNodeCloneLoading(false)
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
        setFormError(result.output || 'No se pudo seleccionar la carpeta para BASEDIR')
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
      setFormError(error instanceof Error ? error.message : 'No se pudo abrir el selector de carpetas')
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
        setNodeFileEditorError(result.output || `No se pudo leer ${kind} file`)
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : `Error leyendo ${kind} file`)
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
        setNodeFileEditorError(result.output || 'No se pudo guardar el archivo')
      } else {
        setNodeFileEditorLastSavedAt(Date.now())
        setNodeOutput(result.output || '')
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : 'Error guardando archivo')
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
      setNodeLogsError('Selecciona un servicio para ver logs')
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
        throw new Error(logsResult.output || `No se pudieron leer los logs de ${serviceId}`)
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
        setNodeLogsError(
          result.output || `No se pudo abrir el stream de logs para ${serviceId}. Mostrando snapshot actual.`
        )
        return
      }
      setNodeLogsService(serviceId)
      setNodeLogsStreamId(result.streamId)
      setNodeLogsLoading(false)
    } catch (error) {
      setNodeLogsStreamId(null)
      setNodeLogsError(error instanceof Error ? error.message : 'Error cargando logs')
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
        setNodeError(result.output || `No se pudo ${action === 'start' ? 'iniciar' : 'detener'} el nodo`)
      } else if (action === 'start' && nodeLogsModalOpen && nodeLogsService) {
        void refreshNodeLogs(nodeLogsService)
      }
    } catch (error) {
      setNodeError(
        error instanceof Error
          ? error.message
          : `Error al ${action === 'start' ? 'iniciar' : 'detener'} el nodo`
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
      message: 'Preparing backup restore...',
      updatedAt: Date.now()
    })

    try {
      const result = await bridge.restoreBackup(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || 'No se pudo restaurar el backup blockchain')
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Error restaurando el backup blockchain')
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
      message: 'Preparing restore + verify...',
      updatedAt: Date.now()
    })

    try {
      const result = await bridge.restoreBackupVerify(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || 'No se pudo restaurar y verificar el backup blockchain')
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Error restaurando y verificando el backup blockchain')
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
        setNodeError(startResult.output || startResult.status.output || 'No se pudo reiniciar el nodo en el nuevo BASEDIR')
      } else {
        setNodeError(null)
        setNodeBaseDirChangeDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'No se pudo reiniciar el nodo en el nuevo BASEDIR')
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
        setNodeError(result.output || result.status.output || 'No se pudo copiar el estado local al nuevo BASEDIR')
      } else {
        setNodeError(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'No se pudo copiar el estado local al nuevo BASEDIR')
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
            `No se pudo ${action === 'start' ? 'iniciar' : action === 'stop' ? 'detener' : 'reiniciar'} el servicio ${serviceId}`
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
              `Se detectaron procesos externos en conflicto para ${conflictedService.name}`
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
          : `Error al ${action === 'start' ? 'iniciar' : action === 'stop' ? 'detener' : 'reiniciar'} el servicio ${serviceId}`
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
      message: service.lastError || `Se detectaron procesos externos en conflicto para ${service.name}`
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
        setNodeError(result.output || result.status.output || 'No se pudo terminar el proceso conflictivo')
      } else {
        setNodeError(null)
        setNodeConflictDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Error terminando proceso conflictivo')
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
        setNodeNativeBuildsError(result.output || result.builds.output || 'No se pudo compilar el workspace nativo')
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : 'Error compilando servicios nativos')
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
          result.output || result.builds.output || `No se pudo compilar el servicio ${serviceId}`
        )
      }
    } catch (error) {
      setNodeNativeBuildsError(
        error instanceof Error ? error.message : `Error compilando el servicio ${serviceId}`
      )
    } finally {
      setNodeNativeBuildActionLoading(null)
    }
  }

  const applySettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    try {
      const rpcUrl = normalizeRpcUrl(draftRpcUrl)
      const pollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
      const rowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)
      const previousBaseDir = normalizeNodeBaseDirInput(nodeSettings.baseDir)
      const repoPath = draftNodeRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
      const composeFile = draftNodeComposeFile.trim() || DEFAULT_NODE_SETTINGS.composeFile
      const envFile = draftNodeEnvFile.trim() || DEFAULT_NODE_SETTINGS.envFile
      const baseDir = normalizeNodeBaseDirInput(draftNodeBaseDir)
      const profiles = parseProfilesCsv(draftNodeProfiles).join(',')
      const blockchainBackupUrl = normalizeBackupTarGzUrl(
        draftNodeBlockchainBackupUrl.trim() || DEFAULT_NODE_SETTINGS.blockchainBackupUrl
      )
      const runtimeMode = draftNodeRuntimeMode

      if (!repoPath) throw new Error('Repo path de Koinos no puede estar vacio')
      if (!composeFile) throw new Error('Compose file no puede estar vacio')
      if (!envFile) throw new Error('Env file no puede estar vacio')
      if (!baseDir) throw new Error('Base data dir no puede estar vacio')

      const baseDirValidation = await validateDraftNodeBaseDir(baseDir)
      if (!baseDirValidation.ok) {
        throw new Error(baseDirValidation.output || `No se puede usar BASEDIR ${baseDir}`)
      }

      setSettings((current) => ({ ...current, rpcUrl, pollMs, rowLimit }))
      setNodeSettings({ repoPath, composeFile, envFile, baseDir, profiles, blockchainBackupUrl, runtimeMode })
      setDraftNodeBaseDir(baseDir)
      const baseDirChanged = previousBaseDir !== baseDir
      const settingsSummary = baseDirChanged
        ? `Settings saved. BASEDIR changed from ${previousBaseDir} to ${baseDir}. Restart the node to use the new location.`
        : `Settings saved. BASEDIR: ${baseDir}`
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
      setFormError(error instanceof Error ? error.message : 'Configuracion invalida')
    }
  }

  const resetDefaults = () => {
    setDraftRpcUrl(DEFAULT_SETTINGS.rpcUrl)
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

      <header className="topbar">
        <div>
          <p className="eyebrow">KOINOS DESKTOP TOOLING</p>
          <h1>Knodel</h1>
          <p className="subtitle">Explorer, node operations and native runtime workflows in one desktop surface.</p>
        </div>
        <div className="topbar-actions">
          <div className="app-version-badge" title={`Knodel version ${appVersion}`}>
            <span className="app-version-label">Version</span>
            <span className="mono">v{appVersion}</span>
          </div>
        </div>
      </header>

      <nav className="tabs-bar" aria-label="Secciones de la aplicacion">
        <div className="tabs-list" role="tablist" aria-label="Tabs">
          <button
            id="tab-explorer"
            type="button"
            role="tab"
            aria-selected={activeTab === 'explorer'}
            aria-controls="panel-explorer"
            className={`tab-button ${activeTab === 'explorer' ? 'is-active' : ''}`.trim()}
            onClick={() => setActiveTab('explorer')}
          >
            Block Explorer
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
            Node
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
            Settings
          </button>
        </div>
        <div className={`status-pill ${topbarStatusClass}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{topbarStatusText}</span>
        </div>
      </nav>

      {activeTab === 'settings' && (
        <section
          id="panel-settings"
          className="settings-panel"
          aria-label="Settings"
          role="tabpanel"
          aria-labelledby="tab-settings"
        >
          <form className="settings-form" onSubmit={applySettings}>
            <div className="settings-header">
              <h2>Settings</h2>
              <p>Cambia RPC y parametros del nodo local sin reiniciar la app.</p>
            </div>

            <div className="settings-subheader">
              <h3>Explorer RPC</h3>
              <p>El origen activo se cambia en el combobox del explorador. Esta URL se usa cuando eliges `Custom RPC`.</p>
            </div>
            <label>
              Custom RPC URL
              <input
                type="url"
                value={draftRpcUrl}
                onChange={(event) => setDraftRpcUrl(event.target.value)}
                placeholder="https://api.koinos.io"
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="settings-row">
              <label>
                Refresh (ms)
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
                Rows
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
              <h3>Koinos Node</h3>
              <p>Controla el runtime Docker o Native desde Electron. En `native`, todos los servicios se ejecutan localmente.</p>
            </div>

            <label>
              Koinos Repo Path
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
                {nodeCloneLoading ? 'Refreshing repo...' : 'Refresh Koinos Repo'}
              </button>
              <span className="settings-inline-help mono">
                Primer uso: hace `git clone`; despues: `git fetch --all --prune` + `git pull --ff-only`
              </span>
            </div>

            <div className="settings-row settings-row-3">
              <label>
                Compose File
                <input
                  type="text"
                  value={draftNodeComposeFile}
                  onChange={(event) => setDraftNodeComposeFile(event.target.value)}
                  placeholder="docker-compose.yml"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-path-preview mono" title={composeFileDisplayPath || draftNodeComposeFile}>
                  {composeFileDisplayPath || '(path vacio)'}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void openNodeFileEditor('compose')
                  }}
                  disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
                >
                  View / Edit
                </button>
              </label>

              <label>
                Env File
                <input
                  type="text"
                  value={draftNodeEnvFile}
                  onChange={(event) => setDraftNodeEnvFile(event.target.value)}
                  placeholder=".env"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-path-preview mono" title={envFileDisplayPath || draftNodeEnvFile}>
                  {envFileDisplayPath || '(path vacio)'}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void openNodeFileEditor('env')
                  }}
                  disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
                >
                  View / Edit
                </button>
              </label>

              <label>
                Profiles (csv)
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
              <h3>Blockchain Backup</h3>
              <p>URL del snapshot `.tar.gz` que se usara mas adelante para restaurar o precargar el estado de la cadena.</p>
            </div>

            <label>
              Backup URL (tar.gz)
              <input
                type="url"
                value={draftNodeBlockchainBackupUrl}
                onChange={(event) => setDraftNodeBlockchainBackupUrl(event.target.value)}
                placeholder="http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz"
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <label>
              Config File (`config/config.yml`)
              <span className="settings-path-preview mono" title={configFileDisplayPath || 'config/config.yml'}>
                {configFileDisplayPath || '(path vacio)'}
              </span>
              <button
                type="button"
                className="ghost-button settings-inline-button"
                onClick={() => {
                  void openNodeFileEditor('config')
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                View / Edit
              </button>
            </label>

            <label>
              Base Data Dir (`BASEDIR`)
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
                        setFormError(result.output || `No se puede usar BASEDIR ${normalized}`)
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
                  {nodeBaseDirPickerLoading ? 'Opening...' : 'Browse...'}
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
                  ? 'Comprobando permisos de escritura del BASEDIR y del volumen para el restore temporal...'
                  : nodeBaseDirValidation?.message ||
                    'Puedes seleccionar una carpeta local o un volumen externo SSD para mover ahi el estado del blockchain.'}
              </span>
            </label>

            <label>
              Runtime
              <select
                value={draftNodeRuntimeMode}
                onChange={(event) => setDraftNodeRuntimeMode(event.target.value === 'native' ? 'native' : 'docker')}
              >
                <option value="docker">Docker</option>
                <option value="native">Native</option>
              </select>
              <span className="settings-inline-help">
                `native` ejecuta todos los servicios localmente, sin `docker compose`.
              </span>
            </label>

            {formError && <p className="form-error">{formError}</p>}

            <div className="settings-actions">
              <button type="button" className="ghost-button" onClick={resetDefaults}>
                Reset
              </button>
              <button type="submit" className="primary-button">
                Guardar y reconectar
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
                <p className="eyebrow">FILE EDITOR</p>
                <h3 id="node-file-editor-title" className="file-editor-title">
                  {nodeFileEditorKind === 'compose'
                    ? 'Compose File'
                    : nodeFileEditorKind === 'env'
                      ? 'Env File'
                      : 'Config File (config.yml)'}
                </h3>
                <p className="file-editor-path mono" title={nodeFileEditorPath}>
                  {nodeFileEditorPath || '(sin path)'}
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setNodeFileEditorOpen(false)}
              >
                Close
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
                {nodeFileEditorLoading ? 'Loading...' : 'Reload'}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void saveNodeManagedFile()
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {nodeFileEditorSaving ? 'Saving...' : 'Save'}
              </button>
              <span className="file-editor-meta">
                {nodeFileEditorLastSavedAt
                  ? `Guardado ${new Date(nodeFileEditorLastSavedAt).toLocaleTimeString()}`
                  : nodeFileEditorLoading
                    ? 'Cargando archivo...'
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
              aria-label={`${nodeFileEditorKind} file content`}
            />
          </section>
        </div>
      )}

      {activeTab === 'node' && (
      <section id="panel-node" className="node-panel" aria-label="Koinos node control" role="tabpanel" aria-labelledby="tab-node">
        <div className="node-panel-header">
          <div>
            <h2>Local Koinos Node ({formatNodeRuntimeMode(nodeRuntimeMode)})</h2>
            <p>
              {nodeRuntimeMode === 'native'
                ? 'Ejecuta los servicios Koinos como procesos locales usando los binarios y runtimes nativos del sistema.'
                : 'Arranca y para el nodo desde la app usando Docker Compose sobre el repo local de Koinos.'}
            </p>
          </div>
          <div className="node-panel-actions">
            <label className="node-runtime-select">
              <span>Runtime</span>
              <select
                value={nodeRuntimeMode}
                onChange={(event) => switchNodeRuntimeMode(event.target.value === 'native' ? 'native' : 'docker')}
                disabled={!hasNodeControls || nodeBusy || nodeStatusLoading}
              >
                {nodeAvailableRuntimeModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatNodeRuntimeMode(mode)}
                  </option>
                ))}
              </select>
            </label>
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
              Refresh
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void cloneKoinosRepo(nodeSettings.repoPath)
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeCloneLoading ? 'Refreshing repo...' : 'Refresh Koinos Repo'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void runNodeRestoreBackup()
              }}
              disabled={!hasNodeControls || nodeBusy}
              title={nodeSettings.blockchainBackupUrl}
            >
              {nodeRestoreBackupLoading ? 'Restoring backup...' : 'Restore Backup'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                void runNodeRestoreBackupVerify()
              }}
              disabled={!hasNodeControls || nodeBusy}
              title={`${nodeSettings.blockchainBackupUrl}\nRequiere jsonrpc en el profile actual`}
            >
              {nodeRestoreBackupVerifyLoading ? 'Restoring + verifying...' : 'Restore + Verify'}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void runNodeAction('start')
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeActionLoading === 'start' ? 'Starting...' : 'Start Node'}
            </button>
            <button
              type="button"
              className="ghost-button danger-button"
              onClick={() => {
                void runNodeAction('stop')
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeActionLoading === 'stop' ? 'Stopping...' : 'Stop Node'}
            </button>
          </div>
        </div>

        {!hasNodeControls && (
          <div className="node-warning" role="note">
            Este control solo esta disponible dentro de Electron (no en `npm run dev:renderer`).
          </div>
        )}

        {hasNodeControls && nodeStatus && !nodeStatus.ok && /repo path not found/i.test(nodeStatus.output) && (
          <div className="node-warning" role="note">
            No existe el repo de Koinos en <code>{nodeSettings.repoPath}</code>. La app intentara clonarlo automaticamente en el primer arranque; tambien puedes usar <strong>Refresh Koinos Repo</strong> para clonar o actualizar el workspace local.
          </div>
        )}

        {hasNodeControls && nodeHasPartialOutage && (
          <div className="node-warning" role="note">
            Servicios no activos: <strong>{nodeStoppedServices.map((service) => service.name).join(', ')}</strong>.
            {nodeRuntimeMode === 'native'
              ? ' El runtime nativo responde, pero el nodo no esta totalmente sano.'
              : ' El compose responde, pero el nodo no esta totalmente sano.'}
          </div>
        )}

        <div className="node-presets">
          <div className="node-services-header">
            <h3>Profiles</h3>
            <span>{nodePresetSummaryText}</span>
          </div>

          {nodePresetsError && (
            <div className="node-inline-error node-presets-error" role="alert">
              {nodePresetsError}
            </div>
          )}

          {nodePresetsLoading ? (
            <p className="node-empty">Cargando profiles desde el compose...</p>
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
                    <span className="node-preset-profiles mono">{formatPresetProfiles(preset)}</span>
                    <span className="node-preset-description">{preset.description}</span>
                    <span className="node-preset-services mono">{preset.services.join(', ') || 'sin servicios'}</span>
                    <span className={`node-preset-state ${matchesRunningState ? 'is-live' : 'is-pending'}`.trim()}>
                      {matchesRunningState ? 'Estado actual: coincide con el nodo' : 'Estado actual: pendiente de aplicar'}
                    </span>
                    <div className="node-preset-actions">
                      <button
                        type="button"
                        className="ghost-button node-preset-button"
                        onClick={() => applyNodePreset(preset)}
                        disabled={!hasNodeControls || nodeBusy}
                      >
                        {selected ? 'Selected' : 'Use profile'}
                      </button>
                      <button
                        type="button"
                        className="primary-button node-preset-button"
                        onClick={() => {
                          void reconcileNodePreset(preset)
                        }}
                        disabled={!hasNodeControls || nodeBusy}
                      >
                        {nodePresetActionLoading === preset.id ? 'Applying...' : 'Apply'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <p className="node-empty">No se detectaron profiles en el compose.</p>
          )}
        </div>

        {nodeError && (
          <div className="error-banner node-error-banner" role="alert">
            <strong>{formatNodeRuntimeMode(nodeRuntimeMode)}:</strong> <span>{nodeError}</span>
          </div>
        )}

        <div className="node-services">
          <div className="node-services-header">
            <h3>Services</h3>
            <span>{nodeServiceCount} detectados · click derecho o acciones a la derecha</span>
          </div>

          {nodeServiceCount > 0 ? (
            <div className="node-services-table-wrap">
              <table className="node-services-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Port</th>
                    <th>Last Error</th>
                    <th>Type</th>
                    <th>Logs</th>
                    <th>Start</th>
                    <th>Restart</th>
                    <th>Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {nodeServices.map((service) => {
                    const capabilities = nodeServiceCapabilities.get(service.id)
                    if (!capabilities) return null

                    const running = capabilities.running
                    const statusTone =
                      service.state === 'conflict' ? 'is-conflict' : running ? 'is-running' : 'is-stopped'
                    const serviceTooltip = formatNodeServiceTooltip(service, capabilities)
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
                            <span className="node-service-secondary mono">{formatNodeServiceRuntimeDetail(service)}</span>
                          </div>
                          <div className="node-service-meta">
                            <span>
                              <span className="node-service-meta-label">Version</span>{' '}
                              <span className="mono">{formatNodeServiceVersion(service)}</span>
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
                              Resolve conflict
                            </button>
                          )}
                        </td>
                        <td>
                          <span className="node-service-runtime-tag">{formatNodeServiceType(service)}</span>
                        </td>
                        <td className="node-service-action-cell">
                          <button
                            type="button"
                            className="ghost-button node-service-inline-button"
                            onClick={() => openServiceLogsModal(service.id)}
                            disabled={!hasNodeControls || nodeBusy}
                          >
                            Logs
                          </button>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.startBlockedReason || 'Iniciar servicio'}
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
                                ? 'Starting...'
                                : 'Start'}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.restartBlockedReason || 'Reiniciar servicio'}
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
                                ? 'Restarting...'
                                : 'Restart'}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.stopBlockedReason || 'Detener servicio'}
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
                                ? 'Stopping...'
                                : 'Stop'}
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
              {nodeStatusLoading ? 'Consultando servicios...' : 'No hay servicios activos para esta configuracion.'}
            </p>
          )}
        </div>

        {nodeBackupProgress && (
          <div className="node-backup-progress" role="status" aria-live="polite">
            <div className="node-services-header">
              <h3>{nodeBackupProgress.action === 'restore-backup' ? 'Restore Backup' : 'Restore + Verify'}</h3>
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
              phase: {nodeBackupProgress.phase} · updated {new Date(nodeBackupProgress.updatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}

        {nodeOutput && (
          <div className="node-output">
            <div className="node-services-header">
              <h3>Command Output</h3>
            </div>
            <pre>{nodeOutput}</pre>
          </div>
        )}

        {nodeServiceContextMenu && (
          <>
            <button
              type="button"
              className="context-menu-backdrop"
              aria-label="Close service menu"
              onClick={() => setNodeServiceContextMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                setNodeServiceContextMenu(null)
              }}
            />
            <div
              className="service-context-menu"
              role="menu"
              aria-label={`Menu for ${nodeContextService?.name ?? nodeServiceContextMenu.serviceId}`}
              style={{ left: nodeServiceContextMenu.x, top: nodeServiceContextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => openServiceLogsModal(nodeServiceContextMenu.serviceId)}
              >
                Show logs
              </button>
              {nodeContextService?.state === 'conflict' && nodeContextService && canKillNodeConflict(nodeContextService) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openNodeConflictDialog(nodeContextService)}
                >
                  Kill conflicting process
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'start')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.startBlockedReason !== null}
                title={nodeContextServiceCapabilities?.startBlockedReason || 'Iniciar servicio'}
              >
                Start service
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'restart')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.restartBlockedReason !== null}
                title={nodeContextServiceCapabilities?.restartBlockedReason || 'Reiniciar servicio'}
              >
                Restart service
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'stop')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.stopBlockedReason !== null}
                title={nodeContextServiceCapabilities?.stopBlockedReason || 'Detener servicio'}
              >
                Stop service
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
                  <p className="eyebrow">PROCESS CONFLICT</p>
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
                  Close
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  Knodel ha detectado procesos nativos externos usando el mismo `baseDir`. Puedes intentar terminarlos
                  desde aqui antes de volver a arrancar el servicio.
                </p>
                <pre className="conflict-modal-pids mono">{nodeConflictDialog.conflictPids.join(', ')}</pre>
                <div className="conflict-modal-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setNodeConflictDialog(null)}
                    disabled={Boolean(nodeConflictKillLoading)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void runNodeKillConflict()
                    }}
                    disabled={!hasNodeControls || nodeBusy || Boolean(nodeConflictKillLoading)}
                  >
                    {nodeConflictKillLoading === nodeConflictDialog.serviceId ? 'Killing...' : 'Kill conflicting process'}
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
                  <p className="eyebrow">BASEDIR CHANGED</p>
                  <h3 id="node-basedir-change-title" className="log-modal-title">
                    Settings saved
                  </h3>
                  <p className="log-modal-meta">
                    The node will only use the new location after a restart or after you migrate data to the new BASEDIR.
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeBaseDirChangeDialog(null)}
                  disabled={nodeBaseDirCopyLoading || nodeBaseDirRestartLoading}
                >
                  Close
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  Previous: <span className="mono">{nodeBaseDirChangeDialog.previousBaseDir}</span>
                  <br />
                  New: <span className="mono">{nodeBaseDirChangeDialog.nextBaseDir}</span>
                </p>
                <p className="conflict-modal-copy">
                  {nodeBaseDirChangeDialog.nodeWasRunning
                    ? 'Knodel detecto servicios activos. Necesitas reiniciarlos para que usen el nuevo BASEDIR.'
                    : 'No habia servicios activos, pero el nuevo BASEDIR aun no tiene estado local a menos que copies datos o lances un restore.'}
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
                    {nodeBaseDirCopyLoading ? 'Copying...' : 'Copy local state'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setNodeBaseDirChangeDialog(null)
                      void runNodeRestoreBackup()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    Restore backup
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void restartNodeForNewBaseDir()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeBaseDirRestartLoading ? 'Restarting...' : 'Restart node now'}
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
                  <p className="eyebrow">SERVICE LOGS</p>
                  <h3 id="service-log-modal-title" className="log-modal-title mono">
                    {nodeLogsTargetService?.name ?? nodeLogsService}
                  </h3>
                  <p className="log-modal-meta">
                    {nodeLogsStreamId
                      ? `Streaming en tiempo real (${nodeRuntimeMode === 'native' ? 'native process logs' : 'docker compose logs -f'})`
                      : 'Conectando stream...'}
                    {nodeLogsLastRefreshAt ? ` · Ultima actividad ${new Date(nodeLogsLastRefreshAt).toLocaleTimeString()}` : ''}
                  </p>
                </div>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeLogsModalOpen(false)}
                >
                  Close
                </button>
              </header>

              <div className="node-logs-controls log-modal-toolbar">
                <label className="node-field node-field-tail">
                  <span>Tail</span>
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
                  {nodeLogsLoading ? 'Connecting...' : 'Reconnect stream'}
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
                    ? 'Conectando al stream de logs...'
                    : 'Esperando logs...'}
              </pre>
            </section>
          </div>
        )}
      </section>
      )}

      {activeTab === 'explorer' && (
      <>
      <section id="panel-explorer" className="overview-grid" aria-label="Resumen de sincronizacion" role="tabpanel" aria-labelledby="tab-explorer">
        <article className="stat-card">
          <span className="stat-label">RPC</span>
          <p className="stat-value mono" title={effectiveExplorerRpcUrl}>
            {effectiveExplorerRpcUrl}
          </p>
          <p className="stat-note">{formatExplorerRpcMode(settings.rpcMode)}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">Head</span>
          <p className="stat-value">{head ? `#${head.height.toLocaleString()}` : '...'}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">Head Time</span>
          <p className="stat-value">{headBlockTimeText}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">Ultima sync</span>
          <p className="stat-value">{lastUpdateText}</p>
        </article>
      </section>

      <main className="table-panel" aria-busy={isInitialLoading}>
        <div className="table-panel-header">
          <div>
            <h2>Bloques recientes</h2>
            <p>Streaming por polling sobre `chain.get_head_info` y `block_store.get_blocks_by_height`.</p>
          </div>
          <div className="table-panel-tools">
            <label className="table-select">
              <span>RPC Source</span>
              <select
                value={settings.rpcMode}
                onChange={(event) => {
                  const nextMode = normalizeExplorerRpcMode(event.target.value)
                  setSettings((current) => ({ ...current, rpcMode: nextMode }))
                }}
              >
                <option value="local">Local Node</option>
                <option value="public">Public RPC</option>
                <option value="custom">Custom RPC</option>
              </select>
            </label>
            <div className="table-meta">
              <span>{formatExplorerRpcMode(settings.rpcMode)}</span>
              <span className="mono" title={effectiveExplorerRpcUrl}>
                {effectiveExplorerRpcUrl}
              </span>
              <span>Refresh: {settings.pollMs}ms</span>
              <span>Rows: {settings.rowLimit}</span>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="error-banner" role="alert">
            <strong>RPC error:</strong> <span>{errorMessage}</span>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Height</th>
                <th>Block ID</th>
                <th>Producer</th>
                <th>Age</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.blockId}
                  className={freshBlockIds.includes(row.blockId) ? 'is-fresh' : undefined}
                >
                  <td className="mono">#{row.height.toLocaleString()}</td>
                  <td className="mono" title={`${row.blockId}\nPrev: ${row.previousId || 'N/A'}`}>
                    {shortHash(row.blockId, 18, 12)}
                  </td>
                  <td className="mono" title={row.signer || 'N/A'}>
                    {shortHash(row.signer, 14, 10)}
                  </td>
                  <td>{formatRelativeAge(row.timestampMs, nowMs)}</td>
                  <td>{formatDateTime(row.timestampMs)}</td>
                </tr>
              ))}

              {!isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No se recibieron bloques desde el RPC configurado.
                  </td>
                </tr>
              )}

              {isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    Conectando al RPC y cargando bloques recientes...
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
  )
}
