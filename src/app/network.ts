export type KoinosNetworkId = 'mainnet' | 'testnet' | 'custom'

export const MAINNET_PUBLIC_RPC_URLS = ['https://api.koinos.io/', 'https://api.koinosblocks.com/'] as const
export const TESTNET_PUBLIC_RPC_URLS = ['https://testnet.koinosfoundation.org/jsonrpc'] as const

export const KOINOS_NETWORK_OPTIONS: Array<{ id: KoinosNetworkId; label: string; description: string }> = [
  {
    id: 'mainnet',
    label: 'Mainnet',
    description: 'Koinos mainnet with local JSON-RPC on 8080 by default.'
  },
  {
    id: 'testnet',
    label: 'Testnet',
    description: 'Koinos Foundation public testnet with local JSON-RPC on 18122 by default.'
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Use manually edited node config and endpoints.'
  }
]

export function normalizeKoinosNetworkId(value: unknown): KoinosNetworkId {
  if (value === 'testnet' || value === 'custom') return value
  return 'mainnet'
}

export function publicRpcUrlsForNetwork(network: KoinosNetworkId): string[] {
  if (network === 'testnet') return [...TESTNET_PUBLIC_RPC_URLS]
  return [...MAINNET_PUBLIC_RPC_URLS]
}

export function nativeTokenSymbolForNetwork(network: KoinosNetworkId): string {
  return network === 'testnet' ? 'vKOIN' : 'KOIN'
}
