# Anomaly 1 (block 32,789,377) — engineer follow-up analysis

Separate report answering the blockchain engineer's objections to the earlier
conclusion that height 32,789,377 "should" have 11 delta entries, not 12.

**Conclusion: the engineer is correct. 12 entries is the honest, correct
delta.** The earlier reading ("the entry-8 remove was a no-op, 11 is the
correct delta, the receipt over-records") is **wrong** and is retracted here.
The direct root computations below prove it. 32,789,377 is anomalous only
because it is the **last block before the January 2026 halt**, and its
consensus root was corrupted during the JGA#2 restart by the very
tombstone-drop bug this effort targets. This has a direct, important
consequence for the fix, at the end.

---

## Decisive evidence: direct root computation of three consecutive blocks

Producer `1UG4UUn7Da9JqE4PKbYUWgjbNwE5F9531` (bytes
`0x000527cd65bc68ac4304b43234714605b954d450`) mints KFS vote-ordering blocks
with an identical 12-entry shape: 7 puts, then `REMOVE old_a` (entry 8),
`REMOVE old_b` (entry 9), `PUT new` (entry 10), final put. A block's delta
root must equal the NEXT block header's `previous_state_merkle_root` (the
consensus-signed value). Recomputing each block's root over all 12 entries vs
over 11 (dropping the entry-8 remove), against the signed root:

| Block | Signed root matches | 12-entry root | 11-entry root (drop e8) |
|---|---|---|---|
| 32,789,375 | **12 entries** | `12208e11acba…` ✅ | `1220ba31e2a4…` ✗ |
| 32,789,376 | **12 entries** | `1220e4a6e321…` ✅ | `1220529db063…` ✗ |
| **32,789,377** | **11 entries** | `12203a22d592…` ✗ | `12209948b54d…` ✅ |

Three consecutive blocks, same producer, same structure, same kind of
entry-8 remove. The first two: consensus counted all **12** entries. The
third: consensus counted only **11**. This is the whole story in one table.

### What it proves

1. **12 entries is correct and normal.** The entry-8 remove is a real state
   change that consensus counts — blocks 32,789,375 and 32,789,376 prove it
   directly (their signed roots match only with all 12). koinosblocks.com
   showing 12 is correct; the stored receipts are honest.

2. **The entry-8 keys genuinely exist in state.** A wide journal scan
   (heights 32.0M–32.8M, 800k blocks) found no `put` of either the clean
   block's target key or 32,789,377's "phantom" key — yet 32,789,375/376
   count their removes in the consensus root. The only consistent explanation
   is that these KFS vote entries were created much earlier (>800k blocks
   back) and are long-lived; their removes are real. The earlier report's
   "no subset / no-op" reasoning was mis-drawn: absence of a nearby put does
   not mean the key was absent from state.

3. **32,789,377 is the sole outlier, and only on the consensus side.** Its
   own delta (12 entries) is honest and identical in shape to its neighbours.
   What differs is the signed root that anchors it — carried in the header of
   32,789,378 — which counts only 11. That root is the corruption, not the
   receipt.

---

## Why 32,789,377 — the halt

Journal timestamps place the block exactly at the halt the engineer described:

```
32,789,375   2026-01-21 18:31:23   producer 000527cd…  (1UG4, KFS voter)
32,789,376   2026-01-21 18:31:33   producer 000527cd…
32,789,377   2026-01-21 18:31:57   producer 000527cd…   <-- last block before halt
   ── ~22 hour gap ──
32,789,378   2026-01-22 16:41:10   producer 00e1facf…   <-- first block after restart
32,789,379   2026-01-22 16:41:15   producer 00e1facf…
```

Blocks are normally ~10 s apart. Here a **~22-hour gap** separates 32,789,377
from 32,789,378, and the producer changes — the JGA#2 shutdown and restart.

The mechanism, now fully consistent with the data:

1. 32,789,377 executed **pre-halt** (Jan 21) on a healthy node and produced an
   honest 12-entry delta. Its true root is `0x12203a22d592…`.
