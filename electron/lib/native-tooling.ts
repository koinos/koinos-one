import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isWindows, isDarwin, isAppleSilicon, executableExtension, findExecutableInPath as findInPath, homebrewPrefix } from './platform'
import { isPackagedBuild, resolveKoinosBinRoot, resolveMonolithBinaryPath, resolveTelenoNodeSourceRoot } from './constants'

export type NativeBuildSystem = 'cmake' | 'go' | 'yarn'

export type NativeServiceBuildDefinition = {
  serviceId: string
  repoPath: string
  buildSystem: NativeBuildSystem
  artifactPath: string
  buildCommands: string[]
  buildTarget?: string
  goPackage?: string
  cmakeConfigureArgs?: string[]
  cmakeBuildArgs?: string[]
  cmakeBuildDir?: string
}

/** Re-export for backwards compatibility */
export const findExecutableInPath = findInPath

export function nativeCmakeExecutable(): string {
  if (isDarwin()) {
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
    const prefix = homebrewPrefix()
    const homebrewCmake = prefix ? path.join(prefix, 'bin', 'cmake') : null
    if (isAppleSilicon()) {
      if (fs.existsSync(pythonUniversalCmake)) return pythonUniversalCmake
      if (homebrewCmake && fs.existsSync(homebrewCmake)) return homebrewCmake
    }
  }
  return 'cmake'
}

export function nativeGitExecutable(): string {
  if (isDarwin()) {
    const systemGit = '/usr/bin/git'
    if (fs.existsSync(systemGit)) return systemGit
  }
  return 'git'
}

export function nativeRabbitmqServerExecutable(): string | null {
  if (isWindows()) {
    const commonPaths = [
      path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'RabbitMQ Server', 'rabbitmq_server-*', 'sbin', 'rabbitmq-server.bat'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'RabbitMQ Server', 'rabbitmq_server-*', 'sbin', 'rabbitmq-server.bat')
    ]
    for (const pattern of commonPaths) {
      const dir = path.dirname(pattern)
      const parentDir = path.dirname(dir)
      if (fs.existsSync(parentDir)) {
        try {
          const entries = fs.readdirSync(path.dirname(parentDir))
          for (const entry of entries) {
            const candidate = path.join(path.dirname(parentDir), entry, 'sbin', 'rabbitmq-server.bat')
            if (fs.existsSync(candidate)) return candidate
          }
        } catch {
          // ignore
        }
      }
    }
    return findInPath('rabbitmq-server.bat') ?? findInPath('rabbitmq-server')
  }
  return findInPath('rabbitmq-server')
}

export function nativeRabbitmqCtlExecutable(): string | null {
  if (isWindows()) {
    const commonPaths = [
      path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'RabbitMQ Server'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'RabbitMQ Server')
    ]
    for (const baseDir of commonPaths) {
      if (fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir)
          for (const entry of entries) {
            const candidate = path.join(baseDir, entry, 'sbin', 'rabbitmqctl.bat')
            if (fs.existsSync(candidate)) return candidate
          }
        } catch {
          // ignore
        }
      }
    }
    return findInPath('rabbitmqctl.bat') ?? findInPath('rabbitmqctl')
  }
  return findInPath('rabbitmqctl')
}

export function nativeRabbitmqHomebrewPrefix(): string | null {
  const serverExecutable = nativeRabbitmqServerExecutable()
  if (serverExecutable) {
    const prefix = path.dirname(path.dirname(serverExecutable))
    if (fs.existsSync(prefix)) return prefix
  }

  return homebrewPrefix()
}

export function nativeRabbitmqOptPrefix(): string | null {
  const hbPrefix = nativeRabbitmqHomebrewPrefix()
  if (!hbPrefix) return null

  const optPrefix = path.join(hbPrefix, 'opt', 'rabbitmq')
  return fs.existsSync(optPrefix) ? optPrefix : null
}

