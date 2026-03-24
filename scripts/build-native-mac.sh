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
    # Use ARM64 toolchain so Hunter propagates arch to ALL sub-projects (gRPC, etc.)
    local toolchain="$KNODEL_ROOT/cmake/arm64-toolchain.cmake"
    if [ -f "$toolchain" ]; then
      args+=(-DCMAKE_TOOLCHAIN_FILE="$toolchain")
    fi
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
# C++ Services — Patched tarball approach (from native-mac-services branch)
# ============================================================================
# On macOS (especially ARM64), Hunter 0.25.5 has multiple issues:
#   1. ZLIB: zutil.h redefines fdopen=NULL on TARGET_OS_MAC
#   2. abseil: AbseilConfigureCopts.cmake emits x86 SSE flags on ARM64
#   3. koinos_exception: missing BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED
#
# Strategy: download upstream tarballs, patch them, create local tarballs,
# then rewrite Hunter/config.cmake URLs to point to local file:// paths.
# ============================================================================

PATCH_CACHE_DIR="$KNODEL_ROOT/.native-build-cache"

sha1_file() {
  shasum -a 1 "$1" | cut -d' ' -f1
}

# --- Prepare patched ZLIB tarball ---
ensure_patched_zlib_tarball() {
  local version="1.3.0-p0"
  local upstream_url="https://github.com/cpp-pm/zlib/archive/refs/tags/v${version}.tar.gz"
  local upstream_path="$PATCH_CACHE_DIR/zlib-${version}-upstream.tar.gz"
  local patched_path="$PATCH_CACHE_DIR/zlib-${version}-darwin-patched.tar.gz"

  mkdir -p "$PATCH_CACHE_DIR"

  if [ -f "$patched_path" ]; then
    echo "$patched_path"
    return 0
  fi

  # Try to find existing Hunter-cached tarball first
  local cached
  cached="$(find "${HUNTER_ROOT:-$HOME/.hunter}" -path "*/Download/ZLIB/*/v${version}.tar.gz" -type f 2>/dev/null | head -1)"
  if [ -n "$cached" ]; then
    cp "$cached" "$upstream_path"
  elif [ ! -f "$upstream_path" ]; then
    echo "  Downloading ZLIB ${version}..."
    curl -sL "$upstream_url" -o "$upstream_path"
  fi

  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$upstream_path" -C "$tmp"
  local root
  root="$(ls "$tmp")"

  # Patch: fix TARGET_OS_MAC check in zutil.h
  local zutil="$tmp/$root/zutil.h"
  if [ -f "$zutil" ]; then
    sed -i '' 's/#if defined(MACOS) || defined(TARGET_OS_MAC)/#if (defined(MACOS) || defined(TARGET_OS_MAC)) \&\& !defined(__APPLE__)/' "$zutil"
    echo "  Patched zutil.h"
  fi

  tar -czf "$patched_path" -C "$tmp" "$root"
  rm -rf "$tmp"
  echo "$patched_path"
}

# --- Prepare patched abseil tarball ---
ensure_patched_abseil_tarball() {
  local version="20230802.1"
  local upstream_url="https://github.com/abseil/abseil-cpp/archive/${version}.tar.gz"
  local upstream_path="$PATCH_CACHE_DIR/abseil-${version}-upstream.tar.gz"
  local patched_path="$PATCH_CACHE_DIR/abseil-${version}-darwin-patched.tar.gz"

  mkdir -p "$PATCH_CACHE_DIR"

  if [ -f "$patched_path" ]; then
    echo "$patched_path"
    return 0
  fi

  # Try to find existing Hunter-cached tarball
  local cached
  cached="$(find "${HUNTER_ROOT:-$HOME/.hunter}" -path "*/Download/abseil/*/${version}.tar.gz" -type f 2>/dev/null | head -1)"
  if [ -n "$cached" ]; then
    cp "$cached" "$upstream_path"
  elif [ ! -f "$upstream_path" ]; then
    echo "  Downloading abseil ${version}..."
    curl -sL "$upstream_url" -o "$upstream_path"
  fi

  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$upstream_path" -C "$tmp"
  local root
  root="$(ls "$tmp")"

  # Patch AbseilConfigureCopts.cmake: fix ARM64 detection
  # The original Apple/Clang block unconditionally sets x86 SSE flags.
  # We need to add an ARM64 check so it skips SSE on arm64.
  local copts_file="$tmp/$root/absl/copts/AbseilConfigureCopts.cmake"
  if [ -f "$copts_file" ] && ! grep -q 'CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"' "$copts_file"; then
    echo "  Patching AbseilConfigureCopts.cmake for ARM64..."
    # Replace the Apple/Clang HWAES block with ARM64-aware version
    python3 -c "
import re, sys
content = open('$copts_file').read()

# Find the Apple Clang block and add ARM64 architecture check
old_if = 'if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES [[Clang]])\n'
new_if = '''if(APPLE AND CMAKE_CXX_COMPILER_ID MATCHES [[Clang]])
  if(
    CMAKE_OSX_ARCHITECTURES STREQUAL \"arm64\"
    OR (
      NOT CMAKE_OSX_ARCHITECTURES
      AND CMAKE_SYSTEM_PROCESSOR STREQUAL \"arm64\"
    )
  )
    set(ABSL_RANDOM_RANDEN_COPTS \"\${ABSL_RANDOM_HWAES_ARM_FLAGS}\")
  elseif(CMAKE_OSX_ARCHITECTURES STREQUAL \"x86_64\" OR (NOT CMAKE_OSX_ARCHITECTURES AND CMAKE_SYSTEM_PROCESSOR MATCHES \"x86_64|amd64\"))
    set(ABSL_RANDOM_RANDEN_COPTS \"\${ABSL_RANDOM_HWAES_X64_FLAGS}\")
  else()
'''
content = content.replace(old_if, new_if)

# Also close the extra if/else
old_end = '''  if(ABSL_RANDOM_RANDEN_COPTS AND NOT ABSL_RANDOM_RANDEN_COPTS_WARNING)
    list(APPEND ABSL_RANDOM_RANDEN_COPTS \"-Wno-unused-command-line-argument\")
  endif()
'''
new_end = '''  if(ABSL_RANDOM_RANDEN_COPTS AND NOT ABSL_RANDOM_RANDEN_COPTS_WARNING)
    list(APPEND ABSL_RANDOM_RANDEN_COPTS \"-Wno-unused-command-line-argument\")
  endif()
  endif()
'''
content = content.replace(old_end, new_end)

open('$copts_file', 'w').write(content)
" 2>&1 || echo "  WARNING: python3 patch failed, trying sed fallback"
  fi

  tar -czf "$patched_path" -C "$tmp" "$root"
  rm -rf "$tmp"
  echo "$patched_path"
}

# --- Prepare patched koinos_exception tarball ---
ensure_patched_koinos_exception_tarball() {
  local version="1.0.2"
  local upstream_url="https://github.com/koinos/koinos-exception-cpp/archive/v${version}.tar.gz"
  local upstream_path="$PATCH_CACHE_DIR/koinos-exception-${version}-upstream.tar.gz"
  local patched_path="$PATCH_CACHE_DIR/koinos-exception-${version}-darwin-patched.tar.gz"

  mkdir -p "$PATCH_CACHE_DIR"

  if [ -f "$patched_path" ]; then
    echo "$patched_path"
    return 0
  fi

  # Try to find existing Hunter-cached tarball
  local cached
  cached="$(find "${HUNTER_ROOT:-$HOME/.hunter}" -path "*/Download/koinos_exception/*/v${version}.tar.gz" -type f 2>/dev/null | head -1)"
  if [ -n "$cached" ]; then
    cp "$cached" "$upstream_path"
  elif [ ! -f "$upstream_path" ]; then
    echo "  Downloading koinos_exception ${version}..."
    curl -sL "$upstream_url" -o "$upstream_path"
  fi

  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$upstream_path" -C "$tmp"
  local root
  root="$(ls "$tmp")"

  # Patch: add BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED before boost include
  local header="$tmp/$root/include/koinos/exception.hpp"
  if [ -f "$header" ] && ! grep -q 'BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED' "$header"; then
    echo "  Patching koinos exception.hpp for macOS stacktrace..."
    sed -i '' 's|#include <boost/exception/all.hpp>|#ifndef BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED\
#define BOOST_STACKTRACE_GNU_SOURCE_NOT_REQUIRED 1\
#endif\
\
#include <boost/exception/all.hpp>|' "$header"
  fi

  tar -czf "$patched_path" -C "$tmp" "$root"
  rm -rf "$tmp"
  echo "$patched_path"
}

# --- Patch Hunter config.cmake with local patched tarball URLs ---
patch_hunter_config_with_tarballs() {
  local build_dir="$1"
  local config_file="$build_dir/_deps/koinos_cmake-src/Hunter/config.cmake"

  if [ ! -f "$config_file" ]; then
    echo "  WARNING: Hunter config not found at $config_file"
    return 1
  fi

  # Check if already patched
  if grep -q 'darwin-patched' "$config_file" 2>/dev/null; then
    echo "  Hunter config already patched with local tarballs"
    return 0
  fi

  echo "  Preparing patched tarballs..."

  local zlib_tarball abseil_tarball exc_tarball
  zlib_tarball="$(ensure_patched_zlib_tarball)"
  abseil_tarball="$(ensure_patched_abseil_tarball)"
  exc_tarball="$(ensure_patched_koinos_exception_tarball)"

  local zlib_url="file://${zlib_tarball}"
  local zlib_sha1="$(sha1_file "$zlib_tarball")"
  local abseil_url="file://${abseil_tarball}"
  local abseil_sha1="$(sha1_file "$abseil_tarball")"
  local exc_url="file://${exc_tarball}"
  local exc_sha1="$(sha1_file "$exc_tarball")"

  echo "  ZLIB:              $zlib_tarball (sha1: $zlib_sha1)"
  echo "  abseil:            $abseil_tarball (sha1: $abseil_sha1)"
  echo "  koinos_exception:  $exc_tarball (sha1: $exc_sha1)"

  local arm64_flag=""
  if [ "$IS_ARM64" = true ]; then
    arm64_flag="--arm64"

    # Also patch rocksdb for ARM64 CRC
    local rocksdb_tarball
    rocksdb_tarball="$(ensure_patched_rocksdb_tarball)"
    if [ -n "$rocksdb_tarball" ] && [ -f "$rocksdb_tarball" ]; then
      local rocksdb_url="file://${rocksdb_tarball}"
      local rocksdb_sha1="$(sha1_file "$rocksdb_tarball")"
      echo "  rocksdb:           $rocksdb_tarball (sha1: $rocksdb_sha1)"
      # Replace rocksdb URL in config
      python3 -c "
import re
content = open('$config_file').read()
pattern = re.compile(
    r'(hunter_config\(rocksdb\s*\n)'
    r'(.*?\n)*?'
    r'(\s+CMAKE_ARGS\s*\n)',
    re.MULTILINE
)
replacement = (
    'hunter_config(rocksdb\n'
    '   URL \"$rocksdb_url\"\n'
    '   SHA1 \"$rocksdb_sha1\"\n'
    '   CMAKE_ARGS\n'
)
new_content, count = pattern.subn(replacement, content)
if count > 0:
    print('  Replaced hunter_config(rocksdb) with patched tarball URL')
open('$config_file', 'w').write(new_content)
"
    fi
  fi

  python3 "$KNODEL_ROOT/scripts/patch-hunter-config.py" \
    "$config_file" \
    "$zlib_url" "$zlib_sha1" \
    "$abseil_url" "$abseil_sha1" \
    "$exc_url" "$exc_sha1" \
    $arm64_flag

  return 0
}

# --- Prepare patched rocksdb tarball (ARM64 CRC) ---
ensure_patched_rocksdb_tarball() {
  if [ "$IS_ARM64" != true ]; then return 1; fi

  local version="8.8.1"
  local upstream_url="https://github.com/facebook/rocksdb/archive/v${version}.tar.gz"
  local upstream_path="$PATCH_CACHE_DIR/rocksdb-${version}-upstream.tar.gz"
  local patched_path="$PATCH_CACHE_DIR/rocksdb-${version}-darwin-patched.tar.gz"

  mkdir -p "$PATCH_CACHE_DIR"

  if [ -f "$patched_path" ]; then
    echo "$patched_path"
    return 0
  fi

  local cached
  cached="$(find "${HUNTER_ROOT:-$HOME/.hunter}" -path "*/Download/rocksdb/*/v${version}.tar.gz" -type f 2>/dev/null | head -1)"
  if [ -n "$cached" ]; then
    cp "$cached" "$upstream_path"
  elif [ ! -f "$upstream_path" ]; then
    echo "  Downloading rocksdb ${version}..."
    curl -sL "$upstream_url" -o "$upstream_path"
  fi

  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$upstream_path" -C "$tmp"
  local root
  root="$(ls "$tmp")"

  # Patch CMakeLists.txt: force HAS_ARMV8_CRC=TRUE on arm64
  # The PORTABLE=ON mode skips -march=native but the arm64 CRC check is
  # separate. However, Hunter's toolchain may cause CMAKE_SYSTEM_PROCESSOR
  # to not match "arm64". We force it.
  local cml="$tmp/$root/CMakeLists.txt"
  if [ -f "$cml" ] && ! grep -q 'KNODEL_ARM64_CRC_PATCH' "$cml"; then
    echo "  Patching rocksdb CMakeLists.txt for ARM64 CRC..."
    # Add a forced ARM64 CRC block right after the existing arm64 check
    sed -i '' '/^endif(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|AARCH64")/a\
\
# KNODEL_ARM64_CRC_PATCH: Force ARM64 CRC on Apple Silicon\
if(APPLE AND NOT HAS_ARMV8_CRC)\
  CHECK_C_COMPILER_FLAG("-march=armv8-a+crc+crypto" KNODEL_HAS_ARMV8_CRC)\
  if(KNODEL_HAS_ARMV8_CRC)\
    set(HAS_ARMV8_CRC TRUE)\
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=armv8-a+crc+crypto -Wno-unused-function")\
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=armv8-a+crc+crypto -Wno-unused-function")\
    message(STATUS "KNODEL: Forced ARM64 CRC support")\
  endif()\
endif()
' "$cml"
  fi

  tar -czf "$patched_path" -C "$tmp" "$root"
  rm -rf "$tmp"
  echo "$patched_path"
}

clean_hunter_caches() {
  # Clean Hunter's cached builds for packages we've patched
  local hunter_base="${HUNTER_ROOT:-$HOME/.hunter}"
  for pkg in ZLIB abseil gRPC koinos_exception rocksdb; do
    find "$hunter_base" -path "*/Build/$pkg" -type d 2>/dev/null | while read -r dir; do
      echo "  Cleaning Hunter cache: $dir"
      rm -rf "$dir"
    done
  done
}

