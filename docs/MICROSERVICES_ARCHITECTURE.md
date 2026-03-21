# Koinos Microservices Architecture

## Overview

Knodel runs a set of interconnected microservices that together form a Koinos blockchain node. All services communicate through an **AMQP message broker** (GarageMQ) using RPC calls and broadcast events.

```
                         ┌─────────────┐
                         │   JSON-RPC   │ :8080
                         │   Gateway    │
                         └──────┬───────┘
                                │
                         ┌──────┴───────┐
    ┌──────────┐         │              │         ┌──────────────┐
    │   P2P    │◄───────►│  AMQP Broker │◄───────►│  Block Store │
    │ Network  │ :8888   │  (GarageMQ)  │  :5672  │  (Badger DB) │
    └──────────┘         │              │         └──────────────┘
                         │              │
    ┌──────────┐         │              │         ┌──────────────┐
    │  Block   │◄───────►│              │◄───────►│   Mempool    │
    │ Producer │         │              │         └──────────────┘
    └──────────┘         │              │
                         │              │         ┌──────────────┐
    ┌──────────┐         │              │◄───────►│   Contract   │
    │  Chain   │◄───────►│              │         │  Meta Store  │
    │ (State)  │         └──────────────┘         └──────────────┘
    └──────────┘
```

## Services

### Core Services (always required)

| Service | Binary | Language | Port | Purpose |
|---------|--------|----------|------|---------|
| **amqp** | `garagemq.exe` | Go | 5672, 15672 | AMQP message broker — the communication backbone |
| **chain** | `koinos_chain.exe` | C++ | — | Blockchain state machine — executes blocks and WASM contracts |
| **mempool** | `koinos_mempool.exe` | C++ | — | Pending transaction pool — validates nonces and resources |
| **block_store** | `koinos-block-store.exe` | Go | — | Persistent block storage using Badger DB |
| **p2p** | `koinos-p2p.exe` | Go | 8888 | Peer-to-peer network using libp2p |

### Optional Services

| Service | Binary | Language | Port | Purpose |
|---------|--------|----------|------|---------|
| **jsonrpc** | `koinos-jsonrpc.exe` | Go | 8080 | HTTP JSON-RPC gateway for external API access |
| **block_producer** | `koinos_block_producer.exe` | C++ | — | Produces new blocks (Proof of Burn algorithm) |
| **contract_meta_store** | `koinos-contract-meta-store.exe` | Go | — | Caches smart contract ABI metadata |

## Startup Order

Services must start in dependency order:

```
1. amqp                    (no dependencies)
2. chain                   (depends on: amqp)
3. mempool                 (depends on: amqp)
4. block_store             (depends on: amqp)
5. p2p                     (depends on: amqp, chain, block_store)
6. block_producer          (depends on: amqp, chain, mempool)
7. jsonrpc                 (depends on: amqp)
8. contract_meta_store     (depends on: amqp)
```

## Communication: AMQP RPC

Each service registers an RPC handler on a dedicated AMQP queue. Other services send requests to these queues and receive responses via correlation IDs.

### Chain Service (`koinos.rpc.chain`)

**Provides:**
- `submit_block` — Execute and apply a block (full WASM execution)
- `submit_transaction` — Validate and apply a transaction
- `get_head_info` — Current chain head (height, ID, LIB)
- `get_chain_id` — Chain identifier
- `get_fork_heads` — All fork chain heads
- `read_contract` — Read-only contract call (no state change)
- `get_account_nonce` — Account nonce
- `get_account_rc` — Account resource credits
- `get_resource_limits` — System resource limits
- `propose_block` — Propose a block for production

**Calls:**
- `mempool.check_pending_account_resources()` — validate transaction resources
- `mempool.check_account_nonce()` — validate transaction nonce
- `mempool.get_pending_nonce()` — get next expected nonce
- `block_store.get_highest_block()` — sync target for indexer
- `block_store.get_blocks_by_height()` — fetch blocks for indexing

### Block Store Service (`koinos.rpc.block_store`)

**Provides:**
- `add_block` — Store a block and its receipt
- `get_blocks_by_height` — Retrieve blocks by height range
- `get_highest_block` — Get the highest stored block topology

### Mempool Service (`koinos.rpc.mempool`)

**Provides:**
- `check_pending_account_resources` — Check if account has resources to pay
- `get_pending_transactions` — List pending transactions (with limit)
- `check_account_nonce` — Validate account nonce
- `get_pending_nonce` — Get next expected nonce for account
- `get_pending_transaction_count` — Count of pending transactions
- `get_reserved_account_rc` — Reserved resource credits for account

### JSON-RPC Gateway (`koinos.rpc.jsonrpc`)

Routes external HTTP requests to internal AMQP services.

Method format: `service_name.method_name`

Examples:
- `chain.get_head_info` → routes to chain service
- `block_store.get_highest_block` → routes to block_store service
- `mempool.get_pending_transactions` → routes to mempool service

Supports whitelist/blacklist filtering via `config.yml`.

### Contract Meta Store (`koinos.rpc.contract_meta_store`)

**Provides:**
- `get_contract_meta` — Get contract ABI metadata

## Communication: AMQP Broadcasts

Services publish events to AMQP topic exchanges. Any interested service can subscribe.

