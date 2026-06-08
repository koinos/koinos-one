// Koinos node YAML configuration schema for the monolith config panel.

export type ConfigSection =
  | 'global'
  | 'features'
  | 'chain'
  | 'mempool'
  | 'block_store'
  | 'p2p'
  | 'block_producer'
  | 'jsonrpc'
  | 'grpc'
  | 'rocksdb'
  | 'account_history'
  | 'transaction_store'
  | 'contract_meta_store'

export const CONFIG_SECTIONS: ConfigSection[] = [
  'global',
  'features',
  'chain',
  'mempool',
  'p2p',
  'jsonrpc',
  'grpc',
  'rocksdb'
]

export const CONFIG_SECTION_LABEL_KEYS: Record<ConfigSection, string> = {
  global: 'config.section.global',
  features: 'config.section.features',
  chain: 'config.section.chain',
  mempool: 'config.section.mempool',
  block_store: 'config.section.block_store',
  p2p: 'config.section.p2p',
  block_producer: 'config.section.block_producer',
  jsonrpc: 'config.section.jsonrpc',
  grpc: 'config.section.grpc',
  rocksdb: 'config.section.rocksdb',
  account_history: 'config.section.account_history',
  transaction_store: 'config.section.transaction_store',
  contract_meta_store: 'config.section.contract_meta_store'
}

export const CONFIG_SECTION_DESC_KEYS: Record<ConfigSection, string> = {
  global: 'config.desc.global',
  features: 'config.desc.features',
  chain: 'config.desc.chain',
  mempool: 'config.desc.mempool',
  block_store: 'config.desc.block_store',
  p2p: 'config.desc.p2p',
  block_producer: 'config.desc.block_producer',
  jsonrpc: 'config.desc.jsonrpc',
  grpc: 'config.desc.grpc',
  rocksdb: 'config.desc.rocksdb',
  account_history: 'config.desc.account_history',
  transaction_store: 'config.desc.transaction_store',
  contract_meta_store: 'config.desc.contract_meta_store'
}

export type ConfigFieldType = 'text' | 'number' | 'boolean' | 'select' | 'string-array'

export interface ConfigFieldMeta {
  section: ConfigSection
  key: string
  type: ConfigFieldType
  labelKey: string
  helpKey: string
  placeholder?: string
  dangerous?: boolean
  advanced?: boolean
  hidden?: boolean
  min?: number
  max?: number
  step?: number
  options?: string[]
}

// ---- Field definitions per section ----
// labelKey format: config.field.<section>.<key>
// helpKey format:  config.help.<section>.<key>

const FEATURES_FIELDS: ConfigFieldMeta[] = [
  { section: 'features', key: 'chain', type: 'boolean', labelKey: 'config.field.features.chain', helpKey: 'config.help.features.chain', advanced: true, dangerous: true },
  { section: 'features', key: 'mempool', type: 'boolean', labelKey: 'config.field.features.mempool', helpKey: 'config.help.features.mempool', advanced: true, dangerous: true },
  { section: 'features', key: 'block_store', type: 'boolean', labelKey: 'config.field.features.block_store', helpKey: 'config.help.features.block_store', advanced: true, dangerous: true },
  { section: 'features', key: 'p2p', type: 'boolean', labelKey: 'config.field.features.p2p', helpKey: 'config.help.features.p2p', advanced: true, dangerous: true },
  { section: 'features', key: 'jsonrpc', type: 'boolean', labelKey: 'config.field.features.jsonrpc', helpKey: 'config.help.features.jsonrpc' },
  { section: 'features', key: 'grpc', type: 'boolean', labelKey: 'config.field.features.grpc', helpKey: 'config.help.features.grpc' },
  { section: 'features', key: 'block_producer', type: 'boolean', labelKey: 'config.field.features.block_producer', helpKey: 'config.help.features.block_producer', hidden: true },
  { section: 'features', key: 'contract_meta_store', type: 'boolean', labelKey: 'config.field.features.contract_meta_store', helpKey: 'config.help.features.contract_meta_store' },
  { section: 'features', key: 'transaction_store', type: 'boolean', labelKey: 'config.field.features.transaction_store', helpKey: 'config.help.features.transaction_store' },
  { section: 'features', key: 'account_history', type: 'boolean', labelKey: 'config.field.features.account_history', helpKey: 'config.help.features.account_history' }
]

