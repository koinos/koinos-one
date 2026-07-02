import type { TelenoNodePreset, TelenoNodeSettings } from './main-types'
import {
  MAINNET_PEER_ADDRESSES,
  TESTNET_PEER_ADDRESSES,
  resolveNetworkProfile
} from './network-profiles'

export const MONOLITH_OBSERVER_FEATURES: Record<string, boolean> = {
  chain: true,
  mempool: true,
  block_store: true,
  p2p: true,
  jsonrpc: true,
  grpc: false,
  block_producer: false,
  contract_meta_store: false,
  transaction_store: false,
  account_history: false
}

export const MONOLITH_PRODUCER_FEATURES: Record<string, boolean> = {
  ...MONOLITH_OBSERVER_FEATURES,
  block_producer: true,
  contract_meta_store: true
}

export const MONOLITH_FULL_NODE_FEATURES: Record<string, boolean> = {
  ...MONOLITH_OBSERVER_FEATURES,
  grpc: true,
  contract_meta_store: true,
  transaction_store: true,
  account_history: true
}

export const MONOLITH_CUSTOM_ADVANCED_FEATURES: Record<string, boolean> = {
  ...MONOLITH_OBSERVER_FEATURES,
  grpc: true,
  contract_meta_store: true,
  transaction_store: true,
  account_history: true
}

function normalizeProfileList(profiles: string[]): string[] {
  return profiles.map((profile) => profile.trim()).filter(Boolean).sort()
}

export function monolithProfilesMatch(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeProfileList(left)
  const normalizedRight = normalizeProfileList(right)
  if (normalizedLeft.length !== normalizedRight.length) return false
  return normalizedLeft.every((profile, index) => profile === normalizedRight[index])
}

/** Build feature flags for a preset/profile selection in monolith mode. */
export function presetToFeatureFlags(presetIdOrProfiles: string | string[]): Record<string, boolean> {
  const presetId = Array.isArray(presetIdOrProfiles)
    ? presetIdOrProfiles.join(',')
    : presetIdOrProfiles

  if (presetId.includes('mainnet_observer') || presetId.includes('testnet_observer')) {
    return { ...MONOLITH_OBSERVER_FEATURES }
  }
  if (presetId.includes('full_node')) {
    return { ...MONOLITH_FULL_NODE_FEATURES }
  }
  if (presetId.includes('block_producer') || presetId.includes('testnet_producer') || presetId.includes('producer')) {
    return { ...MONOLITH_PRODUCER_FEATURES }
  }
  if (presetId.includes('custom_advanced')) {
    return { ...MONOLITH_CUSTOM_ADVANCED_FEATURES }
  }

  const flags: Record<string, boolean> = {}

  for (const comp of ['chain', 'mempool', 'block_store', 'p2p']) flags[comp] = true
  for (const comp of ['block_producer', 'jsonrpc', 'grpc', 'transaction_store', 'contract_meta_store', 'account_history']) {
    flags[comp] = false
  }

  if (presetId.includes('block_producer')) {
    flags.block_producer = true
    flags.jsonrpc = true
    flags.contract_meta_store = true
  }
  if (presetId.includes('jsonrpc')) flags.jsonrpc = true
  if (presetId.includes('grpc')) flags.grpc = true
  if (presetId.includes('transaction_store')) flags.transaction_store = true
  if (presetId.includes('contract_meta_store')) flags.contract_meta_store = true
  if (presetId.includes('account_history')) flags.account_history = true

  return flags
}

