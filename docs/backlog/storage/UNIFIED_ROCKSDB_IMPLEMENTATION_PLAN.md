# Unified RocksDB Implementation Plan

Last updated: 2026-06-13

## Goal

Move Teleno from the current split storage layout:

```text
BASEDIR/db                 # monolith RocksDB: blocks, indexes, metadata services
BASEDIR/chain/blockchain   # chain controller state_db RocksDB
```

to a storage model where `BASEDIR/db` is the single durable RocksDB root for monolith state. This becomes the foundation for compression, offline compaction, online checkpoint backup, and faster producer recovery workflows.

## Safety Boundary

- Do not touch prodnet wallet files.
- Do not mutate prodnet basedirs or prodnet RocksDB data during implementation.
- Run all migration and restore validation against copied or generated testnet/private-testnet data.
- Restore validation must start as an observer first, with `block_producer` disabled.
- Mainnet/prodnet execution is a guided operator step only after testnet validation is complete.

## Current Implementation State

The monolith now opens one shared RocksDB database at `BASEDIR/db` with these column families:

```text
default
blocks
block_meta
contract_meta
transaction_index
account_history
chain_state
chain_metadata
storage_metadata
```

New basedirs and non-migrated existing basedirs still default to:

```text
layout.chain_storage = legacy
```

Migrated basedirs use:

```text
layout.chain_storage = unified
```

For unified basedirs, the chain controller opens a localized `koinos-state-db-cpp` backend on borrowed
RocksDB handles from the shared manager:

```text
default        -> state_db default column family handle
chain_state    -> state_db objects column family handle
chain_metadata -> state_db metadata column family handle
```

Operational status on 2026-06-13:

- The active public-testnet producer basedir at `/Volumes/external/teleno-testnet-producer/basedir`
  has been stopped, safety-copied, migrated to `layout.chain_storage = unified`, restarted as an observer,
  restarted as a producer, and verified to produce accepted public-testnet blocks.
- Prodnet basedirs and prodnet wallets have not been migrated or modified.

## Target Layout

```text
BASEDIR/db
  default
  blocks
  block_meta
  contract_meta
  transaction_index
  account_history
  chain_state
  chain_metadata
  storage_metadata
```

`storage_metadata` records layout version, chain storage mode, network, migration timestamps, source paths, and verification hashes.

## Phase 1: Storage Audit

1. Trace `state_db::database` ownership and open semantics.
2. Identify whether the current `state_db` package can open on a shared RocksDB handle or requires a path-backed instance.
3. Document chain DB keyspace boundaries and whether metadata/state records can be separated.
4. Confirm runtime shutdown order and lock behavior for both DB roots.

Exit criteria:

- A documented answer for whether chain migration can be implemented by adapter injection or must first be implemented as offline import/export plus dual-layout runtime.

Status on 2026-06-11:

- The installed `koinos::state_db::database` API only exposes path-backed `open(...)` calls.
- The installed RocksDB backend owns its own private `std::shared_ptr<rocksdb::DB>` and private column-family handles.
- Teleno now localizes the `koinos-state-db-cpp` source under `node/teleno-node/src/koinos/state_db`.
- The localized backend adds borrowed RocksDB handle support and a `state_db::database::open(shared_backend)` path.
- The chain controller can run from either the legacy path-backed state DB or the unified shared DB column families.

## Phase 2: Central Monolith RocksDB Manager

Create a repo-local storage manager that owns the shared `BASEDIR/db` open path.

Responsibilities:

- Column family descriptor construction.
- RocksDB tuning and compression selection.
- Column family handle lifecycle.
- Storage metadata reads/writes.
- Read-only measurement helpers for column-family sizes.
- Clear logs for selected compression and storage layout.

This phase initially did not change chain behavior. The follow-up adapter work now allows chain to run
from `BASEDIR/db` after a stopped-node migration, while keeping legacy path support.

Tests:

- Build `teleno_node`.
- Existing block producer test.
- Short private/testnet observer smoke on copied data.

Implementation status on 2026-06-11:

