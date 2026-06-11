#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FETCH_SCRIPT="$ROOT_DIR/scripts/fetch-koinos-integration-tests.sh"
SOURCE_DIR="${KOINOS_INTEGRATION_TESTS_DIR:-/private/tmp/knodel-koinos-integration-tests}"
RUN_ROOT="${MONOLITH_STARTUP_BENCH_ROOT:-/private/tmp/knodel-monolith-startup-benchmark}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
REPORT_DIR="${REPORT_DIR:-$RUN_ROOT/$TIMESTAMP}"
BIN="${BIN:-$ROOT_DIR/node/teleno-node/build/koinos_node}"
ITERATIONS="${ITERATIONS:-5}"
START_PORT="${START_PORT:-28100}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
STARTUP_POLL_INTERVAL="${STARTUP_POLL_INTERVAL:-0.05}"
LATENCY_REQUESTS="${LATENCY_REQUESTS:-20}"
WARMUP_REQUESTS="${WARMUP_REQUESTS:-2}"
DURATION_SECONDS="${DURATION_SECONDS:-1}"

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage:
  scripts/benchmark-monolith-startup.sh

Environment:
  ITERATIONS                    Number of launch measurements. Default: 5.
  START_PORT                    First localhost JSON-RPC port. Default: 28100.
  REPORT_DIR                    Output directory.
  BIN                           koinos_node binary path.
  KOINOS_INTEGRATION_TESTS_DIR  Cached koinos-integration-tests checkout.

The wrapper launches temporary monolith nodes with P2P, gRPC, and block
production disabled, measures spawn-to-JSON-RPC readiness, and cleans up every
iteration.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"
}

port_is_free() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

fetch_source() {
  if [[ -d "$SOURCE_DIR/node_config" ]]; then
    return
  fi
  "$FETCH_SCRIPT" >/dev/null
  [[ -d "$SOURCE_DIR/node_config" ]] || die "upstream node_config missing: $SOURCE_DIR/node_config"
}

write_config() {
  local basedir="$1"
  local port="$2"
  cat > "$basedir/config.yml" <<YAML
global:
  instance-id: startup-benchmark-${port}
  log-level: info
  log-color: false
  log-datetime: true
  reset: true
  fork-algorithm: fifo
chain:
  pending-transaction-limit: 10
jsonrpc:
  listen: 127.0.0.1:${port}
block_producer:
  algorithm: federated
  private-key-file: ${basedir}/block_producer/private.key
  gossip-production: false
features:
  chain: true
  mempool: true
  block_store: true
  transaction_store: true
  contract_meta_store: true
  account_history: false
  p2p: false
  jsonrpc: true
  grpc: false
  block_producer: false
YAML
}

prepare_basedir() {
  local basedir="$1"
  local port="$2"
  mkdir -p "$basedir/chain" "$basedir/jsonrpc/descriptors" "$basedir/block_producer"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$basedir/genesis_data.json"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$basedir/chain/genesis_data.json"
  cp "$SOURCE_DIR/node_config/koinos_descriptors.pb" "$basedir/jsonrpc/descriptors/koinos_descriptors.pb"
  cp "$SOURCE_DIR/node_config/private.key" "$basedir/block_producer/private.key"
  chmod 600 "$basedir/block_producer/private.key"
  write_config "$basedir" "$port"
}

