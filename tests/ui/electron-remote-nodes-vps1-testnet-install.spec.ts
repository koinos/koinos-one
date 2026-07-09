import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  generateRemoteCommandPlan,
  normalizeRemoteFleetInventory,
  type RemoteFleetInventory,
  type RemoteFleetInventoryInput
} from '../../src/app/remote-nodes'
import { remoteExecutionConfirmationPhrase } from '../../src/app/remote-node-execution'
import { publicBootstrapUrlForNetwork } from '../../src/app/public-bootstrap'

const repoRoot = process.cwd()
const FIRST_RUN_SETUP_STORAGE_KEY = 'teleno.first-run-setup.completed.v1'
const LANGUAGE_STORAGE_KEY = 'teleno.ui.language.v1'
const SETTINGS_STORAGE_KEY = 'teleno.explorer.settings.v1'
const STABLE_SCREENSHOT_DIR = path.join(repoRoot, '.run', 'remote-node-ui-screenshots')
const VPS1_CONNECTION_REF = 'vps1-testnet-gui-e2e'
const DEFAULT_TESTNET_NODE_ID = 'testnet-observer-gui-e2e'

function optionalSafeEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value || null
}

function testnetNodeId(): string {
  const value = optionalSafeEnv('TELENO_VPS1_TESTNET_NODE_ID') || DEFAULT_TESTNET_NODE_ID
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(value)) {
    throw new Error('TELENO_VPS1_TESTNET_NODE_ID must be a sanitized lowercase alias.')
  }
  return value
}

function testnetBaseDir(): string {
  const nodeId = testnetNodeId()
  const value = optionalSafeEnv('TELENO_VPS1_TESTNET_BASEDIR') || `~/koinos-one/nodes/testnet/${nodeId}/basedir`
  if (value !== `~/koinos-one/nodes/testnet/${nodeId}/basedir`) {
    throw new Error('TELENO_VPS1_TESTNET_BASEDIR must match ~/koinos-one/nodes/testnet/<node-id>/basedir.')
  }
  return value
}

function testnetContainerName(): string {
  return `teleno-${testnetNodeId()}`
}

test.skip(
  process.env.TELENO_PLAYWRIGHT_ELECTRON !== '1' || process.env.TELENO_REMOTE_VPS1_TESTNET_INSTALL_E2E !== '1',
  'Run with TELENO_PLAYWRIGHT_ELECTRON=1 TELENO_REMOTE_VPS1_TESTNET_INSTALL_E2E=1 and local VPS1 port env.'
)
test.setTimeout(60 * 60 * 1000)

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required local-only env: ${name}`)
  return value
}

function requiredLoopbackBindEnv(name: string): string {
  const value = requiredEnv(name)
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(value)) {
    throw new Error(`${name} must be a loopback bind in the form 127.0.0.1:<port>.`)
  }
  return value
}

function requiredPortEnv(name: string): string {
  const value = requiredEnv(name)
  if (!/^\d{2,5}$/.test(value)) throw new Error(`${name} must be a local-only numeric port.`)
  return value
}

function portFromBind(bind: string): string {
  const port = bind.match(/:(\d+)$/)?.[1] || ''
  if (!port) throw new Error('Loopback bind is missing a port.')
  return port
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
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

function resolveVps1Target(): string {
  if (process.env.TELENO_VPS1_SSH_TARGET?.trim()) return process.env.TELENO_VPS1_SSH_TARGET.trim()

  const inventoryPath = path.join(repoRoot, 'docs', 'operations', 'CONFIRMED_SSH_HOSTS.md')
  if (!existsSync(inventoryPath)) throw new Error('Local VPS1 SSH inventory is unavailable.')
  const inventory = readFileSync(inventoryPath, 'utf8')
  for (const line of inventory.split('\n')) {
    if (!/VPS1/i.test(line)) continue
    const columns = line.split('|').map((column) => column.replace(/`/g, '').trim())
    for (let index = 0; index < columns.length; index += 1) {
      const host = columns[index]
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(host)) continue
      const nextUser = columns[index + 1]
      const previousUser = columns[index - 1]
      const user = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(nextUser || '') ? nextUser : previousUser
      if (user && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(user)) return `${user}@${host}`
    }
  }
  throw new Error('VPS1 SSH target was not found in local inventory.')
}

function sshReadOnly(target: string, script: string, timeout = 30_000): string {
  return execFileSync('/usr/bin/ssh', [
    '-qT',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    target,
    'bash',
    '-s'
  ], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout
  })
}

