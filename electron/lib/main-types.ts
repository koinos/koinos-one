import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { WebContents } from 'electron'

import type { NativeBuildSystem } from './native-tooling'

export type KoinosNodeSettingsInput = {
  repoPath?: string
  baseDir?: string
  profiles?: string[]
  blockchainBackupUrl?: string
}

export type KoinosNodeProducerOverviewInput = KoinosNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
}

export type KoinosNodeProducerRegisteredKeyInput = KoinosNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
}

export type KoinosNodeDashboardProducersInput = KoinosNodeSettingsInput & {
  rpcUrl?: string
  windowBlocks?: number
}

export type KoinosNodeDashboardPeersInput = KoinosNodeSettingsInput

export type KoinosNodeDashboardPerformanceInput = KoinosNodeSettingsInput

export type KoinosNodeSettings = {
  repoPath: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
}

export type PublicRpcConfigInput = {
  publicRpcUrls?: string[]
}

export type PublicRpcConfigResult = {
  ok: boolean
  output: string
  publicRpcUrls: string[]
}

export type KoinosNodeServicePort = {
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
  version: string | null
  state: string
  status: string
  ports: KoinosNodeServicePort[]
  dependsOn: string[]
  lastError: string | null
  nativePid: number | null
  conflictPids: number[]
  managedByKnodel: boolean
}

export type KoinosNodeStatus = {
  ok: boolean
  repoPath: string
  baseDir: string
  profiles: string[]
  configReady: boolean
  configDir: string
  services: ServiceStatus[]
  runningServices: number
  output: string
}

export type KoinosNodePresetSource = 'profile'

export type KoinosNodePreset = {
  id: string
  label: string
  source: KoinosNodePresetSource
  profiles: string[]
  services: string[]
  description: string
}

export type KoinosNodePresetsResult = {
  ok: boolean
  presets: KoinosNodePreset[]
  output: string
}

export type KoinosNodeCommandResult = {
  ok: boolean
  action: 'start' | 'stop'
  output: string
  status: KoinosNodeStatus
}

