import { describe, expect, it, vi } from 'vitest'

import {
  aggregateDashboardPerformanceTotals,
  createProducerService,
  formatProducerOverviewActivityWarning,
  isProducerOverviewTimeoutError,
  normalizeDashboardProducerWindowBlocks,
  parseCoinMarketCapKoinPriceUsd,
  parseDashboardPerformancePsRow,
  parseDexScreenerPairPriceUsd,
  parseLatestP2pPeersSnapshot,
  resolveProducerKoinPriceSource
} from './producer-service'
import type { KoinosNodeStatus } from './main-types'

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

  it('parses KOIN price from the DexScreener pair response', () => {
    expect(
      parseDexScreenerPairPriceUsd({
        pair: {
          priceUsd: '0.004531'
        }
      })
    ).toBe(0.004531)

    expect(
      parseDexScreenerPairPriceUsd({
        pairs: [
          {
            priceUsd: '0.004612'
          }
        ]
      })
    ).toBe(0.004612)

    expect(parseDexScreenerPairPriceUsd({ pair: { priceUsd: '0' } })).toBeNull()
  })

  it('parses KOIN price from CoinMarketCap html', () => {
    expect(parseCoinMarketCapKoinPriceUsd('<script>{"price":0.0046685852362138925}</script>')).toBe(0.0046685852362138925)
    expect(parseCoinMarketCapKoinPriceUsd('<p>Koinos price today is $0.004531 USD</p>')).toBe(0.004531)
    expect(parseCoinMarketCapKoinPriceUsd('<html></html>')).toBeNull()
  })

  it('prefers the DexScreener pair over CoinMarketCap when both are available', () => {
    expect(resolveProducerKoinPriceSource(0.004531, 0.0046685)).toEqual({
      priceUsd: 0.004531,
      sourceName: 'DexScreener vKOIN/USDT',
      sourceUrl:
        'https://dexscreener.com/ethereum/0xd833a3afa936ca389966a9ed3a3d9abf7ec45c11b0d575aaaf6ca4d354687da6'
    })

    expect(resolveProducerKoinPriceSource(null, 0.0046685)).toEqual({
      priceUsd: 0.0046685,
      sourceName: 'CoinMarketCap',
      sourceUrl: 'https://coinmarketcap.com/currencies/koinos/'
    })
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

  it('parses ps output rows for dashboard performance', () => {
    expect(
      parseDashboardPerformancePsRow('123 12.5 2048 8192 1-02:03:04 Ss /usr/bin/koinosd --config test.yml')
    ).toEqual({
      pid: 123,
      cpuPercent: 12.5,
      rssBytes: 2097152,
      virtualBytes: 8388608,
      uptimeSeconds: 93784,
      state: 'Ss',
      command: '/usr/bin/koinosd --config test.yml'
    })
  })

  it('aggregates dashboard performance totals by row kind', () => {
    expect(aggregateDashboardPerformanceTotals([
      {
        id: 'knodel:1',
        label: 'Knodel Main',
        kind: 'knodel',
        serviceId: null,
        pid: 1,
        cpuPercent: 12.5,
        rssBytes: 256,
        virtualBytes: null,
        uptimeSeconds: 60,
        state: 'Browser',
        command: null,
        managedByKnodel: true
      },
      {
        id: 'service:jsonrpc',
        label: 'JSON-RPC',
        kind: 'service',
        serviceId: 'jsonrpc',
        pid: 22,
        cpuPercent: 7.25,
        rssBytes: 512,
        virtualBytes: 1024,
        uptimeSeconds: 30,
        state: 'S',
        command: '/usr/bin/jsonrpc',
        managedByKnodel: true
      }
    ])).toEqual({
      knodelCpuPercent: 12.5,
      knodelMemoryBytes: 256,
      servicesCpuPercent: 7.25,
      servicesMemoryBytes: 512
    })
  })
})

