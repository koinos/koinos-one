# Unified RocksDB Testnet Validation - 2026-06-11

## Scope

This report covers the first working unified RocksDB chain-state implementation:

- Centralize ownership of the monolith RocksDB at `BASEDIR/db`.
- Add `chain_state`, `chain_metadata`, and `storage_metadata` column families.
- Localize `koinos-state-db-cpp` so chain state can run on borrowed shared RocksDB handles.
- Add a stopped-node migration command from legacy `BASEDIR/chain/blockchain` into the shared DB.
- Validate migration and restart against generated public-testnet observer data.
- Finalize validation on the active public-testnet producer basedir.

No prodnet wallet files, prodnet configs, or prodnet RocksDB data were read or modified.

## Implementation Result

Implemented:

- `koinos_storage_lib`
- `storage::RocksDBManager`
- `storage_metadata` column family
- `chain_state` column family
- `chain_metadata` column family
- Localized `koinos-state-db-cpp` under `node/teleno-node/src/koinos/state_db`
- Borrowed RocksDB handle support in the localized state DB backend
- Chain controller open path for injected shared state DB backend
- `teleno_node --storage-report`
- `teleno_node --migrate-chain-db-to-unified-rocksdb`
- `teleno_node --rollback-unified-chain-db-migration`

The migration command:

1. Requires `layout.chain_storage = legacy`.
2. Marks `layout.chain_storage = migration-in-progress`.
3. Opens `BASEDIR/chain/blockchain` read-only.
4. Copies legacy `objects` into shared `chain_state`.
5. Copies legacy `metadata` into shared `chain_metadata`.
6. Verifies record counts, byte counts, and SHA-256 hashes.
7. Renames the legacy DB to `blockchain.legacy-pre-unified-<timestamp>`.
8. Marks `layout.chain_storage = unified`.

The rollback command:

1. Requires `layout.chain_storage = unified`.
2. Reads `migration.backup_path`.
3. Refuses if the backup is missing.
4. Refuses to overwrite an existing `BASEDIR/chain/blockchain`.
5. Restores the preserved legacy chain DB.
6. Marks `layout.chain_storage = legacy`.

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

Result:

- `koinos_config_test`: passed
- `koinos_service_registry_test`: passed
- `koinos_rocksdb_manager_test`: passed
- `koinos_block_producer_test`: passed

The only build warning was the existing macOS `libgmp` deployment-target warning. The migration hash implementation uses OpenSSL EVP and produced no SHA deprecation warnings.

## Fresh Public-Testnet Data

Generated live public-testnet observer data with:

```bash
scripts/benchmark-monolith-sync.py \
  --report-dir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611 \
  --jsonrpc-port 28630 \
  --duration-seconds 15 \
  --sample-interval-seconds 5 \
  --startup-timeout-seconds 90
```

Result:

- Status: `pass`
- Height delta: `1183`
- Last height: `1183`
- Average sync rate: `78.814` blocks/sec
- Evidence:
  - `/private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/result.json`
  - `/private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/result.md`
  - `/private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/teleno_node.log`

## Pre-Migration Storage Report

Command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir \
  --config /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/config.yml \
  --storage-report
```

Key output:

```text
chain_state_db_exists: true
layout.version: 1
layout.chain_storage: legacy
blocks estimated_keys=1210 total_sst_file_size=5132509
chain_state estimated_keys=0 total_sst_file_size=0
chain_metadata estimated_keys=0 total_sst_file_size=0
storage_metadata estimated_keys=8 total_sst_file_size=1457
```

## Migration Result

Command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir \
  --config /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/config.yml \
  --migrate-chain-db-to-unified-rocksdb
```

Result:

```text
Migrated legacy chain DB to unified RocksDB
source: /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain
backup: /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain.legacy-pre-unified-20260611T213006Z
objects: count=79 bytes=596614 sha256=682042ab99a51849e5d12b31680a5ceaaa4dc67e1a55b1647dc32469e75f3f6b
metadata: count=5 bytes=266 sha256=483765fc351955bc346d3a5dab710e0c02ca86032d013d22feadbb46419fc525
```

## Post-Migration Storage Report

Key output immediately after migration:

```text
chain_state_db_exists: false
layout.version: 1
layout.chain_storage: unified
chain_state estimated_keys=79 total_sst_file_size=598194
chain_metadata estimated_keys=5 total_sst_file_size=1531
storage_metadata estimated_keys=20 total_sst_file_size=4722
```

## Unified Observer Restart

Started the migrated basedir as an observer with P2P, gRPC, and block production disabled:

