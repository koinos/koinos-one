#!/usr/bin/env bash
# Patches abseil GENERATED_AbseilCopts.cmake to remove x86 SSE flags
# that cause build failures on ARM64 due to CMake flag deduplication.
# Called as PATCH_COMMAND by Hunter's ExternalProject.
SOURCE_DIR="${1:-.}"
COPTS="$SOURCE_DIR/absl/copts/GENERATED_AbseilCopts.cmake"
if [ -f "$COPTS" ] && ! grep -q 'PATCH_ABSEIL_ARM64' "$COPTS" 2>/dev/null; then
  sed -i '' 's|    "-maes"|    # "-maes" # PATCH_ABSEIL_ARM64|' "$COPTS"
  sed -i '' 's|    "-msse4.1"|    # "-msse4.1" # PATCH_ABSEIL_ARM64|' "$COPTS"
fi
exit 0
