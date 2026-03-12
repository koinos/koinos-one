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
import { parse as parseYaml } from 'yaml'
import { Contract, Provider, utils } from 'koilib'
import {
  BLOCK_STORE_PAGE_SIZE,
  DASHBOARD_PEER_LOG_TAIL,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MAX,
  DASHBOARD_PRODUCER_WINDOW_BLOCKS_MIN,
  DEFAULT_BASEDIR,
  DEFAULT_BLOCKCHAIN_BACKUP_URL,
  DEFAULT_COMPOSE_FILE,
  DEFAULT_ENV_FILE,
  DEFAULT_KOINOS_REPO_PATH,
  DEFAULT_KOINOS_SOURCE_ROOT,
  DEFAULT_PROFILES,
  DEFAULT_PUBLIC_RPC_URLS,
  FREE_MANA_METER_ADDRESS,
  FREE_MANA_SHARER_ADDRESS,
  IMPLIED_NODE_PROFILES,
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
  LEGACY_DEFAULT_ENV_FILE,
  MAC_DOCKER_DESKTOP_APP_PATH,
  MAC_DOCKER_DESKTOP_CONFIG_OVERRIDE_SERVICES,
  MAC_DOCKER_DESKTOP_OVERRIDE_PATH,
  MAC_DOCKER_DESKTOP_STARTUP_POLL_MS,
  MAC_DOCKER_DESKTOP_STARTUP_TIMEOUT_MS,
  NODE_SETTINGS_STORAGE_KEY,
  POB_CONTRACT_ADDRESS,
  PRODUCER_DAY_WINDOW_MS,
  PUBLIC_KOINOS_RPC_URL,
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
  composeFilePath,
  configDirPath,
  configExampleDirPath,
  ensureKoinosBaseDir,
  envFilePath,
  expandUserPath,
  managedFilePath,
  normalizeNodeSettings as buildNormalizedNodeSettings,
  parsePersistedNodeSettings as parseStoredNodeSettings,
  readTrimmedFile,
  restoreWorkspaceParentPath,
  verifyWritableDirectory
} from './lib/node-paths'
import {
  formatComposePresetLabel,
  normalizeComposeDependsOn,
  normalizeComposeImage,
  normalizeComposePortDefinition,
  normalizeComposePorts,
  normalizeComposeProfiles,
  parsePortNumber,
  readComposeServiceDefinitions,
  readEnvFileValues,
  resolveComposeEnvTemplate
} from './lib/compose-helpers'
import {
  findExecutableInPath,
  isAppleSiliconHost,
  nativeCmakeBuildCommand,
  nativeCmakeConfigureArgs,
  nativeCmakeConfigureCommand,
  nativeCmakeExecutable,
  nativeGitExecutable,
  nativeHomebrewPrefix,
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
import type {
  BlockchainBackupArchiveState,
  BlockchainBackupExtractState,
  BlockchainBackupWorkspacePaths,
  ComposeResolvedServiceDefinition,
  ComposeServiceDefinition,
  ComposeServiceStatus,
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
  KoinosNodeServiceCommandInput,
  KoinosNodeServiceCommandResult,
  KoinosNodeServicePort,
  KoinosNodeServiceRuntime,
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
  PlatformDescriptor,
  ProcessSnapshotEntry,
  PublicRpcConfigInput,
  PublicRpcConfigResult,
  ServiceVersionCacheEntry,
  TcpListenerOwner,
  WalletAddressInput,
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
  WalletImportInput,
  WalletImportResult,
  WalletOverviewResult,
  WalletReadContractInput,
  WalletReadContractResult,
  WalletRpcInput,
  WalletScalarResult,
  WalletShowSeedResult,
  WalletTokenBalanceInput,
  WalletTokenBalanceResult,
  WalletTransferKoinInput,
  WalletTransferKoinResult,
  WalletTransferVhpInput,
  WalletTransferVhpResult,
  WalletUnlockInput,
  WalletUnlockResult
} from './lib/main-types'
import { createNativeVersionResolver } from './lib/native-versions'
import { createProducerService } from './lib/producer-service'
import { producerAddressFromRuntimeConfig, resolveLocalProducerPublicKey } from './lib/producer-keys'
import { registerKnodelIpcHandlers } from './lib/ipc-handlers'
import { createLogsService } from './lib/logs-service'
import { createNativeBuildService } from './lib/native-build-service'
import { createNativeRuntimeService } from './lib/native-runtime-service'
import { createWalletService } from './lib/wallet-service'
import { createWorkspaceService } from './lib/workspace-service'

const isDev = !!process.env.VITE_DEV_SERVER_URL
let appShutdownInProgress = false
let appShutdownApproved = false
let dockerDesktopStartupPromise: Promise<{ ok: boolean; output: string }> | null = null
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
const BLOCKCHAIN_BACKUP_REQUIRED_DIRS = ['chain', 'block_store'] as const
const BLOCKCHAIN_BACKUP_RESET_DIRS = ['mempool'] as const
const BLOCKCHAIN_BACKUP_CACHE_DIR = '.knodel-blockchain-backup-cache'
const DEFAULT_RUNTIME_MODE: KoinosNodeServiceRuntime = 'native'
const AVAILABLE_RUNTIME_MODES: KoinosNodeServiceRuntime[] = ['native']
const nativeVersionResolver = createNativeVersionResolver({
  cache: nativeServiceVersionCache,
  findExecutableInPath,
  nativeRabbitmqCtlExecutable,
  runCommand
})

const workspaceService = createWorkspaceService({
  normalizeNodeSettings,
  composeFilePath,
  envFilePath,
  configDirPath,
  configExampleDirPath,
  managedFilePath,
  restoreWorkspaceParentPath,
  verifyWritableDirectory,
  runCommand
})

function currentUnlockedProducerWallet(): KnodelUnlockedWallet | null {
  return knodelStorage.getUnlockedWallet() as KnodelUnlockedWallet | null
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
  blockProducerPrivateKeyFilePath
})

const walletService = createWalletService({
  loadKnodelWalletFile,
  knodelProducerWalletFilePath,
  currentUnlockedProducerWallet,
  saveKnodelWallet,
  deleteKnodelWallet,
  closeKnodelWalletSession,
  unlockKnodelWalletSession,
  resolveWalletRpcUrl,
  resolveWalletQueryAddress,
  parseWalletArgs,
  loadContractWithFetchedAbi,
  formatWholeUnits,
  safeIsChecksumAddress,
  loadProducerProfile
})

