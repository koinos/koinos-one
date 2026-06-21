#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const promote = require('./promote-public-bootstrap-backup.js');

class OverlayError extends Error {}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
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

function ensureObjectOverlay(plan) {
  const destinationObjects = path.join(plan.destinationRepository, 'objects');
  const sourceObjects = path.join(plan.sourceRepository, 'objects');
  if (!fs.existsSync(sourceObjects) || !fs.statSync(sourceObjects).isDirectory()) {
    throw new OverlayError(`source objects directory is missing: ${sourceObjects}`);
  }
  if (fs.existsSync(destinationObjects)) {
    const stat = fs.lstatSync(destinationObjects);
    if (!stat.isSymbolicLink()) {
      throw new OverlayError(`destination objects exists and is not a symlink: ${destinationObjects}`);
    }
    const resolved = fs.realpathSync(destinationObjects);
    if (resolved !== fs.realpathSync(sourceObjects)) {
      throw new OverlayError(`destination objects symlink points to ${resolved}, expected ${sourceObjects}`);
    }
    return;
  }
  fs.symlinkSync(sourceObjects, destinationObjects, 'dir');
}

function writeOverlayOnlyObject(plan, object) {
  const destination = promote.objectPath(plan.destinationRepository, object.sha256);
  if (fs.existsSync(destination)) {
    const stat = fs.statSync(destination);
    if (
      stat.isFile()
      && stat.size === object.size_bytes
      && promote.sha256Buffer(fs.readFileSync(destination)) === object.sha256
    ) {
      return;
    }
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  fs.writeFileSync(partial, object.content);
  fs.renameSync(partial, destination);
}

function completedPublicSnapshotDirs(destinationRepository) {
  const snapshotsDir = path.join(destinationRepository, 'snapshots');
  if (!fs.existsSync(snapshotsDir)) return [];
  return fs.readdirSync(snapshotsDir)
    .map((name) => path.join(snapshotsDir, name))
    .filter((entry) => {
      if (!fs.statSync(entry).isDirectory()) return false;
      if (path.basename(entry).includes('.partial')) return false;
      return fs.existsSync(path.join(entry, 'COMPLETE'));
    })
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function prunePublicSnapshots(destinationRepository, retentionCount) {
  if (!Number.isSafeInteger(retentionCount) || retentionCount <= 0) return [];
  const snapshots = completedPublicSnapshotDirs(destinationRepository);
  if (snapshots.length <= retentionCount) return [];
  const removeCount = snapshots.length - retentionCount;
  const removed = [];
  for (const snapshot of snapshots.slice(0, removeCount)) {
    fs.rmSync(snapshot, { recursive: true, force: true });
    removed.push(path.basename(snapshot));
  }
  return removed;
}

function publishOverlay(plan, options = {}) {
  fs.mkdirSync(plan.destinationRepository, { recursive: true });
  ensureObjectOverlay(plan);

  for (const object of plan.objects.values()) {
    if (object.content) writeOverlayOnlyObject(plan, object);
  }

  const finalSnapshot = path.join(plan.destinationRepository, 'snapshots', plan.backupId);
  if (fs.existsSync(finalSnapshot)) {
    if (!options.replace) {
      throw new OverlayError(`destination snapshot already exists: ${finalSnapshot}`);
    }
    fs.rmSync(finalSnapshot, { recursive: true, force: true });
  }

  const partialSnapshot = `${finalSnapshot}.partial-${process.pid}`;
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

  return {
    removedPublicSnapshots: prunePublicSnapshots(
      plan.destinationRepository,
      options.publicRetentionCount
    ),
  };
}

function parseArgs(argv) {
  const options = { backupId: 'latest', replace: false, publicRetentionCount: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--replace') {
      options.replace = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next) throw new OverlayError(`missing value for ${arg}`);
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
    else if (arg === '--public-retention-count') options.publicRetentionCount = Number.parseInt(next, 10);
    else throw new OverlayError(`unknown argument: ${arg}`);
  }
  for (const required of ['sourceRepository', 'destinationRepository', 'network', 'publicBaseUrl', 'observerConfigTemplate']) {
    if (!options[required]) throw new OverlayError(`missing required argument: ${required}`);
  }
  if (!Number.isSafeInteger(options.publicRetentionCount) || options.publicRetentionCount < 0) {
    throw new OverlayError('--public-retention-count must be a non-negative integer');
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const plan = promote.buildPlan(options);
    const overlay = publishOverlay(plan, options);
    const report = {
      ...promote.reportForPlan(plan, false),
      object_storage: 'symlink-overlay',
      source_objects: path.join(plan.sourceRepository, 'objects'),
      destination_objects: path.join(plan.destinationRepository, 'objects'),
      public_retention_count: options.publicRetentionCount,
      removed_public_snapshots: overlay.removedPublicSnapshots,
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.report) fs.writeFileSync(options.report, output);
    process.stdout.write(output);
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

module.exports = { main, publishOverlay, prunePublicSnapshots };

if (require.main === module) {
  process.exitCode = main();
}
