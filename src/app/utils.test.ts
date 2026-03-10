import { describe, expect, it } from 'vitest'
import {
  expandNodeProfiles,
  filterBlocksByProducer,
  mapBlockItem,
  normalizeBackupTarGzUrl,
  normalizeDashboardProducerWindowBlocks,
  normalizeDashboardRefreshSeconds,
  normalizeExplorerRpcSource,
  normalizeNodeBaseDirInput,
  parseAnsiTextSegments,
  parsePublicRpcUrlsInput,
  resolveLocalNodeRpcUrl,
  resolveNodeFileDisplayPath,
  resolveProducerRpcUrl,
  sanitizeStoredPublicRpcUrls,
  sameProfiles,
  sameStringList,
  tryNormalizeHttpUrl
} from './utils'

describe('URL normalization', () => {
  it('normalizes and deduplicates stored public RPC URLs', () => {
    const result = sanitizeStoredPublicRpcUrls([
      'https://api.koinos.io',
      'https://api.koinos.io/',
      'https://api.koinosblocks.com',
      'ftp://example.com',
      'not-a-url'
    ])

    expect(result).toEqual(['https://api.koinos.io/', 'https://api.koinosblocks.com/'])
  })

  it('falls back to local source when selected source is not available', () => {
    const rpcList = ['https://api.koinos.io/', 'https://api.koinosblocks.com/']

    expect(normalizeExplorerRpcSource('https://invalid.example.com', rpcList, 'local')).toBe('local')
    expect(normalizeExplorerRpcSource('https://api.koinos.io', rpcList, 'local')).toBe('https://api.koinos.io/')
  })

  it('parses public RPC inputs from CSV/newlines and removes duplicates', () => {
    const parsed = parsePublicRpcUrlsInput(
      'https://api.koinos.io\nhttps://api.koinos.io/,https://api.koinosblocks.com',
      'en'
    )

    expect(parsed).toEqual(['https://api.koinos.io/', 'https://api.koinosblocks.com/'])
  })

  it('validates backup URL extension and protocol', () => {
    expect(normalizeBackupTarGzUrl('https://example.com/state.tar.gz', 'en')).toBe(
      'https://example.com/state.tar.gz'
    )
    expect(() => normalizeBackupTarGzUrl('https://example.com/state.zip', 'en')).toThrow()
    expect(() => normalizeBackupTarGzUrl('ftp://example.com/state.tar.gz', 'en')).toThrow()
  })

  it('accepts only http/https URLs in tryNormalizeHttpUrl', () => {
    expect(tryNormalizeHttpUrl('https://api.koinos.io')).toBe('https://api.koinos.io/')
    expect(tryNormalizeHttpUrl('ftp://api.koinos.io')).toBeNull()
    expect(tryNormalizeHttpUrl('')).toBeNull()
  })

  it('clamps dashboard settings to supported ranges', () => {
    expect(normalizeDashboardProducerWindowBlocks(12)).toBe(20)
    expect(normalizeDashboardProducerWindowBlocks(8200)).toBe(5000)
    expect(normalizeDashboardProducerWindowBlocks('200')).toBe(200)
    expect(normalizeDashboardRefreshSeconds(1)).toBe(2)
    expect(normalizeDashboardRefreshSeconds(300)).toBe(60)
    expect(normalizeDashboardRefreshSeconds('5')).toBe(5)
  })
})

