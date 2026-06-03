import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { createCipheriv, createHash, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { Contract, Provider, utils } from 'koilib'
import {
  BLOCK_STORE_PAGE_SIZE,
  DASHBOARD_PEER_LOG_TAIL,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
  DEFAULT_BASEDIR,
  DEFAULT_BLOCKCHAIN_BACKUP_URL,
  DEFAULT_PUBLIC_RPC_URLS,
  FREE_MANA_METER_ADDRESS,
  FREE_MANA_SHARER_ADDRESS,
  KOIN_CONTRACT_ADDRESS,
  KOINOS_GIT_CLONE_URL,
  KNODEL_CONFIG_DIR,
  KNODEL_ENCRYPTION_ALGORITHM,
  KNODEL_KEY_LENGTH,
  KNODEL_PBKDF2_ITERATIONS,
  KNODEL_PRODUCER_PROFILE_FILE,
  KNODEL_PRODUCER_WALLET_FILE,
  KNODEL_PUBLIC_RPCS_FILE,
  KNODEL_SECURE_STORAGE_DIR,
  LANGUAGE_STORAGE_KEY,
  NODE_SETTINGS_STORAGE_KEY,
  POB_CONTRACT_ADDRESS,
  PRODUCER_DAY_WINDOW_MS,
  PUBLIC_KOINOS_RPC_URL,
  resolveDefaultKoinosRepoPath,
  resolveDefaultKoinosSourceRoot,
  resolveAmqpBrokerPath,
  resolveAmqpBrokerConfigPath,
  resolveMonolithBinaryPath,
  MONOLITH_CORE_COMPONENTS,
  MONOLITH_OPTIONAL_COMPONENTS,
  resolveKoinosRestRoot,
  isPackagedBuild,
  VHP_CONTRACT_ADDRESS
} from './lib/constants'
import { createAppLifecycleService } from './lib/app-lifecycle-service'
import { createKnodelStorage } from './lib/knodel-storage'
import { createBackupService } from './lib/backup-service'
import {
  baseDirConfigFilePath,
  blockProducerDirectoryPath,
  blockProducerPrivateKeyFilePath,
  blockProducerPublicKeyFilePath,
  configDirPath,
  configExampleDirPath,
  ensureKoinosBaseDir,
  expandUserPath,
  managedFilePath,
  normalizeNodeSettings as buildNormalizedNodeSettings,
  parsePersistedNodeSettings as parseStoredNodeSettings,
  readTrimmedFile,
  restoreWorkspaceParentPath,
  verifyWritableDirectory
} from './lib/node-paths'
import {
  findExecutableInPath,
  nativeCmakeBuildCommand,
  nativeCmakeConfigureArgs,
  nativeCmakeConfigureCommand,
  nativeCmakeExecutable,
  nativeGitExecutable,
  nativeRabbitmqCtlExecutable,
  nativeRabbitmqHomebrewPrefix,
  nativeRabbitmqOptPrefix,
  nativeRabbitmqServerExecutable,
  type NativeBuildSystem,
  type NativeServiceBuildDefinition,
  nativeServiceBuildDefinitionMap,
  nativeServiceBuildDefinitions,
  uniquePathValue
} from './lib/native-tooling'
import { isAppleSilicon, homebrewPrefix } from './lib/platform'
import type {
  BlockchainBackupArchiveState,
  BlockchainBackupExtractState,
  BlockchainBackupWorkspacePaths,
  KoinosJsonRpcProxyInput,
  KoinosJsonRpcProxyResult,
  KoinosNodeBackupProgressAction,
  KoinosNodeBackupProgressEvent,
  KoinosNodeBackupProgressPhase,
  KoinosNodeBackupRestoreResult,
  KoinosNodeBaseDirCopyInput,
  KoinosNodeBaseDirCopyResult,
  KoinosNodeCloneRepoResult,
  KoinosNodeCommandResult,
  KoinosNodeDashboardPerformanceInput,
  KoinosNodeDashboardPerformanceResult,
  KoinosNodeDashboardPeersInput,
  KoinosNodeDashboardPeerRow,
  KoinosNodeDashboardPeersResult,
  KoinosNodeDashboardProducersInput,
  KoinosNodeDashboardProducersResult,
  KoinosNodeFileReadInput,
  KoinosNodeFileReadResult,
  KoinosNodeFileWriteInput,
  KoinosNodeFileWriteResult,
  KoinosNodeLogsFollowEvent,
  KoinosNodeLogsFollowStartInput,
  KoinosNodeLogsFollowStartResult,
  KoinosNodeLogsFollowStopInput,
  KoinosNodeLogsFollowStopResult,
  KoinosNodeLogsInput,
  KoinosNodeLogsResult,
  KoinosNodeManagedFileKind,
  KoinosNodeNativeBuildCommandInput,
  KoinosNodeNativeBuildCommandResult,
  KoinosNodeNativeBuildsResult,
  KoinosNodeNativeBuildStatus,
  KoinosNodePreset,
  KoinosNodePresetCommandInput,
  KoinosNodePresetCommandResult,
  KoinosNodePresetsResult,
  KoinosNodeProducerDeleteResult,
  KoinosNodeProducerAddressSource,
  KoinosNodeProducerLocalInfoResult,
  KoinosNodeProducerOverviewInput,
  KoinosNodeProducerOverviewResult,
  KoinosNodeProducerProfileResult,
  KoinosNodeProducerRegisterInput,
  KoinosNodeProducerRegisterResult,
  KoinosNodeProducerRegisteredKeyInput,
  KoinosNodeProducerRegisteredKeyResult,
  KoinosNodeSelectDirectoryResult,
  ComponentHealth,
  KoinosNodeComponentToggleInput,
  KoinosNodeComponentToggleResult,
  KoinosNodeServiceCommandInput,
  KoinosNodeServiceCommandResult,
  KoinosNodeServicePort,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeStatus,
  KoinosNodeValidateBaseDirResult,
  KnodelEncryptedSecret,
  KnodelEncryptedWallet,
  KnodelProducerProfile,
  KnodelUnlockedWallet,
  LogsFollowSession,
  ManagedKoinosServiceDefinition,
  NativeBuildToolStatus,
  NativeConflictKillResult,
  NativeServiceLaunchSpec,
  NativeServiceProcessState,
  NativeServiceStopResult,
  ProcessSnapshotEntry,
  PublicRpcConfigInput,
  PublicRpcConfigResult,
  ServiceStatus,
  ServiceVersionCacheEntry,
  TcpListenerOwner,
  WalletAddressInput,
  WalletAccountMutationResult,
  WalletAddressQueryInput,
  WalletAddressResult,
  WalletBalanceResult,
  WalletBlockInput,
  WalletBlockOperation,
  WalletBlockResult,
  WalletBlockTransaction,
  WalletBurnInput,
  WalletBurnResult,
  WalletChainInfoResult,
  WalletCloseResult,
  WalletDeleteResult,
  WalletDerivedAccount,
  WalletDeriveFromSeedInput,
  WalletDeriveFromSeedResult,
  WalletGenerateResult,
  WalletImportAccountInput,
  WalletImportInput,
  WalletImportResult,
  WalletImportWatchAccountInput,
  WalletListAccountsResult,
  WalletOverviewResult,
  WalletReadContractInput,
  WalletReadContractResult,
  WalletRemoveAccountInput,
  WalletRenameAccountInput,
  WalletRpcInput,
  WalletScalarResult,
  WalletSetActiveAccountInput,
  WalletSetActiveAccountResult,
  WalletShowSeedResult,
  WalletTokenBalanceInput,
  WalletTokenBalanceResult,
  WalletTransferKoinInput,
  WalletTransferKoinResult,
  WalletTransferVhpInput,
  WalletTransferVhpResult,
  WalletCreateDerivedAccountInput,
  WalletUnlockInput,
  WalletUnlockResult
} from './lib/main-types'
import { createNativeVersionResolver } from './lib/native-versions'
import { createProducerService } from './lib/producer-service'
import { producerAddressFromRuntimeConfig, resolveLocalProducerPublicKey } from './lib/producer-keys'
import { createCachedContractLoader } from './lib/contract-loader'
import { registerKnodelIpcHandlers } from './lib/ipc-handlers'
import { createLogsService } from './lib/logs-service'
import { createNativeBuildService } from './lib/native-build-service'
import { createNativeRuntimeService } from './lib/native-runtime-service'
import { createWalletService } from './lib/wallet-service'
import { createWorkspaceService } from './lib/workspace-service'

const isDev = !!process.env.VITE_DEV_SERVER_URL
app.setName('koinosGUI')
let appShutdownInProgress = false
let appShutdownApproved = false
let mainWindow: BrowserWindow | null = null
const knodelStorage = createKnodelStorage(app.getPath('userData'))

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'
const BACKUP_PROGRESS_EVENT_CHANNEL = 'knodel:koinos-node:backup-progress:event'
const logsFollowSessions = new Map<string, LogsFollowSession>()
const nativeServiceProcesses = new Map<string, NativeServiceProcessState>()
const nativeLogsStreamIdsByService = new Map<string, Set<string>>()
const nativeServiceVersionCache = new Map<string, ServiceVersionCacheEntry>()
let logsFollowSessionSeq = 0
const MAX_NATIVE_SERVICE_LOG_BYTES = 512 * 1024
const NATIVE_AMQP_STARTUP_TIMEOUT_MS = 90000
const MONOLITH_DEFAULT_DISABLED_FEATURES: readonly string[] = []

// ---------------------------------------------------------------------------
// Monolith mode: single koinos_node binary with in-process Koinos components
// ---------------------------------------------------------------------------

/** True when the monolith binary is available (built or bundled). */
function isMonolithAvailable(): boolean {
  try {
    return fs.existsSync(resolveMonolithBinaryPath())
  } catch {
    return false
  }
}

/** Monolith process state — null when not started. */
let monolithProcessState: NativeServiceProcessState | null = null
let monolithDisabledFeatures = new Set<string>(MONOLITH_DEFAULT_DISABLED_FEATURES)
let monolithFallbackReason: string | null = null

function shouldUseMonolithMode(): boolean {
  return true
}

function monolithFallbackMessage(reason: string): string {
  return [
    'Monolith startup failed. koinosGUI manages only the monolithic koinos_node runtime.',
    reason
  ].filter(Boolean).join('\n')
}

function activateMonolithFallback(reason: string): string {
  monolithFallbackReason = reason.trim() || 'koinos_node failed to start'
  return monolithFallbackMessage(monolithFallbackReason)
}

/** Start the monolithic koinos_node binary. */
async function startMonolithProcess(
  settings: KoinosNodeSettings,
  enabledFeatures: string[],
  disabledFeatures: string[]
): Promise<{ ok: boolean; output: string }> {
  if (monolithProcessState && !monolithProcessState.closed) {
    return { ok: true, output: 'koinos_node ya estaba activo' }
  }

  const binaryPath = resolveMonolithBinaryPath()
  if (!fs.existsSync(binaryPath)) {
    return { ok: false, output: `Monolith binary not found: ${binaryPath}` }
  }

  // Ensure config files are in place
  try {
    ensureKoinosConfigFiles(settings)
    ensureBaseDirKoinosRuntimeFiles(settings)
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : 'Config setup failed' }
  }

  const args: string[] = [
    `--basedir=${settings.baseDir}`,
    '--log-level=info'
  ]
  const enabled = new Set(enabledFeatures)
  const disabled = new Set<string>(disabledFeatures)
  for (const feat of MONOLITH_DEFAULT_DISABLED_FEATURES) {
    if (!enabled.has(feat)) disabled.add(feat)
  }
  monolithDisabledFeatures = new Set(disabled)
  for (const feat of enabled) args.push(`--enable=${feat}`)
  for (const feat of disabled) args.push(`--disable=${feat}`)

  const child = spawn(binaryPath, args, {
    cwd: settings.baseDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const state: NativeServiceProcessState = {
    serviceId: 'koinos-node',
    child,
    runtimeName: 'koinos_node',
    cwd: settings.baseDir,
    baseDir: settings.baseDir,
    startedAt: Date.now(),
    lastOutputAt: null,
    output: '',
    lastError: null,
    exitCode: null,
    stopRequested: false,
    closed: false
  }
  monolithProcessState = state
  // Also register in the service processes map so existing code can find it
  nativeServiceProcesses.set('koinos-node', state)

  child.stdout.on('data', (chunk: Buffer | string) => {
    appendNativeServiceOutput('koinos-node', chunk)
  })

  child.stderr.on('data', (chunk: Buffer | string) => {
    appendNativeServiceOutput('koinos-node', chunk)
  })

  child.on('error', (error) => {
    state.lastError = error.message
    appendNativeServiceOutput('koinos-node', `${error.message}\n`)
  })

  child.on('close', (code, signal) => {
    state.closed = true
    state.exitCode = code
    if (!state.stopRequested && (code !== 0 || signal)) {
      state.lastError = state.lastError || `Exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`
      appendNativeServiceOutput('koinos-node', `${state.lastError}\n`)
    }
    if (state.stopRequested && code === 0) {
      state.lastError = null
    }
    closeNativeLogStreamsForService('koinos-node', code)
  })

  // Wait for jsonrpc health endpoint (port 8080)
  const jsonrpcReady = await waitForTcpListener('127.0.0.1', 8080, 30000)

  if (state.closed) {
    return {
      ok: false,
      output: tailTextLines(state.output, 80) || state.lastError || 'koinos_node exited during startup'
    }
  }

  if (!jsonrpcReady) {
    return {
      ok: true,
      output: `Started koinos_node (pid ${child.pid ?? 'n/a'}) — jsonrpc port not yet ready`
    }
  }

  return {
    ok: true,
    output: `Started koinos_node (pid ${child.pid ?? 'n/a'})`
  }
}

/** Stop the monolithic koinos_node binary. */
async function stopMonolithProcess(): Promise<{ ok: boolean; output: string }> {
  if (!monolithProcessState || monolithProcessState.closed) {
    return { ok: true, output: 'koinos_node ya estaba detenido' }
  }

  const state = monolithProcessState
  const pid = state.child.pid ?? null
  state.stopRequested = true

  try {
    state.child.kill('SIGTERM')
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : 'No se pudo detener koinos_node' }
  }

  const closeCode = await waitForChildClose(state.child, 15000)
  if (closeCode !== null || state.closed) {
    return { ok: true, output: `Stopped koinos_node (pid ${pid ?? 'n/a'})` }
  }

  if (process.platform === 'win32' && pid) {
    killProcessTree(pid)
  } else {
    try {
      state.child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }

  return { ok: true, output: `Force-stopped koinos_node (pid ${pid ?? 'n/a'})` }
}

/**
 * Parse component health from monolith log output.
 * The monolith emits lines like: [chain] INFO Listening...
 */
function parseMonolithComponentHealth(): ComponentHealth[] {
  const output = monolithProcessState?.output || ''
  const isRunning = monolithProcessState != null && !monolithProcessState.closed

  return [...MONOLITH_CORE_COMPONENTS, ...MONOLITH_OPTIONAL_COMPONENTS].map((name) => {
    const enabled = !monolithDisabledFeatures.has(name)
    // A component is considered healthy if the monolith is running and
    // we've seen log output from it
    const hasOutput = output.includes(`[${name}]`)
    return {
      name,
      enabled,
      healthy: enabled && isRunning && hasOutput,
      details: !enabled
        ? 'Disabled'
        : isRunning
          ? hasOutput ? 'Running' : 'Waiting...'
          : 'Stopped'
    }
  })
}

/** Build feature flags for a preset in monolith mode. */
function presetToFeatureFlags(presetId: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {}

  // Core components default on, including cpp-libp2p now that Gate D is closed.
  for (const comp of MONOLITH_CORE_COMPONENTS) flags[comp] = true

  // Optional components default off
  for (const comp of MONOLITH_OPTIONAL_COMPONENTS) flags[comp] = false

  // Enable based on preset
  if (presetId.includes('block_producer')) {
    flags.block_producer = true
    flags.jsonrpc = true
    flags.contract_meta_store = true
  }
  if (presetId.includes('jsonrpc')) {
    flags.jsonrpc = true
  }
  if (presetId.includes('grpc')) {
    flags.grpc = true
  }
  if (presetId.includes('transaction_store')) {
    flags.transaction_store = true
  }
  if (presetId.includes('contract_meta_store')) {
    flags.contract_meta_store = true
  }
  if (presetId.includes('account_history')) {
    flags.account_history = true
  }

  return flags
}

function monolithFeatureCliArgs(featureFlags: Record<string, boolean>): { enabled: string[]; disabled: string[] } {
  const enabled: string[] = []
  const disabled: string[] = []
  for (const component of [...MONOLITH_CORE_COMPONENTS, ...MONOLITH_OPTIONAL_COMPONENTS]) {
    if (!(component in featureFlags)) continue
    if (featureFlags[component]) enabled.push(component)
    else disabled.push(component)
  }
  return { enabled, disabled }
}

function writeMonolithFeatureConfig(settings: KoinosNodeSettings, featureFlags: Record<string, boolean>): string {
  ensureKoinosConfigFiles(settings)
  ensureBaseDirKoinosRuntimeFiles(settings)

  const configPath = path.join(settings.baseDir, 'config.yml')
  const yaml = require('yaml')
  const doc = yaml.parseDocument(fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '')
  for (const [component, enabled] of Object.entries(featureFlags)) {
    doc.setIn(['features', component], enabled)
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, doc.toString(), 'utf-8')
  return configPath
}
const BLOCKCHAIN_BACKUP_REQUIRED_DIRS = ['chain', 'block_store'] as const
const BLOCKCHAIN_BACKUP_RESET_DIRS = ['mempool'] as const
const BLOCKCHAIN_BACKUP_CACHE_DIR = '.knodel-blockchain-backup-cache'
const nativeVersionResolver = createNativeVersionResolver({
  cache: nativeServiceVersionCache,
  findExecutableInPath,
  nativeRabbitmqCtlExecutable,
  resolveAmqpBrokerPath,
  fileExists: (filePath: string) => fs.existsSync(filePath),
  runCommand
})

const workspaceService = createWorkspaceService({
  normalizeNodeSettings,
  configDirPath,
  configExampleDirPath,
  managedFilePath,
  baseDirConfigFilePath,
  restoreWorkspaceParentPath,
  verifyWritableDirectory,
  runCommand
})

function currentUnlockedProducerWallet(): KnodelUnlockedWallet | null {
  return knodelStorage.getUnlockedWallet() as KnodelUnlockedWallet | null
}

async function loadContractWithFetchedAbi(provider: Provider, contractId: string): Promise<Contract> {
  return cachedContractLoader(provider, contractId)
}

const producerService = createProducerService({
  normalizeNodeSettings,
  producerAddressFromRuntimeConfig,
  loadKnodelWalletFile,
  resolveLocalProducerPublicKey,
  producerRpcTarget,
  loadContractWithFetchedAbi,
  fetchBlocksByHeightPaged,
  safeIsChecksumAddress,
  formatWholeUnits,
  parseWholeUnits,
  currentUnlockedProducerWallet,
  unlockKnodelWalletSession,
  persistProducerRuntimeConfig,
  saveProducerProfile,
  clearProducerProfile,
  loadProducerProfile,
  clearProducerRuntimeConfig,
  knodelProducerProfileFilePath,
  nativeComposeStatus,
  nativeComposeLogs,
  isComposeServiceRunning,
  blockProducerPrivateKeyFilePath,
  getAppMetrics: () => app.getAppMetrics(),
  hostSnapshot: () => {
    let freeDiskBytes: number | null = null
    let totalDiskBytes: number | null = null
    try {
      const homeDrive = process.env.HOMEDRIVE || 'C:'
      const diskRoot = process.platform === 'win32' ? homeDrive + '\\' : '/'
      const stats = fs.statfsSync(diskRoot)
      freeDiskBytes = stats.bavail * stats.bsize
      totalDiskBytes = stats.blocks * stats.bsize
    } catch { /* ignore */ }
    return {
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg(),
      uptimeSeconds: os.uptime(),
      freeDiskBytes,
      totalDiskBytes
    }
  },
  now: () => Date.now(),
  runCommand
})

const walletService = createWalletService({
  loadKnodelWalletFile,
  knodelProducerWalletFilePath,
  currentUnlockedProducerWallet,
  saveKnodelWallet,
  deleteKnodelWallet,
  closeKnodelWalletSession,
  unlockKnodelWalletSession,
  listWalletAccounts: () => knodelStorage.listWalletAccounts(),
  setActiveWalletAccount: (accountId: string) => knodelStorage.setActiveWalletAccount(accountId),
  createDerivedWalletAccount: (name?: string) => knodelStorage.createDerivedWalletAccount(name),
  importAdditionalWalletAccount: (privateKey: string, password: string, name?: string) =>
    knodelStorage.importWalletAccount(privateKey, password, name),
  importWatchWalletAccount: (address: string, name?: string) => knodelStorage.importWatchWalletAccount(address, name),
  renameWalletAccount: (accountId: string, name: string) => knodelStorage.renameWalletAccount(accountId, name),
  removeWalletAccount: (accountId: string) => knodelStorage.removeWalletAccount(accountId),
  loadWalletAccountSecrets: (accountId?: string) => knodelStorage.loadWalletAccountSecrets(accountId),
  resolveWalletRpcUrl,
  resolveWalletQueryAddress,
  parseWalletArgs,
  loadContractWithFetchedAbi,
  formatWholeUnits,
  safeIsChecksumAddress,
  loadProducerProfile,
  updateConfigProducerAddress: (address: string) => {
    try {
      const settings = normalizeNodeSettings()
      const configPath = path.join(settings.baseDir, 'config.yml')
      if (!fs.existsSync(configPath)) return
      const yaml = require('yaml')
      const doc = yaml.parseDocument(fs.readFileSync(configPath, 'utf-8'))
      doc.setIn(['block_producer', 'producer'], address)
      fs.writeFileSync(configPath, doc.toString(), 'utf-8')
    } catch {
      // Non-critical
    }
  }
})

const logsService = createLogsService({
  logsFollowEventChannel: LOGS_FOLLOW_EVENT_CHANNEL,
  maxNativeServiceLogBytes: MAX_NATIVE_SERVICE_LOG_BYTES,
  normalizeNodeSettings,
  assertRepoReady: workspaceService.assertRepoReady,
  nativeAmqpHomebrewLogFiles,
  nativeComposeStatus,
  toManagedServiceId,
  nativeAmqpUsesBrewService,
  sortManagedServiceIds,
  nativeServiceProcesses,
  logsFollowSessions,
  nativeLogsStreamIdsByService,
  nextStreamId: () => `logs-${Date.now()}-${++logsFollowSessionSeq}`
})

const backupService = createBackupService({
  normalizeNodeSettings,
  assertRepoReady: workspaceService.assertRepoReady,
  ensureKoinosConfigFiles: workspaceService.ensureKoinosConfigFiles,
  ensureBaseDirKoinosRuntimeFiles: workspaceService.ensureBaseDirKoinosRuntimeFiles,
  validateNodeBaseDirAccess: workspaceService.validateNodeBaseDirAccess,
  restoreWorkspaceParentPath,
  ensureKoinosBaseDir,
  readServiceDefinitions: readNativeServiceDefinitions as any,
  selectedManagedComposeServiceIds: selectedManagedComposeServiceIds as any,
  composeServicePortByTarget: composeServicePortByTarget as any,
  koinosNodeStatus,
  koinosNodeAction,
  runCommand
})

// Service IDs for managed Koinos node services.
/** Local service definition used to describe ports, dependencies, and profiles for each managed service. */
type NativeServiceDefinition = {
  ports: KoinosNodeServicePort[]
  dependsOn: string[]
  profiles: string[]
  [key: string]: unknown
}

const KOINOS_MANAGED_SERVICES: ManagedKoinosServiceDefinition[] = [
  { id: 'amqp', displayName: 'amqp' },
  { id: 'chain', displayName: 'chain' },
  { id: 'mempool', displayName: 'mempool' },
  { id: 'block_store', displayName: 'block_store' },
  { id: 'p2p', displayName: 'p2p' },
  { id: 'block_producer', displayName: 'block_producer' },
  { id: 'jsonrpc', displayName: 'jsonrpc' },
  { id: 'grpc', displayName: 'grpc' },
  { id: 'transaction_store', displayName: 'transaction_store' },
  { id: 'contract_meta_store', displayName: 'contract_meta_store' },
  { id: 'account_history', displayName: 'account_history' },
  { id: 'rest', displayName: 'rest' }
]

const KOINOS_MANAGED_SERVICE_BY_ID = new Map(KOINOS_MANAGED_SERVICES.map((definition) => [definition.id, definition] as const))

const nativeBuildService = createNativeBuildService({
  defaultKoinosSourceRoot: resolveDefaultKoinosSourceRoot(),
  managedServices: KOINOS_MANAGED_SERVICES,
  runCommand,
  applyKoinosDarwinHunterWorkaround
})

const nativeRuntimeService = createNativeRuntimeService({
  nativeAmqpStartupTimeoutMs: NATIVE_AMQP_STARTUP_TIMEOUT_MS,
  normalizeNodeSettings,
  assertRepoReady: workspaceService.assertRepoReady,
  readServiceDefinitions: readNativeServiceDefinitions as any,
  prepareNativeStartNotes,
  nativeRuntimeDockerConflictCheck,
  selectedManagedComposeServiceIds: selectedManagedComposeServiceIds as any,
  sortManagedServiceIds,
  sortManagedServiceIdsByDependencies: sortManagedServiceIdsByDependencies as any,
  nativeAmqpUsesBrewService,
  startNativeServiceProcess: startNativeServiceProcess as any,
  stopNativeServiceProcess,
  findExecutableInPath,
  runCommand,
  composeServicePortByTarget: composeServicePortByTarget as any,
  nativeRabbitmqCtlExecutable,
  nativeRabbitmqServerExecutable,
  waitForTcpListener,
  waitForTcpListenerClosed,
  nativeServiceConnectHost,
  listTcpListenerOwners,
  tcpListenerOwnedByRabbitmq,
  describeTcpListenerOwners,
  nativeComposeStatus,
  toManagedServiceId,
  serviceDisplayName,
  findProfileDependents,
  isComposeServiceRunning,
  nativeManagedProcessRegistryOutput,
  killConflictingNativeServiceProcesses,
  resolvePresetOrThrow,
  listsEqual,
  nativeServiceProcesses
})

const appLifecycleService = createAppLifecycleService({
  isDev,
  viteDevServerUrl: process.env.VITE_DEV_SERVER_URL,
  preloadPath: path.join(__dirname, 'preload.js'),
  nodeSettingsStorageKey: NODE_SETTINGS_STORAGE_KEY,
  languageStorageKey: LANGUAGE_STORAGE_KEY,
  parsePersistedNodeSettings,
  koinosNodeStatus,
  isComposeServiceRunning,
  koinosNodeAction,
  nativeServiceProcesses,
  getLogsFollowStreamIds: () => [...logsFollowSessions.keys()],
  stopLogsFollowStream: (streamId) => {
    stopLogsFollowStream(streamId)
  },
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => {
    mainWindow = win
  },
  getAppShutdownApproved: () => appShutdownApproved,
  setAppShutdownApproved: (value) => {
    appShutdownApproved = value
  },
  getAppShutdownInProgress: () => appShutdownInProgress,
  setAppShutdownInProgress: (value) => {
    appShutdownInProgress = value
  },
  quitApp: () => app.quit()
})

const HUNTER_DARWIN_PATCHED_ZLIB_VERSION = '1.3.0-p0'
const HUNTER_DARWIN_PATCHED_ZLIB_URL = 'https://github.com/cpp-pm/zlib/archive/refs/tags/v1.3.0-p0.tar.gz'
const HUNTER_DARWIN_PATCHED_ZLIB_FILENAME = `zlib-${HUNTER_DARWIN_PATCHED_ZLIB_VERSION}-darwin-patched.tar.gz`
const HUNTER_DARWIN_PATCHED_ZLIB_CONDITION = '#if defined(MACOS) || defined(TARGET_OS_MAC)'
const HUNTER_DARWIN_PATCHED_ZLIB_REPLACEMENT = '#if (defined(MACOS) || defined(TARGET_OS_MAC)) && !defined(__APPLE__)'
const HUNTER_DARWIN_PATCHED_ABSEIL_VERSION = '20230802.1'
const HUNTER_DARWIN_PATCHED_ABSEIL_URL = 'https://github.com/abseil/abseil-cpp/archive/20230802.1.tar.gz'
const HUNTER_DARWIN_PATCHED_ABSEIL_FILENAME = `abseil-${HUNTER_DARWIN_PATCHED_ABSEIL_VERSION}-darwin-patched.tar.gz`
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_VERSION = '1.0.2'
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_HUNTER_KEY = 'e7cf9e149268ee78b1b0c342eccd40ce9354a3ad'
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_URL =
  'https://github.com/koinos/koinos-exception-cpp/archive/v1.0.2.tar.gz'
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_FILENAME =
  `koinos-exception-${HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_VERSION}-darwin-patched.tar.gz`
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_INCLUDE = '#include <boost/exception/all.hpp>'
const HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_INCLUDE_REPLACEMENT = [
  '#ifndef BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED',
  '#define BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED 1',
  '#endif',
  '',
  '#include <boost/exception/all.hpp>'
].join('\n')
const HUNTER_DARWIN_PATCHED_ABSEIL_IF = 'if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES [[Clang]])\n'
const HUNTER_DARWIN_PATCHED_ABSEIL_IF_REPLACEMENT = [
  'if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES [[Clang]])',
  '  if(',
  '    CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"',
  '    OR (',
  '      NOT CMAKE_OSX_ARCHITECTURES',
  '      AND (',
  '        CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|aarch64"',
  '        OR CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64"',
  '      )',
  '    )',
  '  )',
  '    set(ABSL_RANDOM_RANDEN_COPTS "${ABSL_RANDOM_HWAES_ARM64_FLAGS}")',
  '  elseif(',
  '    CMAKE_OSX_ARCHITECTURES STREQUAL "x86_64"',
  '    OR (',
  '      NOT CMAKE_OSX_ARCHITECTURES',
  '      AND (',
  '        CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "x86_64|amd64|AMD64"',
  '        OR CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|amd64|AMD64"',
  '      )',
  '    )',
  '  )',
  '    set(ABSL_RANDOM_RANDEN_COPTS "${ABSL_RANDOM_HWAES_X64_FLAGS}")',
  '  else()',
  ''
].join('\n')
const HUNTER_DARWIN_PATCHED_ABSEIL_END = [
  '  if(ABSL_RANDOM_RANDEN_COPTS AND NOT ABSL_RANDOM_RANDEN_COPTS_WARNING)',
  '    list(APPEND ABSL_RANDOM_RANDEN_COPTS "-Wno-unused-command-line-argument")',
  '  endif()',
  ''
].join('\n')
const HUNTER_DARWIN_PATCHED_ABSEIL_END_REPLACEMENT = [
  '  if(ABSL_RANDOM_RANDEN_COPTS AND NOT ABSL_RANDOM_RANDEN_COPTS_WARNING)',
  '    list(APPEND ABSL_RANDOM_RANDEN_COPTS "-Wno-unused-command-line-argument")',
  '  endif()',
  '  endif()',
  ''
].join('\n')

function knodelNativeBuildCacheDir(): string {
  return path.join(os.homedir(), '.knodel', 'native-build-cache')
}

function sha1File(filePath: string): string {
  const hash = createHash('sha1')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function findExistingHunterTarball(packageName: string, version: string): string | null {
  const downloadRoot = path.join(
    os.homedir(),
    '.hunter',
    '_Base',
    'Download',
    packageName,
    version
  )

  if (!fs.existsSync(downloadRoot)) return null

  const stack = [downloadRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }

      if (entry.isFile() && entry.name.endsWith('.tar.gz')) {
        return entryPath
      }
    }
  }

  return null
}

function findExistingHunterZlibTarball(): string | null {
  return findExistingHunterTarball('ZLIB', HUNTER_DARWIN_PATCHED_ZLIB_VERSION)
}

async function ensureHunterDarwinPatchedZlibTarball(): Promise<{ tarballPath: string; sha1: string }> {
  const cacheDir = knodelNativeBuildCacheDir()
  const upstreamTarballPath = path.join(cacheDir, `zlib-${HUNTER_DARWIN_PATCHED_ZLIB_VERSION}-upstream.tar.gz`)
  const patchedTarballPath = path.join(cacheDir, HUNTER_DARWIN_PATCHED_ZLIB_FILENAME)

  fs.mkdirSync(cacheDir, { recursive: true })

  if (fs.existsSync(patchedTarballPath)) {
    return {
      tarballPath: patchedTarballPath,
      sha1: sha1File(patchedTarballPath)
    }
  }

  const cachedHunterTarball = findExistingHunterZlibTarball()
  if (cachedHunterTarball) {
    fs.copyFileSync(cachedHunterTarball, upstreamTarballPath)
  } else if (!fs.existsSync(upstreamTarballPath)) {
    const response = await fetch(HUNTER_DARWIN_PATCHED_ZLIB_URL)
    if (!response.ok) {
      throw new Error(`No se pudo descargar zlib parcheable (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(upstreamTarballPath, buffer)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-zlib-patch-'))
  const extractResult = await runCommand('tar', ['-xzf', upstreamTarballPath, '-C', tempDir], { cwd: tempDir })
  if (!extractResult.ok) {
    throw new Error(extractResult.output || 'No se pudo extraer el tarball de zlib')
  }

  const extractedRoot = fs
    .readdirSync(tempDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())
  if (!extractedRoot) {
    throw new Error('No se encontro el contenido extraido de zlib')
  }

  const extractedRootPath = path.join(tempDir, extractedRoot.name)
  const zutilPath = path.join(extractedRootPath, 'zutil.h')
  const zutilContent = fs.readFileSync(zutilPath, 'utf8')
  if (!zutilContent.includes(HUNTER_DARWIN_PATCHED_ZLIB_CONDITION)) {
    throw new Error('No se encontro el bloque macOS esperado en zlib')
  }

  fs.writeFileSync(
    zutilPath,
    zutilContent.replace(HUNTER_DARWIN_PATCHED_ZLIB_CONDITION, HUNTER_DARWIN_PATCHED_ZLIB_REPLACEMENT),
    'utf8'
  )

  const archiveResult = await runCommand('tar', ['-czf', patchedTarballPath, '-C', tempDir, extractedRoot.name], { cwd: tempDir })
  if (!archiveResult.ok) {
    throw new Error(archiveResult.output || 'No se pudo crear el tarball parcheado de zlib')
  }

  return {
    tarballPath: patchedTarballPath,
    sha1: sha1File(patchedTarballPath)
  }
}

function findExistingHunterAbseilTarball(): string | null {
  return findExistingHunterTarball('abseil', HUNTER_DARWIN_PATCHED_ABSEIL_VERSION)
}

function findExistingHunterKoinosExceptionTarball(): string | null {
  return findExistingHunterTarball('koinos_exception', HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_HUNTER_KEY)
}

async function ensureHunterDarwinPatchedAbseilTarball(): Promise<{ tarballPath: string; sha1: string }> {
  const cacheDir = knodelNativeBuildCacheDir()
  const upstreamTarballPath = path.join(cacheDir, `abseil-${HUNTER_DARWIN_PATCHED_ABSEIL_VERSION}-upstream.tar.gz`)
  const patchedTarballPath = path.join(cacheDir, HUNTER_DARWIN_PATCHED_ABSEIL_FILENAME)

  fs.mkdirSync(cacheDir, { recursive: true })

  if (fs.existsSync(patchedTarballPath)) {
    return {
      tarballPath: patchedTarballPath,
      sha1: sha1File(patchedTarballPath)
    }
  }

  const cachedHunterTarball = findExistingHunterAbseilTarball()
  if (cachedHunterTarball) {
    fs.copyFileSync(cachedHunterTarball, upstreamTarballPath)
  } else if (!fs.existsSync(upstreamTarballPath)) {
    const response = await fetch(HUNTER_DARWIN_PATCHED_ABSEIL_URL)
    if (!response.ok) {
      throw new Error(`No se pudo descargar abseil parcheable (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(upstreamTarballPath, buffer)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-abseil-patch-'))
  const extractResult = await runCommand('tar', ['-xzf', upstreamTarballPath, '-C', tempDir], { cwd: tempDir })
  if (!extractResult.ok) {
    throw new Error(extractResult.output || 'No se pudo extraer el tarball de abseil')
  }

  const extractedRoot = fs
    .readdirSync(tempDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())
  if (!extractedRoot) {
    throw new Error('No se encontro el contenido extraido de abseil')
  }

  const extractedRootPath = path.join(tempDir, extractedRoot.name)
  const coptsPath = path.join(extractedRootPath, 'absl', 'copts', 'AbseilConfigureCopts.cmake')
  const coptsContent = fs.readFileSync(coptsPath, 'utf8')
  if (
    !coptsContent.includes('CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"') &&
    (!coptsContent.includes(HUNTER_DARWIN_PATCHED_ABSEIL_IF) || !coptsContent.includes(HUNTER_DARWIN_PATCHED_ABSEIL_END))
  ) {
    throw new Error('No se encontro el bloque Apple/Clang esperado en abseil')
  }

  if (!coptsContent.includes('CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"')) {
    fs.writeFileSync(
      coptsPath,
      coptsContent
        .replace(HUNTER_DARWIN_PATCHED_ABSEIL_IF, HUNTER_DARWIN_PATCHED_ABSEIL_IF_REPLACEMENT)
        .replace(HUNTER_DARWIN_PATCHED_ABSEIL_END, HUNTER_DARWIN_PATCHED_ABSEIL_END_REPLACEMENT),
      'utf8'
    )
  }

  const archiveResult = await runCommand('tar', ['-czf', patchedTarballPath, '-C', tempDir, extractedRoot.name], { cwd: tempDir })
  if (!archiveResult.ok) {
    throw new Error(archiveResult.output || 'No se pudo crear el tarball parcheado de abseil')
  }

  return {
    tarballPath: patchedTarballPath,
    sha1: sha1File(patchedTarballPath)
  }
}

async function ensureHunterDarwinPatchedKoinosExceptionTarball(): Promise<{ tarballPath: string; sha1: string }> {
  const cacheDir = knodelNativeBuildCacheDir()
  const upstreamTarballPath = path.join(
    cacheDir,
    `koinos-exception-${HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_VERSION}-upstream.tar.gz`
  )
  const patchedTarballPath = path.join(cacheDir, HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_FILENAME)

  fs.mkdirSync(cacheDir, { recursive: true })

  if (fs.existsSync(patchedTarballPath)) {
    return {
      tarballPath: patchedTarballPath,
      sha1: sha1File(patchedTarballPath)
    }
  }

  const cachedHunterTarball = findExistingHunterKoinosExceptionTarball()
  if (cachedHunterTarball) {
    fs.copyFileSync(cachedHunterTarball, upstreamTarballPath)
  } else if (!fs.existsSync(upstreamTarballPath)) {
    const response = await fetch(HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_URL)
    if (!response.ok) {
      throw new Error(`No se pudo descargar koinos_exception parcheable (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(upstreamTarballPath, buffer)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-koinos-exception-patch-'))
  const extractResult = await runCommand('tar', ['-xzf', upstreamTarballPath, '-C', tempDir], { cwd: tempDir })
  if (!extractResult.ok) {
    throw new Error(extractResult.output || 'No se pudo extraer el tarball de koinos_exception')
  }

  const extractedRoot = fs
    .readdirSync(tempDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())
  if (!extractedRoot) {
    throw new Error('No se encontro el contenido extraido de koinos_exception')
  }

  const extractedRootPath = path.join(tempDir, extractedRoot.name)
  const exceptionHeaderPath = path.join(extractedRootPath, 'include', 'koinos', 'exception.hpp')
  const exceptionHeaderContent = fs.readFileSync(exceptionHeaderPath, 'utf8')

  if (
    !exceptionHeaderContent.includes('BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED') &&
    !exceptionHeaderContent.includes(HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_INCLUDE)
  ) {
    throw new Error('No se encontro el include esperado en koinos_exception')
  }

  if (!exceptionHeaderContent.includes('BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED')) {
    fs.writeFileSync(
      exceptionHeaderPath,
      exceptionHeaderContent.replace(
        HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_INCLUDE,
        HUNTER_DARWIN_PATCHED_KOINOS_EXCEPTION_INCLUDE_REPLACEMENT
      ),
      'utf8'
    )
  }

  const archiveResult = await runCommand('tar', ['-czf', patchedTarballPath, '-C', tempDir, extractedRoot.name], {
    cwd: tempDir
  })
  if (!archiveResult.ok) {
    throw new Error(archiveResult.output || 'No se pudo crear el tarball parcheado de koinos_exception')
  }

  return {
    tarballPath: patchedTarballPath,
    sha1: sha1File(patchedTarballPath)
  }
}

function patchHunterConfigBlock(content: string, packageName: string, fileUrl: string, sha1: string): string {
  const patchedBlock = [
    `hunter_config(${packageName}`,
    `   URL "${fileUrl}"`,
    `   SHA1 "${sha1}"`,
    '   CMAKE_ARGS'
  ].join('\n')

  return content.replace(new RegExp(`hunter_config\\(${packageName}[\\s\\S]*?^\\s*CMAKE_ARGS`, 'm'), patchedBlock)
}

async function applyKoinosDarwinHunterWorkaround(repoPath: string, buildDir = 'build'): Promise<string | null> {
  if (!isAppleSilicon()) return null

  const hunterConfigPath = path.join(repoPath, buildDir, '_deps', 'koinos_cmake-src', 'Hunter', 'config.cmake')
  if (!fs.existsSync(hunterConfigPath)) return null

  const currentContent = fs.readFileSync(hunterConfigPath, 'utf8')
  let nextContent = currentContent
  const notes: string[] = []

  try {
    const { tarballPath, sha1 } = await ensureHunterDarwinPatchedZlibTarball()
    nextContent = patchHunterConfigBlock(nextContent, 'ZLIB', pathToFileURL(tarballPath).href, sha1)
    if (nextContent !== currentContent) {
      notes.push(`Applied Darwin Hunter workaround for ZLIB using ${tarballPath}`)
    }
  } catch {
    // Ignore and keep probing other workarounds.
  }

  try {
    const { tarballPath, sha1 } = await ensureHunterDarwinPatchedAbseilTarball()
    const patchedContent = patchHunterConfigBlock(nextContent, 'abseil', pathToFileURL(tarballPath).href, sha1)
    if (patchedContent !== nextContent) {
      notes.push(`Applied Darwin Hunter workaround for abseil using ${tarballPath}`)
    }
    nextContent = patchedContent
  } catch {
    // Ignore and keep any workarounds that were successfully prepared.
  }

  try {
    const { tarballPath, sha1 } = await ensureHunterDarwinPatchedKoinosExceptionTarball()
    const patchedContent = patchHunterConfigBlock(nextContent, 'koinos_exception', pathToFileURL(tarballPath).href, sha1)
    if (patchedContent !== nextContent) {
      notes.push(`Applied Darwin Hunter workaround for koinos_exception using ${tarballPath}`)
    }
    nextContent = patchedContent
  } catch {
    // Ignore and keep any workarounds that were successfully prepared.
  }

  if (nextContent === currentContent) return null

  fs.writeFileSync(hunterConfigPath, nextContent, 'utf8')
  return notes.join('\n')
}

async function resolveNativeServiceVersion(
  serviceId: string,
  definition: NativeServiceBuildDefinition | undefined
): Promise<string | null> {
  return nativeVersionResolver.resolveNativeServiceVersion(serviceId, definition)
}

function validateNodeBaseDirAccess(input?: KoinosNodeSettingsInput): KoinosNodeValidateBaseDirResult {
  return workspaceService.validateNodeBaseDirAccess(input)
}

function normalizeNodeSettings(input?: KoinosNodeSettingsInput): KoinosNodeSettings {
  return buildNormalizedNodeSettings(input) as KoinosNodeSettings
}

function parsePersistedNodeSettings(input: unknown): KoinosNodeSettingsInput | undefined {
  return parseStoredNodeSettings(input) as KoinosNodeSettingsInput | undefined
}

function cleanupAppRuntimeResources(): void {
  appLifecycleService.cleanupAppRuntimeResources()
}

async function requestOrderedAppShutdown(win: BrowserWindow | null): Promise<void> {
  return appLifecycleService.requestOrderedAppShutdown(win)
}

function knodelProducerWalletFilePath(): string {
  return knodelStorage.producerWalletFilePath()
}

function knodelProducerProfileFilePath(): string {
  return knodelStorage.producerProfileFilePath()
}

function loadPublicRpcConfig(): PublicRpcConfigResult {
  return knodelStorage.loadPublicRpcConfig() as PublicRpcConfigResult
}

function savePublicRpcConfig(input?: PublicRpcConfigInput): PublicRpcConfigResult {
  return knodelStorage.savePublicRpcConfig(input) as PublicRpcConfigResult
}

function loadKnodelWalletFile(): KnodelEncryptedWallet | null {
  return knodelStorage.loadWalletFile() as KnodelEncryptedWallet | null
}

function loadProducerProfile(): KnodelProducerProfile | null {
  return knodelStorage.loadProducerProfile() as KnodelProducerProfile | null
}

function saveProducerProfile(profile: KnodelProducerProfile): string {
  return knodelStorage.saveProducerProfile(profile)
}

function clearProducerProfile(): boolean {
  return knodelStorage.clearProducerProfile()
}

function loadKnodelWallet(password: string): KnodelUnlockedWallet | null {
  return knodelStorage.loadWallet(password) as KnodelUnlockedWallet | null
}

function unlockKnodelWalletSession(password: string): KnodelUnlockedWallet | null {
  return knodelStorage.unlockWalletSession(password) as KnodelUnlockedWallet | null
}

function saveKnodelWallet(
  privateKey: string,
  address: string,
  password: string,
  options?: {
    seedPhrase?: string
    derivationPath?: string
  }
): string {
  return knodelStorage.saveWallet(privateKey, address, password, options)
}

function deleteKnodelWallet(): boolean {
  return knodelStorage.deleteWallet()
}

function closeKnodelWalletSession(): string | null {
  return knodelStorage.closeWalletSession()
}

function resolveWalletRpcUrl(input?: WalletRpcInput): string {
  const requested = `${input?.rpcUrl || ''}`.trim()
  if (requested) return requested
  return PUBLIC_KOINOS_RPC_URL
}

function producerRpcTarget(input?: WalletRpcInput): { rpcUrl: string; rpcSource: 'public' | 'local' } {
  const rpcUrl = resolveWalletRpcUrl(input)
  try {
    const parsed = new URL(rpcUrl)
    const host = parsed.hostname.trim().toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      return { rpcUrl, rpcSource: 'local' }
    }
  } catch {
    // fall through to public classification
  }

  return { rpcUrl, rpcSource: 'public' }
}

function parseWalletArgs(value: WalletReadContractInput['args']): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {}
  }
  return value
}

function resolveWalletQueryAddress(address?: string, accountId?: string): string | null {
  return knodelStorage.resolveWalletQueryAddress(address, accountId)
}

function fixFetchedAbi(abi: unknown): unknown {
  if (!abi || typeof abi !== 'object') return abi
  const typedAbi = abi as { methods?: Record<string, Record<string, unknown>> }
  if (!typedAbi.methods) return abi

  for (const method of Object.values(typedAbi.methods)) {
    if (method['entry-point'] && !method.entry_point) {
      method.entry_point = parseInt(`${method['entry-point']}`, 16)
      delete method['entry-point']
    }
    if (typeof method['read-only'] !== 'undefined' && typeof method.read_only === 'undefined') {
      method.read_only = method['read-only']
      delete method['read-only']
    }
  }

  return typedAbi
}

const cachedContractLoader = createCachedContractLoader(
  (abi) => fixFetchedAbi(abi) as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
)

function formatWholeUnits(value: bigint | string | number | null | undefined, decimals = 8): string | null {
  if (value === null || value === undefined) return null
  try {
    const formatted = utils.formatUnits(`${value}`, decimals)
    if (!formatted.includes('.')) return formatted
    return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0'
  } catch {
    return null
  }
}

function parseWholeUnits(value: bigint | string | number | null | undefined, decimals = 8): number | null {
  const formatted = formatWholeUnits(value, decimals)
  if (!formatted) return null
  const parsed = Number.parseFloat(formatted)
  return Number.isFinite(parsed) ? parsed : null
}

function safeIsChecksumAddress(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    return utils.isChecksumAddress(value)
  } catch {
    return false
  }
}

async function fetchBlocksByHeightPaged(
  provider: Provider,
  headBlockId: string,
  startHeight: number,
  endHeight: number
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = []
  let nextStartHeight = startHeight

  while (nextStartHeight <= endHeight) {
    const remainingBlocks = endHeight - nextStartHeight + 1
    const chunkSize = Math.min(BLOCK_STORE_PAGE_SIZE, remainingBlocks)
    const response = await provider.call<{ block_items?: Array<Record<string, unknown>> }>('block_store.get_blocks_by_height', {
      head_block_id: headBlockId,
      ancestor_start_height: nextStartHeight,
      num_blocks: chunkSize,
      return_block: true,
      return_receipt: false
    })
    const chunkItems = Array.isArray(response?.block_items) ? response.block_items : []
    if (!chunkItems.length) break
    items.push(...chunkItems)
    if (chunkItems.length < chunkSize) break
    nextStartHeight += chunkSize
  }

  return items
}

function isProducerOverviewTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : `${error ?? ''}`
  return /context deadline exceeded|timed out|timeout/i.test(message)
}

function formatProducerOverviewActivityWarning(rpcUrl: string, error: unknown): string {
  return isProducerOverviewTimeoutError(error)
    ? `24h producer stats are temporarily unavailable from ${rpcUrl}.`
    : `24h producer stats could not be loaded from ${rpcUrl}.`
}

function normalizeDashboardProducerWindowBlocks(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT

  return Math.min(
    DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
    Math.max(
      DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
      Number.isFinite(numeric) ? Math.round(numeric) : DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT
    )
  )
}

function parseKoinosLogTimestampMs(line: string): number | null {
  const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d+))?/)
  if (!match) return null
  const fraction = `${match[2] || ''}`.slice(0, 3).padEnd(match[2] ? 3 : 0, '0')
  const iso = `${match[1].replace(' ', 'T')}${fraction ? `.${fraction}` : ''}`
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePeerAddressDetails(address: string): { peerId: string | null; host: string | null; port: number | null } {
  const peerIdMatch = address.match(/\/p2p\/([^/]+)$/)
  const hostMatch = address.match(/\/(?:ip4|ip6|dns4|dns6)\/([^/]+)/)
  const portMatch = address.match(/\/tcp\/(\d+)/)
  const port = portMatch ? Number.parseInt(portMatch[1], 10) : NaN

  return {
    peerId: peerIdMatch?.[1] ?? null,
    host: hostMatch?.[1] ?? null,
    port: Number.isFinite(port) ? port : null
  }
}

function parseLatestP2pPeersSnapshot(logOutput: string): {
  snapshotAt: number | null
  selfAddress: string | null
  omittedPeerCount: number
  rows: KoinosNodeDashboardPeerRow[]
} | null {
  const lines = logOutput.split(/\r?\n/)
  let connectedPeersIndex = -1

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('Connected peers:')) {
      connectedPeersIndex = index
      break
    }
  }

  if (connectedPeersIndex < 0) return null

  let selfAddress: string | null = null
  for (let index = connectedPeersIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.includes('Connected peers:')) break
    if (line.includes('My address:')) {
      const nextLine = lines[index + 1] ?? ''
      const addressMatch = nextLine.match(/\s-\s(.+)$/)
      selfAddress = addressMatch?.[1]?.trim() || null
      break
    }
  }

  const rows: KoinosNodeDashboardPeerRow[] = []
  let omittedPeerCount = 0
  for (let index = connectedPeersIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    const peerMatch = line.match(/\s-\s(.+)$/)
    if (peerMatch) {
      const address = peerMatch[1].trim()
      const details = parsePeerAddressDetails(address)
      rows.push({
        address,
        peerId: details.peerId,
        host: details.host,
        port: details.port
      })
      continue
    }

    const omittedMatch = line.match(/and\s+(\d+)\s+more/i)
    if (omittedMatch) {
      omittedPeerCount = Number.parseInt(omittedMatch[1], 10) || 0
      break
    }

    if (rows.length > 0 || line.includes('My address:')) break
  }

  return {
    snapshotAt: parseKoinosLogTimestampMs(lines[connectedPeersIndex]),
    selfAddress,
    omittedPeerCount,
    rows
  }
}

async function fetchCoinMarketCapKoinPriceUsd(): Promise<number | null> {
  try {
    const response = await fetch('https://coinmarketcap.com/currencies/koinos/', {
      headers: { 'user-agent': 'Mozilla/5.0 (koinosGUI Producer Panel)' }
    })
    if (!response.ok) return null
    const html = await response.text()
    const match =
      html.match(/Koinos price today is \$([0-9]+(?:\.[0-9]+)?)/i) ??
      html.match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)
    if (!match) return null
    const parsed = Number.parseFloat(match[1])
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function upsertBlockProducerConfigValue(content: string, key: string, value: string): string {
  const lines = content.split(/\r?\n/)
  let sectionStart = lines.findIndex((line) => line.trim() === 'block_producer:')
  if (sectionStart < 0) {
    const prefix = content.trimEnd()
    const separator = prefix ? '\n\n' : ''
    return `${prefix}${separator}block_producer:\n  ${key}: ${value}\n`
  }

  let sectionEnd = lines.length
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && !lines[index].trim().startsWith('#')) {
      sectionEnd = index
      break
    }
  }

  let replaced = false
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (new RegExp(`^\\s*#?\\s*${key}:`).test(lines[index])) {
      lines[index] = `  ${key}: ${value}`
      replaced = true
      break
    }
  }

  if (!replaced) {
    lines.splice(sectionStart + 1, 0, `  ${key}: ${value}`)
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function persistProducerRuntimeConfig(settings: KoinosNodeSettings, producerAddress: string): string {
  const configPath = baseDirConfigFilePath(settings)
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  let nextContent = upsertBlockProducerConfigValue(existing, 'producer', producerAddress)
  if (fs.existsSync(blockProducerPrivateKeyFilePath(settings))) {
    nextContent = upsertBlockProducerConfigValue(nextContent, 'private-key-file', 'private.key')
  }
  fs.writeFileSync(configPath, nextContent)
  return configPath
}

function commentBlockProducerConfigValue(content: string, key: string): { content: string; changed: boolean } {
  const lines = content.split(/\r?\n/)
  const sectionStart = lines.findIndex((line) => line.trim() === 'block_producer:')
  if (sectionStart < 0) {
    return { content, changed: false }
  }

  let sectionEnd = lines.length
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && !lines[index].trim().startsWith('#')) {
      sectionEnd = index
      break
    }
  }

  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (!new RegExp(`^\\s*#?\\s*${key}:`).test(lines[index])) continue
    const wasCommented = /^\s*#/.test(lines[index])
    lines[index] = lines[index].replace(/^(\s*)#?\s*/, '$1# ')
    return {
      content: `${lines.join('\n').replace(/\n+$/, '')}\n`,
      changed: !wasCommented
    }
  }

  return { content, changed: false }
}

function clearProducerRuntimeConfig(settings: KoinosNodeSettings): { configPath: string; cleared: boolean } {
  const configPath = baseDirConfigFilePath(settings)
  if (!fs.existsSync(configPath)) {
    return { configPath, cleared: false }
  }

  const existing = fs.readFileSync(configPath, 'utf8')
  const next = commentBlockProducerConfigValue(existing, 'producer')
  if (next.changed) {
    fs.writeFileSync(configPath, next.content)
  }

  return { configPath, cleared: next.changed }
}

function assertRepoReady(settings: KoinosNodeSettings): void {
  workspaceService.assertRepoReady(settings)
}

function buildProfilePresets(_settings: KoinosNodeSettings): KoinosNodePreset[] {
  // Core services that always run (no profile required)
  const coreServiceIds = ['amqp', 'chain', 'mempool', 'block_store', 'p2p']
  // Profile-specific services
  const profileServiceMap: Record<string, string[]> = {
    block_producer: ['block_producer', 'jsonrpc', 'contract_meta_store'],
    jsonrpc: ['jsonrpc'],
    grpc: ['grpc'],
    transaction_store: ['transaction_store'],
    contract_meta_store: ['contract_meta_store'],
    account_history: ['account_history'],
    rest: ['rest']
  }

  const managedServiceOrder = new Map(KOINOS_MANAGED_SERVICES.map((service, index) => [service.id, index] as const))

  const sortServiceIds = (serviceIds: Iterable<string>) =>
    [...serviceIds].sort((left, right) => {
      const leftIndex = managedServiceOrder.get(left) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = managedServiceOrder.get(right) ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.localeCompare(right)
    })

  const presets: KoinosNodePreset[] = []

  for (const profile of Object.keys(profileServiceMap)) {
    const services = new Set(coreServiceIds)
    for (const serviceId of profileServiceMap[profile] ?? []) {
      services.add(serviceId)
    }
    // Collect all profile names needed so each included service passes the profile filter
    const profiles = Object.entries(profileServiceMap)
      .filter(([, svcIds]) => svcIds.some((svcId) => services.has(svcId)))
      .map(([profileName]) => profileName)
    const serviceIds = sortServiceIds(services)
    const label = profile.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    presets.push({
      id: `profile:${profile}`,
      label,
      source: shouldUseMonolithMode() ? 'features' : 'profile',
      profiles,
      services: serviceIds,
      featureFlags: presetToFeatureFlags(profile),
      description: `Profile "${profile}" (${serviceIds.length} components)`
    })
  }

  return presets
}

function ensureKoinosConfigFiles(settings: KoinosNodeSettings): { configReady: boolean; output: string } {
  return workspaceService.ensureKoinosConfigFiles(settings)
}

function ensureBaseDirKoinosRuntimeFiles(settings: KoinosNodeSettings): string {
  return workspaceService.ensureBaseDirKoinosRuntimeFiles(settings)
}

function normalizeBlockchainBackupArchiveUrl(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw new Error('La URL del backup blockchain no puede estar vacia')
  }

  const parsed = new URL(value)
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('La URL del backup blockchain debe usar http o https')
  }
  if (!parsed.pathname.endsWith('.tar.gz')) {
    throw new Error('La URL del backup blockchain debe apuntar a un archivo .tar.gz')
  }

  return parsed.toString()
}

function blockchainBackupMetadataUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl)
  parsed.pathname = `${parsed.pathname}.metadata`
  return parsed.toString()
}

function blockchainBackupChecksumUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl)
  parsed.pathname = `${parsed.pathname}.sha256`
  return parsed.toString()
}

function blockchainBackupWorkspacePaths(
  restoreWorkspaceParent: string,
  archiveUrl: string,
  checksum: string
): BlockchainBackupWorkspacePaths {
  const archiveKey = createHash('sha1').update(archiveUrl).digest('hex').slice(0, 12)
  const workspaceDir = path.join(
    restoreWorkspaceParent,
    BLOCKCHAIN_BACKUP_CACHE_DIR,
    `${archiveKey}-${checksum.slice(0, 12)}`
  )
  return {
    workspaceDir,
    archivePath: path.join(workspaceDir, 'backup.tar.gz'),
    archiveStatePath: path.join(workspaceDir, 'archive-state.json'),
    extractDir: path.join(workspaceDir, 'extract'),
    extractStatePath: path.join(workspaceDir, 'extract-state.json')
  }
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function uniqueStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ ok: boolean; code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (result: { ok: boolean; code: number | null; output: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let timeoutHandle: NodeJS.Timeout | null = null
    let killHandle: NodeJS.Timeout | null = null
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore timeout kill errors
        }
        killHandle = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore forced timeout kill errors
          }
        }, 1000)
      }, options.timeoutMs)
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (killHandle) clearTimeout(killHandle)
      finish({
        ok: false,
        code: null,
        output: `${stdout}${stderr}\n${error.message}`.trim()
      })
    })

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (killHandle) clearTimeout(killHandle)
      const timeoutNote = timedOut && options.timeoutMs ? `Timed out after ${options.timeoutMs}ms` : ''
      const output = `${stdout}${stderr}${timeoutNote ? `\n${timeoutNote}` : ''}`.trim()
      finish({
        ok: code === 0 && !timedOut,
        code,
        output
      })
    })
  })
}

