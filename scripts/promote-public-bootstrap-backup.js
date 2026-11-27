#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const METADATA_OVERHEAD_BYTES = 128 * 1024 * 1024;
const RECOMMENDED_MIN_MARGIN_BYTES = 10 * 1024 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;
const WRITE_LOCK = '.public-bootstrap-write.lock';
const STAGING_PREFIX = '.public-bootstrap-stage-';

const ALLOWED_EXACT_PATHS = new Set([
  'config.yml',
  'chain/genesis_data.json',
  'jsonrpc/descriptors/koinos_descriptors.pb',
]);

const DENIED_EXACT_PATHS = new Set([
  '.teleno-native-backups/admin.token',
  '.teleno-native-backups/teleno-native-backup-config.yml',
  'block_producer/private.key',
]);

const DENIED_PARTS = new Set(['.ssh', 'wallet', 'wallets']);
const DENIED_SUFFIXES = ['.token', '.pem', '.p12', '.pfx'];
const DENIED_FRAGMENTS = ['id_rsa', 'id_ed25519', 'private-key', 'private_key', 'password', 'passphrase'];

class PromotionError extends Error {}

function utcTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new PromotionError(`missing required file: ${file}`);
    }
    throw new PromotionError(`invalid JSON in ${file}: ${error.message}`);
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function objectPath(repository, sha256) {
  if (!SHA256_RE.test(sha256)) {
    throw new PromotionError(`invalid SHA-256: ${sha256}`);
  }
  return path.join(repository, 'objects', 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

function validateBackupId(backupId) {
  if (!backupId || backupId === '.' || backupId === '..' || backupId.includes('/') || backupId.includes('\\')) {
    throw new PromotionError(`backup ID must be a snapshot directory name: ${backupId}`);
  }
  if (backupId.endsWith('.partial')) {
    throw new PromotionError(`backup ID must not reference a partial snapshot: ${backupId}`);
  }
}

function validateRelativePath(relativePath) {
  if (!relativePath || path.posix.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new PromotionError(`unsafe relative path: ${relativePath}`);
  }
  for (const part of relativePath.split('/')) {
    if (!part || part === '.' || part === '..') {
      throw new PromotionError(`unsafe relative path: ${relativePath}`);
    }
  }
}

function isDeniedPath(relativePath) {
  const lower = relativePath.toLowerCase();
  if (DENIED_EXACT_PATHS.has(lower)) return true;
  if (lower.split('/').some((part) => DENIED_PARTS.has(part))) return true;
  if (DENIED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  return DENIED_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function isAllowedPath(relativePath) {
  return ALLOWED_EXACT_PATHS.has(relativePath) || relativePath.startsWith('db/');
}

function assertPublicPathAllowed(relativePath) {
  validateRelativePath(relativePath);
  if (isDeniedPath(relativePath)) {
    throw new PromotionError(`public snapshot contains denied path: ${relativePath}`);
  }
  if (!isAllowedPath(relativePath)) {
    throw new PromotionError(`public snapshot contains non-allowlisted path: ${relativePath}`);
  }
}

function parseFilesJson(filesJson) {
  if (filesJson.format !== 'teleno-native-snapshot-files' || !Array.isArray(filesJson.files)) {
    throw new PromotionError('files.json has unexpected format');
  }
  const seen = new Set();
  return filesJson.files.map((entry) => {
    if (typeof entry.path !== 'string') {
      throw new PromotionError('files.json contains file entry without string path');
    }
    if (seen.has(entry.path)) {
      throw new PromotionError(`duplicate path in files.json: ${entry.path}`);
    }
    seen.add(entry.path);
    assertPublicPathAllowed(entry.path);
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
      throw new PromotionError(`invalid SHA-256 for ${entry.path}: ${entry.sha256}`);
    }
    if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0) {
      throw new PromotionError(`invalid size for ${entry.path}: ${entry.size_bytes}`);
    }
    return {
      path: entry.path,
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
      runtime_file: Boolean(entry.runtime_file),
    };
  });
}

function validateSourceObjects(repository, entries) {
  for (const entry of entries) {
    const source = objectPath(repository, entry.sha256);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      throw new PromotionError(`missing object for ${entry.path}: ${source}`);
    }
    const actualSize = fs.statSync(source).size;
    if (actualSize !== entry.size_bytes) {
      throw new PromotionError(`object size mismatch for ${entry.path}: expected ${entry.size_bytes}, got ${actualSize}`);
    }
    const actualHash = sha256File(source);
    if (actualHash !== entry.sha256) {
      throw new PromotionError(`object hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualHash}`);
    }
  }
}

function validateObserverConfig(buffer) {
  const document = YAML.parseDocument(buffer.toString('utf8'), { uniqueKeys: true, merge: true });
  if (document.errors.length) {
    throw new PromotionError(`observer config is invalid YAML: ${document.errors[0].message}`);
  }
  const config = document.toJS({ maxAliasCount: 100 });
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new PromotionError('observer config must be a YAML mapping');
  }
  if (config.features?.block_producer !== false) {
    throw new PromotionError('observer config must explicitly disable block production');
  }
  if (config.chain?.['verify-blocks'] !== true) {
    throw new PromotionError('observer config must enable chain.verify-blocks');
  }
  const forbidden = new Set(['private-key-file', 'password-file', 'passphrase-file', 'admin.token']);
  const visit = (value, parentKey = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      const setting = parentKey === 'admin' && lowerKey === 'token' ? 'admin.token' : lowerKey;
      if (forbidden.has(setting)) {
        throw new PromotionError(`observer config contains forbidden setting: ${setting}`);
      }
      visit(child, lowerKey);
    }
  };
  visit(config);
}

