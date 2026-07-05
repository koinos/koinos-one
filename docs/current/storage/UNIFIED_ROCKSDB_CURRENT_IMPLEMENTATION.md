# Unified RocksDB Current Implementation

Teleno's current storage direction is a single monolith RocksDB root at
`BASEDIR/db`, with column families for blocks, indexes, metadata services, and
chain state.

## Current Column Families

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

## Current Status

- New unified basedirs can run with `layout.chain_storage = unified`.
- The public-testnet producer basedir has been migrated and validated as a
  unified RocksDB basedir.
- Prodnet/mainnet migration remains a guided operator step and is not automatic.
- The active backup implementation expects the supported monolith storage
  layout and rejects unsupported layouts before checkpoint backup.

## State Commit Durability

Canonical state commits write object puts, object deletes, tombstones, and
state metadata through one RocksDB `WriteBatch`. The final state commit batch
uses explicit RocksDB sync durability so revision, state ID, merkle root, size,
and block-header metadata do not advance independently of the matching object
changes inside RocksDB's documented sync boundary.

Non-consensus stores and indexes keep their existing async write path unless a
separate durability change justifies widening the scope.

## Related Backlog

The remaining storage migration and validation plan is tracked in
`../../backlog/storage/UNIFIED_ROCKSDB_IMPLEMENTATION_PLAN.md`.
