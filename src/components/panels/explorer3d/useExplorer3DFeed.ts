import { useEffect, useRef, useState } from 'react'

import {
  applyBlock,
  applyMempoolSnapshot,
  createExplorer3DState,
  explorer3DCounts,
  parsePendingTransactionsResponse,
  pruneExplorer3DState,
  type Explorer3DEvent,
  type Explorer3DState
} from '../../../app/explorer3d'
import { rpcCall } from '../../../app/utils'
import type { BlockRow } from '../../../app/types'
import type { AppLanguage } from '../../../i18n'

const MEMPOOL_POLL_MS = 2000
const PRUNE_INTERVAL_MS = 10_000

export type Explorer3DFeed = {
  state: Explorer3DState
  counts: ReturnType<typeof explorer3DCounts>
  /** False when the RPC source does not answer the mempool method. */
  mempoolAvailable: boolean
  /** Monotonically increasing revision; bump = new events for the scene. */
  revision: number
  /** Events since the previous revision (scene consumes and forgets). */
  lastEvents: Explorer3DEvent[]
}

/**
 * Data feed for the 3D Explorer. Polls the mempool every 2 s while mounted
 * (the lazy 3D view unmounts when the sub-view closes, stopping all polling)
 * and folds the Explorer's existing block rows into the lifecycle store.
 */
export function useExplorer3DFeed(input: {
  language: AppLanguage
  rpcUrl: string
  rows: BlockRow[]
}): Explorer3DFeed {
  const { language, rpcUrl, rows } = input
  const stateRef = useRef<Explorer3DState | null>(null)
  if (!stateRef.current) stateRef.current = createExplorer3DState()
  const state = stateRef.current

  const [mempoolAvailable, setMempoolAvailable] = useState(true)
  const [revision, setRevision] = useState(0)
  const eventsRef = useRef<Explorer3DEvent[]>([])

  // Fold arriving block rows (oldest first so heights stay ordered).
  useEffect(() => {
    const now = Date.now()
    const events: Explorer3DEvent[] = []
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      events.push(...applyBlock(state, {
        height: row.height,
        id: row.blockId,
        signer: row.signer,
        timestampMs: row.timestampMs,
        txIds: row.txIds ?? []
      }, now))
    }
    if (events.length) {
      eventsRef.current = events
      setRevision((value) => value + 1)
    }
  }, [rows, state])

  // Mempool poll while mounted.
  useEffect(() => {
    let disposed = false
    let timer: number | null = null
    let controller: AbortController | null = null

    const poll = async () => {
      if (disposed) return
      controller = new AbortController()
      try {
        const response = await rpcCall<unknown>(
          language,
          rpcUrl,
          'mempool.get_pending_transactions',
          { limit: '200' },
          controller.signal
        )
        if (disposed) return
        setMempoolAvailable(true)
        const events = applyMempoolSnapshot(state, parsePendingTransactionsResponse(response), Date.now())
        if (events.length) {
          eventsRef.current = events
          setRevision((value) => value + 1)
        }
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return
        // Degrade to blocks-only mode; keep polling in case the source changes.
        setMempoolAvailable(false)
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), MEMPOOL_POLL_MS)
      }
    }

    void poll()
    const pruneTimer = window.setInterval(() => {
      pruneExplorer3DState(state, Date.now())
    }, PRUNE_INTERVAL_MS)

    return () => {
      disposed = true
      controller?.abort()
      if (timer !== null) window.clearTimeout(timer)
      window.clearInterval(pruneTimer)
    }
  }, [language, rpcUrl, state])

  return {
    state,
    counts: explorer3DCounts(state),
    mempoolAvailable,
    revision,
    lastEvents: eventsRef.current
  }
}
