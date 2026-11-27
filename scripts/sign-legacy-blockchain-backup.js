#!/usr/bin/env node
// Sign an existing legacy TAR/ZIP publication. Keep the private key outside the app.
const fs = require('fs');
const { createHash, sign } = require('crypto');
const { canonicalJson, sha256 } = require('../backend/src/legacy-signature');

function argumentsByName(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1]) throw new Error('Expected --archive --metadata --archive-url --private-key --output');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const key of ['archive', 'metadata', 'archive-url', 'private-key', 'output']) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  const url = new URL(args['archive-url']);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The archive URL must use HTTPS without credentials');
  return args;
}

async function fileSha256(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

async function main() {
  const args = argumentsByName(process.argv.slice(2));
  const payload = {
    archive_url: new URL(args['archive-url']).toString(),
    archive_sha256: await fileSha256(args.archive),
    metadata_sha256: sha256(fs.readFileSync(args.metadata))
  };
  const envelope = {
    format: 'teleno-legacy-backup-signature',
    version: 1,
    algorithm: 'ed25519',
    payload,
    signature_hex: sign(null, Buffer.from(canonicalJson(payload)), fs.readFileSync(args['private-key'])).toString('hex')
  };
  fs.writeFileSync(args.output, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Signed manifest written to ${args.output}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
