# Backup And Restore

Koinos One uses the native backup and restore implementation in `teleno_node`.
The desktop app does not copy live RocksDB directories itself for the native
backup path.

## When To Use This

Use this page when creating a local backup, configuring private remote SFTP
backup, restoring a selected backup, or understanding the difference between
`Settings > Backup` and `Node > Restore Backup`.

## What Is Backed Up

Native backup is for node blockchain state and runtime data needed to restore a
node database. It does not include producer private keys or wallet files.

Restore preserves existing node state under `.pre-restore/<timestamp>-<backup-id>`
and leaves the node in observer-first mode with block production disabled.

## App Surfaces

`Settings > Backup` is configuration-only.

In simple mode it explains that restore is handled from `Node > Restore Backup`.
In expert mode it exposes local repository, private remote SFTP, scheduler, and
local-only backup admin API settings.

`Node > Restore Backup` owns backup and restore actions.

In simple mode it is restore-first and focuses on `Restore Backup`. In expert
mode it can show:

- runtime context for `BASEDIR`, config path, repositories, workspace, public
  backup URL, and backup admin listen address;
- local native backup inventory;
- private remote SFTP backup inventory;
- public read-only bootstrap inventory;
- create, verify, restore, purge, and cancel actions.

## Before You Start

- Stop block production before restoring.
- Do not restore over an open RocksDB handle.
- Make sure the target volume has enough free space.
- Keep wallet files, seed phrases, WIF keys, SSH private keys, and producer
  private keys outside public docs, logs, and screenshots.
- Use public bootstrap restore for first-time observer bootstrap, not as a
  producer migration shortcut.

## Create A Local Backup

1. Open `Settings > Backup`.
2. Enable expert backup controls if you need backup creation tools.
3. Confirm the local repository and workspace paths.
4. Save settings.
5. Open `Node > Restore Backup`.
6. Use `Create Backup` for a local native backup.
7. Use `Refresh local list` to inspect completed snapshots.

## Configure Private Remote Backup

1. Open `Settings > Backup`.
2. Enable expert backup controls.
3. Enable remote SFTP backup.
4. Enter the SSH host, port, user, auth method, credential file paths, known
   hosts file, strict host-key setting, remote directory, and retention values.
5. Save settings.
6. Use `Check native backup config` before creating or uploading backups.
7. Open `Node > Restore Backup` and refresh remote inventory.

Remote backup is operator-owned private SFTP backup. It is separate from public
bootstrap restore.

## Restore A Backup

1. Open `Node > Restore Backup`.
2. Use `Check Repository`, `Refresh local list`, `Refresh remote list`, or
   `Refresh public list` depending on the source.
3. Select the backup you intend to restore.
4. Use `Verify` when available to run preflight checks.
5. Choose restore.
6. Read the confirmation carefully. It names the backup ID and `BASEDIR`,
   explains `.pre-restore` preservation, and states observer-first behavior.
7. Confirm only when the target backup and folder are correct.
8. Start the restored node as an observer first.

## How To Verify It Worked

- Restore completes without a hash, size, or disk-space error.
- Existing state is preserved under `.pre-restore`.
- The restored node starts with block production disabled.
- `Node` shows the intended `BASEDIR`.
- `Explorer` or logs show the restored observer serving or syncing chain data.

## Stop And Ask Before Continuing

Stop before restoring over data from a mainnet producer, before re-enabling
block production after restore, or before moving restored state into a producer
role. Restored nodes should run as observers first until database health,
network, producer address, VHP, and producer-key checks pass.

## Troubleshooting

If disk-space preflight fails, choose a larger data folder or clear unrelated
files outside the node state. Do not bypass the space check.

If a restore is cancelled, partial staging data can remain. The existing active
database should not be replaced unless activation completed.

If remote listing succeeds but restore later downloads objects, that is
expected. Remote listing caches metadata first; objects are fetched during
selected restore or fetch.

## Related Pages

- [Public Bootstrap Restore](public-bootstrap-restore.md)
- [First-Run Setup](first-run-setup.md)
- [Troubleshooting](troubleshooting.md)
