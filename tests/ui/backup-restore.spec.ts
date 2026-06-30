import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const NODE_SETTINGS_STORAGE_KEY = 'teleno.node.settings.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
const STABLE_SCREENSHOT_DIR = path.join(process.cwd(), '.run', 'backup-restore-ui-screenshots')

type BackupScenario = 'success' | 'loading' | 'empty' | 'error'
type Language = 'en' | 'es'

const PUBLIC_BACKUP_ID = 'public-20260615T213234Z'
const LOCAL_BACKUP_ID = 'local-20260615T213234Z'
const REMOTE_BACKUP_ID = 'remote-20260615T213234Z'

function backupSettings(remoteEnabled: boolean) {
  return {
    localEnabled: true,
    localDirectory: '',
    workspace: '',
    localRetentionCount: 7,
    remoteEnabled,
    remoteDirectory: remoteEnabled ? '/srv/teleno-backups/private-node' : '',
    remoteRetentionCount: 14,
    remoteRetentionDays: 30,
    uploadTempSuffix: '.partial',
    sshHost: remoteEnabled ? 'backup.example.invalid' : '',
    sshPort: 22,
    sshUser: remoteEnabled ? 'private_backup' : '',
    sshAuth: 'private-key',
    sshPrivateKeyFile: remoteEnabled ? '~/.ssh/teleno_backup' : '',
    sshPasswordFile: '',
    sshPassphraseFile: '',
    sshKnownHostsFile: '~/.ssh/known_hosts',
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

function snapshot(backupId: string, source: 'local' | 'remote' | 'public') {
  return {
    backupId,
    createdAt: '2026-06-15T21:32:34Z',
    latest: true,
    complete: true,
    nodeId: `${source}-node`,
    nodeVersion: 'teleno_node mock',
    storageLayout: 'rocksdb',
    publicBootstrap: source === 'public',
    network: 'mainnet',
    chainId: 'mock-chain-id',
    publicBaseUrl: source === 'public'
      ? 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap'
      : '',
    promotedAt: '2026-06-15T22:00:00Z',
    sourceBackupId: backupId,
    sourceCreatedAt: '2026-06-15T21:32:34Z',
    sourceNodeVersion: 'teleno_node mock',
    sourceHeadHeight: 123456789,
    sourceLibHeight: 123456700,
    repositoryDir: '/tmp/teleno-ui/repository',
    snapshotDir: `/tmp/teleno-ui/repository/snapshots/${backupId}`,
    manifest: '',
    files: '',
    fileCount: 6,
    objectCount: 20,
    totalBytes: 12 * 1024 * 1024 * 1024,
    restoreSpace: {
      restoredDatabaseBytes: 12 * 1024 * 1024 * 1024,
      runtimeFilesBytes: 0,
      objectDownloadBytes: 0,
      minimumTargetFreeBytes: 16 * 1024 * 1024 * 1024,
      recommendedTargetFreeBytes: 20 * 1024 * 1024 * 1024
    }
  }
}

async function installBackupBridge(
  page: Page,
  options: {
    scenario?: BackupScenario
    advanced?: boolean
    language?: Language
    remoteEnabled?: boolean
    preflightDelayMs?: number
  } = {}
) {
  const scenario = options.scenario ?? 'success'
  const advanced = options.advanced ?? false
  const language = options.language ?? 'en'
  const remoteEnabled = options.remoteEnabled ?? false
  const preflightDelayMs = options.preflightDelayMs ?? 0
  const baseDir = `/tmp/teleno-ui-${scenario}-${advanced ? 'expert' : 'simple'}`
  const backup = backupSettings(remoteEnabled)
  const nodeSettings = {
    network: 'mainnet',
    repoPath: '/mock/teleno',
    baseDir,
    profiles: 'mainnet_observer',
    blockchainBackupUrl: '',
    runtimeMode: 'native',
    backup
  }

  await page.addInitScript(({
    advanced,
    backup,
    baseDir,
    firstRunKey,
    language,
    languageKey,
    localBackupId,
    nodeSettings,
    nodeSettingsKey,
    publicBackupId,
    preflightDelayMs,
    remoteBackupId,
    scenario,
    settingsKey,
    snapshots
  }) => {
    window.localStorage.clear()
    window.localStorage.setItem(languageKey, language)
    window.localStorage.setItem(firstRunKey, 'complete')
    window.localStorage.setItem(
      settingsKey,
      JSON.stringify({
        rpcSource: 'local',
        publicRpcUrls: ['https://api.koinos.io/'],
        pollMs: 3000,
        rowLimit: 20,
        producerAdvancedMode: false,
        nodeAdvancedMode: advanced,
        dashboardProducerWindowBlocks: 200,
        dashboardRefreshSeconds: 5
      })
    )
    window.localStorage.setItem(nodeSettingsKey, JSON.stringify(nodeSettings))

    const publicSnapshot = snapshots.public
    const localSnapshot = snapshots.local
    const remoteSnapshot = snapshots.remote
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
      services: [{
        id: 'teleno_node',
        name: 'Koinos One Node',
        service: 'teleno_node',
        runtimeName: 'teleno_node',
        runtimeType: 'native',
        binaryPath: '/mock/teleno_node',
        configPath: `${baseDir}/config/config.yml`,
        logPath: `${baseDir}/logs/teleno_node.log`,
        version: 'mock-ui',
        state: 'stopped',
        status: 'Stopped',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: null,
        conflictPids: [],
        managedByTeleno: true
      }],
      components: [],
      runningServices: 0,
      output: 'mock status'
    }
    const calls: Array<{ name: string; payload: unknown }> = []
    const backupProgressListeners: Array<(event: unknown) => void> = []
    const record = (name: string, payload: unknown) => calls.push({ name, payload })
    const emitBackupProgress = (event: unknown) => {
      for (const listener of backupProgressListeners) listener(event)
    }
    const listResult = (source: 'local' | 'remote' | 'public') => {
      if (source === 'public') {
        if (scenario === 'loading') return new Promise(() => undefined)
        if (scenario === 'error') {
          return {
            ok: false,
            output: 'Mock public bootstrap metadata unavailable',
            source: 'public',
            latestBackupId: '',
            snapshots: []
          }
        }
        if (scenario === 'empty') {
          return { ok: true, output: '', source: 'public', latestBackupId: '', snapshots: [] }
        }
        return {
          ok: true,
          output: '',
          source: 'public',
          latestBackupId: publicBackupId,
          repositoryDir: `${baseDir}/.teleno-native-backups/repository`,
          workspaceDir: `${baseDir}/.teleno-native-backups/workspace`,
          snapshots: [publicSnapshot]
        }
      }
      if (source === 'remote') {
        return {
          ok: true,
          output: '',
          source: 'remote',
          latestBackupId: backup.remoteEnabled ? remoteBackupId : '',
          remoteSpace: {
            ok: true,
            availableBytes: 64 * 1024 * 1024 * 1024,
            targetPath: backup.remoteDirectory || '/srv/teleno-backups/private-node',
            message: 'remote space ok'
          },
          snapshots: backup.remoteEnabled ? [remoteSnapshot] : []
        }
      }
      return {
        ok: true,
        output: '',
        source: 'local',
        latestBackupId: localBackupId,
        repositoryDir: `${baseDir}/.teleno-native-backups/repository`,
        workspaceDir: `${baseDir}/.teleno-native-backups/workspace`,
        snapshots: [localSnapshot]
      }
    }

    window.__telenoBackupTest = { calls }
    window.teleno = {
      version: 'backup-ui-test',
      launchDefaults: { nodeSettings },
      app: {
        firstRunSetupState: async () => ({ ok: true, completed: true }),
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
        nativeBackupConfig: async () => ({
          ok: true,
          output: '',
          configPath: `${baseDir}/.teleno-native-backups/teleno-native-backup-config.yml`,
          repositoryDir: `${baseDir}/.teleno-native-backups/repository`,
          workspaceDir: `${baseDir}/.teleno-native-backups/workspace`,
          backup
        }),
        status: async () => status,
        presets: async () => ({ ok: true, output: '', presets: [{ id: 'mainnet_observer', label: 'Mainnet Observer', network: 'mainnet', source: 'profile', profiles: ['mainnet_observer'], services: ['teleno_node'], featureFlags: {}, description: 'Mainnet observer node' }] }),
        nativeBuilds: async () => ({ ok: true, sourceRoot: '/mock/teleno', services: [], output: '' }),
        getVerifyBlocks: async () => ({ ok: true, enabled: true, output: '' }),
        nativeBackupList: async (settings?: { remote?: boolean; public?: boolean }) => {
          record('nativeBackupList', settings)
          return settings?.public ? listResult('public') : settings?.remote ? listResult('remote') : listResult('local')
        },
        nativeBackupRestorePreflight: async (settings?: unknown) => {
          record('nativeBackupRestorePreflight', settings)
          if (preflightDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, preflightDelayMs))
          }
          return {
            ok: true,
            output: 'preflight ok',
            backupId: (settings as { backupId?: string })?.backupId || publicBackupId,
            readyToRestore: true,
            snapshotComplete: true,
            fileCount: 6,
            missingObjectCount: 0,
            missingObjectBytes: 0,
            restoreSpace: publicSnapshot.restoreSpace,
            spaceCheck: {
              passesMinimum: true,
              belowRecommended: false,
              availableBytes: 40 * 1024 * 1024 * 1024,
              targetPath: baseDir,
              message: 'enough space'
            }
          }
        },
        restoreNativeBackup: async (settings?: unknown) => {
          record('restoreNativeBackup', settings)
          emitBackupProgress({
            action: 'restore-backup',
            phase: 'download',
            progress: 42,
            message: 'Downloading public bootstrap backup',
            completedBytes: 8 * 1024 * 1024 * 1024,
            totalBytes: 12 * 1024 * 1024 * 1024,
            progressRangeStart: 25,
            progressRangeEnd: 60
          })
          await new Promise((resolve) => setTimeout(resolve, 250))
          return { ok: true, action: 'restore-backup', output: 'mock restore kept observer-first', status }
        },
        restoreNativeBackupLatest: async (settings?: unknown) => {
          record('restoreNativeBackupLatest', settings)
          emitBackupProgress({
            action: 'restore-backup',
            phase: 'download',
            progress: 42,
            message: 'Downloading public bootstrap backup',
            completedBytes: 8 * 1024 * 1024 * 1024,
            totalBytes: 12 * 1024 * 1024 * 1024,
            progressRangeStart: 25,
            progressRangeEnd: 60
          })
          await new Promise((resolve) => setTimeout(resolve, 250))
          return { ok: true, action: 'restore-backup', output: 'mock latest restore kept observer-first', status }
        },
        createBackup: async (settings?: unknown) => {
          record('createBackup', settings)
          return { ok: true, action: 'create-backup', output: 'mock create', status }
        },
        nativeBackupPurge: async (settings?: unknown) => {
          record('nativeBackupPurge', settings)
          return { ok: true, output: 'mock purge', backupId: (settings as { backupId?: string })?.backupId || '', source: (settings as { backupSource?: string })?.backupSource || 'local' }
        },
        cancelCreateBackup: async () => {
          record('cancelCreateBackup')
          return { ok: true, output: '' }
        },
        dashboardPerformance: async () => ({
          ok: true,
          output: '',
          sampledAt: Date.now(),
          host: {
            totalMemoryBytes: 64 * 1024 * 1024 * 1024,
            freeMemoryBytes: 32 * 1024 * 1024 * 1024,
            loadAverage: [0, 0, 0],
            uptimeSeconds: 3600,
            freeDiskBytes: 40 * 1024 * 1024 * 1024,
            totalDiskBytes: 100 * 1024 * 1024 * 1024,
            nodeVolumeName: 'mock',
            nodeVolumePath: baseDir,
            nodeVolumeFilesystem: 'apfs',
            blockchainDataBytes: 12 * 1024 * 1024 * 1024,
            blockchainDataPath: `${baseDir}/chain/blockchain`
          },
          totals: { telenoCpuPercent: null, telenoMemoryBytes: null, servicesCpuPercent: null, servicesMemoryBytes: null },
          rows: []
        }),
        dashboardProducers: async () => ({ ok: true, output: '', producers: [], sampledAt: Date.now() }),
        dashboardPeers: async () => ({ ok: true, output: '', peers: [], omittedPeers: 0, connectedPeers: 0, sampledAt: Date.now() }),
        producerOverview: async () => ({ ok: true, output: '' }),
        producerRegisteredKey: async () => ({ ok: true, output: '', rpcUrl: '', rpcSource: 'public', producerAddress: null, registeredPublicKey: null }),
        producerLocalInfo: async () => ({ ok: true, output: '', producerAddress: null, configFilePath: null, configHasProducer: false, localPublicKey: null, localPublicKeyPath: null, localPrivateKeyPath: null }),
        producerProfileGet: async () => ({ ok: true, output: '', profileFilePath: '', profile: null }),
        logs: async () => ({ ok: true, logs: '', output: '' }),
        logsFollowStart: async () => ({ ok: true, streamId: 'mock' }),
        logsFollowStop: async () => ({ ok: true }),
        onLogsFollowEvent: () => () => undefined,
        onBackupProgressEvent: (listener: (event: unknown) => void) => {
          backupProgressListeners.push(listener)
          return () => {
            const index = backupProgressListeners.indexOf(listener)
            if (index >= 0) backupProgressListeners.splice(index, 1)
          }
        }
      },
      wallet: {
        overview: async () => ({ ok: true, output: '', walletExists: false, accounts: [], activeAccountId: null, producerAccountId: null }),
        listAccounts: async () => ({ ok: true, accounts: [] })
      }
    }

  }, {
    advanced,
    backup,
    baseDir,
    firstRunKey: FIRST_RUN_SETUP_STORAGE_KEY,
    language,
    languageKey: LANGUAGE_STORAGE_KEY,
    localBackupId: LOCAL_BACKUP_ID,
    nodeSettings,
    nodeSettingsKey: NODE_SETTINGS_STORAGE_KEY,
    publicBackupId: PUBLIC_BACKUP_ID,
    preflightDelayMs,
    remoteBackupId: REMOTE_BACKUP_ID,
    scenario,
    settingsKey: SETTINGS_STORAGE_KEY,
    snapshots: {
      local: snapshot(LOCAL_BACKUP_ID, 'local'),
      remote: snapshot(REMOTE_BACKUP_ID, 'remote'),
      public: snapshot(PUBLIC_BACKUP_ID, 'public')
    }
  })
}

