#!/usr/bin/env bash
# ============================================================================
# Knodel Native macOS Build Script
# ============================================================================
# Builds all 11 Koinos microservices natively on macOS (Intel + Apple Silicon).
#
# Prerequisites:
#   - Xcode Command Line Tools (xcode-select --install)
#   - CMake 3.28.x (brew install cmake)  — NOT 4.x (Hunter 0.25.5 incompatible)
#   - Go 1.22+ (brew install go)
#   - Node.js 20+ and Yarn (brew install node && npm i -g yarn)
#   - GMP library (brew install gmp)
#   - Ninja (optional, improves speed: brew install ninja)
#
# Usage:
#   ./scripts/build-native-mac.sh [all|go|cpp|rest|amqp]
#   ./scripts/build-native-mac.sh              — builds everything
#   ./scripts/build-native-mac.sh go           — builds Go services only
#   ./scripts/build-native-mac.sh cpp          — builds C++ services only
#   ./scripts/build-native-mac.sh rest         — builds koinos-rest only
#   ./scripts/build-native-mac.sh amqp         — builds GarageMQ only
# ============================================================================

set -euo pipefail

TARGET="${1:-all}"
KNODEL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$KNODEL_ROOT/vendor/koinos"
AMQP_VENDOR="$KNODEL_ROOT/vendor/amqp-broker"

PASS=0
FAIL=0

# --- Detect architecture ---
ARCH="$(uname -m)"
IS_ARM64=false
if [ "$ARCH" = "arm64" ]; then
  IS_ARM64=true
fi

# --- Detect Homebrew prefix ---
HOMEBREW_PREFIX=""
if [ -d "/opt/homebrew" ]; then
  HOMEBREW_PREFIX="/opt/homebrew"
elif [ -d "/usr/local/Cellar" ]; then
  HOMEBREW_PREFIX="/usr/local"
fi

# --- Check prerequisites ---
check_prereq() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install with: $install_hint"
    exit 1
  fi
}

check_prereq cmake "brew install cmake"
check_prereq go "brew install go"
check_prereq node "brew install node"

echo "============================================================================"
echo "Knodel Native macOS Build"
echo "  Target:    $TARGET"
echo "  Arch:      $ARCH"
echo "  Vendor:    $VENDOR"
echo "  Homebrew:  ${HOMEBREW_PREFIX:-not found}"
echo "============================================================================"

