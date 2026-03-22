# Chain Service — Exhaustive Technical Reference

The chain service (`koinos_chain.exe`) is the central microservice of the Koinos blockchain. It maintains the authoritative chain state, executes smart contracts via WASM, validates and applies blocks, and serves as the source of truth for all other services.

## Binary & Version

- **Binary:** `koinos_chain.exe` (C++20, MSVC on Windows)
- **Version:** v1.4.2
- **Source:** `vendor/koinos/koinos-chain/`

---

## Startup Sequence

1. Parse CLI flags and YAML config (`config.yml` or `config.yaml`)
2. Initialize logging (level, directory, color, datetime)
3. Load genesis data from JSON file (`genesis_data.json`)
4. Calculate chain ID: `SHA2-256(genesis_data_protobuf)`
5. Create IO contexts:
   - `client_ioc` — 2 threads for outbound AMQP RPC
   - `server_ioc` — N threads for inbound request handling (configurable via `--jobs`)
   - `main_ioc` — signal handling (SIGINT, SIGTERM, SIGQUIT)
6. Instantiate `chain::controller` with VM backend and configuration
7. Call `controller.open()`:
   - Opens RocksDB at `{basedir}/chain/blockchain/`
   - If new database: runs genesis callback (writes 3,761 genesis objects)
   - Calculates and stores chain ID in metadata
   - If `--reset`: wipes database and re-initializes
8. Connect AMQP client to broker
9. Establish connections to `block_store` and `mempool` services (ping-based)
10. Run **indexer**: catch up with block_store (see Indexer section)
11. Register AMQP request handler — begin serving RPC requests
12. Subscribe to `koinos.block.accept` broadcast for live block ingestion

---

## Thread Model

| Context | Threads | Purpose |
|---------|---------|---------|
| `client_ioc` | 2 | Outbound AMQP RPC calls (to block_store, mempool) |
| `server_ioc` | N (default: CPU cores, min 2) | Inbound RPC request processing |
| `main_ioc` | 1 | Signal handling and coordination |

Each thread has an 8 MB stack to accommodate deep WASM call stacks.

---

## Configuration

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--log-level, -l` | `info` | Log level (debug, info, warn, error) |
| `--instance-id, -i` | Random 5-char | Instance identifier for logs |
| `--jobs, -j` | CPU cores | Worker threads |
| `--statedir` | `blockchain/` | State DB path (relative to basedir/chain/) |
| `--genesis-data, -g` | `genesis_data.json` | Genesis data file |
| `--reset` | false | Reset database on startup |
| `--fork-algorithm, -f` | `fifo` | Fork resolution: fifo, pob, block-time |
| `--verify-blocks` | false | Re-execute WASM during indexing |
| `--read-compute-bandwidth-limit` | 10,000,000 | Compute ticks for read_contract |
| `--system-call-buffer-size` | 64,000 | Buffer for system call RPC |
| `--pending-transaction-limit` | 10 | Max pending txns per address |
| `--disable-pending-transaction-limit` | false | Remove per-address limit |

### YAML Config

```yaml
chain:
  fork-algorithm: pob
  jobs: 4
  verify-blocks: false
  read-compute-bandwidth-limit: 10000000
  pending-transaction-limit: 10
```

---

## Controller — The Core Engine

The controller (`controller_impl`) manages all block processing. It uses the pimpl pattern for ABI stability.

### Key State

| Member | Type | Purpose |
|--------|------|---------|
| `_db` | `state_db::database` | Fork tree with state nodes |
| `_vm_backend` | `vm_manager::vm_backend` | Fizzy WASM execution engine |
| `_cached_head_block` | `shared_ptr<block>` | Head block cache (shared_mutex protected) |
| `_client` | `shared_ptr<mq::client>` | AMQP client for outbound RPC |

### Three Block Processing Modes

#### 1. `submit_block` — Full Validation + Execution

Used by P2P for live blocks. This is the **trustless** path.

```
submit_block(block, index_to):
  1. validate_block() — check all fields present
  2. Check block not already applied (get_node returns existing)
  3. Verify parent is finalized (or is the root/LIB)
  4. Create writable state node from parent
  5. Validate: height == parent_height + 1
  6. Validate: timestamp > parent_timestamp
  7. Validate: timestamp <= now + 5 seconds
  8. Validate: previous_state_merkle_root matches parent's merkle root
  9. Execute system_call::apply_block() in kernel mode (runs WASM)
  10. Rectify state if needed (mainnet bug fixes)
  11. Send to block_store via AMQP RPC (1.5s timeout)
  12. Finalize node atomically
  13. Advance LIB via commit_node
  14. Broadcast events: block.accept, block.irreversible, fork_heads
  15. Broadcast per-transaction events