function parseProcessSnapshot(output: string): ProcessSnapshotEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) return null

      const pid = Number.parseInt(match[1], 10)
      const command = match[2]?.trim() ?? ''
      if (!Number.isFinite(pid) || !command) return null

      return { pid, command }
    })
    .filter((entry): entry is ProcessSnapshotEntry => entry !== null)
}

async function listProcessSnapshot(): Promise<ProcessSnapshotEntry[]> {
  const result = await runCommand('ps', ['-Ao', 'pid=,command='], {
    cwd: process.cwd(),
    timeoutMs: 5000
  })

  if (!result.ok || !result.output.trim()) return []
  return parseProcessSnapshot(result.output)
}

function nativeServiceUsesBaseDir(serviceId: string): boolean {
  return serviceId !== 'amqp' && serviceId !== 'rest'
}

function nativeServiceCommandHints(serviceId: string): string[] {
  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  const hints = new Set<string>()

  if (buildDefinition) {
    hints.add(path.basename(buildDefinition.artifactPath))
  }

  if (serviceId === 'amqp') {
    const rabbitmqServer = nativeRabbitmqServerExecutable()
    if (rabbitmqServer) hints.add(path.basename(rabbitmqServer))
    hints.add('rabbitmq-server')
  }

  return [...hints].filter(Boolean)
}