```bash
node/teleno-node/build/teleno_node \
  --basedir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir \
  --config /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/config.yml \
  --jsonrpc-listen 127.0.0.1:28631 \
  --disable p2p block_producer grpc
```

Startup log evidence:

```text
Opened borrowed database at block - Height: 1150, ID: 0x1220445ec239b9e02911346bf75b79e4319dd638c5107e21bb3fe47e6eda069c35df
[chain] State DB opened from shared RocksDB column families
Finished indexing 60 blocks, took 0.01456 seconds
[node] teleno_node ready
[metrics] head_height=1210 lib=1150 ... peer_count=0 ... components=3
```

JSON-RPC after unified restart:

```text
chain.get_head_info:
  height: 1210
  id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
  previous: 0x1220b3b8f89fb88861d815eb39b29ea8aaa3eaa5eb78065982a42c89d170e83a8ecc
  lib: 1150
  head_state_merkle_root: EiApT-Wk_CYFo88-6X7siGzor57rVBjlgIlRu1fRhewWxQ==

block_store.get_highest_block:
  height: 1210
  id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
```

Final storage report after the unified observer indexed the missing block-store window:

```text
chain_state_db_exists: false
layout.chain_storage: unified
chain_state estimated_keys=79 total_sst_file_size=598194
chain_metadata estimated_keys=10 total_sst_file_size=3062
storage_metadata estimated_keys=17 total_sst_file_size=3244
```

No `teleno_node` process matching this test basedir was left running.

## Rollback Rehearsal

Command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir \
  --config /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/config.yml \
  --rollback-unified-chain-db-migration
```

Result:

```text
Rolled back unified chain DB migration
restored: /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain
from backup: /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain.legacy-pre-unified-20260611T213006Z
```

Storage report after rollback:

```text
chain_state_db_exists: true
layout.chain_storage: legacy
```

Started the rolled-back basedir as an observer with P2P, gRPC, and block production disabled.

Startup log evidence:

```text
Opened database at block - Height: 1150, ID: 0x1220445ec239b9e02911346bf75b79e4319dd638c5107e21bb3fe47e6eda069c35df
[chain] State DB opened at /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain
Finished indexing 60 blocks, took 0.009322 seconds
[node] teleno_node ready
```

JSON-RPC after rollback restart:

```text
chain.get_head_info:
  height: 1210
  id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
  lib: 1150
  head_state_merkle_root: EiApT-Wk_CYFo88-6X7siGzor57rVBjlgIlRu1fRhewWxQ==

block_store.get_highest_block:
  height: 1210
  id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
```

## Re-Migration Rehearsal

After the rollback restart passed, the restored legacy chain DB was migrated again.

Result:

```text
Migrated legacy chain DB to unified RocksDB
backup: /private/tmp/teleno-unified-rocksdb-migration-testnet-evp-20260611/basedir/chain/blockchain.legacy-pre-unified-20260611T213448Z
objects: count=79 bytes=596614 sha256=682042ab99a51849e5d12b31680a5ceaaa4dc67e1a55b1647dc32469e75f3f6b
metadata: count=5 bytes=266 sha256=483765fc351955bc346d3a5dab710e0c02ca86032d013d22feadbb46419fc525
```

The re-migrated basedir restarted from unified storage and returned the same head/block-store result:

```text
chain.get_head_info height: 1210
chain.get_head_info id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
block_store.get_highest_block height: 1210
block_store.get_highest_block id: 0x122008466f34e321ddad960047be10f7356a1aa6eb591482c49fcfeb823293f6d3d9
```

## Active Public-Testnet Producer Migration - 2026-06-13

The active public-testnet producer basedir was migrated after the generated/copy rehearsal passed.

Safety boundary:

- Prodnet wallet files, prodnet configs, and prodnet RocksDB data were not touched.
- The running testnet producer was stopped before migration.
- A full stopped basedir copy was created before mutation:

```text
/Volumes/external/teleno-testnet-producer/basedir-pre-unified-20260613T094625Z
size: 9.9G
```

Pre-migration active storage:

```text
/Volumes/external/teleno-testnet-producer/basedir/db               9.9G
/Volumes/external/teleno-testnet-producer/basedir/chain/blockchain 133M
```

Migration command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --migrate-chain-db-to-unified-rocksdb
```

Migration result:

```text
Migrated legacy chain DB to unified RocksDB
source: /Volumes/external/teleno-testnet-producer/basedir/chain/blockchain
backup: /Volumes/external/teleno-testnet-producer/basedir/chain/blockchain.legacy-pre-unified-20260613T094846Z
objects: count=605 bytes=1703774 sha256=065074cacfd4594efc2499bea6df1d9dafe88568e5e8d4b5d87fcf4911e87ca8
metadata: count=5 bytes=268 sha256=13f1ae64d20afb33d517ba7cf7c597cfe365ad399f21db4ce8fc790d83a5ad52
```

