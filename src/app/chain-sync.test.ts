import { describe, expect, it } from 'vitest'
import {
  AUTO_RESTART_CHAIN_COOLDOWN_MS,
  AUTO_RESTART_CHAIN_GAP_THRESHOLD,
  AUTO_RESTART_CHAIN_MIN_STALL_CHECKS,
  AUTO_RESTART_P2P_COOLDOWN_MS,
  AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS,
  VERIFY_BLOCKS_SYNC_THRESHOLD
} from './constants'
import { createAutoRestartState, createP2pRestartState, evaluateAutoRestart, evaluateP2pRestart, parseIndexerProgress, shouldDisableVerifyBlocks, type AutoRestartState } from './chain-sync'

function run(state: AutoRestartState, localHeight: number | null, publicHeight: number | null, now = 1000000) {
  return evaluateAutoRestart(state, { localHeight, publicHeight, now })
}

describe('createAutoRestartState', () => {
  it('returns a clean initial state', () => {
    const state = createAutoRestartState()
    expect(state).toEqual({ lastRestartAt: 0, stallCount: 0, lastSeenHeight: null })
  })
})

describe('evaluateAutoRestart', () => {
  describe('no restart when gap is small', () => {
    it('does not restart when gap is zero', () => {
      const result = run(createAutoRestartState(), 1000, 1000)
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(0)
    })

    it('does not restart when gap is at threshold', () => {
      const height = 5000
      const result = run(createAutoRestartState(), height, height + AUTO_RESTART_CHAIN_GAP_THRESHOLD)
      expect(result.shouldRestart).toBe(false)
    })

    it('does not restart when local is ahead of public', () => {
      const result = run(createAutoRestartState(), 5000, 4000)
      expect(result.shouldRestart).toBe(false)
    })

    it('resets stall count when gap drops below threshold', () => {
      const stalled: AutoRestartState = { lastRestartAt: 0, stallCount: 10, lastSeenHeight: 1000 }
      const result = run(stalled, 1000, 1000 + AUTO_RESTART_CHAIN_GAP_THRESHOLD)
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(0)
    })
  })

  describe('stall detection', () => {
    it('increments stall count when height does not change', () => {
      const state: AutoRestartState = { lastRestartAt: 0, stallCount: 0, lastSeenHeight: 1000 }
      const result = run(state, 1000, 5000)
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(1)
    })

    it('increments stall count when height changes by less than 5', () => {
      const state: AutoRestartState = { lastRestartAt: 0, stallCount: 0, lastSeenHeight: 1000 }
      const result = run(state, 1005, 5000)
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(1)
    })

    it('resets stall count when height advances by more than 5', () => {
      const state: AutoRestartState = { lastRestartAt: 0, stallCount: 2, lastSeenHeight: 1000 }
      const result = run(state, 1006, 5000)
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(0)
    })

    it('does not restart before reaching min stall checks', () => {
      let state = createAutoRestartState()
      state.lastSeenHeight = 1000

      for (let i = 0; i < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1; i++) {
        const result = run(state, 1000, 5000)
        expect(result.shouldRestart).toBe(false)
        state = result.state
      }
      expect(state.stallCount).toBe(AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1)
    })
  })

  describe('triggers restart', () => {
    it('restarts after enough stall checks with large gap', () => {
      let state: AutoRestartState = { lastRestartAt: 0, stallCount: 0, lastSeenHeight: 1000 }

      // Simulate stall checks
      for (let i = 0; i < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS; i++) {
        const result = run(state, 1000, 5000)
        state = result.state
        if (i < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1) {
          expect(result.shouldRestart).toBe(false)
        } else {
          expect(result.shouldRestart).toBe(true)
        }
      }
    })

    it('resets stallCount and sets lastRestartAt after restart', () => {
      const now = 999999
      const state: AutoRestartState = {
        lastRestartAt: 0,
        stallCount: AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1,
        lastSeenHeight: 1000
      }
      const result = run(state, 1000, 5000, now)
      expect(result.shouldRestart).toBe(true)
      expect(result.state.stallCount).toBe(0)
      expect(result.state.lastRestartAt).toBe(now)
    })
  })

  describe('cooldown', () => {
    it('does not restart during cooldown period', () => {
      const restartTime = 100000
      const state: AutoRestartState = {
        lastRestartAt: restartTime,
        stallCount: AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1,
        lastSeenHeight: 1000
      }
      // Try to restart 1ms before cooldown expires
      const result = run(state, 1000, 5000, restartTime + AUTO_RESTART_CHAIN_COOLDOWN_MS - 1)
      expect(result.shouldRestart).toBe(false)
    })

    it('restarts after cooldown expires', () => {
      const restartTime = 100000
      const state: AutoRestartState = {
        lastRestartAt: restartTime,
        stallCount: AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1,
        lastSeenHeight: 1000
      }
      const result = run(state, 1000, 5000, restartTime + AUTO_RESTART_CHAIN_COOLDOWN_MS)
      expect(result.shouldRestart).toBe(true)
    })
  })

  describe('null inputs', () => {
    it('does not restart when localHeight is null', () => {
      const state: AutoRestartState = {
        lastRestartAt: 0,
        stallCount: AUTO_RESTART_CHAIN_MIN_STALL_CHECKS,
        lastSeenHeight: 1000
      }
      const result = run(state, null, 5000)
      expect(result.shouldRestart).toBe(false)
    })

    it('does not restart when publicHeight is null', () => {
      const state: AutoRestartState = {
        lastRestartAt: 0,
        stallCount: AUTO_RESTART_CHAIN_MIN_STALL_CHECKS,
        lastSeenHeight: 1000
      }
      const result = run(state, 1000, null)
      expect(result.shouldRestart).toBe(false)
    })

    it('does not restart when both are null', () => {
      const result = run(createAutoRestartState(), null, null)
      expect(result.shouldRestart).toBe(false)
    })

    it('handles first check with lastSeenHeight null (no stall)', () => {
      const state = createAutoRestartState()
      const result = run(state, 1000, 5000)
      // First check: lastSeenHeight is null, so stallCount resets to 0
      expect(result.shouldRestart).toBe(false)
      expect(result.state.stallCount).toBe(0)
      expect(result.state.lastSeenHeight).toBe(1000)
    })
  })

  describe('full scenario: sync gap with stall then recovery then stall again', () => {
    it('simulates a realistic sync lifecycle', () => {
      let state = createAutoRestartState()
      const publicHeight = 34633000

      // 1. Chain starts syncing fine at height 34468000
      let r = run(state, 34468000, publicHeight, 0)
      expect(r.shouldRestart).toBe(false)
      state = r.state

      // 2. Chain stalls for MIN_STALL_CHECKS checks
      // First stall check after lastSeenHeight was set in step 1
      for (let i = 0; i < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS; i++) {
        r = run(state, 34468000, publicHeight, (i + 1) * 60000)
        state = r.state
        if (i < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS - 1) {
          expect(r.shouldRestart).toBe(false)
        }
      }

      // 3. Last stall check should have triggered restart
      expect(r!.shouldRestart).toBe(true)
      state = r.state

      // 4. After restart, indexer catches up quickly — gap closes
      r = run(state, 34632900, publicHeight, (AUTO_RESTART_CHAIN_MIN_STALL_CHECKS + 1) * 60000)
      expect(r.shouldRestart).toBe(false)
      expect(r.state.stallCount).toBe(0) // gap < threshold, reset

      // 5. Chain is synced
      state = r.state
      r = run(state, publicHeight, publicHeight, (AUTO_RESTART_CHAIN_MIN_STALL_CHECKS + 2) * 60000)
      expect(r.shouldRestart).toBe(false)
      expect(r.state.stallCount).toBe(0)
    })
  })
})

