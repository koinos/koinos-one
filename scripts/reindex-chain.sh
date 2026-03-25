#!/usr/bin/env bash
# ============================================================================
# Koinos Chain Re-indexer
# ============================================================================
# Re-indexes the chain state from the existing block_store with
# verify-blocks: true, producing correct merkle roots for all receipts.
#
# After completion, the block_store will be a clean backup source that
# can be restored with verify-blocks: false on any node.
#
# This process:
#   1. Stops all Koinos services
#   2. Backs up and deletes the chain state (state_db)
#   3. Sets verify-blocks: true in config
#   4. Restarts services — chain re-indexes from block_store
#   5. Monitors progress until it catches up to the chain tip
#   6. Optionally creates a backup of the clean block_store
#
# Usage:
#   ./scripts/reindex-chain.sh [basedir]
#
#   basedir: Koinos data directory (default: ~/.koinos or auto-detected)
#
# Duration estimate:
#   ~50 blocks/sec with WASM execution
#   34M blocks ≈ ~8 days
#   You can interrupt and resume — progress is saved in the chain state.
# ============================================================================

set -euo pipefail

# --- Configuration ---
BASEDIR="${1:-}"
KNODEL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSONRPC_ENDPOINT="http://127.0.0.1:8080"
POLL_INTERVAL=30  # seconds between progress checks

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[reindex]${NC} $*"; }
ok()   { echo -e "${GREEN}[reindex]${NC} $*"; }
warn() { echo -e "${YELLOW}[reindex]${NC} $*"; }
err()  { echo -e "${RED}[reindex]${NC} $*"; }

# --- Detect basedir ---
detect_basedir() {
  if [ -n "$BASEDIR" ]; then
    echo "$BASEDIR"
    return
  fi

  # Check common locations
  for candidate in \
    "$HOME/.koinos" \
    "/Volumes/external/.koinos" \
    "$HOME/AppData/Roaming/koinos" \
    "$HOME/Library/Application Support/knodel/koinos"; do
    if [ -d "$candidate/block_store" ]; then
      echo "$candidate"
      return
    fi
  done

  err "Could not detect basedir. Pass it as argument: $0 /path/to/.koinos"
  exit 1
}

# --- Check if services are running ---
services_running() {
  pgrep -f "koinos_chain|koinos-block-store|koinos-p2p|garagemq" > /dev/null 2>&1
}

# --- Stop all services ---
stop_services() {
  log "Stopping Koinos services..."

  # Try graceful kill first
  pkill -f "koinos_chain|koinos_mempool|koinos-block-store|koinos-p2p|koinos-jsonrpc|koinos_grpc|koinos_block_producer|koinos_account_history|koinos-transaction-store|koinos-contract-meta-store|garagemq" 2>/dev/null || true

  sleep 3

  # Force kill if still running
  if services_running; then
    warn "Services still running, force killing..."
    pkill -9 -f "koinos_chain|koinos_mempool|koinos-block-store|koinos-p2p|koinos-jsonrpc|koinos_grpc|koinos_block_producer|koinos_account_history|koinos-transaction-store|koinos-contract-meta-store|garagemq" 2>/dev/null || true
    sleep 2
  fi

  if services_running; then
    err "Could not stop all services. Please stop them manually and re-run."
    exit 1
  fi

  ok "All services stopped"
}

