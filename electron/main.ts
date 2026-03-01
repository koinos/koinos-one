import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { parse as parseYaml } from 'yaml'

const isDev = !!process.env.VITE_DEV_SERVER_URL
const DEFAULT_KOINOS_REPO_PATH = '/Users/pgarcgo/code/koinos_code/koinos'
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml'
const DEFAULT_ENV_FILE = '.env'
const LEGACY_DEFAULT_ENV_FILE = 'env.example'
const DEFAULT_PROFILES = ['block_producer', 'jsonrpc']
const DEFAULT_BASEDIR = path.join(os.homedir(), '.koinos')
const DEFAULT_BLOCKCHAIN_BACKUP_URL = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'
const DEFAULT_KOINOS_SOURCE_ROOT = '/Users/pgarcgo/code/koinos_code'
const KOINOS_GIT_CLONE_URL = 'https://github.com/koinos/koinos'
const MAC_DOCKER_DESKTOP_OVERRIDE_PATH = path.join(os.tmpdir(), 'knodel-koinos-docker-desktop.override.yml')
const MAC_DOCKER_DESKTOP_CONFIG_OVERRIDE_SERVICES = [
  'amqp',
  'chain',
  'mempool',
  'block_store',
  'p2p',
  'block_producer',
  'jsonrpc',
  'grpc',
  'transaction_store',
  'contract_meta_store',
  'account_history'
] as const

type KoinosNodeSettingsInput = {
  repoPath?: string
  composeFile?: string
  envFile?: string
  baseDir?: string
  profiles?: string[]
  blockchainBackupUrl?: string
  runtimeMode?: KoinosNodeServiceRuntime
}

type KoinosNodeSettings = {
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string[]
  blockchainBackupUrl: string
  runtimeMode: KoinosNodeServiceRuntime
}

type KoinosNodeServiceRuntime = 'docker' | 'native'

type KoinosNodeServicePort = {
  host: string | null
  publishedPort: number | null
  targetPort: number | null
  protocol: string
  label: string
}

type ManagedKoinosServiceDefinition = {
  id: string
  displayName: string
  dockerService: string
  plannedRuntimeModes: KoinosNodeServiceRuntime[]
}

type ComposeServiceDefinition = {
  profiles: string[]
  dependsOn: string[]
  ports: KoinosNodeServicePort[]
}

type ComposeResolvedServiceDefinition = {
  image: string | null
}

type NativeBuildSystem = 'cmake' | 'go' | 'yarn'

type NativeServiceBuildDefinition = {
  serviceId: string
  repoPath: string
  buildSystem: NativeBuildSystem
  artifactPath: string
  buildCommands: string[]
  buildTarget?: string
  goPackage?: string
}

type ComposeServiceStatus = {
  id: string
  name: string
  service: string
  runtimeName: string
  runtimeType: KoinosNodeServiceRuntime
  state: string
  status: string
  ports: KoinosNodeServicePort[]
  dependsOn: string[]
  lastError: string | null
  nativePid: number | null
  conflictPids: number[]
  managedByKnodel: boolean
}

type KoinosNodeStatus = {
  ok: boolean
  dockerAvailable: boolean
  runtimeMode: KoinosNodeServiceRuntime
  availableRuntimeModes: KoinosNodeServiceRuntime[]
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string[]
  configReady: boolean
  configDir: string
  services: ComposeServiceStatus[]
  runningServices: number
  output: string
}

type KoinosNodePresetSource = 'compose-core' | 'compose-profile'

type KoinosNodePreset = {
  id: string
  label: string
  source: KoinosNodePresetSource
  profiles: string[]
  services: string[]
  description: string
}

type KoinosNodePresetsResult = {
  ok: boolean
  presets: KoinosNodePreset[]
  output: string
}

type KoinosNodeCommandResult = {
  ok: boolean
  action: 'start' | 'stop'
  output: string
  status: KoinosNodeStatus
}

type KoinosNodeBackupRestoreResult = {
  ok: boolean
  action: 'restore-backup'
  output: string
  status: KoinosNodeStatus
}

type KoinosJsonRpcProxyInput = {
  rpcUrl?: string
  method?: string
  params?: Record<string, unknown>
}

type KoinosJsonRpcProxyResult = {
  ok: boolean
  method: string
  result?: unknown
  output: string
}

type KoinosNodeServiceCommandInput = KoinosNodeSettingsInput & {
  service?: string
}

type KoinosNodeServiceCommandResult = {
  ok: boolean
  action: 'start' | 'stop' | 'restart' | 'kill-conflict'
  service: string
  output: string
  status: KoinosNodeStatus
}

type KoinosNodePresetCommandInput = KoinosNodeSettingsInput & {
  presetId?: string
}

type KoinosNodePresetCommandResult = {
  ok: boolean
  action: 'reconcile'
  presetId: string
  output: string
  status: KoinosNodeStatus
}

type KoinosNodeNativeBuildStatus = {
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

type KoinosNodeNativeBuildsResult = {
  ok: boolean
  sourceRoot: string
  services: KoinosNodeNativeBuildStatus[]
  output: string
}

type KoinosNodeNativeBuildCommandInput = {
  serviceId?: string
}

type KoinosNodeNativeBuildCommandResult = {
  ok: boolean
  action: 'build-all' | 'build-service'
  serviceId: string | null
  output: string
  builds: KoinosNodeNativeBuildsResult
}

type KoinosNodeCloneRepoResult = {
  ok: boolean
  repoPath: string
  output: string
}

type KoinosNodeManagedFileKind = 'compose' | 'env' | 'config'

type KoinosNodeFileReadInput = KoinosNodeSettingsInput & {
  kind: KoinosNodeManagedFileKind
}

type KoinosNodeFileReadResult = {
  ok: boolean
  kind: KoinosNodeManagedFileKind
  filePath: string
  content: string
  output: string
}

type KoinosNodeFileWriteInput = KoinosNodeSettingsInput & {
  kind: KoinosNodeManagedFileKind
  content?: string
}

type KoinosNodeFileWriteResult = {
  ok: boolean
  kind: KoinosNodeManagedFileKind
  filePath: string
  output: string
}

type KoinosNodeLogsInput = KoinosNodeSettingsInput & {
  service?: string
  tail?: number
}

type KoinosNodeLogsResult = {
  ok: boolean
  service: string | null
  tail: number
  output: string
}

type KoinosNodeLogsFollowStartInput = KoinosNodeLogsInput

type KoinosNodeLogsFollowStartResult = {
  ok: boolean
  streamId: string
  service: string | null
  tail: number
  output?: string
}

type KoinosNodeLogsFollowStopInput = {
  streamId?: string
}

type KoinosNodeLogsFollowStopResult = {
  ok: boolean
  streamId: string | null
}

type KoinosNodeLogsFollowEvent = {
  streamId: string
  type: 'start' | 'chunk' | 'end' | 'error'
  service?: string | null
  tail?: number
  chunk?: string
  code?: number | null
  message?: string
}

type LogsFollowSession = {
  sender: Electron.WebContents
  service: string | null
  tail: number
  ended: boolean
  stop: () => void
}

type NativeServiceProcessState = {
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

type NativeServiceLaunchSpec = {
  serviceId: string
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  runtimeName: string
}

type NativeServiceStopResult = {
  ok: boolean
  output: string
}

type NativeConflictKillResult = {
  ok: boolean
  output: string
}

type PlatformDescriptor = {
  architecture?: string
  os?: string
  variant?: string
}

type NativeBuildToolStatus = {
  ok: boolean
  note: string | null
}

type TcpListenerOwner = {
  pid: number | null
  command: string
  endpoint: string
  host: string
  port: number | null
}

type ProcessSnapshotEntry = {
  pid: number
  command: string
}

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'
const logsFollowSessions = new Map<string, LogsFollowSession>()
const nativeServiceProcesses = new Map<string, NativeServiceProcessState>()
const nativeLogsStreamIdsByService = new Map<string, Set<string>>()
let logsFollowSessionSeq = 0
const MAX_NATIVE_SERVICE_LOG_BYTES = 512 * 1024
const NATIVE_AMQP_STARTUP_TIMEOUT_MS = 90000
const BLOCKCHAIN_BACKUP_RESTORE_DIRS = ['chain', 'block_store'] as const
const BLOCKCHAIN_BACKUP_RESET_DIRS = ['p2p', 'mempool'] as const
const DEFAULT_RUNTIME_MODE: KoinosNodeServiceRuntime = 'docker'
const AVAILABLE_RUNTIME_MODES: KoinosNodeServiceRuntime[] = ['docker', 'native']

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

function normalizeRuntimeMode(value?: string | null): KoinosNodeServiceRuntime {
  return value === 'native' ? 'native' : DEFAULT_RUNTIME_MODE
}

function isAppleSiliconHost(): boolean {
  return process.platform === 'darwin' && os.arch() === 'arm64'
}

function nativeCmakeExecutable(): string {
  const pythonUniversalCmake = path.join(
    os.homedir(),
    'Library',
    'Python',
    '3.9',
    'lib',
    'python',
    'site-packages',
    'cmake',
    'data',
    'bin',
    'cmake'
  )
  const homebrewCmake = '/opt/homebrew/bin/cmake'
  if (isAppleSiliconHost()) {
    if (fs.existsSync(pythonUniversalCmake)) return pythonUniversalCmake
    if (fs.existsSync(homebrewCmake)) return homebrewCmake
  }
  return 'cmake'
}

function nativeGitExecutable(): string {
  const systemGit = '/usr/bin/git'
  return fs.existsSync(systemGit) ? systemGit : 'git'
}

function findExecutableInPath(command: string): string | null {
  const candidates = new Set<string>()
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)

  const homebrewPrefix = nativeHomebrewPrefix()
  if (homebrewPrefix) {
    pathEntries.unshift(path.join(homebrewPrefix, 'bin'), path.join(homebrewPrefix, 'sbin'))
  }

  for (const entry of pathEntries) {
    const candidate = path.join(entry, command)
    if (!fs.existsSync(candidate)) continue
    candidates.add(candidate)
  }

  return [...candidates][0] ?? null
}

function nativeRabbitmqServerExecutable(): string | null {
  return findExecutableInPath('rabbitmq-server')
}

function nativeRabbitmqCtlExecutable(): string | null {
  return findExecutableInPath('rabbitmqctl')
}

function nativeRabbitmqHomebrewPrefix(): string | null {
  const serverExecutable = nativeRabbitmqServerExecutable()
  if (serverExecutable) {
    const prefix = path.dirname(path.dirname(serverExecutable))
    if (fs.existsSync(prefix)) return prefix
  }

  return nativeHomebrewPrefix()
}

function nativeRabbitmqOptPrefix(): string | null {
  const homebrewPrefix = nativeRabbitmqHomebrewPrefix()
  if (!homebrewPrefix) return null

  const optPrefix = path.join(homebrewPrefix, 'opt', 'rabbitmq')
  return fs.existsSync(optPrefix) ? optPrefix : null
}

function uniquePathValue(entries: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of entries) {
    if (!entry) continue
    for (const segment of entry.split(path.delimiter)) {
      const trimmed = segment.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      normalized.push(trimmed)
    }
  }

  return normalized.join(path.delimiter)
}