function detectExternalNativeServiceProcesses(
  settings: KoinosNodeSettings,
  serviceId: string,
  processSnapshot: ProcessSnapshotEntry[],
  excludePids: number[] = []
): ProcessSnapshotEntry[] {
  if (!nativeServiceUsesBaseDir(serviceId)) return []

  const commandHints = nativeServiceCommandHints(serviceId)
  if (commandHints.length === 0) return []

  const excludedPidSet = new Set(excludePids.filter((pid) => Number.isFinite(pid) && pid > 0))
  const rawBaseDir = settings.baseDir
  const resolvedBaseDir = path.resolve(settings.baseDir)
  const baseDirArgs = new Set([rawBaseDir, resolvedBaseDir].map((baseDir) => `--basedir=${baseDir}`))

  return processSnapshot.filter((entry) => {
    if (excludedPidSet.has(entry.pid)) return false
    if (![...baseDirArgs].some((baseDirArg) => entry.command.includes(baseDirArg))) return false
    return commandHints.some((hint) => entry.command.includes(hint))
  })
}

function describeExternalNativeServiceConflict(
  settings: KoinosNodeSettings,
  serviceId: string,
  processes: ProcessSnapshotEntry[]
): string {
  const pidLabel = processes.length === 1 ? 'pid' : 'pids'
  const pidList = processes.map((entry) => String(entry.pid)).join(', ')
  return `External native process detected for ${serviceId} using the same baseDir ${settings.baseDir} (${pidLabel}: ${pidList}). Stop it before starting this component.`
}

