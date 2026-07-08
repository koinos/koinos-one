# Public-Mainnet Confirmation: Block 32,789,378 Stores The Bugged Root

Date: 2026-07-08. Follow-up to
`LEGACY_DELTA_REPLAY_ANOMALY1_HALT_ANALYSIS.md`, executing the verification
requested by the blockchain engineer: reproduce the anomaly with koilib
against public network data, independently of any local block store.

## What was verified

Two koilib RPC calls against a public API (default `https://api.koinos.io`),
via `scripts/verify-block-32789377-root.js`:

1. the stored block receipt of height **32,789,377**
   (`0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586`);
2. the header of height **32,789,378**
   (`0x122086d9090d82fceb9900293bd3f870c4d2ac769682a85f997fd847f4f716a96344`),
   whose `previous_state_merkle_root` is the consensus-signed fingerprint of
   32,789,377's state delta.

The script recomputes the state-delta merkle root exactly as
`koinos-state-db-cpp` does (leaf pairs `sha256(serialized chain.database_key)`
/ `sha256(value or "")`, sorted by serialized key, `sha256(left||right)`
internal nodes, odd node promoted, `0x1220` multihash prefix), in two
variants: over all 12 stored entries, and over 11 (dropping the entry-8
remove of KFS vote key `02076430234253060999996`).

## Result

```text
RPC: https://api.koinos.io

block 32,789,377 stored receipt entries: 12
   8 REMOVE 02076430234253060999996          <-- the dropped tombstone
   9 REMOVE 02076434190761140999996
  10 put    02076434345629600999996
  (… 9 further entries …)

signed root in block 32,789,378 header: 0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690
root over all 12 entries:               0x12203a22d59290a838dd49c87f57fe80319636950948f6b9aaf02287c03bb36e5f68   no match
root over 11 (drop phantom remove):     0x12209948b54dee01acd8528cf15dec02366b76e7739aedaf4487859bf6d0d182d690   MATCH
```

Bit-exact match with the 11-entry root; no match with the honest 12-entry
root. Combined with the neighbouring-block evidence (32,789,375 and
32,789,376 match their signed roots **only** with all 12 entries preserved),
this confirms, against the live public network:

1. **The public API data is honest.** Every queried source — public API,
   local badger block store, unified-DB copy — returns the same 12-entry
   receipt. koinosblocks.com is correct.
2. **Block 32,789,378's header stores the incorrect root** for its parent's
   delta: the 11-entry tombstone-dropped value produced by the
   `verify-blocks=false` replay bug during the January 2026 halt recovery,
   signed into the chain when production resumed.
3. The mainnet therefore carries one permanently mis-anchored block. The
   state contents were and are correct; the scar is confined to that one
   signed fingerprint.

## Reproduce it yourself

```bash
node scripts/verify-block-32789377-root.js                 # api.koinos.io
node scripts/verify-block-32789377-root.js https://<rpc>   # any node
```

Any Koinos API node with block-store access reproduces the same three lines.

## Agreed direction for the fix

The engineer's proposal — handle this in `rectify.cpp`, the established
mechanism for per-block consensus corrections (heights 9,180,357 and the
Oct-2025 KFS window) — is adopted, with one implementation nuance:

`maybe_rectify_state()` runs on the execution path after the block applies
and can adjust the receipt, but the merkle root is derived from the state
node's internal removed-objects set, for which no "un-record" API exists.
Forcing the 11-entry root at this block therefore needs:

1. **A small koinos-state-db-cpp addition** — e.g.
   `discard_removal_record( space, key )` on the writable state node,
   documented as rectification-only: removes the key from the delta's
   removed-objects set so it contributes no tombstone leaf to the merkle
   root (the state content is untouched — the key does not exist either
   way).
2. **A new section in `rectify.cpp`** for block
   `0x1220a97d…d586` (height 32,789,377): call the new API for the phantom
   key, and drop the matching entry from the receipt copy for coherence.

With those two pieces, both sync paths converge on the chain's recorded
root with no further special-casing:

- **verify-blocks=true** (full re-execution): rectify fires during the
  block's application, execution produces the 11-entry root, and block
  32,789,378's parent-root check passes. (Without this, an honest
  re-execution sync halts at 32,789,378 — the same failure the live honest
  nodes hit in January.)
- **verify-blocks=false with the checked-replay fix**: preserve-tombstone
  replay of the stored 12-entry receipt mismatches the signed root, the
  fallback re-executes the block, re-execution now includes the
  rectification, the root matches, and the sync continues. The generic
  fallback design needs no changes.

Planned validation: unit test reproducing the block shape (12-entry receipt,
rectified root equals the 11-entry value) and the full mainnet gate resync
passing this height with exactly one `delta_replay_fallback` at 32,789,377
plus one at 30,504,202.

---

## Q&A: Would the tombstone fix have prevented January? Do the new findings discard earlier conclusions?

Asked by the blockchain engineer after reviewing the confirmation above.

### Would the preserve-tombstone fix have prevented the January incident?

For **three of the four reported halt heights** (30,488,260 / 32,770,790 /
32,900,351): **yes, unambiguously.** Those were the pure replay bug:
`verify-blocks=false` nodes dropped transient tombstones, silently computed
wrong roots, and failed far from the cause. The full-history audit proves
preserve-tombstone replay reproduces the consensus roots of those causal
blocks exactly. With the fix those nodes would neither have crashed nor
needed a resync.

For the fourth (32,789,378, the scar): **very likely yes, with an elegant
detail.** The signed 11-entry root is exactly the bug's signature (the
12-entry root minus one dropped tombstone). If the recovery node reached its
head by replaying 32,789,377's receipt with the old code, the remove was
dropped and the root came out as 11. Preserve-tombstone replay computes the
12-entry root **regardless of whether the key exists in the replaying node's
local state** — the tombstone is preserved unconditionally — so block
32,789,378 would have been produced with the correct anchor and the scar
would not exist. Additionally, the fix's new per-block root verification
would have surfaced any divergence AT the causal block instead of letting a
wrong root be signed into the chain.

Honest caveat: the exact path the recovery node took is not proven (buggy
replay, or execution on a state missing the key for another reason — partial
restore, crash-time corruption). What is proven bit-exactly is that the
signed root has precisely the bug's shape. If the state was already divergent
for another cause, the tombstone fix alone would not repair that divergence —
but the new verification would have detected and halted it before it reached
a signed header.

### Do the new findings discard the earlier conclusions?

No — one sub-conclusion is corrected and the rest comes out stronger:

- **Unchanged:** everything about bug #860 — mechanism, deterministic tests,
  the state-db and chain fixes, the three transient-tombstone causal blocks,
  the audit method and totals.
- **Unchanged:** the 30,504,202 anomaly (Oct-31-2025 KFS hardfork + receipt
  persistence bug #858), verified bit-exact.
- **Unchanged:** no single fixed replay semantics passes the whole chain;
  per-block verification is required.
- **Corrected:** only the INTERPRETATION of block 32,789,377 — from "era
  no-op remove, the receipt over-records" to "the 12-entry receipt is honest;
  the 11-entry signed root is a scar of the January recovery." Mechanically
  even the auditor's handling was already right (subset-drop; same totals);
  what changed is the WHY, and with it the chosen remedy (the rectify.cpp
  section plus the `discard_removal_record` state-db API).

The finding in fact **strengthens** the case for upstreaming the fix: the bug
did not merely strand nodes — it wrote an incorrect root into the chain's
consensus history.
