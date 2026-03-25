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

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'string[]'

export interface ConfigFieldMeta {
  section: ConfigSection
  key: string
  type: ConfigFieldType
  label: string
  description?: string
  defaultValue?: unknown
}

// Field definitions per section
const GLOBAL_FIELDS: ConfigFieldMeta[] = [
  { section: 'global', key: 'amqp', type: 'string', label: 'AMQP URL', description: 'AMQP broker connection string', defaultValue: 'amqp://guest:guest@localhost:5672/' },
  { section: 'global', key: 'log-level', type: 'string', label: 'Log Level', description: 'Logging verbosity (debug, info, warn, error)', defaultValue: 'info' },
  { section: 'global', key: 'log-color', type: 'boolean', label: 'Log Color', description: 'Enable colored log output', defaultValue: true },
  { section: 'global', key: 'log-datetime', type: 'boolean', label: 'Log Datetime', description: 'Include timestamps in logs', defaultValue: true },
  { section: 'global', key: 'instance-id', type: 'string', label: 'Instance ID', description: 'Unique node instance identifier' },
  { section: 'global', key: 'jobs', type: 'number', label: 'Jobs', description: 'Number of worker threads', defaultValue: 16 }
]

const CHAIN_FIELDS: ConfigFieldMeta[] = [
  { section: 'chain', key: 'genesis-key', type: 'string', label: 'Genesis Key', description: 'Genesis block signing key' },
  { section: 'chain', key: 'read-compute-bandwidth-limit', type: 'number', label: 'Read Compute Bandwidth', description: 'Max compute bandwidth for read operations', defaultValue: 10000000 },
  { section: 'chain', key: 'fork-algorithm', type: 'string', label: 'Fork Algorithm', description: 'Block fork resolution algorithm', defaultValue: 'fifo' }
]

const MEMPOOL_FIELDS: ConfigFieldMeta[] = [
  { section: 'mempool', key: 'transaction-expiration', type: 'number', label: 'Transaction Expiration (s)', description: 'Seconds before pending transactions expire', defaultValue: 120 }
]

const BLOCK_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'block_store', key: 'basedir', type: 'string', label: 'Data Directory', description: 'Block storage directory path' }
]

const P2P_FIELDS: ConfigFieldMeta[] = [
  { section: 'p2p', key: 'listen', type: 'string', label: 'Listen Address', description: 'P2P listen address', defaultValue: '/ip4/0.0.0.0/tcp/8888' },
  { section: 'p2p', key: 'seed', type: 'string[]', label: 'Seed Nodes', description: 'Bootstrap peer addresses' },
  { section: 'p2p', key: 'peer-exchange', type: 'boolean', label: 'Peer Exchange', description: 'Enable peer exchange protocol', defaultValue: true },
  { section: 'p2p', key: 'disable-gossip', type: 'boolean', label: 'Disable Gossip', description: 'Disable gossip protocol', defaultValue: false }
]

const BLOCK_PRODUCER_FIELDS: ConfigFieldMeta[] = [
  { section: 'block_producer', key: 'private-key-file', type: 'string', label: 'Private Key File', description: 'Path to block producer private key' },
  { section: 'block_producer', key: 'pob-contract-id', type: 'string', label: 'PoB Contract ID', description: 'Proof of Burn contract address' },
  { section: 'block_producer', key: 'vhp-contract-id', type: 'string', label: 'VHP Contract ID', description: 'Virtual Hash Power contract address' },
  { section: 'block_producer', key: 'approve-proposals', type: 'string[]', label: 'Approve Proposals', description: 'Governance proposals to auto-approve' }
]

const JSONRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'jsonrpc', key: 'listen', type: 'string', label: 'Listen Address', description: 'JSON-RPC HTTP listen address', defaultValue: '0.0.0.0:8080' },
  { section: 'jsonrpc', key: 'whitelist', type: 'string[]', label: 'API Whitelist', description: 'Allowed JSON-RPC methods (empty = all)' }
]

const GRPC_FIELDS: ConfigFieldMeta[] = [
  { section: 'grpc', key: 'listen', type: 'string', label: 'Listen Address', description: 'gRPC listen address', defaultValue: '0.0.0.0:50051' }
]

const ACCOUNT_HISTORY_FIELDS: ConfigFieldMeta[] = [
  { section: 'account_history', key: 'basedir', type: 'string', label: 'Data Directory', description: 'Account history storage path' }
]

const TRANSACTION_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'transaction_store', key: 'basedir', type: 'string', label: 'Data Directory', description: 'Transaction store path' }
]

const CONTRACT_META_STORE_FIELDS: ConfigFieldMeta[] = [
  { section: 'contract_meta_store', key: 'basedir', type: 'string', label: 'Data Directory', description: 'Contract meta store path' }
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

export function extractConfigValues(doc: import('yaml').Document): KoinosConfigValues {
  const values: KoinosConfigValues = {}
  if (!doc || !doc.contents) return values

  const root = doc.contents
  if (!root || typeof (root as any).items === 'undefined') return values

  for (const item of (root as any).items || []) {
    const key = String(item.key)
    const section = key.replace(/-/g, '_') as ConfigSection
    if (CONFIG_SECTIONS.includes(section) && item.value && typeof (item.value as any).items !== 'undefined') {
      const sectionValues: Record<string, unknown> = {}
      for (const subItem of (item.value as any).items || []) {
        const subKey = String(subItem.key)
        const val = subItem.value
        if (val && typeof val.toJSON === 'function') {
          sectionValues[subKey] = val.toJSON()
        } else if (val !== null && val !== undefined) {
          sectionValues[subKey] = typeof val === 'object' && 'value' in val ? val.value : val
        }
      }
      values[section] = sectionValues
    }
  }

  return values
}
