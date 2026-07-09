#!/usr/bin/env bash
# Wrapper around the teleno submodule's native build script.
# Keeps the Koinos One dependency cache location (.deps/teleno-node)
# while the actual build logic lives in node/teleno-node (koinos/teleno).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TELENO_SCRIPT="$ROOT_DIR/node/teleno-node/scripts/build-cpp-libp2p-koinos.sh"

if [[ ! -f "$TELENO_SCRIPT" ]]; then
  echo "error: $TELENO_SCRIPT not found." >&2
  echo "The teleno submodule is not initialized. Run:" >&2
  echo "  git submodule update --init node/teleno-node" >&2
  exit 1
fi

export KOINOS_DEPS_ROOT="${KOINOS_DEPS_ROOT:-$ROOT_DIR/.deps/teleno-node}"
exec "$TELENO_SCRIPT" "$@"