async function openNodeBackups(page: Page) {
  await page.goto('/')
  await page.locator('#tab-node').click()
  await page.getByRole('tab', { name: /Restore Backup|Restaurar backup/ }).click()
  await expect(page.locator('.node-backups-panel')).toBeVisible()
}

async function openSettingsBackup(page: Page) {
  await page.goto('/')
  await page.locator('#tab-settings').click()
  await page.getByRole('button', { name: 'Backup' }).click()
  await expect(page.locator('#panel-settings')).toBeVisible()
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: testInfo.outputPath(`backup-restore-${name}.png`),
    fullPage: true
  })
  await page.screenshot({
    path: path.join(STABLE_SCREENSHOT_DIR, `backup-restore-${name}.png`),
    fullPage: true
  })
}

async function captureNodePanel(page: Page, testInfo: TestInfo, name: string) {
  mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
  await page.locator('.node-backups-panel').screenshot({
    path: testInfo.outputPath(`backup-restore-${name}.png`)
  })
  await page.locator('.node-backups-panel').screenshot({
    path: path.join(STABLE_SCREENSHOT_DIR, `backup-restore-${name}.png`)
  })
}

async function calls(page: Page) {
  return page.evaluate(() => (window as any).__telenoBackupTest?.calls ?? [])
}

