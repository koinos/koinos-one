#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/node/teleno-node"
CONFIG_EXAMPLE_DIR="$ROOT_DIR/vendor/koinos/koinos/config-example"
BIN="$NODE_DIR/build/koinos_node"
SOAK_DURATION_SECONDS="${SOAK_DURATION_SECONDS:-172800}"
SOAK_INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-60}"
SOAK_REQUIRE_PROGRESS="${SOAK_REQUIRE_PROGRESS:-1}"
SOAK_REQUIRE_HEAD_PROGRESS="${SOAK_REQUIRE_HEAD_PROGRESS:-1}"
SOAK_MIN_HEAD_HEIGHT="${SOAK_MIN_HEAD_HEIGHT:-1}"
SOAK_STARTUP_GRACE_SECONDS="${SOAK_STARTUP_GRACE_SECONDS:-900}"
JSONRPC_PORT="${JSONRPC_PORT:-18081}"
P2P_LISTEN="${P2P_LISTEN:-/ip4/0.0.0.0/tcp/8888}"
P2P_PEERS_FILE="${P2P_PEERS_FILE:-$ROOT_DIR/scripts/mainnet-peer-candidates.txt}"
BASEDIR="${MONOLITH_SOAK_BASEDIR:-$(mktemp -d -t teleno-mainnet-soak.XXXXXX)}"
LOG_FILE="${MONOLITH_SOAK_LOG:-$(mktemp -t teleno-mainnet-soak.XXXXXX.log)}"
REPORT_FILE="${MONOLITH_SOAK_REPORT:-$ROOT_DIR/docs/roadmap/monolith/networking/MONOLITH_GATE_F_SOAK_REPORT.md}"
OWN_BASEDIR=0

DEFAULT_P2P_PEERS=(
  "/ip4/46.62.204.73/tcp/8888/p2p/QmPcF1YrxamfKGpyvP6uAZcPxnmK2WUBC4K4N5ZaWky8Sh"
  "/ip4/37.27.7.221/tcp/8888/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs"
  "/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea"
  "/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi"
  "/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8"
)

if [[ -n "${P2P_PEERS:-}" ]]; then
  IFS=',' read -r -a P2P_PEER_LIST <<<"$P2P_PEERS"