function nativeHomebrewPrefix(): string | null {
  const prefix = '/opt/homebrew'
  return fs.existsSync(prefix) ? prefix : null
}

function nativeCmakeConfigureArgs(buildDir = 'build'): string[] {
  const args = ['-S', '.', '-B', buildDir, '-D', 'CMAKE_BUILD_TYPE=Release', '-D', 'CMAKE_POLICY_VERSION_MINIMUM=3.5']
  const homebrewPrefix = nativeHomebrewPrefix()

  if (isAppleSiliconHost()) {
    args.push('-D', 'CMAKE_OSX_ARCHITECTURES=arm64')
    args.push('-D', 'CMAKE_APPLE_SILICON_PROCESSOR=arm64')
  }

  if (homebrewPrefix) {
    args.push('-D', `CMAKE_PREFIX_PATH=${homebrewPrefix}`)
    const gmpInclude = path.join(homebrewPrefix, 'include')
    const gmpLibrary = path.join(homebrewPrefix, 'lib', 'libgmp.dylib')
    const gmpxxLibrary = path.join(homebrewPrefix, 'lib', 'libgmpxx.dylib')
    if (fs.existsSync(gmpInclude)) args.push('-D', `GMP_INCLUDE_DIR=${gmpInclude}`)
    if (fs.existsSync(gmpLibrary)) args.push('-D', `GMP_LIBRARY=${gmpLibrary}`)
    if (fs.existsSync(gmpxxLibrary)) args.push('-D', `GMPXX_LIBRARY=${gmpxxLibrary}`)
  }

  args.push('-D', `GIT_EXECUTABLE=${nativeGitExecutable()}`)
  return args
}

function nativeCmakeConfigureCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), ...nativeCmakeConfigureArgs(buildDir)].join(' ')
}

function nativeCmakeBuildCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), '--build', buildDir, '--config', 'Release', '--parallel'].join(' ')
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

function nativeServiceBuildDefinitions(sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT): NativeServiceBuildDefinition[] {
  return [
    {
      serviceId: 'chain',
      repoPath: path.join(sourceRoot, 'koinos-chain'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-chain', 'build', 'src', 'koinos_chain'),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'mempool',
      repoPath: path.join(sourceRoot, 'koinos-mempool'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-mempool', 'build', 'src', 'koinos_mempool'),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'block_store',
      repoPath: path.join(sourceRoot, 'koinos-block-store'),
      buildSystem: 'go',
      artifactPath: path.join(sourceRoot, 'koinos-block-store', 'build', 'bin', 'koinos-block-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-block-store ./cmd/koinos-block-store'],
      goPackage: './cmd/koinos-block-store'
    },
    {
      serviceId: 'p2p',
      repoPath: path.join(sourceRoot, 'koinos-p2p'),
      buildSystem: 'go',
      artifactPath: path.join(sourceRoot, 'koinos-p2p', 'build', 'bin', 'koinos-p2p'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-p2p ./cmd/koinos-p2p'],
      goPackage: './cmd/koinos-p2p'
    },
    {
      serviceId: 'block_producer',
      repoPath: path.join(sourceRoot, 'koinos-block-producer'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-block-producer', 'build', 'src', 'koinos_block_producer'),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'jsonrpc',
      repoPath: path.join(sourceRoot, 'koinos-jsonrpc'),
      buildSystem: 'go',
      artifactPath: path.join(sourceRoot, 'koinos-jsonrpc', 'build', 'bin', 'koinos-jsonrpc'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-jsonrpc ./cmd/koinos-jsonrpc'],
      goPackage: './cmd/koinos-jsonrpc'
    },
    {
      serviceId: 'grpc',
      repoPath: path.join(sourceRoot, 'koinos-grpc'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-grpc', 'build', 'src', 'koinos_grpc'),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'transaction_store',
      repoPath: path.join(sourceRoot, 'koinos-transaction-store'),
      buildSystem: 'go',
      artifactPath: path.join(sourceRoot, 'koinos-transaction-store', 'build', 'bin', 'koinos-transaction-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-transaction-store ./cmd/koinos-transaction-store'],
      goPackage: './cmd/koinos-transaction-store'
    },
    {
      serviceId: 'contract_meta_store',
      repoPath: path.join(sourceRoot, 'koinos-contract-meta-store'),
      buildSystem: 'go',
      artifactPath: path.join(sourceRoot, 'koinos-contract-meta-store', 'build', 'bin', 'koinos-contract-meta-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-contract-meta-store ./cmd/koinos-contract-meta-store'],
      goPackage: './cmd/koinos-contract-meta-store'
    },
    {
      serviceId: 'account_history',
      repoPath: path.join(sourceRoot, 'koinos-account-history'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-account-history', 'build', 'src', 'koinos_account_history'),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'rest',
      repoPath: path.join(sourceRoot, 'koinos-rest'),
      buildSystem: 'yarn',
      artifactPath: path.join(sourceRoot, 'koinos-rest', '.next', 'BUILD_ID'),
      buildCommands: ['yarn install --frozen-lockfile', 'yarn build']
    }
  ]
}

function nativeServiceBuildDefinitionMap(sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT): Map<string, NativeServiceBuildDefinition> {
  return new Map(nativeServiceBuildDefinitions(sourceRoot).map((definition) => [definition.serviceId, definition] as const))
}

function nativeDockerPlatform(): string | null {
  return isAppleSiliconHost() ? 'linux/arm64' : null
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

function expandUserPath(inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

function normalizeNodeSettings(input?: KoinosNodeSettingsInput): KoinosNodeSettings {
  const repoPath = expandUserPath(input?.repoPath || DEFAULT_KOINOS_REPO_PATH)
  const composeFile = (input?.composeFile || DEFAULT_COMPOSE_FILE).trim() || DEFAULT_COMPOSE_FILE
  const requestedEnvFile = (input?.envFile || DEFAULT_ENV_FILE).trim() || DEFAULT_ENV_FILE
  const envFile = requestedEnvFile === LEGACY_DEFAULT_ENV_FILE ? DEFAULT_ENV_FILE : requestedEnvFile
  const baseDir = expandUserPath(input?.baseDir || DEFAULT_BASEDIR)
  const requestedProfiles = Array.isArray(input?.profiles) ? input?.profiles : DEFAULT_PROFILES
  const profiles = requestedProfiles.map((p) => p.trim()).filter(Boolean)
  const blockchainBackupUrl = (input?.blockchainBackupUrl || DEFAULT_BLOCKCHAIN_BACKUP_URL).trim() || DEFAULT_BLOCKCHAIN_BACKUP_URL
  const runtimeMode = normalizeRuntimeMode(input?.runtimeMode)

  return {
    repoPath,
    composeFile,
    envFile,
    baseDir,
    profiles,
    blockchainBackupUrl,
    runtimeMode
  }
}

function composeFilePath(settings: KoinosNodeSettings): string {
  return path.isAbsolute(settings.composeFile)
    ? settings.composeFile
    : path.join(settings.repoPath, settings.composeFile)
}

function envFilePath(settings: KoinosNodeSettings): string {
  return path.isAbsolute(settings.envFile)
    ? settings.envFile
    : path.join(settings.repoPath, settings.envFile)
}

function managedFilePath(settings: KoinosNodeSettings, kind: KoinosNodeManagedFileKind): string {
  if (kind === 'compose') return composeFilePath(settings)
  if (kind === 'env') return envFilePath(settings)
  return path.join(configDirPath(settings), 'config.yml')
}

function configDirPath(settings: KoinosNodeSettings): string {
  return path.join(settings.repoPath, 'config')
}

function configExampleDirPath(settings: KoinosNodeSettings): string {
  return path.join(settings.repoPath, 'config-example')
}

function assertRepoReady(settings: KoinosNodeSettings): void {
  if (!fs.existsSync(settings.repoPath)) {
    throw new Error(`Koinos repo path not found: ${settings.repoPath}`)
  }
  const composePath = composeFilePath(settings)
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file not found: ${composePath}`)
  }
  const envPath = envFilePath(settings)
  if (!fs.existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`)
  }
}

function normalizeComposeProfiles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }
  return []
}

function normalizeComposeDependsOn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value as Record<string, unknown>).map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

function readEnvFileValues(settings: KoinosNodeSettings): Record<string, string> {
  const envPath = envFilePath(settings)
  if (!fs.existsSync(envPath)) return {}

  const values: Record<string, string> = {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (!key) continue
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  return values
}

function resolveComposeEnvTemplate(input: string, envValues: Record<string, string>): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g, (_match, variableName, operator, fallback) => {
    const currentValue = envValues[String(variableName)]

    if (operator === ':-' || operator === '-' || operator === ':?' || operator === '?') {
      return currentValue && currentValue.length > 0 ? currentValue : String(fallback ?? '')
    }

    return currentValue ?? ''
  })
}

function normalizeComposePortDefinition(
  entry: unknown,
  envValues: Record<string, string>
): KoinosNodeServicePort | null {
  if (typeof entry === 'string') {
    const resolved = resolveComposeEnvTemplate(entry, envValues).trim()
    if (!resolved) return null

    const [addressPart, protocolPart] = resolved.split('/', 2)
    const protocol = protocolPart?.trim() || 'tcp'
    const segments = addressPart.split(':').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length === 0) return null

    const targetValue = segments[segments.length - 1] ?? ''
    const publishedValue = segments.length >= 2 ? segments[segments.length - 2] ?? '' : ''
    const hostValue = segments.length >= 3 ? segments.slice(0, -2).join(':') : ''
    const targetPort = parsePortNumber(targetValue)
    const publishedPort = parsePortNumber(publishedValue)
    const host = hostValue || null

    return {
      host,
      publishedPort,
      targetPort,
      protocol,
      label:
        publishedPort !== null && targetPort !== null
          ? `${host ? `${host}:` : ''}${publishedPort}->${targetPort}/${protocol}`
          : targetPort !== null
            ? `${targetPort}/${protocol}`
            : resolved
    }
  }

  if (typeof entry === 'object' && entry !== null) {
    const portDefinition = entry as Record<string, unknown>
    const host =
      typeof portDefinition.host_ip === 'string' && portDefinition.host_ip.trim()
        ? resolveComposeEnvTemplate(portDefinition.host_ip.trim(), envValues)
        : null
    const publishedPort = parsePortNumber(
      typeof portDefinition.published === 'string'
        ? resolveComposeEnvTemplate(portDefinition.published, envValues)
        : portDefinition.published
    )
    const targetPort = parsePortNumber(
      typeof portDefinition.target === 'string' ? resolveComposeEnvTemplate(portDefinition.target, envValues) : portDefinition.target
    )
    const protocol =
      typeof portDefinition.protocol === 'string' && portDefinition.protocol.trim() ? portDefinition.protocol.trim() : 'tcp'

    return {
      host,
      publishedPort,
      targetPort,
      protocol,
      label:
        publishedPort !== null && targetPort !== null
          ? `${host ? `${host}:` : ''}${publishedPort}->${targetPort}/${protocol}`
          : targetPort !== null
            ? `${targetPort}/${protocol}`
            : protocol
    }
  }

  return null
}

function normalizeComposePorts(value: unknown, envValues: Record<string, string>): KoinosNodeServicePort[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => normalizeComposePortDefinition(entry, envValues))
    .filter((entry): entry is KoinosNodeServicePort => entry !== null)
}

function readComposeServiceDefinitions(settings: KoinosNodeSettings): Map<string, ComposeServiceDefinition> {
  const composePath = composeFilePath(settings)
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file not found: ${composePath}`)
  }

  const raw = fs.readFileSync(composePath, 'utf8')
  const parsed = parseYaml(raw) as { services?: Record<string, Record<string, unknown>> } | null
  const services = parsed?.services
  if (!services || typeof services !== 'object') {
    return new Map()
  }
  const envValues = {
    BASEDIR: settings.baseDir,
    COMPOSE_PROFILES: settings.profiles.join(','),
    ...readEnvFileValues(settings)
  }

  const definitions = new Map<string, ComposeServiceDefinition>()
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    const definition = serviceConfig && typeof serviceConfig === 'object' ? serviceConfig : {}
    definitions.set(serviceName, {
      profiles: normalizeComposeProfiles((definition as Record<string, unknown>).profiles),
      dependsOn: normalizeComposeDependsOn((definition as Record<string, unknown>).depends_on),
      ports: normalizeComposePorts((definition as Record<string, unknown>).ports, envValues)
    })
  }

  return definitions
}

function formatComposePresetLabel(profile: string): string {
  return profile
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildComposePresets(settings: KoinosNodeSettings): KoinosNodePreset[] {
  const serviceDefinitions = readComposeServiceDefinitions(settings)
  const managedServiceOrder = new Map(KOINOS_MANAGED_SERVICES.map((service, index) => [service.id, index] as const))
  const knownServiceIds = new Set(KOINOS_MANAGED_SERVICES.map((service) => service.id))
  const coreServices: string[] = []
  const profiledServicePairs: Array<{ profile: string; serviceId: string }> = []

  for (const [serviceName, definition] of serviceDefinitions.entries()) {
    const serviceId = KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(serviceName)?.id ?? serviceName
    if (!knownServiceIds.has(serviceId)) continue

    if (definition.profiles.length === 0) {
      coreServices.push(serviceId)
    }

    for (const profile of definition.profiles) {
      profiledServicePairs.push({ profile, serviceId })
    }
  }

  const profileServices = new Map<string, Set<string>>()
  for (const { profile, serviceId } of profiledServicePairs) {
    if (!profileServices.has(profile)) profileServices.set(profile, new Set(coreServices))
    profileServices.get(profile)!.add(serviceId)
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
      description: coreServices.length
        ? `Servicios base sin profile: ${sortServiceIds(coreServices).join(', ')}`
        : 'Servicios base del compose'
    }
  ]

  for (const [profile, services] of profileServices.entries()) {
    presets.push({
      id: `compose-profile:${profile}`,
      label: formatComposePresetLabel(profile),
      source: 'compose-profile',
      profiles: [profile],
      services: sortServiceIds(services),
      description: `Compose profile "${profile}" (${services.size} servicios)`
    })
  }

  return presets
}

function ensureKoinosConfigFiles(settings: KoinosNodeSettings): { configReady: boolean; output: string } {
  const configDir = configDirPath(settings)
  const exampleDir = configExampleDirPath(settings)

  if (!fs.existsSync(configDir)) {
    if (!fs.existsSync(exampleDir)) {
      throw new Error(`Missing config dir and config-example dir in ${settings.repoPath}`)
    }
    fs.cpSync(exampleDir, configDir, { recursive: true })
    return { configReady: true, output: `Created config/ from config-example (${exampleDir})` }
  }

  const required = ['config.yml', 'genesis_data.json', 'koinos_descriptors.pb', 'rabbitmq.conf']
  const copied: string[] = []
  for (const file of required) {
    const target = path.join(configDir, file)
    if (fs.existsSync(target)) continue
    const source = path.join(exampleDir, file)
    if (!fs.existsSync(source)) continue
    fs.copyFileSync(source, target)
    copied.push(file)
  }

  const output =
    copied.length > 0 ? `Completed config/ with missing files from config-example: ${copied.join(', ')}` : 'config/ ready'

  return { configReady: true, output }
}

function ensureKoinosRepoRenamedFiles(settings: KoinosNodeSettings): string {
  if (!fs.existsSync(settings.repoPath)) return ''

  const notes: string[] = []

  const configExampleDir = configExampleDirPath(settings)
  const configDir = configDirPath(settings)
  if (!fs.existsSync(configDir) && fs.existsSync(configExampleDir)) {
    fs.renameSync(configExampleDir, configDir)
    notes.push('Renamed config-example/ -> config/')
  }

  const envExamplePath = path.join(settings.repoPath, LEGACY_DEFAULT_ENV_FILE)
  const dotEnvPath = path.join(settings.repoPath, '.env')
  if (!fs.existsSync(dotEnvPath) && fs.existsSync(envExamplePath)) {
    fs.renameSync(envExamplePath, dotEnvPath)
    notes.push('Renamed env.example -> .env')
  }

  return notes.join('\n')
}

async function restoreKoinosRepoTemplatesForRefresh(settings: KoinosNodeSettings): Promise<string> {
  const repoPath = settings.repoPath
  if (!fs.existsSync(path.join(repoPath, '.git'))) return ''

  const pathsToRestore: string[] = []
  const configDir = configDirPath(settings)
  const configExampleDir = configExampleDirPath(settings)
  const dotEnvPath = path.join(repoPath, '.env')
  const envExamplePath = path.join(repoPath, LEGACY_DEFAULT_ENV_FILE)

  // If the app previously renamed these files, restore the tracked templates before pull.
  // This avoids git pull failures caused by local deletions of tracked files.
  if (fs.existsSync(configDir) && !fs.existsSync(configExampleDir)) {
    pathsToRestore.push('config-example')
  }
  if (fs.existsSync(dotEnvPath) && !fs.existsSync(envExamplePath)) {
    pathsToRestore.push(LEGACY_DEFAULT_ENV_FILE)
  }

  if (!pathsToRestore.length) return ''

  const result = await runCommand('git', ['-C', repoPath, 'checkout', '--', ...pathsToRestore], {
    cwd: repoPath
  })

  const restoredLabel = `Restored tracked templates before refresh: ${pathsToRestore.join(', ')}`
  return [restoredLabel, result.output].filter(Boolean).join('\n')
}

function ensureBaseDirKoinosRuntimeFiles(settings: KoinosNodeSettings): string {
  const cfgDir = configDirPath(settings)
  const mappings = [
    ['config.yml', path.join(settings.baseDir, 'config.yml')],
    ['genesis_data.json', path.join(settings.baseDir, 'chain', 'genesis_data.json')],
    ['koinos_descriptors.pb', path.join(settings.baseDir, 'jsonrpc', 'descriptors', 'koinos_descriptors.pb')]
  ] as const

  const copied: string[] = []
  for (const [sourceName, targetPath] of mappings) {
    const sourcePath = path.join(cfgDir, sourceName)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing config source for runtime file: ${sourcePath}`)
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(sourcePath, targetPath)
    copied.push(path.relative(settings.baseDir, targetPath))
  }

  return `Prepared BASEDIR runtime files: ${copied.join(', ')}`
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

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function hasBlockchainBackupPayload(dirPath: string): boolean {
  return BLOCKCHAIN_BACKUP_RESTORE_DIRS.some((entry) => fs.existsSync(path.join(dirPath, entry)))
}

