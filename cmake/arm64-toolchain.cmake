# macOS ARM64 (Apple Silicon) toolchain for Hunter
# This toolchain ensures all Hunter sub-projects build for arm64

set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "Build for Apple Silicon")
set(CMAKE_APPLE_SILICON_PROCESSOR "arm64" CACHE STRING "Apple Silicon processor")
set(CMAKE_SYSTEM_PROCESSOR "arm64" CACHE STRING "Target processor")
