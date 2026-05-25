#!/usr/bin/env bash
#
# migrate_block_store.sh -- Migrate legacy Koinos block_store data to the
# monolith RocksDB layout.
#
# The legacy multi-service node stores blocks in:
#   BASEDIR/block_store/db/   (Badger, owned by koinos-block-store)
#
# The monolith stores block-store records in:
#   BASEDIR/db/               (RocksDB column family "blocks")
#   BASEDIR/db/               (RocksDB column family "block_meta")
#
# This wrapper reuses the proven restore pipeline:
#   Go Badger exporter -> C++ RocksDB stream importer
#
# The block_store records are copied byte-for-byte, so existing block records
# keep their embedded skip-list pointers. The chain state_db remains in
# BASEDIR/chain/blockchain and is reused in place by koinos_node.
#
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$NODE_DIR/../../.." && pwd)"

BASEDIR=""
LEGACY_DB=""
MONOLITH_DB=""
IMPORTER_BIN="${MONOLITH_BLOCK_STORE_IMPORTER:-$NODE_DIR/build/import_block_store_stream}"
EXPORTER_DIR="${LEGACY_BLOCK_STORE_EXPORTER_DIR:-$ROOT_DIR/tools/legacy-block-store-exporter}"
HUNTER_INSTALL_DIR="${HUNTER_INSTALL_DIR:-}"
PROGRESS_EVERY="${PROGRESS_EVERY:-100000}"
DRY_RUN=0
FORCE=0
SKIP_CONFIG=0

usage() {
  cat <<EOF
Usage:
  $0 /path/to/basedir
  $0 --basedir /path/to/basedir [options]

Options:
  --basedir PATH          Legacy/monolith basedir. Defaults for DB paths derive from this.
  --legacy-db PATH        Legacy Badger DB path. Default: BASEDIR/block_store/db.
  --monolith-db PATH      Target monolith RocksDB path. Default: BASEDIR/db.
  --importer PATH         C++ stream importer path. Default: vendor/koinos/koinos-node/build/import_block_store_stream.
  --hunter-install PATH   Hunter install containing RocksDB headers/libs. Inferred from build/CMakeCache.txt when possible.
  --progress-every N      Export/import progress interval. Default: 100000.
  --dry-run               Validate paths and capacity only; do not write RocksDB.
  --force                 Replace an existing non-empty target RocksDB directory.
  --skip-config           Do not update config.yml feature flags.
  -h, --help              Show this help.

Environment:
  MONOLITH_BLOCK_STORE_IMPORTER
  LEGACY_BLOCK_STORE_EXPORTER_DIR
  HUNTER_INSTALL_DIR
  PROGRESS_EVERY

Output:
  Migration logs and a .monolith-migrated marker are written under BASEDIR/.monolith-migration/.
EOF
}

log() { printf '[migrate] %s\n' "$*"; }
warn() { printf '[migrate] warning: %s\n' "$*" >&2; }
fail() { printf '[migrate] error: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

bytes_to_gib() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f GiB", bytes / 1024 / 1024 / 1024 }'
}

dir_size_bytes() {
  local path="$1"
  du -sk "$path" | awk '{ print $1 * 1024 }'
}

free_bytes_for_path() {
  local path="$1"
  mkdir -p "$path"
  df -Pk "$path" | awk 'NR == 2 { print $4 * 1024 }'
}

is_dir_nonempty() {
  local path="$1"
  [[ -d "$path" ]] && find "$path" -mindepth 1 -maxdepth 1 -print -quit | grep -q .
}

safe_remove_monolith_db() {
  local path="$1"
  case "$path" in
    ""|"/"|"/tmp"|"/private/tmp"|"$BASEDIR"|"$BASEDIR/") fail "refusing to remove unsafe monolith db path: $path" ;;
  esac
  rm -rf "$path"
}

infer_hunter_install_dir() {
  if [[ -n "$HUNTER_INSTALL_DIR" ]]; then
    echo "$HUNTER_INSTALL_DIR"
    return
  fi

  local cache="$NODE_DIR/build/CMakeCache.txt"
  if [[ -f "$cache" ]]; then
    local rocksdb_dir
    rocksdb_dir="$(sed -nE 's/^RocksDB_DIR:[^=]*=(.*)\/lib\/cmake\/rocksdb$/\1/p' "$cache" | tail -1)"
    if [[ -n "$rocksdb_dir" && -f "$rocksdb_dir/include/rocksdb/db.h" ]]; then
      echo "$rocksdb_dir"
      return
    fi
  fi

  for candidate in \
    "$ROOT_DIR/.deps/koinos-node/hunter/_Base" \
    "$NODE_DIR/.deps/hunter/_Base" \
    "$HOME/.hunter/_Base" \
    "/Volumes/external/.hunter/_Base"; do
    if [[ -d "$candidate" ]]; then
      local header
      header="$(find "$candidate" -type f -path '*/Install/include/rocksdb/db.h' -print -quit 2>/dev/null || true)"
      if [[ -n "$header" ]]; then
        echo "${header%/include/rocksdb/db.h}"
        return
      fi
    fi
  done

  fail "could not infer HUNTER_INSTALL_DIR; pass --hunter-install PATH"
}