# --- Find a binary ---
find_binary() {
  local name="$1"
  local candidates=(
    "$KNODEL_ROOT/vendor/koinos/$name/build/src/$name"
    "$KNODEL_ROOT/vendor/koinos/$name/build/bin/$name"
    "$KNODEL_ROOT/native-binaries/mac-arm64/$name"
    "$KNODEL_ROOT/build/bundle-staging/koinos/bin/$name"
  )
  # Also check with dashes converted to underscores and vice versa
  local alt_name="${name//-/_}"
  candidates+=(
    "$KNODEL_ROOT/vendor/koinos/${name//_/-}/build/src/$name"
    "$KNODEL_ROOT/vendor/koinos/${name//_/-}/build/bin/${name//_/-}"
    "$KNODEL_ROOT/native-binaries/mac-arm64/$alt_name"
  )

  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# --- Start only the minimal services needed for re-indexing ---
# Re-indexing only needs: garagemq (AMQP), block_store, chain, jsonrpc (for monitoring)
start_services() {
  log "Starting minimal services for re-indexing..."

  local AMQP_URL="amqp://guest:guest@127.0.0.1:5672/"
  local BASEDIR_ARG="--basedir=$BASEDIR"
  local AMQP_ARG="--amqp=$AMQP_URL"

  # Find binaries
  local GARAGEMQ=$(find_binary "garagemq")
  local BLOCK_STORE=$(find_binary "koinos-block-store")
  local CHAIN=$(find_binary "koinos_chain")
  local JSONRPC=$(find_binary "koinos-jsonrpc")

  if [ -z "$GARAGEMQ" ]; then err "Cannot find garagemq binary"; exit 1; fi
  if [ -z "$BLOCK_STORE" ]; then err "Cannot find koinos-block-store binary"; exit 1; fi
  if [ -z "$CHAIN" ]; then err "Cannot find koinos_chain binary"; exit 1; fi
  if [ -z "$JSONRPC" ]; then err "Cannot find koinos-jsonrpc binary"; exit 1; fi

  log "  garagemq:    $GARAGEMQ"
  log "  block_store: $BLOCK_STORE"
  log "  chain:       $CHAIN"
  log "  jsonrpc:     $JSONRPC"

  # Start GarageMQ
  mkdir -p "$BASEDIR/amqp"
  "$GARAGEMQ" --config="" --db-path="$BASEDIR/amqp" > /dev/null 2>&1 &
  log "  Started garagemq (PID: $!)"
  sleep 3

  # Start block_store
  "$BLOCK_STORE" "$BASEDIR_ARG" "$AMQP_ARG" > /dev/null 2>&1 &
  log "  Started block_store (PID: $!)"
  sleep 2

  # Start chain (will auto-detect it needs to re-index from block_store)
  "$CHAIN" "$BASEDIR_ARG" "$AMQP_ARG" > /dev/null 2>&1 &
  log "  Started chain (PID: $!)"
  sleep 2

  # Start jsonrpc (for monitoring via RPC)
  "$JSONRPC" "$BASEDIR_ARG" "$AMQP_ARG" --listen=/ip4/127.0.0.1/tcp/8080 > /dev/null 2>&1 &
  log "  Started jsonrpc (PID: $!)"
  sleep 5

  # Verify services started
  if ! services_running; then
    err "Services did not start. Check logs."
    exit 1
  fi

  ok "Minimal services started (garagemq, block_store, chain, jsonrpc)"
}

# --- Query chain head ---
get_chain_head() {
  local result
  result=$(curl -s --max-time 10 "$JSONRPC_ENDPOINT/" \
    -d '{"jsonrpc":"2.0","method":"chain.get_head_info","params":{},"id":1}' \
    -H "Content-Type: application/json" 2>/dev/null)

  echo "$result" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    r = data.get('result', {})
    h = r.get('head_topology', {}).get('height', '0')
    print(h)
except:
    print('0')
" 2>/dev/null
}

# --- Query block_store highest block ---
get_blockstore_head() {
  local result
  result=$(curl -s --max-time 10 "$JSONRPC_ENDPOINT/" \
    -d '{"jsonrpc":"2.0","method":"block_store.get_highest_block","params":{},"id":1}' \
    -H "Content-Type: application/json" 2>/dev/null)

  echo "$result" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data['result']['topology']['height'])
except:
    print('0')
" 2>/dev/null
}

# --- Set verify-blocks in config ---
set_verify_blocks() {
  local config_file="$BASEDIR/config.yml"
  local value="$1"  # true or false

  if [ ! -f "$config_file" ]; then
    warn "No config.yml found at $config_file, creating one"
    echo "global:" > "$config_file"
  fi

  if grep -q "verify-blocks:" "$config_file" 2>/dev/null; then
    # Update existing
    if [ "$(uname)" = "Darwin" ]; then
      sed -i '' "s/verify-blocks:.*/verify-blocks: $value/" "$config_file"
    else
      sed -i "s/verify-blocks:.*/verify-blocks: $value/" "$config_file"
    fi
  else
    # Add under chain: section or create it
    if grep -q "^chain:" "$config_file" 2>/dev/null; then
      if [ "$(uname)" = "Darwin" ]; then
        sed -i '' "/^chain:/a\\
\\  verify-blocks: $value" "$config_file"
      else
        sed -i "/^chain:/a\\  verify-blocks: $value" "$config_file"
      fi
    else
      echo "" >> "$config_file"
      echo "chain:" >> "$config_file"
      echo "  verify-blocks: $value" >> "$config_file"
    fi
  fi

  ok "Set verify-blocks: $value in $config_file"
}