export function uniquePathValue(entries: Array<string | null | undefined>): string {
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

export function nativeCmakeConfigureArgs(buildDir = 'build'): string[] {
  const args = ['-S', '.', '-B', buildDir, '-D', 'CMAKE_BUILD_TYPE=Release', '-D', 'CMAKE_POLICY_VERSION_MINIMUM=3.5']

  if (isWindows()) {
    args.push('-G', 'MinGW Makefiles')
    const vcpkgRoot = process.env.VCPKG_ROOT
    if (vcpkgRoot) {
      const toolchainFile = path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake')
      args.push('-D', `CMAKE_TOOLCHAIN_FILE=${toolchainFile}`)
    }
  }

  if (isAppleSilicon()) {
    args.push('-D', 'CMAKE_OSX_ARCHITECTURES=arm64')
    args.push('-D', 'CMAKE_APPLE_SILICON_PROCESSOR=arm64')
  }

  const hbPrefix = homebrewPrefix()
  if (isDarwin() && hbPrefix) {
    args.push('-D', `CMAKE_PREFIX_PATH=${hbPrefix}`)
    const gmpInclude = path.join(hbPrefix, 'include')
    const gmpLibrary = path.join(hbPrefix, 'lib', 'libgmp.dylib')
    const gmpxxLibrary = path.join(hbPrefix, 'lib', 'libgmpxx.dylib')
    if (fs.existsSync(gmpInclude)) args.push('-D', `GMP_INCLUDE_DIR=${gmpInclude}`)
    if (fs.existsSync(gmpLibrary)) args.push('-D', `GMP_LIBRARY=${gmpLibrary}`)
    if (fs.existsSync(gmpxxLibrary)) args.push('-D', `GMPXX_LIBRARY=${gmpxxLibrary}`)
  }

  args.push('-D', `GIT_EXECUTABLE=${nativeGitExecutable()}`)
  return args
}

export function nativeCmakeConfigureCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), ...nativeCmakeConfigureArgs(buildDir)].join(' ')
}

export function nativeCmakeBuildCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), '--build', buildDir, '--config', 'Release', '--parallel'].join(' ')
}

