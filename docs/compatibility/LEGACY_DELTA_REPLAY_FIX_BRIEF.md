# Engineering Brief: Fix the Receipt-Delta Fast Replay Path in the Official Koinos Microservices

Self-contained implementation and test plan. Everything needed is in this
document — no access to any other codebase is required. Target repositories:
`koinos/koinos-state-db-cpp`, `koinos/koinos-chain` (and, read-only,
`koinos/koinos-block-store`). All line references below were verified against
the master branches on 2026-07-07.

---

## 1. Goal

Make a full mainnet sync with `verify-blocks=false` (the fast, receipt-delta
replay mode of `koinos-chain`) **complete from genesis to head, correctly and
verifiably**. Today it cannot: it silently builds wrong state at a handful of
historical blocks and fails far from the cause. After this change it must:

1. apply recorded state deltas with tombstone-preserving semantics,
2. verify every block's replayed state-delta Merkle root against the
   consensus-signed value in the next block's header, and
3. when that verification fails (two known historical blocks, detailed
   below), automatically fall back to fully re-executing that single block,
   then continue in fast mode.

Acceptance is empirical and exact: a fresh `verify-blocks=false` sync of
mainnet must finish at head with **exactly two** fallback re-executions, at
heights **30,504,202** and **32,789,377**, and the state-delta Merkle root of
the head block must match the independently audited value given in §6.

---

## 2. Background: the protocol facts you need

### 2.1 The state-delta Merkle root

Every Koinos block receipt carries `state_delta_entries` — the compacted net
database changes of the block (protobuf `koinos::protocol::state_delta_entry`:
an `object_space`, a `key`, and an optional `value`; an entry **without** a
value is a remove). Each block's header carries
`previous_state_merkle_root`: the Merkle root of the **previous block's
delta**, as computed by the validators that accepted it. This is the
consensus-signed anchor everything below relies on.

The root is computed by `state_delta::merkle_root()` in
`koinos-state-db-cpp` (`src/koinos/state_db/state_delta.cpp`): collect every
key written in the delta plus every key in the delta's removed-objects set,
sort the full database keys lexicographically, and build a SHA2-256 Merkle
tree over leaf pairs `(hash(key), hash(value))`, where a removed key's value
leaf is the hash of the **empty string**.

### 2.2 The tombstone bug

`state_delta::erase( key )` in the current upstream library only records a
removal if the key currently exists:

```cpp
if( find( k ) )   // records the removal only for present keys
```

Contract execution can produce a receipt containing a remove entry for a key
that is **absent from the parent state** — most commonly a key created and
then removed inside the same block ("transient tombstone"; the compacted
receipt keeps the remove but has no put, since the key is not part of the
final block state). During **execution** the key existed at the moment of
removal, so validators recorded it and the consensus root **includes** the
tombstone leaf. During **receipt replay** the key is absent from the parent,
`find(k)` is false, the removal becomes a no-op, the tombstone leaf is lost,
and the replayed root **differs from consensus**.