| Broadcast Topic | Publisher | Subscribers | Trigger |
|-----------------|-----------|-------------|---------|
| `koinos.block.accept` | chain | p2p, block_store, mempool, contract_meta_store | Block accepted and applied |
| `koinos.block.irreversible` | chain | mempool | Block became irreversible (finalized) |
| `koinos.transaction.accept` | chain | mempool | Transaction accepted |
| `koinos.transaction.fail` | chain | — | Transaction failed validation |
| `koinos.gossip.status` | p2p | block_producer | P2P gossip connectivity changed |

## Data Flows

### Block Sync (Initial Sync / Catch-up)

```
P2P Network
    │
    ▼
┌────────┐  blocks via gossip   ┌─────────────┐
│  P2P   │ ──────────────────►  │ Block Store  │  stores in Badger DB
└────────┘                      └──────┬───────┘
                                       │
                        get_blocks_by_height()
                                       │
                                       ▼
                                ┌──────────────┐
                                │    Chain     │
                                │  (Indexer)   │
                                └──────────────┘
```

The chain's **indexer** runs at startup:
1. Calls `block_store.get_highest_block()` to find the sync target
2. Requests blocks in batches via `block_store.get_blocks_by_height()`
3. Applies blocks using one of two modes:
   - **`apply_block_delta()`** — applies pre-computed state deltas from receipts (fast, no WASM, ~3600 blocks/sec)
   - **`submit_block()`** — re-executes all WASM contracts (slow, full verification)

Default mode is `apply_block_delta()` (`verify-blocks=false`).

### Live Block Processing (After Sync)

```
P2P Network
    │
    ▼
┌────────┐  submit_block()   ┌──────────┐  broadcast: block.accept   ┌─────────────┐
│  P2P   │ ────────────────► │  Chain   │ ──────────────────────────► │ Block Store  │
└────────┘                   └──────────┘                             └─────────────┘
                                  │
                                  │  broadcast: block.accept
                                  ▼
                             ┌──────────┐
                             │ Mempool  │  removes included transactions
                             └──────────┘
```

Live blocks arrive via P2P gossip and are submitted to the chain for **full WASM execution** via `submit_block()`. After successful application, the chain broadcasts `koinos.block.accept` so all other services can update their state.

### Transaction Flow

```
External Client
    │
    ▼
┌──────────┐  chain.submit_transaction()  ┌──────────┐
│ JSON-RPC │ ───────────────────────────►  │  Chain   │
└──────────┘                               └────┬─────┘
                                                │
                                    broadcast: transaction.accept
                                                │
                                                ▼
                                           ┌──────────┐
                                           │ Mempool  │  adds to pending pool
                                           └──────────┘
                                                │
                                    get_pending_transactions()
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │Block Producer  │  includes in next block
                                        └───────────────┘
```

### Block Production

```
┌───────────────┐  get_pending_transactions()  ┌──────────┐
│Block Producer  │ ◄──────────────────────────  │ Mempool  │
└───────┬───────┘                               └──────────┘
        │
        │  propose_block() / submit_block()
        ▼
   ┌──────────┐  broadcast: block.accept   ┌────────┐
   │  Chain   │ ─────────────────────────►  │  P2P   │  gossips to network
   └──────────┘                             └────────┘
```

## Configuration

All services read from `config.yml` in the base directory (default: `~/.koinos`).

```yaml
global:
  amqp: amqp://guest:guest@127.0.0.1:5672/    # AMQP broker URL
  log-level: info                               # debug, info, warn, error
  instance-id: Koinos                           # Unique node identifier
  fork-algorithm: pob                           # Fork resolution: pob, fifo, block-time
  blacklist:                                    # Blocked RPC methods
    - block_store.add_block
    - chain.propose_block

p2p:
  listen: /ip4/0.0.0.0/tcp/8888               # P2P listen address
  peer:                                         # Seed nodes
    - /dns4/seed.koinosblocks.com/tcp/8888/p2p/Qm...

jsonrpc:
  listen: /tcp/8080                             # API listen port

block_producer:
  algorithm: pob                                # Production algorithm
  # producer: <address>                         # Block producer address
  # private-key-file: private.key               # Producer private key
```

## Storage

| Service | Database | Location | Size (full sync) |
|---------|----------|----------|------------------|
| **chain** | RocksDB | `chain/blockchain/` | ~2-5 MB (state only) |
| **block_store** | Badger DB | `block_store/db/` | ~350 GB (all blocks) |
| **contract_meta_store** | Badger DB | `contract_meta_store/db/` | ~10 MB |
| **p2p** | — | `p2p/` | ~1 MB (peer data) |

Note: The chain state database is remarkably small because it only stores the current state (key-value pairs), not historical blocks. All historical data lives in the block_store.

## Windows-Specific Notes

- **Process shutdown**: Windows doesn't propagate SIGTERM to child processes. Knodel uses `taskkill /T /F` for reliable process tree termination.
- **Heap corruption fix**: The koinos-mq library has a dangling pointer bug in `publish()` that causes heap corruption on MSVC. Fixed by patching the `expiration` field lifetime in `libkoinos_mq.lib`.
- **Backup restore**: Uses Windows built-in `bsdtar` (`C:\Windows\System32\tar.exe`) instead of MSYS/Git Bash tar to avoid path mangling issues with drive letters.
