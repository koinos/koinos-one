# Teleno Node Development

`teleno_node` is the native monolithic Koinos node binary used by Koinos One.
It embeds the runtime components that were historically separate services.

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

- `node/teleno-node/src/main.cpp`
- `node/teleno-node/src/core/`
- `node/teleno-node/src/block_store/`
- `node/teleno-node/src/mempool/`
- `node/teleno-node/src/p2p/`
- `node/teleno-node/src/jsonrpc/`
- `node/teleno-node/src/grpc_server/`
- `node/teleno-node/src/block_production/`
- `node/teleno-node/src/storage/`
- `node/teleno-node/src/backup/`

## Development Principle

Native changes may optimize storage, process layout, calls, scheduling, and
backup behavior, but must not change externally observable Koinos protocol
behavior.

Before changing backup, restore, storage, P2P, producer, or release behavior,
read the relevant files under `docs/current/` and `docs/backlog/`.
