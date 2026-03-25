# Koinos Chain State Architecture

Technical reference for the chain state database, merkle tree, and block application pipeline.

## Database Backend

The chain uses **`state_db`** — a custom Koinos state management library that implements a tree of state nodes with merkle proofs. Internally it uses **RocksDB** as the persistence layer.

- Data directory: `<basedir>/chain/blockchain/`
- Typical size: ~1 GB for a fully synced node
- Source: `src/koinos/chain/controller.cpp:120` — `state_db::database _db`

## What the Chain State Contains

The state is a **complete snapshot of the blockchain at a given block height**. It stores:

| Category | Key examples | Description |
|---|---|---|
| System metadata | `head_block`, `chain_id`, `genesis_key` | Core chain identity and head pointer |
| Resource limits | `resource_limit_data`, `max_account_resources` | Compute/network/disk bandwidth caps |
| Contract bytecode | `contract_bytecode` space | WASM code for every deployed contract |
| Contract metadata | `contract_metadata` space | ABI, privileges, authorization |
| Contract state | Per-contract zones | Token balances, governance data, etc. |
| Transaction nonces | `transaction_nonce` space | Per-account replay protection |
| System call dispatch | `system_call_dispatch` space | Override table for system calls |
| Protocol descriptor | `protocol_descriptor` | Current protocol version |

Source: `src/koinos/chain/state.hpp` and `src/koinos/chain/state.cpp:10-90`

## Data Structure

### Key-Value Schema

```
object_space(zone, id, system_flag) -> key -> serialized_value
```

- **zone**: identifies the contract (or kernel for system objects)
- **id**: sub-space within the contract
- **system_flag**: kernel vs user space
- **key**: arbitrary bytes chosen by the contract
- **value**: protobuf-serialized data

### Merkle Tree of State Nodes

Each block produces a **state node** — a snapshot of all key-value pairs after applying that block. State nodes form a tree:

```
Genesis ──► Block 1 ──► Block 2 ──► Block 3 (head)
                  │
                  └──► Block 2' (fork, pruned)
```

Each state node:
- Has a `parent_id` (the previous block)
- Tracks **delta entries** (what changed vs the parent)
- Computes a **merkle root** over the entire state

### State Node Interface

```cpp
state_node_ptr           // Writable node (during block execution)
abstract_state_node_ptr  // Base read/write interface
anonymous_state_node_ptr // Read-only snapshot (for RPC queries)
```

Key operations:
- `put_object(space, key, value)` — write, automatically tracks delta
- `get_object(space, key)` — read
- `remove_object(space, key)` — delete, tracks delta
- `get_delta_entries()` — returns all changes since parent
- `merkle_root()` — computed hash over entire state

Source: `src/koinos/chain/execution_context.hpp:32-36`, `src/koinos/chain/system_calls.cpp:1043-1091`

## Relationship: Chain State vs Block Store

These are **separate microservices** communicating via AMQP:

```
┌─────────────────────┐            ┌──────────────────────┐
│     CHAIN STATE     │   AMQP     │     BLOCK STORE      │
│                     │◄──────────►│                      │
│  Merkle tree of     │            │  Raw blocks +        │
│  state nodes        │            │  receipts (deltas)   │
│                     │            │                      │
│  ~1 GB (RocksDB)    │            │  ~38 GB (RocksDB)    │
│  Ephemeral —        │            │  Permanent —         │
│  can be rebuilt     │            │  source of truth     │
└─────────────────────┘            └──────────────────────┘
```

**Block Store** persists blocks and their receipts long-term. It is the source of truth for what happened on-chain.

**Chain State** maintains the *computed* live state. It can be destroyed and rebuilt from the block store by replaying all blocks.

Source: `controller.cpp:425-445` (block store RPC integration)

## Block Application Pipeline

### Normal Path (verify-blocks: true)

