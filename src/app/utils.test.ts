import { describe, expect, it } from 'vitest'
import { NODE_NETWORK_BASEDIRS_STORAGE_KEY, NODE_SETTINGS_STORAGE_KEY } from './constants'
import {
  defaultNodeBaseDirForNetwork,
  defaultNodeProfilesForNetwork,
  expandNodeProfiles,
  filterBlocksByProducer,
  formatBytes,
  formatCpuPercent,
  formatDurationSeconds,
  formatKoinscanBlockUrl,
  loadInitialNodeSettings,
  mapBlockItem,
  normalizeBackupTarGzUrl,
  normalizeDashboardProducerWindowBlocks,
  normalizeDashboardRefreshSeconds,
  normalizeExternalHttpsUrl,
  normalizeExplorerRpcSource,
  normalizeNodeBaseDirInput,
  parseAnsiTextSegments,
  parsePublicRpcUrlsInput,
  resolveNodeBaseDirForNetwork,
  resolveLocalNodeRpcUrl,
  resolveNodeFileDisplayPath,
  resolveProducerRpcUrl,
  sanitizeStoredPublicRpcUrls,
  sameProfiles,
  sameStringList,
  storeNodeBaseDirForNetwork,
  tryNormalizeHttpUrl
} from './utils'

function withMockLocalStorage(run: (store: Map<string, string>) => void): void {
  const previousWindow = (globalThis as { window?: unknown }).window
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      }
    }
  }

  try {
    run(store)
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      ;(globalThis as { window?: unknown }).window = previousWindow
    }
  }
}

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

  it('normalizes the Koinscan address and builds block links', () => {
    expect(normalizeExternalHttpsUrl('koinscan.com')).toBe('https://koinscan.com/')
    expect(formatKoinscanBlockUrl('koinscan.com', 123)).toBe('https://koinscan.com/blocks/123')
  })

  it('clamps dashboard settings to supported ranges', () => {
    expect(normalizeDashboardProducerWindowBlocks(12)).toBe(20)
    expect(normalizeDashboardProducerWindowBlocks(8200)).toBe(5000)
    expect(normalizeDashboardProducerWindowBlocks('200')).toBe(200)
    expect(normalizeDashboardRefreshSeconds(1)).toBe(2)
    expect(normalizeDashboardRefreshSeconds(300)).toBe(60)
    expect(normalizeDashboardRefreshSeconds('5')).toBe(5)
  })

  it('formats bytes, cpu percentages, and durations for dashboard performance', () => {
    expect(formatBytes(1536, 'en-US')).toBe('1.5 KB')
    expect(formatCpuPercent(12.34, 'en-US')).toBe('12.3%')
    expect(formatDurationSeconds(3661)).toBe('1h 1m 1s')
  })
})