function nativeManagedProcessRegistryOutput(settings?: KoinosNodeSettings): string {
  const lines = sortManagedServiceIds(nativeServiceProcesses.keys())
    .map((serviceId) => {
      const state = nativeServiceProcesses.get(serviceId)
      if (!state || state.closed) return ''
      if (settings && state.baseDir && path.resolve(state.baseDir) !== path.resolve(settings.baseDir)) return ''

      const pid = state.child.pid ?? null
      const baseDirLabel = state.baseDir ? ` · baseDir ${state.baseDir}` : ''
      return `- ${serviceId} · pid ${pid ?? 'n/a'}${baseDirLabel}`
    })
    .filter(Boolean)

  if (lines.length === 0) return ''
  return ['Native process registry:', ...lines].join('\n')
}

async function killConflictingNativeServiceProcesses(
  settings: KoinosNodeSettings,
  serviceId: string
): Promise<NativeConflictKillResult> {
  const trackedState = nativeServiceProcesses.get(serviceId)
  const trackedPid = trackedState && !trackedState.closed && trackedState.child.pid ? [trackedState.child.pid] : []
  const initialSnapshot = await listProcessSnapshot()
  const conflictingProcesses = detectExternalNativeServiceProcesses(settings, serviceId, initialSnapshot, trackedPid)

  if (conflictingProcesses.length === 0) {
    return {
      ok: true,
      output: `No se detectaron procesos en conflicto para ${serviceId}`
    }
  }

  const termOutputs: string[] = []
  for (const processEntry of conflictingProcesses) {
    try {
      process.kill(processEntry.pid, 'SIGTERM')
      termOutputs.push(`SIGTERM enviado a pid ${processEntry.pid} (${serviceId})`)
    } catch (error) {
      termOutputs.push(
        `No se pudo enviar SIGTERM a pid ${processEntry.pid}: ${error instanceof Error ? error.message : 'error desconocido'}`
      )
    }
  }

  await delay(1500)

  const afterTermSnapshot = await listProcessSnapshot()
  const remainingAfterTerm = detectExternalNativeServiceProcesses(settings, serviceId, afterTermSnapshot, trackedPid)

  const killOutputs = [...termOutputs]
  for (const processEntry of remainingAfterTerm) {
    try {
      process.kill(processEntry.pid, 'SIGKILL')
      killOutputs.push(`SIGKILL enviado a pid ${processEntry.pid} (${serviceId})`)
    } catch (error) {
      killOutputs.push(
        `No se pudo enviar SIGKILL a pid ${processEntry.pid}: ${error instanceof Error ? error.message : 'error desconocido'}`
      )
    }
  }

  if (remainingAfterTerm.length > 0) {
    await delay(750)
  }

  const finalSnapshot = await listProcessSnapshot()
  const remainingAfterKill = detectExternalNativeServiceProcesses(settings, serviceId, finalSnapshot, trackedPid)

  return {
    ok: remainingAfterKill.length === 0,
    output: [
      ...killOutputs,
      remainingAfterKill.length === 0
        ? `Procesos conflictivos terminados para ${serviceId}`
        : `Siguen en conflicto para ${serviceId}: ${remainingAfterKill.map((entry) => entry.pid).join(', ')}`
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function parseLsofTcpListeners(raw: string): TcpListenerOwner[] {
  const listeners: TcpListenerOwner[] = []
  let currentPid: number | null = null
  let currentCommand = ''

  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (line.startsWith('p')) {
      const pid = Number.parseInt(line.slice(1), 10)
      currentPid = Number.isFinite(pid) ? pid : null
      continue
    }

    if (line.startsWith('c')) {
      currentCommand = line.slice(1).trim()
      continue
    }

    if (!line.startsWith('n')) continue

    const endpoint = line.slice(1).trim()
    const match = endpoint.match(/^(.*):(\d+)$/)
    const host = match?.[1] ?? endpoint
    const port = match?.[2] ? Number.parseInt(match[2], 10) : null

    listeners.push({
      pid: currentPid,
      command: currentCommand,
      endpoint,
      host,
      port: Number.isFinite(port) ? port : null
    })
  }

  return listeners
}

async function listTcpListenerOwners(ports: number[]): Promise<TcpListenerOwner[]> {
  const requestedPorts = [...new Set(ports.filter((port) => Number.isFinite(port) && port > 0))]
  if (requestedPorts.length === 0) return []

  const result = await runCommand(
    'lsof',
    ['-nP', ...requestedPorts.map((port) => `-iTCP:${port}`), '-sTCP:LISTEN', '-Fpctn'],
    { cwd: process.cwd(), timeoutMs: 5000 }
  )

  if (!result.ok && !result.output) return []
  return parseLsofTcpListeners(result.output)
}

function describeTcpListenerOwners(listeners: TcpListenerOwner[]): string {
  if (!listeners.length) return 'sin listeners'

  return listeners
    .map((listener) => `${listener.endpoint} -> ${listener.command || 'unknown'}${listener.pid ? ` (pid ${listener.pid})` : ''}`)
    .join(', ')
}

function tcpListenerOwnedByRabbitmq(listener: TcpListenerOwner): boolean {
  return /beam\.smp|rabbitmq-server/i.test(listener.command)
}

async function nativeBuildStatus(): Promise<KoinosNodeNativeBuildsResult> {
  return nativeBuildService.monolithBuildStatus()
}

async function nativeBuildAll(): Promise<KoinosNodeNativeBuildCommandResult> {
  const result = await nativeBuildService.monolithBuildAll()
  if (result.ok && result.builds.ok) monolithFallbackReason = null
  return result
}

async function nativeBuildServiceAction(input?: KoinosNodeNativeBuildCommandInput): Promise<KoinosNodeNativeBuildCommandResult> {
  const result = await nativeBuildService.monolithBuildServiceAction(input)
  if (result.ok && result.builds.ok) monolithFallbackReason = null
  return result
}

function normalizeLogsTail(inputTail: unknown, fallback = 200): number {
  return logsService.normalizeLogsTail(inputTail, fallback)
}

function stopLogsFollowStream(streamId: string): KoinosNodeLogsFollowStopResult {
  return logsService.stopLogsFollowStream(streamId)
}

function sortComposeServices(a: ServiceStatus, b: ServiceStatus): number {
  const indexA = KOINOS_MANAGED_SERVICES.findIndex((definition) => definition.id === a.id)
  const indexB = KOINOS_MANAGED_SERVICES.findIndex((definition) => definition.id === b.id)
  const orderA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA
  const orderB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB
  if (orderA !== orderB) return orderA - orderB
  return a.name.localeCompare(b.name)
}

function sortManagedServiceIds(serviceIds: Iterable<string>): string[] {
  const order = new Map(KOINOS_MANAGED_SERVICES.map((service, index) => [service.id, index] as const))
  return [...serviceIds].sort((left, right) => {
    const leftIndex = order.get(left) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = order.get(right) ?? Number.MAX_SAFE_INTEGER
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    return left.localeCompare(right)
  })
}

function selectedManagedComposeServiceIds(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): string[] {
  return sortManagedServiceIds(
    [...serviceDefinitions.entries()]
      .filter(([, definition]) => composeServiceMatchesProfiles(definition, settings.profiles))
      .map(([serviceName]) => KOINOS_MANAGED_SERVICE_BY_ID.get(serviceName)?.id ?? null)
      .filter((serviceId): serviceId is string => Boolean(serviceId))
  )
}

function sortManagedServiceIdsByDependencies(
  serviceIds: Iterable<string>,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): string[] {
  const included = new Set(serviceIds)
  const resolved = new Set<string>()
  const active = new Set<string>()
  const ordered: string[] = []

  const visit = (serviceId: string) => {
    if (!included.has(serviceId) || resolved.has(serviceId)) return
    if (active.has(serviceId)) return
    active.add(serviceId)

    const dependencies = serviceDefinitions.get(serviceId)?.dependsOn ?? []
    for (const dependency of dependencies.map(toManagedServiceId)) {
      visit(dependency)
    }

    active.delete(serviceId)
    resolved.add(serviceId)
    ordered.push(serviceId)
  }

  for (const serviceId of sortManagedServiceIds(included)) {
    visit(serviceId)
  }

  return ordered
}

function tailTextLines(text: string, tail: number): string {
  return logsService.tailTextLines(text, tail)
}

function composeServicePortByTarget(
  definition: NativeServiceDefinition | undefined,
  targetPort: number
): KoinosNodeServicePort | null {
  return definition?.ports.find((port) => port.targetPort === targetPort) ?? null
}

function nativeServiceConnectHost(port: KoinosNodeServicePort | null, fallback = '127.0.0.1'): string {
  if (!port?.host || port.host === '0.0.0.0') return fallback
  return port.host
}

function nativeServiceBindHost(port: KoinosNodeServicePort | null, fallback = '127.0.0.1'): string {
  return port?.host || fallback
}

function nativeAmqpRuntimeDir(settings: KoinosNodeSettings): string {
  const baseDir = path.isAbsolute(settings.baseDir) ? settings.baseDir : path.join(os.homedir(), settings.baseDir)
  return path.join(baseDir, 'amqp')
}

function nativeAmqpConfigPath(settings: KoinosNodeSettings): string {
  return path.join(nativeAmqpRuntimeDir(settings), 'rabbitmq.conf')
}

function nativeAmqpEnabledPluginsPath(settings: KoinosNodeSettings): string {
  return path.join(nativeAmqpRuntimeDir(settings), 'enabled_plugins')
}

function nativeAmqpMnesiaDir(settings: KoinosNodeSettings): string {
  return path.join(nativeAmqpRuntimeDir(settings), 'mnesia')
}

function nativeAmqpLogsDir(settings: KoinosNodeSettings): string {
  return path.join(nativeAmqpRuntimeDir(settings), 'logs')
}

function nativeAmqpNodeToken(settings: KoinosNodeSettings): string {
  return createHash('sha1').update(path.resolve(settings.baseDir)).digest('hex').slice(0, 8)
}

function nativeAmqpNodeName(settings: KoinosNodeSettings): string {
  return `knodelrabbit${nativeAmqpNodeToken(settings)}@localhost`
}

function nativeAmqpDistPort(settings: KoinosNodeSettings): number {
  return 26672 + (parseInt(nativeAmqpNodeToken(settings).slice(0, 4), 16) % 1000)
}

function nativeRabbitmqListenerValue(port: KoinosNodeServicePort | null, fallbackPort: number): string {
  const host = port?.host?.trim() || ''
  const publishedPort = port?.publishedPort ?? fallbackPort
  if (!host || host === '0.0.0.0') return String(publishedPort)
  return `${host}:${publishedPort}`
}

function ensureNativeAmqpRuntimeFiles(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): { configPath: string; enabledPluginsPath: string; mnesiaDir: string; logsDir: string } {
  const runtimeDir = nativeAmqpRuntimeDir(settings)
  const configPath = nativeAmqpConfigPath(settings)
  const enabledPluginsPath = nativeAmqpEnabledPluginsPath(settings)
  const mnesiaDir = nativeAmqpMnesiaDir(settings)
  const logsDir = nativeAmqpLogsDir(settings)

  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.mkdirSync(mnesiaDir, { recursive: true })
  fs.mkdirSync(logsDir, { recursive: true })

  const sourceConfigPath = path.join(configDirPath(settings), 'rabbitmq.conf')
  const sourceConfig = fs.existsSync(sourceConfigPath) ? fs.readFileSync(sourceConfigPath, 'utf8').trim() : ''
  const amqpPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 5672)
  const amqpAdminPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 15672)
  const configLines = [
    sourceConfig,
    '# Generated by koinosGUI for native runtime compatibility',
    `listeners.tcp.default = ${nativeRabbitmqListenerValue(amqpPort, 5672)}`,
    amqpAdminPort?.host && amqpAdminPort.host !== '0.0.0.0' ? `management.tcp.ip = ${amqpAdminPort.host}` : '',
    `management.tcp.port = ${amqpAdminPort?.publishedPort ?? 15672}`
  ].filter(Boolean)

  fs.writeFileSync(configPath, `${configLines.join('\n')}\n`, 'utf8')
  fs.writeFileSync(enabledPluginsPath, '[rabbitmq_management].\n', 'utf8')

  return {
    configPath,
    enabledPluginsPath,
    mnesiaDir,
    logsDir
  }
}

