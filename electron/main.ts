import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
}

type KoinosNodeSettings = {
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string[]
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
}

type ComposeResolvedServiceDefinition = {
  image: string | null
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

type KoinosNodeServiceCommandInput = KoinosNodeSettingsInput & {
  service?: string
}

type KoinosNodeServiceCommandResult = {
  ok: boolean
  action: 'start' | 'stop' | 'restart'
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
  child: ChildProcessByStdio<null, Readable, Readable>
  sender: Electron.WebContents
  service: string | null
  tail: number
  ended: boolean
}

type PlatformDescriptor = {
  architecture?: string
  os?: string
  variant?: string
}

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'
const logsFollowSessions = new Map<string, LogsFollowSession>()
let logsFollowSessionSeq = 0

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

// Native runtime is planned, but Docker remains the only active executor for now.
const ACTIVE_RUNTIME_MODE: KoinosNodeServiceRuntime = 'docker'
const AVAILABLE_RUNTIME_MODES: KoinosNodeServiceRuntime[] = ['docker']

function nativeDockerPlatform(): string | null {
  return process.platform === 'darwin' && os.arch() === 'arm64' ? 'linux/arm64' : null
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

  return {
    repoPath,
    composeFile,
    envFile,
    baseDir,
    profiles
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

  const definitions = new Map<string, ComposeServiceDefinition>()
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    const definition = serviceConfig && typeof serviceConfig === 'object' ? serviceConfig : {}
    definitions.set(serviceName, {
      profiles: normalizeComposeProfiles((definition as Record<string, unknown>).profiles),
      dependsOn: normalizeComposeDependsOn((definition as Record<string, unknown>).depends_on)
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
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<{ ok: boolean; code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      resolve({
        ok: false,
        code: null,
        output: `${stdout}${stderr}\n${error.message}`.trim()
      })
    })

    child.on('close', (code) => {
      const output = `${stdout}${stderr}`.trim()
      resolve({
        ok: code === 0,
        code,
        output
      })
    })
  })
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
  if (!session.child.killed) {
    try {
      session.child.kill('SIGTERM')
    } catch {
      // ignore kill errors; process may already be gone
    }
  }
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
      runtimeType: ACTIVE_RUNTIME_MODE,
      state: 'not created',
      status: 'Not created',
      ports: [],
      dependsOn: definition.dependsOn.map(toManagedServiceId),
      lastError: null
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
      runtimeType: ACTIVE_RUNTIME_MODE,
      state,
      status,
      ports: normalizeComposePublishers(item),
      dependsOn: (serviceDefinitions?.get(service)?.dependsOn ?? []).map(toManagedServiceId),
      lastError: deriveComposeServiceLastError(item, state, status)
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
      runtimeMode: ACTIVE_RUNTIME_MODE,
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
    runtimeMode: ACTIVE_RUNTIME_MODE,
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
        ? `Loaded ${presets.length} presets from ${composeFilePath(settings)}`
        : `No presets found in ${composeFilePath(settings)}`
    }
  } catch (error) {
    return {
      ok: false,
      presets: [],
      output: error instanceof Error ? error.message : 'No se pudieron leer los presets del compose'
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

function findRunningDependents(status: KoinosNodeStatus, serviceId: string): ComposeServiceStatus[] {
  return status.services.filter((candidate) => isComposeServiceRunning(candidate) && candidate.dependsOn.includes(serviceId))
}

async function resolvePresetOrThrow(
  settings: KoinosNodeSettings,
  presetId: string
): Promise<{ preset: KoinosNodePreset; settings: KoinosNodeSettings }> {
  const presetsResult = await dockerComposePresets(settings)
  const preset = presetsResult.presets.find((candidate) => candidate.id === presetId)
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`)
  }

  return {
    preset,
    settings: {
      ...settings,
      profiles: preset.profiles
    }
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
  action: 'start' | 'stop' | 'restart',
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
    const runningDependents = findRunningDependents(currentStatus, serviceId)
    if (runningDependents.length > 0) {
      return {
        ok: false,
        action,
        service,
        output: `No se puede detener ${service}. Servicios dependientes activos: ${runningDependents
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
      output: error instanceof Error ? error.message : 'No se pudo resolver el preset',
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
      output: `El nodo ya coincide con el preset ${preset.label}`,
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
    child,
    sender,
    service: service || null,
    tail,
    ended: false
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

function registerIpcHandlers() {
  const handlers = [
    'knodel:koinos-node:defaults',
    'knodel:koinos-node:clone-repo',
    'knodel:koinos-node:file-read',
    'knodel:koinos-node:file-write',
    'knodel:koinos-node:status',
    'knodel:koinos-node:presets',
    'knodel:koinos-node:start',
    'knodel:koinos-node:stop',
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
    return dockerComposeStatus(input)
  })

  ipcMain.handle('knodel:koinos-node:presets', async (_event, input?: KoinosNodeSettingsInput) => {
    return dockerComposePresets(input)
  })

  ipcMain.handle('knodel:koinos-node:start', async (_event, input?: KoinosNodeSettingsInput) => {
    return dockerComposeAction('start', input)
  })

  ipcMain.handle('knodel:koinos-node:stop', async (_event, input?: KoinosNodeSettingsInput) => {
    return dockerComposeAction('stop', input)
  })

  ipcMain.handle('knodel:koinos-node:service-start', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return dockerComposeServiceAction('start', input)
  })

  ipcMain.handle('knodel:koinos-node:service-stop', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return dockerComposeServiceAction('stop', input)
  })

  ipcMain.handle('knodel:koinos-node:service-restart', async (_event, input?: KoinosNodeServiceCommandInput) => {
    return dockerComposeServiceAction('restart', input)
  })

  ipcMain.handle('knodel:koinos-node:preset-reconcile', async (_event, input?: KoinosNodePresetCommandInput) => {
    return dockerComposePresetReconcile(input)
  })

  ipcMain.handle('knodel:koinos-node:logs', async (_event, input?: KoinosNodeLogsInput) => {
    return dockerComposeLogs(input)
  })

  ipcMain.handle(
    'knodel:koinos-node:logs-follow-start',
    async (event, input?: KoinosNodeLogsFollowStartInput) => {
      return dockerComposeLogsFollowStart(event.sender, input)
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

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const streamId of [...logsFollowSessions.keys()]) {
    stopLogsFollowStream(streamId)
  }
  if (process.platform !== 'darwin') app.quit()
})
