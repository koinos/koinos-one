# macOS ARM64 (Apple Silicon) toolchain for Hunter
# This toolchain ensures all Hunter sub-projects build for arm64

set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "Build for Apple Silicon")
set(CMAKE_APPLE_SILICON_PROCESSOR "arm64" CACHE STRING "Apple Silicon processor")
set(CMAKE_SYSTEM_PROCESSOR "arm64" CACHE STRING "Target processor")

# Force Homebrew ARM64 GMP — prevents picking up x86_64 /usr/local/lib/libgmp.dylib.
# find_library(GMP_LIBRARY) skips search when variable is already in cache.
if(EXISTS "/opt/homebrew/lib/libgmp.dylib")
  set(GMP_LIBRARY "/opt/homebrew/lib/libgmp.dylib" CACHE PATH "GMP library (ARM64)" FORCE)
  set(GMP_INCLUDE_DIR "/opt/homebrew/include" CACHE PATH "GMP include dir (ARM64)" FORCE)
  set(GMP_FOUND TRUE CACHE BOOL "GMP found" FORCE)
endif()