describe('node path and state helpers', () => {
  it('normalizes base dir to end with .koinos while preserving Teleno and legacy app basedirs', () => {
    expect(normalizeNodeBaseDirInput('~/data')).toBe('~/data/.koinos')
    expect(normalizeNodeBaseDirInput('~/data/.koinos/')).toBe('~/data/.koinos')
    expect(normalizeNodeBaseDirInput('~/.teleno/')).toBe('~/.teleno')
    expect(normalizeNodeBaseDirInput('~/.koinosgui/')).toBe('~/.koinosgui')
  })

  it('stores and resolves node base dirs independently per network', () => {
    withMockLocalStorage(() => {
      storeNodeBaseDirForNetwork('testnet', '/Volumes/external/teleno-testnet-producer/basedir')

      expect(resolveNodeBaseDirForNetwork('testnet')).toBe('/Volumes/external/teleno-testnet-producer/basedir')
      expect(resolveNodeBaseDirForNetwork('mainnet')).toBe(defaultNodeBaseDirForNetwork('mainnet'))
    })
  })

  it('does not store a known testnet base dir as the mainnet base dir', () => {
    withMockLocalStorage(() => {
      const testnetBaseDir = '/Volumes/external/teleno-testnet-producer/basedir'

      storeNodeBaseDirForNetwork('testnet', testnetBaseDir)
      storeNodeBaseDirForNetwork('mainnet', testnetBaseDir)

      expect(resolveNodeBaseDirForNetwork('testnet')).toBe(testnetBaseDir)
      expect(resolveNodeBaseDirForNetwork('mainnet')).toBe(defaultNodeBaseDirForNetwork('mainnet'))
    })
  })

  it('recovers from a stale mainnet cache entry that points at a testnet base dir', () => {
    withMockLocalStorage((store) => {
      store.set(
        NODE_NETWORK_BASEDIRS_STORAGE_KEY,
        JSON.stringify({ mainnet: '/Volumes/external/teleno-testnet-producer/basedir' })
      )

      expect(resolveNodeBaseDirForNetwork('mainnet')).toBe(defaultNodeBaseDirForNetwork('mainnet'))
    })
  })

  it('reconciles stored node settings when the mainnet base dir points at testnet data', () => {
    withMockLocalStorage((store) => {
      store.set(
        NODE_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          network: 'mainnet',
          repoPath: '/tmp/koinos',
          baseDir: '/Volumes/external/teleno-testnet-producer/basedir',
          profiles: 'mainnet_observer',
          blockchainBackupUrl: 'https://example.com/backup.tar.gz'
        })
      )

      expect(loadInitialNodeSettings()).toMatchObject({
        network: 'mainnet',
        baseDir: defaultNodeBaseDirForNetwork('mainnet')
      })
    })
  })

  it('uses launch node settings over stored node settings', () => {
    withMockLocalStorage((store) => {
      store.set(
        NODE_NETWORK_BASEDIRS_STORAGE_KEY,
        JSON.stringify({ testnet: '/tmp/stale-testnet/basedir' })
      )
      store.set(
        NODE_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          network: 'mainnet',
          repoPath: '/tmp/stale-repo',
          baseDir: '~/.teleno',
          profiles: 'mainnet_observer',
          backup: { adminEnabled: false }
        })
      )
      ;(window as unknown as { teleno: TelenoApi }).teleno = {
        version: 'test',
        launchDefaults: {
          nodeSettings: {
            network: 'testnet',
            repoPath: '/Users/pgarcgo/code/teleno',
            baseDir: '/Volumes/external/knodel-testnet-producer/basedir',
            profiles: ['testnet_observer'],
            backup: {
              adminEnabled: true,
              adminListen: '127.0.0.1:18088',
              remoteEnabled: true,
              remoteDirectory: '/srv/teleno-backups/testnet/teleno-dev/teleno-ux-testnet',
              sshHost: 'testnet.koinosfoundation.org',
              sshUser: 'teleno_backup'
            }
          }
        }
      }

      expect(loadInitialNodeSettings()).toMatchObject({
        network: 'testnet',
        repoPath: '/Users/pgarcgo/code/teleno',
        baseDir: '/Volumes/external/knodel-testnet-producer/basedir',
        profiles: 'testnet_observer',
        backup: {
          adminEnabled: true,
          remoteEnabled: true,
          sshHost: 'testnet.koinosfoundation.org',
          sshUser: 'teleno_backup'
        }
      })
    })
  })

  it('uses network-specific default node profiles', () => {
    expect(defaultNodeProfilesForNetwork('mainnet')).toBe('mainnet_observer')
    expect(defaultNodeProfilesForNetwork('testnet')).toBe('testnet_observer')
  })

  it('resolves relative managed file paths against repo path', () => {
    expect(resolveNodeFileDisplayPath('/tmp/koinos', 'docker-compose.yml')).toBe('/tmp/koinos/docker-compose.yml')
    expect(resolveNodeFileDisplayPath('/tmp/koinos', '/etc/hosts')).toBe('/etc/hosts')
  })

  it('compares string lists regardless of order/whitespace', () => {
    expect(sameStringList([' jsonrpc ', 'block_producer'], ['block_producer', 'jsonrpc'])).toBe(true)
    expect(sameStringList(['jsonrpc'], ['jsonrpc', 'amqp'])).toBe(false)
  })

  it('keeps monolith component profiles explicit', () => {
    expect(expandNodeProfiles(['block_producer'])).toEqual(['block_producer'])
  })

  it('compares monolith component profiles without legacy dependency expansion', () => {
    expect(sameProfiles(['block_producer'], ['block_producer', 'jsonrpc', 'contract_meta_store'])).toBe(false)
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
    } as unknown as TelenoNodeStatus

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
    } as unknown as TelenoNodeStatus

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
    } as unknown as TelenoNodeStatus

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