main() {
  require_tool lsof
  require_tool node
  require_tool python3
  fetch_source
  [[ -x "$BIN" ]] || die "koinos_node not executable: $BIN"
  [[ "$ITERATIONS" =~ ^[0-9]+$ ]] && (( ITERATIONS > 0 )) || die "ITERATIONS must be a positive integer"
  [[ "$START_PORT" =~ ^[0-9]+$ ]] || die "START_PORT must be an integer"

  mkdir -p "$REPORT_DIR"
  local results_file="$REPORT_DIR/results.tsv"
  printf 'iteration\tport\tstatus\tstartup_ms\tresult_dir\tjson\tlog\n' > "$results_file"

  local index
  for (( index=1; index<=ITERATIONS; index++ )); do
    local port=$((START_PORT + index - 1))
    local iter_dir="$REPORT_DIR/iteration-$index"
    local basedir="$iter_dir/basedir"
    local result_dir="$iter_dir/benchmark"
    local log_path="$iter_dir/koinos_node.log"
    port_is_free "$port" || die "port $port is already in use"
    mkdir -p "$iter_dir"
    prepare_basedir "$basedir" "$port"

    echo "iteration=${index} port=${port}"
    "$ROOT_DIR/scripts/benchmark-monolith.py" \
      --launch-bin "$BIN" \
      --launch-basedir "$basedir" \
      --launch-config "$basedir/config.yml" \
      --launch-log "$log_path" \
      --jsonrpc-listen "127.0.0.1:${port}" \
      --rpc-url "http://127.0.0.1:${port}/" \
      --startup-timeout-seconds "$STARTUP_TIMEOUT_SECONDS" \
      --startup-poll-interval "$STARTUP_POLL_INTERVAL" \
      --duration-seconds "$DURATION_SECONDS" \
      --interval-seconds 1 \
      --latency-requests "$LATENCY_REQUESTS" \
      --warmup-requests "$WARMUP_REQUESTS" \
      --result-dir "$result_dir"

    node - "$index" "$port" "$result_dir/result.json" "$log_path" "$results_file" <<'JS'
const fs = require("fs");
const [iteration, port, jsonPath, logPath, resultsPath] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const row = [
  iteration,
  port,
  result.status || "",
  result.startup_ms ?? "",
  result.result_dir || jsonPath.replace(/\/result\.json$/, ""),
  jsonPath,
  logPath,
].join("\t");
fs.appendFileSync(resultsPath, `${row}\n`);
JS
  done

  node - "$REPORT_DIR" "$results_file" <<'JS'
const fs = require("fs");
const path = require("path");
const [reportDir, resultsPath] = process.argv.slice(2);

function percentile(values, pct) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0];
  const rank = (ordered.length - 1) * (pct / 100);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return ordered[lower];
  const weight = rank - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  return {
    count: values.length,
    min: round(Math.min(...values)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    max: round(Math.max(...values)),
  };
}

const rows = fs.readFileSync(resultsPath, "utf8").trim().split(/\r?\n/).slice(1).map((line) => {
  const [iteration, port, status, startupMs, resultDir, json, log] = line.split("\t");
  return { iteration: Number(iteration), port: Number(port), status, startup_ms: Number(startupMs), result_dir: resultDir, json, log };
});
const startupValues = rows.filter((row) => row.status === "pass" && Number.isFinite(row.startup_ms)).map((row) => row.startup_ms);
const result = {
  kind: "knodel-monolith-startup-benchmark",
  status: rows.every((row) => row.status === "pass") ? "pass" : "fail",
  result_dir: reportDir,
  rows,
  startup_ms: summarize(startupValues),
};
const jsonPath = path.join(reportDir, "summary.json");
const mdPath = path.join(reportDir, "summary.md");
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

const lines = [
  "# Monolith Startup Benchmark",
  "",
  `- Status: \`${result.status}\``,
  `- Iterations: \`${rows.length}\``,
  `- Startup ms: \`${JSON.stringify(result.startup_ms)}\``,
  "",
  "| Iteration | Port | Status | Startup ms |",
  "|---:|---:|---|---:|",
  ...rows.map((row) => `| ${row.iteration} | ${row.port} | ${row.status} | ${row.startup_ms} |`),
  "",
  `JSON summary: \`${jsonPath}\``,
  "",
];
fs.writeFileSync(mdPath, lines.join("\n"));
console.log(JSON.stringify({ status: result.status, summary_json: jsonPath, summary_md: mdPath }, null, 2));
process.exit(result.status === "pass" ? 0 : 1);
JS
}

main "$@"
