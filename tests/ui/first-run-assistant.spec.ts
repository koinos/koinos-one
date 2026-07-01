import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const NODE_SETTINGS_STORAGE_KEY = 'teleno.node.settings.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
const STABLE_SCREENSHOT_DIR = path.join(process.cwd(), '.run', 'first-run-assistant-ui-screenshots')

async function installFirstRunBridge(page: Page, options: { walletReady?: boolean; localCopy?: boolean } = {}) {
  const baseDir = '/tmp/koinos-one-first-run'
  const nodeSettings = {
    network: 'mainnet',
    repoPath: '/mock/teleno',
    baseDir,
    profiles: 'mainnet_observer',
    blockchainBackupUrl: '',
    backup: {
      localEnabled: true,
      localDirectory: '',
      workspace: '',
      localRetentionCount: 7,
      remoteEnabled: false,
      remoteDirectory: '',
      remoteRetentionCount: 14,
      remoteRetentionDays: 30,
      uploadTempSuffix: '.partial',
      sshHost: '',
      sshPort: 22,
      sshUser: '',
      sshAuth: 'private-key',
      sshPrivateKeyFile: '',
      sshPasswordFile: '',
      sshPassphraseFile: '',
      sshKnownHostsFile: '',
      sshStrictHostKeyChecking: true,
      sshConnectTimeoutSeconds: 15,
      scheduleEnabled: false,
      scheduleInterval: '6h',
      scheduleRunOnStartupIfMissed: true,
      scheduleJitterSeconds: 300,
      scheduleMinimumHeadProgress: 1,
      scheduleSkipIfSyncingFromGenesis: true,
      scheduleMaxConcurrentBackups: 1,
      adminEnabled: true,
      adminListen: '127.0.0.1:18088',
      adminTokenFile: '',
      adminJobs: 1
    }
  }
  const status = {
    ok: true,
    network: 'mainnet',
    dockerAvailable: true,
    runtimeMode: 'native',
    availableRuntimeModes: ['native'],
    repoPath: '/mock/teleno',
    composeFile: '',
    envFile: '',
    baseDir,
    profiles: ['mainnet_observer'],
    configReady: true,
    configDir: `${baseDir}/config`,
    services: [],
    components: [],
    runningServices: 0,
    output: 'mock status'
  }
  const publicSnapshot = {
    backupId: 'public-20260629T191207Z',
    createdAt: '2026-06-29T19:12:07Z',
    latest: true,
    complete: true,
    nodeId: 'public-node',
    nodeVersion: 'teleno_node mock',
    storageLayout: 'rocksdb',
    publicBootstrap: true,
    network: 'mainnet',
    chainId: 'mock-chain-id',
    publicBaseUrl: 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap',
    promotedAt: '2026-06-29T21:12:50Z',
    sourceBackupId: 'public-20260629T191207Z',
    sourceCreatedAt: '2026-06-29T19:12:07Z',
    sourceNodeVersion: 'teleno_node mock',
    sourceHeadHeight: 37260000,
    sourceLibHeight: 37259900,
    repositoryDir: `${baseDir}/.teleno-native-backups/repository`,
    snapshotDir: `${baseDir}/.teleno-native-backups/repository/snapshots/public-20260629T191207Z`,
    manifest: '',
    files: '',
    fileCount: 460,
    objectCount: 460,
    totalBytes: 25 * 1024 * 1024 * 1024,
    restoreSpace: {
      restoredDatabaseBytes: 25 * 1024 * 1024 * 1024,
      runtimeFilesBytes: 0,
      objectDownloadBytes: 0,
      minimumTargetFreeBytes: 55 * 1024 * 1024 * 1024,
      recommendedTargetFreeBytes: 80 * 1024 * 1024 * 1024
    }
  }
  const baseDirLocalCopy = options.localCopy
    ? {
        detected: true,
        evidence: ['chain/blockchain', 'block_store/db'],
        newestModifiedMs: Date.UTC(2026, 5, 28, 12, 0, 0),
        totalBytes: 24 * 1024 * 1024 * 1024,
        scannedEntries: 42,
        truncated: false
      }
    : {
        detected: false,
        evidence: [],
        newestModifiedMs: null,
        totalBytes: null,
        scannedEntries: 0,
        truncated: false
      }

  const readyWallet = {
    ok: true,
    output: '',
    walletExists: true,
    unlocked: true,
    walletAddress: '16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N',
    accountCount: 1,
    hasSeedPhrase: true,
    activeAccountId: 'account-1',
    activeAccountName: 'Account 1',
    activeAccountKind: 'seed',
    producerAccountId: null,
    accounts: [{
      id: 'account-1',
      name: 'Account 1',
      address: '16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N',
      kind: 'seed',
      hasPrivateKey: true,
      derivationPath: "m/44'/659'/0'/0/0"
    }]
  }
  const emptyWallet = {
    ok: true,
    output: '',
    walletExists: false,
    unlocked: false,
    accountCount: 0,
    accounts: [],
    activeAccountId: null,
    producerAccountId: null
  }
  const walletOverview = options.walletReady ? readyWallet : emptyWallet

  await page.addInitScript(({ baseDirLocalCopy, languageKey, nodeSettings, nodeSettingsKey, settingsKey, status, publicSnapshot, walletOverview }) => {
    window.localStorage.clear()
    window.localStorage.setItem(languageKey, 'en')
    window.localStorage.setItem(settingsKey, JSON.stringify({
      rpcSource: 'local',
      publicRpcUrls: ['https://api.koinos.io/'],
      pollMs: 3000,
      rowLimit: 20,
      producerAdvancedMode: true,
      nodeAdvancedMode: true,
      dashboardProducerWindowBlocks: 200,
      dashboardRefreshSeconds: 5
    }))
    window.localStorage.setItem(nodeSettingsKey, JSON.stringify(nodeSettings))
    window.teleno = {
      version: 'first-run-ui-test',
      launchDefaults: { nodeSettings },
      app: {
        firstRunSetupState: async () => ({ ok: true, completed: false, install: { packaged: true } }),
        completeFirstRunSetup: async () => ({ ok: true, completed: true }),
        resetFirstRunSetup: async () => ({ ok: true, completed: false }),
        quit: async () => undefined
      },
      appConfig: {
        loadPublicRpcUrls: async () => ({ ok: true, output: '', network: 'mainnet', publicRpcUrls: ['https://api.koinos.io/'], publicRpcUrlsByNetwork: {} }),
        savePublicRpcUrls: async () => ({ ok: true, output: '', network: 'mainnet', publicRpcUrls: ['https://api.koinos.io/'], publicRpcUrlsByNetwork: {} })
      },
      telenoNode: {
        defaults: async () => nodeSettings,
        validateBaseDir: async () => ({ ok: true, baseDir: nodeSettings.baseDir, restoreWorkspaceParent: '/tmp', writable: true, localCopy: baseDirLocalCopy, output: '' }),
        selectBaseDir: async () => ({ ok: true, canceled: false, path: nodeSettings.baseDir, restoreWorkspaceParent: '/tmp', writable: true, localCopy: baseDirLocalCopy, output: '' }),
        status: async () => status,
        presets: async () => ({ ok: true, output: '', presets: [] }),
        nativeBuilds: async () => ({ ok: true, sourceRoot: '/mock/teleno', services: [], output: '' }),
        getVerifyBlocks: async () => ({ ok: true, enabled: true, output: '' }),
        nativeBackupList: async (settings?: { public?: boolean }) => settings?.public
          ? { ok: true, output: '', source: 'public', latestBackupId: publicSnapshot.backupId, snapshots: [publicSnapshot] }
          : { ok: true, output: '', source: 'local', latestBackupId: '', snapshots: [] },
        dashboardPerformance: async () => ({ ok: true, output: '', sampledAt: Date.now(), host: { totalMemoryBytes: 0, freeMemoryBytes: 0, loadAverage: [0, 0, 0], uptimeSeconds: 0, freeDiskBytes: null, totalDiskBytes: null, nodeVolumeName: '', nodeVolumePath: '', nodeVolumeFilesystem: '', blockchainDataBytes: null, blockchainDataPath: '' }, totals: { telenoCpuPercent: null, telenoMemoryBytes: null, servicesCpuPercent: null, servicesMemoryBytes: null }, rows: [] }),
        dashboardProducers: async () => ({ ok: true, output: '', producers: [], sampledAt: Date.now() }),
        dashboardPeers: async () => ({ ok: true, output: '', peers: [], omittedPeers: 0, connectedPeers: 0, sampledAt: Date.now() }),
        producerOverview: async () => ({ ok: true, output: '' }),
        producerRegisteredKey: async () => ({ ok: true, output: '', rpcUrl: '', rpcSource: 'public', producerAddress: null, registeredPublicKey: null }),
        producerLocalInfo: async () => ({ ok: true, output: '', producerAddress: null, configFilePath: null, configHasProducer: false, localPublicKey: null, localPublicKeyPath: null, localPrivateKeyPath: null }),
        producerProfileGet: async () => ({ ok: true, output: '', profileFilePath: '', profile: null }),
        logs: async () => ({ ok: true, logs: '', output: '' }),
        onBackupProgressEvent: () => () => undefined
      },
      wallet: {
        overview: async () => walletOverview,
        listAccounts: async () => ({ ok: true, accounts: walletOverview.accounts || [] })
      }
    }
  }, {
    baseDirLocalCopy,
    languageKey: LANGUAGE_STORAGE_KEY,
    nodeSettings,
    nodeSettingsKey: NODE_SETTINGS_STORAGE_KEY,
    publicSnapshot,
    settingsKey: SETTINGS_STORAGE_KEY,
    status,
    walletOverview
  })
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: path.join(STABLE_SCREENSHOT_DIR, `${name}.png`),
    fullPage: true
  })
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true
  })
}

