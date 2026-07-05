# Component Overview

`teleno_node` runs Koinos components in one process. Components communicate
through direct calls and an internal event bus instead of GarageMQ/AMQP.

## Implemented Core Components

| Component | Current role |
| --- | --- |
| `chain` | Validates blocks and transactions, executes contracts, maintains chain state, and provides core RPC behavior. |
| `block_store` | Stores blocks and block metadata in the monolith RocksDB layout. |
| `mempool` | Tracks pending transactions, nonce checks, resource checks, and expiration. |
| `p2p` | Handles Peer RPC sync, GossipSub block/transaction topics, peer identity, and gossip readiness. |
| `jsonrpc` | Provides the main public Koinos JSON-RPC compatibility surface. |
| `grpc` | Provides typed protobuf gRPC service compatibility. |
| `block_producer` | Builds, signs, and gossips blocks when explicitly enabled and safe. |
| `transaction_store` | Forward transaction indexing. Historical backfill remains backlog work. |
| `contract_meta_store` | Forward contract metadata indexing. Historical backfill remains backlog work. |
| `account_history` | Simplified account history. Full legacy parity/backfill remains backlog work. |
| `backup scheduler/admin API` | Native backup, restore, public bootstrap, scheduler, and local admin operations. |

## Feature Flags

`NodeConfig` in
[`core/config.hpp`](https://github.com/koinos/koinos-one/blob/main/node/teleno-node/src/core/config.hpp)
includes feature flags for components. Core features such as chain, mempool,
block store, P2P, JSON-RPC, contract metadata, and transaction store default to
enabled. gRPC, block production, and account history default to disabled in the
base config.

Feature toggles are a runtime composition tool. They are not permission to
change protocol behavior or hide incompatible behavior behind a default.

## Lifecycle

[`core/service_registry.hpp`](https://github.com/koinos/koinos-one/blob/main/node/teleno-node/src/core/service_registry.hpp)
starts components in registered order and stops them in reverse order. A failed
component startup triggers stop of already-started components.

The main process composes dependencies in `main.cpp`: chain, block store,
mempool, P2P, RPC servers, producer, stores, storage, and backup services are
wired into the service registry and shared through internal interfaces where
needed.

## Removed Legacy Surface

GarageMQ/AMQP and the old microservice operator surface are intentionally not
part of the active Koinos One command surface. Legacy material is retained only
for compatibility evidence.

## Adding Or Changing Components

When adding or changing a component:

1. Identify whether the behavior is internal or externally observable.
2. Keep lifecycle startup and shutdown deterministic.
3. Add config defaults and CLI/config parsing deliberately.
4. Preserve JSON-RPC, gRPC, and P2P compatibility where clients depend on it.
5. Add focused tests and broader validation scripts when the change crosses
   component boundaries.
