# Storage And RocksDB

The current storage direction is a unified monolith RocksDB root at
`BASEDIR/db`.

## Column Families

Current column families are:

- `default`
- `blocks`
- `block_meta`
- `contract_meta`
- `transaction_index`
- `account_history`
- `chain_state`
- `chain_metadata`
- `storage_metadata`

## Current Status

New unified basedirs can run with `layout.chain_storage = unified`. The public
testnet producer basedir has been migrated and validated as a unified RocksDB
basedir.

Prodnet/mainnet migration remains a guided operator step and is not automatic.

## Backup Relationship

The active backup implementation expects the supported monolith storage layout
and rejects unsupported layouts before checkpoint backup.

RocksDB checkpoint backup must run against a supported, closed-over layout. Do
not add GUI or Electron paths that copy live RocksDB directories as a substitute
for native checkpoint backup.

## Developer Guidance

Storage engine details are implementation details only if the logical Koinos
state, block data, receipts, roots, and externally visible RPC behavior stay
compatible.

Do not treat deleting or rebuilding state as a default recovery step. Persistent
state merkle mismatch recovery must preserve the existing state DB until
validation-based recovery has been attempted and the user explicitly approves
more invasive actions.

## Migration Boundary

Prodnet/mainnet migration is a guided operator step, not an automatic hidden
rewrite. Migration tooling should produce reviewable output, preserve rollback
paths where possible, and validate the resulting node before claiming success.

Current storage details live in
`docs/current/storage/UNIFIED_ROCKSDB_CURRENT_IMPLEMENTATION.md`; remaining
storage rollout work lives in
`docs/backlog/storage/UNIFIED_ROCKSDB_IMPLEMENTATION_PLAN.md`.