2. The halt hit; JGA#2 went down.
3. On restart (Jan 22), the node that produced 32,789,378 re-established its
   head state through the fast `verify-blocks=false` receipt-replay path — the
   path carrying the **original tombstone-drop bug**. Replaying 32,789,377's
   receipt dropped the entry-8 tombstone (absent-from-the-replay-node's-parent
   under the buggy semantics), computing the **11-entry** root
   `0x12209948b54d…`.
4. That wrong root was written into 32,789,378's `previous_state_merkle_root`
   and signed. The chain then continued from the corrupted anchor.

So the halt-recovery **baked the tombstone-drop bug's wrong root into the
consensus header of the next block**. This block is not a "legacy no-op
remove"; it is a permanent on-chain scar from the January incident.

---

## Consequence for the fix (must be resolved before it can sync mainnet)

The current fix's fallback re-executes a mismatching block and requires the
result to match the next header's consensus root. For 32,789,377 that header
carries the **11-entry** root. But re-executing the block on its true prestate
(where the entry-8 key exists) runs the KFS `remove` as a real change and
produces the **12-entry** delta root `0x12203a22…`, which does **not** match
the signed 11-root.

Therefore:

- **The gate resync will HALT at 32,789,377.** Re-execution cannot reproduce a
  corrupted consensus root. The fix as currently designed does not complete a
  full mainnet sync. (The gate run is the live confirmation; ETA to this block
  ~10 h from now.)
- The **only** way to match the on-chain 11-root is to **drop** the entry-8
  tombstone for this one block — i.e. apply the OLD buggy semantics here. That
  is exactly what the offline auditor does via its remove-subset search.

The three anomaly classes and their required handling:

| Block class | Correct handling | Reason |
|---|---|---|
| transient-tombstone (#860 halt cause) | **preserve** remove | consensus counted the tombstone; replay must too |
| 30,504,202 (KFS hardfork / #858) | **re-execute** | receipt is missing the rectification entries |
| **32,789,377 (this block)** | **drop** entry-8 remove | the on-chain consensus root is itself corrupted; only dropping matches the signed chain |

No fixed semantics works, and — crucially — **re-execution alone does not
work either**, because one block's consensus anchor is wrong. The fix needs a
third path. Options:

1. **Re-execute, then drop-subset fallback.** When re-execution still
   mismatches the signed root, search remove-entry subsets for one whose
   omission matches the next header; apply it and log loudly. Generalizes the
   auditor's logic; keeps sync moving; needs no hardcoded heights; also
   absorbs any future halt-scarred block. This is the recommended path.
2. **Known-corruption allowlist** for 32,789,377 (like `rectify.cpp`'s
   per-block entries). Simple and explicit, but hardcodes a mainnet artifact
   and won't catch a future incident.
3. **Governance re-anchor.** The honest delta is 12; correcting the on-chain
   record is a chain-governance action, out of scope for a sync fix.

Recommendation: option 1, layered under the existing preserve-tombstone +
re-execution logic. The fallback order becomes: preserve-replay → if root
mismatches next header, re-execute → if still mismatches, drop-subset search →
if none matches, halt (genuine corruption).

---

## Corrections to earlier documents

These previously committed docs stated the wrong conclusion (11 correct,
receipt over-records) and are corrected by this report:

- `docs/compatibility/LEGACY_DELTA_REPLAY_ANOMALY_ROOT_CAUSES.md` (koinos-one)
- `docs/current/storage/STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md` — the
  2026-07-08 update section
- the earlier engineering brief's framing of anomaly 1

The 30,504,202 (#858) analysis is unaffected and remains verified bit-exact.

---

## Evidence sources

- Full-history replay journal (37,280,004 blocks) at
  `/Volumes/external2/koinos2/state-delta-audit-full.delta-journal`, decoded
  with `inspect_heights.py`, `find_phantom_put.py`, `compare_keys.py`, and the
  direct root computation reusing `recompute-anomaly2-rectified-root.py`'s
  merkle implementation (self-validated against clean blocks).
- Live block-store query of the original badger store confirming the stored
  12-entry receipt.
- Audit run `state-delta-audit-full` (2026-07-07): one `legacy_tombstone_drop`
  block (32,789,377), one unexplained block (30,504,202) out of 37.28 M.
