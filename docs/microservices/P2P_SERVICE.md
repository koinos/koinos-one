# P2P Service — Exhaustive Technical Reference

The P2P service (`koinos-p2p.exe`) manages peer-to-peer networking for the Koinos node. It discovers peers, synchronizes blocks from the network, gossips new blocks and transactions, and serves block data to other nodes.

## Binary & Version

- **Binary:** `koinos-p2p.exe` (Go)
- **Version:** v1.3.0
- **Source:** `vendor/koinos/koinos-p2p/`

---

## Startup Sequence

1. Parse CLI flags and YAML config
2. Initialize logging
3. Connect AMQP client to broker
4. Verify connectivity to `block_store` and `chain` services (ping)
5. Generate or load libp2p identity (from `--seed` or random)
6. Configure libp2p host:
   - NAT port mapping (UPnP)
   - Auto relay for NATed hosts
   - NAT hole punching
   - Auto NAT detection
7. Start listening on configured multiaddress
8. Register AMQP request handler
9. Start connection manager — begin connecting to seed nodes
10. Start gossip subsystem (GossipSub)
11. Start periodic peer status logging (every 60 seconds)

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--listen, -L` | `/ip4/127.0.0.1/tcp/8888` | libp2p listen address |
| `--seed, -s` | random | Seed for peer ID generation |
| `--peer, -p` | (see below) | Seed node multiaddresses (repeatable) |
| `--checkpoint, -c` | none | Required checkpoints as `height:blockid` |
| `--disable-gossip, -g` | false | Disable block/tx gossip |
| `--force-gossip, -G` | false | Force gossip always on |
| `--jobs, -j` | CPU cores | RPC worker threads |
| `--dht-local-discovery` | false | Enable local DHT discovery |

### Default Seed Nodes (Mainnet)

```yaml
p2p:
  peer:
    - /dns4/seed.koinosblocks.com/tcp/8888/p2p/QmUNURuZxSu5wLnmBNJdwGtwjLmV5JxGhu4uNSAS8ZNcze
    - /dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmQVBuhg2j2BV1hvMMNoLVrZ9T9gPb8F9bRgifCspBz6WW
    - /dns4/seed-east.burnkoin.com/tcp/8888/p2p/QmYAC9nxqgVt2p8NvmxNFsoMpQS7c4zEBmsZndEBTRHNu4
```

---

## Connection Manager

### Peer Connection Lifecycle

```
1. TCP connection established (libp2p)
   ↓
2. PeerConnection object created
   ↓
3. Handshake loop (retries every 6s):
   a. Exchange protocol versions
   b. Exchange chain IDs (must match)
   c. Get peer's head block
   d. Validate all checkpoints match peer's chain
   ↓
4. Sync loop (fires every 1-10s):
   a. Get peer's head block
   b. If peer is ahead: request missing blocks
   c. Apply blocks to local chain
   ↓
5. On disconnect: cancel context, cleanup
```

### Seed Node Reconnection

Every 10 seconds, attempts to reconnect to any disconnected seed nodes.

### Peer Status Logging

Every 60 seconds, logs:
```
My address: /ip4/X.X.X.X/tcp/8888/p2p/QmXXX
Connected peers:
 - /ip4/A.A.A.A/tcp/4001/p2p/12D3KooWXXX
 - /ip4/B.B.B.B/tcp/4001/p2p/12D3KooWYYY
   and N more...
```

---

## Block Sync Protocol

### Sync Flow (per peer)

```
1. Get peer's head block → (head_id, head_height)
2. Get local chain info → (local_head, local_lib)
3. If peer_height <= local_lib: skip (peer is behind)
4. If we already know peer's head: skip (already synced)
5. Verify chain connectivity:
   - Get ancestor at local_lib height from peer
   - Must match our LIB exactly (reject if mismatch)
6. Calculate batch: request blocks [lib+1, lib+batch_size]
7. Send GetBlocks RPC to peer
8. Apply each block locally via submit_block
9. Update sync state
10. Repeat until caught up
```

### Batch Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BlockRequestBatchSize` | 500 | Max blocks per request |
| `BlockRequestTimeout` | 150s | Timeout for batch request |
| `SyncedBlockDelta` | 5 | Considered synced if within N blocks of peer |
| `SyncedSleepTime` | 10s | Sleep between sync checks when synced |

### Remote Peer RPC Methods

| Method | Description |
|--------|-------------|
| `GetChainID()` | Returns peer's chain ID (multihash) |
| `GetHeadBlock()` | Returns (block_id, height) |
| `GetAncestorBlockID(head, height)` | Returns ancestor ID at exact height |
| `GetBlocks(head, start, count)` | Returns array of blocks |

---

## Gossip System — GossipSub

### Topics

| Topic | Buffer Size | Content |
|-------|-------------|---------|
| `koinos.blocks` | 8 messages | New blocks |
| `koinos.transactions` | 32 messages | New transactions |

### Dynamic Gossip Toggle

Gossip is automatically enabled/disabled based on sync state:

| Condition | Gossip State |
|-----------|-------------|
| Has peers AND head block < 45s old | **Enabled** |
| No peers OR head block > 45s old | **Disabled** |
| `--force-gossip` flag | Always enabled |
| `--disable-gossip` flag | Always disabled |

Check interval: every 1 second.

### Block Validation (on receive)

1. Deserialize block from protobuf
2. Filter out self-published messages
3. Check fork bomb limits
4. Pass to applicator for chain-aware validation
5. Report peer errors for invalid blocks

### Fork Bomb Detection

Tracked per `(height, signer, parent_block)` tuple:
- **Max 3 unique blocks** per tuple allowed
- Exceeding limit triggers immediate disconnect with high error score (500 points)
- Records purged when LIB advances past their height

---

## Applicator — Block/Transaction Queue

The applicator prevents duplicate application and manages ordering.

### Block Application Rules

1. Cannot apply if height > highest_known + 1 (waiting for parent)
2. Cannot apply if parent is still pending
3. Fork watchdog check before adding
4. Reject blocks > 4 seconds in the future (wait for timestamp)
5. Only one copy of each block applied

### Transaction Application Rules

1. Nonce ordering enforced (wait for previous nonce)
2. Tracked by payee/payer + nonce
3. Auto-expire after 30 seconds
4. Duplicate detection cache

### Concurrency

- Async goroutine channels for non-blocking enqueue
- Error channels return results to callers
- Multiple callers per block (gossip + peer sync + broadcast)
- Application jobs: `min(8, CPU cores)`

### Pending Limits

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MaxPendingBlocks` | 2,500 | Max blocks waiting to apply |
| `MaxHeightDelta` | 60 | Max height above current head for pending blocks |
| `MaxPendingTransactions` | 100,000 | Max pending transaction entries |
| `DelayThreshold` | 4s | Reject blocks timestamped this far in future |

---

## Peer Error Handling & Scoring

### Error Score System

Each peer (tracked by IP address) has an error score with exponential decay:

```
score *= e^(-ln(2) * elapsed_time / half_life)
```

| Parameter | Default |
|-----------|---------|
| Half-life | 30 minutes |
| Reconnect threshold | 50 points |
| Disconnect threshold | ~100+ points |

### Error Score Values

| Error Type | Score | Description |
|------------|-------|-------------|
| `BlockApplication` | 100 | Block failed validation |
| `BlockApplicationTimeout` | 150 | Chain took too long to process |
| `UnknownPreviousBlock` | 25 | Missing parent block |
| `Deserialization` | 100 | Malformed message |
| `ForkBomb` | 500 | Fork bomb detected (instant disconnect) |
| `ChainIDMismatch` | 2,000 | Wrong network (instant disconnect) |
| `ProtocolMismatch` | 2,000 | Incompatible protocol version |
| `CheckpointMismatch` | 2,000 | Checkpoint validation failed |
| `BlockIrreversibility` | 0 | Logged only, no penalty |

---

## AMQP Integration

### Outbound RPC

| Service | Methods Called |
|---------|---------------|
| `chain` | `submit_block`, `submit_transaction`, `get_head_info`, `get_chain_id`, `get_fork_heads` |
| `block_store` | `get_blocks_by_height`, `get_blocks_by_id` |

### Broadcast Subscriptions

| Event | Action |
|-------|--------|
| `koinos.block.accept` | Forward to gossip for publishing |
| `koinos.transaction.accept` | Forward to gossip for publishing |
| `koinos.block.forks` | Update fork heads tracking |

### Broadcast Publications

| Event | Trigger |
|-------|---------|
| Gossip status changes | Notify local services of gossip enable/disable |

---

## Transaction Cache

Prevents re-gossiping recently seen transactions:

- Map-based duplicate detection
- Time-based auto-expiration (5 minutes default)
- Sorted by insertion time for efficient pruning
- Checked before applying gossip transactions

---

## libp2p Configuration

| Feature | Status | Description |
|---------|--------|-------------|
| NAT UPnP | Enabled | Automatic port mapping |
| Auto relay | Enabled | Static relays for NATed hosts |
| Hole punching | Enabled | NAT traversal |
| Auto NAT | Enabled | Detect public reachability |
| GossipSub | Enabled | PubSub routing for blocks/transactions |
| DHT local discovery | Optional | Local network peer discovery |

---

## Timeouts

| Operation | Timeout |
|-----------|---------|
| Local RPC (chain/block_store) | 30s |
| Block application (submit_block) | 60s |
| Remote peer RPC | 6s |
| Block batch request (500 blocks) | 150s |
| Handshake retry | 6s |

---

## Known Issues

- **Block application timeout during sync:** When syncing from genesis, WASM contract execution in `submit_block` can take too long, causing P2P to timeout and penalize the peer. This is why the indexer's `apply_block_delta` approach (no WASM) is preferred for initial sync.
- **Seed node peer ID changes:** If a seed node rotates its key, the configured peer ID becomes stale and connections fail with "peer id mismatch". Update `config.yml` with the new peer ID.