function readOnlyPreflight(target: string, rpcPort: string, p2pPort: string, adminPort: string): Record<string, string> {
  const nodeId = testnetNodeId()
  const container = testnetContainerName()
  const raw = sshReadOnly(target, `
set -eu
basedir="$HOME/koinos-one/nodes/testnet/${nodeId}/basedir"
container=${shQuote(container)}
rpc_port=${shQuote(rpcPort)}
p2p_port=${shQuote(p2pPort)}
admin_port=${shQuote(adminPort)}
status_for_path() { if [ -e "$1" ]; then echo present; else echo absent; fi; }
port_state() {
  p="$1"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(:|\\\\])\${p}$" >/dev/null; then echo used; else echo free; fi
}
container_state() {
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Fx "$1" >/dev/null; then docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo present; else echo absent; fi
}
printf 'target=resolved\\n'
printf 'docker=%s\\n' "$(docker --version >/dev/null 2>&1 && echo available || echo missing)"
printf 'systemd=%s\\n' "$(systemctl --version >/dev/null 2>&1 && echo available || echo missing)"
printf 'diskHomeAvailKb=%s\\n' "$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
printf 'basedir=%s\\n' "$(status_for_path "$basedir")"
printf 'config=%s\\n' "$(test -f "$basedir/config.yml" && echo present || echo absent)"
printf 'restoredMarker=%s\\n' "$(test -e "$basedir/.backup-just-restored" && echo present || echo absent)"
printf 'chainDir=%s\\n' "$(test -e "$basedir/chain" && echo present || echo absent)"
printf 'container=%s\\n' "$(container_state "$container")"
printf 'rpcPort=%s\\n' "$(port_state "$rpc_port")"
printf 'p2pPort=%s\\n' "$(port_state "$p2p_port")"
printf 'adminPort=%s\\n' "$(port_state "$admin_port")"
`)
  return parseKeyValues(raw)
}

function verifyVps1Observer(target: string, rpcPort: string, adminPort: string): Record<string, string> {
  const nodeId = testnetNodeId()
  const container = testnetContainerName()
  const raw = sshReadOnly(target, `
set -eu
basedir="$HOME/koinos-one/nodes/testnet/${nodeId}/basedir"
container=${shQuote(container)}
rpc_port=${shQuote(rpcPort)}
admin_port=${shQuote(adminPort)}
config="$basedir/config.yml"
height_from_rpc() {
  curl --fail --silent --max-time 5 \\
    -H 'content-type: application/json' \\
    -d '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}' \\
    "http://127.0.0.1:$rpc_port" |
    tr -d '\\n' |
    sed -n 's/.*"height"[": ]*\\([0-9][0-9]*\\).*/\\1/p; s/.*"height":"\\([0-9][0-9]*\\)".*/\\1/p'
}
public_state() {
  p="$1"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(^|[^0-9])0\\.0\\.0\\.0:\${p}$" >/dev/null; then echo unsafe; else echo safe; fi
}
running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)
network=$(awk '/^network:/ {print $2; exit}' "$config" 2>/dev/null || true)
producer=$(awk '/block_producer:/ {print $2; exit}' "$config" 2>/dev/null || true)
bootstrap=$(awk '/base-url:/ {print $2; exit}' "$config" 2>/dev/null || true)
height_one=$(height_from_rpc || true)
sleep 20
height_two=$(height_from_rpc || true)
if [ -n "$height_one" ] && [ -n "$height_two" ] && [ "$height_one" != "$height_two" ]; then
  head_signal=advanced
elif [ -n "$height_two" ]; then
  head_signal=responded
else
  head_signal=missing
fi
if docker logs --tail 200 "$container" 2>&1 | grep -E -i 'state merkle mismatch|previous state merkle mismatch|digest mismatch|restore failed|chain[_ -]?id mismatch|block_producer: true' >/dev/null; then
  stop_criteria=present
else
  stop_criteria=absent
fi
printf 'containerRunning=%s\\n' "$running"
printf 'configNetwork=%s\\n' "\${network:-missing}"
printf 'blockProducer=%s\\n' "\${producer:-missing}"
printf 'bootstrapSource=%s\\n' "$(case "$bootstrap" in http*) echo public ;; *) echo missing ;; esac)"
printf 'headSignal=%s\\n' "$head_signal"
printf 'rpcExposure=%s\\n' "$(public_state "$rpc_port")"
printf 'adminExposure=%s\\n' "$(public_state "$admin_port")"
printf 'stopCriteria=%s\\n' "$stop_criteria"
`, 60_000)
  return parseKeyValues(raw)
}

