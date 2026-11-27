import { expect, test, type Page } from '@playwright/test'

const nodeSettingsKey = 'teleno.node.settings.v1'
const formerDefault = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
const mainnetDefault = 'https://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
const customHttp = '  http://mirror.example.test/backup.tar.gz  '
const customHttps = 'https://mirror.example.test/backup.tar.gz'

type Network = 'mainnet' | 'testnet' | 'custom'

async function openSettings(page: Page, origin: string, network: Network, backupUrl: string, language = 'en') {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  )
  await page.addInitScript(({ nodeKey, network, backupUrl, language }) => {
    const baseDir = '/fixture/initial/basedir'
    const repoPath = '/fixture/repository'
    const profiles = [network === 'custom' ? 'custom_advanced' : `${network}_observer`]
    if (localStorage.getItem(nodeKey) === null) {
      localStorage.setItem('teleno.ui.language.v1', language)
      localStorage.setItem('teleno.first-run-setup.completed.v1', 'complete')
      localStorage.setItem('teleno.explorer.settings.v1', JSON.stringify({
        rpcSource: 'local', publicRpcUrls: ['https://rpc.example.test/'], koinscanUrl: 'https://scan.example.test/',
        pollMs: 3700, rowLimit: 20, nodeAdvancedMode: false, producerAdvancedMode: false
      }))
      localStorage.setItem(nodeKey, JSON.stringify({
        network, baseDir, repoPath, profiles: profiles.join(','), blockchainBackupUrl: backupUrl,
        backup: { localRetentionCount: 11 }
      }))
    }
    const status = {
      ok: true, network, repoPath, baseDir, profiles, configReady: true, configDir: baseDir,
      services: [], components: [], runningServices: 0, output: '', runtimeMode: 'monolith'
    }
    const restoreRequests: unknown[] = []
    Object.assign(window, { fixtureRestoreRequests: restoreRequests })
    window.teleno = {
      version: '0.0.0-fixture',
      app: { firstRunSetupState: async () => ({ ok: true, completed: true }) },
      telenoNode: {
        status: async () => status,
        stop: async () => ({ ok: true, status, output: '' }),
        rpcCall: async () => ({ ok: true, result: {} }),
        validateBaseDir: async (input: { baseDir: string }) => ({
          ok: true, baseDir: input.baseDir, restoreWorkspaceParent: '/fixture', writable: true, output: ''
        }),
        restoreBackupVerify: async (input: unknown) => {
          restoreRequests.push(input)
          return { ok: true, status, output: 'Mock restore accepted' }
        }
      }
    } as unknown as Window['teleno']
  }, { nodeKey: nodeSettingsKey, network, backupUrl, language })
  await page.goto('/')
  await page.locator('#tab-settings').click()
}

function savedProfile(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), nodeSettingsKey)
}

function requests(page: Page) {
  return page.evaluate(() => (window as Window & { fixtureRestoreRequests: unknown[] }).fixtureRestoreRequests)
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: /^(Save Settings|Guardar ajustes)$/ })
}

async function saveDataFolderAndRequestRestore(page: Page, folder: string) {
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await page.locator('.settings-input-with-button input').fill(folder)
  await saveButton(page).click()
  await expect.poll(() => savedProfile(page)).toMatchObject({ baseDir: folder })
  await page.locator('#tab-node').click()
  const dialog = page.getByRole('dialog', { name: /^(Settings saved|Ajustes guardados)$/ })
  await dialog.getByRole('button', { name: 'Restore from backup' }).click()
}

test('keeps unrelated desktop saves usable and lets users edit the saved legacy URL', async ({ page, baseURL }, testInfo) => {
  await openSettings(page, new URL(baseURL!).origin, 'mainnet', customHttp)
  await saveDataFolderAndRequestRestore(page, '/fixture/updated/basedir')
  await expect(page.getByRole('alert').filter({ hasText: 'In Settings > Backup, use the final HTTPS backup URL' })).toBeVisible()
  expect(await requests(page)).toEqual([])
  const savedBeforeEdit = await savedProfile(page)
  expect(savedBeforeEdit).toMatchObject({
    baseDir: '/fixture/updated/basedir', blockchainBackupUrl: customHttp, backup: { localRetentionCount: 11 }
  })

  await page.locator('#tab-settings').click()
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Legacy backup URL', exact: true })
  await expect(editor).toHaveValue(customHttp)
  await page.screenshot({ path: testInfo.outputPath('legacy-backup-url-editor-en.png'), animations: 'disabled' })
  await editor.fill(formerDefault)
  await saveButton(page).click()
  await expect(page.getByRole('alert').filter({ hasText: 'In Settings > Backup, use the final HTTPS backup URL' })).toBeVisible()
  expect(await savedProfile(page)).toEqual(savedBeforeEdit)

  await editor.fill(customHttps)
  await saveButton(page).click()
  await expect.poll(() => savedProfile(page)).toEqual({
    ...savedBeforeEdit,
    blockchainBackupUrl: customHttps,
    blockchainBackupUrlsByNetwork: { mainnet: customHttps }
  })
  await saveDataFolderAndRequestRestore(page, '/fixture/verified/basedir')
  await expect.poll(() => requests(page)).toEqual([
    expect.objectContaining({ network: 'mainnet', baseDir: '/fixture/verified/basedir', blockchainBackupUrl: customHttps })
  ])
})

