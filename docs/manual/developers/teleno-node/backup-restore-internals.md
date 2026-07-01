# Backup And Restore Internals

Native backup and restore are owned by `teleno_node`. The Electron app
configures and calls native backup actions, but the native binary owns the
checkpoint, repository, SFTP, public restore, staging, activation, scheduler,
and admin API behavior.

## Native Backup Areas

| Source area | Responsibility |
| --- | --- |
| `backup/backup_plan.*` | Backup config planning and validation. |
| `backup/checkpoint_manager.*` | RocksDB checkpoint primitive. |
| `backup/snapshot_repository.*` | Local content-addressed snapshot repository. |
| `backup/sftp_uploader.*` | Native libssh SFTP upload and remote metadata handling. |
| `backup/public_restore.*` | Public read-only bootstrap restore over HTTP(S) or file fixtures. |
| `backup/backup_service.*` | Runtime backup service path. |
| `backup/backup_scheduler.*` | Scheduled backup execution. |
| `backup/backup_admin_server.*` | Local-only HTTP admin API. |
| `backup/restore_activation_supervisor.*` | Restore staging and activation safety. |

## CLI Surfaces

The native binary implements backup dry-run, create, list, delete, restore,
public list/fetch/restore, JSON output, and backup ID selection flags. See
`docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md` for the
full current flag list.

Common modes include:

- `--backup-dry-run`
- `--backup-create`
- `--backup-list`
- `--backup-list-remote`
- `--backup-delete`
- `--backup-restore`
- `--backup-public-list`
- `--backup-public-fetch`
- `--backup-public-restore`
- `--backup-json`

## Admin API

The backup admin API is local-only and bearer-token protected. Public Koinos
JSON-RPC exposes no backup or restore methods. Public bootstrap restore means
the backup source is read-only and public; it does not mean administrative
control is public.

## Restore Safety

Restore must:

- avoid restoring over an open RocksDB handle;
- preserve previous runtime paths under `.pre-restore/`;
- keep active config separate from restored config;
- write restore metadata;
- force observer-first recovery;
- disable block production until operator checks pass.

Backups do not include producer private keys or wallet files.

## Snapshot Repository

Native backup stores immutable file objects by SHA-256 and snapshot metadata
under the configured local repository. Later backups reuse unchanged objects.
Local and remote retention should delete only snapshots and objects that no
remaining completed snapshot references.

## UX Boundary

Settings > Backup is configuration-oriented. Node > Backups owns operation
controls such as restore, verify, create, list, and purge. The UI can use the
admin API when a managed node is running and fall back to CLI commands when it
is not.

Public bootstrap sources are read-only from the operator UI. Publishing public
bootstrap backups is a maintainer/release workflow, not a normal settings
operation.
