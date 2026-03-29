# Chain & Block Store Sync Architecture

How blocks flow through the Koinos node, from P2P network to local state.

## Service Communication

All microservices communicate via **AMQP message queues** (GarageMQ). No service talks directly to another — everything goes through AMQP with request/response correlation IDs.

Key services in the sync flow:
- **P2P**: Connects to peers, receives/sends blocks and transactions
- **block_store**: Persists blocks with their state deltas (RocksDB)
- **chain**: Maintains the canonical state database, applies blocks, executes WASM

## Block Flow: P2P Sync (Normal Operation)

When P2P receives a new block from a peer:

```
P2P receives block from peer
    │
    ├──► AMQP ──► block_store: stores block (including state deltas from producer)
    │
    └──► AMQP ──► chain: attempts to apply block
                    │
                    ├─ verify-blocks: false (default)
                    │   └─ Takes state deltas from block → applies directly
                    │      └─ Checks previous state merkle root
                    │         → if matches local state: accepts block ✓
                    │         → if mismatch: rejects block ✗ ("merkle mismatch")
                    │
                    └─ verify-blocks: true (safe mode)
                        └─ Ignores state deltas from block
                           └─ Re-executes all WASM contracts via fizzy VM
                              └─ Computes own state deltas → applies
                                 └─ Always correct, but ~100x slower
```

## Block Flow: Indexing on Startup (Batch Mode)

When chain starts, it checks block_store for blocks above its current height:

```
chain process starts
    │
    ├─ Opens state DB (RocksDB)
    │   → log: "Opened database at block - Height: X"
    │
    ├─ Connects to block_store via AMQP
    │   → log: "Retrieving highest block from block store"
    │
    ├─ If block_store.highest > chain.height:
    │   → log: "Indexing to target block - Height: Y"
    │   → Reads blocks X..Y sequentially from block_store (local I/O)
    │   → Applies state deltas in batch (~3000 blk/s with verify-blocks: false)
    │   → log: "Finished indexing N blocks, took Z seconds"
    │
    └─ Starts listening on AMQP for new blocks from P2P (one at a time)
```

This indexing-on-startup is the fastest sync path because:
1. Blocks are read from local disk (block_store), not network
2. Sequential batch processing without per-block AMQP overhead
3. State deltas are pre-computed and stored alongside blocks

## State Deltas

Each block stored in block_store contains:
- **Block header**: height, ID, timestamp, producer
- **Transactions**: the actual operations
- **State deltas**: the key-value changes that this block applies to the state DB

State deltas are deterministic — if you execute the same transactions on the same state, you get the same deltas. However, the **previous state merkle root** embedded in each block must match the local chain state for the deltas to be valid.

### When State Deltas Work (verify-blocks: false)
- Chain's local state matches the canonical state at that block height
- State deltas from block_store or P2P can be applied directly
- Very fast: ~3000 blk/s (batch) or ~5-20 blk/s (P2P, network-limited)

### When State Deltas Fail
- Chain's local state diverges from what the block expects
- The "previous state merkle root" check fails
- Error: `block previous state merkle mismatch`
- Chain rejects the block and cannot advance

Common causes of state divergence:
1. **After backup restore**: The restored state DB may not exactly match the canonical state at that block height
2. **After extended offline period**: Blocks received from P2P were produced on a different state history
3. **Fork resolution**: Temporary forks can leave the state DB in a non-canonical state

## verify-blocks Setting

Located in `{BASEDIR}/config.yml` under `chain.verify-blocks`:

```yaml
chain:
  verify-blocks: false  # Default: trust state deltas
  verify-blocks: true   # Safe mode: re-execute WASM for every block
```

### Performance Comparison

| Mode | Source | Speed | Notes |
|------|--------|-------|-------|
| Batch indexing (block_store) | Local disk | ~3000 blk/s | Sequential I/O, state deltas consistent |
| P2P + valid state deltas | Network | ~5-20 blk/s | Waiting for blocks from peers |
| P2P + WASM re-execution | Network | ~0.2-37 blk/s | Varies by block complexity (transactions, contract uploads) |
| P2P + merkle mismatch | Network | 0 blk/s | Infinite rejection loop |

Speed on macOS ARM64 with fizzy VM. Linux x86_64 is typically faster for WASM execution.

## Knodel Auto-Management

Knodel automatically manages verify-blocks across the backup/restore lifecycle:

### On Restore
1. Knodel restores chain/ and block_store/ from backup
2. Automatically enables `verify-blocks: true` in config.yml
3. Chain starts re-executing WASM to rebuild correct state

### During Sync
- Chain processes blocks via WASM (slower but always correct)
- Speed varies from 0.2 to 37 blk/s depending on block content
- Empty blocks (no transactions) are fast; contract-heavy blocks are slow

### On Sync Completion
1. Knodel monitors the gap between local and public chain height
2. When gap drops below 50 blocks (`VERIFY_BLOCKS_SYNC_THRESHOLD`)
3. Automatically disables `verify-blocks` and restarts chain
4. Chain resumes normal fast operation with state deltas

### Stall Detection
If chain stalls (gap > 100 blocks, height not advancing for 3 consecutive checks):
1. Knodel automatically restarts chain service
2. Chain re-indexes from block_store on startup (batch mode, fast)
3. This can recover from situations where P2P blocks are stuck in AMQP queues

## Key Files

- **chain state DB**: `{BASEDIR}/chain/blockchain/` (RocksDB, ~1GB)
- **block_store DB**: `{BASEDIR}/block_store/db/` (RocksDB, ~38GB)
- **chain config**: `{BASEDIR}/config.yml` (verify-blocks setting)
- **chain logs**: `{BASEDIR}/chain/logs/`
- **block_store logs**: `{BASEDIR}/block_store/logs/`
- **Knodel chain-sync**: `src/app/chain-sync.ts` (auto-restart + verify-blocks toggle)
- **Knodel backup-service**: `electron/lib/backup-service.ts` (verify-blocks on restore)

## Practical Observations

From real-world sync testing (March 2026, mainnet):

1. **Backup restore with ~15K block gap**: Initial indexing of 60 blocks from block_store was instant. Subsequent P2P sync hit merkle mismatches at multiple points.

2. **verify-blocks: true recovery**: Chain processed blocks at 0.4-37 blk/s. Speed varied dramatically — empty blocks processed in batches quickly, while blocks with contract uploads or complex transactions dropped to < 1 blk/s.

3. **State "healing"**: After verify-blocks: true rebuilt the state through the inconsistent zone (~900 blocks), switching back to verify-blocks: false worked — state deltas from P2P matched the now-correct local state.

4. **Network block rate**: Koinos mainnet produces ~20-25 blocks per minute. Even with valid state deltas, P2P sync is bounded by this rate when near the chain head.
