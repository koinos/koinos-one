# Unified RocksDB Compression Validation - 2026-06-11

## Scope

This report covers the compression implementation slice after unified chain-state migration:

- Add a shared RocksDB compression setting.
- Keep a blocks-column-family compression override.
- Add an exact-compression release gate.
- Add offline RocksDB compaction commands.
- Validate command behavior against generated public-testnet data only.

No prodnet wallet files, prodnet configs, or prodnet RocksDB data were read or modified.

## Implementation Result

Implemented:

- `rocksdb.compression`
- `rocksdb.blocks-compression`
- `rocksdb.require-compression`
- `--require-rocksdb-compression`
- `--compact-db --compact-cf <column-family>`
- `--compact-db --all`
- Compression status in `--storage-report`
- `scripts/check-rocksdb-compression.sh`

Compression selection now applies as follows:

```text
rocksdb.compression          -> default for shared DB column families
rocksdb.blocks-compression   -> optional override for blocks
```

If `rocksdb.require-compression` or `--require-rocksdb-compression` is enabled, the node refuses to open unless the configured codec is exactly supported by the linked RocksDB library.

## Current Dependency State

The active build consumes a prebuilt Hunter RocksDB package:

```text
RocksDB_DIR=/Volumes/external/teleno-build-cache/deps/hunter/_Base/a20151e/825f5b0/d63702f/Install/lib/cmake/rocksdb
```

The current Hunter RocksDB build metadata does not include `WITH_ZSTD=ON`:

```text
WITH_TESTS=OFF
WITH_GFLAGS=OFF
WITH_BENCHMARK_TOOLS=OFF
WITH_CORE_TOOLS=OFF
WITH_TOOLS=OFF
PORTABLE=ON
FAIL_ON_WARNINGS=OFF
ROCKSDB_BUILD_SHARED=OFF
```

Local `libzstd` is installed under `/opt/homebrew` and `/usr/local`, but the linked RocksDB static library is not built with zstd enabled.

## Build And Unit Gates

Build:

```bash
cmake --build node/teleno-node/build --target teleno_node koinos_rocksdb_manager_test --parallel
```

Focused CTest:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure \
  -R 'koinos_(rocksdb_manager|block_producer|config|service_registry)_test'
```

UX schema test:

```bash
npx vitest run src/app/koinos-config-schema.test.ts
```

Result:

- `koinos_config_test`: passed
- `koinos_service_registry_test`: passed
- `koinos_rocksdb_manager_test`: passed
- `koinos_block_producer_test`: passed
- `src/app/koinos-config-schema.test.ts`: passed

## Compression Gate Validation

Command:

```bash
scripts/check-rocksdb-compression.sh
```

Current result:

```text
compression_gate_status=1
Fatal: RocksDB compression requirement failed: default: requested zstd, selected none because the requested codec is unsupported
```

This is the correct result for the current dependency package. The same gate must pass after the RocksDB package is rebuilt or replaced with zstd support.

## Testnet Storage Report

Generated public-testnet sample basedir:

```text
/private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir
```

Storage report compression rows:

```text
compression.requested_default: zstd
compression.selected_default: none
compression.requested_blocks: zstd
compression.selected_blocks: none
compression.supported: none
compression.fallback: default: requested zstd, selected none because the requested codec is unsupported; blocks: requested zstd, selected none because the requested codec is unsupported
```

## Offline Compaction Validation

Command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir \
  --config /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/config.yml \
  --compact-db --all --storage-report
```

Result:

```text
Compacted all shared RocksDB column families
before_kb=8612
after_kb=8164
```

The size reduction is normal compaction/tombstone cleanup, not zstd compression, because the current linked RocksDB library supports only `none`.

Selected post-compaction report rows:

```text
blocks estimated_keys=1210 total_sst_file_size=5132509 estimated_live_data_size=5132509
chain_state estimated_keys=79 total_sst_file_size=598002 estimated_live_data_size=598002
chain_metadata estimated_keys=5 total_sst_file_size=1406 estimated_live_data_size=1406
storage_metadata estimated_keys=17 total_sst_file_size=2255 estimated_live_data_size=2255
```

## Post-Compaction Observer Check

Started the compacted generated-testnet basedir as an observer with P2P, gRPC, and block production disabled.

JSON-RPC result:

```text
chain.get_head_info height: 1210
chain.get_head_info id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
chain.get_head_info lib: 1150
chain.get_head_info head_state_merkle_root: EiApT-Wk_CYFo88-6X7siGzor57rVBjlgIlRu1fRhewWxQ==

block_store.get_highest_block height: 1210
block_store.get_highest_block id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
```

Log evidence:

```text
[chain] State DB opened from shared RocksDB column families
Finished indexing 60 blocks, took 0.018058 seconds
[node] teleno_node ready
```

No test `teleno_node` process was left running.

## Remaining Compression Dependency Step

Real zstd compression is not active until the linked RocksDB package reports `zstd` in `rocksdb::GetSupportedCompressions()`.

Follow-up on 2026-06-13: a clean, separate zstd-enabled RocksDB build and separate `build-zstd` Teleno build passed the strict compression gate, synced public-testnet data, compacted the disposable zstd DB, and reopened the compacted sample successfully. See `UNIFIED_ROCKSDB_ZSTD_VALIDATION_20260613.md`.

Required dependency work:

1. Rebuild or replace the RocksDB package with zstd enabled, for example with CMake/Hunter args equivalent to:

```text
WITH_ZSTD=ON
CMAKE_PREFIX_PATH=/opt/homebrew
```

2. Reconfigure `node/teleno-node/build` so `RocksDB_DIR` points to that zstd-enabled package.
3. Rebuild `teleno_node`.
4. Run `scripts/check-rocksdb-compression.sh`; it must exit `0`.
5. Run `--storage-report`; it must show:

```text
compression.selected_default: zstd
compression.selected_blocks: zstd
compression.supported: ...zstd...
```

6. Run `--compact-db --all` on copied testnet data and measure before/after size.

Do not run compaction or migration on prodnet data until the copied testnet/full-node sample passes.
