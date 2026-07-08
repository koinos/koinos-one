# Public Bootstrap Restore

Public bootstrap restore lets a new node restore a published read-only backup
before continuing normal sync. It is designed to make first-time observer setup
faster without requiring SSH credentials.

## When To Use This

Use public bootstrap restore when setting up a new observer node and Koinos One
shows a configured `Public Backup Repository` for the selected network.

Do not treat it as a normal way to migrate an active producer.

## What Public Means

Public refers to the backup source, not to an admin API.

The bootstrap repository is served over HTTP(S) for ordinary read-only `GET`
requests. Koinos One still uses a local-only, bearer-token protected backup
admin API when the running node helps orchestrate backup operations. Public
Koinos JSON-RPC exposes no backup or restore methods.

## Network Sources

Koinos One currently knows standard public bootstrap URLs for:

- mainnet: official read-only public backups for new mainnet observers;
- testnet: read-only signed testnet public backups.

Custom networks keep public restore disabled unless explicitly configured.

Testnet public bootstrap metadata is signed when the bundled verification key is
available. Mainnet public bootstrap restore is operational over HTTPS with
per-object SHA-256 verification, while mainnet signature enforcement remains a
hardening follow-up.

## Before You Start

- Use a writable `Base Data Folder` with enough free space.
- Keep block production disabled.
- Use the standard `Restore Backup` flow unless you are intentionally working in
  expert mode.
- Do not enter SSH credentials for public bootstrap restore. They are not
  needed.

## Steps In Koinos One

1. Open `Node > Restore Backup`.
2. Confirm the `Data folder`.
3. Confirm the `Public Backup Repository`.
4. Use `Check Repository` to fetch latest metadata and local space estimates.
5. Confirm the latest backup size, date, and restore-space status.
6. Choose `Restore Backup`.
7. Read the restore confirmation.
8. Confirm only if the backup ID and `BASEDIR` are correct.
9. Start the restored node as an observer.

## What Happens During Restore

Koinos One and `teleno_node`:

1. resolve the selected public backup metadata;
2. validate manifest, file inventory, sizes, and hashes;
3. verify public metadata signatures when configured;
4. check disk space before large downloads;
5. download only missing content-addressed objects;
6. verify every accepted object by SHA-256;
7. stage the restore;
8. activate it while the database is closed;
9. write observer-safe settings when needed.

## How To Verify It Worked

- `Restore Backup` completes without disk-space, hash, or signature errors.
- `Node > Node Operation` shows the expected `BASEDIR`.
- The node starts with block production disabled.
- Logs show the node opening the database and becoming ready.
- `Explorer` or JSON-RPC head data advances as the observer catches up.

## Think Twice Before These Actions

Stop before using a restored public bootstrap database as a producer. A restored
node should run as an observer first. Re-enable block production only after
database health, network, producer address, VHP, and producer-key checks pass.

## Troubleshooting

If no public backup is available, start as an observer and sync from peers.

If HTTPS, signature, size, or hash verification fails, do not bypass the error
for a public network source. Check the configured repository and try again later.

If there is not enough disk space, choose a larger `Base Data Folder`.

## Related Pages

- [First-Run Setup](first-run-setup.md)
- [Backup And Restore](backup-and-restore.md)
- [Syncing A Node](syncing-a-node.md)
