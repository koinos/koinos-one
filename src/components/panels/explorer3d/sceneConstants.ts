export const SCENE_COLORS = {
  background: '#fbfcfe',
  fog: '#fbfcfe',
  gate: '#8c3ff0',
  gateEmissive: '#5d00b3',
  pendingTx: '#5d00b3',
  block: '#33485b',
  blockOwn: '#5d00b3',
  track: '#d8e0ec'
} as const

export const MAX_RENDERED_PENDING_TX = 500
export const GATE_POSITION = { x: -9, y: 1.6, z: 0 } as const
export const CHAIN_START_X = 2.2
export const CHAIN_SPACING = 1.35
/** Where the newest block sits: absorb target for included transactions. */
export const CHAIN_BLOCK_POSITION = { x: CHAIN_START_X, y: 0.96, z: 0 } as const
