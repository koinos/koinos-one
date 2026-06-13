#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$ROOT_DIR/node/teleno-node/build/teleno_node}"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "teleno_node binary not found or not executable: $NODE_BIN" >&2
  exit 2
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/teleno-rocksdb-compression-gate.XXXXXX")"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

"$NODE_BIN" \
  --basedir "$WORKDIR" \
  --require-rocksdb-compression \
  --storage-report
