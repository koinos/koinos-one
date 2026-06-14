# Online RocksDB Checkpoint Backup Plan

Status: superseded.

This document described the earlier online checkpoint backup direction before native backup and restore were fully moved into `teleno_node`.

Use these active documents instead:

- `README.md` for the backup documentation index.
- `NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md` for the current native implementation.
- `NATIVE_BACKUP_REMAINING_WORK_PLAN.md` for the remaining backlog and validation plan.
- `NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md` for current validation evidence.

Historical note: the important design principle from this plan remains valid: do not copy a live RocksDB directory directly. The current native implementation uses node-owned RocksDB checkpoints and object-repository snapshots instead.
