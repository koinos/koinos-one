# Unified RocksDB Zstd Validation - 2026-06-13

## Scope

This report covers the clean zstd dependency experiment for unified RocksDB storage.

The validation intentionally used:

- A separate RocksDB install prefix.
- A separate Teleno build directory.
- A disposable public-testnet observer basedir under `/private/tmp`.

No prodnet wallet files, prodnet configs, or prodnet RocksDB data were read or modified.

## Separate RocksDB Build

Installed prefix:

```text
/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1
```

Source tarball:

```text
/Volumes/external/teleno-build-cache/deps/hunter/_Base/Download/rocksdb/ef3e82eb750013c9fec5220911213609613776d7/ef3e82e/v8.8.1.tar.gz
```

Configuration:

```bash
cmake -S /private/tmp/teleno-rocksdb-zstd-build-20260613/rocksdb-8.8.1 \
  -B /private/tmp/teleno-rocksdb-zstd-build-20260613/build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1 \
  -DCMAKE_PREFIX_PATH=/opt/homebrew \
  -DWITH_ZSTD=ON \
  -Dzstd_LIBRARIES=/opt/homebrew/lib/libzstd.a \
  -Dzstd_INCLUDE_DIRS=/opt/homebrew/include \
  -DWITH_TESTS=OFF \
  -DWITH_GFLAGS=OFF \
  -DWITH_BENCHMARK_TOOLS=OFF \
  -DWITH_CORE_TOOLS=OFF \
  -DWITH_TOOLS=OFF \
  -DPORTABLE=ON \
  -DFAIL_ON_WARNINGS=OFF \
  -DROCKSDB_BUILD_SHARED=OFF
```

Build:

```bash
cmake --build /private/tmp/teleno-rocksdb-zstd-build-20260613/build \
  --target install --parallel 4
```

Result:

- `librocksdb.a` installed.
- CMake found zstd at `/opt/homebrew/lib/libzstd.a`.
- Linker emitted macOS deployment-target warnings because the Homebrew static `libzstd.a` objects were built for a newer macOS version than the current Teleno link target.

## Separate Teleno Build

Build directory:

```text
node/teleno-node/build-zstd
```

Important CMake cache values:

```text
RocksDB_DIR=/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1/lib/cmake/rocksdb
zstd_LIBRARIES=/opt/homebrew/lib/libzstd.a
zstd_INCLUDE_DIRS=/opt/homebrew/include
KOINOS_ENABLE_LIBP2P=ON
```

Build:

```bash
cmake --build node/teleno-node/build-zstd \
  --target teleno_node koinos_rocksdb_manager_test --parallel 4
```

Result:

- `node/teleno-node/build-zstd/src/teleno_node`: built
- `node/teleno-node/build-zstd/src/koinos_rocksdb_manager_test`: built

Runtime dependency check:

```bash
otool -L node/teleno-node/build-zstd/src/teleno_node
```

Relevant result:

```text
/opt/homebrew/opt/gmp/lib/libgmp.10.dylib
```

No dynamic `libzstd` or dynamic RocksDB dependency was reported.

## Build Workflow Promotion

The zstd path was promoted into the normal local build workflow:

- Added `scripts/build-rocksdb-zstd.sh`.
- Updated `scripts/build-cpp-libp2p-koinos.sh` to build or reuse a zstd-enabled RocksDB override by default.
- Added `TELENO_ROCKSDB_WITH_ZSTD=0` as an explicit opt-out for testing the old Hunter RocksDB path.
- Added `node/teleno-node/build-zstd/` to `.gitignore` for future isolated zstd experiments.

The default local build directory was reconfigured to the zstd RocksDB package:

```text
node/teleno-node/build
RocksDB_DIR=/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1/lib/cmake/rocksdb
zstd_LIBRARIES=/opt/homebrew/lib/libzstd.a
zstd_INCLUDE_DIRS=/opt/homebrew/include
KOINOS_ENABLE_LIBP2P=ON
```

Build:

```bash
cmake --build node/teleno-node/build \
  --target teleno_node koinos_rocksdb_manager_test --parallel 4
```

