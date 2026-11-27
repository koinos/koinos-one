const fs = require('fs');
const { createHash, createPublicKey, verify } = require('crypto');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadLegacyBackupPublicKey(publicKeyFile) {
  if (!publicKeyFile) {
    throw new Error('Set TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE to a trusted Ed25519 public key for remote backups');
  }
  let publicKey;
  try {
    publicKey = createPublicKey(fs.readFileSync(publicKeyFile));
  } catch (error) {
    throw new Error('Could not read the configured legacy backup public key', { cause: error });
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('The legacy backup public key must be Ed25519');
  return publicKey;
}

function verifyLegacyManifest(envelope, archiveUrl, metadataBytes, publicKey) {
  const payload = envelope && envelope.payload;
  if (envelope?.format !== 'teleno-legacy-backup-signature' || envelope.version !== 1 ||
      envelope.algorithm !== 'ed25519' || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof envelope.signature_hex !== 'string' || !/^[0-9a-f]{128}$/i.test(envelope.signature_hex)) {
    throw new Error('Invalid legacy backup signature envelope');
  }
  if (!verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(envelope.signature_hex, 'hex'))) {
    throw new Error('Legacy backup signature does not match the trusted key');
  }
  if (payload.archive_url !== archiveUrl || payload.metadata_sha256 !== sha256(metadataBytes) ||
      typeof payload.archive_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.archive_sha256)) {
    throw new Error('Legacy backup signed manifest does not match the archive or metadata');
  }
  return payload.archive_sha256;
}

module.exports = { canonicalJson, sha256, loadLegacyBackupPublicKey, verifyLegacyManifest };
