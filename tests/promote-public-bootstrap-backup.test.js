#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const promote = require('../scripts/promote-public-bootstrap-backup.js');
const {
  OBSERVER_CONFIG,
  createSourceRepository,
  makeFileEntry,
  sha256,
  writeTemplate,
} = require('./helpers/public-bootstrap-fixture.js');

function options(root, dryRun) {
  return {
    sourceRepository: path.join(root, 'source-repository'),
    backupId: 'latest',
    destinationRepository: path.join(root, 'teleno-bootstrap'),
    network: 'testnet',
    publicBaseUrl: `file://${path.join(root, 'teleno-bootstrap')}`,
    observerConfigTemplate: path.join(root, 'observer-template.yml'),
    dryRun,
  };
}

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teleno-public-promote-test-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('dry-run rewrites config without writing destination', () => withTempDir((root) => {
  createSourceRepository(root);
  writeTemplate(root);

  const plan = promote.buildPlan(options(root, true));
  const report = promote.reportForPlan(plan, true);

  assert.equal(report.dry_run, true);
  assert.equal(report.sanitized_config_sha256, sha256(Buffer.from(OBSERVER_CONFIG)));
  assert.equal(fs.existsSync(path.join(root, 'teleno-bootstrap', 'latest.json')), false);
  assert.equal(Object.hasOwn(plan.manifestJson.source, 'basedir'), false);
  assert.equal(Object.hasOwn(plan.manifestJson.repository, 'path'), false);
}));

test('publish writes sanitized snapshot', () => withTempDir((root) => {
  const backupId = createSourceRepository(root);
  writeTemplate(root);

  const plan = promote.buildPlan(options(root, false));
  promote.publish(plan);
  promote.validatePublishedTree(plan);

  const dest = path.join(root, 'teleno-bootstrap');
  const latest = JSON.parse(fs.readFileSync(path.join(dest, 'latest.json'), 'utf8'));
  const files = JSON.parse(fs.readFileSync(path.join(dest, 'snapshots', backupId, 'files.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'snapshots', backupId, 'manifest.json'), 'utf8'));
  const configEntry = files.files.find((entry) => entry.path === 'config.yml');
  const configObject = promote.objectPath(dest, configEntry.sha256);

  assert.equal(fs.readFileSync(configObject, 'utf8'), OBSERVER_CONFIG);
  assert.equal(latest.backup_id, backupId);
  assert.equal(manifest.repository.type, 'public-bootstrap-object-store');
  assert.equal(manifest.public_bootstrap.producer_mode, false);
}));

test('rejects producer private key path', () => withTempDir((root) => {
  const repo = path.join(root, 'source-repository');
  const privateKeyEntry = makeFileEntry(repo, 'block_producer/private.key', Buffer.from('secret'), true);
  createSourceRepository(root, [privateKeyEntry]);
  writeTemplate(root);

  assert.throws(() => promote.buildPlan(options(root, true)), /denied path/);
}));

test('rejects object hash mismatch', () => withTempDir((root) => {
  createSourceRepository(root);
  writeTemplate(root);

  const files = JSON.parse(
    fs.readFileSync(path.join(root, 'source-repository', 'snapshots', '20260620T120000Z-ms-1-files-4', 'files.json'), 'utf8')
  );
  const dbEntry = files.files.find((entry) => entry.path === 'db/000001.sst');
  fs.writeFileSync(promote.objectPath(path.join(root, 'source-repository'), dbEntry.sha256), 'corrupt');

  assert.throws(() => promote.buildPlan(options(root, true)), /size mismatch|hash mismatch/);
}));

test('main dry-run does not write public destination', () => withTempDir((root) => {
  createSourceRepository(root);
  const template = writeTemplate(root);

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    const rc = promote.main([
      '--source-repository', path.join(root, 'source-repository'),
      '--destination-repository', path.join(root, 'teleno-bootstrap'),
      '--network', 'testnet',
      '--public-base-url', `file://${path.join(root, 'teleno-bootstrap')}`,
      '--observer-config-template', template,
      '--dry-run',
    ]);
    assert.equal(rc, 0);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(JSON.parse(output).dry_run, true);
  assert.equal(fs.existsSync(path.join(root, 'teleno-bootstrap', 'latest.json')), false);
}));
