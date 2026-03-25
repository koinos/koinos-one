// Koinos node YAML configuration schema for the Microservices Config Panel

export type ConfigSection =
  | 'global'
  | 'chain'
  | 'mempool'
  | 'block_store'
  | 'p2p'
  | 'block_producer'
  | 'jsonrpc'
  | 'grpc'
  | 'account_history'
  | 'transaction_store'
  | 'contract_meta_store'

export const CONFIG_SECTIONS: ConfigSection[] = [
  'global',
  'chain',
  'mempool',
  'block_store',
  'p2p',
  'block_producer',
  'jsonrpc',
  'grpc',
  'account_history',
  'transaction_store',
  'contract_meta_store'
]

export const CONFIG_SECTION_LABEL_KEYS: Record<ConfigSection, string> = {
  global: 'config.section.global',
  chain: 'config.section.chain',
  mempool: 'config.section.mempool',
  block_store: 'config.section.block_store',
  p2p: 'config.section.p2p',
  block_producer: 'config.section.block_producer',
  jsonrpc: 'config.section.jsonrpc',
  grpc: 'config.section.grpc',
  account_history: 'config.section.account_history',
  transaction_store: 'config.section.transaction_store',
  contract_meta_store: 'config.section.contract_meta_store'
}

export const CONFIG_SECTION_DESC_KEYS: Record<ConfigSection, string> = {
  global: 'config.desc.global',
  chain: 'config.desc.chain',
  mempool: 'config.desc.mempool',
  block_store: 'config.desc.block_store',
  p2p: 'config.desc.p2p',
  block_producer: 'config.desc.block_producer',
  jsonrpc: 'config.desc.jsonrpc',
  grpc: 'config.desc.grpc',
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
  min?: number
  max?: number
  step?: number
  options?: string[]
}

// ---- Field definitions per section ----
// labelKey format: config.field.<section>.<key>
// helpKey format:  config.help.<section>.<key>

const GLOBAL_FIELDS: ConfigFieldMeta[] = [
  { section: 'global', key: 'amqp', type: 'text', labelKey: 'config.field.global.amqp', helpKey: 'config.help.global.amqp', placeholder: 'amqp://guest:guest@localhost:5672/' },
  { section: 'global', key: 'log-level', type: 'select', labelKey: 'config.field.global.log-level', helpKey: 'config.help.global.log-level', options: ['debug', 'info', 'warn', 'error'] },
  { section: 'global', key: 'log-color', type: 'boolean', labelKey: 'config.field.global.log-color', helpKey: 'config.help.global.log-color' },
  { section: 'global', key: 'log-datetime', type: 'boolean', labelKey: 'config.field.global.log-datetime', helpKey: 'config.help.global.log-datetime' },
  { section: 'global', key: 'instance-id', type: 'text', labelKey: 'config.field.global.instance-id', helpKey: 'config.help.global.instance-id' },
  { section: 'global', key: 'fork-algorithm', type: 'select', labelKey: 'config.field.global.fork-algorithm', helpKey: 'config.help.global.fork-algorithm', options: ['fifo', 'pob', 'block-time'] },
  { section: 'global', key: 'jobs', type: 'number', labelKey: 'config.field.global.jobs', helpKey: 'config.help.global.jobs', min: 1, max: 64, step: 1 },
  { section: 'global', key: 'blacklist', type: 'string-array', labelKey: 'config.field.global.blacklist', helpKey: 'config.help.global.blacklist' },
  { section: 'global', key: 'whitelist', type: 'string-array', labelKey: 'config.field.global.whitelist', helpKey: 'config.help.global.whitelist' },
  { section: 'global', key: 'reset', type: 'boolean', labelKey: 'config.field.global.reset', helpKey: 'config.help.global.reset', dangerous: true }
]

const CHAIN_FIELDS: ConfigFieldMeta[] = [
  { section: 'chain', key: 'verify-blocks', type: 'boolean', labelKey: 'config.field.chain.verify-blocks', helpKey: 'config.help.chain.verify-blocks' },
  { section: 'chain', key: 'pending-transaction-limit', type: 'number', labelKey: 'config.field.chain.pending-transaction-limit', helpKey: 'config.help.chain.pending-transaction-limit', min: 1, max: 1000, step: 1 },
  { section: 'chain', key: 'disable-pending-transaction-limit', type: 'boolean', labelKey: 'config.field.chain.disable-pending-transaction-limit', helpKey: 'config.help.chain.disable-pending-transaction-limit', dangerous: true },
  { section: 'chain', key: 'read-compute-bandwidth-limit', type: 'number', labelKey: 'config.field.chain.read-compute-bandwidth-limit', helpKey: 'config.help.chain.read-compute-bandwidth-limit', min: 0, step: 100000 }
]