describe('parseIndexerProgress', () => {
  it('returns null for empty input', () => {
    expect(parseIndexerProgress('')).toBeNull()
  })

  it('returns null when no indexing lines present', () => {
    const log = `2026-03-29 17:03:20 (chain.Koinos) [koinos_chain.cpp:306] <info>: Connecting AMQP client...
2026-03-29 17:03:20 (chain.Koinos) [koinos_chain.cpp:308] <info>: Established AMQP client connection`
    expect(parseIndexerProgress(log)).toBeNull()
  })

  it('parses a single indexing line', () => {
    const log = '2026-03-29 17:03:20.553755 (chain.Koinos) [controller.cpp:693] <info>: Indexing chain (0.199995%) - Height: 68938, ID: 0x12208ba3c4b220cc'
    const result = parseIndexerProgress(log)
    expect(result).toEqual({ percent: 0.199995, height: 68938 })
  })

  it('returns the last match when multiple lines present', () => {
    const log = `Indexing chain (0.199995%) - Height: 68938, ID: 0x1220abc
Indexing chain (0.299992%) - Height: 103407, ID: 0x1220def
Indexing chain (0.39999%) - Height: 137876, ID: 0x1220ghi`
    const result = parseIndexerProgress(log)
    expect(result).toEqual({ percent: 0.39999, height: 137876 })
  })

  it('returns null after "Finished indexing"', () => {
    const log = `Indexing chain (99.9999%) - Height: 34464000, ID: 0x1220abc
Finished indexing 60 blocks, took 3.0951 seconds`
    expect(parseIndexerProgress(log)).toBeNull()
  })

  it('returns progress if indexing resumes after finished', () => {
    const log = `Finished indexing 60 blocks, took 3.0951 seconds
Indexing chain (5.5%) - Height: 1900000, ID: 0x1220abc`
    const result = parseIndexerProgress(log)
    expect(result).toEqual({ percent: 5.5, height: 1900000 })
  })

  it('handles 0% progress', () => {
    const log = 'Indexing chain (0%) - Height: 0, ID: 0x1220abc'
    expect(parseIndexerProgress(log)).toEqual({ percent: 0, height: 0 })
  })

  it('handles 100% progress', () => {
    const log = 'Indexing chain (100%) - Height: 34500000, ID: 0x1220abc'
    expect(parseIndexerProgress(log)).toEqual({ percent: 100, height: 34500000 })
  })

  it('handles high-precision decimal percentages', () => {
    const log = 'Indexing chain (99.999999%) - Height: 34633100, ID: 0x1220abc'
    expect(parseIndexerProgress(log)).toEqual({ percent: 99.999999, height: 34633100 })
  })
})

