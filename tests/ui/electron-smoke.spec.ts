import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = process.cwd()
const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
const STABLE_SCREENSHOT_DIR = path.join(repoRoot, '.run', 'backup-restore-ui-screenshots')

test.skip(process.env.TELENO_PLAYWRIGHT_ELECTRON !== '1', 'Run with npm run test:ui:electron')

async function closeAppAndRemoveTemp(app: Awaited<ReturnType<typeof electron.launch>>, tempRoot: string) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app.close().catch(() => undefined)
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function completeFirstRunForTest(page: Page) {
  await page.evaluate(async (firstRunKey) => {
    await window.teleno?.app?.completeFirstRunSetup?.({ completedFrom: 'playwright-electron-smoke' })
    window.localStorage.setItem(firstRunKey, 'complete')
  }, FIRST_RUN_SETUP_STORAGE_KEY)
  await page.reload()
}

test('launches the Electron desktop shell', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'teleno-electron-smoke-'))
  const app = await electron.launch({
    cwd: repoRoot,
    args: [`--user-data-dir=${path.join(tempRoot, 'user-data')}`, repoRoot],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      TELENO_LAUNCH_NODE_SETTINGS_JSON: JSON.stringify({
        network: 'mainnet',
        baseDir: path.join(tempRoot, 'basedir'),
        profiles: 'mainnet_observer',
        backup: { remoteEnabled: false }
      })
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await completeFirstRunForTest(page)

    await expect(page.getByLabel('Koinos One')).toBeVisible()
    await expect(page.locator('#tab-settings')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Explorer' })).toBeVisible()
  } finally {
    await closeAppAndRemoveTemp(app, tempRoot)
  }
})

test('shows simple backup restore settings in real Electron with disposable paths', async ({}, testInfo) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'teleno-electron-backup-ui-'))
  const app = await electron.launch({
    cwd: repoRoot,
    args: [`--user-data-dir=${path.join(tempRoot, 'user-data')}`, repoRoot],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      TELENO_LAUNCH_NODE_SETTINGS_JSON: JSON.stringify({
        network: 'mainnet',
        baseDir: path.join(tempRoot, 'basedir'),
        profiles: 'mainnet_observer',
        backup: { remoteEnabled: false }
      })
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await completeFirstRunForTest(page)

    await page.locator('#tab-settings').click()
    await page.getByRole('button', { name: 'Backup' }).click()
    const settingsPanel = page.locator('#panel-settings')
    await expect(settingsPanel.getByText('Restore backups')).toBeVisible()
    await expect(settingsPanel.getByText('Use Node > Restore Backup to restore chain state.')).toBeVisible()
    await expect(settingsPanel.getByText('Remote SFTP backup')).toHaveCount(0)
    await expect(settingsPanel.getByText('Native backup admin')).toHaveCount(0)
    const screenshotName = 'electron-settings-backup-simple.png'
    mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({
      path: testInfo.outputPath('electron-settings-backup-simple.png'),
      fullPage: true
    })
    await page.screenshot({
      path: path.join(STABLE_SCREENSHOT_DIR, screenshotName),
      fullPage: true
    })
  } finally {
    await closeAppAndRemoveTemp(app, tempRoot)
  }
})
