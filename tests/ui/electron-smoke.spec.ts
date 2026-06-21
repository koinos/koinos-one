import { _electron as electron, expect, test } from '@playwright/test'

const repoRoot = process.cwd()

test.skip(process.env.TELENO_PLAYWRIGHT_ELECTRON !== '1', 'Run with npm run test:ui:electron')

test('launches the Electron desktop shell', async () => {
  const app = await electron.launch({
    cwd: repoRoot,
    args: ['--user-data-dir=/tmp/teleno-playwright-user-data', repoRoot],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: ''
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByLabel('Koinos One')).toBeVisible()
    await expect(page.locator('#tab-settings')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Explorer' })).toBeVisible()
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
  }
})