test('simple mode is restore-first and does not auto-fetch the public bootstrap', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackupBridge(page, { scenario: 'success', advanced: false, remoteEnabled: true, preflightDelayMs: 750 })
  await openNodeBackups(page)

  const simplePanel = page.locator('.node-backups-panel-simple')
  await expect(simplePanel.getByText('Public Backup Repository')).toBeVisible()
  await expect(simplePanel.getByRole('button', { name: 'Check Repository' })).toHaveAttribute(
    'title',
    'Checks the public backup repository for the latest backup metadata and updates the size, date, and local space estimate. It does not download or restore backup data.'
  )
  await expect(simplePanel.getByText('Restore mode')).toHaveCount(0)
  await expect(simplePanel.getByText('Observer first')).toHaveCount(0)
  await expect(simplePanel.getByRole('button', { name: 'Choose data folder' })).toHaveCount(0)
  await expect(simplePanel.locator('.node-backup-bootstrap-guide > div > span').filter({ hasText: /^Data folder$/ })).toHaveCount(0)
  await expect(simplePanel.getByText('/tmp/teleno-ui-success-simple')).toHaveCount(0)
  await expect(simplePanel.getByText('This is the normal way to get a node running quickly.')).toHaveCount(0)
  await expect(simplePanel.getByText('Local restore space: enough space.')).toBeVisible()
  await expect(simplePanel.getByText('Latest backup date:', { exact: false })).toBeVisible()
  await expect(simplePanel.getByRole('button', { name: 'Restore Backup' })).toBeEnabled()
  await expect(simplePanel.getByText('Additional backup management tools are available in Expert Mode.')).toHaveCount(0)
  expect(await calls(page)).not.toContainEqual(expect.objectContaining({ name: 'nativeBackupRestorePreflight' }))

  await expect(simplePanel.getByText('Create Backup')).toHaveCount(0)
  await expect(simplePanel.getByText('Create Local Backup')).toHaveCount(0)
  await expect(simplePanel.getByText('Create Remote Backup')).toHaveCount(0)
  await expect(simplePanel.getByText('Remote SFTP')).toHaveCount(0)
  await expect(simplePanel.getByText('Admin API')).toHaveCount(0)
  await expect(simplePanel.getByText('public-backup publication')).toHaveCount(0)
  await capture(page, testInfo, 'simple-success-desktop')

  let restoreConfirmMessage = ''
  page.once('dialog', async (dialog) => {
    restoreConfirmMessage = dialog.message()
    await dialog.dismiss()
  })
  await simplePanel.getByRole('button', { name: 'Restore Backup' }).click()
  await expect.poll(() => restoreConfirmMessage).toContain(PUBLIC_BACKUP_ID)
  expect(restoreConfirmMessage).toContain('observer-first')
  expect(restoreConfirmMessage).toContain('block production stays disabled')
  expect(await calls(page)).not.toContainEqual(expect.objectContaining({ name: 'restoreNativeBackup' }))
})

