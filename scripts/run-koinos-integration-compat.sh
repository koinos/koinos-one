#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FETCH_SCRIPT="$ROOT_DIR/scripts/fetch-koinos-integration-tests.sh"
SOURCE_DIR="${KOINOS_INTEGRATION_TESTS_DIR:-/private/tmp/knodel-koinos-integration-tests}"
RUN_ROOT="${KOINOS_INTEGRATION_COMPAT_ROOT:-/private/tmp/knodel-integration-compat}"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/vendor/koinos/koinos-node/build}"
BIN="${BIN:-$BUILD_DIR/koinos_node}"
MODE="${1:-inventory}"
TEST_NAME="${2:-publish_transaction}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
REPORT_DIR="$RUN_ROOT/$TIMESTAMP"
PIDS=()
LEGACY_COMPOSE_PROJECT=""

usage() {
  cat <<'EOF'
usage:
  scripts/run-koinos-integration-compat.sh inventory
  scripts/run-koinos-integration-compat.sh legacy <test-name>
  scripts/run-koinos-integration-compat.sh legacy-native <test-name>
  scripts/run-koinos-integration-compat.sh monolith <test-name>

Modes:
  inventory   Fetch/pin upstream and classify available tests.
  legacy      Run an upstream test unchanged through its Docker Compose stack.
  legacy-native
              Run an upstream single-node test unchanged through native legacy
              microservice binaries and GarageMQ on macOS.
  monolith    Run an adapted upstream test against local koinos_node.

Current legacy-native mode supports: publish_transaction, pending_nonce,
  pending_transaction_limit, transaction_error, koin, vhp, pob, propose_block.
Current monolith mode supports unchanged JSON-RPC upstream tests:
  publish_transaction, pending_nonce, pending_transaction_limit, vhp, pob.
It also supports an adapted public-JSON-RPC run for koin because the upstream
test body is API-compatible but instantiates a legacy AMQP client directly.

Environment:
  KOINOS_INTEGRATION_TESTS_DIR      Upstream checkout directory.
  KOINOS_INTEGRATION_TESTS_REF      Upstream ref passed to fetch script.
  KOINOS_INTEGRATION_COMPAT_ROOT    Result directory root.
  BUILD_DIR                         koinos-node build directory.
  BIN                               koinos_node binary path.
  JSONRPC_PORT                      Monolith JSON-RPC port for compatibility mode.
  LEGACY_NATIVE_JSONRPC_PORT        Native legacy JSON-RPC port.
  LEGACY_NATIVE_AMQP_PORT           Native legacy AMQP port.
  LEGACY_NATIVE_AMQP_ADMIN_PORT     Native legacy AMQP admin port.
  KEEP_RUN_ROOT=1                   Keep temporary monolith basedir after exit.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

fetch_source() {
  "$FETCH_SCRIPT" >/dev/null
  [[ -d "$SOURCE_DIR/.git" ]] || die "upstream checkout missing: $SOURCE_DIR"
}

commit_id() {
  git -C "$SOURCE_DIR" rev-parse HEAD
}

safe_mkdir_report() {
  mkdir -p "$REPORT_DIR"
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"
}

port_is_free() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_rpc_ready() {
  local port="$1"
  local deadline=$((SECONDS + 45))
  local ready_head="$REPORT_DIR/rpc-ready-head.json"
  local ready_error="$REPORT_DIR/rpc-ready-last-error.log"
  local ready_response="$REPORT_DIR/rpc-ready-response.json"
  local body='{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}'

  until curl -fsS --max-time 5 "http://127.0.0.1:${port}/" \
      -H 'content-type: application/json' \
      --data-binary "$body" >"$ready_response" 2>"$ready_error" \
      && python3 - "$ready_response" "$ready_head" >"$ready_error" 2>&1 <<'PY'
import json
import sys
from pathlib import Path

response_path = Path(sys.argv[1])
head_path = Path(sys.argv[2])

with response_path.open() as f:
    parsed = json.load(f)

if "error" in parsed:
    print(json.dumps(parsed["error"], sort_keys=True), file=sys.stderr)
    raise SystemExit(3)

head_path.write_text(json.dumps(parsed.get("result") or {}, sort_keys=True) + "\n")
PY
  do
    if (( SECONDS >= deadline )); then
      cat "$ready_error" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "rpc_ready_head=$ready_head"
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

start_logged_process() {
  local name="$1"
  local log_path="$2"
  shift 2
  echo "start_${name}_log=$log_path"
  "$@" >"$log_path" 2>&1 &
  PIDS+=("$!")
}

stop_processes() {
  local pid
  if (( ${#PIDS[@]} > 0 )); then
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -INT "$pid" 2>/dev/null || true
      fi
    done
    sleep 5
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
    sleep 3
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  if [[ -n "$LEGACY_COMPOSE_PROJECT" ]]; then
    (
      cd "$SOURCE_DIR/tests/$TEST_NAME"
      docker compose -p "$LEGACY_COMPOSE_PROJECT" \
        -f ../../node_config/docker-compose.config.yml \
        -f docker-compose.yml \
        down -v >/dev/null 2>&1 || true
    )
  fi
}

inventory() {
  fetch_source
  safe_mkdir_report
  python3 - "$SOURCE_DIR" "$REPORT_DIR" "$(commit_id)" <<'PY'
import json
import re
import sys
from pathlib import Path

source = Path(sys.argv[1])
report_dir = Path(sys.argv[2])
commit = sys.argv[3]
tests_root = source / "tests"

rows = []
for test_dir in sorted(p for p in tests_root.iterdir() if p.is_dir()):
    files = {p.name: p for p in test_dir.iterdir() if p.is_file()}
    go_text = "\n".join(p.read_text(errors="replace") for p in test_dir.glob("*.go"))
    compose_text = files.get("docker-compose.yml", Path("/dev/null")).read_text(errors="replace") if "docker-compose.yml" in files else ""
    service_names = re.findall(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", compose_text)
    ports = sorted(set(re.findall(r'"?([0-9]{4,5}):[0-9]{2,5}"?', compose_text) + re.findall(r"localhost:([0-9]{4,5})", go_text)))
    mutates = bool(re.search(r"SubmitTransaction|CreateBlock|Upload|Burn|Register|SetSystem|Mint|Transfer", go_text))
    direct_amqp = "koinos-mq-golang" in go_text or ".RPC(" in go_text
    multi_node = len([s for s in service_names if "jsonrpc" in s or "p2p" in s or "producer" in s]) > 2
    producer_required = "block_producer" in compose_text or "CreateBlock" in go_text or "propose_block" in test_dir.name
    rows.append({
        "name": test_dir.name,
        "services": service_names,
        "ports": ports,
        "single_node": not multi_node,
        "multi_node": multi_node,
        "producer_required": producer_required,
        "jsonrpc": "jsonrpc" in compose_text or "jsonrpc" in go_text.lower(),
        "direct_amqp_or_rpc": direct_amqp,
        "mutates_state": mutates,
        "has_docker_compose": "docker-compose.yml" in files,
        "candidate_phase": (
            "phase-1-single-node" if test_dir.name in {
                "publish_transaction", "pending_nonce", "pending_transaction_limit",
                "transaction_error", "koin", "vhp", "pob", "propose_block"
            } else "phase-2-multi-node" if multi_node else "later-review"
        )
    })

report = {
    "kind": "koinos-integration-tests-inventory",
    "upstream": "https://github.com/koinos/koinos-integration-tests",
    "commit": commit,
    "test_count": len(rows),
    "tests": rows,
}
json_path = report_dir / "inventory.json"
md_path = report_dir / "inventory.md"
json_path.write_text(json.dumps(report, indent=2) + "\n")
with md_path.open("w") as f:
    f.write("# Koinos Integration Tests Inventory\n\n")
    f.write(f"- Upstream commit: `{commit}`\n")
    f.write(f"- Test count: `{len(rows)}`\n\n")
    f.write("| Test | Phase | Topology | Producer | Mutates | Direct AMQP/RPC | Ports |\n")
    f.write("|---|---|---|---|---|---|---|\n")
    for row in rows:
        topology = "multi-node" if row["multi_node"] else "single-node"
        f.write(
            f"| `{row['name']}` | {row['candidate_phase']} | {topology} | "
            f"{'yes' if row['producer_required'] else 'no'} | "
            f"{'yes' if row['mutates_state'] else 'no'} | "
            f"{'yes' if row['direct_amqp_or_rpc'] else 'no'} | "
            f"{', '.join(row['ports']) or '-'} |\n"
        )
print(f"inventory_json={json_path}")
print(f"inventory_md={md_path}")
PY
}

run_legacy() {
  fetch_source
  safe_mkdir_report
  require_tool go
  require_tool docker
  [[ -d "$SOURCE_DIR/tests/$TEST_NAME" ]] || die "unknown upstream test: $TEST_NAME"
  local project_timestamp
  project_timestamp="$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')"
  LEGACY_COMPOSE_PROJECT="knodel-${TEST_NAME//_/-}-${project_timestamp}"
  trap stop_processes EXIT
  (
    cd "$SOURCE_DIR/tests/$TEST_NAME"
    go build ./...
    docker compose -p "$LEGACY_COMPOSE_PROJECT" \
      -f ../../node_config/docker-compose.config.yml \
      -f docker-compose.yml \
      up -d
    go clean -testcache
    go test -timeout "${GO_TEST_TIMEOUT:-30m}" -v ./...
  ) 2>&1 | tee "$REPORT_DIR/legacy-$TEST_NAME.log"
  echo "legacy_log=$REPORT_DIR/legacy-$TEST_NAME.log"
}

native_bin() {
  local rel="$1"
  local path="$ROOT_DIR/$rel"
  [[ -x "$path" ]] || die "native legacy binary missing or not executable: $path"
  printf '%s\n' "$path"
}

write_legacy_native_amqp_config() {
  local config_path="$1"
  local db_path="$2"
  local amqp_port="$3"
  local admin_port="$4"
  cat > "$config_path" <<YAML
proto: amqp-rabbit
users:
  - username: guest
    password: 084e0343a0486ff05530df6c705c8bb4
tcp:
  ip: 127.0.0.1
  port: ${amqp_port}
  nodelay: false
  readBufSize: 196608
  writeBufSize: 196608
admin:
  ip: 127.0.0.1
  port: ${admin_port}
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

prepare_legacy_native_basedir() {
  local basedir="$1"
  mkdir -p "$basedir/chain" "$basedir/jsonrpc/descriptors" "$basedir/block_producer" "$basedir/amqp"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$basedir/chain/genesis_data.json"
  cp "$SOURCE_DIR/node_config/koinos_descriptors.pb" "$basedir/jsonrpc/descriptors/koinos_descriptors.pb"
  cp "$SOURCE_DIR/node_config/private.key" "$basedir/block_producer/private.key"
  cp "$SOURCE_DIR/node_config/pob.key" "$basedir/block_producer/pob.key"
  chmod 600 "$basedir/block_producer/private.key"
  chmod 600 "$basedir/block_producer/pob.key"
}

legacy_native_supported_test() {
  case "$1" in
    publish_transaction|pending_nonce|pending_transaction_limit|transaction_error|koin|vhp|pob|propose_block)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

legacy_native_needs_block_producer() {
  case "$1" in
    publish_transaction|pob|propose_block) return 0 ;;
    *) return 1 ;;
  esac
}

legacy_native_needs_p2p() {
  case "$1" in
    propose_block) return 0 ;;
    *) return 1 ;;
  esac
}

run_legacy_native_single_node() {
  fetch_source
  safe_mkdir_report
  require_tool go
  require_tool curl
  require_tool python3
  require_tool nc

  [[ -d "$SOURCE_DIR/tests/$TEST_NAME" ]] || die "unknown upstream test: $TEST_NAME"
  legacy_native_supported_test "$TEST_NAME" || die "legacy-native mode does not support $TEST_NAME"

  local amqp_port="${LEGACY_NATIVE_AMQP_PORT:-25673}"
  local amqp_admin_port="${LEGACY_NATIVE_AMQP_ADMIN_PORT:-35673}"
  local jsonrpc_port="${LEGACY_NATIVE_JSONRPC_PORT:-28080}"
  local p2p_port="${LEGACY_NATIVE_P2P_PORT:-28888}"
  port_is_free "$amqp_port" || die "AMQP port $amqp_port is already in use"
  port_is_free "$amqp_admin_port" || die "AMQP admin port $amqp_admin_port is already in use"
  port_is_free "$jsonrpc_port" || die "JSON-RPC port $jsonrpc_port is already in use"
  if legacy_native_needs_p2p "$TEST_NAME"; then
    port_is_free "$p2p_port" || die "P2P port $p2p_port is already in use"
  fi

  local garagemq
  local chain
  local mempool
  local block_store
  local jsonrpc
  local block_producer
  local p2p
  garagemq="$(native_bin "vendor/amqp-broker/garagemq")"
  chain="$(native_bin "vendor/koinos/koinos-chain/build/src/koinos_chain")"
  mempool="$(native_bin "vendor/koinos/koinos-mempool/build/src/koinos_mempool")"
  block_store="$(native_bin "vendor/koinos/koinos-block-store/build/bin/koinos-block-store")"
  jsonrpc="$(native_bin "vendor/koinos/koinos-jsonrpc/build/bin/koinos-jsonrpc")"
  if legacy_native_needs_block_producer "$TEST_NAME"; then
    block_producer="$(native_bin "vendor/koinos/koinos-block-producer/build/src/koinos_block_producer")"
  fi
  if legacy_native_needs_p2p "$TEST_NAME"; then
    p2p="$(native_bin "vendor/koinos/koinos-p2p/build/bin/koinos-p2p")"
  fi

  local basedir="$REPORT_DIR/legacy-native-$TEST_NAME-basedir"
  local logs_dir="$REPORT_DIR/legacy-native-logs"
  local amqp_config="$basedir/amqp/garagemq.yaml"
  local amqp_url="amqp://guest:guest@127.0.0.1:${amqp_port}/"
  prepare_legacy_native_basedir "$basedir"
  mkdir -p "$logs_dir"
  write_legacy_native_amqp_config "$amqp_config" "$basedir/amqp/db" "$amqp_port" "$amqp_admin_port"

  trap stop_processes EXIT

  start_logged_process amqp "$logs_dir/amqp.log" "$garagemq" --config "$amqp_config"
  wait_tcp_ready 127.0.0.1 "$amqp_port" amqp 20 || die "GarageMQ did not open AMQP port $amqp_port"

  local chain_args=(
    --basedir="$basedir"
    --amqp="$amqp_url"
    --log-level=info
    --reset=true
  )
  if [[ "$TEST_NAME" == "pending_transaction_limit" ]]; then
    chain_args+=(--pending-transaction-limit=5)
  fi
  if [[ "$TEST_NAME" == "pob" ]]; then
    chain_args+=(--fork-algorithm=pob)
  fi

  start_logged_process chain "$logs_dir/chain.log" "$chain" \
    "${chain_args[@]}"
  start_logged_process block_store "$logs_dir/block_store.log" "$block_store" \
    --basedir="$basedir" --amqp="$amqp_url" --log-level=info --reset
  local mempool_args=(
    --basedir="$basedir"
    --amqp="$amqp_url"
    --log-level=info
  )
  if [[ "$TEST_NAME" == "pob" ]]; then
    mempool_args+=(--fork-algorithm=pob)
  fi
  start_logged_process mempool "$logs_dir/mempool.log" "$mempool" "${mempool_args[@]}"
  start_logged_process jsonrpc "$logs_dir/jsonrpc.log" "$jsonrpc" \
    --basedir="$basedir" --amqp="$amqp_url" --listen="/ip4/127.0.0.1/tcp/${jsonrpc_port}" --log-level=info
  if legacy_native_needs_p2p "$TEST_NAME"; then
    start_logged_process p2p "$logs_dir/p2p.log" "$p2p" \
      --basedir="$basedir" --amqp="$amqp_url" --listen="/ip4/127.0.0.1/tcp/${p2p_port}" --log-level=info
  fi
  if legacy_native_needs_block_producer "$TEST_NAME"; then
    local producer_args=(
      --basedir="$basedir"
      --amqp="$amqp_url"
      --log-level=info
      --max-inclusion-attempts=2000
    )
    case "$TEST_NAME" in
      pob)
        producer_args+=(
          --algorithm=pob
          --gossip-production=false
          --private-key-file="$basedir/block_producer/pob.key"
          --producer=18pztbh788JozD6UVuT67W5sNpYNgFk7Q2
        )
        ;;
      propose_block)
        producer_args+=(
          --algorithm=federated
          --private-key-file="$basedir/block_producer/private.key"
        )
        ;;
      *)
        producer_args+=(
          --algorithm=federated
          --gossip-production=false
          --private-key-file="$basedir/block_producer/private.key"
        )
        ;;
    esac
    start_logged_process block_producer "$logs_dir/block_producer.log" "$block_producer" "${producer_args[@]}"
  fi

  wait_rpc_ready "$jsonrpc_port"

  (
    cd "$SOURCE_DIR/tests/$TEST_NAME"
    go clean -testcache
    go test -timeout "${GO_TEST_TIMEOUT:-2m}" -v ./...
  ) 2>&1 | tee "$REPORT_DIR/legacy-native-$TEST_NAME-go-test.log"

  curl -fsS --max-time 5 "http://127.0.0.1:${jsonrpc_port}/" \
    -H 'content-type: application/json' \
    --data-binary '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}' \
    > "$REPORT_DIR/legacy-native-$TEST_NAME-final-head.json" || true
  echo "legacy_native_logs=$logs_dir"
  echo "legacy_native_go_test_log=$REPORT_DIR/legacy-native-$TEST_NAME-go-test.log"
  echo "legacy_native_final_head=$REPORT_DIR/legacy-native-$TEST_NAME-final-head.json"

  stop_processes
  trap - EXIT
  if [[ "${KEEP_RUN_ROOT:-0}" != "1" ]]; then
    rm -rf "$basedir"
  fi
}

