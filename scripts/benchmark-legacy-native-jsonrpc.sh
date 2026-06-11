#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FETCH_SCRIPT="$ROOT_DIR/scripts/fetch-koinos-integration-tests.sh"
SOURCE_DIR="${KOINOS_INTEGRATION_TESTS_DIR:-/private/tmp/knodel-koinos-integration-tests}"
RUN_ROOT="${LEGACY_NATIVE_BENCH_ROOT:-/private/tmp/knodel-legacy-native-benchmark}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
REPORT_DIR="${REPORT_DIR:-$RUN_ROOT/$TIMESTAMP}"
BASEDIR="$REPORT_DIR/basedir"
LOGS_DIR="$REPORT_DIR/logs"
AMQP_PORT="${LEGACY_NATIVE_BENCH_AMQP_PORT:-25674}"
AMQP_ADMIN_PORT="${LEGACY_NATIVE_BENCH_AMQP_ADMIN_PORT:-35674}"
JSONRPC_PORT="${LEGACY_NATIVE_BENCH_JSONRPC_PORT:-28081}"
AMQP_URL="amqp://guest:guest@127.0.0.1:${AMQP_PORT}/"
BENCHMARK_DIR="$REPORT_DIR/benchmark"
SERVICE_SAMPLE_CSV="$REPORT_DIR/service-samples.csv"
SERVICE_SAMPLE_SUMMARY="$REPORT_DIR/service-samples-summary.txt"
DURATION_SECONDS="${DURATION_SECONDS:-120}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
LATENCY_REQUESTS="${LATENCY_REQUESTS:-500}"
WARMUP_REQUESTS="${WARMUP_REQUESTS:-20}"

PIDS=()
SERVICE_NAMES=()
SAMPLER_PID=""

die() {
  echo "error: $*" >&2
  exit 1
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"
}

legacy_bin() {
  local var_name="$1"
  local label="$2"
  local path="${!var_name:-}"
  [[ -n "$path" ]] || die "${label} binary path is not configured; set ${var_name}"
  [[ -x "$path" ]] || die "${label} binary missing or not executable: $path"
  printf '%s\n' "$path"
}

port_is_free() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

