import type {
  ComposeServiceDefinition,
  ComposeServiceStatus,
  KoinosNodeCommandResult,
  KoinosNodePreset,
  KoinosNodePresetCommandInput,
  KoinosNodePresetCommandResult,
  KoinosNodeServicePort,
  KoinosNodeServiceCommandInput,
  KoinosNodeServiceCommandResult,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeStatus,
  NativeConflictKillResult,
  TcpListenerOwner
} from './main-types'

type DockerRunResult = {
  result: { ok: boolean; code: number | null; output: string }
  notes: string[]
}

type NativeRuntimeServiceDeps = {
  nativeAmqpStartupTimeoutMs: number
  normalizeNodeSettings: (input?: KoinosNodeSettingsInput) => KoinosNodeSettings
  ensureKoinosRepoRenamedFiles: (settings: KoinosNodeSettings) => string
  assertRepoReady: (settings: KoinosNodeSettings) => void
  readComposeServiceDefinitions: (settings: KoinosNodeSettings) => Map<string, ComposeServiceDefinition>
  prepareNativeStartNotes: (settings: KoinosNodeSettings, notes: string[]) => string[]
  prepareComposeStartNotes: (settings: KoinosNodeSettings, notes: string[]) => string[]
  nativeRuntimeDockerConflictCheck: (settings: KoinosNodeSettings) => Promise<{ ok: boolean; output: string }>
  selectedManagedComposeServiceIds: (
    settings: KoinosNodeSettings,
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ) => string[]
  sortManagedServiceIds: (serviceIds: Iterable<string>) => string[]
  sortManagedServiceIdsByDependencies: (
    serviceIds: Iterable<string>,
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ) => string[]
  nativeAmqpUsesBrewService: () => boolean
  startNativeServiceProcess: (
    settings: KoinosNodeSettings,
    serviceId: string,
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ) => Promise<{ ok: boolean; output: string }>
  stopNativeServiceProcess: (serviceId: string) => Promise<{ ok: boolean; output: string }>
  findExecutableInPath: (name: string) => string | null
  runCommand: (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ) => Promise<{ ok: boolean; code: number | null; output: string }>
  composeServicePortByTarget: (definition: ComposeServiceDefinition | undefined, targetPort: number) => KoinosNodeServicePort | null
  nativeRabbitmqCtlExecutable: () => string | null
  nativeRabbitmqServerExecutable: () => string | null
  waitForTcpListener: (host: string, port: number, timeoutMs: number) => Promise<boolean>
  waitForTcpListenerClosed: (host: string, port: number, timeoutMs: number) => Promise<boolean>
  nativeServiceConnectHost: (port: KoinosNodeServicePort | null, fallback?: string) => string
  listTcpListenerOwners: (ports: number[]) => Promise<TcpListenerOwner[]>
  tcpListenerOwnedByRabbitmq: (listener: TcpListenerOwner) => boolean
  tcpListenerOwnedByDocker: (listener: TcpListenerOwner) => boolean
  describeTcpListenerOwners: (listeners: TcpListenerOwner[]) => string
  nativeComposeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  dockerComposeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  toManagedServiceId: (service: string) => string
  serviceDisplayName: (serviceId: string) => string
  findProfileDependents: (status: KoinosNodeStatus, serviceId: string) => ComposeServiceStatus[]
  isComposeServiceRunning: (service: ComposeServiceStatus) => boolean
  nativeManagedProcessRegistryOutput: (settings?: KoinosNodeSettings) => string
  killConflictingNativeServiceProcesses: (
    settings: KoinosNodeSettings,
    serviceId: string
  ) => Promise<NativeConflictKillResult>
  ensureNativeComposeImages: (
    settings: KoinosNodeSettings,
    serviceNames?: string[]
  ) => Promise<{ ok: boolean; output: string }>
  composeBaseArgs: (settings: KoinosNodeSettings) => string[]
  composeCommandEnv: (settings: KoinosNodeSettings) => NodeJS.ProcessEnv
  runDockerCommandWithAutoStart: (
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; allowAutoStart?: boolean }
  ) => Promise<DockerRunResult>
  resolvePresetOrThrow: (
    settings: KoinosNodeSettings,
    presetId: string
  ) => Promise<{ preset: KoinosNodePreset; settings: KoinosNodeSettings }>
  nativeDockerPlatform: () => string | null
  toDockerServiceName: (serviceId: string) => string
  listsEqual: (left: string[], right: string[]) => boolean
  nativeServiceProcesses: Map<string, unknown>
}

