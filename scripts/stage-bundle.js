#!/usr/bin/env node
// ============================================================================
// Stage Bundle for Installer (Cross-Platform)
// ============================================================================
// Collects monolith release artifacts into build/bundle-staging/teleno/ for
// electron-builder to bundle as extraResources.
//
// Supports Windows (.exe, build-win/) and macOS/Linux (no ext, build/).
//
// Usage: node scripts/stage-bundle.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'koinos');
const NODE_DIR = path.join(ROOT, 'node', 'teleno-node');
const STAGING = path.join(ROOT, 'build', 'bundle-staging', 'teleno');
const BIN_DIR = path.join(STAGING, 'bin');
const CONFIG_DIR = path.join(STAGING, 'config');
const ABI_DIR = path.join(STAGING, 'abis');

// Platform detection
const isWindows = process.platform === 'win32';
const EXT = isWindows ? '.exe' : '';
const CPP_BUILD_DIR = isWindows ? 'build-win' : 'build';

let passed = 0;
let failed = 0;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileChecked(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.error(`  MISS: ${label} — ${src}`);
    failed++;
    return false;
  }
  fs.copyFileSync(src, dest);
  const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`  OK:   ${label} (${sizeMB} MB)`);
  passed++;
  return true;
}

function copyFirstExistingChecked(sources, dest, label) {
  for (const src of sources) {
    if (fs.existsSync(src)) {
      return copyFileChecked(src, dest, label);
    }
  }

  console.error(`  MISS: ${label}`);
  for (const src of sources) {
    console.error(`        checked ${src}`);
  }
  failed++;
  return false;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

// ============================================================================
// Main
// ============================================================================

const platformLabel = isWindows ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';

console.log('============================================================================');
console.log(`Staging Koinos One monolith bundle for ${platformLabel} installer`);
console.log(`  Platform: ${platformLabel} (ext: "${EXT}", cpp build dir: ${CPP_BUILD_DIR})`);
console.log(`  Node:     ${NODE_DIR}`);
console.log(`  Vendor:   ${VENDOR}`);
console.log(`  Staging:  ${STAGING}`);
console.log('============================================================================\n');

// Clean and create staging directory
if (fs.existsSync(STAGING)) {
  fs.rmSync(STAGING, { recursive: true });
}
ensureDir(BIN_DIR);
ensureDir(CONFIG_DIR);
ensureDir(ABI_DIR);

// --- Monolithic Koinos One node ---
console.log('=== Monolithic Koinos One Node ===');
copyFirstExistingChecked(
  [
    path.join(NODE_DIR, CPP_BUILD_DIR, 'teleno_node' + EXT),
    path.join(NODE_DIR, CPP_BUILD_DIR, 'src', 'teleno_node' + EXT),
  ],
  path.join(BIN_DIR, 'teleno_node' + EXT),
  'teleno_node'
);

// --- Config templates ---
console.log('\n=== Config Templates ===');
const configSrc = path.join(VENDOR, 'koinos', 'config-example');
if (fs.existsSync(configSrc)) {
  copyDirRecursive(configSrc, CONFIG_DIR);
  console.log(`  OK:   config-example`);
  passed++;
} else {
  console.error(`  MISS: config-example — ${configSrc}`);
  failed++;
}

// Also copy harbinger (testnet) config if available
const harbingerSrc = path.join(VENDOR, 'koinos', 'harbinger', 'config-example');
if (fs.existsSync(harbingerSrc)) {
  const harbingerDest = path.join(STAGING, 'config-harbinger');
  ensureDir(harbingerDest);
  copyDirRecursive(harbingerSrc, harbingerDest);
  console.log(`  OK:   config-harbinger (testnet)`);
  passed++;
}

// Copy Koinos One config resources such as public bootstrap verification keys.
const telenoConfigSrc = path.join(ROOT, 'config');
if (fs.existsSync(telenoConfigSrc)) {
  copyDirRecursive(telenoConfigSrc, CONFIG_DIR);
  console.log(`  OK:   teleno config resources`);
  passed++;
}

// --- Core contract ABIs ---
console.log('\n=== Core Contract ABIs ===');
copyFileChecked(
  path.join(VENDOR, 'koinos-contracts-as', 'contracts', 'koin', 'abi', 'koin.abi'),
  path.join(ABI_DIR, 'koin.abi'),
  'koin.abi'
);
copyFileChecked(
  path.join(VENDOR, 'koinos-contracts-as', 'contracts', 'vhp', 'abi', 'vhp.abi'),
  path.join(ABI_DIR, 'vhp.abi'),
  'vhp.abi'
);
copyFileChecked(
  path.join(VENDOR, 'koinos-contracts-as', 'contracts', 'pob', 'abi', 'pob.abi'),
  path.join(ABI_DIR, 'pob.abi'),
  'pob.abi'
);

// --- Summary ---
console.log('\n============================================================================');
console.log(`Staging complete: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log(`\nWARNING: Some artifacts are missing. The installer will be incomplete.`);
  if (isWindows) {
    console.log('Build teleno_node.exe into node\\teleno-node\\build-win\\ before staging.');
  } else {
    console.log('Build the monolith first: ./scripts/build-cpp-libp2p-koinos.sh');
  }
}

// List staging directory sizes
console.log('\nStaging directory contents:');
for (const entry of fs.readdirSync(STAGING, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const dirSize = getDirSize(path.join(STAGING, entry.name));
    console.log(`  ${entry.name}/  (${(dirSize / (1024 * 1024)).toFixed(1)} MB)`);
  }
}

const totalSize = getDirSize(STAGING);
console.log(`\n  Total: ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);
console.log('============================================================================');

process.exit(failed > 0 ? 1 : 0);

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}
