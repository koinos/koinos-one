# First-Run Setup

The first-run assistant prepares a safe local observer node. In the current app
flow, first-run setup targets the public Koinos mainnet observer path.

## When To Use This

Use this page the first time you open a packaged Koinos One install, or when you
are resetting a local app profile and want the normal observer-first setup
sequence.

## What The Assistant Does

The assistant walks through these steps:

1. `Welcome`
2. `Folder`
3. `Wallet`
4. `Restore`
5. `Start`
6. `Done`

It selects mainnet observer setup, asks for a data folder, optionally lets you
prepare a wallet, checks the public backup source, restores the public backup
when available, and starts the node as an observer.

Block production is not enabled automatically.

## Network Choice

The packaged first-run assistant currently keeps the first observer setup on
`Mainnet`. For `Testnet` or `Custom` operation, complete or skip first-run setup,
then open `Settings`, choose the network, confirm the `Base Data Folder`, and
save. When a saved network change replaces an active local runtime, Koinos One
stops the previous node context before switching.

Changing networks changes the chain data and public RPC defaults being used.
Keep separate data folders for separate networks unless you are intentionally
managing a custom layout.

## Before You Start

- Choose a writable `Base Data Folder` with enough free space.
- Prefer an external SSD if your internal disk is small.
- Leave the node as an observer until sync, data health, wallet state, producer
  address, VHP, and producer key checks are complete.
- Back up wallet seed phrases or WIF keys outside Koinos One before funding an
  account.

## Steps

1. On `Welcome`, read the observer-first safety note and choose `Get started`.
2. On `Folder`, choose the folder that will hold node data, the local backup
   repository, restore staging files, and runtime files.
3. Continue to save the folder selection.
4. On `Wallet`, create or open a local wallet only if you want it ready now.
   A wallet is not required to run an observer.
5. On `Restore`, let Koinos One check the `Public Backup URL`.
6. If a public backup is available, use `Restore Public Backup`.
7. If no public backup is available, continue and let the observer sync from
   peers.
8. On `Start`, start the node as an observer.
9. On `Done`, continue into the main app and monitor sync.

## How To Verify It Worked

- The final step says `Observer is running`.
- The summary shows `Start mode` as `Observer running` or `Observer first`.
- The `Node` tab shows the local node runtime and `BASEDIR`.
- `Producer` is not automatically active.
- The footer status changes from `Stopped` to a live or syncing state when the
  observer starts.

## Stop And Ask Before Continuing

Stop before enabling producer mode, registering a producer key, burning KOIN,
signing a transaction, or changing configuration that affects block production.
Those are not part of first-run observer setup.

## Troubleshooting

If folder selection fails, choose a folder on a mounted writable volume and make
sure macOS permits Koinos One to write there.

If public backup restore is unavailable, this is not fatal. The node can still
start as an observer and sync from peers.

If the node fails to start, copy the visible error from the assistant or open
`Node > Node Operation` and `Show logs`. Do not delete chain or state data as a
first response to a sync error.

## Related Pages

- [Public Bootstrap Restore](public-bootstrap-restore.md)
- [Syncing A Node](syncing-a-node.md)
- [Wallet And Accounts](wallet-and-accounts.md)
- [Producer Mode](producer-mode.md)
