# Root causes of the two delta-replay anomalies

In-depth companion to `LEGACY_DELTA_REPLAY_FIX_BRIEF.md` §2.3 and §6, written
after tracing both anomalies to their code-level origins (2026-07-08). All
file/line references were checked against `koinos-chain`
`fix/860-state-delta-tombstone-replay` and `koinos-state-db-cpp`
`fix/preserve-tombstone-remove`.

## Background: two sources of truth that must agree, and don't

Every applied block produces two independent records of "what changed":

1. **The consensus merkle root.** While the block executes, the block's state
   node accumulates writes in its `state_delta`: puts land in the delta's
   backend, removes land in `_removed_objects`. After finalization,
   `state_delta::merkle_root()` (state_delta.cpp) collects every written key
   plus every key in `_removed_objects`, sorts the serialized database keys,
   and builds a SHA2-256 merkle tree with leaf pairs `(hash(key),
   hash(value))` — a removed key contributes `hash("")` as its value leaf.
   The validators that accepted the block computed this root, and the NEXT
   block's header carries it as `previous_state_merkle_root`. That header is
   signed and irreversibly part of the chain: **whatever the executing
   validators computed IS the correct root, by definition of consensus.**

2. **The receipt's `state_delta_entries`.** The same block node is asked for
   `get_delta_entries()` and the result is serialized into the block receipt,
   which `koinos-chain` hands to `block_store` for persistence. This is the
   record the fast sync path (`verify-blocks=false`) replays instead of
   re-executing blocks.

The fast path (`controller_impl::apply_block_delta`) assumes these two records
are equivalent: replaying the receipt's entries onto the parent state should
rebuild a delta whose merkle root equals the consensus root. The
37,280,004-block audit proved this holds for 37,280,002 blocks (with
tombstone-preserving replay semantics) and fails for exactly two. Each failure
is a different way the receipt diverged from what consensus counted.

---

## Anomaly 2 — height 30,504,202: the receipt is missing the Oct-31-2025
## hardfork writes (bug #858)

### The hardfork

On 2025-10-31 the Koinos Fund contract had a bug fixed via an in-node
"rectification" rather than an on-chain transaction. `maybe_rectify_state()`
(`src/koinos/chain/rectify.cpp`) is called from the **full execution path**
(`controller.cpp`, right after `system_call::apply_block`). For the first
block whose timestamp falls in the window **2025-10-31T11:58:00 to
12:00:00 UTC** (`timestamp() < 1761912000000` guard in rectify.cpp), and only
if the KFS contract metadata hash is not already the new one, it does two
things:

```cpp
// 1. mutate state directly (contract bytecode + metadata for
//    1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9):
block_node->put_object( bytecode_space, key, &new_bytecode );
block_node->put_object( metadata_space, key, &metadata_value );

// 2. append the matching entries to the receipt:
auto* state_entry = block_receipt.add_state_delta_entries();
...
auto* metadata_state_entry = block_receipt.add_state_delta_entries();
...
```

The two `put_object` calls go through the block node's `state_delta`, so they
are part of the block's delta and therefore **part of the consensus merkle
root**. Every validator executing that block performed the same rectification,
so the root signed into the next header includes the new bytecode and metadata
leaves. So far, consistent.

### The persistence bug (#858)

The receipt mutation, however, happened on a **copy**. In
`controller_impl::apply_block()` the flow was:

```cpp
res.receipt = std::get< protocol::block_receipt >( ctx.receipt() );  // copy
maybe_rectify_state( ctx, block, *res.receipt );                     // rectifies the copy
...
// but the block_store write and the koinos.block.accept broadcast
// still used ctx.receipt() — the ORIGINAL, unrectified receipt
```

Fixed in v1.5.1 (PR #858, "Fix rectified receipt persistence", documented in
`RECEIPT_PERSISTENCE_FIX_AND_RECOVERY.md`): both persistence paths now use
`*res.receipt`. But the fix is forward-only. **Any block store populated by a
pre-1.5.1 node stores the rectified block's receipt without the two
rectification entries** — and there is no way to regenerate them from the
receipt itself.

