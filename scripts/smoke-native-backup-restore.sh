#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$ROOT_DIR/node/teleno-node/build/teleno_node}"
CONFIG_EXAMPLE_DIR="${CONFIG_EXAMPLE_DIR:-$ROOT_DIR/vendor/koinos/koinos/config-example}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
RUN_ROOT="${TELENO_BACKUP_SMOKE_ROOT:-/private/tmp/teleno-native-backup-smoke}"
REPORT_DIR="${REPORT_DIR:-$RUN_ROOT/$TIMESTAMP}"
SOURCE_PORT="${SOURCE_PORT:-28350}"
RESTORE_PORT="${RESTORE_PORT:-28351}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
REMOTE_ENABLED="${TELENO_BACKUP_REMOTE:-0}"

SOURCE_BASEDIR="$REPORT_DIR/source/basedir"
SOURCE_REPO="$REPORT_DIR/source/repo"
SOURCE_WORKSPACE="$REPORT_DIR/source/workspace"
SOURCE_CONFIG="$SOURCE_BASEDIR/config.yml"
SOURCE_LOG="$REPORT_DIR/source/teleno_node.log"

RESTORE_BASEDIR="$REPORT_DIR/restore/basedir"
RESTORE_REPO="$REPORT_DIR/restore/repo"
RESTORE_WORKSPACE="$REPORT_DIR/restore/workspace"
RESTORE_STAGING="$REPORT_DIR/restore/staging"
RESTORE_CONFIG="$REPORT_DIR/restore/config.yml"
RESTORE_LOG="$REPORT_DIR/restore/teleno_node.log"

SOURCE_PID=""
RESTORE_PID=""

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage:
  scripts/smoke-native-backup-restore.sh

Default mode creates a local native backup repository and restores from it.
Set TELENO_BACKUP_REMOTE=1 to also exercise native libssh SFTP upload/fetch.

Environment:
  NODE_BIN                         teleno_node binary path.
  REPORT_DIR                       Output directory. Defaults under /private/tmp.
  SOURCE_PORT                      Source node JSON-RPC port. Default: 28350.
  RESTORE_PORT                     Restored node JSON-RPC port. Default: 28351.
  STARTUP_TIMEOUT_SECONDS          JSON-RPC startup timeout. Default: 30.
  CONFIG_EXAMPLE_DIR               Directory containing genesis_data.json and koinos_descriptors.pb.

Remote SFTP mode:
  TELENO_BACKUP_REMOTE=1
  TELENO_BACKUP_SSH_HOST           SSH/SFTP host.
  TELENO_BACKUP_SSH_USER           SSH/SFTP user.
  TELENO_BACKUP_REMOTE_DIR         Existing absolute remote directory.
  TELENO_BACKUP_SSH_AUTH           private-key, password-file, or env-password. Default: private-key.
  TELENO_BACKUP_SSH_PRIVATE_KEY_FILE
  TELENO_BACKUP_SSH_PASSWORD_FILE
  TELENO_BACKUP_SSH_PASSPHRASE_FILE
  TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE
  TELENO_BACKUP_SSH_STRICT_HOST_KEY_CHECKING  true or false. Default: true.
EOF
}

cleanup() {
  if [[ -n "$RESTORE_PID" ]] && kill -0 "$RESTORE_PID" 2>/dev/null; then
    kill "$RESTORE_PID" 2>/dev/null || true
    wait "$RESTORE_PID" 2>/dev/null || true
  fi
  if [[ -n "$SOURCE_PID" ]] && kill -0 "$SOURCE_PID" 2>/dev/null; then
    kill "$SOURCE_PID" 2>/dev/null || true
    wait "$SOURCE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"
}

port_is_free() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

json_value() {
  local expression="$1"
  node -e '
const fs = require("node:fs");
const expression = process.argv[1];
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const fn = new Function("data", `return (${expression});`);
const value = fn(data);
if (value === undefined || value === null) process.exit(2);
if (typeof value === "object") console.log(JSON.stringify(value));
else console.log(String(value));
' "$expression"
}

rpc_call() {
  local port="$1"
  local method="$2"
  curl -sS --max-time 5 "http://127.0.0.1:${port}/" \
    -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":{}}"
}