- `koinos_storage_lib` owns shared RocksDB descriptor construction, tuning, handle lifecycle, layout metadata, and column-family estimates.
- The shared DB now includes `chain_state`, `chain_metadata`, and `storage_metadata`.
- `teleno_node` opens the shared DB through the storage manager.
- `teleno_node --storage-report --basedir <BASEDIR>` prints layout metadata and per-column-family estimates.

## Phase 3: Storage Metadata

Add `storage_metadata` column family and write these keys:

```text
layout.version
layout.chain_storage
layout.created_by
layout.created_at
layout.basedir
layout.network
```

Supported `layout.chain_storage` values:

```text
legacy
unified
migration-in-progress
```

For existing nodes, first startup writes:

```text
layout.version = 1
layout.chain_storage = legacy
```

Tests:

- New empty basedir creates metadata.
- Existing copied testnet basedir opens as `legacy`.
- A fake `migration-in-progress` marker causes startup refusal with a clear error.

Implementation status on 2026-06-11:

- Metadata keys currently written: `layout.version`, `layout.chain_storage`, `layout.created_by`, `layout.created_at`, `layout.basedir`, and `layout.network`.
- `layout.chain_storage = legacy` starts the chain controller from `BASEDIR/chain/blockchain`.
- `layout.chain_storage = unified` starts the chain controller from `BASEDIR/db` column families.
- `layout.chain_storage = migration-in-progress` and unknown layout values cause startup refusal.

## Phase 4: Chain Storage Adapter Decision

If upstream `state_db::database` can accept an injected RocksDB handle/column family:

1. Add a chain storage adapter that maps chain state writes into `chain_state` and chain metadata into `chain_metadata`.
2. Keep legacy path support for one release.

If upstream `state_db::database` cannot accept an injected handle:

1. Implement an offline migration/import wrapper first.
2. Keep runtime dual-layout support until state_db is adapted upstream or vendored locally.

No production data is touched in either path.

Implementation status on 2026-06-11:

- Teleno chose the localized-backend path.
- `node/teleno-node/src/koinos/state_db` contains the adapted state DB implementation plus upstream MIT license.
- The localized RocksDB backend supports borrowed shared DB and borrowed column-family handles.
- `state_delta`, `state_db::database`, and `chain::controller` have overloads for injected backend ownership.
- Legacy path-backed open remains available for non-migrated nodes.

## Phase 5: Offline Migration Command

Add stopped-node commands:

```bash
teleno_node --basedir <BASEDIR> --migrate-chain-db-to-unified-rocksdb
teleno_node --basedir <BASEDIR> --rollback-unified-chain-db-migration
```

Current behavior on 2026-06-11:

- The command performs stopped-node migration from legacy chain state to unified shared RocksDB.
- It opens `BASEDIR/chain/blockchain` read-only.
- It copies legacy `objects` into `chain_state` and legacy `metadata` into `chain_metadata`.
- It verifies source and target record counts, byte counts, and SHA-256 hashes.
- It renames the legacy chain DB to `BASEDIR/chain/blockchain.legacy-pre-unified-<timestamp>`.
- It writes `layout.chain_storage = unified` only after copy and verification pass.
- If an exception occurs before completion, it restores `layout.chain_storage = legacy`.
- The rollback command requires `layout.chain_storage = unified`, uses `migration.backup_path`,
  refuses to overwrite an existing legacy chain DB, restores the preserved legacy chain DB, and
  writes `layout.chain_storage = legacy`.

Rules:

- Refuse if the shared RocksDB or legacy chain RocksDB cannot be opened because another process holds the lock.
- Run as a command mode only; no node services, P2P, JSON-RPC, or block production are started.
- Write `migration-in-progress` before copying.
- Verify source and target record counts and hashes.
- Preserve the legacy chain DB by renaming it to:

```text
BASEDIR/chain/blockchain.legacy-pre-unified-<timestamp>
```

- Write `layout.chain_storage = unified` only after verification passes.
- Rollback must be tested before any prodnet migration procedure is proposed.