test('simple mode shows the restore progress bar during public bootstrap restore', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackupBridge(page, { scenario: 'success', advanced: false, remoteEnabled: true })
  await openNodeBackups(page)

  const simplePanel = page.locator('.node-backups-panel-simple')
  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await simplePanel.getByRole('button', { name: 'Restore Backup' }).click()

  await expect(simplePanel.locator('.node-backup-progress')).toBeVisible()
  await expect(simplePanel.getByText('Downloading public bootstrap backup')).toBeVisible()
  await expect(simplePanel.getByText('42%')).toBeVisible()
  await expect(simplePanel.getByRole('button', { name: 'Stop restore' })).toBeVisible()
  await simplePanel.getByRole('button', { name: 'Stop restore' }).click()
  await expect.poll(() => calls(page)).toContainEqual(expect.objectContaining({ name: 'restoreNativeBackup' }))
  await expect.poll(() => calls(page)).toContainEqual(expect.objectContaining({ name: 'cancelCreateBackup' }))
  await captureNodePanel(page, testInfo, 'simple-restore-progress-desktop')
})

test('simple mode handles loading, empty, and error states with disabled restore', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1180 })

  await installBackupBridge(page, { scenario: 'loading', advanced: false })
  await openNodeBackups(page)
  await expect(page.getByRole('button', { name: 'Checking repository...' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore Backup' })).toBeDisabled()
  await captureNodePanel(page, testInfo, 'simple-loading-mobile')

  await installBackupBridge(page, { scenario: 'empty', advanced: false })
  await openNodeBackups(page)
  await expect(page.getByText('No latest standard public bootstrap backup found yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore Backup' })).toBeDisabled()
  await captureNodePanel(page, testInfo, 'simple-empty-mobile')

  await installBackupBridge(page, { scenario: 'error', advanced: false })
  await openNodeBackups(page)
  await expect(page.locator('.node-backups-panel-simple .settings-inline-help.is-error')).toContainText('Mock public bootstrap metadata unavailable')
  await expect(page.getByRole('button', { name: 'Restore Backup' })).toBeDisabled()
  await captureNodePanel(page, testInfo, 'simple-error-mobile')
})

