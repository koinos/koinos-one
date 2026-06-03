#!/usr/bin/env node
// Validate the staged native bundle before electron-builder packages it.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGING = path.resolve(process.env.PACKAGE_STAGING_DIR || path.join(ROOT, 'build', 'bundle-staging', 'koinos'));
const targetPlatform = (process.env.PACKAGE_TARGET_PLATFORM || process.platform).toLowerCase();
const isWindowsTarget = targetPlatform === 'win32' || targetPlatform === 'windows' || targetPlatform === 'win';
const ext = isWindowsTarget ? '.exe' : '';

const requiredBinaries = [
  'koinos_node',
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

console.log('============================================================================');
console.log('Verifying koinosGUI package staging');
console.log(`  Staging: ${STAGING}`);
console.log(`  Target:  ${targetPlatform}`);
console.log('============================================================================');

if (!fs.existsSync(STAGING) || !fs.statSync(STAGING).isDirectory()) {
  fail(`staging directory missing: ${STAGING}`);
} else {
  for (const binary of requiredBinaries) {
    requireExecutable(binary);
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