export type KoinosNodeBackupRestoreResult = {
  ok: boolean
  action: 'restore-backup' | 'restore-backup-verify'
  output: string
  status: KoinosNodeStatus
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

export type KoinosNodeProducerAddressSource = 'config' | 'vault' | 'none'

export type KoinosNodeProducerRegistrationStatus =
  | 'missing-address'
  | 'missing-local-key'
  | 'match'
  | 'mismatch'
  | 'unregistered'

export type KoinosNodeProducerLocalInfoResult = {
  ok: boolean
  output: string
  localPublicKey: string | null
  localPublicKeyPath: string | null
  localPrivateKeyPath: string | null
}

export type KoinosNodeProducerRegisteredKeyResult = {
  ok: boolean
  output: string
  rpcUrl: string
  rpcSource: 'public' | 'local'
  producerAddress: string | null
  registeredPublicKey: string | null
}

export type KoinosNodeProducerOverviewResult = {
  ok: boolean
  output: string
  rpcUrl: string
  rpcSource: 'public' | 'local'
  priceSourceName: string
  priceSourceUrl: string
  producerAddress: string | null
  producerAddressSource: KoinosNodeProducerAddressSource
  configFilePath: string
  configHasProducer: boolean
  walletAddress: string | null
  walletExists: boolean
  localPublicKey: string | null
  localPublicKeyPath: string | null
  localPrivateKeyPath: string | null
  registeredPublicKey: string | null
  registrationStatus: KoinosNodeProducerRegistrationStatus
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

export type KoinosNodeProducerRegisterInput = KoinosNodeSettingsInput & {
  producerAddress?: string
  rpcUrl?: string
  signerAccountId?: string
  allowDelegatedSigner?: boolean
  password?: string
  persistConfig?: boolean
  persistProfile?: boolean
}

export type KoinosNodeProducerRegisterResult = {
  ok: boolean
  producerAddress: string
  output: string
  overview: KoinosNodeProducerOverviewResult
}

export type KoinosNodeProducerDeleteResult = {
  ok: boolean
  output: string
  overview: KoinosNodeProducerOverviewResult
  profile: KnodelProducerProfile | null
}

export type KoinosNodeDashboardProducerRow = {
  signer: string
  blocks: number
  sharePercent: number
  lastBlockHeight: number
  lastProducedBlockAt: number | null
}

export type KoinosNodeDashboardProducersResult = {
  ok: boolean
  output: string
  rpcUrl: string
  rpcSource: 'public' | 'local'
  windowBlocks: number
  analyzedBlocks: number
  headHeight: number | null
  rows: KoinosNodeDashboardProducerRow[]
}

export type KoinosNodeDashboardPeerRow = {
  address: string
  peerId: string | null
  host: string | null
  port: number | null
}

export type KoinosNodeDashboardPeersResult = {
  ok: boolean
  output: string
  service: string
  source: 'p2p-log'
  snapshotAt: number | null
  selfAddress: string | null
  omittedPeerCount: number
  rows: KoinosNodeDashboardPeerRow[]
}

export type KoinosNodeDashboardPerformanceRow = {
  id: string
  label: string
  kind: 'knodel' | 'service'
  serviceId: string | null
  pid: number | null
  cpuPercent: number | null
  rssBytes: number | null
  virtualBytes: number | null
  uptimeSeconds: number | null
  state: string | null
  command: string | null
  managedByKnodel: boolean
}

export type KoinosNodeDashboardPerformanceHost = {
  cpuCount: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  loadAverage: number[]
  uptimeSeconds: number
}

export type KoinosNodeDashboardPerformanceTotals = {
  knodelCpuPercent: number | null
  knodelMemoryBytes: number | null
  servicesCpuPercent: number | null
  servicesMemoryBytes: number | null
}

export type KoinosNodeDashboardPerformanceResult = {
  ok: boolean
  output: string
  sampledAt: number
  host: KoinosNodeDashboardPerformanceHost
  totals: KoinosNodeDashboardPerformanceTotals
  rows: KoinosNodeDashboardPerformanceRow[]
}

export type KoinosNodeProducerProfileResult = {
  ok: boolean
  output: string
  profileFilePath: string
  profile: KnodelProducerProfile | null
}

export type KoinosNodeServiceCommandInput = KoinosNodeSettingsInput & {
  service?: string
}

export type KoinosNodeServiceCommandResult = {
  ok: boolean
  action: 'start' | 'stop' | 'restart' | 'kill-conflict'
  service: string
  output: string
  status: KoinosNodeStatus
}

export type KoinosNodePresetCommandInput = KoinosNodeSettingsInput & {
  presetId?: string
}

export type KoinosNodePresetCommandResult = {
  ok: boolean
  action: 'reconcile'
  presetId: string
  output: string
  status: KoinosNodeStatus
}

export type KoinosNodeNativeBuildStatus = {
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

export type KoinosNodeNativeBuildsResult = {
  ok: boolean
  sourceRoot: string
  services: KoinosNodeNativeBuildStatus[]
  output: string
}

export type KoinosNodeNativeBuildCommandInput = {
  serviceId?: string
}

export type KoinosNodeNativeBuildCommandResult = {
  ok: boolean
  action: 'build-all' | 'build-service'
  serviceId: string | null
  output: string
  builds: KoinosNodeNativeBuildsResult
}

export type KoinosNodeCloneRepoResult = {
  ok: boolean
  repoPath: string
  output: string
}

export type KoinosNodeManagedFileKind = 'config'

export type KoinosNodeFileReadInput = KoinosNodeSettingsInput & {
  kind: KoinosNodeManagedFileKind
}

export type KoinosNodeFileReadResult = {
  ok: boolean
  kind: KoinosNodeManagedFileKind
  filePath: string
  content: string
  output: string
}

export type KoinosNodeFileWriteInput = KoinosNodeSettingsInput & {
  kind: KoinosNodeManagedFileKind
  content?: string
}

export type KoinosNodeFileWriteResult = {
  ok: boolean
  kind: KoinosNodeManagedFileKind
  filePath: string
  output: string
}

export type KoinosNodeSelectDirectoryResult = {
  ok: boolean
  canceled: boolean
  path: string
  restoreWorkspaceParent: string
  writable: boolean
  output: string
}

export type KoinosNodeValidateBaseDirResult = {
  ok: boolean
  baseDir: string
  restoreWorkspaceParent: string
  writable: boolean
  output: string
}

export type KoinosNodeBaseDirCopyInput = KoinosNodeSettingsInput & {
  sourceBaseDir?: string
  targetBaseDir?: string
}

export type KoinosNodeBaseDirCopyResult = {
  ok: boolean
  sourceBaseDir: string
  targetBaseDir: string
  output: string
  status: KoinosNodeStatus
}

export type KoinosNodeLogsInput = KoinosNodeSettingsInput & {
  service?: string
  tail?: number
}

export type KoinosNodeLogsResult = {
  ok: boolean
  service: string | null
  tail: number
  output: string
}

export type KoinosNodeLogsFollowStartInput = KoinosNodeLogsInput

export type KoinosNodeLogsFollowStartResult = {
  ok: boolean
  streamId: string
  service: string | null
  tail: number
  output?: string
}

export type KoinosNodeLogsFollowStopInput = {
  streamId?: string
}

export type KoinosNodeLogsFollowStopResult = {
  ok: boolean
  streamId: string | null
}

export type KoinosNodeLogsFollowEvent = {
  streamId: string
  type: 'start' | 'chunk' | 'end' | 'error'
  service?: string | null
  tail?: number
  chunk?: string
  code?: number | null
  message?: string
}

export type KoinosNodeBackupProgressAction = 'restore-backup' | 'restore-backup-verify'

export type KoinosNodeBackupProgressPhase =
  | 'prepare'
  | 'stop'
  | 'download'
  | 'checksum'
  | 'extract'
  | 'restore'
  | 'start'
  | 'verify'
  | 'complete'
  | 'error'

export type KoinosNodeBackupProgressEvent = {
  action: KoinosNodeBackupProgressAction
  phase: KoinosNodeBackupProgressPhase
  progress: number
  message: string
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

export type KnodelEncryptedSecret = {
  encrypted: string
  salt: string
  iv: string
  authTag: string
}

export type KnodelWalletAccountKind = 'derived' | 'imported-wif' | 'watch-only'

export type KnodelEncryptedWalletAccount = {
  id: string
  name: string
  kind: KnodelWalletAccountKind
  address: string
  createdAt: string
  updatedAt?: string
  derivationPath?: string | null
  encryptedKey?: KnodelEncryptedSecret | null
}

export type KnodelWalletAccountSummary = {
  id: string
  name: string
  kind: KnodelWalletAccountKind
  address: string
  derivationPath: string | null
  createdAt: string
  updatedAt: string | null
  hasPrivateKey: boolean
  isActive: boolean
}

export type KnodelEncryptedWallet = {
  version?: number
  address: string
  encryptedKey?: KnodelEncryptedSecret | null
  encryptedSeedPhrase?: KnodelEncryptedSecret | null
  seedDerivationPath?: string | null
  activeAccountId?: string | null
  accounts?: KnodelEncryptedWalletAccount[]
  createdAt?: string
  updatedAt?: string
}

export type KnodelUnlockedWalletAccount = {
  id: string
  name: string
  kind: KnodelWalletAccountKind
  address: string
  derivationPath: string | null
  privateKey: string | null
  createdAt: string
  updatedAt: string | null
}

export type KnodelUnlockedWallet = {
  address: string
  privateKey: string | null
  seedPhrase: string | null
  seedDerivationPath: string | null
  activeAccountId: string | null
  accountName: string | null
  accountKind: KnodelWalletAccountKind | null
  accounts: KnodelUnlockedWalletAccount[]
}

export type KnodelProducerProfile = {
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
  rpcUrl?: string
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
  activeAccountKind: KnodelWalletAccountKind | null
  accountCount: number
  accounts: KnodelWalletAccountSummary[]
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

export type WalletImportInput = {
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

export type WalletUnlockInput = {
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
  accountKind: KnodelWalletAccountKind | null
  firstAccountAddress: string | null
  firstAccountPrivateKeyWif: string | null
  firstAccountDerivationPath: string | null
  seedPhrase: string | null
}

export type WalletAddressQueryInput = WalletRpcInput & {
  address?: string
  accountId?: string
}

export type WalletAccountRefInput = {
  accountId?: string
}

export type WalletListAccountsResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  accounts: KnodelWalletAccountSummary[]
}

export type WalletSetActiveAccountInput = {
  accountId?: string
}

export type WalletSetActiveAccountResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  activeAccount: KnodelWalletAccountSummary | null
}

export type WalletCreateDerivedAccountInput = {
  name?: string
}

export type WalletAccountMutationResult = {
  ok: boolean
  output: string
  walletAddress: string | null
  activeAccountId: string | null
  account: KnodelWalletAccountSummary | null
  accounts: KnodelWalletAccountSummary[]
}

export type WalletImportAccountInput = {
  name?: string
  privateKey?: string
  password?: string
}

export type WalletImportWatchAccountInput = {
  name?: string
  address?: string
}

export type WalletRenameAccountInput = {
  accountId?: string
  name?: string
}

export type WalletRemoveAccountInput = {
  accountId?: string
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