function findBlockchainBackupPayloadRoot(dirPath: string, depth = 0): string | null {
  if (hasBlockchainBackupPayload(dirPath)) return dirPath
  if (depth >= 4) return null

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = findBlockchainBackupPayloadRoot(path.join(dirPath, entry.name), depth + 1)
    if (candidate) return candidate
  }

  return null
}

async function downloadAndExtractBlockchainBackup(url: string, extractDir: string): Promise<{ ok: boolean; output: string }> {
  fs.mkdirSync(extractDir, { recursive: true })

  const command = `set -o pipefail && curl --location --fail --silent --show-error ${shellSingleQuote(url)} | tar -xzf - -C ${shellSingleQuote(extractDir)}`
  return runCommand('/bin/bash', ['-lc', command], {
    cwd: process.cwd()
  })
}

function restoreBlockchainBackupPayload(payloadRoot: string, settings: KoinosNodeSettings): string[] {
  fs.mkdirSync(settings.baseDir, { recursive: true })

  for (const dirName of BLOCKCHAIN_BACKUP_RESET_DIRS) {
    fs.rmSync(path.join(settings.baseDir, dirName), { recursive: true, force: true })
  }

  const restored: string[] = []
  for (const dirName of BLOCKCHAIN_BACKUP_RESTORE_DIRS) {
    const sourcePath = path.join(payloadRoot, dirName)
    if (!fs.existsSync(sourcePath)) continue

    const targetPath = path.join(settings.baseDir, dirName)
    fs.rmSync(targetPath, { recursive: true, force: true })
    fs.cpSync(sourcePath, targetPath, { recursive: true })
    restored.push(dirName)
  }

  if (restored.length === 0) {
    throw new Error(
      `El backup no contiene ninguno de los directorios esperados: ${BLOCKCHAIN_BACKUP_RESTORE_DIRS.join(', ')}`
    )
  }

  return restored
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
  const result = await runCommand('docker', [...composeBaseArgs(settings), 'config'], {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings)
  })

  if (!result.ok) {
    throw new Error(result.output || 'No se pudo resolver la configuracion de docker compose')
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
  const buildxResult = await runCommand('docker', ['buildx', 'imagetools', 'inspect', '--raw', image], {
    cwd: process.cwd()
  })

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

  const manifestResult = await runCommand('docker', ['manifest', 'inspect', '--verbose', image], {
    cwd: process.cwd()
  })

  if (!manifestResult.ok) {
    throw new Error(manifestResult.output || `No se pudo inspeccionar el manifiesto de ${image}`)
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

  const notes = [`Apple Silicon detectado: comprobando y descargando imagenes nativas ${targetPlatform}`]
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
    const pullResult = await runCommand('docker', ['pull', '--platform', targetPlatform, image], {
      cwd: settings.repoPath
    })
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

function firstOutputLine(output: string, fallback: string): string {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || fallback
}

async function detectNativeBuildToolStatuses(): Promise<Record<NativeBuildSystem, NativeBuildToolStatus>> {
  const cwd = process.cwd()
  const cmakeResult = await runCommand(nativeCmakeExecutable(), ['--version'], { cwd })
  const clangResult = await runCommand('clang', ['--version'], { cwd })
  const goResult = await runCommand('go', ['version'], { cwd })
  const nodeResult = await runCommand('node', ['--version'], { cwd })
  const yarnResult = await runCommand('yarn', ['--version'], { cwd })

  const cmakeToolStatus =
    cmakeResult.ok && clangResult.ok
      ? { ok: true, note: null }
      : {
          ok: false,
          note: /xcode license/i.test(`${cmakeResult.output}\n${clangResult.output}`)
            ? 'Xcode CLI tools no estan listos: acepta antes la licencia de Xcode'
            : firstOutputLine(
                `${cmakeResult.output}\n${clangResult.output}`,
                'No se encontro un toolchain C/C++ valido para servicios CMake'
              )
        }

  const goToolStatus = goResult.ok
    ? { ok: true, note: null }
    : { ok: false, note: firstOutputLine(goResult.output, 'No se encontro Go para compilar servicios Go') }

  const yarnToolStatus =
    nodeResult.ok && yarnResult.ok
      ? { ok: true, note: null }
      : {
          ok: false,
          note: firstOutputLine(
            `${nodeResult.output}\n${yarnResult.output}`,
            'No se encontro Node/Yarn para compilar el servicio rest'
          )
        }

  return {
    cmake: cmakeToolStatus,
    go: goToolStatus,
    yarn: yarnToolStatus
  }
}

function artifactUpdatedAt(artifactPath: string | null): number | null {
  if (!artifactPath || !fs.existsSync(artifactPath)) return null
  try {
    return fs.statSync(artifactPath).mtimeMs
  } catch {
    return null
  }
}

async function nativeBuildStatus(): Promise<KoinosNodeNativeBuildsResult> {
  const sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT
  const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
  const toolStatuses = await detectNativeBuildToolStatuses()

  const services = KOINOS_MANAGED_SERVICES.map((service): KoinosNodeNativeBuildStatus => {
    const definition = definitions.get(service.id)
    if (!definition) {
      return {
        serviceId: service.id,
        serviceName: service.displayName,
        supported: false,
        buildSystem: null,
        repoPath: null,
        repoExists: false,
        artifactPath: null,
        artifactExists: false,
        artifactUpdatedAt: null,
        buildable: false,
        note: service.id === 'amqp' ? 'RabbitMQ no se compila desde /Users/pgarcgo/code/koinos_code' : 'Sin definicion de build nativa',
        buildCommands: []
      }
    }

    const repoExists = fs.existsSync(definition.repoPath)
    const artifactExists = fs.existsSync(definition.artifactPath)
    const toolStatus = toolStatuses[definition.buildSystem]

    return {
      serviceId: service.id,
      serviceName: service.displayName,
      supported: true,
      buildSystem: definition.buildSystem,
      repoPath: definition.repoPath,
      repoExists,
      artifactPath: definition.artifactPath,
      artifactExists,
      artifactUpdatedAt: artifactUpdatedAt(definition.artifactPath),
      buildable: repoExists && toolStatus.ok,
      note: !repoExists
        ? `Repo path not found: ${definition.repoPath}`
        : !toolStatus.ok
        ? toolStatus.note
        : artifactExists
        ? null
        : 'Aun no compilado',
      buildCommands: definition.buildCommands
    }
  })

  const builtCount = services.filter((service) => service.supported && service.artifactExists).length
  const supportedCount = services.filter((service) => service.supported).length

  return {
    ok: true,
    sourceRoot,
    services,
    output: `Native build workspace: ${sourceRoot} · ${builtCount}/${supportedCount} servicios con artefacto generado`
  }
}

async function buildNativeService(definition: NativeServiceBuildDefinition): Promise<{ ok: boolean; output: string }> {
  const toolStatuses = await detectNativeBuildToolStatuses()
  const toolStatus = toolStatuses[definition.buildSystem]

  if (!fs.existsSync(definition.repoPath)) {
    return {
      ok: false,
      output: `Repo path not found: ${definition.repoPath}`
    }
  }

  if (!toolStatus.ok) {
    return {
      ok: false,
      output: toolStatus.note || `Toolchain no disponible para ${definition.buildSystem}`
    }
  }

  if (definition.buildSystem === 'cmake') {
    let configureResult = await runCommand(nativeCmakeExecutable(), nativeCmakeConfigureArgs(), {
      cwd: definition.repoPath
    })
    if (!configureResult.ok) {
      let workaroundNote: string | null = null

      try {
        workaroundNote = await applyKoinosDarwinHunterWorkaround(definition.repoPath)
      } catch (error) {
        workaroundNote = `No se pudo aplicar el workaround Darwin/Hunter: ${
          error instanceof Error ? error.message : String(error)
        }`
      }

      if (!workaroundNote) {
        return {
          ok: false,
          output: [configureResult.output].filter(Boolean).join('\n')
        }
      }

      const retryConfigureResult = await runCommand(nativeCmakeExecutable(), nativeCmakeConfigureArgs(), {
        cwd: definition.repoPath
      })

      configureResult = {
        ok: retryConfigureResult.ok,
        code: retryConfigureResult.code,
        output: [configureResult.output, workaroundNote, retryConfigureResult.output].filter(Boolean).join('\n')
      }

      if (!retryConfigureResult.ok) {
        return {
          ok: false,
          output: configureResult.output
        }
      }
    }

    const buildResult = await runCommand(nativeCmakeExecutable(), ['--build', 'build', '--config', 'Release', '--parallel'], {
      cwd: definition.repoPath
    })
    return {
      ok: buildResult.ok,
      output: [configureResult.output, buildResult.output].filter(Boolean).join('\n')
    }
  }

  if (definition.buildSystem === 'go') {
    fs.mkdirSync(path.dirname(definition.artifactPath), { recursive: true })
    const buildResult = await runCommand(
      'go',
      ['build', '-o', definition.artifactPath, definition.goPackage || '.'],
      {
        cwd: definition.repoPath,
        env: { CGO_ENABLED: '0' }
      }
    )
    return {
      ok: buildResult.ok,
      output: buildResult.output
    }
  }

  const installResult = await runCommand('yarn', ['install', '--frozen-lockfile'], { cwd: definition.repoPath })
  if (!installResult.ok) {
    return {
      ok: false,
      output: installResult.output
    }
  }

  const buildResult = await runCommand('yarn', ['build'], { cwd: definition.repoPath })
  return {
    ok: buildResult.ok,
    output: [installResult.output, buildResult.output].filter(Boolean).join('\n')
  }
}

async function nativeBuildAll(): Promise<KoinosNodeNativeBuildCommandResult> {
  const sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT
  const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
  const logs: string[] = []
  let ok = true

  for (const service of KOINOS_MANAGED_SERVICES) {
    const definition = definitions.get(service.id)
    if (!definition) {
      logs.push(`[${service.id}] omitido: sin build nativo definido`)
      continue
    }

    const result = await buildNativeService(definition)
    logs.push(`=== ${service.id} ===\n${result.output || '(sin salida)'}`)
    if (!result.ok) ok = false
  }

  const builds = await nativeBuildStatus()
  return {
    ok,
    action: 'build-all',
    serviceId: null,
    output: logs.join('\n\n'),
    builds
  }
}

async function nativeBuildServiceAction(input?: KoinosNodeNativeBuildCommandInput): Promise<KoinosNodeNativeBuildCommandResult> {
  const serviceId = input?.serviceId?.trim() || ''
  const sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT
  const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
  const definition = definitions.get(serviceId)

  if (!serviceId || !definition) {
    const builds = await nativeBuildStatus()
    return {
      ok: false,
      action: 'build-service',
      serviceId: serviceId || null,
      output: serviceId ? `No hay build nativo configurado para ${serviceId}` : 'Parametro serviceId invalido',
      builds
    }
  }

  const result = await buildNativeService(definition)
  const builds = await nativeBuildStatus()
  return {
    ok: result.ok,
    action: 'build-service',
    serviceId,
    output: result.output,
    builds
  }
}

function normalizeLogsTail(inputTail: unknown, fallback = 200): number {
  const tailRaw =
    typeof inputTail === 'number' ? inputTail : Number.parseInt(String(inputTail ?? String(fallback)), 10)
  return Number.isFinite(tailRaw) ? Math.min(2000, Math.max(20, Math.trunc(tailRaw))) : fallback
}

function sendLogsFollowEvent(sender: Electron.WebContents, payload: KoinosNodeLogsFollowEvent): void {
  if (sender.isDestroyed()) return
  sender.send(LOGS_FOLLOW_EVENT_CHANNEL, payload)
}

function stopLogsFollowStream(streamId: string): KoinosNodeLogsFollowStopResult {
  const session = logsFollowSessions.get(streamId)
  if (!session) {
    return { ok: false, streamId: null }
  }

  logsFollowSessions.delete(streamId)
  session.ended = true
  session.stop()
  return { ok: true, streamId }
}

function parsePortNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
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
  if (!text.trim()) return ''
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - tail)).join('\n').trim()
}

