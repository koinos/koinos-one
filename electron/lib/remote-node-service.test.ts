import { describe, expect, it, vi } from 'vitest'

import {
  createRemoteNodeExecutionService,
  redactRemoteExecutionOutput,
  remoteExecutionConfirmationPhrase
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

  it('blocks rollback execution even for confirmed testnet observers', async () => {
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
      confirmation: 'EXECUTE testnet-observer-a testnet rollback'
    })

    const result = await service.executeRemoteCommandPlan(input)

    expect(result.ok).toBe(false)
    expect(result.receipt.status).toBe('blocked')
    expect(result.output).toContain('rollback execution is unavailable')
    expect(runner).not.toHaveBeenCalled()
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
})
