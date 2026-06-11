#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/node/teleno-node"
CONFIG_EXAMPLE_DIR="$ROOT_DIR/vendor/koinos/koinos/config-example"
BIN="${MONOLITH_NODE_BIN:-$NODE_DIR/build/koinos_node}"
HUNTER_INSTALL_DIR="${HUNTER_INSTALL_DIR:-/Volumes/external/.hunter/_Base/a20151e/caf7adb/26936b6/Install}"
IMPORTER_BIN="${MONOLITH_BLOCK_STORE_IMPORTER:-$NODE_DIR/build/import_block_store_stream}"

DEFAULT_BACKUP_URL="https://seed.koinosfoundation.org/backups/koinos-backup.tar.gz"
BACKUP_URL="${MONOLITH_BACKUP_URL:-$DEFAULT_BACKUP_URL}"
WORKDIR="${MONOLITH_RESTORE_WORKDIR:-/Volumes/external/teleno-monolith-restore}"
BASEDIR="${MONOLITH_RESTORE_BASEDIR:-$WORKDIR/basedir}"
ARCHIVE_PATH="${MONOLITH_BACKUP_ARCHIVE:-$WORKDIR/koinos-backup.tar.gz}"
REPORT_FILE="${MONOLITH_RESTORE_REPORT:-$ROOT_DIR/docs/roadmap/monolith/backup-restore/MONOLITH_BACKUP_RESTORE_REPORT.md}"
JSONRPC_PORT="${JSONRPC_PORT:-18083}"
DOWNLOAD=0
DRY_RUN=0
KEEP_WORKDIR=0
SCAN_ARCHIVE=0
KEEP_DOWNLOADED_ARCHIVE="${KEEP_DOWNLOADED_ARCHIVE:-0}"

RESTORE_DIRECTORIES=(
  chain
  block_store
  transaction_store
  contract_meta_store
  account_history
  p2p
)

usage() {
  cat <<EOF
Usage: $0 [--dry-run] [--download] [--archive PATH] [--url URL] [--workdir PATH] [--basedir PATH] [--keep-workdir] [--scan-archive]

Validates a Koinos backup restore against the monolithic koinos_node.

Default workdir: $WORKDIR
Default URL:     $BACKUP_URL

Modes:
  --dry-run       Check remote metadata, checksum, binary, and external disk capacity without downloading.
  --download      Download the backup archive into the workdir before restoring.
  --archive PATH  Restore from an existing local .tar.gz archive.

The full restore intentionally uses an external BASEDIR and starts koinos_node
with P2P disabled, then verifies chain.get_head_info via local JSON-RPC.
EOF
}

log() { printf '[restore] %s\n' "$*"; }
warn() { printf '[restore] warning: %s\n' "$*" >&2; }
fail() { printf '[restore] error: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --download) DOWNLOAD=1; shift ;;
    --archive) ARCHIVE_PATH="${2:?Missing value for --archive}"; shift 2 ;;
    --url) BACKUP_URL="${2:?Missing value for --url}"; shift 2 ;;
    --workdir) WORKDIR="${2:?Missing value for --workdir}"; BASEDIR="$WORKDIR/basedir"; ARCHIVE_PATH="$WORKDIR/koinos-backup.tar.gz"; shift 2 ;;
    --basedir) BASEDIR="${2:?Missing value for --basedir}"; shift 2 ;;
    --keep-workdir) KEEP_WORKDIR=1; shift ;;
    --scan-archive) SCAN_ARCHIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

METADATA_URL="${BACKUP_URL}.metadata"
CHECKSUM_URL="${BACKUP_URL}.sha256"
LOG_FILE="$WORKDIR/koinos_node.log"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

bytes_to_gib() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f GiB", bytes / 1024 / 1024 / 1024 }'
}

volume_free_bytes() {
  local path="$1"
  mkdir -p "$path"
  df -Pk "$path" | awk 'NR == 2 { print $4 * 1024 }'
}