```

**Cost:** Slow — executes every smart contract in every transaction.

#### 2. `apply_block_delta` — Replay from Receipts

Used by the indexer when `verify-blocks=false` (default). This is the **trust-the-chain** optimization.

```
apply_block_delta(block, receipt, index_to):
  1. Create writable state node from parent
  2. For each state_delta_entry in receipt:
     - put_object(space, key, value) or remove_object(space, key)
  3. Finalize node
  4. Advance LIB (with fork tree buffer on Windows)
```

**Cost:** ~3,600 blocks/sec — no WASM execution, just state replay.

#### 3. `propose_block` — Block Production

Used by block producers to build new blocks.

```
propose_block(block, index_to):
  Same as submit_block, but:
  - If transactions fail, returns failed_transaction_indices instead of throwing
  - Block producer removes failed txns and retries
```

### Fork Resolution

The fork tree supports three algorithms:

| Algorithm | Behavior |
|-----------|----------|
| `fifo` | First block received at a given height wins |
| `block-time` | Block with earliest timestamp wins |
| `pob` | Block with highest proof-of-burn score wins |

The comparator is set during `controller.open()` and determines which fork becomes the canonical head.

### State Database (Fork Tree)

The state DB manages a tree of state nodes, each representing a block's state:

- **Root:** The Last Irreversible Block (LIB). Oldest node, fully committed.
- **Head:** The highest canonical block.
- **Writable nodes:** Created for new blocks, can be modified.
- **Finalized nodes:** Marked as canonical, cannot be modified.

Key operations:

| Operation | Description |
|-----------|-------------|
| `create_writable_node(parent, id, header)` | Fork off a new block state |
| `finalize_node(id)` | Mark block as canonical |
| `commit_node(id)` | Advance root (LIB), prune old state |
| `discard_node(id)` | Remove unfinalized block |
| `get_fork_heads()` | All non-finalized branch tips |
| `get_head()` | Current canonical head |
| `get_root()` | Current LIB |
| `get_node(id)` | Lookup node by block ID |
| `get_node_at_revision(height, id)` | Find ancestor at specific height |

---

## Indexer — Startup Sync

The indexer runs once at startup to synchronize chain state with block_store.

### Flow

```
1. RPC: block_store.get_highest_block() → target_height
2. Compare with controller.get_head_info().height → current_height
3. If current >= target: "Chain state is synchronized with block store" → done
4. Otherwise: index from current+1 to target
```

### Batching Strategy

| Iteration | Batch Size | Heights Requested |
|-----------|------------|-------------------|
| 1 | 50 | 1–50 |
| 2 | 100 | 51–150 |
| 3 | 200 | 151–350 |
| 4 | 400 | 351–750 |
| 5+ | 1,000 | 751–1750, etc. |

Batch size doubles each iteration, capping at 1,000. Uses two async queues:
- **Request queue** (100 slots): pending block_store RPC futures
- **Block queue** (100 slots): individual blocks ready to apply

### Verify Modes

| Mode | Function Called | Speed | Trust |
|------|-----------------|-------|-------|
| `verify-blocks=false` (default) | `apply_block_delta()` | ~3,600 blk/s | Trusts block receipts |
| `verify-blocks=true` | `submit_block()` | ~5–50 blk/s | Re-executes all WASM |

Progress logged every `max(10000, target/1000)` blocks.

---

## WASM VM — Fizzy Backend

### Architecture

```
Contract bytecode (base64 in state DB)
  → fizzy_parse() → Module (cached in LRU, 32 slots)
  → fizzy_resolve_instantiate() → Instance (512 memory pages max)
  → fizzy_execute() → Results
