import os from 'node:os'
import path from 'node:path'

export const DEFAULT_KOINOS_REPO_PATH = '/Users/pgarcgo/code/koinos_code/koinos'
export const DEFAULT_COMPOSE_FILE = 'docker-compose.yml'
export const DEFAULT_ENV_FILE = '.env'
export const LEGACY_DEFAULT_ENV_FILE = 'env.example'
export const DEFAULT_PROFILES = ['block_producer', 'jsonrpc', 'contract_meta_store']
export const IMPLIED_NODE_PROFILES: Record<string, string[]> = {
  block_producer: ['jsonrpc', 'contract_meta_store']
}
export const DEFAULT_BASEDIR = path.join(os.homedir(), '.koinos')
export const DEFAULT_BLOCKCHAIN_BACKUP_URL = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
export const DEFAULT_KOINOS_SOURCE_ROOT = '/Users/pgarcgo/code/koinos_code'
export const PUBLIC_KOINOS_RPC_URL = 'https://api.koinos.io/'
export const DEFAULT_PUBLIC_RPC_URLS = ['https://api.koinos.io/', 'https://api.koinosblocks.com/'] as const
export const NODE_SETTINGS_STORAGE_KEY = 'knodel.koinos-node.settings.v1'
export const LANGUAGE_STORAGE_KEY = 'knodel.ui.language.v1'
export const KOIN_CONTRACT_ADDRESS = '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK'
export const VHP_CONTRACT_ADDRESS = '12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq'
export const POB_CONTRACT_ADDRESS = '159myq5YUhhoVWu3wsHKHiJYKPKGUrGiyv'
export const FREE_MANA_SHARER_ADDRESS = '162GhJwsciDiKsgwzj2t6VoFHt3RMzGKdG'
export const FREE_MANA_METER_ADDRESS = '1MqveNK3piSGPHGocsRUCVhpCPLgQA58K9'
export const KNODEL_SECURE_STORAGE_DIR = 'secure-storage'
export const KNODEL_CONFIG_DIR = 'config'
export const KNODEL_PRODUCER_WALLET_FILE = 'producer-wallet.json'
export const KNODEL_PRODUCER_PROFILE_FILE = 'producer-profile.v1.json'
export const KNODEL_PUBLIC_RPCS_FILE = 'public-rpcs.json'
export const KNODEL_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
export const KNODEL_KEY_LENGTH = 32
export const KNODEL_PBKDF2_ITERATIONS = 100000
export const PRODUCER_DAY_WINDOW_MS = 24 * 60 * 60 * 1000
export const BLOCK_STORE_PAGE_SIZE = 1000
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT = 200
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN = 20
export const DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX = 5000
export const DASHBOARD_PEER_LOG_TAIL = 2000
export const KOINOS_GIT_CLONE_URL = 'https://github.com/koinos/koinos'
export const MAC_DOCKER_DESKTOP_OVERRIDE_PATH = path.join(os.tmpdir(), 'knodel-koinos-docker-desktop.override.yml')
export const MAC_DOCKER_DESKTOP_APP_PATH = '/Applications/Docker.app'
export const MAC_DOCKER_DESKTOP_STARTUP_TIMEOUT_MS = 90_000
export const MAC_DOCKER_DESKTOP_STARTUP_POLL_MS = 1500
export const MAC_DOCKER_DESKTOP_CONFIG_OVERRIDE_SERVICES = [
  'amqp',
  'chain',
  'mempool',
  'block_store',
  'p2p',
  'block_producer',
  'jsonrpc',
  'grpc',
  'transaction_store',
  'contract_meta_store',
  'account_history'
] as const
