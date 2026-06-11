# Online RocksDB Checkpoint Backup Plan

- Date: 2026-06-09
- Scope: koinosGUI monolithic node backup/restore
- Status: implementation plan

## Objective

Implement an online blockchain-state backup path for the monolithic `koinos_node` that does not stop the running node. The backup must capture a consistent RocksDB checkpoint, archive only the monolith state needed for restore, avoid legacy microservice directories, and remain safe for mainnet and live producer operation.

The current GUI backup flow stops the node and creates a `tar.gz` archive from legacy directories such as `chain/` and `block_store/`. That is not the correct long-term model for the monolith. The intended final model is one live RocksDB checkpoint over the unified monolith database at `BASEDIR/db`, but the current runtime is only partially consolidated and still opens a separate chain-state RocksDB database at `BASEDIR/chain/blockchain`.

## Current State

- `koinos_node` opens a shared monolith RocksDB database at `BASEDIR/db`.
- The shared database uses column families for:
  - `default`
  - `blocks`
  - `block_meta`
  - `contract_meta`
  - `transaction_index`
  - `account_history`
- The chain controller still opens a separate RocksDB database at `BASEDIR/chain/blockchain`.
- `BASEDIR/chain/genesis_data.json` is still needed for genesis/config initialization.
- Existing GUI backup code lives in `electron/lib/backup-service.ts`.
- Existing GUI backup stops the node before archiving because it copies live filesystem directories directly.
- The existing backup archive is legacy-shaped and includes `chain/` and `block_store/`.
- The monolith architecture document identifies the target backup model as one RocksDB checkpoint for the whole node state, but that target depends on completing the unified RocksDB layout migration first.

## Required Preceding Phase

The recommended implementation order is:

1. Complete the unified RocksDB layout migration in `MONOLITHIC_NODE_ARCHITECTURE.md` Phase 9.
2. Validate the unified layout against restored mainnet data, live testnet observer sync, and live testnet producer canary.
3. Implement this online checkpoint backup plan against the final one-DB layout.

This avoids building a temporary backup format around the current two-DB runtime. A two-DB checkpoint backup could be implemented as a stopgap, but it would need two node-owned checkpoints, a cross-database application consistency guard, a larger manifest, and extra restore logic. That work is not the preferred path unless online backup is needed before storage unification.

## Design Principles

1. Do not `tar` the live `BASEDIR/db` directory while the node is running.
2. Create the checkpoint from inside the `koinos_node` process because the process owns the open RocksDB handle.
3. Keep administrative backup controls private to the local GUI, not public JSON-RPC.
4. Prefer a same-volume checkpoint workspace so RocksDB can hard-link SST files instead of copying them.
5. Archive the checkpoint directory, not the live database.
6. Include enough metadata to verify restore safety.
7. Do not include GUI wallet storage or private keys in the blockchain backup.
8. Treat live producer backup as allowed but potentially I/O-heavy; warn the user before starting.

## Recommended Architecture

After the unified storage layout is complete, add a two-stage backup flow:

1. `koinos_node` creates a RocksDB checkpoint into a temporary workspace under the same volume as the active `BASEDIR`.
2. koinosGUI compresses that checkpoint into the user-selected archive file, writes checksums and metadata, then removes the temporary checkpoint.

The node must expose this as a private local admin operation rather than a public chain API.

## Private Admin Control Channel

Add a private admin endpoint to the monolith:

- Bind only to loopback by default.
- Generate a random per-process admin token at launch.
- Pass the token to koinosGUI through the Electron-managed process state, not through user-visible logs.
- Reject all requests without the token.
- Do not expose the endpoint through the normal public JSON-RPC method dispatcher.

Recommended command-line/config fields:

- `--admin-listen=127.0.0.1:0`
- `--admin-token-file=<path>` or an Electron-created environment variable for development
- `admin.enabled: true|false`
- `admin.listen: 127.0.0.1:0`