## Phase 6: Testnet Validation

All validation uses generated or copied testnet/private-testnet data only.

Minimum gates:

1. Fresh private testnet starts with legacy layout.
2. Short sync/replay produces a non-empty chain DB.
3. Stop node.
4. Run migration command.
5. Start as observer with unified layout.
6. Compare before/after:
   - chain ID
   - head height
   - head block ID
   - LIB
   - state merkle root
   - block store highest block
   - selected JSON-RPC parity calls
7. Run a copied public-testnet basedir migration sample.
8. Start copied public-testnet basedir as observer only.

Validation status on 2026-06-11:

- A generated public-testnet observer basedir was synced, stopped, migrated, and restarted as a non-producing observer.
- Rollback was rehearsed on the same generated testnet basedir, restored the legacy chain DB, and restarted from the legacy path as a non-producing observer.
- The restored legacy basedir was migrated again and restarted from unified storage again, with the same head/block-store result.
- The migrated observer opened `layout.chain_storage = unified`, indexed the expected missing blocks from block store, and served JSON-RPC head/block-store data from the unified chain state.
- Evidence is recorded in `UNIFIED_ROCKSDB_TESTNET_VALIDATION_20260611.md`.

Final public-testnet producer status on 2026-06-13:

- The active public-testnet producer basedir was copied to
  `/Volumes/external/teleno-testnet-producer/basedir-pre-unified-20260613T094625Z`.
- The active basedir was migrated in stopped-node mode and the legacy chain DB was preserved at
  `/Volumes/external/teleno-testnet-producer/basedir/chain/blockchain.legacy-pre-unified-20260613T094846Z`.
- `--storage-report` showed `chain_state_db_exists: false`, `layout.chain_storage: unified`, and
  `compression.selected_default: zstd`.
- A post-migration observer restart opened `[chain] State DB opened from shared RocksDB column families`,
  indexed the missed 60-block window, and returned matching `chain.get_head_info` and
  `block_store.get_highest_block` height `5768309`.
- A post-migration producer restart opened the same shared chain state and produced blocks through height
  `5768356` during foreground validation.
- The detached testnet producer was relaunched from the unified basedir as PID `72925`; its log showed
  produced blocks at heights `5768360`, `5768362`, `5768368`, and `5768369`.
- Public testnet RPC confirmed height `5768369` as block
  `0x12206eb58202942686b20a48bc7f5d00bcc64046a6d94f60c6bb8cda1e03967249eb`.
- Detailed evidence is recorded in `UNIFIED_ROCKSDB_TESTNET_VALIDATION_20260611.md`.

## Phase 7: Compression Follow-Up

After unified storage is validated:

1. Build RocksDB with `zstd` support.
2. Add release gate that fails if configured `zstd` falls back to `none`.
3. Add offline compaction:

```bash
teleno_node --basedir <BASEDIR> --compact-db --compact-cf blocks
teleno_node --basedir <BASEDIR> --compact-db --all
```

4. Measure before/after column-family sizes on copied testnet data.

Implementation status on 2026-06-13:

- `rocksdb.compression` now controls the default compression codec for shared column families.
- `rocksdb.blocks-compression` remains as an optional override for block payload storage.
- `rocksdb.require-compression` and `--require-rocksdb-compression` fail startup/report commands when the configured non-`none` codec is not exactly supported by the linked RocksDB library.
- `--storage-report` prints requested/selected/default/block compression, supported codecs, and fallback reasons.
- `--compact-db --compact-cf <name>` compacts a selected shared RocksDB column family.
- `--compact-db --all` compacts all shared RocksDB column families.
- `scripts/check-rocksdb-compression.sh` is the release/package gate: it passes only when the built `teleno_node` can open with exact configured compression.
- A separate zstd-enabled RocksDB 8.8.1 install was built at `/Volumes/external/teleno-build-cache/deps/rocksdb-zstd-8.8.1`.
- A separate `node/teleno-node/build-zstd` build linked against that package, selected `zstd` for default and blocks compression, passed the strict compression gate, synced 3,367 public-testnet blocks, compacted the testnet sample from `10864 KB` to `2540 KB`, and reopened the compacted DB with matching chain/block-store height and ID.
- `scripts/build-rocksdb-zstd.sh` now builds or reuses the zstd-enabled RocksDB package, and `scripts/build-cpp-libp2p-koinos.sh` uses it by default for the monolith build. Set `TELENO_ROCKSDB_WITH_ZSTD=0` only when intentionally testing the old Hunter RocksDB path.
- The default local `node/teleno-node/build/teleno_node` now points at the zstd RocksDB package, passes `scripts/check-rocksdb-compression.sh`, and passed a 30-second public-testnet observer smoke with `2272` synced blocks at `75.708` blocks/sec.
- `scripts/build-zstd-static.sh` now builds a pinned static `zstd` 1.5.7 artifact for Teleno's macOS deployment target. The local zstd and rebuilt RocksDB static archives both report `minos 13.3`, and the default node build now links zstd from `/Volumes/external/teleno-build-cache/deps/zstd-static-1.5.7`.
- The local-zstd default build passed `scripts/check-rocksdb-compression.sh`, `koinos_rocksdb_manager_test`, the UI config-schema Vitest, and a 30-second public-testnet observer smoke with `2279` synced blocks at `75.941` blocks/sec.
- `scripts/build-gmp-static.sh` now builds a pinned static GMP 6.3.0 artifact for Teleno's macOS deployment target. GMP upstream `make check` passed, and the local `libgmp.a` reports `minos 13.3`.
- `scripts/build-cpp-libp2p-koinos.sh` now passes the local GMP archive into node configuration by default, overrides the stale Homebrew dynamic GMP interface link exported by `secp256k1-vrf::secp256k1-vrf`, and can reuse the cached `cpp-libp2p` tag if a network fetch fails.
- The local-zstd/local-GMP default build passed `scripts/check-rocksdb-compression.sh`, `koinos_rocksdb_manager_test`, the UI config-schema Vitest, and a 30-second public-testnet observer smoke with `2319` synced blocks at `77.274` blocks/sec.
- The normal `scripts/build-cpp-libp2p-koinos.sh` wrapper passed end to end with the local static dependency path. The wrapper-built binary then passed the same compression gate, the storage unit test, the UI config-schema Vitest, and a final 30-second public-testnet observer smoke with `2331` synced blocks at `77.674` blocks/sec.
- The previous Homebrew `libzstd.a` and dynamic `libgmp.dylib` deployment-target warnings are resolved. `otool -L node/teleno-node/build/teleno_node` now reports only system libraries.
- The active public-testnet producer basedir was compacted offline after unified migration. Its active basedir size dropped from `10229884 KiB` to `3013376 KiB`, a reduction of approximately `70.5%`; compared with the full pre-unified safety copy, the reduction was approximately `71.0%`.
- Post-compaction strict compression reporting still selected `zstd` for default and block column families, and a temporary observer restart opened shared chain-state column families and verified `chain.get_head_info` plus `block_store.get_highest_block` at height `5768883`.
- Baseline no-zstd evidence is recorded in `UNIFIED_ROCKSDB_COMPRESSION_VALIDATION_20260611.md`; zstd-enabled evidence is recorded in `UNIFIED_ROCKSDB_ZSTD_VALIDATION_20260613.md`.

## Phase 8: Backup Follow-Up

After unified storage is stable, implement:

- Producer identity backup.
- Full node RocksDB checkpoint backup.
- Restore starts as observer with production disabled.
- Manifest includes layout version, column families, compression, chain ID, head/LIB, node version, and checksums.

## Prodnet Migration Policy

Prodnet migration is not automatic. After testnet validation passes:

1. Present testnet evidence.
2. Ask the operator for a maintenance window.
3. Stop prodnet node.
4. Create external backup/checkpoint first.
5. Run migration.
6. Start as observer.
7. Verify head/LIB/state.
8. Enable producer only after explicit operator confirmation.