http_content_length() {
  curl -fsSIL --max-time 30 "$1" | awk 'BEGIN { IGNORECASE=1 } /^Content-Length:/ { gsub(/\r/, "", $2); value=$2 } END { print value }'
}

fetch_metadata() {
  curl -fsSL --max-time 30 "$METADATA_URL"
}

fetch_checksum() {
  curl -fsSL --max-time 30 "$CHECKSUM_URL" | awk '{ print $1; exit }'
}

write_report_header() {
  mkdir -p "$(dirname "$REPORT_FILE")"
  cat >"$REPORT_FILE" <<MD
# Monolith Backup Restore Report

- Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Backup URL: ${BACKUP_URL}
- Workdir: ${WORKDIR}
- BASEDIR: ${BASEDIR}
- Archive: ${ARCHIVE_PATH}
- JSON-RPC: http://127.0.0.1:${JSONRPC_PORT}/

MD
}

append_report() {
  printf '%s\n' "$*" >>"$REPORT_FILE"
}

prepare_runtime_files() {
  mkdir -p "$BASEDIR/chain" "$BASEDIR/jsonrpc/descriptors"
  cp "$CONFIG_EXAMPLE_DIR/genesis_data.json" "$BASEDIR/chain/genesis_data.json"
  cp "$CONFIG_EXAMPLE_DIR/koinos_descriptors.pb" "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"
  cat >"$BASEDIR/config.yml" <<YAML
global:
  log-level: info
chain:
  verify-blocks: false
jsonrpc:
  listen: 127.0.0.1:${JSONRPC_PORT}
features:
  chain: true
  mempool: true
  block_store: true
  p2p: false
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: true
  transaction_store: true
  account_history: true
YAML
}

build_block_store_importer() {
  if [[ -x "$IMPORTER_BIN" && "$IMPORTER_BIN" -nt "$NODE_DIR/tools/import_block_store_stream.cpp" ]]; then
    return
  fi

  require_cmd c++
  mkdir -p "$(dirname "$IMPORTER_BIN")"
  log "building block-store stream importer"
  c++ -std=c++20 -O2 \
    -I"$HUNTER_INSTALL_DIR/include" \
    "$NODE_DIR/tools/import_block_store_stream.cpp" \
    "$HUNTER_INSTALL_DIR/lib/librocksdb.a" \
    "$HUNTER_INSTALL_DIR/lib/libz.a" \
    -lc++ -lpthread \
    -o "$IMPORTER_BIN"
}

convert_legacy_block_store() {
  local legacy_db="$BASEDIR/block_store/db"
  local monolith_db="$BASEDIR/db"

  [[ -d "$legacy_db" ]] || fail "Legacy block_store Badger DB not found at $legacy_db"

  require_cmd go
  build_block_store_importer

  rm -rf "$monolith_db"
  mkdir -p "$monolith_db"

  log "converting legacy Badger block_store to monolith RocksDB"
  (
    cd "$ROOT_DIR/tools/legacy-block-store-exporter"
    go run . --db "$legacy_db"
  ) | "$IMPORTER_BIN" --db "$monolith_db"
}