For macOS-first implementation, loopback HTTP with a bearer token is enough. A future hardening pass can switch to Unix domain sockets on macOS/Linux and named pipes on Windows.

Admin methods:

- `GET /health`
- `POST /backup/checkpoint`
- `GET /backup/status/<id>`
- `POST /backup/cancel/<id>` for future use; checkpoint cancellation may be best-effort only

The first implementation can make `POST /backup/checkpoint` synchronous and return when the checkpoint directory is ready, as long as the GUI progress text is honest.

## Node-Side Checkpoint Manager

Add a `BackupCheckpointManager` inside `koinos_node` with access to:

- `rocksdb::DB*`
- `BASEDIR`
- current node config
- read-only chain head summary provider
- a write-quiesce guard, described below

This assumes Phase 9 has moved chain state into the shared `BASEDIR/db` RocksDB handle. If the node is still running the current two-DB layout, this manager must refuse final one-DB checkpoint backup and report that storage migration is required.

Responsibilities:

1. Validate that no checkpoint is already running.
2. Create a unique checkpoint workspace:
   - `BASEDIR/.koinosgui-checkpoints/<timestamp>-<short-id>/`
3. Capture metadata before checkpoint:
   - network if known
   - chain ID if available
   - current head height
   - current head block ID
   - LIB height
   - enabled optional components
   - RocksDB column families
   - node version/build commit if available
4. Temporarily quiesce application writes long enough to start a consistent checkpoint.
5. Flush WAL where appropriate.
6. Call RocksDB checkpoint creation.
7. Write `backup-manifest.json` into the checkpoint workspace.
8. Return the checkpoint path and manifest summary to Electron.

RocksDB API target:

```cpp
#include <rocksdb/utilities/checkpoint.h>

rocksdb::Checkpoint* checkpoint = nullptr;
auto status = rocksdb::Checkpoint::Create(db, &checkpoint);
auto create_status = checkpoint->CreateCheckpoint(checkpoint_path);
delete checkpoint;
```

Use RAII wrappers in production code.

## Application Consistency Guard

RocksDB checkpoints are storage-consistent, but the node also needs application-level consistency. The checkpoint must not catch the node between multi-step block application writes unless those writes are already atomic across all touched column families.

Implementation requirement:

- Introduce a lightweight backup/write guard shared by chain/block-store/index writers.
- During checkpoint creation:
  - pause new block application/indexing writes
  - wait for in-flight write batches to finish
  - create checkpoint
  - release writes
- Continue serving read-only JSON-RPC where possible.
- For producer mode, production can remain running, but if the checkpoint pause exceeds a threshold, log and surface a warning.

If the current write path proves all state-changing block writes are already atomic in one RocksDB batch, the guard can be narrower. The first implementation should still include the guard because the blast radius of an inconsistent backup is high.

## Archive Format

Use a new archive format rather than pretending it is the old legacy backup:

Recommended filename:

```text
koinos_monolith_rocksdb_<network>_<height>_<YYYYMMDDTHHMMSSZ>.tar.zst
```

Fallback if `zstd` is not available:

```text
koinos_monolith_rocksdb_<network>_<height>_<YYYYMMDDTHHMMSSZ>.tar.gz
```

Archive contents:

```text
backup-manifest.json
db/
config.yml
chain/genesis_data.json
jsonrpc/descriptors/koinos_descriptors.pb
```

Do not include by default:

- `wallet` data
- GUI secure storage
- producer private key files
- legacy `block_store/`
- legacy `account_history/`
- legacy `transaction_store/`
- legacy `contract_meta_store/`
- logs
- old checkpoints
- `.knodel-blockchain-backup-cache/`

If a user explicitly asks to include producer key material, that should be a separate encrypted export flow, not part of blockchain-state backup.

## Manifest Schema

Add a versioned manifest:

