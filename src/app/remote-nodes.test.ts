import { describe, expect, it } from 'vitest'

import {
  defaultRemoteFleetInventory,
  generateRemoteFleetCommandPlans,
  generateRemoteFleetRolloutPlan,
  generateRemoteCommandPlan,
  importRemoteProviderMetadata,
  normalizeRemoteFleetInventory,
  redactRemoteProviderMetadataInput,
  validateRemoteFleetInventory
} from './remote-nodes'

describe('remote node fleet planning', () => {
  const trustedDigest = `sha256:${'a'.repeat(64)}`

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

  it('generates observer-first install plans with prodnet trust gates', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'prodnet-observer-a', 'install-observer')

    expect(plan.blocked).toBe(true)
    expect(plan.notices.map((notice) => notice.code)).toContain('dryRunOnly')
    expect(plan.notices.map((notice) => notice.code)).toContain('prodnetConfirmationRequired')
    expect(plan.notices.map((notice) => notice.code)).toContain('prodnetArtifactTrustRequired')
    expect(plan.notices.map((notice) => notice.code)).toContain('prodnetDryRunProofRequired')
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

  it('marks rollback and cleanup as destructive DB-preserving testnet plans', () => {
    const inventory = defaultRemoteFleetInventory()
    const rollback = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'rollback')
    const cleanup = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'cleanup')
    const rollbackCommands = rollback.steps.map((step) => step.command).join('\n')
    const cleanupCommands = cleanup.steps.map((step) => step.command).join('\n')

    expect(rollback.notices.map((notice) => notice.code)).toContain('destructiveConfirmationRequired')
    expect(cleanup.notices.map((notice) => notice.code)).toContain('destructiveConfirmationRequired')
    expect(rollback.steps.some((step) => step.destructive)).toBe(true)
    expect(cleanup.steps.some((step) => step.destructive)).toBe(true)
    expect(rollback.steps.map((step) => step.phase)).toEqual(['preflight', 'preserve', 'runtime', 'config', 'artifact', 'verify', 'receipt'])
    expect(cleanup.steps.map((step) => step.phase)).toEqual(['preflight', 'preserve', 'cleanup', 'cleanup', 'verify', 'receipt'])
    expect(rollbackCommands).toContain('TELENO_ROLLBACK_EVIDENCE')
    expect(rollbackCommands).toContain('TELENO_DB_PRESERVED')
    expect(rollbackCommands).toContain('previous_image')
    expect(rollbackCommands).toContain('docker rm teleno-testnet-observer-a')
    expect(cleanupCommands).toContain('TELENO_CLEANUP_CANDIDATE')
    expect(cleanupCommands).toContain('TELENO_DB_PRESERVED')
    expect(cleanupCommands).toContain('cleanup receipt evidence missing')
    expect(cleanupCommands).toContain('rm -rf -- "$item"')
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

  it('builds an ordered fleet rollout review model from selected nodes', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        { id: 'testnet-a', label: 'Testnet A', network: 'testnet', connectionRef: 'ssh-testnet-a' },
        { id: 'testnet-b', label: 'Testnet B', network: 'testnet', connectionRef: 'ssh-testnet-b' }
      ]
    })

    const rollout = generateRemoteFleetRolloutPlan(inventory, ['testnet-b', 'testnet-a'], 'status')

    expect(rollout.nodeIds).toEqual(['testnet-b', 'testnet-a'])
    expect(rollout.entries.map((entry) => entry.status)).toEqual(['reviewing', 'reviewing'])
    expect(rollout.entries.every((entry) => entry.plan.action === 'status')).toBe(true)
    expect(rollout.entries.every((entry) => entry.stepCount > 0)).toBe(true)
    expect(rollout.entries[0].confirmationPhrase).toBe('EXECUTE testnet-b testnet status')
    expect(rollout.blocked).toBe(false)
    expect(rollout.stepCount).toBe(4)
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

  it('keeps rollback and cleanup DB-preserving and blocks prodnet mutation through plan shape', () => {
    const inventory = defaultRemoteFleetInventory()
    const prodnetRollback = generateRemoteCommandPlan(inventory, 'prodnet-observer-a', 'rollback')
    const prodnetCleanup = generateRemoteCommandPlan(inventory, 'prodnet-observer-a', 'cleanup')

    expect(prodnetRollback.notices.map((notice) => notice.code)).toContain('prodnetConfirmationRequired')
    expect(prodnetCleanup.notices.map((notice) => notice.code)).toContain('prodnetConfirmationRequired')

    const cleanup = generateRemoteCommandPlan(inventory, 'testnet-observer-a', 'cleanup')
    const cleanupCommands = cleanup.steps.map((step) => step.command).join('\n')
    expect(cleanupCommands).toContain('cleanup attempted protected path')
    expect(cleanupCommands).not.toMatch(/rm -rf -- .*chain/)
    expect(cleanupCommands).not.toMatch(/rm -rf -- .*state/)
    expect(cleanupCommands).not.toMatch(/rm -rf -- .*config\.yml/)
  })

  it('blocks prodnet observer mutation until artifact, bootstrap policy, and proof gates are present', () => {
    const inventory = defaultRemoteFleetInventory()
    const plan = generateRemoteCommandPlan(inventory, 'prodnet-observer-a', 'install-observer')

    expect(plan.blocked).toBe(true)
    expect(plan.notices.map((notice) => notice.code)).toEqual(expect.arrayContaining([
      'prodnetArtifactTrustRequired',
      'prodnetDryRunProofRequired'
    ]))
    expect(plan.steps.map((step) => step.phase)).toEqual(expect.arrayContaining(['proof', 'trust', 'bootstrap', 'preflight']))
    expect(plan.steps.map((step) => step.command).join('\n')).toContain('TELENO_PRODNET_PROOF_RECEIPT')
  })

  it('generates a prodnet dry-run proof and trusted observer install plan without blanket mutation blocking', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [{
        id: 'prodnet-trusted-a',
        label: 'Prodnet Trusted A',
        network: 'mainnet',
        role: 'observer',
        connectionRef: 'ssh-prodnet-trusted-a',
        runtime: {
          kind: 'docker',
          image: `ghcr.io/pgarciagon/teleno-node@${trustedDigest}`,
          expectedVersion: 'prodnet-reviewed-build',
          serviceName: ''
        },
        trust: {
          artifactDigest: trustedDigest,
          artifactSignatureRef: '',
          bootstrapPolicyId: 'prodnet-public-bootstrap-v1',
          bootstrapPolicyDigest: 'sha256:70726f646e65742d7075626c69632d626f6f7473747261702d76310000000000',
          prodnetObserverProofRef: 'remote-proof-prodnet-trusted-a'
        }
      }]
    })

    const proof = generateRemoteCommandPlan(inventory, 'prodnet-trusted-a', 'prodnet-observer-proof')
    const install = generateRemoteCommandPlan(inventory, 'prodnet-trusted-a', 'install-observer')
    const installCommands = install.steps.map((step) => step.command).join('\n')

    expect(proof.blocked).toBe(false)
    expect(proof.steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)).toBe(true)
    expect(proof.steps.map((step) => step.phase)).toEqual(['preflight', 'trust', 'bootstrap', 'proof', 'verify'])
    expect(install.blocked).toBe(false)
    expect(install.notices.map((notice) => notice.code)).toContain('prodnetConfirmationRequired')
    expect(installCommands).toContain(`TELENO_ARTIFACT_DIGEST_PINNED ${trustedDigest}`)
    expect(installCommands).toContain('TELENO_BOOTSTRAP_POLICY prodnet-public-bootstrap-v1')
    expect(installCommands).toContain('TELENO_PRODNET_OBSERVER_ONLY block_production_disabled')
    expect(installCommands).toContain('TELENO_STOP_CRITERIA: disk floor violation')
    expect(installCommands).toContain('block_producer: false')
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

  it('imports sanitized provider metadata as observer-only local inventory records', () => {
    const result = importRemoteProviderMetadata(JSON.stringify({
      provider: 'example-vps',
      instance: 'server-a',
      label: 'Imported Testnet Observer',
      region: 'eu-central',
      os: 'Ubuntu 24 LTS',
      cpu: '4 vCPU',
      ram: '16 GB',
      disk: '300 GB',
      state: 'running',
      publicAddress: 'redacted',
      privateAddress: 'absent',
      sshAlias: 'ssh-imported-testnet-observer'
    }), {
      network: 'testnet'
    })

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.instances[0]).toMatchObject({
      providerName: 'example-vps',
      instanceRef: 'server-a',
      publicAddress: 'present-redacted',
      privateAddress: 'absent',
      suggestedSshAlias: 'ssh-imported-testnet-observer'
    })
    expect(result.nodes[0]).toMatchObject({
      id: 'imported-testnet-observer',
      label: 'Imported Testnet Observer',
      network: 'testnet',
      role: 'observer',
      hostRef: 'provider-example-vps-server-a',
      connectionRef: 'ssh-imported-testnet-observer',
      producer: { enabled: false },
      safety: {
        observerFirstRequired: true,
        mainnetMutationAllowed: false,
        remoteAdminPublicExposureAllowed: false
      },
      paths: {
        baseDir: '~/koinos-one/nodes/testnet/imported-testnet-observer/basedir'
      }
    })
    expect(validateRemoteFleetInventory({ version: 1, nodes: result.nodes })).toEqual([])
  })

  it('redacts and blocks provider metadata containing raw infrastructure or secrets', () => {
    const unsafe = [
      'provider: example-vps',
      'instance: unsafe-a',
      'label: Unsafe Import',
      'publicIp: 192.0.2.10',
      'hostname: node.example.invalid',
      'sshUser: root',
      'apiToken=abc123',
      'path: /home/operator/.ssh/id_ed25519'
    ].join('\n')
    const result = importRemoteProviderMetadata(unsafe, { network: 'testnet' })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'secret-blocked',
      'raw-address-blocked',
      'raw-host-blocked',
      'user-reference-blocked',
      'private-path-blocked'
    ]))
    expect(result.redactedPreview).not.toContain('192.0.2.10')
    expect(result.redactedPreview).not.toContain('node.example.invalid')
    expect(result.redactedPreview).not.toContain('abc123')
    expect(result.redactedPreview).not.toContain('/home/operator')
    expect(redactRemoteProviderMetadataInput(unsafe)).toContain('[redacted-secret]')
  })

  it('blocks duplicate provider instances while generating unique safe node ids', () => {
    const existing = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [{
        id: 'existing-import',
        network: 'testnet',
        hostRef: 'provider-example-vps-server-a',
        connectionRef: 'ssh-existing-import'
      }]
    })
    const result = importRemoteProviderMetadata([
      'provider: example-vps',
      'instance: server-a',
      'label: Existing Import',
      'sshAlias: ssh-import-a'
    ].join('\n'), {
      network: 'testnet',
      existingInventory: existing
    })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate-instance')
    expect(result.nodes[0].id).toBe('existing-import-2')
    expect(result.nodes[0].hostRef).toBe('provider-example-vps-server-a')
  })
})
