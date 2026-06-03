#!/usr/bin/env node
// Validate an electron-builder output after packaging.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const targetPlatform = (process.env.PACKAGE_TARGET_PLATFORM || process.platform).toLowerCase();
const isWindowsTarget = targetPlatform === 'win32' || targetPlatform === 'windows' || targetPlatform === 'win';
const isMacTarget = targetPlatform === 'darwin' || targetPlatform === 'mac' || targetPlatform === 'macos';
const ext = isWindowsTarget ? '.exe' : '';

function defaultPackagedAppDir() {
  if (isMacTarget) {
    const archDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    return path.join(ROOT, 'release', archDir, 'koinosGUI.app');
  }
  if (isWindowsTarget) {
    return path.join(ROOT, 'release', 'win-unpacked');
  }
  return path.join(ROOT, 'release');
}

const APP_DIR = path.resolve(process.env.PACKAGED_APP_DIR || defaultPackagedAppDir());
const RESOURCES_DIR = isMacTarget ? path.join(APP_DIR, 'Contents', 'Resources') : path.join(APP_DIR, 'resources');
const APP_EXECUTABLE = isMacTarget
  ? path.join(APP_DIR, 'Contents', 'MacOS', 'koinosGUI')
  : path.join(APP_DIR, `koinosGUI${ext}`);

const requiredFiles = [
  path.join(RESOURCES_DIR, 'app.asar'),
  path.join(RESOURCES_DIR, 'koinos', 'bin', `koinos_node${ext}`),
  path.join(RESOURCES_DIR, 'koinos', 'config', 'config.yml'),
  path.join(RESOURCES_DIR, 'koinos', 'config', 'genesis_data.json'),
  path.join(RESOURCES_DIR, 'koinos', 'config', 'koinos_descriptors.pb'),
  APP_EXECUTABLE,
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing ${path.relative(ROOT, filePath)}`);
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    fail(`not a file ${path.relative(ROOT, filePath)}`);
    return;
  }
  if (stat.size <= 0) {
    fail(`empty ${path.relative(ROOT, filePath)}`);
  }
}

function requireExecutable(filePath) {
  requireFile(filePath);
  if (isWindowsTarget) return;
  if (fs.existsSync(filePath) && (fs.statSync(filePath).mode & 0o111) === 0) {
    fail(`not executable ${path.relative(ROOT, filePath)}`);
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
console.log('Verifying koinosGUI packaged app');
console.log(`  App:       ${APP_DIR}`);
console.log(`  Resources: ${RESOURCES_DIR}`);
console.log(`  Target:    ${targetPlatform}`);
console.log('============================================================================');

if (!fs.existsSync(APP_DIR) || !fs.statSync(APP_DIR).isDirectory()) {
  fail(`packaged app directory missing: ${APP_DIR}`);
} else {
  for (const filePath of requiredFiles) {
    if (filePath === APP_EXECUTABLE || filePath.endsWith(`${path.sep}koinos_node${ext}`)) {
      requireExecutable(filePath);
    } else {
      requireFile(filePath);
    }
  }
}

if (failures.length > 0) {
  console.error('\nPackaged app verification failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

const appSizeMb = (dirSizeBytes(APP_DIR) / (1024 * 1024)).toFixed(1);
const resourceSizeMb = (dirSizeBytes(path.join(RESOURCES_DIR, 'koinos')) / (1024 * 1024)).toFixed(1);
console.log(`Packaged app verification passed: ${requiredFiles.length} required files, app ${appSizeMb} MB, koinos resources ${resourceSizeMb} MB.`);
