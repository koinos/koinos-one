#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PRODUCER_RPC_URL="${PRODUCER_RPC_URL:-}"
OBSERVER_RPC_URL="${OBSERVER_RPC_URL:-}"
SEED_RPC_URL="${SEED_RPC_URL:-}"
REPORT="${REPORT:-$ROOT_DIR/docs/roadmap/monolith/testnets/MONOLITH_EXTERNAL_TESTNET_REPORT.md}"
SAMPLES_FILE="${EXTERNAL_TESTNET_SAMPLES_FILE:-/private/tmp/knodel-external-testnet-samples.tsv}"
DURATION_SECONDS="${EXTERNAL_TESTNET_DURATION_SECONDS:-1800}"
INTERVAL_SECONDS="${EXTERNAL_TESTNET_INTERVAL_SECONDS:-60}"
MAX_OBSERVER_LAG="${EXTERNAL_TESTNET_MAX_OBSERVER_LAG:-2000}"
ALLOW_SINGLE_RPC="${EXTERNAL_TESTNET_ALLOW_SINGLE_RPC:-0}"
CHECK_STORES="${EXTERNAL_TESTNET_CHECK_STORES:-1}"
PRODUCER_LOG_FILE="${EXTERNAL_TESTNET_PRODUCER_LOG_FILE:-}"
OBSERVER_LOG_FILE="${EXTERNAL_TESTNET_OBSERVER_LOG_FILE:-}"

STATUS="failed"
FAIL_REASON=""
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SAMPLE_COUNT=0
STALLED_SAMPLES=0
MAX_CONSECUTIVE_STALLED_SAMPLES=0
SEVERE_LOG_MATCHES="not-run"

usage() {
  cat <<USAGE >&2
usage: PRODUCER_RPC_URL=http://host:port/ OBSERVER_RPC_URL=http://host:port/ $0

Environment:
  PRODUCER_RPC_URL                    Producer node JSON-RPC endpoint. Required.
  OBSERVER_RPC_URL                    Independent observer JSON-RPC endpoint. Required.
  SEED_RPC_URL                        Optional seed JSON-RPC endpoint for chain ID comparison.
  EXTERNAL_TESTNET_DURATION_SECONDS   Sampling duration. Default: 1800.
  EXTERNAL_TESTNET_INTERVAL_SECONDS   Sampling interval. Default: 60.
  EXTERNAL_TESTNET_MAX_OBSERVER_LAG   Max final producer-observer head lag. Default: 2000.
  EXTERNAL_TESTNET_CHECK_STORES       Check observer block/transaction/contract stores. Default: 1.
  EXTERNAL_TESTNET_PRODUCER_LOG_FILE  Optional local producer log copy to scan.
  EXTERNAL_TESTNET_OBSERVER_LOG_FILE  Optional local observer log copy to scan.
  REPORT                              Markdown report path. Default: docs/roadmap/monolith/testnets/MONOLITH_EXTERNAL_TESTNET_REPORT.md.
USAGE
}

die() {
  FAIL_REASON="$*"
  echo "error: $*" >&2
  exit 1
}

require_config() {
  if [[ -z "$PRODUCER_RPC_URL" || -z "$OBSERVER_RPC_URL" ]]; then
    usage
    STATUS="blocked"
    die "PRODUCER_RPC_URL and OBSERVER_RPC_URL are required for shared/external testnet signoff"
  fi
  if [[ "$ALLOW_SINGLE_RPC" != "1" && "$PRODUCER_RPC_URL" == "$OBSERVER_RPC_URL" ]]; then
    STATUS="blocked"
    die "producer and observer RPC endpoints must be independent; set EXTERNAL_TESTNET_ALLOW_SINGLE_RPC=1 only for diagnostics"
  fi
}

rpc_raw() {
  local url="$1"
  local method="$2"
  local params="${3:-}"
  if [[ -z "$params" ]]; then
    params="{}"
  fi
  node - "$url" "$method" "$params" <<'NODE'
const http = require('node:http')
const https = require('node:https')

const [urlText, method, paramsJson] = process.argv.slice(2)
const url = new URL(urlText)
const params = JSON.parse(paramsJson || '{}')
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
const transport = url.protocol === 'https:' ? https : http

const req = transport.request({
  protocol: url.protocol,
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: `${url.pathname || '/'}${url.search || ''}`,
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  },
  timeout: 10000
}, (res) => {
  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`HTTP ${res.statusCode}: ${data}`)
      process.exit(1)
    }
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
  local url="$1"
  local method="$2"
  local params="${3:-}"
  if [[ -z "$params" ]]; then
    params="{}"
  fi
  local raw
  raw="$(rpc_raw "$url" "$method" "$params")"
  node - "$raw" <<'NODE'
const response = JSON.parse(process.argv[2])
if (response.error) {
  console.error(JSON.stringify(response.error))
  process.exit(1)
}
process.stdout.write(JSON.stringify(response.result || {}))
NODE
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

chain_id() {
  node - "$(rpc_result "$1" "chain.get_chain_id" "{}")" <<'NODE'
const result = JSON.parse(process.argv[2])
console.log(result.chain_id || result.chainId || '')
NODE
}

