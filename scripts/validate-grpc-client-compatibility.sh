#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MONOLITH_GRPC_TARGET="${MONOLITH_GRPC_TARGET:-127.0.0.1:50151}"
MONOLITH_JSONRPC_URL="${MONOLITH_JSONRPC_URL:-http://127.0.0.1:18124}"
VALIDATION_OUTPUT="${VALIDATION_OUTPUT:-/private/tmp/knodel-grpc-client-validation-$(date -u +%Y%m%dT%H%M%SZ).txt}"
GRPC_CLIENT_TIMEOUT_MS="${GRPC_CLIENT_TIMEOUT_MS:-20000}"
PROTO_ROOT="${PROTO_ROOT:-$ROOT_DIR/vendor/koinos/koinos-contracts-as}"
KOINOS_CLI_PATH="${KOINOS_CLI_PATH:-$(command -v koinos-cli || true)}"
KOINOSCTL_PATH="${KOINOSCTL_PATH:-$(command -v koinosctl || true)}"
GRPCURL="${GRPCURL:-$(command -v grpcurl || true)}"

if [[ -z "$GRPCURL" && -x /private/tmp/knodel-grpc-tools/grpcurl ]]; then
  GRPCURL=/private/tmp/knodel-grpc-tools/grpcurl
fi

mkdir -p "$(dirname "$VALIDATION_OUTPUT")"

section()
{
  echo
  echo "## $*"
}

run_report()
{
  echo "\$ $*"
  set +e
  "$@" 2>&1
  local status=$?
  set -e
  echo "exit_status=$status"
  return 0
}

{
  echo "# gRPC client compatibility validation"
  date -u '+timestamp=%Y-%m-%dT%H:%M:%SZ'
  echo "monolith_grpc_target=$MONOLITH_GRPC_TARGET"
  echo "monolith_jsonrpc_url=$MONOLITH_JSONRPC_URL"

  section "generated protobuf client probe"
  GRPC_PARITY_OUTPUT="${VALIDATION_OUTPUT%.txt}-probe.json" \
  MONOLITH_GRPC_TARGET="$MONOLITH_GRPC_TARGET" \
  GRPC_PARITY_TIMEOUT_MS="$GRPC_CLIENT_TIMEOUT_MS" \
    "$ROOT_DIR/scripts/compare-grpc-parity.sh"

  section "grpcurl typed gRPC client"
  if [[ -n "$GRPCURL" && -x "$GRPCURL" ]]; then
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto "$MONOLITH_GRPC_TARGET" list
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto \
      -d '{}' "$MONOLITH_GRPC_TARGET" koinos.services.koinos/get_chain_id
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto \
      -d '{}' "$MONOLITH_GRPC_TARGET" koinos.services.koinos/get_head_info
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto \
      -d '{}' "$MONOLITH_GRPC_TARGET" koinos.services.koinos/get_pending_transactions
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto \
      -d '{}' "$MONOLITH_GRPC_TARGET" koinos.services.koinos/get_contract_meta
    run_report "$GRPCURL" -plaintext -import-path "$PROTO_ROOT" -proto koinos/rpc/services.proto \
      -d '{}' "$MONOLITH_GRPC_TARGET" koinos.services.koinos/get_gossip_status
  else
    echo "grpcurl not found; install or set GRPCURL=/path/to/grpcurl to run this external-client check."
  fi

  section "koinos-cli client audit"
  if [[ -n "$KOINOS_CLI_PATH" && -x "$KOINOS_CLI_PATH" ]]; then
    run_report "$KOINOS_CLI_PATH" -v
    run_report "$KOINOS_CLI_PATH" --help
    run_report "$KOINOS_CLI_PATH" -r "$MONOLITH_JSONRPC_URL" -x 'balance 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi'
    echo "The installed koinos-cli uses HTTP JSON-RPC. The next command is expected to fail against the gRPC port."
    run_report "$KOINOS_CLI_PATH" -r "http://$MONOLITH_GRPC_TARGET" -x 'balance 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi'
  else
    echo "koinos-cli not found."
  fi

  section "koinosctl client audit"
  if [[ -n "$KOINOSCTL_PATH" && -x "$KOINOSCTL_PATH" ]]; then
    run_report "$KOINOSCTL_PATH" --help
  else
    echo "koinosctl not found in PATH."
  fi
} > "$VALIDATION_OUTPUT" 2>&1

echo "wrote gRPC client compatibility validation to $VALIDATION_OUTPUT"