function readCmakeCacheValue(cachePath: string, key: string): string | null {
  if (!fs.existsSync(cachePath)) return null

  try {
    const pattern = new RegExp(`^${key}:[^=]*=(.+)$`, 'm')
    const match = fs.readFileSync(cachePath, 'utf-8').match(pattern)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function cmakePrefixFromPackageDir(packageDir: string | null): string | null {
  if (!packageDir) return null
  const marker = `${path.sep}lib${path.sep}cmake${path.sep}`
  const index = packageDir.indexOf(marker)
  if (index < 0) return null
  const prefix = packageDir.slice(0, index)
  return fs.existsSync(prefix) ? prefix : null
}

function existingPaths(paths: Array<string | null | undefined>): string[] {
  return paths.filter((entry): entry is string => Boolean(entry && fs.existsSync(entry)))
}

function uniqueCmakePrefixPath(paths: string[]): string {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const prefix of paths) {
    const trimmed = prefix.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized.join(';')
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/[\s"'$`\\]/.test(part) ? `'${part.replace(/'/g, `'\\''`)}'` : part))
    .join(' ')
}

export function monolithCmakeConfigureArgs(sourceRoot = resolveTelenoNodeSourceRoot(), buildDir = 'build'): string[] {
  const repoPath = sourceRoot
  const cachePath = path.join(repoPath, buildDir, 'CMakeCache.txt')
  const koinosPrefix = cmakePrefixFromPackageDir(readCmakeCacheValue(cachePath, 'koinos_proto_DIR'))
  const cppLibp2pAuxPrefix =
    cmakePrefixFromPackageDir(readCmakeCacheValue(cachePath, 'soralog_DIR')) ??
    cmakePrefixFromPackageDir(readCmakeCacheValue(cachePath, 'Boost.DI_DIR'))
  const homebrew = homebrewPrefix()

  const cppLibp2pPrefix = path.join(repoPath, '.deps', 'cpp-libp2p-koinos')
  const thirdPartyInclude = path.join(repoPath, '.deps', 'cpp-libp2p-thirdparty-include')
  const shimPrefix = path.join(repoPath, 'cmake', 'shims')
  const preludePath = path.join(repoPath, 'cmake', 'cpp-libp2p-koinos-prelude.cmake')

  const fallbackKoinosPrefixes = [
    '/Volumes/external/.hunter/_Base/a20151e/caf7adb/26936b6/Install',
    path.join(os.homedir(), '.hunter', '_Base', 'a20151e', 'caf7adb', '26936b6', 'Install')
  ]
  const fallbackCppLibp2pAuxPrefixes = [
    '/Volumes/external/.hunter/_Base/15ca502/b7ec3c0/00f4bd3/Install',
    path.join(os.homedir(), '.hunter', '_Base', '15ca502', 'b7ec3c0', '00f4bd3', 'Install')
  ]

  const prefixPaths = existingPaths([
    shimPrefix,
    cppLibp2pPrefix,
    koinosPrefix,
    ...fallbackKoinosPrefixes,
    cppLibp2pAuxPrefix,
    ...fallbackCppLibp2pAuxPrefixes,
    homebrew
  ])

  const includePaths = existingPaths([koinosPrefix ? path.join(koinosPrefix, 'include') : null, thirdPartyInclude])
  const args = nativeCmakeConfigureArgs(buildDir)

  args.push('-D', 'KOINOS_ENABLE_LIBP2P=ON')
  args.push('-D', `CMAKE_PROJECT_INCLUDE=${preludePath}`)
  if (prefixPaths.length > 0) args.push('-D', `CMAKE_PREFIX_PATH=${uniqueCmakePrefixPath(prefixPaths)}`)

  const opensslRoot = existingPaths([koinosPrefix, ...fallbackKoinosPrefixes]).find((prefix) =>
    fs.existsSync(path.join(prefix, 'lib', 'cmake', 'OpenSSL'))
  )
  if (opensslRoot) args.push('-D', `OPENSSL_ROOT_DIR=${opensslRoot}`)

  const zlibRoot = existingPaths([koinosPrefix, ...fallbackKoinosPrefixes]).find(
    (prefix) => fs.existsSync(path.join(prefix, 'include', 'zlib.h')) && fs.existsSync(path.join(prefix, 'lib', 'libz.a'))
  )
  if (zlibRoot) {
    args.push('-D', `ZLIB_INCLUDE_DIR=${path.join(zlibRoot, 'include')}`)
    args.push('-D', `ZLIB_LIBRARY=${path.join(zlibRoot, 'lib', 'libz.a')}`)
  }

  if (includePaths.length > 0) args.push('-D', `CMAKE_CXX_FLAGS=${includePaths.map((includePath) => `-I${includePath}`).join(' ')}`)
  args.push('-D', `CMAKE_RUNTIME_OUTPUT_DIRECTORY=${path.join(repoPath, buildDir)}`)

  return args
}

export function nativeServiceBuildDefinitions(sourceRoot = resolveTelenoNodeSourceRoot()): NativeServiceBuildDefinition[] {
  return [monolithBuildDefinition(sourceRoot)]
}

export function nativeServiceBuildDefinitionMap(sourceRoot = resolveTelenoNodeSourceRoot()): Map<string, NativeServiceBuildDefinition> {
  return new Map(nativeServiceBuildDefinitions(sourceRoot).map((definition) => [definition.serviceId, definition] as const))
}

/**
 * Build definition for the monolithic Teleno node binary.
 * Replaces all individual service build definitions when running in monolith mode.
 */
export function monolithBuildDefinition(sourceRoot = resolveTelenoNodeSourceRoot()): NativeServiceBuildDefinition {
  if (isPackagedBuild()) {
    return {
      serviceId: 'teleno-node',
      repoPath: resolveKoinosBinRoot(),
      buildSystem: 'cmake',
      artifactPath: resolveMonolithBinaryPath(),
      buildCommands: []
    }
  }

  const cmakeBuildDir = isWindows() ? 'build-win' : 'build'
  const configureArgs = monolithCmakeConfigureArgs(sourceRoot, cmakeBuildDir)
  const buildArgs = ['--build', cmakeBuildDir, '--config', 'Release', '--parallel']

  return {
    serviceId: 'teleno-node',
    repoPath: sourceRoot,
    buildSystem: 'cmake',
    artifactPath: path.join(sourceRoot, cmakeBuildDir, 'teleno_node' + executableExtension()),
    buildCommands: [formatCommand(nativeCmakeExecutable(), configureArgs), formatCommand(nativeCmakeExecutable(), buildArgs)],
    cmakeConfigureArgs: configureArgs,
    cmakeBuildArgs: buildArgs,
    cmakeBuildDir
  }
}
