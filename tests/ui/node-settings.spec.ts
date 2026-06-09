import { expect, test, type Page } from '@playwright/test'

const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const NODE_SETTINGS_STORAGE_KEY = 'teleno.node.settings.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'

const CONFIG_YAML = `global:
  log-level: info
p2p:
  listen: /ip4/0.0.0.0/tcp/8888
  peer:
    - /dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmSeedPeer
  peer-exchange: true
  seed: legacy-deterministic-seed
  seed-reconnect-interval-seconds: 10
  peer-discovery: true
  target-peer-count: 20
  max-peer-candidates: 200
  max-candidate-dials-per-cycle: 3
  peer-acquisition-interval-seconds: 5
  candidate-redial-interval-seconds: 60
  checkpoint:
    - 1:0x1220checkpoint
jsonrpc:
  listen: 0.0.0.0:8080
grpc:
  listen: 127.0.0.1:50051
rocksdb:
  block-cache-mb: 512
  max-background-jobs: 4
  bytes-per-sync: 0
  default-block-size: 4096
  blocks-block-size: 16384
  target-file-size-base: 67108864
  max-bytes-for-level-base: 268435456
  write-buffer-size: 67108864
  db-write-buffer-size: 536870912
  max-write-buffer-number: 4
  blocks-compression: zstd
block-store:
  basedir: /legacy/block-store
transaction-store:
  basedir: /legacy/transaction-store
contract-meta-store:
  basedir: /legacy/contract-meta-store
account-history:
  basedir: /legacy/account-history
`

async function installMockBridge(page: Page) {
  await page.addInitScript(({ configYaml, settingsKey, nodeSettingsKey, languageKey }) => {
    window.localStorage.setItem(languageKey, 'en')
    window.localStorage.setItem(
      settingsKey,
      JSON.stringify({
        rpcSource: 'local',
        publicRpcUrls: ['https://api.koinos.io/'],
        pollMs: 3000,
        rowLimit: 20,
        producerAdvancedMode: false,
        nodeAdvancedMode: true,
        dashboardProducerWindowBlocks: 200,
        dashboardRefreshSeconds: 5
      })
    )
    window.localStorage.setItem(
      nodeSettingsKey,
      JSON.stringify({
        repoPath: '/mock/teleno',
        baseDir: '/mock/basedir',
        profiles: 'mainnet_observer',
        blockchainBackupUrl: 'https://example.invalid/koinos_blockchain_backup.tar.gz'
      })
    )

    const components = [
      'chain',
      'mempool',
      'block_store',
      'p2p',
      'block_producer',
      'jsonrpc',
      'grpc',
      'transaction_store',
      'contract_meta_store',
      'account_history'
    ].map((name) => ({
      name,
      enabled: name !== 'block_producer',
      healthy: name !== 'block_producer',
      state: name === 'block_producer' ? 'disabled' : 'running',
      details: name === 'block_producer' ? 'disabled in observer profile' : 'mock running'
    }))

    const services = [
      {
        id: 'teleno-node',
        name: 'Teleno Node',
        service: 'teleno-node',
        runtimeName: 'teleno_node',
        version: null,
        state: 'running',
        status: 'Running (mock)',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: 12345,
        conflictPids: [],
        managedByTeleno: true
      }
    ]

    const rpcCall = async ({ method }: { method?: string }) => {
      if (method === 'chain.get_head_info') {
        return {
          ok: true,
          result: {
            head_topology: { id: '0x1220mockhead', height: '36552633' },
            head_block_time: '1780748059000',
            last_irreversible_block: '0x1220mocklib'
          }
        }
      }
      if (method === 'block_store.get_blocks_by_height') {
        return {
          ok: true,
          result: {
            block_items: [
              {
                block_id: '0x1220mockhead',
                block_height: '36552633',
                block: {
                  id: '0x1220mockhead',
                  header: {
                    height: '36552633',
                    previous: '0x1220mockprev',
                    signer: '1MockProducer',
                    timestamp: '1780748059000'
                  },
                  transactions: []
                }
              }
            ]
          }
        }
      }
      return { ok: true, result: {} }
    }

    window.teleno = {
      version: '0.10.1',
      appConfig: {
        loadPublicRpcUrls: async () => ({ ok: true, publicRpcUrls: ['https://api.koinos.io/'] }),
        savePublicRpcUrls: async () => ({ ok: true, publicRpcUrls: ['https://api.koinos.io/'] })
      },
      telenoNode: {
        defaults: async () => ({
          ok: true,
          repoPath: '/mock/teleno',
          baseDir: '/mock/basedir',
          profiles: ['mainnet_observer'],
          blockchainBackupUrl: 'https://example.invalid/koinos_blockchain_backup.tar.gz'
        }),
        fileRead: async () => ({ ok: true, content: configYaml, output: '' }),
        fileWrite: async () => ({ ok: true, output: 'saved' }),
        status: async () => ({
          ok: true,
          dockerAvailable: false,
          runtimeMode: 'monolith',
          availableRuntimeModes: ['monolith'],
          repoPath: '/mock/teleno',
          composeFile: '',
          envFile: '',
          baseDir: '/mock/basedir',
          profiles: ['mainnet_observer'],
          configReady: true,
          configDir: '/mock/basedir/config',
          services,
          components,
          runningServices: 1,
          output: ''
        }),
        presets: async () => ({ ok: true, presets: [], output: '' }),
        nativeBuilds: async () => ({ ok: true, builds: [], output: '' }),
        rpcCall,
        dashboardProducers: async () => ({ ok: true, producers: [], output: '' }),
        dashboardPeers: async () => ({ ok: true, peers: [], omittedPeers: 0, connectedPeers: 0, output: '' }),
        dashboardPerformance: async () => ({ ok: true, rows: [], totals: {}, output: '' }),
        producerOverview: async () => ({ ok: true, output: '' }),
        producerRegisteredKey: async () => ({ ok: true, output: '' }),
        producerLocalInfo: async () => ({ ok: true, output: '' }),
        producerProfileGet: async () => ({ ok: true, profile: null }),
        logs: async () => ({ ok: true, logs: '', output: '' }),
        logsFollowStart: async () => ({ ok: true, streamId: 'mock' }),
        logsFollowStop: async () => ({ ok: true }),
        onLogsFollowEvent: () => () => undefined,
        onBackupProgressEvent: () => () => undefined
      },
      wallet: {
        overview: async () => ({ ok: true, output: '' }),
        listAccounts: async () => ({ ok: true, accounts: [] })
      }
    }
  }, { configYaml: CONFIG_YAML, settingsKey: SETTINGS_STORAGE_KEY, nodeSettingsKey: NODE_SETTINGS_STORAGE_KEY, languageKey: LANGUAGE_STORAGE_KEY })
}

