#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const promote = require('../scripts/promote-public-bootstrap-backup.js');
const overlay = require('../scripts/publish-public-bootstrap-overlay.js');
const { createSourceRepository, sha256, writeTemplate } = require('./helpers/public-bootstrap-fixture.js');

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teleno-public-overlay-test-'));
  try {
    const backupId = createSourceRepository(root);
    const template = writeTemplate(root);
    const source = path.join(root, 'source-repository');
    const destination = path.join(root, 'public');
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const keyFile = path.join(root, 'synthetic-key.pem');
    fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const options = {
      sourceRepository: source,
      destinationRepository: destination,
      backupId: 'latest',
      network: 'testnet',
      publicBaseUrl: `file://${destination}`,
      observerConfigTemplate: template,
      signingPrivateKeyFile: keyFile,
      publicRetentionCount: 0,
    };
    return fn({ root, backupId, source, destination, options });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function objectInventory(repository) {
  const root = path.join(repository, 'objects');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push([path.relative(root, file), sha256(fs.readFileSync(file))]);
      else files.push([path.relative(root, file), 'non-regular-entry']);
    }
  };
  visit(root);
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}

test('overlay exports only signed allowlisted objects without exposing or changing private objects', () => withFixture(({ source, destination, options, backupId }) => {
  const sentinel = Buffer.from('unpromoted synthetic private object');
  const sentinelHash = sha256(sentinel);
  const sourceSentinel = promote.objectPath(source, sentinelHash);
  fs.mkdirSync(path.dirname(sourceSentinel), { recursive: true });
  fs.writeFileSync(sourceSentinel, sentinel);
  const sourceBefore = fs.readFileSync(sourceSentinel);
  const sourceObjectsBefore = objectInventory(source);

  const plan = promote.buildPlan(options);
  overlay.publishOverlay(plan, options);
  promote.validatePublishedTree(plan);

  assert.equal(fs.lstatSync(path.join(destination, 'objects')).isDirectory(), true);
  assert.notEqual(fs.realpathSync(path.join(destination, 'objects')), fs.realpathSync(path.join(source, 'objects')));
  assert.equal(fs.existsSync(promote.objectPath(destination, sentinelHash)), false);
  assert.deepEqual(fs.readFileSync(sourceSentinel), sourceBefore);
  assert.deepEqual(objectInventory(source), sourceObjectsBefore);
  assert.deepEqual(
    fs.readdirSync(path.join(destination, 'snapshots', backupId)).sort(),
    ['COMPLETE', 'files.json', 'manifest.json', 'public-bootstrap-signature.json', 'public-bootstrap.json']
  );
  const publicHashes = new Set(plan.objects.keys());
  const publishedHashes = [];
  for (const a of fs.readdirSync(path.join(destination, 'objects', 'sha256'))) {
    for (const b of fs.readdirSync(path.join(destination, 'objects', 'sha256', a))) {
      publishedHashes.push(...fs.readdirSync(path.join(destination, 'objects', 'sha256', a, b)));
    }
  }
  assert.deepEqual(new Set(publishedHashes), publicHashes);
}));

test('overlay refuses unsigned plans and an existing source-store link', () => withFixture(({ source, destination, options }) => {
  const unsigned = promote.buildPlan({ ...options, signingPrivateKeyFile: undefined });
  assert.throws(() => overlay.publishOverlay(unsigned, options), /requires an Ed25519 signature/);
  fs.mkdirSync(destination);
  fs.symlinkSync(path.join(source, 'objects'), path.join(destination, 'objects'), 'dir');
  const signed = promote.buildPlan(options);
  assert.throws(() => overlay.publishOverlay(signed, options), /symlink or non-directory parent/);
  assert.equal(fs.existsSync(path.join(destination, 'latest.json')), false);
}));

test('overlay rejects a symlinked destination object parent', () => withFixture(({ source, destination, options }) => {
  const plan = promote.buildPlan(options);
  fs.mkdirSync(path.join(destination, 'objects'), { recursive: true });
  fs.symlinkSync(path.join(source, 'objects', 'sha256'), path.join(destination, 'objects', 'sha256'), 'dir');
  assert.throws(() => overlay.publishOverlay(plan, options), /symlink or non-directory parent/);
  assert.equal(fs.existsSync(path.join(destination, 'latest.json')), false);
}));

test('overlay rejects a destination reached through a source symlink before writing', () => withFixture(({ root, source, options }) => {
  const alias = path.join(root, 'source-alias');
  fs.symlinkSync(source, alias, 'dir');
  const destinationRepository = path.join(alias, 'public');
  const plan = promote.buildPlan({ ...options, destinationRepository });
  assert.throws(() => overlay.publishOverlay(plan, options), /must be independent/);
  assert.equal(fs.existsSync(path.join(source, 'public')), false);
}));

test('retention preserves the promoted latest even when it sorts oldest', () => withFixture(({ destination, options, backupId }) => {
  const plan = promote.buildPlan(options);
  overlay.publishOverlay(plan, options);
  for (const id of ['zz-newer-one', 'zz-newer-two']) {
    const directory = path.join(destination, 'snapshots', id);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'COMPLETE'), 'complete\n');
  }
  assert.deepEqual(overlay.prunePublicSnapshots(destination, 1), ['zz-newer-one', 'zz-newer-two']);
  assert.equal(fs.existsSync(path.join(destination, 'snapshots', backupId, 'COMPLETE')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'latest.json'))).backup_id, backupId);
}));