const GLOBAL_FIELDS: ConfigFieldMeta[] = [
  { section: 'global', key: 'log-level', type: 'select', labelKey: 'config.field.global.log-level', helpKey: 'config.help.global.log-level', options: ['debug', 'info', 'warn', 'error'] },
  { section: 'global', key: 'log-color', type: 'boolean', labelKey: 'config.field.global.log-color', helpKey: 'config.help.global.log-color', advanced: true },
  { section: 'global', key: 'log-datetime', type: 'boolean', labelKey: 'config.field.global.log-datetime', helpKey: 'config.help.global.log-datetime', advanced: true },
  { section: 'global', key: 'instance-id', type: 'text', labelKey: 'config.field.global.instance-id', helpKey: 'config.help.global.instance-id', advanced: true },
  { section: 'global', key: 'fork-algorithm', type: 'select', labelKey: 'config.field.global.fork-algorithm', helpKey: 'config.help.global.fork-algorithm', options: ['fifo', 'pob', 'block-time'], advanced: true },
  { section: 'global', key: 'jobs', type: 'number', labelKey: 'config.field.global.jobs', helpKey: 'config.help.global.jobs', min: 1, max: 64, step: 1, advanced: true },
  { section: 'global', key: 'blacklist', type: 'string-array', labelKey: 'config.field.global.blacklist', helpKey: 'config.help.global.blacklist', advanced: true },
  { section: 'global', key: 'whitelist', type: 'string-array', labelKey: 'config.field.global.whitelist', helpKey: 'config.help.global.whitelist', advanced: true },
  { section: 'global', key: 'reset', type: 'boolean', labelKey: 'config.field.global.reset', helpKey: 'config.help.global.reset', dangerous: true }
]

const CHAIN_FIELDS: ConfigFieldMeta[] = [
  { section: 'chain', key: 'jobs', type: 'number', labelKey: 'config.field.chain.jobs', helpKey: 'config.help.chain.jobs', min: 1, max: 64, step: 1, advanced: true },
  { section: 'chain', key: 'verify-blocks', type: 'boolean', labelKey: 'config.field.chain.verify-blocks', helpKey: 'config.help.chain.verify-blocks' },
  { section: 'chain', key: 'pending-transaction-limit', type: 'number', labelKey: 'config.field.chain.pending-transaction-limit', helpKey: 'config.help.chain.pending-transaction-limit', min: 1, max: 1000, step: 1, advanced: true },
  { section: 'chain', key: 'disable-pending-transaction-limit', type: 'boolean', labelKey: 'config.field.chain.disable-pending-transaction-limit', helpKey: 'config.help.chain.disable-pending-transaction-limit', dangerous: true },
  { section: 'chain', key: 'read-compute-bandwidth-limit', type: 'number', labelKey: 'config.field.chain.read-compute-bandwidth-limit', helpKey: 'config.help.chain.read-compute-bandwidth-limit', min: 0, step: 100000, advanced: true }
]

const MEMPOOL_FIELDS: ConfigFieldMeta[] = [
  { section: 'mempool', key: 'transaction-expiration', type: 'number', labelKey: 'config.field.mempool.transaction-expiration', helpKey: 'config.help.mempool.transaction-expiration', min: 10, max: 600, step: 10, advanced: true }
]

const BLOCK_STORE_FIELDS: ConfigFieldMeta[] = []

