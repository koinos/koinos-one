import os from 'node:os'
import path from 'node:path'
import { executableExtension } from './platform'

export const DEFAULT_BASEDIR = path.join(os.homedir(), '.koinos')
export const DEFAULT_BLOCKCHAIN_BACKUP_URL = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
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

// Resolved at runtime relative to the app root (see platform.ts)
export function resolveDefaultKoinosSourceRoot(): string {
  return path.resolve(__dirname, '..', '..', 'vendor', 'koinos')
}

export function resolveDefaultKoinosRepoPath(): string {
  return path.join(resolveDefaultKoinosSourceRoot(), 'koinos')
}

/** True when running from a packaged electron-builder .exe (not dev mode). */
export function isPackagedBuild(): boolean {
  return !(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp
}

/** Root directory for bundled Koinos binaries (packaged) or vendor source (dev). */
export function resolveKoinosBinRoot(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'bin')
  }
  return resolveDefaultKoinosSourceRoot()
}

/** Root directory for bundled koinos-rest standalone app (packaged only). */
export function resolveKoinosRestRoot(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'rest')
  }
  return path.join(resolveDefaultKoinosSourceRoot(), 'koinos-rest')
}

/** Root directory for bundled config templates (packaged only). */
export function resolveKoinosConfigRoot(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'config')
  }
  return path.join(resolveDefaultKoinosSourceRoot(), 'koinos', 'config-example')
}

/** Path to bundled GarageMQ broker binary. @deprecated Use resolveMonolithBinaryPath() for monolith mode. */
export function resolveAmqpBrokerPath(): string {
  const ext = executableExtension()
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'bin', 'garagemq' + ext)
  }
  return path.resolve(__dirname, '..', '..', 'vendor', 'amqp-broker', 'garagemq' + ext)
}

/** Path to GarageMQ config template. @deprecated Use monolith mode config instead. */
export function resolveAmqpBrokerConfigPath(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'config', 'amqp', 'garagemq.yaml')
  }
  return path.resolve(__dirname, '..', '..', 'vendor', 'amqp-broker', 'etc', 'config.yaml')
}

/** Path to the monolithic koinos_node binary. */
export function resolveMonolithBinaryPath(): string {
  const ext = executableExtension()
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'bin', 'koinos_node' + ext)
  }
  return path.resolve(__dirname, '..', '..', 'vendor', 'koinos', 'koinos-node', 'build', 'koinos_node' + ext)
}

/** Known components within the monolith binary. */
export const MONOLITH_COMPONENTS = [
  'chain', 'mempool', 'block_store', 'p2p',
  'block_producer', 'jsonrpc', 'grpc',
  'transaction_store', 'contract_meta_store', 'account_history'
] as const

/** Components that are always enabled in the monolith. */
export const MONOLITH_CORE_COMPONENTS = ['chain', 'mempool', 'block_store', 'p2p'] as const

/** Components that can be toggled via feature flags. */
export const MONOLITH_OPTIONAL_COMPONENTS = [
  'block_producer', 'jsonrpc', 'grpc',
  'transaction_store', 'contract_meta_store', 'account_history'
] as const
