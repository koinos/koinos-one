#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/node/teleno-node"
CONFIG_EXAMPLE_DIR="$ROOT_DIR/vendor/koinos/koinos/config-example"
BIN="$NODE_DIR/build/koinos_node"
BASEDIR="$(mktemp -d -t knodel-monolith-p2p.XXXXXX)"
LOG_FILE="$(mktemp -t knodel-monolith-p2p.XXXXXX.log)"
JSONRPC_PORT="${JSONRPC_PORT:-18080}"

cleanup() {
  if [[ -n "${NODE_PID:-}" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
  fi
  rm -rf "$BASEDIR"
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

cmake -S "$NODE_DIR" -B "$NODE_DIR/build" >/tmp/knodel-monolith-p2p-cmake.log
cmake --build "$NODE_DIR/build" --target koinos_node --parallel >/tmp/knodel-monolith-p2p-build.log

mkdir -p "$BASEDIR/chain" "$BASEDIR/jsonrpc/descriptors"
cp "$CONFIG_EXAMPLE_DIR/genesis_data.json" "$BASEDIR/chain/genesis_data.json"
cp "$CONFIG_EXAMPLE_DIR/koinos_descriptors.pb" "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"
cat >"$BASEDIR/config.yml" <<YAML
global:
  log-level: info
chain:
  verify-blocks: false
p2p:
  listen: /ip4/127.0.0.1/tcp/0
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

"$BIN" --basedir="$BASEDIR" --log-level=info --enable=p2p --enable=jsonrpc >"$LOG_FILE" 2>&1 &
NODE_PID=$!

node - "$JSONRPC_PORT" <<'NODE'
const net = require('node:net')
const port = Number(process.argv[2])
const deadline = Date.now() + 30000
function probe() {
  const socket = net.connect({ host: '127.0.0.1', port })
  socket.once('connect', () => {
    socket.destroy()
    process.exit(0)
  })
  socket.once('error', () => {
    socket.destroy()
    if (Date.now() > deadline) process.exit(1)
    setTimeout(probe, 250)
  })
}
probe()
NODE

node - "$JSONRPC_PORT" <<'NODE'
const http = require('node:http')
const port = Number(process.argv[2])
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain.get_head_info', params: {} })
const req = http.request({
  host: '127.0.0.1',
  port,
  path: '/',
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data)
      if (parsed.error) throw new Error(JSON.stringify(parsed.error))
      process.exit(0)
    } catch (error) {
      console.error(error.message)
      process.exit(1)
    }
  })
})
req.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
req.write(body)
req.end()
NODE

sleep 2
if ! grep -q "\\[p2p\\] Started" "$LOG_FILE"; then
  cat "$LOG_FILE" >&2
  exit 1
fi
if ! grep -q "\\[p2p/transport\\] Started" "$LOG_FILE"; then
  cat "$LOG_FILE" >&2
  exit 1
fi

kill "$NODE_PID" 2>/dev/null || true
wait "$NODE_PID" 2>/dev/null || true
NODE_PID=""

echo "monolith p2p local smoke ok: basedir=$BASEDIR jsonrpc=127.0.0.1:${JSONRPC_PORT}"
