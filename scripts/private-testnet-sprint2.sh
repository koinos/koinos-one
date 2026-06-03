#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/vendor/koinos/koinos-node"
BIN="${BIN:-$NODE_DIR/build/koinos_node}"
KEYGEN="${KEYGEN:-$NODE_DIR/build/koinos_private_testnet_keygen}"
GENESIS_SOURCE="${GENESIS_SOURCE:-$ROOT_DIR/vendor/koinos/koinos/harbinger/config-example/genesis_data.json}"
DESCRIPTORS_SOURCE="${DESCRIPTORS_SOURCE:-$ROOT_DIR/vendor/koinos/koinos/harbinger/config-example/koinos_descriptors.pb}"
REPORT="${REPORT:-$ROOT_DIR/docs/roadmap/monolith/testnets/MONOLITH_PRIVATE_TESTNET_REPORT.md}"
RUN_ROOT="${PRIVATE_TESTNET_ROOT:-/private/tmp/knodel-private-testnet}"
KEY_SEED="${PRIVATE_TESTNET_KEY_SEED:-knodel-private-testnet-producer}"
BUILD="${PRIVATE_TESTNET_BUILD:-1}"
MODE="${PRIVATE_TESTNET_MODE:-federated}"
CONTRACTS_DIR="${PRIVATE_TESTNET_CONTRACTS_DIR:-$ROOT_DIR/tools/private-testnet/contracts}"

SEED_P2P_PORT="${SEED_P2P_PORT:-18888}"
PRODUCER_P2P_PORT="${PRODUCER_P2P_PORT:-18889}"
OBSERVER_P2P_PORT="${OBSERVER_P2P_PORT:-18890}"
SEED_RPC_PORT="${SEED_RPC_PORT:-18880}"
PRODUCER_RPC_PORT="${PRODUCER_RPC_PORT:-18881}"
OBSERVER_RPC_PORT="${OBSERVER_RPC_PORT:-18882}"
PRODUCED_TIMEOUT_SECONDS="${PRODUCED_TIMEOUT_SECONDS:-120}"
SYNC_TIMEOUT_SECONDS="${SYNC_TIMEOUT_SECONDS:-120}"
SOAK_DURATION_SECONDS="${SOAK_DURATION_SECONDS:-0}"
SOAK_INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-60}"
SOAK_MAX_STALLED_SAMPLES="${SOAK_MAX_STALLED_SAMPLES:-3}"

STATUS="failed"
FAIL_REASON=""
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PIDS=()
SOAK_STATUS="not-run"

die() {
  FAIL_REASON="$*"
  echo "error: $*" >&2
  exit 1
}

safe_clean_root() {
  case "$RUN_ROOT" in
    ""|"/"|"/tmp"|"/private/tmp"|"/mnt"|"/mnt/") die "refusing to clean unsafe PRIVATE_TESTNET_ROOT=$RUN_ROOT" ;;
  esac

  case "$RUN_ROOT" in
    /private/tmp/knodel-private-testnet*|/tmp/knodel-private-testnet*|*/knodel-private-testnet*) rm -rf "$RUN_ROOT" ;;
    *) die "refusing to clean unsafe PRIVATE_TESTNET_ROOT=$RUN_ROOT; path basename must start with knodel-private-testnet" ;;
  esac

  mkdir -p "$RUN_ROOT"
}

rpc_raw() {
  local port="$1"
  local method="$2"
  local params="${3:-}"
  if [[ -z "$params" ]]; then
    params="{}"
  fi
  node - "$port" "$method" "$params" <<'NODE'
const http = require('node:http')
const [port, method, paramsJson] = process.argv.slice(2)
const params = JSON.parse(paramsJson || '{}')
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
const req = http.request({
  host: '127.0.0.1',
  port: Number(port),
  path: '/',
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  },
  timeout: 5000
}, (res) => {
  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    try {
      JSON.parse(data)
      process.stdout.write(data)
    } catch (error) {
      console.error(`invalid JSON-RPC response: ${error.message}: ${data}`)
      process.exit(2)
    }
  })
})
req.on('timeout', () => req.destroy(new Error('timeout')))
req.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
req.write(body)
req.end()
NODE
}