const logsService = createLogsService({
  logsFollowEventChannel: LOGS_FOLLOW_EVENT_CHANNEL,
  maxNativeServiceLogBytes: MAX_NATIVE_SERVICE_LOG_BYTES,
  normalizeNodeSettings,
  assertRepoReady: workspaceService.assertRepoReady,
  composeBaseArgs,
  runDockerCommandWithAutoStart,
  composeLogsCommandEnv,
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
  ensureKoinosRepoRenamedFiles: workspaceService.ensureKoinosRepoRenamedFiles,
  ensureKoinosConfigFiles: workspaceService.ensureKoinosConfigFiles,
  ensureBaseDirKoinosRuntimeFiles: workspaceService.ensureBaseDirKoinosRuntimeFiles,
  validateNodeBaseDirAccess: workspaceService.validateNodeBaseDirAccess,
  restoreWorkspaceParentPath,
  ensureKoinosBaseDir,
  readComposeServiceDefinitions,
  selectedManagedComposeServiceIds,
  composeServicePortByTarget,
  koinosNodeStatus,
  koinosNodeAction,
  runCommand
})

// Service IDs stay stable even if their runtime later moves from Docker to bundled native binaries.
const KOINOS_MANAGED_SERVICES: ManagedKoinosServiceDefinition[] = [
  { id: 'amqp', displayName: 'amqp', dockerService: 'amqp', plannedRuntimeModes: ['docker', 'native'] },
  { id: 'chain', displayName: 'chain', dockerService: 'chain', plannedRuntimeModes: ['docker', 'native'] },
  { id: 'mempool', displayName: 'mempool', dockerService: 'mempool', plannedRuntimeModes: ['docker', 'native'] },
  { id: 'block_store', displayName: 'block_store', dockerService: 'block_store', plannedRuntimeModes: ['docker', 'native'] },
  { id: 'p2p', displayName: 'p2p', dockerService: 'p2p', plannedRuntimeModes: ['docker', 'native'] },
  {
    id: 'block_producer',
    displayName: 'block_producer',
    dockerService: 'block_producer',
    plannedRuntimeModes: ['docker', 'native']
  },
  { id: 'jsonrpc', displayName: 'jsonrpc', dockerService: 'jsonrpc', plannedRuntimeModes: ['docker', 'native'] },
  { id: 'grpc', displayName: 'grpc', dockerService: 'grpc', plannedRuntimeModes: ['docker', 'native'] },
  {
    id: 'transaction_store',
    displayName: 'transaction_store',
    dockerService: 'transaction_store',
    plannedRuntimeModes: ['docker', 'native']
  },
  {
    id: 'contract_meta_store',
    displayName: 'contract_meta_store',
    dockerService: 'contract_meta_store',
    plannedRuntimeModes: ['docker', 'native']
  },
  {
    id: 'account_history',
    displayName: 'account_history',
    dockerService: 'account_history',
    plannedRuntimeModes: ['docker', 'native']
  },
  { id: 'rest', displayName: 'rest', dockerService: 'rest', plannedRuntimeModes: ['docker', 'native'] }
]

const KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE = new Map(
  KOINOS_MANAGED_SERVICES.map((definition) => [definition.dockerService, definition] as const)
)
const KOINOS_MANAGED_SERVICE_BY_ID = new Map(KOINOS_MANAGED_SERVICES.map((definition) => [definition.id, definition] as const))

const nativeBuildService = createNativeBuildService({
  defaultKoinosSourceRoot: DEFAULT_KOINOS_SOURCE_ROOT,
  managedServices: KOINOS_MANAGED_SERVICES,
  runCommand,
  applyKoinosDarwinHunterWorkaround
})

