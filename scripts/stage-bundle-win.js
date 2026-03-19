#!/usr/bin/env node
// ============================================================================
// Stage Bundle for Windows Installer
// ============================================================================
// Collects all built artifacts into build/bundle-staging/koinos/ for
// electron-builder to bundle as extraResources in the NSIS installer.
//
// Usage: node scripts/stage-bundle-win.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'koinos');
const STAGING = path.join(ROOT, 'build', 'bundle-staging', 'koinos');
const BIN_DIR = path.join(STAGING, 'bin');
const REST_DIR = path.join(STAGING, 'rest');
const CONFIG_DIR = path.join(STAGING, 'config');

// Service definitions: [name, exe location relative to vendor/koinos/]
const GO_SERVICES = [
  'koinos-block-store',
  'koinos-p2p',
  'koinos-jsonrpc',
  'koinos-transaction-store',
  'koinos-contract-meta-store',
];

const CPP_SERVICES = [
  { name: 'koinos-chain',           exe: 'koinos-chain/build-win/src/koinos_chain.exe' },
  { name: 'koinos-mempool',         exe: 'koinos-mempool/build-win/src/koinos_mempool.exe' },
  { name: 'koinos-grpc',            exe: 'koinos-grpc/build-win/src/koinos_grpc.exe' },
  { name: 'koinos-block-producer',  exe: 'koinos-block-producer/build-win/src/koinos_block_producer.exe' },
  { name: 'koinos-account-history', exe: 'koinos-account-history/build-win/src/koinos_account_history.exe' },
];

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

console.log('============================================================================');
console.log('Staging Knodel bundle for Windows installer');
console.log(`  Vendor:  ${VENDOR}`);
console.log(`  Staging: ${STAGING}`);
console.log('============================================================================\n');

// Clean and create staging directory
if (fs.existsSync(STAGING)) {
  fs.rmSync(STAGING, { recursive: true });
}
ensureDir(BIN_DIR);
ensureDir(REST_DIR);
ensureDir(CONFIG_DIR);

// --- Go services ---
console.log('=== Go Services ===');
for (const svc of GO_SERVICES) {
  const src = path.join(VENDOR, svc, `${svc}.exe`);
  const dest = path.join(BIN_DIR, `${svc}.exe`);
  copyFileChecked(src, dest, svc);
}

// --- C++ services ---
console.log('\n=== C++ Services ===');
for (const svc of CPP_SERVICES) {
  const src = path.join(VENDOR, svc.exe);
  const dest = path.join(BIN_DIR, path.basename(svc.exe));
  copyFileChecked(src, dest, svc.name);
}

// --- GarageMQ (AMQP broker) ---
console.log('\n=== AMQP Broker ===');
const garagemqSrc = path.join(ROOT, 'vendor', 'amqp-broker', 'garagemq.exe');
copyFileChecked(garagemqSrc, path.join(BIN_DIR, 'garagemq.exe'), 'garagemq');
// Also copy default config
const garagemqConfigSrc = path.join(ROOT, 'vendor', 'amqp-broker', 'etc', 'config.yaml');
if (fs.existsSync(garagemqConfigSrc)) {
  const amqpConfigDir = path.join(STAGING, 'config', 'amqp');
  ensureDir(amqpConfigDir);
  fs.copyFileSync(garagemqConfigSrc, path.join(amqpConfigDir, 'garagemq.yaml'));
  console.log('  OK:   garagemq.yaml config');
  passed++;
}

// --- koinos-rest (standalone Next.js build) ---
console.log('\n=== koinos-rest (standalone) ===');
const restStandalone = path.join(VENDOR, 'koinos-rest', '.next', 'standalone');
if (fs.existsSync(restStandalone)) {
  copyDirRecursive(restStandalone, REST_DIR);
  // Also copy the static assets (.next/static/) which standalone needs
  const restStatic = path.join(VENDOR, 'koinos-rest', '.next', 'static');
  if (fs.existsSync(restStatic)) {
    copyDirRecursive(restStatic, path.join(REST_DIR, '.next', 'static'));
  }
  // Copy public/ directory if it exists
  const restPublic = path.join(VENDOR, 'koinos-rest', 'public');
  if (fs.existsSync(restPublic)) {
    copyDirRecursive(restPublic, path.join(REST_DIR, 'public'));
  }
  console.log(`  OK:   koinos-rest standalone`);
  passed++;
} else {
  console.error(`  MISS: koinos-rest standalone build — ${restStandalone}`);
  console.error('        Run "yarn build" in vendor/koinos/koinos-rest first.');
  failed++;
}

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

// --- Summary ---
console.log('\n============================================================================');
console.log(`Staging complete: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nWARNING: Some artifacts are missing. The installer will be incomplete.');
  console.log('Build all services first: scripts/build-native-win.bat all');
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