run_legacy_native() {
  run_legacy_native_single_node
}

write_monolith_config() {
  local basedir="$1"
  local port="$2"
  local block_producer_enabled="$3"
  local block_producer_algorithm="$4"
  local private_key_file="$5"
  local producer_address="${6:-}"
  local pending_transaction_limit="${7:-10}"
  local fork_algorithm="${8:-fifo}"
  cat > "$basedir/config.yml" <<YAML
global:
  instance-id: integration-compat-${TEST_NAME}
  log-level: info
  log-color: false
  log-datetime: true
  reset: true
  fork-algorithm: ${fork_algorithm}
chain:
  pending-transaction-limit: ${pending_transaction_limit}
jsonrpc:
  listen: 127.0.0.1:${port}
block_producer:
  algorithm: ${block_producer_algorithm}
  private-key-file: ${private_key_file}
  producer: ${producer_address}
  gossip-production: false
  max-inclusion-attempts: 2000
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
  block_producer: ${block_producer_enabled}
YAML
}

monolith_supported_test() {
  case "$1" in
    publish_transaction|pending_nonce|pending_transaction_limit|koin|vhp|pob)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

monolith_test_dir() {
  case "$TEST_NAME" in
    koin)
      local adapted_source="$REPORT_DIR/adapted-koinos-integration-tests"
      cp -R "$SOURCE_DIR" "$adapted_source"
      perl -0pi -e 's#"testing"#"testing"\n\n\tkjsonrpc "github.com/koinos/koinos-util-golang/v2/rpc"#' \
        "$adapted_source/tests/koin/koin_test.go" || die "failed to adapt koin test imports"
      perl -0pi -e 's#integration\.NewKoinosMQClient\("amqp://guest:guest\@localhost:25673/"\)#kjsonrpc.NewKoinosRPCClient("http://localhost:28080/")#' \
        "$adapted_source/tests/koin/koin_test.go" || die "failed to adapt koin test client"
      printf '%s\n' "$adapted_source/tests/koin"
      ;;
    *)
      printf '%s\n' "$SOURCE_DIR/tests/$TEST_NAME"
      ;;
  esac
}