for (const network of ['testnet', 'custom'] as const) {
  test(`clears the inherited mainnet URL on ${network} and accepts an explicit HTTPS source`, async ({ page, baseURL }, testInfo) => {
    const spanish = network === 'testnet'
    await openSettings(page, new URL(baseURL!).origin, network, formerDefault, spanish ? 'es' : 'en')
    await saveDataFolderAndRequestRestore(page, '/fixture/updated/basedir')
    await expect(page.getByRole('alert').filter({ hasText: /^(Enter the direct HTTPS URL|Introduce la URL HTTPS directa)/ })).toBeVisible()
    await expect.poll(() => savedProfile(page)).toMatchObject({ network, blockchainBackupUrl: '' })
    expect(await requests(page)).toEqual([])

    await page.locator('#tab-settings').click()
    await page.getByRole('button', { name: 'Backup', exact: true }).click()
    const editor = page.getByRole('textbox', { name: spanish ? 'URL de copia de seguridad antigua' : 'Legacy backup URL', exact: true })
    await expect(editor).toHaveValue('')
    if (spanish) await page.screenshot({ path: testInfo.outputPath('legacy-backup-url-editor-es.png'), animations: 'disabled' })
    await editor.fill(customHttps)
    await saveButton(page).click()
    await expect.poll(() => savedProfile(page)).toMatchObject({ network, blockchainBackupUrl: customHttps })
    await saveDataFolderAndRequestRestore(page, '/fixture/verified/basedir')
    await expect.poll(() => requests(page)).toEqual([
      expect.objectContaining({ network, baseDir: '/fixture/verified/basedir', blockchainBackupUrl: customHttps })
    ])
  })
}

test('migrates the exact former built-in URL on mainnet', async ({ page, baseURL }) => {
  await openSettings(page, new URL(baseURL!).origin, 'mainnet', formerDefault)
  await saveDataFolderAndRequestRestore(page, '/fixture/verified/basedir')
  await expect.poll(() => savedProfile(page)).toMatchObject({ network: 'mainnet', blockchainBackupUrl: mainnetDefault })
  await expect.poll(() => requests(page)).toEqual([
    expect.objectContaining({ network: 'mainnet', baseDir: '/fixture/verified/basedir', blockchainBackupUrl: mainnetDefault })
  ])
})

test('restores with the selected network mirror or default across saved switches and reload', async ({ page, baseURL }) => {
  const testnetMirror = 'https://testnet-mirror.example.test/backup.tar.gz'
  const mainnetMirror = 'https://mainnet-mirror.example.test/backup.tar.gz'
  await openSettings(page, new URL(baseURL!).origin, 'testnet', testnetMirror)

  async function saveNetwork(network: Network, expectedUrl: string) {
    await page.locator('#tab-settings').click()
    await page.getByRole('button', { name: 'General', exact: true }).click()
    await page.getByRole('combobox', { name: /^Network/ }).selectOption(network)
    await saveButton(page).click()
    await expect.poll(() => savedProfile(page)).toMatchObject({ network, blockchainBackupUrl: expectedUrl })
  }

  await saveNetwork('mainnet', mainnetDefault)
  await saveDataFolderAndRequestRestore(page, '/fixture/mainnet-default/basedir')
  await expect.poll(() => requests(page)).toEqual([
    expect.objectContaining({ network: 'mainnet', blockchainBackupUrl: mainnetDefault })
  ])

  await page.locator('#tab-settings').click()
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Legacy backup URL', exact: true })
  await expect(editor).toHaveValue(mainnetDefault)
  await editor.fill(mainnetMirror)
  await saveButton(page).click()
  await expect.poll(() => savedProfile(page)).toMatchObject({ blockchainBackupUrl: mainnetMirror })

  await saveNetwork('testnet', testnetMirror)
  await saveDataFolderAndRequestRestore(page, '/fixture/testnet-restore/basedir')
  await expect.poll(() => requests(page)).toEqual([
    expect.objectContaining({ network: 'mainnet', blockchainBackupUrl: mainnetDefault }),
    expect.objectContaining({ network: 'testnet', blockchainBackupUrl: testnetMirror })
  ])

  await page.reload()
  await saveNetwork('mainnet', mainnetMirror)
  await saveDataFolderAndRequestRestore(page, '/fixture/mainnet-restore/basedir')
  await expect.poll(() => requests(page)).toEqual([
    expect.objectContaining({ network: 'mainnet', blockchainBackupUrl: mainnetMirror })
  ])
  expect(await savedProfile(page)).toMatchObject({ blockchainBackupUrlsByNetwork: { mainnet: mainnetMirror, testnet: testnetMirror } })
})