export function buildProfilePresets(settings: TelenoNodeSettings): TelenoNodePreset[] {
  const mainnet = resolveNetworkProfile('mainnet')
  const testnet = resolveNetworkProfile('testnet')
  const presets: TelenoNodePreset[] = [
    {
      id: 'profile:mainnet_observer',
      label: 'Mainnet Seed',
      network: 'mainnet',
      source: 'features',
      profiles: ['mainnet_observer'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_OBSERVER_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: MAINNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: mainnet.p2pListen },
          { path: ['p2p', 'seed-reconnect-interval-seconds'], value: 60 },
          { path: ['p2p', 'peer-discovery'], value: true },
          { path: ['p2p', 'target-peer-count'], value: 20 },
          { path: ['p2p', 'max-peer-candidates'], value: 200 },
          { path: ['p2p', 'max-candidate-dials-per-cycle'], value: 3 },
          { path: ['p2p', 'peer-acquisition-interval-seconds'], value: 5 },
          { path: ['p2p', 'candidate-redial-interval-seconds'], value: 60 },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: mainnet.jsonrpcListen }
        ]
      },
      description: 'Mainnet seed with P2P and local JSON-RPC enabled; block production disabled.'
    },
    {
      id: 'profile:testnet_observer',
      label: 'Testnet Seed',
      network: 'testnet',
      source: 'features',
      profiles: ['testnet_observer'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_OBSERVER_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: TESTNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: testnet.p2pListen },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: testnet.jsonrpcListen }
        ]
      },
      description: 'Public testnet seed using the Koinos Foundation testnet peer and local testnet ports.'
    },
    {
      id: 'profile:mainnet_full_node',
      label: 'Mainnet Full Node',
      network: 'mainnet',
      source: 'features',
      profiles: ['mainnet_full_node'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_FULL_NODE_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: MAINNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: mainnet.p2pListen },
          { path: ['p2p', 'seed-reconnect-interval-seconds'], value: 60 },
          { path: ['p2p', 'peer-discovery'], value: true },
          { path: ['p2p', 'target-peer-count'], value: 20 },
          { path: ['p2p', 'max-peer-candidates'], value: 200 },
          { path: ['p2p', 'max-candidate-dials-per-cycle'], value: 3 },
          { path: ['p2p', 'peer-acquisition-interval-seconds'], value: 5 },
          { path: ['p2p', 'candidate-redial-interval-seconds'], value: 60 },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: mainnet.jsonrpcListen }
        ]
      },
      description: 'Mainnet full node with JSON-RPC, gRPC, contract metadata, transaction store, and account history enabled; block production disabled.'
    },
    {
      id: 'profile:testnet_full_node',
      label: 'Testnet Full Node',
      network: 'testnet',
      source: 'features',
      profiles: ['testnet_full_node'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_FULL_NODE_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: TESTNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: testnet.p2pListen },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: testnet.jsonrpcListen }
        ]
      },
      description: 'Testnet full node with JSON-RPC, gRPC, contract metadata, transaction store, and account history enabled; block production disabled.'
    },
    {
      id: 'profile:block_producer',
      label: 'Mainnet Producer',
      network: 'mainnet',
      source: 'features',
      profiles: ['block_producer'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_PRODUCER_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: MAINNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: mainnet.p2pListen },
          { path: ['p2p', 'seed-reconnect-interval-seconds'], value: 60 },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: mainnet.jsonrpcListen }
        ]
      },
      description: 'Mainnet producer mode. Producer address and key material are managed from the Producer tab.'
    },
    {
      id: 'profile:testnet_producer',
      label: 'Testnet Producer',
      network: 'testnet',
      source: 'features',
      profiles: ['testnet_producer'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_PRODUCER_FEATURES },
      configPatch: {
        set: [
          { path: ['p2p', 'peer'], value: TESTNET_PEER_ADDRESSES },
          { path: ['p2p', 'listen'], value: testnet.p2pListen },
          { path: ['p2p', 'peer-log-interval-seconds'], value: 60 },
          { path: ['jsonrpc', 'listen'], value: testnet.jsonrpcListen }
        ]
      },
      description: 'Testnet producer preset for local validation; block production must still be configured explicitly.'
    },
    {
      id: 'profile:custom_advanced',
      label: 'Custom Advanced',
      network: 'custom',
      source: 'features',
      profiles: ['custom_advanced'],
      services: ['teleno-node'],
      featureFlags: { ...MONOLITH_CUSTOM_ADVANCED_FEATURES },
      description: 'Advanced operator preset with optional query/index services enabled and block production disabled.'
    }
  ]
  return presets.filter((preset) => preset.network === settings.network)
}

export function monolithFeaturePlanForSettings(settings: TelenoNodeSettings): {
  preset: TelenoNodePreset | null
  featureFlags: Record<string, boolean>
  configPatch?: TelenoNodePreset['configPatch']
} {
  const preset = buildProfilePresets(settings).find((candidate) =>
    monolithProfilesMatch(candidate.profiles, settings.profiles)
  ) ?? null

  return {
    preset,
    featureFlags: preset?.featureFlags ?? presetToFeatureFlags(settings.profiles),
    configPatch: preset?.configPatch
  }
}
