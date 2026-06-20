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

node - "$SOURCE_REPO" "$TEMPLATE" "$ROOT_DIR" <<'JS'
const fs = require('node:fs');
const path = require('node:path');

const sourceRepo = process.argv[2];
const template = process.argv[3];
const rootDir = process.argv[4];
const fixture = require(path.join(rootDir, 'tests', 'helpers', 'public-bootstrap-fixture.js'));

fixture.createSourceRepository(path.dirname(sourceRepo));
fs.writeFileSync(template, fixture.OBSERVER_CONFIG);
JS

cp "$TEMPLATE" "$CONFIG"

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
  --observer-config-template "$TEMPLATE" >/dev/null

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