rpc_result() {
  local port="$1"
  local method="$2"
  local params="${3:-}"
  if [[ -z "$params" ]]; then
    params="{}"
  fi
  local raw
  raw="$(rpc_raw "$port" "$method" "$params")"
  node - "$raw" <<'NODE'
const response = JSON.parse(process.argv[2])
if (response.error) {
  console.error(JSON.stringify(response.error))
  process.exit(1)
}
process.stdout.write(JSON.stringify(response.result || {}))
NODE
}

wait_rpc_ready() {
  local port="$1"
  local deadline=$((SECONDS + 45))
  local last_error=""
  until last_error="$(rpc_result "$port" "chain.get_head_info" "{}" 2>&1 >/dev/null)"; do
    if (( SECONDS >= deadline )); then
      if [[ -n "$last_error" ]]; then
        echo "$last_error" >&2
      fi
      return 1
    fi
    sleep 1
  done
}

json_height() {
  node - "$1" <<'NODE'
const result = JSON.parse(process.argv[2])
const topology = result.head_topology || result.headTopology || result.topology || {}
const height = Number(topology.height || 0)
console.log(Number.isFinite(height) ? height : 0)
NODE
}

head_height() {
  json_height "$(rpc_result "$1" "chain.get_head_info" "{}")"
}

highest_height() {
  json_height "$(rpc_result "$1" "block_store.get_highest_block" "{}")"
}

head_height_or_zero() {
  head_height "$1" 2>/dev/null || echo 0
}

highest_height_or_zero() {
  highest_height "$1" 2>/dev/null || echo 0
}

chain_id() {
  node - "$(rpc_result "$1" "chain.get_chain_id" "{}")" <<'NODE'
const result = JSON.parse(process.argv[2])
console.log(result.chain_id || result.chainId || '')
NODE
}

wait_head_at_least() {
  local port="$1"
  local min_height="$2"
  local timeout="$3"
  local deadline=$((SECONDS + timeout))
  local height=0
  while (( SECONDS < deadline )); do
    height="$(head_height "$port" 2>/dev/null || echo 0)"
    if [[ "$height" =~ ^[0-9]+$ ]] && (( height >= min_height )); then
      echo "$height"
      return 0
    fi
    sleep 1
  done
  echo "$height"
  return 1
}

wait_log() {
  local file="$1"
  local pattern="$2"
  local timeout="$3"
  local deadline=$((SECONDS + timeout))
  until grep -qE "$pattern" "$file" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 1
  done
}

extract_peer_id() {
  sed -nE 's/.*Host peer ID: ([A-Za-z0-9]+).*/\1/p' "$1" | tail -1
}

extract_produced_line() {
  grep -E "\\[block_producer\\] Produced block - Height:" "$1" 2>/dev/null \
    | tail -1 \
    | perl -pe 's/\e\[[0-9;]*m//g' \
    || true
}

extract_produced_height() {
  local line="$1"
  sed -nE 's/.*Height: ([0-9]+).*/\1/p' <<<"$line"
}

count_severe_log_matches() {
  local total=0
  local file count
  for file in "${SEED_DIR:-}/node.log" "${PRODUCER_DIR:-}/node.log" "${OBSERVER_DIR:-}/node.log"; do
    if [[ -f "$file" ]]; then
      count="$(grep -Eic "Block application failed|could not burn vhp|proposal failed|rejected proposal|chain ID mismatch|Segmentation fault|Assertion" "$file" 2>/dev/null || true)"
      total=$((total + count))
    fi
  done
  echo "$total"
}

