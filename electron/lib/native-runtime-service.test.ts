import { describe, expect, it } from 'vitest'

import { createNativeRuntimeService } from './native-runtime-service'
import type {
  ComposeServiceDefinition,
  ComposeServiceStatus,
  KoinosNodeSettings,
  KoinosNodeStatus,
  NativeServiceProcessState
} from './main-types'

function createSettings(): KoinosNodeSettings {
  return {
    repoPath: '/tmp/koinos',
    composeFile: '/tmp/koinos/docker-compose.yml',
    envFile: '/tmp/koinos/.env',
    baseDir: '/tmp/koinos/basedir',
    profiles: ['block_producer'],
    blockchainBackupUrl: 'https://example.com/backup.tar.gz',
    runtimeMode: 'native'
  }
}

function createStatus(serviceOverrides?: Partial<ComposeServiceStatus>): KoinosNodeStatus {
  return {
    ok: true,
    dockerAvailable: true,
    runtimeMode: 'native',
    availableRuntimeModes: ['native'],
    repoPath: '/tmp/koinos',
    composeFile: '/tmp/koinos/docker-compose.yml',
    envFile: '/tmp/koinos/.env',
    baseDir: '/tmp/koinos/basedir',
    profiles: ['block_producer'],
    configReady: true,
    configDir: '/tmp/koinos/config',
    services: [
      {
        id: 'chain',
        name: 'chain',
        service: 'chain',
        runtimeName: 'chain',
        runtimeType: 'native',
        version: null,
        state: 'running',
        status: 'running',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: 123,
        conflictPids: [],
        managedByKnodel: true,
        ...serviceOverrides
      }
    ],
    runningServices: serviceOverrides?.state === 'stopped' ? 0 : 1,
    output: ''
  }
}

function createService(overrides?: Partial<Parameters<typeof createNativeRuntimeService>[0]>) {
  const settings = createSettings()
  const nativeStatus = createStatus()
  const dockerStatus = createStatus({ runtimeType: 'docker' })

  return createNativeRuntimeService({
    nativeAmqpStartupTimeoutMs: 1000,
    normalizeNodeSettings: () => settings,
    ensureKoinosRepoRenamedFiles: () => '',
    assertRepoReady: () => {},
    readComposeServiceDefinitions: () => new Map<string, ComposeServiceDefinition>(),
    prepareNativeStartNotes: (_settings, notes) => notes,
    prepareComposeStartNotes: (_settings, notes) => notes,
    nativeRuntimeDockerConflictCheck: async () => ({ ok: true, output: '' }),
    selectedManagedComposeServiceIds: () => ['chain'],
    sortManagedServiceIds: (ids) => [...ids],
    sortManagedServiceIdsByDependencies: (ids) => [...ids],
    nativeAmqpUsesBrewService: () => false,
    startNativeServiceProcess: async () => ({ ok: true, output: 'started' }),
    stopNativeServiceProcess: async () => ({ ok: true, output: 'stopped' }),
    findExecutableInPath: () => null,
    runCommand: async () => ({ ok: true, code: 0, output: '' }),
    composeServicePortByTarget: () => null,
    nativeRabbitmqCtlExecutable: () => null,
    nativeRabbitmqServerExecutable: () => null,
    waitForTcpListener: async () => true,
    waitForTcpListenerClosed: async () => true,
    nativeServiceConnectHost: () => '127.0.0.1',
    listTcpListenerOwners: async () => [],
    tcpListenerOwnedByRabbitmq: () => false,
    tcpListenerOwnedByDocker: () => false,
    describeTcpListenerOwners: () => 'none',
    nativeComposeStatus: async () => nativeStatus,
    dockerComposeStatus: async () => dockerStatus,
    toManagedServiceId: (service) => service,
    serviceDisplayName: (serviceId) => serviceId,
    findProfileDependents: () => [],
    isComposeServiceRunning: (service) => service.state === 'running',
    nativeManagedProcessRegistryOutput: () => '',
    killConflictingNativeServiceProcesses: async () => ({ ok: true, output: 'killed' }),
    ensureNativeComposeImages: async () => ({ ok: true, output: '' }),
    composeBaseArgs: () => ['compose'],
    composeCommandEnv: () => ({}),
    runDockerCommandWithAutoStart: async () => ({ result: { ok: true, code: 0, output: 'ok' }, notes: [] }),
    resolvePresetOrThrow: async () => ({ preset: { id: 'p', label: 'Preset', source: 'compose-core', profiles: [], services: ['chain'], description: '' }, settings }),
    nativeDockerPlatform: () => null,
    toDockerServiceName: (serviceId) => serviceId,
    listsEqual: (left, right) => left.join(',') === right.join(','),
    nativeServiceProcesses: new Map<string, NativeServiceProcessState>(),
    ...overrides
  })
}

describe('native-runtime-service', () => {
  it('blocks native start when docker conflicts are detected', async () => {
    const service = createService({
      nativeRuntimeDockerConflictCheck: async () => ({ ok: false, output: 'docker conflict' })
    })

    const result = await service.nativeComposeAction('start')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('docker conflict')
  })

  it('rejects kill-conflict in docker service mode', async () => {
    const service = createService()

    const result = await service.dockerComposeServiceAction('kill-conflict', { service: 'chain' })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('Kill conflicting process solo esta disponible en runtime native')
  })
})