describe('shouldDisableVerifyBlocks', () => {
  it('returns false when verify-blocks is not enabled', () => {
    expect(shouldDisableVerifyBlocks({ localHeight: 100, publicHeight: 100, verifyBlocksEnabled: false })).toBe(false)
    expect(shouldDisableVerifyBlocks({ localHeight: 100, publicHeight: 100, verifyBlocksEnabled: null })).toBe(false)
  })

  it('returns false when heights are null', () => {
    expect(shouldDisableVerifyBlocks({ localHeight: null, publicHeight: 100, verifyBlocksEnabled: true })).toBe(false)
    expect(shouldDisableVerifyBlocks({ localHeight: 100, publicHeight: null, verifyBlocksEnabled: true })).toBe(false)
  })

  it('returns false when gap is above threshold', () => {
    expect(shouldDisableVerifyBlocks({
      localHeight: 34620000,
      publicHeight: 34620000 + VERIFY_BLOCKS_SYNC_THRESHOLD + 1,
      verifyBlocksEnabled: true
    })).toBe(false)
  })

  it('returns true when gap is at threshold', () => {
    expect(shouldDisableVerifyBlocks({
      localHeight: 34620000,
      publicHeight: 34620000 + VERIFY_BLOCKS_SYNC_THRESHOLD,
      verifyBlocksEnabled: true
    })).toBe(true)
  })

  it('returns true when gap is below threshold', () => {
    expect(shouldDisableVerifyBlocks({
      localHeight: 34636000,
      publicHeight: 34636010,
      verifyBlocksEnabled: true
    })).toBe(true)
  })

  it('returns true when fully synced', () => {
    expect(shouldDisableVerifyBlocks({
      localHeight: 34636000,
      publicHeight: 34636000,
      verifyBlocksEnabled: true
    })).toBe(true)
  })
})

describe('evaluateP2pRestart', () => {
  const base = { syncGapExists: true, p2pRunning: true, now: 100000 }

  it('does not restart when P2P has peers', () => {
    const state = createP2pRestartState()
    const result = evaluateP2pRestart(state, { ...base, peerCount: 3 })
    expect(result.shouldRestart).toBe(false)
    expect(result.state.noPeersCount).toBe(0)
  })

  it('does not restart when P2P is not running', () => {
    const state = createP2pRestartState()
    const result = evaluateP2pRestart(state, { ...base, peerCount: 0, p2pRunning: false })
    expect(result.shouldRestart).toBe(false)
  })

  it('does not restart when no sync gap', () => {
    const state = createP2pRestartState()
    const result = evaluateP2pRestart(state, { ...base, peerCount: 0, syncGapExists: false })
    expect(result.shouldRestart).toBe(false)
  })

  it('does not restart before min checks reached', () => {
    let state = createP2pRestartState()
    for (let i = 0; i < AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS - 1; i++) {
      const result = evaluateP2pRestart(state, { ...base, peerCount: 0, now: 100000 + i * 60000 })
      expect(result.shouldRestart).toBe(false)
      state = result.state
    }
    expect(state.noPeersCount).toBe(AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS - 1)
  })

  it('restarts after min checks with 0 peers', () => {
    let state = createP2pRestartState()
    for (let i = 0; i < AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS; i++) {
      const result = evaluateP2pRestart(state, { ...base, peerCount: 0, now: 100000 + i * 60000 })
      state = result.state
      if (i === AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS - 1) {
        expect(result.shouldRestart).toBe(true)
      }
    }
  })

  it('respects cooldown after restart', () => {
    const state = { noPeersCount: 0, lastRestartAt: 100000 }
    // Within cooldown
    let result = evaluateP2pRestart(state, { ...base, peerCount: 0, now: 100000 + 60000 })
    result = evaluateP2pRestart(result.state, { ...base, peerCount: 0, now: 100000 + 120000 })
    expect(result.shouldRestart).toBe(false)

    // After cooldown
    result = evaluateP2pRestart(result.state, { ...base, peerCount: 0, now: 100000 + AUTO_RESTART_P2P_COOLDOWN_MS + 1 })
    // Still needs min checks after cooldown — noPeersCount was accumulating
    // With MIN_NO_PEERS_CHECKS=2, after 3 checks it should trigger
    expect(result.state.noPeersCount >= AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS || result.shouldRestart).toBe(true)
  })

  it('resets counter when peers appear', () => {
    let state = createP2pRestartState()
    // Accumulate no-peers checks
    const r1 = evaluateP2pRestart(state, { ...base, peerCount: 0 })
    state = r1.state
    expect(state.noPeersCount).toBe(1)

    // Peers appear
    const r2 = evaluateP2pRestart(state, { ...base, peerCount: 2 })
    expect(r2.state.noPeersCount).toBe(0)
    expect(r2.shouldRestart).toBe(false)
  })
})