```json
{
  "format": "koinosgui-rocksdb-checkpoint",
  "version": 1,
  "created_at": "2026-06-09T00:00:00.000Z",
  "network": "mainnet",
  "basedir": "/Volumes/external/knodel-monolith-restore/basedir",
  "checkpoint_path": ".koinosgui-checkpoints/...",
  "node": {
    "binary": "koinos_node",
    "version": "0.1.0",
    "koinosgui_version": "0.10.1"
  },
  "head": {
    "height": "36629623",
    "id": "0x...",
    "lib": "36629563"
  },
  "rocksdb": {
    "column_families": [
      "default",
      "blocks",
      "block_meta",
      "contract_meta",
      "transaction_index",
      "account_history"
    ]
  },
  "features": {
    "jsonrpc": true,
    "grpc": false,
    "block_producer": false,
    "contract_meta_store": true,
    "transaction_store": true,
    "account_history": true
  },
  "restore": {
    "requires_verify_blocks": false,
    "restore_mode": "monolith-rocksdb"
  }
}
```

For checkpoint backups, `requires_verify_blocks` should normally be `false` because the checkpoint is a consistent database snapshot, not a legacy receipt replay restore. Keep the field explicit so restore logic can distinguish this from old backup formats.

## Electron Backup Flow

Add a new online backup function in `electron/lib/backup-service.ts`:

```ts
createOnlineRocksDbCheckpointBackup(input, sender)
```

Flow:

1. Confirm the node is managed by koinosGUI and currently running.
2. Confirm the admin endpoint and token are available.
3. Query current node status and local head.
4. Ask the user for the destination path.
5. Estimate storage:
   - source DB size
   - expected compressed size
   - destination free space
   - temporary checkpoint workspace free space
6. Warn if `features.block_producer` is enabled.
7. Call monolith admin `POST /backup/checkpoint`.
8. Wait for checkpoint completion.
9. Verify checkpoint contains `db/` and manifest.
10. Compress checkpoint with preferred compression:
    - first choice: `zstd -T0`
    - second choice: `pigz`
    - fallback: gzip
11. Write `.sha256`.
12. Optionally run a quick restore smoke into a temporary basedir if the user selected "Verify backup".
13. Remove checkpoint workspace.
14. Report final size and checksum.

Cancellation:

- Before checkpoint: cancel immediately.
- During checkpoint: mark cancellation requested; checkpoint may complete first.
- During compression/checksum: terminate child process and remove partial archive.
- During cleanup: best-effort only.

## Restore Flow

Update restore detection to support both formats:

- Legacy Koinos backup:
  - contains `chain/` and `block_store/`
  - may need conversion/import to monolith RocksDB
  - may require verify-blocks handling
- New monolith RocksDB checkpoint backup:
  - contains `db/`
  - restore by extracting into a clean `BASEDIR`
  - copy runtime files if missing
  - do not run legacy Badger conversion
  - do not force verify-blocks unless manifest says so

Restore validation:

1. Extract into selected target basedir.
2. Ensure `config.yml`, genesis data, and descriptors exist.
3. Start node with P2P disabled and JSON-RPC on an isolated port.
4. Verify `chain.get_head_info` succeeds.
5. Compare returned height/head against manifest when possible.
6. Stop the validation node.

## UI Changes

Settings > Backup should separate two actions:

- "Online RocksDB Backup"
  - Preferred for monolith.
  - Does not stop the node.
  - Requires managed running node.
  - Shows producer warning if block producer is enabled.
- "Legacy Backup"
  - Existing flow.
  - Stops node.
  - Intended for old layouts or compatibility only.

Progress phases:

- Preparing
- Creating RocksDB checkpoint
- Compressing checkpoint
- Writing checksum
- Verifying backup, optional
- Cleaning temporary checkpoint
- Complete

The UI should show:

- source `BASEDIR`
- network
- current head
- estimated archive size
- temporary checkpoint path
- final archive size
- SHA-256 checksum

## Type And IPC Changes

Update:

- `electron/lib/main-types.ts`
  - add `create-online-checkpoint-backup` progress action
  - add result fields for archive path, checksum, checkpoint path, source size, final size