const P2P_FIELDS: ConfigFieldMeta[] = [
  { section: 'p2p', key: 'listen', type: 'text', labelKey: 'config.field.p2p.listen', helpKey: 'config.help.p2p.listen', placeholder: '/ip4/0.0.0.0/tcp/8888', advanced: true },
  { section: 'p2p', key: 'peer', type: 'string-array', labelKey: 'config.field.p2p.peer', helpKey: 'config.help.p2p.peer', placeholder: '/dns4/seed.koinos.io/tcp/8888/p2p/...' },
  { section: 'p2p', key: 'jobs', type: 'number', labelKey: 'config.field.p2p.jobs', helpKey: 'config.help.p2p.jobs', min: 1, max: 64, step: 1, advanced: true },
  { section: 'p2p', key: 'seed-reconnect-interval-seconds', type: 'number', labelKey: 'config.field.p2p.seed-reconnect-interval-seconds', helpKey: 'config.help.p2p.seed-reconnect-interval-seconds', min: 1, max: 3600, step: 1, advanced: true },
  { section: 'p2p', key: 'peer-discovery', type: 'boolean', labelKey: 'config.field.p2p.peer-discovery', helpKey: 'config.help.p2p.peer-discovery', advanced: true },
  { section: 'p2p', key: 'target-peer-count', type: 'number', labelKey: 'config.field.p2p.target-peer-count', helpKey: 'config.help.p2p.target-peer-count', min: 1, max: 100, step: 1, advanced: true },
  { section: 'p2p', key: 'max-peer-candidates', type: 'number', labelKey: 'config.field.p2p.max-peer-candidates', helpKey: 'config.help.p2p.max-peer-candidates', min: 1, max: 1000, step: 1, advanced: true },
  { section: 'p2p', key: 'max-candidate-dials-per-cycle', type: 'number', labelKey: 'config.field.p2p.max-candidate-dials-per-cycle', helpKey: 'config.help.p2p.max-candidate-dials-per-cycle', min: 1, max: 20, step: 1, advanced: true },
  { section: 'p2p', key: 'peer-acquisition-interval-seconds', type: 'number', labelKey: 'config.field.p2p.peer-acquisition-interval-seconds', helpKey: 'config.help.p2p.peer-acquisition-interval-seconds', min: 1, max: 300, step: 1, advanced: true },
  { section: 'p2p', key: 'candidate-redial-interval-seconds', type: 'number', labelKey: 'config.field.p2p.candidate-redial-interval-seconds', helpKey: 'config.help.p2p.candidate-redial-interval-seconds', min: 5, max: 3600, step: 5, advanced: true },
  { section: 'p2p', key: 'disable-gossip', type: 'boolean', labelKey: 'config.field.p2p.disable-gossip', helpKey: 'config.help.p2p.disable-gossip', advanced: true },
  { section: 'p2p', key: 'force-gossip', type: 'boolean', labelKey: 'config.field.p2p.force-gossip', helpKey: 'config.help.p2p.force-gossip', advanced: true },
  { section: 'p2p', key: 'checkpoint', type: 'string-array', labelKey: 'config.field.p2p.checkpoint', helpKey: 'config.help.p2p.checkpoint', advanced: true }
]

const BLOCK_PRODUCER_FIELDS: ConfigFieldMeta[] = [
  { section: 'block_producer', key: 'private-key-file', type: 'text', labelKey: 'config.field.block-producer.private-key-file', helpKey: 'config.help.block-producer.private-key-file', dangerous: true },
  { section: 'block_producer', key: 'pob-contract-id', type: 'text', labelKey: 'config.field.block-producer.pob-contract-id', helpKey: 'config.help.block-producer.pob-contract-id' },
  { section: 'block_producer', key: 'vhp-contract-id', type: 'text', labelKey: 'config.field.block-producer.vhp-contract-id', helpKey: 'config.help.block-producer.vhp-contract-id' },
  { section: 'block_producer', key: 'approve-proposals', type: 'string-array', labelKey: 'config.field.block-producer.approve-proposals', helpKey: 'config.help.block-producer.approve-proposals' }
]

const JSONRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'jsonrpc', key: 'listen', type: 'text', labelKey: 'config.field.jsonrpc.listen', helpKey: 'config.help.jsonrpc.listen', placeholder: '127.0.0.1:8080', advanced: true, dangerous: true },
  { section: 'jsonrpc', key: 'jobs', type: 'number', labelKey: 'config.field.jsonrpc.jobs', helpKey: 'config.help.jsonrpc.jobs', min: 1, max: 64, step: 1, advanced: true }
]

const GRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'grpc', key: 'listen', type: 'text', labelKey: 'config.field.grpc.endpoint', helpKey: 'config.help.grpc.endpoint', placeholder: '127.0.0.1:50051', advanced: true, dangerous: true },
  { section: 'grpc', key: 'jobs', type: 'number', labelKey: 'config.field.grpc.jobs', helpKey: 'config.help.grpc.jobs', min: 1, max: 64, step: 1, advanced: true }
]

const ROCKSDB_FIELDS: ConfigFieldMeta[] = [
  { section: 'rocksdb', key: 'block-cache-mb', type: 'number', labelKey: 'config.field.rocksdb.block-cache-mb', helpKey: 'config.help.rocksdb.block-cache-mb', min: 16, max: 8192, step: 16, advanced: true },
  { section: 'rocksdb', key: 'max-background-jobs', type: 'number', labelKey: 'config.field.rocksdb.max-background-jobs', helpKey: 'config.help.rocksdb.max-background-jobs', min: 1, max: 64, step: 1, advanced: true },
  { section: 'rocksdb', key: 'bytes-per-sync', type: 'number', labelKey: 'config.field.rocksdb.bytes-per-sync', helpKey: 'config.help.rocksdb.bytes-per-sync', min: 0, step: 65536, advanced: true },
  { section: 'rocksdb', key: 'default-block-size', type: 'number', labelKey: 'config.field.rocksdb.default-block-size', helpKey: 'config.help.rocksdb.default-block-size', min: 1024, step: 1024, advanced: true },
  { section: 'rocksdb', key: 'blocks-block-size', type: 'number', labelKey: 'config.field.rocksdb.blocks-block-size', helpKey: 'config.help.rocksdb.blocks-block-size', min: 1024, step: 1024, advanced: true },
  { section: 'rocksdb', key: 'target-file-size-base', type: 'number', labelKey: 'config.field.rocksdb.target-file-size-base', helpKey: 'config.help.rocksdb.target-file-size-base', min: 1048576, step: 1048576, advanced: true },
  { section: 'rocksdb', key: 'max-bytes-for-level-base', type: 'number', labelKey: 'config.field.rocksdb.max-bytes-for-level-base', helpKey: 'config.help.rocksdb.max-bytes-for-level-base', min: 1048576, step: 1048576, advanced: true },
  { section: 'rocksdb', key: 'write-buffer-size', type: 'number', labelKey: 'config.field.rocksdb.write-buffer-size', helpKey: 'config.help.rocksdb.write-buffer-size', min: 1048576, step: 1048576, advanced: true },
  { section: 'rocksdb', key: 'db-write-buffer-size', type: 'number', labelKey: 'config.field.rocksdb.db-write-buffer-size', helpKey: 'config.help.rocksdb.db-write-buffer-size', min: 1048576, step: 1048576, advanced: true },
  { section: 'rocksdb', key: 'max-write-buffer-number', type: 'number', labelKey: 'config.field.rocksdb.max-write-buffer-number', helpKey: 'config.help.rocksdb.max-write-buffer-number', min: 1, max: 16, step: 1, advanced: true },
  { section: 'rocksdb', key: 'blocks-compression', type: 'select', labelKey: 'config.field.rocksdb.blocks-compression', helpKey: 'config.help.rocksdb.blocks-compression', options: ['zstd', 'snappy', 'none'], advanced: true }
]

const ACCOUNT_HISTORY_FIELDS: ConfigFieldMeta[] = []

const TRANSACTION_STORE_FIELDS: ConfigFieldMeta[] = []

const CONTRACT_META_STORE_FIELDS: ConfigFieldMeta[] = []

const ALL_FIELDS: Record<ConfigSection, ConfigFieldMeta[]> = {
  global: GLOBAL_FIELDS,
  features: FEATURES_FIELDS,
  chain: CHAIN_FIELDS,
  mempool: MEMPOOL_FIELDS,
  block_store: BLOCK_STORE_FIELDS,
  p2p: P2P_FIELDS,
  block_producer: BLOCK_PRODUCER_FIELDS,
  jsonrpc: JSONRPC_FIELDS,
  grpc: GRPC_FIELDS,
  rocksdb: ROCKSDB_FIELDS,
  account_history: ACCOUNT_HISTORY_FIELDS,
  transaction_store: TRANSACTION_STORE_FIELDS,
  contract_meta_store: CONTRACT_META_STORE_FIELDS
}

