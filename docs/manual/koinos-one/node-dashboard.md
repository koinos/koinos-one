# Node Dashboard

The main app gives you several views of the local node. `Node` is the control
surface. `Dashboard` and `Explorer` are read-oriented views that help you
understand what the node or selected RPC source is seeing.

## When To Use This

Use this page when you want to check whether the node is running, where its data
lives, which endpoint the app is reading from, and whether peers, producer
activity, and performance data look healthy.

## Main Areas

`Node > Node Operation` shows:

- the selected runtime, normally native `teleno_node`;
- `Start`, `Restart`, and `Stop` controls;
- the active preset and enabled components;
- `BASEDIR`, `Config`, `Binary`, and `Log file` paths;
- component health and component context actions;
- `Show logs` for the local node runtime.

`Node > Restore Backup` shows the normal restore-first backup surface. In simple
mode it focuses on `Restore Backup`. In advanced mode it also shows local,
private remote, and public backup inventory and maintenance actions.

`Dashboard` shows producer, peer, and performance panels when data is available.
The refresh window is controlled from `Settings > Dashboard`.

`Explorer` reads recent blocks from `RPC Source`. It can use the local node when
available or the configured public RPC list.

## How To Read Status

- `Stopped` means Koinos One does not currently have a running managed node.
- `Starting...`, `Stopping...`, and `Restarting...` mean an operation is in
  progress.
- A live footer status and recent head changes mean the app is receiving chain
  data.
- Partial outage warnings mean the runtime responded but one or more expected
  components are inactive.

## How To Verify It Worked

After starting the node:

1. Open `Node > Node Operation`.
2. Confirm `BASEDIR` is the folder you intended.
3. Confirm the local runtime is active and no conflict warning is visible.
4. Open `Explorer` and choose the local node RPC source if it is available.
5. Confirm recent block rows appear or that sync status is advancing.
6. Open `Dashboard` and check that panels refresh without repeated RPC errors.

## Useful Settings

- `Settings > Explorer` controls public RPC URLs used by `Explorer RPC Source`.
- `Settings > Dashboard` controls refresh cadence and producer scan window.
- `Settings > Node Settings` exposes raw node config only when advanced node
  settings are enabled.
- `Settings > Backup` configures backup behavior; restore actions live under
  `Node > Restore Backup`.

## Troubleshooting

If the local node is unavailable, first check the footer, then `Node > Node
Operation`, then `Show logs`.

If `Explorer` is working through a public RPC but the local node is not, the app
UI is alive but the local node may still be stopped, syncing, or unable to bind
its local ports.

If the dashboard cannot load producer or peer data, verify the selected RPC
source and wait for the local node to finish enough startup to serve requests.

## Related Pages

- [Syncing A Node](syncing-a-node.md)
- [Backup And Restore](backup-and-restore.md)
- [Troubleshooting](troubleshooting.md)
