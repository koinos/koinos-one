# Current Monolithic Node Architecture

This page is the rendered manual version of
[`docs/current/monolith/ARCHITECTURE.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/monolith/ARCHITECTURE.md).

Koinos One manages one native `teleno_node` process. The node embeds the Koinos
runtime components that were historically separate microservices and connects
them with direct in-process calls plus an internal event bus.

## Runtime Model

```text
Koinos One Electron UI
  |
  +-- electron native runtime controller
        |
        +-- teleno_node
              |
              +-- chain
              +-- block_store
              +-- mempool
              +-- p2p
              +-- jsonrpc
              +-- grpc
              +-- block_producer
              +-- transaction_store
              +-- contract_meta_store
              +-- account_history
              +-- backup scheduler/admin API
```

## Active Design Choices

- GarageMQ/AMQP is not part of the current runtime surface. Component calls are
  in-process.
- JSON-RPC and gRPC are the external client compatibility surfaces.
- Public backup and restore APIs are not exposed through public JSON-RPC.
  Backup admin endpoints are local-only and bearer-token protected.
- Block production is optional and controlled by runtime config.
- Restored nodes start as observers first. Production should be enabled only
  after database health, producer address, VHP, and producer-key checks pass.

## Current Validation Sources

- Detailed current status:
  [`docs/current/monolith/CURRENT_MONOLITH_STATUS.md`](https://github.com/pgarciagon/koinos-one/blob/main/docs/current/monolith/CURRENT_MONOLITH_STATUS.md).
- Service coverage:
  [Monolith Service Coverage](monolith-service-coverage.md).
- Historical validation reports remain under
  [`docs/roadmap/monolith/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/roadmap/monolith).
- Legacy compatibility evidence lives under
  [`docs/legacy/`](https://github.com/pgarciagon/koinos-one/tree/main/docs/legacy).
