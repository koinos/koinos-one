import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { TELENO_NODE_BINARY_NAME, isPackagedBuild, resolveMonolithBinaryPath } from './constants'

type NativeNodeBuildInfo = {
  binaryName: string
  version: string | null
  semanticVersion: string | null
  releaseTag: string | null
  buildVersion: string | null
  versionOutput: string | null
  sha256: string | null
  shortSha256: string | null
  sizeBytes: number | null
  mtime: string | null
}

export type KoinosOneBuildInfo = {
  schemaVersion: number
  productVersion: string
  releaseChannel: string
  buildTimestamp: string | null
  gitCommit: string | null
  gitShortCommit: string | null
  gitBranch: string | null
  gitDirty: boolean | null
  nativeNode: NativeNodeBuildInfo
  source: 'generated' | 'runtime'
}

let cachedBuildInfo: KoinosOneBuildInfo | null = null

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..')
}

function packageVersion(): string {
  try {
    return require('../../package.json').version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function buildInfoPath(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'build-info.json')
  }
  return path.join(repoRoot(), 'build', 'generated', 'build-info.json')
}

function readGeneratedBuildInfo(): Partial<KoinosOneBuildInfo> | null {
  const filePath = buildInfoPath()
  if (!fs.existsSync(filePath)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null
  } catch {
    return null
  }
}

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function nativeNodeVersionOutput(binaryPath: string): string | null {
  if (!fs.existsSync(binaryPath)) return null
  try {
    return execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null
  } catch {
    return null
  }
}

function nativeNodeBuildInfo(generated?: Partial<NativeNodeBuildInfo> | null): NativeNodeBuildInfo {
  const binaryPath = resolveMonolithBinaryPath()
  const stat = fs.existsSync(binaryPath) ? fs.statSync(binaryPath) : null
  const sha256 = sha256File(binaryPath) || generated?.sha256 || null

  // Output shape: "teleno_node <version>+<commit>[-dirty]"
  const versionOutput = nativeNodeVersionOutput(binaryPath) || generated?.versionOutput || null
  const buildVersion = versionOutput?.match(/teleno_node\s+(\S+)/i)?.[1] ?? generated?.buildVersion ?? null
  const semanticVersion = generated?.semanticVersion || buildVersion?.split('+', 1)[0] || null
  const releaseTag = generated?.releaseTag || (semanticVersion ? `teleno-node-v${semanticVersion}` : null)

  return {
    binaryName: generated?.binaryName || TELENO_NODE_BINARY_NAME,
    version: buildVersion ?? generated?.version ?? null,
    semanticVersion,
    releaseTag,
    buildVersion,
    versionOutput,
    sha256,
    shortSha256: sha256 ? sha256.slice(0, 12) : generated?.shortSha256 || null,
    sizeBytes: stat?.size ?? generated?.sizeBytes ?? null,
    mtime: stat?.mtime.toISOString() ?? generated?.mtime ?? null
  }
}

function runtimeBuildInfo(): KoinosOneBuildInfo {
  const version = packageVersion()
  const gitCommit = git(['rev-parse', 'HEAD'])
  const gitShortCommit = git(['rev-parse', '--short=12', 'HEAD'])
  const gitBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const gitStatus = git(['status', '--porcelain'])

  return {
    schemaVersion: 1,
    productVersion: version,
    releaseChannel: 'dev',
    buildTimestamp: null,
    gitCommit,
    gitShortCommit,
    gitBranch,
    gitDirty: gitStatus === null ? null : gitStatus.length > 0,
    nativeNode: nativeNodeBuildInfo(),
    source: 'runtime'
  }
}

export function loadKoinosOneBuildInfo(): KoinosOneBuildInfo {
  if (cachedBuildInfo) return cachedBuildInfo

  const generated = readGeneratedBuildInfo()
  const fallback = runtimeBuildInfo()

  cachedBuildInfo = {
    ...fallback,
    ...generated,
    schemaVersion: Number(generated?.schemaVersion) || fallback.schemaVersion,
    productVersion: `${generated?.productVersion || fallback.productVersion}`,
    releaseChannel: `${generated?.releaseChannel || fallback.releaseChannel}`,
    buildTimestamp: generated?.buildTimestamp || fallback.buildTimestamp,
    nativeNode: nativeNodeBuildInfo(generated?.nativeNode),
    source: generated ? 'generated' : 'runtime'
  }

  return cachedBuildInfo
}
