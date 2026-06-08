import { describe, expect, it } from 'vitest'

import {
  CONFIG_SECTIONS,
  extractConfigValues,
  findIgnoredLegacyConfigEntries,
  getFieldsForSection
} from './koinos-config-schema'

describe('koinos config schema', () => {
  it('does not expose known monolith no-op fields', () => {
    const visibleFields = CONFIG_SECTIONS.flatMap((section) =>
      getFieldsForSection(section)
        .filter((field) => !field.hidden)
        .map((field) => `${field.section}.${field.key}`)
    )

    expect(visibleFields).not.toContain('block_store.basedir')
    expect(visibleFields).not.toContain('transaction_store.basedir')
    expect(visibleFields).not.toContain('contract_meta_store.basedir')
    expect(visibleFields).not.toContain('account_history.basedir')
    expect(visibleFields).not.toContain('p2p.peer-exchange')
    expect(visibleFields).not.toContain('p2p.seed')
    expect(visibleFields).toContain('p2p.checkpoint')
    expect(visibleFields).toContain('global.blacklist')
    expect(visibleFields).toContain('global.whitelist')
    expect(visibleFields).toContain('rocksdb.block-cache-mb')
  })

  it('reports ignored legacy settings without including them in editable sections', () => {
    const parsed = {
      global: { amqp: 'amqp://guest:guest@localhost:5672/', blacklist: ['chain.propose_block'] },
      p2p: { 'peer-exchange': true, seed: 'stable-node-id', peer: ['/dns4/example/tcp/8888/p2p/QmPeer'] },
      'block-store': { basedir: '/tmp/old-block-store' },
      block_producer: { 'pob-contract-id': 'old-pob', producer: '1Producer' },
      rocksdb: { 'block-cache-mb': 512 }
    }

    const ignored = findIgnoredLegacyConfigEntries(parsed)
    expect(ignored.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'global.amqp',
        'p2p.peer-exchange',
        'p2p.seed',
        'block-store.basedir',
        'block_producer.pob-contract-id'
      ])
    )

    const extracted = extractConfigValues(parsed)
    expect(extracted.block_store).toBeUndefined()
    expect(extracted.rocksdb?.['block-cache-mb']).toBe(512)
    expect(extracted.global?.blacklist).toEqual(['chain.propose_block'])
  })
})