- `electron/preload.ts`
  - expose `createOnlineCheckpointBackup`
  - expose cancel API, or reuse backup cancel with action discrimination
- `electron/lib/ipc-handlers.ts`
  - register a new IPC handler
- `src/knodel-electron.d.ts`
  - add renderer bridge type
- `src/App.tsx`
  - add handler that calls the new bridge method
- `src/components/panels/SettingsPanel.tsx`
  - add UI controls and progress copy
- `src/i18n.ts`
  - add English/Spanish UI strings

## C++ Code Changes

Recommended new files:

- `node/teleno-node/src/core/backup_checkpoint_manager.hpp`
- `node/teleno-node/src/core/backup_checkpoint_manager.cpp`
- `node/teleno-node/src/admin/admin_server.hpp`
- `node/teleno-node/src/admin/admin_server.cpp`

Modify:

- `node/teleno-node/src/main.cpp`
  - create admin token/listener
  - construct backup manager after RocksDB opens
  - register admin routes
  - wire shutdown
- `node/teleno-node/src/core/config.hpp`
- `node/teleno-node/src/core/config.cpp`
  - parse admin settings
- `node/teleno-node/src/CMakeLists.txt`
  - add new source files
  - ensure RocksDB utilities symbols are linked if needed

## Safety Requirements

- Never allow online backup through a public JSON-RPC method.
- Refuse backup if admin token is missing.
- Refuse backup if checkpoint path is outside the configured checkpoint workspace.
- Refuse backup if another backup is running.
- Refuse restore into a non-empty basedir unless the user explicitly chooses a destructive restore path.
- Never include GUI secure storage.
- Never include private key files by default.
- Log archive paths and checksums, but never log admin tokens.
- Keep mainnet producer operations read-only; backup must not submit transactions or mutate chain state beyond normal ongoing node operation.

## Storage Model

For a same-volume checkpoint:

- The checkpoint workspace should mostly use hard links to SST files.
- Temporary additional disk use should be much smaller than the full DB size, but WAL/current small files and new compactions may add some overhead.
- The archive destination still needs enough space for the compressed backup.

Current observed sizes on the external SSD:

- Testnet producer `BASEDIR`: about `10 GB`
- Testnet producer `db/`: about `10 GB`
- Mainnet monolith full `BASEDIR`: about `190 GB`
- Mainnet monolith `db/`: about `80 GB`

Expected archive sizes:

- Testnet checkpoint backup: about `6-10 GB`
- Mainnet checkpoint backup: about `45-80 GB`

Free-space rule:

- Require destination free space >= estimated compressed archive size plus 10%.
- Require source volume free space >= 5% of DB size or at least 5 GB for checkpoint/WAL/compaction headroom.
- Warn if source and destination are the same physical volume and free space is tight.

## Test Plan

### C++ Unit Tests

Add tests under `node/teleno-node/tests/core/`:

1. Creates a temporary RocksDB with all monolith column families.
2. Writes sample data.
3. Creates a checkpoint.
4. Opens the checkpoint independently.
5. Verifies all expected column families/data are present.

Add a concurrent-write test:

1. Start a writer loop.
2. Trigger checkpoint.
3. Confirm checkpoint opens cleanly.
4. Confirm live DB continues accepting writes after checkpoint.

Add admin auth test:

1. Missing token is rejected.
2. Wrong token is rejected.
3. Correct token starts checkpoint.

### Electron Unit Tests

Add tests for `backup-service.ts`:

1. Online backup refuses when node is not running.
2. Online backup refuses when admin endpoint/token is missing.
3. Online backup estimates space from `db/`, not legacy dirs.
4. Online backup writes `.sha256`.
5. Online backup cleanup removes temporary checkpoint workspace.
6. Cancellation removes partial archives.
7. Restore dispatcher detects `koinosgui-rocksdb-checkpoint` manifest.
8. Restore dispatcher does not run legacy conversion for checkpoint backups.

