#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const promote = require('./promote-public-bootstrap-backup.js');

class OverlayError extends Error {}

function publishOverlay(plan, options = {}) {
  const sourceObjects = path.join(plan.sourceRepository, 'objects');
  if (!fs.lstatSync(sourceObjects, { throwIfNoEntry: false })?.isDirectory()) {
    throw new OverlayError(`source objects directory is missing: ${sourceObjects}`);
  }
  return promote.publish(plan, { publicRetentionCount: options.publicRetentionCount });
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
    else if (arg === '--public-retention-count') options.publicRetentionCount = /^\d+$/.test(next) ? Number(next) : NaN;
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
      object_storage: 'copied-allowlisted',
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

module.exports = { main, publishOverlay, prunePublicSnapshots: promote.prunePublicSnapshots };

if (require.main === module) {
  process.exitCode = main();
}