### How this shows up in the audit

- Stored receipt at 30,504,202: **8 entries, all puts.**
- Consensus root (header of 30,504,203):
  `0x12209d2d9592ddf831e892a5d4d38e93324f6834e255f84509b5e1c907ccfaa685e6`.
- Root computed from the 8 stored entries:
  `0x12207fb526273e706238cef899350facfd1ddcfa5e19ae352284be53e68d5c516f45`.
- The audit tried all 255 non-empty subsets of the 8 entries: none reproduces
  the consensus root. That is the right shape of negative: subset-testing can
  only detect **extra** entries. Here the receipt has **missing** entries (the
  two rectification puts), which no subset can recover. A 256-bit hash match
  cannot happen by accident, so "no subset matches" conclusively rules out
  the extra-entry explanation and points at missing data.

(If the timestamp window is checked against the block, 30,504,202 should be
the first block at/after 2025-10-31T11:58:00 UTC — the engineer's observation
that this is hardfork day is exactly right.)

### Consequences

- **Mainnet nodes are fine.** They executed + rectified; their state and the
  signed root are correct.
- **Receipt replay can never pass this block**, under any replay semantics:
  the information simply is not in the receipt. This kills the idea of fixing
  fast sync purely by changing replay semantics.
- **Re-execution fixes it naturally**: the fallback re-runs the block through
  the same path `submit_block` uses, which calls `maybe_rectify_state`, which
  re-applies the bytecode/metadata writes → the rebuilt node's root matches
  consensus. No hardcoded heights needed in the new code; the hardcoding
  already lives (appropriately) in rectify.cpp.
- The #858 recovery doc itself prescribed `verify-blocks=true` for affected
  nodes — full re-execution of the whole chain. The lookahead fallback is the
  surgical version: full re-execution for exactly the blocks that need it.

### Cheap independent confirmation (proposed, not yet run)

Recompute the delta root over the 8 stored entries PLUS the two entries
rectify.cpp appends (bytecode put + metadata put, exact spaces/keys/values are
literals in rectify.cpp). If it equals `0x12209d2d…85e6`, the missing data is
confirmed to be exactly the rectification — closing the loop analytically,
independent of the gate run's empirical check.

---

## Anomaly 1 — height 32,789,377: the receipt contains a remove that
## consensus never counted

### What the audit found

- Stored receipt: **12 entries**, one of which is a remove of the KFS vote
  key ASCII `02076430234253060999996`
  (hex `0x3032303736343330323334323533303630393939393936`).
- Consensus root (header of 32,789,378):
  `0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690` —
  reproduced **only** by omitting exactly that one remove entry.
- Root over all 12 entries (preserve-tombstone replay):
  `0x12203a22d59290a838dd49c87f57fe80319636950948f6b9aaf02287c03bb36e5f68`.

### Who is "wrong"?

Nobody that is running mainnet. The signed root is the one the validators
computed **during execution**, and during execution the remove of that key was
a no-op: the key did not exist at the moment `erase()` ran, and the era's
`state_delta::erase` only records a removal for present keys:

```cpp
void state_delta::erase( const key_type& k )
{
  if( find( k ) )            // absent key → nothing recorded
  {
    _backend->erase( k );
    _removed_objects.insert( k );
  }
}
```

No `_removed_objects` entry → no `(hash(key), hash(""))` leaf → the consensus
tree has 11 effective entries. That root is what the network signed; it is
correct by definition. **The anomaly is that the serialized receipt carries
the 12th entry anyway** — a remove that execution treated as a no-op.

So, answering the engineer's question directly: the "correct" root for this
block is the 11-entry root, not the 12-entry one. The syncing node computes a
"wrong" root only in the sense that it faithfully replays a receipt that
over-records what consensus counted. Nothing "came wrong from the network" at
the header level; the header is consensus. The receipt is the inconsistent
artifact.

### Why this block makes the semantics problem unsolvable

