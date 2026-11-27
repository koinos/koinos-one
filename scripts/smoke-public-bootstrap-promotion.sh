#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$ROOT_DIR/node/teleno-node/build/teleno_node}"
SMOKE_ROOT="${TELENO_PUBLIC_BOOTSTRAP_SMOKE_ROOT:-/private/tmp/teleno-public-bootstrap-smoke/$(date -u +%Y%m%dT%H%M%SZ)}"
SOURCE_REPO="$SMOKE_ROOT/source-repository"
PUBLIC_REPO="$SMOKE_ROOT/teleno-bootstrap"
TEMPLATE="$SMOKE_ROOT/observer-template.yml"
BASEDIR="$SMOKE_ROOT/restore-basedir"
CONFIG="$BASEDIR/config.yml"

die() {
  echo "error: $*" >&2
  exit 1
}

[[ -x "$NODE_BIN" ]] || die "teleno_node binary not found or not executable: $NODE_BIN"

mkdir -p "$SMOKE_ROOT" "$BASEDIR"

SIGNING_DIR="$(mktemp -d "$SMOKE_ROOT/signing.XXXXXXXX")"
cleanup_signing() {
  rm -f -- "$SIGNING_DIR/private.pem" "$SIGNING_DIR/public.pem"
  rmdir -- "$SIGNING_DIR"
}
trap cleanup_signing EXIT

node - "$SMOKE_ROOT" "$TEMPLATE" "$CONFIG" "$SIGNING_DIR" "$ROOT_DIR" <<'JS'
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [smokeRoot, template, config, signingDir, rootDir] = process.argv.slice(2);
const fixture = require(path.join(rootDir, 'tests', 'helpers', 'public-bootstrap-fixture.js'));

fixture.createSourceRepository(smokeRoot);
fs.writeFileSync(template, fixture.OBSERVER_CONFIG);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyFile = path.resolve(signingDir, 'public.pem');
fs.writeFileSync(path.join(signingDir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(config, JSON.stringify({
  features: { block_producer: false },
  chain: { 'verify-blocks': true },
  backup: {
    enabled: false,
    'public-restore': {
      enabled: true,
      network: 'testnet',
      'signature-required': true,
      'signature-public-key-file': publicKeyFile,
    },
  },
}, null, 2) + '\n');
JS

node "$ROOT_DIR/scripts/promote-public-bootstrap-backup.js" \
  --source-repository "$SOURCE_REPO" \
  --destination-repository "$PUBLIC_REPO" \
  --network testnet \
  --public-base-url "file://$PUBLIC_REPO" \
  --observer-config-template "$TEMPLATE" \
  --dry-run >/dev/null

node "$ROOT_DIR/scripts/promote-public-bootstrap-backup.js" \
  --source-repository "$SOURCE_REPO" \
  --destination-repository "$PUBLIC_REPO" \
  --network testnet \
  --public-base-url "file://$PUBLIC_REPO" \
  --observer-config-template "$TEMPLATE" \
  --signing-private-key-file "$SIGNING_DIR/private.pem" >/dev/null

"$NODE_BIN" \
  --basedir "$BASEDIR" \
  --config "$CONFIG" \
  --backup-public-list \
  --backup-public-url "file://$PUBLIC_REPO" \
  --backup-json >/dev/null

"$NODE_BIN" \
  --basedir "$BASEDIR" \
  --config "$CONFIG" \
  --backup-public-fetch \
  --backup-public-url "file://$PUBLIC_REPO" \
  --backup-id latest \
  --backup-json >/dev/null

echo "public bootstrap promotion smoke passed: $SMOKE_ROOT"