cleanup() {
  local pid
  if [[ -n "$SAMPLER_PID" ]] && kill -0 "$SAMPLER_PID" 2>/dev/null; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi

  if (( ${#PIDS[@]} > 0 )); then
    for (( idx=${#PIDS[@]}-1; idx>=0; idx-- )); do
      pid="${PIDS[$idx]}"
      if kill -0 "$pid" 2>/dev/null; then
        kill -INT "$pid" 2>/dev/null || true
      fi
    done
    sleep 5
    for (( idx=${#PIDS[@]}-1; idx>=0; idx-- )); do
      pid="${PIDS[$idx]}"
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
    sleep 3
    for (( idx=${#PIDS[@]}-1; idx>=0; idx-- )); do
      pid="${PIDS[$idx]}"
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi
}

trap cleanup EXIT

write_amqp_config() {
  local config_path="$1"
  local db_path="$2"
  cat > "$config_path" <<YAML
proto: amqp-rabbit
users:
  - username: guest
    password: 084e0343a0486ff05530df6c705c8bb4
tcp:
  ip: 127.0.0.1
  port: ${AMQP_PORT}
  nodelay: false
  readBufSize: 196608
  writeBufSize: 196608
admin:
  ip: 127.0.0.1
  port: ${AMQP_ADMIN_PORT}
queue:
  shardSize: 8192
  maxMessagesInRam: 131072
db:
  defaultPath: ${db_path}
  engine: badger
vhost:
  defaultPath: /
security:
  passwordCheck: md5
connection:
  channelsMax: 4096
  frameMaxSize: 65536
YAML
}

fetch_source() {
  if [[ -d "$SOURCE_DIR/node_config" ]]; then
    return
  fi
  "$FETCH_SCRIPT" >/dev/null
  [[ -d "$SOURCE_DIR/node_config" ]] || die "upstream node_config missing: $SOURCE_DIR/node_config"
}

prepare_basedir() {
  mkdir -p "$BASEDIR/chain" "$BASEDIR/jsonrpc/descriptors" "$BASEDIR/amqp" "$LOGS_DIR"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$BASEDIR/chain/genesis_data.json"
  cp "$SOURCE_DIR/node_config/koinos_descriptors.pb" "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"
  write_amqp_config "$BASEDIR/amqp/garagemq.yaml" "$BASEDIR/amqp/db"
}

start_logged_process() {
  local name="$1"
  local log_path="$2"
  shift 2
  echo "start_${name}_log=$log_path"
  "$@" >"$log_path" 2>&1 &
  local pid="$!"
  disown "$pid" 2>/dev/null || true
  PIDS+=("$pid")
  SERVICE_NAMES+=("$name")
  echo "$pid" > "$REPORT_DIR/${name}.pid"
  echo "start_${name}_pid=$pid"
}

wait_tcp_ready() {
  local host="$1"
  local port="$2"
  local name="$3"
  local timeout="${4:-30}"
  local deadline=$((SECONDS + timeout))

  until nc -z "$host" "$port" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 1
  done
  echo "${name}_ready=${host}:${port}"
}

wait_rpc_ready() {
  local deadline=$((SECONDS + 60))
  local response="$REPORT_DIR/rpc-ready-response.json"
  local error_log="$REPORT_DIR/rpc-ready-last-error.log"
  local body='{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}'

  until curl -fsS --max-time 5 "http://127.0.0.1:${JSONRPC_PORT}/" \
      -H 'content-type: application/json' \
      --data-binary "$body" >"$response" 2>"$error_log" \
      && python3 - "$response" >"$error_log" 2>&1 <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    parsed = json.load(handle)
if "error" in parsed:
    print(json.dumps(parsed["error"], sort_keys=True), file=sys.stderr)
    raise SystemExit(3)
PY
  do
    if (( SECONDS >= deadline )); then
      cat "$error_log" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "rpc_ready=http://127.0.0.1:${JSONRPC_PORT}/"
}

sample_services() {
  echo "timestamp,service,pid,rss_kib,cpu_percent" > "$SERVICE_SAMPLE_CSV"
  while true; do
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local index
    for index in "${!PIDS[@]}"; do
      local pid="${PIDS[$index]}"
      local name="${SERVICE_NAMES[$index]}"
      if kill -0 "$pid" 2>/dev/null; then
        ps -o rss= -o pcpu= -p "$pid" | awk -v ts="$ts" -v svc="$name" -v pid="$pid" '
          NF >= 2 { printf "%s,%s,%s,%s,%s\n", ts, svc, pid, $1, $2 }
        ' >> "$SERVICE_SAMPLE_CSV"
      fi
    done
    sleep "$INTERVAL_SECONDS"
  done
}

summarize_service_samples() {
  if [[ ! -s "$SERVICE_SAMPLE_CSV" ]]; then
    return
  fi
  awk -F, '
    NR > 1 {
      svc=$2
      ts=$1
      rss=$4 + 0
      cpu=$5 + 0
      service_count[svc] += 1
      service_rss_sum[svc] += rss
      service_cpu_sum[svc] += cpu
      if (rss > service_rss_max[svc]) service_rss_max[svc] = rss
      if (cpu > service_cpu_max[svc]) service_cpu_max[svc] = cpu
      total_rss[ts] += rss
      total_cpu[ts] += cpu
    }
    END {
      print "# Legacy Native Service Samples"
      print ""
      print "## Per Service"
      print ""
      print "| Service | Samples | RSS mean MB | RSS max MB | CPU mean % | CPU max % |"
      print "|---|---:|---:|---:|---:|---:|"
      for (svc in service_count) {
        printf "| %s | %d | %.3f | %.3f | %.3f | %.3f |\n", svc, service_count[svc], service_rss_sum[svc] / service_count[svc] / 1024, service_rss_max[svc] / 1024, service_cpu_sum[svc] / service_count[svc], service_cpu_max[svc]
      }
      print ""
      print "## Stack Totals"
      print ""
      stack_samples = 0
      for (ts in total_rss) {
        stack_samples += 1
        stack_rss_sum += total_rss[ts]
        stack_cpu_sum += total_cpu[ts]
        if (total_rss[ts] > stack_rss_max) stack_rss_max = total_rss[ts]
        if (total_cpu[ts] > stack_cpu_max) stack_cpu_max = total_cpu[ts]
      }
      if (stack_samples > 0) {
        printf "- Samples: `%d`\n", stack_samples
        printf "- RSS mean MB: `%.3f`\n", stack_rss_sum / stack_samples / 1024
        printf "- RSS max MB: `%.3f`\n", stack_rss_max / 1024
        printf "- CPU mean %%: `%.3f`\n", stack_cpu_sum / stack_samples
        printf "- CPU max %%: `%.3f`\n", stack_cpu_max
      }
    }
  ' "$SERVICE_SAMPLE_CSV" > "$SERVICE_SAMPLE_SUMMARY"
}

main() {
  require_tool curl
  require_tool lsof
  require_tool nc
  require_tool ps
  require_tool awk
  require_tool python3

  port_is_free "$AMQP_PORT" || die "AMQP port $AMQP_PORT is already in use"
  port_is_free "$AMQP_ADMIN_PORT" || die "AMQP admin port $AMQP_ADMIN_PORT is already in use"
  port_is_free "$JSONRPC_PORT" || die "JSON-RPC port $JSONRPC_PORT is already in use"

  fetch_source
  mkdir -p "$REPORT_DIR"
  prepare_basedir

  local garagemq
  local chain
  local block_store
  local mempool
  local jsonrpc
  garagemq="$(legacy_bin LEGACY_GARAGEMQ_BIN GarageMQ)"
  chain="$(legacy_bin LEGACY_CHAIN_BIN koinos_chain)"
  block_store="$(legacy_bin LEGACY_BLOCK_STORE_BIN koinos-block-store)"
  mempool="$(legacy_bin LEGACY_MEMPOOL_BIN koinos_mempool)"
  jsonrpc="$(legacy_bin LEGACY_JSONRPC_BIN koinos-jsonrpc)"

  echo "report_dir=$REPORT_DIR"
  echo "basedir=$BASEDIR"
  echo "jsonrpc_url=http://127.0.0.1:${JSONRPC_PORT}/"

  start_logged_process amqp "$LOGS_DIR/amqp.log" "$garagemq" --config "$BASEDIR/amqp/garagemq.yaml"
  wait_tcp_ready 127.0.0.1 "$AMQP_PORT" amqp 20 || die "GarageMQ did not open AMQP port $AMQP_PORT"

  start_logged_process chain "$LOGS_DIR/chain.log" "$chain" \
    --basedir="$BASEDIR" --amqp="$AMQP_URL" --log-level=info --reset=true
  start_logged_process block_store "$LOGS_DIR/block_store.log" "$block_store" \
    --basedir="$BASEDIR" --amqp="$AMQP_URL" --log-level=info --reset
  start_logged_process mempool "$LOGS_DIR/mempool.log" "$mempool" \
    --basedir="$BASEDIR" --amqp="$AMQP_URL" --log-level=info
  start_logged_process jsonrpc "$LOGS_DIR/jsonrpc.log" "$jsonrpc" \
    --basedir="$BASEDIR" --amqp="$AMQP_URL" --listen="/ip4/127.0.0.1/tcp/${JSONRPC_PORT}" --log-level=info

  wait_rpc_ready || die "legacy native JSON-RPC did not become ready"

  local jsonrpc_pid
  jsonrpc_pid="$(cat "$REPORT_DIR/jsonrpc.pid")"
  sample_services &
  SAMPLER_PID="$!"

  "$ROOT_DIR/scripts/benchmark-monolith.py" \
    --rpc-url "http://127.0.0.1:${JSONRPC_PORT}/" \
    --pid "$jsonrpc_pid" \
    --log-file "$LOGS_DIR/chain.log" \
    --duration-seconds "$DURATION_SECONDS" \
    --interval-seconds "$INTERVAL_SECONDS" \
    --latency-requests "$LATENCY_REQUESTS" \
    --warmup-requests "$WARMUP_REQUESTS" \
    --result-dir "$BENCHMARK_DIR"

  if [[ -n "$SAMPLER_PID" ]] && kill -0 "$SAMPLER_PID" 2>/dev/null; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
    SAMPLER_PID=""
  fi
  summarize_service_samples

  echo "benchmark_json=$BENCHMARK_DIR/result.json"
  echo "benchmark_md=$BENCHMARK_DIR/result.md"
  echo "service_samples=$SERVICE_SAMPLE_CSV"
  echo "service_sample_summary=$SERVICE_SAMPLE_SUMMARY"
  echo "logs=$LOGS_DIR"
}

main "$@"
