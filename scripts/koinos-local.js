#!/usr/bin/env node
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(process.cwd(), 'infra', 'koinos', '.env');
const envExamplePath = path.join(process.cwd(), 'infra', 'koinos', '.env.example');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function preflight() {
  if (!fs.existsSync(envPath)) {
    console.log('Missing infra/koinos/.env');
    console.log('Run: cp infra/koinos/.env.example infra/koinos/.env');
    process.exit(1);
  }

  const env = { ...loadEnv(envExamplePath), ...loadEnv(envPath) };
  const ports = ['JSONRPC_PORT', 'P2P_PORT', 'BLOCK_STORE_PORT', 'MEMPOOL_PORT', 'CHAIN_PORT'];

  console.log('Checking local profile ports...');
  let ok = true;
  for (const key of ports) {
    const p = Number(env[key]);
    if (!Number.isInteger(p)) {
      console.log(`- ${key}: invalid`);
      ok = false;
      continue;
    }
    const free = await checkPort(p);
    console.log(`- ${key}=${p}: ${free ? 'free' : 'IN USE'}`);
    if (!free) ok = false;
  }

  const backup = env.BACKUP_TAR_PATH;
  if (!backup || !fs.existsSync(backup)) {
    console.log(`- BACKUP_TAR_PATH missing/not found: ${backup || '(empty)'}`);
    ok = false;
  } else {
    console.log(`- BACKUP_TAR_PATH: OK (${backup})`);
  }

  if (!ok) {
    console.log('\nPreflight failed. Adjust ports/path in infra/koinos/.env');
    process.exit(2);
  }
  console.log('\nPreflight OK. Safe to launch local profile without colliding with existing node ports.');
}

const cmd = process.argv[2] || 'preflight';
if (cmd === 'preflight') preflight();
else {
  console.log('Usage: node scripts/koinos-local.js preflight');
  process.exit(1);
}
