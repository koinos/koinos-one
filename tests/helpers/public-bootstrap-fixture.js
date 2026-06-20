const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const promote = require('../../scripts/promote-public-bootstrap-backup.js');

const OBSERVER_CONFIG = `global:
  log-level: info
  fork-algorithm: pob
chain:
  verify-blocks: true
p2p:
  listen: /ip4/0.0.0.0/tcp/18888
  peer:
    - /dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W
jsonrpc:
  listen: 127.0.0.1:18122
backup:
  enabled: false
  public-restore:
    enabled: true
    base-url: https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap
    network: testnet
features:
  chain: true
  mempool: true
  block_store: true
  p2p: true
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: true
  transaction_store: false
  account_history: false
`;

const UNSAFE_SOURCE_CONFIG = `global:
  log-level: info
chain:
  verify-blocks: false
block_producer:
  producer: 1UnsafeProducer
  private-key-file: block_producer/private.key
features:
  block_producer: true
backup:
  ssh:
    private-key-file: ~/.ssh/id_ed25519
`;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function writeObject(repo, data) {
  const digest = sha256(data);
  const file = promote.objectPath(repo, digest);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return digest;
}

function makeFileEntry(repo, relativePath, data, runtimeFile) {
  const digest = writeObject(repo, data);
  return {
    path: relativePath,
    sha256: digest,
    size_bytes: data.length,
    runtime_file: runtimeFile,
  };
}

function createSourceRepository(root, extraEntries = []) {
  const repo = path.join(root, 'source-repository');
  const backupId = '20260620T120000Z-ms-1-files-4';
  const snapshot = path.join(repo, 'snapshots', backupId);
  fs.mkdirSync(snapshot, { recursive: true });

  const entries = [
    makeFileEntry(repo, 'chain/genesis_data.json', Buffer.from('genesis'), true),
    makeFileEntry(repo, 'config.yml', Buffer.from(UNSAFE_SOURCE_CONFIG), true),
    makeFileEntry(repo, 'db/000001.sst', Buffer.from('db-data-1'), false),
    makeFileEntry(repo, 'jsonrpc/descriptors/koinos_descriptors.pb', Buffer.from('descriptors'), true),
    ...extraEntries,
  ];

  const totalBytes = entries.reduce((sum, entry) => sum + entry.size_bytes, 0);
  const manifest = {
    format: 'teleno-native-rocksdb-snapshot',
    version: 1,
    backup_id: backupId,
    created_at: '20260620T120000Z',
    node: { name: 'teleno_node', version: 'test' },
    source: {
      basedir: '/private/operator/path/should/not/publish',
      node_id: 'private-node',
      storage_layout: 'unified',
    },
    repository: {
      type: 'local-object-store',
      path: '/private/repo/path/should/not/publish',
    },
    snapshot: { file_count: entries.length, object_count: entries.length, total_bytes: totalBytes },
    sizes: {
      restored_database_bytes: 9,
      runtime_files_bytes: 20,
      object_download_bytes: totalBytes,
      archive_bytes: 0,
      minimum_target_free_bytes: 1,
      recommended_target_free_bytes: 1,
    },
    restore: {
      requires_node_stop: true,
      start_as_observer_first: true,
      force_block_producer_disabled_on_first_start: true,
    },
  };
  const files = {
    format: 'teleno-native-snapshot-files',
    version: 1,
    backup_id: backupId,
    files: entries,
  };
  const latest = {
    format: 'teleno-native-latest-snapshot',
    version: 1,
    backup_id: backupId,
    snapshot_dir: backupId,
    manifest: `snapshots/${backupId}/manifest.json`,
    files: `snapshots/${backupId}/files.json`,
  };

  fs.writeFileSync(path.join(snapshot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(snapshot, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);
  fs.writeFileSync(path.join(snapshot, 'COMPLETE'), 'complete\n');
  fs.writeFileSync(path.join(repo, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  return backupId;
}

function writeTemplate(root) {
  const file = path.join(root, 'observer-template.yml');
  fs.writeFileSync(file, OBSERVER_CONFIG);
  return file;
}

module.exports = {
  OBSERVER_CONFIG,
  createSourceRepository,
  makeFileEntry,
  sha256,
  writeTemplate,
};
