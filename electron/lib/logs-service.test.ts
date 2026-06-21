import { describe, expect, it, vi } from 'vitest'

import { createLogsService } from './logs-service'
import type { TelenoNodeStatus, NativeServiceProcessState } from './main-types'
import { normalizeBackupSettings } from './node-paths'

function createMonolithStatus(): TelenoNodeStatus {
  return {
    ok: true,
    repoPath: '/tmp/koinos',
    baseDir: '/tmp/.koinos',
    profiles: ['jsonrpc'],
    configReady: true,
    configDir: '/tmp/koinos/config',
    services: [
      {
        id: 'teleno-node',
        name: 'Koinos One Node',
        service: 'teleno-node',
        runtimeName: 'teleno_node',
        version: null,
        state: 'running',
        status: 'Running',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: 123,
        conflictPids: [],
        managedByTeleno: true
      }
    ],
    components: [
      { name: 'chain', enabled: true, healthy: true },
      { name: 'jsonrpc', enabled: true, healthy: true }
    ],
    runningServices: 1,
    output: 'teleno_node running'
  }
}

function createService(output: string, maxNativeServiceLogBytes = 1024 * 1024) {
  const nativeServiceProcesses = new Map<string, NativeServiceProcessState>()
  nativeServiceProcesses.set('teleno-node', {
    serviceId: 'teleno-node',
    child: { pid: 123 } as NativeServiceProcessState['child'],
    runtimeName: 'teleno_node',
    cwd: '/tmp/.koinos',
    baseDir: '/tmp/.koinos',
    startedAt: Date.now(),
    lastOutputAt: null,
    output,
    lastError: null,
    exitCode: null,
    stopRequested: false,
    closed: false
  })

  let streamSeq = 0
  const logsFollowSessions = new Map()
  const nativeLogsStreamIdsByService = new Map<string, Set<string>>()
  const sender = {
    isDestroyed: () => false,
    send: vi.fn()
  }

  const service = createLogsService({
    logsFollowEventChannel: 'logs:event',
    maxNativeServiceLogBytes,
    normalizeNodeSettings: () => ({
      network: 'mainnet',
      repoPath: '/tmp/koinos',
      baseDir: '/tmp/.koinos',
      profiles: ['jsonrpc'],
      blockchainBackupUrl: '',
      backup: normalizeBackupSettings()
    }),
    assertRepoReady: vi.fn(),
    nativeAmqpHomebrewLogFiles: () => [],
    nativeComposeStatus: vi.fn(async () => createMonolithStatus()),
    toManagedServiceId: (candidate) => candidate,
    nativeAmqpUsesBrewService: () => false,
    sortManagedServiceIds: (ids) => [...ids].sort(),
    nativeServiceProcesses,
    logsFollowSessions,
    nativeLogsStreamIdsByService,
    nextStreamId: () => `stream-${++streamSeq}`
  })

  return { service, sender, nativeServiceProcesses, nativeLogsStreamIdsByService }
}

describe('logs-service monolith component logs', () => {
  it('returns filtered monolith logs for component targets', async () => {
    const { service } = createService([
      '[chain] started',
      '[jsonrpc] listening',
      '[chain] accepted block',
      '[jsonrpc] request handled'
    ].join('\n'))

    const result = await service.nativeComposeLogs({ service: 'jsonrpc', tail: 20 })

    expect(result).toEqual({
      ok: true,
      service: 'jsonrpc',
      tail: 20,
      output: '[jsonrpc] listening\n[jsonrpc] request handled'
    })
  })

  it('streams only matching component log chunks from the monolith process', async () => {
    const { service, sender, nativeLogsStreamIdsByService } = createService([
      '[chain] started',
      '[jsonrpc] listening'
    ].join('\n'))

    const result = await service.nativeComposeLogsFollowStart(sender as any, { service: 'jsonrpc', tail: 20 })
    service.appendNativeServiceOutput('teleno-node', '[chain] ignored\n[jsonrpc] streamed\n')

    expect(result.ok).toBe(true)
    expect(result.service).toBe('jsonrpc')
    expect(nativeLogsStreamIdsByService.get('teleno-node')?.has(result.streamId)).toBe(true)
    expect(sender.send).toHaveBeenCalledWith('logs:event', {
      streamId: result.streamId,
      type: 'chunk',
      chunk: '[jsonrpc] listening\n'
    })
    expect(sender.send).toHaveBeenCalledWith('logs:event', {
      streamId: result.streamId,
      type: 'chunk',
      chunk: '[jsonrpc] streamed'
    })
  })

  it('keeps compact metrics rows parseable when the native log buffer is trimmed', async () => {
    const { service, nativeServiceProcesses } = createService('', 512 * 1024)
    const state = nativeServiceProcesses.get('teleno-node')
    expect(state).toBeDefined()

    service.appendNativeServiceOutput('teleno-node', `${'x'.repeat(1024 * 1024)}\n`)
    service.appendNativeServiceOutput(
      'teleno-node',
      [
        '[metrics] head_height=42 lib=40 blocks_per_sec=1.250 pending_txs=3 peer_count=2 rss_bytes=1048576 rss_mb=1.000 components=8',
        '[jsonrpc] still visible'
      ].join('\n')
    )

    expect(state?.output.length).toBeLessThanOrEqual(512 * 1024)
    expect(state?.output).toContain('[metrics] head_height=42')
    expect(state?.output).toContain('blocks_per_sec=1.250')
    expect(state?.output).toContain('peer_count=2')
    expect(state?.output).toContain('rss_bytes=1048576')
  })
})
