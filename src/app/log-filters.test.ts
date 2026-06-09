import { describe, expect, it } from 'vitest'

import {
  filterLogOutput,
  listLogComponents,
  parseLogLineComponent,
  parseLogLineLevel
} from './log-filters'

describe('log filters', () => {
  const sample = [
    '2026-06-09 21:07:11.717959 (koinos_node.jeimN) [p2p_node.cpp:673] <info>: [p2p] Syncing from QmSeed',
    '2026-06-09 21:07:19.552868 (koinos_node.jeimN) [controller.cpp:467] <info>: Sync progress - Height: 47000',
    '2026-06-09 21:08:00.000000 (koinos_node.jeimN) [db.cpp:42] <error>: [db] Failed to open RocksDB',
    '* lock file is held by another process',
    '2026-06-09 21:08:05.000000 (block_producer.Koinos) [pob_producer.cpp:498] <warning>: Producing with low VHP'
  ].join('\n')

  it('parses Koinos-style log levels', () => {
    expect(parseLogLineLevel('<info>: hello')).toBe('info')
    expect(parseLogLineLevel('<\u001b[32minfo\u001b[0m>: hello')).toBe('info')
    expect(parseLogLineLevel('<warning>: hello')).toBe('warn')
    expect(parseLogLineLevel('<critical>: hello')).toBe('fatal')
    expect(parseLogLineLevel('plain line')).toBeNull()
  })

  it('parses message component tags before falling back to process component names', () => {
    expect(parseLogLineComponent('[p2p_node.cpp:673] <info>: [p2p] Syncing')).toBe('p2p')
    expect(parseLogLineComponent('(block_producer.Koinos) [pob_producer.cpp:498] <warning>: Producing')).toBe('block_producer')
    expect(parseLogLineComponent('(koinos_node.jeimN) [main.cpp:1] <info>: hello')).toBeNull()
  })

  it('filters by component while preserving continuation lines', () => {
    expect(filterLogOutput(sample, { level: 'all', component: 'db' })).toBe([
      '2026-06-09 21:08:00.000000 (koinos_node.jeimN) [db.cpp:42] <error>: [db] Failed to open RocksDB',
      '* lock file is held by another process'
    ].join('\n'))
  })

  it('filters by level and treats fatal as an error-level match', () => {
    expect(filterLogOutput('<critical>: [db] bad\n<info>: [p2p] ok', { level: 'error', component: 'all' }))
      .toBe('<critical>: [db] bad')
  })

  it('filters by minimum severity level', () => {
    expect(filterLogOutput('<info>: [p2p] ok\n<warning>: [p2p] careful\n<error>: [db] bad', { level: 'warn', component: 'all' }))
      .toBe('<warning>: [p2p] careful\n<error>: [db] bad')
  })

  it('returns known components first and discovers additional components from output', () => {
    expect(listLogComponents(sample, ['p2p', 'block_store'])).toEqual([
      'all',
      'p2p',
      'block_store',
      'block_producer',
      'db'
    ])
  })
})
