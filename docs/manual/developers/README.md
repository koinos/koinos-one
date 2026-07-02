# Developer Documentation

This section helps contributors understand, develop, test, package, and
maintain Koinos One and the native Teleno Node. It is an orientation layer, not
the full engineering history. When a change needs deep validation detail, use
the current implementation, backlog, roadmap, and compatibility documents named
near the end of this page.

## Start Here

- [Repository Tour](repository-tour.md) - repository layout, ownership
  boundaries, and where to look first.
- [Local Development](local-development.md) - local setup, common commands,
  and validation paths.
- [Architecture Overview](architecture-overview.md) - how the desktop app
  supervises the native node.

## GUI

- [GUI Development](gui/README.md) - GUI development index.
- [Electron, Vite, React, And TypeScript Structure](gui/electron-vite-react-structure.md)
  - renderer, preload, Electron main process, and build outputs.
- [App State And Native Bridge](gui/app-state-and-native-bridge.md) - renderer
  state, preload bridge, IPC, and native runtime services.
- [i18n And GUI Copy](gui/i18n-and-gui-copy.md) - English/Spanish copy rules
  and i18n workflow.
- [Settings And Operational Screens](gui/settings-screens.md) - Settings, Node,
  Backup, Wallet, Producer, and operational screen conventions.
- [GUI Packaging](gui/packaging.md) - app build identity, staging, packaging,
  and packaged-app verification.

## Teleno Node

- [Teleno Node Development](teleno-node/README.md) - native node development
  index.
- [Native Source Layout](teleno-node/source-layout.md) - native source
  directories and library boundaries.
- [Component Overview](teleno-node/component-overview.md) - monolith runtime
  components.
- [Chain, Block Store, And Mempool](teleno-node/chain-block-store-mempool.md)
  - core validation and local data path responsibilities.
- [P2P, JSON-RPC, And gRPC](teleno-node/p2p-jsonrpc-grpc.md) - networking and
  external API surfaces.
- [Backup And Restore Internals](teleno-node/backup-restore-internals.md) -
  native backup, restore, public bootstrap, scheduler, and admin API internals.
- [Storage And RocksDB](teleno-node/storage-and-rocksdb.md) - unified RocksDB
  layout and migration boundaries.
- [Testing And Validation](teleno-node/testing-and-validation.md) - native
  tests, scripts, smoke tests, and validation evidence.
- [Native Release Builds](teleno-node/release-builds.md) - native build
  identity and release packaging handoff.

## Compatibility And Safety

- [Koinos Protocol Boundary](compatibility/koinos-protocol-boundary.md) - what
  must remain compatible with Koinos protocol behavior.
- [Legacy Service Parity](compatibility/legacy-service-parity.md) -
  implemented, partial, removed, and backlog service coverage.
- [Mainnet Safety](compatibility/mainnet-safety.md) - private material,
  protected addresses, and chain-mutating operation rules for developers.

## Source References

Use these rendered manual pages when the summary documentation is not enough:

- [Koinos Protocol Compatibility Reference](deeper-references/koinos-protocol.md)
- [Current Monolithic Node Architecture](deeper-references/monolith-architecture.md)
- [Monolith Service Coverage](deeper-references/monolith-service-coverage.md)

The deeper reference pages are manual copies of these repository sources:

- [`docs/current/README.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/README.md)
- [`docs/current/monolith/ARCHITECTURE.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/monolith/ARCHITECTURE.md)
- [`docs/current/monolith/CURRENT_MONOLITH_STATUS.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/monolith/CURRENT_MONOLITH_STATUS.md)
- [`docs/current/monolith/SERVICE_COVERAGE.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/monolith/SERVICE_COVERAGE.md)
- [`docs/current/storage/UNIFIED_ROCKSDB_CURRENT_IMPLEMENTATION.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/storage/UNIFIED_ROCKSDB_CURRENT_IMPLEMENTATION.md)
- [`docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md)
- [`docs/koinos/KOINOS_PROTOCOL.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/koinos/KOINOS_PROTOCOL.md)
- [`docs/backlog/README.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/backlog/README.md)

Keep this section high level. Deep validation transcripts, long benchmark
results, and future implementation plans belong in the existing
[`docs/current/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/current),
[`docs/roadmap/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/roadmap),
[`docs/backlog/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/backlog),
and [`docs/archive/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/archive)
areas.

## Contributor Rules Of Thumb

- Treat Koinos protocol behavior as compatibility-sensitive.
- Keep implemented behavior and backlog work clearly separated.
- Keep Knodel and legacy microservice work outside the active command surface
  unless the user explicitly asks for it.
- Keep all public docs free of protected producer addresses, private hostnames,
  private IPs, SSH users, secrets, wallet material, and local-only inventory.
- Update GUI copy and
  [`src/i18n.ts`](https://github.com/pgarciagon/koinos-one/blob/main/src/i18n.ts)
  together for every user-facing GUI change.
- Validate with tests or scripts that match the risk and blast radius of the
  change.