count_severe_log_matches() {
  local total=0
  local file count
  for file in "$PRODUCER_LOG_FILE" "$OBSERVER_LOG_FILE"; do
    if [[ -n "$file" && -f "$file" ]]; then
      count="$(grep -Eic "Block application failed|could not burn vhp|proposal failed|rejected proposal|chain ID mismatch|Segmentation fault|Assertion" "$file" 2>/dev/null || true)"
      total=$((total + count))
    fi
  done
  echo "$total"
}

write_report() {
  local finished_at
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local dirty
  dirty="$(git -C "$ROOT_DIR" status --short 2>/dev/null | wc -l | tr -d ' ')"
  mkdir -p "$(dirname "$REPORT")"
  cat > "$REPORT" <<REPORT_MD
# Monolith External Testnet Report

Updated: ${finished_at}

## Result

- Status: ${STATUS}
- Failure reason: ${FAIL_REASON:-none}
- Started: ${STARTED_AT}
- Finished: ${finished_at}
- Commit: ${commit}
- Dirty worktree entries at report time: ${dirty}

## Endpoints

- Producer RPC: ${PRODUCER_RPC_URL:-not-configured}
- Observer RPC: ${OBSERVER_RPC_URL:-not-configured}
- Seed RPC: ${SEED_RPC_URL:-not-configured}

## Chain IDs

- Producer chain ID: ${PRODUCER_CHAIN_ID:-not-run}
- Observer chain ID: ${OBSERVER_CHAIN_ID:-not-run}
- Seed chain ID: ${SEED_CHAIN_ID:-not-run}

## Soak

- Duration seconds: ${DURATION_SECONDS}
- Interval seconds: ${INTERVAL_SECONDS}
- Samples file: ${SAMPLES_FILE}
- Samples: ${SAMPLE_COUNT}
- Initial producer head: ${INITIAL_PRODUCER_HEIGHT:-not-run}
- Final producer head: ${FINAL_PRODUCER_HEIGHT:-not-run}
- Initial observer head: ${INITIAL_OBSERVER_HEIGHT:-not-run}
- Final observer head: ${FINAL_OBSERVER_HEIGHT:-not-run}
- Initial observer block-store highest height: ${INITIAL_OBSERVER_HIGHEST:-not-run}
- Final observer block-store highest height: ${FINAL_OBSERVER_HIGHEST:-not-run}
- Final observer lag: ${FINAL_OBSERVER_LAG:-not-run}
- Max allowed observer lag: ${MAX_OBSERVER_LAG}
- Stalled samples: ${STALLED_SAMPLES}
- Max consecutive stalled samples: ${MAX_CONSECUTIVE_STALLED_SAMPLES}
- Severe log matches: ${SEVERE_LOG_MATCHES}

## Store Checks

- Enabled: ${CHECK_STORES}
- Observer block-store check: ${OBSERVER_BLOCK_STORE_CHECK:-not-run}
- Observer transaction-store check: ${OBSERVER_TRANSACTION_STORE_CHECK:-not-run}
- Observer contract-meta-store check: ${OBSERVER_CONTRACT_META_STORE_CHECK:-not-run}
REPORT_MD
}
trap write_report EXIT

require_config
mkdir -p "$(dirname "$SAMPLES_FILE")"

PRODUCER_CHAIN_ID="$(chain_id "$PRODUCER_RPC_URL")"
OBSERVER_CHAIN_ID="$(chain_id "$OBSERVER_RPC_URL")"
[[ -n "$PRODUCER_CHAIN_ID" ]] || die "producer chain ID is empty"
[[ "$PRODUCER_CHAIN_ID" == "$OBSERVER_CHAIN_ID" ]] || die "producer and observer chain IDs differ"
if [[ -n "$SEED_RPC_URL" ]]; then
  SEED_CHAIN_ID="$(chain_id "$SEED_RPC_URL")"
  [[ "$PRODUCER_CHAIN_ID" == "$SEED_CHAIN_ID" ]] || die "producer and seed chain IDs differ"
else
  SEED_CHAIN_ID="not-configured"
fi

INITIAL_PRODUCER_HEIGHT="$(head_height "$PRODUCER_RPC_URL")"
INITIAL_OBSERVER_HEIGHT="$(head_height "$OBSERVER_RPC_URL")"
if [[ "$CHECK_STORES" == "1" ]]; then
  INITIAL_OBSERVER_HIGHEST="$(highest_height "$OBSERVER_RPC_URL")"
else
  INITIAL_OBSERVER_HIGHEST="not-run"
fi

{
  printf "timestamp\telapsed_seconds\tproducer_head\tobserver_head\tobserver_highest\n"
} > "$SAMPLES_FILE"

deadline=$((SECONDS + DURATION_SECONDS))
last_observer_height="$INITIAL_OBSERVER_HEIGHT"
consecutive_stalls=0

