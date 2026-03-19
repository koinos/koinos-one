# Windows MSVC Build Patches

These files are applied automatically by `build-native-win.bat` to make the Koinos C++ services compile with MSVC on Windows.

## Files

### `KoinosCompilerOptions.cmake`
Replaces the FetchContent-downloaded `KoinosCompilerOptions.cmake` in each service's `build-win/_deps/koinos_cmake-src/`.

Changes from upstream:
- `if (MSVC)` → `if (MSVC OR CMAKE_HOST_WIN32)` — MSVC variable is not set before `project()` with Ninja generator
- `/W4 /WX` → `/W3` — disable warnings-as-errors for MSVC (upstream code has harmless GCC-style warnings)
- Added `-DNOMINMAX -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601` for Windows API compat
- Added `-DBOOST_ALL_NO_LIB` to disable Boost auto-linking (cmake handles library linking)
- Force-includes `msvc_compat.h` instead of bare `winsock2.h`

### `msvc_compat.h`
Force-included header that:
1. Includes `winsock2.h` and `windows.h` in the correct order
2. Undefines Windows macros (`GetMessage`, `SendMessage`, etc.) that conflict with protobuf method names

## Hunter Patches (applied manually once)

The following patches were applied to Hunter v0.25.5 at `~/.hunter/_Base/Download/Hunter/0.25.5/a20151e/Unpacked/`:

### `cmake/modules/hunter_setup_msvc.cmake`
- Line 69: MSVC version regex widened from `19[012][0-9]` to `19[0-9][0-9]` to accept MSVC 19.44

### `cmake/projects/Boost/schemes/url_sha1_boost_library.cmake.in`
- Fixed `b2_cmd` from `b2` to `.\b2` (Windows needs explicit relative path)
- Fixed `bootstrap_cmd` to use `cmake -E chdir` with full working directory
- Added `<rewrite-setup-scripts>off` to b2 properties (fixes msvc-setup.nup creation failure)
- Fixed toolset_version detection for MSVC 19.44

### `cmake/projects/Boost/schemes/url_sha1_boost.cmake.in`
- Fixed bootstrap_cmd to use `.\bootstrap.bat` instead of bare `bootstrap.bat`
- Fixed install_cmd to use `.\b2` with proper path resolution

### `cmake/projects/Boost/scripts/patched_boostrap.bat.in`
- Added vswhere.exe PATH for MSVC detection
- Added current working directory to PATH for b2 discovery

### `cmake/schemes/patch_secp256k1.cmake`
Central patch file for fizzy and libsecp256k1-vrf MSVC compatibility:
- **libsecp256k1-vrf**: 32-bit scalar/field fallback (no `__int128` on MSVC)
- **fizzy**: Removed GCC-only flags (`-Wcast-qual`, `-msse2`, etc.)
- **fizzy execute.cpp/parser.hpp/parser_expr.cpp**: `__builtin_memcpy` → `std::memcpy`
- **fizzy execute.cpp**: Removed `__attribute__((no_sanitize(...)))`
- **fizzy parser.cpp**: MSVC STL `string_view::iterator` ≠ raw pointer — use `.data()` instead
- **fizzy cxx20/bit.hpp**: Full rewrite with MSVC intrinsics (`_BitScanForward64`, `__popcnt64`, etc.)

### `~/.hunter/_Base/a20151e/4ca0be2/d63702f/cache.cmake`
Hunter cache file additions:
- `set(MSVC ON)` — force MSVC detection in packages included before `project()`
- `set(MSVC_VERSION 1944)` — MSVC version for pre-project() detection
- `CMAKE_CXX_COMPILER` / `CMAKE_C_COMPILER` → `clang-cl.exe` for Hunter-built koinos packages
- `FETCHCONTENT_SOURCE_DIR_KOINOS_CMAKE` → patched local koinos_cmake copy

## Source Code Patches (applied to submodule working trees)

These changes are needed in the koinos service source code for MSVC compatibility:

### koinos-chain
- `src/koinos/chain/thunk_dispatcher.hpp`: Replaced explicit variadic template specialization with `if constexpr(sizeof...(Ts) == 0)` (MSVC C2912)
- `src/koinos/chain/rectify.cpp`: Split 110KB base64 string literal into 15KB chunks (MSVC C2026: 16380 char limit)
- `tests/controller_test.cpp`, `tests/stack_test.cpp`, `tests/thunk_test.cpp`: Same string literal splitting
- `src/koinos_chain.cpp`: `YAML::LoadFile(yaml_config)` → `YAML::LoadFile(yaml_config.string())` (filesystem::path conversion)

### koinos-mempool, koinos-grpc, koinos-block-producer, koinos-account-history
- Main `.cpp` file in each: `YAML::LoadFile(yaml_config)` → `YAML::LoadFile(yaml_config.string())`