const MEMPOOL_FIELDS: ConfigFieldMeta[] = [
  { section: 'mempool', key: 'transaction-expiration', type: 'number', labelKey: 'config.field.mempool.transaction-expiration', helpKey: 'config.help.mempool.transaction-expiration', min: 10, max: 600, step: 10 }
]

const BLOCK_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'block_store', key: 'basedir', type: 'text', labelKey: 'config.field.block-store.basedir', helpKey: 'config.help.block-store.basedir' }
]

const P2P_FIELDS: ConfigFieldMeta[] = [
  { section: 'p2p', key: 'listen', type: 'text', labelKey: 'config.field.p2p.listen', helpKey: 'config.help.p2p.listen', placeholder: '/ip4/0.0.0.0/tcp/8888' },
  { section: 'p2p', key: 'seed', type: 'string-array', labelKey: 'config.field.p2p.seed', helpKey: 'config.help.p2p.seed', placeholder: '/dns4/seed.koinos.io/tcp/8888/p2p/...' },
  { section: 'p2p', key: 'peer-exchange', type: 'boolean', labelKey: 'config.field.p2p.peer-exchange', helpKey: 'config.help.p2p.peer-exchange' },
  { section: 'p2p', key: 'disable-gossip', type: 'boolean', labelKey: 'config.field.p2p.disable-gossip', helpKey: 'config.help.p2p.disable-gossip' },
  { section: 'p2p', key: 'force-gossip', type: 'boolean', labelKey: 'config.field.p2p.force-gossip', helpKey: 'config.help.p2p.force-gossip' },
  { section: 'p2p', key: 'checkpoint', type: 'string-array', labelKey: 'config.field.p2p.checkpoint', helpKey: 'config.help.p2p.checkpoint' }
]

const BLOCK_PRODUCER_FIELDS: ConfigFieldMeta[] = [
  { section: 'block_producer', key: 'private-key-file', type: 'text', labelKey: 'config.field.block-producer.private-key-file', helpKey: 'config.help.block-producer.private-key-file', dangerous: true },
  { section: 'block_producer', key: 'pob-contract-id', type: 'text', labelKey: 'config.field.block-producer.pob-contract-id', helpKey: 'config.help.block-producer.pob-contract-id' },
  { section: 'block_producer', key: 'vhp-contract-id', type: 'text', labelKey: 'config.field.block-producer.vhp-contract-id', helpKey: 'config.help.block-producer.vhp-contract-id' },
  { section: 'block_producer', key: 'approve-proposals', type: 'string-array', labelKey: 'config.field.block-producer.approve-proposals', helpKey: 'config.help.block-producer.approve-proposals' }
]

const JSONRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'jsonrpc', key: 'listen', type: 'text', labelKey: 'config.field.jsonrpc.listen', helpKey: 'config.help.jsonrpc.listen', placeholder: '0.0.0.0:8080' }
]

const GRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'grpc', key: 'listen', type: 'text', labelKey: 'config.field.grpc.endpoint', helpKey: 'config.help.grpc.endpoint', placeholder: '0.0.0.0:50051' }
]

const ACCOUNT_HISTORY_FIELDS: ConfigFieldMeta[] = [
  { section: 'account_history', key: 'basedir', type: 'text', labelKey: 'config.field.account-history.basedir', helpKey: 'config.help.account-history.basedir' }
]

const TRANSACTION_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'transaction_store', key: 'basedir', type: 'text', labelKey: 'config.field.transaction-store.basedir', helpKey: 'config.help.transaction-store.basedir' }
]

const CONTRACT_META_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'contract_meta_store', key: 'basedir', type: 'text', labelKey: 'config.field.contract-meta-store.basedir', helpKey: 'config.help.contract-meta-store.basedir' }
]

const ALL_FIELDS: Record<ConfigSection, ConfigFieldMeta[]> = {
  global: GLOBAL_FIELDS,
  chain: CHAIN_FIELDS,
  mempool: MEMPOOL_FIELDS,
  block_store: BLOCK_STORE_FIELDS,
  p2p: P2P_FIELDS,
  block_producer: BLOCK_PRODUCER_FIELDS,
  jsonrpc: JSONRPC_FIELDS,
  grpc: GRPC_FIELDS,
  account_history: ACCOUNT_HISTORY_FIELDS,
  transaction_store: TRANSACTION_STORE_FIELDS,
  contract_meta_store: CONTRACT_META_STORE_FIELDS
}

export function getFieldsForSection(section: ConfigSection): ConfigFieldMeta[] {
  return ALL_FIELDS[section] || []
}

export type KoinosConfigValues = Partial<Record<ConfigSection, Record<string, unknown>>>

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
