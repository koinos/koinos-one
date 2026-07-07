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

The best one turns out to be simple: the node already stores the **full
blocks**, not just the page summaries. So when a page's signature doesn't
match, the node can **redo that one page for real** — re-execute the block
the slow, fully-verified way — and then continue in fast mode. Redoing 2
pages out of 37 million costs nothing, it fixes both problem pages, and it
automatically handles any similar surprise that might exist in other copies
of the history. Other options (patching the two pages in the data files
once, keeping a small "known exceptions" list, or starting from a snapshot
taken after the problem area) are described in Part 2.

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

### Solution proposals

#### A. Per-block re-execution fallback (recommended)

The block store holds full blocks, not just receipts, so the node has a
perfect plan B available at all times: when the fast replay's root check
fails, **re-execute that single block through the full verification path**
(`submit_block`, the same code `verify-blocks=true` uses) and continue in
fast mode.

Why it fixes both anomalies:

- **32,789,377**: current execution semantics treat a remove of a
  never-existing key as a no-op — the same decision the original validators
  made — so the re-executed root matches the consensus root.
- **30,504,202**: re-execution does not depend on the (damaged) receipt at
  all; it rebuilds the true delta from the block's transactions.
- **Any future unknown anomaly** in other block-store copies is handled the
  same way, with no heuristics and no hardcoded heights. Ground truth wins.

Design sketch:

1. The indexer retains the previous `block_item` (one-block lookbehind — the
   mismatch over block H is detected while applying block H+1, after H has
   been consumed from the queue).
2. On `state_merkle_mismatch_exception` in `indexer::process_block`, instead
   of aborting: log a warning, `discard_node(id_H)` (API already exists,
   used in `apply_block_delta`), re-execute block H via
   `controller::submit_block`, then retry `apply_block_delta(H+1)`.
3. Loop guard: if the mismatch persists at the same height after one repair,
   it is a genuine error — halt as today.

Cost: zero in the clean case (only runs on mismatch); re-executes 2 blocks
out of 37.28M on the current mainnet copy. Assumption to validate
empirically: historical re-execution is deterministic under current code —
the same premise `verify-blocks=true` from genesis already rests on.

#### B'. Bounded legacy-root tolerance (partial)

On mismatch, recompute the parent root with subsets of its remove entries
omitted, and accept if one reproduces the signed header root. Unlike the
audit tool, the node has the parent state, so the search can be restricted
to removes of **parent-absent** keys — the only possible legacy-drop
candidates (the two bug subclasses are indistinguishable at replay time
because the receipt is a compacted net delta, so a deterministic
recomputation is impossible and a bounded search is required). Fixes
32,789,377 only; cannot fix 30,504,202 (missing data). Reasonable as a fast
path in front of option A, unnecessary given A's negligible cost.

#### C. Repair the data instead of the code (offline migration)

- **C1 — regenerate receipts by re-execution**: a one-time migration tool
  syncs to each anomalous height, re-executes the block, and rewrites the
  stored receipt with the true delta. Vanilla replay then works forever;
  runtime code stays untouched. Fixes both blocks.
- **C2 — import correct receipts from an independent block-store copy**: for
  30,504,202 specifically, this also settles the local-degradation
  hypothesis.

Trade-off: mutates historical data (needs careful tooling plus a post-repair
audit run), and every operator holding an old copy must run the migration.

#### D. Known-exceptions list (checkpoint-style)

Ship a small list of heights (32,789,377 / 30,504,202) where, on mismatch,
the node accepts the consensus-signed header root and continues. Ten lines,
trivially auditable, zero risk outside the listed heights — but it does not
generalize (a third anomaly means another release), and for 30,504,202 the
resulting state may silently lack one entry (almost certainly a no-net-effect
tombstone, but unproven).

#### E. Snapshot bootstrap above the anomaly range

Publish an audit-verified snapshot above height 32,789,378 and support fast
sync only from there. No code changes, but genesis-to-head trustless
reconstruction in fast mode is given up.

#### F. Trust the signed root on any mismatch — rejected

Silently accepting every mismatch destroys the verification value of the
root check: any receipt corruption would pass unnoticed. Acceptable only
when bounded to an explicit list, which is option D.

#### Comparison and recommendation

| Option | Fixes 32,789,377 | Fixes 30,504,202 | Generalizes | Risk | Effort |
|---|---|---|---|---|---|
| **A. Re-execution fallback** | ✅ | ✅ | ✅ | low | medium |
| B'. Bounded legacy tolerance | ✅ | ❌ | partial | low | low |
| C1. Offline receipt repair | ✅ | ✅ | ✅ (re-runnable) | medium (mutates data) | medium |
| D. Exception list | ✅ | ✅* | ❌ | low | minimal |
| E. Snapshot bootstrap | ✅ | ✅ | — | trust in provider | minimal |

Recommended combination: **A** as the permanent node mechanism
(self-healing, ground truth always wins), optionally **C1** as an operator
tool for cleaning existing block stores in place. **D** works as an express
patch if a launch cannot wait. The subset search stays where it belongs — in
the audit tool, as a forensic diagnostic.

### Related documents

- `FULL_HISTORY_STATE_DELTA_AUDIT_2026-07-07.md` — the audit that located and
  characterized both anomalies.
- `STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md` — the original chain-halt
  investigation and the preserve-tombstone fix.
