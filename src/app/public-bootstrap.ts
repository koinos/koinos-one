import type { KoinosNetworkId } from './network'

export const TESTNET_PUBLIC_BOOTSTRAP_URL = 'https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap'
export const MAINNET_PUBLIC_BOOTSTRAP_URL = 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap'

export function publicBootstrapUrlForNetwork(network: KoinosNetworkId): string {
  if (network === 'testnet') return TESTNET_PUBLIC_BOOTSTRAP_URL
  if (network === 'mainnet') return MAINNET_PUBLIC_BOOTSTRAP_URL
  return ''
}

export function publicBootstrapDescriptionForNetwork(network: KoinosNetworkId): string {
  if (network === 'mainnet') {
    return 'Official read-only prodnet public backups for new mainnet nodes. Restore starts as an observer with block production disabled.'
  }
  if (network === 'testnet') {
    return 'Read-only signed testnet public backups for new testnet nodes. No SSH credentials are required.'
  }
  return 'Public backup restore is not available for custom networks.'
}