elif [[ -f "$P2P_PEERS_FILE" ]]; then
  P2P_PEER_LIST=()
  while IFS= read -r peer; do
    peer="${peer%%#*}"
    peer="${peer#"${peer%%[![:space:]]*}"}"
    peer="${peer%"${peer##*[![:space:]]}"}"
    [[ -n "$peer" ]] && P2P_PEER_LIST+=("$peer")
  done <"$P2P_PEERS_FILE"
else
  P2P_PEER_LIST=("${DEFAULT_P2P_PEERS[@]}")
fi

if [[ -z "${MONOLITH_SOAK_BASEDIR:-}" ]]; then
  OWN_BASEDIR=1
fi

cleanup() {
  if [[ -n "${NODE_PID:-}" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
  fi
  if [[ "$OWN_BASEDIR" -eq 1 ]]; then
    rm -rf "$BASEDIR"
  fi
}
trap cleanup EXIT

cmake -S "$NODE_DIR" -B "$NODE_DIR/build" >/tmp/teleno-mainnet-soak-cmake.log
cmake --build "$NODE_DIR/build" --target koinos_node --parallel >/tmp/teleno-mainnet-soak-build.log

mkdir -p "$(dirname "$REPORT_FILE")"
mkdir -p "$BASEDIR/chain" "$BASEDIR/jsonrpc/descriptors"
cp "$CONFIG_EXAMPLE_DIR/genesis_data.json" "$BASEDIR/chain/genesis_data.json"
cp "$CONFIG_EXAMPLE_DIR/koinos_descriptors.pb" "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"
cat >"$BASEDIR/config.yml" <<YAML
global:
  log-level: info
chain:
  verify-blocks: false
p2p:
  listen: ${P2P_LISTEN}
  seed-reconnect-interval-seconds: 60
  peer:
YAML
for peer in "${P2P_PEER_LIST[@]}"; do
  echo "    - ${peer}" >>"$BASEDIR/config.yml"
done
cat >>"$BASEDIR/config.yml" <<YAML
jsonrpc:
  listen: 127.0.0.1:${JSONRPC_PORT}
features:
  chain: true
  mempool: true
  block_store: true
  p2p: true
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: true
  transaction_store: true
  account_history: false
YAML

started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$REPORT_FILE" <<MD
# Monolith Gate F Soak Report

- Started: ${started_at}
- Duration target: ${SOAK_DURATION_SECONDS}s
- Sample interval: ${SOAK_INTERVAL_SECONDS}s
- Require progress: ${SOAK_REQUIRE_PROGRESS}
- Require head progress: ${SOAK_REQUIRE_HEAD_PROGRESS}
- Minimum head height: ${SOAK_MIN_HEAD_HEIGHT}
- Startup progress grace: ${SOAK_STARTUP_GRACE_SECONDS}s
- BASEDIR: ${BASEDIR}
- Log file: ${LOG_FILE}
- JSON-RPC: 127.0.0.1:${JSONRPC_PORT}
- P2P listen: ${P2P_LISTEN}
- P2P peers:
$(printf '  - `%s`\n' "${P2P_PEER_LIST[@]}")

| UTC time | pid | RSS KB | head height | peer log rows | peer connected | peer disconnected | handshake rows | sync rows | score threshold | note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
MD

"$BIN" --basedir="$BASEDIR" --log-level=info --enable=p2p --enable=jsonrpc >"$LOG_FILE" 2>&1 &
NODE_PID=$!
deadline=$(( $(date +%s) + SOAK_DURATION_SECONDS ))
max_head_height=0
max_peer_rows=0
max_peer_connected_rows=0
max_peer_disconnected_rows=0
max_handshake_rows=0
max_sync_rows=0
max_score_threshold_rows=0
progress_seen=0

while [[ "$(date +%s)" -lt "$deadline" ]]; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "| $(date -u +%Y-%m-%dT%H:%M:%SZ) | ${NODE_PID} | 0 | n/a | 0 | 0 | 0 | 0 | 0 | 0 | process exited |" >>"$REPORT_FILE"
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi

  rss="$(ps -o rss= -p "$NODE_PID" | tr -d ' ' || true)"
  rss="${rss:-0}"
  head_height="$(node - "$JSONRPC_PORT" <<'NODE' || true
const http = require('node:http')
const port = Number(process.argv[2])
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'node.get_status', params: {} })
const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'POST', timeout: 5000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data)
      const height = parsed.result?.head_height ?? parsed.result?.headHeight
      console.log(height ?? 'n/a')
    } catch {
      console.log('n/a')
    }
  })
})
req.on('timeout', () => { req.destroy(); console.log('timeout') })
req.on('error', () => console.log('n/a'))
req.write(body)
req.end()
NODE
)"
  peer_rows="$(grep -c "\\[p2p\\].* - " "$LOG_FILE" || true)"
  peer_connected_rows="$(grep -c "\\[p2p\\] Peer connected:" "$LOG_FILE" || true)"
  peer_disconnected_rows="$(grep -c "\\[p2p\\] Peer disconnected:" "$LOG_FILE" || true)"
  handshake_rows="$(grep -c "\\[p2p\\] Handshake complete" "$LOG_FILE" || true)"
  sync_rows="$(grep -c "\\[p2p\\] Syncing from" "$LOG_FILE" || true)"
  score_threshold_rows="$(grep -c "score threshold exceeded" "$LOG_FILE" || true)"
  current_connected=0
  if [[ "$peer_connected_rows" =~ ^[0-9]+$ && "$peer_disconnected_rows" =~ ^[0-9]+$ ]]; then
    current_connected=$(( peer_connected_rows - peer_disconnected_rows ))
    if [[ "$current_connected" -lt 0 ]]; then
      current_connected=0
    fi
  fi
  note="ok"
  if [[ "$head_height" == "n/a" || "$head_height" == "timeout" ]]; then
    note="jsonrpc-not-ready"
  elif [[ "$score_threshold_rows" =~ ^[0-9]+$ && "$score_threshold_rows" -gt 0 ]]; then
    note="score-threshold"
  elif [[ "$current_connected" -eq 0 && "$peer_disconnected_rows" =~ ^[0-9]+$ && "$peer_disconnected_rows" -gt 0 ]]; then
    note="disconnected"
  elif [[ "$head_height" == "0" && "$sync_rows" =~ ^[0-9]+$ && "$sync_rows" -eq 0 && "$handshake_rows" =~ ^[0-9]+$ && "$handshake_rows" -gt 0 ]]; then
    note="handshake-no-sync"
  elif [[ "$head_height" == "0" && "$peer_rows" =~ ^[0-9]+$ && "$peer_rows" -gt 0 ]]; then
    note="connected-no-sync"
  fi
  if [[ "$head_height" =~ ^[0-9]+$ && "$head_height" -gt "$max_head_height" ]]; then
    max_head_height="$head_height"
  fi
  if [[ "$peer_rows" =~ ^[0-9]+$ && "$peer_rows" -gt "$max_peer_rows" ]]; then
    max_peer_rows="$peer_rows"
  fi
  if [[ "$peer_connected_rows" =~ ^[0-9]+$ && "$peer_connected_rows" -gt "$max_peer_connected_rows" ]]; then
    max_peer_connected_rows="$peer_connected_rows"
  fi
  if [[ "$peer_disconnected_rows" =~ ^[0-9]+$ && "$peer_disconnected_rows" -gt "$max_peer_disconnected_rows" ]]; then
    max_peer_disconnected_rows="$peer_disconnected_rows"
  fi
  if [[ "$handshake_rows" =~ ^[0-9]+$ && "$handshake_rows" -gt "$max_handshake_rows" ]]; then
    max_handshake_rows="$handshake_rows"
  fi
  if [[ "$sync_rows" =~ ^[0-9]+$ && "$sync_rows" -gt "$max_sync_rows" ]]; then
    max_sync_rows="$sync_rows"
  fi
  if [[ "$score_threshold_rows" =~ ^[0-9]+$ && "$score_threshold_rows" -gt "$max_score_threshold_rows" ]]; then
    max_score_threshold_rows="$score_threshold_rows"
  fi
  if [[ "$SOAK_REQUIRE_HEAD_PROGRESS" != "0" ]]; then
    [[ "$max_head_height" -ge "$SOAK_MIN_HEAD_HEIGHT" ]] && progress_seen=1
  elif [[ "$max_head_height" -gt 0 || "$max_handshake_rows" -gt 0 || "$max_peer_rows" -gt 0 ]]; then
    progress_seen=1
  fi
  echo "| $(date -u +%Y-%m-%dT%H:%M:%SZ) | ${NODE_PID} | ${rss} | ${head_height} | ${peer_rows} | ${peer_connected_rows} | ${peer_disconnected_rows} | ${handshake_rows} | ${sync_rows} | ${score_threshold_rows} | ${note} |" >>"$REPORT_FILE"

  elapsed=$(( $(date +%s) - started_epoch ))
  if [[ "$SOAK_REQUIRE_PROGRESS" != "0" && "$elapsed" -ge "$SOAK_STARTUP_GRACE_SECONDS" && "$progress_seen" -eq 0 ]]; then
    cat >>"$REPORT_FILE" <<MD

