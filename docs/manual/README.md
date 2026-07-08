# Koinos One Manual

Koinos One is a desktop app that runs a full Koinos mainnet node on your own
computer — sync the blockchain, manage accounts and balances, produce blocks,
and keep verified backups, all from one window. This manual covers the desktop
app, the underlying `teleno_node` runtime, and the Koinos concepts behind
them.

!!! note "A community project"
    Koinos One and its monolithic Teleno Node are a community-driven project.
    The official reference implementation of the Koinos node remains the
    microservices-based stack. Teleno is a full rewrite that must stay
    protocol-compatible with the reference node software.

## Common Tasks

- [Install on macOS](koinos-one/install-macos.md) and
  [set up your node for the first time](koinos-one/first-run-setup.md).
- [Sync your node with mainnet](koinos-one/syncing-a-node.md).
- [Back up your node and wallet](koinos-one/backup-and-restore.md).
- [Start producing blocks](koinos-one/producer-mode.md).
- [Fix a problem](koinos-one/troubleshooting.md).
- [See what changed in each release](reference/changelog.md).

## Start Here By Audience

- **New to Koinos:** start with [Koinos Concepts](concepts/README.md).
- **Installing or using the desktop app:** start with the
  [Koinos One User Guide](koinos-one/README.md).
- **Running `teleno_node` directly from the command line:** start with the
  [Teleno Node CLI Guide](teleno-node/README.md).
- **Contributing to the app or node:** start with the
  [Developer Documentation](developers/README.md).
- **Looking up ports, file paths, configuration, security, or releases:**
  start with the [Reference](reference/README.md).

## Sections

- [Koinos Concepts](concepts/README.md) - the blockchain basics behind the
  app: accounts, keys, transactions, blocks, and what running a node means.
- [Koinos One User Guide](koinos-one/README.md) - installing and using the
  desktop app.
- [Teleno Node CLI Guide](teleno-node/README.md) - running the native
  `teleno_node` binary without the desktop app.
- [Developer Documentation](developers/README.md) - contributor documentation
  for the GUI and native node, including how this manual is built.
- [Reference](reference/README.md) - glossary, ports, paths, configuration
  files, security model, and the changelog.