build_block_store_importer() {
  if [[ -x "$IMPORTER_BIN" && "$IMPORTER_BIN" -nt "$NODE_DIR/tools/import_block_store_stream.cpp" ]]; then
    return
  fi

  require_cmd c++

  local hunter_install
  hunter_install="$(infer_hunter_install_dir)"

  [[ -f "$hunter_install/include/rocksdb/db.h" ]] || fail "RocksDB headers not found under $hunter_install"
  [[ -f "$hunter_install/lib/librocksdb.a" ]] || fail "RocksDB library not found under $hunter_install"
  [[ -f "$hunter_install/lib/libz.a" ]] || fail "zlib library not found under $hunter_install"

  mkdir -p "$(dirname "$IMPORTER_BIN")"
  log "building block-store stream importer"

  local extra_libs=()
  if [[ "$(uname -s)" == "Darwin" ]]; then
    extra_libs+=( -lc++ )
  fi

  c++ -std=c++20 -O2 \
    -I"$hunter_install/include" \
    "$NODE_DIR/tools/import_block_store_stream.cpp" \
    "$hunter_install/lib/librocksdb.a" \
    "$hunter_install/lib/libz.a" \
    -pthread \
    "${extra_libs[@]}" \
    -o "$IMPORTER_BIN"
}

update_config_for_monolith() {
  [[ "$SKIP_CONFIG" -eq 0 ]] || return
  local config="$BASEDIR/config.yml"
  [[ -f "$config" ]] || return

  local backup="$BASEDIR/config.yml.pre-monolith"
  if [[ ! -f "$backup" ]]; then
    cp "$config" "$backup"
    log "backed up config.yml to config.yml.pre-monolith"
  fi

  if ! grep -q '^features:' "$config" 2>/dev/null; then
    cat >>"$config" <<'FEATURES'

# Feature flags (monolith mode)
features:
  chain: true
  mempool: true
  block_store: true
  p2p: true
  jsonrpc: true
  grpc: false
  block_producer: false
  contract_meta_store: true
  transaction_store: true
  account_history: false
FEATURES
    log "added monolith feature flags to config.yml"
  fi
}

parse_stat() {
  local log_file="$1"
  local pattern="$2"
  local field="$3"
  sed -nE "s/.*${pattern}.*${field}=([0-9]+).*/\\1/p" "$log_file" | tail -1
}

write_marker() {
  local run_dir="$1"
  local export_records="$2"
  local export_bytes="$3"
  local import_records="$4"
  local import_blocks="$5"
  local import_meta="$6"
  local import_bytes="$7"

  cat >"$run_dir/.monolith-migrated" <<EOF
{
  "migratedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "legacyDb": "$LEGACY_DB",
  "monolithDb": "$MONOLITH_DB",
  "exportRecords": $export_records,
  "exportBytes": $export_bytes,
  "importRecords": $import_records,
  "importBlockRecords": $import_blocks,
  "importMetaRecords": $import_meta,
  "importBytes": $import_bytes
}
EOF
  cp "$run_dir/.monolith-migrated" "$BASEDIR/.monolith-migrated"
}

run_dry_run() {
  [[ -d "$BASEDIR" ]] || fail "basedir does not exist: $BASEDIR"
  [[ -d "$LEGACY_DB" ]] || fail "legacy Badger DB not found: $LEGACY_DB"
  [[ -d "$EXPORTER_DIR" ]] || fail "legacy exporter not found: $EXPORTER_DIR"
  [[ -f "$EXPORTER_DIR/go.mod" ]] || fail "legacy exporter go.mod not found: $EXPORTER_DIR/go.mod"
  require_cmd go

  local legacy_size free_bytes recommended_bytes
  legacy_size="$(dir_size_bytes "$LEGACY_DB")"
  free_bytes="$(free_bytes_for_path "$(dirname "$MONOLITH_DB")")"
  recommended_bytes=$(( legacy_size * 2 ))

  log "legacy Badger DB: $LEGACY_DB"
  log "target RocksDB: $MONOLITH_DB"
  log "legacy DB size: $(bytes_to_gib "$legacy_size")"
  log "target volume free: $(bytes_to_gib "$free_bytes")"
  log "recommended free space: $(bytes_to_gib "$recommended_bytes")"

  if is_dir_nonempty "$MONOLITH_DB"; then
    warn "target RocksDB directory is not empty; use --force for a destructive replacement"
  fi
  if [[ "$free_bytes" -lt "$recommended_bytes" ]]; then
    warn "free space is below conservative 2x legacy DB recommendation"
  fi

  log "dry-run complete"
}

