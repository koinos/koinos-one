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
