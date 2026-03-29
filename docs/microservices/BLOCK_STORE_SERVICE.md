# Block Store Service — Exhaustive Technical Reference

The block store (`koinos-block-store.exe`) is the persistent storage layer for blockchain blocks. It stores full blocks and receipts in a key-value database and provides efficient retrieval by height or ID using a skip-list data structure.

## Binary & Version

- **Binary:** `koinos-block-store.exe` (Go)
- **Version:** v1.1.0
- **Source:** `vendor/koinos/koinos-block-store/`

---

## Startup Sequence

1. Parse CLI flags and YAML config
2. Initialize logging
3. Open Badger DB at `{basedir}/block_store/db`
4. If `--reset`: wipe database
5. Initialize highest block metadata (key `0x01`) if not present — genesis at height 0
6. Connect AMQP request handler with exponential backoff
7. Subscribe to `koinos.block.accept` broadcast
8. Start stats reporter (logs block additions every 60 seconds)
9. Wait for shutdown signal

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--reset, -r` | false | Reset database |
| `--instance-id, -i` | auto | Instance identifier |
| `--log-level, -l` | `info` | Log level |
| `--jobs, -j` | CPU cores | RPC worker threads |

---

## Storage Engine — Badger DB

Badger is an LSM-tree key-value store written in Go:

- **SST files:** Sorted string tables for indexed lookups
- **Value log (vlog):** Append-only file for large values
- **Pre-allocation:** vlog files are pre-allocated at 2 GB each
- **Compaction:** Background LSM compaction merges levels

### Data Layout

| Key | Value | Description |
|-----|-------|-------------|
| `0x01` | `BlockTopology` protobuf | Highest block metadata |
| `block_id` (multihash) | `BlockRecord` protobuf | Full block + receipt + skip-list pointers |

### BlockRecord Structure

```protobuf
BlockRecord {
  block: Block           // Full block with header + transactions
  receipt: BlockReceipt  // Transaction receipts + state deltas
  previous_block_ids: []bytes  // Skip-list ancestor pointers
}
```

---

## Skip-List Ancestor System

The block store uses a **deterministic skip-list** for O(log n) ancestor lookups. This is critical for validating block ancestry without scanning the full chain.

### How It Works

Each block at height `h` stores pointers to ancestors at heights determined by powers of 2:

```
h - 1       (always)
h - 2       (if h is divisible by 2)
h - 4       (if h is divisible by 4)
h - 8       (if h is divisible by 8)
...
```

The number of pointers equals `trailing_zeros(h) + 1`.

### Examples

| Block Height | Binary | Trailing Zeros | Ancestor Heights |
|-------------|--------|----------------|------------------|
| 1 | 0001 | 0 | [0] |
| 2 | 0010 | 1 | [1, 0] |
| 3 | 0011 | 0 | [2] |
| 4 | 0100 | 2 | [3, 2, 0] |
| 8 | 1000 | 3 | [7, 6, 4, 0] |
| 12 | 1100 | 2 | [11, 10, 8] |
| 16 | 10000 | 4 | [15, 14, 12, 8, 0] |

### Average pointers per block: ~2

### Lookup Algorithm (`getAncestorIDAtHeight`)

To find the ancestor of block B at target height T:

```
current = B
while current.height > T:
    index = getPreviousHeightIndex(T, current.height)
    current = lookup(current.previous_block_ids[index])
return current
```

`getPreviousHeightIndex` uses binary search to find the largest index `i` where `previous_heights[i] >= target`.

---

## RPC Methods

### `GetHighestBlock`

Returns the topology (ID, height, previous) of the highest stored block.

- **Request:** empty
- **Response:** `{ topology: { id, height, previous } }`
- **Storage:** Direct read from key `0x01`

### `GetBlocksByHeight`

Retrieves blocks at consecutive heights starting from a given ancestor height.

- **Request:** `{ head_block_id, ancestor_start_height, num_blocks, return_block, return_receipt }`
- **Response:** `{ block_items: [{ block_id, block_height, block?, receipt? }] }`
- **Limit:** Max 1,000 blocks per request
- **Algorithm:**
  1. Look up `head_block_id` in DB
  2. Navigate to `ancestor_start_height` using skip-list
  3. Walk forward through the chain collecting blocks
  4. Return requested fields (block data and/or receipt)

### `GetBlocksByID`

Retrieves blocks by their IDs.

- **Request:** `{ block_ids: [], return_block, return_receipt }`
- **Response:** `{ block_items: [{ block_id, block_height, block?, receipt? }] }`
- **Limit:** Max 1,000 blocks per request
- **Algorithm:** Direct key-value lookup for each ID

### `AddBlock`

Stores a new block in the database.

- **Request:** `{ block_to_add: { block_id, block, receipt } }`
- **Response:** empty
- **Validation:**
  1. Block, header, and ID must be present
  2. Build skip-list pointers for the new block height
  3. For each pointer: look up ancestor block at that height via skip-list
  4. If ancestor not found: **reject with "Block not present"** error
  5. Marshal block + receipt + pointers as `BlockRecord`
  6. Store in Badger DB
  7. If block is highest: update metadata at key `0x01`

### Skip-List Validation on AddBlock

This is the critical validation step. When adding block at height H:

```
for each power-of-2 interval:
    ancestor_height = H - (1 << i)
    ancestor = getAncestorIDAtHeight(parent, ancestor_height)
    if ancestor not found:
        REJECT "Block not present"
    store ancestor.id in previous_block_ids
```

This ensures the full skip-list is consistent and all referenced ancestors exist in the database.

---

## AMQP Integration

### RPC Endpoint

- **Queue:** `koinos.rpc.block_store` (durable)
- **Exchange:** `koinos.rpc` (direct, durable)
- **Routing key:** `block_store`

### Broadcast Subscription

| Event | Handler |
|-------|---------|
| `koinos.block.accept` | Extracts block + receipt from `BlockAccepted` message, calls `AddBlock`. Errors logged but don't crash the service. |

### Message Size Limit

536 MB maximum per AMQP message.

---

## Disk Usage

Block store is the largest data consumer:

| Metric | Value |
|--------|-------|
| Average block size | ~10 KB |
| 34.4M blocks (full mainnet) | ~350 GB |
| Badger vlog pre-allocation | 2 GB per file |
| Initial empty DB | ~2 GB (pre-allocated vlog) |

---

## Periodic Reporting

Every 60 seconds, logs:
```
Recently added N block(s)
```

This counter resets after each report.

---

## Error Handling

- **AddBlock with missing ancestor:** Returns error "Block not present" — block is silently rejected
- **Badger DB errors:** Fatal, service exits
- **AMQP disconnection:** Automatic reconnection with exponential backoff
- **Oversized response:** Returns error if serialized response > 536 MB

---

## Reset Behavior

`--reset` or `-r` flag:
- Deletes all Badger DB data files
- Re-initializes highest block metadata to genesis (height 0, zero hash ID)
- **Warning:** This requires re-syncing all blocks from P2P
