# Native Source Layout

The native node source lives in the
[koinos/teleno](https://github.com/koinos/teleno) repository (checked out here
as the `node/teleno-node` submodule) under
[`src/`](https://github.com/koinos/teleno/tree/main/src).

## Core Directories

| Path | Purpose |
| --- | --- |
| `main.cpp` | CLI parsing, component composition, runtime startup, and utility modes. |
| `core/` | Config parsing, event bus, service registry, RPC access policy, and node version helpers. |
| `interfaces/` | Internal interfaces for chain, block store, and mempool integration. |
| `koinos/chain/` | Embedded chain library adapted for monolith use. |
| `koinos/mempool/` | Embedded mempool library. |
| `koinos/state_db/` | Local state DB implementation and RocksDB backend. |
| `koinos/vm_manager/` | WASM VM manager code used by chain execution. |
| `block_store/` | Monolith block store implementation. |
| `transaction_store/` | Transaction index implementation. |
| `contract_meta_store/` | Contract metadata index implementation. |
| `account_history/` | Simplified account history implementation. |
| `block_production/` | Monolith-native block producer loop. |
| `p2p/` | Peer RPC, gossip, sync, transport abstraction, and peer identity. |
| `jsonrpc/` | Public JSON-RPC compatibility server. |
| `grpc_server/` | Typed gRPC compatibility server. |
| `storage/` | Unified RocksDB management and migration helpers. |
| `backup/` | Native backup, restore, SFTP, public restore, scheduler, and admin API. |

## Build Structure

[`node/teleno-node/src/CMakeLists.txt`](https://github.com/koinos/teleno/blob/main/src/CMakeLists.txt)
splits the node into library targets such as core, storage, backup, block
store, mempool, chain, P2P, JSON-RPC, gRPC, and block producer libraries. The
final executable is `teleno_node`.

The custom `koinos_node` target remains as compatibility for old automation, but
it depends on `teleno_node`.

## Tests

Native tests live under
[`node/teleno-node/tests/`](https://github.com/koinos/teleno/tree/main/tests)
and are registered from
`CMakeLists.txt` when `KOINOS_BUILD_TESTS` is enabled.

## Editing Guidance

- Keep protocol-sensitive code close to the component that owns it.
- Prefer internal interfaces over ad hoc cross-component calls.
- Put reusable config parsing and lifecycle behavior in `core/`.
- Put storage layout and migration behavior in `storage/`, not in individual
  API handlers.
- Put backup repository, transport, scheduler, admin, and restore activation
  behavior in `backup/`.
- Add or update focused native tests when changing component behavior.
