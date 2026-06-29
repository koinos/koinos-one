import { describe, expect, it } from 'vitest'

import {
  defaultRemoteFleetInventory,
  generateRemoteFleetCommandPlans,
  generateRemoteCommandPlan,
  normalizeRemoteFleetInventory,
  validateRemoteFleetInventory
} from './remote-nodes'

describe('remote node fleet planning', () => {
  it('normalizes a sanitized observer inventory with public bootstrap defaults', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [{
        id: 'observer-a',
        label: 'Observer A',
        network: 'mainnet',
        role: 'observer',
        environment: 'prodnet',
        hostRef: 'host-observer-a',
        connectionRef: 'ssh-observer-a',
        paths: {
          baseDir: '<remote-basedir>',
          config: '<remote-basedir>/config.yml'
        }
      }]
    })

    expect(inventory.nodes).toHaveLength(1)
    expect(inventory.nodes[0].producer.enabled).toBe(false)
    expect(inventory.nodes[0].safety.observerFirstRequired).toBe(true)
    expect(inventory.nodes[0].backup.publicBootstrapUrl).toContain('teleno-bootstrap')
    expect(validateRemoteFleetInventory(inventory)).toEqual([])
  })

  it('uses a safe human default basedir for remote observers', () => {
    const inventory = defaultRemoteFleetInventory()

    expect(inventory.nodes.find((node) => node.id === 'testnet-observer-a')?.paths.baseDir)
      .toBe('~/koinos-one/nodes/testnet/testnet-observer-a/basedir')
    expect(inventory.nodes.find((node) => node.id === 'prodnet-observer-a')?.paths.baseDir)
      .toBe('~/koinos-one/nodes/mainnet/prodnet-observer-a/basedir')
  })

  it('generates observer-first install plans without remote execution hooks', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'prodnet-observer-a', 'install-observer')

    expect(plan.blocked).toBe(false)
    expect(plan.notices.map((notice) => notice.code)).toContain('dryRunOnly')
    expect(plan.notices.map((notice) => notice.code)).toContain('prodnetConfirmationRequired')
    expect(plan.steps.some((step) => step.command.includes('--backup-public-restore'))).toBe(true)
    expect(plan.steps.some((step) => step.command.includes('docker run --rm'))).toBe(true)
    expect(plan.steps.some((step) => step.command.includes('TELENO_ARTIFACT_IMAGE'))).toBe(true)
    expect(plan.steps.some((step) => step.command.includes('expected=%s'))).toBe(true)
    expect(plan.steps.some((step) => step.command.includes("'unspecified'"))).toBe(true)
    expect(plan.steps.map((step) => step.command).join('\n')).not.toContain('<teleno_node-version-or-commit>')
    expect(plan.steps.some((step) => step.command.includes('block_producer: false'))).toBe(true)
    expect(plan.steps.every((step) => !step.chainMutation)).toBe(true)
  })

  it('generates the proven testnet Docker port mapping without invalid shell flags', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'install-observer')
    const commands = plan.steps.map((step) => step.command).join('\n')

    expect(commands).toContain('-p 127.0.0.1:18122:18122')
    expect(commands).toContain('-p 28890:18888')
    expect(commands).toContain('listen: 0.0.0.0:18122')
    expect(commands).toContain('chain:')
    expect(commands).toContain('verify-blocks: true')
    expect(commands).toContain('p2p:')
    expect(commands).toContain('listen: /ip4/0.0.0.0/tcp/18888')
    expect(commands).toContain('/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/')
    expect(commands).toContain('"$HOME/koinos-one/nodes/testnet/testnet-observer-a/basedir"')
    expect(commands).toContain('TELENO_STOP_CRITERIA: disposable BASEDIR already exists')
    expect(commands).toContain('TELENO_STOP_CRITERIA: container already exists')
    expect(commands).toContain('TELENO_STOP_CRITERIA: planned port 18122 is already in use')
    expect(commands).toContain('TELENO_STOP_CRITERIA: disk floor violation')
    expect(commands).not.toContain('pipefail')
  })

  it('blocks raw host targets, public RPC bindings, and producer activation', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        {
          id: 'mainnet-a',
          network: 'mainnet',
          role: 'producer',
          hostRef: 'root@192.0.2.10',
          connectionRef: 'root@192.0.2.10',
          ports: {
            jsonrpcHostBind: '0.0.0.0:18080',
            p2pPublic: '18888',
            backupAdminListen: '0.0.0.0:18088'
          },
          producer: {
            enabled: true,
            profileRef: 'producer-profile-a'
          }
        },
        {
          id: 'mainnet-b',
          network: 'mainnet',
          hostRef: 'host-mainnet-b',
          connectionRef: 'ssh-mainnet-b',
          ports: {
            jsonrpcHostBind: '127.0.0.1:18080',
            p2pPublic: '18888',
            backupAdminListen: '127.0.0.1:18088'
          }
        }
      ]
    })

    const codes = validateRemoteFleetInventory(inventory).map((notice) => notice.code)
    expect(codes).toContain('producerUnavailable')
    expect(codes).toContain('rawHostRefBlocked')
    expect(codes).toContain('jsonrpcPublicBlocked')
    expect(codes).toContain('publicAdminBlocked')

    const plan = generateRemoteCommandPlan(inventory, 'mainnet-a', 'install-observer')
    expect(plan.blocked).toBe(true)
  })

  it('scopes duplicate BASEDIR and port blockers to the same SSH alias', () => {
    const crossHostInventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        {
          id: 'testnet-a',
          network: 'testnet',
          connectionRef: 'ssh-testnet-a',
          paths: { baseDir: '~/koinos-one/nodes/testnet/shared/basedir' },
          ports: {
            jsonrpcHostBind: '127.0.0.1:18122',
            p2pPublic: '28890',
            backupAdminListen: '127.0.0.1:18188'
          }
        },
        {
          id: 'testnet-b',
          network: 'testnet',
          connectionRef: 'ssh-testnet-b',
          paths: { baseDir: '~/koinos-one/nodes/testnet/shared/basedir' },
          ports: {
            jsonrpcHostBind: '127.0.0.1:18122',
            p2pPublic: '28890',
            backupAdminListen: '127.0.0.1:18188'
          }
        }
      ]
    })

    expect(validateRemoteFleetInventory(crossHostInventory).map((notice) => notice.code)).not.toContain('duplicatePort')
    expect(validateRemoteFleetInventory(crossHostInventory).map((notice) => notice.code)).not.toContain('duplicateBaseDir')

    const sameHostInventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: crossHostInventory.nodes.map((node) => ({
        ...node,
        connectionRef: 'ssh-shared-test-host'
      }))
    })

    const sameHostCodes = validateRemoteFleetInventory(sameHostInventory).map((notice) => notice.code)
    expect(sameHostCodes).toContain('duplicatePort')
    expect(sameHostCodes).toContain('duplicateBaseDir')
  })

  it('marks rollback and cleanup as destructive dry-run plans', () => {
    const inventory = defaultRemoteFleetInventory()
    const rollback = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'rollback')
    const cleanup = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'cleanup')

    expect(rollback.notices.map((notice) => notice.code)).toContain('destructiveConfirmationRequired')
    expect(cleanup.notices.map((notice) => notice.code)).toContain('destructiveConfirmationRequired')
    expect(rollback.steps.some((step) => step.destructive)).toBe(true)
    expect(cleanup.steps.some((step) => step.destructive)).toBe(true)
  })

  it('reconciles observer-safe config before starting an existing restored node', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'start-observer')
    const commands = plan.steps.map((step) => step.command).join('\n')

    expect(commands).toContain('block_producer: false')
    expect(commands).toContain('listen: /ip4/0.0.0.0/tcp/18888')
    expect(commands).toContain('/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/')
    expect(commands).toContain('-p 127.0.0.1:18122:18122')
    expect(plan.steps.some((step) => step.phase === 'config' && step.hostMutation)).toBe(true)
  })

  it('expands multi-node actions into per-node command plans', () => {
    const inventory = defaultRemoteFleetInventory()
    const plans = generateRemoteFleetCommandPlans(inventory, [], 'status')

    expect(plans.map((plan) => plan.nodeId)).toEqual(['prodnet-observer-a', 'testnet-observer-a'])
    expect(plans.every((plan) => plan.action === 'status')).toBe(true)
    expect(plans.every((plan) => plan.steps.length > 0)).toBe(true)
  })

  it('generates read-only health checks with unsafe exposure and stop-criteria probes', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'status')
    const commands = plan.steps.map((step) => step.command).join('\n')

    expect(commands).toContain('TELENO_HEALTH_SECTION host')
    expect(commands).toContain('chain.get_head_info')
    expect(commands).toContain('TELENO_STOP_CRITERIA')
    expect(commands).toContain('TELENO_HEALTH_SIGNAL no-seed-peers')
    expect(commands).toContain('TELENO_HEALTH_SIGNAL no-head-progress')
    expect(commands).toContain('TELENO_HEALTH_SIGNAL no-peers')
    expect(commands).toContain('block_producer')
    expect(plan.steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)).toBe(true)
  })

  it('keeps rollback and cleanup review-only without stop, remove, or delete commands', () => {
    const inventory = defaultRemoteFleetInventory()

    for (const action of ['rollback', 'cleanup'] as const) {
      const plan = generateRemoteCommandPlan(inventory, 'testnet-observer-a', action)
      const commands = plan.steps.map((step) => step.command).join('\n')

      expect(plan.steps.some((step) => step.destructive)).toBe(true)
      expect(commands).toContain('review-only')
      expect(commands).not.toMatch(/\bdocker\s+(stop|rm)\b/)
      expect(commands).not.toMatch(/\bsystemctl\s+stop\b/)
      expect(commands).not.toContain('rm -rf')
    }
  })

  it('keeps health and logs plans read-only with no runtime mutation commands', () => {
    const inventory = defaultRemoteFleetInventory()

    for (const action of ['status', 'logs'] as const) {
      const plan = generateRemoteCommandPlan(inventory, 'testnet-observer-a', action)
      const commands = plan.steps.map((step) => step.command).join('\n')

      expect(plan.steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)).toBe(true)
      expect(commands).not.toMatch(/\bdocker\s+(run|start|stop|restart|rm)\b/)
      expect(commands).not.toMatch(/\bsystemctl\s+(start|stop|restart)\b/)
      expect(commands).not.toContain('--backup-public-restore')
      expect(commands).not.toContain('rm -rf')
      if (action === 'logs') {
        expect(commands).toContain('[redacted]')
        expect(commands).not.toContain('<redacted>')
        expect(commands).not.toMatch(/<[^>\n]+>/)
      }
    }
  })
})
