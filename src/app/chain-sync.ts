import {
  AUTO_RESTART_CHAIN_COOLDOWN_MS,
  AUTO_RESTART_CHAIN_GAP_THRESHOLD,
  AUTO_RESTART_CHAIN_MIN_STALL_CHECKS,
  AUTO_RESTART_P2P_COOLDOWN_MS,
  AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS,
  VERIFY_BLOCKS_SYNC_THRESHOLD
} from './constants'

// --- Indexer progress parsing ---

export type IndexerProgress = {
  percent: number
  height: number
} | null

const INDEXING_RE = /Indexing chain \(([0-9.]+)%\)\s*-\s*Height:\s*(\d+)/
const FINISHED_RE = /Finished indexing/

export function parseIndexerProgress(logOutput: string): IndexerProgress {
  const lines = logOutput.split('\n')
  let lastMatch: IndexerProgress = null
  let finishedAfterMatch = false

  for (const line of lines) {
    const m = INDEXING_RE.exec(line)
    if (m) {
      lastMatch = { percent: parseFloat(m[1]), height: parseInt(m[2], 10) }
      finishedAfterMatch = false
    } else if (FINISHED_RE.test(line)) {
      finishedAfterMatch = true
    }
  }

  return finishedAfterMatch ? null : lastMatch
}

export type AutoRestartState = {
  lastRestartAt: number
  stallCount: number
  lastSeenHeight: number | null
}

export type AutoRestartInput = {
  localHeight: number | null
  publicHeight: number | null
  now: number
}

export type AutoRestartResult = {
  shouldRestart: boolean
  state: AutoRestartState
}

export function createAutoRestartState(): AutoRestartState {
  return { lastRestartAt: 0, stallCount: 0, lastSeenHeight: null }
}

export function evaluateAutoRestart(state: AutoRestartState, input: AutoRestartInput): AutoRestartResult {
  const { localHeight, publicHeight, now } = input
  const currentHeight = localHeight ?? 0
  const gap = publicHeight !== null && localHeight !== null ? publicHeight - localHeight : 0

  // No significant gap — reset stall tracking
  if (gap <= AUTO_RESTART_CHAIN_GAP_THRESHOLD) {
    return {
      shouldRestart: false,
      state: { ...state, stallCount: 0, lastSeenHeight: currentHeight }
    }
  }

  // Detect stall: height hasn't changed meaningfully since last check
  let nextStallCount: number
  if (state.lastSeenHeight !== null && currentHeight <= state.lastSeenHeight + 5) {
    nextStallCount = state.stallCount + 1
  } else {
    nextStallCount = 0
  }

  const nextState: AutoRestartState = {
    ...state,
    stallCount: nextStallCount,
    lastSeenHeight: currentHeight
  }

  // Not stalled long enough
  if (nextStallCount < AUTO_RESTART_CHAIN_MIN_STALL_CHECKS) {
    return { shouldRestart: false, state: nextState }
  }

  // Cooldown not elapsed (lastRestartAt === 0 means never restarted)
  if (state.lastRestartAt > 0 && now - state.lastRestartAt < AUTO_RESTART_CHAIN_COOLDOWN_MS) {
    return { shouldRestart: false, state: nextState }
  }

  // Trigger restart
  return {
    shouldRestart: true,
    state: { lastRestartAt: now, stallCount: 0, lastSeenHeight: currentHeight }
  }
}

// --- Verify-blocks auto-disable ---

/**
 * Determines if verify-blocks should be automatically disabled.
 * After a restore, verify-blocks is enabled for safe re-sync. Once chain
 * catches up (gap below threshold), it can be safely disabled for performance.
 */
export function shouldDisableVerifyBlocks(input: {
  localHeight: number | null
  publicHeight: number | null
  verifyBlocksEnabled: boolean | null
}): boolean {
  const { localHeight, publicHeight, verifyBlocksEnabled } = input

  // Only act if verify-blocks is currently enabled
  if (verifyBlocksEnabled !== true) return false

  // Need both heights to evaluate
  if (localHeight === null || publicHeight === null) return false

  // Disable when gap is small enough (chain is caught up)
  const gap = publicHeight - localHeight
  return gap <= VERIFY_BLOCKS_SYNC_THRESHOLD
}

export function hasStateMerkleMismatch(logOutput: string): boolean {
  return /block previous state merkle mismatch/i.test(logOutput)
}

// --- P2P auto-restart when no peers ---

export type P2pRestartState = {
  noPeersCount: number
  lastRestartAt: number
}

export function createP2pRestartState(): P2pRestartState {
  return { noPeersCount: 0, lastRestartAt: 0 }
}

/**
 * Evaluates whether P2P should be restarted due to having no peers.
 * Triggers when: chain has a sync gap, P2P is running but has 0 peers
 * for N consecutive checks, and cooldown has elapsed.
 */
export function evaluateP2pRestart(state: P2pRestartState, input: {
  peerCount: number
  syncGapExists: boolean
  p2pRunning: boolean
  now: number
}): { shouldRestart: boolean; state: P2pRestartState } {
  const { peerCount, syncGapExists, p2pRunning, now } = input

  // Only act when P2P is running and there's a sync gap
  if (!p2pRunning || !syncGapExists) {
    return { shouldRestart: false, state: { ...state, noPeersCount: 0 } }
  }

  // If we have peers, reset counter
  if (peerCount > 0) {
    return { shouldRestart: false, state: { ...state, noPeersCount: 0 } }
  }

  // No peers — increment counter
  const nextCount = state.noPeersCount + 1

  // Not enough consecutive no-peers checks yet
  if (nextCount < AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS) {
    return { shouldRestart: false, state: { ...state, noPeersCount: nextCount } }
  }

  // Cooldown check
  if (state.lastRestartAt > 0 && now - state.lastRestartAt < AUTO_RESTART_P2P_COOLDOWN_MS) {
    return { shouldRestart: false, state: { ...state, noPeersCount: nextCount } }
  }

  // Trigger restart
  return {
    shouldRestart: true,
    state: { noPeersCount: 0, lastRestartAt: now }
  }
}