const nativeRuntimeService = createNativeRuntimeService({
  nativeAmqpStartupTimeoutMs: NATIVE_AMQP_STARTUP_TIMEOUT_MS,
  normalizeNodeSettings,
  ensureKoinosRepoRenamedFiles: workspaceService.ensureKoinosRepoRenamedFiles,
  assertRepoReady: workspaceService.assertRepoReady,
  readComposeServiceDefinitions,
  prepareNativeStartNotes,
  prepareComposeStartNotes,
  nativeRuntimeDockerConflictCheck,
  selectedManagedComposeServiceIds,
  sortManagedServiceIds,
  sortManagedServiceIdsByDependencies,
  nativeAmqpUsesBrewService,
  startNativeServiceProcess,
  stopNativeServiceProcess,
  findExecutableInPath,
  runCommand,
  composeServicePortByTarget,
  nativeRabbitmqCtlExecutable,
  nativeRabbitmqServerExecutable,
  waitForTcpListener,
  waitForTcpListenerClosed,
  nativeServiceConnectHost,
  listTcpListenerOwners,
  tcpListenerOwnedByRabbitmq,
  tcpListenerOwnedByDocker,
  describeTcpListenerOwners,
  nativeComposeStatus,
  dockerComposeStatus,
  toManagedServiceId,
  serviceDisplayName,
  findProfileDependents,
  isComposeServiceRunning,
  nativeManagedProcessRegistryOutput,
  killConflictingNativeServiceProcesses,
  ensureNativeComposeImages,
  composeBaseArgs,
  composeCommandEnv,
  runDockerCommandWithAutoStart,
  resolvePresetOrThrow,
  nativeDockerPlatform,
  toDockerServiceName,
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

function normalizeRuntimeMode(_value?: string | null): KoinosNodeServiceRuntime {
  return 'native'
}

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
  if (!isAppleSiliconHost()) return null

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

function nativeDockerPlatform(): string | null {
  // On macOS, prefer linux/arm64 images in Docker mode when available.
  return process.platform === 'darwin' ? 'linux/arm64' : null
}

function buildMacDockerDesktopOverrideContent(): string {
  const lines = ['services:']
  const platform = nativeDockerPlatform()
  const serviceNames = new Set(['amqp', ...KOINOS_MANAGED_SERVICES.map((definition) => definition.dockerService)])

  for (const serviceName of serviceNames) {
    lines.push(`  ${serviceName}:`)
    if (MAC_DOCKER_DESKTOP_CONFIG_OVERRIDE_SERVICES.includes(serviceName as (typeof MAC_DOCKER_DESKTOP_CONFIG_OVERRIDE_SERVICES)[number])) {
      lines.push('    configs: []')
    }
    if (platform) {
      lines.push(`    platform: ${platform}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function validateNodeBaseDirAccess(input?: KoinosNodeSettingsInput): KoinosNodeValidateBaseDirResult {
  return workspaceService.validateNodeBaseDirAccess(input)
}

function normalizeNodeSettings(input?: KoinosNodeSettingsInput): KoinosNodeSettings {
  return buildNormalizedNodeSettings(input, expandNodeProfiles) as KoinosNodeSettings
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

function resolveWalletQueryAddress(address?: string): string | null {
  return knodelStorage.resolveWalletQueryAddress(address)
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

async function loadContractWithFetchedAbi(provider: Provider, contractId: string): Promise<Contract> {
  const contract = new Contract({ id: contractId, provider })
  const abi = await contract.fetchAbi()
  if (!abi) {
    throw new Error(`Could not load ABI for contract ${contractId}`)
  }
  contract.abi = fixFetchedAbi(abi) as typeof contract.abi
  contract.updateFunctionsFromAbi()
  return contract
}

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
      headers: { 'user-agent': 'Mozilla/5.0 (Knodel Producer Panel)' }
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

function buildComposePresets(settings: KoinosNodeSettings): KoinosNodePreset[] {
  const serviceDefinitions = readComposeServiceDefinitions(settings)
  const managedServiceOrder = new Map(KOINOS_MANAGED_SERVICES.map((service, index) => [service.id, index] as const))
  const knownServiceIds = new Set(KOINOS_MANAGED_SERVICES.map((service) => service.id))
  const coreServices = new Set<string>()
  const profileServices = new Map<string, Set<string>>()

  for (const [serviceName, definition] of serviceDefinitions.entries()) {
    const serviceId = KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(serviceName)?.id ?? serviceName
    if (!knownServiceIds.has(serviceId)) continue

    if (definition.profiles.length === 0) {
      coreServices.add(serviceId)
    }

    for (const profile of definition.profiles) {
      if (!profileServices.has(profile)) profileServices.set(profile, new Set())
      profileServices.get(profile)!.add(serviceId)
    }
  }

  const sortServiceIds = (serviceIds: Iterable<string>) =>
    [...serviceIds].sort((left, right) => {
      const leftIndex = managedServiceOrder.get(left) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = managedServiceOrder.get(right) ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.localeCompare(right)
    })

  const presets: KoinosNodePreset[] = [
    {
      id: 'compose-core',
      label: 'Core',
      source: 'compose-core',
      profiles: [],
      services: sortServiceIds(coreServices),
      description: coreServices.size
        ? `Servicios base sin profile: ${sortServiceIds(coreServices).join(', ')}`
        : 'Servicios base del compose'
    }
  ]

  for (const profile of profileServices.keys()) {
    const profiles = expandNodeProfiles([profile])
    const services = new Set(coreServices)
    for (const impliedProfile of profiles) {
      for (const serviceId of profileServices.get(impliedProfile) ?? []) {
        services.add(serviceId)
      }
    }
    const serviceIds = sortServiceIds(services)
    const profileExtensionLabel = profiles.length > 1 ? ` + ${profiles.slice(1).join(', ')}` : ''

    presets.push({
      id: `compose-profile:${profile}`,
      label: formatComposePresetLabel(profile),
      source: 'compose-profile',
      profiles,
      services: serviceIds,
      description: `Compose profile "${profile}"${profileExtensionLabel} (${serviceIds.length} servicios)`
    })
  }

  return presets
}

function ensureKoinosConfigFiles(settings: KoinosNodeSettings): { configReady: boolean; output: string } {
  return workspaceService.ensureKoinosConfigFiles(settings)
}

function ensureKoinosRepoRenamedFiles(settings: KoinosNodeSettings): string {
  return workspaceService.ensureKoinosRepoRenamedFiles(settings)
}

async function restoreKoinosRepoTemplatesForRefresh(settings: KoinosNodeSettings): Promise<string> {
  return workspaceService.restoreKoinosRepoTemplatesForRefresh(settings)
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

function expandNodeProfiles(profiles: string[]): string[] {
  const pending = uniqueStringList(profiles)
  const expanded: string[] = []
  const seen = new Set<string>()

  while (pending.length > 0) {
    const profile = pending.shift()
    if (!profile || seen.has(profile)) continue
    seen.add(profile)
    expanded.push(profile)

    for (const impliedProfile of IMPLIED_NODE_PROFILES[profile] ?? []) {
      if (!seen.has(impliedProfile)) pending.push(impliedProfile)
    }
  }

  return expanded
}

function usesMacDockerDesktopWorkaround(): boolean {
  return process.platform === 'darwin'
}

function ensureMacDockerDesktopComposeOverride(): string {
  fs.writeFileSync(MAC_DOCKER_DESKTOP_OVERRIDE_PATH, buildMacDockerDesktopOverrideContent(), 'utf8')
  return MAC_DOCKER_DESKTOP_OVERRIDE_PATH
}

function composeBaseArgs(settings: KoinosNodeSettings): string[] {
  const args = ['compose', '--file', composeFilePath(settings)]
  if (usesMacDockerDesktopWorkaround()) {
    args.push('--file', ensureMacDockerDesktopComposeOverride())
  }
  args.push('--env-file', envFilePath(settings))
  return args
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

type DockerCommandRunResult = {
  result: { ok: boolean; code: number | null; output: string }
  notes: string[]
}

function dockerCommandMissingCli(output: string): boolean {
  return /spawn docker ENOENT/i.test(output)
}

function dockerDaemonConnectionError(output: string): boolean {
  return /Cannot connect to the Docker daemon|error during connect|Is the docker daemon running|dial unix .*docker\.sock|context deadline exceeded/i.test(
    output
  )
}

async function ensureDockerDesktopDaemonReady(): Promise<{ ok: boolean; output: string }> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      output: 'El arranque automatico de Docker Desktop solo esta soportado en macOS.'
    }
  }

  if (!fs.existsSync(MAC_DOCKER_DESKTOP_APP_PATH)) {
    return {
      ok: false,
      output: `No se encontro Docker Desktop en ${MAC_DOCKER_DESKTOP_APP_PATH}.`
    }
  }

  if (!dockerDesktopStartupPromise) {
    dockerDesktopStartupPromise = (async () => {
      const notes: string[] = ['Intentando abrir Docker Desktop automaticamente...']
      const openResult = await runCommand('open', ['-a', 'Docker'], {
        cwd: process.cwd(),
        timeoutMs: 10_000
      })

      if (!openResult.ok) {
        return {
          ok: false,
          output: [notes.join('\n'), openResult.output].filter(Boolean).join('\n')
        }
      }

      const deadline = Date.now() + MAC_DOCKER_DESKTOP_STARTUP_TIMEOUT_MS
      let lastInfoOutput = ''
      while (Date.now() < deadline) {
        const infoResult = await runCommand('docker', ['info'], {
          cwd: process.cwd(),
          timeoutMs: 5_000
        })
        if (infoResult.ok) {
          return {
            ok: true,
            output: [...notes, 'Docker daemon listo.'].join('\n')
          }
        }
        if (dockerCommandMissingCli(infoResult.output)) {
          return {
            ok: false,
            output: [notes.join('\n'), infoResult.output].filter(Boolean).join('\n')
          }
        }
        if (infoResult.output.trim()) lastInfoOutput = infoResult.output.trim()
        await delay(MAC_DOCKER_DESKTOP_STARTUP_POLL_MS)
      }

      return {
        ok: false,
        output: [
          notes.join('\n'),
          lastInfoOutput || `Docker daemon no estuvo listo tras ${MAC_DOCKER_DESKTOP_STARTUP_TIMEOUT_MS}ms.`
        ]
          .filter(Boolean)
          .join('\n')
      }
    })().finally(() => {
      dockerDesktopStartupPromise = null
    })
  }

  return dockerDesktopStartupPromise
}

async function runDockerCommandWithAutoStart(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; allowAutoStart?: boolean }
): Promise<DockerCommandRunResult> {
  const firstResult = await runCommand('docker', args, options)
  if (firstResult.ok || options.allowAutoStart === false || process.platform !== 'darwin') {
    return { result: firstResult, notes: [] }
  }

  if (!dockerDaemonConnectionError(firstResult.output) || dockerCommandMissingCli(firstResult.output)) {
    return { result: firstResult, notes: [] }
  }

  const startup = await ensureDockerDesktopDaemonReady()
  if (!startup.ok) {
    return {
      result: firstResult,
      notes: startup.output ? [startup.output] : []
    }
  }

  const retryResult = await runCommand('docker', args, options)
  return {
    result: retryResult,
    notes: startup.output ? [startup.output] : []
  }
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
  return `Se detecto otro proceso nativo para ${serviceId} usando el mismo baseDir ${settings.baseDir} (${pidLabel}: ${pidList}). Detenlo antes de arrancar este servicio.`
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

function composeCommandEnv(settings: KoinosNodeSettings): NodeJS.ProcessEnv {
  return {
    BASEDIR: settings.baseDir,
    COMPOSE_PROFILES: settings.profiles.join(',')
  }
}

function composeLogsCommandEnv(settings: KoinosNodeSettings): NodeJS.ProcessEnv {
  return {
    ...composeCommandEnv(settings),
    COMPOSE_ANSI: 'always'
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

function tcpListenerOwnedByDocker(listener: TcpListenerOwner): boolean {
  return /com\.docker|docker/i.test(listener.command)
}

function tcpListenerOwnedByRabbitmq(listener: TcpListenerOwner): boolean {
  return /beam\.smp|rabbitmq-server/i.test(listener.command)
}

function platformDescriptorToString(platform?: PlatformDescriptor | null): string {
  if (!platform?.os || !platform.architecture) return 'unknown'
  return `${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ''}`
}

function platformMatchesTarget(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target}/`)
}

async function resolveComposeServiceImages(
  settings: KoinosNodeSettings
): Promise<Map<string, ComposeResolvedServiceDefinition>> {
  const dockerRun = await runDockerCommandWithAutoStart([...composeBaseArgs(settings), 'config'], {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings),
    allowAutoStart: true
  })
  const result = dockerRun.result

  if (!result.ok) {
    throw new Error([dockerRun.notes.join('\n'), result.output || 'No se pudo resolver la configuracion de docker compose'].filter(Boolean).join('\n'))
  }

  const parsed = parseYaml(result.output) as { services?: Record<string, { image?: unknown }> } | null
  const services = parsed?.services
  if (!services || typeof services !== 'object') {
    return new Map()
  }

  const resolved = new Map<string, ComposeResolvedServiceDefinition>()
  for (const [serviceName, definition] of Object.entries(services)) {
    const image = typeof definition?.image === 'string' && definition.image.trim() ? definition.image.trim() : null
    resolved.set(serviceName, { image })
  }

  return resolved
}

async function inspectRemoteImagePlatforms(image: string): Promise<string[]> {
  const buildxRun = await runDockerCommandWithAutoStart(['buildx', 'imagetools', 'inspect', '--raw', image], {
    cwd: process.cwd()
  })
  const buildxResult = buildxRun.result

  if (buildxResult.ok) {
    try {
      const parsed = JSON.parse(buildxResult.output) as {
        manifests?: Array<{ platform?: PlatformDescriptor }>
        mediaType?: string
      }
      if (Array.isArray(parsed.manifests) && parsed.manifests.length > 0) {
        return parsed.manifests
          .map((manifest) => platformDescriptorToString(manifest.platform))
          .filter((platform) => platform !== 'unknown')
      }
    } catch {
      // fall through to docker manifest inspect --verbose
    }
  }

  const manifestRun = await runDockerCommandWithAutoStart(['manifest', 'inspect', '--verbose', image], {
    cwd: process.cwd()
  })
  const manifestResult = manifestRun.result

  if (!manifestResult.ok) {
    throw new Error([manifestRun.notes.join('\n'), manifestResult.output || `No se pudo inspeccionar el manifiesto de ${image}`].filter(Boolean).join('\n'))
  }

  try {
    const parsed = JSON.parse(manifestResult.output) as {
      Descriptor?: { platform?: PlatformDescriptor }
    }
    const platform = platformDescriptorToString(parsed.Descriptor?.platform)
    return platform === 'unknown' ? [] : [platform]
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `No se pudo interpretar el manifiesto remoto de ${image}`
    )
  }
}

async function ensureNativeComposeImages(
  settings: KoinosNodeSettings,
  serviceNames?: string[]
): Promise<{ ok: boolean; output: string }> {
  const targetPlatform = nativeDockerPlatform()
  if (!targetPlatform) {
    return { ok: true, output: '' }
  }

  const notes = [`macOS detectado: comprobando y descargando imagenes ${targetPlatform}`]
  const resolvedServices = await resolveComposeServiceImages(settings)
  const selectedServiceNames = serviceNames?.length ? serviceNames : [...resolvedServices.keys()]
  const filteredServices = selectedServiceNames
    .map((serviceName) => [serviceName, resolvedServices.get(serviceName)] as const)
    .filter((entry): entry is readonly [string, ComposeResolvedServiceDefinition] => Boolean(entry[1]))

  if (!filteredServices.length) {
    return {
      ok: false,
      output: [notes.join('\n'), 'No se pudieron resolver servicios con imagen para esta configuracion de compose']
        .filter(Boolean)
        .join('\n')
    }
  }

  const images = [...new Set(filteredServices.map(([, definition]) => definition.image).filter((image): image is string => Boolean(image)))]
  const unsupportedImages: Array<{ image: string; platforms: string[] }> = []

  for (const image of images) {
    const platforms = await inspectRemoteImagePlatforms(image)
    if (!platforms.some((platform) => platformMatchesTarget(platform, targetPlatform))) {
      unsupportedImages.push({ image, platforms })
    }
  }

  if (unsupportedImages.length > 0) {
    return {
      ok: false,
      output: [
        ...notes,
        'Estas imagenes no publican una variante ARM nativa compatible:',
        ...unsupportedImages.map(
          ({ image, platforms }) => `- ${image} (disponibles: ${platforms.length > 0 ? platforms.join(', ') : 'unknown'})`
        )
      ].join('\n')
    }
  }

  for (const image of images) {
    const pullRun = await runDockerCommandWithAutoStart(['pull', '--platform', targetPlatform, image], {
      cwd: settings.repoPath
    })
    const pullResult = pullRun.result
    if (pullRun.notes.length > 0) {
      notes.push(...pullRun.notes)
    }
    notes.push(pullResult.output || `Pulled ${image} (${targetPlatform})`)
    if (!pullResult.ok) {
      return {
        ok: false,
        output: notes.join('\n')
      }
    }
  }

  return {
    ok: true,
    output: notes.join('\n')
  }
}

async function nativeBuildStatus(): Promise<KoinosNodeNativeBuildsResult> {
  return nativeBuildService.nativeBuildStatus()
}

async function nativeBuildAll(): Promise<KoinosNodeNativeBuildCommandResult> {
  return nativeBuildService.nativeBuildAll()
}

async function nativeBuildServiceAction(input?: KoinosNodeNativeBuildCommandInput): Promise<KoinosNodeNativeBuildCommandResult> {
  return nativeBuildService.nativeBuildServiceAction(input)
}

function normalizeLogsTail(inputTail: unknown, fallback = 200): number {
  return logsService.normalizeLogsTail(inputTail, fallback)
}

function stopLogsFollowStream(streamId: string): KoinosNodeLogsFollowStopResult {
  return logsService.stopLogsFollowStream(streamId)
}

function normalizeComposePublishers(item: Record<string, unknown>): KoinosNodeServicePort[] {
  const publishers = Array.isArray(item.Publishers) ? item.Publishers : []
  const normalized = publishers
    .filter((publisher): publisher is Record<string, unknown> => typeof publisher === 'object' && publisher !== null)
    .map((publisher) => {
      const host = typeof publisher.URL === 'string' && publisher.URL ? publisher.URL : null
      const publishedPort = parsePortNumber(publisher.PublishedPort)
      const targetPort = parsePortNumber(publisher.TargetPort)
      const protocol = typeof publisher.Protocol === 'string' && publisher.Protocol ? publisher.Protocol : 'tcp'
      const label =
        publishedPort !== null && targetPort !== null
          ? `${host ? `${host}:` : ''}${publishedPort}->${targetPort}/${protocol}`
          : targetPort !== null
          ? `${targetPort}/${protocol}`
          : protocol

      return {
        host,
        publishedPort,
        targetPort,
        protocol,
        label
      }
    })

  if (normalized.length > 0) return normalized

  const rawPorts = typeof item.Ports === 'string' ? item.Ports : ''
  if (!rawPorts.trim()) return []

  const parsedPorts: KoinosNodeServicePort[] = []
  const matches = rawPorts.matchAll(/(?:(?<host>[^:\s,]+):)?(?<published>\d+)->(?<target>\d+)\/(?<protocol>[a-z]+)/gi)

  for (const match of matches) {
    const host = match.groups?.host ?? null
    const publishedPort = parsePortNumber(match.groups?.published)
    const targetPort = parsePortNumber(match.groups?.target)
    const protocol = match.groups?.protocol?.toLowerCase() || 'tcp'
    parsedPorts.push({
      host,
      publishedPort,
      targetPort,
      protocol,
      label: `${host ? `${host}:` : ''}${publishedPort ?? '?'}->${targetPort ?? '?'}${protocol ? `/${protocol}` : ''}`
    })
  }

  return parsedPorts
}

function deriveComposeServiceLastError(item: Record<string, unknown>, state: string, status: string): string | null {
  const runtimeError = typeof item.Error === 'string' && item.Error.trim() ? item.Error.trim() : ''
  if (runtimeError) return runtimeError

  const health = typeof item.Health === 'string' ? item.Health.trim() : ''
  if (health && health.toLowerCase() !== 'healthy') {
    return `Health: ${health}`
  }

  if (/running|up/i.test(`${state} ${status}`)) return null
  if (status.trim()) return status.trim()
  return state.trim() || null
}

function sortComposeServices(a: ComposeServiceStatus, b: ComposeServiceStatus): number {
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
  serviceDefinitions: Map<string, ComposeServiceDefinition>
): string[] {
  return sortManagedServiceIds(
    [...serviceDefinitions.entries()]
      .filter(([, definition]) => composeServiceMatchesProfiles(definition, settings.profiles))
      .map(([serviceName]) => KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(serviceName)?.id ?? null)
      .filter((serviceId): serviceId is string => Boolean(serviceId))
  )
}

function sortManagedServiceIdsByDependencies(
  serviceIds: Iterable<string>,
  serviceDefinitions: Map<string, ComposeServiceDefinition>
): string[] {
  const included = new Set(serviceIds)
  const resolved = new Set<string>()
  const active = new Set<string>()
  const ordered: string[] = []

  const visit = (serviceId: string) => {
    if (!included.has(serviceId) || resolved.has(serviceId)) return
    if (active.has(serviceId)) return
    active.add(serviceId)

    const dependencies = serviceDefinitions.get(toDockerServiceName(serviceId))?.dependsOn ?? []
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
  definition: ComposeServiceDefinition | undefined,
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
  return path.join(settings.baseDir, 'amqp')
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
  serviceDefinitions: Map<string, ComposeServiceDefinition>
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
    '# Generated by Knodel for native runtime',
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
  serviceDefinitions: Map<string, ComposeServiceDefinition>
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

function nativeAmqpUrl(serviceDefinitions: Map<string, ComposeServiceDefinition>): string {
  const amqpPort = composeServicePortByTarget(serviceDefinitions.get('amqp'), 5672)
  return `amqp://guest:guest@${nativeServiceConnectHost(amqpPort)}:${amqpPort?.publishedPort ?? 5672}/`
}

function nativeJsonrpcUrl(serviceDefinitions: Map<string, ComposeServiceDefinition>): string {
  const jsonrpcPort = composeServicePortByTarget(serviceDefinitions.get('jsonrpc'), 8080)
  return `http://${nativeServiceConnectHost(jsonrpcPort)}:${jsonrpcPort?.publishedPort ?? 8080}/`
}

function nativeServiceDefaultRuntimeName(serviceId: string, definition?: NativeServiceBuildDefinition): string {
  if (serviceId === 'amqp') return nativeAmqpUsesBrewService() ? 'brew services rabbitmq' : 'rabbitmq-server'
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

async function stopNativeServiceProcess(serviceId: string): Promise<NativeServiceStopResult> {
  const state = nativeServiceProcesses.get(serviceId)
  if (!state || state.closed) {
    return {
      ok: true,
      output: `${serviceId} ya estaba detenido`
    }
  }

  state.stopRequested = true

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
      output: `Stopped ${serviceId} (pid ${state.child.pid ?? 'n/a'})`
    }
  }

  try {
    state.child.kill('SIGKILL')
  } catch {
    // ignore final kill errors
  }

  return {
    ok: true,
    output: `Force-stopped ${serviceId} (pid ${state.child.pid ?? 'n/a'})`
  }
}

function nativeServiceLaunchSpec(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinitions: Map<string, ComposeServiceDefinition>
): NativeServiceLaunchSpec {
  if (serviceId === 'amqp') {
    const rabbitmqServer = nativeRabbitmqServerExecutable()
    if (!rabbitmqServer) {
      throw new Error('No se encontro rabbitmq-server en el sistema. Instala RabbitMQ nativo antes de usar este runtime.')
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

  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  if (!buildDefinition) {
    throw new Error(`No hay un launcher nativo configurado para ${serviceId}`)
  }

  const amqpUrl = nativeAmqpUrl(serviceDefinitions)
  if (serviceId === 'rest') {
    const restPort = composeServicePortByTarget(serviceDefinitions.get('rest'), 3000)
    const standaloneServerPath = path.join(buildDefinition.repoPath, '.next', 'standalone', 'server.js')
    return {
      serviceId,
      command: fs.existsSync(standaloneServerPath) ? 'node' : 'yarn',
      args: fs.existsSync(standaloneServerPath) ? [standaloneServerPath] : ['start'],
      cwd: buildDefinition.repoPath,
      env: {
        JSONRPC_URL: nativeJsonrpcUrl(serviceDefinitions),
        HOSTNAME: nativeServiceBindHost(restPort),
        PORT: String(restPort?.publishedPort ?? 3000),
        NODE_ENV: 'production'
      },
      runtimeName: fs.existsSync(standaloneServerPath) ? 'node .next/standalone/server.js' : 'yarn start'
    }
  }

  const args = [`--basedir=${settings.baseDir}`, `--amqp=${amqpUrl}`]

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
  serviceDefinitions: Map<string, ComposeServiceDefinition>
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

  if (serviceId !== 'amqp' && buildDefinition && !fs.existsSync(buildDefinition.artifactPath)) {
    return {
      ok: false,
      output: `Falta el artefacto nativo para ${serviceId}: ${buildDefinition.artifactPath}`
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
      output: tailTextLines(state.output, 80) || state.lastError || `El servicio ${serviceId} salio al arrancar`
    }
  }

  return {
    ok: true,
    output: `Started ${serviceId} (${launchSpec.runtimeName}, pid ${child.pid ?? 'n/a'})`
  }
}

function toManagedServiceId(service: string): string {
  return KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(service)?.id ?? service
}

function toDockerServiceName(serviceId: string): string {
  return KOINOS_MANAGED_SERVICE_BY_ID.get(serviceId)?.dockerService ?? serviceId
}

function serviceDisplayName(serviceId: string): string {
  return KOINOS_MANAGED_SERVICE_BY_ID.get(serviceId)?.displayName ?? serviceId
}

function isComposeServiceRunning(service: ComposeServiceStatus): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

function composeServiceMatchesProfiles(definition: ComposeServiceDefinition, profiles: string[]): boolean {
  if (definition.profiles.length === 0) return true
  if (profiles.length === 0) return false
  const requestedProfiles = new Set(profiles)
  return definition.profiles.some((profile) => requestedProfiles.has(profile))
}

function mergeComposeServiceStatuses(
  parsedServices: ComposeServiceStatus[],
  serviceDefinitions: Map<string, ComposeServiceDefinition>,
  profiles: string[]
): ComposeServiceStatus[] {
  const merged = new Map(parsedServices.map((service) => [service.service, service] as const))

  for (const [serviceName, definition] of serviceDefinitions.entries()) {
    if (merged.has(serviceName)) continue
    if (!composeServiceMatchesProfiles(definition, profiles)) continue

    const managedDefinition = KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(serviceName)
    merged.set(serviceName, {
      id: managedDefinition?.id ?? toManagedServiceId(serviceName),
      name: managedDefinition?.displayName ?? serviceName,
      service: serviceName,
      runtimeName: serviceName,
      runtimeType: 'docker',
      version: definition.image,
      state: 'not created',
      status: 'Not created',
      ports: definition.ports,
      dependsOn: definition.dependsOn.map(toManagedServiceId),
      lastError: null,
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    })
  }

  return [...merged.values()].sort(sortComposeServices)
}

function parseComposeLabels(rawLabels: unknown): Map<string, string> {
  const labels = typeof rawLabels === 'string' ? rawLabels.trim() : ''
  if (!labels) return new Map()

  const matches = [...labels.matchAll(/(?:^|,)([A-Za-z0-9_.-]+)=/g)]
  const parsed = new Map<string, string>()

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const key = match[1]?.trim()
    if (!key) continue

    const valueStart = (match.index ?? 0) + match[0].length
    const nextMatch = matches[index + 1]
    const valueEnd = nextMatch?.index ?? labels.length
    parsed.set(key, labels.slice(valueStart, valueEnd).trim().replace(/,$/, ''))
  }

  return parsed
}

function isComposeItemOwnedBySettings(item: Record<string, unknown>, settings?: KoinosNodeSettings): boolean {
  if (!settings) return true

  const labels = parseComposeLabels(item.Labels)
  const expectedComposeFile = path.resolve(composeFilePath(settings))
  const expectedRepoPath = path.resolve(settings.repoPath)
  const configFiles = (labels.get('com.docker.compose.project.config_files') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry))

  if (configFiles.length > 0) {
    return configFiles.includes(expectedComposeFile)
  }

  const workingDir = labels.get('com.docker.compose.project.working_dir')
  if (workingDir) {
    return path.resolve(workingDir) === expectedRepoPath
  }

  return true
}

function parseComposePsJson(
  raw: string,
  serviceDefinitions?: Map<string, ComposeServiceDefinition>,
  settings?: KoinosNodeSettings
): ComposeServiceStatus[] {
  const text = raw.trim()
  if (!text) return []

  const normalizeItem = (item: Record<string, unknown>): ComposeServiceStatus => {
    const service = String(item.Service ?? item.service ?? item.Name ?? item.name ?? 'unknown')
    const runtimeName = String(item.Name ?? item.name ?? service)
    const state = String(item.State ?? item.state ?? item.Status ?? item.status ?? 'unknown')
    const status = String(item.Status ?? item.status ?? item.State ?? item.state ?? 'unknown')
    const image =
      typeof item.Image === 'string' && item.Image.trim()
        ? item.Image.trim()
        : typeof item.image === 'string' && item.image.trim()
          ? item.image.trim()
          : serviceDefinitions?.get(service)?.image ?? null
    const definition = KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(service)

    return {
      id: definition?.id ?? toManagedServiceId(service),
      name: definition?.displayName ?? service,
      service,
      runtimeName,
      runtimeType: 'docker',
      version: image,
      state,
      status,
      ports: normalizeComposePublishers(item).length > 0 ? normalizeComposePublishers(item) : serviceDefinitions?.get(service)?.ports ?? [],
      dependsOn: (serviceDefinitions?.get(service)?.dependsOn ?? []).map(toManagedServiceId),
      lastError: deriveComposeServiceLastError(item, state, status),
      nativePid: null,
      conflictPids: [],
      managedByKnodel: false
    }
  }

  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .filter((item) => isComposeItemOwnedBySettings(item, settings))
        .map(normalizeItem)
        .sort(sortComposeServices)
    }
    if (typeof parsed === 'object' && parsed !== null) {
      if (!isComposeItemOwnedBySettings(parsed as Record<string, unknown>, settings)) return []
      return [normalizeItem(parsed as Record<string, unknown>)].sort(sortComposeServices)
    }
  } catch {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const items: ComposeServiceStatus[] = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (!isComposeItemOwnedBySettings(parsed, settings)) continue
        items.push(normalizeItem(parsed))
      } catch {
        // ignore non-json lines
      }
    }
    return items.sort(sortComposeServices)
  }

  return []
}