discover_payload_root() {
  local archive="$1"
  tar -tzf "$archive" | awk '
    {
      path=$0
      sub(/^\.\//, "", path)
      n=split(path, parts, "/")
      for (i=1; i<=n; i++) {
        if (parts[i] == "chain" || parts[i] == "block_store") {
          root=""
          for (j=1; j<i; j++) root = root (root == "" ? "" : "/") parts[j]
          print root
          exit
        }
      }
    }'
}

payload_root_strip_components() {
  local payload_root="$1"
  if [[ -z "$payload_root" ]]; then
    echo 0
    return
  fi

  awk -F/ '{ print NF }' <<<"$payload_root"
}

extract_restore_directories() {
  local archive="$1"
  local target_dir="$2"
  local payload_root="$3"
  local strip_components
  strip_components="$(payload_root_strip_components "$payload_root")"
  mkdir -p "$target_dir"
  rm -rf "$target_dir/mempool"

  for dir_name in "${RESTORE_DIRECTORIES[@]}"; do
    local member="$dir_name"
    if [[ -n "$payload_root" ]]; then
      member="$payload_root/$dir_name"
    fi

    if tar -tzf "$archive" "$member" >/dev/null 2>&1; then
      log "extracting $member"
      rm -rf "$target_dir/$dir_name"
      if [[ "$strip_components" -gt 0 ]]; then
        tar -xzf "$archive" -C "$target_dir" --strip-components "$strip_components" "$member"
      else
        tar -xzf "$archive" -C "$target_dir" "$member"
      fi
    else
      warn "archive does not contain $member; skipping"
    fi
  done

  local config_member="config.yml"
  if [[ -n "$payload_root" ]]; then
    config_member="$payload_root/config.yml"
  fi

  if tar -tzf "$archive" "$config_member" >/dev/null 2>&1; then
    tar -xOzf "$archive" "$config_member" >"$target_dir/config.yml.restored-legacy"
  fi

  printf '{"restoredAt":"%s","directories":["%s"]}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(IFS=,; echo "${RESTORE_DIRECTORIES[*]}")" \
    >"$target_dir/.backup-just-restored"
}

jsonrpc_head_info() {
  node - "$JSONRPC_PORT" <<'NODE'
const http = require('node:http')
const port = Number(process.argv[2])
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain.get_head_info', params: {} })
const req = http.request({
  host: '127.0.0.1',
  port,
  path: '/',
  method: 'POST',
  timeout: 5000,
  headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
}, (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data)
      if (parsed.error) {
        console.error(parsed.error.message || JSON.stringify(parsed.error))
        process.exit(2)
      }
      const topology = parsed.result?.head_topology
      if (!topology?.id) {
        console.error(`missing head_topology.id in ${data}`)
        process.exit(3)
      }
      console.log(JSON.stringify({ height: topology.height ?? '', id: topology.id }))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(4)
    }
  })
})
req.on('timeout', () => { req.destroy(new Error('timeout')) })
req.on('error', (error) => { console.error(error.message); process.exit(1) })
req.write(body)
req.end()
NODE
}

verify_node() {
  "$BIN" --basedir="$BASEDIR" --log-level=info --disable=p2p --enable=jsonrpc >"$LOG_FILE" 2>&1 &
  local node_pid=$!
  log "started koinos_node pid=$node_pid"

  local started_at
  started_at="$(date +%s)"
  local head_json=""
  while [[ $(( $(date +%s) - started_at )) -lt 120 ]]; do
    if ! kill -0 "$node_pid" 2>/dev/null; then
      cat "$LOG_FILE" >&2 || true
      fail "koinos_node exited before JSON-RPC verification"
    fi
    if head_json="$(jsonrpc_head_info 2>/tmp/teleno-monolith-restore-rpc.err)"; then
      append_report "## JSON-RPC Verification"
      append_report ""
      append_report "\`\`\`json"
      append_report "$head_json"
      append_report "\`\`\`"
      kill "$node_pid" 2>/dev/null || true
      wait "$node_pid" 2>/dev/null || true
      return 0
    fi
    sleep 2
  done

  kill "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
  cat "$LOG_FILE" >&2 || true
  fail "chain.get_head_info did not verify within 120s: $(cat /tmp/teleno-monolith-restore-rpc.err 2>/dev/null || true)"
}