```
1. Block arrives ──► controller.cpp:298
2. Validate previous_state_merkle_root matches parent state
3. Create child state_node from parent
4. Execute each transaction:
   ├── Run WASM contract code
   ├── put_object / remove_object track deltas automatically
   └── Resource metering (compute, network, disk)
5. Generate receipt:
   ├── Collect state_delta_entries from state_node
   ├── Collect events from chronicler
   ├── Collect logs
   └── Record resource consumption
6. Finalize: _db.finalize_node() computes merkle root
7. Set receipt.state_merkle_root = node.merkle_root()
8. Send block + receipt to block_store via AMQP
```

Source: `controller.cpp:298-632`, `system_calls.cpp:111-166`, `system_calls.cpp:235-382`

### Fast Sync Path (verify-blocks: false)

```
1. Block arrives with pre-computed receipt (from block_store)
2. Validate previous_state_merkle_root matches parent state
3. Create child state_node from parent
4. Skip WASM execution — apply receipt deltas directly:
   for each delta in receipt.state_delta_entries:
       state_node.put_object(delta.space, delta.key, delta.value)
5. Finalize: compute merkle root from applied deltas
6. Advance to next block
```

Source: `controller.cpp:634-780` (`apply_block_delta()`)

This is ~70x faster (~3600 blocks/sec vs ~50 blocks/sec) because it skips WASM execution entirely.

## Merkle Root Validation

Each block header contains three merkle roots:

```
Block Header {
    previous_state_merkle_root  // Parent block's final state root
    transaction_merkle_root     // SHA256 tree of transaction hashes
    operation_merkle_root       // SHA256 tree of operations per tx
}
```

The critical validation at block application time:

```cpp
// controller.cpp:392-395
if (block.previous_state_merkle_root != parent_node->merkle_root()) {
    // "block previous state merkle mismatch"
    return FAILURE;
}
```

After successful execution:

```cpp
// controller.cpp:487-488
_db.finalize_node(block_id);
receipt.state_merkle_root = _db.get_node(block_id)->merkle_root();
```

Source: `system_calls.cpp:1222-1269` (verify_merkle_root implementation)

## Receipt Structure

```protobuf
block_receipt {
    id                    // Block hash
    height                // Block number
    state_delta_entries[] {
        object_space {
            zone          // Contract ID
            id            // Sub-space
            system        // Kernel flag
        }
        key               // Object key
        value             // New value (empty = delete)
    }
    state_merkle_root     // Computed after finalization
    events[]              // Contract-emitted events
    logs[]                // Execution logs
    disk_storage_charged  // Resource metrics
    network_bandwidth_charged
    compute_bandwidth_charged
}
```

## Comparison with Other Blockchains

The receipt + merkle state pattern is standard across the industry, but implementations vary:

| Blockchain | State Model | Receipt Equivalent | Key Difference |
|---|---|---|---|
| **Ethereum** | Patricia Merkle Trie | Transaction receipts (logs, status, gas) | Receipts do NOT include state deltas — must re-execute to reconstruct state. Has a separate "receipt trie" |
| **Bitcoin** | UTXO set | None (implicit) | No smart contracts, no receipts. The "state" is simply the set of unspent transaction outputs |
| **Solana** | Account snapshots | Transaction status | No explicit deltas. Uses periodic full snapshots instead of incremental deltas |
| **Cosmos/Tendermint** | IAVL+ Merkle Tree | ABCI `DeliverTx` responses | Very similar to Koinos. `DeliverTx` returns events and state changes |
| **Near** | State trie | Execution outcomes | Each receipt is an "execution outcome" with logs, tokens burned, and state changes |

### What Makes Koinos Different

1. **State deltas stored in receipts**: In Ethereum, state deltas are NOT stored in receipts (only logs/events). Reconstructing state requires full re-execution. Koinos stores complete `state_delta_entries` in each receipt, enabling fast sync without WASM re-execution.

2. **Microservice separation**: Most blockchains run state and block storage in the same process. Koinos separates them into independent services (chain, block_store) communicating via AMQP. More modular but adds operational complexity.

3. **Aggressive fast sync**: Ethereum's "snap sync" requires merkle proofs for validation. Koinos with `verify-blocks: false` trusts receipt deltas without proof verification — much faster (~70x) but vulnerable to corrupt receipts (as seen in backup restore scenarios).

