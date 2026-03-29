import type { ExplorerSettings, NodeManagerSettings } from './types'

export const SETTINGS_STORAGE_KEY = 'knodel.explorer.settings.v1'
export const NODE_SETTINGS_STORAGE_KEY = 'knodel.koinos-node.settings.v1'
export const LANGUAGE_STORAGE_KEY = 'knodel.ui.language.v1'
export const LOCAL_RPC_SOURCE = 'local'
export const DEFAULT_PUBLIC_RPC_URLS = ['https://api.koinos.io/', 'https://api.koinosblocks.com/'] as const
export const LOCAL_NODE_RPC_FALLBACK_URL = 'http://127.0.0.1:8080/'
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT = 200
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN = 20
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX = 5000
export const DASHBOARD_REFRESH_SECONDS_DEFAULT = 5
export const DASHBOARD_REFRESH_SECONDS_MIN = 2
export const DASHBOARD_REFRESH_SECONDS_MAX = 60

export const DEFAULT_SETTINGS = {
  rpcSource: LOCAL_RPC_SOURCE,
  publicRpcUrls: [...DEFAULT_PUBLIC_RPC_URLS],
  pollMs: 3000,
  rowLimit: 20,
  producerAdvancedMode: false,
  dashboardProducerWindowBlocks: DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  dashboardRefreshSeconds: DASHBOARD_REFRESH_SECONDS_DEFAULT
} as const satisfies ExplorerSettings

export const DEFAULT_NODE_SETTINGS = {
  repoPath: '/Users/pgarcgo/code/koinos_code/koinos',
  baseDir: '~/.koinos',
  profiles: 'block_producer,jsonrpc,contract_meta_store',
  blockchainBackupUrl: 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
} as const satisfies NodeManagerSettings

export const SYNC_GAP_BLOCK_THRESHOLD = 50
export const SYNC_GAP_TIME_THRESHOLD_MS = 30_000

export const AUTO_RESTART_CHAIN_GAP_THRESHOLD = 100
export const AUTO_RESTART_CHAIN_COOLDOWN_MS = 5 * 60 * 1000
export const AUTO_RESTART_CHAIN_CHECK_INTERVAL_MS = 60 * 1000
export const AUTO_RESTART_CHAIN_MIN_STALL_CHECKS = 3
export const VERIFY_BLOCKS_SYNC_THRESHOLD = 50

export const ANSI_BASIC_COLORS = ['#20272b', '#ff6b6b', '#3ddc97', '#f4b35d', '#5aa8ff', '#d88cff', '#58d7e7', '#d9e3e8']
export const ANSI_BRIGHT_COLORS = ['#6a7d86', '#ff9b95', '#7cf3be', '#ffd98a', '#90c3ff', '#f0b7ff', '#93effa', '#ffffff']
