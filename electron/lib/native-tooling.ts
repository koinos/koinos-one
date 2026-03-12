import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_KOINOS_SOURCE_ROOT } from './constants'

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

export function isAppleSiliconHost(): boolean {
  return process.platform === 'darwin' && os.arch() === 'arm64'
}

export function nativeCmakeExecutable(): string {
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

export function nativeGitExecutable(): string {
  const systemGit = '/usr/bin/git'
  return fs.existsSync(systemGit) ? systemGit : 'git'
}

export function findExecutableInPath(command: string): string | null {
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

export function nativeRabbitmqServerExecutable(): string | null {
  return findExecutableInPath('rabbitmq-server')
}

export function nativeRabbitmqCtlExecutable(): string | null {
  return findExecutableInPath('rabbitmqctl')
}

export function nativeRabbitmqHomebrewPrefix(): string | null {
  const serverExecutable = nativeRabbitmqServerExecutable()
  if (serverExecutable) {
    const prefix = path.dirname(path.dirname(serverExecutable))
    if (fs.existsSync(prefix)) return prefix
  }

  return nativeHomebrewPrefix()
}

export function nativeRabbitmqOptPrefix(): string | null {
  const homebrewPrefix = nativeRabbitmqHomebrewPrefix()
  if (!homebrewPrefix) return null

  const optPrefix = path.join(homebrewPrefix, 'opt', 'rabbitmq')
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

export function nativeHomebrewPrefix(): string | null {
  const prefix = '/opt/homebrew'
  return fs.existsSync(prefix) ? prefix : null
}

export function nativeCmakeConfigureArgs(buildDir = 'build'): string[] {
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

export function nativeCmakeConfigureCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), ...nativeCmakeConfigureArgs(buildDir)].join(' ')
}

export function nativeCmakeBuildCommand(buildDir = 'build'): string {
  return [nativeCmakeExecutable(), '--build', buildDir, '--config', 'Release', '--parallel'].join(' ')
}

export function nativeServiceBuildDefinitions(sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT): NativeServiceBuildDefinition[] {
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

export function nativeServiceBuildDefinitionMap(sourceRoot = DEFAULT_KOINOS_SOURCE_ROOT): Map<string, NativeServiceBuildDefinition> {
  return new Map(nativeServiceBuildDefinitions(sourceRoot).map((definition) => [definition.serviceId, definition] as const))
}
