export {}

declare global {
  type KnodelKoinosNodeServiceRuntime = 'docker' | 'native'
  type KnodelKoinosNativeBuildSystem = 'cmake' | 'go' | 'yarn'

  type KnodelKoinosNodeServicePort = {
    host: string | null
    publishedPort: number | null
    targetPort: number | null
    protocol: string
    label: string
  }

  type KnodelKoinosNodeSettings = {
    repoPath?: string
    composeFile?: string
    envFile?: string
    baseDir?: string
    profiles?: string[]
    runtimeMode?: KnodelKoinosNodeServiceRuntime
  }

  type KnodelKoinosNodeServiceStatus = {
    id: string
    name: string
    service: string
    runtimeName: string
    runtimeType: KnodelKoinosNodeServiceRuntime
    state: string
    status: string
    ports: KnodelKoinosNodeServicePort[]
    dependsOn: string[]
    lastError: string | null
  }

  type KnodelKoinosNodePresetSource = 'compose-core' | 'compose-profile'

  type KnodelKoinosNodePreset = {
    id: string
    label: string
    source: KnodelKoinosNodePresetSource
    profiles: string[]
    services: string[]
    description: string
  }

  type KnodelKoinosNodeStatus = {
    ok: boolean
    dockerAvailable: boolean
    runtimeMode: KnodelKoinosNodeServiceRuntime
    availableRuntimeModes: KnodelKoinosNodeServiceRuntime[]
    repoPath: string
    composeFile: string
    envFile: string
    baseDir: string
    profiles: string[]
    configReady: boolean
    configDir: string
    services: KnodelKoinosNodeServiceStatus[]
    runningServices: number
    output: string
  }

  type KnodelKoinosNodePresetsResult = {
    ok: boolean
    presets: KnodelKoinosNodePreset[]
    output: string
  }

  type KnodelKoinosNodeCommandResult = {
    ok: boolean
    action: 'start' | 'stop'
    output: string
    status: KnodelKoinosNodeStatus
  }

  type KnodelKoinosNodeServiceCommandParams = KnodelKoinosNodeSettings & {
    service: string
  }

  type KnodelKoinosNodeServiceCommandResult = {
    ok: boolean
    action: 'start' | 'stop' | 'restart'
    service: string
    output: string
    status: KnodelKoinosNodeStatus
  }

  type KnodelKoinosNodePresetCommandParams = KnodelKoinosNodeSettings & {
    presetId: string
  }

  type KnodelKoinosNodePresetCommandResult = {
    ok: boolean
    action: 'reconcile'
    presetId: string
    output: string
    status: KnodelKoinosNodeStatus
  }

  type KnodelKoinosNodeNativeBuildStatus = {
    serviceId: string
    serviceName: string
    supported: boolean
    buildSystem: KnodelKoinosNativeBuildSystem | null
    repoPath: string | null
    repoExists: boolean
    artifactPath: string | null
    artifactExists: boolean
    artifactUpdatedAt: number | null
    buildable: boolean
    note: string | null
    buildCommands: string[]
  }

  type KnodelKoinosNodeNativeBuildsResult = {
    ok: boolean
    sourceRoot: string
    services: KnodelKoinosNodeNativeBuildStatus[]
    output: string
  }

  type KnodelKoinosNodeNativeBuildParams = {
    serviceId?: string
  }

  type KnodelKoinosNodeNativeBuildCommandResult = {
    ok: boolean
    action: 'build-all' | 'build-service'
    serviceId: string | null
    output: string
    builds: KnodelKoinosNodeNativeBuildsResult
  }

  type KnodelKoinosNodeCloneRepoResult = {
    ok: boolean
    repoPath: string
    output: string
  }

  type KnodelKoinosNodeManagedFileKind = 'compose' | 'env' | 'config'

  type KnodelKoinosNodeFileReadParams = KnodelKoinosNodeSettings & {
    kind: KnodelKoinosNodeManagedFileKind
  }

  type KnodelKoinosNodeFileReadResult = {
    ok: boolean
    kind: KnodelKoinosNodeManagedFileKind
    filePath: string
    content: string
    output: string
  }

  type KnodelKoinosNodeFileWriteParams = KnodelKoinosNodeSettings & {
    kind: KnodelKoinosNodeManagedFileKind
    content?: string
  }

  type KnodelKoinosNodeFileWriteResult = {
    ok: boolean
    kind: KnodelKoinosNodeManagedFileKind
    filePath: string
    output: string
  }

  type KnodelKoinosNodeLogsParams = KnodelKoinosNodeSettings & {
    service?: string
    tail?: number
  }

  type KnodelKoinosNodeLogsResult = {
    ok: boolean
    service: string | null
    tail: number
    output: string
  }

  type KnodelKoinosNodeLogsFollowStartResult = {
    ok: boolean
    streamId: string
    service: string | null
    tail: number
    output?: string
  }

  type KnodelKoinosNodeLogsFollowStopParams = {
    streamId?: string
  }

  type KnodelKoinosNodeLogsFollowStopResult = {
    ok: boolean
    streamId: string | null
  }

  type KnodelKoinosNodeLogsFollowEvent = {
    streamId: string
    type: 'start' | 'chunk' | 'end' | 'error'
    service?: string | null
    tail?: number
    chunk?: string
    code?: number | null
    message?: string
  }

  type KnodelApi = {
    version: string
    koinosNode?: {
      defaults: () => Promise<Required<KnodelKoinosNodeSettings>>
      cloneRepo: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCloneRepoResult>
      fileRead: (params: KnodelKoinosNodeFileReadParams) => Promise<KnodelKoinosNodeFileReadResult>
      fileWrite: (params: KnodelKoinosNodeFileWriteParams) => Promise<KnodelKoinosNodeFileWriteResult>
      status: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeStatus>
      presets: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodePresetsResult>
      nativeBuilds: () => Promise<KnodelKoinosNodeNativeBuildsResult>
      nativeBuildAll: () => Promise<KnodelKoinosNodeNativeBuildCommandResult>
      nativeBuildService: (
        params: KnodelKoinosNodeNativeBuildParams
      ) => Promise<KnodelKoinosNodeNativeBuildCommandResult>
      start: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCommandResult>
      stop: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCommandResult>
      serviceStart: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      serviceStop: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      serviceRestart: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      presetReconcile: (params: KnodelKoinosNodePresetCommandParams) => Promise<KnodelKoinosNodePresetCommandResult>
      logs: (params?: KnodelKoinosNodeLogsParams) => Promise<KnodelKoinosNodeLogsResult>
      logsFollowStart: (params?: KnodelKoinosNodeLogsParams) => Promise<KnodelKoinosNodeLogsFollowStartResult>
      logsFollowStop: (
        params?: KnodelKoinosNodeLogsFollowStopParams
      ) => Promise<KnodelKoinosNodeLogsFollowStopResult>
      onLogsFollowEvent: (listener: (event: KnodelKoinosNodeLogsFollowEvent) => void) => () => void
    }
  }

  interface Window {
    knodel?: KnodelApi
  }
}