run_migration() {
  [[ -d "$BASEDIR" ]] || fail "basedir does not exist: $BASEDIR"
  [[ -d "$LEGACY_DB" ]] || fail "legacy Badger DB not found: $LEGACY_DB"
  [[ -d "$EXPORTER_DIR" ]] || fail "legacy exporter not found: $EXPORTER_DIR"
  require_cmd go

  build_block_store_importer

  if is_dir_nonempty "$MONOLITH_DB"; then
    [[ "$FORCE" -eq 1 ]] || fail "target RocksDB directory is not empty: $MONOLITH_DB (use --force to replace it)"
    log "removing existing target RocksDB directory"
    safe_remove_monolith_db "$MONOLITH_DB"
  fi
  mkdir -p "$MONOLITH_DB"

  local run_dir="$BASEDIR/.monolith-migration"
  mkdir -p "$run_dir"
  local export_log="$run_dir/export.log"
  local import_log="$run_dir/import.log"

  log "exporting Badger and importing RocksDB"
  (
    cd "$EXPORTER_DIR"
    go run . --db "$LEGACY_DB" --progress-every "$PROGRESS_EVERY" 2> >(tee "$export_log" >&2)
  ) | "$IMPORTER_BIN" --db "$MONOLITH_DB" --progress-every "$PROGRESS_EVERY" 2> >(tee "$import_log" >&2)

  local export_records export_bytes import_records import_blocks import_meta import_bytes
  export_records="$(parse_stat "$export_log" 'export complete' 'records')"
  export_bytes="$(parse_stat "$export_log" 'export complete' 'bytes')"
  import_records="$(parse_stat "$import_log" 'import complete' 'records')"
  import_blocks="$(parse_stat "$import_log" 'import complete' 'blocks')"
  import_meta="$(parse_stat "$import_log" 'import complete' 'meta')"
  import_bytes="$(parse_stat "$import_log" 'import complete' 'bytes')"

  [[ -n "$export_records" && -n "$export_bytes" ]] || fail "could not parse exporter completion stats"
  [[ -n "$import_records" && -n "$import_blocks" && -n "$import_meta" && -n "$import_bytes" ]] || fail "could not parse importer completion stats"
  [[ "$export_records" == "$import_records" ]] || fail "record count mismatch: exported=$export_records imported=$import_records"
  [[ "$export_bytes" == "$import_bytes" ]] || fail "byte count mismatch: exported=$export_bytes imported=$import_bytes"
  [[ "$import_meta" -ge 1 ]] || fail "import did not include block_store metadata record"

  update_config_for_monolith
  write_marker "$run_dir" "$export_records" "$export_bytes" "$import_records" "$import_blocks" "$import_meta" "$import_bytes"

  log "migration complete: records=$import_records blocks=$import_blocks meta=$import_meta bytes=$import_bytes"
  log "marker: $BASEDIR/.monolith-migrated"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --basedir) BASEDIR="${2:?missing value for --basedir}"; shift 2 ;;
    --legacy-db) LEGACY_DB="${2:?missing value for --legacy-db}"; shift 2 ;;
    --monolith-db) MONOLITH_DB="${2:?missing value for --monolith-db}"; shift 2 ;;
    --importer) IMPORTER_BIN="${2:?missing value for --importer}"; shift 2 ;;
    --hunter-install) HUNTER_INSTALL_DIR="${2:?missing value for --hunter-install}"; shift 2 ;;
    --progress-every) PROGRESS_EVERY="${2:?missing value for --progress-every}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --skip-config) SKIP_CONFIG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) fail "unknown argument: $1" ;;
    *)
      if [[ -z "$BASEDIR" ]]; then
        BASEDIR="$1"
        shift
      else
        fail "unexpected positional argument: $1"
      fi
      ;;
  esac
done

[[ -n "$BASEDIR" ]] || { usage; exit 2; }
[[ -d "$BASEDIR" ]] || fail "basedir does not exist: $BASEDIR"
BASEDIR="$(cd "$BASEDIR" && pwd)"
LEGACY_DB="${LEGACY_DB:-$BASEDIR/block_store/db}"
MONOLITH_DB="${MONOLITH_DB:-$BASEDIR/db}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  run_dry_run
else
  run_migration
fi