# --- Monitor re-indexing progress ---
monitor_progress() {
  local blockstore_head="$1"
  local start_time
  start_time=$(date +%s)
  local last_height=0
  local last_check_time=$start_time

  log "Monitoring re-index progress (target: $(printf "%'d" "$blockstore_head") blocks)..."
  log "Press Ctrl+C to stop monitoring (re-indexing continues in background)"
  echo ""

  while true; do
    sleep "$POLL_INTERVAL"

    local chain_head
    chain_head=$(get_chain_head)

    if [ "$chain_head" = "0" ]; then
      warn "Could not get chain head (services may be starting up)..."
      continue
    fi

    local now
    now=$(date +%s)
    local elapsed=$((now - start_time))
    local interval=$((now - last_check_time))

    # Calculate speed
    local blocks_since_last=$((chain_head - last_height))
    local speed=0
    if [ "$interval" -gt 0 ] && [ "$last_height" -gt 0 ]; then
      speed=$((blocks_since_last / interval))
    fi

    # Calculate ETA
    local remaining=$((blockstore_head - chain_head))
    local eta_str="calculating..."
    if [ "$speed" -gt 0 ]; then
      local eta_seconds=$((remaining / speed))
      local eta_hours=$((eta_seconds / 3600))
      local eta_minutes=$(((eta_seconds % 3600) / 60))
      if [ "$eta_hours" -gt 24 ]; then
        local eta_days=$((eta_hours / 24))
        eta_str="${eta_days}d ${eta_hours}h"
      elif [ "$eta_hours" -gt 0 ]; then
        eta_str="${eta_hours}h ${eta_minutes}m"
      else
        eta_str="${eta_minutes}m"
      fi
    fi

    # Progress bar
    local pct=0
    if [ "$blockstore_head" -gt 0 ]; then
      pct=$((chain_head * 100 / blockstore_head))
    fi

    local elapsed_str
    local e_hours=$((elapsed / 3600))
    local e_minutes=$(((elapsed % 3600) / 60))
    elapsed_str="${e_hours}h ${e_minutes}m"

    printf "\r  [%3d%%] %'d / %'d — %d blocks/sec — ETA: %s — elapsed: %s    " \
      "$pct" "$chain_head" "$blockstore_head" "$speed" "$eta_str" "$elapsed_str"

    last_height=$chain_head
    last_check_time=$now

    # Check if caught up
    if [ "$chain_head" -ge "$((blockstore_head - 10))" ]; then
      echo ""
      ok "Re-indexing complete! Chain is at $(printf "%'d" "$chain_head")"
      return 0
    fi
  done
}

# ============================================================================
# Main
# ============================================================================

echo "============================================================================"
echo "  Koinos Chain Re-indexer"
echo "============================================================================"
echo ""

BASEDIR=$(detect_basedir)
log "Base directory: $BASEDIR"

# Verify block_store exists
if [ ! -d "$BASEDIR/block_store" ]; then
  err "No block_store found at $BASEDIR/block_store"
  err "This script requires an existing block_store to re-index from."
  exit 1
fi

# Get block_store size info
BLOCKSTORE_SIZE=$(du -sh "$BASEDIR/block_store" 2>/dev/null | cut -f1)
log "Block store size: $BLOCKSTORE_SIZE"

# Check if chain state exists
if [ -d "$BASEDIR/chain" ]; then
  CHAIN_SIZE=$(du -sh "$BASEDIR/chain" 2>/dev/null | cut -f1)
  log "Existing chain state: $CHAIN_SIZE"
else
  log "No existing chain state"
fi

echo ""
warn "This will:"
warn "  1. Stop all Koinos services"
warn "  2. Delete the chain state ($BASEDIR/chain)"
warn "  3. Re-index from block_store with verify-blocks: true"
warn "  4. This takes ~8 days for 34M blocks at ~50 blocks/sec"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  log "Aborted."
  exit 0
fi

# Step 1: Stop services
if services_running; then
  stop_services
else
  log "Services not running"
fi

# Step 2: Backup and delete chain state
if [ -d "$BASEDIR/chain" ]; then
  BACKUP_NAME="chain.backup.$(date +%Y%m%d-%H%M%S)"
  log "Backing up chain state to $BASEDIR/$BACKUP_NAME"
  mv "$BASEDIR/chain" "$BASEDIR/$BACKUP_NAME"
  ok "Chain state backed up"
else
  log "No chain state to backup"
fi

# Step 3: Set verify-blocks: true
set_verify_blocks "true"

# Step 4: Start services
start_services

# Wait for services to initialize
log "Waiting for services to initialize..."
sleep 15

# Get the target height from block_store
BLOCKSTORE_HEAD=$(get_blockstore_head)
if [ "$BLOCKSTORE_HEAD" = "0" ]; then
  warn "Could not determine block_store head. Waiting 30s for services..."
  sleep 30
  BLOCKSTORE_HEAD=$(get_blockstore_head)
fi

if [ "$BLOCKSTORE_HEAD" = "0" ]; then
  err "Could not get block_store head height. Check if services are running."
  err "You can monitor progress manually with:"
  err "  curl -s $JSONRPC_ENDPOINT/ -d '{\"jsonrpc\":\"2.0\",\"method\":\"chain.get_head_info\",\"params\":{},\"id\":1}'"
  exit 1
fi

log "Block store head: $(printf "%'d" "$BLOCKSTORE_HEAD")"
echo ""

# Step 5: Monitor progress
monitor_progress "$BLOCKSTORE_HEAD"

echo ""
echo "============================================================================"
ok "Re-indexing complete!"
ok ""
ok "Your block_store now has correct merkle roots for all receipts."
ok "To create a clean backup:"
ok "  1. Stop all services"
ok "  2. Copy $BASEDIR/block_store/ to your backup location"
ok "  3. This backup can be restored with verify-blocks: false"
echo "============================================================================"

# Clean up the old chain backup
if [ -d "$BASEDIR/$BACKUP_NAME" ]; then
  echo ""
  read -p "Delete the old chain state backup ($BACKUP_NAME)? [y/N] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$BASEDIR/$BACKUP_NAME"
    ok "Old backup deleted"
  fi
fi
