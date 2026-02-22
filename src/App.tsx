import { useEffect, useMemo, useRef, useState } from 'react'

const SETTINGS_STORAGE_KEY = 'knodel.explorer.settings.v1'
const DEFAULT_SETTINGS = {
  rpcUrl: 'https://api.koinos.io',
  pollMs: 3000,
  rowLimit: 20
} as const

type ExplorerSettings = {
  rpcUrl: string
  pollMs: number
  rowLimit: number
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

function normalizeRpcUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('La URL RPC no puede estar vacia')
  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('La URL RPC debe usar http o https')
  }
  return parsed.toString()
}

function loadInitialSettings(): ExplorerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ExplorerSettings>
    return {
      rpcUrl: typeof parsed.rpcUrl === 'string' && parsed.rpcUrl ? parsed.rpcUrl : DEFAULT_SETTINGS.rpcUrl,
      pollMs: clamp(typeof parsed.pollMs === 'number' ? parsed.pollMs : DEFAULT_SETTINGS.pollMs, 1000, 30000),
      rowLimit: clamp(typeof parsed.rowLimit === 'number' ? parsed.rowLimit : DEFAULT_SETTINGS.rowLimit, 5, 50)
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<T> {
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
  const [settings, setSettings] = useState<ExplorerSettings>(() => loadInitialSettings())
  const [rows, setRows] = useState<BlockRow[]>([])
  const [head, setHead] = useState<HeadSnapshot | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [freshBlockIds, setFreshBlockIds] = useState<string[]>([])
  const [draftRpcUrl, setDraftRpcUrl] = useState(settings.rpcUrl)
  const [draftPollMs, setDraftPollMs] = useState(String(settings.pollMs))
  const [draftRowLimit, setDraftRowLimit] = useState(String(settings.rowLimit))
  const [nowMs, setNowMs] = useState(() => Date.now())
  const rowsRef = useRef<BlockRow[]>([])

  useEffect(() => {
    setDraftRpcUrl(settings.rpcUrl)
    setDraftPollMs(String(settings.pollMs))
    setDraftRowLimit(String(settings.rowLimit))
  }, [settings])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

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
        const snapshot = await fetchLatestBlocks(settings, controller.signal)
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
    }, settings.pollMs)

    return () => {
      disposed = true
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [settings])

  const statusText = useMemo(() => {
    if (errorMessage) return `Error RPC · ${errorMessage}`
    if (isInitialLoading) return 'Conectando a Koinos RPC...'
    if (isRefreshing) return 'Actualizando bloques...'
    return `Live · ${rows.length} bloques visibles`
  }, [errorMessage, isInitialLoading, isRefreshing, rows.length])

  const lastUpdateText = lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : 'N/A'
  const headBlockTimeText = head ? formatDateTime(head.timestampMs) : 'N/A'

  const applySettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    try {
      const rpcUrl = normalizeRpcUrl(draftRpcUrl)
      const pollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
      const rowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)

      setSettings({ rpcUrl, pollMs, rowLimit })
      setIsSettingsOpen(false)
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
    setFormError(null)
  }

  return (
    <div className="app-shell">
      <div className="app-background" aria-hidden="true" />

      <header className="topbar">
        <div>
          <p className="eyebrow">KOINOS</p>
          <h1>Knodel Block Explorer</h1>
          <p className="subtitle">Primera pagina en tiempo real usando JSON-RPC</p>
        </div>

        <div className="topbar-actions">
          <div className={`status-pill ${errorMessage ? 'is-error' : 'is-live'}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{statusText}</span>
          </div>

          <button
            type="button"
            className="settings-button"
            onClick={() => {
              setIsSettingsOpen((open) => !open)
              setFormError(null)
            }}
            aria-expanded={isSettingsOpen}
            aria-controls="settings-panel"
          >
            Settings
          </button>
        </div>
      </header>

      <section className="overview-grid" aria-label="Resumen de sincronizacion">
        <article className="stat-card">
          <span className="stat-label">RPC</span>
          <p className="stat-value mono">{settings.rpcUrl}</p>
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

      {isSettingsOpen && (
        <section id="settings-panel" className="settings-panel" aria-label="Settings">
          <form className="settings-form" onSubmit={applySettings}>
            <div className="settings-header">
              <h2>Settings</h2>
              <p>Cambia el RPC y la frecuencia de refresco sin reiniciar la app.</p>
            </div>

            <label>
              RPC URL
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

      <main className="table-panel" aria-busy={isInitialLoading}>
        <div className="table-panel-header">
          <div>
            <h2>Bloques recientes</h2>
            <p>Streaming por polling sobre `chain.get_head_info` y `block_store.get_blocks_by_height`.</p>
          </div>
          <div className="table-meta">
            <span>Refresh: {settings.pollMs}ms</span>
            <span>Rows: {settings.rowLimit}</span>
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
    </div>
  )
}
