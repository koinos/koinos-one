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

## Restore A Legacy TAR Archive

For a legacy desktop restore from a configured URL, supply a direct HTTPS
link to a `.tar.gz` file without credentials, a query, or a fragment. Before
starting Koinos One, set `TELENO_BACKUP_SIGNATURE_PUBLIC_KEY_FILE` in its
launch environment to the absolute path of the publisher's PEM SPKI Ed25519
public key. Obtain the key through a trusted channel independent of the
backup server.

The server must offer the archive and three adjacent sidecars at the final
HTTPS URL. The app refuses redirects for all four requests.

| Sidecar suffix | Contents |
| --- | --- |
| `.metadata` | Nonempty metadata text with the publisher's original bytes. When `Included Directories` is present, it can list `chain` and `block_store`. |
| `.sha256` | The archive's SHA-256 digest, optionally followed by its filename. |
| `.manifest.json` | A version 1 `teleno-legacy-backup-signature` manifest with an Ed25519 signature covering the normalized archive URL and the SHA-256 digests of the archive and metadata. |

Edit the **Legacy backup URL** in **Settings > Backup**. Koinos One saves a
separate URL for each network. Switching networks selects the saved URL for
the new network or its default. Mainnet defaults to the built-in HTTPS archive,
including on migration from the former built-in HTTP URL. Testnet and custom
networks start with an empty URL, including profiles that inherited that HTTP
default. Enter a signed HTTPS archive for the selected network to enable
legacy remote restore there.

An existing custom URL stays saved when other settings change. Replace
custom HTTP or redirecting URLs with the final signed HTTPS archive URL
before using remote restore. The mirror must publish the signed sidecars,
and its operators must distribute the trusted public key.

For a legacy TAR file you already trust, use the local archive restore
option. It works with the selected file and needs no remote sidecars. The
legacy restore extracts into a new staging directory on every attempt.
Remote restores may reuse a cached archive after verifying their own copy.
Allow space for the archive copy and extracted data while the current
blockchain directories are still present. Use the public bootstrap inventory
for native snapshot restore.

## How To Verify It Worked

- Restore completes without a hash, size, or disk-space error.
- Existing state is preserved under `.pre-restore`.
- The restored node starts with block production disabled.
- `Node` shows the intended `BASEDIR`.
- `Explorer` or logs show the restored observer serving or syncing chain data.

## Think Twice Before These Actions

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

If the app quit during a legacy restore and a later attempt reports that
the data folder is locked, confirm that all Koinos One processes using the
folder have exited. Inspect any retained `.teleno-legacy-install-*` recovery
directory before clearing the stale `.teleno-legacy-restore.lock` file from
that specific node data folder. Keep recovery data until the blockchain
directories have been verified.

## Related Pages

- [Public Bootstrap Restore](public-bootstrap-restore.md)
- [First-Run Setup](first-run-setup.md)
- [Troubleshooting](troubleshooting.md)
