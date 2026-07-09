#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { telenoNodeIdentity } = require('./lib/teleno-node-identity');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'build', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'build-info.json');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const isWindows = process.platform === 'win32';

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

function nativeNodeIdentity() {
  const identity = telenoNodeIdentity({
    root: ROOT,
    targetPlatform: isWindows ? 'win32' : process.platform,
  });
  return {
    ...identity,
    // Kept for existing consumers that read the parsed --version token.
    version: identity.buildVersion,
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
