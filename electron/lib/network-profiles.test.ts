import { describe, expect, it } from 'vitest'

import {
  MAINNET_PEER_ADDRESSES,
  TESTNET_PUBLIC_RPC_URLS,
  contractsForNetwork,
  defaultProfilesForNetwork,
  primaryPublicRpcUrlForNetwork,
  resolveNetworkProfile
} from './network-profiles'

describe('network profiles', () => {
  it('exposes explicit testnet rpc, peer, port, and contract defaults', () => {
    const testnet = resolveNetworkProfile('testnet')

    expect(testnet.publicRpcUrls).toEqual([...TESTNET_PUBLIC_RPC_URLS])
    expect(testnet.peerAddresses).toEqual([
      '/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W'
    ])
    expect(testnet.p2pListen).toBe('/ip4/0.0.0.0/tcp/18888')
    expect(testnet.jsonrpcListen).toBe('127.0.0.1:18122')
    expect(contractsForNetwork('testnet')).toMatchObject({
      koin: '1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju',
      vhp: '17n12ktwN79sR6ia9DDgCfmw77EgpbTyBi',
      pob: '1MAbK5pYkhp9yHnfhYamC3tfSLmVRTDjd9'
    })
  })

  it('infers testnet when profiles contain testnet presets', () => {
    const profile = resolveNetworkProfile(undefined, ['testnet_producer'])

    expect(profile.id).toBe('testnet')
    expect(defaultProfilesForNetwork('testnet')).toEqual(['testnet_observer'])
    expect(primaryPublicRpcUrlForNetwork('testnet')).toBe('https://testnet.koinosfoundation.org/jsonrpc')
  })

  it('uses corrected mainnet peer ids for GUI presets', () => {
    const mainnet = resolveNetworkProfile('mainnet')

    expect(mainnet.peerAddresses).toEqual([...MAINNET_PEER_ADDRESSES])
    expect(mainnet.peerAddresses).toEqual([
      '/ip4/46.62.204.73/tcp/8888/p2p/QmPcF1YrxamfKGpyvP6uAZcPxnmK2WUBC4K4N5ZaWky8Sh',
      '/ip4/37.27.7.221/tcp/8888/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs',
      '/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea',
      '/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi',
      '/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8'
    ])
    expect(mainnet.peerAddresses.join('\n')).not.toContain('QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP')
    expect(mainnet.peerAddresses.join('\n')).not.toContain('QmV8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs')
  })
})
