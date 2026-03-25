import fs from 'node:fs'
import path from 'node:path'

import type { NativeServiceBuildDefinition } from './native-tooling'

type VersionCacheEntry = {
  fingerprint: string
  version: string | null
}

type RunCommandResult = {
  ok: boolean
  output: string
}

type NativeVersionResolverDeps = {
  cache: Map<string, VersionCacheEntry>
  findExecutableInPath: (command: string) => string | null
  nativeRabbitmqCtlExecutable: () => string | null
  resolveAmqpBrokerPath?: () => string
  fileExists: (filePath: string) => boolean
  runCommand: (command: string, args: string[], options: { cwd: string; timeoutMs?: number }) => Promise<RunCommandResult>
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function firstNonEmptyLine(input: string): string | null {
  for (const line of stripAnsi(input).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }

  return null
}

function normalizeDiscoveredVersion(input: string): string | null {
  const line = firstNonEmptyLine(input)
  if (!line) return null
  if (
    /^(usage:|error:|fatal:|timed out after|permission denied|spawn |fork\/exec |exec format error|bad cpu type)/i.test(
      line
    )
  ) {
    return null
  }
  return line.length > 160 ? `${line.slice(0, 157)}...` : line
}

function fileFingerprint(filePath: string | null | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null

  try {
    const stat = fs.statSync(filePath)
    return `${path.resolve(filePath)}:${stat.mtimeMs}:${stat.size}`
  } catch {
    return path.resolve(filePath)
  }
}

export function createNativeVersionResolver(deps: NativeVersionResolverDeps) {
  function getCachedServiceVersion(cacheKey: string, fingerprint: string): string | null | undefined {
    const cached = deps.cache.get(cacheKey)
    if (!cached || cached.fingerprint !== fingerprint) return undefined
    return cached.version
  }

  function setCachedServiceVersion(cacheKey: string, fingerprint: string, version: string | null): string | null {
    deps.cache.set(cacheKey, { fingerprint, version })
    return version
  }

  async function resolveVersionFromCommand(
    command: string,
    args: string[],
    cwd: string,
    fallbackArgs?: string[]
  ): Promise<string | null> {
    const primary = await deps.runCommand(command, args, { cwd, timeoutMs: 4000 })
    const primaryVersion = normalizeDiscoveredVersion(primary.output)
    if (primary.ok && primaryVersion) return primaryVersion

    if (fallbackArgs && fallbackArgs.length > 0) {
      const fallback = await deps.runCommand(command, fallbackArgs, { cwd, timeoutMs: 4000 })
      const fallbackVersion = normalizeDiscoveredVersion(fallback.output)
      if (fallback.ok && fallbackVersion) return fallbackVersion
    }

    return primaryVersion
  }

  function resolveNativeSourceDeclaredVersion(definition: NativeServiceBuildDefinition): string | null {
    if (definition.buildSystem === 'yarn') {
      const packageJsonPath = path.join(definition.repoPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) return null

      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string' && parsed.version.trim()) {
          return parsed.version.trim().startsWith('v') ? parsed.version.trim() : `v${parsed.version.trim()}`
        }
      } catch {
        return null
      }

      return null
    }

    if (definition.buildSystem === 'go') {
      const packageDir =
        definition.goPackage && definition.goPackage.startsWith('./')
          ? path.join(definition.repoPath, definition.goPackage.slice(2))
          : definition.repoPath
      const mainPath = path.join(packageDir, 'main.go')
      if (!fs.existsSync(mainPath)) return null

      const match = fs
        .readFileSync(mainPath, 'utf8')
        .match(/(?:^|\n)\s*Version\s*=\s*"([^"]+)"/m)
      return match?.[1]?.trim() || null
    }

    if (definition.buildSystem === 'cmake') {
      const cmakeListsPath = path.join(definition.repoPath, 'CMakeLists.txt')
      if (!fs.existsSync(cmakeListsPath)) return null

      const match = fs
        .readFileSync(cmakeListsPath, 'utf8')
        .match(/project\([\s\S]*?\bVERSION\s+([0-9]+\.[0-9]+\.[0-9]+)\b/m)
      return match?.[1] ? `v${match[1]}` : null
    }

    return null
  }

  async function resolveNativeBinaryVersion(definition: NativeServiceBuildDefinition): Promise<string | null> {
    const fingerprint = fileFingerprint(definition.artifactPath)
    if (!fingerprint) return resolveNativeSourceDeclaredVersion(definition)

    const cacheKey = `binary:${definition.serviceId}`
    const cached = getCachedServiceVersion(cacheKey, fingerprint)
    if (cached !== undefined) return cached

    const version =
      (await resolveVersionFromCommand(definition.artifactPath, ['--version'], definition.repoPath, ['-v'])) ||
      resolveNativeSourceDeclaredVersion(definition)
    return setCachedServiceVersion(cacheKey, fingerprint, version)
  }

  function resolveNativeRestVersion(definition: NativeServiceBuildDefinition): string | null {
    const packageJsonPath = path.join(definition.repoPath, 'package.json')
    const packageFingerprint = fileFingerprint(packageJsonPath)
    const buildFingerprint = fileFingerprint(definition.artifactPath)
    const fingerprint = [packageFingerprint, buildFingerprint].filter(Boolean).join('|')
    if (!fingerprint) return null

    const cacheKey = `rest:${definition.serviceId}`
    const cached = getCachedServiceVersion(cacheKey, fingerprint)
    if (cached !== undefined) return cached

    let packageVersion: string | null = null
    if (packageJsonPath && fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string' && parsed.version.trim()) {
          packageVersion = parsed.version.trim().startsWith('v') ? parsed.version.trim() : `v${parsed.version.trim()}`
        }
      } catch {
        packageVersion = null
      }
    }

    let buildId: string | null = null
    if (definition.artifactPath && fs.existsSync(definition.artifactPath)) {
      const value = fs.readFileSync(definition.artifactPath, 'utf8').trim()
      if (value) buildId = value
    }

    const version = packageVersion && buildId ? `${packageVersion} · build ${buildId}` : packageVersion || buildId
    return setCachedServiceVersion(cacheKey, fingerprint, version || null)
  }

  async function resolveNativeAmqpVersion(): Promise<string | null> {
    // Check for GarageMQ first (bundled AMQP broker)
    const garagemqPath = deps.resolveAmqpBrokerPath?.() ?? null
    if (garagemqPath && deps.fileExists(garagemqPath)) {
      return 'GarageMQ (bundled)'
    }

    const brewExecutable = deps.findExecutableInPath('brew')
    const rabbitmqCtl = deps.nativeRabbitmqCtlExecutable()
    const fingerprint = [fileFingerprint(brewExecutable), fileFingerprint(rabbitmqCtl)].filter(Boolean).join('|') || 'amqp:none'
    const cacheKey = 'amqp:native'
    const cached = getCachedServiceVersion(cacheKey, fingerprint)
    if (cached !== undefined) return cached

    if (brewExecutable) {
      const brewResult = await deps.runCommand(brewExecutable, ['list', '--versions', 'rabbitmq'], {
        cwd: process.cwd(),
        timeoutMs: 4000
      })
      const brewLine = firstNonEmptyLine(brewResult.output)
      const brewMatch = brewLine?.match(/^rabbitmq\s+(.+)$/i)
      if (brewResult.ok && brewMatch?.[1]) {
        return setCachedServiceVersion(cacheKey, fingerprint, `RabbitMQ ${brewMatch[1].trim()}`)
      }
    }

    if (rabbitmqCtl) {
      const version = await resolveVersionFromCommand(rabbitmqCtl, ['version'], process.cwd())
      if (version) {
        const normalized = /^rabbitmq/i.test(version) ? version : `RabbitMQ ${version}`
        return setCachedServiceVersion(cacheKey, fingerprint, normalized)
      }
    }

    return setCachedServiceVersion(cacheKey, fingerprint, null)
  }

  async function resolveNativeServiceVersion(
    serviceId: string,
    definition: NativeServiceBuildDefinition | undefined
  ): Promise<string | null> {
    if (serviceId === 'amqp') return resolveNativeAmqpVersion()
    if (!definition) return null
    if (serviceId === 'rest') return resolveNativeRestVersion(definition)
    return resolveNativeBinaryVersion(definition)
  }

  return {
    resolveNativeServiceVersion
  }
}
