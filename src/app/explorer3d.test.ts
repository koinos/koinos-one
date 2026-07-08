import { describe, expect, it } from 'vitest'

import {
  applyBlock,
  applyMempoolSnapshot,
  createExplorer3DState,
  explorer3DCounts,
  parsePendingTransactionsResponse,
  pruneExplorer3DState
} from './explorer3d'

describe('explorer3d data layer', () => {
  it('emits tx-seen for new pending transactions and keeps them pending', () => {
    const state = createExplorer3DState()
    const events = applyMempoolSnapshot(state, [{ id: 'tx1', payer: 'alice', opCount: 2 }], 1000)

    expect(events).toEqual([{ type: 'tx-seen', id: 'tx1' }])
    expect(state.txs.get('tx1')).toMatchObject({ stage: 'pending', payer: 'alice', opCount: 2, firstSeenAt: 1000 })
    expect(state.mempoolObserved).toBe(true)
  })

  it('does not re-emit tx-seen for already known transactions', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'tx1' }], 1000)
    const events = applyMempoolSnapshot(state, [{ id: 'tx1' }], 3000)
    expect(events).toEqual([])
  })

  it('drops pending transactions that vanish without a block', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'tx1' }], 1000)
    const events = applyMempoolSnapshot(state, [], 3000)

    expect(events).toEqual([{ type: 'tx-dropped', id: 'tx1' }])
    expect(state.txs.get('tx1')).toMatchObject({ stage: 'dropped', droppedAt: 3000 })
  })

  it('marks pending transactions included when their block arrives', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'tx1' }], 1000)
    const events = applyBlock(
      state,
      { height: 10, id: 'b10', signer: 'prod', timestampMs: 5000, txIds: ['tx1'] },
      5100
    )

    expect(events).toEqual([
      { type: 'block-arrived', height: 10, id: 'b10', signer: 'prod', txIds: ['tx1'] },
      { type: 'tx-included', id: 'tx1', blockHeight: 10, blockId: 'b10' }
    ])
    expect(state.txs.get('tx1')).toMatchObject({ stage: 'included', blockHeight: 10, blockId: 'b10' })
  })

  it('creates included records for transactions never seen in the mempool (blocks-only mode)', () => {
    const state = createExplorer3DState()
    applyBlock(state, { height: 10, id: 'b10', signer: 'prod', timestampMs: 5000, txIds: ['ghost'] }, 5100)
    expect(state.txs.get('ghost')).toMatchObject({ stage: 'included', blockHeight: 10 })
  })

  it('a stale mempool snapshot does not resurrect an included transaction', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'tx1' }], 1000)
    applyBlock(state, { height: 10, id: 'b10', signer: 'prod', timestampMs: 5000, txIds: ['tx1'] }, 5100)
    const events = applyMempoolSnapshot(state, [{ id: 'tx1' }], 6000)

    expect(events).toEqual([])
    expect(state.txs.get('tx1')?.stage).toBe('included')
  })

  it('deduplicates blocks and caps the block ring newest-first', () => {
    const state = createExplorer3DState({ maxBlocks: 2 })
    applyBlock(state, { height: 1, id: 'b1', signer: 'p', timestampMs: 1, txIds: [] }, 1)
    applyBlock(state, { height: 2, id: 'b2', signer: 'p', timestampMs: 2, txIds: [] }, 2)
    expect(applyBlock(state, { height: 2, id: 'b2', signer: 'p', timestampMs: 2, txIds: [] }, 3)).toEqual([])
    applyBlock(state, { height: 3, id: 'b3', signer: 'p', timestampMs: 3, txIds: [] }, 4)

    expect(state.blocks.map((b) => b.height)).toEqual([3, 2])
  })

  it('prunes settled transactions after the ttl but keeps pending ones', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'stays' }, { id: 'goes' }], 1000)
    applyBlock(state, { height: 5, id: 'b5', signer: 'p', timestampMs: 2000, txIds: ['goes'] }, 2000)

    const removed = pruneExplorer3DState(state, 2000 + 61_000, 60_000)

    expect(removed).toBe(1)
    expect(state.txs.has('goes')).toBe(false)
    expect(state.txs.get('stays')?.stage).toBe('pending')
  })

  it('culls oldest settled transactions when over the cap, never pending ones', () => {
    const state = createExplorer3DState({ maxTxs: 10 })
    for (let i = 0; i < 12; i++) {
      applyBlock(state, { height: i + 1, id: `b${i}`, signer: 'p', timestampMs: i, txIds: [`tx${i}`] }, i)
    }
    applyMempoolSnapshot(state, [{ id: 'pending1' }], 100)

    expect(state.txs.size).toBeLessThanOrEqual(10)
    expect(state.txs.has('pending1')).toBe(true)
    expect(state.txs.has('tx0')).toBe(false)
  })

  it('reports lifecycle counts', () => {
    const state = createExplorer3DState()
    applyMempoolSnapshot(state, [{ id: 'a' }, { id: 'b' }], 1000)
    applyBlock(state, { height: 1, id: 'b1', signer: 'p', timestampMs: 1, txIds: ['a'] }, 1500)
    applyMempoolSnapshot(state, [], 2000)

    expect(explorer3DCounts(state)).toEqual({ pending: 0, included: 1, dropped: 1, blocks: 1 })
  })

  it('parses the mempool RPC response defensively', () => {
    expect(parsePendingTransactionsResponse(null)).toEqual([])
    expect(parsePendingTransactionsResponse({})).toEqual([])
    expect(
      parsePendingTransactionsResponse({
        pending_transactions: [
          { transaction: { id: 'tx1', header: { payer: 'alice' }, operations: [{}, {}] } },
          { transaction: { id: '' } },
          { nope: true }
        ]
      })
    ).toEqual([{ id: 'tx1', payer: 'alice', opCount: 2 }])
  })
})
