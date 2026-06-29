import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  generateRemoteCommandPlan,
  normalizeRemoteFleetInventory,
  type RemoteFleetInventory,
  recommendedRemoteBaseDir,
  type RemoteFleetInventoryInput
} from '../../src/app/remote-nodes'
import { remoteExecutionConfirmationPhrase } from '../../src/app/remote-node-execution'

const repoRoot = process.cwd()
const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const STABLE_SCREENSHOT_DIR = path.join(repoRoot, '.run', 'remote-node-ui-screenshots')

test.skip(process.env.TELENO_PLAYWRIGHT_ELECTRON !== '1', 'Run with TELENO_PLAYWRIGHT_ELECTRON=1')

async function closeAppAndRemoveTemp(app: Awaited<ReturnType<typeof electron.launch>>, tempRoot: string) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app.close().catch(() => undefined)
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function completeFirstRunForTest(page: Page) {
  await page.evaluate(async ({ firstRunKey, languageKey }) => {
    await window.teleno?.app?.completeFirstRunSetup?.({ completedFrom: 'playwright-electron-remote-nodes' })
    window.localStorage.setItem(firstRunKey, 'complete')
    window.localStorage.setItem(languageKey, 'en')
  }, {
    firstRunKey: FIRST_RUN_SETUP_STORAGE_KEY,
    languageKey: LANGUAGE_STORAGE_KEY
  })
  await page.reload()
}

async function capture(page: Page, testInfo: { outputPath: (path: string) => string }, name: string) {
  mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: false
  })
  await page.screenshot({
    path: path.join(STABLE_SCREENSHOT_DIR, name),
    fullPage: false
  })
}