function latestForBackupId(backupId, signed = false) {
  const latest = {
    format: 'teleno-native-latest-snapshot',
    version: 1,
    backup_id: backupId,
    snapshot_dir: backupId,
    manifest: `snapshots/${backupId}/manifest.json`,
    files: `snapshots/${backupId}/files.json`,
    public_metadata: `snapshots/${backupId}/public-bootstrap.json`,
  };
  if (signed) latest.signature = `snapshots/${backupId}/public-bootstrap-signature.json`;
  return latest;
}

function resolveBackupId(repository, requestedBackupId) {
  if (requestedBackupId !== 'latest') {
    validateBackupId(requestedBackupId);
    return requestedBackupId;
  }
  const latest = readJson(path.join(repository, 'latest.json'));
  if (typeof latest.backup_id !== 'string') {
    throw new PromotionError('latest.json does not contain backup_id');
  }
  validateBackupId(latest.backup_id);
  return latest.backup_id;
}

function recomputeSizes(entries) {
  const restoredDatabaseBytes = entries
    .filter((entry) => entry.path.startsWith('db/'))
    .reduce((sum, entry) => sum + entry.size_bytes, 0);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size_bytes, 0);
  const runtimeFilesBytes = totalBytes - restoredDatabaseBytes;
  const minimum = restoredDatabaseBytes + runtimeFilesBytes + METADATA_OVERHEAD_BYTES;
  const recommended = minimum + Math.max(RECOMMENDED_MIN_MARGIN_BYTES, Math.floor(restoredDatabaseBytes / 5));
  return {
    restored_database_bytes: restoredDatabaseBytes,
    runtime_files_bytes: runtimeFilesBytes,
    object_download_bytes: totalBytes,
    archive_bytes: 0,
    minimum_target_free_bytes: minimum,
    recommended_target_free_bytes: recommended,
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function optionalString(...values) {
  const value = firstDefined(...values);
  return value === null ? '' : String(value);
}

function optionalSafeInteger(...values) {
  const value = firstDefined(...values);
  if (value === null) return 0;
  const number = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function signPublicBootstrapPayload(payload, privateKeyFile, keyId) {
  const privateKeyPem = fs.readFileSync(path.resolve(privateKeyFile));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new PromotionError('public bootstrap signing key must be Ed25519');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const canonicalPayload = canonicalizeJson(payload);
  const signature = crypto.sign(null, Buffer.from(canonicalPayload), privateKey);
  return {
    format: 'teleno-public-bootstrap-signature',
    version: 1,
    algorithm: 'ed25519',
    key_id: keyId || 'teleno-public-bootstrap',
    public_key_sha256: sha256Buffer(publicKeyDer),
    payload,
    signature_hex: signature.toString('hex'),
  };
}

function buildPlan(options) {
  const sourceRepository = path.resolve(options.sourceRepository);
  const destinationRepository = path.resolve(options.destinationRepository);
  if (sourceRepository === destinationRepository) {
    throw new PromotionError('source and destination repositories must be different');
  }
  if (destinationRepository.startsWith(`${sourceRepository}${path.sep}`)) {
    throw new PromotionError('destination repository must not be inside the source repository');
  }
  if (sourceRepository.startsWith(`${destinationRepository}${path.sep}`)) {
    throw new PromotionError('source repository must not be inside the public destination');
  }
  if (options.signatureKeyId && !options.signingPrivateKeyFile) {
    throw new PromotionError('signature key ID requires a signing private key');
  }

  const sourceBackupId = resolveBackupId(sourceRepository, options.backupId);
  const snapshotDir = path.join(sourceRepository, 'snapshots', sourceBackupId);
  if (!fs.existsSync(path.join(snapshotDir, 'COMPLETE'))) {
    throw new PromotionError(`snapshot is not complete: ${sourceBackupId}`);
  }

  const sourceManifest = readJson(path.join(snapshotDir, 'manifest.json'));
  const sourceFilesJson = readJson(path.join(snapshotDir, 'files.json'));
  if (sourceManifest.format !== 'teleno-native-rocksdb-snapshot'
      || sourceManifest.version !== 1) {
    throw new PromotionError('source manifest has unexpected format or version');
  }
  if (sourceManifest.backup_id !== sourceBackupId) {
    throw new PromotionError('manifest backup_id does not match selected snapshot');
  }
  if (sourceFilesJson.backup_id !== sourceBackupId) {
    throw new PromotionError('files.json backup_id does not match selected snapshot');
  }

  const sourceEntries = parseFilesJson(sourceFilesJson);
  validateSourceObjects(sourceRepository, sourceEntries);

  const configTemplate = fs.readFileSync(path.resolve(options.observerConfigTemplate));
  validateObserverConfig(configTemplate);
  const configSha = sha256Buffer(configTemplate);
  const configSize = configTemplate.length;

  const outputEntries = [{ path: 'config.yml', sha256: configSha, size_bytes: configSize, runtime_file: true }];
  const objects = new Map([[configSha, { sha256: configSha, size_bytes: configSize, content: configTemplate }]]);
  for (const entry of sourceEntries) {
    if (entry.path === 'config.yml') continue;
    outputEntries.push(entry);
    if (!objects.has(entry.sha256)) {
      objects.set(entry.sha256, {
        sha256: entry.sha256,
        size_bytes: entry.size_bytes,
        sourcePath: objectPath(sourceRepository, entry.sha256),
      });
    }
  }
  outputEntries.sort((a, b) => a.path.localeCompare(b.path));

  const sizes = recomputeSizes(outputEntries);
  const totalBytes = sizes.object_download_bytes;
  const promotedAt = utcTimestamp();
  // A replacement must coexist with the snapshot that the old signed pointer names.
  const backupId = options.replace ? `${promotedAt}-pub-${crypto.randomUUID()}` : sourceBackupId;
  const publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
  const sourceNode = sourceManifest.node || {};
  const sourceInfo = sourceManifest.source || {};
  const sourceChain = sourceManifest.chain || {};
  const sourceHead = sourceManifest.head || {};
  const sourceLib = sourceManifest.lib || {};
  const sourceSnapshot = sourceManifest.snapshot || {};
  const publicSourceMetadata = {
    backup_id: sourceBackupId,
    created_at: optionalString(sourceManifest.created_at),
    node_id: optionalString(sourceInfo.node_id),
    node_version: optionalString(sourceNode.version),
    storage_layout: optionalString(sourceInfo.storage_layout, 'unified'),
    chain_id: optionalString(sourceInfo.chain_id, sourceChain.chain_id, sourceManifest.chain_id),
    head_height: optionalSafeInteger(
      sourceManifest.head_height,
      sourceInfo.head_height,
      sourceSnapshot.head_height,
      sourceHead.height,
      sourceChain.head_height
    ),
    lib_height: optionalSafeInteger(
      sourceManifest.lib_height,
      sourceInfo.lib_height,
      sourceSnapshot.lib_height,
      sourceLib.height,
      sourceChain.lib_height
    ),
  };

  const manifest = {
    format: 'teleno-native-rocksdb-snapshot',
    version: sourceManifest.version,
    backup_id: backupId,
    created_at: optionalString(sourceManifest.created_at),
    node: {
      name: optionalString(sourceNode.name),
      version: publicSourceMetadata.node_version,
    },
    source: {
      node_id: `public-bootstrap-${options.network}`,
      storage_layout: publicSourceMetadata.storage_layout,
      network: options.network,
      chain_id: publicSourceMetadata.chain_id || '',
    },
    repository: {
      type: 'public-bootstrap-object-store',
      base_url: publicBaseUrl,
    },
    snapshot: {
      file_count: outputEntries.length,
      object_count: objects.size,
      total_bytes: totalBytes,
    },
    sizes,
    restore: {
      requires_node_stop: true,
      start_as_observer_first: true,
      force_block_producer_disabled_on_first_start: true,
    },
    public_bootstrap: {
      version: 1,
      network: options.network,
      chain_id: publicSourceMetadata.chain_id || '',
      source_backup_id: sourceBackupId,
      public_base_url: publicBaseUrl,
      promoted_at: promotedAt,
      producer_mode: false,
      sanitized_config: true,
      source: publicSourceMetadata,
      restore_space: sizes,
    },
  };

  const filesJson = {
    format: 'teleno-native-snapshot-files',
    version: sourceFilesJson.version || 1,
    backup_id: backupId,
    files: outputEntries,
  };

  const publicMetadataJson = {
    format: 'teleno-public-bootstrap-snapshot',
    version: 1,
    network: options.network,
    chain_id: publicSourceMetadata.chain_id || '',
    backup_id: backupId,
    source_backup_id: sourceBackupId,
    public_base_url: publicBaseUrl,
    promoted_at: promotedAt,
    sanitized_config_sha256: configSha,
    sanitized_config_size_bytes: configSize,
    file_count: outputEntries.length,
    object_count: objects.size,
    total_bytes: totalBytes,
    producer_mode: false,
    source: publicSourceMetadata,
    restore_space: sizes,
  };

  const signed = Boolean(options.signingPrivateKeyFile);
  const latestJson = latestForBackupId(backupId, signed);
  let signatureJson = null;
  if (signed) {
    const payload = {
      format: 'teleno-public-bootstrap-signature-payload',
      version: 1,
      algorithm: 'ed25519',
      backup_id: backupId,
      network: options.network,
      chain_id: publicSourceMetadata.chain_id || '',
      public_base_url: publicBaseUrl,
      latest_sha256: sha256Buffer(jsonBytes(latestJson)),
      manifest_sha256: sha256Buffer(jsonBytes(manifest)),
      files_sha256: sha256Buffer(jsonBytes(filesJson)),
      public_metadata_sha256: sha256Buffer(jsonBytes(publicMetadataJson)),
      object_count: objects.size,
      total_bytes: totalBytes,
      sanitized_config_sha256: configSha,
      signed_at: promotedAt,
    };
    signatureJson = signPublicBootstrapPayload(payload, options.signingPrivateKeyFile, options.signatureKeyId);
  }

  return {
    sourceRepository,
    destinationRepository,
    backupId,
    latestJson,
    manifestJson: manifest,
    filesJson,
    publicMetadataJson,
    signatureJson,
    objects,
    sanitizedConfigSha256: configSha,
    sanitizedConfigSize: configSize,
    promotedAt,
    signed,
  };
}

function verifyExistingObject(file, sha, size) {
  return fs.existsSync(file) && fs.lstatSync(file).isFile() && fs.statSync(file).size === size && sha256File(file) === sha;
}

function ensureSafeDirectory(root, relative = '', { create = true } = {}) {
  if (create && !fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (!fs.lstatSync(root).isDirectory()) {
    throw new PromotionError(`destination is not a real directory: ${root}`);
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    if (!fs.lstatSync(current).isDirectory()) {
      throw new PromotionError(`destination has a symlink or non-directory parent: ${current}`);
    }
  }
}

function assertSafeDestinationFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new PromotionError(`destination is not a regular file: ${file}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function pathExistsLstat(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function canonicalDestinationPath(file) {
  let existing = path.resolve(file);
  const missing = [];
  while (!pathExistsLstat(existing)) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

function assertIndependentRepositories(plan) {
  const source = fs.realpathSync(plan.sourceRepository);
  const destination = canonicalDestinationPath(plan.destinationRepository);
  if (destination === source || destination.startsWith(`${source}${path.sep}`)
      || source.startsWith(`${destination}${path.sep}`)) {
    throw new PromotionError('source and public destination repositories must be independent');
  }
}

function withDestinationWriteLock(destinationRepository, write) {
  ensureSafeDirectory(destinationRepository);
  const lock = path.join(destinationRepository, WRITE_LOCK);
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new PromotionError(`public bootstrap destination is locked: ${lock}`);
    }
    throw error;
  }
  try {
    return write();
  } finally {
    fs.rmdirSync(lock);
  }
}

function withStagingDirectory(parent, work) {
  const dir = fs.mkdtempSync(path.join(parent, STAGING_PREFIX));
  try {
    return work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pruneCompletedSnapshots(destinationRepository, retentionCount) {
  if (!Number.isSafeInteger(retentionCount) || retentionCount <= 0) return [];
  ensureSafeDirectory(destinationRepository, 'snapshots', { create: false });
  const snapshotsDir = path.join(destinationRepository, 'snapshots');
  const latestFile = path.join(destinationRepository, 'latest.json');
  if (!assertSafeDestinationFile(latestFile)) {
    throw new PromotionError('latest.json is missing');
  }
  const latest = readJson(latestFile);
  const currentDir = latest.snapshot_dir ?? latest.backup_id;
  const completed = fs.readdirSync(snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(STAGING_PREFIX) && !entry.name.includes('.partial'))
    .map((entry) => entry.name)
    .filter((name) => fs.lstatSync(path.join(snapshotsDir, name, 'COMPLETE'), { throwIfNoEntry: false })?.isFile())
    .sort((a, b) => a.localeCompare(b));
  if (!completed.includes(currentDir)) {
    throw new PromotionError('latest.json does not name a completed public snapshot');
  }
  const removable = completed.filter((name) => name !== currentDir && name !== latest.backup_id);
  const removed = removable.slice(0, Math.max(0, completed.length - retentionCount));
  for (const name of removed) {
    fs.rmSync(path.join(snapshotsDir, name), { recursive: true });
  }
  return removed;
}

function prunePublicSnapshots(destinationRepository, retentionCount) {
  if (!Number.isSafeInteger(retentionCount) || retentionCount <= 0) return [];
  return withDestinationWriteLock(destinationRepository, () => pruneCompletedSnapshots(destinationRepository, retentionCount));
}

function publishObject(destinationRepository, object) {
  const destination = objectPath(destinationRepository, object.sha256);
  const objectsDir = path.dirname(destination);
  ensureSafeDirectory(destinationRepository, path.relative(destinationRepository, objectsDir));
  const exists = assertSafeDestinationFile(destination);
  if (verifyExistingObject(destination, object.sha256, object.size_bytes)) return;
  if (exists) throw new PromotionError(`published object conflicts with hash: ${object.sha256}`);
  withStagingDirectory(objectsDir, (stage) => {
    const partial = path.join(stage, object.sha256);
    if (object.content !== undefined) {
      fs.writeFileSync(partial, object.content, { flag: 'wx' });
    } else {
      fs.copyFileSync(object.sourcePath, partial, fs.constants.COPYFILE_EXCL);
    }
    if (!verifyExistingObject(partial, object.sha256, object.size_bytes)) {
      throw new PromotionError(`failed to write verified object: ${object.sha256}`);
    }
    fs.renameSync(partial, destination);
  });
}

function publish(plan, { publicRetentionCount = 0 } = {}) {
  if (!plan.signatureJson) throw new PromotionError('public publication requires an Ed25519 signature');
  assertIndependentRepositories(plan);
  const destination = plan.destinationRepository;
  return withDestinationWriteLock(destination, () => {
    ensureSafeDirectory(destination, path.join('objects', 'sha256'));
    ensureSafeDirectory(destination, 'snapshots');
    const snapshotsDir = path.join(destination, 'snapshots');
    const finalSnapshot = path.join(snapshotsDir, plan.backupId);
    if (pathExistsLstat(finalSnapshot)) {
      throw new PromotionError(`destination snapshot already exists: ${finalSnapshot}`);
    }
    const latestFile = path.join(destination, 'latest.json');
    assertSafeDestinationFile(latestFile);

    for (const object of plan.objects.values()) {
      publishObject(destination, object);
    }

    // Stage beside each target so its rename stays on the target filesystem.
    withStagingDirectory(destination, (pointerStage) => {
      withStagingDirectory(snapshotsDir, (snapshotStage) => {
        const stagedSnapshot = path.join(snapshotStage, 'snapshot');
        const stagedLatest = path.join(pointerStage, 'latest.json');
        fs.mkdirSync(stagedSnapshot);
        for (const [name, bytes] of snapshotMetadata(plan)) {
          fs.writeFileSync(path.join(stagedSnapshot, name), bytes, { flag: 'wx' });
        }
        fs.writeFileSync(stagedLatest, jsonBytes(plan.latestJson), { flag: 'wx' });
        validatePublishedTree(plan, { snapshotDir: stagedSnapshot, latestFile: stagedLatest });

        // Readers of the old signed pointer keep its completed snapshot until
        // the verified successor becomes latest.
        fs.renameSync(stagedSnapshot, finalSnapshot);
        fs.renameSync(stagedLatest, latestFile);
      });
    });
    return { removedPublicSnapshots: pruneCompletedSnapshots(destination, publicRetentionCount) };
  });
}

function snapshotMetadata(plan) {
  return [
    ['manifest.json', jsonBytes(plan.manifestJson)],
    ['files.json', jsonBytes(plan.filesJson)],
    ['public-bootstrap.json', jsonBytes(plan.publicMetadataJson)],
    ['public-bootstrap-signature.json', jsonBytes(plan.signatureJson)],
    ['COMPLETE', Buffer.from('complete\n')],
  ];
}

function validatePublishedTree(plan, {
  snapshotDir = path.join(plan.destinationRepository, 'snapshots', plan.backupId),
  latestFile = path.join(plan.destinationRepository, 'latest.json'),
} = {}) {
  const destinationRepository = plan.destinationRepository;
  const readOnly = { create: false };
  ensureSafeDirectory(destinationRepository, path.join('objects', 'sha256'), readOnly);
  ensureSafeDirectory(destinationRepository, path.relative(destinationRepository, snapshotDir), readOnly);
  for (const object of plan.objects.values()) {
    const destination = objectPath(destinationRepository, object.sha256);
    ensureSafeDirectory(destinationRepository, path.relative(destinationRepository, path.dirname(destination)), readOnly);
    if (!verifyExistingObject(destination, object.sha256, object.size_bytes)) {
      throw new PromotionError(`published object failed verification: ${object.sha256}`);
    }
  }
  for (const [name, value] of snapshotMetadata(plan)) {
    const file = path.join(snapshotDir, name);
    if (!assertSafeDestinationFile(file) || !fs.readFileSync(file).equals(value)) {
      throw new PromotionError(`published snapshot failed verification: ${name}`);
    }
  }
  if (!assertSafeDestinationFile(latestFile) || !fs.readFileSync(latestFile).equals(jsonBytes(plan.latestJson))) {
    throw new PromotionError('published latest.json failed verification');
  }
}

function reportForPlan(plan, dryRun) {
  return {
    ok: true,
    dry_run: dryRun,
    backup_id: plan.backupId,
    source_backup_id: plan.publicMetadataJson.source_backup_id,
    source_repository: plan.sourceRepository,
    destination_repository: plan.destinationRepository,
    public_base_url: plan.publicMetadataJson.public_base_url,
    network: plan.publicMetadataJson.network,
    file_count: plan.publicMetadataJson.file_count,
    object_count: plan.publicMetadataJson.object_count,
    total_bytes: plan.publicMetadataJson.total_bytes,
    sanitized_config_sha256: plan.sanitizedConfigSha256,
    sanitized_config_size: plan.sanitizedConfigSize,
    promoted_at: plan.promotedAt,
    signed: plan.signed,
    signature_key_id: plan.signatureJson?.key_id || '',
    signature_public_key_sha256: plan.signatureJson?.public_key_sha256 || '',
    latest_written: !dryRun,
  };
}

function parseArgs(argv) {
  const options = { backupId: 'latest', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next) throw new PromotionError(`missing value for ${arg}`);
    index += 1;
    if (arg === '--source-repository') options.sourceRepository = next;
    else if (arg === '--backup-id') options.backupId = next;
    else if (arg === '--destination-repository') options.destinationRepository = next;
    else if (arg === '--network') options.network = next;
    else if (arg === '--public-base-url') options.publicBaseUrl = next;
    else if (arg === '--observer-config-template') options.observerConfigTemplate = next;
    else if (arg === '--signing-private-key-file') options.signingPrivateKeyFile = next;
    else if (arg === '--signature-key-id') options.signatureKeyId = next;
    else if (arg === '--report') options.report = next;
    else throw new PromotionError(`unknown argument: ${arg}`);
  }

  for (const required of ['sourceRepository', 'destinationRepository', 'network', 'publicBaseUrl', 'observerConfigTemplate']) {
    if (!options[required]) throw new PromotionError(`missing required argument: ${required}`);
  }
  if (!['testnet', 'mainnet'].includes(options.network)) {
    throw new PromotionError('--network must be testnet or mainnet');
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const plan = buildPlan(options);
    if (!options.dryRun) publish(plan);
    const report = reportForPlan(plan, options.dryRun);
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.report) fs.writeFileSync(options.report, output);
    process.stdout.write(output);
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  PromotionError,
  buildPlan,
  main,
  objectPath,
  publish,
  reportForPlan,
  canonicalizeJson,
  jsonBytes,
  sha256Buffer,
  signPublicBootstrapPayload,
  validatePublishedTree,
  prunePublicSnapshots,
};

if (require.main === module) {
  process.exitCode = main();
}
