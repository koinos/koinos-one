import {
  AUTO_RESTART_CHAIN_COOLDOWN_MS,
  AUTO_RESTART_CHAIN_GAP_THRESHOLD,
  AUTO_RESTART_CHAIN_MIN_STALL_CHECKS,
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