function nativeAmqpEnv(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): NodeJS.ProcessEnv {
  const runtimeFiles = ensureNativeAmqpRuntimeFiles(settings, serviceDefinitions)
  const homebrewPrefix = nativeRabbitmqHomebrewPrefix()
  const rabbitmqOptPrefix = nativeRabbitmqOptPrefix()
  const pathValue = uniquePathValue([
    homebrewPrefix ? path.join(homebrewPrefix, 'bin') : null,
    homebrewPrefix ? path.join(homebrewPrefix, 'sbin') : null,
    process.env.PATH
  ])

  return {
    PATH: pathValue,
    NODENAME: nativeAmqpNodeName(settings),
    RABBITMQ_NODENAME: nativeAmqpNodeName(settings),
    NODE_IP_ADDRESS: '127.0.0.1',
    RABBITMQ_NODE_IP_ADDRESS: '127.0.0.1',
    RABBITMQ_CONFIG_FILE: runtimeFiles.configPath,
    RABBITMQ_MNESIA_BASE: runtimeFiles.mnesiaDir,
    RABBITMQ_LOG_BASE: runtimeFiles.logsDir,
    RABBITMQ_ENABLED_PLUGINS_FILE: runtimeFiles.enabledPluginsPath,
    RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: `-kernel inet_dist_listen_min ${nativeAmqpDistPort(
      settings
    )} -kernel inet_dist_listen_max ${nativeAmqpDistPort(settings)}`,
    ...(rabbitmqOptPrefix && homebrewPrefix
      ? {
          PLUGINS_DIR: `${path.join(rabbitmqOptPrefix, 'plugins')}:${path.join(
            homebrewPrefix,
            'share',
            'rabbitmq',
            'plugins'
          )}`
        }
      : {})
  }
}

function nativeAmqpUrl(serviceDefinitions: Map<string, NativeServiceDefinition>): string {
  const amqpPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 5672)
  return `amqp://guest:guest@${nativeServiceConnectHost(amqpPort)}:${amqpPort?.publishedPort ?? 5672}/`
}

function nativeJsonrpcUrl(serviceDefinitions: Map<string, NativeServiceDefinition>): string {
  const jsonrpcPort = composeServicePortByTarget(serviceDefinitions.get('jsonrpc'), 8080)
  return `http://${nativeServiceConnectHost(jsonrpcPort)}:${jsonrpcPort?.publishedPort ?? 8080}/`
}

function nativeServiceDefaultRuntimeName(serviceId: string, definition?: NativeServiceBuildDefinition): string {
  if (serviceId === 'amqp') {
    const gmq = resolveAmqpBrokerPath()
    if (gmq && fs.existsSync(gmq)) return 'garagemq'
    return nativeAmqpUsesBrewService() ? 'brew services rabbitmq' : 'rabbitmq-server'
  }
  if (serviceId === 'rest' && definition) {
    return fs.existsSync(path.join(definition.repoPath, '.next', 'standalone', 'server.js'))
      ? 'node .next/standalone/server.js'
      : 'yarn start'
  }
  if (definition?.artifactPath) return path.basename(definition.artifactPath)
  return serviceId
}

function appendNativeServiceOutput(serviceId: string, chunk: Buffer | string): void {
  logsService.appendNativeServiceOutput(serviceId, chunk)
}

function closeNativeLogStreamsForService(serviceId: string, code?: number | null): void {
  logsService.closeNativeLogStreamsForService(serviceId, code)
}

function nativeServiceRunning(serviceId: string): boolean {
  const state = nativeServiceProcesses.get(serviceId)
  return Boolean(state && !state.closed)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canConnectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
    socket.connect(port, host)
  })
}

async function waitForTcpListener(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await canConnectTcp(host, port, 750)) return true
    await delay(250)
  }

  return false
}

async function waitForTcpListenerClosed(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!(await canConnectTcp(host, port, 750))) return true
    await delay(250)
  }

  return false
}

function nativeAmqpUsesBrewService(): boolean {
  // GarageMQ takes priority over Homebrew RabbitMQ when the binary exists
  const gmq = resolveAmqpBrokerPath()
  if (gmq && fs.existsSync(gmq)) return false
  return process.platform === 'darwin' && Boolean(findExecutableInPath('brew')) && Boolean(nativeRabbitmqServerExecutable())
}

async function nativeAmqpBrewServiceState(): Promise<{
  available: boolean
  started: boolean
  status: string
  output: string
}> {
  const brewExecutable = findExecutableInPath('brew')
  if (!brewExecutable) {
    return {
      available: false,
      started: false,
      status: 'unavailable',
      output: 'Homebrew no esta disponible para gestionar rabbitmq'
    }
  }

  const result = await runCommand(brewExecutable, ['services', 'list'], {
    cwd: process.cwd()
  })

  if (!result.ok) {
    return {
      available: false,
      started: false,
      status: 'error',
      output: result.output || 'No se pudo consultar brew services'
    }
  }

  const line = result.output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^rabbitmq\s+/i.test(entry))

  if (!line) {
    return {
      available: true,
      started: false,
      status: 'stopped',
      output: 'rabbitmq no aparece en brew services'
    }
  }

  const status = line.split(/\s+/)[1] ?? 'unknown'
  return {
    available: true,
    started: status === 'started',
    status,
    output: line
  }
}

