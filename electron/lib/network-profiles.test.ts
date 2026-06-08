import { describe, expect, it } from 'vitest'

import {
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
})
