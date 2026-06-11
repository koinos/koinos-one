#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/node/teleno-node/build}"
PROBE="$BUILD_DIR/koinos_grpc_parity_probe"

MONOLITH_GRPC_TARGET="${MONOLITH_GRPC_TARGET:-${1:-}}"
LEGACY_GRPC_TARGET="${LEGACY_GRPC_TARGET:-${2:-}}"
GRPC_PARITY_OUTPUT="${GRPC_PARITY_OUTPUT:-/private/tmp/knodel-grpc-parity-$(date -u +%Y%m%dT%H%M%SZ).json}"
GRPC_PARITY_TIMEOUT_MS="${GRPC_PARITY_TIMEOUT_MS:-5000}"
GRPC_PARITY_STRICT_PAYLOAD="${GRPC_PARITY_STRICT_PAYLOAD:-0}"
GRPC_PARITY_FAIL_ON_MISMATCH="${GRPC_PARITY_FAIL_ON_MISMATCH:-0}"
GRPC_PARITY_LEGACY_INPUT="${GRPC_PARITY_LEGACY_INPUT:-}"
GRPC_PARITY_MONOLITH_INPUT="${GRPC_PARITY_MONOLITH_INPUT:-}"

if [[ -z "$MONOLITH_GRPC_TARGET" && -z "$LEGACY_GRPC_TARGET" && -z "$GRPC_PARITY_LEGACY_INPUT" && -z "$GRPC_PARITY_MONOLITH_INPUT" ]]; then
  cat >&2 <<'EOF'
usage:
  MONOLITH_GRPC_TARGET=127.0.0.1:50051 [LEGACY_GRPC_TARGET=127.0.0.1:50052] scripts/compare-grpc-parity.sh
  scripts/compare-grpc-parity.sh 127.0.0.1:50051 [127.0.0.1:50052]
  GRPC_PARITY_LEGACY_INPUT=legacy.json GRPC_PARITY_MONOLITH_INPUT=monolith.json scripts/compare-grpc-parity.sh

The harness probes the real koinos.services.koinos gRPC service with generated
protobuf stubs. If LEGACY_GRPC_TARGET is provided, it compares status codes and
stable protobuf payloads between legacy and monolith. The input-file mode allows
sequential comparison when legacy and monolith cannot open the same basedir at
the same time.
EOF
  exit 2
fi

cmake --build "$BUILD_DIR" --target koinos_grpc_parity_probe --parallel

args=(--timeout-ms "$GRPC_PARITY_TIMEOUT_MS" --output "$GRPC_PARITY_OUTPUT")
if [[ -n "$MONOLITH_GRPC_TARGET" ]]; then
  args+=(--monolith "$MONOLITH_GRPC_TARGET")
fi
if [[ -n "$LEGACY_GRPC_TARGET" ]]; then
  args+=(--legacy "$LEGACY_GRPC_TARGET")
fi
if [[ -n "$GRPC_PARITY_LEGACY_INPUT" ]]; then
  args+=(--legacy-input "$GRPC_PARITY_LEGACY_INPUT")
fi
if [[ -n "$GRPC_PARITY_MONOLITH_INPUT" ]]; then
  args+=(--monolith-input "$GRPC_PARITY_MONOLITH_INPUT")
fi
if [[ "$GRPC_PARITY_STRICT_PAYLOAD" == "1" ]]; then
  args+=(--strict-payload)
fi
if [[ "$GRPC_PARITY_FAIL_ON_MISMATCH" == "1" ]]; then
  args+=(--fail-on-mismatch)
fi

"$PROBE" "${args[@]}"
