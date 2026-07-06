export {}

declare global {
  type TelenoNodeServiceRuntime = 'native'
  type TelenoNetworkId = 'mainnet' | 'testnet' | 'custom'
  type TelenoNativeBuildSystem = 'cmake' | 'go' | 'yarn'

  type TelenoNodeBackupAuthMethod = 'private-key' | 'password-file' | 'env-password'

  type TelenoNodeBackupSettings = {
    localEnabled?: boolean
    localDirectory?: string
    workspace?: string
    localRetentionCount?: number
    remoteEnabled?: boolean
    remoteDirectory?: string
    remoteRetentionCount?: number
    remoteRetentionDays?: number
    uploadTempSuffix?: string
    sshHost?: string
    sshPort?: number
    sshUser?: string
    sshAuth?: TelenoNodeBackupAuthMethod
    sshPrivateKeyFile?: string
    sshPasswordFile?: string
    sshPassphraseFile?: string
    sshKnownHostsFile?: string
    sshStrictHostKeyChecking?: boolean
    sshConnectTimeoutSeconds?: number
    scheduleEnabled?: boolean
    scheduleInterval?: string
    scheduleRunOnStartupIfMissed?: boolean
    scheduleJitterSeconds?: number
    scheduleMinimumHeadProgress?: number
    scheduleSkipIfSyncingFromGenesis?: boolean
    scheduleMaxConcurrentBackups?: number
    adminEnabled?: boolean
    adminListen?: string
    adminTokenFile?: string
    adminJobs?: number
  }

  type TelenoNodeServicePort = {
    host: string | null
    publishedPort: number | null
    targetPort: number | null
    protocol: string
    label: string
  }

  type TelenoNodeSettings = {
    network?: TelenoNetworkId
    repoPath?: string
    composeFile?: string
    envFile?: string
    baseDir?: string
    profiles?: string[]
    blockchainBackupUrl?: string
    backup?: TelenoNodeBackupSettings
    runtimeMode?: TelenoNodeServiceRuntime
  }

  type TelenoNodeBackupPasswordFileParams = {
    network?: TelenoNetworkId
    password?: string
  }

  type TelenoNodeBackupPasswordFileResult = {
    ok: boolean
    output: string
    filePath: string | null
  }

  type TelenoLaunchDefaults = {
    nodeSettings?: Partial<TelenoNodeSettings>
  }

  type TelenoAppPreferences = {
    keepRunningInMenuBar: boolean
  }

  type TelenoAppPreferencesResult = {
    ok: boolean
    output: string
    filePath: string
    preferences: TelenoAppPreferences
  }

  type TelenoFirstRunSetupState = {
    ok: boolean
    completed: boolean
    filePath?: string
    completedAt?: string | null
    setup?: unknown
    source?: 'file' | 'missing' | 'unreadable' | 'migrated-existing-setup' | 'reset'
    migrated?: boolean
    migrationReason?: string | null
    installChangedSinceCompletion?: boolean
    install?: {
      appName?: string
      appVersion?: string
      appPath?: string
      packaged?: boolean
      mtimeMs?: number | null
      birthtimeMs?: number | null
    }
  }

  type TelenoNodeServiceStatus = {
    id: string
    name: string
    service: string
    runtimeName: string
    runtimeType: TelenoNodeServiceRuntime
    binaryPath?: string | null
    configPath?: string | null
    logPath?: string | null
    version: string | null
    state: string
    status: string
    ports: TelenoNodeServicePort[]
    dependsOn: string[]
    lastError: string | null
    nativePid: number | null
    conflictPids: number[]
    managedByTeleno: boolean
  }

  type TelenoNodePresetSource = 'profile' | 'features'

  type TelenoNodePreset = {
    id: string
    label: string
    network?: TelenoNetworkId
    source: TelenoNodePresetSource
    profiles: string[]
    services: string[]
    featureFlags?: Record<string, boolean>
    description: string
  }

  type TelenoNodeComponentHealth = {
    name: string
    enabled: boolean
    healthy: boolean
    state?: 'running' | 'passive' | 'waiting' | 'disabled' | 'stopped'
    details?: string
  }

  type TelenoNodeStatus = {
    ok: boolean
    network?: TelenoNetworkId
    dockerAvailable: boolean
    runtimeMode: TelenoNodeServiceRuntime
    availableRuntimeModes: TelenoNodeServiceRuntime[]
    repoPath: string
    composeFile: string
    envFile: string
    baseDir: string
    profiles: string[]
    configReady: boolean
    configDir: string
    services: TelenoNodeServiceStatus[]
    components: TelenoNodeComponentHealth[]
    runningServices: number
    output: string
  }

  type TelenoNodePresetsResult = {
    ok: boolean
    presets: TelenoNodePreset[]
    output: string
  }

  type TelenoNodeCommandResult = {
    ok: boolean
    action: 'start' | 'stop'
    output: string
    status: TelenoNodeStatus
  }

  type TelenoNodeBackupRestoreResult = {
    ok: boolean
    action: 'restore-backup' | 'restore-backup-verify' | 'create-backup'
    output: string
    status: TelenoNodeStatus | string
  }

  type TelenoNodeNativeBackupDryRunResult = {
    ok: boolean
    output: string
    configPath?: string
    repositoryDir?: string
    workspaceDir?: string
  }

  type TelenoNodeNativeBackupRestoreInput = TelenoNodeSettings & {
    backupId?: string
    backupSource?: 'local' | 'remote' | 'public' | 'auto'
  }

  type TelenoNodeNativeBackupPurgeInput = TelenoNodeSettings & {
    backupId?: string
    backupSource?: 'local' | 'remote'
  }

  type TelenoNodeNativeBackupPurgeResult = {
    ok: boolean
    output: string
    backupId: string
    source: 'local' | 'remote'
    configPath?: string
    repositoryDir?: string
    workspaceDir?: string
  }

  type TelenoNodeNativeBackupRestoreSpace = {
    restoredDatabaseBytes: number
    runtimeFilesBytes: number
    objectDownloadBytes: number
    minimumTargetFreeBytes: number
    recommendedTargetFreeBytes: number
  }

  type TelenoNodeNativeBackupSnapshot = {
    backupId: string
    createdAt: string
    latest: boolean
    complete: boolean
    nodeId: string
    nodeVersion: string
    storageLayout: string
    publicBootstrap: boolean
    network: string
    chainId: string
    publicBaseUrl: string
    promotedAt: string
    sourceBackupId: string
    sourceCreatedAt: string
    sourceNodeVersion: string
    sourceHeadHeight: number
    sourceLibHeight: number
    repositoryDir: string
    snapshotDir: string
    manifest: string
    files: string
    fileCount: number
    objectCount: number
    totalBytes: number
    restoreSpace: TelenoNodeNativeBackupRestoreSpace
  }

  type TelenoNodeNativeBackupRemoteSpace = {
    ok: boolean
    availableBytes: number
    targetPath: string
    message: string
  }

  type TelenoNodeNativeBackupListResult = {
    ok: boolean
    output: string
    source?: 'local' | 'remote' | 'public'
    configPath?: string
    repositoryDir?: string
    workspaceDir?: string
    latestBackupId: string
    remoteSpace?: TelenoNodeNativeBackupRemoteSpace
    snapshots: TelenoNodeNativeBackupSnapshot[]
  }

  type TelenoNodeNativeBackupConfigResult = {
    ok: boolean
    output: string
    configPath?: string
    repositoryDir?: string
    workspaceDir?: string
    backup?: TelenoNodeBackupSettings
  }

  type TelenoNodeNativeBackupPreflightResult = {
    ok: boolean
    output: string
    configPath?: string
    repositoryDir?: string
    workspaceDir?: string
    backupId: string
    readyToRestore: boolean
    snapshotComplete: boolean
    fileCount: number
    missingObjectCount: number
    missingObjectBytes: number
    restoreSpace: TelenoNodeNativeBackupRestoreSpace
    spaceCheck: {
      passesMinimum: boolean
      belowRecommended: boolean
      availableBytes: number
      targetPath: string
      message: string
    }
  }

  type TelenoNodeProducerAddressSource = 'config' | 'vault' | 'none'

  type TelenoNodeProducerRegistrationStatus =
    | 'missing-address'
    | 'missing-local-key'
    | 'match'
    | 'mismatch'
    | 'unregistered'

  type TelenoNodeProducerOverviewParams = TelenoNodeSettings & {
    producerAddress?: string
    rpcUrl?: string
  }

  type TelenoNodeProducerRegisteredKeyParams = TelenoNodeSettings & {
    producerAddress?: string
    rpcUrl?: string
  }

  type TelenoNodeProducerLocalInfoResult = {
    ok: boolean
    output: string
    producerAddress: string | null
    configFilePath: string | null
    configHasProducer: boolean
    localPublicKey: string | null
    localPublicKeyPath: string | null
    localPrivateKeyPath: string | null
  }

  type TelenoNodeProducerRegisteredKeyResult = {
    ok: boolean
    output: string
    rpcUrl: string
    rpcSource: 'public' | 'local'
    producerAddress: string | null
    registeredPublicKey: string | null
  }

  type TelenoNodeProducerOverviewResult = {
    ok: boolean
    output: string
    rpcUrl: string
    rpcSource: 'public' | 'local'
    priceSourceName: string
    priceSourceUrl: string
    producerAddress: string | null
    producerAddressSource: TelenoNodeProducerAddressSource
    configFilePath: string
    configHasProducer: boolean
    walletAddress: string | null
    walletExists: boolean
    localPublicKey: string | null
    localPublicKeyPath: string | null
    localPrivateKeyPath: string | null
    registeredPublicKey: string | null
    registrationStatus: TelenoNodeProducerRegistrationStatus
    koinBalance: string | null
    vhpBalance: string | null
    mana: string | null
    totalKoinSupply: string | null
    totalVhpSupply: string | null
    totalVirtualSupply: string | null
    targetBlockIntervalMs: number | null
    analysisWindowBlocks: number
    activeProducerCount: number | null
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

  type TelenoNodeProducerRegisterParams = TelenoNodeSettings & {
    producerAddress?: string
    rpcUrl?: string
    signerAccountId?: string
    allowDelegatedSigner?: boolean
    password?: string
    persistConfig?: boolean
    persistProfile?: boolean
  }

  type TelenoNodeProducerRegisterResult = {
    ok: boolean
    producerAddress: string
    output: string
    overview: TelenoNodeProducerOverviewResult
  }

  type TelenoNodeProducerDeleteResult = {
    ok: boolean
    output: string
    overview: TelenoNodeProducerOverviewResult
    profile: TelenoProducerProfile | null
  }

  type TelenoNodeDashboardProducersParams = TelenoNodeSettings & {
    rpcUrl?: string
    windowBlocks?: number
  }

  type TelenoNodeDashboardProducerRow = {
    signer: string
    koinBalance: string | null
    vhpBalance: string | null
    blocks: number
    sharePercent: number
    lastBlockHeight: number
    lastProducedBlockAt: number | null
  }

  type TelenoNodeDashboardProducersResult = {
    ok: boolean
    output: string
    rpcUrl: string
    rpcSource: 'public' | 'local'
    windowBlocks: number
    analyzedBlocks: number
    headHeight: number | null
    rows: TelenoNodeDashboardProducerRow[]
  }

  type TelenoNodeDashboardPeerRow = {
    address: string
    peerId: string | null
    host: string | null
    port: number | null
  }

  type TelenoNodeDashboardPeersResult = {
    ok: boolean
    output: string
    service: string
    source: 'p2p-live' | 'p2p-log'
    snapshotAt: number | null
    selfAddress: string | null
    omittedPeerCount: number
    rows: TelenoNodeDashboardPeerRow[]
  }

  type TelenoNodeDashboardPerformanceRow = {
    id: string
    label: string
    kind: 'teleno' | 'service'
    serviceId: string | null
    pid: number | null
    cpuPercent: number | null
    rssBytes: number | null
    virtualBytes: number | null
    uptimeSeconds: number | null
    state: string | null
    command: string | null
    managedByTeleno: boolean
  }

  type TelenoNodeDashboardPerformanceHost = {
    cpuCount: number
    totalMemoryBytes: number
    freeMemoryBytes: number
    loadAverage: number[]
    uptimeSeconds: number
    freeDiskBytes: number | null
    totalDiskBytes: number | null
    nodeVolumeName: string | null
    nodeVolumePath: string | null
    nodeVolumeFilesystem: string | null
    blockchainDataBytes: number | null
    blockchainDataPath: string | null
  }

  type TelenoNodeDashboardPerformanceTotals = {
    telenoCpuPercent: number | null
    telenoMemoryBytes: number | null
    servicesCpuPercent: number | null
    servicesMemoryBytes: number | null
  }

  type TelenoNodeDashboardPerformanceResult = {
    ok: boolean
    output: string
    sampledAt: number
    host: TelenoNodeDashboardPerformanceHost
    totals: TelenoNodeDashboardPerformanceTotals
    rows: TelenoNodeDashboardPerformanceRow[]
  }

  type TelenoProducerProfile = {
    producerAddress: string
    registrationSignerAccountId: string
    burnAccountId: string
    localPublicKey: string
    localPublicKeyPath: string
    registeredPublicKey: string | null
    lastRegistrationTxId: string | null
    updatedAt: string
  }

  type TelenoNodeProducerProfileResult = {
    ok: boolean
    output: string
    profileFilePath: string
    profile: TelenoProducerProfile | null
  }

  type TelenoNodeComponentToggleParams = TelenoNodeSettings & {
    component: string
    enabled: boolean
  }

  type TelenoNodeComponentToggleResult = {
    ok: boolean
    component: string
    enabled: boolean
    output: string
    status: TelenoNodeStatus
  }

  type TelenoNodeServiceCommandParams = TelenoNodeSettings & {
    service: string
  }

  type TelenoNodeServiceCommandResult = {
    ok: boolean
    action: 'start' | 'stop' | 'restart' | 'kill-conflict'
    service: string
    output: string
    status: TelenoNodeStatus
  }

  type TelenoNodePresetCommandParams = TelenoNodeSettings & {
    presetId: string
  }

  type TelenoNodePresetCommandResult = {
    ok: boolean
    action: 'reconcile'
    presetId: string
    output: string
    status: TelenoNodeStatus
  }

  type TelenoNodeNativeBuildStatus = {
    serviceId: string
    serviceName: string
    supported: boolean
    buildSystem: TelenoNativeBuildSystem | null
    repoPath: string | null
    repoExists: boolean
    artifactPath: string | null
    artifactExists: boolean
    artifactUpdatedAt: number | null
    buildable: boolean
    note: string | null
    buildCommands: string[]
  }

  type TelenoNodeNativeBuildsResult = {
    ok: boolean
    sourceRoot: string
    services: TelenoNodeNativeBuildStatus[]
    output: string
  }

  type TelenoNodeNativeBuildParams = {
    serviceId?: string
  }

  type TelenoNodeNativeBuildCommandResult = {
    ok: boolean
    action: 'build-all' | 'build-service'
    serviceId: string | null
    output: string
    builds: TelenoNodeNativeBuildsResult
  }

  type TelenoNodeCloneRepoResult = {
    ok: boolean
    repoPath: string
    output: string
  }

  type TelenoNodeManagedFileKind = 'compose' | 'env' | 'config'

  type TelenoNodeFileReadParams = TelenoNodeSettings & {
    kind: TelenoNodeManagedFileKind
  }

  type TelenoNodeFileReadResult = {
    ok: boolean
    kind: TelenoNodeManagedFileKind
    filePath: string
    content: string
    output: string
  }

  type TelenoNodeFileWriteParams = TelenoNodeSettings & {
    kind: TelenoNodeManagedFileKind
    content?: string
  }

  type TelenoNodeFileWriteResult = {
    ok: boolean
    kind: TelenoNodeManagedFileKind
    filePath: string
    output: string
  }

  type TelenoNodeSelectDirectoryResult = {
    ok: boolean
    canceled: boolean
    path: string
    restoreWorkspaceParent: string
    writable: boolean
    localCopy?: TelenoNodeBaseDirLocalCopy
    output: string
  }

  type TelenoNodeBaseDirLocalCopy = {
    detected: boolean
    evidence: string[]
    newestModifiedMs: number | null
    totalBytes: number | null
    scannedEntries: number
    truncated: boolean
  }

  type TelenoNodeValidateBaseDirResult = {
    ok: boolean
    baseDir: string
    restoreWorkspaceParent: string
    writable: boolean
    localCopy?: TelenoNodeBaseDirLocalCopy
    output: string
  }

  type TelenoNodeBaseDirCopyParams = TelenoNodeSettings & {
    sourceBaseDir: string
    targetBaseDir: string
    stopSourceRuntime?: boolean
  }

  type TelenoNodeBaseDirCopyResult = {
    ok: boolean
    sourceBaseDir: string
    targetBaseDir: string
    output: string
    status: TelenoNodeStatus
  }

  type TelenoNodeLogsParams = TelenoNodeSettings & {
    service?: string
    tail?: number
  }

  type TelenoNodeLogsResult = {
    ok: boolean
    service: string | null
    tail: number
    output: string
  }

  type TelenoNodeLogsFollowStartResult = {
    ok: boolean
    streamId: string
    service: string | null
    tail: number
    output?: string
  }

  type TelenoNodeLogsFollowStopParams = {
    streamId?: string
  }

  type TelenoNodeLogsFollowStopResult = {
    ok: boolean
    streamId: string | null
  }

  type TelenoNodeLogsFollowEvent = {
    streamId: string
    type: 'start' | 'chunk' | 'end' | 'error'
    service?: string | null
    tail?: number
    chunk?: string
    code?: number | null
    message?: string
  }

  type TelenoNodeBackupProgressEvent = {
    action: 'restore-backup' | 'restore-backup-verify' | 'create-backup'
    phase: 'prepare' | 'stop' | 'download' | 'checksum' | 'extract' | 'restore' | 'compress' | 'save' | 'upload' | 'start' | 'verify' | 'complete' | 'cancelled' | 'error'
    progress: number
    message: string
    completedBytes?: number | null
    totalBytes?: number | null
    bytesPerSecond?: number | null
    etaSeconds?: number | null
    completedBatches?: number | null
    totalBatches?: number | null
    phaseProgress?: number | null
    progressRangeStart?: number | null
    progressRangeEnd?: number | null
  }

  type TelenoJsonRpcProxyParams = {
    rpcUrl: string
    method: string
    params?: Record<string, unknown>
  }

  type TelenoJsonRpcProxyResult = {
    ok: boolean
    method: string
    result?: unknown
    output: string
  }

  type TelenoWalletRpcParams = {
    network?: TelenoNetworkId
    rpcUrl?: string
    baseDir?: string
  }

  type TelenoWalletAccountKind = 'derived' | 'imported-wif' | 'watch-only'

  type TelenoWalletAccountSummary = {
    id: string
    name: string
    kind: TelenoWalletAccountKind
    address: string
    derivationPath: string | null
    createdAt: string
    updatedAt: string | null
    hasPrivateKey: boolean
    isActive: boolean
  }

  type TelenoWalletOverviewResult = {
    ok: boolean
    output: string
    rpcUrl: string
    walletFilePath: string
    walletExists: boolean
    walletAddress: string | null
    walletCreatedAt: string | null
    activeAccountId: string | null
    activeAccountName: string | null
    activeAccountKind: TelenoWalletAccountKind | null
    accountCount: number
    accounts: TelenoWalletAccountSummary[]
    unlocked: boolean
    hasSeedPhrase: boolean
  }

  type TelenoWalletGenerateResult = {
    ok: boolean
    output: string
    address: string | null
    privateKeyWif: string | null
    seedPhrase: string | null
    derivationPath: string | null
  }

  type TelenoWalletImportParams = TelenoWalletRpcParams & {
    privateKey?: string
    password?: string
    seedPhrase?: string
    derivationPath?: string
  }

  type TelenoWalletImportResult = {
    ok: boolean
    output: string
    address: string | null
    walletFilePath: string
    unlocked: boolean
  }

  type TelenoWalletDeleteResult = {
    ok: boolean
    output: string
    walletFilePath: string
  }

  type TelenoWalletCloseResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    unlocked: boolean
  }

  type TelenoWalletUnlockParams = TelenoWalletRpcParams & {
    password?: string
  }

  type TelenoWalletUnlockResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    unlocked: boolean
  }

  type TelenoWalletAddressParams = {
    privateKey?: string
  }

  type TelenoWalletAddressResult = {
    ok: boolean
    output: string
    address: string | null
  }

  type TelenoWalletDeriveFromSeedParams = {
    seedPhrase?: string
    numAccounts?: number
  }

  type TelenoWalletDerivedAccount = {
    index: number
    derivationPath: string
    address: string
    privateKeyWif: string
  }

  type TelenoWalletDeriveFromSeedResult = {
    ok: boolean
    output: string
    accounts: TelenoWalletDerivedAccount[]
  }

  type TelenoWalletShowSeedResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    accountId: string | null
    accountName: string | null
    accountKind: TelenoWalletAccountKind | null
    firstAccountAddress: string | null
    firstAccountPrivateKeyWif: string | null
    firstAccountDerivationPath: string | null
    seedPhrase: string | null
  }

  type TelenoWalletAddressQueryParams = TelenoWalletRpcParams & {
    address?: string
    accountId?: string
  }

  type TelenoWalletListAccountsResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    activeAccountId: string | null
    accounts: TelenoWalletAccountSummary[]
  }

  type TelenoWalletSetActiveAccountParams = TelenoWalletRpcParams & {
    accountId?: string
  }

  type TelenoWalletSetActiveAccountResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    activeAccountId: string | null
    activeAccount: TelenoWalletAccountSummary | null
  }

  type TelenoWalletSetProducerAccountParams = TelenoWalletSetActiveAccountParams

  type TelenoWalletSetProducerAccountResult = TelenoWalletSetActiveAccountResult & {
    configPath: string | null
  }

  type TelenoWalletCreateDerivedAccountParams = TelenoWalletRpcParams & {
    name?: string
  }

  type TelenoWalletAccountMutationResult = {
    ok: boolean
    output: string
    walletAddress: string | null
    activeAccountId: string | null
    account: TelenoWalletAccountSummary | null
    accounts: TelenoWalletAccountSummary[]
  }

  type TelenoWalletImportAccountParams = TelenoWalletRpcParams & {
    name?: string
    privateKey?: string
    password?: string
  }

  type TelenoWalletImportWatchAccountParams = TelenoWalletRpcParams & {
    name?: string
    address?: string
  }

  type TelenoWalletRenameAccountParams = TelenoWalletRpcParams & {
    accountId?: string
    name?: string
  }

  type TelenoWalletRemoveAccountParams = TelenoWalletRpcParams & {
    accountId?: string
  }

  type TelenoWalletBalanceResult = {
    ok: boolean
    output: string
    rpcUrl: string
    address: string | null
    koin: string | null
    vhp: string | null
    mana: string | null
  }

  type TelenoWalletScalarResult = {
    ok: boolean
    output: string
    rpcUrl: string
    address: string | null
    value: string | null
    unit: string
  }

  type TelenoWalletChainInfoResult = {
    ok: boolean
    output: string
    rpcUrl: string
    headHeight: number | null
    headBlockId: string | null
    lastIrreversibleBlock: number | null
    headBlockTime: number | null
  }

  type TelenoWalletBlockParams = TelenoWalletRpcParams & {
    heightOrId?: string
    full?: boolean
  }

  type TelenoWalletBlockOperation = {
    kind: 'call_contract' | 'upload_contract' | 'unknown'
    contractId: string | null
    entryPoint: string | null
  }

  type TelenoWalletBlockTransaction = {
    id: string | null
    payer: string | null
    operationCount: number
    operations: TelenoWalletBlockOperation[]
  }

  type TelenoWalletBlockResult = {
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
    transactions: TelenoWalletBlockTransaction[]
  }

  type TelenoWalletTokenBalanceParams = TelenoWalletRpcParams & {
    contractId?: string
    address?: string
    accountId?: string
  }

  type TelenoWalletTokenBalanceResult = {
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

  type TelenoWalletReadContractParams = TelenoWalletRpcParams & {
    contractId?: string
    method?: string
    args?: Record<string, unknown> | string
  }

  type TelenoWalletReadContractResult = {
    ok: boolean
    output: string
    rpcUrl: string
    contractId: string | null
    method: string | null
    args: Record<string, unknown>
    result?: unknown
  }

  type TelenoWalletBurnParams = TelenoWalletRpcParams & {
    percent?: number
    amount?: number
    accountId?: string
    targetAddress?: string
    useProducerBurnAccount?: boolean
    useFreeMana?: boolean
    password?: string
    dryRun?: boolean
  }

  type TelenoWalletBurnResult = {
    ok: boolean
    output: string
    rpcUrl: string
    dryRun: boolean
    walletAddress: string | null
    targetAddress: string | null
    burnAmountKoin: string | null
    remainingKoin: string | null
    previousKoin: string | null
    previousVhp: string | null
    newKoin: string | null
    newVhp: string | null
    usedFreeMana: boolean
    payer: string | null
    txId: string | null
  }

  type TelenoWalletTransferVhpParams = TelenoWalletRpcParams & {
    toAddress?: string
    amount?: number
    accountId?: string
    useFreeMana?: boolean
    password?: string
    dryRun?: boolean
  }

  type TelenoWalletTransferVhpResult = {
    ok: boolean
    output: string
    rpcUrl: string
    dryRun: boolean
    fromAddress: string | null
    toAddress: string | null
    amountVhp: string | null
    usedFreeMana: boolean
    payer: string | null
    txId: string | null
  }

  type TelenoWalletTransferKoinParams = TelenoWalletRpcParams & {
    toAddress?: string
    amount?: number
    accountId?: string
    useFreeMana?: boolean
    password?: string
    dryRun?: boolean
  }

  type TelenoWalletTransferKoinResult = {
    ok: boolean
    output: string
    rpcUrl: string
    dryRun: boolean
    fromAddress: string | null
    toAddress: string | null
    amountKoin: string | null
    usedFreeMana: boolean
    payer: string | null
    txId: string | null
  }

  type TelenoPublicRpcConfigParams = {
    network?: TelenoNetworkId
    publicRpcUrls?: string[]
    publicRpcUrlsByNetwork?: Partial<Record<TelenoNetworkId, string[]>>
  }

  type TelenoPublicRpcConfigResult = {
    ok: boolean
    output: string
    network?: TelenoNetworkId
    publicRpcUrls: string[]
    publicRpcUrlsByNetwork?: Partial<Record<TelenoNetworkId, string[]>>
  }

  type TelenoRemoteInventoryResult = {
    ok: boolean
    output: string
    filePath: string
    inventory: unknown
  }

  type TelenoRemoteReceiptsResult = {
    ok: boolean
    output: string
    filePath: string
    receipts: unknown[]
  }

  type TelenoRemoteExecutionResult = {
    ok: boolean
    output: string
    receipt: unknown
  }

  type TelenoRemoteExecutionStepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped'

  type TelenoRemoteExecutionHealthSnapshot = {
    state: string
    checkedAt: string
    summary: string
    stopCriteria: string[]
  }

  type TelenoRemoteExecutionProgressEvent = {
    event: 'remote-execution-progress'
    planId: string
    nodeId: string
    network: string
    action: string
    stepIndex: number
    stepCount: number
    phase: string
    status: TelenoRemoteExecutionStepStatus
    startedAt: string | null
    completedAt: string | null
    exitCode: number | null
    health: TelenoRemoteExecutionHealthSnapshot | null
    outputExcerpt: string
  }

  type TelenoBuildInfoNativeNode = {
    binaryName: string
    semanticVersion: string | null
    releaseTag: string | null
    buildVersion: string | null
    versionOutput: string | null
    sha256: string | null
    shortSha256: string | null
    sizeBytes: number | null
    mtime: string | null
  }

  type TelenoBuildInfo = {
    schemaVersion: number
    productVersion: string
    releaseChannel: string
    buildTimestamp: string | null
    gitCommit: string | null
    gitShortCommit: string | null
    gitBranch: string | null
    gitDirty: boolean | null
    nativeNode: TelenoBuildInfoNativeNode
    source: 'generated' | 'runtime'
  }

  type TelenoApi = {
    version: string
    buildInfo?: TelenoBuildInfo
    launchDefaults?: TelenoLaunchDefaults
    app?: {
      quit: () => Promise<{ ok: boolean }>
      firstRunSetupState?: () => Promise<TelenoFirstRunSetupState>
      completeFirstRunSetup?: (params?: unknown) => Promise<TelenoFirstRunSetupState>
      resetFirstRunSetup?: () => Promise<TelenoFirstRunSetupState>
    }
    appConfig?: {
      loadPreferences?: () => Promise<TelenoAppPreferencesResult>
      savePreferences?: (params?: Partial<TelenoAppPreferences>) => Promise<TelenoAppPreferencesResult>
      loadPublicRpcUrls: () => Promise<TelenoPublicRpcConfigResult>
      savePublicRpcUrls: (params?: TelenoPublicRpcConfigParams) => Promise<TelenoPublicRpcConfigResult>
    }
    remoteNodes?: {
      loadInventory: () => Promise<TelenoRemoteInventoryResult>
      saveInventory: (params?: unknown) => Promise<TelenoRemoteInventoryResult>
      loadReceipts: () => Promise<TelenoRemoteReceiptsResult>
      appendReceipt: (params?: unknown) => Promise<TelenoRemoteReceiptsResult>
      executePlan: (params?: unknown) => Promise<TelenoRemoteExecutionResult>
      onExecutionProgressEvent: (listener: (event: TelenoRemoteExecutionProgressEvent) => void) => () => void
    }
    telenoNode?: {
      defaults: () => Promise<Required<TelenoNodeSettings>>
      saveBackupPasswordFile?: (
        params?: TelenoNodeBackupPasswordFileParams
      ) => Promise<TelenoNodeBackupPasswordFileResult>
      cloneRepo: (settings?: TelenoNodeSettings) => Promise<TelenoNodeCloneRepoResult>
      fileRead: (params: TelenoNodeFileReadParams) => Promise<TelenoNodeFileReadResult>
      fileWrite: (params: TelenoNodeFileWriteParams) => Promise<TelenoNodeFileWriteResult>
      selectBaseDir: (settings?: TelenoNodeSettings) => Promise<TelenoNodeSelectDirectoryResult>
      validateBaseDir: (settings?: TelenoNodeSettings) => Promise<TelenoNodeValidateBaseDirResult>
      copyBaseDirData: (params: TelenoNodeBaseDirCopyParams) => Promise<TelenoNodeBaseDirCopyResult>
      status: (settings?: TelenoNodeSettings) => Promise<TelenoNodeStatus>
      presets: (settings?: TelenoNodeSettings) => Promise<TelenoNodePresetsResult>
      nativeBuilds: () => Promise<TelenoNodeNativeBuildsResult>
      nativeBuildAll: () => Promise<TelenoNodeNativeBuildCommandResult>
      nativeBuildService: (
        params: TelenoNodeNativeBuildParams
      ) => Promise<TelenoNodeNativeBuildCommandResult>
      start: (settings?: TelenoNodeSettings) => Promise<TelenoNodeCommandResult>
      stop: (settings?: TelenoNodeSettings) => Promise<TelenoNodeCommandResult>
      restoreBackup: (settings?: TelenoNodeSettings) => Promise<TelenoNodeBackupRestoreResult>
      restoreBackupVerify: (settings?: TelenoNodeSettings) => Promise<TelenoNodeBackupRestoreResult>
      createBackup: (settings?: TelenoNodeSettings) => Promise<TelenoNodeBackupRestoreResult>
      nativeBackupDryRun: (settings?: TelenoNodeSettings) => Promise<TelenoNodeNativeBackupDryRunResult>
      nativeBackupConfig: (settings?: TelenoNodeSettings) => Promise<TelenoNodeNativeBackupConfigResult>
      nativeBackupList: (settings?: TelenoNodeSettings & { remote?: boolean; public?: boolean }) => Promise<TelenoNodeNativeBackupListResult>
      nativeBackupPurge: (settings?: TelenoNodeNativeBackupPurgeInput) => Promise<TelenoNodeNativeBackupPurgeResult>
      nativeBackupRestorePreflight: (settings?: TelenoNodeNativeBackupRestoreInput) => Promise<TelenoNodeNativeBackupPreflightResult>
      restoreNativeBackup: (settings?: TelenoNodeNativeBackupRestoreInput) => Promise<TelenoNodeBackupRestoreResult>
      restoreNativeBackupLatest: (settings?: TelenoNodeSettings) => Promise<TelenoNodeBackupRestoreResult>
      cancelCreateBackup: () => Promise<{ ok: boolean; output: string }>
      restoreLocalBackup: (settings?: TelenoNodeSettings) => Promise<TelenoNodeBackupRestoreResult>
      getVerifyBlocks: (settings?: TelenoNodeSettings) => Promise<{ ok: boolean; enabled: boolean | null; output: string }>
      setVerifyBlocks: (settings?: TelenoNodeSettings & { enabled?: boolean }) => Promise<{ ok: boolean; output: string }>
      rpcCall: (params: TelenoJsonRpcProxyParams) => Promise<TelenoJsonRpcProxyResult>
      dashboardProducers: (
        params?: TelenoNodeDashboardProducersParams
      ) => Promise<TelenoNodeDashboardProducersResult>
      dashboardPeers: (params?: TelenoNodeSettings) => Promise<TelenoNodeDashboardPeersResult>
      dashboardPerformance: (
        params?: TelenoNodeSettings
      ) => Promise<TelenoNodeDashboardPerformanceResult>
      producerLocalInfo: (settings?: TelenoNodeSettings) => Promise<TelenoNodeProducerLocalInfoResult>
      producerRegisteredKey: (
        settings?: TelenoNodeProducerRegisteredKeyParams
      ) => Promise<TelenoNodeProducerRegisteredKeyResult>
      producerOverview: (
        settings?: TelenoNodeProducerOverviewParams
      ) => Promise<TelenoNodeProducerOverviewResult>
      producerRegister: (
        params: TelenoNodeProducerRegisterParams
      ) => Promise<TelenoNodeProducerRegisterResult>
      producerProfileGet: () => Promise<TelenoNodeProducerProfileResult>
      producerProfileClear: () => Promise<TelenoNodeProducerProfileResult>
      producerDelete: (settings?: TelenoNodeSettings) => Promise<TelenoNodeProducerDeleteResult>
      serviceStart: (params: TelenoNodeServiceCommandParams) => Promise<TelenoNodeServiceCommandResult>
      serviceStop: (params: TelenoNodeServiceCommandParams) => Promise<TelenoNodeServiceCommandResult>
      serviceRestart: (params: TelenoNodeServiceCommandParams) => Promise<TelenoNodeServiceCommandResult>
      serviceKillConflict: (
        params: TelenoNodeServiceCommandParams
      ) => Promise<TelenoNodeServiceCommandResult>
      componentToggle: (
        params: TelenoNodeComponentToggleParams
      ) => Promise<TelenoNodeComponentToggleResult>
      presetReconcile: (params: TelenoNodePresetCommandParams) => Promise<TelenoNodePresetCommandResult>
      logs: (params?: TelenoNodeLogsParams) => Promise<TelenoNodeLogsResult>
      logsFollowStart: (params?: TelenoNodeLogsParams) => Promise<TelenoNodeLogsFollowStartResult>
      logsFollowStop: (
        params?: TelenoNodeLogsFollowStopParams
      ) => Promise<TelenoNodeLogsFollowStopResult>
      onLogsFollowEvent: (listener: (event: TelenoNodeLogsFollowEvent) => void) => () => void
      onBackupProgressEvent: (listener: (event: TelenoNodeBackupProgressEvent) => void) => () => void
    }
    wallet?: {
      overview: (params?: TelenoWalletRpcParams) => Promise<TelenoWalletOverviewResult>
      generate: () => Promise<TelenoWalletGenerateResult>
      importWallet: (params?: TelenoWalletImportParams) => Promise<TelenoWalletImportResult>
      listAccounts: () => Promise<TelenoWalletListAccountsResult>
      setActiveAccount: (params?: TelenoWalletSetActiveAccountParams) => Promise<TelenoWalletSetActiveAccountResult>
      setProducerAccount: (
        params?: TelenoWalletSetProducerAccountParams
      ) => Promise<TelenoWalletSetProducerAccountResult>
      createDerivedAccount: (
        params?: TelenoWalletCreateDerivedAccountParams
      ) => Promise<TelenoWalletAccountMutationResult>
      importAccount: (params?: TelenoWalletImportAccountParams) => Promise<TelenoWalletAccountMutationResult>
      importWatchAccount: (
        params?: TelenoWalletImportWatchAccountParams
      ) => Promise<TelenoWalletAccountMutationResult>
      renameAccount: (params?: TelenoWalletRenameAccountParams) => Promise<TelenoWalletAccountMutationResult>
      removeAccount: (params?: TelenoWalletRemoveAccountParams) => Promise<TelenoWalletAccountMutationResult>
      unlock: (params?: TelenoWalletUnlockParams) => Promise<TelenoWalletUnlockResult>
      closeWallet: (params?: TelenoWalletRpcParams) => Promise<TelenoWalletCloseResult>
      deleteWallet: (params?: TelenoWalletRpcParams) => Promise<TelenoWalletDeleteResult>
      addressFromWif: (params?: TelenoWalletAddressParams) => Promise<TelenoWalletAddressResult>
      deriveFromSeed: (params?: TelenoWalletDeriveFromSeedParams) => Promise<TelenoWalletDeriveFromSeedResult>
      showSeed: (params?: TelenoWalletRpcParams) => Promise<TelenoWalletShowSeedResult>
      chainInfo: (params?: TelenoWalletRpcParams) => Promise<TelenoWalletChainInfoResult>
      block: (params?: TelenoWalletBlockParams) => Promise<TelenoWalletBlockResult>
      balance: (params?: TelenoWalletAddressQueryParams) => Promise<TelenoWalletBalanceResult>
      vhp: (params?: TelenoWalletAddressQueryParams) => Promise<TelenoWalletScalarResult>
      nonce: (params?: TelenoWalletAddressQueryParams) => Promise<TelenoWalletScalarResult>
      rc: (params?: TelenoWalletAddressQueryParams) => Promise<TelenoWalletScalarResult>
      tokenBalance: (params?: TelenoWalletTokenBalanceParams) => Promise<TelenoWalletTokenBalanceResult>
      readContract: (params?: TelenoWalletReadContractParams) => Promise<TelenoWalletReadContractResult>
      transferKoin: (params?: TelenoWalletTransferKoinParams) => Promise<TelenoWalletTransferKoinResult>
      burn: (params?: TelenoWalletBurnParams) => Promise<TelenoWalletBurnResult>
      transferVhp: (params?: TelenoWalletTransferVhpParams) => Promise<TelenoWalletTransferVhpResult>
    }
  }

  interface Window {
    teleno?: TelenoApi
  }
}