```

### Host Functions Exposed to WASM

| Function | Purpose |
|----------|---------|
| `invoke_thunk(id, ret, ret_len, arg, arg_len, written)` | Call immutable kernel function |
| `invoke_system_call(id, ret, ret_len, arg, arg_len, written)` | Call upgradeable system function |

### Two-Level Dispatch: Thunks vs System Calls

**Thunks** are immutable native C++ implementations registered at compile time:
- `apply_block`, `apply_transaction`, `apply_upload_contract_operation`
- `get_head_info`, `get_chain_id`, `get_caller`, `get_contract_id`
- Cryptographic: `hash`, `recover_public_key`, `verify_merkle_root`, `verify_vrf_proof`
- State: `put_object`, `get_object`, `remove_object`, `get_next_object`, `get_prev_object`
- Resource: `consume_block_resources`, `get_resource_limits`
- Events: `event`, `log`

**System calls** are upgradeable — stored in state DB and can be overridden by governance:
- Stored at `metadata::system_call_dispatch` space
- Maps system_call_id to a contract target (contract_id + entry_point)
- Checked first; falls back to thunk if no override exists

### Execution Context

Each block/transaction gets an execution context with:

| Field | Purpose |
|-------|---------|
| Stack frames (max 256) | Contract call chain with privilege tracking |
| Intent | read_only, block_application, transaction_application, block_proposal |
| State node | Writable or anonymous (read-only) |
| Cache | compute_bandwidth, descriptor_pool, system_call_table |

### Resource Metering

WASM execution is metered via **ticks** (compute bandwidth):
- Each WASM instruction costs ticks
- `consume_block_resources()` tracks disk, network, compute per block
- Transactions have `rc_limit` (resource credit limit)
- Blocks have global resource limits from chain state

---

## AMQP RPC Methods

| Method | Description |
|--------|-------------|
| `submit_block` | Full block validation + execution |
| `submit_transaction` | Apply transaction (mempool + validation) |
| `get_head_info` | Head block topology, LIB, block time, head state merkle root |
| `get_chain_id` | Chain identifier (SHA2-256 of genesis) |
| `get_fork_heads` | All fork tips + LIB |
| `read_contract` | Read-only contract call (no state changes) |
| `get_account_nonce` | Current transaction nonce for account |
| `get_account_rc` | Remaining resource credits for account |
| `get_resource_limits` | Global block resource limits |
| `invoke_system_call` | Call system call by ID or name |
| `propose_block` | Build block with transactions (for producers) |

## Broadcast Events

| Event | Trigger |
|-------|---------|
| `koinos.block.accept` | Block applied to chain |
| `koinos.block.irreversible` | LIB advanced |
| `koinos.block.forks` | Fork heads updated |
| `koinos.transaction.accept` | Transaction included in block |
| `koinos.transaction.fail` | Transaction failed during block application |
| `koinos.event.{contract}.{name}` | Contract-emitted events |

## Broadcast Subscriptions

| Event | Action |
|-------|--------|
| `koinos.block.accept` | Call submit_block with received block |

---

## Genesis Initialization

When the database is created for the first time:

1. Genesis callback receives the root state node
2. Writes all `genesis_data.entries()` (3,761 objects for mainnet):
   - System call dispatch table (maps syscall IDs to contract targets)
   - Protocol descriptors (protobuf schemas)
   - Compute bandwidth registry (resource costs per operation)
   - Resource limit data (global block limits)
   - Genesis public key
3. Verifies `genesis_key` exists in metadata
4. Calculates `chain_id = SHA2-256(genesis_data)` and stores it
5. Root node ID = zero hash (`0x1220000...000`)

Block 1's `header.previous` references this zero hash, establishing the chain anchor.

---

## Error Handling

- **Block validation failure (before finalization):** Node is discarded, exception thrown
- **Block failure after finalization:** Error logged, exception rethrown (this should not happen)
- **Transaction failure in submit_block:** Transaction marked as failed, block still applied
- **Transaction failure in propose_block:** Failed indices returned to producer for retry
- **AMQP timeout:** Logged as warning, operation may retry
- **WASM execution error:** Caught by host API, converted to koinos::exception

## Shutdown

1. Signal received (SIGINT/SIGTERM)
2. `stopped = true` flag set
3. IO contexts stopped
4. All worker threads joined
5. `controller.close()` — closes RocksDB
6. Process exits

---

## Rectify (Mainnet Bug Fixes)

The `rectify.cpp` file contains hardcoded state corrections for specific block heights where mainnet bugs produced incorrect state. These ensure all nodes compute identical state despite historical bugs. Corrections are applied as state delta overrides during block application.

---

## Windows-Specific Notes

- **MQ Fix:** The `publish()` function in koinos-mq has a dangling pointer bug where `std::to_string(expiration).c_str()` creates a temporary that's freed before AMQP uses it. Fixed by keeping the string alive in a local variable in the rebuilt `libkoinos_mq.lib`.
- **Fork Tree Buffer:** During indexing, `commit_node()` is prevented from advancing LIB too close to the current height to avoid "unknown previous block" errors (200-block buffer).
- **RocksDB:** Uses the same RocksDB build as Linux, cross-compiled via Hunter package manager.