function nativeAmqpHomebrewLogDir(): string | null {
  const homebrewPrefix = nativeRabbitmqHomebrewPrefix()
  if (!homebrewPrefix) return null

  const logDir = path.join(homebrewPrefix, 'var', 'log', 'rabbitmq')
  return fs.existsSync(logDir) ? logDir : null
}

function nativeAmqpHomebrewLogFiles(): string[] {
  const logDir = nativeAmqpHomebrewLogDir()
  if (!logDir) return []

  return fs
    .readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(logDir, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

function waitForChildClose(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number
): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, timeoutMs)

    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code)
    })
  })
}

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      require('node:child_process').execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' })
    } catch {
      // ignore - process may already be dead
    }
  }
}

async function stopNativeServiceProcess(serviceId: string): Promise<NativeServiceStopResult> {
  const state = nativeServiceProcesses.get(serviceId)
  if (!state || state.closed) {
    return {
      ok: true,
      output: `${serviceId} ya estaba detenido`
    }
  }

  state.stopRequested = true
  const pid = state.child.pid ?? null

  try {
    state.child.kill('SIGTERM')
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : `No se pudo detener ${serviceId}`
    }
  }

  const closeCode = await waitForChildClose(state.child, serviceId === 'amqp' ? 15000 : 5000)
  if (closeCode !== null || state.closed) {
    return {
      ok: true,
      output: `Stopped ${serviceId} (pid ${pid ?? 'n/a'})`
    }
  }

  // On Windows, use taskkill /T to kill the entire process tree
  if (process.platform === 'win32' && pid) {
    killProcessTree(pid)
  } else {
    try {
      state.child.kill('SIGKILL')
    } catch {
      // ignore final kill errors
    }
  }

  return {
    ok: true,
    output: `Force-stopped ${serviceId} (pid ${pid ?? 'n/a'})`
  }
}

function nativeServiceLaunchSpec(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): NativeServiceLaunchSpec {
  if (serviceId === 'amqp') {
    const garagemqBinary = resolveAmqpBrokerPath()
    if (!fs.existsSync(garagemqBinary)) {
      // Fallback to system RabbitMQ if GarageMQ not bundled
      const rabbitmqServer = nativeRabbitmqServerExecutable()
      if (!rabbitmqServer) {
        throw new Error('No se encontro garagemq ni rabbitmq-server. Compila GarageMQ o instala RabbitMQ.')
      }
      return {
        serviceId,
        command: rabbitmqServer,
        args: [],
        cwd: nativeAmqpRuntimeDir(settings),
        env: nativeAmqpEnv(settings, serviceDefinitions),
        runtimeName: 'rabbitmq-server'
      }
    }

    // Use bundled GarageMQ
    const runtimeDir = nativeAmqpRuntimeDir(settings)
    fs.mkdirSync(runtimeDir, { recursive: true })
    const runtimeConfig = path.join(runtimeDir, 'garagemq.yaml')
    if (!fs.existsSync(runtimeConfig)) {
      const templateConfig = resolveAmqpBrokerConfigPath()
      if (fs.existsSync(templateConfig)) {
        fs.copyFileSync(templateConfig, runtimeConfig)
      }
    }

    const amqpPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 5672)
    const adminPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 15672)
    return {
      serviceId,
      command: garagemqBinary,
      args: [
        '--config', runtimeConfig,
        ...(amqpPort ? [] : []),
      ],
      cwd: runtimeDir,
      runtimeName: 'garagemq'
    }
  }

  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  if (!buildDefinition) {
    throw new Error(`No hay un launcher nativo configurado para ${serviceId}`)
  }

  const amqpUrl = nativeAmqpUrl(serviceDefinitions)
  if (serviceId === 'rest') {
    const restPort = composeServicePortByTarget(serviceDefinitions.get('rest'), 3000)
    const restEnv: Record<string, string> = {
      JSONRPC_URL: nativeJsonrpcUrl(serviceDefinitions),
      HOSTNAME: nativeServiceBindHost(restPort),
      PORT: String(restPort?.publishedPort ?? 3000),
      NODE_ENV: 'production'
    }

    if (isPackagedBuild()) {
      // In packaged mode, use Electron's own Node.js via ELECTRON_RUN_AS_NODE
      const restRoot = resolveKoinosRestRoot()
      const serverJs = path.join(restRoot, 'server.js')
      return {
        serviceId,
        command: process.execPath,
        args: [serverJs],
        cwd: restRoot,
        env: { ...restEnv, ELECTRON_RUN_AS_NODE: '1' },
        runtimeName: 'electron-node server.js'
      }
    }

    const standaloneServerPath = path.join(buildDefinition.repoPath, '.next', 'standalone', 'server.js')
    return {
      serviceId,
      command: fs.existsSync(standaloneServerPath) ? 'node' : 'yarn',
      args: fs.existsSync(standaloneServerPath) ? [standaloneServerPath] : ['start'],
      cwd: buildDefinition.repoPath,
      env: restEnv,
      runtimeName: fs.existsSync(standaloneServerPath) ? 'node .next/standalone/server.js' : 'yarn start'
    }
  }

  const absoluteBaseDir = path.isAbsolute(settings.baseDir) ? settings.baseDir : path.join(os.homedir(), settings.baseDir)
  const args = [`--basedir=${absoluteBaseDir}`, `--amqp=${amqpUrl}`]

  if (serviceId === 'p2p') {
    const p2pPort = composeServicePortByTarget(serviceDefinitions.get('p2p'), 8888)
    args.push(`--listen=/ip4/${nativeServiceBindHost(p2pPort, '0.0.0.0')}/tcp/${p2pPort?.publishedPort ?? 8888}`)
  }

  if (serviceId === 'jsonrpc') {
    const jsonrpcPort = composeServicePortByTarget(serviceDefinitions.get('jsonrpc'), 8080)
    args.push(`--listen=/ip4/${nativeServiceBindHost(jsonrpcPort)}/tcp/${jsonrpcPort?.publishedPort ?? 8080}`)
  }

  if (serviceId === 'grpc') {
    const grpcPort = composeServicePortByTarget(serviceDefinitions.get('grpc'), 50051)
    args.push(`--endpoint=${nativeServiceBindHost(grpcPort)}:${grpcPort?.publishedPort ?? 50051}`)
  }

  return {
    serviceId,
    command: buildDefinition.artifactPath,
    args,
    cwd: buildDefinition.repoPath,
    runtimeName: nativeServiceDefaultRuntimeName(serviceId, buildDefinition)
  }
}

async function startNativeServiceProcess(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinitions: Map<string, NativeServiceDefinition>
): Promise<{ ok: boolean; output: string }> {
  const existingState = nativeServiceProcesses.get(serviceId)
  if (existingState && !existingState.closed) {
    if (
      nativeServiceUsesBaseDir(serviceId) &&
      existingState.baseDir &&
      path.resolve(existingState.baseDir) !== path.resolve(settings.baseDir)
    ) {
      return {
        ok: false,
        output: `${serviceId} sigue activo con BASEDIR ${existingState.baseDir} (pid ${existingState.child.pid ?? 'n/a'}). Usa Restart para moverlo a ${settings.baseDir}.`
      }
    }

    return {
      ok: true,
      output: `${serviceId} ya estaba activo`
    }
  }

  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  if (serviceId !== 'amqp' && !buildDefinition) {
    return {
      ok: false,
      output: `No hay build nativo configurado para ${serviceId}`
    }
  }

  if (serviceId !== 'amqp' && serviceId !== 'rest' && buildDefinition && !fs.existsSync(buildDefinition.artifactPath)) {
    return {
      ok: false,
      output: `Falta el artefacto nativo para ${serviceId}: ${buildDefinition.artifactPath}`
    }
  }

  // After backup restore: temporarily force verify-blocks=true for correct merkle roots
  if (serviceId === 'chain') {
    const backupMarkerPath = path.join(settings.baseDir, '.backup-just-restored')
    if (fs.existsSync(backupMarkerPath)) {
      try {
        const configPath = path.join(settings.baseDir, 'config.yml')
        if (fs.existsSync(configPath)) {
          const yaml = require('yaml')
          const doc = yaml.parseDocument(fs.readFileSync(configPath, 'utf-8'))
          const currentVerify = doc.getIn(['chain', 'verify-blocks'])

          if (!currentVerify) {
            // Enable verify-blocks for this startup to fix merkle roots
            doc.setIn(['chain', 'verify-blocks'], true)
            fs.writeFileSync(configPath, doc.toString(), 'utf-8')
            console.log('[chain] Backup restore detected — enabled verify-blocks for merkle correction')

            // Schedule: after chain starts and finishes indexing, revert verify-blocks and restart
            const revertAfterIndexing = () => {
              setTimeout(async () => {
                const chainState = nativeServiceProcesses.get('chain')
                if (!chainState || chainState.closed) return

                // Wait for chain to finish indexing (up to 60 seconds)
                let indexingDone = false
                for (let i = 0; i < 60; i++) {
                  await new Promise(resolve => setTimeout(resolve, 1000))
                  const cs = nativeServiceProcesses.get('chain')
                  if (!cs || cs.closed) return
                  // Check if chain is listening (indexing done)
                  // Check chain log file for indexing completion
                  const chainLogPath = path.join(settings.baseDir, 'chain', 'logs', 'chain.log')
                  const logContent = fs.existsSync(chainLogPath) ? fs.readFileSync(chainLogPath, 'utf-8') : ''
                  if (logContent.includes('Listening for requests over AMQP')) {
                    indexingDone = true
                    break
                  }
                }

                if (!indexingDone) {
                  console.log('[chain] Backup merkle correction: timed out waiting for indexer')
                  return
                }

                // Revert verify-blocks to false
                try {
                  const doc2 = yaml.parseDocument(fs.readFileSync(configPath, 'utf-8'))
                  doc2.setIn(['chain', 'verify-blocks'], false)
                  fs.writeFileSync(configPath, doc2.toString(), 'utf-8')
                  fs.unlinkSync(backupMarkerPath)
                  console.log('[chain] Backup merkle correction complete — reverted verify-blocks, restarting chain')

                  // Restart chain with corrected config
                  const stopResult = await stopNativeServiceProcess('chain')
                  if (stopResult.ok) {
                    await startNativeServiceProcess(settings, 'chain', serviceDefinitions)
                  }
                } catch (revertError) {
                  console.log('[chain] Could not revert verify-blocks:', revertError)
                }
              }, 2000)
            }
            revertAfterIndexing()
          } else {
            // verify-blocks already true, just clean up the marker
            fs.unlinkSync(backupMarkerPath)
          }
        }
      } catch (markerError) {
        console.log('[chain] Backup marker check failed:', markerError)
      }
    }
  }

  // Auto-inject producer address into config.yml if starting block_producer without one
  if (serviceId === 'block_producer') {
    try {
      const configPath = path.join(settings.baseDir, 'config.yml')
      if (fs.existsSync(configPath)) {
        const yaml = require('yaml')
        const configContent = fs.readFileSync(configPath, 'utf-8')
        const doc = yaml.parseDocument(configContent)
        const existingProducer = doc.getIn(['block_producer', 'producer'])
        if (!existingProducer) {
          // Try to get address from wallet
          const walletResult = await walletService.walletOverview()
          const address = (walletResult as any)?.accounts?.[0]?.address || (walletResult as any)?.address
          if (address) {
            doc.setIn(['block_producer', 'producer'], address)
            fs.writeFileSync(configPath, doc.toString(), 'utf-8')
            console.log(`[block_producer] Auto-set producer address to ${address} in config.yml`)
          } else {
            return {
              ok: false,
              output: 'No producer address configured and no wallet found. Create a wallet in the Wallet tab first, then retry.'
            }
          }
        }
      }
    } catch (configError) {
      console.log(`[block_producer] Could not auto-inject producer address: ${configError instanceof Error ? configError.message : configError}`)
    }
  }

  let launchSpec: NativeServiceLaunchSpec
  try {
    launchSpec = nativeServiceLaunchSpec(settings, serviceId, serviceDefinitions)
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : `No se pudo preparar el launcher nativo para ${serviceId}`
    }
  }

  const processSnapshot = await listProcessSnapshot()
  const conflictingProcesses = detectExternalNativeServiceProcesses(settings, serviceId, processSnapshot)
  if (conflictingProcesses.length > 0) {
    return {
      ok: false,
      output: describeExternalNativeServiceConflict(settings, serviceId, conflictingProcesses)
    }
  }

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchSpec.cwd,
    env: { ...process.env, ...launchSpec.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const state: NativeServiceProcessState = {
    serviceId,
    child,
    runtimeName: launchSpec.runtimeName,
    cwd: launchSpec.cwd,
    baseDir: nativeServiceUsesBaseDir(serviceId) ? settings.baseDir : null,
    startedAt: Date.now(),
    lastOutputAt: null,
    output: '',
    lastError: null,
    exitCode: null,
    stopRequested: false,
    closed: false
  }
  nativeServiceProcesses.set(serviceId, state)

  child.stdout.on('data', (chunk: Buffer | string) => {
    appendNativeServiceOutput(serviceId, chunk)
  })

  child.stderr.on('data', (chunk: Buffer | string) => {
    appendNativeServiceOutput(serviceId, chunk)
  })

  child.on('error', (error) => {
    state.lastError = error.message
    appendNativeServiceOutput(serviceId, `${error.message}\n`)
  })

  child.on('close', (code, signal) => {
    state.closed = true
    state.exitCode = code
    if (!state.stopRequested && (code !== 0 || signal)) {
      state.lastError = state.lastError || `Exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`
      appendNativeServiceOutput(serviceId, `${state.lastError}\n`)
    }
    if (state.stopRequested && code === 0) {
      state.lastError = null
    }
    closeNativeLogStreamsForService(serviceId, code)
  })

  if (serviceId === 'amqp') {
    const amqpPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 5672)
    const amqpAdminPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 15672)
    const amqpConnectHost = nativeServiceConnectHost(amqpPort)
    const amqpAdminConnectHost = nativeServiceConnectHost(amqpAdminPort)
    const amqpReady = await waitForTcpListener(amqpConnectHost, amqpPort?.publishedPort ?? 5672, 15000)
    const adminReady = await waitForTcpListener(
      amqpAdminConnectHost,
      amqpAdminPort?.publishedPort ?? 15672,
      15000
    )

    if (!amqpReady || !adminReady) {
      if (!state.closed) {
        await stopNativeServiceProcess(serviceId)
      }
      return {
        ok: false,
        output:
          tailTextLines(state.output, 80) ||
          `RabbitMQ no quedo listo en ${amqpConnectHost}:${amqpPort?.publishedPort ?? 5672} y ${amqpAdminConnectHost}:${
            amqpAdminPort?.publishedPort ?? 15672
          }`
      }
    }

    await delay(500)
  } else {
    await delay(1000)
  }

  if (state.closed) {
    return {
      ok: false,
      output: tailTextLines(state.output, 80) || state.lastError || `Component ${serviceId} exited during startup`
    }
  }

  return {
    ok: true,
    output: `Started ${serviceId} (${launchSpec.runtimeName}, pid ${child.pid ?? 'n/a'})`
  }
}

function toManagedServiceId(service: string): string {
  return KOINOS_MANAGED_SERVICE_BY_ID.get(service)?.id ?? service
}

function serviceDisplayName(serviceId: string): string {
  return KOINOS_MANAGED_SERVICE_BY_ID.get(serviceId)?.displayName ?? serviceId
}

