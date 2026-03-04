#!/usr/bin/env bash
set -euo pipefail

# Reusable helper for running the Koinos docker-compose stack.
# Default mode is "sync-only" (core services + p2p + jsonrpc), without block_producer.
# On macOS Docker Desktop it applies the same workaround used by the app:
# - prepares runtime files inside BASEDIR
# - injects a compose override that disables "configs" mounts under /koinos
# - forces linux/amd64 on macOS unless DOCKER_DEFAULT_PLATFORM is already set
# On Linux, it runs normally without the macOS-specific override.

KOINOS_REPO_PATH="${KOINOS_REPO_PATH:-/Users/pgarcgo/code/koinos_code/koinos}"
KOINOS_BASEDIR="${KOINOS_BASEDIR:-$HOME/.koinos}"
KOINOS_OVERRIDE_FILE="${KOINOS_OVERRIDE_FILE:-/tmp/knodel-koinos-dockerdesktop.override.yml}"
KOINOS_PROFILES="${KOINOS_PROFILES:-jsonrpc}"

usage() {
  cat <<'EOF'
Usage:
  scripts/koinos-compose-all.sh [compose-command] [args...]

Examples:
  scripts/koinos-compose-all.sh up
  scripts/koinos-compose-all.sh up -d
  scripts/koinos-compose-all.sh down
  scripts/koinos-compose-all.sh logs -f p2p
  scripts/koinos-compose-all.sh ps

Default behavior:
  - Sync-only mode (NO block_producer)
  - Uses profile: jsonrpc
  - Starts core services + p2p + jsonrpc

Examples with different profiles:
  KOINOS_PROFILES=api scripts/koinos-compose-all.sh up -d
  KOINOS_PROFILES=all scripts/koinos-compose-all.sh up -d

Environment overrides:
  KOINOS_REPO_PATH   Default: /Users/pgarcgo/code/koinos_code/koinos
  KOINOS_BASEDIR     Default: ~/.koinos
  KOINOS_OVERRIDE_FILE  Default: /tmp/knodel-koinos-dockerdesktop.override.yml
  KOINOS_PROFILES    Default: jsonrpc (comma-separated, e.g. "jsonrpc" or "api" or "all")
  DOCKER_DEFAULT_PLATFORM (optional; on macOS defaults to linux/amd64 if unset)
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "[koinos-compose-all] $*"
}

ensure_repo_files() {
  [[ -d "$KOINOS_REPO_PATH" ]] || die "Repo path not found: $KOINOS_REPO_PATH"
  [[ -f "$KOINOS_REPO_PATH/docker-compose.yml" ]] || die "Missing docker-compose.yml in $KOINOS_REPO_PATH"

  if [[ ! -d "$KOINOS_REPO_PATH/config" && -d "$KOINOS_REPO_PATH/config-example" ]]; then
    mv "$KOINOS_REPO_PATH/config-example" "$KOINOS_REPO_PATH/config"
    log "Renamed config-example/ -> config/"
  fi
  [[ -d "$KOINOS_REPO_PATH/config" ]] || die "Missing config/ (and config-example/ not found)"

  if [[ ! -f "$KOINOS_REPO_PATH/.env" && -f "$KOINOS_REPO_PATH/env.example" ]]; then
    mv "$KOINOS_REPO_PATH/env.example" "$KOINOS_REPO_PATH/.env"
    log "Renamed env.example -> .env"
  fi
  [[ -f "$KOINOS_REPO_PATH/.env" ]] || die "Missing .env (and env.example not found)"
}

prepare_runtime_files() {
  local cfg="$KOINOS_REPO_PATH/config"

  mkdir -p \
    "$KOINOS_BASEDIR" \
    "$KOINOS_BASEDIR/chain" \
    "$KOINOS_BASEDIR/jsonrpc/descriptors"

  [[ -f "$cfg/config.yml" ]] || die "Missing $cfg/config.yml"
  [[ -f "$cfg/genesis_data.json" ]] || die "Missing $cfg/genesis_data.json"
  [[ -f "$cfg/koinos_descriptors.pb" ]] || die "Missing $cfg/koinos_descriptors.pb"

  cp "$cfg/config.yml" "$KOINOS_BASEDIR/config.yml"
  cp "$cfg/genesis_data.json" "$KOINOS_BASEDIR/chain/genesis_data.json"
  cp "$cfg/koinos_descriptors.pb" "$KOINOS_BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"

  log "Prepared BASEDIR runtime files in $KOINOS_BASEDIR"
}

write_docker_desktop_override() {
  cat > "$KOINOS_OVERRIDE_FILE" <<'YAML'
services:
  amqp: { configs: [] }
  chain: { configs: [] }
  mempool: { configs: [] }
  block_store: { configs: [] }
  p2p: { configs: [] }
  block_producer: { configs: [] }
  jsonrpc: { configs: [] }
  grpc: { configs: [] }
  rest: { configs: [] }
  transaction_store: { configs: [] }
  contract_meta_store: { configs: [] }
  account_history: { configs: [] }
YAML
  log "Wrote Docker Desktop override: $KOINOS_OVERRIDE_FILE"
}

compose_cmd() {
  local action="$1"
  shift || true

  local -a cmd
  cmd=(docker compose -f docker-compose.yml)

  if [[ "$(uname -s)" == "Darwin" ]]; then
    write_docker_desktop_override
    cmd+=(-f "$KOINOS_OVERRIDE_FILE")
  fi

  cmd+=(--env-file .env)

  # Profiles matter mainly for "up"/"start".
  # Default is sync-only via profile "jsonrpc" to avoid starting block_producer.
  if [[ "$action" == "up" || "$action" == "start" ]]; then
    local profile
    IFS=',' read -r -a _profiles <<< "$KOINOS_PROFILES"
    for profile in "${_profiles[@]}"; do
      profile="${profile//[[:space:]]/}"
      [[ -n "$profile" ]] || continue
      cmd+=(--profile "$profile")
    done
  fi

  cmd+=("$action" "$@")

  (
    cd "$KOINOS_REPO_PATH"

    export BASEDIR="$KOINOS_BASEDIR"
    if [[ "$(uname -s)" == "Darwin" && -z "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
      export DOCKER_DEFAULT_PLATFORM="linux/amd64"
    fi

    log "Repo: $KOINOS_REPO_PATH"
    log "BASEDIR: $KOINOS_BASEDIR"
    if [[ "$action" == "up" || "$action" == "start" ]]; then
      log "Profiles: ${KOINOS_PROFILES:-"(none)"} (default sync-only avoids block_producer)"
    fi
    if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
      log "DOCKER_DEFAULT_PLATFORM=$DOCKER_DEFAULT_PLATFORM"
    fi
    log "Running: ${cmd[*]}"
    "${cmd[@]}"
  )
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  local action="up"
  if [[ $# -gt 0 && "${1#-}" == "$1" ]]; then
    action="$1"
    shift
  fi

  ensure_repo_files

  case "$action" in
    up|start|restart)
      prepare_runtime_files
      ;;
    *)
      # No runtime file copy needed for read-only/status commands.
      ;;
  esac

  compose_cmd "$action" "$@"
}

main "$@"
