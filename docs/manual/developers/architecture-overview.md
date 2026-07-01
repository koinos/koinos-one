# Architecture Overview

Koinos One is a desktop operator app around one native `teleno_node` process.
The native node embeds the Koinos runtime components that used to be separate
services and connects them with direct calls and an internal event bus. The
product goal is an optimized monolithic Koinos node that remains compatible
with Koinos protocol behavior.

## Runtime Shape

```text
Koinos One React UI
  |
  +-- Electron preload bridge
        |
        +-- Electron main process and IPC handlers
              |
              +-- native runtime services
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

## Layer Responsibilities

The React renderer owns user interaction, display state, polling, form drafts,
and visual presentation. It must not perform privileged filesystem, subprocess,
wallet, or native node operations directly.

The Electron preload bridge exposes the restricted `window.teleno` API. The
renderer uses bridge helpers in `src/app/` so browser-only development runs can
handle missing Electron bridges gracefully.

The Electron main process owns IPC handlers, local storage, native process
supervision, backup CLI/admin calls, wallet operations, and packaged app
lifecycle behavior.

The native `teleno_node` process owns Koinos validation, networking, RPC,
producer logic, storage, indexing, and native backup/restore internals.

## Key Design Choices

- The current runtime path is monolithic. GarageMQ/AMQP is not part of the
  active Koinos One operator surface.
- JSON-RPC and gRPC are the external compatibility surfaces for clients.
- Backup and restore admin routes are local-only and token protected.
- Block production is optional and controlled by runtime configuration.
- Restored nodes start as observers before any producer behavior is enabled.

## Implemented And Partial Areas

Implemented core areas include chain, block store, mempool, P2P, JSON-RPC,
gRPC, block producer, native backup/restore, and forward indexing for
transaction and contract metadata.

Partial or gated areas include full account-history parity, historical
transaction/contract metadata backfill, longer mainnet/prodnet validation,
signed prodnet public bootstrap publication, and gRPC ACL enforcement. Check
`docs/current/monolith/SERVICE_COVERAGE.md` and `docs/backlog/README.md`
before describing those areas as complete.

## What Can Change Locally

Koinos One can change process supervision, GUI state, local backup tooling,
RocksDB layout, and desktop presets as long as externally observable Koinos
protocol behavior remains compatible.

## What Must Not Change

The node must preserve Koinos protocol behavior: chain ID, genesis, protobuf
wire data, transaction IDs, block IDs, merkle roots, deterministic execution,
fork choice, P2P Peer RPC behavior, gossip payloads, and public RPC envelopes.

For protocol details, see `docs/koinos/KOINOS_PROTOCOL.md`.

## Safety Defaults

The architecture favors observer-first recovery. Restores disable production
until health, network, producer address, VHP, and producer key checks pass.
Mainnet producer registration, VHP burns, producer setup changes, config writes
targeting a producer, and transaction signing/submission require explicit user
direction and reviewable confirmation.
