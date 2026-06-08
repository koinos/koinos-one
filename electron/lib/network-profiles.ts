export type KoinosNetworkId = 'mainnet' | 'testnet' | 'custom';

export interface KoinosNetworkContracts {
  koin: string;
  vhp: string;
  pob: string;
}

export interface KoinosNetworkProfile {
  id: KoinosNetworkId;
  label: string;
  defaultProfiles: string[];
  publicRpcUrls: string[];
  peerAddresses: string[];
  p2pListen: string;
  jsonrpcListen: string;
  blockchainBackupUrl?: string;
  chainId?: string;
  contracts: KoinosNetworkContracts;
}

export const MAINNET_PUBLIC_RPC_URLS = [
  'https://api.koinos.io/',
  'https://api.koinosblocks.com/',
];

export const TESTNET_PUBLIC_RPC_URLS = [
  'https://testnet.koinosfoundation.org/jsonrpc',
];

export const MAINNET_BLOCKCHAIN_BACKUP_URL =
  'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz';

export const MAINNET_CONTRACTS: KoinosNetworkContracts = {
  koin: '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK',
  vhp: '12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq',
  pob: '159myq5YUhhoVWu3wsHKHiJYKPKGUrGiyv',
};

export const TESTNET_CONTRACTS: KoinosNetworkContracts = {
  koin: '1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju',
  vhp: '17n12ktwN79sR6ia9DDgCfmw77EgpbTyBi',
  pob: '1MAbK5pYkhp9yHnfhYamC3tfSLmVRTDjd9',
};

export const MAINNET_PEER_ADDRESSES = [
  '/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP',
  '/ip4/37.27.7.221/tcp/8888/p2p/QmV8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs',
  '/ip4/111.83.81.199/tcp/32422/p2p/12D3KooWDdVEWJJa3caBpaFCUU5UxriTzCgw3hakAULgW2f1CsWW',
  '/ip4/46.19.92.132/tcp/60873/p2p/QmbG8LQogAG3CeXqZquf3BajvwZrdjJXkZtVF9oeeqNJa4',
  '/ip4/94.124.166.167/tcp/15336/p2p/12D3KooWPrQeAT6BpYP6tz5Ma4oY2wFDPViN9YMKdEVNndK6nC1k',
  '/ip4/23.94.48.244/tcp/54123/p2p/12D3KooWPuobruMXUYMXSB5Dx3Cgtgc7vQQ5gbmD4CK66wkUukCFw',
  '/ip4/15.204.196.29/tcp/44782/p2p/12D3KooWNd4VUv8bamTw4NCmBJzhDak68u6uAA42XgQY4Bs7GsTG',
  '/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZVWcYaUnn6MuYF8Ea',
  '/ip4/13.13.242.42/tcp/8888/p2p/QmUEfw71aEnfibTZ7MvugkaN37gFUX18dEwMKeoSV3BCZf',
  '/ip4/157.180.8.166/tcp/8888/p2p/QmcX85x7jcwg4ZghqPUbzKmVR4GKJhk4EA8CNLz4XKs59v',
  '/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8',
  '/ip4/42.76.102.116/tcp/18322/p2p/12D3KooWK2RyJxbCdZVUGcveenTN5FbxjX7toNtdkWqZwqD6ueTx',
  '/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4XmXouu1Mmi',
];

export const TESTNET_PEER_ADDRESSES = [
  '/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W',
];

export const KOINOS_NETWORK_PROFILES: Record<KoinosNetworkId, KoinosNetworkProfile> = {
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    defaultProfiles: ['mainnet_observer'],
    publicRpcUrls: MAINNET_PUBLIC_RPC_URLS,
    peerAddresses: MAINNET_PEER_ADDRESSES,
    p2pListen: '/ip4/0.0.0.0/tcp/8888',
    jsonrpcListen: '127.0.0.1:8080',
    blockchainBackupUrl: MAINNET_BLOCKCHAIN_BACKUP_URL,
    contracts: MAINNET_CONTRACTS,
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    defaultProfiles: ['testnet_observer'],
    publicRpcUrls: TESTNET_PUBLIC_RPC_URLS,
    peerAddresses: TESTNET_PEER_ADDRESSES,
    p2pListen: '/ip4/0.0.0.0/tcp/18888',
    jsonrpcListen: '127.0.0.1:18122',
    chainId: 'EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==',
    contracts: TESTNET_CONTRACTS,
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    defaultProfiles: [],
    publicRpcUrls: MAINNET_PUBLIC_RPC_URLS,
    peerAddresses: [],
    p2pListen: '/ip4/0.0.0.0/tcp/8888',
    jsonrpcListen: '127.0.0.1:8080',
    contracts: MAINNET_CONTRACTS,
  },
};

export function normalizeKoinosNetworkId(value: unknown): KoinosNetworkId {
  if (value === 'testnet' || value === 'custom') {
    return value;
  }
  return 'mainnet';
}

export function inferNetworkFromProfiles(profiles: string[] | undefined): KoinosNetworkId {
  const profileSet = new Set((profiles ?? []).map((profile) => profile.trim()));
  if ([...profileSet].some((profile) => profile.startsWith('testnet_') || profile === 'testnet')) {
    return 'testnet';
  }
  return 'mainnet';
}

export function resolveNetworkProfile(network: unknown, profiles?: string[]): KoinosNetworkProfile {
  if (network === undefined || network === null || network === '') {
    return KOINOS_NETWORK_PROFILES[inferNetworkFromProfiles(profiles)];
  }
  return KOINOS_NETWORK_PROFILES[normalizeKoinosNetworkId(network)];
}

export function defaultProfilesForNetwork(network: KoinosNetworkId): string[] {
  return [...KOINOS_NETWORK_PROFILES[network].defaultProfiles];
}

export function publicRpcUrlsForNetwork(network: KoinosNetworkId): string[] {
  return [...KOINOS_NETWORK_PROFILES[network].publicRpcUrls];
}

export function primaryPublicRpcUrlForNetwork(network: KoinosNetworkId): string {
  return KOINOS_NETWORK_PROFILES[network].publicRpcUrls[0] ?? MAINNET_PUBLIC_RPC_URLS[0];
}

export function contractsForNetwork(network: KoinosNetworkId): KoinosNetworkContracts {
  return KOINOS_NETWORK_PROFILES[network].contracts;
}
