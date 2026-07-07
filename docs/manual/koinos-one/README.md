# Koinos One User Guide

Koinos One is the desktop app for operating a local Koinos node through the
native `teleno_node` runtime. This guide is for users who want the app to
install, restore, start, monitor, back up, and safely operate a node without
driving the node directly from a terminal.

<p class="koinos-one-overview-illustration">
  <img src="../assets/koinos-one-local-nodes.png" alt="Distributed desktop computers running local Koinos nodes">
</p>

## Project Objective

The main objective of Koinos One is to make it easy to run a Koinos node
locally on a user's own desktop or laptop instead of relying on cloud servers or
data centers. A local node should be practical for everyday users: it should use
low PC resources, keep local internet bandwidth requirements reasonable, and
make safe node operation accessible from a desktop app.

Koinos has always aimed to be one of the most decentralized blockchains on the
planet. That goal is only realistic if thousands, and eventually millions, of
nodes can run on desktop computers around the world. Koinos One exists to move
node operation in that direction: away from a small number of hosted
infrastructure providers and toward many independently operated local nodes.

The current desktop focus is macOS. Windows and Linux desktop binaries are
planned so users on those platforms can run the same local-node experience
without building the native software themselves.

## Start Here

1. [Install On macOS](install-macos.md)
2. [First-Run Setup](first-run-setup.md)
3. [Node Dashboard](node-dashboard.md)
4. [Syncing A Node](syncing-a-node.md)

## Operations

- [Backup And Restore](backup-and-restore.md)
- [Public Bootstrap Restore](public-bootstrap-restore.md)
- [Wallet And Accounts](wallet-and-accounts.md)
- [Producer Mode](producer-mode.md)
- [Troubleshooting](troubleshooting.md)

## Safety Model

Koinos One starts from an observer-first model. An observer follows and verifies
the network without producing blocks. Block production, transaction signing, VHP
burns, mainnet producer registration, and producer-affecting config changes are
separate explicit actions.

!!! warning "Think twice before these actions"
    Pause and re-check the selected network and addresses before any action
    that signs a transaction, burns KOIN into VHP, registers or replaces a
    producer key on mainnet, enables block production, changes the producer
    address, or exposes JSON-RPC/gRPC/admin endpoints outside localhost.

## Main App Areas

- `Explorer` reads recent blocks from the selected RPC source.
- `Dashboard` shows producer, peer, and performance information.
- `Node` starts, stops, restarts, restores, and inspects the local node.
- `Remote` manages remote observer nodes over SSH: add a server, restore the
  public backup, and start a safe remote observer.
- `Producer` inspects and configures producer identity after observer checks.
- `Wallet` manages local wallet accounts and signing actions.
- `Documentation` renders this MkDocs manual inside the app.
- `Settings` stores network, RPC, backup, node, and advanced-mode settings.

## Source References

The user guide is based on the current implementation documented in:

- [`docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md)
- [`docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md)
- [`docs/current/monolith/CURRENT_MONOLITH_STATUS.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/monolith/CURRENT_MONOLITH_STATUS.md)
- [Monolith Service Coverage](../developers/deeper-references/monolith-service-coverage.md)