# --- CMake configure args ---
cmake_configure_args() {
  local src_dir="$1"
  local build_dir="$2"
  local args=(-S "$src_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release)

  # Prefer Ninja if available
  if command -v ninja &>/dev/null; then
    args+=(-G Ninja)
  fi

  if [ "$IS_ARM64" = true ]; then
    args+=(-DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_APPLE_SILICON_PROCESSOR=arm64)
  fi

  if [ -n "$HOMEBREW_PREFIX" ]; then
    args+=(-DCMAKE_PREFIX_PATH="$HOMEBREW_PREFIX")
    local gmp_include="$HOMEBREW_PREFIX/include"
    local gmp_library="$HOMEBREW_PREFIX/lib/libgmp.dylib"
    local gmpxx_library="$HOMEBREW_PREFIX/lib/libgmpxx.dylib"
    [ -d "$gmp_include" ] && args+=(-DGMP_INCLUDE_DIR="$gmp_include")
    [ -f "$gmp_library" ] && args+=(-DGMP_LIBRARY="$gmp_library")
    [ -f "$gmpxx_library" ] && args+=(-DGMPXX_LIBRARY="$gmpxx_library")
  fi

  # Git executable
  if [ -x /usr/bin/git ]; then
    args+=(-DGIT_EXECUTABLE=/usr/bin/git)
  fi

  echo "${args[@]}"
}

# ============================================================================
# Go Services
# ============================================================================
build_go() {
  echo ""
  echo "=== Building Go Services ==="

  local GO_SERVICES=(
    koinos-block-store
    koinos-p2p
    koinos-jsonrpc
    koinos-transaction-store
    koinos-contract-meta-store
  )

  for svc in "${GO_SERVICES[@]}"; do
    echo ""
    echo "--- Building $svc ---"
    local svc_dir="$VENDOR/$svc"
    if [ ! -d "$svc_dir" ]; then
      echo "SKIP: $svc_dir not found"
      continue
    fi

    pushd "$svc_dir" > /dev/null

    # Determine the cmd directory
    local cmd_dir=""
    if [ -d "cmd/$svc" ]; then
      cmd_dir="./cmd/$svc"
    elif [ -d "cmd" ]; then
      # Find first cmd subdirectory
      local first_cmd
      first_cmd="$(find cmd -maxdepth 1 -mindepth 1 -type d | head -1)"
      if [ -n "$first_cmd" ]; then
        cmd_dir="./$first_cmd"
      fi
    fi

    mkdir -p build/bin
    local build_target="${cmd_dir:-.}"
    if CGO_ENABLED=0 go build -v -o "build/bin/$svc" "$build_target" 2>&1; then
      echo "OK: $svc built"
      ((PASS++)) || true
    else
      echo "FAILED: $svc"
      ((FAIL++)) || true
    fi

    popd > /dev/null
  done
}

# ============================================================================
# C++ Services
# ============================================================================
build_cpp() {
  echo ""
  echo "=== Building C++ Services ==="
  echo "NOTE: First build will take a long time (Hunter downloads + compiles all dependencies)."
  echo "      Subsequent builds use cached packages and are much faster."
  echo ""

  local CPP_SERVICES=(
    koinos-chain
    koinos-mempool
    koinos-grpc
    koinos-block-producer
    koinos-account-history
  )

  for svc in "${CPP_SERVICES[@]}"; do
    echo ""
    echo "--- Building $svc ---"
    local svc_dir="$VENDOR/$svc"
    if [ ! -d "$svc_dir" ]; then
      echo "SKIP: $svc_dir not found"
      continue
    fi

    local build_dir="$svc_dir/build"

    # Step 1: Configure
    echo "  [1/2] Configuring..."
    local cmake_args
    cmake_args=($(cmake_configure_args "$svc_dir" "$build_dir"))
    if ! cmake "${cmake_args[@]}" 2>&1; then
      echo "FAILED: $svc cmake configure"
      ((FAIL++)) || true
      continue
    fi

    # Step 2: Build
    echo "  [2/2] Building..."
    if cmake --build "$build_dir" --config Release --parallel 2>&1; then
      echo "OK: $svc built"
      ((PASS++)) || true
    else
      echo "FAILED: $svc build"
      ((FAIL++)) || true
    fi
  done
}

# ============================================================================
# REST Service (koinos-rest)
# ============================================================================
build_rest() {
  echo ""
  echo "=== Building koinos-rest ==="
  local rest_dir="$VENDOR/koinos-rest"
  if [ ! -d "$rest_dir" ]; then
    echo "SKIP: koinos-rest not found at $rest_dir"
    return
  fi

  pushd "$rest_dir" > /dev/null
  if yarn install --frozen-lockfile 2>&1 && yarn build 2>&1; then
    echo "OK: koinos-rest built"
    ((PASS++)) || true
  else
    echo "FAILED: koinos-rest"
    ((FAIL++)) || true
  fi
  popd > /dev/null
}

# ============================================================================
# AMQP Broker (GarageMQ)
# ============================================================================
build_amqp() {
  echo ""
  echo "=== Building GarageMQ (AMQP broker) ==="
  if [ ! -d "$AMQP_VENDOR" ]; then
    echo "SKIP: amqp-broker not found at $AMQP_VENDOR"
    return
  fi

  pushd "$AMQP_VENDOR" > /dev/null
  if go build -v -o garagemq . 2>&1; then
    echo "OK: garagemq built"
    ((PASS++)) || true
  else
    echo "FAILED: garagemq"
    ((FAIL++)) || true
  fi
  popd > /dev/null
}

# ============================================================================
# Dispatch
# ============================================================================
case "$TARGET" in
  all)
    build_go
    build_rest
    build_cpp
    build_amqp
    ;;
  go)
    build_go
    ;;
  cpp)
    build_cpp
    ;;
  rest)
    build_rest
    ;;
  amqp)
    build_amqp
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [all|go|cpp|rest|amqp]"
    exit 1
    ;;
esac

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================================================"
echo "Build Summary"
echo "============================================================================"

# Check Go binaries
for svc in koinos-block-store koinos-p2p koinos-jsonrpc koinos-transaction-store koinos-contract-meta-store; do
  if [ -f "$VENDOR/$svc/build/bin/$svc" ]; then
    echo "  OK:   $svc"
  else
    echo "  MISS: $svc"
  fi
done

# Check C++ binaries
for svc in koinos-chain koinos-mempool koinos-grpc koinos-block-producer koinos-account-history; do
  local_name="$(echo "$svc" | sed 's/-/_/g' | sed 's/koinos_//')"
  bin_name="koinos_${local_name}"
  if [ -f "$VENDOR/$svc/build/src/$bin_name" ]; then
    echo "  OK:   $bin_name"
  else
    echo "  MISS: $bin_name (expected at $VENDOR/$svc/build/src/$bin_name)"
  fi
done

# Check REST
if [ -d "$VENDOR/koinos-rest/.next" ]; then
  echo "  OK:   koinos-rest (.next build output)"
else
  echo "  MISS: koinos-rest"
fi

# Check GarageMQ
if [ -f "$AMQP_VENDOR/garagemq" ]; then
  echo "  OK:   garagemq"
else
  echo "  MISS: garagemq"
fi

echo ""
echo "  Passed: $PASS, Failed: $FAIL"
echo "============================================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
