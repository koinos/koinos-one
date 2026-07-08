import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { WebContents } from 'electron'

import type { NativeBuildSystem } from './native-tooling'
import type { KoinosNetworkId } from './network-profiles'

export type TelenoAppPreferencesInput = {
  keepRunningInMenuBar?: boolean
}

export type TelenoAppPreferences = {
  keepRunningInMenuBar: boolean
}

export type TelenoAppPreferencesResult = {
  ok: boolean
  output: string
  filePath: string
  preferences: TelenoAppPreferences
}

export type TelenoNodeSettingsInput = {
  network?: KoinosNetworkId
  repoPath?: string
  baseDir?: string
  profiles?: string[]
  blockchainBackupUrl?: string
  backup?: TelenoNodeBackupSettingsInput
}

export type TelenoNodeBackupAuthMethod = 'private-key' | 'password-file' | 'env-password'

export type TelenoNodeBackupSettingsInput = Partial<TelenoNodeBackupSettings>

export type TelenoNodeBackupPasswordFileInput = {
  network?: KoinosNetworkId
  password?: string
}

export type TelenoNodeBackupPasswordFileResult = {
  ok: boolean
  output: string
  filePath: string | null
}

export type TelenoNodeBackupSettings = {
  localEnabled: boolean
  localDirectory: string
  workspace: string
  localRetentionCount: number
  remoteEnabled: boolean
  remoteDirectory: string
  remoteRetentionCount: number
  remoteRetentionDays: number
  uploadTempSuffix: string
  sshHost: string
  sshPort: number
  sshUser: string
  sshAuth: TelenoNodeBackupAuthMethod
  sshPrivateKeyFile: string
  sshPasswordFile: string
  sshPassphraseFile: string
  sshKnownHostsFile: string
  sshStrictHostKeyChecking: boolean
  sshConnectTimeoutSeconds: number
  scheduleEnabled: boolean
  scheduleInterval: string
  scheduleRunOnStartupIfMissed: boolean
  scheduleJitterSeconds: number
  scheduleMinimumHeadProgress: number
  scheduleSkipIfSyncingFromGenesis: boolean
  scheduleMaxConcurrentBackups: number
  adminEnabled: boolean
  adminListen: string
  adminTokenFile: string
  adminJobs: number
}

export type TelenoNodeProducerOverviewInput = TelenoNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
}

export type TelenoNodeProducerRegisteredKeyInput = TelenoNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
}

export type TelenoNodeDashboardProducersInput = TelenoNodeSettingsInput & {
  rpcUrl?: string
  windowBlocks?: number
}

export type TelenoNodeDashboardPeersInput = TelenoNodeSettingsInput

export type TelenoNodeDashboardPerformanceInput = TelenoNodeSettingsInput

export type TelenoNodeSettings = {
  network: KoinosNetworkId
  repoPath: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
  backup: TelenoNodeBackupSettings
}

export type PublicRpcConfigInput = {
  network?: KoinosNetworkId
  publicRpcUrls?: string[]
  publicRpcUrlsByNetwork?: Partial<Record<KoinosNetworkId, string[]>>
}

export type PublicRpcConfigResult = {
  ok: boolean
  output: string
  network?: KoinosNetworkId
  publicRpcUrls: string[]
  publicRpcUrlsByNetwork?: Partial<Record<KoinosNetworkId, string[]>>
}

export type TelenoNodeServicePort = {
  host: string | null
  publishedPort: number | null
  targetPort: number | null
  protocol: string
  label: string
}

export type ManagedKoinosServiceDefinition = {
  id: string
  displayName: string
}

