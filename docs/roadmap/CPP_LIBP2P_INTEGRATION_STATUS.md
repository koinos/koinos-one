# cpp-libp2p Integration Status

**Date:** 2026-04-09  
**Branch:** `feat/monolithic-node-migration`  
**cpp-libp2p source:** `~/code/cpp-libp2p` (branch `koinos-compat`, based on tag `v0.1.37`)

---

## What Works

### cpp-libp2p compiles standalone ✅
- Cloned `v0.1.37` to `~/code/cpp-libp2p`
- Built with its own Hunter deps using env var workaround for cmake 4.x:
  ```bash
  CMAKE_POLICY_VERSION_MINIMUM=3.5 cmake -B build -S . \
    -DTESTING=OFF -DEXAMPLES=OFF -DCLANG_FORMAT=OFF -DMETRICS_ENABLED=OFF \
    -DHUNTER_ROOT=/Volumes/external/.hunter \
    -DCMAKE_INSTALL_PREFIX=./install -DCMAKE_BUILD_TYPE=Release
  cmake --build build --parallel && cmake --install build
  ```
- 96 static libraries installed to `~/code/cpp-libp2p/install/`
- Hunter cache at `/Volumes/external/.hunter/_Base/15ca502/...`

### koinos-node transport code compiles ✅
- Fixed `libp2p_transport.hpp` and `.cpp` to match v0.1.37 API:
  - `gossip::TopicSubscription` → `protocol::Subscription` (RAII, stored in `std::optional`)
  - `GossipImpl` constructor → `gossip::create()` factory function
  - Removed `gossip/impl/gossip_impl.hpp` include
  - `setProtocolHandler` callback: `StreamAndProtocol` not `StreamResult`
  - `publish()`: `TopicId` (string) not `TopicSet`, `Bytes` not vector
  - All stream I/O is async (callback-based) — wrapped with `std::promise` for sync RPC
  - `PeerInfo` is a struct `{id, addresses}`, no `PeerInfo::create()`
  - `ByteArray` doesn't exist — use `libp2p::Bytes` (`vector<uint8_t>`)
- CMake target names: `p2p::p2p_default_host`, `p2p::p2p_gossip`, etc. (not `libp2p::p2p`)
- Added `find_package(libsecp256k1)` before `find_package(libp2p)` (missing from libp2pConfig.cmake)

### boost_random for 1.83 ✅
- Built from source (`random_device.cpp` only) and installed to koinos-node Hunter prefix
- cmake config files created at:
  `/Volumes/external/.hunter/_Base/a20151e/caf7adb/26936b6/Install/lib/cmake/boost_random-1.83.0/`
- Standalone CMakeLists.txt updated to include `random` in Boost components

---

## What Blocks Linking (the ABI conflicts)

### Dependency version matrix

| Dependency | koinos-node (Hunter a20151e) | cpp-libp2p (Hunter 15ca502) | Compatible? |
|---|---|---|---|
| Boost | 1.83.0 | 1.87.0 | ⚠️ Header-mostly, ABI breaks possible |
| Protobuf | 3.17.3 (koinos fork) | 3.19.4-p0 | ❌ ABI-breaking internal methods |
| OpenSSL | OpenSSL 3.0.12 | BoringSSL | ❌ Different API surface |

### Protobuf ABI break (3.17.3 → 3.19.4)
Missing symbols when linking:
- `google::protobuf::internal::RepeatedPtrFieldBase::DestroyProtos()`
- `google::protobuf::Message::MaybeComputeUnknownFieldsSize()`
- Several other internal methods added in 3.19

### OpenSSL vs BoringSSL
- **lsquic** (QUIC transport) uses `EVP_AEAD_*` — BoringSSL-only
- **chachapoly_impl.cpp** uses `EVP_AEAD_*`, `bssl::ScopedEVP_AEAD_CTX` — BoringSSL-only
- **gRPC** (koinos-node) uses `SSL_ctrl`, `SSL_get1_peer_certificate` — standard OpenSSL-only
- Cannot link both BoringSSL and OpenSSL in same binary

---

## In-Progress Fix: Rebuild cpp-libp2p Against koinos-node's Deps

### Branch: `koinos-compat` in `~/code/cpp-libp2p`

### Patches applied so far:

1. **`cmake/Hunter/config.cmake`** — Pinned Protobuf to koinos fork:
   ```cmake
   hunter_config(Protobuf
       URL  "https://github.com/koinos/protobuf/archive/e1b1477875a8b022903b548eb144f2c7bf4d9561.tar.gz"
       SHA1 "5796707a98eec15ffb3ad86ff50e8eec5fa65e68"
       CMAKE_ARGS
         CMAKE_OSX_ARCHITECTURES=arm64
         CMAKE_CXX_FLAGS=-fvisibility=hidden
         CMAKE_C_FLAGS=-fvisibility=hidden
   )
   ```

2. **`cmake/dependencies.cmake`** — Replaced `BoringSSL` with standard `OpenSSL`, removed `lsquic`

3. **`src/transport/CMakeLists.txt`** — Commented out `add_subdirectory(quic)`

4. **`src/network/CMakeLists.txt`** — Removed `p2p_quic` from `p2p_default_network` link list