4. **WASM execution model**: Like Near and Cosmos, Koinos uses WASM for contract execution. Unlike Ethereum's EVM which is stack-based, WASM provides near-native performance and allows contracts to be written in multiple languages (C++, AssemblyScript, etc.).

## Merkle Mismatch: Deep Investigation

### The Symptom

A node restored from backup and synced with `verify-blocks: false` gets stuck at a specific block:

```
Block application failed - Height: 34309561
  with reason: block previous state merkle mismatch
```

Switching to `verify-blocks: true` allows the node to pass the block without errors.

### How the Error Occurs

The error comes from `controller.cpp:392-394`:

```cpp
KOINOS_ASSERT(
    block.header().previous_state_merkle_root()
        == util::converter::as<std::string>(parent_node->merkle_root()),
    state_merkle_mismatch_exception,
    "block previous state merkle mismatch"
);
```

This compares:
- **A**: `block.header().previous_state_merkle_root` — fixed value from the block header (immutable, part of consensus)
- **B**: `parent_node->merkle_root()` — computed by the local `state_db` from the accumulated state

When A != B, the error fires.

### Critical Code Path Discovery

The indexer (`indexer.cpp:234-241`) dispatches blocks differently based on `verify-blocks`:

```cpp
if (_verify_blocks) {
    // Path 1: Full execution
    _controller.submit_block(submit_block, _target_head.height());
    // → apply_block() → executes WASM → validates merkle (line 392)
} else {
    // Path 2: Fast sync
    _controller.apply_block_delta(block_item.block(), block_item.receipt(), _target_head.height());
    // → applies receipt deltas directly → NO merkle validation
}
```

**Key insight**: `apply_block_delta()` (controller.cpp:634-780) applies deltas and calls `_db.finalize_node()` to compute a merkle root, but **never validates it against the block header**. The merkle validation only exists in `apply_block()` (line 392).

### When the Error Actually Triggers

The error does NOT occur during indexing. It occurs when:

1. Indexer finishes replaying the block_store with `apply_block_delta` (no validation)
2. Node starts receiving **new blocks via P2P**
3. New blocks arrive via `submit_block` → `apply_block` → **validates merkle**
4. The first new block's `previous_state_merkle_root` doesn't match the local state → mismatch

### Investigation: Are the Deltas Corrupt?

#### Test 1: Internal Receipt Consistency

Verified that each block's `receipt.state_merkle_root` matches the next block's `header.previous_state_merkle_root`:

```
Block 34,309,558: receipt_merkle = EiCpdE...
Block 34,309,559: prev_state     = EiCpdE...  ✅ match
Block 34,309,559: receipt_merkle = EiCt8b...
Block 34,309,560: prev_state     = EiCt8b...  ✅ match
Block 34,309,560: receipt_merkle = EiDkZb...
Block 34,309,561: prev_state     = EiDkZb...  ✅ match
```

Verified 1,000 blocks around the problem area — **0 mismatches**. The receipts form a valid chain internally.

Tool: `scripts/verify-backup-receipts.py`

#### Test 2: Cross-Reference with Public Node

Compared state_delta_entries from the local block_store against a public Koinos node (api.koinos.io):

```
Block 34,309,550: local_delta_hash=db2119a4  public_delta_hash=db2119a4  ✅ match
Block 34,309,551: local_delta_hash=7b817605  public_delta_hash=7b817605  ✅ match
...
Block 34,309,560: local_delta_hash=6a54e74e  public_delta_hash=6a54e74e  ✅ match
```

Sampled 50 blocks across the entire 34M block range — **all deltas identical**.

Tool: `scripts/compare-receipts.py`

#### Test 3: Public Node Receipt Structure

Discovered that the public node does NOT store `state_merkle_root` in its receipts:

```
Local receipt keys:  [id, height, ..., state_merkle_root, state_delta_entries]
Public receipt keys: [id, height, ..., state_delta_entries]  ← no merkle root
```

The public node (and likely the backup source) never computed merkle roots — they only stored deltas.

### Root Cause: state_db Merkle Computation Divergence

