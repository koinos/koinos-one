#!/usr/bin/env bash
# ============================================================================
# Setup Hunter Patches for macOS
# ============================================================================
# Patches Hunter 0.25.5 package sources to fix build issues on macOS with
# modern SDKs (Xcode 16+) and CMake 4.x.
#
# Run this ONCE before building C++ services for the first time.
# The patches are applied to ~/.hunter/ and persist across builds.
#
# Issues fixed:
#   1. ZLIB fdopen macro conflict: Hunter's ZLIB defines fdopen as NULL on
#      TARGET_OS_MAC, which conflicts with macOS SDK's fdopen declaration.
#
# Usage: ./scripts/mac-patches/setup-hunter-patches.sh
# ============================================================================

set -euo pipefail

HUNTER_BASE="${HUNTER_ROOT:-$HOME/.hunter}"
PATCHED=0

echo "============================================================================"
echo "Hunter macOS Patch Setup"
echo "  Hunter base: $HUNTER_BASE"
echo "============================================================================"

# --- Patch ZLIB zutil.h: remove fdopen macro on TARGET_OS_MAC ---
# The old ZLIB in Hunter defines:
#   #define fdopen(fd,mode) NULL /* No fdopen() */
# when TARGET_OS_MAC is set (which modern Xcode always sets).
# This conflicts with the macOS SDK's function declaration of fdopen().

echo ""
echo "=== Patching ZLIB sources ==="

find "$HUNTER_BASE" -path "*/Build/ZLIB/Source/zutil.h" -type f 2>/dev/null | while read -r zutil_file; do
  if grep -q '#        define fdopen(fd,mode) NULL' "$zutil_file" 2>/dev/null; then
    echo "  Patching: $zutil_file"
    # Comment out the problematic fdopen macro
    sed -i '' 's/#        define fdopen(fd,mode) NULL \/\* No fdopen() \*\//#        \/\/ define fdopen(fd,mode) NULL \/\* Patched: fdopen exists on modern macOS \*\//' "$zutil_file"
    ((PATCHED++)) || true
  else
    echo "  Already patched or not applicable: $zutil_file"
  fi
done

if [ "$PATCHED" -eq 0 ]; then
  echo "  No ZLIB sources found to patch."
  echo "  Run a C++ cmake configure first to trigger Hunter downloads, then re-run this script."
  echo ""
  echo "  Example:"
  echo "    cd vendor/koinos/koinos-chain"
  echo "    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release"
  echo "    # (it will fail — that's expected)"
  echo "    ./scripts/mac-patches/setup-hunter-patches.sh"
  echo "    # Now retry the build"
fi

echo ""
echo "============================================================================"
echo "Patches applied: $PATCHED"
echo "============================================================================"
