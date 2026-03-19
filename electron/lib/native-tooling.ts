import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isWindows, isDarwin, isAppleSilicon, executableExtension, findExecutableInPath as findInPath, homebrewPrefix } from './platform'
import { resolveDefaultKoinosSourceRoot, isPackagedBuild, resolveKoinosBinRoot, resolveKoinosRestRoot } from './constants'

export type NativeBuildSystem = 'cmake' | 'go' | 'yarn'

export type NativeServiceBuildDefinition = {
  serviceId: string
  repoPath: string
  buildSystem: NativeBuildSystem
  artifactPath: string
  buildCommands: string[]
  buildTarget?: string
  goPackage?: string
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

export function nativeServiceBuildDefinitions(sourceRoot = resolveDefaultKoinosSourceRoot()): NativeServiceBuildDefinition[] {
  const ext = executableExtension()

  // In packaged mode, all binaries live in a flat bin/ directory
  if (isPackagedBuild()) {
    const binRoot = resolveKoinosBinRoot()
    const restRoot = resolveKoinosRestRoot()
    return [
      { serviceId: 'chain', repoPath: binRoot, buildSystem: 'cmake', artifactPath: path.join(binRoot, 'koinos_chain' + ext), buildCommands: [] },
      { serviceId: 'mempool', repoPath: binRoot, buildSystem: 'cmake', artifactPath: path.join(binRoot, 'koinos_mempool' + ext), buildCommands: [] },
      { serviceId: 'block_store', repoPath: binRoot, buildSystem: 'go', artifactPath: path.join(binRoot, 'koinos-block-store' + ext), buildCommands: [] },
      { serviceId: 'p2p', repoPath: binRoot, buildSystem: 'go', artifactPath: path.join(binRoot, 'koinos-p2p' + ext), buildCommands: [] },
      { serviceId: 'block_producer', repoPath: binRoot, buildSystem: 'cmake', artifactPath: path.join(binRoot, 'koinos_block_producer' + ext), buildCommands: [] },
      { serviceId: 'jsonrpc', repoPath: binRoot, buildSystem: 'go', artifactPath: path.join(binRoot, 'koinos-jsonrpc' + ext), buildCommands: [] },
      { serviceId: 'grpc', repoPath: binRoot, buildSystem: 'cmake', artifactPath: path.join(binRoot, 'koinos_grpc' + ext), buildCommands: [] },
      { serviceId: 'transaction_store', repoPath: binRoot, buildSystem: 'go', artifactPath: path.join(binRoot, 'koinos-transaction-store' + ext), buildCommands: [] },
      { serviceId: 'contract_meta_store', repoPath: binRoot, buildSystem: 'go', artifactPath: path.join(binRoot, 'koinos-contract-meta-store' + ext), buildCommands: [] },
      { serviceId: 'account_history', repoPath: binRoot, buildSystem: 'cmake', artifactPath: path.join(binRoot, 'koinos_account_history' + ext), buildCommands: [] },
      { serviceId: 'rest', repoPath: restRoot, buildSystem: 'yarn', artifactPath: path.join(restRoot, 'server.js'), buildCommands: [] }
    ]
  }

  // On Windows, C++ builds are in build-win/src/ and Go builds are at repo root
  const cmakeBuildDir = isWindows() ? 'build-win' : 'build'
  const goBinPath = (svcDir: string, svcName: string) =>
    isWindows()
      ? path.join(sourceRoot, svcDir, svcName + ext)
      : path.join(sourceRoot, svcDir, 'build', 'bin', svcName + ext)

  return [
    {
      serviceId: 'chain',
      repoPath: path.join(sourceRoot, 'koinos-chain'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-chain', cmakeBuildDir, 'src', 'koinos_chain' + ext),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'mempool',
      repoPath: path.join(sourceRoot, 'koinos-mempool'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-mempool', cmakeBuildDir, 'src', 'koinos_mempool' + ext),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'block_store',
      repoPath: path.join(sourceRoot, 'koinos-block-store'),
      buildSystem: 'go',
      artifactPath: goBinPath('koinos-block-store', 'koinos-block-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-block-store' + ext + ' ./cmd/koinos-block-store'],
      goPackage: './cmd/koinos-block-store'
    },
    {
      serviceId: 'p2p',
      repoPath: path.join(sourceRoot, 'koinos-p2p'),
      buildSystem: 'go',
      artifactPath: goBinPath('koinos-p2p', 'koinos-p2p'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-p2p' + ext + ' ./cmd/koinos-p2p'],
      goPackage: './cmd/koinos-p2p'
    },
    {
      serviceId: 'block_producer',
      repoPath: path.join(sourceRoot, 'koinos-block-producer'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-block-producer', cmakeBuildDir, 'src', 'koinos_block_producer' + ext),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'jsonrpc',
      repoPath: path.join(sourceRoot, 'koinos-jsonrpc'),
      buildSystem: 'go',
      artifactPath: goBinPath('koinos-jsonrpc', 'koinos-jsonrpc'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-jsonrpc' + ext + ' ./cmd/koinos-jsonrpc'],
      goPackage: './cmd/koinos-jsonrpc'
    },
    {
      serviceId: 'grpc',
      repoPath: path.join(sourceRoot, 'koinos-grpc'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-grpc', cmakeBuildDir, 'src', 'koinos_grpc' + ext),
      buildCommands: [nativeCmakeConfigureCommand(), nativeCmakeBuildCommand()]
    },
    {
      serviceId: 'transaction_store',
      repoPath: path.join(sourceRoot, 'koinos-transaction-store'),
      buildSystem: 'go',
      artifactPath: goBinPath('koinos-transaction-store', 'koinos-transaction-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-transaction-store' + ext + ' ./cmd/koinos-transaction-store'],
      goPackage: './cmd/koinos-transaction-store'
    },
    {
      serviceId: 'contract_meta_store',
      repoPath: path.join(sourceRoot, 'koinos-contract-meta-store'),
      buildSystem: 'go',
      artifactPath: goBinPath('koinos-contract-meta-store', 'koinos-contract-meta-store'),
      buildCommands: ['CGO_ENABLED=0 go build -o build/bin/koinos-contract-meta-store' + ext + ' ./cmd/koinos-contract-meta-store'],
      goPackage: './cmd/koinos-contract-meta-store'
    },
    {
      serviceId: 'account_history',
      repoPath: path.join(sourceRoot, 'koinos-account-history'),
      buildSystem: 'cmake',
      artifactPath: path.join(sourceRoot, 'koinos-account-history', cmakeBuildDir, 'src', 'koinos_account_history' + ext),
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

export function nativeServiceBuildDefinitionMap(sourceRoot = resolveDefaultKoinosSourceRoot()): Map<string, NativeServiceBuildDefinition> {
  return new Map(nativeServiceBuildDefinitions(sourceRoot).map((definition) => [definition.serviceId, definition] as const))
}
