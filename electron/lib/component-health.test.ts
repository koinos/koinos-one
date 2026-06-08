import { describe, expect, it } from 'vitest'

import { deriveMonolithComponentHealth } from './component-health'

describe('deriveMonolithComponentHealth', () => {
  it('marks enabled passive monolith modules as passive instead of unhealthy', () => {
    const components = deriveMonolithComponentHealth({
      output: [
        '[chain] Started',
        '[block_store] Started',
        '[p2p] Started',
        '[jsonrpc] Started'
      ].join('\n'),
      isRunning: true,
      featureFlags: {
        chain: true,
        mempool: true,
        block_store: true,
        p2p: true,
        jsonrpc: true,
        transaction_store: true,
        contract_meta_store: true,
        account_history: true,
        grpc: false,
        block_producer: false
      }
    })

    expect(components.find((component) => component.name === 'mempool')).toMatchObject({
      enabled: true,
      healthy: true,
      state: 'passive',
      details: 'Enabled'
    })
    expect(components.find((component) => component.name === 'transaction_store')).toMatchObject({
      enabled: true,
      healthy: true,
      state: 'passive'
    })
    expect(components.find((component) => component.name === 'jsonrpc')).toMatchObject({
      enabled: true,
      healthy: true,
      state: 'running'
    })
  })

  it('keeps disabled block producer disabled even when old producer log output exists', () => {
    const components = deriveMonolithComponentHealth({
      output: [
        '[block_producer] Gossip production gate opened',
        '[jsonrpc] Started'
      ].join('\n'),
      isRunning: true,
      featureFlags: {
        block_producer: false,
        jsonrpc: true
      }
    })

    expect(components.find((component) => component.name === 'block_producer')).toMatchObject({
      enabled: false,
      healthy: false,
      state: 'disabled',
      details: 'Disabled'
    })
  })
})