describe('node path and state helpers', () => {
  it('normalizes base dir to end with .koinos', () => {
    expect(normalizeNodeBaseDirInput('~/data')).toBe('~/data/.koinos')
    expect(normalizeNodeBaseDirInput('~/data/.koinos/')).toBe('~/data/.koinos')
  })

  it('resolves relative managed file paths against repo path', () => {
    expect(resolveNodeFileDisplayPath('/tmp/koinos', 'docker-compose.yml')).toBe('/tmp/koinos/docker-compose.yml')
    expect(resolveNodeFileDisplayPath('/tmp/koinos', '/etc/hosts')).toBe('/etc/hosts')
  })

  it('compares string lists regardless of order/whitespace', () => {
    expect(sameStringList([' jsonrpc ', 'block_producer'], ['block_producer', 'jsonrpc'])).toBe(true)
    expect(sameStringList(['jsonrpc'], ['jsonrpc', 'amqp'])).toBe(false)
  })

  it('expands the block producer profile to include jsonrpc', () => {
    expect(expandNodeProfiles(['block_producer'])).toEqual(['block_producer', 'contract_meta_store', 'jsonrpc'])
  })

  it('treats block_producer and block_producer,jsonrpc as the same effective profile', () => {
    expect(sameProfiles(['block_producer'], ['block_producer', 'jsonrpc', 'contract_meta_store'])).toBe(true)
  })

  it('builds local node RPC URL from published jsonrpc port', () => {
    const status = {
      services: [
        {
          id: 'jsonrpc',
          ports: [
            {
              host: '0.0.0.0',
              publishedPort: 18080,
              targetPort: 8080,
              protocol: 'tcp',
              label: 'jsonrpc'
            }
          ]
        }
      ]
    } as unknown as KnodelKoinosNodeStatus

    expect(resolveLocalNodeRpcUrl(status)).toBe('http://127.0.0.1:18080/')
  })

  it('prefers the local producer RPC when jsonrpc is running', () => {
    const status = {
      services: [
        {
          id: 'jsonrpc',
          state: 'running',
          status: 'Up',
          lastError: null,
          ports: [
            {
              host: '127.0.0.1',
              publishedPort: 18080,
              targetPort: 8080,
              protocol: 'tcp',
              label: 'jsonrpc'
            }
          ]
        },
        {
          id: 'contract_meta_store',
          state: 'running',
          status: 'Up',
          lastError: null,
          ports: []
        }
      ]
    } as unknown as KnodelKoinosNodeStatus

    expect(resolveProducerRpcUrl(status, 'https://api.koinos.io/')).toBe('http://127.0.0.1:18080/')
  })

  it('falls back to the public producer RPC when contract metadata is not running', () => {
    const status = {
      services: [
        {
          id: 'jsonrpc',
          state: 'running',
          status: 'Up',
          lastError: null,
          ports: [
            {
              host: '127.0.0.1',
              publishedPort: 18080,
              targetPort: 8080,
              protocol: 'tcp',
              label: 'jsonrpc'
            }
          ]
        }
      ]
    } as unknown as KnodelKoinosNodeStatus

    expect(resolveProducerRpcUrl(status, 'https://api.koinos.io/')).toBe('https://api.koinos.io/')
  })
})

describe('block and ansi parsing helpers', () => {
  it('maps block store items into rows', () => {
    const mapped = mapBlockItem({
      block_id: 'legacy-block-id',
      block_height: '123',
      block: {
        id: '0xabc',
        header: {
          previous: '0xprev',
          height: '123',
          timestamp: '1700000000000',
          signer: '1A2B3C'
        }
      }
    })

    expect(mapped).toEqual({
      height: 123,
      blockId: '0xabc',
      previousId: '0xprev',
      signer: '1A2B3C',
      timestampMs: 1700000000000
    })
  })

  it('returns null for invalid block rows', () => {
    expect(mapBlockItem({ block_height: '0' })).toBeNull()
  })

  it('filters recent blocks to a single producer address', () => {
    const rows = [
      {
        height: 10,
        blockId: 'a',
        previousId: 'p1',
        signer: '1ABC',
        timestampMs: 1000
      },
      {
        height: 9,
        blockId: 'b',
        previousId: 'p2',
        signer: '1def',
        timestampMs: 900
      },
      {
        height: 8,
        blockId: 'c',
        previousId: 'p3',
        signer: ' 1abc ',
        timestampMs: 800
      }
    ]

    expect(filterBlocksByProducer(rows, '1aBc')).toEqual([rows[0], rows[2]])
    expect(filterBlocksByProducer(rows, '')).toEqual([])
  })

  it('splits ANSI colorized text into styled segments', () => {
    const segments = parseAnsiTextSegments('ok \u001b[31mERR\u001b[0m done')
    expect(segments).toHaveLength(3)
    expect(segments[0]?.text).toBe('ok ')
    expect(segments[1]?.text).toBe('ERR')
    expect(segments[1]?.style?.color).toBeDefined()
    expect(segments[2]?.text).toBe(' done')
  })
})