# --- Patch rocksdb source in Hunter cache to force ARM64 CRC ---
# Hunter's cmake_args mechanism doesn't properly pass flags with spaces,
# so we patch the rocksdb source directly after Hunter extracts it.
patch_rocksdb_arm64_crc() {
  if [ "$IS_ARM64" != true ]; then return 0; fi

  local hunter_base="${HUNTER_ROOT:-$HOME/.hunter}"
  # Find all extracted rocksdb Source dirs
  while IFS= read -r -d '' cmakelists; do
    local srcdir="$(dirname "$cmakelists")"
    if grep -q 'crc32c_arm64.cc' "$cmakelists" && ! grep -q 'FORCE_ARM64_CRC' "$cmakelists"; then
      echo "  Patching rocksdb CMakeLists.txt to force ARM64 CRC..."
      # Insert an unconditional HAS_ARMV8_CRC=TRUE right before the arm64 check
      sed -i '' '/CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|AARCH64"/,/endif(CMAKE_SYSTEM_PROCESSOR/ {
        /CHECK_C_COMPILER_FLAG.*armv8.*HAS_ARMV8_CRC/a\
\  # FORCE_ARM64_CRC: patched by knodel build script\
\  set(HAS_ARMV8_CRC TRUE)
      }' "$cmakelists"
      # Also ensure the CRC flags are set
      sed -i '' '/HAS_ARMV8_CRC/,/endif(HAS_ARMV8_CRC)/ {
        /set(CMAKE_C_FLAGS.*armv8/s/^/#ORIG /
        /set(CMAKE_CXX_FLAGS.*armv8/s/^/#ORIG /
      }' "$cmakelists"
      # Add the flags unconditionally after the HAS_ARMV8_CRC block
      sed -i '' '/endif(HAS_ARMV8_CRC)/a\
# Forced ARM64 CRC flags (patched by knodel)\
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=armv8-a+crc+crypto -Wno-unused-function")\
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=armv8-a+crc+crypto -Wno-unused-function")\
set(HAS_ARMV8_CRC TRUE)
' "$cmakelists"
      echo "  Patched: $cmakelists"
    fi
  done < <(find "$hunter_base" -path "*/rocksdb/Source/CMakeLists.txt" -type f -print0 2>/dev/null)
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

  local hunter_cleaned=false

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

    # Step 2: Patch Hunter config with local patched tarballs
    echo "  [2/4] Patching Hunter config with local patched tarballs..."
    if patch_hunter_config_with_tarballs "$build_dir"; then
      # Clean Hunter caches on first service only, so packages rebuild with patches
      if [ "$hunter_cleaned" = false ]; then
        echo "  Cleaning Hunter caches to force rebuild with patched sources..."
        clean_hunter_caches
        hunter_cleaned=true
      fi
    fi

    # Step 3: Reconfigure with patches applied (this triggers Hunter package builds)
    echo "  [3/4] Reconfiguring with patched tarballs (building Hunter packages)..."
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
