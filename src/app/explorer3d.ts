// Pure data layer for the experimental 3D Explorer. No three.js imports:
// this module tracks the observable lifecycle of transactions and blocks
// (mempool snapshot diffs + block arrivals) and emits events the scene can
// animate. See docs/backlog/gui/EXPERIMENTAL_3D_EXPLORER_PLAN.md.

export type Tx3DStage = 'pending' | 'included' | 'dropped'

export type Tx3DLifecycle = {
  id: string
  firstSeenAt: number
  payer: string | null
  opCount: number | null
  stage: Tx3DStage
  blockHeight: number | null
  blockId: string | null
  includedAt: number | null
  droppedAt: number | null
}

export type Block3D = {
  height: number
  id: string
  signer: string
  timestampMs: number
  txIds: string[]
  arrivedAt: number
}

export type Explorer3DEvent =
  | { type: 'tx-seen'; id: string }
  | { type: 'tx-dropped'; id: string }
  | { type: 'tx-included'; id: string; blockHeight: number; blockId: string }
  | { type: 'block-arrived'; height: number; id: string; signer: string; txIds: string[] }

export type PendingTxSummary = {
  id: string
  payer?: string | null
  opCount?: number | null
}

export type Explorer3DState = {
  txs: Map<string, Tx3DLifecycle>
  blocks: Block3D[]
  maxBlocks: number
  maxTxs: number
  /** True once a mempool snapshot has been applied (false = blocks-only mode). */
  mempoolObserved: boolean
}

export const EXPLORER3D_DEFAULT_MAX_BLOCKS = 24
export const EXPLORER3D_DEFAULT_MAX_TXS = 2000
export const EXPLORER3D_SETTLED_TTL_MS = 60_000

export function createExplorer3DState(options?: {
  maxBlocks?: number
  maxTxs?: number
}): Explorer3DState {
  return {
    txs: new Map(),
    blocks: [],
    maxBlocks: Math.max(1, options?.maxBlocks ?? EXPLORER3D_DEFAULT_MAX_BLOCKS),
    maxTxs: Math.max(10, options?.maxTxs ?? EXPLORER3D_DEFAULT_MAX_TXS),
    mempoolObserved: false
  }
}

/**
 * Apply a mempool snapshot. New ids become pending (tx-seen); previously
 * pending ids missing from the snapshot and not included in a block are
 * dropped (tx-dropped). Included/dropped records are never resurrected by a
 * stale snapshot.
 */
export function applyMempoolSnapshot(
  state: Explorer3DState,
  pending: PendingTxSummary[],
  now: number
): Explorer3DEvent[] {
  const events: Explorer3DEvent[] = []
  state.mempoolObserved = true
  const snapshotIds = new Set<string>()

  for (const entry of pending) {
    const id = `${entry.id ?? ''}`.trim()
    if (!id) continue
    snapshotIds.add(id)
    const existing = state.txs.get(id)
    if (existing) continue
    state.txs.set(id, {
      id,
      firstSeenAt: now,
      payer: entry.payer?.trim() || null,
      opCount: entry.opCount ?? null,
      stage: 'pending',
      blockHeight: null,
      blockId: null,
      includedAt: null,
      droppedAt: null
    })
    events.push({ type: 'tx-seen', id })
  }

  for (const tx of state.txs.values()) {
    if (tx.stage !== 'pending') continue
    if (snapshotIds.has(tx.id)) continue
    tx.stage = 'dropped'
    tx.droppedAt = now
    events.push({ type: 'tx-dropped', id: tx.id })
  }

  enforceTxCap(state)
  return events
}

/**
 * Apply an arriving block. Transactions included in the block move to the
 * included stage; transactions never seen in the mempool (blocks-only mode or
 * missed polls) are created directly as included so the scene can still show
 * them being sealed.
 */
