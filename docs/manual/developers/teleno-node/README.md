# Teleno Node Development

`teleno_node` is the native monolithic Koinos node binary used by Koinos One.
It embeds the runtime components that were historically separate services.

The node is developed in its own repository,
[koinos/teleno](https://github.com/koinos/teleno), and consumed here as the
`node/teleno-node` git submodule, so working-tree paths below still resolve
locally after `git submodule update --init node/teleno-node`. The native
runtime is versioned independently through the submodule's `VERSION` file with
`teleno-node-v<version>` release tags.

## Pages

- [Native Source Layout](source-layout.md)
- [Component Overview](component-overview.md)
- [Chain, Block Store, And Mempool](chain-block-store-mempool.md)
- [P2P, JSON-RPC, And gRPC](p2p-jsonrpc-grpc.md)
- [Backup And Restore Internals](backup-restore-internals.md)
- [Storage And RocksDB](storage-and-rocksdb.md)
- [Testing And Validation](testing-and-validation.md)
- [Native Release Builds](release-builds.md)

## Main Source Areas

- [`node/teleno-node/src/main.cpp`](https://github.com/koinos/teleno/blob/main/src/main.cpp)
- [`node/teleno-node/src/core/`](https://github.com/koinos/teleno/tree/main/src/core)
- [`node/teleno-node/src/block_store/`](https://github.com/koinos/teleno/tree/main/src/block_store)
- [`node/teleno-node/src/mempool/`](https://github.com/koinos/teleno/tree/main/src/mempool)
- [`node/teleno-node/src/p2p/`](https://github.com/koinos/teleno/tree/main/src/p2p)
- [`node/teleno-node/src/jsonrpc/`](https://github.com/koinos/teleno/tree/main/src/jsonrpc)
- [`node/teleno-node/src/grpc_server/`](https://github.com/koinos/teleno/tree/main/src/grpc_server)
- [`node/teleno-node/src/block_production/`](https://github.com/koinos/teleno/tree/main/src/block_production)
- [`node/teleno-node/src/storage/`](https://github.com/koinos/teleno/tree/main/src/storage)
- [`node/teleno-node/src/backup/`](https://github.com/koinos/teleno/tree/main/src/backup)

## Development Principle

Native changes may optimize storage, process layout, calls, scheduling, and
backup behavior, but must not change externally observable Koinos protocol
behavior.

Before changing backup, restore, storage, P2P, producer, or release behavior,
read the relevant files under
[`docs/current/`](https://github.com/koinos/koinos-one/tree/main/docs/current)
and
[`docs/backlog/`](https://github.com/koinos/koinos-one/tree/main/docs/backlog).