This is not hypothetical: it caused a production incident ("the KFS chain
halt") where fast-syncing nodes reached the tip with silently wrong roots and
then rejected the first live block with `block previous state merkle
mismatch` at reported heights 30,488,260 / 32,770,790 / 32,789,378 /
32,900,351 — each one block above a causal block containing Koinos Fund
System (contract `1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9`) remove-only vote
entries.

### 2.3 Why fixing the semantics alone is not enough: the two anomaly classes

A 37,280,004-block full-history audit (independent offline tool, recomputing
every block's delta root and chaining it against the signed headers) found
that **tombstone-preserving replay reproduces consensus for 37,280,002
blocks** — including three of the four incident causal blocks — but two
blocks can never be reproduced from their stored receipts:

**Anomaly 1 — height 32,789,377** (block id
`0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586`).
The receipt records 12 delta entries. The consensus root in the header of
32,789,378 —
`0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690` —
is reproduced **only** by omitting one remove entry (key = ASCII
`02076430234253060999996`, a KFS vote key). The preserve-tombstone root over
all 12 entries is
`0x12203a22d59290a838dd49c87f57fe80319636950948f6b9aaf02287c03bb36e5f68`.
Explanation: this remove was of a key that did **not** exist at the moment of
removal during execution (a no-op under the era's semantics), so validators
excluded it from the root, while the receipt records it. Consequence: **no
single fixed replay semantic passes the whole chain** — always-preserve fails
here; always-drop fails the transient-tombstone blocks of §2.2.

**Anomaly 2 — height 30,504,202** (block id
`0x1220f0ca713b49490ff60f5636e2848f48a7b31c95f583074a30ce7e3cb35d154524`).
The receipt records 8 entries, all puts. Expected (signed) root
`0x12209d2d9592ddf831e892a5d4d38e93324f6834e255f84509b5e1c907ccfaa685e6`;
computed root
`0x12207fb526273e706238cef899350facfd1ddcfa5e19ae352284be53e68d5c516f45`.
No subset of the 8 recorded entries reproduces the expected root (all 255
combinations tested; a 256-bit match cannot be coincidence, so the negative
is conclusive). The receipt most plausibly **lost an entry** that consensus
included. Missing data cannot be reconstructed from the receipt — only full
re-execution of the block can rebuild the true delta.

The per-block re-execution fallback (§4) handles both classes with one
mechanism and needs no hardcoded heights.

### 2.4 Current state of the upstream code (verified)

- `koinos-chain` already has the fast replay: `verify-blocks` option
  (`src/koinos_chain.cpp:75`), the indexer branch
  (`src/koinos/chain/indexer.cpp:234-241` — `submit_block` when verifying,
  `controller.apply_block_delta( block, receipt, target_height )` when not),
  and `controller::apply_block_delta` (`src/koinos/chain/controller.cpp:634`).
- `apply_block_delta` applies removes with plain
  `block_node->remove_object( space, key )` (controller.cpp:677 loop) — the
  §2.2 bug — and performs **no Merkle verification at all**: no parent-root
  check, no receipt-root check. Errors therefore surface far from their
  cause.
- `koinos-state-db-cpp` has no tombstone-preserving API, and its
  `discard_node` refuses to discard the head node
  (`src/koinos/state_db/state_db.cpp:786`,
  `"cannot discard a node that would result in discarding of head"`). This
  constraint shapes the fallback design (§4).
- `koinos-chain` ships `maybe_rectify_state`
  (`src/koinos/chain/rectify.cpp`, called from the execution path at
  `controller.cpp:421`) — hardcoded per-block receipt/state corrections for
  height 9,180,357 and an Oct-2025 window. Precedent for per-block fixes,
  but do **not** extend it for this work: the generic fallback is superior
  (no hardcoded data, covers unknown anomalies in other block-store copies).
- The indexer already receives `block_store::block_item` values containing
  both the block and its receipt from the block-store service, in canonical
  ascending height order. No block-store changes are expected.

---

## 3. Change 1 — tombstone-preserving mutation API (`koinos-state-db-cpp`)

1. Extend `state_delta::erase` with a flag, defaulting to current behavior:

   ```cpp
   void state_delta::erase( const key_type& k, bool preserve_tombstone = false )
   {
     if( find( k ) || preserve_tombstone )
     {
       _backend->erase( k );
       _removed_objects.insert( k );
     }
   }
   ```

   Semantics: with `preserve_tombstone = true`, the key is recorded in
   `_removed_objects` even when absent, so `merkle_root()` includes its
   `(hash(key), hash(""))` leaf pair. All existing callers keep the old
   behavior (normal contract execution must NOT invent tombstones for
   removes of absent keys — that would change consensus).

2. Add the state-node level wrapper mirroring `remove_object`:
   `int64_t remove_object_preserve_tombstone( const object_space& space, const object_key& key )`
   — identical to `remove_object` except it calls `erase` with
   `preserve_tombstone = true`. Document it as **only for replaying
   serialized receipt deltas**, never for live mutation.

3. Unit tests (this library):
   - erase of an absent key, preserve=false → no `_removed_objects` entry,
     root unchanged (regression guard for execution semantics);
   - erase of an absent key, preserve=true → tombstone recorded; root gains
     exactly one `(hash(key), hash(""))` leaf pair;
   - erase of a present key behaves identically under both flags;
   - a delta with {put A, preserved-remove B, put C} reproduces a hand
     computed reference root (fixture: sort keys, hash pairs, Merkle).

---

## 4. Change 2 — verified replay with re-execution fallback (`koinos-chain`)

### 4.1 Design constraint that dictates the shape

The naive fallback — apply block H by delta, detect the bad root when block
H+1's header check fails, discard H's node, re-execute H — is
**impossible**: by then H is the head node and `state_db` refuses to discard
it (§2.4). The repair must run **before H's node is finalized**, while it is
still writable. That is achievable because the indexer consumes blocks in
canonical order: when it holds H+1 it already knows the consensus-signed
expectation for H's root — `H+1.header().previous_state_merkle_root()`. The
design is a **one-block lookahead**.

### 4.2 Controller

1. In `apply_block_delta`, replace the remove call in the delta-entry loop:

   ```cpp
   if( delta_entry.has_value() )
     block_node->put_object( object_space, delta_entry.key(), &delta_entry.value() );
   else
     block_node->remove_object_preserve_tombstone( object_space, delta_entry.key() );
   ```

2. Add the two verification asserts to `apply_block_delta` (both missing
   upstream today):
   - before applying entries:
     `block.header().previous_state_merkle_root() == parent_node->merkle_root()`
     → throw a dedicated `state_merkle_mismatch` exception on failure;
   - after applying entries, when the receipt carries a root
     (`receipt.state_merkle_root().size()`):
     `receipt.state_merkle_root() == block_node->pending_merkle_root()`.
     (Note: all mainnet receipts to date carry an empty root, so this check
     is future-proofing.)

3. Add `apply_block_delta_checked( block, receipt, expected_root, index_to )`:
   identical to `apply_block_delta` plus, after applying the delta entries
   and **before finalizing the node**:

   ```cpp
   if( util::converter::as< std::string >( block_node->pending_merkle_root() )
       != expected_root )
   {
     LOG( warning ) << "delta_replay_fallback height=" << block_height
                    << " id=" << block_id
                    << " - replayed delta root does not match the consensus"
                       " root signed in the next block header;"
                       " re-executing block through full verification";
     // legal: the node is writable and not yet head
     discard the writable block node;
     re-execute the block through the existing full-execution path
       (the same internals submit_block uses), which rebuilds the node
       from ground truth;
     return;   // errors from re-execution propagate — genuine failures
               // must still halt
   }
   finalize as today;
   ```

   No retry loop and no loop guard are needed: if re-execution itself
   produces a root the next header rejects, that is a real error and the
   sync must stop.

### 4.3 Indexer

Non-verify branch only (`_verify_blocks == false`); the verify branch is
untouched.

1. Add `std::optional< block_store::block_item > _pending_item;`.
2. On each item pulled: if `_pending_item` holds block H, apply it with the
   now-known expectation:

   ```cpp
   _controller.apply_block_delta_checked(
     _pending_item->block(), _pending_item->receipt(),
     item.block().header().previous_state_merkle_root(),
     _target_head.height() );
   _pending_item = item;
   ```

3. At end of stream, apply the final pending item (the target head) with
   plain `apply_block_delta` — it has no successor header; its root is
   cross-checked by the first live block, as today.

### 4.4 Configuration and observability

- No new options. The fallback triggers only where today's code either
  halts confusingly (after adding the asserts) or silently corrupts state
  (before them) — it cannot regress a clean sync. Optionally add
  `--strict-delta-replay` to turn the fallback off for forensic runs.
- Log line per fallback (`delta_replay_fallback height=... id=...`) and a
  total count in the indexer's completion message.

---

## 5. Test plan

### 5.1 Unit — state-db (see §3.3)

### 5.2 Unit — chain controller

Using the repository's existing controller test fixtures (genesis + block
production helpers):

1. **Transient tombstone replay (the §2.2 bug):** produce/execute a block
   whose receipt contains a remove entry for a parent-absent key alongside
   normal puts; replay the same receipt onto a fresh parent with
   `apply_block_delta`; assert the replayed `pending_merkle_root` equals the
   root produced by execution. (Fails before Change 1, passes after.)
2. **Checked-apply, clean path:** `apply_block_delta_checked` with the
   correct expected root behaves byte-identically to `apply_block_delta`
   (same node id, same root, node finalized).
3. **Checked-apply, anomaly-1 shape:** hand-craft a receipt with one extra
   parent-absent remove and pass an `expected_root` computed *without* that
   entry; assert the fallback path triggers, the block is re-executed, and
   the resulting node root equals `expected_root`.
4. **Checked-apply, unrecoverable shape:** pass an `expected_root` that
   nothing (neither the delta nor re-execution) can produce; assert the call
   throws and the sync would halt — the fallback must not mask genuine
   corruption.
5. **Head-discard regression:** assert the fallback path never attempts to
   discard a finalized/head node (this is the design constraint of §4.1; a
   unit test pinning it prevents an accidental lookbehind refactor).

### 5.3 Integration — full mainnet resync (the decisive gate)

Fresh data directory, `verify-blocks: false`, sync mainnet from a block
store containing full history (or a restored copy). Pass criteria, all
required:

- sync reaches head without manual intervention;
- the log contains **exactly two** `delta_replay_fallback` lines, at heights
  **30,504,202** and **32,789,377** (block ids in §2.3) — no more, no fewer;
- the head block's state-delta Merkle root equals the audited reference in
  §6 (if syncing to a later head, verify instead at height 37,280,004 that
  the block's replayed root matches
  `previous_state_merkle_root` of block 37,280,005 — the chain check does
  this implicitly by not halting);
- the node transitions to live sync and applies new blocks normally
  (the first live block's `previous_state_merkle_root` check passes).

This run simultaneously validates the re-execution determinism assumption
(historical blocks re-executed by current code must reproduce the
consensus roots — the same premise `verify-blocks=true` rests on).

### 5.4 Regression

- Full test suite of both repositories.
- A `verify-blocks: true` sync over the same range is unaffected (the
  changes never run in that mode).
- Performance: the added per-block `pending_merkle_root` computation is a
  sort+hash over a typically single-digit number of entries (mainnet mean ≈
  7.8 entries/block: 290,295,679 entries over 37,280,004 blocks); confirm
  replay throughput regression is negligible (< 5%).

### 5.5 Cross-implementation parity (optional but recommended)

If a Teleno (monolithic node) build with the equivalent fix is available:
sync the same block-store copy through both stacks and require identical
head state Merkle roots and identical fallback heights. An independent
offline audit tool exists that recomputes the full history and reports
anomalies; its published totals are the reference in §6.

---

## 6. Ground-truth reference values (from the 2026-07-07 full-history audit)

```
audited head height:        37,280,004
audited head block id:      0x12205fd14f5c2d504646bf69e88ef2e8d8db41e60b4ff6c087430a852e286cd2ada0
audited head delta root:    0x1220b674199c1c179e1446691324b10bfbb27181b03f621da23b45474c80427007a6
blocks validated clean:     37,280,002
total delta entries:        290,295,679  (284,883,828 puts / 5,411,851 removes)

anomaly 1 (legacy tombstone drop):
  height:                   32,789,377
  block id:                 0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586
  receipt entries:          12
  preserve-tombstone root:  0x12203a22d59290a838dd49c87f57fe80319636950948f6b9aaf02287c03bb36e5f68
  consensus (expected):     0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690
  reproduced by omitting:   the remove entry with key ASCII "02076430234253060999996"
                            (hex 0x3032303736343330323334323533303630393939393936)

anomaly 2 (receipt lost an entry):
  height:                   30,504,202
  block id:                 0x1220f0ca713b49490ff60f5636e2848f48a7b31c95f583074a30ce7e3cb35d154524
  receipt entries:          8 (all puts)
  computed root:            0x12207fb526273e706238cef899350facfd1ddcfa5e19ae352284be53e68d5c516f45
  consensus (expected):     0x12209d2d9592ddf831e892a5d4d38e93324f6834e255f84509b5e1c907ccfaa685e6
  no entry subset matches (255/255 combinations tested)

historical incident heights (context; three validate clean under
preserve-tombstone, only 32,789,377 needs the fallback):
  reported 30,488,260 → causal 30,488,259
  reported 32,770,790 → causal 32,770,789
  reported 32,789,378 → causal 32,789,377
  reported 32,900,351 → causal 32,900,350
```

## 7. Delivery

Three PRs in dependency order, each with its tests:

1. `koinos-state-db-cpp` — preserve-tombstone API (§3).
2. `koinos-chain` — preserve semantics + the two replay asserts in
   `apply_block_delta` (§4.2 items 1–2).
3. `koinos-chain` — `apply_block_delta_checked` + indexer lookahead fallback
   (§4.2 item 3, §4.3).

PR 2 alone already converts the silent far-from-cause corruption into a
fail-fast halt at the causal block; PR 3 converts the halt into automatic
self-repair. Do not merge PR 3 without PR 2's asserts — the fallback has
nothing to catch without them.
