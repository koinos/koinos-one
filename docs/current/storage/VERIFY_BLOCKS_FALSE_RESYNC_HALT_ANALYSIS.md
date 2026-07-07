# Will a Fresh `verify-blocks=false` Sync Halt? — Analysis of the Two Anomalous Blocks

Date: 2026-07-07

**Question:** if a node syncs the existing mainnet history from genesis using
the fast receipt-delta replay path (`verify-blocks=false`), will it stop at
the two anomalous blocks found by the full-history state delta audit
(`FULL_HISTORY_STATE_DELTA_AUDIT_2026-07-07.md`)?

**Answer: yes — it halts twice, at heights 32,789,378 and 30,504,203** (the
blocks immediately after the two anomalous ones). This document explains why,
first in plain language, then in full technical detail, and lists the
mitigation options.

---

## Part 1 — Plain-language explanation

### The ledger analogy

Think of the blockchain as a giant **accounting ledger**. Each block is one
page of entries: "add this record, delete that one". At the bottom of every
page there is a **summary signature** (the "state root") that mathematically
summarizes everything written on that page. The whole network signed off on
those signatures years ago — they are immutable.

Fast sync (`verify-blocks=false`) works like this: instead of redoing every
operation from scratch, the node **copies each page's entries** and checks
that its own computed summary signature matches the one the network signed.
If it matches, continue. **If it doesn't match, stop** — the node assumes
something is wrong and refuses to go on.

### The problem with the two pages

Out of 37 million pages, there are exactly 2 where the signature your node
computes **can never match** the one the network signed:

**Page 32,789,377 (the KFS bug block).** Back then, the old node software had
a quirk: one specific kind of entry — "delete a record that never existed" —
was written on the page but **left out of the signature math**. The entire
network signed that "incomplete" signature. Today's corrected software counts
everything, so it computes a different signature than the historical one.
Correct under the new rules, but different from what was signed. → The node
stops right there.

**Page 30,504,202.** Here it is the opposite: the copy of the page on this
disk is **missing one entry** that the original signature did include. With
one entry short, the signature can never match, no matter which rules you
use. → The node stops there too.

### What it means

- The chain data is not broken and no balances are wrong. Page 1 is a
  disagreement about *how the signature was computed*; page 2 is a *lost
  entry in this local copy*.
- Everything else — 37,280,002 pages — checks out perfectly.
- Thanks to the audit we know **exactly** which two pages fail, which exact
  entry is the conflicting one, and why. Without it, a network launch would
  have discovered this by surprise, mid-sync.

### The fixes, in plain terms

1. **Teach the node the known exception** (recommended): when a signature
   doesn't match, also try "would it match if I ignore that one odd
   delete-of-nothing entry, the way the old software did?". If yes, it is the
   known legacy case → accept and continue. This is exactly what the audit
   tool already does; the same logic needs porting to the node's replay path.
2. **For the page with the lost entry**: fetch a good copy of that page from
   another node, or cross just that one block in slow mode (re-executing it
   for real), or bootstrap from a snapshot taken after that height.

---

## Part 2 — Technical explanation

### The replay-time invariant

With `verify-blocks=false`, the indexer calls
`controller::apply_block_delta()` per block
(`node/teleno-node/src/koinos/chain/indexer.cpp:244`). Before applying block
H+1, the controller asserts
(`node/teleno-node/src/koinos/chain/controller.cpp:698`):

```
block(H+1).header().previous_state_merkle_root()
    == parent_node(H)->merkle_root()
```