export type ServiceStatus = {
  id: string
  name: string
  service: string
  runtimeName: string
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

export type ComponentHealth = {
  name: string
  enabled: boolean
  healthy: boolean
  state?: 'running' | 'passive' | 'waiting' | 'disabled' | 'stopped'
  details?: string
}

export type TelenoNodeStatus = {
  ok: boolean
  network?: KoinosNetworkId
  repoPath: string
  baseDir: string
  profiles: string[]
  configReady: boolean
  configDir: string
  services: ServiceStatus[]
  components: ComponentHealth[]
  runningServices: number
  output: string
}

export type TelenoNodeComponentToggleInput = TelenoNodeSettingsInput & {
  component?: string
  enabled?: boolean
}

export type TelenoNodeComponentToggleResult = {
  ok: boolean
  component: string
  enabled: boolean
  output: string
  status: TelenoNodeStatus
}

export type TelenoNodePresetSource = 'profile' | 'features'

export type TelenoNodePreset = {
  id: string
  label: string
  network?: KoinosNetworkId
  source: TelenoNodePresetSource
  profiles: string[]
  services: string[]
  featureFlags?: Record<string, boolean>
  configPatch?: {
    set?: Array<{ path: string[]; value: unknown }>
    delete?: string[][]
  }
  description: string
}

export type TelenoNodePresetsResult = {
  ok: boolean
  presets: TelenoNodePreset[]
  output: string
}

export type TelenoNodeCommandResult = {
  ok: boolean
  action: 'start' | 'stop'
  output: string
  status: TelenoNodeStatus
}

export type TelenoNodeBackupRestoreResult = {
  ok: boolean
  action: TelenoNodeBackupProgressAction
  output: string
  status: TelenoNodeStatus | string
}

export type TelenoNodeNativeBackupDryRunResult = {
  ok: boolean
  output: string
  configPath?: string
  repositoryDir?: string
  workspaceDir?: string
}

export type TelenoNodeNativeBackupRestoreInput = TelenoNodeSettingsInput & {
  backupId?: string
  backupSource?: 'local' | 'remote' | 'public' | 'auto'
}

export type TelenoNodeNativeBackupPurgeInput = TelenoNodeSettingsInput & {
  backupId?: string
  backupSource?: 'local' | 'remote'
}

export type TelenoNodeNativeBackupPurgeResult = {
  ok: boolean
  output: string
  backupId: string
  source: 'local' | 'remote'
  configPath?: string
  repositoryDir?: string
  workspaceDir?: string
}

export type TelenoNodeNativeBackupRestoreSpace = {
  restoredDatabaseBytes: number
  runtimeFilesBytes: number
  objectDownloadBytes: number
  minimumTargetFreeBytes: number
  recommendedTargetFreeBytes: number
}

export type TelenoNodeNativeBackupSnapshot = {
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

export type TelenoNodeNativeBackupRemoteSpace = {
  ok: boolean
  availableBytes: number
  targetPath: string
  message: string
}

export type TelenoNodeNativeBackupListResult = {
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

export type TelenoNodeNativeBackupConfigResult = {
  ok: boolean
  output: string
  configPath?: string
  repositoryDir?: string
  workspaceDir?: string
  backup?: TelenoNodeBackupSettings
}

export type TelenoNodeNativeBackupPreflightResult = {
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

export type BlockchainBackupWorkspacePaths = {
  workspaceDir: string
  archivePath: string
  archiveStatePath: string
  extractDir: string
  extractStatePath: string
}

export type BlockchainBackupArchiveState = {
  size: number
  mtimeMs: number
  updatedAt: number
}

export type BlockchainBackupExtractState = {
  payloadRootRelativePath: string
  restoreDirectories: string[]
  completedDirectories: string[]
  updatedAt: number
}

export type KoinosJsonRpcProxyInput = {
  rpcUrl?: string
  method?: string
  params?: Record<string, unknown>
}

export type KoinosJsonRpcProxyResult = {
  ok: boolean
  method: string
  result?: unknown
  output: string
}

export type TelenoNodeProducerAddressSource = 'config' | 'vault' | 'manual' | 'none'

export type TelenoNodeProducerRegistrationStatus =
  | 'missing-address'
  | 'missing-local-key'
  | 'match'
  | 'mismatch'
  | 'unregistered'

export type TelenoNodeProducerLocalInfoResult = {
  ok: boolean
  output: string
  producerAddress: string | null
  configFilePath: string | null
  configHasProducer: boolean
  localPublicKey: string | null
  localPublicKeyPath: string | null
  localPrivateKeyPath: string | null
}

export type TelenoNodeProducerRegisteredKeyResult = {
  ok: boolean
  output: string
  rpcUrl: string
  rpcSource: 'public' | 'local'
  producerAddress: string | null
  registeredPublicKey: string | null
}

export type TelenoNodeProducerOverviewResult = {
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

export type TelenoNodeProducerRegisterInput = TelenoNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
  signerAccountId?: string
  allowDelegatedSigner?: boolean
  password?: string
  persistConfig?: boolean
  persistProfile?: boolean
}

export type TelenoNodeProducerRegisterResult = {
  ok: boolean
  producerAddress: string
  output: string
  overview: TelenoNodeProducerOverviewResult
}

export type TelenoNodeProducerDeleteResult = {
  ok: boolean
  output: string
  overview: TelenoNodeProducerOverviewResult
  profile: TelenoProducerProfile | null
}

export type TelenoNodeDashboardProducerRow = {
  signer: string
  koinBalance: string | null
  vhpBalance: string | null
  blocks: number
  sharePercent: number
  lastBlockHeight: number
  lastProducedBlockAt: number | null
}

export type TelenoNodeDashboardProducersResult = {
  ok: boolean
  output: string
  rpcUrl: string
  rpcSource: 'public' | 'local'
  windowBlocks: number
  analyzedBlocks: number
  headHeight: number | null
  rows: TelenoNodeDashboardProducerRow[]
}

export type TelenoNodeDashboardPeerRow = {
  address: string
  peerId: string | null
  host: string | null
  port: number | null
}

export type TelenoNodeDashboardPeersResult = {
  ok: boolean
  output: string
  service: string
  source: 'p2p-live' | 'p2p-log'
  snapshotAt: number | null
  selfAddress: string | null
  omittedPeerCount: number
  rows: TelenoNodeDashboardPeerRow[]
}

export type TelenoNodeDashboardPerformanceRow = {
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

export type TelenoNodeDashboardPerformanceHost = {
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

export type TelenoNodeDashboardPerformanceTotals = {
  telenoCpuPercent: number | null
  telenoMemoryBytes: number | null
  servicesCpuPercent: number | null
  servicesMemoryBytes: number | null
}

export type TelenoNodeDashboardPerformanceResult = {
  ok: boolean
  output: string
  sampledAt: number
  host: TelenoNodeDashboardPerformanceHost
  totals: TelenoNodeDashboardPerformanceTotals
  rows: TelenoNodeDashboardPerformanceRow[]
}

export type TelenoNodeProducerProfileResult = {
  ok: boolean
  output: string
  profileFilePath: string
  profile: TelenoProducerProfile | null
}

export type TelenoNodeServiceCommandInput = TelenoNodeSettingsInput & {
  service?: string
}

export type TelenoNodeServiceCommandResult = {
  ok: boolean
  action: 'start' | 'stop' | 'restart' | 'kill-conflict'
  service: string
  output: string
  status: TelenoNodeStatus
}

export type TelenoNodePresetCommandInput = TelenoNodeSettingsInput & {
  presetId?: string
}

export type TelenoNodePresetCommandResult = {
  ok: boolean
  action: 'reconcile'
  presetId: string
  output: string
  status: TelenoNodeStatus
}

export type TelenoNodeNativeBuildStatus = {
  serviceId: string
  serviceName: string
  supported: boolean
  buildSystem: NativeBuildSystem | null
  repoPath: string | null
  repoExists: boolean
  artifactPath: string | null
  artifactExists: boolean
  artifactUpdatedAt: number | null
  buildable: boolean
  note: string | null
  buildCommands: string[]
}

export type TelenoNodeNativeBuildsResult = {
  ok: boolean
  sourceRoot: string
  services: TelenoNodeNativeBuildStatus[]
  output: string
}

export type TelenoNodeNativeBuildCommandInput = {
  serviceId?: string
}

export type TelenoNodeNativeBuildCommandResult = {
  ok: boolean
  action: 'build-all' | 'build-service'
  serviceId: string | null
  output: string
  builds: TelenoNodeNativeBuildsResult
}

export type TelenoNodeCloneRepoResult = {
  ok: boolean
  repoPath: string
  output: string
}

export type TelenoNodeManagedFileKind = 'config'

export type TelenoNodeFileReadInput = TelenoNodeSettingsInput & {
  kind: TelenoNodeManagedFileKind
}

export type TelenoNodeFileReadResult = {
  ok: boolean
  kind: TelenoNodeManagedFileKind
  filePath: string
  content: string
  output: string
}

export type TelenoNodeFileWriteInput = TelenoNodeSettingsInput & {
  kind: TelenoNodeManagedFileKind
  content?: string
}

export type TelenoNodeFileWriteResult = {
  ok: boolean
  kind: TelenoNodeManagedFileKind
  filePath: string
  output: string
}

export type TelenoNodeSelectDirectoryResult = {
  ok: boolean
  canceled: boolean
  path: string
  restoreWorkspaceParent: string
  writable: boolean
  localCopy?: TelenoNodeBaseDirLocalCopy
  output: string
}

export type TelenoNodeBaseDirLocalCopy = {
  detected: boolean
  evidence: string[]
  newestModifiedMs: number | null
  totalBytes: number | null
  scannedEntries: number
  truncated: boolean
}

export type TelenoNodeValidateBaseDirResult = {
  ok: boolean
  baseDir: string
  restoreWorkspaceParent: string
  writable: boolean
  localCopy?: TelenoNodeBaseDirLocalCopy
  output: string
}

export type TelenoNodeBaseDirCopyInput = TelenoNodeSettingsInput & {
  sourceBaseDir?: string
  targetBaseDir?: string
}

export type TelenoNodeBaseDirCopyResult = {
  ok: boolean
  sourceBaseDir: string
  targetBaseDir: string
  output: string
  status: TelenoNodeStatus
}

export type TelenoNodeLogsInput = TelenoNodeSettingsInput & {
  service?: string
  tail?: number
}

export type TelenoNodeLogsResult = {
  ok: boolean
  service: string | null
  tail: number
  output: string
}

export type TelenoNodeLogsFollowStartInput = TelenoNodeLogsInput

export type TelenoNodeLogsFollowStartResult = {
  ok: boolean
  streamId: string
  service: string | null
  tail: number
  output?: string
}

export type TelenoNodeLogsFollowStopInput = {
  streamId?: string
}

export type TelenoNodeLogsFollowStopResult = {
  ok: boolean
  streamId: string | null
}

export type TelenoNodeLogsFollowEvent = {
  streamId: string
  type: 'start' | 'chunk' | 'end' | 'error'
  service?: string | null
  tail?: number
  chunk?: string
  code?: number | null
  message?: string
}

export type TelenoNodeBackupProgressAction = 'restore-backup' | 'restore-backup-verify' | 'create-backup'

export type TelenoNodeBackupProgressPhase =
  | 'prepare'
  | 'stop'
  | 'download'
  | 'checksum'
  | 'extract'
  | 'restore'
  | 'compress'
  | 'save'
  | 'upload'
  | 'start'
  | 'verify'
  | 'complete'
  | 'cancelled'
  | 'error'

export type TelenoNodeBackupProgressEvent = {
  action: TelenoNodeBackupProgressAction
  phase: TelenoNodeBackupProgressPhase
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

export type LogsFollowSession = {
  sender: WebContents
  service: string | null
  tail: number
  ended: boolean
  stop: () => void
}

export type NativeServiceProcessState = {
  serviceId: string
  child: ChildProcessByStdio<null, Readable, Readable>
  runtimeName: string
  binaryPath?: string | null
  configPath?: string | null
  logPath?: string | null
  cwd: string
  baseDir: string | null
  startedAt: number
  lastOutputAt: number | null
  output: string
  lastError: string | null
  exitCode: number | null
  stopRequested: boolean
  closed: boolean
}

export type NativeServiceLaunchSpec = {
  serviceId: string
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  runtimeName: string
}

export type NativeServiceStopResult = {
  ok: boolean
  output: string
}

export type NativeConflictKillResult = {
  ok: boolean
  output: string
}

export type NativeBuildToolStatus = {
  ok: boolean
  note: string | null
}

export type ServiceVersionCacheEntry = {
  fingerprint: string
  version: string | null
}

export type TcpListenerOwner = {
  pid: number | null
  command: string
  endpoint: string
  host: string
  port: number | null
}

export type ProcessSnapshotEntry = {
  pid: number
  command: string
}

export type TelenoEncryptedSecret = {
  encrypted: string
  salt: string
  iv: string
  authTag: string
}

export type TelenoWalletAccountKind = 'derived' | 'imported-wif' | 'watch-only'

export type TelenoEncryptedWalletAccount = {
  id: string
  name: string
  kind: TelenoWalletAccountKind
  address: string
  createdAt: string
  updatedAt?: string
  derivationPath?: string | null
  encryptedKey?: TelenoEncryptedSecret | null
}

export type TelenoWalletAccountSummary = {
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

export type TelenoEncryptedWallet = {
  version?: number
  address: string
  encryptedKey?: TelenoEncryptedSecret | null
  encryptedSeedPhrase?: TelenoEncryptedSecret | null
  seedDerivationPath?: string | null
  activeAccountId?: string | null
  accounts?: TelenoEncryptedWalletAccount[]
  createdAt?: string
  updatedAt?: string
}

export type TelenoUnlockedWalletAccount = {
  id: string
  name: string
  kind: TelenoWalletAccountKind
  address: string
  derivationPath: string | null
  privateKey: string | null
  createdAt: string
  updatedAt: string | null
}

export type TelenoUnlockedWallet = {
  address: string
  privateKey: string | null
  seedPhrase: string | null
  seedDerivationPath: string | null
  activeAccountId: string | null
  accountName: string | null
  accountKind: TelenoWalletAccountKind | null
  accounts: TelenoUnlockedWalletAccount[]
}

export type TelenoProducerProfile = {
  network: KoinosNetworkId
  producerAddress: string
  registrationSignerAccountId: string
  burnAccountId: string
  localPublicKey: string
  localPublicKeyPath: string
  registeredPublicKey: string | null
  lastRegistrationTxId: string | null
  updatedAt: string
}

export type WalletRpcInput = {
  network?: KoinosNetworkId
  rpcUrl?: string
  baseDir?: string
}

export type WalletOverviewResult = {
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

export type WalletGenerateResult = {
  ok: boolean
  output: string
  address: string | null
  privateKeyWif: string | null
  seedPhrase: string | null
  derivationPath: string | null
}

export type WalletImportInput = WalletRpcInput & {
  privateKey?: string
  password?: string
  seedPhrase?: string
  derivationPath?: string
}

export type WalletImportResult = {
  ok: boolean
  output: string
  address: string | null
  walletFilePath: string
  unlocked: boolean
}

export type WalletDeleteResult = {
  ok: boolean
  output: string
  walletFilePath: string
}

export type WalletCloseResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  unlocked: boolean
}

export type WalletUnlockInput = WalletRpcInput & {
  password?: string
}

export type WalletUnlockResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  unlocked: boolean
}

export type WalletAddressInput = {
  privateKey?: string
}

export type WalletAddressResult = {
  ok: boolean
  output: string
  address: string | null
}

export type WalletDeriveFromSeedInput = {
  seedPhrase?: string
  numAccounts?: number
}

export type WalletDerivedAccount = {
  index: number
  derivationPath: string
  address: string
  privateKeyWif: string
}

export type WalletDeriveFromSeedResult = {
  ok: boolean
  output: string
  accounts: WalletDerivedAccount[]
}

export type WalletShowSeedResult = {
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

export type WalletAddressQueryInput = WalletRpcInput & {
  address?: string
  accountId?: string
}

export type WalletAccountRefInput = WalletRpcInput & {
  accountId?: string
}

export type WalletListAccountsResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  accounts: TelenoWalletAccountSummary[]
}

export type WalletSetActiveAccountInput = WalletAccountRefInput

export type WalletSetProducerAccountInput = WalletAccountRefInput

export type WalletCreateDerivedAccountInput = WalletRpcInput & {
  name?: string
}

export type WalletImportAccountInput = WalletRpcInput & {
  name?: string
  privateKey?: string
  password?: string
}

export type WalletImportWatchAccountInput = WalletRpcInput & {
  name?: string
  address?: string
}

export type WalletRenameAccountInput = WalletRpcInput & {
  accountId?: string
  name?: string
}

export type WalletRemoveAccountInput = WalletAccountRefInput

export type WalletListAccountsInput = WalletRpcInput

export type WalletCloseInput = WalletRpcInput

export type WalletDeleteInput = WalletRpcInput

export type WalletShowSeedInput = WalletRpcInput & {
  accountId?: string
}

export type WalletSetActiveAccountResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  activeAccount: TelenoWalletAccountSummary | null
}

export type WalletSetProducerAccountResult = WalletSetActiveAccountResult & {
  configPath: string | null
}

export type WalletAccountMutationResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  account: TelenoWalletAccountSummary | null
  accounts: TelenoWalletAccountSummary[]
}

export type WalletBalanceResult = {
  ok: boolean
  output: string
  rpcUrl: string
  address: string | null
  koin: string | null
  vhp: string | null
  mana: string | null
}

export type WalletScalarResult = {
  ok: boolean
  output: string
  rpcUrl: string
  address: string | null
  value: string | null
  unit: string
}

export type WalletChainInfoResult = {
  ok: boolean
  output: string
  rpcUrl: string
  headHeight: number | null
  headBlockId: string | null
  lastIrreversibleBlock: number | null
  headBlockTime: number | null
}

export type WalletBlockInput = WalletRpcInput & {
  heightOrId?: string
  full?: boolean
}

export type WalletBlockOperation = {
  kind: 'call_contract' | 'upload_contract' | 'unknown'
  contractId: string | null
  entryPoint: string | null
}

export type WalletBlockTransaction = {
  id: string | null
  payer: string | null
  operationCount: number
  operations: WalletBlockOperation[]
}

export type WalletBlockResult = {
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
  transactions: WalletBlockTransaction[]
}

export type WalletTokenBalanceInput = WalletRpcInput & {
  contractId?: string
  address?: string
  accountId?: string
}

export type WalletTokenBalanceResult = {
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

export type WalletReadContractInput = WalletRpcInput & {
  contractId?: string
  method?: string
  args?: Record<string, unknown> | string
}

export type WalletReadContractResult = {
  ok: boolean
  output: string
  rpcUrl: string
  contractId: string | null
  method: string | null
  args: Record<string, unknown>
  result?: unknown
}

export type WalletBurnInput = WalletRpcInput & {
  percent?: number
  amount?: number
  accountId?: string
  targetAddress?: string
  useProducerBurnAccount?: boolean
  useFreeMana?: boolean
  password?: string
  dryRun?: boolean
}

export type WalletBurnResult = {
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

export type WalletTransferVhpInput = WalletRpcInput & {
  toAddress?: string
  amount?: number
  accountId?: string
  useFreeMana?: boolean
  password?: string
  dryRun?: boolean
}

export type WalletTransferVhpResult = {
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

export type WalletTransferKoinInput = WalletRpcInput & {
  toAddress?: string
  amount?: number
  accountId?: string
  useFreeMana?: boolean
  password?: string
  dryRun?: boolean
}

export type WalletTransferKoinResult = {
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
