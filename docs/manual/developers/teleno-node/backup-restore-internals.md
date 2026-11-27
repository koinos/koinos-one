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
[`docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md)
for the full current flag list.

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

Settings > Backup is configuration-oriented. Node > Restore Backup owns operation
controls such as restore, verify, create, list, and purge. The UI can use the
admin API when a managed node is running and fall back to CLI commands when it
is not.

Public bootstrap sources are read-only from the operator UI. Publishing public
bootstrap backups is a maintainer/release workflow, not a normal settings
operation.

## JavaScript Public Bootstrap Publisher

The unreleased Koinos One source candidate requires an Ed25519 signing key for
actual publication through both JavaScript publisher routes. The promotion
script's `--dry-run` may be unsigned and writes no public tree; the overlay
command has no dry-run mode. The overlay publisher
copies only hash-verified objects selected by the snapshot; it refuses an old
destination that links `objects` to the private repository. Published metadata
and objects are checked after writing. Consumers still need the matching
trusted public key and signature-required configuration.

Both publishers hold a destination write lock until the staged snapshot is
verified, the pointer is updated, and retention finishes. Overlay `--replace`
creates a new published ID and keeps the source backup ID as provenance.
Publication includes the validated observer config even when the source omitted
it. Consult the operator guide below before clearing an interrupted writer's
lock or staging directory.

For a tree that uses the old symlink layout, stage a new independent destination
and verify its signed contents and a trust-configured consumer before an
approved hosting or upload cutover. Preserve the old tree and routing record
for rollback review. Do not serve the old tree again if it exposes the private
store; withdraw the bootstrap route until a safe tree is ready. The detailed
operator boundary is in
[`PUBLIC_BOOTSTRAP_RESTORE.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md).