wait_for_rpc() {
  local port="$1"
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if rpc_call "$port" "chain.get_head_info" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

write_common_config() {
  local path="$1"
  local port="$2"
  local local_repo="$3"
  local workspace="$4"
  local include_remote="$5"
  local node_id="$6"

  cat >"$path" <<YAML
global:
  log-level: info
  log-color: false
  log-datetime: true
  fork-algorithm: pob
chain:
  verify-blocks: false
jsonrpc:
  listen: 127.0.0.1:${port}
backup:
  enabled: true
  node-id: ${node_id}
  workspace: ${workspace}
  local:
    enabled: true
    directory: ${local_repo}
    retention-count: 2
YAML

  if [[ "$include_remote" == "1" ]]; then
    cat >>"$path" <<YAML
  ssh:
    enabled: true
    transport: native
    host: ${TELENO_BACKUP_SSH_HOST}
    port: ${TELENO_BACKUP_SSH_PORT:-22}
    user: ${TELENO_BACKUP_SSH_USER}
    auth: ${TELENO_BACKUP_SSH_AUTH:-private-key}
YAML
    if [[ -n "${TELENO_BACKUP_SSH_PRIVATE_KEY_FILE:-}" ]]; then
      cat >>"$path" <<YAML
    private-key-file: ${TELENO_BACKUP_SSH_PRIVATE_KEY_FILE}
YAML
    fi
    if [[ -n "${TELENO_BACKUP_SSH_PASSWORD_FILE:-}" ]]; then
      cat >>"$path" <<YAML
    password-file: ${TELENO_BACKUP_SSH_PASSWORD_FILE}
YAML
    fi
    if [[ -n "${TELENO_BACKUP_SSH_PASSPHRASE_FILE:-}" ]]; then
      cat >>"$path" <<YAML
    passphrase-file: ${TELENO_BACKUP_SSH_PASSPHRASE_FILE}
YAML
    fi
    if [[ -n "${TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE:-}" ]]; then
      cat >>"$path" <<YAML
    known-hosts-file: ${TELENO_BACKUP_SSH_KNOWN_HOSTS_FILE}
YAML
    fi
    cat >>"$path" <<YAML
    strict-host-key-checking: ${TELENO_BACKUP_SSH_STRICT_HOST_KEY_CHECKING:-true}
    connect-timeout-seconds: ${TELENO_BACKUP_SSH_CONNECT_TIMEOUT_SECONDS:-15}
  remote:
    enabled: true
    directory: ${TELENO_BACKUP_REMOTE_DIR}
    retention-count: 2
    retention-days: 1
    upload-temp-suffix: .partial
YAML
  else
    cat >>"$path" <<'YAML'
  remote:
    enabled: false
YAML
  fi

  cat >>"$path" <<'YAML'
features:
  chain: true
  mempool: true
  block_store: true
  p2p: false
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: true
  transaction_store: false
  account_history: false
YAML
}

prepare_basedir() {
  local basedir="$1"
  mkdir -p "$basedir/chain" "$basedir/jsonrpc/descriptors"
  cp "$CONFIG_EXAMPLE_DIR/genesis_data.json" "$basedir/genesis_data.json"
  cp "$CONFIG_EXAMPLE_DIR/genesis_data.json" "$basedir/chain/genesis_data.json"
  cp "$CONFIG_EXAMPLE_DIR/koinos_descriptors.pb" "$basedir/jsonrpc/descriptors/koinos_descriptors.pb"
}

start_node() {
  local basedir="$1"
  local config="$2"
  local log="$3"
  local port="$4"
  "$NODE_BIN" --basedir "$basedir" --config "$config" --disable block_producer >"$log" 2>&1 &
  local pid="$!"
  if ! wait_for_rpc "$port"; then
    cat "$log" >&2 || true
    die "node did not become ready on port $port"
  fi
  echo "$pid"
}

stop_pid() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

validate_remote_env() {
  [[ "$REMOTE_ENABLED" == "0" || "$REMOTE_ENABLED" == "1" ]] || die "TELENO_BACKUP_REMOTE must be 0 or 1"
  if [[ "$REMOTE_ENABLED" == "0" ]]; then
    return
  fi

  [[ -n "${TELENO_BACKUP_SSH_HOST:-}" ]] || die "TELENO_BACKUP_SSH_HOST is required when TELENO_BACKUP_REMOTE=1"
  [[ -n "${TELENO_BACKUP_SSH_USER:-}" ]] || die "TELENO_BACKUP_SSH_USER is required when TELENO_BACKUP_REMOTE=1"
  [[ -n "${TELENO_BACKUP_REMOTE_DIR:-}" ]] || die "TELENO_BACKUP_REMOTE_DIR is required when TELENO_BACKUP_REMOTE=1"
  [[ "${TELENO_BACKUP_REMOTE_DIR}" == /* ]] || die "TELENO_BACKUP_REMOTE_DIR must be an absolute remote path"

  local auth="${TELENO_BACKUP_SSH_AUTH:-private-key}"
  case "$auth" in
    private-key)
      [[ -n "${TELENO_BACKUP_SSH_PRIVATE_KEY_FILE:-}" ]] || die "TELENO_BACKUP_SSH_PRIVATE_KEY_FILE is required for private-key auth"
      [[ -f "$TELENO_BACKUP_SSH_PRIVATE_KEY_FILE" ]] || die "private key file not found: $TELENO_BACKUP_SSH_PRIVATE_KEY_FILE"
      ;;
    password-file)
      [[ -n "${TELENO_BACKUP_SSH_PASSWORD_FILE:-}" ]] || die "TELENO_BACKUP_SSH_PASSWORD_FILE is required for password-file auth"
      [[ -f "$TELENO_BACKUP_SSH_PASSWORD_FILE" ]] || die "password file not found: $TELENO_BACKUP_SSH_PASSWORD_FILE"
      ;;
    env-password)
      [[ -n "${TELENO_BACKUP_SSH_PASSWORD:-}" ]] || die "TELENO_BACKUP_SSH_PASSWORD is required for env-password auth"
      export TELENO_BACKUP_SSH_PASSWORD
      ;;
    *)
      die "unsupported TELENO_BACKUP_SSH_AUTH: $auth"
      ;;
  esac
}

write_summary() {
  local status="$1"
  local source_chain_id="$2"
  local source_height="$3"
  local restore_chain_id="$4"
  local restore_height="$5"
  local backup_id="$6"
  local restore_backup_id="$7"

  cat >"$REPORT_DIR/summary.md" <<MD
# Native Backup Restore Smoke

- Status: \`${status}\`
- Remote SFTP: \`${REMOTE_ENABLED}\`
- Source chain ID: \`${source_chain_id}\`
- Source height: \`${source_height}\`
- Restore chain ID: \`${restore_chain_id}\`
- Restore height: \`${restore_height}\`
- Backup ID: \`${backup_id}\`
- Restored backup ID: \`${restore_backup_id}\`
- Source log: \`${SOURCE_LOG}\`
- Restore log: \`${RESTORE_LOG}\`
- Source config: \`${SOURCE_CONFIG}\`
- Restore config: \`${RESTORE_CONFIG}\`
MD

  node - "$REPORT_DIR/summary.json" "$status" "$REMOTE_ENABLED" "$source_chain_id" "$source_height" "$restore_chain_id" "$restore_height" "$backup_id" "$restore_backup_id" <<'JS'
const fs = require("node:fs");
const [path, status, remote, sourceChainId, sourceHeight, restoreChainId, restoreHeight, backupId, restoreBackupId] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({
  status,
  remote_sftp: remote === "1",
  source_chain_id: sourceChainId,
  source_height: Number(sourceHeight),
  restore_chain_id: restoreChainId,
  restore_height: Number(restoreHeight),
  backup_id: backupId,
  restored_backup_id: restoreBackupId,
}, null, 2)}\n`);
JS
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_tool curl
  require_tool lsof
  require_tool node
  [[ -x "$NODE_BIN" ]] || die "teleno_node not executable: $NODE_BIN"
  [[ -f "$CONFIG_EXAMPLE_DIR/genesis_data.json" ]] || die "missing genesis_data.json in $CONFIG_EXAMPLE_DIR"
  [[ -f "$CONFIG_EXAMPLE_DIR/koinos_descriptors.pb" ]] || die "missing koinos_descriptors.pb in $CONFIG_EXAMPLE_DIR"
  port_is_free "$SOURCE_PORT" || die "source port is already in use: $SOURCE_PORT"
  port_is_free "$RESTORE_PORT" || die "restore port is already in use: $RESTORE_PORT"
  validate_remote_env

  mkdir -p "$SOURCE_BASEDIR" "$SOURCE_REPO" "$SOURCE_WORKSPACE" "$RESTORE_BASEDIR" "$RESTORE_REPO" "$RESTORE_WORKSPACE" "$RESTORE_STAGING" "$REPORT_DIR/source" "$REPORT_DIR/restore"
  prepare_basedir "$SOURCE_BASEDIR"
  write_common_config "$SOURCE_CONFIG" "$SOURCE_PORT" "$SOURCE_REPO" "$SOURCE_WORKSPACE" "$REMOTE_ENABLED" "native-backup-smoke-source"

  echo "starting source node: $SOURCE_BASEDIR"
  SOURCE_PID="$(start_node "$SOURCE_BASEDIR" "$SOURCE_CONFIG" "$SOURCE_LOG" "$SOURCE_PORT")"
  local source_head
  source_head="$(rpc_call "$SOURCE_PORT" "chain.get_head_info")"
  local source_chain
  source_chain="$(rpc_call "$SOURCE_PORT" "chain.get_chain_id")"
  local source_height
  source_height="$(printf '%s' "$source_head" | json_value 'data.result.head_topology.height')"
  local source_chain_id
  source_chain_id="$(printf '%s' "$source_chain" | json_value 'data.result.chain_id')"
  stop_pid "$SOURCE_PID"
  SOURCE_PID=""

  echo "migrating source chain state to unified RocksDB"
  "$NODE_BIN" --basedir "$SOURCE_BASEDIR" --config "$SOURCE_CONFIG" --migrate-chain-db-to-unified-rocksdb >"$REPORT_DIR/source/migration.log" 2>&1

  echo "validating backup dry-run"
  "$NODE_BIN" --basedir "$SOURCE_BASEDIR" --config "$SOURCE_CONFIG" --backup-dry-run --backup-json \
    >"$REPORT_DIR/source/backup-dry-run.json" \
    2>"$REPORT_DIR/source/backup-dry-run.log"

  echo "creating native backup"
  local create_json="$REPORT_DIR/source/backup-create.json"
  if [[ "$REMOTE_ENABLED" == "1" ]]; then
    "$NODE_BIN" --basedir "$SOURCE_BASEDIR" --config "$SOURCE_CONFIG" --backup-create --backup-json \
      >"$create_json" \
      2>"$REPORT_DIR/source/backup-create.log"
  else
    "$NODE_BIN" --basedir "$SOURCE_BASEDIR" --config "$SOURCE_CONFIG" --backup-create-local --backup-json \
      >"$create_json" \
      2>"$REPORT_DIR/source/backup-create.log"
  fi
  local backup_id
  backup_id="$(json_value 'data.local_snapshot ? data.local_snapshot.backup_id : (data.local ? data.local.backup_id : data.backup_id)' <"$create_json")"

  local restore_repo="$SOURCE_REPO"
  if [[ "$REMOTE_ENABLED" == "1" ]]; then
    restore_repo="$RESTORE_REPO"
  fi
  write_common_config "$RESTORE_CONFIG" "$RESTORE_PORT" "$restore_repo" "$RESTORE_WORKSPACE" "$REMOTE_ENABLED" "native-backup-smoke-restore"

  echo "restoring native backup"
  "$NODE_BIN" \
    --basedir "$RESTORE_BASEDIR" \
    --config "$RESTORE_CONFIG" \
    --backup-restore \
    --backup-output "$RESTORE_STAGING" \
    --backup-json \
    >"$REPORT_DIR/restore/backup-restore.json" \
    2>"$REPORT_DIR/restore/backup-restore.log"
  local restore_backup_id
  restore_backup_id="$(json_value 'data.activation.backup_id' <"$REPORT_DIR/restore/backup-restore.json")"

  echo "starting restored observer"
  RESTORE_PID="$(start_node "$RESTORE_BASEDIR" "$RESTORE_CONFIG" "$RESTORE_LOG" "$RESTORE_PORT")"
  local restore_head
  restore_head="$(rpc_call "$RESTORE_PORT" "chain.get_head_info")"
  local restore_chain
  restore_chain="$(rpc_call "$RESTORE_PORT" "chain.get_chain_id")"
  local restore_height
  restore_height="$(printf '%s' "$restore_head" | json_value 'data.result.head_topology.height')"
  local restore_chain_id
  restore_chain_id="$(printf '%s' "$restore_chain" | json_value 'data.result.chain_id')"
  stop_pid "$RESTORE_PID"
  RESTORE_PID=""

  [[ "$source_chain_id" == "$restore_chain_id" ]] || die "restored chain ID mismatch: $restore_chain_id != $source_chain_id"
  [[ "$source_height" == "$restore_height" ]] || die "restored height mismatch: $restore_height != $source_height"
  [[ "$backup_id" == "$restore_backup_id" ]] || die "restored backup ID mismatch: $restore_backup_id != $backup_id"

  "$NODE_BIN" --basedir "$RESTORE_BASEDIR" --config "$RESTORE_CONFIG" --storage-report \
    >"$REPORT_DIR/restore/storage-report.txt" \
    2>"$REPORT_DIR/restore/storage-report.log"
  grep -q 'layout.chain_storage: unified' "$REPORT_DIR/restore/storage-report.txt" || die "restored storage is not unified"

  write_summary "pass" "$source_chain_id" "$source_height" "$restore_chain_id" "$restore_height" "$backup_id" "$restore_backup_id"
  echo "native backup restore smoke passed: $REPORT_DIR"
}

main "$@"
