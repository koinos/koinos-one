import { describe, expect, it } from 'vitest'

import {
  createRemoteFleetRolloutReceipt,
  createRemoteExecutionReceipt,
  parseRemoteHealthOutput,
  remoteFleetRolloutConfirmationPhrase,
  redactRemoteOutput,
  remoteExecutionConfirmationPhrase,
  validateRemoteFleetRolloutGate,
  validateRemoteExecutionGate
} from './remote-node-execution'
import {
  defaultRemoteFleetInventory,
  generateRemoteCommandPlan,
  generateRemoteFleetRolloutPlan,
  normalizeRemoteFleetInventory
} from './remote-nodes'

describe('remote node execution gates', () => {
  const trustedDigest = `sha256:${'a'.repeat(64)}`

  it('requires exact confirmation and allows only read-only prodnet diagnostics', () => {
    const inventory = defaultRemoteFleetInventory()
    const testnetNode = inventory.nodes.find((node) => node.id === 'testnet-observer-a')!
    const plan = generateRemoteCommandPlan(inventory, testnetNode.id, 'status')

    expect(validateRemoteExecutionGate(inventory, plan, '').codes).toContain('confirmation-required')
    expect(validateRemoteExecutionGate(inventory, plan, remoteExecutionConfirmationPhrase(testnetNode, 'status')).ok).toBe(true)

    const prodnetNode = inventory.nodes.find((node) => node.id === 'prodnet-observer-a')!
    const prodnetPlan = generateRemoteCommandPlan(inventory, prodnetNode.id, 'status')
    expect(validateRemoteExecutionGate(inventory, prodnetPlan, remoteExecutionConfirmationPhrase(prodnetNode, 'status')).ok)
      .toBe(true)

    const prodnetStopPlan = generateRemoteCommandPlan(inventory, prodnetNode.id, 'stop')
    expect(validateRemoteExecutionGate(inventory, prodnetStopPlan, remoteExecutionConfirmationPhrase(prodnetNode, 'stop')).codes)
      .toContain('prodnet-execution-blocked')

    const rollbackPlan = generateRemoteCommandPlan(inventory, testnetNode.id, 'rollback')
    expect(remoteExecutionConfirmationPhrase(testnetNode, 'rollback')).toBe('EXECUTE testnet-observer-a testnet rollback PRESERVE_DB')
    expect(validateRemoteExecutionGate(inventory, rollbackPlan, 'EXECUTE testnet-observer-a testnet rollback').codes)
      .toContain('confirmation-required')
    expect(validateRemoteExecutionGate(inventory, rollbackPlan, remoteExecutionConfirmationPhrase(testnetNode, 'rollback')).ok)
      .toBe(true)

    const prodnetRollbackPlan = generateRemoteCommandPlan(inventory, prodnetNode.id, 'rollback')
    expect(validateRemoteExecutionGate(inventory, prodnetRollbackPlan, remoteExecutionConfirmationPhrase(prodnetNode, 'rollback')).codes)
      .toContain('prodnet-execution-blocked')
  })

  it('blocks execution when generated commands still contain placeholders', () => {
    const inventory = defaultRemoteFleetInventory()
    const testnetNode = inventory.nodes.find((node) => node.id === 'testnet-observer-a')!
    const plan = {
      ...generateRemoteCommandPlan(inventory, testnetNode.id, 'status'),
      steps: [{
        phase: 'preflight' as const,
        command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho <public-p2p-port>\nTELENO_REMOTE",
        hostMutation: false,
        chainMutation: false,
        destructive: false
      }]
    }

    const gate = validateRemoteExecutionGate(inventory, plan, remoteExecutionConfirmationPhrase(testnetNode, 'status'))

    expect(gate.ok).toBe(false)
    expect(gate.codes).toContain('unresolved-placeholder')
  })

  it('allows the generated Docker install plan with loopback host bind and container-local listen', () => {
    const inventory = defaultRemoteFleetInventory()
    const testnetNode = inventory.nodes.find((node) => node.id === 'testnet-observer-a')!
    const plan = generateRemoteCommandPlan(inventory, testnetNode.id, 'install-observer')

    const gate = validateRemoteExecutionGate(
      inventory,
      plan,
      remoteExecutionConfirmationPhrase(testnetNode, 'install-observer')
    )

    expect(plan.steps.map((step) => step.command).join('\n')).toContain('listen: 0.0.0.0:18122')
    expect(gate.ok).toBe(true)
  })

  it('blocks Docker plans that expose JSON-RPC on every host interface', () => {
    const inventory = defaultRemoteFleetInventory()
    const testnetNode = inventory.nodes.find((node) => node.id === 'testnet-observer-a')!
    const plan = {
      ...generateRemoteCommandPlan(inventory, testnetNode.id, 'install-observer'),
      steps: [{
        phase: 'runtime' as const,
        command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\ndocker run -p 0.0.0.0:18122:18122 teleno\nTELENO_REMOTE",
        hostMutation: true,
        chainMutation: false,
        destructive: false
      }]
    }

    const gate = validateRemoteExecutionGate(
      inventory,
      plan,
      remoteExecutionConfirmationPhrase(testnetNode, 'install-observer')
    )

    expect(gate.ok).toBe(false)
    expect(gate.codes).toContain('unsafe-command')
  })

  it('redacts secrets and parses unsafe stop criteria', () => {
    const raw = 'token=abc token-file: /secret/admin.token password: hunter2 root@192.0.2.10 http://192.0.2.20:18080 ipv6=2001:db8::1 block_producer: true'
    const redacted = redactRemoteOutput(raw)
    const health = parseRemoteHealthOutput(raw, '2026-06-26T00:00:00.000Z')

    expect(redacted).toContain('token=<redacted>')
    expect(redacted).toContain('token-file: <redacted>')
    expect(redacted).toContain('password: <redacted>')
    expect(redacted).toContain('<ssh-target-redacted>')
    expect(redacted).toContain('<ip-redacted>:<port-redacted>')
    expect(redacted).not.toContain(':18080')
    expect(redacted).not.toContain('2a01:4f8')
    expect(redactRemoteOutput('System information as of 04:46:39 PM')).toContain('04:46:39 PM')
    expect(redactRemoteOutput('Linux private-host 6.8.0 /home/operator/koinos-one/node')).not.toContain('private-host')
    expect(redactRemoteOutput('Linux private-host 6.8.0 /home/operator/koinos-one/node')).not.toContain('/home/operator')
    expect(redactRemoteOutput('ssh: Could not resolve hostname private-vps')).not.toContain('private-vps')
    expect(redactRemoteOutput('planned port 28890 is already in use')).not.toContain('28890')
    expect(redactRemoteOutput('/ip4/203.0.113.10/tcp/18888')).not.toContain('/tcp/18888')
    expect(health.state).toBe('unsafe')
    expect(health.stopCriteria).toContain('producer-enabled')
  })

  it('parses recovery and exposure stop criteria without leaking raw targets', () => {
    const health = parseRemoteHealthOutput([
      'chain id mismatch',
      'digest mismatch',
      'state merkle mismatch',
      'TELENO_STOP_CRITERIA: public JSON-RPC/admin exposure',
      'operator@192.0.2.10'
    ].join('\n'))

    expect(health.state).toBe('unsafe')
    expect(health.stopCriteria).toEqual(expect.arrayContaining([
      'chain-id-mismatch',
      'digest-mismatch',
      'state-merkle-mismatch',
      'public-jsonrpc-exposure',
      'public-admin-exposure'
    ]))
    expect(health.summary).toContain('Stop criteria detected')
  })

  it('parses rollback and cleanup safety stop criteria', () => {
    const health = parseRemoteHealthOutput([
      'TELENO_STOP_CRITERIA: rollback evidence missing',
      'TELENO_STOP_CRITERIA: cleanup receipt evidence missing',
      'TELENO_STOP_CRITERIA: cleanup state unknown',
      'TELENO_STOP_CRITERIA: cleanup attempted protected path'
    ].join('\n'))

    expect(health.state).toBe('failed')
    expect(health.stopCriteria).toEqual(expect.arrayContaining([
      'rollback-evidence-missing',
      'cleanup-evidence-missing',
      'cleanup-state-unknown',
      'cleanup-protected-path'
    ]))
  })

  it('does not classify Docker container-local JSON-RPC listen as public exposure', () => {
    const health = parseRemoteHealthOutput([
      'TELENO_HEALTH_SECTION config',
      'network: testnet',
      'block_producer: false',
      'listen: 0.0.0.0:18122',
      'running'
    ].join('\n'))

    expect(health.stopCriteria).not.toContain('public-jsonrpc-exposure')
    expect(health.state).toBe('healthy')
  })

  it('creates sanitized execution receipts', () => {
    const inventory = defaultRemoteFleetInventory()
    const node = inventory.nodes.find((candidate) => candidate.id === 'testnet-observer-a')!
    const receipt = createRemoteExecutionReceipt({
      node,
      action: 'status',
      status: 'succeeded',
      planStepCount: 2,
      output: 'teleno_node ready\nblock_producer: false\npassword=abc'
    })

    expect(receipt.nodeId).toBe(node.id)
    expect(receipt.output).not.toContain('password=abc')
    expect(receipt.health.state).toBe('healthy')
  })

  it('requires fleet and per-node confirmation before sequential rollout execution', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        { id: 'testnet-a', label: 'Testnet A', network: 'testnet', connectionRef: 'ssh-testnet-a' },
        { id: 'testnet-b', label: 'Testnet B', network: 'testnet', connectionRef: 'ssh-testnet-b' }
      ]
    })
    const rollout = generateRemoteFleetRolloutPlan(inventory, ['testnet-a', 'testnet-b'], 'status')
    const fullConfirmation = [
      remoteFleetRolloutConfirmationPhrase(rollout),
      ...rollout.entries.map((entry) => entry.confirmationPhrase)
    ].join('\n')

    expect(validateRemoteFleetRolloutGate(inventory, rollout, '').codes).toContain('fleet-confirmation-required')
    expect(validateRemoteFleetRolloutGate(inventory, rollout, fullConfirmation).ok).toBe(true)
  })

  it('keeps prodnet fleet mutation blocked while allowing read-only rollout review', () => {
    const inventory = defaultRemoteFleetInventory()
    const statusRollout = generateRemoteFleetRolloutPlan(inventory, ['prodnet-observer-a', 'testnet-observer-a'], 'status')
    const installRollout = generateRemoteFleetRolloutPlan(inventory, ['prodnet-observer-a', 'testnet-observer-a'], 'install-observer')
    const statusConfirmation = [
      remoteFleetRolloutConfirmationPhrase(statusRollout),
      ...statusRollout.entries.map((entry) => entry.confirmationPhrase)
    ].join('\n')
    const installConfirmation = [
      remoteFleetRolloutConfirmationPhrase(installRollout),
      ...installRollout.entries.map((entry) => entry.confirmationPhrase)
    ].join('\n')

    expect(validateRemoteFleetRolloutGate(inventory, statusRollout, statusConfirmation).ok).toBe(true)
    expect(validateRemoteFleetRolloutGate(inventory, installRollout, installConfirmation).codes)
      .toContain('prodnet-execution-blocked')
  })

  it('allows trusted prodnet observer mutation only with proof, digest, policy, and observer-only confirmation', () => {
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
    const node = inventory.nodes[0]
    const plan = generateRemoteCommandPlan(inventory, node.id, 'install-observer')
    const confirmation = remoteExecutionConfirmationPhrase(node, 'install-observer')

    expect(plan.blocked).toBe(false)
    expect(confirmation).toContain('PROOF remote-proof-prodnet-trusted-a')
    expect(confirmation).toContain(`ARTIFACT ${trustedDigest}`)
    expect(confirmation).toContain('POLICY prodnet-public-bootstrap-v1')
    expect(confirmation).toContain('OBSERVER_ONLY')
    expect(validateRemoteExecutionGate(inventory, plan, confirmation).ok).toBe(true)
    expect(validateRemoteExecutionGate(inventory, plan, 'EXECUTE prodnet-trusted-a mainnet install-observer').codes)
      .toContain('confirmation-required')
  })

  it('blocks trusted prodnet observer mutation in fleet rollout gates', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        {
          id: 'prodnet-trusted-a',
          network: 'mainnet',
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
        },
        { id: 'testnet-a', network: 'testnet', connectionRef: 'ssh-testnet-a' }
      ]
    })
    const rollout = generateRemoteFleetRolloutPlan(inventory, ['prodnet-trusted-a', 'testnet-a'], 'install-observer')
    const confirmation = [
      remoteFleetRolloutConfirmationPhrase(rollout),
      ...rollout.entries.map((entry) => entry.confirmationPhrase)
    ].join('\n')

    expect(validateRemoteFleetRolloutGate(inventory, rollout, confirmation).codes)
      .toContain('prodnet-batch-mutation-blocked')
  })

  it('classifies prodnet dry-run proof receipts as healthy when no stop criteria are present', () => {
    const health = parseRemoteHealthOutput([
      'TELENO_PRODNET_PROOF_READY dry-run reviewed commands only',
      'observer-only'
    ].join('\n'))

    expect(health.state).toBe('healthy')
  })

  it('creates sanitized fleet rollout receipts with skipped nodes after failure', () => {
    const inventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        { id: 'testnet-a', label: 'Testnet A', network: 'testnet', connectionRef: 'ssh-testnet-a' },
        { id: 'testnet-b', label: 'Testnet B', network: 'testnet', connectionRef: 'ssh-testnet-b' }
      ]
    })
    const rollout = generateRemoteFleetRolloutPlan(inventory, ['testnet-a', 'testnet-b'], 'status')
    const nodeReceipt = createRemoteExecutionReceipt({
      node: inventory.nodes[0],
      action: 'status',
      status: 'failed',
      planStepCount: 2,
      output: 'root@192.0.2.10 token=abc state merkle mismatch'
    })

    const fleetReceipt = createRemoteFleetRolloutReceipt({
      rollout,
      nodeReceipts: [nodeReceipt],
      skippedNodeIds: ['testnet-b'],
      stopReason: 'root@192.0.2.10 token=abc',
      output: 'operator@192.0.2.20 password=hunter2'
    })

    expect(fleetReceipt.kind).toBe('fleet-rollout')
    expect(fleetReceipt.status).toBe('failed')
    expect(fleetReceipt.nodeResults.map((result) => result.status)).toEqual(['failed', 'skipped'])
    expect(fleetReceipt.stopReason).toContain('<ssh-target-redacted>')
    expect(fleetReceipt.stopReason).toContain('token=<redacted>')
    expect(fleetReceipt.output).not.toContain('192.0.2')
    expect(fleetReceipt.output).not.toContain('hunter2')
  })

  it('does not classify ordinary P2P peer connection warnings as node failure', () => {
    const health = parseRemoteHealthOutput([
      'running',
      'block_producer: false',
      '[p2p/transport] Failed to connect to peer: /ip4/192.0.2.10/tcp/8888 error=Bad address',
      '[p2p/transport] Failed to connect to peer: /ip4/192.0.2.11/tcp/8888 error=Connection reset by peer'
    ].join('\n'))

    expect(health.state).toBe('healthy')
  })

  it('classifies missing peers and missing head progress as degraded with actionable summaries', () => {
    const noPeers = parseRemoteHealthOutput([
      'running',
      'block_producer: false',
      'TELENO_HEALTH_SIGNAL no-peers',
      'peer_count=0'
    ].join('\n'))
    const noHead = parseRemoteHealthOutput([
      'running',
      'block_producer: false',
      'TELENO_HEALTH_SIGNAL no-head-progress'
    ].join('\n'))

    expect(noPeers.state).toBe('degraded')
    expect(noPeers.summary).toContain('no connected peers')
    expect(noHead.state).toBe('degraded')
    expect(noHead.summary).toContain('head did not advance')
  })
})
