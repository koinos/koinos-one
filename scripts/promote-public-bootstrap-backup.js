#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const METADATA_OVERHEAD_BYTES = 128 * 1024 * 1024;
const RECOMMENDED_MIN_MARGIN_BYTES = 10 * 1024 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

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

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, jsonBytes(value));
  fs.renameSync(tmp, file);
}

function writeBytesAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
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
  if (!relativePath || path.posix.isAbsolute(relativePath)) {
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
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
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
  const lower = buffer.toString('utf8').toLowerCase();
  if (lower.includes('block_producer: true')) {
    throw new PromotionError('observer config enables block_producer feature');
  }
  if (!lower.includes('features:') || !lower.includes('block_producer: false')) {
    throw new PromotionError('observer config must explicitly disable block production');
  }
  if (!lower.includes('verify-blocks: true')) {
    throw new PromotionError('observer config must enable chain.verify-blocks');
  }
  for (const forbidden of ['private-key-file', 'password-file', 'passphrase-file', 'admin.token']) {
    if (lower.includes(forbidden)) {
      throw new PromotionError(`observer config contains forbidden setting: ${forbidden}`);
    }
  }
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

function signPublicBootstrapPayload(payload, privateKeyFile, keyId) {
  const privateKeyPem = fs.readFileSync(path.resolve(privateKeyFile));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
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

  const backupId = resolveBackupId(sourceRepository, options.backupId);
  const snapshotDir = path.join(sourceRepository, 'snapshots', backupId);
  if (!fs.existsSync(path.join(snapshotDir, 'COMPLETE'))) {
    throw new PromotionError(`snapshot is not complete: ${backupId}`);
  }

  const sourceManifest = readJson(path.join(snapshotDir, 'manifest.json'));
  const sourceFilesJson = readJson(path.join(snapshotDir, 'files.json'));
  if (sourceManifest.backup_id !== backupId) {
    throw new PromotionError('manifest backup_id does not match selected snapshot');
  }
  if (sourceFilesJson.backup_id !== backupId) {
    throw new PromotionError('files.json backup_id does not match selected snapshot');
  }

  const sourceEntries = parseFilesJson(sourceFilesJson);
  validateSourceObjects(sourceRepository, sourceEntries);

  const configTemplate = fs.readFileSync(path.resolve(options.observerConfigTemplate));
  validateObserverConfig(configTemplate);
  const configSha = sha256Buffer(configTemplate);
  const configSize = configTemplate.length;

  const outputEntries = [];
  const objects = new Map();
  for (const entry of sourceEntries) {
    if (entry.path === 'config.yml') {
      const sanitized = { path: 'config.yml', sha256: configSha, size_bytes: configSize, runtime_file: true };
      outputEntries.push(sanitized);
      objects.set(configSha, { sha256: configSha, size_bytes: configSize, content: configTemplate });
      continue;
    }
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
  const publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');

  const manifest = JSON.parse(JSON.stringify(sourceManifest));
  manifest.source = {
    node_id: `public-bootstrap-${options.network}`,
    storage_layout: sourceManifest.source?.storage_layout || 'unified',
    network: options.network,
  };
  manifest.repository = {
    type: 'public-bootstrap-object-store',
    base_url: publicBaseUrl,
  };
  manifest.snapshot = {
    file_count: outputEntries.length,
    object_count: objects.size,
    total_bytes: totalBytes,
  };
  manifest.sizes = sizes;
  manifest.restore = {
    requires_node_stop: true,
    start_as_observer_first: true,
    force_block_producer_disabled_on_first_start: true,
  };
  manifest.public_bootstrap = {
    version: 1,
    network: options.network,
    source_backup_id: backupId,
    public_base_url: publicBaseUrl,
    promoted_at: promotedAt,
    producer_mode: false,
    sanitized_config: true,
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
    backup_id: backupId,
    source_backup_id: backupId,
    public_base_url: publicBaseUrl,
    promoted_at: promotedAt,
    sanitized_config_sha256: configSha,
    file_count: outputEntries.length,
    object_count: objects.size,
    total_bytes: totalBytes,
    producer_mode: false,
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
      chain_id: sourceManifest.source?.chain_id || sourceManifest.chain_id || '',
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
  return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size === size && sha256File(file) === sha;
}

function publishObject(destinationRepository, object) {
  const destination = objectPath(destinationRepository, object.sha256);
  if (verifyExistingObject(destination, object.sha256, object.size_bytes)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  if (object.content) {
    fs.writeFileSync(partial, object.content);
  } else {
    fs.copyFileSync(object.sourcePath, partial);
  }
  if (!verifyExistingObject(partial, object.sha256, object.size_bytes)) {
    fs.rmSync(partial, { force: true });
    throw new PromotionError(`failed to write verified object: ${object.sha256}`);
  }
  fs.renameSync(partial, destination);
}

function publish(plan) {
  fs.mkdirSync(plan.destinationRepository, { recursive: true });
  for (const object of plan.objects.values()) {
    publishObject(plan.destinationRepository, object);
  }

  const snapshotsDir = path.join(plan.destinationRepository, 'snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const finalSnapshot = path.join(snapshotsDir, plan.backupId);
  if (fs.existsSync(finalSnapshot)) {
    throw new PromotionError(`destination snapshot already exists: ${finalSnapshot}`);
  }

  const partialSnapshot = path.join(snapshotsDir, `${plan.backupId}.partial-${process.pid}`);
  fs.rmSync(partialSnapshot, { recursive: true, force: true });
  fs.mkdirSync(partialSnapshot, { recursive: true });
  try {
    writeJsonAtomic(path.join(partialSnapshot, 'manifest.json'), plan.manifestJson);
    writeJsonAtomic(path.join(partialSnapshot, 'files.json'), plan.filesJson);
    writeJsonAtomic(path.join(partialSnapshot, 'public-bootstrap.json'), plan.publicMetadataJson);
    if (plan.signatureJson) {
      writeJsonAtomic(path.join(partialSnapshot, 'public-bootstrap-signature.json'), plan.signatureJson);
    }
    writeBytesAtomic(path.join(partialSnapshot, 'COMPLETE'), Buffer.from('complete\n'));
    fs.renameSync(partialSnapshot, finalSnapshot);
  } catch (error) {
    fs.rmSync(partialSnapshot, { recursive: true, force: true });
    throw error;
  }

  const latestPartial = path.join(plan.destinationRepository, 'latest.json.partial');
  writeJsonAtomic(latestPartial, plan.latestJson);
  fs.renameSync(latestPartial, path.join(plan.destinationRepository, 'latest.json'));
}

function validatePublishedTree(plan) {
  for (const object of plan.objects.values()) {
    const destination = objectPath(plan.destinationRepository, object.sha256);
    if (!verifyExistingObject(destination, object.sha256, object.size_bytes)) {
      throw new PromotionError(`published object failed verification: ${object.sha256}`);
    }
  }
  const snapshotDir = path.join(plan.destinationRepository, 'snapshots', plan.backupId);
  for (const name of ['manifest.json', 'files.json', 'COMPLETE']) {
    if (!fs.existsSync(path.join(snapshotDir, name))) {
      throw new PromotionError(`published snapshot is missing ${name}`);
    }
  }
  if (plan.signatureJson && !fs.existsSync(path.join(snapshotDir, 'public-bootstrap-signature.json'))) {
    throw new PromotionError('published signed snapshot is missing public-bootstrap-signature.json');
  }
  const latest = readJson(path.join(plan.destinationRepository, 'latest.json'));
  if (latest.backup_id !== plan.backupId) {
    throw new PromotionError('published latest.json does not point at promoted backup');
  }
}

function reportForPlan(plan, dryRun) {
  return {
    ok: true,
    dry_run: dryRun,
    backup_id: plan.backupId,
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
    if (!options.dryRun) {
      publish(plan);
      validatePublishedTree(plan);
    }
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
};

if (require.main === module) {
  process.exitCode = main();
}