function isComposeServiceRunning(service: ServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

/**
 * Build native service definitions from known Koinos service metadata.
 * Hardcoded native service definitions with ports, dependencies, and profiles.
 */
function readNativeServiceDefinitions(_settings: KoinosNodeSettings): Map<string, NativeServiceDefinition> {
  const defs = new Map<string, NativeServiceDefinition>()

  // Core services (no profile)
  defs.set('amqp', { ports: [{ host: '127.0.0.1', publishedPort: 5672, targetPort: 5672, protocol: 'tcp', label: '5672/tcp' }, { host: '127.0.0.1', publishedPort: 15672, targetPort: 15672, protocol: 'tcp', label: '15672/tcp' }], dependsOn: [], profiles: [] })
  defs.set('chain', { ports: [], dependsOn: ['amqp'], profiles: [] })
  defs.set('mempool', { ports: [], dependsOn: ['amqp', 'chain'], profiles: [] })
  defs.set('block_store', { ports: [], dependsOn: ['amqp'], profiles: [] })
  defs.set('p2p', { ports: [{ host: '0.0.0.0', publishedPort: 8888, targetPort: 8888, protocol: 'tcp', label: '8888/tcp' }], dependsOn: ['amqp', 'chain'], profiles: [] })

  // Profile services
  defs.set('block_producer', { ports: [], dependsOn: ['amqp', 'chain', 'mempool', 'jsonrpc'], profiles: ['block_producer'] })
  defs.set('jsonrpc', { ports: [{ host: '127.0.0.1', publishedPort: 8080, targetPort: 8080, protocol: 'tcp', label: '8080/tcp' }], dependsOn: ['amqp', 'chain'], profiles: ['jsonrpc'] })
  defs.set('grpc', { ports: [{ host: '127.0.0.1', publishedPort: 50051, targetPort: 50051, protocol: 'tcp', label: '50051/tcp' }], dependsOn: ['amqp', 'chain'], profiles: ['grpc'] })
  defs.set('transaction_store', { ports: [], dependsOn: ['amqp'], profiles: ['transaction_store'] })
  defs.set('contract_meta_store', { ports: [], dependsOn: ['amqp'], profiles: ['contract_meta_store'] })
  defs.set('account_history', { ports: [], dependsOn: ['amqp'], profiles: ['account_history'] })
  defs.set('rest', { ports: [{ host: '127.0.0.1', publishedPort: 1080, targetPort: 1080, protocol: 'tcp', label: '1080/tcp' }], dependsOn: ['amqp', 'jsonrpc'], profiles: ['rest'] })

  return defs
}

function composeServiceMatchesProfiles(definition: NativeServiceDefinition, profiles: string[]): boolean {
  if (definition.profiles.length === 0) return true
  if (profiles.length === 0) return false
  const requestedProfiles = new Set(profiles)
  return definition.profiles.some((profile) => requestedProfiles.has(profile))
}

async function nativeServiceStatusFromProcessState(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinition: NativeServiceDefinition,
  state: NativeServiceProcessState | undefined,
  processSnapshot: ProcessSnapshotEntry[]
): Promise<ServiceStatus> {
  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  const fallbackRuntimeName = nativeServiceDefaultRuntimeName(serviceId, buildDefinition)
  const runtimeName = state?.runtimeName ?? fallbackRuntimeName
  const version = await resolveNativeServiceVersion(serviceId, buildDefinition)
  const garagemqBinary = serviceId === 'amqp' ? resolveAmqpBrokerPath() : null
  const rabbitmqExecutable = serviceId === 'amqp' && (!garagemqBinary || !fs.existsSync(garagemqBinary)) ? nativeRabbitmqServerExecutable() : null
  const amqpRuntimeMissing =
    serviceId === 'amqp' && (!garagemqBinary || !fs.existsSync(garagemqBinary)) && !rabbitmqExecutable ? 'No se encontro garagemq ni rabbitmq-server' : null
  const artifactMissing =
    serviceId !== 'amqp' && buildDefinition ? !fs.existsSync(buildDefinition.artifactPath) : false
  const conflictingProcesses = detectExternalNativeServiceProcesses(
    settings,
    serviceId,
    processSnapshot,
    state && !state.closed && state.child.pid ? [state.child.pid] : []
  )
  const runningWithDifferentBaseDir =
    state &&
    !state.closed &&
    nativeServiceUsesBaseDir(serviceId) &&
    state.baseDir &&
    path.resolve(state.baseDir) !== path.resolve(settings.baseDir)

  if (runningWithDifferentBaseDir) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'restart required',
      status: `Running with old BASEDIR (pid ${state.child.pid ?? 'n/a'})`,
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: `Component is still using BASEDIR ${state.baseDir}. Restart it to move it to ${settings.baseDir}.`,
      nativePid: state.child.pid ?? null,
      conflictPids: [],
      managedByKnodel: true
    }
  }

  if (state && !state.closed && conflictingProcesses.length === 0) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'running',
      status: `Running (pid ${state.child.pid ?? 'n/a'})`,
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: null,
      nativePid: state.child.pid ?? null,
      conflictPids: [],
      managedByKnodel: true
    }
  }

  if (conflictingProcesses.length > 0) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'conflict',
      status: 'Conflicting native process detected',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: describeExternalNativeServiceConflict(settings, serviceId, conflictingProcesses),
      nativePid: null,
      conflictPids: conflictingProcesses.map((entry) => entry.pid),
      managedByKnodel: false
    }
  }

  if (amqpRuntimeMissing) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'unavailable',
      status: 'Missing native runtime',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: amqpRuntimeMissing,
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  if (artifactMissing) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'not built',
      status: 'Missing native artifact',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: buildDefinition ? `Falta el artefacto nativo: ${buildDefinition.artifactPath}` : 'Sin build nativo',
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  if (state?.closed && !state.stopRequested) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: serviceId,
      runtimeName,
      version,
      state: 'exited',
      status: `Exited (${state.exitCode ?? 'null'})`,
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: state.lastError || `Exited with code ${state.exitCode ?? 'null'}`,
      nativePid: state.child.pid ?? null,
      conflictPids: [],
      managedByKnodel: true
    }
  }

  return {
    id: serviceId,
    name: serviceDisplayName(serviceId),
    service: serviceId,
    runtimeName,
    version,
    state: 'stopped',
    status: 'Stopped',
    ports: serviceDefinition.ports,
    dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
    lastError: null,
    nativePid: null,
    conflictPids: [],
    managedByKnodel: false
  }
}

async function nativeAmqpBrewComposeStatus(
  settings: KoinosNodeSettings,
  serviceDefinition: NativeServiceDefinition
): Promise<ServiceStatus> {
  const runtimeName = 'brew services rabbitmq'
  const version = await resolveNativeServiceVersion('amqp', undefined)
  const rabbitmqServer = nativeRabbitmqServerExecutable()
  if (!rabbitmqServer) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      version,
      state: 'unavailable',
      status: 'Missing native runtime',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: 'No se encontro rabbitmq-server para el runtime native',
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  const brewState = await nativeAmqpBrewServiceState()
  if (!brewState.available) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      version,
      state: 'unavailable',
      status: 'Homebrew unavailable',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: brewState.output,
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  const amqpPort = composeServicePortByTarget(serviceDefinition, 5672)
  const amqpAdminPort = composeServicePortByTarget(serviceDefinition, 15672)
  const listenerPorts = [amqpPort?.publishedPort ?? 5672, amqpAdminPort?.publishedPort ?? 15672]
  const listeners = await listTcpListenerOwners(listenerPorts)
  const amqpReady = await canConnectTcp(nativeServiceConnectHost(amqpPort), amqpPort?.publishedPort ?? 5672, 750)
  const adminReady = await canConnectTcp(nativeServiceConnectHost(amqpAdminPort), amqpAdminPort?.publishedPort ?? 15672, 750)
  if (brewState.started && amqpReady && adminReady) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      version,
      state: 'running',
      status: 'Running (brew service)',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: null,
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  if (brewState.started) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      version,
      state: 'starting',
      status: 'Starting (brew service)',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: `rabbitmq esta marcado como ${brewState.status}, pero los puertos 5672/15672 aun no estan listos`,
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  return {
    id: 'amqp',
    name: serviceDisplayName('amqp'),
    service: 'amqp',
    runtimeName,
    version,
    state: 'stopped',
    status: 'Stopped',
    ports: serviceDefinition.ports,
    dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
    lastError: null,
    nativePid: null,
    conflictPids: [],
    managedByKnodel: false
  }
}

async function nativeComposeStatus(input?: KoinosNodeSettingsInput): Promise<KoinosNodeStatus> {
  const settings = normalizeNodeSettings(input)
  const configDir = configDirPath(settings)

  // Monolith mode: single process status with component health
  if (shouldUseMonolithMode() || (monolithProcessState && !monolithProcessState.closed)) {
    const isRunning = monolithProcessState != null && !monolithProcessState.closed
    const monolithService: ServiceStatus = {
      id: 'koinos-node',
      name: 'Koinos Node',
      service: 'koinos-node',
      runtimeName: 'koinos_node',
      version: null,
      state: isRunning ? 'running' : 'stopped',
      status: isRunning
        ? `Running (pid ${monolithProcessState?.child.pid ?? 'n/a'})`
        : 'Stopped',
      ports: [
        { host: '127.0.0.1', publishedPort: 8080, targetPort: 8080, protocol: 'tcp', label: '8080/tcp' },
        { host: '0.0.0.0', publishedPort: 8888, targetPort: 8888, protocol: 'tcp', label: '8888/tcp' }
      ],
      dependsOn: [],
      lastError: monolithProcessState?.lastError ?? null,
      nativePid: isRunning ? monolithProcessState?.child.pid ?? null : null,
      conflictPids: [],
      managedByKnodel: true
    }

    return {
      ok: true,
      repoPath: settings.repoPath,
      baseDir: settings.baseDir,
      profiles: settings.profiles,
      configReady: fs.existsSync(configDir),
      configDir,
      services: [monolithService],
      components: parseMonolithComponentHealth(),
      runningServices: isRunning ? 1 : 0,
      output: isRunning
        ? `koinos_node running (pid ${monolithProcessState?.child.pid ?? 'n/a'})`
        : 'koinos_node stopped'
    }
  }

  let serviceDefinitions = new Map<string, NativeServiceDefinition>()

  try {
    assertRepoReady(settings)
    serviceDefinitions = readNativeServiceDefinitions(settings)
  } catch (error) {
    return {
      ok: false,
      repoPath: settings.repoPath,
      baseDir: settings.baseDir,
      profiles: settings.profiles,
      configReady: fs.existsSync(configDir),
      configDir,
      services: [],
      components: [],
      runningServices: 0,
      output: ['', error instanceof Error ? error.message : 'Invalid Koinos native settings']
        .filter(Boolean)
        .join('\n')
    }
  }

  const selectedServiceIds = selectedManagedComposeServiceIds(settings, serviceDefinitions)
  const processSnapshot = await listProcessSnapshot()
  const services = (
    await Promise.all(
      selectedServiceIds.map(async (serviceId): Promise<ServiceStatus | null> => {
        const serviceDefinition = serviceDefinitions.get(serviceId)
        if (!serviceDefinition) return null

        if (serviceId === 'amqp' && nativeAmqpUsesBrewService()) {
          return nativeAmqpBrewComposeStatus(settings, serviceDefinition)
        }

        return nativeServiceStatusFromProcessState(
          settings,
          serviceId,
          serviceDefinition,
          nativeServiceProcesses.get(serviceId),
          processSnapshot
        )
      })
    )
  )
    .filter((service): service is ServiceStatus => service !== null)
    .sort(sortComposeServices)

  const runningServices = services.filter(isComposeServiceRunning).length
  const unavailableNativeServices = services.filter(
    (service) => service.state === 'not built' || service.state === 'unavailable'
  )

  // Derive component health from service statuses for monolith-aware consumers
  const components = services
    .filter((service) => service.id !== 'amqp')
    .map((service) => ({
      name: service.id,
      enabled: true,
      healthy: isComposeServiceRunning(service),
      details: service.status
    }))

  return {
    ok: unavailableNativeServices.length === 0,
    repoPath: settings.repoPath,
    baseDir: settings.baseDir,
    profiles: settings.profiles,
    configReady: fs.existsSync(configDir),
    configDir,
    services,
    components,
    runningServices,
    output: [
      monolithFallbackReason ? monolithFallbackMessage(monolithFallbackReason) : '',
      nativeManagedProcessRegistryOutput(settings),
      unavailableNativeServices.length > 0
        ? unavailableNativeServices.map((service) => service.lastError).filter(Boolean).join('\n')
        : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

async function composePresets(input?: KoinosNodeSettingsInput): Promise<KoinosNodePresetsResult> {
  const settings = normalizeNodeSettings(input)

  try {
    const presets = buildProfilePresets(settings)
    return {
      ok: true,
      presets,
      output: presets.length
        ? `Loaded ${presets.length} native service profiles`
        : `No profiles found for native services`
    }
  } catch (error) {
    return {
      ok: false,
      presets: [],
      output: error instanceof Error ? error.message : 'No se pudieron leer los profiles del compose'
    }
  }
}

function listsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function findProfileDependents(status: KoinosNodeStatus, serviceId: string): ServiceStatus[] {
  return status.services.filter((candidate) => candidate.id !== serviceId && candidate.dependsOn.includes(serviceId))
}

async function resolvePresetOrThrow(
  settings: KoinosNodeSettings,
  presetId: string
): Promise<{ preset: KoinosNodePreset; settings: KoinosNodeSettings }> {
  const presetsResult = await composePresets(settings)
  const preset = presetsResult.presets.find((candidate) => candidate.id === presetId)
  if (!preset) {
    throw new Error(`Profile not found: ${presetId}`)
  }

  return {
    preset,
    settings: {
      ...settings,
      profiles: preset.profiles
    }
  }
}

function prepareNativeStartNotes(settings: KoinosNodeSettings, initialNotes: string[] = []): string[] {
  const notes = [...initialNotes]
  const prep = ensureKoinosConfigFiles(settings)
  notes.push(prep.output)
  fs.mkdirSync(settings.baseDir, { recursive: true })
  notes.push(ensureBaseDirKoinosRuntimeFiles(settings))
  return notes
}

async function nativeRuntimeDockerConflictCheck(_settings: KoinosNodeSettings): Promise<{ ok: boolean; output: string }> {
  return { ok: true, output: '' }
}

async function nativeComposeAction(
  action: 'start' | 'stop',
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeCommandResult> {
  return nativeRuntimeService.nativeComposeAction(action, input)
}

async function nativeComposeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  return nativeRuntimeService.nativeComposeServiceAction(action, input)
}

async function nativeComposePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
  return nativeRuntimeService.nativeComposePresetReconcile(input)
}

async function cloneKoinosRepo(input?: KoinosNodeSettingsInput): Promise<KoinosNodeCloneRepoResult> {
  return workspaceService.cloneKoinosRepo(input)
}

async function readKoinosManagedFile(input: KoinosNodeFileReadInput): Promise<KoinosNodeFileReadResult> {
  return workspaceService.readKoinosManagedFile(input)
}

async function writeKoinosManagedFile(input: KoinosNodeFileWriteInput): Promise<KoinosNodeFileWriteResult> {
  return workspaceService.writeKoinosManagedFile(input)
}

async function nativeComposeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  return logsService.nativeComposeLogs(input)
}

async function nativeComposeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): Promise<KoinosNodeLogsFollowStartResult> {
  return logsService.nativeComposeLogsFollowStart(sender, input)
}

async function koinosNodeStatus(input?: KoinosNodeSettingsInput): Promise<KoinosNodeStatus> {
  const settings = normalizeNodeSettings(input)
  return nativeComposeStatus(settings)
}

