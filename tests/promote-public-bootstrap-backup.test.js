#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

function writeEd25519PrivateKey(root) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyFile = path.join(root, 'public-bootstrap-signing-key.pem');
  fs.writeFileSync(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return privateKeyFile;
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

  const plan = promote.buildPlan({ ...options(root, false), signingPrivateKeyFile: writeEd25519PrivateKey(root) });
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
  assert.equal(manifest.public_bootstrap.network, 'testnet');
  assert.equal(manifest.public_bootstrap.chain_id, 'EiBZK_TEST_CHAIN_ID');
  assert.equal(manifest.public_bootstrap.source.node_id, 'private-node');
  assert.equal(manifest.public_bootstrap.source.node_version, 'test');
  assert.equal(manifest.public_bootstrap.source.head_height, 12345);
  assert.equal(manifest.public_bootstrap.source.lib_height, 12300);
  assert.equal(manifest.public_bootstrap.restore_space.object_download_bytes, plan.publicMetadataJson.total_bytes);
  assert.equal(plan.publicMetadataJson.source.storage_layout, 'unified');
  assert.equal(plan.publicMetadataJson.restore_space.minimum_target_free_bytes, manifest.sizes.minimum_target_free_bytes);
}));

test('signed publish includes the observer template when the source config is absent', () => withTempDir((root) => {
  const backupId = createSourceRepository(root, [], { includeConfig: false });
  writeTemplate(root);
  const signingPrivateKeyFile = writeEd25519PrivateKey(root);
  const plan = promote.buildPlan({ ...options(root, false), signingPrivateKeyFile });
  promote.publish(plan);
  const dest = plan.destinationRepository;
  const snapshot = path.join(dest, 'snapshots', backupId);
  const filesBytes = fs.readFileSync(path.join(snapshot, 'files.json'));
  const manifestBytes = fs.readFileSync(path.join(snapshot, 'manifest.json'));
  const metadataBytes = fs.readFileSync(path.join(snapshot, 'public-bootstrap.json'));
  const envelope = JSON.parse(fs.readFileSync(path.join(snapshot, 'public-bootstrap-signature.json'), 'utf8'));
  const files = JSON.parse(filesBytes).files;
  const manifest = JSON.parse(manifestBytes);
  const metadata = JSON.parse(metadataBytes);
  const config = files.find((entry) => entry.path === 'config.yml');
  assert.equal(config.runtime_file, true);
  assert.equal(config.sha256, metadata.sanitized_config_sha256);
  assert.equal(config.size_bytes, metadata.sanitized_config_size_bytes);
  const configBytes = fs.readFileSync(promote.objectPath(dest, config.sha256));
  assert.equal(configBytes.toString('utf8'), OBSERVER_CONFIG);
  assert.equal(configBytes.length, config.size_bytes);
  assert.equal(sha256(configBytes), config.sha256);
  assert.equal(files.length, 4);
  assert.equal(manifest.snapshot.file_count, files.length);
  assert.equal(metadata.file_count, files.length);
  const objectCount = new Set(files.map((entry) => entry.sha256)).size;
  const totalBytes = files.reduce((total, entry) => total + entry.size_bytes, 0);
  assert.equal(metadata.object_count, objectCount);
  assert.equal(envelope.payload.object_count, objectCount);
  assert.equal(manifest.snapshot.total_bytes, totalBytes);
  assert.equal(metadata.total_bytes, totalBytes);
  assert.equal(envelope.payload.total_bytes, totalBytes);
  assert.equal(envelope.payload.sanitized_config_sha256, config.sha256);
  for (const [field, bytes] of [
    ['latest_sha256', fs.readFileSync(path.join(dest, 'latest.json'))],
    ['files_sha256', filesBytes],
    ['manifest_sha256', manifestBytes],
    ['public_metadata_sha256', metadataBytes],
  ]) {
    assert.equal(envelope.payload[field], sha256(bytes));
  }
  const publicKey = crypto.createPublicKey(fs.readFileSync(signingPrivateKeyFile));
  assert.ok(crypto.verify(null, Buffer.from(promote.canonicalizeJson(envelope.payload)), publicKey,
    Buffer.from(envelope.signature_hex, 'hex')));
}));