### Integration Smoke

Create a script:

```text
scripts/smoke-online-rocksdb-backup.sh
```

Flow:

1. Launch isolated monolith with a tiny private/test config.
2. Wait for JSON-RPC readiness.
3. Submit or insert enough data to populate RocksDB.
4. Run online checkpoint backup through the admin endpoint.
5. Archive it.
6. Restore into a second basedir.
7. Launch second monolith with P2P disabled.
8. Compare `chain.get_head_info`.
9. Clean up all processes and temp dirs.

### Live Validation

Run in this order:

1. Isolated local smoke, no live network.
2. Testnet observer, not producing.
3. Testnet producer with warning accepted.
4. Mainnet observer only.

Do not run first live validation on a mainnet producer.

## Implementation Phases

### Phase 1: Node Checkpoint Primitive

- Add `BackupCheckpointManager`.
- Add C++ unit tests.
- Prove temporary checkpoint can be opened as a standalone RocksDB.
- No GUI changes yet.

Exit criteria:

- `cmake --build node/teleno-node/build --target koinos_node <tests> --parallel`
- Checkpoint unit tests pass.

### Phase 2: Private Admin Endpoint

- Add admin endpoint with token auth.
- Add backup checkpoint route.
- Add logs:
  - `[backup] Checkpoint requested`
  - `[backup] Checkpoint complete path=...`
  - `[backup] Checkpoint failed reason=...`
- Add admin auth tests.

Exit criteria:

- Missing/wrong token rejected.
- Correct token creates checkpoint.
- Public JSON-RPC does not expose backup method.

### Phase 3: Electron Backup Service

- Add `createOnlineRocksDbCheckpointBackup`.
- Add compression helper with `zstd`/`pigz`/gzip fallback.
- Add checksum generation.
- Add cleanup/cancel behavior.
- Add unit tests.

Exit criteria:

- Mocked backup service covers happy path, no-node path, missing-token path, cleanup, cancellation, and manifest handling.

### Phase 4: Restore Support

- Add archive format detection.
- Add restore path for `db/` checkpoint archive.
- Add optional restore verification.
- Keep legacy restore path intact.

Exit criteria:

- Legacy `.tar.gz` restore still works.
- New checkpoint archive restores into a clean basedir.
- Validation node can start and answer `chain.get_head_info`.

### Phase 5: UI

- Add "Online RocksDB Backup" action in Settings > Backup.
- Keep existing legacy backup action but label it clearly.
- Add producer warning.
- Show estimated size and free-space checks.
- Show final checksum and archive path.

Exit criteria:

- UI exposes the new backup without stopping the node.
- Existing backup/restore progress UI remains functional.

### Phase 6: End-To-End Evidence

- Add smoke script.
- Run isolated smoke.
- Run testnet observer smoke.
- Run testnet producer backup while producing.
- Document results in a report.

Exit criteria:

- Restored checkpoint reaches the same or expected head.
- Live node remains running during backup.
- No RocksDB lock conflicts.
- No partial archive left after cancellation.

## Open Questions

1. Should the first release support only `.tar.zst`, or keep `.tar.gz` fallback immediately?
2. Should checkpoint verification always launch a temporary node, or remain optional to avoid extra time?
3. Should a live producer backup pause block production briefly or only pause RocksDB write paths?
4. Should old legacy backup UI be hidden in simple mode once online checkpoint backup is ready?
5. Should admin transport use loopback HTTP first, or should macOS start directly with Unix domain sockets?

## Recommendation

Implement this in the following order:

1. Node-side checkpoint manager.
2. Private admin endpoint.
3. Electron online backup service.
4. Restore support for checkpoint archives.
5. UI changes.
6. E2E smoke and live testnet validation.

Do not implement this by adding a public JSON-RPC method. The backup action is operationally powerful, can consume disk and CPU, and must remain a local authenticated admin operation.
