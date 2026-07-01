# Chain, Block Store, And Mempool

These three components are the core validation and local data path.

## Chain

The chain component owns block and transaction validation, deterministic
execution, resource accounting, fork choice behavior, and state transition
rules. It must preserve Koinos protocol behavior.

Important protocol-sensitive outputs include:

- transaction IDs;
- block IDs;
- operation and transaction merkle roots;
- state roots;
- block validity decisions;
- deterministic receipts and state deltas.

## Block Store

The block store persists blocks and metadata in the monolith RocksDB layout. It
serves local RPC and P2P sync requirements. Internal storage can differ from
legacy services only if externally visible behavior remains compatible.

The block store is also part of restore and migration safety. It must retain
enough block data and metadata for local RPC, peer sync, validation, and index
rebuild workflows.

## Mempool

The mempool tracks pending transactions before block inclusion. It checks
pending account resources, pending nonce state, transaction count, and expiration
behavior.

Local admission policy can be an implementation detail. Once a transaction is
included in a block, validation is governed by consensus rules.

## Integration Boundary

The monolith replaces AMQP service calls with internal interfaces and direct
calls. That is an implementation detail; public JSON-RPC, gRPC, P2P sync, and
chain validation behavior remain compatibility surfaces.

## Common Validation

For changes in this area, consider:

- focused CTest for chain, block store, mempool, or producer behavior;
- JSON-RPC parity checks when request/response behavior changes;
- integration compatibility tests when wallet or upstream client behavior is
  affected;
- live or private-network validation only when explicitly scoped and safe.
