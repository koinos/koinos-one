# Block Producer Service — Exhaustive Technical Reference

The block producer (`koinos_block_producer.exe`) creates new blocks by selecting transactions from the mempool, assembling valid blocks, and submitting them to the chain for consensus validation.

## Binary & Version

- **Binary:** `koinos_block_producer.exe` (C++20, MSVC on Windows)
- **Version:** v1.3.0
- **Source:** `vendor/koinos/koinos-block-producer/`

---

## Startup Sequence

1. Parse CLI flags and YAML config
2. Initialize logging
3. Load or generate private key (WIF format from `--private-key-file`)
4. Connect AMQP client to broker
5. Verify connectivity to `chain` and `mempool` services
6. Subscribe to `koinos.block.accept` for head block tracking
7. If `--gossip-production`: subscribe to gossip status events
8. Start production loop based on consensus algorithm

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--algorithm` | `federated` | Consensus: federated, pow, or pob |
| `--private-key-file` | `private.key` | WIF-encoded private key |
| `--resources-lower-bound` | 75 | % utilization target (stop filling) |
| `--resources-upper-bound` | 90 | % utilization cap (reject txn) |
| `--max-inclusion-attempts` | 2,000 | Max transactions to try per block |
| `--gossip-production` | false | Only produce when gossip is enabled |
| `--approve-proposals` | none | Governance proposal IDs to approve |

---

## Block Assembly Process

### 1. Build Block Header (`next_block`)

```
header:
  previous: head_block.id
  height: head_block.height + 1
  timestamp: now()
  signer: producer_public_key
  approved_proposals: [configured list]
```

### 2. Fill Block with Transactions (`fill_block`)

```
fill_block(block, receipt):
  1. Get resource limits from chain (disk, network, compute per block)
  2. Get pending transactions from mempool (up to max_inclusion_attempts)
  3. For each transaction:
     a. Calculate resource usage: disk + system_disk, network + system_network, compute + system_compute
     b. If adding this txn would exceed upper_bound (90%) of ANY resource: skip
     c. Add transaction to block
     d. Accumulate resource counters
     e. If ALL resources >= lower_bound (75%): stop (block is "full enough")
  4. Return filled block
```

### 3. Set Merkle Roots

```
set_merkle_roots(block):
  For each transaction:
    hash1 = SHA2-256(txn.header)
    hash2 = SHA2-256(txn.signatures)
  Build merkle tree from all 2*N hashes
  block.header.transaction_merkle_root = tree.root
```

### 4. Submit Block

```
submit_block(block):
  1. RPC: chain.propose_block(block) with 3s timeout
  2. If error: log and return false (fatal error)
  3. If no receipt (failed transactions):
     - Remove failed transaction indices
     - Return true (retry with fewer txns)
  4. If receipt: block accepted! Return false (done)
```

If `submit_block` returns true (failed txns removed), the producer immediately retries with the remaining transactions.

---

## Resource Management

### Block Resource Limits

Each block has three resource dimensions with global limits from chain state:

| Resource | Description |
|----------|-------------|
| **Disk storage** | Bytes written to state DB |
| **Network bandwidth** | Bytes of transaction data |
| **Compute bandwidth** | WASM execution ticks |

### Fill Strategy

The producer uses a **two-threshold** strategy:

| Threshold | Value | Behavior |
|-----------|-------|----------|
| `lower_bound` | 75% | Stop adding transactions when ALL resources reach this level |
| `upper_bound` | 90% | Skip individual transactions that would push ANY resource above this |

This prevents overfilling blocks while maximizing utilization.

### Resource Accumulation

For each transaction added to a block:
```
disk_used += txn_disk_storage + system_disk_storage
network_used += txn_network_bandwidth + system_network_bandwidth
compute_used += txn_compute_bandwidth + system_compute_bandwidth
```

The `system_*` values represent overhead from the chain's own bookkeeping.

---

## Proof of Burn (PoB) Consensus

### Algorithm

PoB is Koinos's consensus mechanism where block producers "burn" KOIN to receive VHP (Virtual Hash Power), which gives them the right to produce blocks.

### Production Loop

```
produce():
  1. Get auxiliary data from PoB contract:
     - seed: Random seed from previous block
     - difficulty: Current mining difficulty
     - target_block_interval: 3000ms
     - quantum_length: 10ms
  2. Get producer's VHP balance
  3. Calculate time quantum from head block time
  4. Loop:
     a. If quantum > now + 5s: wait
     b. Generate VRF proof: sign(private_key, seed + block_time)
     c. Calculate target: max_uint128 / difficulty
     d. Check: (vrf_hash >> 128) / vhp_balance < target
     e. If difficulty met: build and submit block
     f. If not met: increment quantum by quantum_length (10ms)
     g. Repeat
```

### VRF (Verifiable Random Function)

- **Input:** `seed || block_time` (concatenated)
- **Key:** Producer's private key
- **Output:** Deterministic, verifiable random proof
- **Purpose:** Proves the producer had the right to produce at this time slot

### Difficulty Check

```
proof_hash = SHA2-256(vrf_proof)
hash_portion = proof_hash >> 128  // Take upper 128 bits
target = MAX_UINT128 / difficulty
result = hash_portion / vhp_balance

if result < target:
    DIFFICULTY MET → produce block
else:
    try next quantum
```

### Monitoring

Every 60 seconds, logs estimated total VHP producing on the network:
```
estimated_vhp = difficulty / quanta_per_block_interval
```

---

## Gossip-Based Production Control

When `--gossip-production` is enabled:

| Gossip State | Production |
|-------------|------------|
| Enabled | Normal production |
| Disabled | Halt production (node is syncing) |

This prevents producing blocks while the node is still syncing, which would create invalid blocks.

---

## AMQP Integration

### Outbound RPC

| Service | Method | Purpose |
|---------|--------|---------|
| `chain` | `get_head_info` | Get current chain head for block building |
| `chain` | `propose_block` | Submit assembled block |
| `chain` | `get_resource_limits` | Get block resource limits |
| `chain` | `read_contract` | Read PoB contract state (seed, difficulty) |
| `mempool` | `get_pending_transactions` | Get transactions to include |

### Broadcast Subscriptions

| Event | Action |
|-------|--------|
| `koinos.block.accept` | Update head block time for quantum calculation |
| Gossip status | Enable/disable production |

---

## Key File

### Private Key (`private.key`)

- **Format:** WIF (Wallet Import Format)
- **Location:** `{basedir}/block_producer/private.key`
- **Auto-generation:** If file doesn't exist, a new key pair is generated
- **Public key derived:** Used as block signer

---

## Error Handling

- **propose_block returns error:** Logged as system error, production paused
- **propose_block returns no receipt (failed txns):** Failed transactions removed, retry immediately
- **No pending transactions:** Block produced with zero transactions (empty block)
- **VHP balance is zero:** Cannot produce blocks (need to burn KOIN first)
- **Clock skew:** Blocks timestamped > 5s in future are rejected by the chain