Result:

- `node/teleno-node/build/teleno_node`: built
- `node/teleno-node/build/koinos_rocksdb_manager_test`: built

At this stage, the link still emitted the known Homebrew deployment-target warnings for `/opt/homebrew/lib/libzstd.a`. This was a release-hardening issue, not a runtime codec issue. The local-zstd pass below resolves the zstd warning.

## Compression Gate

Command:

```bash
NODE_BIN=/Users/pgarcgo/code/koinos-one/node/teleno-node/build-zstd/src/teleno_node \
  scripts/check-rocksdb-compression.sh
```

Result: passed.

Key report rows:

```text
[db] RocksDB tuning: ... compression=zstd blocks_compression=zstd supported_compressions=none,zstd,zstd-not-final
compression.requested_default: zstd
compression.selected_default: zstd
compression.requested_blocks: zstd
compression.selected_blocks: zstd
compression.supported: none,zstd,zstd-not-final
```

The extra `zstd-not-final` entry is RocksDB's legacy `kZSTDNotFinalCompression` enum. Teleno now reports it by name instead of as raw value `64`.

## Default Build Compression Gate

After reconfiguring `node/teleno-node/build`, the default binary path also passed the strict compression gate.

Command:

```bash
scripts/check-rocksdb-compression.sh
```

Result: passed.

Key report rows:

```text
[db] RocksDB tuning: ... compression=zstd blocks_compression=zstd supported_compressions=none,zstd,zstd-not-final
compression.requested_default: zstd
compression.selected_default: zstd
compression.requested_blocks: zstd
compression.selected_blocks: zstd
compression.supported: none,zstd,zstd-not-final
```

Runtime dependency check:

```bash
otool -L node/teleno-node/build/teleno_node
```

Relevant result:

```text
/opt/homebrew/opt/gmp/lib/libgmp.10.dylib
```

No dynamic `libzstd` or dynamic RocksDB dependency was reported.

## No-Zstd Hunter Baseline Before Promotion

The original Hunter-backed build did not support zstd before the default dependency path was switched to the zstd-enabled RocksDB package.

Command:

```bash
scripts/check-rocksdb-compression.sh
```

Result:

```text
status=1
Fatal: RocksDB compression requirement failed: default: requested zstd, selected none because the requested codec is unsupported
```

This was expected before the normal dependency build was switched to a zstd-enabled RocksDB package.

## Public-Testnet Zstd Sync Sample

Initial DNS note:

- The system resolver could not resolve `testnet.koinosfoundation.org`.
- `dig` returned `37.27.41.35`.
- The observer run used the resolved IP multiaddr:

```text
/ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W
```

Command:

```bash
scripts/benchmark-monolith-sync.py \
  --bin /Users/pgarcgo/code/koinos-one/node/teleno-node/build-zstd/src/teleno_node \
  --duration-seconds 45 \
  --sample-interval-seconds 5 \
  --jsonrpc-port 28636 \
  --peer /ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W \
  --remote-rpc-url '' \
  --report-dir /private/tmp/teleno-zstd-sync-sample-ip-20260613
```

Result:

```text
status: pass
height_delta: 3367
last_height: 3367
average_blocks_per_second: 74.812
```

Log counters:

```text
handshake: 1
peer_connected: 1
sync: 7
warning: 0
error: 0
score_threshold: 0
checkpoint_mismatch: 0
block_application_failed: 0
```

Evidence:

```text
/private/tmp/teleno-zstd-sync-sample-ip-20260613/result.json
/private/tmp/teleno-zstd-sync-sample-ip-20260613/result.md
/private/tmp/teleno-zstd-sync-sample-ip-20260613/teleno_node.log
```

## Default Build Public-Testnet Smoke

After promoting the zstd package into `node/teleno-node/build`, a second public-testnet observer smoke used the default binary path.

Command:

```bash
scripts/benchmark-monolith-sync.py \
  --bin /Users/pgarcgo/code/koinos-one/node/teleno-node/build/teleno_node \
  --duration-seconds 30 \
  --sample-interval-seconds 5 \
  --jsonrpc-port 28638 \
  --peer /ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W \
  --remote-rpc-url '' \
  --report-dir /private/tmp/teleno-zstd-default-sync-20260613
```

Result:

```text
status: pass
height_delta: 2272
last_height: 2272
average_blocks_per_second: 75.708
```

Evidence:

```text
/private/tmp/teleno-zstd-default-sync-20260613/result.json
/private/tmp/teleno-zstd-default-sync-20260613/result.md
/private/tmp/teleno-zstd-default-sync-20260613/teleno_node.log
```

## Offline Compaction

Command:

```bash
node/teleno-node/build-zstd/src/teleno_node \
  --basedir /private/tmp/teleno-zstd-sync-sample-ip-20260613/basedir \
  --config /private/tmp/teleno-zstd-sync-sample-ip-20260613/basedir/config.yml \
  --compact-db --all --storage-report
```

Size result:

```text
before_kb=10864
after_kb=2540
```

This is a small live-sync sample and the before size was WAL-heavy, so it should not be treated as a full-node compression ratio. It does prove that offline flush-plus-compaction writes zstd-selected SST files and preserves readable testnet state.

Selected post-compaction report rows:

```text
compression.requested_default: zstd
compression.selected_default: zstd
compression.requested_blocks: zstd
compression.selected_blocks: zstd
compression.supported: none,zstd,zstd-not-final

blocks estimated_keys: 3371 total_sst_file_size: 1856504
block_meta estimated_keys: 1 total_sst_file_size: 1226
contract_meta estimated_keys: 9 total_sst_file_size: 1487
transaction_index estimated_keys: 15 total_sst_file_size: 168787
storage_metadata estimated_keys: 6 total_sst_file_size: 1258
```

## Post-Compaction Reopen Check

Started the compacted basedir with P2P disabled and queried local JSON-RPC.

Result:

```text
chain_height=3371
chain_id=0x1220039ecdc289a583e7954ea5e205da1bf915cf5b21bedbfabccc2e6d84ae253b22
block_store_height=3371
block_store_id=0x1220039ecdc289a583e7954ea5e205da1bf915cf5b21bedbfabccc2e6d84ae253b22
```

Log evidence:

```text
[db] RocksDB tuning: ... compression=zstd blocks_compression=zstd supported_compressions=none,zstd,zstd-not-final
[chain] Indexing complete
[node] teleno_node ready
[node] teleno_node shutdown complete
```

## Verification Commands

Passed:

```bash
ctest --test-dir node/teleno-node/build-zstd --output-on-failure -R 'koinos_rocksdb_manager_test'
cmake --build node/teleno-node/build --target teleno_node koinos_rocksdb_manager_test --parallel 4
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_rocksdb_manager_test'
npx vitest run src/app/koinos-config-schema.test.ts
bash -n scripts/build-rocksdb-zstd.sh
bash -n scripts/build-zstd-static.sh
bash -n scripts/build-cpp-libp2p-koinos.sh
```

## Remaining Dependency Work

The code path is validated, and the default local build now points at the zstd-enabled RocksDB package.

## Local Zstd Release-Hardening Pass

The Homebrew static zstd archive produced deployment-target warnings during the node link because the bottle was built for a newer macOS target. Teleno now builds a local static zstd package first and points RocksDB and the default node build at that local artifact.

Local zstd install:

```text
/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7
```

Source tarball:

```text
/Users/pgarcgo/Library/Caches/Homebrew/downloads/87f6a70b2d4762b0ebcdd4989e8547ac79aa0d5d6c24953a7a566389d9208bba--zstd-1.5.7.tar.gz
```

Pinned source checksum:

```text
37d7284556b20954e56e1ca85b80226768902e2edabd3b649e9e72c0c9012ee3
```

Build command:

```bash
KOINOS_DEPS_ROOT=/Volumes/external/teleno-build-cache/deps \
  ZSTD_FORCE_REBUILD=1 \
  JOBS=4 \
  scripts/build-zstd-static.sh
```

Result:

- `libzstd.a` installed under the local Teleno dependency cache.
- `otool -l` on the static archive reports `minos 13.3`.
- `scripts/build-rocksdb-zstd.sh` now uses the local static zstd package by default and records a zstd dependency fingerprint before reusing an installed RocksDB package.

RocksDB was force-rebuilt against the local zstd package:

```bash
KOINOS_DEPS_ROOT=/Volumes/external/teleno-build-cache/deps \
  HUNTER_ROOT=/Volumes/external/teleno-build-cache/deps/hunter \
  ROCKSDB_ZSTD_FORCE_REBUILD=1 \
  JOBS=4 \
  scripts/build-rocksdb-zstd.sh
```

Result:

- CMake found zstd at `/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7/lib/libzstd.a`.
- `otool -l` on `librocksdb.a` reports `minos 13.3`.
- The earlier Homebrew `libzstd.a` deployment-target warning did not appear.

The default local node build was reconfigured to:

```text
RocksDB_DIR=/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1/lib/cmake/rocksdb
zstd_LIBRARIES=/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7/lib/libzstd.a
zstd_INCLUDE_DIRS=/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7/include
```

Build result:

- `node/teleno-node/build/teleno_node`: built.
- `node/teleno-node/build/koinos_rocksdb_manager_test`: built.
- The prior zstd deployment-target link warning is gone.
- The only remaining deployment-target link warning is the separate pre-existing dynamic GMP dependency:

```text
ld: warning: dylib (/opt/homebrew/lib/libgmp.dylib) was built for newer macOS version (26.0) than being linked (13.3)
```

Runtime dependency check:

```bash
otool -L node/teleno-node/build/teleno_node
```

Relevant result:

```text
/opt/homebrew/opt/gmp/lib/libgmp.10.dylib
```

No dynamic `libzstd` or dynamic RocksDB dependency was reported.

## Local-Zstd Default Build Smoke

Command:

```bash
scripts/benchmark-monolith-sync.py \
  --bin /Users/pgarcgo/code/koinos-one/node/teleno-node/build/teleno_node \
  --duration-seconds 30 \
  --sample-interval-seconds 5 \
  --jsonrpc-port 28639 \
  --peer /ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W \
  --remote-rpc-url '' \
  --report-dir /private/tmp/teleno-zstd-localdep-sync-20260613
```

Result:

```text
status: pass
height_delta: 2279
last_height: 2279
average_blocks_per_second: 75.941
```

Log counters:

```text
handshake: 1
peer_connected: 1
sync: 5
warning: 0
error: 0
score_threshold: 0
checkpoint_mismatch: 0
block_application_failed: 0
```

Evidence:

```text
/private/tmp/teleno-zstd-localdep-sync-20260613/result.json
/private/tmp/teleno-zstd-localdep-sync-20260613/result.md
/private/tmp/teleno-zstd-localdep-sync-20260613/teleno_node.log
```

## Local GMP Release-Hardening Pass

The remaining native dependency warning after the local-zstd pass came from `secp256k1-vrf` exporting a Homebrew dynamic GMP link in its generated CMake package:

```text
/Volumes/external/teleno-build-cache/deps/hunter/_Base/a20151e/825f5b0/d63702f/Install/lib/cmake/libsecp256k1-vrf/libsecp256k1-vrfConfig.cmake
INTERFACE_LINK_LIBRARIES "/opt/homebrew/lib/libgmp.dylib"
```

Teleno now builds a pinned local static GMP package and overrides the imported `secp256k1-vrf::secp256k1-vrf` target's interface link library to the local archive during node configuration.

Local GMP install:

```text
/Volumes/external/teleno-build-cache/deps/gmp-static-6.3.0
```

Source tarball:

```text
/Users/pgarcgo/Library/Caches/Homebrew/downloads/e2aadf8cdae3c70b4d30df66e060f9ccbd275c2181760c3f98de07fc499bccf3--gmp-6.3.0.tar.xz
```

Pinned source checksum:

```text
a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898
```

Build command:

```bash
KOINOS_DEPS_ROOT=/Volumes/external/teleno-build-cache/deps \
  GMP_FORCE_REBUILD=1 \
  JOBS=4 \
  scripts/build-gmp-static.sh
```

Upstream GMP check command:

```bash
make -C /Volumes/external/teleno-build-cache/deps/gmp-static-build check -j4
```

Result:

- `libgmp.a` installed under the local Teleno dependency cache.
- `otool -l` on the static archive reports `minos 13.3`.
- GMP upstream `make check` passed.
- `scripts/build-cpp-libp2p-koinos.sh` now builds or reuses the pinned local static GMP artifact by default and passes `-DGMP_LIBRARY=<local libgmp.a>` to the node configure step.
- `node/teleno-node/src/CMakeLists.txt` now overrides `secp256k1-vrf::secp256k1-vrf` to remove the stale Homebrew dynamic GMP interface link.

The default local node build was reconfigured to:

```text
RocksDB_DIR=/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1/lib/cmake/rocksdb
zstd_LIBRARIES=/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7/lib/libzstd.a
zstd_INCLUDE_DIRS=/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7/include
GMP_LIBRARY=/Volumes/external/teleno-build-cache/deps/gmp-static-6.3.0/lib/libgmp.a
```

Build result:

- `node/teleno-node/build/teleno_node`: built.
- `node/teleno-node/build/koinos_rocksdb_manager_test`: built.
- The prior dynamic GMP deployment-target link warning is gone.

Runtime dependency check:

```bash
otool -L node/teleno-node/build/teleno_node | sort
```

Result:

```text
/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation
/usr/lib/libSystem.B.dylib
/usr/lib/libc++.1.dylib
/usr/lib/libresolv.9.dylib
```

No dynamic `libgmp`, `libzstd`, or RocksDB dependency was reported.

Final link-line check:

```bash
rg -n "/opt/homebrew/lib/libgmp.dylib|/opt/homebrew/opt/gmp|libgmp" \
  node/teleno-node/build/src/CMakeFiles/teleno_node.dir/link.txt
```

Result:

- No Homebrew GMP path found.
- The final link line includes `/Volumes/external/teleno-build-cache/deps/gmp-static-6.3.0/lib/libgmp.a`.

Validation commands:

```bash
bash -n scripts/build-gmp-static.sh
bash -n scripts/build-zstd-static.sh
bash -n scripts/build-rocksdb-zstd.sh
bash -n scripts/build-cpp-libp2p-koinos.sh
KOINOS_DEPS_ROOT=/Volumes/external/teleno-build-cache/deps \
  JOBS=4 \
  scripts/build-cpp-libp2p-koinos.sh
cmake --build node/teleno-node/build --target teleno_node koinos_rocksdb_manager_test --parallel 4
scripts/check-rocksdb-compression.sh
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_rocksdb_manager_test'
npx vitest run src/app/koinos-config-schema.test.ts
```

The normal build wrapper passed end to end with local zstd, local RocksDB, and local GMP. During this run, DNS for `github.com` was unavailable, so the wrapper reused the cached `cpp-libp2p` `v0.1.37` tag:

```text
cpp-libp2p fetch failed; reusing cached v0.1.37
-- teleno_node: GMP library: /Volumes/external/teleno-build-cache/deps/gmp-static-6.3.0/lib/libgmp.a
==> Done
teleno_node: /Users/pgarcgo/code/koinos-one/node/teleno-node/build/teleno_node
```

Public-testnet smoke:

```bash
scripts/benchmark-monolith-sync.py \
  --bin /Users/pgarcgo/code/koinos-one/node/teleno-node/build/teleno_node \
  --duration-seconds 30 \
  --sample-interval-seconds 5 \
  --jsonrpc-port 28640 \
  --peer /ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W \
  --remote-rpc-url '' \
  --report-dir /private/tmp/teleno-zstd-gmp-localdep-sync-20260613
```

Result:

```text
status: pass
height_delta: 2319
last_height: 2319
average_blocks_per_second: 77.274
```

Evidence:

```text
/private/tmp/teleno-zstd-gmp-localdep-sync-20260613/result.json
/private/tmp/teleno-zstd-gmp-localdep-sync-20260613/result.md
/private/tmp/teleno-zstd-gmp-localdep-sync-20260613/teleno_node.log
```

Wrapper-built public-testnet smoke:

```bash
scripts/benchmark-monolith-sync.py \
  --bin /Users/pgarcgo/code/koinos-one/node/teleno-node/build/teleno_node \
  --duration-seconds 30 \
  --sample-interval-seconds 5 \
  --jsonrpc-port 28641 \
  --peer /ip4/37.27.41.35/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W \
  --remote-rpc-url '' \
  --report-dir /private/tmp/teleno-zstd-gmp-wrapper-sync-20260613
```

Result:

```text
status: pass
height_delta: 2331
last_height: 2331
average_blocks_per_second: 77.674
```

Evidence:

```text
/private/tmp/teleno-zstd-gmp-wrapper-sync-20260613/result.json
/private/tmp/teleno-zstd-gmp-wrapper-sync-20260613/result.md
/private/tmp/teleno-zstd-gmp-wrapper-sync-20260613/teleno_node.log
```

## Current Remaining Dependency Work

The local native dependency hardening task is complete for the default local build path: RocksDB, zstd, and GMP are all linked as local static artifacts for the rebuilt `teleno_node` binary, and `otool -L` reports only system libraries.

## Active Public-Testnet Producer Compaction - 2026-06-13

After the active public-testnet producer basedir was migrated to unified storage, the producer was
stopped and the shared RocksDB was compacted offline with the zstd-enabled build.

Pre-compaction state:

```text
producer pid before stop: 72925
chain.get_head_info height before stop: 5768880
basedir: 10229884 KiB
db:      10222556 KiB
chain:       7256 KiB
```

Pre-compaction storage report:

```text
layout.chain_storage: unified
chain_state_db_exists: false
compression.selected_default: zstd
compression.selected_blocks: zstd
blocks total_sst_file_size: 10447640557
chain_state total_sst_file_size: 563645
chain_metadata total_sst_file_size: 6012
```

Compaction command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --compact-db --all
```

Result:

```text
Compacted all shared RocksDB column families
```

Post-compaction state:

```text
basedir:  3013376 KiB
db:       3006048 KiB
chain:       7256 KiB
```

Size change from the stopped pre-compaction active basedir:

```text
before: 10229884 KiB
after:   3013376 KiB
saved:   7216508 KiB
reduction: approximately 70.5%
```

Size change from the full pre-unified safety copy:

```text
pre-unified copy: 10397692 KiB
after compaction:  3013376 KiB
saved:             7384316 KiB
reduction: approximately 71.0%
```

Strict compression report after compaction:

```text
layout.chain_storage: unified
chain_state_db_exists: false
compression.selected_default: zstd
compression.selected_blocks: zstd
blocks total_sst_file_size: 3043294528
chain_state total_sst_file_size: 555414
chain_metadata total_sst_file_size: 1378
```

Post-compaction observer verification:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --disable p2p --disable block_producer --disable grpc
```

Startup evidence:

```text
[chain] State DB opened from shared RocksDB column families
Finished indexing 60 blocks, took 0.022002 seconds
[node] teleno_node ready
```

JSON-RPC verification:

```text
chain.get_head_info height: 5768883
chain.get_head_info id: 0x122036c2bf7c1cf3d05a1f04a838b70a2b55a8fe7f851278017069d747057df74d6d
chain.get_head_info lib: 5768823
block_store.get_highest_block height: 5768883
block_store.get_highest_block id: 0x122036c2bf7c1cf3d05a1f04a838b70a2b55a8fe7f851278017069d747057df74d6d
```

The verification observer was stopped cleanly after the check. No `teleno_node` process was left running.

Next dependency tasks:

1. Keep `scripts/check-rocksdb-compression.sh` as a package/release gate.
2. Run a longer public-testnet zstd soak before any prodnet migration guidance.
3. Re-run package staging verification with the cleaned binary before signed/notarized release packaging.