async function nativeServiceStatusFromProcessState(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinition: ComposeServiceDefinition,
  state: NativeServiceProcessState | undefined,
  processSnapshot: ProcessSnapshotEntry[]
): Promise<ComposeServiceStatus> {
  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  const fallbackRuntimeName = nativeServiceDefaultRuntimeName(serviceId, buildDefinition)
  const runtimeName = state?.runtimeName ?? fallbackRuntimeName
  const version = await resolveNativeServiceVersion(serviceId, buildDefinition)
  const rabbitmqExecutable = serviceId === 'amqp' ? nativeRabbitmqServerExecutable() : null
  const amqpRuntimeMissing =
    serviceId === 'amqp' && !rabbitmqExecutable ? 'No se encontro rabbitmq-server para el runtime native' : null
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
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
      version,
      state: 'restart required',
      status: `Running with old BASEDIR (pid ${state.child.pid ?? 'n/a'})`,
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: `El servicio sigue usando BASEDIR ${state.baseDir}. Reinicia para moverlo a ${settings.baseDir}.`,
      nativePid: state.child.pid ?? null,
      conflictPids: [],
      managedByKnodel: true
    }
  }

  if (state && !state.closed && conflictingProcesses.length === 0) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
    service: toDockerServiceName(serviceId),
    runtimeName,
    runtimeType: 'native',
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
  serviceDefinition: ComposeServiceDefinition
): Promise<ComposeServiceStatus> {
  const runtimeName = 'brew services rabbitmq'
  const version = await resolveNativeServiceVersion('amqp', undefined)
  const rabbitmqServer = nativeRabbitmqServerExecutable()
  if (!rabbitmqServer) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      runtimeType: 'native',
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
      runtimeType: 'native',
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
  const dockerListeners = listeners.filter(tcpListenerOwnedByDocker)
  const rabbitmqListeners = listeners.filter(tcpListenerOwnedByRabbitmq)

  if (dockerListeners.length > 0 && rabbitmqListeners.length === 0) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      runtimeType: 'native',
      version,
      state: 'conflict',
      status: 'Ports occupied by Docker',
      ports: serviceDefinition.ports,
      dependsOn: serviceDefinition.dependsOn.map(toManagedServiceId),
      lastError: `Los puertos de amqp estan ocupados por Docker Desktop: ${describeTcpListenerOwners(dockerListeners)}`,
      nativePid: null,
      conflictPids: dockerListeners.map((listener) => listener.pid).filter((pid): pid is number => typeof pid === 'number'),
      managedByKnodel: false
    }
  }

  if (brewState.started && amqpReady && adminReady) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      runtimeType: 'native',
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
      runtimeType: 'native',
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
    runtimeType: 'native',
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
  const prepNotes = ensureKoinosRepoRenamedFiles(settings)
  let serviceDefinitions = new Map<string, ComposeServiceDefinition>()

  try {
    assertRepoReady(settings)
    serviceDefinitions = readComposeServiceDefinitions(settings)
  } catch (error) {
    return {
      ok: false,
      dockerAvailable: true,
      runtimeMode: 'native',
      availableRuntimeModes: [...AVAILABLE_RUNTIME_MODES],
      repoPath: settings.repoPath,
      composeFile: composeFilePath(settings),
      envFile: envFilePath(settings),
      baseDir: settings.baseDir,
      profiles: settings.profiles,
      configReady: fs.existsSync(configDir),
      configDir,
      services: [],
      runningServices: 0,
      output: [prepNotes, error instanceof Error ? error.message : 'Invalid Koinos native settings']
        .filter(Boolean)
        .join('\n')
    }
  }

  const selectedServiceIds = selectedManagedComposeServiceIds(settings, serviceDefinitions)
  const processSnapshot = await listProcessSnapshot()
  const services = (
    await Promise.all(
      selectedServiceIds.map(async (serviceId): Promise<ComposeServiceStatus | null> => {
        const dockerServiceName = toDockerServiceName(serviceId)
        const serviceDefinition = serviceDefinitions.get(dockerServiceName)
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
    .filter((service): service is ComposeServiceStatus => service !== null)
    .sort(sortComposeServices)

  const runningServices = services.filter(isComposeServiceRunning).length
  const unavailableNativeServices = services.filter(
    (service) => service.runtimeType === 'native' && (service.state === 'not built' || service.state === 'unavailable')
  )

  return {
    ok: unavailableNativeServices.length === 0,
    dockerAvailable: true,
    runtimeMode: 'native',
    availableRuntimeModes: [...AVAILABLE_RUNTIME_MODES],
    repoPath: settings.repoPath,
    composeFile: composeFilePath(settings),
    envFile: envFilePath(settings),
    baseDir: settings.baseDir,
    profiles: settings.profiles,
    configReady: fs.existsSync(configDir),
    configDir,
    services,
    runningServices,
    output: [
      prepNotes,
      nativeManagedProcessRegistryOutput(settings),
      unavailableNativeServices.length > 0
        ? unavailableNativeServices.map((service) => service.lastError).filter(Boolean).join('\n')
        : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

async function dockerComposeStatus(
  input?: KoinosNodeSettingsInput,
  options?: { allowAutoStart?: boolean }
): Promise<KoinosNodeStatus> {
  const settings = normalizeNodeSettings(input)
  const configDir = configDirPath(settings)
  const prepNotes = ensureKoinosRepoRenamedFiles(settings)
  let serviceDefinitions = new Map<string, ComposeServiceDefinition>()

  try {
    assertRepoReady(settings)
    serviceDefinitions = readComposeServiceDefinitions(settings)
  } catch (error) {
    return {
      ok: false,
      dockerAvailable: true,
      runtimeMode: 'docker',
      availableRuntimeModes: [...AVAILABLE_RUNTIME_MODES],
      repoPath: settings.repoPath,
      composeFile: composeFilePath(settings),
      envFile: envFilePath(settings),
      baseDir: settings.baseDir,
      profiles: settings.profiles,
      configReady: fs.existsSync(configDir),
      configDir,
      services: [],
      runningServices: 0,
      output: [prepNotes, error instanceof Error ? error.message : 'Invalid Koinos compose settings']
        .filter(Boolean)
        .join('\n')
    }
  }

  const args = [...composeBaseArgs(settings), 'ps', '--all', '--format', 'json']

  const dockerRun = await runDockerCommandWithAutoStart(args, {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings),
    allowAutoStart: options?.allowAutoStart !== false
  })
  const result = dockerRun.result

  const services = result.ok
    ? mergeComposeServiceStatuses(
        parseComposePsJson(result.output, serviceDefinitions, settings),
        serviceDefinitions,
        settings.profiles
      )
    : []
  const runningServices = services.filter(isComposeServiceRunning).length

  return {
    ok: result.ok,
    dockerAvailable: result.ok || !/spawn docker ENOENT/i.test(result.output),
    runtimeMode: 'docker',
    availableRuntimeModes: [...AVAILABLE_RUNTIME_MODES],
    repoPath: settings.repoPath,
    composeFile: composeFilePath(settings),
    envFile: envFilePath(settings),
    baseDir: settings.baseDir,
    profiles: settings.profiles,
    configReady: fs.existsSync(configDir),
    configDir,
    services,
    runningServices,
    output: [prepNotes, dockerRun.notes.join('\n'), result.output].filter(Boolean).join('\n')
  }
}

async function composePresets(input?: KoinosNodeSettingsInput): Promise<KoinosNodePresetsResult> {
  const settings = normalizeNodeSettings(input)

  try {
    const presets = buildComposePresets(settings)
    return {
      ok: true,
      presets,
      output: presets.length
        ? `Loaded ${presets.length} profiles from ${composeFilePath(settings)}`
        : `No profiles found in ${composeFilePath(settings)}`
    }
  } catch (error) {
    return {
      ok: false,
      presets: [],
      output: error instanceof Error ? error.message : 'No se pudieron leer los profiles del compose'
    }
  }
}

function prepareComposeStartNotes(settings: KoinosNodeSettings, initialNotes: string[] = []): string[] {
  const notes = [...initialNotes]
  const prep = ensureKoinosConfigFiles(settings)
  notes.push(prep.output)
  fs.mkdirSync(settings.baseDir, { recursive: true })
  if (usesMacDockerDesktopWorkaround()) {
    notes.push('macOS detected: using Docker Desktop compose override (disable configs mounts inside /koinos)')
    notes.push(ensureBaseDirKoinosRuntimeFiles(settings))
  }
  return notes
}

function listsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function findProfileDependents(status: KoinosNodeStatus, serviceId: string): ComposeServiceStatus[] {
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

async function nativeRuntimeDockerConflictCheck(settings: KoinosNodeSettings): Promise<{ ok: boolean; output: string }> {
  const dockerStatus = await dockerComposeStatus(
    { ...settings, runtimeMode: 'docker' },
    { allowAutoStart: false }
  )
  if (
    !dockerStatus.dockerAvailable ||
    (!dockerStatus.ok &&
      /spawn docker ENOENT|Cannot connect to the Docker daemon|error during connect|Is the docker daemon running/i.test(
        dockerStatus.output
      ))
  ) {
    return {
      ok: true,
      output: ''
    }
  }

  const conflictingServices = dockerStatus.services.filter((service) => isComposeServiceRunning(service))
  if (conflictingServices.length === 0) {
    return {
      ok: true,
      output: ''
    }
  }

  return {
    ok: false,
    output: `Deten primero los servicios Docker activos antes de usar el runtime native: ${conflictingServices
      .map((service) => service.name)
      .join(', ')}`
  }
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

async function dockerComposeAction(
  action: 'start' | 'stop',
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeCommandResult> {
  return nativeRuntimeService.dockerComposeAction(action, input)
}

async function dockerComposeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  return nativeRuntimeService.dockerComposeServiceAction(action, input)
}

async function dockerComposePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
  return nativeRuntimeService.dockerComposePresetReconcile(input)
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

async function dockerComposeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  return logsService.dockerComposeLogs(input)
}

function dockerComposeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): KoinosNodeLogsFollowStartResult {
  return logsService.dockerComposeLogsFollowStart(sender, input)
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
  return nativeComposeAction(action, settings)
}

async function koinosNodeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  return nativeComposeServiceAction(action, input)
}

async function koinosNodePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
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
      const defaults = normalizeNodeSettings()
      return {
        ...defaults,
        composeFile: composeFilePath(defaults),
        envFile: envFilePath(defaults)
      }
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
    koinosJsonRpcProxy,
    koinosNodeDashboardProducers,
    koinosNodeDashboardPeers,
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