test('an I/O failure during staging leaves the actual current snapshot readable and allows a retry', (t) => withFixture(({ destination, options, backupId }) => {
  const original = promote.buildPlan(options);
  overlay.publishOverlay(original);
  const latestFile = path.join(destination, 'latest.json');
  const before = fs.readFileSync(latestFile);
  const originalDir = path.join(destination, 'snapshots', backupId);
  const originalManifest = fs.readFileSync(path.join(originalDir, 'manifest.json'));
  const replacement = promote.buildPlan({ ...options, replace: true });
  assert.notEqual(replacement.backupId, backupId);
  assert.equal(replacement.publicMetadataJson.source_backup_id, backupId);

  const write = fs.writeFileSync;
  const mock = t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (path.basename(file) === 'files.json') {
      promote.validatePublishedTree(original);
      throw Object.assign(new Error('fixture could not write staged inventory'), { code: 'EIO' });
    }
    return write(file, ...args);
  });
  try {
    assert.throws(() => overlay.publishOverlay(replacement, { publicRetentionCount: 1 }), { code: 'EIO' });
  } finally {
    mock.mock.restore();
  }
  assert.deepEqual(fs.readFileSync(latestFile), before);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'snapshots')), [backupId]);
  promote.validatePublishedTree(original);
  assert.deepEqual(fs.readdirSync(destination).sort(), ['latest.json', 'objects', 'snapshots']);

  assert.deepEqual(overlay.publishOverlay(replacement, { publicRetentionCount: 2 }).removedPublicSnapshots, []);
  promote.validatePublishedTree(replacement);
  assert.deepEqual(fs.readFileSync(path.join(originalDir, 'manifest.json')), originalManifest);
  assert.ok(fs.statSync(path.join(originalDir, 'COMPLETE')).isFile());
  assert.equal(replacement.latestJson.snapshot_dir, replacement.backupId);
  assert.equal(replacement.signatureJson.payload.backup_id, replacement.backupId);
}));

test('a failed pointer rename leaves the current snapshot and keeps the verified successor recoverable', (t) => withFixture(({ destination, options }) => {
  const original = promote.buildPlan(options);
  promote.publish(original);
  const replacement = promote.buildPlan({ ...options, replace: true });
  const latestFile = path.join(destination, 'latest.json');
  const replacementDir = path.join(destination, 'snapshots', replacement.backupId);
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === latestFile) {
      promote.validatePublishedTree(original);
      promote.validatePublishedTree(replacement, { latestFile: from });
      throw Object.assign(new Error('fixture could not install the verified pointer'), { code: 'EIO' });
    }
    return rename(from, to);
  });
  try {
    assert.throws(() => overlay.publishOverlay(replacement, { publicRetentionCount: 1 }), { code: 'EIO' });
  } finally {
    mock.mock.restore();
  }
  promote.validatePublishedTree(original);
  assert.ok(fs.statSync(path.join(replacementDir, 'COMPLETE')).isFile());
  const retry = promote.buildPlan({ ...options, replace: true });
  overlay.publishOverlay(retry, { publicRetentionCount: 3 });
  promote.validatePublishedTree(retry);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'snapshots')).sort(),
    [original.backupId, replacement.backupId, retry.backupId].sort());
}));

test('the overlay and ordinary promotion share the destination lock through pruning', (t) => withFixture(({ destination, options, backupId }) => {
  promote.publish(promote.buildPlan(options));
  const replacement = promote.buildPlan({ ...options, replace: true });
  const oldDir = path.join(destination, 'snapshots', backupId);
  const remove = fs.rmSync;
  let concurrentAttemptChecked = false;
  const mock = t.mock.method(fs, 'rmSync', (dir, ...args) => {
    if (dir === oldDir) {
      promote.validatePublishedTree(replacement);
      const competitor = spawnSync(process.execPath, [
        require.resolve('../scripts/promote-public-bootstrap-backup.js'),
        '--source-repository', options.sourceRepository,
        '--destination-repository', destination,
        '--network', options.network,
        '--public-base-url', options.publicBaseUrl,
        '--observer-config-template', options.observerConfigTemplate,
        '--signing-private-key-file', options.signingPrivateKeyFile,
      ], { encoding: 'utf8', timeout: 5000 });
      assert.ifError(competitor.error);
      assert.equal(competitor.status, 1, competitor.stderr);
      assert.match(competitor.stderr, /public bootstrap destination is locked/);
      concurrentAttemptChecked = true;
    }
    return remove(dir, ...args);
  });
  try {
    assert.deepEqual(overlay.publishOverlay(replacement, { publicRetentionCount: 1 }).removedPublicSnapshots, [backupId]);
  } finally {
    mock.mock.restore();
  }
  assert.ok(concurrentAttemptChecked);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'snapshots')), [replacement.backupId]);
  promote.validatePublishedTree(replacement);
}));