export function applyBlock(
  state: Explorer3DState,
  block: { height: number; id: string; signer: string; timestampMs: number; txIds?: string[] },
  now: number
): Explorer3DEvent[] {
  const events: Explorer3DEvent[] = []
  const id = `${block.id ?? ''}`.trim()
  if (!id || !Number.isFinite(block.height) || block.height <= 0) return events
  if (state.blocks.some((existing) => existing.id === id)) return events

  const txIds = (block.txIds ?? []).map((txId) => `${txId}`.trim()).filter(Boolean)

  state.blocks.push({
    height: block.height,
    id,
    signer: `${block.signer ?? ''}`.trim(),
    timestampMs: block.timestampMs,
    txIds,
    arrivedAt: now
  })
  state.blocks.sort((a, b) => b.height - a.height)
  if (state.blocks.length > state.maxBlocks) {
    state.blocks.length = state.maxBlocks
  }
  events.push({ type: 'block-arrived', height: block.height, id, signer: `${block.signer ?? ''}`.trim(), txIds })

  for (const txId of txIds) {
    const existing = state.txs.get(txId)
    if (existing) {
      if (existing.stage === 'included') continue
      existing.stage = 'included'
      existing.blockHeight = block.height
      existing.blockId = id
      existing.includedAt = now
      existing.droppedAt = null
    } else {
      state.txs.set(txId, {
        id: txId,
        firstSeenAt: now,
        payer: null,
        opCount: null,
        stage: 'included',
        blockHeight: block.height,
        blockId: id,
        includedAt: now,
        droppedAt: null
      })
    }
    events.push({ type: 'tx-included', id: txId, blockHeight: block.height, blockId: id })
  }

  enforceTxCap(state)
  return events
}

/** Remove settled (included/dropped) transactions older than ttlMs. */
export function pruneExplorer3DState(
  state: Explorer3DState,
  now: number,
  ttlMs: number = EXPLORER3D_SETTLED_TTL_MS
): number {
  let removed = 0
  for (const tx of state.txs.values()) {
    const settledAt = tx.stage === 'included' ? tx.includedAt : tx.stage === 'dropped' ? tx.droppedAt : null
    if (settledAt !== null && now - settledAt > ttlMs) {
      state.txs.delete(tx.id)
      removed += 1
    }
  }
  return removed
}

export function explorer3DCounts(state: Explorer3DState): {
  pending: number
  included: number
  dropped: number
  blocks: number
} {
  let pending = 0
  let included = 0
  let dropped = 0
  for (const tx of state.txs.values()) {
    if (tx.stage === 'pending') pending += 1
    else if (tx.stage === 'included') included += 1
    else dropped += 1
  }
  return { pending, included, dropped, blocks: state.blocks.length }
}

/** Oldest settled entries are culled first; pending entries are kept. */
function enforceTxCap(state: Explorer3DState): void {
  if (state.txs.size <= state.maxTxs) return
  const settled = Array.from(state.txs.values())
    .filter((tx) => tx.stage !== 'pending')
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  for (const tx of settled) {
    if (state.txs.size <= state.maxTxs) break
    state.txs.delete(tx.id)
  }
}

/** Deterministic pseudo-random in [0, 1) from a string seed (stable layout). */
export function hash01(seed: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

export const MEMPOOL_CENTER = { x: -2.5, y: 1.6, z: 0 } as const

/** Static orbital slot for a pending transaction around the mempool center. */
export function mempoolSlot(txId: string): { x: number; y: number; z: number } {
  const angle = hash01(txId, 1) * Math.PI * 2
  const radius = 1.1 + hash01(txId, 2) * 1.6
  const height = (hash01(txId, 3) - 0.5) * 1.6
  return {
    x: MEMPOOL_CENTER.x + Math.cos(angle) * radius,
    y: MEMPOOL_CENTER.y + height,
    z: MEMPOOL_CENTER.z + Math.sin(angle) * radius
  }
}

/** Parse the JSON-RPC mempool.get_pending_transactions response defensively. */
export function parsePendingTransactionsResponse(response: unknown): PendingTxSummary[] {
  const list = (response as { pending_transactions?: unknown })?.pending_transactions
  if (!Array.isArray(list)) return []
  const out: PendingTxSummary[] = []
  for (const item of list) {
    const tx = (item as { transaction?: { id?: unknown; header?: { payer?: unknown }; operations?: unknown[] } })
      ?.transaction
    const id = `${tx?.id ?? ''}`.trim()
    if (!id) continue
    out.push({
      id,
      payer: typeof tx?.header?.payer === 'string' ? tx.header.payer : null,
      opCount: Array.isArray(tx?.operations) ? tx.operations.length : null
    })
  }
  return out
}