test('publish can write and verify a signed public bootstrap envelope', () => withTempDir((root) => {
  const backupId = createSourceRepository(root);
  writeTemplate(root);
  const privateKeyFile = writeEd25519PrivateKey(root);

  const plan = promote.buildPlan({
    ...options(root, false),
    signingPrivateKeyFile: privateKeyFile,
    signatureKeyId: 'unit-test-key',
  });
  promote.publish(plan);
  promote.validatePublishedTree(plan);

  const dest = path.join(root, 'teleno-bootstrap');
  const latest = JSON.parse(fs.readFileSync(path.join(dest, 'latest.json'), 'utf8'));
  const envelope = JSON.parse(
    fs.readFileSync(path.join(dest, 'snapshots', backupId, 'public-bootstrap-signature.json'), 'utf8')
  );
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyFile));
  const publicKey = crypto.createPublicKey(privateKey);

  assert.equal(latest.signature, `snapshots/${backupId}/public-bootstrap-signature.json`);
  assert.equal(envelope.format, 'teleno-public-bootstrap-signature');
  assert.equal(envelope.algorithm, 'ed25519');
  assert.equal(envelope.key_id, 'unit-test-key');
  assert.equal(envelope.payload.backup_id, backupId);
  assert.equal(envelope.payload.chain_id, 'EiBZK_TEST_CHAIN_ID');
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(promote.canonicalizeJson(envelope.payload)),
      publicKey,
      Buffer.from(envelope.signature_hex, 'hex')
    ),
    true
  );
  assert.equal(promote.reportForPlan(plan, false).signed, true);
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

test('rejects unsigned publication while allowing an unsigned dry-run plan', () => withTempDir((root) => {
  createSourceRepository(root);
  writeTemplate(root);
  const plan = promote.buildPlan(options(root, true));
  assert.equal(plan.signed, false);
  assert.throws(() => promote.publish(plan), /requires an Ed25519 signature/);
  assert.equal(fs.existsSync(path.join(root, 'teleno-bootstrap')), false);
}));

test('rejects backslash paths', () => withTempDir((root) => {
  const repo = path.join(root, 'source-repository');
  const entry = makeFileEntry(repo, 'db\\..\\private.key', Buffer.from('synthetic'), false);
  createSourceRepository(root, [entry]);
  writeTemplate(root);
  assert.throws(() => promote.buildPlan(options(root, true)), /unsafe relative path/);
}));

test('parses effective observer YAML and allows harmless comments', () => withTempDir((root) => {
  createSourceRepository(root);
  const template = writeTemplate(root);
  fs.appendFileSync(template, '# block_producer: true and private-key-file are examples only\n');
  assert.doesNotThrow(() => promote.buildPlan(options(root, true)));
  fs.writeFileSync(template, 'features:\n  block_producer: false\nchain:\n  verify-blocks: false\n# verify-blocks: true\n');
  assert.throws(() => promote.buildPlan(options(root, true)), /must enable chain.verify-blocks/);
  fs.writeFileSync(template, 'features:\n  block_producer: false\n  block_producer: true\nchain:\n  verify-blocks: true\n');
  assert.throws(() => promote.buildPlan(options(root, true)), /invalid YAML/);
  fs.writeFileSync(template, 'safe: &producer true\nfeatures:\n  block_producer: *producer\nchain:\n  verify-blocks: true\n');
  assert.throws(() => promote.buildPlan(options(root, true)), /disable block production/);
  fs.writeFileSync(template, 'features:\n  block_producer: false\nchain:\n  verify-blocks: true\nbackup:\n  password-file: synthetic-secret-path\n');
  assert.throws(() => promote.buildPlan(options(root, true)), /forbidden setting/);
}));

test('rejects nested admin token settings in observer YAML', () => withTempDir((root) => {
  createSourceRepository(root);
  const template = writeTemplate(root);
  fs.appendFileSync(template, 'admin:\n  token: synthetic-token\n');
  assert.throws(() => promote.buildPlan(options(root, true)), /forbidden setting: admin.token/);
  fs.writeFileSync(template, `${OBSERVER_CONFIG}extension:\n  admin:\n    token: synthetic-token\n`);
  assert.throws(() => promote.buildPlan(options(root, true)), /forbidden setting: admin.token/);
}));

test('rejects a non-Ed25519 signing key', () => withTempDir((root) => {
  createSourceRepository(root);
  writeTemplate(root);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(root, 'rsa-key.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => promote.buildPlan({ ...options(root, false), signingPrivateKeyFile: keyFile }), /must be Ed25519/);
}));

test('publishes only allowlisted manifest fields', () => withTempDir((root) => {
  const backupId = createSourceRepository(root);
  writeTemplate(root);
  const file = path.join(root, 'source-repository', 'snapshots', backupId, 'manifest.json');
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  source.operator_secret = 'synthetic-private-marker';
  source.node.operator_secret = 'synthetic-private-marker';
  fs.writeFileSync(file, JSON.stringify(source));
  const plan = promote.buildPlan(options(root, true));
  assert.equal(JSON.stringify(plan.manifestJson).includes('synthetic-private-marker'), false);
  assert.deepEqual(Object.keys(plan.manifestJson).sort(), [
    'backup_id', 'created_at', 'format', 'node', 'public_bootstrap', 'repository',
    'restore', 'sizes', 'snapshot', 'source', 'version',
  ]);
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
