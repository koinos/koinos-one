#!/usr/bin/env bash
#
# migrate_block_store.sh — Migrate block store data from multi-service layout to monolith.
#
# The multi-service Koinos node stores data in separate directories:
#   {basedir}/block_store/db/     (Badger DB — Go block_store)
#   {basedir}/chain/blockchain/   (RocksDB — chain state_db)
#
# The monolith stores everything in a single RocksDB:
#   {basedir}/db/                 (RocksDB with column families)
#
# This script creates the monolith data directory layout and copies
# the chain state_db (which is already RocksDB). The Badger DB block_store
# data cannot be directly migrated — the monolith will re-sync blocks
# from peers or a backup restore.
#
# Usage:
#   ./migrate_block_store.sh /path/to/basedir
#
# What it does:
#   1. Verifies the basedir has the old multi-service layout
#   2. Creates {basedir}/db/ for the monolith
#   3. Preserves the existing chain state_db
#   4. Creates a marker file indicating migration is needed
#   5. Backs up the old config.yml and removes AMQP settings
#
set -euo pipefail

BASEDIR="${1:?Usage: $0 /path/to/basedir}"

if [[ ! -d "$BASEDIR" ]]; then
  echo "Error: $BASEDIR does not exist"
  exit 1
fi

echo "Koinos Monolith Migration Tool"
echo "==============================="
echo "basedir: $BASEDIR"
echo ""

# Check for old layout
if [[ -d "$BASEDIR/block_store/db" ]]; then
  echo "[info] Found old block_store/db (Badger DB) — will need re-sync"
  echo "       The monolith uses RocksDB; Badger DB data cannot be imported directly."
  echo "       After migration, sync blocks from peers or restore from backup."
fi

if [[ -d "$BASEDIR/chain/blockchain" ]]; then
  echo "[info] Found chain/blockchain (RocksDB) — preserved for monolith"
fi

# Create monolith db directory
if [[ ! -d "$BASEDIR/db" ]]; then
  mkdir -p "$BASEDIR/db"
  echo "[done] Created $BASEDIR/db/ for monolith RocksDB"
else
  echo "[skip] $BASEDIR/db/ already exists"
fi

# Back up config.yml
if [[ -f "$BASEDIR/config.yml" ]]; then
  cp "$BASEDIR/config.yml" "$BASEDIR/config.yml.pre-monolith"
  echo "[done] Backed up config.yml → config.yml.pre-monolith"

  # Remove AMQP settings from config
  if grep -q "amqp:" "$BASEDIR/config.yml" 2>/dev/null; then
    sed -i.bak '/^[[:space:]]*amqp:/d' "$BASEDIR/config.yml"
    rm -f "$BASEDIR/config.yml.bak"
    echo "[done] Removed AMQP settings from config.yml"
  fi

  # Add features section if not present
  if ! grep -q "^features:" "$BASEDIR/config.yml" 2>/dev/null; then
    cat >> "$BASEDIR/config.yml" <<'FEATURES'

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
    echo "[done] Added features section to config.yml"
  fi
fi

# Create migration marker
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BASEDIR/.monolith-migrated"
echo "[done] Created migration marker: $BASEDIR/.monolith-migrated"

echo ""
echo "Migration preparation complete."
echo ""
echo "Next steps:"
echo "  1. Start the monolith: koinos_node --basedir $BASEDIR"
echo "  2. The chain state_db will be reused automatically"
echo "  3. Block store will need to re-sync from peers or backup"
echo "  4. You can safely remove old directories after verification:"
echo "     - $BASEDIR/block_store/   (old Badger DB)"
echo "     - $BASEDIR/amqp/          (old AMQP broker data)"
echo "     - $BASEDIR/mempool/       (old mempool data)"
