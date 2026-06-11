#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PEERS_FILE="${P2P_PEERS_FILE:-$ROOT_DIR/scripts/mainnet-peer-candidates.txt}"
RUN_ROOT="${AB_RUN_ROOT:-/private/tmp/teleno-ab-peer-acquisition}"
REPORT="${AB_REPORT:-$ROOT_DIR/docs/roadmap/monolith/networking/MONOLITH_AB_PEER_ACQUISITION_REPORT.md}"
GO_DISCOVERY_ATTEMPTS="${AB_GO_DISCOVERY_ATTEMPTS:-1}"
GO_DISCOVERY_TIMEOUT="${AB_GO_DISCOVERY_TIMEOUT:-8s}"
GO_STABILITY_ATTEMPTS="${AB_GO_STABILITY_ATTEMPTS:-3}"
GO_STABILITY_TIMEOUT="${AB_GO_STABILITY_TIMEOUT:-8s}"
GO_STABILITY_DELAY="${AB_GO_STABILITY_DELAY:-10s}"
RUN_MONOLITH="${AB_RUN_MONOLITH:-auto}"
MONOLITH_DURATION_SECONDS="${AB_MONOLITH_DURATION_SECONDS:-300}"
MONOLITH_INTERVAL_SECONDS="${AB_MONOLITH_INTERVAL_SECONDS:-15}"
MONOLITH_STARTUP_GRACE_SECONDS="${AB_MONOLITH_STARTUP_GRACE_SECONDS:-240}"
MONOLITH_MIN_HEAD_HEIGHT="${AB_MONOLITH_MIN_HEAD_HEIGHT:-1000}"
MONOLITH_JSONRPC_PORT="${AB_MONOLITH_JSONRPC_PORT:-18082}"
MONOLITH_P2P_LISTEN="${AB_MONOLITH_P2P_LISTEN:-/ip4/127.0.0.1/tcp/0}"

