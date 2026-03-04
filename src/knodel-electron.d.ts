export {}

declare global {
  type KnodelKoinosNodeServiceRuntime = 'native'
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
    blockchainBackupUrl?: string
    runtimeMode?: KnodelKoinosNodeServiceRuntime
  }

  type KnodelKoinosNodeServiceStatus = {
    id: string
    name: string
    service: string
    runtimeName: string
    runtimeType: KnodelKoinosNodeServiceRuntime
    version: string | null
    state: string
    status: string
    ports: KnodelKoinosNodeServicePort[]
    dependsOn: string[]
    lastError: string | null
    nativePid: number | null
    conflictPids: number[]
    managedByKnodel: boolean
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

  type KnodelKoinosNodeBackupRestoreResult = {
    ok: boolean
    action: 'restore-backup' | 'restore-backup-verify'
    output: string
    status: KnodelKoinosNodeStatus
  }

  type KnodelKoinosNodeProducerAddressSource = 'config' | 'vault' | 'none'

  type KnodelKoinosNodeProducerRegistrationStatus =
    | 'missing-address'
    | 'missing-local-key'
    | 'match'
    | 'mismatch'
    | 'unregistered'

  type KnodelKoinosNodeProducerOverviewParams = KnodelKoinosNodeSettings & {
    producerAddress?: string
  }

  type KnodelKoinosNodeProducerOverviewResult = {
    ok: boolean
    output: string
    rpcUrl: string
    rpcSource: 'public'
    priceSourceUrl: string
    producerAddress: string | null
    producerAddressSource: KnodelKoinosNodeProducerAddressSource
    configFilePath: string
    configHasProducer: boolean
    walletAddress: string | null
    walletExists: boolean
    localPublicKey: string | null
    localPublicKeyPath: string | null
    localPrivateKeyPath: string | null
    registeredPublicKey: string | null
    registrationStatus: KnodelKoinosNodeProducerRegistrationStatus
    koinBalance: string | null
    vhpBalance: string | null
    mana: string | null
    totalKoinSupply: string | null
    totalVhpSupply: string | null
    totalVirtualSupply: string | null
    targetBlockIntervalMs: number | null
    analysisWindowBlocks: number
    activeProducerCount: number
    producedLast24h: number | null
    shareLast24hPercent: number | null
    projectedBlocksPerMonth: number | null
    estimatedApyPercent: number | null
    estimatedKoinPerDay: string | null
    estimatedKoinPerMonth: string | null
    koinPriceUsd: number | null
    estimatedUsdPerMonth: number | null
    lastProducedBlockAt: number | null
  }

  type KnodelKoinosNodeProducerRegisterParams = KnodelKoinosNodeSettings & {
    producerAddress?: string
    password?: string
    persistConfig?: boolean
  }

  type KnodelKoinosNodeProducerRegisterResult = {
    ok: boolean
    producerAddress: string
    output: string
    overview: KnodelKoinosNodeProducerOverviewResult
  }

  type KnodelKoinosNodeServiceCommandParams = KnodelKoinosNodeSettings & {
    service: string
  }

  type KnodelKoinosNodeServiceCommandResult = {
    ok: boolean
    action: 'start' | 'stop' | 'restart' | 'kill-conflict'
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

  type KnodelKoinosNodeSelectDirectoryResult = {
    ok: boolean
    canceled: boolean
    path: string
    restoreWorkspaceParent: string
    writable: boolean
    output: string
  }

  type KnodelKoinosNodeValidateBaseDirResult = {
    ok: boolean
    baseDir: string
    restoreWorkspaceParent: string
    writable: boolean
    output: string
  }

  type KnodelKoinosNodeBaseDirCopyParams = KnodelKoinosNodeSettings & {
    sourceBaseDir: string
    targetBaseDir: string
    stopSourceRuntime?: boolean
  }

  type KnodelKoinosNodeBaseDirCopyResult = {
    ok: boolean
    sourceBaseDir: string
    targetBaseDir: string
    output: string
    status: KnodelKoinosNodeStatus
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

  type KnodelKoinosNodeBackupProgressEvent = {
    action: 'restore-backup' | 'restore-backup-verify'
    phase: 'prepare' | 'stop' | 'download' | 'checksum' | 'extract' | 'restore' | 'start' | 'verify' | 'complete' | 'error'
    progress: number
    message: string
  }

  type KnodelKoinosJsonRpcProxyParams = {
    rpcUrl: string
    method: string
    params?: Record<string, unknown>
  }

  type KnodelKoinosJsonRpcProxyResult = {
    ok: boolean
    method: string
    result?: unknown
    output: string
  }

  type KnodelWalletRpcParams = {
    rpcUrl?: string
  }

  type KnodelWalletOverviewResult = {
    ok: boolean
    output: string
    rpcUrl: string
    walletFilePath: string
    walletExists: boolean
    walletAddress: string | null
    walletCreatedAt: string | null
    unlocked: boolean
  }

  type KnodelWalletGenerateResult = {
    ok: boolean
    output: string
    address: string | null
    privateKeyWif: string | null
  }

  type KnodelWalletImportParams = {
    privateKey?: string
    password?: string
  }

  type KnodelWalletImportResult = {
    ok: boolean
    output: string
    address: string | null
    walletFilePath: string
    unlocked: boolean
  }

  type KnodelWalletDeleteResult = {
    ok: boolean
    output: string
    walletFilePath: string
  }

  type KnodelWalletUnlockParams = {
    password?: string
  }

  type KnodelWalletUnlockResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    unlocked: boolean
  }

  type KnodelWalletAddressParams = {
    privateKey?: string
  }

  type KnodelWalletAddressResult = {
    ok: boolean
    output: string
    address: string | null
  }

  type KnodelWalletDeriveFromSeedParams = {
    seedPhrase?: string
    numAccounts?: number
  }

  type KnodelWalletDerivedAccount = {
    index: number
    derivationPath: string
    address: string
    privateKeyWif: string
  }

  type KnodelWalletDeriveFromSeedResult = {
    ok: boolean
    output: string
    accounts: KnodelWalletDerivedAccount[]
  }

  type KnodelWalletAddressQueryParams = KnodelWalletRpcParams & {
    address?: string
  }

  type KnodelWalletBalanceResult = {
    ok: boolean
    output: string
    rpcUrl: string
    address: string | null
    koin: string | null
    vhp: string | null
    mana: string | null
  }

  type KnodelWalletScalarResult = {
    ok: boolean
    output: string
    rpcUrl: string
    address: string | null
    value: string | null
    unit: string
  }

  type KnodelWalletChainInfoResult = {
    ok: boolean
    output: string
    rpcUrl: string
    headHeight: number | null
    headBlockId: string | null
    lastIrreversibleBlock: number | null
    headBlockTime: number | null
  }

  type KnodelWalletBlockParams = KnodelWalletRpcParams & {
    heightOrId?: string
    full?: boolean
  }

  type KnodelWalletBlockOperation = {
    kind: 'call_contract' | 'upload_contract' | 'unknown'
    contractId: string | null
    entryPoint: string | null
  }

  type KnodelWalletBlockTransaction = {
    id: string | null
    payer: string | null
    operationCount: number
    operations: KnodelWalletBlockOperation[]
  }

  type KnodelWalletBlockResult = {
    ok: boolean
    output: string
    rpcUrl: string
    blockHeight: number | null
    blockId: string | null
    previous: string | null
    timestamp: number | null
    signer: string | null
    transactionCount: number
    diskStorageUsed: number | null
    networkBandwidthUsed: number | null
    computeBandwidthUsed: number | null
    transactions: KnodelWalletBlockTransaction[]
  }

  type KnodelWalletTokenBalanceParams = KnodelWalletRpcParams & {
    contractId?: string
    address?: string
  }

  type KnodelWalletTokenBalanceResult = {
    ok: boolean
    output: string
    rpcUrl: string
    contractId: string | null
    address: string | null
    tokenName: string | null
    tokenSymbol: string | null
    decimals: number | null
    balance: string | null
  }

  type KnodelWalletReadContractParams = KnodelWalletRpcParams & {
    contractId?: string
    method?: string
    args?: Record<string, unknown> | string
  }

  type KnodelWalletReadContractResult = {
    ok: boolean
    output: string
    rpcUrl: string
    contractId: string | null
    method: string | null
    args: Record<string, unknown>
    result?: unknown
  }

  type KnodelWalletBurnParams = KnodelWalletRpcParams & {
    percent?: number
    amount?: number
    password?: string
    dryRun?: boolean
  }

  type KnodelWalletBurnResult = {
    ok: boolean
    output: string
    rpcUrl: string
    dryRun: boolean
    walletAddress: string | null
    burnAmountKoin: string | null
    remainingKoin: string | null
    previousKoin: string | null
    previousVhp: string | null
    newKoin: string | null
    newVhp: string | null
    txId: string | null
  }

  type KnodelPublicRpcConfigParams = {
    publicRpcUrls?: string[]
  }

  type KnodelPublicRpcConfigResult = {
    ok: boolean
    output: string
    publicRpcUrls: string[]
  }

  type KnodelApi = {
    version: string
    appConfig?: {
      loadPublicRpcUrls: () => Promise<KnodelPublicRpcConfigResult>
      savePublicRpcUrls: (params?: KnodelPublicRpcConfigParams) => Promise<KnodelPublicRpcConfigResult>
    }
    koinosNode?: {
      defaults: () => Promise<Required<KnodelKoinosNodeSettings>>
      cloneRepo: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCloneRepoResult>
      fileRead: (params: KnodelKoinosNodeFileReadParams) => Promise<KnodelKoinosNodeFileReadResult>
      fileWrite: (params: KnodelKoinosNodeFileWriteParams) => Promise<KnodelKoinosNodeFileWriteResult>
      selectBaseDir: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeSelectDirectoryResult>
      validateBaseDir: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeValidateBaseDirResult>
      copyBaseDirData: (params: KnodelKoinosNodeBaseDirCopyParams) => Promise<KnodelKoinosNodeBaseDirCopyResult>
      status: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeStatus>
      presets: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodePresetsResult>
      nativeBuilds: () => Promise<KnodelKoinosNodeNativeBuildsResult>
      nativeBuildAll: () => Promise<KnodelKoinosNodeNativeBuildCommandResult>
      nativeBuildService: (
        params: KnodelKoinosNodeNativeBuildParams
      ) => Promise<KnodelKoinosNodeNativeBuildCommandResult>
      start: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCommandResult>
      stop: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeCommandResult>
      restoreBackup: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeBackupRestoreResult>
      restoreBackupVerify: (settings?: KnodelKoinosNodeSettings) => Promise<KnodelKoinosNodeBackupRestoreResult>
      rpcCall: (params: KnodelKoinosJsonRpcProxyParams) => Promise<KnodelKoinosJsonRpcProxyResult>
      producerOverview: (
        settings?: KnodelKoinosNodeProducerOverviewParams
      ) => Promise<KnodelKoinosNodeProducerOverviewResult>
      producerRegister: (
        params: KnodelKoinosNodeProducerRegisterParams
      ) => Promise<KnodelKoinosNodeProducerRegisterResult>
      serviceStart: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      serviceStop: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      serviceRestart: (params: KnodelKoinosNodeServiceCommandParams) => Promise<KnodelKoinosNodeServiceCommandResult>
      serviceKillConflict: (
        params: KnodelKoinosNodeServiceCommandParams
      ) => Promise<KnodelKoinosNodeServiceCommandResult>
      presetReconcile: (params: KnodelKoinosNodePresetCommandParams) => Promise<KnodelKoinosNodePresetCommandResult>
      logs: (params?: KnodelKoinosNodeLogsParams) => Promise<KnodelKoinosNodeLogsResult>
      logsFollowStart: (params?: KnodelKoinosNodeLogsParams) => Promise<KnodelKoinosNodeLogsFollowStartResult>
      logsFollowStop: (
        params?: KnodelKoinosNodeLogsFollowStopParams
      ) => Promise<KnodelKoinosNodeLogsFollowStopResult>
      onLogsFollowEvent: (listener: (event: KnodelKoinosNodeLogsFollowEvent) => void) => () => void
      onBackupProgressEvent: (listener: (event: KnodelKoinosNodeBackupProgressEvent) => void) => () => void
    }
    wallet?: {
      overview: (params?: KnodelWalletRpcParams) => Promise<KnodelWalletOverviewResult>
      generate: () => Promise<KnodelWalletGenerateResult>
      importWallet: (params?: KnodelWalletImportParams) => Promise<KnodelWalletImportResult>
      unlock: (params?: KnodelWalletUnlockParams) => Promise<KnodelWalletUnlockResult>
      deleteWallet: () => Promise<KnodelWalletDeleteResult>
      addressFromWif: (params?: KnodelWalletAddressParams) => Promise<KnodelWalletAddressResult>
      deriveFromSeed: (params?: KnodelWalletDeriveFromSeedParams) => Promise<KnodelWalletDeriveFromSeedResult>
      chainInfo: (params?: KnodelWalletRpcParams) => Promise<KnodelWalletChainInfoResult>
      block: (params?: KnodelWalletBlockParams) => Promise<KnodelWalletBlockResult>
      balance: (params?: KnodelWalletAddressQueryParams) => Promise<KnodelWalletBalanceResult>
      vhp: (params?: KnodelWalletAddressQueryParams) => Promise<KnodelWalletScalarResult>
      nonce: (params?: KnodelWalletAddressQueryParams) => Promise<KnodelWalletScalarResult>
      rc: (params?: KnodelWalletAddressQueryParams) => Promise<KnodelWalletScalarResult>
      tokenBalance: (params?: KnodelWalletTokenBalanceParams) => Promise<KnodelWalletTokenBalanceResult>
      readContract: (params?: KnodelWalletReadContractParams) => Promise<KnodelWalletReadContractResult>
      burn: (params?: KnodelWalletBurnParams) => Promise<KnodelWalletBurnResult>
    }
  }

  interface Window {
    knodel?: KnodelApi
  }
}