monolith_needs_block_producer() {
  case "$1" in
    publish_transaction|pob) return 0 ;;
    *) return 1 ;;
  esac
}

run_monolith_single_node() {
  fetch_source
  safe_mkdir_report
  require_tool go
  require_tool curl
  require_tool python3
  [[ -x "$BIN" ]] || die "koinos_node not executable: $BIN"
  [[ -d "$SOURCE_DIR/tests/$TEST_NAME" ]] || die "unknown upstream test: $TEST_NAME"
  monolith_supported_test "$TEST_NAME" || die "monolith mode does not support unchanged upstream test $TEST_NAME"

  local port="${JSONRPC_PORT:-28080}"
  port_is_free "$port" || die "port $port is already in use"

  cmake --build "$BUILD_DIR" --target koinos_node --parallel

  local node_dir="$REPORT_DIR/monolith-$TEST_NAME-node"
  mkdir -p "$node_dir/block_producer" "$node_dir/chain"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$node_dir/genesis_data.json"
  cp "$SOURCE_DIR/node_config/genesis_data.json" "$node_dir/chain/genesis_data.json"
  cp "$SOURCE_DIR/node_config/private.key" "$node_dir/block_producer/private.key"
  cp "$SOURCE_DIR/node_config/pob.key" "$node_dir/block_producer/pob.key"
  chmod 600 "$node_dir/block_producer/private.key"
  chmod 600 "$node_dir/block_producer/pob.key"

  local block_producer_enabled=false
  local block_producer_algorithm=federated
  local private_key_file="$node_dir/block_producer/private.key"
  local producer_address=""
  local pending_transaction_limit=10
  local fork_algorithm=fifo
  if monolith_needs_block_producer "$TEST_NAME"; then
    block_producer_enabled=true
  fi
  if [[ "$TEST_NAME" == "pob" ]]; then
    block_producer_algorithm=pob
    private_key_file="$node_dir/block_producer/pob.key"
    producer_address=18pztbh788JozD6UVuT67W5sNpYNgFk7Q2
    fork_algorithm=pob
  fi
  if [[ "$TEST_NAME" == "pending_transaction_limit" ]]; then
    pending_transaction_limit=5
  fi
  write_monolith_config "$node_dir" "$port" "$block_producer_enabled" \
    "$block_producer_algorithm" "$private_key_file" "$producer_address" "$pending_transaction_limit" "$fork_algorithm"

  trap stop_processes EXIT
  "$BIN" --basedir="$node_dir" --config="$node_dir/config.yml" >"$REPORT_DIR/monolith-$TEST_NAME-node.log" 2>&1 &
  PIDS+=("$!")

  wait_rpc_ready "$port"
  local test_dir
  test_dir="$(monolith_test_dir)"
  (
    cd "$test_dir"
    go clean -testcache
    go test -timeout "${GO_TEST_TIMEOUT:-2m}" -v ./...
  ) 2>&1 | tee "$REPORT_DIR/monolith-$TEST_NAME-go-test.log"

  curl -fsS --max-time 5 "http://127.0.0.1:${port}/" \
    -H 'content-type: application/json' \
    --data-binary '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}' \
    > "$REPORT_DIR/monolith-$TEST_NAME-final-head.json" || true
  echo "monolith_node_log=$REPORT_DIR/monolith-$TEST_NAME-node.log"
  echo "monolith_go_test_log=$REPORT_DIR/monolith-$TEST_NAME-go-test.log"
  echo "monolith_final_head=$REPORT_DIR/monolith-$TEST_NAME-final-head.json"

  stop_processes
  trap - EXIT
  if [[ "${KEEP_RUN_ROOT:-0}" != "1" ]]; then
    rm -rf "$node_dir"
  fi
}

run_monolith() {
  run_monolith_single_node
}

case "$MODE" in
  -h|--help|help) usage ;;
  inventory) inventory ;;
  legacy) run_legacy ;;
  legacy-native) run_legacy_native ;;
  monolith) run_monolith ;;
  *) usage; die "unknown mode: $MODE" ;;
esac
