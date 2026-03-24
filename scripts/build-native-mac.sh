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

# --- CMake version selection ---
# Hunter 0.25.5 is incompatible with CMake 4.x. Prefer CMake 3.28.x.
# Install via: pip3 install cmake==3.28.4 --user --break-system-packages
CMAKE_CMD="cmake"
PYTHON_CMAKE="$HOME/Library/Python/3.9/bin/cmake"
if [ -x "$PYTHON_CMAKE" ]; then
  PY_CMAKE_MAJOR="$("$PYTHON_CMAKE" --version | head -1 | sed 's/cmake version //' | cut -d. -f1)"
  if [ "$PY_CMAKE_MAJOR" -lt 4 ]; then
    CMAKE_CMD="$PYTHON_CMAKE"
    echo "  CMake:     $("$CMAKE_CMD" --version | head -1) (from pip, Hunter-compatible)"
  fi
fi

CMAKE_MAJOR="$("$CMAKE_CMD" --version | head -1 | sed 's/cmake version //' | cut -d. -f1)"
if [ "$CMAKE_MAJOR" -ge 4 ]; then
  echo "  CMake:     $("$CMAKE_CMD" --version | head -1) (WARNING: CMake 4.x may have Hunter compat issues)"
  echo "  TIP:       Install CMake 3.28: pip3 install cmake==3.28.4 --user --break-system-packages"
  export CMAKE_POLICY_VERSION_MINIMUM=3.5
  CMAKE_POLICY_FIX=true
else
  echo "  CMake:     $("$CMAKE_CMD" --version | head -1)"
  CMAKE_POLICY_FIX=false
fi

# --- CMake configure args ---
cmake_configure_args() {
  local src_dir="$1"
  local build_dir="$2"
  local args=(-S "$src_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release)

  # CMake 4.x compat: Hunter 0.25.5 sub-builds use cmake_minimum_required < 3.5
  if [ "$CMAKE_POLICY_FIX" = true ]; then
    args+=(-DCMAKE_POLICY_VERSION_MINIMUM=3.5)
  fi

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
patch_hunter_config() {
  # Patch the Hunter config.cmake fetched by FetchContent to fix ZLIB on macOS.
  # Hunter 0.25.5's ZLIB (via zutil.h) defines fdopen as NULL on TARGET_OS_MAC,
  # which conflicts with macOS SDK headers. Fix: pass -UTARGET_OS_MAC via CMAKE_C_FLAGS.
  local build_dir="$1"
  local config_file="$build_dir/_deps/koinos_cmake-src/Hunter/config.cmake"

  if [ ! -f "$config_file" ]; then
    echo "  WARNING: Hunter config not found at $config_file"
    return 1
  fi

  # Only patch if not already patched
  if grep -q 'UTARGET_OS_MAC' "$config_file" 2>/dev/null; then
    echo "  Hunter config already patched"
    return 0
  fi

  echo "  Patching Hunter config: adding -UTARGET_OS_MAC to ZLIB C flags..."

  # Replace the ZLIB hunter_config to add -UTARGET_OS_MAC flag and force arm64 arch
  if [ "$IS_ARM64" = true ]; then
    sed -i '' '/^hunter_config(ZLIB/,/^)/c\
hunter_config(ZLIB\
   VERSION ${HUNTER_ZLIB_VERSION}\
   CMAKE_ARGS\
      CMAKE_POSITION_INDEPENDENT_CODE=ON\
      CMAKE_CXX_STANDARD=20\
      CMAKE_CXX_STANDARD_REQUIRED=ON\
      CMAKE_C_FLAGS=-UTARGET_OS_MAC\
      CMAKE_OSX_ARCHITECTURES=arm64\
)' "$config_file"
  else
    sed -i '' '/^hunter_config(ZLIB/,/^)/c\
hunter_config(ZLIB\
   VERSION ${HUNTER_ZLIB_VERSION}\
   CMAKE_ARGS\
      CMAKE_POSITION_INDEPENDENT_CODE=ON\
      CMAKE_CXX_STANDARD=20\
      CMAKE_CXX_STANDARD_REQUIRED=ON\
      CMAKE_C_FLAGS=-UTARGET_OS_MAC\
)' "$config_file"
  fi

  # On Apple Silicon, add CMAKE_OSX_ARCHITECTURES=arm64 to abseil, re2, c-ares, gRPC
  # so Hunter sub-builds correctly detect arm64 and avoid x86 SSE flags.
  if [ "$IS_ARM64" = true ]; then
    echo "  Patching Hunter config: adding CMAKE_OSX_ARCHITECTURES=arm64 to abseil/gRPC deps..."
    for pkg in abseil re2 c-ares; do
      if grep -q "^hunter_config($pkg" "$config_file"; then
        sed -i '' "/^hunter_config($pkg/,/^)/ {
          /CMAKE_CXX_STANDARD_REQUIRED=ON/a\\
\\      CMAKE_OSX_ARCHITECTURES=arm64
        }" "$config_file"
      fi
    done
    # Also patch gRPC itself
    if grep -q "^hunter_config(gRPC" "$config_file"; then
      sed -i '' '/^hunter_config(gRPC/,/^)/ {
        /CMAKE_CXX_STANDARD_REQUIRED=ON/a\
\      CMAKE_OSX_ARCHITECTURES=arm64
      }' "$config_file"
    fi
  fi

  echo "  Hunter config patched successfully"

  # Patch abseil RANDEN_COPTS to avoid -msse4.1 on ARM64.
  # The Apple multi-arch code in AbseilConfigureCopts.cmake doesn't work correctly
  # because CMake deduplicates -Xarch_x86_64 prefixes, leaving -msse4.1 unscoped.
  # Fix: directly patch the GENERATED_AbseilCopts.cmake in Hunter's abseil source.
  local hunter_base="${HUNTER_ROOT:-$HOME/.hunter}"
  while IFS= read -r -d '' copts_file; do
    if grep -q 'ABSL_RANDOM_HWAES_X64_FLAGS' "$copts_file" 2>/dev/null; then
      if ! grep -q 'Patched for ARM64' "$copts_file" 2>/dev/null; then
        echo "  Patching abseil GENERATED_AbseilCopts.cmake: clearing X64 HWAES flags for ARM64 compat"
        # On ARM64-only builds, we don't need x86_64 flags at all
        sed -i '' '/ABSL_RANDOM_HWAES_X64_FLAGS/,/)/ {
          s/"-maes"/# "-maes" # Patched for ARM64/
          s/"-msse4.1"/# "-msse4.1" # Patched for ARM64/
        }' "$copts_file"
      fi
    fi
  done < <(find "$hunter_base" -path "*/Build/abseil/Source/absl/copts/GENERATED_AbseilCopts.cmake" -type f -print0 2>/dev/null)
  return 0
}