async function openAdvancedNodeSettings(page: Page) {
  await page.goto('/')
  await page.locator('#tab-settings').click()
  await page.getByRole('button', { name: 'Node Settings' }).click()
  const panel = page.locator('.microservices-config-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Node Settings' })).toBeVisible()

  await panel.evaluate((node) => {
    for (const section of Array.from(node.querySelectorAll('.config-section'))) {
      if (!section.querySelector('.config-section-fields')) {
        section.querySelector<HTMLElement>('.config-section-header')?.click()
      }
    }
  })

  return panel
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page)
})

test('renders the monolith Node Settings surface without legacy store sections', async ({ page }) => {
  const panel = await openAdvancedNodeSettings(page)

  const sectionTitles = await panel.locator('.config-section-title').allTextContents()
  expect(sectionTitles).toEqual(['Global', 'Feature Flags', 'Chain', 'Mempool', 'P2P', 'JSON-RPC', 'gRPC', 'RocksDB'])
  expect(sectionTitles).not.toContain('Block Store')
  expect(sectionTitles).not.toContain('Transaction Store')
  expect(sectionTitles).not.toContain('Contract Meta Store')
  expect(sectionTitles).not.toContain('Account History')

  await expect(panel.getByText('Ignored legacy settings')).toBeVisible()
  await expect(panel.getByText('Public RPC without an ACL')).toBeVisible()
  await expect(panel.getByText('Peer Discovery', { exact: true })).toBeVisible()
  await expect(panel.getByText('Target Peer Count', { exact: true })).toBeVisible()
  await expect(panel.getByText('Checkpoints', { exact: true })).toBeVisible()
  await expect(panel.getByText('Block Cache (MB)', { exact: true })).toBeVisible()
  await expect(panel.getByText('Blocks Compression', { exact: true })).toBeVisible()

  const fieldLabels = await panel.evaluate((node) =>
    Array.from(node.querySelectorAll('.config-section-fields label > span:first-child')).map((label) =>
      (label.textContent ?? '').trim()
    )
  )
  expect(fieldLabels).not.toContain('Node identity seed')
  expect(fieldLabels).not.toContain('Peer Exchange')
  expect(fieldLabels.some((label) => /basedir|data directory/i.test(label))).toBe(false)
})

test('keeps editable Node Settings fields in the bright theme', async ({ page }) => {
  const panel = await openAdvancedNodeSettings(page)

  const darkControls = await panel.evaluate((node) => {
    const luminance = (color: string) => {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!match) return 1
      const [, r, g, b] = match.map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }

    return Array.from(node.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      '.config-section-fields input:not([type="checkbox"]), .config-section-fields select, .config-section-fields textarea'
    ))
      .map((control) => ({
        label: control.closest('label')?.querySelector('span')?.textContent?.trim() ?? control.tagName,
        background: window.getComputedStyle(control).backgroundColor,
        color: window.getComputedStyle(control).color
      }))
      .filter((control) => luminance(control.background) < 0.45)
  })

  expect(darkControls).toEqual([])
})

test('matches the advanced Node Settings visual checkpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openAdvancedNodeSettings(page)
  await expect(page).toHaveScreenshot('node-settings-advanced.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })
})
