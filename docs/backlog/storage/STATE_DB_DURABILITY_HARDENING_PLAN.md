# State DB Durability Hardening Plan

- Date: 2026-07-05
- Scope: Koinos state DB RocksDB backend, state-delta commit atomicity,
  power-loss recovery, and validation coverage
- Status: implementation plan
- Source: defensive review of `audit.md` received 2026-07-03, rechecked
  against `origin/main` at `92f65fe`

## Problem

The current state-delta commit path starts a RocksDB `WriteBatch`, but not every
state commit write participates in that batch. Object puts are batch-aware.
Object deletes and metadata writes are not. RocksDB write options are also
default async writes.

The result is not a consensus fork risk by itself. The node should halt when
later validation detects inconsistent local state. The operational risk is a
node-local durability failure after power loss or kernel panic: metadata can
persist a new revision and merkle root without the matching object/tombstone
changes being durably present.

This matters for a desktop app because consumer machines are more exposed to
unclean shutdown than a UPS-backed server.

## Confirmed Evidence

- `node/teleno-node/src/koinos/state_db/state_delta.cpp` calls
  `backend->start_write_batch()`, applies removed objects and puts, then writes
  metadata and calls `backend->end_write_batch()`.
- `node/teleno-node/src/koinos/state_db/backends/rocksdb/rocksdb_backend.cpp`
  makes `put()` use `_write_batch` when present.
- The same RocksDB backend makes `erase()` call `_db->Delete(...)` directly.
- `store_metadata()` writes size, revision, id, merkle root, and block header
  through direct `_db->Put(...)` calls.
- `_wopts` is a default `rocksdb::WriteOptions` member, so the state commit
  write is not explicitly synced.
- `FlushWAL(true)` exists for checkpoint creation, but not for every state
  commit.

## Goals

1. Make each irreversible state-delta commit atomic across objects, deletes,
   tombstones, revision, id, merkle root, size, and block header metadata.
2. Make the final state commit durable enough to survive power loss within
   RocksDB's documented `sync=true` boundary.
3. Avoid changing consensus data, state hashing, merkle computation, block
   execution, or receipt semantics.
4. Keep non-consensus indexes and stores on their current async performance
   path unless separately justified.
5. Add targeted crash-window tests so future refactors cannot reintroduce
   split metadata/object commits.

## Non-Goals

- Do not rewrite the storage layout.
- Do not clear or rebuild chain state as part of this change.
- Do not change checkpoint backup semantics except where tests need a fixture.
- Do not make every RocksDB store synchronous. The first hardening target is
  the canonical state DB commit.
- Do not claim full recovery from arbitrary disk corruption. This plan narrows
  the known split-commit window.

## Implementation Plan

### 1. Add Batch-Aware Delete Support

Change `rocksdb_backend::erase(...)` so it routes through `_write_batch` when a
batch is open:

```cpp
if( _write_batch )
  status = _write_batch->Delete( &*_handles[ objects_cf ], Slice( k ) );
else
  status = _db->Delete( _wopts, &*_handles[ objects_cf ], Slice( k ) );
```

Keep the existing cache tombstone behavior unchanged. The cache should continue
to remember negative entries after a delete.

### 2. Add Batch-Aware Metadata Writes

Introduce a small helper in `rocksdb_backend`:

```cpp
void put_metadata_value( std::string_view key, std::string_view value );
```

The helper should:

- `Put` into `_write_batch` when present;
- otherwise direct `Put` with `_wopts`;
- assert on non-ok status with the existing exception type and message style.

Refactor `store_metadata()` to call this helper for every metadata key. This
puts metadata and object writes in one RocksDB batch during commit.

### 3. Add Durable Commit Control

Add an explicit durable commit path for state commits. Candidate approaches:

1. Make `end_write_batch()` accept an optional durability mode:

   ```cpp
   enum class write_durability { default_async, sync };
   void end_write_batch( write_durability durability = write_durability::default_async );
   ```

