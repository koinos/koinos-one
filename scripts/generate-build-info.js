#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'build', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'build-info.json');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const isWindows = process.platform === 'win32';
const ext = isWindows ? '.exe' : '';

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
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

function nativeNodeIdentity() {
  const candidates = [
    path.join(ROOT, 'node', 'teleno-node', isWindows ? 'build-win' : 'build', `teleno_node${ext}`),
    path.join(ROOT, 'node', 'teleno-node', isWindows ? 'build-win' : 'build', 'src', `teleno_node${ext}`),
  ];
  const binaryPath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  const stat = fs.existsSync(binaryPath) ? fs.statSync(binaryPath) : null;
  const sha256 = sha256File(binaryPath);

  return {
    binaryName: `teleno_node${ext}`,
    sha256,
    shortSha256: sha256 ? sha256.slice(0, 12) : null,
    sizeBytes: stat ? stat.size : null,
    mtime: stat ? stat.mtime.toISOString() : null,
  };
}

function releaseChannel(version) {
  const explicit = process.env.KOINOS_ONE_RELEASE_CHANNEL || process.env.TELENO_RELEASE_CHANNEL;
  if (explicit && explicit.trim()) return explicit.trim();
  const prerelease = `${version}`.split('-', 2)[1];
  if (prerelease) return prerelease.split('.', 1)[0] || prerelease;
  return 'dev';
}

const productVersion = readPackageVersion();
const gitCommit = git(['rev-parse', 'HEAD']) || null;
const gitShortCommit = git(['rev-parse', '--short=12', 'HEAD']) || null;
const gitBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || null;
const gitStatus = git(['status', '--porcelain']);

const buildInfo = {
  schemaVersion: 1,
  productVersion,
  releaseChannel: releaseChannel(productVersion),
  buildTimestamp: new Date().toISOString(),
  gitCommit,
  gitShortCommit,
  gitBranch,
  gitDirty: gitStatus === null ? null : gitStatus.length > 0,
  nativeNode: nativeNodeIdentity(),
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(buildInfo, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
