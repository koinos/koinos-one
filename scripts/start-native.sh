#!/usr/bin/env bash
# ============================================================================
# Knodel Native Node Launcher
# ============================================================================
# Starts all Koinos microservices natively on macOS.
#
# Usage:
#   ./scripts/start-native.sh                — start all services
#   ./scripts/start-native.sh --basedir DIR  — custom data directory
#   ./scripts/start-native.sh --stop         — stop all running services
# ============================================================================

set -euo pipefail

KNODEL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$KNODEL_ROOT/vendor/koinos"
AMQP_VENDOR="$KNODEL_ROOT/vendor/amqp-broker"
CONFIG_EXAMPLE="$VENDOR/koinos/config-example"

# Defaults
BASEDIR="${HOME}/.koinos"
AMQP_URL="amqp://guest:guest@127.0.0.1:5672/"
STOP_MODE=false
LOG_DIR=""
PID_DIR=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --basedir) BASEDIR="$2"; shift 2 ;;
    --amqp)   AMQP_URL="$2"; shift 2 ;;
    --stop)   STOP_MODE=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

LOG_DIR="$BASEDIR/logs"
PID_DIR="$BASEDIR/pids"

# ============================================================================
# Stop mode
# ============================================================================
if [ "$STOP_MODE" = true ]; then
  echo "Stopping all Koinos services..."
  if [ -d "$PID_DIR" ]; then
    for pidfile in "$PID_DIR"/*.pid; do
      [ -f "$pidfile" ] || continue
      svc="$(basename "$pidfile" .pid)"
      pid="$(cat "$pidfile")"
      if kill -0 "$pid" 2>/dev/null; then
        echo "  Stopping $svc (PID $pid)..."
        kill "$pid" 2>/dev/null || true
      fi
      rm -f "$pidfile"
    done
    # Wait for processes to exit
    sleep 2
    # Force kill any remaining
    for pidfile in "$PID_DIR"/*.pid; do
      [ -f "$pidfile" ] || continue
      pid="$(cat "$pidfile")"
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      rm -f "$pidfile"
    done
  fi
  echo "All services stopped."
  exit 0
fi

# ============================================================================
# Setup basedir and config files
# ============================================================================
echo "============================================================================"
echo "Knodel Native Node"
echo "  Basedir: $BASEDIR"
echo "  AMQP:    $AMQP_URL"
echo "============================================================================"

mkdir -p "$BASEDIR" "$LOG_DIR" "$PID_DIR"
mkdir -p "$BASEDIR/chain"
mkdir -p "$BASEDIR/jsonrpc/descriptors"
mkdir -p "$BASEDIR/amqp/mnesia"
mkdir -p "$BASEDIR/amqp/logs"

# Copy config.yml (fix AMQP URL for native — replace 'amqp' hostname with 127.0.0.1)
if [ ! -f "$BASEDIR/config.yml" ]; then
  echo "Setting up config.yml..."
  sed 's|amqp://guest:guest@amqp:5672/|amqp://guest:guest@127.0.0.1:5672/|' \
    "$CONFIG_EXAMPLE/config.yml" > "$BASEDIR/config.yml"
fi

# Copy genesis_data.json
if [ ! -f "$BASEDIR/chain/genesis_data.json" ]; then
  echo "Setting up genesis_data.json..."
  cp "$CONFIG_EXAMPLE/genesis_data.json" "$BASEDIR/chain/genesis_data.json"
fi

# Copy koinos_descriptors.pb
if [ ! -f "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb" ]; then
  echo "Setting up koinos_descriptors.pb..."
  cp "$CONFIG_EXAMPLE/koinos_descriptors.pb" "$BASEDIR/jsonrpc/descriptors/koinos_descriptors.pb"
fi

# Setup GarageMQ config
GARAGEMQ_CONFIG="$BASEDIR/amqp/garagemq.yaml"
if [ ! -f "$GARAGEMQ_CONFIG" ]; then
  echo "Setting up GarageMQ config..."
  # Copy base config and override db path to use basedir
  sed "s|defaultPath: db|defaultPath: $BASEDIR/amqp/db|" \
    "$AMQP_VENDOR/etc/config.yaml" > "$GARAGEMQ_CONFIG"
  # Bind to localhost only
  sed -i '' 's|ip: 0.0.0.0|ip: 127.0.0.1|g' "$GARAGEMQ_CONFIG"
fi

echo ""

# ============================================================================
# Binary locations
# ============================================================================
BIN_GARAGEMQ="$AMQP_VENDOR/garagemq"
BIN_CHAIN="$VENDOR/koinos-chain/build/src/koinos_chain"
BIN_MEMPOOL="$VENDOR/koinos-mempool/build/src/koinos_mempool"
BIN_BLOCK_STORE="$VENDOR/koinos-block-store/build/bin/koinos-block-store"
BIN_P2P="$VENDOR/koinos-p2p/build/bin/koinos-p2p"
BIN_JSONRPC="$VENDOR/koinos-jsonrpc/build/bin/koinos-jsonrpc"
BIN_GRPC="$VENDOR/koinos-grpc/build/src/koinos_grpc"
BIN_BLOCK_PRODUCER="$VENDOR/koinos-block-producer/build/src/koinos_block_producer"
BIN_TRANSACTION_STORE="$VENDOR/koinos-transaction-store/build/bin/koinos-transaction-store"
BIN_CONTRACT_META_STORE="$VENDOR/koinos-contract-meta-store/build/bin/koinos-contract-meta-store"
BIN_ACCOUNT_HISTORY="$VENDOR/koinos-account-history/build/src/koinos_account_history"
REST_DIR="$VENDOR/koinos-rest"

# Check all binaries exist
MISSING=0
for bin_var in BIN_GARAGEMQ BIN_CHAIN BIN_MEMPOOL BIN_BLOCK_STORE BIN_P2P BIN_JSONRPC BIN_GRPC BIN_BLOCK_PRODUCER BIN_TRANSACTION_STORE BIN_CONTRACT_META_STORE BIN_ACCOUNT_HISTORY; do
  bin_path="${!bin_var}"
  if [ ! -f "$bin_path" ]; then
    echo "ERROR: Missing binary: $bin_path"
    echo "  Run: ./scripts/build-native-mac.sh"
    ((MISSING++)) || true
  fi
done
if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "$MISSING binaries missing. Build first with: ./scripts/build-native-mac.sh"
  exit 1
fi

# ============================================================================
# Service launcher helpers
# ============================================================================
start_service() {
  local name="$1"
  shift
  local binary="$1"
  shift

  # Check if already running
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local old_pid
    old_pid="$(cat "$pidfile")"
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "  $name already running (PID $old_pid)"
      return 0
    fi
    rm -f "$pidfile"
  fi

  local logfile="$LOG_DIR/$name.log"
  echo "  Starting $name..."
  "$binary" "$@" > "$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  echo "  $name started (PID $pid, log: $logfile)"
}

wait_for_port() {
  local port="$1"
  local name="$2"
  local timeout="${3:-30}"
  local elapsed=0
  while ! nc -z 127.0.0.1 "$port" 2>/dev/null; do
    sleep 1
    ((elapsed++)) || true
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "  WARNING: $name did not start on port $port within ${timeout}s"
      return 1
    fi
  done
  echo "  $name ready on port $port (${elapsed}s)"
  return 0
}

# ============================================================================
# Start services in dependency order
# ============================================================================

echo "=== Starting AMQP Broker (GarageMQ) ==="
start_service "amqp" "$BIN_GARAGEMQ" --config "$GARAGEMQ_CONFIG"
wait_for_port 5672 "AMQP" 15

echo ""
echo "=== Starting Core Services ==="

# chain (depends: amqp)
start_service "chain" "$BIN_CHAIN" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"
sleep 2

# block_store (depends: amqp)
start_service "block_store" "$BIN_BLOCK_STORE" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"

# mempool (depends: amqp, chain)
start_service "mempool" "$BIN_MEMPOOL" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"

# transaction_store (depends: amqp)
start_service "transaction_store" "$BIN_TRANSACTION_STORE" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"

# contract_meta_store (depends: amqp)
start_service "contract_meta_store" "$BIN_CONTRACT_META_STORE" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"

# account_history (depends: amqp, chain, block_store)
start_service "account_history" "$BIN_ACCOUNT_HISTORY" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL"

echo ""
echo "=== Starting API Services ==="

# jsonrpc (depends: amqp, chain)
start_service "jsonrpc" "$BIN_JSONRPC" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL" --listen="/ip4/127.0.0.1/tcp/8080"

# grpc (depends: amqp, chain)
start_service "grpc" "$BIN_GRPC" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL" --endpoint="127.0.0.1:50051"

echo ""
echo "=== Starting Network Services ==="

# p2p (depends: amqp, chain, block_store)
start_service "p2p" "$BIN_P2P" \
  --basedir="$BASEDIR" --amqp="$AMQP_URL" --listen="/ip4/0.0.0.0/tcp/8888"

echo ""
echo "=== Starting REST API ==="

# REST (depends: jsonrpc)
if [ -d "$REST_DIR/.next" ]; then
  local_server="$REST_DIR/.next/standalone/server.js"
  if [ -f "$local_server" ]; then
    # Standalone build
    JSONRPC_URL="http://127.0.0.1:8080/" HOSTNAME="127.0.0.1" PORT="3000" NODE_ENV="production" \
      start_service "rest" node "$local_server"
  else
    # Dev mode fallback
    JSONRPC_URL="http://127.0.0.1:8080/" HOSTNAME="127.0.0.1" PORT="3000" NODE_ENV="production" \
      start_service "rest" yarn --cwd "$REST_DIR" start
  fi
else
  echo "  SKIP: koinos-rest not built (run: ./scripts/build-native-mac.sh rest)"
fi

# ============================================================================
# Wait for API ports
# ============================================================================
echo ""
echo "=== Waiting for API services ==="
wait_for_port 8080 "JSON-RPC" 15
wait_for_port 50051 "gRPC" 15
wait_for_port 8888 "P2P" 15

# ============================================================================
# Status summary
# ============================================================================
echo ""
echo "============================================================================"
echo "Knodel Node Status"
echo "============================================================================"

RUNNING=0
TOTAL=0
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  svc="$(basename "$pidfile" .pid)"
  pid="$(cat "$pidfile")"
  ((TOTAL++)) || true
  if kill -0 "$pid" 2>/dev/null; then
    echo "  [OK]   $svc (PID $pid)"
    ((RUNNING++)) || true
  else
    echo "  [DEAD] $svc (PID $pid)"
  fi
done

echo ""
echo "  Running: $RUNNING / $TOTAL services"
echo ""
echo "  Endpoints:"
echo "    JSON-RPC: http://127.0.0.1:8080/"
echo "    gRPC:     127.0.0.1:50051"
echo "    P2P:      /ip4/0.0.0.0/tcp/8888"
echo "    REST:     http://127.0.0.1:3000/"
echo ""
echo "  Logs:     $LOG_DIR/"
echo "  Data:     $BASEDIR/"
echo "  Stop:     ./scripts/start-native.sh --stop"
echo "============================================================================"
