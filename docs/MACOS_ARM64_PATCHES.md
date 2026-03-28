# macOS ARM64 Native Build — Patch Strategy

This document describes every patch applied to get koinos-chain (and its Hunter-managed
C++ dependencies) to compile natively on Apple Silicon (arm64) under macOS 15+ /
Xcode 16+ (including the Xcode 26 beta with libc++ 26).

---

## Background

Knodel builds the koinos blockchain node services (chain, p2p, …) from source using
the [Hunter](https://github.com/cpp-pm/hunter) CMake package manager.  Hunter pins
every dependency to a specific commit/tarball and caches the build products in
`~/.hunter/_Base/<hunter-sha>/<toolchain-sha>/<config-sha>/`.

Two factors make macOS ARM64 builds non-trivial:

1. **Hunter's config SHA** — `Hunter/config.cmake` content is hashed to produce the
   config-sha path component.  ANY change to that file invalidates ALL cached packages
   and forces a full rebuild of Boost, Protobuf, RocksDB, etc. (~40 min).  That is
   why we cannot just add `-Wno-deprecated-declarations` to fizzy's `CMAKE_ARGS`.

2. **Xcode 26 / libc++ 26** — Apple's beta toolchain promotes several deprecation
   warnings to hard errors.  The most impactful is `char_traits<unsigned char>` which
   breaks fizzy.

---

## Upstream Forks & Pull Requests

All patches are carried in lightweight forks and have been submitted as upstream PRs.
The table below is the single source of truth.

| Package | Issue | Fork branch | Upstream PR | Status |
|---------|-------|-------------|-------------|--------|
| `fizzy` | `char_traits<uint8_t>` deprecated (Xcode 26 hard error) | [pgarciagon/fizzy@fix/macos-libcxx26-char-traits](https://github.com/pgarciagon/fizzy/tree/fix/macos-libcxx26-char-traits) | [koinos/fizzy#4](https://github.com/koinos/fizzy/pull/4) | Open |
| `ZLIB` | `fdopen()` NULL macro conflicts with macOS `stdio.h` | [pgarciagon/zlib@fix/macos-fdopen-conflict](https://github.com/pgarciagon/zlib/tree/fix/macos-fdopen-conflict) | [cpp-pm/zlib#3](https://github.com/cpp-pm/zlib/pull/3) | Open |
| `koinos-cmake` | Hunter config wiring all ARM64 fixes together | [pgarciagon/koinos-cmake@fix/macos-arm64](https://github.com/pgarciagon/koinos-cmake/tree/fix/macos-arm64) | [koinos/koinos-cmake#18](https://github.com/koinos/koinos-cmake/pull/18) | Open |

---

## Patch Details

### 1. fizzy — `char_traits<uint8_t>` deprecation

**File:** `lib/fizzy/bytes.hpp`

**Root cause:** `std::basic_string<uint8_t>` and `std::basic_string_view<uint8_t>`
require `std::char_traits<unsigned char>`.  LLVM libc++ 16 deprecated that
specialisation; Xcode 26 makes it a hard error (`-Werror,-Wdeprecated-declarations`).

**Fix:** Wrap the two `using` declarations in `#pragma clang diagnostic` guards:

```cpp
// BEFORE
namespace fizzy {
using bytes      = std::basic_string<uint8_t>;
using bytes_view = std::basic_string_view<uint8_t>;
}

// AFTER
#if defined(__clang__)
#  pragma clang diagnostic push
#  pragma clang diagnostic ignored "-Wdeprecated-declarations"
#endif
namespace fizzy {
using bytes      = std::basic_string<uint8_t>;
using bytes_view = std::basic_string_view<uint8_t>;
}
#if defined(__clang__)
#  pragma clang diagnostic pop
#endif
```

**Why not a CMake flag?** Adding `-Wno-deprecated-declarations` to fizzy's
`hunter_config(fizzy CMAKE_ARGS …)` would change the Hunter config SHA and
invalidate every other cached package.

**Tarball reference** (used in `Hunter/config.cmake`):
- Commit: `7cdd7350f3a524bbbf1a5793212e8b8f102e3ec7`
- SHA1: `b8a7e09a54a94cc55b584c5db9a7efc6bd433acf`

---

### 2. ZLIB — `fdopen()` macro conflict

**File:** `zutil.h`

**Root cause:** The original guard is:

```c
#if (defined(MACOS) || defined(TARGET_OS_MAC)) && !defined(__APPLE__)
//  ↑ original did NOT have the !defined(__APPLE__) part
#  define fdopen(fd,mode) NULL
#endif
```

`TARGET_OS_MAC` is always `1` on Apple platforms (set by `<TargetConditionals.h>`).
macOS ships a real `fdopen()` in `<stdio.h>`.  Without the `!defined(__APPLE__)`
guard the macro replaces every call to `fdopen()` with `NULL`, causing:

```
error: expected expression
    NULL (fd, type)
```

**Fix:** Add `&& !defined(__APPLE__)` so the macro only fires on ancient non-Apple
`TARGET_OS_MAC` builds (Carbon era):

```c
#if (defined(MACOS) || defined(TARGET_OS_MAC)) && !defined(__APPLE__)
#  define fdopen(fd,mode) NULL
#endif
```

**Tarball reference:**
- Commit: `600934d9020e2822aad40ddd05b775e73585e952`
- SHA1: `d3587b03fecfa49813fe59019d5797577137896d`

---

### 3. rocksdb — ARM CRC hardware path

**In:** `Hunter/config.cmake` — `hunter_config(rocksdb …)`

**Root cause:** `PORTABLE=ON` tells rocksdb to produce a portable binary.  When a
CMake toolchain file (`arm64-toolchain.cmake`) is active, rocksdb's CRC
auto-detection `try_compile` step may not correctly identify ARM CRC hardware
support.  Without the march flag rocksdb falls back to a software crc32c
implementation and may fail to compile SSE-guarded intrinsics.

**Fix:**
```cmake
CMAKE_CXX_FLAGS=-fvisibility=hidden -march=armv8-a+crc+crypto -Wno-unused-function
CMAKE_C_FLAGS=-fvisibility=hidden -march=armv8-a+crc+crypto -Wno-unused-function
```

No separate fork needed — this is a pure Hunter config change.

---

### 4. libsecp256k1-vrf — Homebrew GMP path

**In:** `Hunter/config.cmake` — `hunter_config(libsecp256k1-vrf …)`

**Root cause:** `FindGMP.cmake` only searches `/usr/local/lib` and `/usr/local/include`.
On Apple Silicon, Homebrew installs everything under `/opt/homebrew`.  Configure
fails with "GMP not found" even when `brew install gmp` has been run.

**Fix:**
```cmake
CMAKE_ARGS
   GMP_LIBRARY=/opt/homebrew/lib/libgmp.dylib
   GMP_INCLUDE_DIR=/opt/homebrew/include
```

Prerequisite: `brew install gmp` must be run before building.

---

### 5. abseil — SSE flag injection (build-script level)

**In:** `scripts/mac-patches/patch-abseil-arm64.sh` + `scripts/build-native-mac.sh`

**Root cause:** abseil's `GENERATED_AbseilCopts.cmake` unconditionally lists
`-maes` and `-msse4.1` in its copts.  On ARM64 those flags cause immediate
compilation errors.

**Fix:** The build script runs `patch-abseil-arm64.sh` after Hunter extracts the
abseil source but before compilation.  The script comments out the two offending
lines in `GENERATED_AbseilCopts.cmake` using a sentinel comment
(`# PATCH_ABSEIL_ARM64`) so it is idempotent.

This fix lives entirely in the Knodel build system (no upstream fork needed) because
the flag detection is controlled by a CMake option that is not accessible via
`hunter_config CMAKE_ARGS` without changing the config SHA.

---

### 6. arm64-toolchain.cmake — GMP hint for sub-builds

**File:** `cmake/arm64-toolchain.cmake`

Sets `GMP_LIBRARY`, `GMP_INCLUDE_DIR`, and `GMP_FOUND` cache variables pointing at
Homebrew ARM64 paths.  These are inherited by all CMake sub-builds that Hunter
drives via `ExternalProject`, so every package that calls `find_package(GMP)` finds
the correct library automatically.

---

## How the Knodel Build Script Uses These Patches

`scripts/build-native-mac.sh` orchestrates the full native build:

1. **Step 1** — Runs cmake with `|| true` (ignores failure) to trigger FetchContent
   of `koinos-cmake` and Hunter's initial package extraction.
2. **Step 2a** — Calls `patch-hunter-config.py` to rewrite the active
   `Hunter/config.cmake` with the forked ZLIB/abseil/koinos_exception tarballs.
3. **Step 2b** — Calls `patch-abseil-arm64.sh` on the extracted abseil source to
   strip x86 SSE copts.
4. **Step 2c** — Calls `patch_fizzy_for_modern_libcxx()` which:
   - Locates `~/.hunter/.../Build/fizzy/Source/lib/fizzy/bytes.hpp`
   - Applies the clang pragma fix if not already patched
   - Builds fizzy with `make -j<ncpu>`
   - Stamps `fizzy-Release-build`, `fizzy-Release-install`, and `Build/fizzy/DONE`
     so Hunter skips fizzy entirely on subsequent cmake runs
5. **Step 3** — Runs the full cmake + make for koinos-chain.

---

## When Upstream PRs Are Merged

Once the upstream PRs land:

| PR merged | Action |
|-----------|--------|
| koinos/fizzy#4 | Revert `fizzy` entry in `Hunter/config.cmake` to canonical koinos/fizzy URL + new SHA1; remove `patch_fizzy_for_modern_libcxx()` from build script |
| cpp-pm/zlib#3 | Revert `ZLIB` entry to `VERSION ${HUNTER_ZLIB_VERSION}`; remove ZLIB patching from `patch-hunter-config.py` |
| koinos/koinos-cmake#18 | Update Knodel to track the new koinos-cmake tag; remove local `Hunter/config.cmake` patching entirely |

---

## Quick Reference — Fork Commit SHAs

```
fizzy    7cdd7350f3a524bbbf1a5793212e8b8f102e3ec7  SHA1=b8a7e09a54a94cc55b584c5db9a7efc6bd433acf
zlib     600934d9020e2822aad40ddd05b775e73585e952  SHA1=d3587b03fecfa49813fe59019d5797577137896d
```