export function createNativeRuntimeService(deps: NativeRuntimeServiceDeps) {
  async function startNativeAmqpBrewService(
    settings: KoinosNodeSettings,
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ): Promise<{ ok: boolean; output: string }> {
    const brewExecutable = deps.findExecutableInPath('brew')
    if (!brewExecutable) {
      return {
        ok: false,
        output: 'Homebrew no esta disponible para arrancar rabbitmq'
      }
    }

    const serviceDefinition = serviceDefinitions.get('amqp')
    if (!serviceDefinition) {
      return {
        ok: false,
        output: 'No se encontro la definicion de amqp en docker-compose.yml'
      }
    }

    const result = await deps.runCommand(brewExecutable, ['services', 'start', 'rabbitmq'], {
      cwd: process.cwd(),
      timeoutMs: 30000
    })
    const amqpPort = deps.composeServicePortByTarget(serviceDefinition, 5672)
    const amqpAdminPort = deps.composeServicePortByTarget(serviceDefinition, 15672)
    const listenerPorts = [amqpPort?.publishedPort ?? 5672, amqpAdminPort?.publishedPort ?? 15672]
    const rabbitmqCtl = deps.nativeRabbitmqCtlExecutable()
    let awaitStartupOutput = ''
    if (rabbitmqCtl) {
      const awaitStartupResult = await deps.runCommand(rabbitmqCtl, ['await_startup'], {
        cwd: process.cwd(),
        timeoutMs: deps.nativeAmqpStartupTimeoutMs
      })
      if (awaitStartupResult.output) awaitStartupOutput = awaitStartupResult.output
    }

    const amqpReady = await deps.waitForTcpListener(
      deps.nativeServiceConnectHost(amqpPort),
      amqpPort?.publishedPort ?? 5672,
      deps.nativeAmqpStartupTimeoutMs
    )
    const adminReady = await deps.waitForTcpListener(
      deps.nativeServiceConnectHost(amqpAdminPort),
      amqpAdminPort?.publishedPort ?? 15672,
      deps.nativeAmqpStartupTimeoutMs
    )
    const listeners = await deps.listTcpListenerOwners(listenerPorts)
    const rabbitmqListeners = listeners.filter(deps.tcpListenerOwnedByRabbitmq)
    const dockerListeners = listeners.filter(deps.tcpListenerOwnedByDocker)
    const listenerSummary = listeners.length > 0 ? deps.describeTcpListenerOwners(listeners) : 'sin listeners'

    return {
      ok: result.ok && amqpReady && adminReady && rabbitmqListeners.length > 0 && dockerListeners.length === 0,
      output: [
        result.output,
        awaitStartupOutput,
        amqpReady && adminReady
          ? rabbitmqListeners.length > 0 && dockerListeners.length === 0
            ? 'RabbitMQ listo via brew services'
            : `Los puertos de amqp no pertenecen a RabbitMQ nativo: ${listenerSummary}`
          : `RabbitMQ no abrio 5672/15672 a tiempo (${Math.round(deps.nativeAmqpStartupTimeoutMs / 1000)}s)`
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  async function stopNativeAmqpBrewService(
    settings: KoinosNodeSettings,
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ): Promise<{ ok: boolean; output: string }> {
    const brewExecutable = deps.findExecutableInPath('brew')
    if (!brewExecutable) {
      return {
        ok: false,
        output: 'Homebrew no esta disponible para detener rabbitmq'
      }
    }

    const serviceDefinition = serviceDefinitions.get('amqp')
    if (!serviceDefinition) {
      return {
        ok: false,
        output: 'No se encontro la definicion de amqp en docker-compose.yml'
      }
    }

    const outputs: string[] = []
    const result = await deps.runCommand(brewExecutable, ['services', 'stop', 'rabbitmq'], {
      cwd: process.cwd(),
      timeoutMs: 20000
    })
    if (result.output) outputs.push(result.output)
    const amqpPort = deps.composeServicePortByTarget(serviceDefinition, 5672)
    const amqpAdminPort = deps.composeServicePortByTarget(serviceDefinition, 15672)
    const listenerPorts = [amqpPort?.publishedPort ?? 5672, amqpAdminPort?.publishedPort ?? 15672]
    const amqpClosed = await deps.waitForTcpListenerClosed(
      deps.nativeServiceConnectHost(amqpPort),
      amqpPort?.publishedPort ?? 5672,
      15000
    )
    const adminClosed = await deps.waitForTcpListenerClosed(
      deps.nativeServiceConnectHost(amqpAdminPort),
      amqpAdminPort?.publishedPort ?? 15672,
      15000
    )

    if (amqpClosed && adminClosed) {
      return {
        ok: true,
        output: [...outputs, 'RabbitMQ detenido via brew services'].filter(Boolean).join('\n')
      }
    }

    let listeners = await deps.listTcpListenerOwners(listenerPorts)
    if (listeners.length > 0) {
      outputs.push(`Puertos de amqp aun ocupados por: ${deps.describeTcpListenerOwners(listeners)}`)
    }

    const dockerListeners = listeners.filter(deps.tcpListenerOwnedByDocker)
    const rabbitmqListeners = listeners.filter(deps.tcpListenerOwnedByRabbitmq)

    if (dockerListeners.length > 0 && rabbitmqListeners.length === 0) {
      return {
        ok: true,
        output: [
          ...outputs,
          'RabbitMQ nativo ya estaba detenido',
          `Los puertos de amqp siguen ocupados por Docker Desktop: ${deps.describeTcpListenerOwners(dockerListeners)}`
        ]
          .filter(Boolean)
          .join('\n')
      }
    }

    if (listeners.some(deps.tcpListenerOwnedByRabbitmq)) {
      const rabbitmqCtl = deps.nativeRabbitmqCtlExecutable()
      if (rabbitmqCtl) {
        const shutdownResult = await deps.runCommand(rabbitmqCtl, ['shutdown'], {
          cwd: process.cwd(),
          timeoutMs: 15000
        })
        if (shutdownResult.output) outputs.push(shutdownResult.output)
        listeners = await deps.listTcpListenerOwners(listenerPorts)
      }
    }

    if (listeners.some(deps.tcpListenerOwnedByRabbitmq)) {
      const rabbitmqServer = deps.nativeRabbitmqServerExecutable()
      if (rabbitmqServer) {
        const pkillResult = await deps.runCommand('pkill', ['-f', rabbitmqServer], {
          cwd: process.cwd(),
          timeoutMs: 5000
        })
        if (pkillResult.output) outputs.push(pkillResult.output)
        listeners = await deps.listTcpListenerOwners(listenerPorts)
      }
    }

    const amqpClosedAfterFallback = await deps.waitForTcpListenerClosed(
      deps.nativeServiceConnectHost(amqpPort),
      amqpPort?.publishedPort ?? 5672,
      10000
    )
    const adminClosedAfterFallback = await deps.waitForTcpListenerClosed(
      deps.nativeServiceConnectHost(amqpAdminPort),
      amqpAdminPort?.publishedPort ?? 15672,
      10000
    )
    const remainingListeners =
      amqpClosedAfterFallback && adminClosedAfterFallback ? [] : await deps.listTcpListenerOwners(listenerPorts)
    const remainingRabbitmqListeners = remainingListeners.filter(deps.tcpListenerOwnedByRabbitmq)

    return {
      ok: remainingRabbitmqListeners.length === 0,
      output: [
        ...outputs,
        remainingRabbitmqListeners.length === 0
          ? remainingListeners.length > 0
            ? `RabbitMQ nativo detenido. Los puertos de amqp siguen ocupados por otro proceso: ${deps.describeTcpListenerOwners(remainingListeners)}`
            : 'RabbitMQ detenido'
          : `RabbitMQ sigue exponiendo 5672/15672${
              remainingListeners.length > 0 ? `: ${deps.describeTcpListenerOwners(remainingListeners)}` : ''
            }`
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  async function startNativeServices(
    settings: KoinosNodeSettings,
    serviceIds: string[],
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ): Promise<{ ok: boolean; output: string }> {
    const outputs: string[] = []

    for (const serviceId of deps.sortManagedServiceIdsByDependencies(serviceIds, serviceDefinitions)) {
      const result =
        serviceId === 'amqp' && deps.nativeAmqpUsesBrewService()
          ? await startNativeAmqpBrewService(settings, serviceDefinitions)
          : await deps.startNativeServiceProcess(settings, serviceId, serviceDefinitions)
      if (result.output) outputs.push(`[${serviceId}] ${result.output}`)
      if (!result.ok) {
        return {
          ok: false,
          output: outputs.join('\n')
        }
      }
    }

    return {
      ok: true,
      output: outputs.join('\n')
    }
  }

  async function stopNativeServices(
    settings: KoinosNodeSettings,
    serviceIds: string[],
    serviceDefinitions: Map<string, ComposeServiceDefinition>
  ): Promise<{ ok: boolean; output: string }> {
    const outputs: string[] = []
    let ok = true

    for (const serviceId of deps.sortManagedServiceIdsByDependencies(serviceIds, serviceDefinitions).reverse()) {
      const result =
        serviceId === 'amqp' && deps.nativeAmqpUsesBrewService()
          ? await stopNativeAmqpBrewService(settings, serviceDefinitions)
          : await deps.stopNativeServiceProcess(serviceId)
      if (result.output) outputs.push(`[${serviceId}] ${result.output}`)
      if (!result.ok) ok = false
    }

    return {
      ok,
      output: outputs.join('\n')
    }
  }

  async function nativeComposeAction(
    action: 'start' | 'stop',
    input?: KoinosNodeSettingsInput
  ): Promise<KoinosNodeCommandResult> {
    const settings = deps.normalizeNodeSettings(input)
    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(settings)
    deps.assertRepoReady(settings)
    const serviceDefinitions = deps.readComposeServiceDefinitions(settings)

    const notes: string[] =
      action === 'start'
        ? deps.prepareNativeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
        : repoRenameNotes
          ? [repoRenameNotes]
          : []

    if (action === 'start') {
      const conflictCheck = await deps.nativeRuntimeDockerConflictCheck(settings)
      if (!conflictCheck.ok) {
        return {
          ok: false,
          action,
          output: [notes.join('\n'), conflictCheck.output].filter(Boolean).join('\n'),
          status: await deps.nativeComposeStatus(settings)
        }
      }
    }

    const targetServiceIds =
      action === 'start'
        ? deps.selectedManagedComposeServiceIds(settings, serviceDefinitions)
        : deps.sortManagedServiceIds(
            new Set([...deps.selectedManagedComposeServiceIds(settings, serviceDefinitions), ...deps.nativeServiceProcesses.keys()])
          )

    const result =
      action === 'start'
        ? await startNativeServices(settings, targetServiceIds, serviceDefinitions)
        : await stopNativeServices(settings, targetServiceIds, serviceDefinitions)

    const status = await deps.nativeComposeStatus(settings)
    return {
      ok: result.ok,
      action,
      output: [notes.join('\n'), result.output].filter(Boolean).join('\n'),
      status
    }
  }

  async function nativeComposeServiceAction(
    action: 'start' | 'stop' | 'restart' | 'kill-conflict',
    input?: KoinosNodeServiceCommandInput
  ): Promise<KoinosNodeServiceCommandResult> {
    const settings = deps.normalizeNodeSettings(input)
    const service = input?.service?.trim() || ''
    if (!service) {
      return {
        ok: false,
        action,
        service: '',
        output: 'Parametro service invalido',
        status: await deps.nativeComposeStatus(settings)
      }
    }

    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(settings)
    deps.assertRepoReady(settings)
    const serviceDefinitions = deps.readComposeServiceDefinitions(settings)
    const currentStatus = await deps.nativeComposeStatus(settings)
    const serviceId = deps.toManagedServiceId(service)
    const targetService = currentStatus.services.find((candidate) => candidate.service === service || candidate.id === serviceId)

    if (!targetService) {
      return {
        ok: false,
        action,
        service,
        output: `Servicio no gestionado en el perfil actual: ${service}`,
        status: currentStatus
      }
    }

    if (action === 'start' || action === 'restart') {
      const conflictCheck = await deps.nativeRuntimeDockerConflictCheck(settings)
      if (!conflictCheck.ok) {
        return {
          ok: false,
          action,
          service,
          output: conflictCheck.output,
          status: currentStatus
        }
      }
    }

    if (action === 'kill-conflict') {
      const killResult = await deps.killConflictingNativeServiceProcesses(settings, serviceId)
      const status = await deps.nativeComposeStatus(settings)
      return {
        ok: killResult.ok,
        action,
        service,
        output: [repoRenameNotes, killResult.output, deps.nativeManagedProcessRegistryOutput(settings)].filter(Boolean).join('\n'),
        status
      }
    }

    if ((action === 'start' || action === 'restart') && !deps.isComposeServiceRunning(targetService)) {
      const currentServicesById = new Map(currentStatus.services.map((candidate) => [candidate.id, candidate] as const))
      const missingDependencyIds = (targetService.dependsOn ?? []).filter((dependencyId) => {
        const dependency = currentServicesById.get(dependencyId)
        return !dependency || !deps.isComposeServiceRunning(dependency)
      })
      if (missingDependencyIds.length > 0) {
        return {
          ok: false,
          action,
          service,
          output: `No se puede ${action === 'start' ? 'iniciar' : 'reiniciar'} ${service}. Dependencias no activas: ${missingDependencyIds
            .map(deps.serviceDisplayName)
            .join(', ')}`,
          status: currentStatus
        }
      }
    }

    if (action === 'stop') {
      const profileDependents = deps.findProfileDependents(currentStatus, serviceId)
      if (profileDependents.length > 0) {
        return {
          ok: false,
          action,
          service,
          output: `No se puede detener ${service}. Servicios dependientes en el profile actual: ${profileDependents
            .map((dependent) => dependent.name)
            .join(', ')}`,
          status: currentStatus
        }
      }
    }

    const notes: string[] =
      action === 'start' || action === 'restart'
        ? deps.prepareNativeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
        : repoRenameNotes
          ? [repoRenameNotes]
          : []

    if (action === 'restart') {
      const stopResult = await stopNativeServices(settings, [serviceId], serviceDefinitions)
      const startResult = await startNativeServices(settings, [serviceId], serviceDefinitions)
      const status = await deps.nativeComposeStatus(settings)
      return {
        ok: stopResult.ok && startResult.ok,
        action,
        service,
        output: [notes.join('\n'), stopResult.output, startResult.output, deps.nativeManagedProcessRegistryOutput(settings)]
          .filter(Boolean)
          .join('\n'),
        status
      }
    }

    const result =
      action === 'start'
        ? await startNativeServices(settings, [serviceId], serviceDefinitions)
        : await stopNativeServices(settings, [serviceId], serviceDefinitions)

    const status = await deps.nativeComposeStatus(settings)
    return {
      ok: result.ok,
      action,
      service,
      output: [notes.join('\n'), result.output, deps.nativeManagedProcessRegistryOutput(settings)].filter(Boolean).join('\n'),
      status
    }
  }

  async function nativeComposePresetReconcile(input?: KoinosNodePresetCommandInput): Promise<KoinosNodePresetCommandResult> {
    const initialSettings = deps.normalizeNodeSettings(input)
    const presetId = input?.presetId?.trim() || ''
    if (!presetId) {
      return {
        ok: false,
        action: 'reconcile',
        presetId: '',
        output: 'Parametro presetId invalido',
        status: await deps.nativeComposeStatus(initialSettings)
      }
    }

    let presetSettings = initialSettings
    let preset: KoinosNodePreset | null = null

    try {
      const resolved = await deps.resolvePresetOrThrow(initialSettings, presetId)
      preset = resolved.preset
      presetSettings = resolved.settings
    } catch (error) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: error instanceof Error ? error.message : 'No se pudo resolver el profile',
        status: await deps.nativeComposeStatus(initialSettings)
      }
    }

    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(presetSettings)
    deps.assertRepoReady(presetSettings)
    const notes = deps.prepareNativeStartNotes(presetSettings, repoRenameNotes ? [repoRenameNotes] : [])
    const serviceDefinitions = deps.readComposeServiceDefinitions(presetSettings)
    const currentStatus = await deps.nativeComposeStatus(presetSettings)
    const targetServiceIds = deps.sortManagedServiceIds(preset.services)
    const currentRunningIds = deps.sortManagedServiceIds(
      currentStatus.services.filter(deps.isComposeServiceRunning).map((service) => service.id)
    )
    const servicesToStop = currentStatus.services
      .filter((service) => deps.isComposeServiceRunning(service) && !targetServiceIds.includes(service.id))
      .map((service) => service.id)

    if (deps.listsEqual(targetServiceIds, currentRunningIds)) {
      return {
        ok: true,
        action: 'reconcile',
        presetId,
        output: `El nodo ya coincide con el profile ${preset.label}`,
        status: currentStatus
      }
    }

    const conflictCheck = await deps.nativeRuntimeDockerConflictCheck(presetSettings)
    if (!conflictCheck.ok) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: [notes.join('\n'), conflictCheck.output].filter(Boolean).join('\n'),
        status: await deps.nativeComposeStatus(presetSettings)
      }
    }

    const startResult = await startNativeServices(presetSettings, targetServiceIds, serviceDefinitions)
    const stopResult =
      servicesToStop.length > 0
        ? await stopNativeServices(presetSettings, servicesToStop, serviceDefinitions)
        : { ok: true, output: '' }

    const status = await deps.nativeComposeStatus(presetSettings)
    return {
      ok: startResult.ok && stopResult.ok,
      action: 'reconcile',
      presetId,
      output: [notes.join('\n'), startResult.output, stopResult.output].filter(Boolean).join('\n'),
      status
    }
  }

  async function dockerComposeAction(
    action: 'start' | 'stop',
    input?: KoinosNodeSettingsInput
  ): Promise<KoinosNodeCommandResult> {
    const settings = deps.normalizeNodeSettings(input)
    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(settings)
    deps.assertRepoReady(settings)

    const notes: string[] =
      action === 'start'
        ? deps.prepareComposeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
        : repoRenameNotes
          ? [repoRenameNotes]
          : []

    if (action === 'start') {
      const nativeImages = await deps.ensureNativeComposeImages(settings)
      if (nativeImages.output) notes.push(nativeImages.output)
      if (!nativeImages.ok) {
        return {
          ok: false,
          action,
          output: notes.filter(Boolean).join('\n'),
          status: await deps.dockerComposeStatus(settings)
        }
      }
    }

    const composeArgs =
      action === 'start' ? [...deps.composeBaseArgs(settings), 'up', '-d'] : [...deps.composeBaseArgs(settings), 'down']

    const dockerRun = await deps.runDockerCommandWithAutoStart(composeArgs, {
      cwd: settings.repoPath,
      env: deps.composeCommandEnv(settings),
      allowAutoStart: true
    })
    const result = dockerRun.result

    const status = await deps.dockerComposeStatus(settings)
    return {
      ok: result.ok,
      action,
      output: [notes.join('\n'), dockerRun.notes.join('\n'), result.output].filter(Boolean).join('\n'),
      status
    }
  }

  async function dockerComposeServiceAction(
    action: 'start' | 'stop' | 'restart' | 'kill-conflict',
    input?: KoinosNodeServiceCommandInput
  ): Promise<KoinosNodeServiceCommandResult> {
    const settings = deps.normalizeNodeSettings(input)
    const service = input?.service?.trim() || ''
    if (!service) {
      return {
        ok: false,
        action,
        service: '',
        output: 'Parametro service invalido',
        status: await deps.dockerComposeStatus(settings)
      }
    }

    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(settings)
    deps.assertRepoReady(settings)
    const currentStatus = await deps.dockerComposeStatus(settings)
    const serviceId = deps.toManagedServiceId(service)
    const targetService = currentStatus.services.find((candidate) => candidate.service === service || candidate.id === serviceId)

    if (action === 'kill-conflict') {
      return {
        ok: false,
        action,
        service,
        output: 'Kill conflicting process solo esta disponible en runtime native',
        status: currentStatus
      }
    }

    if ((action === 'start' || action === 'restart') && (!targetService || !deps.isComposeServiceRunning(targetService))) {
      const currentServicesById = new Map(currentStatus.services.map((candidate) => [candidate.id, candidate] as const))
      const missingDependencyIds = (targetService?.dependsOn ?? []).filter((dependencyId) => {
        const dependency = currentServicesById.get(dependencyId)
        return !dependency || !deps.isComposeServiceRunning(dependency)
      })
      if (missingDependencyIds.length > 0) {
        return {
          ok: false,
          action,
          service,
          output: `No se puede ${action === 'start' ? 'iniciar' : 'reiniciar'} ${service}. Dependencias no activas: ${missingDependencyIds
            .map(deps.serviceDisplayName)
            .join(', ')}`,
          status: currentStatus
        }
      }
    }

    if (action === 'stop') {
      const profileDependents = deps.findProfileDependents(currentStatus, serviceId)
      if (profileDependents.length > 0) {
        return {
          ok: false,
          action,
          service,
          output: `No se puede detener ${service}. Servicios dependientes en el profile actual: ${profileDependents
            .map((dependent) => dependent.name)
            .join(', ')}`,
          status: currentStatus
        }
      }
    }

    const notes: string[] =
      action === 'start' || (action === 'restart' && (!targetService || !deps.isComposeServiceRunning(targetService)))
        ? deps.prepareComposeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
        : repoRenameNotes
          ? [repoRenameNotes]
          : []

    if (action === 'start' || action === 'restart') {
      const nativeImages = await deps.ensureNativeComposeImages(settings, [service])
      if (nativeImages.output) notes.push(nativeImages.output)
      if (!nativeImages.ok) {
        return {
          ok: false,
          action,
          service,
          output: notes.filter(Boolean).join('\n'),
          status: await deps.dockerComposeStatus(settings)
        }
      }
    }

    const composeArgs =
      action === 'start'
        ? [...deps.composeBaseArgs(settings), 'up', '-d', '--no-deps', service]
        : action === 'stop'
          ? [...deps.composeBaseArgs(settings), 'stop', service]
          : targetService && deps.isComposeServiceRunning(targetService) && !deps.nativeDockerPlatform()
            ? [...deps.composeBaseArgs(settings), 'restart', service]
            : [...deps.composeBaseArgs(settings), 'up', '-d', '--force-recreate', '--no-deps', service]

    const dockerRun = await deps.runDockerCommandWithAutoStart(composeArgs, {
      cwd: settings.repoPath,
      env: deps.composeCommandEnv(settings),
      allowAutoStart: true
    })
    const result = dockerRun.result

    const status = await deps.dockerComposeStatus(settings)
    return {
      ok: result.ok,
      action,
      service,
      output: [notes.join('\n'), dockerRun.notes.join('\n'), result.output].filter(Boolean).join('\n'),
      status
    }
  }

  async function dockerComposePresetReconcile(input?: KoinosNodePresetCommandInput): Promise<KoinosNodePresetCommandResult> {
    const initialSettings = deps.normalizeNodeSettings(input)
    const presetId = input?.presetId?.trim() || ''
    if (!presetId) {
      return {
        ok: false,
        action: 'reconcile',
        presetId: '',
        output: 'Parametro presetId invalido',
        status: await deps.dockerComposeStatus(initialSettings)
      }
    }

    let presetSettings = initialSettings
    let preset: KoinosNodePreset | null = null

    try {
      const resolved = await deps.resolvePresetOrThrow(initialSettings, presetId)
      preset = resolved.preset
      presetSettings = resolved.settings
    } catch (error) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: error instanceof Error ? error.message : 'No se pudo resolver el profile',
        status: await deps.dockerComposeStatus(initialSettings)
      }
    }

    const repoRenameNotes = deps.ensureKoinosRepoRenamedFiles(presetSettings)
    deps.assertRepoReady(presetSettings)
    const notes = deps.prepareComposeStartNotes(presetSettings, repoRenameNotes ? [repoRenameNotes] : [])
    const currentStatus = await deps.dockerComposeStatus(presetSettings)
    const targetServiceIds = [...preset.services].sort()
    const currentRunningIds = currentStatus.services.filter(deps.isComposeServiceRunning).map((service) => service.id).sort()
    const servicesToStop = currentStatus.services
      .filter((service) => deps.isComposeServiceRunning(service) && !targetServiceIds.includes(service.id))
      .map((service) => service.service)
    const servicesToUp = preset.services.map(deps.toDockerServiceName)

    if (deps.listsEqual(targetServiceIds, currentRunningIds)) {
      return {
        ok: true,
        action: 'reconcile',
        presetId,
        output: `El nodo ya coincide con el profile ${preset.label}`,
        status: currentStatus
      }
    }

    const nativeImages = await deps.ensureNativeComposeImages(presetSettings, servicesToUp)
    if (nativeImages.output) notes.push(nativeImages.output)
    if (!nativeImages.ok) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: notes.filter(Boolean).join('\n'),
        status: await deps.dockerComposeStatus(presetSettings)
      }
    }

    const upDockerRun = await deps.runDockerCommandWithAutoStart([...deps.composeBaseArgs(presetSettings), 'up', '-d', ...servicesToUp], {
      cwd: presetSettings.repoPath,
      env: deps.composeCommandEnv(presetSettings),
      allowAutoStart: true
    })
    const upResult = upDockerRun.result

    let stopOutput = ''
    let stopOk = true
    const stopNotes: string[] = []
    if (servicesToStop.length > 0) {
      const stopDockerRun = await deps.runDockerCommandWithAutoStart(
        [...deps.composeBaseArgs(presetSettings), 'stop', ...servicesToStop],
        {
          cwd: presetSettings.repoPath,
          env: deps.composeCommandEnv(presetSettings),
          allowAutoStart: true
        }
      )
      const stopResult = stopDockerRun.result
      if (stopDockerRun.notes.length > 0) stopNotes.push(...stopDockerRun.notes)
      stopOk = stopResult.ok
      stopOutput = stopResult.output
    }

    const status = await deps.dockerComposeStatus(presetSettings)
    return {
      ok: upResult.ok && stopOk,
      action: 'reconcile',
      presetId,
      output: [
        notes.join('\n'),
        upDockerRun.notes.join('\n'),
        stopNotes.join('\n'),
        upResult.output,
        stopOutput,
        servicesToStop.length ? `Stopped extras: ${servicesToStop.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      status
    }
  }

  return {
    nativeComposeAction,
    nativeComposeServiceAction,
    nativeComposePresetReconcile,
    dockerComposeAction,
    dockerComposeServiceAction,
    dockerComposePresetReconcile
  }
}
