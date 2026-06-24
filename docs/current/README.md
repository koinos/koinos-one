# Current Implementation Index

These documents describe functionality that exists in the active Koinos One /
Teleno implementation. If a document describes a desired future feature, it
belongs under `docs/backlog/`. If it describes an old implementation path, it
belongs under `docs/archive/implementation-plans/`.

## Monolithic Node

- `monolith/ARCHITECTURE.md` - current runtime architecture.
- `monolith/SERVICE_COVERAGE.md` - current legacy-service coverage and known
  parity limits.
- `monolith/CURRENT_MONOLITH_STATUS.md` - detailed status and validation history.

## Backup And Restore

- `backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md` - implemented native
  backup, restore, SFTP, scheduler, and admin API behavior.
- `backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md` - implemented public bootstrap
  restore behavior.

## Storage

- `storage/UNIFIED_ROCKSDB_CURRENT_IMPLEMENTATION.md` - current RocksDB layout
  and migration status.

## Operations And Protocol References

- `operations/SERVER_INVENTORY.md` - private local-only server inventory. This
  file is intentionally ignored by Git because it can contain hostnames, IPs,
  SSH users, workloads, and resource snapshots.
- `operations/PRODNET_OBSERVER_DOCKER_DEPLOYMENT.md` - Docker-based prodnet
  observer deployment, public-bootstrap restore, verification, and sizing notes.
- `../operations/START_TELENO_NODE.md` - command-line startup guide.
- `../operations/TELENO_NODE_CONTAINER.md` - Linux container guide.
- `../koinos/KOINOS_PROTOCOL.md` - Koinos protocol compatibility reference.
