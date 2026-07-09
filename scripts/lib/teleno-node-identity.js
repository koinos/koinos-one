const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SEMVER_WITHOUT_BUILD = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

function telenoNodeVersionFile(root = ROOT) {
  return path.join(root, 'node', 'teleno-node', 'VERSION');
}

function readTelenoNodeSemanticVersion(root = ROOT) {
  const filePath = telenoNodeVersionFile(root);
  const version = fs.readFileSync(filePath, 'utf8').trim();
  if (!SEMVER_WITHOUT_BUILD.test(version)) {
    throw new Error(`Invalid teleno_node SemVer in ${path.relative(root, filePath)}: ${version}`);
  }
  return version;
}

function telenoNodeReleaseTag(version) {
  return `teleno-node-v${version}`;
}

function releaseChannel(version, env = process.env) {
  const explicit = env.TELENO_NODE_RELEASE_CHANNEL || env.KOINOS_ONE_RELEASE_CHANNEL || env.TELENO_RELEASE_CHANNEL;
  if (explicit && explicit.trim()) return explicit.trim();
  const prerelease = `${version}`.split('-', 2)[1];
  if (prerelease) return prerelease.split('.', 1)[0] || prerelease;
  return 'dev';
}

function git(args, root = ROOT) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function telenoNodeBinaryCandidates(root = ROOT, targetPlatform = process.platform) {
  const isWindows = targetPlatform === 'win32' || targetPlatform === 'windows' || targetPlatform === 'win';
  const ext = isWindows ? '.exe' : '';
  const buildDir = isWindows ? 'build-win' : 'build';
  return [
    path.join(root, 'node', 'teleno-node', buildDir, `teleno_node${ext}`),
    path.join(root, 'node', 'teleno-node', buildDir, 'src', `teleno_node${ext}`),
  ];
}

function resolveTelenoNodeBinary(root = ROOT, targetPlatform = process.platform) {
  const candidates = telenoNodeBinaryCandidates(root, targetPlatform);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function readBinaryVersion(binaryPath) {
  if (!fs.existsSync(binaryPath) || !fs.statSync(binaryPath).isFile()) {
    return { name: null, buildVersion: null, versionOutput: null };
  }

  try {
    const versionOutput = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();
    const match = versionOutput.match(/^(\S+)\s+(.+)$/);
    return {
      name: match ? match[1] : null,
      buildVersion: match ? match[2] : null,
      versionOutput,
    };
  } catch {
    return { name: null, buildVersion: null, versionOutput: null };
  }
}

function escapeRegExp(value) {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function versionMatchesSemanticVersion(versionOutput, semanticVersion) {
  if (!versionOutput) return false;
  return new RegExp(`^teleno_node ${escapeRegExp(semanticVersion)}(?:\\+|$)`).test(versionOutput);
}

function telenoNodeIdentity(options = {}) {
  const root = options.root || ROOT;
  const targetPlatform = options.targetPlatform || process.platform;
  const semanticVersion = readTelenoNodeSemanticVersion(root);
  const binaryPath = resolveTelenoNodeBinary(root, targetPlatform);
  const stat = fs.existsSync(binaryPath) ? fs.statSync(binaryPath) : null;
  const sha256 = sha256File(binaryPath);
  const binaryVersion = readBinaryVersion(binaryPath);

  return {
    binaryName: path.basename(binaryPath),
    semanticVersion,
    releaseTag: telenoNodeReleaseTag(semanticVersion),
    buildVersion: binaryVersion.buildVersion,
    versionOutput: binaryVersion.versionOutput,
    sha256,
    shortSha256: sha256 ? sha256.slice(0, 12) : null,
    sizeBytes: stat ? stat.size : null,
    mtime: stat ? stat.mtime.toISOString() : null,
  };
}

module.exports = {
  ROOT,
  git,
  readTelenoNodeSemanticVersion,
  releaseChannel,
  resolveTelenoNodeBinary,
  telenoNodeIdentity,
  telenoNodeReleaseTag,
  versionMatchesSemanticVersion,
};