function tailFileLines(filePath: string, tail: number): string {
  if (!fs.existsSync(filePath)) return ''
  return tailTextLines(fs.readFileSync(filePath, 'utf8'), tail)
}

function tailNativeAmqpHomebrewLogs(tail: number): string {
  return nativeAmqpHomebrewLogFiles()
    .map((filePath) => {
      const content = tailFileLines(filePath, tail)
      if (!content) return ''
      return [`== ${path.basename(filePath)} ==`, content].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

function trimNativeLogBuffer(text: string): string {
  if (text.length <= MAX_NATIVE_SERVICE_LOG_BYTES) return text
  return text.slice(text.length - MAX_NATIVE_SERVICE_LOG_BYTES)
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
  const state = nativeServiceProcesses.get(serviceId)
  if (!state) return

  const text = String(chunk)
  if (!text) return

  state.output = trimNativeLogBuffer(`${state.output}${text}`)
  state.lastOutputAt = Date.now()

  const streamIds = nativeLogsStreamIdsByService.get(serviceId)
  if (!streamIds || streamIds.size === 0) return

  for (const streamId of [...streamIds]) {
    const session = logsFollowSessions.get(streamId)
    if (!session || session.ended) {
      streamIds.delete(streamId)
      continue
    }

    sendLogsFollowEvent(session.sender, {
      streamId,
      type: 'chunk',
      chunk: text
    })
  }

  if (streamIds.size === 0) {
    nativeLogsStreamIdsByService.delete(serviceId)
  }
}

function closeNativeLogStreamsForService(serviceId: string, code?: number | null): void {
  const streamIds = nativeLogsStreamIdsByService.get(serviceId)
  if (!streamIds || streamIds.size === 0) return

  nativeLogsStreamIdsByService.delete(serviceId)

  for (const streamId of [...streamIds]) {
    const session = logsFollowSessions.get(streamId)
    if (!session || session.ended) continue
    session.ended = true
    logsFollowSessions.delete(streamId)
    sendLogsFollowEvent(session.sender, {
      streamId,
      type: 'end',
      code: code ?? 0
    })
  }
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
    const definition = KOINOS_MANAGED_SERVICE_BY_DOCKER_SERVICE.get(service)

    return {
      id: definition?.id ?? toManagedServiceId(service),
      name: definition?.displayName ?? service,
      service,
      runtimeName,
      runtimeType: 'docker',
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

function nativeServiceStatusFromProcessState(
  settings: KoinosNodeSettings,
  serviceId: string,
  serviceDefinition: ComposeServiceDefinition,
  state: NativeServiceProcessState | undefined,
  processSnapshot: ProcessSnapshotEntry[]
): ComposeServiceStatus {
  const buildDefinition = nativeServiceBuildDefinitionMap().get(serviceId)
  const fallbackRuntimeName = nativeServiceDefaultRuntimeName(serviceId, buildDefinition)
  const runtimeName = state?.runtimeName ?? fallbackRuntimeName
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

  if (state && !state.closed && conflictingProcesses.length === 0) {
    return {
      id: serviceId,
      name: serviceDisplayName(serviceId),
      service: toDockerServiceName(serviceId),
      runtimeName,
      runtimeType: 'native',
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
  const rabbitmqServer = nativeRabbitmqServerExecutable()
  if (!rabbitmqServer) {
    return {
      id: 'amqp',
      name: serviceDisplayName('amqp'),
      service: 'amqp',
      runtimeName,
      runtimeType: 'native',
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

async function dockerComposeStatus(input?: KoinosNodeSettingsInput): Promise<KoinosNodeStatus> {
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

  const result = await runCommand('docker', args, {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings)
  })

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
    output: [prepNotes, result.output].filter(Boolean).join('\n')
  }
}

async function dockerComposePresets(input?: KoinosNodeSettingsInput): Promise<KoinosNodePresetsResult> {
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
  const presetsResult = await dockerComposePresets(settings)
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
  const dockerStatus = await dockerComposeStatus({ ...settings, runtimeMode: 'docker' })
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

async function startNativeAmqpBrewService(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, ComposeServiceDefinition>
): Promise<{ ok: boolean; output: string }> {
  const brewExecutable = findExecutableInPath('brew')
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

  const result = await runCommand(brewExecutable, ['services', 'start', 'rabbitmq'], {
    cwd: process.cwd(),
    timeoutMs: 30000
  })
  const amqpPort = composeServicePortByTarget(serviceDefinition, 5672)
  const amqpAdminPort = composeServicePortByTarget(serviceDefinition, 15672)
  const listenerPorts = [amqpPort?.publishedPort ?? 5672, amqpAdminPort?.publishedPort ?? 15672]
  const rabbitmqCtl = nativeRabbitmqCtlExecutable()
  let awaitStartupOutput = ''
  if (rabbitmqCtl) {
    const awaitStartupResult = await runCommand(rabbitmqCtl, ['await_startup'], {
      cwd: process.cwd(),
      timeoutMs: NATIVE_AMQP_STARTUP_TIMEOUT_MS
    })
    if (awaitStartupResult.output) awaitStartupOutput = awaitStartupResult.output
  }

  const amqpReady = await waitForTcpListener(
    nativeServiceConnectHost(amqpPort),
    amqpPort?.publishedPort ?? 5672,
    NATIVE_AMQP_STARTUP_TIMEOUT_MS
  )
  const adminReady = await waitForTcpListener(
    nativeServiceConnectHost(amqpAdminPort),
    amqpAdminPort?.publishedPort ?? 15672,
    NATIVE_AMQP_STARTUP_TIMEOUT_MS
  )
  const listeners = await listTcpListenerOwners(listenerPorts)
  const rabbitmqListeners = listeners.filter(tcpListenerOwnedByRabbitmq)
  const dockerListeners = listeners.filter(tcpListenerOwnedByDocker)
  const listenerSummary = listeners.length > 0 ? describeTcpListenerOwners(listeners) : 'sin listeners'

  return {
    ok: result.ok && amqpReady && adminReady && rabbitmqListeners.length > 0 && dockerListeners.length === 0,
    output: [
      result.output,
      awaitStartupOutput,
      amqpReady && adminReady
        ? rabbitmqListeners.length > 0 && dockerListeners.length === 0
          ? 'RabbitMQ listo via brew services'
          : `Los puertos de amqp no pertenecen a RabbitMQ nativo: ${listenerSummary}`
        : `RabbitMQ no abrio 5672/15672 a tiempo (${Math.round(NATIVE_AMQP_STARTUP_TIMEOUT_MS / 1000)}s)`
    ]
      .filter(Boolean)
      .join('\n')
  }
}

async function stopNativeAmqpBrewService(
  settings: KoinosNodeSettings,
  serviceDefinitions: Map<string, ComposeServiceDefinition>
): Promise<{ ok: boolean; output: string }> {
  const brewExecutable = findExecutableInPath('brew')
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
  const result = await runCommand(brewExecutable, ['services', 'stop', 'rabbitmq'], {
    cwd: process.cwd(),
    timeoutMs: 20000
  })
  if (result.output) outputs.push(result.output)
  const amqpPort = composeServicePortByTarget(serviceDefinition, 5672)
  const amqpAdminPort = composeServicePortByTarget(serviceDefinition, 15672)
  const listenerPorts = [amqpPort?.publishedPort ?? 5672, amqpAdminPort?.publishedPort ?? 15672]
  const amqpClosed = await waitForTcpListenerClosed(
    nativeServiceConnectHost(amqpPort),
    amqpPort?.publishedPort ?? 5672,
    15000
  )
  const adminClosed = await waitForTcpListenerClosed(
    nativeServiceConnectHost(amqpAdminPort),
    amqpAdminPort?.publishedPort ?? 15672,
    15000
  )

  if (amqpClosed && adminClosed) {
    return {
      ok: true,
      output: [...outputs, 'RabbitMQ detenido via brew services'].filter(Boolean).join('\n')
    }
  }

  let listeners = await listTcpListenerOwners(listenerPorts)
  if (listeners.length > 0) {
    outputs.push(`Puertos de amqp aun ocupados por: ${describeTcpListenerOwners(listeners)}`)
  }

  const dockerListeners = listeners.filter(tcpListenerOwnedByDocker)
  const rabbitmqListeners = listeners.filter(tcpListenerOwnedByRabbitmq)

  if (dockerListeners.length > 0 && rabbitmqListeners.length === 0) {
    return {
      ok: true,
      output: [
        ...outputs,
        'RabbitMQ nativo ya estaba detenido',
        `Los puertos de amqp siguen ocupados por Docker Desktop: ${describeTcpListenerOwners(dockerListeners)}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  if (listeners.some(tcpListenerOwnedByRabbitmq)) {
    const rabbitmqCtl = nativeRabbitmqCtlExecutable()
    if (rabbitmqCtl) {
      const shutdownResult = await runCommand(rabbitmqCtl, ['shutdown'], {
        cwd: process.cwd(),
        timeoutMs: 15000
      })
      if (shutdownResult.output) outputs.push(shutdownResult.output)
      listeners = await listTcpListenerOwners(listenerPorts)
    }
  }

  if (listeners.some(tcpListenerOwnedByRabbitmq)) {
    const rabbitmqServer = nativeRabbitmqServerExecutable()
    if (rabbitmqServer) {
      const pkillResult = await runCommand('pkill', ['-f', rabbitmqServer], {
        cwd: process.cwd(),
        timeoutMs: 5000
      })
      if (pkillResult.output) outputs.push(pkillResult.output)
      listeners = await listTcpListenerOwners(listenerPorts)
    }
  }

  const amqpClosedAfterFallback = await waitForTcpListenerClosed(
    nativeServiceConnectHost(amqpPort),
    amqpPort?.publishedPort ?? 5672,
    10000
  )
  const adminClosedAfterFallback = await waitForTcpListenerClosed(
    nativeServiceConnectHost(amqpAdminPort),
    amqpAdminPort?.publishedPort ?? 15672,
    10000
  )
  const remainingListeners =
    amqpClosedAfterFallback && adminClosedAfterFallback ? [] : await listTcpListenerOwners(listenerPorts)
  const remainingRabbitmqListeners = remainingListeners.filter(tcpListenerOwnedByRabbitmq)

  return {
    ok: remainingRabbitmqListeners.length === 0,
    output: [
      ...outputs,
      remainingRabbitmqListeners.length === 0
        ? remainingListeners.length > 0
          ? `RabbitMQ nativo detenido. Los puertos de amqp siguen ocupados por otro proceso: ${describeTcpListenerOwners(remainingListeners)}`
          : 'RabbitMQ detenido'
        : `RabbitMQ sigue exponiendo 5672/15672${remainingListeners.length > 0 ? `: ${describeTcpListenerOwners(remainingListeners)}` : ''}`
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

  for (const serviceId of sortManagedServiceIdsByDependencies(serviceIds, serviceDefinitions)) {
    const result =
      serviceId === 'amqp' && nativeAmqpUsesBrewService()
        ? await startNativeAmqpBrewService(settings, serviceDefinitions)
        : await startNativeServiceProcess(settings, serviceId, serviceDefinitions)
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

  for (const serviceId of sortManagedServiceIdsByDependencies(serviceIds, serviceDefinitions).reverse()) {
    const result =
      serviceId === 'amqp' && nativeAmqpUsesBrewService()
        ? await stopNativeAmqpBrewService(settings, serviceDefinitions)
        : await stopNativeServiceProcess(serviceId)
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
  const settings = normalizeNodeSettings(input)
  const repoRenameNotes = ensureKoinosRepoRenamedFiles(settings)
  assertRepoReady(settings)
  const serviceDefinitions = readComposeServiceDefinitions(settings)

  const notes: string[] =
    action === 'start'
      ? prepareNativeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
      : repoRenameNotes
        ? [repoRenameNotes]
        : []

  if (action === 'start') {
    const conflictCheck = await nativeRuntimeDockerConflictCheck(settings)
    if (!conflictCheck.ok) {
      return {
        ok: false,
        action,
        output: [notes.join('\n'), conflictCheck.output].filter(Boolean).join('\n'),
        status: await nativeComposeStatus(settings)
      }
    }
  }

  const targetServiceIds =
    action === 'start'
      ? selectedManagedComposeServiceIds(settings, serviceDefinitions)
      : sortManagedServiceIds(
          new Set([
            ...selectedManagedComposeServiceIds(settings, serviceDefinitions),
            ...nativeServiceProcesses.keys()
          ])
        )

  const result =
    action === 'start'
      ? await startNativeServices(settings, targetServiceIds, serviceDefinitions)
      : await stopNativeServices(settings, targetServiceIds, serviceDefinitions)

  const status = await nativeComposeStatus(settings)
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
  const settings = normalizeNodeSettings(input)
  const service = input?.service?.trim() || ''
  if (!service) {
    return {
      ok: false,
      action,
      service: '',
      output: 'Parametro service invalido',
      status: await nativeComposeStatus(settings)
    }
  }

  const repoRenameNotes = ensureKoinosRepoRenamedFiles(settings)
  assertRepoReady(settings)
  const serviceDefinitions = readComposeServiceDefinitions(settings)
  const currentStatus = await nativeComposeStatus(settings)
  const serviceId = toManagedServiceId(service)
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
    const conflictCheck = await nativeRuntimeDockerConflictCheck(settings)
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
    const killResult = await killConflictingNativeServiceProcesses(settings, serviceId)
    const status = await nativeComposeStatus(settings)
    return {
      ok: killResult.ok,
      action,
      service,
      output: [repoRenameNotes, killResult.output, nativeManagedProcessRegistryOutput(settings)].filter(Boolean).join('\n'),
      status
    }
  }

  if ((action === 'start' || action === 'restart') && !isComposeServiceRunning(targetService)) {
    const currentServicesById = new Map(currentStatus.services.map((candidate) => [candidate.id, candidate] as const))
    const missingDependencyIds = (targetService.dependsOn ?? []).filter((dependencyId) => {
      const dependency = currentServicesById.get(dependencyId)
      return !dependency || !isComposeServiceRunning(dependency)
    })
    if (missingDependencyIds.length > 0) {
      return {
        ok: false,
        action,
        service,
        output: `No se puede ${action === 'start' ? 'iniciar' : 'reiniciar'} ${service}. Dependencias no activas: ${missingDependencyIds
          .map(serviceDisplayName)
          .join(', ')}`,
        status: currentStatus
      }
    }
  }

  if (action === 'stop') {
    const profileDependents = findProfileDependents(currentStatus, serviceId)
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
      ? prepareNativeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
      : repoRenameNotes
        ? [repoRenameNotes]
        : []

  if (action === 'restart') {
    const stopResult = await stopNativeServices(settings, [serviceId], serviceDefinitions)
    const startResult = await startNativeServices(settings, [serviceId], serviceDefinitions)
    const status = await nativeComposeStatus(settings)
    return {
      ok: stopResult.ok && startResult.ok,
      action,
      service,
      output: [notes.join('\n'), stopResult.output, startResult.output, nativeManagedProcessRegistryOutput(settings)]
        .filter(Boolean)
        .join('\n'),
      status
    }
  }

  const result =
    action === 'start'
      ? await startNativeServices(settings, [serviceId], serviceDefinitions)
      : await stopNativeServices(settings, [serviceId], serviceDefinitions)

  const status = await nativeComposeStatus(settings)
  return {
    ok: result.ok,
    action,
    service,
    output: [notes.join('\n'), result.output, nativeManagedProcessRegistryOutput(settings)].filter(Boolean).join('\n'),
    status
  }
}

async function nativeComposePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
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

  const repoRenameNotes = ensureKoinosRepoRenamedFiles(presetSettings)
  assertRepoReady(presetSettings)
  const notes = prepareNativeStartNotes(presetSettings, repoRenameNotes ? [repoRenameNotes] : [])
  const serviceDefinitions = readComposeServiceDefinitions(presetSettings)
  const currentStatus = await nativeComposeStatus(presetSettings)
  const targetServiceIds = sortManagedServiceIds(preset.services)
  const currentRunningIds = sortManagedServiceIds(
    currentStatus.services.filter(isComposeServiceRunning).map((service) => service.id)
  )
  const servicesToStop = currentStatus.services
    .filter((service) => isComposeServiceRunning(service) && !targetServiceIds.includes(service.id))
    .map((service) => service.id)

  if (listsEqual(targetServiceIds, currentRunningIds)) {
    return {
      ok: true,
      action: 'reconcile',
      presetId,
      output: `El nodo ya coincide con el profile ${preset.label}`,
      status: currentStatus
    }
  }

  const conflictCheck = await nativeRuntimeDockerConflictCheck(presetSettings)
  if (!conflictCheck.ok) {
    return {
      ok: false,
      action: 'reconcile',
      presetId,
      output: [notes.join('\n'), conflictCheck.output].filter(Boolean).join('\n'),
      status: await nativeComposeStatus(presetSettings)
    }
  }

  const startResult = await startNativeServices(presetSettings, targetServiceIds, serviceDefinitions)
  const stopResult =
    servicesToStop.length > 0
      ? await stopNativeServices(presetSettings, servicesToStop, serviceDefinitions)
      : { ok: true, output: '' }

  const status = await nativeComposeStatus(presetSettings)
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
  const settings = normalizeNodeSettings(input)
  const repoRenameNotes = ensureKoinosRepoRenamedFiles(settings)
  assertRepoReady(settings)

  const notes: string[] =
    action === 'start'
      ? prepareComposeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
      : repoRenameNotes
      ? [repoRenameNotes]
      : []

  if (action === 'start') {
    const nativeImages = await ensureNativeComposeImages(settings)
    if (nativeImages.output) notes.push(nativeImages.output)
    if (!nativeImages.ok) {
      return {
        ok: false,
        action,
        output: notes.filter(Boolean).join('\n'),
        status: await dockerComposeStatus(settings)
      }
    }
  }

  const composeArgs =
    action === 'start'
      ? [...composeBaseArgs(settings), 'up', '-d']
      : [...composeBaseArgs(settings), 'down']

  const result = await runCommand('docker', composeArgs, {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings)
  })

  const status = await dockerComposeStatus(settings)
  return {
    ok: result.ok,
    action,
    output: [notes.join('\n'), result.output].filter(Boolean).join('\n'),
    status
  }
}

async function dockerComposeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  const settings = normalizeNodeSettings(input)
  const service = input?.service?.trim() || ''
  if (!service) {
    return {
      ok: false,
      action,
      service: '',
      output: 'Parametro service invalido',
      status: await dockerComposeStatus(settings)
    }
  }

  const repoRenameNotes = ensureKoinosRepoRenamedFiles(settings)
  assertRepoReady(settings)
  const currentStatus = await dockerComposeStatus(settings)
  const serviceId = toManagedServiceId(service)
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

  if ((action === 'start' || action === 'restart') && (!targetService || !isComposeServiceRunning(targetService))) {
    const currentServicesById = new Map(currentStatus.services.map((candidate) => [candidate.id, candidate] as const))
    const missingDependencyIds = (targetService?.dependsOn ?? []).filter((dependencyId) => {
      const dependency = currentServicesById.get(dependencyId)
      return !dependency || !isComposeServiceRunning(dependency)
    })
    if (missingDependencyIds.length > 0) {
      return {
        ok: false,
        action,
        service,
        output: `No se puede ${action === 'start' ? 'iniciar' : 'reiniciar'} ${service}. Dependencias no activas: ${missingDependencyIds
          .map(serviceDisplayName)
          .join(', ')}`,
        status: currentStatus
      }
    }
  }

  if (action === 'stop') {
    const profileDependents = findProfileDependents(currentStatus, serviceId)
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
    action === 'start' || (action === 'restart' && (!targetService || !isComposeServiceRunning(targetService)))
      ? prepareComposeStartNotes(settings, repoRenameNotes ? [repoRenameNotes] : [])
      : repoRenameNotes
      ? [repoRenameNotes]
      : []

  if (action === 'start' || action === 'restart') {
    const nativeImages = await ensureNativeComposeImages(settings, [service])
    if (nativeImages.output) notes.push(nativeImages.output)
    if (!nativeImages.ok) {
      return {
        ok: false,
        action,
        service,
        output: notes.filter(Boolean).join('\n'),
        status: await dockerComposeStatus(settings)
      }
    }
  }

  const composeArgs =
    action === 'start'
      ? [...composeBaseArgs(settings), 'up', '-d', '--no-deps', service]
      : action === 'stop'
      ? [...composeBaseArgs(settings), 'stop', service]
      : targetService && isComposeServiceRunning(targetService) && !nativeDockerPlatform()
      ? [...composeBaseArgs(settings), 'restart', service]
      : [...composeBaseArgs(settings), 'up', '-d', '--force-recreate', '--no-deps', service]

  const result = await runCommand('docker', composeArgs, {
    cwd: settings.repoPath,
    env: composeCommandEnv(settings)
  })

  const status = await dockerComposeStatus(settings)
  return {
    ok: result.ok,
    action,
    service,
    output: [notes.join('\n'), result.output].filter(Boolean).join('\n'),
    status
  }
}

async function dockerComposePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
  const initialSettings = normalizeNodeSettings(input)
  const presetId = input?.presetId?.trim() || ''
  if (!presetId) {
    return {
      ok: false,
      action: 'reconcile',
      presetId: '',
      output: 'Parametro presetId invalido',
      status: await dockerComposeStatus(initialSettings)
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
      status: await dockerComposeStatus(initialSettings)
    }
  }

  const repoRenameNotes = ensureKoinosRepoRenamedFiles(presetSettings)
  assertRepoReady(presetSettings)
  const notes = prepareComposeStartNotes(presetSettings, repoRenameNotes ? [repoRenameNotes] : [])
  const currentStatus = await dockerComposeStatus(presetSettings)
  const targetServiceIds = [...preset.services].sort()
  const currentRunningIds = currentStatus.services.filter(isComposeServiceRunning).map((service) => service.id).sort()
  const servicesToStop = currentStatus.services
    .filter((service) => isComposeServiceRunning(service) && !targetServiceIds.includes(service.id))
    .map((service) => service.service)
  const servicesToUp = preset.services.map(toDockerServiceName)

  if (listsEqual(targetServiceIds, currentRunningIds)) {
    return {
      ok: true,
      action: 'reconcile',
      presetId,
      output: `El nodo ya coincide con el profile ${preset.label}`,
      status: currentStatus
    }
  }

  const nativeImages = await ensureNativeComposeImages(presetSettings, servicesToUp)
  if (nativeImages.output) notes.push(nativeImages.output)
  if (!nativeImages.ok) {
    return {
      ok: false,
      action: 'reconcile',
      presetId,
      output: notes.filter(Boolean).join('\n'),
      status: await dockerComposeStatus(presetSettings)
    }
  }

  const upResult = await runCommand('docker', [...composeBaseArgs(presetSettings), 'up', '-d', ...servicesToUp], {
    cwd: presetSettings.repoPath,
    env: composeCommandEnv(presetSettings)
  })

  let stopOutput = ''
  let stopOk = true
  if (servicesToStop.length > 0) {
    const stopResult = await runCommand('docker', [...composeBaseArgs(presetSettings), 'stop', ...servicesToStop], {
      cwd: presetSettings.repoPath,
      env: composeCommandEnv(presetSettings)
    })
    stopOk = stopResult.ok
    stopOutput = stopResult.output
  }

  const status = await dockerComposeStatus(presetSettings)
  return {
    ok: upResult.ok && stopOk,
    action: 'reconcile',
    presetId,
    output: [notes.join('\n'), upResult.output, stopOutput, servicesToStop.length ? `Stopped extras: ${servicesToStop.join(', ')}` : '']
      .filter(Boolean)
      .join('\n'),
    status
  }
}

async function cloneKoinosRepo(input?: KoinosNodeSettingsInput): Promise<KoinosNodeCloneRepoResult> {
  const settings = normalizeNodeSettings(input)
  const repoPath = settings.repoPath

  if (!repoPath.trim()) {
    return {
      ok: false,
      repoPath,
      output: 'Koinos repo path no puede estar vacio'
    }
  }

  if (fs.existsSync(repoPath)) {
    const stat = fs.statSync(repoPath)
    if (!stat.isDirectory()) {
      return {
        ok: false,
        repoPath,
        output: `La ruta existe pero no es un directorio: ${repoPath}`
      }
    }

    if (fs.existsSync(path.join(repoPath, '.git'))) {
      const refreshSteps: string[] = []
      const restoreTemplatesResult = await restoreKoinosRepoTemplatesForRefresh(settings)
      if (restoreTemplatesResult) refreshSteps.push(restoreTemplatesResult)
      const fetchResult = await runCommand('git', ['-C', repoPath, 'fetch', '--all', '--prune'], {
        cwd: repoPath
      })
      if (fetchResult.output) refreshSteps.push(fetchResult.output)
      if (!fetchResult.ok) {
        return {
          ok: false,
          repoPath,
          output: refreshSteps.join('\n')
        }
      }

      const pullResult = await runCommand('git', ['-C', repoPath, 'pull', '--ff-only'], {
        cwd: repoPath
      })
      if (pullResult.output) refreshSteps.push(pullResult.output)
      const renameNotes = ensureKoinosRepoRenamedFiles(settings)
      if (renameNotes) refreshSteps.push(renameNotes)
      return {
        ok: pullResult.ok,
        repoPath,
        output:
          refreshSteps.join('\n').trim() ||
          (pullResult.ok
            ? `Refreshed Koinos repo in ${repoPath}`
            : `No se pudo refrescar el repo de Koinos en ${repoPath}`)
      }
    }

    const existingEntries = fs.readdirSync(repoPath)
    if (existingEntries.length > 0) {
      return {
        ok: false,
        repoPath,
        output: `La carpeta destino ya existe y no esta vacia: ${repoPath}`
      }
    }
  } else {
    fs.mkdirSync(path.dirname(repoPath), { recursive: true })
  }

  const result = await runCommand('git', ['clone', KOINOS_GIT_CLONE_URL, repoPath], {
    cwd: path.dirname(repoPath)
  })

  const renameNotes = result.ok ? ensureKoinosRepoRenamedFiles(settings) : ''
  const output = [result.output, renameNotes]
    .filter(Boolean)
    .join('\n')
    .trim() || (result.ok ? `Cloned ${KOINOS_GIT_CLONE_URL} into ${repoPath}` : 'git clone failed')
  return {
    ok: result.ok,
    repoPath,
    output
  }
}

async function readKoinosManagedFile(input: KoinosNodeFileReadInput): Promise<KoinosNodeFileReadResult> {
  const settings = normalizeNodeSettings(input)
  const kind = input.kind
  const filePath = managedFilePath(settings, kind)

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return {
      ok: true,
      kind,
      filePath,
      content,
      output: `Loaded ${kind} file: ${filePath}`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : `No se pudo leer ${kind} file`
    return {
      ok: false,
      kind,
      filePath,
      content: '',
      output: message
    }
  }
}

async function writeKoinosManagedFile(input: KoinosNodeFileWriteInput): Promise<KoinosNodeFileWriteResult> {
  const settings = normalizeNodeSettings(input)
  const kind = input.kind
  const filePath = managedFilePath(settings, kind)
  const content = input.content ?? ''

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return {
      ok: true,
      kind,
      filePath,
      output: `Saved ${kind} file: ${filePath}`
    }
  } catch (error) {
    return {
      ok: false,
      kind,
      filePath,
      output: error instanceof Error ? error.message : `No se pudo guardar ${kind} file`
    }
  }
}

async function dockerComposeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  const settings = normalizeNodeSettings(input)
  assertRepoReady(settings)

  const service = input?.service?.trim() || ''
  const tail = normalizeLogsTail(input?.tail)

  const composeArgs = [...composeBaseArgs(settings), 'logs', '--tail', String(tail)]
  if (service) composeArgs.push(service)

  const result = await runCommand('docker', composeArgs, {
    cwd: settings.repoPath,
    env: composeLogsCommandEnv(settings)
  })

  return {
    ok: result.ok,
    service: service || null,
    tail,
    output: result.output
  }
}

function dockerComposeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): KoinosNodeLogsFollowStartResult {
  const settings = normalizeNodeSettings(input)
  assertRepoReady(settings)

  const service = input?.service?.trim() || ''
  const tail = normalizeLogsTail(input?.tail)

  const composeArgs = [...composeBaseArgs(settings), 'logs', '--tail', String(tail), '--follow']
  if (service) composeArgs.push(service)

  const child = spawn('docker', composeArgs, {
    cwd: settings.repoPath,
    env: { ...process.env, ...composeLogsCommandEnv(settings) },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const streamId = `logs-${Date.now()}-${++logsFollowSessionSeq}`
  const session: LogsFollowSession = {
    sender,
    service: service || null,
    tail,
    ended: false,
    stop: () => {
      if (!child.killed) {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore kill errors; process may already be gone
        }
      }
    }
  }
  logsFollowSessions.set(streamId, session)

  const onChunk = (chunk: Buffer | string) => {
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'chunk',
      chunk: String(chunk)
    })
  }

  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)

  child.on('error', (error) => {
    if (session.ended) return
    session.ended = true
    logsFollowSessions.delete(streamId)
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'error',
      message: error.message
    })
  })

  child.on('close', (code) => {
    if (session.ended) return
    session.ended = true
    logsFollowSessions.delete(streamId)
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'end',
      code
    })
  })

  sendLogsFollowEvent(sender, {
    streamId,
    type: 'start',
    service: service || null,
    tail
  })

  return {
    ok: true,
    streamId,
    service: service || null,
    tail
  }
}

function nativeAmqpHomebrewLogsFollowStart(
  sender: Electron.WebContents,
  service: string,
  tail: number,
  streamId: string
): KoinosNodeLogsFollowStartResult {
  const logFiles = nativeAmqpHomebrewLogFiles()
  if (logFiles.length === 0) {
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'start',
      service,
      tail
    })
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'end',
      code: 0
    })
    return {
      ok: true,
      streamId,
      service,
      tail
    }
  }

  const child = spawn('tail', ['-n', String(tail), '-F', ...logFiles], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const session: LogsFollowSession = {
    sender,
    service,
    tail,
    ended: false,
    stop: () => {
      if (!child.killed) {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore kill errors
        }
      }
    }
  }
  logsFollowSessions.set(streamId, session)

  const onChunk = (chunk: Buffer | string) => {
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'chunk',
      chunk: String(chunk)
    })
  }

  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)

  child.on('error', (error) => {
    if (session.ended) return
    session.ended = true
    logsFollowSessions.delete(streamId)
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'error',
      message: error.message
    })
  })

  child.on('close', (code) => {
    if (session.ended) return
    session.ended = true
    logsFollowSessions.delete(streamId)
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'end',
      code
    })
  })

  sendLogsFollowEvent(sender, {
    streamId,
    type: 'start',
    service,
    tail
  })

  return {
    ok: true,
    streamId,
    service,
    tail
  }
}

async function nativeComposeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  const settings = normalizeNodeSettings(input)
  const service = input?.service?.trim() || ''
  const tail = normalizeLogsTail(input?.tail)
  const status = await nativeComposeStatus(settings)

  if (service) {
    const serviceId = toManagedServiceId(service)
    const targetService = status.services.find((candidate) => candidate.service === service || candidate.id === serviceId)
    if (!targetService) {
      return {
        ok: false,
        service: service || null,
        tail,
        output: `Servicio no gestionado en el perfil actual: ${service}`
      }
    }

    if (serviceId === 'amqp' && nativeAmqpUsesBrewService()) {
      return {
        ok: true,
        service: targetService.service,
        tail,
        output: tailNativeAmqpHomebrewLogs(tail)
      }
    }

    if (targetService.runtimeType === 'docker') {
      return dockerComposeLogs({ ...settings, runtimeMode: 'docker', service: targetService.service, tail })
    }

    const state = nativeServiceProcesses.get(serviceId)
    return {
      ok: true,
      service: targetService.service,
      tail,
      output: tailTextLines(state?.output ?? '', tail)
    }
  }

  const output = sortManagedServiceIds(nativeServiceProcesses.keys())
    .map((serviceId) => {
      const state = nativeServiceProcesses.get(serviceId)
      if (!state?.output.trim()) return ''
      return [`== ${serviceId} ==`, tailTextLines(state.output, tail)].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')

  const amqpLogs = nativeAmqpUsesBrewService() ? tailNativeAmqpHomebrewLogs(tail) : ''

  return {
    ok: true,
    service: null,
    tail,
    output: [amqpLogs, output].filter(Boolean).join('\n\n')
  }
}

async function nativeComposeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): Promise<KoinosNodeLogsFollowStartResult> {
  const settings = normalizeNodeSettings(input)
  const service = input?.service?.trim() || ''
  const tail = normalizeLogsTail(input?.tail)
  const status = await nativeComposeStatus(settings)

  const streamId = `logs-${Date.now()}-${++logsFollowSessionSeq}`
  const serviceId = toManagedServiceId(service)
  const targetService = service
    ? status.services.find((candidate) => candidate.service === service || candidate.id === serviceId) ?? null
    : null

  if (!targetService) {
    return {
      ok: false,
      streamId,
      service: service || null,
      tail,
      output: `Servicio no gestionado en el perfil actual: ${service || '(vacio)'}`
    }
  }

  if (targetService.runtimeType === 'docker') {
    return dockerComposeLogsFollowStart(sender, { ...settings, runtimeMode: 'docker', service: targetService.service, tail })
  }

  if (targetService.id === 'amqp' && nativeAmqpUsesBrewService()) {
    return nativeAmqpHomebrewLogsFollowStart(sender, targetService.service, tail, streamId)
  }

  const nativeServiceId = targetService.id
  const session: LogsFollowSession = {
    sender,
    service: targetService.service,
    tail,
    ended: false,
    stop: () => {
      const streamIds = nativeLogsStreamIdsByService.get(nativeServiceId)
      if (!streamIds) return
      streamIds.delete(streamId)
      if (streamIds.size === 0) nativeLogsStreamIdsByService.delete(nativeServiceId)
    }
  }
  logsFollowSessions.set(streamId, session)

  const streamIds = nativeLogsStreamIdsByService.get(nativeServiceId) ?? new Set<string>()
  streamIds.add(streamId)
  nativeLogsStreamIdsByService.set(nativeServiceId, streamIds)

  sendLogsFollowEvent(sender, {
    streamId,
    type: 'start',
    service: targetService.service,
    tail
  })

  const state = nativeServiceProcesses.get(nativeServiceId)
  const initialChunk = tailTextLines(state?.output ?? '', tail)
  if (initialChunk) {
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'chunk',
      chunk: `${initialChunk}\n`
    })
  }

  if (!state || state.closed) {
    stopLogsFollowStream(streamId)
    sendLogsFollowEvent(sender, {
      streamId,
      type: 'end',
      code: state?.exitCode ?? 0
    })
  }

  return {
    ok: true,
    streamId,
    service: targetService.service,
    tail
  }
}

async function koinosNodeStatus(input?: KoinosNodeSettingsInput): Promise<KoinosNodeStatus> {
  const settings = normalizeNodeSettings(input)
  return settings.runtimeMode === 'native' ? nativeComposeStatus(settings) : dockerComposeStatus(settings)
}

async function koinosNodeAction(
  action: 'start' | 'stop',
  input?: KoinosNodeSettingsInput
): Promise<KoinosNodeCommandResult> {
  const settings = normalizeNodeSettings(input)
  return settings.runtimeMode === 'native'
    ? nativeComposeAction(action, settings)
    : dockerComposeAction(action, settings)
}

async function koinosNodeServiceAction(
  action: 'start' | 'stop' | 'restart' | 'kill-conflict',
  input?: KoinosNodeServiceCommandInput
): Promise<KoinosNodeServiceCommandResult> {
  const runtimeMode = normalizeNodeSettings(input).runtimeMode
  return runtimeMode === 'native'
    ? nativeComposeServiceAction(action, input)
    : dockerComposeServiceAction(action, input)
}

async function koinosNodePresetReconcile(
  input?: KoinosNodePresetCommandInput
): Promise<KoinosNodePresetCommandResult> {
  const runtimeMode = normalizeNodeSettings(input).runtimeMode
  return runtimeMode === 'native'
    ? nativeComposePresetReconcile(input)
    : dockerComposePresetReconcile(input)
}

async function koinosNodeRestoreBackup(input?: KoinosNodeSettingsInput): Promise<KoinosNodeBackupRestoreResult> {
  const settings = normalizeNodeSettings(input)
  const repoRenameNotes = ensureKoinosRepoRenamedFiles(settings)
  const notes = repoRenameNotes ? [repoRenameNotes] : []

  try {
    assertRepoReady(settings)
    const backupUrl = normalizeBlockchainBackupArchiveUrl(settings.blockchainBackupUrl)
    const stopResult =
      settings.runtimeMode === 'native' ? await nativeComposeAction('stop', input) : await dockerComposeAction('stop', input)

    if (stopResult.output) notes.push(stopResult.output)
    if (!stopResult.ok) {
      return {
        ok: false,
        action: 'restore-backup',
        output: [...notes, 'No se pudo detener el nodo antes de restaurar el backup'].filter(Boolean).join('\n'),
        status: stopResult.status
      }
    }

    const configPrep = ensureKoinosConfigFiles(settings)
    if (configPrep.output) notes.push(configPrep.output)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-blockchain-backup-'))
    const extractDir = path.join(tempDir, 'extract')

    try {
      notes.push(`Restoring blockchain backup from ${backupUrl}`)
      const extractResult = await downloadAndExtractBlockchainBackup(backupUrl, extractDir)
      if (!extractResult.ok) {
        return {
          ok: false,
          action: 'restore-backup',
          output: [...notes, extractResult.output || 'No se pudo descargar o extraer el backup'].filter(Boolean).join('\n'),
          status: await koinosNodeStatus(settings)
        }
      }

      const payloadRoot = findBlockchainBackupPayloadRoot(extractDir)
      if (!payloadRoot) {
        return {
          ok: false,
          action: 'restore-backup',
          output: [
            ...notes,
            `El backup no contiene los directorios esperados (${BLOCKCHAIN_BACKUP_RESTORE_DIRS.join(', ')})`
          ]
            .filter(Boolean)
            .join('\n'),
          status: await koinosNodeStatus(settings)
        }
      }

      const restoredDirs = restoreBlockchainBackupPayload(payloadRoot, settings)
      notes.push(`Restored blockchain state: ${restoredDirs.join(', ')}`)
      notes.push(`Cleared runtime state: ${BLOCKCHAIN_BACKUP_RESET_DIRS.join(', ')}`)
      notes.push(ensureBaseDirKoinosRuntimeFiles(settings))

      const status = await koinosNodeStatus(settings)
      return {
        ok: true,
        action: 'restore-backup',
        output: notes.filter(Boolean).join('\n'),
        status
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    return {
      ok: false,
      action: 'restore-backup',
      output: [...notes, error instanceof Error ? error.message : 'No se pudo restaurar el backup blockchain']
        .filter(Boolean)
        .join('\n'),
      status: await koinosNodeStatus(settings)
    }
  }
}

async function koinosJsonRpcProxy(input?: KoinosJsonRpcProxyInput): Promise<KoinosJsonRpcProxyResult> {
  const rpcUrl = input?.rpcUrl?.trim() || ''
  const method = input?.method?.trim() || ''
  const params = input?.params ?? {}

  if (!rpcUrl) {
    return {
      ok: false,
      method,
      output: 'Parametro rpcUrl invalido'
    }
  }

  if (!method) {
    return {
      ok: false,
      method: '',
      output: 'Parametro method invalido'
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        return {
          ok: false,
          method,
          output: `RPC HTTP ${response.status}`
        }
      }

      const payload = (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } }
      if (payload.error) {
        return {
          ok: false,
          method,
          output:
            typeof payload.error.data === 'string' && payload.error.data
              ? `${payload.error.message || 'RPC error'}: ${payload.error.data}`
              : payload.error.message || 'RPC error'
        }
      }

      return {
        ok: true,
        method,
        result: payload.result,
        output: ''
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RPC request failed'
    return {
      ok: false,
      method,
      output: message
    }
  }
}

async function koinosNodeLogs(input?: KoinosNodeLogsInput): Promise<KoinosNodeLogsResult> {
  const runtimeMode = normalizeNodeSettings(input).runtimeMode
  return runtimeMode === 'native' ? nativeComposeLogs(input) : dockerComposeLogs(input)
}

async function koinosNodeLogsFollowStart(
  sender: Electron.WebContents,
  input?: KoinosNodeLogsFollowStartInput
): Promise<KoinosNodeLogsFollowStartResult> {
  const runtimeMode = normalizeNodeSettings(input).runtimeMode
  return runtimeMode === 'native'
    ? nativeComposeLogsFollowStart(sender, input)
    : Promise.resolve(dockerComposeLogsFollowStart(sender, input))
}

function registerIpcHandlers() {
  const handlers = [
    'knodel:koinos-node:defaults',
    'knodel:koinos-node:clone-repo',
    'knodel:koinos-node:file-read',
    'knodel:koinos-node:file-write',
    'knodel:koinos-node:status',
    'knodel:koinos-node:presets',
    'knodel:koinos-node:native-builds',
    'knodel:koinos-node:native-build-all',
    'knodel:koinos-node:native-build-service',
    'knodel:koinos-node:start',
    'knodel:koinos-node:stop',
    'knodel:koinos-node:restore-backup',
    'knodel:koinos-node:rpc-call',
    'knodel:koinos-node:service-start',
    'knodel:koinos-node:service-stop',
    'knodel:koinos-node:service-restart',
    'knodel:koinos-node:preset-reconcile',
    'knodel:koinos-node:logs',
    'knodel:koinos-node:logs-follow-start',
    'knodel:koinos-node:logs-follow-stop'
  ] as const
  for (const channel of handlers) ipcMain.removeHandler(channel)

  ipcMain.handle('knodel:koinos-node:defaults', () => {
    const defaults = normalizeNodeSettings()
    return {
      ...defaults,
      composeFile: composeFilePath(defaults),
      envFile: envFilePath(defaults)
    }
  })

  ipcMain.handle('knodel:koinos-node:clone-repo', async (_event, input?: KoinosNodeSettingsInput) => {
    return cloneKoinosRepo(input)
  })

  ipcMain.handle('knodel:koinos-node:file-read', async (_event, input?: KoinosNodeFileReadInput) => {
    if (!input?.kind || (input.kind !== 'compose' && input.kind !== 'env' && input.kind !== 'config')) {
      return {
        ok: false,
        kind: 'compose',
        filePath: '',
        content: '',
        output: 'Parametro kind invalido'
      } satisfies KoinosNodeFileReadResult
    }
    return readKoinosManagedFile(input)
  })

  ipcMain.handle('knodel:koinos-node:file-write', async (_event, input?: KoinosNodeFileWriteInput) => {
    if (!input?.kind || (input.kind !== 'compose' && input.kind !== 'env' && input.kind !== 'config')) {
      return {
        ok: false,
        kind: 'compose',
        filePath: '',
        output: 'Parametro kind invalido'
      } satisfies KoinosNodeFileWriteResult
    }
    return writeKoinosManagedFile(input)
  })

  ipcMain.handle('knodel:koinos-node:status', async (_event, input?: KoinosNodeSettingsInput) => {
    return koinosNodeStatus(input)
  })

  ipcMain.handle('knodel:koinos-node:presets', async (_event, input?: KoinosNodeSettingsInput) => {
    return dockerComposePresets(input)
  })

  ipcMain.handle('knodel:koinos-node:native-builds', async () => {
    return nativeBuildStatus()
  })

  ipcMain.handle('knodel:koinos-node:native-build-all', async () => {
    return nativeBuildAll()
  })

  ipcMain.handle('knodel:koinos-node:native-build-service', async (_event, input?: KoinosNodeNativeBuildCommandInput) => {
    return nativeBuildServiceAction(input)
  })

  ipcMain.handle('knodel:koinos-node:start', async (_event, input?: KoinosNodeSettingsInput) => {
    return koinosNodeAction('start', input)
  })

  ipcMain.handle('knodel:koinos-node:stop', async (_event, input?: KoinosNodeSettingsInput) => {
    return koinosNodeAction('stop', input)
  })

  ipcMain.handle('knodel:koinos-node:restore-backup', async (_event, input?: KoinosNodeSettingsInput) => {
    return koinosNodeRestoreBackup(input)
  })

  ipcMain.handle('knodel:koinos-node:rpc-call', async (_event, input?: KoinosJsonRpcProxyInput) => {
    return koinosJsonRpcProxy(input)
  })

  ipcMain.handle('knodel:koinos-node:service-start', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return koinosNodeServiceAction('start', input)
  })

  ipcMain.handle('knodel:koinos-node:service-stop', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return koinosNodeServiceAction('stop', input)
  })

  ipcMain.handle('knodel:koinos-node:service-restart', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return koinosNodeServiceAction('restart', input)
  })

  ipcMain.handle('knodel:koinos-node:service-kill-conflict', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return koinosNodeServiceAction('kill-conflict', input)
  })

  ipcMain.handle('knodel:koinos-node:preset-reconcile', async (_event, input?: KoinosNodePresetCommandInput) => {
    return koinosNodePresetReconcile(input)
  })

  ipcMain.handle('knodel:koinos-node:logs', async (_event, input?: KoinosNodeLogsInput) => {
    return koinosNodeLogs(input)
  })

  ipcMain.handle(
    'knodel:koinos-node:logs-follow-start',
    async (event, input?: KoinosNodeLogsFollowStartInput) => {
      return koinosNodeLogsFollowStart(event.sender, input)
    }
  )

  ipcMain.handle('knodel:koinos-node:logs-follow-stop', async (_event, input?: KoinosNodeLogsFollowStopInput) => {
    const streamId = input?.streamId?.trim() || ''
    if (!streamId) return { ok: false, streamId: null }
    return stopLogsFollowStream(streamId)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function terminateNativeRuntimeProcesses(): void {
  for (const state of nativeServiceProcesses.values()) {
    if (state.closed) continue
    state.stopRequested = true
    try {
      state.child.kill('SIGTERM')
    } catch {
      // ignore shutdown errors
    }
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  for (const streamId of [...logsFollowSessions.keys()]) {
    stopLogsFollowStream(streamId)
  }
  terminateNativeRuntimeProcesses()
})

app.on('window-all-closed', () => {
  for (const streamId of [...logsFollowSessions.keys()]) {
    stopLogsFollowStream(streamId)
  }
  terminateNativeRuntimeProcesses()
  if (process.platform !== 'darwin') app.quit()
})