test('simple mode Spanish copy remains restore-first and hides expert concepts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackupBridge(page, { scenario: 'success', advanced: false, language: 'es', remoteEnabled: true })
  await openNodeBackups(page)

  const simplePanel = page.locator('.node-backups-panel-simple')
  await expect(simplePanel.getByRole('button', { name: 'Restaurar backup' })).toBeEnabled()
  await expect(simplePanel.getByText('Repositorio publico de backups')).toBeVisible()
  await expect(simplePanel.getByText('Modo de restauracion')).toHaveCount(0)
  await expect(simplePanel.getByText('Observador primero')).toHaveCount(0)
  await expect(simplePanel.getByText('Fecha del ultimo backup:', { exact: false })).toBeVisible()
  await expect(simplePanel.getByText('Esta es la forma normal de poner un nodo en marcha rapidamente.')).toHaveCount(0)
  await expect(simplePanel.getByText('Hay herramientas adicionales de gestion de backups en el modo experto.')).toHaveCount(0)
  await expect(simplePanel.getByText('SFTP')).toHaveCount(0)
  await expect(simplePanel.getByText('admin')).toHaveCount(0)
  await capture(page, testInfo, 'simple-spanish-desktop')
})

test('expert mode separates private backup tools from read-only public bootstrap inventory', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await installBackupBridge(page, { scenario: 'success', advanced: true, remoteEnabled: true })
  await openNodeBackups(page)

  await expect(page.getByRole('button', { name: 'Create Local Backup' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Remote Backup' })).toBeVisible()
  await expect(page.getByText('Remote SFTP')).toBeVisible()
  await expect(page.getByText('Public bootstrap backups')).toBeVisible()
  await expect(page.getByText('Admin API')).toBeVisible()

  const publicCard = page.locator('.node-backup-snapshot', { hasText: PUBLIC_BACKUP_ID })
  const remoteCard = page.locator('.node-backup-snapshot', { hasText: REMOTE_BACKUP_ID })
  const localCard = page.locator('.node-backup-snapshot', { hasText: LOCAL_BACKUP_ID })
  await expect(publicCard.getByRole('button', { name: /Verify public backup/ })).toBeVisible()
  await expect(publicCard.getByRole('button', { name: /Restore public backup/ })).toBeVisible()
  await expect(publicCard.getByRole('button', { name: /Purge/ })).toHaveCount(0)
  await expect(remoteCard.getByRole('button', { name: /Purge remote backup/ })).toBeVisible()
  await expect(localCard.getByRole('button', { name: /Purge local backup/ })).toBeVisible()

  await page.getByRole('button', { name: 'Create Local Backup' }).click()
  await page.getByRole('button', { name: 'Create Remote Backup' }).click()
  await publicCard.getByRole('button', { name: /Verify public backup/ }).click()

  const trackedCalls = await calls(page)
  expect(trackedCalls).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'createBackup' }),
    expect.objectContaining({ name: 'nativeBackupRestorePreflight' })
  ]))
  expect(JSON.stringify(trackedCalls)).toContain('"backupSource":"public"')
  expect(JSON.stringify(trackedCalls)).not.toContain('public-publish')
  await capture(page, testInfo, 'expert-desktop')
})

test('settings backup simple/expert switching and unsaved navigation prompt work', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackupBridge(page, { scenario: 'success', advanced: false })
  await openSettingsBackup(page)

  const settingsPanel = page.locator('#panel-settings')
  await expect(settingsPanel.getByText('Restore backups')).toBeVisible()
  await expect(settingsPanel.getByText('Use Node > Restore Backup to restore chain state.')).toBeVisible()
  await expect(settingsPanel.getByText('Remote SFTP backup')).toHaveCount(0)
  await expect(settingsPanel.getByText('Native backup admin')).toHaveCount(0)
  await capture(page, testInfo, 'settings-simple')

  await settingsPanel.getByRole('button', { name: 'Show expert backup controls' }).click()
  await expect(settingsPanel.getByText('Expert backup configuration')).toBeVisible()
  await expect(settingsPanel.getByRole('heading', { name: 'Remote SFTP backup' })).toBeVisible()
  await expect(settingsPanel.getByRole('heading', { name: 'Native backup admin' })).toBeVisible()
  await capture(page, testInfo, 'settings-expert')

  await page.getByRole('button', { name: 'Explorer' }).click()
  await expect(page.getByRole('dialog', { name: 'Unsaved settings changes' })).toBeVisible()
})