**The deltas are correct** (verified against public node), but when `state_db` applies them sequentially via `apply_block_delta`, the resulting merkle tree diverges from what the block headers expect.

This happens because the merkle root depends on:
1. The exact `state_db` library version and its internal merkle tree algorithm
2. The order and method of applying deltas to the tree
3. Any accumulated floating-point or hash computation differences

The backup's block headers contain merkle roots that were computed by a specific version of `state_db` running on the node that originally produced those blocks. If the local `state_db` (compiled from source) computes the merkle tree slightly differently, the roots diverge even with identical deltas.

**Evidence**: This problem occurs on both macOS ARM64 and Windows x86_64, ruling out platform-specific compilation issues. It points to a `state_db` version or algorithm difference.

### Why verify-blocks: true Works

With `verify-blocks: true`:
1. The chain re-executes WASM for each transaction
2. Computes deltas from scratch (which are identical to the backup's)
3. Computes the merkle root from the freshly-built state
4. The merkle root is **internally consistent** with the state it just built
5. When the next block arrives, its `previous_state_merkle_root` matches because the chain's state_db produced a consistent merkle chain

The chain essentially ignores the backup's merkle roots and builds its own consistent chain.

## Backup Restore and Receipt Contamination

### The Problem

When restoring from a third-party backup and syncing with `verify-blocks: false`, the chain trusts the receipt deltas stored in the block_store. Even if the deltas are correct, the local `state_db` may compute different merkle roots than the original node, causing a mismatch when the first P2P block arrives.

### Mixed Sync Scenario

If you synced part of the chain with `false` and then switched to `true` after hitting a mismatch, your local block_store ends up in a mixed state:

```
Blocks 0 → N:       receipts from backup (deltas correct, merkle roots from original node)
Blocks N+1 → tip:   receipts re-computed locally (deltas + merkle roots from local state_db)
```

With `verify-blocks: true`, the chain re-executes WASM for each block, computes correct deltas, and **overwrites the receipts in the local block_store**. So the re-synced range is clean, but everything before the switch point still has the original backup receipts.

### Implications

- **Future chain reset**: If you ever delete `<basedir>/chain/` and replay from the local block_store with `verify-blocks: false`, you will hit the same mismatch at the same point — the backup receipts lack locally-computed merkle roots.
- **Current chain state**: The live chain state IS correct if you synced past the bad range with `verify-blocks: true`. The merkle tree is consistent from that point forward.

### Creating a Clean Backup

The only way to produce a backup that works reliably with `verify-blocks: false`:

1. **Full re-sync with `verify-blocks: true`** from block 0 to the chain tip (this can take days/weeks for 34M+ blocks with WASM execution)
2. **Stop all services**
3. **Copy the `block_store/` directory** — this is your clean backup with all receipts re-computed by your local state_db

Alternatively, obtain a backup from a node running the exact same `state_db` version.

### Pragmatic Approach

If a full re-sync is not feasible:
- Keep `verify-blocks: true` until you reach the chain tip
- Your chain state will be correct for node operation
- Accept that a future restore from this block_store would need `verify-blocks: true` for the pre-existing range

## Diagnostic Tools

| Script | Purpose |
|---|---|
| `scripts/verify-backup-receipts.py` | Check internal receipt consistency (merkle chain between consecutive blocks) |
| `scripts/compare-receipts.py` | Cross-reference local receipts against a public Koinos node |

## Key Source Files

| File | Purpose |
|---|---|
| `controller.cpp:298-632` | Main block processing loop |
| `controller.cpp:634-780` | `apply_block_delta()` — fast sync replay |
| `controller.cpp:425-445` | Block store RPC integration |
| `controller.cpp:484-501` | State finalization + merkle root |
| `system_calls.cpp:111-166` | Receipt generation |
| `system_calls.cpp:235-382` | `apply_block` implementation |
| `system_calls.cpp:1043-1091` | put/get/remove object (state modifications) |
| `system_calls.cpp:1222-1269` | `verify_merkle_root` |
| `state.hpp` / `state.cpp` | Object space definitions |
| `execution_context.hpp` | State node type aliases |