test('first-run assistant includes wallet setup after the data folder step', async ({ page }, testInfo) => {
  await installFirstRunBridge(page)
  await page.goto('/')

  await expect(page.locator('#first-run-setup-title')).toHaveText('Welcome to Koinos One')
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.locator('#first-run-setup-title')).toHaveText('Select a folder for data storage')
  await expect(page.getByText('Current public backup size: 25 GB')).toBeVisible()

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('#first-run-setup-title')).toHaveText('Create or open a wallet')
  await expect(page.getByText('Create or open a local wallet?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import with WIF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import with seed' })).toBeVisible()

  await capture(page, testInfo, 'first-run-wallet-step')

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('#first-run-setup-title')).toHaveText('Restore Public Backup')
  await expect(page.getByText('Public backup available')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore Public Backup' })).toBeVisible()
  await expect(page.getByText('Or start from an empty chain database')).toBeVisible()
  await expect(page.getByText('sync every block from seed peers')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync from seed peers' })).toBeVisible()

  await capture(page, testInfo, 'first-run-restore-choice')
})

test('first-run assistant asks what to do with an existing ready wallet', async ({ page }, testInfo) => {
  await installFirstRunBridge(page, { walletReady: true })
  await page.goto('/')

  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.locator('#first-run-setup-title')).toHaveText('Create or open a wallet')
  await expect(page.getByText('Use this wallet?')).toBeVisible()
  await expect(page.getByText('Keep this wallet', { exact: true })).toBeVisible()
  await expect(page.getByText('16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import WIF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import seed' })).toBeVisible()
  await expect(page.locator('.wallet-output')).toHaveCount(0)

  await capture(page, testInfo, 'first-run-wallet-ready-choice')
})

test('first-run assistant offers to keep existing local node data before public restore', async ({ page }, testInfo) => {
  await installFirstRunBridge(page, { localCopy: true })
  await page.goto('/')

  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Choose folder' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.locator('#first-run-setup-title')).toHaveText('Restore Public Backup')
  await expect(page.getByText('Existing local node data found')).toBeVisible()
  await expect(page.getByText('Local copy', { exact: true })).toBeVisible()
  await expect(page.getByText('Public backup', { exact: true })).toBeVisible()
  await expect(page.getByText('The public backup appears newer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use local copy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore Public Backup' })).toBeVisible()

  await capture(page, testInfo, 'first-run-local-copy-choice')
})