clean_hunter_zlib_cache() {
  # Remove Hunter's cached ZLIB install so it rebuilds with the new flags
  local hunter_base="${HUNTER_ROOT:-$HOME/.hunter}"
  # Find and remove ZLIB install stamps and installed artifacts
  find "$hunter_base" -path "*/Build/ZLIB" -type d 2>/dev/null | while read -r zlib_dir; do
    echo "  Cleaning Hunter ZLIB cache: $zlib_dir"
    rm -rf "$zlib_dir"
  done
  # Also clean the ZLIB install directory
  find "$hunter_base" -path "*/Install/ZLIB" -type d 2>/dev/null | while read -r zlib_dir; do
    echo "  Cleaning Hunter ZLIB install: $zlib_dir"
    rm -rf "$zlib_dir"
  done
}

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

  local first_svc=true

  for svc in "${CPP_SERVICES[@]}"; do
    echo ""
    echo "--- Building $svc ---"
    local svc_dir="$VENDOR/$svc"
    if [ ! -d "$svc_dir" ]; then
      echo "SKIP: $svc_dir not found"
      continue
    fi

    local build_dir="$svc_dir/build"

    # Step 1: Initial configure (triggers FetchContent to download koinos_cmake)
    echo "  [1/4] Configuring (FetchContent download)..."
    local cmake_args
    cmake_args=($(cmake_configure_args "$svc_dir" "$build_dir"))
    "$CMAKE_CMD" "${cmake_args[@]}" 2>&1 || true

    # Step 2: Patch Hunter config for macOS compatibility
    echo "  [2/4] Patching Hunter config for macOS compatibility..."

    # On ARM64, inject CMAKE_OSX_ARCHITECTURES into the Hunter global cache
    # BEFORE any Hunter packages get built. The cache.cmake is read by ALL
    # Hunter ExternalProject sub-builds via -C flag.
    if [ "$IS_ARM64" = true ]; then
      # Find all Hunter cache.cmake files (there may be multiple config hashes)
      while IFS= read -r -d '' hunter_cache; do
        if ! grep -q 'CMAKE_OSX_ARCHITECTURES' "$hunter_cache" 2>/dev/null; then
          echo 'set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "Force ARM64 on Apple Silicon")' >> "$hunter_cache"
          echo "  Injected CMAKE_OSX_ARCHITECTURES=arm64 into: $hunter_cache"
        fi
      done < <(find "$build_dir/_3rdParty/Hunter" -name "cache.cmake" -print0 2>/dev/null)
    fi

    if patch_hunter_config "$build_dir"; then
      # On first service, clean the entire Hunter install so deps rebuild with correct arch
      if [ "$first_svc" = true ]; then
        clean_hunter_zlib_cache
        # Also clean the Install dir to force ALL packages to rebuild
        local hunter_install_dir
        hunter_install_dir="$(find "$build_dir/_3rdParty/Hunter" -name "Install" -type d 2>/dev/null | head -1)"
        if [ -n "$hunter_install_dir" ] && [ -d "$hunter_install_dir" ]; then
          echo "  Cleaning Hunter Install directory to force ARM64 rebuild..."
          rm -rf "$hunter_install_dir"
        fi
        first_svc=false
      fi
    fi

    # Step 3: Reconfigure with patches applied (this triggers Hunter package builds)
    echo "  [3/4] Reconfiguring with patches (building Hunter packages)..."
    if ! "$CMAKE_CMD" "${cmake_args[@]}" 2>&1; then
      echo "FAILED: $svc cmake configure"
      ((FAIL++)) || true
      continue
    fi

    # Step 4: Build
    echo "  [4/4] Building..."
    if "$CMAKE_CMD" --build "$build_dir" --config Release --parallel 2>&1; then
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
