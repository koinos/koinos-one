import { describe, expect, it } from 'vitest'

import {
  formatProducerOverviewActivityWarning,
  isProducerOverviewTimeoutError,
  normalizeDashboardProducerWindowBlocks,
  parseLatestP2pPeersSnapshot
} from './producer-service'

describe('producer-service helpers', () => {
  it('detects producer timeout errors', () => {
    expect(isProducerOverviewTimeoutError(new Error('rpc failed, context deadline exceeded'))).toBe(true)
    expect(isProducerOverviewTimeoutError(new Error('Timed out while loading producer overview'))).toBe(true)
    expect(isProducerOverviewTimeoutError(new Error('permission denied'))).toBe(false)
  })

  it('formats producer activity warnings based on timeout detection', () => {
    expect(formatProducerOverviewActivityWarning('http://127.0.0.1:8080/', new Error('context deadline exceeded'))).toBe(
      '24h producer stats are temporarily unavailable from http://127.0.0.1:8080/.'
    )
    expect(formatProducerOverviewActivityWarning('https://api.koinos.io/', new Error('boom'))).toBe(
      '24h producer stats could not be loaded from https://api.koinos.io/.'
    )
  })

  it('normalizes dashboard producer window bounds', () => {
    expect(normalizeDashboardProducerWindowBlocks(undefined)).toBe(200)
    expect(normalizeDashboardProducerWindowBlocks('17')).toBe(20)
    expect(normalizeDashboardProducerWindowBlocks(201.6)).toBe(202)
    expect(normalizeDashboardProducerWindowBlocks(999999)).toBe(5000)
  })

  it('parses the latest p2p peer snapshot from logs', () => {
    const snapshot = parseLatestP2pPeersSnapshot(`
2026-03-11 09:40:00.123456 (p2p.Koinos) <info>: My address:
  - /ip4/127.0.0.1/tcp/8888/p2p/SELF
2026-03-11 09:40:01.123456 (p2p.Koinos) <info>: Connected peers:
  - /ip4/10.0.0.2/tcp/8899/p2p/PEER1
  - /dns4/example.com/tcp/9999/p2p/PEER2
  and 3 more
`)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.selfAddress).toBe('/ip4/127.0.0.1/tcp/8888/p2p/SELF')
    expect(snapshot?.omittedPeerCount).toBe(3)
    expect(snapshot?.rows).toEqual([
      {
        address: '/ip4/10.0.0.2/tcp/8899/p2p/PEER1',
        peerId: 'PEER1',
        host: '10.0.0.2',
        port: 8899
      },
      {
        address: '/dns4/example.com/tcp/9999/p2p/PEER2',
        peerId: 'PEER2',
        host: 'example.com',
        port: 9999
      }
    ])
    expect(snapshot?.snapshotAt).toBe(Date.parse('2026-03-11T09:40:01.123'))
  })
})
