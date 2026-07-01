# Troubleshooting

This page collects recovery-first actions for common Koinos One issues.

## First Checks

1. Check the footer status.
2. Open `Node > Node Operation`.
3. Confirm the intended network and `BASEDIR`.
4. Use `Show logs`.
5. Check free disk space.
6. Confirm whether a backup or restore is active.
7. Avoid deleting state until you have captured logs and confirmed the recovery
   path.

## App Opens But Node Is Stopped

Open `Node` and choose `Start`. If `Start` is disabled, check for:

- Electron-only controls unavailable in a browser renderer;
- an active operation still running;
- node status not ready yet;
- another native process using the same `BASEDIR`.

## Public Backup Not Available

This is not fatal. Start the node as an observer and let it sync from peers.
Try `Check Repository` again later from `Node > Restore Backup`.

## Restore Fails

Use the error type to decide the next action:

- disk-space error: choose a larger data folder;
- HTTPS/signature/hash/size error: do not bypass the trust check for a public
  network source;
- cancelled restore: leave the existing database in place and inspect staging
  output;
- open database error: stop the node before restoring.

Restore should preserve existing state under `.pre-restore` only after the
restore flow reaches activation.

## Sync Stalls Or Reports A State Mismatch

Do not clear `chain/blockchain`. Do not start from an empty state database as
the first action. Do not force a fresh full resync as the first action.

Instead:

1. Stop the node cleanly.
2. Preserve the existing `BASEDIR`.
3. Save logs and the exact error.
4. Restart once if the failure is not persistent.
5. If the mismatch repeats, ask for a recovery plan before moving or deleting
   state.

## RPC Errors

If `Explorer` works with a public RPC but not with the local node, the app is
running but the local node may be stopped, still starting, or unable to bind its
local JSON-RPC port.

If JSON-RPC or gRPC is bound to `0.0.0.0`, configure an explicit ACL before
exposing the endpoint outside localhost.

## Wallet Problems

If a password no longer unlocks the local wallet vault, recover from a backed-up
seed phrase or WIF. Deleting a wallet removes only the encrypted local copy; it
does not recover funds.

If a transaction action is disabled, check that the wallet is unlocked, the
account can sign, the selected network is correct, and the account has enough
mana/RC.

## Producer Problems

If producer registration is disabled, check the producer address, local public
key, unlocked producer wallet, mana/RC, and VHP.

If the registered public key does not match the local public key, replacing it
is an on-chain transaction. Stop and verify the network, signer, producer
address, and key before continuing.

## Stop And Ask Before Continuing

Stop before mainnet producer setup, transaction signing, VHP burn, mainnet
registration, producer-key replacement, or config changes affecting block
production. These operations can have real network or funds impact.

## Related Pages

- [Syncing A Node](syncing-a-node.md)
- [Backup And Restore](backup-and-restore.md)
- [Public Bootstrap Restore](public-bootstrap-restore.md)
- [Wallet And Accounts](wallet-and-accounts.md)
- [Producer Mode](producer-mode.md)
