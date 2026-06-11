#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P2P_FIXTURES_DIR="${P2P_FIXTURES_DIR:-$ROOT_DIR/compat/koinos-p2p-fixtures}"
NODE_DIR="$ROOT_DIR/node/teleno-node"
LOG_FILE="$(mktemp -t knodel-gossip-fixture.XXXXXX.log)"

cleanup() {
  if [[ -n "${FIXTURE_PID:-}" ]] && kill -0 "$FIXTURE_PID" 2>/dev/null; then
    kill "$FIXTURE_PID" 2>/dev/null || true
    wait "$FIXTURE_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

cmake -S "$NODE_DIR" -B "$NODE_DIR/build" >/tmp/knodel-gossip-cmake.log
cmake --build "$NODE_DIR/build" --target koinos_libp2p_gossip_live_test --parallel \
  >/tmp/knodel-gossip-build.log

(cd "$P2P_FIXTURES_DIR" && go run ./cmd/gossip-fixture >"$LOG_FILE" 2>&1) &
FIXTURE_PID=$!

PEER_ADDR=""
for _ in {1..100}; do
  if ! kill -0 "$FIXTURE_PID" 2>/dev/null; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi

  if [[ -s "$LOG_FILE" ]]; then
    PEER_ADDR="$(head -n 1 "$LOG_FILE")"
    if [[ "$PEER_ADDR" == /ip4/*/p2p/* ]]; then
      break
    fi
    PEER_ADDR=""
  fi
  sleep 0.1
done

if [[ -z "$PEER_ADDR" ]]; then
  echo "gossip-fixture did not print a peer address" >&2
  cat "$LOG_FILE" >&2 || true
  exit 1
fi

"$NODE_DIR/build/koinos_libp2p_gossip_live_test" "$PEER_ADDR"

set +e
wait "$FIXTURE_PID"
FIXTURE_STATUS=$?
set -e
FIXTURE_PID=""

if [[ "$FIXTURE_STATUS" -ne 0 ]] || ! grep -q "gossip fixture interop ok" "$LOG_FILE"; then
  cat "$LOG_FILE" >&2 || true
  exit 1
fi

echo "gossip interop smoke ok: $PEER_ADDR"
