import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  normalizeRemoteFleetInventory,
  type RemoteFleetInventory,
  type RemoteFleetInventoryInput
} from '../../src/app/remote-nodes'
import { remoteExecutionConfirmationPhrase } from '../../src/app/remote-node-execution'

const repoRoot = process.cwd()
const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const STABLE_SCREENSHOT_DIR = path.join(repoRoot, '.run', 'remote-node-ui-screenshots')
const LAN_CONNECTION_REF = 'lan-readonly'

test.skip(
  process.env.TELENO_PLAYWRIGHT_ELECTRON !== '1' || process.env.TELENO_REMOTE_LAN_READONLY_E2E !== '1',
  'Run with TELENO_PLAYWRIGHT_ELECTRON=1 TELENO_REMOTE_LAN_READONLY_E2E=1'
)
test.setTimeout(120_000)

type LanObserverDiscovery = {
  serviceName: string
  network: 'mainnet' | 'testnet'
  baseDir: string
  config: string
  jsonrpcHostBind: string
  backupAdminListen: string
  p2pPublic: string
  publicBootstrapUrl: string
}

function resolveLanTarget(): string {
  if (process.env.TELENO_LAN_SSH_TARGET?.trim()) return process.env.TELENO_LAN_SSH_TARGET.trim()
  const inventoryLabel = process.env.TELENO_LAN_INVENTORY_LABEL?.trim()
  if (!inventoryLabel) {
    throw new Error('Set TELENO_LAN_SSH_TARGET or TELENO_LAN_INVENTORY_LABEL for the local-only LAN read-only E2E.')
  }

  const inventoryPath = path.join(repoRoot, 'docs/operations/CONFIRMED_SSH_HOSTS.md')
  if (!existsSync(inventoryPath)) throw new Error('Local LAN SSH inventory is unavailable.')
  const inventory = readFileSync(inventoryPath, 'utf8')
  for (const line of inventory.split('\n')) {
    if (!line.includes(inventoryLabel)) continue
    const columns = line.split('|').map((column) => column.replace(/`/g, '').trim())
    const ip = columns[2]
    const user = columns[3]
    if (ip && user) return `${user}@${ip}`
  }
  throw new Error('LAN SSH target was not found in local inventory.')
}

function parseKeyValues(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    values[line.slice(0, index)] = line.slice(index + 1).trim()
  }
  return values
}

function coerceHostLoopbackBind(value: string, fallback: string): string {
  const port = value.match(/:(\d+)$/)?.[1] || value.match(/tcp\/(\d+)/)?.[1]
  return port ? `127.0.0.1:${port}` : fallback
}

function discoverLanObserver(target: string): LanObserverDiscovery {
  const raw = execFileSync('/usr/bin/ssh', [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    target,
    'bash',
    '-s'
  ], {
    input: `
set -eu
unit=$(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^teleno.*\\.service$' | head -n 1 || true)
[ -n "$unit" ] || exit 42
exec_start=$(systemctl show "$unit" -p ExecStart --value)
base_dir=$(printf '%s\\n' "$exec_start" | sed -n 's/.*--basedir \\([^ ;]*\\).*/\\1/p' | head -n1)
config=$(printf '%s\\n' "$exec_start" | sed -n 's/.*--config \\([^ ;]*\\).*/\\1/p' | head -n1)
[ -n "$base_dir" ] && [ -n "$config" ] && [ -f "$config" ] || exit 43
network=$(awk '/^network:/ {print $2; exit}' "$config")
[ -n "$network" ] || network=$(awk '/network:/ {print $2; exit}' "$config")
jsonrpc=$(awk '/^jsonrpc:/ {section=1; next} /^[^[:space:]]/ {section=0} section && /listen:/ {print $2; exit}' "$config")
admin=$(awk '/^  admin:/ {section=1; next} /^  [A-Za-z0-9_-]+:/ && !/^  admin:/ {if (section) exit} section && /listen:/ {print $2; exit}' "$config")
p2p=$(sed -n '/^p2p:/,/^[^[:space:]]/ s#.*tcp/\\([0-9][0-9]*\\).*#\\1#p' "$config" | head -n1)
bootstrap=$(awk '/base-url:/ {print $2; exit}' "$config")
block_producer=$(awk '/block_producer:/ {print $2; exit}' "$config")
printf 'unit=%s\\n' "$unit"
printf 'baseDir=%s\\n' "$base_dir"
printf 'config=%s\\n' "$config"
printf 'network=%s\\n' "\${network:-mainnet}"
printf 'jsonrpc=%s\\n' "\${jsonrpc:-}"
printf 'admin=%s\\n' "\${admin:-}"
printf 'p2p=%s\\n' "\${p2p:-}"
printf 'bootstrap=%s\\n' "\${bootstrap:-}"
printf 'blockProducer=%s\\n' "\${block_producer:-unknown}"
`,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  })
  const values = parseKeyValues(raw)
  const serviceName = values.unit?.replace(/\.service$/, '')
  if (!serviceName || !values.baseDir || !values.config) {
    throw new Error('LAN observer discovery did not return a service, basedir, and config.')
  }
  if (values.blockProducer === 'true') {
    throw new Error('LAN observer discovery found block production enabled; read-only GUI validation stopped.')
  }

  const network = values.network === 'testnet' ? 'testnet' : 'mainnet'
  return {
    serviceName,
    network,
    baseDir: values.baseDir,
    config: values.config,
    jsonrpcHostBind: coerceHostLoopbackBind(values.jsonrpc || '', network === 'testnet' ? '127.0.0.1:18122' : '127.0.0.1:18080'),
    backupAdminListen: coerceHostLoopbackBind(values.admin || '', network === 'testnet' ? '127.0.0.1:18188' : '127.0.0.1:18088'),
    p2pPublic: values.p2p || (network === 'testnet' ? '28890' : '18889'),
    publicBootstrapUrl: values.bootstrap || 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap'
  }
}

function createSshAliasWrapper(tempRoot: string, target: string): string {
  const wrapperDir = path.join(tempRoot, 'bin')
  mkdirSync(wrapperDir, { recursive: true })
  const wrapperPath = path.join(wrapperDir, 'ssh')
  writeFileSync(wrapperPath, `#!/bin/sh
if [ "$1" = "${LAN_CONNECTION_REF}" ]; then
  shift
  exec /usr/bin/ssh -qT -o BatchMode=yes -o ConnectTimeout=8 ${JSON.stringify(target)} "$@"
fi
exec /usr/bin/ssh "$@"
`)
  chmodSync(wrapperPath, 0o700)
  return wrapperDir
}

async function closeAppAndRemoveTemp(app: Awaited<ReturnType<typeof electron.launch>>, tempRoot: string) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app.close().catch(() => undefined)
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function completeFirstRunForTest(page: Page) {
  await page.evaluate(async ({ firstRunKey, languageKey }) => {
    await window.teleno?.app?.completeFirstRunSetup?.({ completedFrom: 'playwright-electron-lan-readonly' })
    window.localStorage.setItem(firstRunKey, 'complete')
    window.localStorage.setItem(languageKey, 'en')
  }, {
    firstRunKey: FIRST_RUN_SETUP_STORAGE_KEY,
    languageKey: LANGUAGE_STORAGE_KEY
  })
  await page.reload()
}

async function capture(page: Page, testInfo: { outputPath: (path: string) => string }, name: string, mask: Locator[] = []) {
  mkdirSync(STABLE_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: false, mask })
  await page.screenshot({ path: path.join(STABLE_SCREENSHOT_DIR, name), fullPage: false, mask })
}

test('validates LAN Server read-only diagnostics through real Electron IPC', async ({}, testInfo) => {
  const target = resolveLanTarget()
  const observer = discoverLanObserver(target)
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'teleno-electron-lan-readonly-'))
  const tempBaseDir = path.join(tempRoot, 'basedir')
  const wrapperDir = createSshAliasWrapper(tempRoot, target)
  const app = await electron.launch({
    cwd: repoRoot,
    args: [`--user-data-dir=${path.join(tempRoot, 'user-data')}`, repoRoot],
    env: {
      ...process.env,
      PATH: `${wrapperDir}${path.delimiter}${process.env.PATH || ''}`,
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
      () => page.evaluate(() => Boolean(window.teleno?.remoteNodes?.loadInventory && window.teleno?.remoteNodes?.executePlan)),
      { message: 'remoteNodes preload bridge is exposed' }
    ).toBe(true)

    const inventoryInput: RemoteFleetInventoryInput = {
      version: 1,
      nodes: [{
        id: 'lan-readonly-observer',
        label: 'LAN Read-only Observer',
        network: observer.network,
        role: 'observer',
        environment: observer.network === 'mainnet' ? 'prodnet' : 'testnet',
        hostRef: 'lan-server',
        connectionRef: LAN_CONNECTION_REF,
        runtime: {
          kind: 'systemd',
          image: 'local-systemd-readonly',
          expectedVersion: 'live-lan-readonly',
          serviceName: observer.serviceName
        },
        paths: {
          baseDir: observer.baseDir,
          config: observer.config
        },
        ports: {
          jsonrpcHostBind: observer.jsonrpcHostBind,
          p2pPublic: observer.p2pPublic,
          backupAdminListen: observer.backupAdminListen
        },
        backup: {
          publicBootstrapUrl: observer.publicBootstrapUrl,
          privateBackupPolicyRef: ''
        },
        producer: {
          enabled: false,
          profileRef: ''
        }
      }]
    }
    const saved = await page.evaluate((inventory) => window.teleno?.remoteNodes?.saveInventory(inventory), inventoryInput)
    expect(saved?.ok).toBe(true)
    const inventory: RemoteFleetInventory = normalizeRemoteFleetInventory(saved?.inventory as RemoteFleetInventoryInput)
    const lanNode = inventory.nodes.find((node) => node.id === 'lan-readonly-observer')
    expect(lanNode).toBeTruthy()

    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    const remotePanel = page.locator('#panel-remote')
    const sensitiveMasks = () => [
      remotePanel.locator('.remote-node-card-grid'),
      remotePanel.locator('.remote-human-summary dl'),
      remotePanel.locator('.settings-form input'),
      remotePanel.locator('.remote-command-list pre'),
      remotePanel.locator('.remote-output'),
      page.locator('footer')
    ]
    await expect(remotePanel.locator('.remote-node-card').filter({ hasText: 'LAN Read-only Observer' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Check health' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Show logs' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Restore backup and start observer' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Stop observer' })).toHaveCount(0)
    await expect(remotePanel.getByRole('button', { name: 'Restart observer' })).toHaveCount(0)
    await capture(page, testInfo, 'lan-remote-nodes-simple-readonly-real-ipc.png', sensitiveMasks())

    await remotePanel.getByLabel('Type the phrase').fill(remoteExecutionConfirmationPhrase(lanNode!, 'status'))
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeEnabled()
    await remotePanel.locator('.remote-execution-panel').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'lan-remote-nodes-confirmed-status-real-ipc.png', sensitiveMasks())
    await remotePanel.getByRole('button', { name: 'Execute confirmed plan' }).click()
    await expect(remotePanel.locator('.remote-output').first()).toContainText(/STEP 1|Remote health state|Observer health checks|Stop criteria detected/, { timeout: 60_000 })

    const receipts = await page.evaluate(() => window.teleno?.remoteNodes?.loadReceipts())
    expect(receipts?.ok).toBe(true)
    const lanReceipt = receipts?.receipts?.find((receipt) =>
      receipt &&
      typeof receipt === 'object' &&
      (receipt as { nodeId?: unknown }).nodeId === 'lan-readonly-observer'
    ) as { health?: { state?: string }, output?: string } | undefined
    expect(lanReceipt).toBeTruthy()
    expect(lanReceipt?.health?.state).not.toBe('needs-server')
    expect(lanReceipt?.output || '').not.toContain('Could not resolve hostname')
    await remotePanel.locator('.remote-receipt').filter({ hasText: 'lan-readonly-observer · status' }).scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'lan-remote-nodes-receipt-real-ipc.png', sensitiveMasks())

    await page.evaluate((settingsKey) => {
      const current = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Record<string, unknown>
      window.localStorage.setItem(settingsKey, JSON.stringify({
        ...current,
        nodeAdvancedMode: true
      }))
    }, SETTINGS_STORAGE_KEY)
    await page.reload()
    await page.getByRole('tab', { name: 'Remote' }).click()
    await remotePanel.getByRole('button', { name: 'Collect Logs Plan' }).click()
    await expect(remotePanel.locator('.remote-command-list')).toContainText(`ssh ${LAN_CONNECTION_REF}`)
    await expect(remotePanel.locator('.remote-command-list')).toContainText('journalctl')
    await remotePanel.locator('.remote-command-list').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'lan-remote-nodes-expert-diagnostics-real-ipc.png', sensitiveMasks())

    await remotePanel.getByRole('button', { name: 'Stop Node Plan' }).click()
    await remotePanel.getByLabel('Type the phrase').fill(remoteExecutionConfirmationPhrase(lanNode!, 'stop'))
    await expect(remotePanel.getByText('Prodnet execution is blocked except for read-only health and logs plans.')).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeDisabled()
    await remotePanel.locator('.remote-execution-panel').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'lan-remote-nodes-mutating-blocked-real-ipc.png', sensitiveMasks())
  } finally {
    await closeAppAndRemoveTemp(app, tempRoot)
  }
})
