# Monolith Service Coverage

This page is the rendered manual version of
[`docs/current/monolith/SERVICE_COVERAGE.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/monolith/SERVICE_COVERAGE.md).

This document separates the current monolithic implementation from legacy
microservice compatibility evidence.

## Implemented Core Services

| Legacy service area | Current monolith status | Notes |
| --- | --- | --- |
| `chain` | Implemented | Core validation and JSON-RPC/gRPC methods are wired. |
| `block_store` | Implemented | Blocks and block metadata live in the monolith RocksDB layout. |
| `mempool` | Implemented | Pending transactions, nonce checks, RC reservation, and expiration are covered. |
| `p2p` | Implemented | Peer RPC and GossipSub interop exist; mainnet synchronization and production have been validated. |
| `jsonrpc` | Implemented | Public Koinos JSON-RPC compatibility is the main client surface. |
| `grpc` | Implemented | Typed protobuf service is wired; ACL enforcement remains backlog work. |
| `block_producer` | Implemented | Private PoB, public testnet, and mainnet production have been validated. |
| `transaction_store` | Partially implemented | Forward indexing exists; historical backfill/import parity remains backlog work. |
| `contract_meta_store` | Partially implemented | Forward indexing exists; historical metadata backfill remains backlog work. |
| `account_history` | Partially implemented | Simplified and disabled in current prodnet deployment; full legacy parity/backfill remains backlog work. |

## Intentionally Removed Legacy Surfaces

- GarageMQ/AMQP service messaging.
- Legacy microservice build/start/package operator surface.
- Legacy REST wrapper, unless it is explicitly re-scoped as a product
  compatibility requirement.

## Main Remaining Parity Work

The missing work is tracked in
[`docs/backlog/README.md`](https://github.com/koinos/koinos-one/blob/main/docs/backlog/README.md).
The highest-risk legacy-service gap is full account history parity, followed by
historical backfill/import for transaction and contract metadata indexes.
