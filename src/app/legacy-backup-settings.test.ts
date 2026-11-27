import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { MAINNET_LEGACY_BACKUP_URL } from '../../electron/lib/legacy-backup-url'
import { DEFAULT_NODE_SETTINGS, NODE_SETTINGS_STORAGE_KEY } from './constants'
import { loadInitialNodeSettings, nodeSettingsWithBackupUrl, normalizeBackupTarGzUrl, normalizeBackupUrlSetting, toNodeApiSettings } from './utils'

vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {} }))

type RestoreRequest = ReturnType<typeof toNodeApiSettings>
type RestoreHandler = (input: RestoreRequest) => Promise<{ ok: boolean; output: string }>

it('selects the saved or explicitly configured mirror for the effective network at the Electron handler', async () => {
  // Exercise the actual main-process service in Vitest without adding Node-only
  // code to the renderer typecheck's import graph.
  const { createBackupService } = await vi.importActual<{
    createBackupService: (deps: Record<string, unknown>) => {
      telenoNodeRestoreBackup: RestoreHandler
      telenoNodeRestoreBackupAndVerify: RestoreHandler
    }
  }>('../../electron/lib/backup-service')
  const { normalizeNodeSettings } = await vi.importActual<{
    normalizeNodeSettings: (input: RestoreRequest) => RestoreRequest
  }>('../../electron/lib/node-paths')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-backup-settings-'))
  try {
    const publicKeyFile = path.join(root, 'fixture.pub')
    const { publicKey } = generateKeyPairSync('ed25519')
    fs.writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }))
    vi.stubEnv('TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE', publicKeyFile)
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const status = {
      ok: true, repoPath: root, baseDir: root, profiles: [], configReady: true, configDir: root,
      services: [], components: [], runningServices: 0, output: ''
    }
    const stop = vi.fn()
    const validate = vi.fn()
    const service = createBackupService({
      normalizeNodeSettings,
      assertRepoReady: () => {},
      validateNodeBaseDirAccess: validate,
      telenoNodeStatus: async () => status,
      telenoNodeAction: stop,
      ensureKoinosConfigFiles: vi.fn(),
      ensureBaseDirKoinosRuntimeFiles: vi.fn(),
      restoreWorkspaceParentPath: vi.fn(),
      ensureKoinosBaseDir: vi.fn(),
      readServiceDefinitions: () => new Map(),
      selectedManagedComposeServiceIds: () => ['jsonrpc'],
      composeServicePortByTarget: () => null,
      runCommand: vi.fn()
    })

    function loadSettings(
      saved?: string,
      network = 'mainnet',
      launch?: { network: string; blockchainBackupUrl?: string },
      urls?: Partial<Record<string, string>>
    ) {
      const getItem = (key: string) => key === NODE_SETTINGS_STORAGE_KEY && saved !== undefined
        ? JSON.stringify({ network, blockchainBackupUrl: saved, blockchainBackupUrlsByNetwork: urls }) : null
      vi.stubGlobal('window', {
        localStorage: { getItem },
        teleno: launch ? { launchDefaults: { nodeSettings: launch } } : undefined
      })
      return loadInitialNodeSettings()
    }
    const former = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
    const customHttps = 'https://mirror.example.test/backup.tar.gz'
    const mainnetMirror = 'https://mainnet-mirror.example.test/backup.tar.gz'
    const testnetMirror = 'https://testnet-mirror.example.test/backup.tar.gz'
    const fresh = loadSettings()
    const reset = nodeSettingsWithBackupUrl(fresh, 'mainnet', DEFAULT_NODE_SETTINGS.blockchainBackupUrl)
    const blank = nodeSettingsWithBackupUrl(fresh, 'mainnet', normalizeBackupUrlSetting('  ', 'mainnet', 'en'))
    const testnetSettings = loadSettings(testnetMirror, 'testnet')
    expect(normalizeBackupUrlSetting(' ', 'testnet', 'en')).toBe('')
    for (const [settings, expected] of [
      [fresh, MAINNET_LEGACY_BACKUP_URL],
      [reset, MAINNET_LEGACY_BACKUP_URL],
      [blank, MAINNET_LEGACY_BACKUP_URL],
      [loadSettings(former), MAINNET_LEGACY_BACKUP_URL],
      [loadSettings(customHttps, 'testnet'), customHttps],
      [loadSettings(customHttps, 'custom'), customHttps],
      [loadSettings(testnetMirror, 'testnet', { network: 'mainnet' }), MAINNET_LEGACY_BACKUP_URL],
      [loadSettings(mainnetMirror, 'mainnet', { network: 'testnet', blockchainBackupUrl: testnetMirror }), testnetMirror],
      [loadSettings(testnetMirror, 'testnet', { network: 'mainnet' }, { mainnet: mainnetMirror, testnet: testnetMirror }), mainnetMirror],
      [{ ...testnetSettings, network: 'mainnet' }, MAINNET_LEGACY_BACKUP_URL]
    ] as const) {
      const request = toNodeApiSettings({ ...settings, baseDir: root, repoPath: root })
      request.blockchainBackupUrl = normalizeBackupTarGzUrl(request.blockchainBackupUrl ?? '', 'en')
      const result = await service.telenoNodeRestoreBackupAndVerify(request)
      expect(result.ok).toBe(false)
      expect(fetchMock.mock.calls).toEqual([
        [`${expected}.sha256`, { redirect: 'error' }],
        [`${expected}.metadata`, { redirect: 'error' }]
      ])
      fetchMock.mockClear()
    }
    for (const network of ['testnet', 'custom']) {
      const inherited = loadSettings(former, network)
      expect(inherited.blockchainBackupUrl).toBe('')
      expect(loadSettings(former, 'mainnet', { network }).blockchainBackupUrl).toBe('')
      const rawRequest = { ...toNodeApiSettings(inherited), blockchainBackupUrl: former }
      expect((await service.telenoNodeRestoreBackupAndVerify(rawRequest)).output).toMatch(/Settings > Backup/)
    }
    const launchWithoutTargetMirror = loadSettings(mainnetMirror, 'mainnet', { network: 'testnet' })
    expect(launchWithoutTargetMirror.blockchainBackupUrl).toBe('')
    expect(nodeSettingsWithBackupUrl(launchWithoutTargetMirror, 'mainnet').blockchainBackupUrl).toBe(mainnetMirror)
    expect((await service.telenoNodeRestoreBackupAndVerify(toNodeApiSettings(launchWithoutTargetMirror))).output).toMatch(/Settings > Backup/)
    const customHttp = '  http://mirror.example.test/backup.tar.gz  '
    const custom = toNodeApiSettings({ ...loadSettings(customHttp), baseDir: root, repoPath: root })
    expect(custom.blockchainBackupUrl).toBe(customHttp)
    expect(() => normalizeBackupUrlSetting(former, 'mainnet', 'en')).toThrow(/final HTTPS/)
    expect(() => normalizeBackupUrlSetting(customHttp, 'mainnet', 'en')).toThrow(/final HTTPS/)
    expect(() => normalizeBackupUrlSetting(customHttp, 'mainnet', 'es')).toThrow(/HTTPS final/)
    expect((await service.telenoNodeRestoreBackup(custom)).output).toMatch(/final HTTPS/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