run_dry_run() {
  write_report_header

  local content_length
  content_length="$(http_content_length "$BACKUP_URL")"
  [[ -n "$content_length" ]] || fail "Could not read backup Content-Length from $BACKUP_URL"

  local free_bytes
  free_bytes="$(volume_free_bytes "$WORKDIR")"
  local recommended_bytes=$(( content_length * 3 ))

  local metadata
  metadata="$(fetch_metadata)"
  local checksum
  checksum="$(fetch_checksum)"

  log "backup size: $(bytes_to_gib "$content_length")"
  log "workdir free: $(bytes_to_gib "$free_bytes")"
  log "checksum: $checksum"

  append_report "## Dry Run"
  append_report ""
  append_report "- Backup size: $(bytes_to_gib "$content_length") (${content_length} bytes)"
  append_report "- External volume free: $(bytes_to_gib "$free_bytes")"
  append_report "- Recommended free space for download + extraction: $(bytes_to_gib "$recommended_bytes")"
  append_report "- SHA-256: \`${checksum}\`"
  append_report ""
  append_report "### Remote Metadata"
  append_report ""
  append_report "\`\`\`text"
  append_report "$metadata"
  append_report "\`\`\`"

  if [[ "$free_bytes" -lt "$recommended_bytes" ]]; then
    append_report ""
    append_report "Result: dry-run passed remote checks, but free space is below the conservative 3x recommendation."
    warn "free space is below conservative 3x recommendation; full restore may still work if the extracted subset is smaller"
  else
    append_report ""
    append_report "Result: dry-run passed remote checks and external volume has enough conservative capacity."
  fi
}

run_full_restore() {
  require_cmd tar
  require_cmd node
  require_cmd shasum

  [[ -x "$BIN" ]] || fail "koinos_node binary not found or not executable: $BIN"
  mkdir -p "$WORKDIR"
  write_report_header

  if [[ "$DOWNLOAD" -eq 1 ]]; then
    log "downloading backup to $ARCHIVE_PATH"
    curl -fL --continue-at - "$BACKUP_URL" -o "$ARCHIVE_PATH"
  fi

  [[ -f "$ARCHIVE_PATH" ]] || fail "Archive not found. Pass --download or --archive PATH."

  local expected_checksum
  expected_checksum="$(fetch_checksum)"
  log "verifying checksum"
  local actual_checksum
  actual_checksum="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{ print $1 }')"
  [[ "$actual_checksum" == "$expected_checksum" ]] || fail "Checksum mismatch: expected $expected_checksum, got $actual_checksum"

  local payload_root
  payload_root="$(discover_payload_root "$ARCHIVE_PATH")"
  log "payload root: ${payload_root:-.}"

  rm -rf "$BASEDIR"
  extract_restore_directories "$ARCHIVE_PATH" "$BASEDIR" "$payload_root"
  if [[ "$DOWNLOAD" -eq 1 && "$KEEP_DOWNLOADED_ARCHIVE" -ne 1 ]]; then
    log "removing downloaded archive before conversion to preserve external volume space"
    rm -f "$ARCHIVE_PATH"
  fi
  convert_legacy_block_store
  prepare_runtime_files

  append_report "## Restore"
  append_report ""
  append_report "- Payload root: ${payload_root:-.}"
  append_report "- Restored directories: ${RESTORE_DIRECTORIES[*]}"
  append_report "- Runtime config forced to local JSON-RPC and P2P disabled for verification."
  append_report "- Legacy config copied to \`${BASEDIR}/config.yml.restored-legacy\` when present."
  append_report "- Legacy Badger \`block_store/db\` converted to monolith RocksDB \`${BASEDIR}/db\`."
  append_report ""

  verify_node

  append_report ""
  append_report "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  append_report "Result: restore verification completed."
}

require_cmd curl
require_cmd awk

if [[ "$DRY_RUN" -eq 1 ]]; then
  run_dry_run
else
  run_full_restore
fi

if [[ "$SCAN_ARCHIVE" -eq 1 && -f "$ARCHIVE_PATH" ]]; then
  log "first archive entries:"
  tar -tzf "$ARCHIVE_PATH" | sed -n '1,40p'
fi

log "report: $REPORT_FILE"