write_config() {
  local node_dir="$1"
  local p2p_port="$2"
  local rpc_port="$3"
  local enable_producer="$4"
  local seed_peers="${5:-}"
  local fork_algorithm="fifo"
  local producer_algorithm="federated"
  local producer_address_line=""

  if [[ "$MODE" == "pob" ]]; then
    fork_algorithm="pob"
    producer_algorithm="pob"
    producer_address_line="  producer: ${PRODUCER_ADDRESS}"
  fi

  mkdir -p "$node_dir/block_producer" "$node_dir/chain" "$node_dir/jsonrpc/descriptors"
  cp "$RUN_ROOT/genesis_data.json" "$node_dir/chain/genesis_data.json"
  cp "$DESCRIPTORS_SOURCE" "$node_dir/jsonrpc/descriptors/koinos_descriptors.pb"

  {
    cat <<YAML
global:
  log-level: debug
  log-color: false
  log-datetime: true
  fork-algorithm: ${fork_algorithm}
chain:
  verify-blocks: true
p2p:
  listen: /ip4/127.0.0.1/tcp/${p2p_port}
  force-gossip: true
  seed-reconnect-interval-seconds: 2
YAML
    if [[ -n "$seed_peers" ]]; then
      cat <<YAML
  peer:
YAML
      local seed_peer
      for seed_peer in $seed_peers; do
        cat <<YAML
    - ${seed_peer}
YAML
      done
    fi
    cat <<YAML
jsonrpc:
  listen: 127.0.0.1:${rpc_port}
block_producer:
  algorithm: ${producer_algorithm}
${producer_address_line}
  private-key-file: ${node_dir}/block_producer/private.key
  gossip-production: true
  max-inclusion-attempts: 2000
features:
  chain: true
  mempool: true
  block_store: true
  transaction_store: true
  contract_meta_store: true
  account_history: false
  p2p: true
  jsonrpc: true
  grpc: false
  block_producer: ${enable_producer}
YAML
  } > "$node_dir/config.yml"
}

start_node() {
  local name="$1"
  local node_dir="$2"
  local log_file="$node_dir/node.log"
  "$BIN" --basedir="$node_dir" --config="$node_dir/config.yml" >"$log_file" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  echo "$pid"
}

