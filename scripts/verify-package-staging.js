#!/usr/bin/env node
// Validate the staged native bundle before electron-builder packages it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGING = path.resolve(process.env.PACKAGE_STAGING_DIR || path.join(ROOT, 'build', 'bundle-staging', 'teleno'));
const targetPlatform = (process.env.PACKAGE_TARGET_PLATFORM || process.platform).toLowerCase();
const isWindowsTarget = targetPlatform === 'win32' || targetPlatform === 'windows' || targetPlatform === 'win';
const isMacTarget = targetPlatform === 'darwin' || targetPlatform === 'mac' || targetPlatform === 'macos';
const ext = isWindowsTarget ? '.exe' : '';

const requiredBinaries = [
  'teleno_node',
].map((name) => path.join('bin', `${name}${ext}`));

const requiredFiles = [
  ...requiredBinaries,
  path.join('config', 'config.yml'),
  path.join('config', 'genesis_data.json'),
  path.join('config', 'koinos_descriptors.pb'),
];

const optionalGroups = [
  {
    name: 'config-harbinger',
    marker: path.join('config-harbinger'),
    files: [
      path.join('config-harbinger', 'config.yml'),
      path.join('config-harbinger', 'genesis_data.json'),
      path.join('config-harbinger', 'koinos_descriptors.pb'),
    ],
  },
];

const requiredBackupFlags = [
  '--backup-dry-run',
  '--backup-create',
  '--backup-list',
  '--backup-restore',
  '--backup-restore-preflight',
  '--backup-id',
  '--backup-json',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function requireFile(relativePath) {
  const absolutePath = path.join(STAGING, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`missing ${relativePath}`);
    return;
  }
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    fail(`not a file ${relativePath}`);
    return;
  }
  if (stat.size <= 0) {
    fail(`empty ${relativePath}`);
  }
}

function requireExecutable(relativePath) {
  requireFile(relativePath);
  if (isWindowsTarget) return;

  const absolutePath = path.join(STAGING, relativePath);
  if (fs.existsSync(absolutePath) && (fs.statSync(absolutePath).mode & 0o111) === 0) {
    fail(`not executable ${relativePath}`);
  }
}

function dirSizeBytes(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    size += entry.isDirectory() ? dirSizeBytes(fullPath) : fs.statSync(fullPath).size;
  }
  return size;
}

function requireNoThirdPartyDylibs(relativePath) {
  if (!isMacTarget) return;

  const absolutePath = path.join(STAGING, relativePath);
  if (!fs.existsSync(absolutePath)) return;

  let output = '';
  try {
    output = execFileSync('otool', ['-L', absolutePath], { encoding: 'utf8' });
  } catch (error) {
    fail(`failed to inspect dylibs for ${relativePath}: ${error.message}`);
    return;
  }

  const leaked = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/opt/homebrew/') || line.startsWith('/usr/local/'));
  if (leaked.length > 0) {
    fail(`third-party dylib dependency in ${relativePath}: ${leaked.join(', ')}`);
  }
}

function requireTelenoNodeBackupCli(relativePath) {
  if (isWindowsTarget) return;

  const absolutePath = path.join(STAGING, relativePath);
  if (!fs.existsSync(absolutePath)) return;

  let output = '';
  try {
    output = execFileSync(absolutePath, ['--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (error) {
    fail(`failed to inspect CLI surface for ${relativePath}: ${error.message}`);
    return;
  }

  const missingFlags = requiredBackupFlags.filter((flag) => !output.includes(flag));
  if (missingFlags.length > 0) {
    fail(`missing native backup CLI flags in ${relativePath}: ${missingFlags.join(', ')}`);
  }
}

console.log('============================================================================');
console.log('Verifying Teleno package staging');
console.log(`  Staging: ${STAGING}`);
console.log(`  Target:  ${targetPlatform}`);
console.log('============================================================================');

if (!fs.existsSync(STAGING) || !fs.statSync(STAGING).isDirectory()) {
  fail(`staging directory missing: ${STAGING}`);
} else {
  for (const binary of requiredBinaries) {
    requireExecutable(binary);
    requireNoThirdPartyDylibs(binary);
    if (path.basename(binary) === `teleno_node${ext}`) {
      requireTelenoNodeBackupCli(binary);
    }
  }

  for (const relativePath of requiredFiles.filter((entry) => !requiredBinaries.includes(entry))) {
    requireFile(relativePath);
  }

  for (const group of optionalGroups) {
    const marker = path.join(STAGING, group.marker);
    if (fs.existsSync(marker)) {
      for (const relativePath of group.files) {
        requireFile(relativePath);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('\nPackage staging verification failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

const totalSizeMb = (dirSizeBytes(STAGING) / (1024 * 1024)).toFixed(1);
console.log(`Package staging verification passed: ${requiredFiles.length} required files, ${totalSizeMb} MB total.`);
