import { describe, expect, it } from 'vitest'

import { createNativeRuntimeService } from './native-runtime-service'
import type {
  TelenoNodeSettings,
  TelenoNodeStatus,
  ServiceStatus,
  NativeServiceProcessState
} from './main-types'
import { normalizeBackupSettings } from './node-paths'

function createSettings(): TelenoNodeSettings {
  return {
    network: 'mainnet',
    repoPath: '/tmp/koinos',
    baseDir: '/tmp/koinos/basedir',
    profiles: ['block_producer'],
    blockchainBackupUrl: 'https://example.com/backup.tar.gz',
    backup: normalizeBackupSettings()
  }
}

function createStatus(serviceOverrides?: Partial<ServiceStatus>): TelenoNodeStatus {
  return {
    ok: true,
    network: 'mainnet',
    repoPath: '/tmp/koinos',
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
        version: null,
        state: 'running',
        status: 'running',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: 123,
        conflictPids: [],
        managedByTeleno: true,
        ...serviceOverrides
      }
    ],
    components: [],
    runningServices: serviceOverrides?.state === 'stopped' ? 0 : 1,
    output: ''
  }
}

function createService(overrides?: Partial<Parameters<typeof createNativeRuntimeService>[0]>) {
  const settings = createSettings()
  const nativeStatus = createStatus()

  return createNativeRuntimeService({
    nativeAmqpStartupTimeoutMs: 1000,
    normalizeNodeSettings: () => settings,
    assertRepoReady: () => {},
    readServiceDefinitions: () => new Map<string, Record<string, unknown>>(),
    prepareNativeStartNotes: (_settings: TelenoNodeSettings, notes: string[]) => notes,
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
    describeTcpListenerOwners: () => 'none',
    nativeComposeStatus: async () => nativeStatus,
    toManagedServiceId: (service: string) => service,
    serviceDisplayName: (serviceId: string) => serviceId,
    findProfileDependents: () => [],
    isComposeServiceRunning: (service) => service.state === 'running',
    nativeManagedProcessRegistryOutput: () => '',
    killConflictingNativeServiceProcesses: async () => ({ ok: true, output: 'killed' }),
    resolvePresetOrThrow: async () => ({ preset: { id: 'p', label: 'Preset', source: 'profile' as const, profiles: [], services: ['chain'], description: '' }, settings }),
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

  it('calls nativeComposeServiceAction correctly', async () => {
    const service = createService()

    const result = await service.nativeComposeServiceAction('start', { service: 'chain' })
    expect(result).toBeDefined()
  })
})