5. **`src/crypto/chachapoly/chachapoly_impl.cpp`** — Rewritten to use standard OpenSSL 3.x EVP API:
   - `EVP_chacha20_poly1305()` instead of `EVP_aead_chacha20_poly1305()`
   - `EVP_EncryptInit_ex`/`EVP_DecryptInit_ex` instead of `EVP_AEAD_CTX_seal`/`open`
   - `EVP_CTRL_AEAD_GET_TAG`/`SET_TAG` for authentication tag handling
   - Removed `bssl::ScopedEVP_AEAD_CTX`, using manual `EVP_CIPHER_CTX_new`/`free`

6. **`include/libp2p/crypto/chachapoly/chachapoly_impl.hpp`** — Removed `EVP_AEAD_CTX*` and `EVP_AEAD*` members

### Remaining work to complete the rebuild:

1. **Check OpenSSL availability in qdrvm Hunter** — The qdrvm Hunter (0.25.3-qdrvm36) may not have standard OpenSSL 3.0.12. Options:
   - Add `hunter_config(OpenSSL ...)` pointing to the same OpenSSL source that koinos uses
   - Or use the koinos Hunter (0.25.5) instead of qdrvm — but cpp-libp2p's other deps (soralog, qtils, etc.) may not be registered there
   - Or use `PACKAGE_MANAGER=vcpkg` mode and provide all deps via `CMAKE_PREFIX_PATH`

2. **Rebuild cpp-libp2p** with these patches:
   ```bash
   cd ~/code/cpp-libp2p
   rm -rf build
   CMAKE_POLICY_VERSION_MINIMUM=3.5 cmake -B build -S . \
     -DTESTING=OFF -DEXAMPLES=OFF -DCLANG_FORMAT=OFF -DMETRICS_ENABLED=OFF \
     -DHUNTER_ROOT=/Volumes/external/.hunter \
     -DCMAKE_INSTALL_PREFIX=./install -DCMAKE_BUILD_TYPE=Release
   cmake --build build --parallel && cmake --install build
   ```

3. **Rebuild koinos-node** with the new cpp-libp2p:
   ```bash
   cd vendor/koinos/koinos-node
   rm -rf build
   CMAKE_POLICY_VERSION_MINIMUM=3.5 cmake -S . -B build \
     -DCMAKE_BUILD_TYPE=Release \
     -DCMAKE_PREFIX_PATH="<hunter-a20151e-install>;<new-libp2p-install>;<new-libp2p-hunter-install>;/opt/homebrew" \
     -DKOINOS_ENABLE_LIBP2P=ON -Wno-dev
   cmake --build build --parallel
   ```

4. **Potential additional issues:**
   - Boost 1.83 vs 1.87 — if rebuilt cpp-libp2p's Hunter still pulls 1.87, there may be header/ABI issues. May need to also pin Boost version in Hunter config.
   - The `default_network.cpp` includes all transports at injector level — removing QUIC may require patching the injector or `network_injector.hpp` if it hard-codes QUIC.
   - The `libp2pConfig.cmake` generated by the new build will list `lsquic` as a `find_dependency` — need to verify the install step doesn't include it, or patch the config template.

### Alternative approach: bypass Hunter entirely
Instead of fighting Hunter version overrides, build cpp-libp2p in `PACKAGE_MANAGER=vcpkg` mode (which just uses `find_package` for everything) with `CMAKE_PREFIX_PATH` pointing at:
1. koinos-node's Hunter install (for Protobuf, OpenSSL, Boost, ZLIB, c-ares)
2. cpp-libp2p's Hunter install (for soralog, tsl_hat_trie, Boost.DI, fmt, yaml-cpp, libsecp256k1, qtils)

This avoids rebuilding any Hunter packages and uses existing ones directly.

---

## Files Modified in koinos-node

### `vendor/koinos/koinos-node/src/CMakeLists.txt`
- libp2p block: uses `find_package(libsecp256k1)` + `find_package(libp2p)` + correct `p2p::` targets
- Links: `p2p::p2p_default_host`, `p2p::p2p_default_network`, `p2p::p2p_gossip`, `p2p::p2p_kademlia`, `p2p::p2p_noise`, `p2p::p2p_yamux`, `p2p::p2p_peer_id`, `p2p::p2p_multiaddress`, `p2p::p2p_identify`

### `vendor/koinos/koinos-node/CMakeLists.standalone.txt`
- Added `random` to Boost components list

### `vendor/koinos/koinos-node/src/p2p/libp2p_transport.hpp`
- Fixed to match v0.1.37 API (see "What Works" section above)

### `vendor/koinos/koinos-node/src/p2p/libp2p_transport.cpp`
- Full rewrite against actual v0.1.37 async API

---

## Environment

- **Xcode:** Command Line Tools only (no Xcode IDE)
- **Clang:** Apple clang 14.0.3 (clang-1403.0.22.14.1), arm64-apple-darwin25.2.0
- **CMake:** 4.2.3 (requires `CMAKE_POLICY_VERSION_MINIMUM=3.5` env var for Hunter compat)
- **Hunter root:** `/Volumes/external/.hunter/`
- **koinos-node Hunter hash:** `a20151e/caf7adb/26936b6`
- **cpp-libp2p Hunter hash:** `15ca502/b7ec3c0/00f4bd3`
