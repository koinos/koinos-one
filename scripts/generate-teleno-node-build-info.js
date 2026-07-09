#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  git,
  releaseChannel,
  telenoNodeIdentity,
} = require('./lib/teleno-node-identity');

const OUTPUT_DIR = path.join(ROOT, 'build', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'teleno-node-build-info.json');

const identity = telenoNodeIdentity({ root: ROOT });
const gitStatus = git(['status', '--porcelain'], ROOT);

const buildInfo = {
  schemaVersion: 1,
  component: 'teleno_node',
  semanticVersion: identity.semanticVersion,
  buildVersion: identity.buildVersion,
  releaseTag: identity.releaseTag,
  releaseChannel: releaseChannel(identity.semanticVersion),
  buildTimestamp: new Date().toISOString(),
  gitCommit: git(['rev-parse', 'HEAD'], ROOT),
  gitShortCommit: git(['rev-parse', '--short=12', 'HEAD'], ROOT),
  gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT),
  gitDirty: gitStatus === null ? null : gitStatus.length > 0,
  binary: {
    binaryName: identity.binaryName,
    versionOutput: identity.versionOutput,
    sha256: identity.sha256,
    shortSha256: identity.shortSha256,
    sizeBytes: identity.sizeBytes,
    mtime: identity.mtime,
  },
  container: {
    image: 'ghcr.io/koinos/teleno-node',
    tags: [
      identity.semanticVersion,
      identity.releaseTag,
    ],
  },
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(buildInfo, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