function createSshAliasWrapper(tempRoot: string, target: string): string {
  const wrapperDir = path.join(tempRoot, 'bin')
  mkdirSync(wrapperDir, { recursive: true })
  const wrapperPath = path.join(wrapperDir, 'ssh')
  writeFileSync(wrapperPath, `#!/bin/sh
if [ "$1" = "${VPS1_CONNECTION_REF}" ]; then
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
    await window.teleno?.app?.completeFirstRunSetup?.({ completedFrom: 'playwright-electron-vps1-testnet-install' })
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

test('executes VPS1 testnet observer install restore start through real Electron IPC', async ({}, testInfo) => {
  const testnetNodeIdValue = testnetNodeId()
  const testnetBaseDirValue = testnetBaseDir()
  const rpcBind = requiredLoopbackBindEnv('TELENO_VPS1_TESTNET_JSONRPC_BIND')
  const p2pPort = requiredPortEnv('TELENO_VPS1_TESTNET_P2P_PORT')
  const adminBind = requiredLoopbackBindEnv('TELENO_VPS1_TESTNET_ADMIN_BIND')
  const rpcPort = portFromBind(rpcBind)
  const adminPort = portFromBind(adminBind)
  const target = resolveVps1Target()
  const preflight = readOnlyPreflight(target, rpcPort, p2pPort, adminPort)

  expect(preflight.docker).toBe('available')
  expect(preflight.systemd).toBe('available')
  expect(Number(preflight.diskHomeAvailKb || '0')).toBeGreaterThan(20 * 1024 * 1024)
  const containerAbsent = preflight.container === 'absent'
  const containerRunning = preflight.container === 'running'
  const cleanInstall = preflight.basedir === 'absent'
  const resumeStart = (
    preflight.basedir === 'present' &&
    preflight.config === 'present' &&
    preflight.restoredMarker === 'present' &&
    preflight.chainDir === 'present' &&
    containerAbsent
  )
  const alreadyRunning = (
    preflight.basedir === 'present' &&
    preflight.config === 'present' &&
    preflight.chainDir === 'present' &&
    containerRunning
  )
  if (containerAbsent) {
    expect(preflight.rpcPort).toBe('free')
    expect(preflight.p2pPort).toBe('free')
    expect(preflight.adminPort).toBe('free')
  }
  expect(cleanInstall || resumeStart || alreadyRunning).toBe(true)
  const reconcileRestart = alreadyRunning && process.env.TELENO_VPS1_TESTNET_RECONCILE_RESTART === '1'
  const liveAction = cleanInstall ? 'install-observer' : resumeStart ? 'start-observer' : reconcileRestart ? 'restart' : 'status'
  const actionSlug = cleanInstall ? 'install' : resumeStart ? 'start' : reconcileRestart ? 'restart' : 'status'

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'teleno-electron-vps1-testnet-'))
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
        id: testnetNodeIdValue,
        label: 'VPS1 Testnet GUI E2E Observer',
        network: 'testnet',
        role: 'observer',
        environment: 'testnet',
        hostRef: 'vps1-testnet',
        connectionRef: VPS1_CONNECTION_REF,
        runtime: {
          kind: 'docker',
          image: 'ghcr.io/koinos/teleno-node:beta',
          expectedVersion: 'live-vps1-testnet-e2e',
          serviceName: ''
        },
        paths: {
          baseDir: testnetBaseDirValue,
          config: `${testnetBaseDirValue}/config.yml`
        },
        ports: {
          jsonrpcHostBind: rpcBind,
          p2pPublic: p2pPort,
          backupAdminListen: adminBind
        },
        backup: {
          publicBootstrapUrl: publicBootstrapUrlForNetwork('testnet'),
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
    const vps1Node = inventory.nodes.find((node) => node.id === testnetNodeIdValue)
    expect(vps1Node).toBeTruthy()
    const reviewedPlan = generateRemoteCommandPlan(inventory, testnetNodeIdValue, liveAction)
    const reviewedCommands = reviewedPlan.steps.map((step) => step.command).join('\n')
    expect(reviewedPlan.blocked).toBe(false)
    expect(reviewedCommands).toContain('block_producer: false')
    if (liveAction !== 'status') expect(reviewedCommands).toContain(`-p ${rpcBind}:${rpcPort}`)
    if (cleanInstall) {
      expect(reviewedCommands).toContain('--backup-public-restore')
    } else if (resumeStart) {
      expect(reviewedCommands).not.toContain('--backup-public-restore')
    } else if (reconcileRestart) {
      expect(reviewedCommands).toContain('peer:')
      expect(reviewedCommands).toContain('docker stop')
    } else {
      expect(reviewedCommands).toContain('chain.get_head_info')
    }

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
    await expect(remotePanel.locator('.remote-node-card').filter({ hasText: 'VPS1 Testnet GUI E2E Observer' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: 'Restore backup and start observer' })).toBeVisible()
    await expect(remotePanel.getByRole('button', { name: /producer/i })).toHaveCount(0)
    await capture(page, testInfo, 'vps1-remote-nodes-simple-testnet-install-real-ipc.png', sensitiveMasks())

    if (cleanInstall) {
      await remotePanel.getByRole('button', { name: 'Restore backup and start observer' }).click()
    } else if (resumeStart) {
      await page.evaluate((settingsKey) => {
        const current = JSON.parse(window.localStorage.getItem(settingsKey) || '{}') as Record<string, unknown>
        window.localStorage.setItem(settingsKey, JSON.stringify({
          ...current,
          nodeAdvancedMode: true
        }))
      }, SETTINGS_STORAGE_KEY)
      await page.reload()
      await page.getByRole('tab', { name: 'Remote' }).click()
      await remotePanel.getByRole('button', { name: 'Start Observer Plan' }).click()
    } else if (reconcileRestart) {
      await remotePanel.getByRole('button', { name: 'Restart observer' }).click()
    } else {
      await remotePanel.getByRole('button', { name: 'Check health' }).click()
    }
    await expect(remotePanel.locator('.remote-plan-summary').getByText('VPS1 Testnet GUI E2E Observer')).toBeVisible()
    await remotePanel.getByLabel('Type the phrase').fill(remoteExecutionConfirmationPhrase(vps1Node!, liveAction))
    await expect(remotePanel.getByRole('button', { name: 'Execute confirmed plan' })).toBeEnabled()
    await remotePanel.locator('.remote-execution-panel').scrollIntoViewIfNeeded()
    await capture(page, testInfo, `vps1-remote-nodes-confirmed-${actionSlug}-real-ipc.png`, sensitiveMasks())

    await remotePanel.getByRole('button', { name: 'Execute confirmed plan' }).click()
    await expect(remotePanel.locator('.remote-output').first()).toContainText(/Executing remote plan|Remote command plan is running/, { timeout: 10_000 })
    await capture(page, testInfo, `vps1-remote-nodes-${actionSlug}-progress-real-ipc.png`, sensitiveMasks())

    await expect(
      remotePanel.locator('.remote-receipt').filter({ hasText: `${testnetNodeIdValue} · ${liveAction}` })
    ).toBeVisible({ timeout: 55 * 60 * 1000 })
    const receipts = await page.evaluate(() => window.teleno?.remoteNodes?.loadReceipts())
    expect(receipts?.ok).toBe(true)
    const receipt = receipts?.receipts?.find((candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      (candidate as { nodeId?: unknown; action?: unknown }).nodeId === testnetNodeIdValue &&
      (candidate as { nodeId?: unknown; action?: unknown }).action === liveAction
    ) as { status?: string; health?: { state?: string; stopCriteria?: string[] }; output?: string } | undefined
    expect(receipt?.status).toBe('succeeded')
    expect(receipt?.health?.stopCriteria || []).toEqual([])
    expect(receipt?.output || '').not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}/)
    writeFileSync(
      path.join(STABLE_SCREENSHOT_DIR, `vps1-${testnetNodeIdValue}-${actionSlug}-sanitized-receipt.json`),
      JSON.stringify({
        nodeId: testnetNodeIdValue,
        network: 'testnet',
        action: liveAction,
        status: receipt?.status,
        health: receipt?.health,
        planStepCount: (receipt as { planStepCount?: unknown } | undefined)?.planStepCount ?? null,
        output: receipt?.output || ''
      }, null, 2) + '\n'
    )
    await remotePanel.locator('.remote-receipt').filter({ hasText: `${testnetNodeIdValue} · ${liveAction}` }).scrollIntoViewIfNeeded()
    await capture(page, testInfo, `vps1-remote-nodes-${actionSlug}-receipt-real-ipc.png`, sensitiveMasks())

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
    await remotePanel.getByRole('button', { name: 'Collect Logs Plan' }).click()
    await expect(remotePanel.locator('.remote-command-list')).toContainText(`ssh ${VPS1_CONNECTION_REF}`)
    await remotePanel.locator('.remote-command-list').scrollIntoViewIfNeeded()
    await capture(page, testInfo, 'vps1-remote-nodes-expert-diagnostics-real-ipc.png', sensitiveMasks())
  } finally {
    await closeAppAndRemoveTemp(app, tempRoot)
  }

  const verified = verifyVps1Observer(target, rpcPort, adminPort)
  expect(verified.containerRunning).toBe('true')
  expect(verified.configNetwork).toBe('testnet')
  expect(verified.blockProducer).toBe('false')
  expect(verified.bootstrapSource).toBe('public')
  expect(['advanced', 'responded']).toContain(verified.headSignal)
  expect(verified.rpcExposure).toBe('safe')
  expect(verified.adminExposure).toBe('safe')
  expect(verified.stopCriteria).toBe('absent')
})
