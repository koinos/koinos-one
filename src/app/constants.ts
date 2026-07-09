import type { ExplorerSettings, NodeBackupSettings, NodeManagerSettings } from './types'
import { MAINNET_PUBLIC_RPC_URLS } from './network'

export const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
export const NODE_SETTINGS_STORAGE_KEY = 'teleno.node.settings.v1'
export const NODE_NETWORK_BASEDIRS_STORAGE_KEY = 'teleno.node.network-basedirs.v1'
export const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
export const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
export const LEGACY_SETTINGS_STORAGE_KEY = 'koinosgui.explorer.settings.v1'
export const LEGACY_NODE_SETTINGS_STORAGE_KEY = 'koinosgui.koinos-node.settings.v1'
export const LEGACY_NODE_NETWORK_BASEDIRS_STORAGE_KEY = 'koinosgui.koinos-node.network-basedirs.v1'
export const LEGACY_LANGUAGE_STORAGE_KEY = 'koinosgui.ui.language.v1'
export const LOCAL_RPC_SOURCE = 'local'
export const DEFAULT_PUBLIC_RPC_URLS = MAINNET_PUBLIC_RPC_URLS
export const DEFAULT_KOINSCAN_URL = 'https://koinscan.com/'
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
  koinscanUrl: DEFAULT_KOINSCAN_URL,
  pollMs: 1000,
  rowLimit: 20,
  explorer3dQuality: 'medium',
  producerAdvancedMode: false,
  nodeAdvancedMode: false,
  dashboardProducerWindowBlocks: DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  dashboardRefreshSeconds: DASHBOARD_REFRESH_SECONDS_DEFAULT
} as const satisfies ExplorerSettings

export const DEFAULT_NODE_BACKUP_SETTINGS = {
  localEnabled: true,
  localDirectory: '',
  workspace: '',
  localRetentionCount: 7,
  remoteEnabled: false,
  remoteDirectory: '',
  remoteRetentionCount: 14,
  remoteRetentionDays: 30,
  uploadTempSuffix: '.partial',
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshAuth: 'private-key',
  sshPrivateKeyFile: '',
  sshPasswordFile: '',
  sshPassphraseFile: '',
  sshKnownHostsFile: '',
  sshStrictHostKeyChecking: true,
  sshConnectTimeoutSeconds: 15,
  scheduleEnabled: false,
  scheduleInterval: '6h',
  scheduleRunOnStartupIfMissed: true,
  scheduleJitterSeconds: 300,
  scheduleMinimumHeadProgress: 1,
  scheduleSkipIfSyncingFromGenesis: true,
  scheduleMaxConcurrentBackups: 1,
  adminEnabled: true,
  adminListen: '127.0.0.1:18088',
  adminTokenFile: '',
  adminJobs: 1
} as const satisfies NodeBackupSettings

export const DEFAULT_NODE_SETTINGS = {
  network: 'mainnet',
  repoPath: '/Users/pgarcgo/code/koinos_code/koinos',
  baseDir: '~/.teleno',
  profiles: 'mainnet_observer',
  blockchainBackupUrl: 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz',
  backup: { ...DEFAULT_NODE_BACKUP_SETTINGS }
} as const satisfies NodeManagerSettings

export const DEFAULT_NODE_BASEDIR_BY_NETWORK = {
  mainnet: DEFAULT_NODE_SETTINGS.baseDir,
  testnet: '~/.teleno/testnet/.koinos',
  custom: '~/.teleno/custom/.koinos'
} as const satisfies Record<NodeManagerSettings['network'], string>

export const DEFAULT_NODE_PROFILES_BY_NETWORK = {
  mainnet: 'mainnet_observer',
  testnet: 'testnet_observer',
  custom: 'custom_advanced'
} as const satisfies Record<NodeManagerSettings['network'], string>

export const SYNC_GAP_BLOCK_THRESHOLD = 50
export const SYNC_GAP_TIME_THRESHOLD_MS = 30_000

export const AUTO_RESTART_CHAIN_GAP_THRESHOLD = 100
export const AUTO_RESTART_CHAIN_COOLDOWN_MS = 5 * 60 * 1000
export const AUTO_RESTART_CHAIN_CHECK_INTERVAL_MS = 60 * 1000
export const AUTO_RESTART_CHAIN_MIN_STALL_CHECKS = 2
export const VERIFY_BLOCKS_SYNC_THRESHOLD = 50

export const AUTO_RESTART_P2P_COOLDOWN_MS = 5 * 60 * 1000
export const AUTO_RESTART_P2P_MIN_NO_PEERS_CHECKS = 2

export const ANSI_BASIC_COLORS = ['#20272b', '#ff6b6b', '#3ddc97', '#f4b35d', '#5aa8ff', '#d88cff', '#58d7e7', '#d9e3e8']
export const ANSI_BRIGHT_COLORS = ['#6a7d86', '#ff9b95', '#7cf3be', '#ffd98a', '#90c3ff', '#f0b7ff', '#93effa', '#ffffff']