stop_nodes() {
  if (( ${#PIDS[@]} == 0 )); then
    return
  fi
  local pid
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -INT "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}

fail_soak() {
  SOAK_STATUS="failed"
  die "$*"
}

run_soak() {
  if (( SOAK_DURATION_SECONDS <= 0 )); then
    return
  fi

  SOAK_STATUS="running"
  SOAK_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  SOAK_SAMPLES_FILE="$RUN_ROOT/soak-samples.tsv"
  SOAK_INITIAL_PRODUCER_HEIGHT="$(head_height_or_zero "$PRODUCER_RPC_PORT")"
  SOAK_INITIAL_OBSERVER_HEIGHT="$(head_height_or_zero "$OBSERVER_RPC_PORT")"
  SOAK_INITIAL_OBSERVER_HIGHEST="$(highest_height_or_zero "$OBSERVER_RPC_PORT")"
  SOAK_SAMPLE_COUNT=0
  SOAK_STALLED_SAMPLES=0
  SOAK_MAX_CONSECUTIVE_STALLED_SAMPLES=0

  {
    printf "timestamp\telapsed_seconds\tproducer_head\tobserver_head\tobserver_highest\tlast_produced_height\n"
  } > "$SOAK_SAMPLES_FILE"

  local deadline=$((SECONDS + SOAK_DURATION_SECONDS))
  local last_observer_height="$SOAK_INITIAL_OBSERVER_HEIGHT"
  local consecutive_stalls=0

  while (( SECONDS <= deadline )); do
    local now elapsed producer_height observer_height observer_highest latest_line latest_height
    now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    elapsed=$((SOAK_DURATION_SECONDS - (deadline - SECONDS)))
    producer_height="$(head_height_or_zero "$PRODUCER_RPC_PORT")"
    observer_height="$(head_height_or_zero "$OBSERVER_RPC_PORT")"
    observer_highest="$(highest_height_or_zero "$OBSERVER_RPC_PORT")"
    latest_line="$(extract_produced_line "$PRODUCER_DIR/node.log")"
    latest_height="$(extract_produced_height "$latest_line")"
    latest_height="${latest_height:-0}"

    printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$now" "$elapsed" "$producer_height" "$observer_height" "$observer_highest" "$latest_height" \
      >> "$SOAK_SAMPLES_FILE"
    echo "soak sample: elapsed=${elapsed}s producer=${producer_height} observer=${observer_height} block_store=${observer_highest} produced=${latest_height}"

    SOAK_SAMPLE_COUNT=$((SOAK_SAMPLE_COUNT + 1))

    if ! [[ "$producer_height" =~ ^[0-9]+$ && "$observer_height" =~ ^[0-9]+$ && "$observer_highest" =~ ^[0-9]+$ ]]; then
      fail_soak "soak RPC returned a non-numeric height"
    fi
    if (( producer_height == 0 || observer_height == 0 )); then
      fail_soak "soak RPC returned zero head after bootstrap"
    fi
    if (( observer_highest < observer_height )); then
      fail_soak "observer block store highest height $observer_highest is below observer head $observer_height during soak"
    fi

    if (( SOAK_SAMPLE_COUNT > 1 )); then
      if (( observer_height <= last_observer_height )); then
        consecutive_stalls=$((consecutive_stalls + 1))
        SOAK_STALLED_SAMPLES=$((SOAK_STALLED_SAMPLES + 1))
        if (( consecutive_stalls > SOAK_MAX_CONSECUTIVE_STALLED_SAMPLES )); then
          SOAK_MAX_CONSECUTIVE_STALLED_SAMPLES="$consecutive_stalls"
        fi
        if (( consecutive_stalls >= SOAK_MAX_STALLED_SAMPLES )); then
          fail_soak "observer head stalled at $observer_height for $consecutive_stalls consecutive soak samples"
        fi
      else
        consecutive_stalls=0
      fi
    fi

    last_observer_height="$observer_height"
    if (( SECONDS >= deadline )); then
      break
    fi

    local sleep_for="$SOAK_INTERVAL_SECONDS"
    local remaining=$((deadline - SECONDS))
    if (( sleep_for > remaining )); then
      sleep_for="$remaining"
    fi
    if (( sleep_for > 0 )); then
      sleep "$sleep_for"
    fi
  done

  SOAK_FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  SOAK_FINAL_PRODUCER_HEIGHT="$(head_height_or_zero "$PRODUCER_RPC_PORT")"
  SOAK_FINAL_OBSERVER_HEIGHT="$(head_height_or_zero "$OBSERVER_RPC_PORT")"
  SOAK_FINAL_OBSERVER_HIGHEST="$(highest_height_or_zero "$OBSERVER_RPC_PORT")"
  SOAK_LAST_PRODUCED_LINE="$(extract_produced_line "$PRODUCER_DIR/node.log")"
  SOAK_LAST_PRODUCED_HEIGHT="$(extract_produced_height "$SOAK_LAST_PRODUCED_LINE")"
  SOAK_LAST_PRODUCED_HEIGHT="${SOAK_LAST_PRODUCED_HEIGHT:-0}"
  SOAK_SEVERE_LOG_MATCHES="$(count_severe_log_matches)"

  if (( SOAK_FINAL_PRODUCER_HEIGHT <= SOAK_INITIAL_PRODUCER_HEIGHT )); then
    fail_soak "producer head did not progress during soak"
  fi
  if (( SOAK_FINAL_OBSERVER_HEIGHT <= SOAK_INITIAL_OBSERVER_HEIGHT )); then
    fail_soak "observer head did not progress during soak"
  fi
  if (( SOAK_FINAL_OBSERVER_HIGHEST < SOAK_FINAL_OBSERVER_HEIGHT )); then
    fail_soak "observer block store highest height $SOAK_FINAL_OBSERVER_HIGHEST is below final observer head $SOAK_FINAL_OBSERVER_HEIGHT"
  fi
  if (( SOAK_SEVERE_LOG_MATCHES > 0 )); then
    fail_soak "soak found $SOAK_SEVERE_LOG_MATCHES severe log match(es)"
  fi

  PRODUCER_HEAD_HEIGHT="$SOAK_FINAL_PRODUCER_HEIGHT"
  OBSERVER_HEAD_HEIGHT="$SOAK_FINAL_OBSERVER_HEIGHT"
  OBSERVER_HIGHEST_HEIGHT="$SOAK_FINAL_OBSERVER_HIGHEST"
  SOAK_STATUS="passed"
}

write_report() {
  local finished_at
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local dirty
  dirty="$(git -C "$ROOT_DIR" status --short 2>/dev/null | wc -l | tr -d ' ')"
  local producer_line
  producer_line="${PRODUCED_LINE:-}"
  if [[ -z "$producer_line" ]]; then
    producer_line="$(extract_produced_line "${PRODUCER_DIR:-/dev/null}/node.log")"
  fi
  local pob_probe
  if [[ -x "$ROOT_DIR/scripts/probe-private-pob-genesis.js" ]]; then
    local full_genesis="$ROOT_DIR/vendor/koinos/koinos/config-example/genesis_data.json"
    local -a pob_probe_targets=()
    if [[ -f "$RUN_ROOT/genesis_data.json" ]]; then
      pob_probe_targets+=("$RUN_ROOT/genesis_data.json")
    fi
    pob_probe_targets+=("$GENESIS_SOURCE")
    if [[ "$GENESIS_SOURCE" != "$full_genesis" ]]; then
      pob_probe_targets+=("$full_genesis")
    fi
    pob_probe="$(node "$ROOT_DIR/scripts/probe-private-pob-genesis.js" --markdown-fragment \
      "${pob_probe_targets[@]}" 2>&1 || true)"
  else
    pob_probe="## Phase B Genesis Readiness Probe

The genesis readiness probe script is missing."
  fi

  cat > "$REPORT" <<REPORT_MD
# Monolith Private Testnet Report

Updated: ${finished_at}

## Result

- Status: ${STATUS}
- Failure reason: ${FAIL_REASON:-none}
- Started: ${STARTED_AT}
- Finished: ${finished_at}
- Commit: ${commit}
- Dirty worktree entries at report time: ${dirty}
- Run root: ${RUN_ROOT}
- Mode: ${MODE}

## Network Smoke

- Runtime shape: three local monolith nodes: seed-1, producer-1, observer-1
- Genesis source: ${GENESIS_SOURCE}
- Genesis runtime file: ${RUN_ROOT}/genesis_data.json
- Genesis patch: ${GENESIS_PATCH_DESCRIPTION:-unknown}
- Producer address: ${PRODUCER_ADDRESS:-unknown}
- Seed peer ID: ${SEED_PEER_ID:-unknown}
- Producer peer ID: ${PRODUCER_PEER_ID:-unknown}
- Seed RPC: http://127.0.0.1:${SEED_RPC_PORT}/
- Producer RPC: http://127.0.0.1:${PRODUCER_RPC_PORT}/
- Observer RPC: http://127.0.0.1:${OBSERVER_RPC_PORT}/
- Chain IDs: seed=${SEED_CHAIN_ID:-unknown}, producer=${PRODUCER_CHAIN_ID:-unknown}, observer=${OBSERVER_CHAIN_ID:-unknown}
- Produced height used for observer sync: ${PRODUCED_HEIGHT:-unknown}
- Producer head height: ${PRODUCER_HEAD_HEIGHT:-unknown}
- Observer head height: ${OBSERVER_HEAD_HEIGHT:-unknown}
- Observer block-store highest height: ${OBSERVER_HIGHEST_HEIGHT:-unknown}
- Produced block log: ${producer_line:-none}

## Soak

- Status: ${SOAK_STATUS:-not-run}
- Requested duration seconds: ${SOAK_DURATION_SECONDS}
- Interval seconds: ${SOAK_INTERVAL_SECONDS}
- Started: ${SOAK_STARTED_AT:-not-run}
- Finished: ${SOAK_FINISHED_AT:-not-run}
- Samples file: ${SOAK_SAMPLES_FILE:-not-generated}
- Samples: ${SOAK_SAMPLE_COUNT:-0}
- Initial producer head: ${SOAK_INITIAL_PRODUCER_HEIGHT:-not-run}
- Final producer head: ${SOAK_FINAL_PRODUCER_HEIGHT:-not-run}
- Initial observer head: ${SOAK_INITIAL_OBSERVER_HEIGHT:-not-run}
- Final observer head: ${SOAK_FINAL_OBSERVER_HEIGHT:-not-run}
- Initial observer block-store highest height: ${SOAK_INITIAL_OBSERVER_HIGHEST:-not-run}
- Final observer block-store highest height: ${SOAK_FINAL_OBSERVER_HIGHEST:-not-run}
- Stalled samples: ${SOAK_STALLED_SAMPLES:-0}
- Max consecutive stalled samples: ${SOAK_MAX_CONSECUTIVE_STALLED_SAMPLES:-0}
- Severe log matches: ${SOAK_SEVERE_LOG_MATCHES:-not-run}
- Last produced height: ${SOAK_LAST_PRODUCED_HEIGHT:-not-run}
- Last produced block log: ${SOAK_LAST_PRODUCED_LINE:-not-run}

## Verification

- Producer uses block_producer.gossip-production: true.
- Private smoke uses p2p.force-gossip: true to avoid the genesis-height circularity where a new network has no recent head block yet.
- Observer is seeded with both the seed node and producer node multiaddrs so direct producer sync is exercised after bootstrap.
- Observer acceptance is verified through chain.get_head_info.
- EventBus fanout to block store is verified through block_store.get_highest_block on observer.
- Transaction store health check: ${TRANSACTION_STORE_CHECK:-not-run}
- Contract meta store health check: ${CONTRACT_META_STORE_CHECK:-not-run}
- Shutdown: ${SHUTDOWN_RESULT:-not-run}

## Phase B PoB/VHP

PoB/VHP signoff status: ${POB_SIGNOFF_STATUS:-not-run}. Inspection on 2026-05-24 found that the Harbinger genesis used for Phase A has only six metadata entries, and the full Koinos config-example genesis contains launch KOIN balances but not a complete private PoB/VHP/name-service state that can be safely patched by adding one balance row. The deterministic bootstrap path now builds a private PoB genesis from the staged system-contract artifacts, registers the producer hot public key, gives the producer KOIN/RC and effective VHP, seeds the producer-to-PoB VHP burn allowance needed by private bootstrap, and enables block_producer.algorithm: pob when PRIVATE_TESTNET_MODE=pob.

Bootstrap summary: ${POB_BOOTSTRAP_SUMMARY:-not-generated}

${pob_probe}
REPORT_MD
}

cleanup() {
  stop_nodes
  SHUTDOWN_RESULT="clean"
  write_report
}
trap cleanup EXIT

if [[ "$BUILD" == "1" ]]; then
  cmake --build "$NODE_DIR/build" --target koinos_node --parallel
  cmake --build "$NODE_DIR/build" --target koinos_private_testnet_keygen --parallel
fi

if [[ ! -x "$KEYGEN" && -x "$NODE_DIR/build/src/koinos_private_testnet_keygen" ]]; then
  KEYGEN="$NODE_DIR/build/src/koinos_private_testnet_keygen"
fi
if [[ ! -x "$BIN" && -x "$NODE_DIR/build/src/koinos_node" ]]; then
  BIN="$NODE_DIR/build/src/koinos_node"
fi

[[ -x "$BIN" ]] || die "missing koinos_node binary: $BIN"
[[ -x "$KEYGEN" ]] || die "missing keygen binary: $KEYGEN"
[[ -f "$GENESIS_SOURCE" ]] || die "missing genesis source: $GENESIS_SOURCE"
[[ -f "$DESCRIPTORS_SOURCE" ]] || die "missing descriptors source: $DESCRIPTORS_SOURCE"

case "$MODE" in
  federated)
    ;;
  pob)
    [[ -x "$ROOT_DIR/scripts/build-private-pob-genesis.js" ]] \
      || die "missing private PoB genesis builder: $ROOT_DIR/scripts/build-private-pob-genesis.js"
    [[ -f "$CONTRACTS_DIR/manifest.json" ]] \
      || die "missing staged contract artifacts: $CONTRACTS_DIR/manifest.json"
    ;;
  *)
    die "unsupported PRIVATE_TESTNET_MODE=$MODE"
    ;;
esac

safe_clean_root

KEY_OUTPUT="$("$KEYGEN" "$KEY_SEED")"
PRODUCER_WIF="$(sed -n 's/^wif=//p' <<<"$KEY_OUTPUT")"
PRODUCER_ADDRESS="$(sed -n 's/^address=//p' <<<"$KEY_OUTPUT")"
PRODUCER_ADDRESS_BASE64="$(sed -n 's/^address_base64=//p' <<<"$KEY_OUTPUT")"
PRODUCER_PUBLIC_KEY_BASE64="$(sed -n 's/^public_key_base64=//p' <<<"$KEY_OUTPUT")"
GENESIS_KEY_BASE64="$(sed -n 's/^genesis_key_base64=//p' <<<"$KEY_OUTPUT")"
[[ -n "$PRODUCER_WIF" ]] || die "keygen did not return a WIF"
[[ -n "$PRODUCER_ADDRESS_BASE64" ]] || die "keygen did not return address bytes"
[[ -n "$PRODUCER_PUBLIC_KEY_BASE64" ]] || die "keygen did not return public key bytes"
[[ -n "$GENESIS_KEY_BASE64" ]] || die "keygen did not return genesis key"

if [[ "$MODE" == "pob" ]]; then
  POB_BOOTSTRAP_SUMMARY="$RUN_ROOT/bootstrap-summary.json"
  "$ROOT_DIR/scripts/build-private-pob-genesis.js" \
    --source "$GENESIS_SOURCE" \
    --contracts-dir "$CONTRACTS_DIR" \
    --output "$RUN_ROOT/genesis_data.json" \
    --summary "$POB_BOOTSTRAP_SUMMARY" \
    --producer-address "$PRODUCER_ADDRESS" \
    --producer-address-base64 "$PRODUCER_ADDRESS_BASE64" \
    --producer-public-key-base64 "$PRODUCER_PUBLIC_KEY_BASE64" \
    --genesis-address-base64 "$PRODUCER_ADDRESS_BASE64" >/dev/null
  "$ROOT_DIR/scripts/probe-private-pob-genesis.js" --require-ready "$RUN_ROOT/genesis_data.json" \
    || die "generated private PoB genesis did not pass static readiness"
  GENESIS_PATCH_DESCRIPTION="deterministic private PoB bootstrap with system-contract bytecode, dispatch, name-service records, producer public-key registration, KOIN/RC balance, VHP stake, and VHP burn allowance"
  POB_SIGNOFF_STATUS="running"
else
  node - "$GENESIS_SOURCE" "$RUN_ROOT/genesis_data.json" "$GENESIS_KEY_BASE64" "$PRODUCER_ADDRESS_BASE64" <<'NODE'
const fs = require('node:fs')
const [src, dst, genesisKey, producerAddress] = process.argv.slice(2)
const genesis = JSON.parse(fs.readFileSync(src, 'utf8'))
const normalizeBase64 = (value) => value.replace(/=+$/g, '')
const normalizedGenesisKey = normalizeBase64(genesisKey)
const entry = genesis.entries.find((item) =>
  item.space && item.space.system === true && normalizeBase64(item.key) === normalizedGenesisKey)
if (!entry) {
  throw new Error(`genesis key entry not found: ${genesisKey}`)
}
entry.value = producerAddress
fs.writeFileSync(dst, `${JSON.stringify(genesis, null, 2)}\n`)
NODE
  GENESIS_PATCH_DESCRIPTION="state::key::genesis_key replaced with deterministic producer address bytes"
fi

SEED_DIR="$RUN_ROOT/seed-1"
PRODUCER_DIR="$RUN_ROOT/producer-1"
OBSERVER_DIR="$RUN_ROOT/observer-1"

write_config "$SEED_DIR" "$SEED_P2P_PORT" "$SEED_RPC_PORT" "false"

start_node "seed-1" "$SEED_DIR" >/dev/null
wait_rpc_ready "$SEED_RPC_PORT" || die "seed-1 JSON-RPC did not become ready"
wait_log "$SEED_DIR/node.log" "Host peer ID:" 45 || die "seed-1 did not log a libp2p host peer ID"
SEED_PEER_ID="$(extract_peer_id "$SEED_DIR/node.log")"
[[ -n "$SEED_PEER_ID" ]] || die "unable to parse seed-1 peer ID"
SEED_MULTIADDR="/ip4/127.0.0.1/tcp/${SEED_P2P_PORT}/p2p/${SEED_PEER_ID}"

write_config "$PRODUCER_DIR" "$PRODUCER_P2P_PORT" "$PRODUCER_RPC_PORT" "true" "$SEED_MULTIADDR"
echo "$PRODUCER_WIF" > "$PRODUCER_DIR/block_producer/private.key"
start_node "producer-1" "$PRODUCER_DIR" >/dev/null
wait_rpc_ready "$PRODUCER_RPC_PORT" || die "producer-1 JSON-RPC did not become ready"
wait_log "$PRODUCER_DIR/node.log" "Host peer ID:" 45 || die "producer-1 did not log a libp2p host peer ID"
PRODUCER_PEER_ID="$(extract_peer_id "$PRODUCER_DIR/node.log")"
[[ -n "$PRODUCER_PEER_ID" ]] || die "unable to parse producer-1 peer ID"
PRODUCER_MULTIADDR="/ip4/127.0.0.1/tcp/${PRODUCER_P2P_PORT}/p2p/${PRODUCER_PEER_ID}"

write_config "$OBSERVER_DIR" "$OBSERVER_P2P_PORT" "$OBSERVER_RPC_PORT" "false" "$SEED_MULTIADDR $PRODUCER_MULTIADDR"
start_node "observer-1" "$OBSERVER_DIR" >/dev/null
wait_rpc_ready "$OBSERVER_RPC_PORT" || die "observer-1 JSON-RPC did not become ready"

SEED_CHAIN_ID="$(chain_id "$SEED_RPC_PORT")"
PRODUCER_CHAIN_ID="$(chain_id "$PRODUCER_RPC_PORT")"
OBSERVER_CHAIN_ID="$(chain_id "$OBSERVER_RPC_PORT")"
[[ "$SEED_CHAIN_ID" == "$PRODUCER_CHAIN_ID" ]] || die "producer chain ID mismatch"
[[ "$SEED_CHAIN_ID" == "$OBSERVER_CHAIN_ID" ]] || die "observer chain ID mismatch"

wait_log "$PRODUCER_DIR/node.log" "\\[block_producer\\] Produced block - Height:" "$PRODUCED_TIMEOUT_SECONDS" \
  || die "producer-1 did not produce a block within ${PRODUCED_TIMEOUT_SECONDS}s"
PRODUCED_LINE="$(extract_produced_line "$PRODUCER_DIR/node.log")"
PRODUCED_HEIGHT="$(extract_produced_height "$PRODUCED_LINE")"
[[ -n "$PRODUCED_HEIGHT" ]] || die "unable to parse produced block height"

PRODUCER_HEAD_HEIGHT="$(wait_head_at_least "$PRODUCER_RPC_PORT" "$PRODUCED_HEIGHT" 10)" \
  || die "producer-1 head did not advance to produced height $PRODUCED_HEIGHT"
OBSERVER_HEAD_HEIGHT="$(wait_head_at_least "$OBSERVER_RPC_PORT" "$PRODUCED_HEIGHT" "$SYNC_TIMEOUT_SECONDS")" \
  || die "observer-1 did not catch produced height $PRODUCED_HEIGHT within ${SYNC_TIMEOUT_SECONDS}s"
OBSERVER_HIGHEST_HEIGHT="$(highest_height "$OBSERVER_RPC_PORT")"
if (( OBSERVER_HIGHEST_HEIGHT < PRODUCED_HEIGHT )); then
  die "observer block store highest height $OBSERVER_HIGHEST_HEIGHT is below produced height $PRODUCED_HEIGHT"
fi

run_soak

if rpc_result "$OBSERVER_RPC_PORT" "transaction_store.get_transactions_by_id" '{"transactionIds":["AA=="]}' >/dev/null 2>&1; then
  TRANSACTION_STORE_CHECK="ok"
else
  TRANSACTION_STORE_CHECK="failed"
  die "transaction store health check failed"
fi

if rpc_result "$OBSERVER_RPC_PORT" "contract_meta_store.get_contract_meta" '{"contractId":"AA=="}' >/dev/null 2>&1; then
  CONTRACT_META_STORE_CHECK="ok"
else
  CONTRACT_META_STORE_CHECK="failed"
  die "contract meta store health check failed"
fi

STATUS="passed"
if [[ "$MODE" == "pob" ]]; then
  POB_SIGNOFF_STATUS="passed"
fi
if (( SOAK_DURATION_SECONDS > 0 )); then
  echo "private testnet ${MODE} soak passed: duration=${SOAK_DURATION_SECONDS}s produced_height=$PRODUCED_HEIGHT observer_height=$OBSERVER_HEAD_HEIGHT report=$REPORT"
else
  echo "private testnet ${MODE} smoke passed: produced_height=$PRODUCED_HEIGHT observer_height=$OBSERVER_HEAD_HEIGHT report=$REPORT"
fi
