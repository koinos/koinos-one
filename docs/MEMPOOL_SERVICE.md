# Mempool Service — Exhaustive Technical Reference

The mempool (`koinos_mempool.exe`) manages pending (unconfirmed) transactions. It tracks per-account resource reservations, enforces nonce ordering, handles fork-aware transaction state, and serves pending transactions to block producers.

## Binary & Version

- **Binary:** `koinos_mempool.exe` (C++20, MSVC on Windows)
- **Version:** v1.5.0
- **Source:** `vendor/koinos/koinos-mempool/`

---

## Startup Sequence

1. Parse CLI flags and YAML config
2. Initialize logging
3. Open state database for pending transaction tracking
4. Connect AMQP client
5. Register AMQP request handler
6. Subscribe to broadcast events
7. Start transaction pruning timer (every 1 second)
8. Wait for shutdown signal

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--transaction-expiration` | 120 | Seconds before pending txns expire |
| `--fork-algorithm` | `fifo` | Fork resolution (fifo, pob, block-time) |
| `--jobs` | CPU cores | Worker threads |
| `--instance-id` | auto | Instance identifier |
| `--log-level` | `info` | Log level |

---

## Core Data Model

### State Spaces (state_db)

The mempool uses an in-memory state_db with fork support, organized in 5 object spaces:

| Space | Purpose |
|-------|---------|
| `mempool_metadata` | Global state (counters, timestamps) |
| `pending_transaction` | Transaction storage (keyed by sequence number) |
| `transaction_index` | ID → sequence number lookup |
| `address_resources` | Per-account RC reservation tracking |
| `account_nonce` | Nonce conflict detection |

### Per-Account Resource Tracking

For each account with pending transactions:

```
AddressResource {
  max_rc: uint64    // Maximum RC available for this account
  current_rc: uint64 // RC remaining after all pending txns
}
```

Resource check formula (uses int128 for overflow safety):
```
new_rc = current_rc + (new_max_rc - stored_max_rc) - trx_rc_limit
if new_rc < 0: REJECT insufficient resources
```

---

## Transaction Lifecycle

### Adding a Transaction

```
add_pending_transaction(txn, height, payer_rc, max_payer_rc, trx_rc_limit):
  1. Check transaction doesn't already exist (transaction_index lookup)
  2. Check account nonce is valid (not duplicate)
  3. Check per-account resource limit:
     - Load address_resource for payer
     - Calculate if payer can afford trx_rc_limit
  4. Store transaction in pending_transaction space
  5. Update transaction_index
  6. Update address_resources for payer
  7. Update account_nonce tracking
  8. Return success
```

### Retrieving Pending Transactions

```
get_pending_transactions(limit):
  - Returns up to min(limit, 2000) pending transactions
  - Ordered by insertion sequence
  - Used by block producers to fill blocks
```

### Removing Transactions

Transactions are removed when:

1. **Included in a block** — `block.accept` event removes confirmed txn IDs
2. **Failed in a block** — `transaction.fail` event removes the txn
3. **Expired** — pruning timer removes txns older than `transaction-expiration` seconds
4. **LIB advances** — state committed, orphaned fork txns cleaned up

### Expiration / Pruning

Every 1 second, the mempool checks all pending transactions against the system clock. Transactions older than `transaction-expiration` (default 120s) are evicted.

---

## RPC Methods

| Method | Description |
|--------|-------------|
| `check_pending_account_resources(payer, max_payer_rc, trx_rc_limit)` | Check if account can afford transaction |
| `get_pending_transactions(limit)` | Get up to 2,000 pending transactions |
| `get_pending_transactions_by_id(ids[])` | Get specific transactions by ID (max 2,000) |
| `get_reserved_account_rc(account)` | Get max RC available for account |
| `check_account_nonce(payee, nonce)` | Check if nonce is valid (not duplicate) |
| `get_pending_nonce(account)` | Get next expected nonce for account |
| `get_pending_transaction_count(account)` | Count of pending txns for account |

---

## Fork-Aware Block Handling

The mempool maintains a fork-aware state using state_db nodes:

### On `block.accept`

```
1. Create temporary node: tmp_id = hash(block_id)
2. Remove all transaction IDs found in the block from pending state
3. Update resource tracking for affected accounts
4. Store node in block_map[height]
```

### On `block.irreversible` (LIB advance)

```
1. Find node for the irreversible block
2. commit_node() — advance root, prune old state
3. Clean up block_map entries at or below LIB height
4. Remove orphaned transactions from non-canonical forks
```

### Fork Handling

When forks are detected:
- Each fork branch has its own state node
- Transactions valid on one fork may be invalid on another
- LIB commitment resolves forks permanently

---

## AMQP Integration

### RPC Endpoint

- **Queue:** `koinos.rpc.mempool` (durable)
- **Exchange:** `koinos.rpc` (direct, durable)

### Broadcast Subscriptions

| Event | Action |
|-------|--------|
| `koinos.transaction.accept` | Add transaction to pending pool, re-broadcast as `koinos.mempool.accept` |
| `koinos.transaction.fail` | Remove failed transaction from pending pool |
| `koinos.block.accept` | Remove confirmed transactions, update fork state |
| `koinos.block.irreversible` | Commit state at LIB, prune old data |

### Broadcast Publications

| Event | Trigger |
|-------|---------|
| `koinos.mempool.accept` | New transaction added to mempool |

---

## Resource Credit (RC) System

The RC system prevents spam by requiring accounts to have sufficient resources:

- **RC (Resource Credits):** Regenerating resource allocated per account based on KOIN balance
- **max_payer_rc:** Maximum RC the payer currently has (from chain state)
- **trx_rc_limit:** RC cost of the transaction (set by the transaction submitter)
- **Reservation:** Pending transactions "reserve" RC to prevent double-spending

The mempool tracks reserved RC per account across all pending transactions to ensure an account doesn't submit more transactions than it can afford.

---

## Thread Safety

- All state access is protected by read-write locks
- RPC handlers acquire shared (read) or exclusive (write) locks as needed
- Pruning timer acquires exclusive lock during eviction
- Block handlers acquire exclusive lock for state modifications

---

## Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Max pending transactions returned | 2,000 | Per RPC request |
| Transaction expiration | 120s | Default, configurable |
| Pruning interval | 1s | Check for expired transactions |