Aborted: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Result: invalid soak. Required progress was not observed within the startup grace window of ${SOAK_STARTUP_GRACE_SECONDS}s. Minimum head height: ${SOAK_MIN_HEAD_HEIGHT}; max head height: ${max_head_height}; max peer rows: ${max_peer_rows}; max peer connected rows: ${max_peer_connected_rows}; max peer disconnected rows: ${max_peer_disconnected_rows}; max handshake rows: ${max_handshake_rows}; max sync rows: ${max_sync_rows}; max score threshold rows: ${max_score_threshold_rows}.
MD
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi

  sleep "$SOAK_INTERVAL_SECONDS"
done

kill "$NODE_PID" 2>/dev/null || true
wait "$NODE_PID" 2>/dev/null || true
NODE_PID=""

if [[ "$SOAK_REQUIRE_PROGRESS" != "0" && "$SOAK_REQUIRE_HEAD_PROGRESS" != "0" && "$max_head_height" -lt "$SOAK_MIN_HEAD_HEIGHT" ]]; then
  cat >>"$REPORT_FILE" <<MD

Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Result: invalid soak. Process stayed alive, but required head height progress was not observed.
Minimum required head height: ${SOAK_MIN_HEAD_HEIGHT}
Max observed head height: ${max_head_height}
Max observed peer log rows: ${max_peer_rows}
Max observed peer connected rows: ${max_peer_connected_rows}
Max observed peer disconnected rows: ${max_peer_disconnected_rows}
Max observed handshake rows: ${max_handshake_rows}
Max observed sync rows: ${max_sync_rows}
Max observed score threshold rows: ${max_score_threshold_rows}
MD
  exit 1
fi

if [[ "$SOAK_REQUIRE_PROGRESS" != "0" && "$max_score_threshold_rows" -gt 0 ]]; then
  cat >>"$REPORT_FILE" <<MD

Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Result: invalid soak. Process stayed alive, but at least one peer exceeded the score threshold.
Max observed head height: ${max_head_height}
Max observed peer log rows: ${max_peer_rows}
Max observed peer connected rows: ${max_peer_connected_rows}
Max observed peer disconnected rows: ${max_peer_disconnected_rows}
Max observed handshake rows: ${max_handshake_rows}
Max observed sync rows: ${max_sync_rows}
Max observed score threshold rows: ${max_score_threshold_rows}
MD
  exit 1
fi

cat >>"$REPORT_FILE" <<MD

Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Result: process stayed alive for requested duration and accepted shutdown.
Max observed head height: ${max_head_height}
Max observed peer log rows: ${max_peer_rows}
Max observed peer connected rows: ${max_peer_connected_rows}
Max observed peer disconnected rows: ${max_peer_disconnected_rows}
Max observed handshake rows: ${max_handshake_rows}
Max observed sync rows: ${max_sync_rows}
Max observed score threshold rows: ${max_score_threshold_rows}
MD

echo "mainnet p2p soak completed: report=$REPORT_FILE log=$LOG_FILE"
