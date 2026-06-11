#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P2P_FIXTURES_DIR="${P2P_FIXTURES_DIR:-$ROOT_DIR/compat/koinos-p2p-fixtures}"
NODE_DIR="$ROOT_DIR/node/teleno-node"
LOG_FILE="$(mktemp -t teleno-peer-rpc-fixture.XXXXXX.log)"

cleanup() {
  if [[ -n "${FIXTURE_PID:-}" ]] && kill -0 "$FIXTURE_PID" 2>/dev/null; then
    kill "$FIXTURE_PID" 2>/dev/null || true
    wait "$FIXTURE_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

cmake -S "$NODE_DIR" -B "$NODE_DIR/build" >/tmp/teleno-one-peer-sync-cmake.log
cmake --build "$NODE_DIR/build" --target \
  koinos_p2p_one_peer_sync_test \
  koinos_libp2p_peer_rpc_live_test \
  koinos_libp2p_one_peer_sync_live_test \
  --parallel >/tmp/teleno-one-peer-sync-build.log

(cd "$P2P_FIXTURES_DIR" && go run ./cmd/peer-rpc-fixture >"$LOG_FILE" 2>&1) &
FIXTURE_PID=$!

PEER_ADDR=""
for _ in {1..100}; do
  if [[ -s "$LOG_FILE" ]]; then
    PEER_ADDR="$(head -n 1 "$LOG_FILE")"
    break
  fi
  sleep 0.1
done

if [[ -z "$PEER_ADDR" ]]; then
  echo "peer-rpc-fixture did not print a peer address" >&2
  cat "$LOG_FILE" >&2 || true
  exit 1
fi

"$NODE_DIR/build/koinos_p2p_one_peer_sync_test"
"$NODE_DIR/build/koinos_libp2p_peer_rpc_live_test" "$PEER_ADDR"
"$NODE_DIR/build/koinos_libp2p_one_peer_sync_live_test" "$PEER_ADDR"

echo "one-peer-sync smoke ok: $PEER_ADDR"