if [[ "$PEERS_FILE" != /* ]]; then
  PEERS_FILE="$ROOT_DIR/$PEERS_FILE"
fi

DISCOVERY_OUTPUT="$RUN_ROOT/go-discovery-validated.txt"
DISCOVERY_LOG="$RUN_ROOT/go-discovery.log"
STABILITY_OUTPUT="$RUN_ROOT/go-stable-validated.txt"
STABILITY_LOG="$RUN_ROOT/go-stability.log"
MONOLITH_REPORT="$RUN_ROOT/monolith-soak-report.md"
MONOLITH_LOG="$RUN_ROOT/monolith-soak.log"

mkdir -p "$RUN_ROOT" "$(dirname "$REPORT")"

peer_count() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo 0
    return
  fi
  { grep -vE '^[[:space:]]*(#|$)' "$file" || true; } | wc -l | tr -d ' '
}

peer_csv() {
  local file="$1"
  { grep -vE '^[[:space:]]*(#|$)' "$file" || true; } | paste -sd, -
}

write_report() {
  local status="$1"
  local classification="$2"
  local monolith_exit="${3:-not-run}"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  cat >"$REPORT" <<MD
# Monolith A/B Peer Acquisition Report

Updated: ${now}

## Result

- Status: ${status}
- Classification: ${classification}
- Git HEAD at run: ${commit}
- Run root: ${RUN_ROOT}

## Inputs

- Peer file: ${PEERS_FILE}
- Explicit P2P_PEERS: ${P2P_PEERS:-not-set}
- Go discovery attempts: ${GO_DISCOVERY_ATTEMPTS}
- Go discovery timeout: ${GO_DISCOVERY_TIMEOUT}
- Go stability attempts: ${GO_STABILITY_ATTEMPTS}
- Go stability timeout: ${GO_STABILITY_TIMEOUT}
- Go stability delay: ${GO_STABILITY_DELAY}
- Run monolith: ${RUN_MONOLITH}

## Go Legacy Direct-Dial Baseline

This baseline uses the same go-libp2p/gorpc stack and Peer RPC protocol as legacy \`koinos-p2p\`, but it does not start the full legacy microservice stack. The full legacy service still requires AMQP, chain, and block_store.

- Discovery output: ${DISCOVERY_OUTPUT}
- Discovery log: ${DISCOVERY_LOG}
- Discovery Peer RPC peers: $(peer_count "$DISCOVERY_OUTPUT")
- Stability output: ${STABILITY_OUTPUT}
- Stability log: ${STABILITY_LOG}
- Stable Peer RPC peers: $(peer_count "$STABILITY_OUTPUT")

## C++ Monolith

- Monolith exit code: ${monolith_exit}
- Monolith report: ${MONOLITH_REPORT}
- Monolith log: ${MONOLITH_LOG}
- Duration seconds: ${MONOLITH_DURATION_SECONDS}
- Interval seconds: ${MONOLITH_INTERVAL_SECONDS}
- Startup grace seconds: ${MONOLITH_STARTUP_GRACE_SECONDS}
- Minimum head height: ${MONOLITH_MIN_HEAD_HEIGHT}
- JSON-RPC port: ${MONOLITH_JSONRPC_PORT}
- P2P listen: ${MONOLITH_P2P_LISTEN}

## Decision Rule

- If Go has no stable Peer RPC peer, do not treat C++ failure as evidence of a C++ bug.
- If Go has a stable Peer RPC peer and C++ fails against that same peer list, continue C++ compatibility debugging.
- If both pass, Gate F can move back to longer soak duration.
MD
}

run_go_probe() {
  local peers_env="$1"
  local attempts="$2"
  local timeout="$3"
  local delay="$4"
  local output="$5"
  local log="$6"

  set +e
  if [[ -n "$peers_env" ]]; then
    GOCACHE=/private/tmp/teleno-go-cache \
      P2P_PEERS="$peers_env" \
      SEED_PROBE_ATTEMPTS="$attempts" \
      SEED_PROBE_TIMEOUT="$timeout" \
      SEED_PROBE_DELAY="$delay" \
      SEED_PROBE_OUTPUT="$output" \
      "$ROOT_DIR/scripts/probe-mainnet-seeds.sh" >"$log" 2>&1
  else
    GOCACHE=/private/tmp/teleno-go-cache \
      P2P_PEERS_FILE="$PEERS_FILE" \
      SEED_PROBE_ATTEMPTS="$attempts" \
      SEED_PROBE_TIMEOUT="$timeout" \
      SEED_PROBE_DELAY="$delay" \
      SEED_PROBE_OUTPUT="$output" \
      "$ROOT_DIR/scripts/probe-mainnet-seeds.sh" >"$log" 2>&1
  fi
  local exit_code=$?
  set -e
  return "$exit_code"
}

run_monolith_soak() {
  set +e
  SOAK_DURATION_SECONDS="$MONOLITH_DURATION_SECONDS" \
    SOAK_INTERVAL_SECONDS="$MONOLITH_INTERVAL_SECONDS" \
    SOAK_STARTUP_GRACE_SECONDS="$MONOLITH_STARTUP_GRACE_SECONDS" \
    SOAK_REQUIRE_PROGRESS=1 \
    SOAK_REQUIRE_HEAD_PROGRESS=1 \
    SOAK_MIN_HEAD_HEIGHT="$MONOLITH_MIN_HEAD_HEIGHT" \
    JSONRPC_PORT="$MONOLITH_JSONRPC_PORT" \
    P2P_LISTEN="$MONOLITH_P2P_LISTEN" \
    P2P_PEERS_FILE="$STABILITY_OUTPUT" \
    MONOLITH_SOAK_REPORT="$MONOLITH_REPORT" \
    MONOLITH_SOAK_LOG="$MONOLITH_LOG" \
    "$ROOT_DIR/scripts/soak-mainnet-p2p.sh" >"$RUN_ROOT/monolith-soak.stdout" 2>"$RUN_ROOT/monolith-soak.stderr"
  local exit_code=$?
  set -e
  return "$exit_code"
}

echo "==> Go discovery probe"
run_go_probe "${P2P_PEERS:-}" "$GO_DISCOVERY_ATTEMPTS" "$GO_DISCOVERY_TIMEOUT" "0s" "$DISCOVERY_OUTPUT" "$DISCOVERY_LOG" || true
discovery_count="$(peer_count "$DISCOVERY_OUTPUT")"
echo "go discovery Peer RPC peers: $discovery_count"

if [[ "$discovery_count" -eq 0 ]]; then
  write_report "blocked" "go-discovery-found-no-peer-rpc-targets" "skipped"
  echo "A/B peer acquisition blocked: Go discovery found no Peer RPC-capable targets"
  exit 1
fi

echo "==> Go stability probe"
run_go_probe "$(peer_csv "$DISCOVERY_OUTPUT")" "$GO_STABILITY_ATTEMPTS" "$GO_STABILITY_TIMEOUT" "$GO_STABILITY_DELAY" "$STABILITY_OUTPUT" "$STABILITY_LOG" || true
stable_count="$(peer_count "$STABILITY_OUTPUT")"
echo "go stable Peer RPC peers: $stable_count"

if [[ "$stable_count" -eq 0 ]]; then
  write_report "blocked" "go-stability-found-only-transient-peer-rpc-targets" "skipped"
  echo "A/B peer acquisition blocked: Go stability probe found only transient Peer RPC targets"
  exit 1
fi

if [[ "$RUN_MONOLITH" == "0" || "$RUN_MONOLITH" == "false" ]]; then
  write_report "partial" "go-stable-monolith-skipped" "skipped"
  echo "A/B peer acquisition partial: Go baseline found stable peers; monolith was skipped"
  exit 0
fi

echo "==> C++ monolith soak against Go-stable peers"
monolith_exit=0
run_monolith_soak || monolith_exit=$?

if [[ "$monolith_exit" -eq 0 ]]; then
  write_report "passed" "go-stable-and-monolith-progressed" "$monolith_exit"
  echo "A/B peer acquisition passed: Go baseline and monolith both progressed"
  exit 0
fi

write_report "failed" "go-stable-but-monolith-failed" "$monolith_exit"
echo "A/B peer acquisition failed: Go baseline found stable peers, but monolith soak failed"
exit "$monolith_exit"
