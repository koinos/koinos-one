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
  '/ip4/46.62.204.73/tcp/8888/p2p/QmPcF1YrxamfKGpyvP6uAZcPxnmK2WUBC4K4N5ZaWky8Sh',
  '/ip4/37.27.7.221/tcp/8888/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs',
  '/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea',
  '/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi',
  '/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8',
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