function createPerformanceService(overrides: Record<string, unknown> = {}) {
  const baseStatus: KoinosNodeStatus = {
    ok: true,
    dockerAvailable: true,
    runtimeMode: 'native',
    availableRuntimeModes: ['native'],
    repoPath: '/tmp/koinos',
    composeFile: '/tmp/koinos/docker-compose.yml',
    envFile: '/tmp/koinos/.env',
    baseDir: '/tmp/.koinos',
    profiles: [],
    configReady: true,
    configDir: '/tmp/koinos/config',
    services: [],
    runningServices: 0,
    output: ''
  }

  const deps = {
    normalizeNodeSettings: vi.fn(() => ({
      repoPath: '/tmp/koinos',
      composeFile: 'docker-compose.yml',
      envFile: '.env',
      baseDir: '/tmp/.koinos',
      profiles: [],
      blockchainBackupUrl: '',
      runtimeMode: 'native' as const
    })),
    producerAddressFromRuntimeConfig: vi.fn(() => ({
      producerAddress: null,
      configFilePath: '/tmp/koinos/config/config.yml',
      configHasProducer: false
    })),
    loadKnodelWalletFile: vi.fn(() => null),
    resolveLocalProducerPublicKey: vi.fn(() => ({
      publicKey: null,
      publicKeyPath: null,
      privateKeyPath: null
    })),
    producerRpcTarget: vi.fn(() => ({
      rpcUrl: 'http://127.0.0.1:8080/',
      rpcSource: 'local' as const
    })),
    loadContractWithFetchedAbi: vi.fn(),
    fetchBlocksByHeightPaged: vi.fn(),
    safeIsChecksumAddress: vi.fn(() => false),
    formatWholeUnits: vi.fn(() => null),
    parseWholeUnits: vi.fn(() => null),
    currentUnlockedProducerWallet: vi.fn(() => null),
    unlockKnodelWalletSession: vi.fn(() => null),
    persistProducerRuntimeConfig: vi.fn(() => '/tmp/koinos/config/config.yml'),
    saveProducerProfile: vi.fn(() => '/tmp/producer-profile.json'),
    clearProducerProfile: vi.fn(() => true),
    loadProducerProfile: vi.fn(() => null),
    clearProducerRuntimeConfig: vi.fn(() => ({
      configPath: '/tmp/koinos/config/config.yml',
      cleared: false
    })),
    knodelProducerProfileFilePath: vi.fn(() => '/tmp/producer-profile.json'),
    nativeComposeStatus: vi.fn(async () => baseStatus),
    nativeComposeLogs: vi.fn(async () => ({
      ok: true,
      service: 'p2p',
      tail: 200,
      output: ''
    })),
    isComposeServiceRunning: vi.fn(() => true),
    blockProducerPrivateKeyFilePath: vi.fn(() => '/tmp/.koinos/block_producer/private.key'),
    getAppMetrics: vi.fn(() => [
      {
        pid: 101,
        type: 'Browser',
        creationTime: 999000,
        cpu: { percentCPUUsage: 14.25 },
        memory: { workingSetSize: 2048 }
      }
    ]),
    hostSnapshot: vi.fn(() => ({
      cpuCount: 8,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      freeMemoryBytes: 8 * 1024 * 1024 * 1024,
      loadAverage: [0.25, 0.5, 0.75],
      uptimeSeconds: 7200
    })),
    now: vi.fn(() => 1_000_000),
    runCommand: vi.fn(async () => ({
      ok: true,
      code: 0,
      output: ''
    })),
    ...overrides
  }

  return {
    deps,
    service: createProducerService(deps as any)
  }
}

describe('dashboard performance', () => {
  it('returns a valid snapshot when no managed services are running', async () => {
    const { service } = createPerformanceService()

    const result = await service.koinosNodeDashboardPerformance()

    expect(result.ok).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      kind: 'knodel',
      label: 'Knodel Main',
      pid: 101
    })
    expect(result.totals).toEqual({
      knodelCpuPercent: 14.25,
      knodelMemoryBytes: 2048 * 1024,
      servicesCpuPercent: null,
      servicesMemoryBytes: null
    })
  })

  it('tolerates missing service pids without failing the whole response', async () => {
    const { service } = createPerformanceService({
      nativeComposeStatus: vi.fn(async () => ({
        ok: true,
        dockerAvailable: true,
        runtimeMode: 'native',
        availableRuntimeModes: ['native'],
        repoPath: '/tmp/koinos',
        composeFile: '/tmp/koinos/docker-compose.yml',
        envFile: '/tmp/koinos/.env',
        baseDir: '/tmp/.koinos',
        profiles: [],
        configReady: true,
        configDir: '/tmp/koinos/config',
        runningServices: 1,
        output: '',
        services: [
          {
            id: 'jsonrpc',
            name: 'JSON-RPC',
            service: 'jsonrpc',
            runtimeName: 'jsonrpc',
            runtimeType: 'native',
            version: '1.0.0',
            state: 'running',
            status: 'Up',
            ports: [],
            dependsOn: [],
            lastError: null,
            nativePid: 4242,
            conflictPids: [],
            managedByKnodel: true
          }
        ]
      }))
    })

    const result = await service.koinosNodeDashboardPerformance()
    const serviceRow = result.rows.find((row) => row.serviceId === 'jsonrpc')

    expect(result.ok).toBe(true)
    expect(serviceRow).toMatchObject({
      label: 'JSON-RPC',
      pid: 4242,
      cpuPercent: null,
      rssBytes: null,
      virtualBytes: null,
      state: 'running'
    })
    expect(result.output).toContain('Process sample unavailable for: JSON-RPC.')
  })
})