test('validates Remote Nodes through real Electron preload and IPC', async ({}, testInfo) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'teleno-electron-remote-nodes-'))
  const tempBaseDir = path.join(tempRoot, 'basedir')
  const app = await electron.launch({
    cwd: repoRoot,
    args: [`--user-data-dir=${path.join(tempRoot, 'user-data')}`, repoRoot],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      TELENO_LAUNCH_NODE_SETTINGS_JSON: JSON.stringify({
        network: 'testnet',
        baseDir: tempBaseDir,
        profiles: 'testnet_observer',
        backup: { remoteEnabled: false }
      })
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await completeFirstRunForTest(page)

    await expect.poll(
      () => page.evaluate(() => Boolean(window.teleno?.remoteNodes?.loadInventory && window.teleno?.remoteNodes?.saveInventory)),
      { message: 'remoteNodes preload bridge is exposed' }
    ).toBe(true)

    await page.getByRole('tab', { name: 'Remote' }).click()
    const remotePanel = page.locator('#panel-remote')
    await expect(remotePanel.getByRole('heading', { name: 'Remote Nodes' })).toBeVisible()
    await expect(remotePanel.getByText('Dry-run by default')).toBeVisible()
    await expect(remotePanel.getByText('Server checklist')).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Check health' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Show logs' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Restore backup and start observer' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Stop observer' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Restart observer' })).toHaveCount(0)
    await expect(remotePanel.getByText('Collect Logs Plan')).toHaveCount(0)
    await expect(remotePanel.getByText('Cleanup Plan')).toHaveCount(0)

    await remotePanel.getByRole('button', { name: 'Add node' }).click()
    await remotePanel.getByLabel('Label').fill('IPC Testnet Observer')
    await remotePanel.getByLabel('SSH alias').fill('ipc-testnet-observer')
    await expect(remotePanel.getByLabel('Suggested BASEDIR')).toHaveValue(
      recommendedRemoteBaseDir('testnet', 'testnet-observer-3')
    )
    await remotePanel.getByRole('button', { name: 'Save inventory' }).click()
    await expect(remotePanel.getByText('Saved local remote inventory to')).toBeVisible()

    const savedInventoryResult = await page.evaluate(() => window.teleno?.remoteNodes?.loadInventory())
    expect(savedInventoryResult?.ok).toBe(true)
    const savedInventory: RemoteFleetInventory = normalizeRemoteFleetInventory(savedInventoryResult?.inventory as RemoteFleetInventoryInput)
    const savedNode = savedInventory.nodes.find((node) => node.id === 'testnet-observer-3')
    expect(savedNode).toMatchObject({
      label: 'IPC Testnet Observer',
      connectionRef: 'ipc-testnet-observer',
      network: 'testnet',
      role: 'observer',
      producer: { enabled: false },
      paths: {
        baseDir: recommendedRemoteBaseDir('testnet', 'testnet-observer-3')
      }
    })

    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    await expect(remotePanel.getByText('IPC Testnet Observer')).toBeVisible()
    await expect(remotePanel.getByText(recommendedRemoteBaseDir('testnet', 'testnet-observer-3'))).toBeVisible()
    await remotePanel.locator('.remote-node-card').filter({ hasText: 'IPC Testnet Observer' }).click()
    await remotePanel.getByRole('button', { name: 'Restore backup and start observer' }).click()
    await expect(remotePanel.locator('.remote-plan-summary').getByText('IPC Testnet Observer')).toBeVisible()
    await expect(remotePanel.locator('.remote-command-list')).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Collect Logs Plan' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Cleanup Plan' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: /producer/i })).toHaveCount(0)
    await expect(remotePanel.getByText('Producer activation unavailable')).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeDisabled()
    await remotePanel.locator('.remote-plan').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'electron-remote-nodes-simple-real-ipc.png')

    await remotePanel.getByLabel('Type the phrase').fill('EXECUTE wrong testnet status')
    await expect(remotePanel.getByText('Exact confirmation is required before execution.')).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeDisabled()
    await remotePanel.locator('.remote-execution-panel').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'electron-remote-nodes-confirmation-gate-real-ipc.png')

    const statusPlan = generateRemoteCommandPlan(savedInventory, 'testnet-observer-3', 'status')
    const blockedResult = await page.evaluate(async ({ node, plan }) => {
      return window.teleno?.remoteNodes?.executePlan?.({
        node,
        plan,
        confirmation: 'WRONG CONFIRMATION'
      })
    }, {
      node: savedNode,
      plan: statusPlan
    })
    expect(blockedResult?.ok).toBe(false)
    expect(`${blockedResult?.output || ''}`).toContain('Type "EXECUTE testnet-observer-3 testnet status"')

    const receiptsResult = await page.evaluate(() => window.teleno?.remoteNodes?.loadReceipts())
    expect(receiptsResult?.ok).toBe(true)
    expect(receiptsResult?.receipts).toHaveLength(1)
    expect(receiptsResult?.receipts[0]).toMatchObject({
      nodeId: 'testnet-observer-3',
      action: 'status',
      status: 'blocked'
    })

    await remotePanel.locator('.remote-node-card').filter({ hasText: 'Prodnet Observer A' }).click()
    await expect(remotePanel.getByRole('button', { name: 'Check health' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Show logs' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Restore backup and start observer' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Stop observer' })).toHaveCount(0)
    const prodnetNode = savedInventory.nodes.find((node) => node.id === 'prodnet-observer-a')
    expect(prodnetNode).toBeTruthy()
    await page.evaluate((settingsKey) => {
      const current = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Record<string, unknown>
      window.localStorage.setItem(settingsKey, JSON.stringify({
        ...current,
        nodeAdvancedMode: true
      }))
    }, SETTINGS_STORAGE_KEY)
    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    await remotePanel.locator('.remote-node-card').filter({ hasText: 'Prodnet Observer A' }).click()
    await remotePanel.getByRole('button', { name: 'Stop Node Plan' }).click()
    await remotePanel.getByLabel('Type the phrase').fill(remoteExecutionConfirmationPhrase(prodnetNode!, 'stop'))
    await expect(remotePanel.getByText('Prodnet execution is blocked except for read-only health and logs plans.')).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeDisabled()
    await remotePanel.locator('.remote-execution-panel').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'electron-remote-nodes-prodnet-blocked-real-ipc.png')

    const prodnetStopPlan = generateRemoteCommandPlan(savedInventory, 'prodnet-observer-a', 'stop')
    const prodnetBlockedResult = await page.evaluate(async ({ node, plan, confirmation }) => {
      return window.teleno?.remoteNodes?.executePlan?.({ node, plan, confirmation })
    }, {
      node: prodnetNode!,
      plan: prodnetStopPlan,
      confirmation: remoteExecutionConfirmationPhrase(prodnetNode!, 'stop')
    })
    expect(prodnetBlockedResult?.ok).toBe(false)
    expect(`${prodnetBlockedResult?.output || ''}`).toContain('read-only status and logs plans')

    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    const testnetReceipt = remotePanel.locator('.remote-receipt').filter({ hasText: 'testnet-observer-3 · status' })
    await expect(testnetReceipt).toBeVisible()
    await expect(testnetReceipt.getByText('blocked', { exact: true })).toBeVisible()
    const prodnetReceipt = remotePanel.locator('.remote-receipt').filter({ hasText: 'prodnet-observer-a · stop' })
    await expect(prodnetReceipt).toBeVisible()
    await expect(prodnetReceipt.getByText('blocked', { exact: true })).toBeVisible()
    await remotePanel.locator('.remote-node-card').filter({ hasText: 'IPC Testnet Observer' }).click()
    await expect(remotePanel.locator('.remote-plan-summary').getByText('IPC Testnet Observer')).toBeVisible()
    await expect(remotePanel.getByText('Prodnet execution is limited to read-only health and logs plans')).toHaveCount(0)
    await prodnetReceipt.scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'electron-remote-nodes-receipts-real-ipc.png')

    await page.evaluate((settingsKey) => {
      const current = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Record<string, unknown>
      window.localStorage.setItem(settingsKey, JSON.stringify({
        ...current,
        nodeAdvancedMode: true
      }))
    }, SETTINGS_STORAGE_KEY)
    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    await expect(remotePanel.getByRole('heading', { name: 'Command plans' })).toBeVisible()
    await remotePanel.locator('.remote-node-card').filter({ hasText: 'IPC Testnet Observer' }).click()
    await remotePanel.getByRole('button', { name: 'Collect Logs Plan' }).click()
    await expect(remotePanel.getByRole('button', { name: 'Cleanup Plan' })).toBeVisible()
    await expect(remotePanel.locator('.remote-plan-summary').getByText('IPC Testnet Observer')).toBeVisible()
    await expect(remotePanel.getByText('Fill in the remaining placeholder values before execution.')).toHaveCount(0)
    await expect(remotePanel.locator('.remote-command-list')).toContainText('ssh ipc-testnet-observer')
    await expect(remotePanel.locator('.remote-command-list')).toContainText('Diagnostics')
    await expect(remotePanel.locator('.remote-command-list')).toContainText('read-only')
    await expect(remotePanel.locator('.remote-command-list')).toContainText('docker logs')
    await remotePanel.locator('.remote-command-list').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'electron-remote-nodes-expert-real-ipc.png')

    await page.evaluate((settingsKey) => {
      const current = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Record<string, unknown>
      window.localStorage.setItem(settingsKey, JSON.stringify({
        ...current,
        nodeAdvancedMode: false
      }))
    }, SETTINGS_STORAGE_KEY)
  } finally {
    await closeAppAndRemoveTemp(app, tempRoot)
  }
})