while (( SECONDS <= deadline )); do
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  elapsed=$((DURATION_SECONDS - (deadline - SECONDS)))
  producer_height="$(head_height "$PRODUCER_RPC_URL")"
  observer_height="$(head_height "$OBSERVER_RPC_URL")"
  if [[ "$CHECK_STORES" == "1" ]]; then
    observer_highest="$(highest_height "$OBSERVER_RPC_URL")"
  else
    observer_highest="not-run"
  fi

  printf "%s\t%s\t%s\t%s\t%s\n" "$now" "$elapsed" "$producer_height" "$observer_height" "$observer_highest" >> "$SAMPLES_FILE"
  echo "external sample: elapsed=${elapsed}s producer=${producer_height} observer=${observer_height} block_store=${observer_highest}"
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))

  if ! [[ "$producer_height" =~ ^[0-9]+$ && "$observer_height" =~ ^[0-9]+$ ]]; then
    die "JSON-RPC returned non-numeric head height"
  fi
  if [[ "$CHECK_STORES" == "1" ]]; then
    if ! [[ "$observer_highest" =~ ^[0-9]+$ ]]; then
      die "observer block store returned non-numeric height"
    fi
    if (( observer_highest < observer_height )); then
      die "observer block-store highest height $observer_highest is below observer head $observer_height"
    fi
  fi

  if (( SAMPLE_COUNT > 1 )); then
    if (( observer_height <= last_observer_height )); then
      consecutive_stalls=$((consecutive_stalls + 1))
      STALLED_SAMPLES=$((STALLED_SAMPLES + 1))
      if (( consecutive_stalls > MAX_CONSECUTIVE_STALLED_SAMPLES )); then
        MAX_CONSECUTIVE_STALLED_SAMPLES="$consecutive_stalls"
      fi
      if (( consecutive_stalls >= 3 )); then
        die "observer head stalled at $observer_height for $consecutive_stalls consecutive samples"
      fi
    else
      consecutive_stalls=0
    fi
  fi
  last_observer_height="$observer_height"

  if (( SECONDS >= deadline )); then
    break
  fi
  sleep_for="$INTERVAL_SECONDS"
  remaining=$((deadline - SECONDS))
  if (( sleep_for > remaining )); then
    sleep_for="$remaining"
  fi
  if (( sleep_for > 0 )); then
    sleep "$sleep_for"
  fi
done

FINAL_PRODUCER_HEIGHT="$(head_height "$PRODUCER_RPC_URL")"
FINAL_OBSERVER_HEIGHT="$(head_height "$OBSERVER_RPC_URL")"
if [[ "$CHECK_STORES" == "1" ]]; then
  FINAL_OBSERVER_HIGHEST="$(highest_height "$OBSERVER_RPC_URL")"
else
  FINAL_OBSERVER_HIGHEST="not-run"
fi
SEVERE_LOG_MATCHES="$(count_severe_log_matches)"

if (( FINAL_PRODUCER_HEIGHT <= INITIAL_PRODUCER_HEIGHT )); then
  die "producer head did not progress"
fi
if (( FINAL_OBSERVER_HEIGHT <= INITIAL_OBSERVER_HEIGHT )); then
  die "observer head did not progress"
fi
if (( FINAL_PRODUCER_HEIGHT > FINAL_OBSERVER_HEIGHT )); then
  FINAL_OBSERVER_LAG=$((FINAL_PRODUCER_HEIGHT - FINAL_OBSERVER_HEIGHT))
else
  FINAL_OBSERVER_LAG=0
fi
if (( FINAL_OBSERVER_LAG > MAX_OBSERVER_LAG )); then
  die "final observer lag $FINAL_OBSERVER_LAG exceeds max $MAX_OBSERVER_LAG"
fi
if [[ "$CHECK_STORES" == "1" ]]; then
  if (( FINAL_OBSERVER_HIGHEST < FINAL_OBSERVER_HEIGHT )); then
    die "final observer block-store highest height $FINAL_OBSERVER_HIGHEST is below observer head $FINAL_OBSERVER_HEIGHT"
  fi
  OBSERVER_BLOCK_STORE_CHECK="ok"
  if rpc_result "$OBSERVER_RPC_URL" "transaction_store.get_transactions_by_id" '{"transactionIds":["AA=="]}' >/dev/null 2>&1; then
    OBSERVER_TRANSACTION_STORE_CHECK="ok"
  else
    OBSERVER_TRANSACTION_STORE_CHECK="failed"
    die "observer transaction store health check failed"
  fi
  if rpc_result "$OBSERVER_RPC_URL" "contract_meta_store.get_contract_meta" '{"contractId":"AA=="}' >/dev/null 2>&1; then
    OBSERVER_CONTRACT_META_STORE_CHECK="ok"
  else
    OBSERVER_CONTRACT_META_STORE_CHECK="failed"
    die "observer contract meta store health check failed"
  fi
fi
if (( SEVERE_LOG_MATCHES > 0 )); then
  die "found $SEVERE_LOG_MATCHES severe log match(es)"
fi

STATUS="passed"
echo "external PoB testnet signoff passed: producer_head=$FINAL_PRODUCER_HEIGHT observer_head=$FINAL_OBSERVER_HEIGHT report=$REPORT"