The left side is **consensus-signed** (it lives in the child block's header).
The right side is computed locally by `state_delta::merkle_root()`
(`state_db/state_delta.cpp:217`): a SHA-256 Merkle tree over the block's own
delta — every key put in this delta plus every key in `_removed_objects`,
sorted, as (hash(key), hash(value-or-empty)) leaf pairs.

With the corrected replay semantics, `erase(k, preserve_tombstone=true)`
records the key in `_removed_objects` unconditionally
(`state_delta.cpp:44-47`), so the replayed delta reproduces the receipt's
`state_delta_entries` exactly. The replayed root therefore equals the audit
tool's preserve-tombstone root — the two formulas are the same, and the
equivalence is proven empirically: the audit reproduced the consensus roots
of 37,280,002 blocks, and those roots were produced by nodes running
`state_delta::merkle_root()`.

### Failure 1 — height 32,789,377 (halt at 32,789,378)

The audit proved:

- preserve-tombstone root over the block's 12 receipt entries:
  `0x12203a22d59290a838dd49c87f57fe80319636950948f6b9aaf02287c03bb36e5f68`
- consensus-signed `previous_state_merkle_root` in the header of 32,789,378:
  `0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690`
- the consensus root is reproduced bit-for-bit by omitting exactly one remove
  entry — KFS vote key `02076430234253060999996` (contract
  `1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9`).

A replaying node computes the first root; the header demands the second; the
assert throws `state_merkle_mismatch_exception`
("block previous state merkle mismatch"), the indexer's exception handler
aborts the sync. **Halt at 32,789,378.**

### Why this block differs from the other chain-halt blocks

The chain-halt incident (see `STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md`)
involved four causal blocks. The audit validated three of them cleanly under
preserve-tombstone; only 32,789,377 fails. The era's `erase()` semantics
(`if( find(k) || preserve_tombstone )`) explain both subclasses:

- **Common subclass (the three clean blocks):** a key created *and then*
  removed within the block. At execution time the key existed when removed,
  so even the old semantics recorded it — **consensus includes the
  tombstone**. Only *replay* dropped it (key absent from the replay parent),
  which the preserve-tombstone fix repairs. These blocks now replay
  correctly.
- **Rare subclass (32,789,377):** a remove of a key that did **not** exist at
  the moment of removal during execution — a no-op under the old semantics,
  so **consensus excludes the tombstone** — while the receipt records the
  entry anyway. Preserve-tombstone replay faithfully reproduces the receipt
  and therefore *cannot* reproduce the consensus root.

Consequence: **no single fixed replay semantic can traverse the whole
history.** Always-preserve fails the rare subclass; always-drop fails the
common subclass. Correct replay of the existing chain requires per-block
tolerance for the legacy exclusion.

### Failure 2 — height 30,504,202 (halt at 30,504,203)

The receipt records 8 entries, all puts. The preserve-tombstone root
(`0x12207fb5...6f45`) differs from the consensus root (`0x12209d2d...85e6`),
and **no subset** of the 8 recorded entries reproduces the consensus root
(255 combinations tested; a 256-bit match cannot be coincidental, so the
exhaustive negative is conclusive). The most plausible cause is the inverse
failure: this block-store copy's receipt **lost an entry** that consensus
included — likely a tombstone stripped when the copy was synced through the
old buggy replay path. Missing data cannot be reconstructed locally; replay
can only build from the receipt, so the root can never match. **Halt at
30,504,203, under any semantics.** Notably this height was not part of the
reported incident set, supporting the local-copy-degradation hypothesis.

### Confidence and the one open gap

The conclusion rests on root arithmetic empirically validated across 37.28M
blocks plus direct inspection of the replay code path. What has *not* been
done is an end-to-end run of the node's real `apply_block_delta` crossing
those two heights. That empirical confirmation is cheap to set up and
recommended before any launch decision.

### Mitigation options

| Option | Fixes 32,789,377 | Fixes 30,504,202 | Notes |
|---|---|---|---|
| Port the audit's legacy-subset tolerance into `apply_block_delta`: on parent-root mismatch, retry with remove-entry subsets omitted; accept if a subset reproduces the signed header root | ✅ | ❌ | Mirrors `legacy_dropped_tombstone_blocks` accounting in the audit tool; bounded (≤ 20 entries) and only runs on mismatch |
| Obtain a correct receipt for 30,504,202 from an independent block-store copy | — | ✅ | Also settles the degradation hypothesis |
| Cross the affected heights with `verify-blocks=true` (hybrid sync) | ✅ | ✅ | Re-executes only a handful of blocks; simple operationally |
| Bootstrap from a snapshot/checkpoint taken above 32,789,378 | ✅ | ✅ | Trades verification for trust in the snapshot provider |

### Related documents

- `FULL_HISTORY_STATE_DELTA_AUDIT_2026-07-07.md` — the audit that located and
  characterized both anomalies.
- `STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md` — the original chain-halt
  investigation and the preserve-tombstone fix.