Compare with the #860 bug class (the transient tombstone, e.g. causal blocks
30,488,259 / 32,770,789 / 32,900,350): there, a key created AND removed within
the same block **did exist at the moment of removal during execution**, so
validators DID record the tombstone and the consensus root INCLUDES the
`hash("")` leaf — while replay onto the parent (where the key never existed)
under old semantics drops it. Preserve-tombstone replay fixes those blocks.

Height 32,789,377 is the mirror image: consensus EXCLUDED the leaf, the
receipt records it. Preserve-tombstone replay now over-includes.

| Replay semantics | Transient-tombstone blocks (3×) | 32,789,377 |
|---|---|---|
| drop absent-key removes (old) | FAIL (root missing leaves) | pass (accidentally) |
| preserve tombstones (new) | pass | FAIL (root has extra leaf) |

No fixed rule can distinguish "this absent-key remove was recorded by
consensus" from "this one wasn't" using only the receipt — the receipt looks
identical in both cases. The consensus-signed root in the next header is the
only oracle, hence the design: replay with preserve semantics (right for
37,280,001 of the 37,280,002 clean blocks), check against the next header's
root, and re-execute the single block when the oracle disagrees.

### Open question: how did the no-op remove get INTO the receipt?

Not yet pinned. The receipt's `state_delta_entries` come from
`get_delta_entries()` on the same node whose `_removed_objects` feeds the
merkle root — naively they cannot diverge. Leads, in order of plausibility:

1. **The squash path.** Transactions execute in anonymous child nodes and
   `state_delta::squash()` merges them into the block node with:
   ```cpp
   for( const key_type& r_key: _removed_objects )
   {
     _parent->_backend->erase( r_key );
     if( !_parent->is_root() )
       _parent->_removed_objects.insert( r_key );   // UNCONDITIONAL
   }
   ```
   Unlike `erase()`, squash propagates a child's removal into the parent's
   `_removed_objects` without checking whether the parent ever had the key.
   A remove that was recorded inside a transaction node (where the key
   briefly existed, or where a different code version recorded it) can reach
   the block delta by a path with different existence semantics than a
   direct kernel-mode erase. Whether the specific 2026-era vote-flow hits an
   asymmetry here depends on the state-db version that validated that block.
2. **Version archaeology.** The block was validated by whatever
   chain/state-db release ran in Jan 2026. If `get_delta_entries()` /
   `merkle_root()` / `erase()` semantics shifted across releases (e.g. the
   receipt-entries feature landing in v1.5.0), the receipt writer and the
   root builder may briefly have disagreed about no-op removes.
3. **Receipt provenance.** If this block store's receipts were ever backfilled
   by a node that re-executed history under a parent state that differed
   (e.g. resumed from a slightly divergent snapshot), the extra remove could
   be an artifact of that copy rather than of the original validation. An
   independent block store copy showing the same 12 entries would eliminate
   this.

None of these change the fix: whatever the provenance, the receipt is not a
faithful basis for reconstructing this block's consensus root, and
re-execution is. But pinning the mechanism matters for upstream review
(especially if squash's unconditional insert can still create
receipt-vs-root divergence in CURRENT code), so it is worth the archaeology
before the PRs go up.

---

## Why one mechanism (checked replay + re-execution fallback) covers both

The two anomalies fail in opposite directions — missing data vs extra data —
and a receipt-only fix exists for neither. What they share: **the consensus
root in the next block's header is a signed, always-available oracle for the
correct delta**, and **full re-execution deterministically reproduces it**
(anomaly 2 via rectify.cpp, anomaly 1 via the era-equivalent no-op semantics
of live execution; the same premise `verify-blocks=true` has always rested
on). The one-block-lookahead checked replay uses the oracle where it exists,
falls back to re-execution on disagreement, and halts (instead of masking)
when even re-execution cannot satisfy the oracle — which is the correct
behavior for genuine corruption.

Empirical validation in progress: the mainnet gate resync must log exactly two
`delta_replay_fallback` lines, at these two heights and no others.