Post-migration storage report:

```text
chain_state_db_exists: false
layout.chain_storage: unified
compression.selected_default: zstd
compression.selected_blocks: zstd
blocks estimated_keys: 5780693
blocks total_sst_file_size: 10446488655
chain_state estimated_keys: 605
chain_state total_sst_file_size: 557411
chain_metadata estimated_keys: 5
chain_metadata total_sst_file_size: 1503
```

The legacy chain DB was no longer present at the active path. The preserved legacy backup remained at:

```text
/Volumes/external/teleno-testnet-producer/basedir/chain/blockchain.legacy-pre-unified-20260613T094846Z
```

Post-migration active storage:

```text
/Volumes/external/teleno-testnet-producer/basedir/db    9.7G
/Volumes/external/teleno-testnet-producer/basedir/chain 7.1M
```

### Observer Restart

The migrated basedir was first restarted as an observer:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --disable block_producer
```

Startup evidence:

```text
[chain] State DB opened from shared RocksDB column families
Finished indexing 60 blocks, took 0.006455 seconds
[node] teleno_node ready
```

JSON-RPC after unified observer restart:

```text
chain.get_head_info height: 5768309
chain.get_head_info id: 0x12200370883a8583058b1af880b07119e7544f312002b8c4ea93965d3062eef1f7e5
chain.get_head_info lib: 5768249
block_store.get_highest_block height: 5768309
block_store.get_highest_block id: 0x12200370883a8583058b1af880b07119e7544f312002b8c4ea93965d3062eef1f7e5
```

### Producer Restart

Producer mode was then restarted from the same unified basedir.

Startup evidence:

```text
[db] RocksDB opened at /Volumes/external/teleno-testnet-producer/basedir/db with 9 column families
[chain] State DB opened from shared RocksDB column families
[block_producer] Production loop started
[node] teleno_node ready
```

Foreground validation produced 14 blocks before the process was stopped cleanly for daemon relaunch.
Produced heights included:

```text
5768338
5768339
5768341
5768344
5768345
5768346
5768347
5768349
5768350
5768351
5768352
5768354
5768355
5768356
```

The detached testnet producer was then relaunched and left running:

```text
pid: 72925
log: /Volumes/external/teleno-testnet-producer/logs/teleno_node-testnet-unified-producer-daemon-20260613T095420Z.log
jsonrpc: http://127.0.0.1:18122/
p2p: /ip4/0.0.0.0/tcp/18888
```

Detached producer evidence:

```text
[chain] State DB opened from shared RocksDB column families
[block_producer] Produced block #1 at height 5768360
[block_producer] Produced block #2 at height 5768362
[block_producer] Produced block #3 at height 5768368
[block_producer] Produced block #4 at height 5768369
```

Local RPC after detached restart:

```text
chain.get_head_info height: 5768361
chain.get_head_info lib: 5768301
block_store.get_highest_block height: 5768366
```

Public testnet RPC confirmation used the validated testnet IP because DNS resolution from this host failed:

```bash
curl --resolve testnet.koinosfoundation.org:443:37.27.41.35 \
  https://testnet.koinosfoundation.org/jsonrpc
```

Public RPC returned head height `5768381`, then confirmed the produced block:

```text
block_store.get_blocks_by_height height 5768369
block_id: 0x12206eb58202942686b20a48bc7f5d00bcc64046a6d94f60c6bb8cda1e03967249eb
```

## Status

This validates the unified chain-state path on both a generated public-testnet sample and the active
public-testnet producer basedir:

- Legacy public-testnet observer data synced successfully.
- Stopped-node migration copied and verified chain state.
- Legacy chain DB was preserved by rename.
- The migrated node restarted as an observer from shared RocksDB chain column families.
- JSON-RPC chain head and block-store highest block agreed after restart.
- Rollback restored legacy chain state and restarted successfully.
- Re-migration after rollback restarted from unified storage successfully.
- The active public-testnet producer basedir migrated successfully.
- The active public-testnet producer restarted from unified storage and produced accepted blocks.
- Public testnet RPC confirmed a produced post-migration block by height and ID.
- Prodnet data and wallets were not touched.

Before any prodnet migration, keep prodnet as a guided operator procedure: stop the prodnet node, create
an external backup, migrate while stopped, restart as observer first, verify head/LIB/state, and only then
enable production after explicit operator confirmation.