2. Or add a separate `end_write_batch_sync()` method and keep the existing
   interface unchanged for other backends.

The state root commit in `state_delta::commit(...)` should use the sync mode.
Non-state callers can stay async unless they are part of the same state commit.

If the abstract backend interface changes, update the map backend to accept the
same method signature as a no-op.

### 4. Keep Ordering Simple

After deletes, puts, and metadata all participate in the same batch, ordering
inside the batch is less important for atomicity. Preserve the current logical
order for readability:

1. Deletes/tombstones.
2. Object puts.
3. Metadata fields.
4. Batch write.

Do not move merkle computation, revision assignment, or block header assignment
without a separate reason.

### 5. Add Instrumented Tests

Add tests under the native test suite that use a controlled RocksDB backend.

Required cases:

- A commit with both put and erase emits one `WriteBatch` containing object
  writes, object deletes, and all metadata keys.
- `store_metadata()` does not direct-write while a batch is open.
- The state commit path uses `WriteOptions.sync = true`.
- A simulated failure before the batch write leaves the previous root visible.
- A simulated failure during batch write does not leave metadata advanced
  independently of objects.

If RocksDB itself is difficult to fault-inject cleanly, add a small test-only
backend or wrapper that records operations and forced failures. The acceptance
condition is the operation boundary, not full physical disk emulation.

### 6. Add a Startup Sanity Option

A full root recomputation is too expensive as a normal startup gate for large
state. Still add an expert/offline diagnostic path for operators:

```bash
teleno_node --basedir <path> --storage-check-state-root --backup-json
```

Initial implementation can be slow and explicitly offline. It should never be
part of normal startup unless later profiling shows it is practical.

### 7. Document Recovery Expectations

Update storage and recovery docs to say:

- State commit is atomic and synced as of the hardening change.
- Existing operators should still preserve the DB on merkle mismatch.
- Recovery order remains validate, inspect, restore from known-good backup,
  and only then consider destructive rebuild with explicit approval.

Do not document any local private machine paths or producer addresses.

## Tests

### Native Unit Tests

- RocksDB backend batch-aware delete.
- RocksDB backend batch-aware metadata write.
- State-delta commit writes one batch containing object and metadata updates.
- Sync durability is selected for state commit.
- Map backend still compiles and passes existing state tests.

### Regression Tests

- Existing `controller_delta_test.cpp` tombstone replay tests still pass.
- Existing chain/controller tests still pass.
- Backup checkpoint tests still pass.
- Public bootstrap restore tests still pass.

### Manual Validation

On a disposable basedir:

1. Sync or import a small chain state fixture.
2. Apply blocks with state changes and deletes.
3. Stop cleanly and restart.
4. Confirm head, LIB, stored merkle root, and block application continue.
5. Run the optional offline state-root diagnostic if implemented.

## Acceptance Criteria

- No direct RocksDB object delete occurs during an open state write batch.
- No direct RocksDB metadata put occurs during an open state write batch.
- State commit writes through one RocksDB `WriteBatch`.
- State commit uses explicit synchronous write durability.
- Test coverage proves the old split metadata/object batch behavior cannot
  silently return.
- Existing consensus and backup tests pass.

## Release Gate

Before using this in a release candidate:

1. Run `cmake --build node/teleno-node/build --target teleno_node --parallel`.
2. Run `ctest --test-dir node/teleno-node/build --output-on-failure`.
3. Run focused storage, controller, backup, and public restore tests.
4. Run a disposable observer smoke with several restarts.
5. Confirm performance impact is acceptable for desktop observer and producer
   profiles.

## Rollback Plan

If the change causes unacceptable performance or startup failures:

- Revert only the sync durability selection first, keeping batch-aware delete
  and metadata writes.
- If correctness tests fail, revert the full storage change and keep the
  recovery docs warning active.
- Never ask users to clear `chain/blockchain` or state DB as a first recovery
  step.
