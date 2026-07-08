# Syncing A Node

Syncing is the process of downloading, validating, and indexing chain data until
the local node catches up with the selected network.

## When To Use This

Use this page when starting, stopping, restarting, or monitoring the local
observer node from Koinos One.

## Before You Start

- Confirm the selected network in `Settings`.
- Confirm the intended `Base Data Folder`.
- Make sure the folder has enough free disk space.
- Leave producer mode disabled while restoring or catching up.

## Start, Stop, And Restart

1. Open `Node`.
2. Use `Start` to launch the local node.
3. Use `Show logs` if startup takes longer than expected.
4. Use `Restart` after saving settings that require a node restart.
5. Use `Stop` before changing data folders, restoring backups, or quitting when
   Koinos One asks you to stop managed services.

If Koinos One is configured to keep running in the macOS menu bar, closing the
window can hide the app while the node continues. Use `Quit Koinos One` or the
shutdown dialog when you intend to stop managed services.

## Monitoring Sync

Use these signals together:

- footer status and local RPC URL;
- `Node > Node Operation` component state;
- `Explorer` recent blocks;
- `Dashboard` refresh status;
- `Show logs` for warnings, peer activity, and block progress.

When sync is healthy, head height should advance over time, logs should show
normal block or peer activity, and the UI should avoid repeated RPC failures.

## How To Verify It Worked

- `Node` shows the local runtime as active.
- The local RPC source responds in `Explorer`.
- Head height or recent block rows advance.
- Logs do not repeatedly report the same fatal error.
- Disk free space remains comfortably above the restore and database growth
  needs for the selected network.

## Think Twice Before These Actions

Stop before changing advanced P2P, JSON-RPC, gRPC, chain verification, producer,
or block production settings on a mainnet node. Advanced config changes can
affect sync behavior, API exposure, or production safety.

## Recovery-Safe Troubleshooting

If the node reports a persistent state merkle mismatch, do not clear
`chain/blockchain`, do not start from an empty state database, and do not force a
fresh full resync as the first action. Preserve the existing state and gather
logs first.

If a restart is needed after a settings change, use the app's `Restart` control
so Koinos One can stop and start the managed runtime in the expected order.

If the node is stopped but `Start` is blocked, check for a process conflict. The
app may detect another native process using the same `BASEDIR`.

## Related Pages

- [Node Dashboard](node-dashboard.md)
- [Backup And Restore](backup-and-restore.md)
- [Troubleshooting](troubleshooting.md)