async function koinosNodeAction(
  action: 'start' | 'stop',
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeCommandResult> {
  const settings = normalizeNodeSettings(input)

  // Use monolith mode when the binary is available and not disabled by a startup fallback.
  if (shouldUseMonolithMode()) {
    assertRepoReady(settings)
    const result =
      action === 'start'
        ? await startMonolithProcess(settings, [], [])
        : await stopMonolithProcess()
    if (action === 'start' && !result.ok) {
      monolithFallbackReason = result.output
    }
    const status = await nativeComposeStatus(settings)
    return { ok: result.ok, action, output: result.output, status }
  }

  return nativeComposeAction(action, settings)
}

async function koinosNodeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  if (shouldUseMonolithMode()) {
    const settings = normalizeNodeSettings(input)
    const service = input?.service?.trim() || 'koinos-node'

    if (service !== 'koinos-node') {
      const status = await nativeComposeStatus(settings)
      return {
        ok: false,
        action,
        service,
        output: `Monolith mode manages a single koinos-node process; ${service} is a component, not a standalone service`,
        status
      }
    }

    let result: { ok: boolean; output: string }
    if (action === 'start') {
      result = await startMonolithProcess(settings, [], [])
    } else if (action === 'stop') {
      result = await stopMonolithProcess()
    } else if (action === 'restart') {
      const stopResult = await stopMonolithProcess()
      const startResult = await startMonolithProcess(settings, [], [])
      result = {
        ok: stopResult.ok && startResult.ok,
        output: [stopResult.output, startResult.output].filter(Boolean).join('\n')
      }
    } else {
      result = {
        ok: true,
        output: 'Monolith mode has no per-service conflict process to kill'
      }
    }

    if ((action === 'start' || action === 'restart') && !result.ok) {
      monolithFallbackReason = result.output
    }

    return {
      ok: result.ok,
      action,
      service,
      output: result.output,
      status: await nativeComposeStatus(settings)
    }
  }

  const service = input?.service?.trim() || ''
  if (service === 'koinos-node') {
    const settings = normalizeNodeSettings(input)
    let result: { ok: boolean; output: string }
    if (action === 'stop') {
      result = await nativeComposeAction('stop', settings)
    } else if (action === 'restart') {
      const stopResult = await nativeComposeAction('stop', settings)
      const startResult = await nativeComposeAction('start', settings)
      result = {
        ok: stopResult.ok && startResult.ok,
        output: [stopResult.output, startResult.output].filter(Boolean).join('\n')
      }
    } else if (action === 'kill-conflict') {
      result = { ok: true, output: 'Native multi-service mode has no koinos-node process to kill' }
    } else {
      result = await nativeComposeAction('start', settings)
    }
    return {
      ok: result.ok,
      action,
      service,
      output: result.output,
      status: await nativeComposeStatus(settings)
    }
  }

  return nativeComposeServiceAction(action, input)
}

async function koinosNodeComponentToggle(
  input?: KoinosNodeComponentToggleInput
): Promise<KoinosNodeComponentToggleResult> {
  const settings = normalizeNodeSettings(input)
  const component = input?.component?.trim() || ''
  const enabled = input?.enabled ?? true

  if (!component) {
    return {
      ok: false,
      component: '',
      enabled,
      output: 'Parametro component invalido',
      status: await nativeComposeStatus(settings)
    }
  }

  // Monolith mode: write feature flag to config.yml and restart
  if (shouldUseMonolithMode()) {
    try {
      writeMonolithFeatureConfig(settings, { [component]: enabled })
    } catch (error) {
      return {
        ok: false,
        component,
        enabled,
        output: `No se pudo actualizar features.${component}: ${error instanceof Error ? error.message : String(error)}`,
        status: await nativeComposeStatus(settings)
      }
    }

    // Restart monolith if running
    if (monolithProcessState && !monolithProcessState.closed) {
      await stopMonolithProcess()
      await startMonolithProcess(settings, enabled ? [component] : [], enabled ? [] : [component])
    }

    return {
      ok: true,
      component,
      enabled,
      output: `Feature ${component} ${enabled ? 'enabled' : 'disabled'}`,
      status: await nativeComposeStatus(settings)
    }
  }

  // Legacy multi-service mode: start/stop individual service
  const serviceAction = enabled ? 'start' : 'stop'
  const serviceResult = await nativeComposeServiceAction(serviceAction, {
    ...input,
    service: component
  })

  return {
    ok: serviceResult.ok,
    component,
    enabled,
    output: serviceResult.output,
    status: serviceResult.status
  }
}

async function koinosNodePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
  if (shouldUseMonolithMode()) {
    const initialSettings = normalizeNodeSettings(input)
    const presetId = input?.presetId?.trim() || ''
    if (!presetId) {
      return {
        ok: false,
        action: 'reconcile',
        presetId: '',
        output: 'Parametro presetId invalido',
        status: await nativeComposeStatus(initialSettings)
      }
    }

    let presetSettings = initialSettings
    let preset: KoinosNodePreset | null = null

    try {
      const resolved = await resolvePresetOrThrow(initialSettings, presetId)
      preset = resolved.preset
      presetSettings = resolved.settings
    } catch (error) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: error instanceof Error ? error.message : 'No se pudo resolver el profile',
        status: await nativeComposeStatus(initialSettings)
      }
    }

    try {
      assertRepoReady(presetSettings)
      const featureFlags = preset.featureFlags ?? presetToFeatureFlags(presetId)
      const configPath = writeMonolithFeatureConfig(presetSettings, featureFlags)
      const { enabled, disabled } = monolithFeatureCliArgs(featureFlags)
      const stopResult = monolithProcessState && !monolithProcessState.closed
        ? await stopMonolithProcess()
        : { ok: true, output: 'koinos_node ya estaba detenido' }
      const startResult = await startMonolithProcess(presetSettings, enabled, disabled)
      const output = [
        `Updated monolith feature flags in ${configPath}`,
        stopResult.output,
        startResult.output
      ].filter(Boolean).join('\n')

      return {
        ok: stopResult.ok && startResult.ok,
        action: 'reconcile',
        presetId,
        output,
        status: await nativeComposeStatus(presetSettings)
      }
    } catch (error) {
      return {
        ok: false,
        action: 'reconcile',
        presetId,
        output: error instanceof Error ? error.message : 'No se pudo aplicar el preset monolitico',
        status: await nativeComposeStatus(presetSettings)
      }
    }
  }

  return nativeComposePresetReconcile(input)
}

async function koinosNodeRestoreBackup(
  input?: KoinosNodeSettingsInput,
  sender?: Electron.WebContents,
  progressAction: KoinosNodeBackupProgressAction = 'restore-backup',
  completeOnSuccess = true
): Promise<KoinosNodeBackupRestoreResult> {
  return backupService.koinosNodeRestoreBackup(input, sender, progressAction, completeOnSuccess)
}

async function koinosNodeRestoreBackupAndVerify(
  input?: KoinosNodeSettingsInput,
  sender?: Electron.WebContents
): Promise<KoinosNodeBackupRestoreResult> {
  return backupService.koinosNodeRestoreBackupAndVerify(input, sender)
}

async function createLocalBackup(
  input?: KoinosNodeSettingsInput,
  sender?: Electron.WebContents
): Promise<KoinosNodeBackupRestoreResult> {
  return backupService.createLocalBackup(input, sender!)
}

function cancelCreateBackup(): { ok: boolean; output: string } {
  return backupService.cancelCreateBackup()
}

function getVerifyBlocks(input?: KoinosNodeSettingsInput): { ok: boolean; enabled: boolean | null; output: string } {
  return backupService.getVerifyBlocks(input)
}

function setVerifyBlocks(input?: KoinosNodeSettingsInput & { enabled?: boolean }): { ok: boolean; output: string } {
  return backupService.setVerifyBlocks(input)
}

async function restoreFromLocalFile(
  input?: KoinosNodeSettingsInput,
  sender?: Electron.WebContents
): Promise<KoinosNodeBackupRestoreResult> {
  return backupService.restoreFromLocalFile(input, sender!)
}

async function copyNodeBaseDirData(input?: KoinosNodeBaseDirCopyInput): Promise<KoinosNodeBaseDirCopyResult> {
  return backupService.copyNodeBaseDirData(input)
}

async function selectNodeBaseDir(input?: KoinosNodeSettingsInput): Promise<KoinosNodeSelectDirectoryResult> {
  return backupService.selectNodeBaseDir(input)
}

async function koinosJsonRpcProxy(input?: KoinosJsonRpcProxyInput): Promise<KoinosJsonRpcProxyResult> {
  return backupService.koinosJsonRpcProxy(input)
}

async function koinosNodeProducerOverview(input?: KoinosNodeProducerOverviewInput): Promise<KoinosNodeProducerOverviewResult> {
  return producerService.koinosNodeProducerOverview(input)
}

async function koinosNodeProducerRegisteredKey(
  input?: KoinosNodeProducerRegisteredKeyInput
): Promise<KoinosNodeProducerRegisteredKeyResult> {
  return producerService.koinosNodeProducerRegisteredKey(input)
}

async function koinosNodeDashboardProducers(
  input?: KoinosNodeDashboardProducersInput
): Promise<KoinosNodeDashboardProducersResult> {
  return producerService.koinosNodeDashboardProducers(input)
}

async function koinosNodeDashboardPeers(input?: KoinosNodeDashboardPeersInput): Promise<KoinosNodeDashboardPeersResult> {
  return producerService.koinosNodeDashboardPeers(input)
}

async function koinosNodeDashboardPerformance(
  input?: KoinosNodeDashboardPerformanceInput
): Promise<KoinosNodeDashboardPerformanceResult> {
  return producerService.koinosNodeDashboardPerformance(input)
}

async function koinosNodeProducerProfileGet(): Promise<KoinosNodeProducerProfileResult> {
  return producerService.koinosNodeProducerProfileGet()
}

async function koinosNodeProducerProfileClear(): Promise<KoinosNodeProducerProfileResult> {
  return producerService.koinosNodeProducerProfileClear()
}

async function koinosNodeProducerLocalInfo(
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeProducerLocalInfoResult> {
  return producerService.koinosNodeProducerLocalInfo(input)
}

async function koinosNodeProducerDelete(
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeProducerDeleteResult> {
  return producerService.koinosNodeProducerDelete(input)
}

async function koinosNodeProducerRegister(
  input?: KoinosNodeProducerRegisterInput
): Promise<KoinosNodeProducerRegisterResult> {
  return producerService.koinosNodeProducerRegister(input)
}

async function walletOverview(input?: WalletRpcInput): Promise<WalletOverviewResult> {
  return walletService.walletOverview(input)
}

async function walletGenerate(): Promise<WalletGenerateResult> {
  return walletService.walletGenerate()
}

async function walletImport(input?: WalletImportInput): Promise<WalletImportResult> {
  return walletService.walletImport(input)
}

async function walletListAccounts(): Promise<WalletListAccountsResult> {
  return walletService.walletListAccounts()
}

async function walletSetActiveAccount(input?: WalletSetActiveAccountInput): Promise<WalletSetActiveAccountResult> {
  return walletService.walletSetActiveAccount(input)
}

async function walletCreateDerivedAccount(input?: WalletCreateDerivedAccountInput): Promise<WalletAccountMutationResult> {
  return walletService.walletCreateDerivedAccount(input)
}

async function walletImportAccount(input?: WalletImportAccountInput): Promise<WalletAccountMutationResult> {
  return walletService.walletImportAccount(input)
}

async function walletImportWatchAccount(input?: WalletImportWatchAccountInput): Promise<WalletAccountMutationResult> {
  return walletService.walletImportWatchAccount(input)
}

async function walletRenameAccount(input?: WalletRenameAccountInput): Promise<WalletAccountMutationResult> {
  return walletService.walletRenameAccount(input)
}

async function walletRemoveAccount(input?: WalletRemoveAccountInput): Promise<WalletAccountMutationResult> {
  return walletService.walletRemoveAccount(input)
}

async function walletShowSeed(): Promise<WalletShowSeedResult> {
  return walletService.walletShowSeed()
}

async function walletDelete(): Promise<WalletDeleteResult> {
  return walletService.walletDelete()
}

async function walletClose(): Promise<WalletCloseResult> {
  return walletService.walletClose()
}

async function walletUnlock(input?: WalletUnlockInput): Promise<WalletUnlockResult> {
  return walletService.walletUnlock(input)
}

async function walletAddressFromWif(input?: WalletAddressInput): Promise<WalletAddressResult> {
  return walletService.walletAddressFromWif(input)
}

async function walletDeriveFromSeed(input?: WalletDeriveFromSeedInput): Promise<WalletDeriveFromSeedResult> {
  return walletService.walletDeriveFromSeed(input)
}

async function walletChainInfo(input?: WalletRpcInput): Promise<WalletChainInfoResult> {
  return walletService.walletChainInfo(input)
}

async function walletBlock(input?: WalletBlockInput): Promise<WalletBlockResult> {
  return walletService.walletBlock(input)
}

async function walletBalance(input?: WalletAddressQueryInput): Promise<WalletBalanceResult> {
  return walletService.walletBalance(input)
}

async function walletVhp(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
  return walletService.walletVhp(input)
}

async function walletNonce(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
  return walletService.walletNonce(input)
}

async function walletRc(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
  return walletService.walletRc(input)
}

async function walletTokenBalance(input?: WalletTokenBalanceInput): Promise<WalletTokenBalanceResult> {
  return walletService.walletTokenBalance(input)
}

async function walletReadContract(input?: WalletReadContractInput): Promise<WalletReadContractResult> {
  return walletService.walletReadContract(input)
}

async function walletBurn(input?: WalletBurnInput): Promise<WalletBurnResult> {
  return walletService.walletBurn(input)
}

async function walletTransferVhp(input?: WalletTransferVhpInput): Promise<WalletTransferVhpResult> {
  return walletService.walletTransferVhp(input)
}

async function walletTransferKoin(input?: WalletTransferKoinInput): Promise<WalletTransferKoinResult> {
  return walletService.walletTransferKoin(input)
}

async function koinosNodeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  return nativeComposeLogs(input)
}

async function koinosNodeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): Promise<KoinosNodeLogsFollowStartResult> {
  return nativeComposeLogsFollowStart(sender, input)
}

function registerIpcHandlers() {
  return registerKnodelIpcHandlers(ipcMain, {
    loadPublicRpcConfig,
    savePublicRpcConfig,
    getNodeDefaults: () => {
      return normalizeNodeSettings()
    },
    cloneKoinosRepo,
    readKoinosManagedFile,
    writeKoinosManagedFile,
    selectNodeBaseDir,
    validateNodeBaseDirAccess,
    copyNodeBaseDirData,
    koinosNodeStatus,
    composePresets,
    nativeBuildStatus,
    nativeBuildAll,
    nativeBuildServiceAction,
    koinosNodeAction,
    koinosNodeRestoreBackup,
    koinosNodeRestoreBackupAndVerify,
    createLocalBackup,
    cancelCreateBackup,
    restoreFromLocalFile,
    getVerifyBlocks,
    setVerifyBlocks,
    koinosJsonRpcProxy,
    koinosNodeDashboardProducers,
    koinosNodeDashboardPeers,
    koinosNodeDashboardPerformance,
    koinosNodeProducerOverview,
    koinosNodeProducerRegisteredKey,
    koinosNodeProducerLocalInfo,
    koinosNodeProducerRegister,
    koinosNodeProducerProfileGet,
    koinosNodeProducerProfileClear,
    koinosNodeProducerDelete,
    walletOverview,
    walletGenerate,
    walletImport,
    walletListAccounts,
    walletSetActiveAccount,
    walletCreateDerivedAccount,
    walletImportAccount,
    walletImportWatchAccount,
    walletRenameAccount,
    walletRemoveAccount,
    walletUnlock,
    walletClose,
    walletDelete,
    walletAddressFromWif,
    walletDeriveFromSeed,
    walletShowSeed,
    walletChainInfo,
    walletBlock,
    walletBalance,
    walletVhp,
    walletNonce,
    walletRc,
    walletTokenBalance,
    walletReadContract,
    walletBurn,
    walletTransferVhp,
    walletTransferKoin,
    koinosNodeServiceAction,
    koinosNodeComponentToggle,
    koinosNodePresetReconcile,
    koinosNodeLogs,
    koinosNodeLogsFollowStart,
    stopLogsFollowStream
  })
}

function createWindow(): BrowserWindow {
  return appLifecycleService.createWindow()
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '../assets/branding/icon.png'))
  }
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
})

app.on('before-quit', (event) => {
  if (!appShutdownApproved) {
    event.preventDefault()
    const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    void requestOrderedAppShutdown(targetWindow)
    return
  }

  cleanupAppRuntimeResources()
})

app.on('window-all-closed', () => {
  cleanupAppRuntimeResources()
  if (process.platform !== 'darwin') app.quit()
})