export function getFieldsForSection(section: ConfigSection): ConfigFieldMeta[] {
  return ALL_FIELDS[section] || []
}

export type KoinosConfigValues = Partial<Record<ConfigSection, Record<string, unknown>>>

export interface IgnoredLegacyConfigEntry {
  path: string
  reasonKey: string
}

const IGNORED_LEGACY_FIELDS: Array<{ section: string; key: string; path: string; reasonKey: string }> = [
  { section: 'global', key: 'amqp', path: 'global.amqp', reasonKey: 'config.ignoredLegacy.reason.amqp' },
  { section: 'p2p', key: 'peer-exchange', path: 'p2p.peer-exchange', reasonKey: 'config.ignoredLegacy.reason.peerExchange' },
  { section: 'block_store', key: 'basedir', path: 'block_store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'block-store', key: 'basedir', path: 'block-store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'transaction_store', key: 'basedir', path: 'transaction_store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'transaction-store', key: 'basedir', path: 'transaction-store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'contract_meta_store', key: 'basedir', path: 'contract_meta_store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'contract-meta-store', key: 'basedir', path: 'contract-meta-store.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'account_history', key: 'basedir', path: 'account_history.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'account-history', key: 'basedir', path: 'account-history.basedir', reasonKey: 'config.ignoredLegacy.reason.storeBasedir' },
  { section: 'block_producer', key: 'pob-contract-id', path: 'block_producer.pob-contract-id', reasonKey: 'config.ignoredLegacy.reason.producerContractOverride' },
  { section: 'block-producer', key: 'pob-contract-id', path: 'block-producer.pob-contract-id', reasonKey: 'config.ignoredLegacy.reason.producerContractOverride' },
  { section: 'block_producer', key: 'vhp-contract-id', path: 'block_producer.vhp-contract-id', reasonKey: 'config.ignoredLegacy.reason.producerContractOverride' },
  { section: 'block-producer', key: 'vhp-contract-id', path: 'block-producer.vhp-contract-id', reasonKey: 'config.ignoredLegacy.reason.producerContractOverride' }
]

/**
 * Extract config values from a parsed YAML plain object (doc.toJSON()).
 * Maps YAML top-level keys (with hyphens) to ConfigSection names (with underscores).
 */
export function extractConfigValues(parsed: Record<string, unknown>): KoinosConfigValues {
  const values: KoinosConfigValues = {}
  if (!parsed || typeof parsed !== 'object') return values

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    // Koinos YAML uses hyphens (block-store), schema uses underscores (block_store)
    const section = rawKey.replace(/-/g, '_') as ConfigSection
    if (CONFIG_SECTIONS.includes(section) && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      values[section] = rawValue as Record<string, unknown>
    }
  }

  return values
}

export function findIgnoredLegacyConfigEntries(parsed: Record<string, unknown>): IgnoredLegacyConfigEntry[] {
  const entries: IgnoredLegacyConfigEntry[] = []
  if (!parsed || typeof parsed !== 'object') return entries

  for (const field of IGNORED_LEGACY_FIELDS) {
    const section = (parsed as Record<string, unknown>)[field.section]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    if (Object.prototype.hasOwnProperty.call(section, field.key)) {
      entries.push({ path: field.path, reasonKey: field.reasonKey })
    }
  }

  const p2p = (parsed as Record<string, unknown>).p2p
  if (p2p && typeof p2p === 'object' && !Array.isArray(p2p) && Object.prototype.hasOwnProperty.call(p2p, 'seed')) {
    const seed = (p2p as Record<string, unknown>).seed
    if (!Array.isArray(seed)) {
      entries.push({ path: 'p2p.seed', reasonKey: 'config.ignoredLegacy.reason.p2pSeed' })
    }
  }

  return entries
}
