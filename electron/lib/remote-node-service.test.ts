import { describe, expect, it, vi } from 'vitest'

import {
  createRemoteNodeExecutionService,
  redactRemoteExecutionOutput,
  remoteExecutionConfirmationPhrase,
  type RemoteExecutionProgressEvent
} from './remote-node-service'

function request(overrides: Record<string, unknown> = {}) {
  const node = {
    id: 'testnet-observer-a',
    network: 'testnet',
    role: 'observer',
    connectionRef: 'ssh-testnet-observer-a',
    producer: { enabled: false }
  }
  const plan = {
    nodeId: 'testnet-observer-a',
    action: 'status' as const,
    blocked: false,
    steps: [{
      phase: 'preflight',
      command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho healthy\nTELENO_REMOTE",
      hostMutation: false,
      chainMutation: false,
      destructive: false
    }]
  }
  return {
    node,
    plan,
    confirmation: remoteExecutionConfirmationPhrase(node, plan.action),
    ...overrides
  }
}

describe('remote node execution service', () => {
  it('allows confirmed prodnet read-only diagnostics through the injected runner', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'running\nblock_producer: false' }))
    const service = createRemoteNodeExecutionService({ runner })
    const node = {
      id: 'prodnet-observer-a',
      network: 'mainnet',
      role: 'observer',
      connectionRef: 'ssh-prodnet-observer-a',
      producer: { enabled: false }
    }
    const plan = {
      nodeId: 'prodnet-observer-a',
      action: 'status' as const,
      blocked: false,
      steps: [{
        command: "ssh ssh-prodnet-observer-a <<'TELENO_REMOTE'\necho healthy\nTELENO_REMOTE",
        chainMutation: false
      }]
    }

    const result = await service.executeRemoteCommandPlan({
      node,
      plan,
      confirmation: remoteExecutionConfirmationPhrase(node, plan.action)
    })

    expect(result.ok).toBe(true)
    expect(result.receipt.status).toBe('succeeded')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('blocks prodnet host mutation even with a confirmation phrase', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'should not run' }))
    const service = createRemoteNodeExecutionService({ runner })
    const node = {
      id: 'prodnet-observer-a',
      network: 'mainnet',
      role: 'observer',
      connectionRef: 'ssh-prodnet-observer-a',
      producer: { enabled: false }
    }
    const plan = {
      nodeId: 'prodnet-observer-a',
      action: 'stop' as const,
      blocked: false,
      steps: [{
        command: "ssh ssh-prodnet-observer-a <<'TELENO_REMOTE'\nsystemctl status teleno-prodnet-observer-a\nTELENO_REMOTE",
        hostMutation: true,
        chainMutation: false
      }]
    }

    const result = await service.executeRemoteCommandPlan({
      node,
      plan,
      confirmation: remoteExecutionConfirmationPhrase(node, plan.action)
    })

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('blocked')
    expect(result.output).toContain('read-only status and logs plans')
    expect(runner).not.toHaveBeenCalled()
  })

  it('allows trusted prodnet observer install only with proof, digest, policy, and observer-only evidence', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const runner = vi.fn(async () => ({ code: 0, output: 'TELENO_PRODNET_OBSERVER_ONLY block_production_disabled\nblock_producer: false\nrunning' }))
    const service = createRemoteNodeExecutionService({ runner })
    const node = {
      id: 'prodnet-trusted-a',
      network: 'mainnet',
      role: 'observer',
      connectionRef: 'ssh-prodnet-trusted-a',
      producer: { enabled: false },
      runtime: { image: `ghcr.io/pgarciagon/teleno-node@${digest}` },
      backup: { publicBootstrapUrl: 'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap' },
      trust: {
        artifactDigest: digest,
        bootstrapPolicyId: 'prodnet-public-bootstrap-v1',
        prodnetObserverProofRef: 'remote-proof-prodnet-trusted-a'
      }
    }
    const plan = {
      nodeId: 'prodnet-trusted-a',
      action: 'install-observer' as const,
      blocked: false,
      steps: [{
        phase: 'trust',
        command: [
          "ssh ssh-prodnet-trusted-a <<'TELENO_REMOTE'",
          `echo "TELENO_PRODNET_PROOF_RECEIPT remote-proof-prodnet-trusted-a"`,
          `echo "TELENO_ARTIFACT_DIGEST_PINNED ${digest}"`,
          'echo "TELENO_BOOTSTRAP_POLICY prodnet-public-bootstrap-v1"',
          'echo "TELENO_PRODNET_OBSERVER_ONLY block_production_disabled"',
          'docker run -d --name teleno-prodnet-trusted-a -p 127.0.0.1:18080:18080 ghcr.io/pgarciagon/teleno-node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --basedir /data --config /data/config.yml',
          'TELENO_REMOTE'
        ].join('\n'),
        hostMutation: true,
        chainMutation: false,
        destructive: false
      }]
    }

    const result = await service.executeRemoteCommandPlan({
      node,
      plan,
      confirmation: remoteExecutionConfirmationPhrase(node, plan.action)
    })

    expect(result.ok).toBe(true)
    expect(result.receipt.status).toBe('succeeded')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('blocks rollback execution when DB preservation evidence is missing', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'should not run' }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'rollback' as const,
        blocked: false,
        steps: [{
          phase: 'rollback',
          command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho TELENO_ROLLBACK_PLAN review-only\nTELENO_REMOTE",
          hostMutation: false,
          chainMutation: false,
          destructive: true
        }]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet rollback PRESERVE_DB'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('blocked')
    expect(result.output).toContain('must prove prior evidence and DB preservation')
    expect(runner).not.toHaveBeenCalled()
  })

  it('allows confirmed testnet rollback with prior evidence and DB preservation markers', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'TELENO_ROLLBACK_EVIDENCE present\nTELENO_DB_PRESERVED existing DB untouched\nblock_producer: false\nrunning'
    }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'rollback' as const,
        blocked: false,
        steps: [{
          phase: 'rollback',
          command: [
            "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'",
            'echo TELENO_ROLLBACK_EVIDENCE previous artifact and config present',
            'echo TELENO_DB_PRESERVED existing chain/state DB paths were detected and left untouched',
            'docker stop teleno-testnet-observer-a || true',
            'docker rm teleno-testnet-observer-a || true',
            'echo block_producer: false',
            'TELENO_REMOTE'
          ].join('\n'),
          hostMutation: true,
          chainMutation: false,
          destructive: true
        }]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet rollback PRESERVE_DB'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(true)
    expect(result.receipt.status).toBe('succeeded')
    expect(result.receipt.output).toContain('TELENO_DB_PRESERVED')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('allows confirmed testnet cleanup that preserves DB and removes only temporary candidates', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'TELENO_CLEANUP_CANDIDATE non-state temporary item present\nTELENO_DB_PRESERVED cleanup removed only non-state temporary items\nblock_producer: false'
    }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'cleanup' as const,
        blocked: false,
        steps: [{
          phase: 'cleanup',
          command: [
            "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'",
            'echo TELENO_CLEANUP_CANDIDATE non-state temporary item present',
            'echo TELENO_DB_PRESERVED cleanup candidates exclude chain, blockchain, state, config, wallet, and producer data',
            'rm -rf -- "$item"',
            'echo block_producer: false',
            'TELENO_REMOTE'
          ].join('\n'),
          hostMutation: true,
          chainMutation: false,
          destructive: true
        }]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet cleanup PRESERVE_DB'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(true)
    expect(result.receipt.status).toBe('succeeded')
    expect(result.receipt.output).toContain('TELENO_DB_PRESERVED')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('executes one confirmed testnet observer plan through the injected runner', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'teleno_node ready\nblock_producer: false\nrunning'
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(true)
    expect(result.receipt.status).toBe('succeeded')
    expect(result.receipt.health.state).toBe('healthy')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('allows a generated Docker testnet plan with loopback host bind and container-local listen', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'running\nblock_producer: false'
    }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'install-observer' as const,
        blocked: false,
        steps: [{
          phase: 'runtime',
          command: [
            "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'",
            'cat > "$HOME/koinos-one/nodes/testnet/testnet-observer-a/basedir/config.yml" <<\'TELENO_CONFIG\'',
            'network: testnet',
            'features:',
            '  block_producer: false',
            'jsonrpc:',
            '  listen: 0.0.0.0:18122',
            'TELENO_CONFIG',
            'docker run -d --name teleno-testnet-observer-a -p 127.0.0.1:18122:18122 -p 28890:18888 teleno',
            'TELENO_REMOTE'
          ].join('\n'),
          hostMutation: true,
          chainMutation: false,
          destructive: false
        }]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet install-observer'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(true)
    expect(result.receipt.health.stopCriteria).not.toContain('public-jsonrpc-exposure')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('blocks Docker plans that expose JSON-RPC on every host interface', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'should not run' }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'install-observer' as const,
        blocked: false,
        steps: [{
          phase: 'runtime',
          command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\ndocker run -p 0.0.0.0:18122:18122 teleno\nTELENO_REMOTE",
          hostMutation: true,
          chainMutation: false,
          destructive: false
        }]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet install-observer'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('blocked')
    expect(result.output).toContain('unsafe command or exposure pattern')
    expect(runner).not.toHaveBeenCalled()
  })

  it('blocks executable plans with unresolved placeholders before invoking SSH', async () => {
    const runner = vi.fn(async () => ({ code: 0, output: 'should not run' }))
    const service = createRemoteNodeExecutionService({ runner })
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'status' as const,
        blocked: false,
        steps: [{
          phase: 'preflight',
          command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho <remote-basedir>\nTELENO_REMOTE",
          hostMutation: false,
          chainMutation: false,
          destructive: false
        }]
      }
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('blocked')
    expect(result.output).toContain('unresolved placeholder')
    expect(runner).not.toHaveBeenCalled()
  })

  it('redacts secrets and raw targets from output', () => {
    expect(redactRemoteExecutionOutput('token=abc root@192.0.2.10 password: hunter2')).toContain('token=<redacted>')
    expect(redactRemoteExecutionOutput('token=abc root@192.0.2.10 password: hunter2')).toContain('<ssh-target-redacted>')
    expect(redactRemoteExecutionOutput('token=abc root@192.0.2.10 password: hunter2')).toContain('password: <redacted>')
    expect(redactRemoteExecutionOutput('token-file: /secret/admin.token')).toContain('token-file: <redacted>')
    expect(redactRemoteExecutionOutput('http://192.0.2.20:18080')).toContain('<ip-redacted>:<port-redacted>')
    expect(redactRemoteExecutionOutput('http://192.0.2.20:18080')).not.toContain(':18080')
    expect(redactRemoteExecutionOutput('IPv6 address for eth0: 2001:db8::1')).not.toContain('2001:db8')
    expect(redactRemoteExecutionOutput('System information as of 04:46:39 PM')).toContain('04:46:39 PM')
    expect(redactRemoteExecutionOutput('Linux private-host 6.8.0 /home/operator/koinos-one/node')).not.toContain('private-host')
    expect(redactRemoteExecutionOutput('Linux private-host 6.8.0 /home/operator/koinos-one/node')).not.toContain('/home/operator')
    expect(redactRemoteExecutionOutput('ssh: Could not resolve hostname private-vps')).not.toContain('private-vps')
    expect(redactRemoteExecutionOutput('planned port 28890 is already in use')).not.toContain('28890')
    expect(redactRemoteExecutionOutput('/ip4/203.0.113.10/tcp/18888')).not.toContain('/tcp/18888')
  })

  it('stores sanitized execution output in receipts', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'running token=abc password: hunter2 operator@192.0.2.10'
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.receipt.output).toContain('token=<redacted>')
    expect(result.receipt.output).toContain('password: <redacted>')
    expect(result.receipt.output).toContain('<ssh-target-redacted>')
    expect(result.receipt.output).not.toContain('hunter2')
    expect(result.receipt.output).not.toContain('192.0.2.10')
  })

  it('stops and records unsafe health when stop criteria appear', async () => {
    const runner = vi.fn(async () => ({
      code: 65,
      output: 'TELENO_STOP_CRITERIA: producer unexpectedly enabled\nblock_producer: true'
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('failed')
    expect(result.receipt.health.state).toBe('unsafe')
    expect(result.receipt.health.stopCriteria).toContain('producer-enabled')
  })

  it('records recovery and exposure stop criteria in sanitized receipts', async () => {
    const runner = vi.fn(async () => ({
      code: 65,
      output: [
        'chain id mismatch',
        'digest mismatch',
        'previous state merkle mismatch',
        'TELENO_STOP_CRITERIA: public JSON-RPC/admin exposure',
        'operator@192.0.2.10'
      ].join('\n')
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('failed')
    expect(result.receipt.health.state).toBe('unsafe')
    expect(result.receipt.health.stopCriteria).toEqual(expect.arrayContaining([
      'chain-id-mismatch',
      'digest-mismatch',
      'state-merkle-mismatch',
      'public-jsonrpc-exposure',
      'public-admin-exposure'
    ]))
    expect(result.receipt.output).toContain('<ssh-target-redacted>')
    expect(result.receipt.output).not.toContain('192.0.2.10')
  })

  it('records degraded health when a running observer has no peers or head progress', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      output: 'running\nblock_producer: false\nTELENO_HEALTH_SIGNAL no-peers\nTELENO_HEALTH_SIGNAL no-head-progress'
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(true)
    expect(result.receipt.health.state).toBe('degraded')
    expect(result.receipt.health.summary).toContain('no connected peers')
  })

  it('streams queued, running, output, and succeeded progress events with sanitized excerpts', async () => {
    const events: RemoteExecutionProgressEvent[] = []
    const runner = vi.fn(async (_command: string, onOutput?: (chunk: string) => void) => {
      onOutput?.('Linux private-host 6.8.0 token=abc /home/operator/koinos-one\n')
      onOutput?.('running\nblock_producer: false\n')
      return {
        code: 0,
        output: 'Linux private-host 6.8.0 token=abc /home/operator/koinos-one\nrunning\nblock_producer: false'
      }
    })
    const service = createRemoteNodeExecutionService({
      runner,
      onProgress: (event) => events.push(event)
    })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(true)
    expect(events.map((event) => event.status)).toEqual(['queued', 'running', 'running', 'running', 'succeeded'])
    expect(new Set(events.map((event) => event.planId)).size).toBe(1)
    expect(events.every((event) => event.nodeId === 'testnet-observer-a')).toBe(true)
    const lastEvent = events[events.length - 1]
    expect(lastEvent.outputExcerpt).toContain('token=<redacted>')
    expect(lastEvent.outputExcerpt).not.toContain('private-host')
    expect(lastEvent.outputExcerpt).not.toContain('/home/operator')
    expect(result.receipt.planId).toBe(events[0].planId)
    expect(result.receipt.steps).toHaveLength(1)
    expect(result.receipt.steps[0]).toMatchObject({
      stepIndex: 0,
      stepCount: 1,
      phase: 'preflight',
      status: 'succeeded',
      exitCode: 0
    })
    expect(result.receipt.steps[0].outputExcerpt).not.toContain('token=abc')
  })

  it('stops on a failed step and marks remaining steps skipped in progress and receipt summaries', async () => {
    const events: RemoteExecutionProgressEvent[] = []
    const runner = vi.fn(async () => ({
      code: 65,
      output: 'restore failed\nTELENO_STOP_CRITERIA: preserve state DB and stop remote rollout'
    }))
    const input = request({
      plan: {
        nodeId: 'testnet-observer-a',
        action: 'install-observer' as const,
        blocked: false,
        steps: [
          {
            phase: 'preflight',
            command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho preflight\nTELENO_REMOTE",
            hostMutation: false,
            chainMutation: false,
            destructive: false
          },
          {
            phase: 'artifact',
            command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho artifact\nTELENO_REMOTE",
            hostMutation: true,
            chainMutation: false,
            destructive: false
          },
          {
            phase: 'bootstrap',
            command: "ssh ssh-testnet-observer-a <<'TELENO_REMOTE'\necho restore\nTELENO_REMOTE",
            hostMutation: true,
            chainMutation: false,
            destructive: false
          }
        ]
      },
      confirmation: 'EXECUTE testnet-observer-a testnet install-observer'
    })
    const service = createRemoteNodeExecutionService({
      runner,
      onProgress: (event) => events.push(event)
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(false)
    expect(runner).toHaveBeenCalledTimes(1)
    expect(result.receipt.status).toBe('failed')
    expect(result.receipt.health.stopCriteria).toContain('restore-failure')
    expect(result.receipt.steps.map((step) => step.status)).toEqual(['failed', 'skipped', 'skipped'])
    expect(events.filter((event) => event.status === 'skipped')).toHaveLength(2)
    expect(events[events.length - 1].phase).toBe('bootstrap')
  })

  it('records rollback and cleanup stop criteria in receipts', async () => {
    const runner = vi.fn(async () => ({
      code: 65,
      output: [
        'TELENO_STOP_CRITERIA: rollback evidence missing',
        'TELENO_STOP_CRITERIA: cleanup receipt evidence missing',
        'TELENO_STOP_CRITERIA: cleanup state unknown',
        'TELENO_STOP_CRITERIA: cleanup attempted protected path'
      ].join('\n')
    }))
    const service = createRemoteNodeExecutionService({ runner })

    const result = await service.executeRemoteCommandPlan(request())

    expect(result.ok).toBe(false)
    expect(result.receipt.health.stopCriteria).toEqual(expect.arrayContaining([
      'rollback-evidence-missing',
      'cleanup-evidence-missing',
      'cleanup-state-unknown',
      'cleanup-protected-path'
    ]))
  })

  it('records blocked step summaries without invoking the runner when execution gates fail', async () => {
    const events: RemoteExecutionProgressEvent[] = []
    const runner = vi.fn(async () => ({ code: 0, output: 'should not run' }))
    const service = createRemoteNodeExecutionService({
      runner,
      onProgress: (event) => events.push(event)
    })

    const result = await service.executeRemoteCommandPlan(request({ confirmation: 'wrong' }))

    expect(result.ok).toBe(false)
    expect(runner).not.toHaveBeenCalled()
    expect(result.receipt.status).toBe('blocked')
    expect(result.receipt.steps.map((step) => step.status)).toEqual(['blocked'])
    expect(events.map((event) => event.status)).toEqual(['blocked'])
  })
})
