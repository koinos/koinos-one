#!/usr/bin/env node

const {
  ROOT,
  readTelenoNodeSemanticVersion,
  telenoNodeIdentity,
  versionMatchesSemanticVersion,
} = require('./lib/teleno-node-identity');

const failures = [];

function fail(message) {
  failures.push(message);
}

const semanticVersion = readTelenoNodeSemanticVersion(ROOT);
const identity = telenoNodeIdentity({ root: ROOT });

console.log(`teleno_node semantic version: ${semanticVersion}`);
console.log(`teleno_node release tag: ${identity.releaseTag}`);

if (identity.versionOutput) {
  console.log(`teleno_node binary version: ${identity.versionOutput}`);
  if (!versionMatchesSemanticVersion(identity.versionOutput, semanticVersion)) {
    fail(`binary --version does not match node/teleno-node/VERSION (${semanticVersion})`);
  }
} else {
  console.log('teleno_node binary version: not built in this workspace');
}

if (failures.length > 0) {
  console.error('\nteleno_node version verification failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
