# Full-History State Delta Audit — 2026-07-07

First complete cryptographic validation of the Koinos mainnet state delta
history, covering every block from genesis to height 37,280,004. This report
has two parts: a plain-language summary for non-specialists, and a technical
report for blockchain engineers. The tooling changes that made the audit
possible are documented in `STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md` and were
merged via PR #23.

---

## Part 1 — For everyone

### What was checked, and why

A blockchain node keeps two related records: the blocks themselves, and the
database changes each block caused (balances updated, records created or
deleted). Every block also carries a cryptographic fingerprint — a "state
root" — that the whole network agreed on when the block was accepted. If you
recompute the fingerprint from the recorded changes and it matches, the
recorded history is provably intact; if it doesn't, something is wrong with
either the record or the software that wrote it.

Years ago, node software had a subtle bug in how it handled one specific kind
of database change: deleting a record that didn't exist yet at the start of
the block (it was created and deleted within the same block). The current
software fixes this, but a question remained: **how much of the existing
chain history was actually touched by the old bug, and does the full history
still check out under the corrected rules?**

Until now nobody knew, because checking all 37 million blocks took days and
the checking tool itself had bugs that stopped it partway. Both problems were
fixed, and the complete check has now been run for the first time.

### The result

**37,280,004 blocks checked. 37,280,002 are perfect. 2 are anomalous.**

- **Block 32,789,377** is a confirmed example of the old bug. Its record
  contains a delete of a record that never existed outside that block, and
  the old software silently left that delete out of the fingerprint math. The
  audit identified the exact affected entry. The chain data is not corrupt —
  the old software just computed the fingerprint slightly differently, and we
  can now prove precisely how.
- **Block 30,504,202** doesn't match and can't be fully explained from this
  machine's data alone. The most likely cause is that this particular copy of
  the history is missing one small entry for that block (the reverse side of
  the same old bug). Checking against a second, independent copy of the chain
  would settle it.

### What this means

- The historical record on this node reproduces the network-agreed
  fingerprints essentially perfectly — 99.999995% of blocks match exactly.
- The old bug's real-world footprint was tiny: one confirmed block out of 37
  million, plus one suspect.
- The corrected software's rules are the right ones: they reproduce what the
  network actually agreed on, block after block, across four years of
  history.
- The full check now takes about 4 hours on a small desktop computer with an
  external USB drive, so it can be re-run any time — for example after
  restoring a backup, or to verify a copy of the chain before trusting it.

---

## Part 2 — For blockchain engineers

### Scope and setup

- **Source**: read-only mainnet block store (RocksDB, 25 GiB, 41,488,547
  block records including fork candidates), restored basedir at
  `/Volumes/external2/.koinos`.
- **Hardware**: Mac mini, 8 GiB RAM, source and scratch on a USB spinning
  disk — deliberately modest, to prove the audit is operationally routine.
- **Tool**: `koinos_state_delta_replay_audit` (default direct-delta-root
  journal path), as of PR #23.
- **Wall time**: journal build ≈ 70 min (full source scan, 41.5M records);
  replay 2 h 41 min (15:36–18:17 CEST). The journal is a reusable artifact;
  subsequent replays skip the build.

### Methodology

1. **Journal build.** One sequential scan of the source block-store column
   family streams every record through a reader → parser-pool → writer
   pipeline. Receipts are pruned to the audit-relevant fields (id, height,
   `state_merkle_root`, `state_delta_entries`) and written to height-bucketed
   flat files (100k heights/bucket) through per-bucket memory buffers flushed
   as large sequential appends. The scan is never truncated: fork candidates
   for an already-seen height appear arbitrarily late in the block-id-ordered
   scan, and every candidate is journaled (4,208,543 fork candidates
   alongside 37,280,004 canonical heights). Metadata records a
   `full_source_scan` marker; journals built by older tool versions without
   the marker are rebuilt automatically.
2. **Canonical chain resolution — backward.** The audit anchors on the source
   head block id (canonical by definition) and walks parent pointers
   downward. Each block's `previous` uniquely selects the canonical block
   below, which is immune to the sibling-fork ambiguity that breaks forward
   greedy parent chaining (two fork siblings share a parent; a forward walk
   can select the orphan and abort one height later). The walk terminates at
   genesis against a zero-hash anchor for both parent id and parent state
   root.
3. **Root validation.** Per block, the delta Merkle root is recomputed from
   the serialized `state_delta_entries` (sorted key/value leaf pairs, SHA-256
   Merkle tree, preserve-tombstone semantics: a remove hashes as an
   empty-value leaf). Decoding and hashing run on all cores one bucket at a
   time; only the id/root chain comparison is sequential. The computed root
   must equal the child block's `previous_state_merkle_root`. Note that all
   37.28M mainnet receipts have an empty `state_merkle_root` field, so the
   validation chain rests entirely on the consensus-signed header roots — the
   stronger anchor.
4. **Anomaly classification.** On a root mismatch, the auditor searches
   subsets of the block's recorded entries (≤ 20 entries) for an omission
   that reproduces the consensus root exactly; a 256-bit match identifies the
   precise entry set the era's node excluded from its Merkle computation.
   Matches are classified as legacy drops (tombstones vs puts counted
   separately); non-matches are recorded as unexplained with full forensics.
   The run always completes the inventory; exit status 2 and a
   `completed with unexplained mismatches` verdict distinguish a non-clean
   audit from a clean one.

### Results

```
blocks_checked:                  37,280,004
receipt_delta_entries:           290,295,679
receipt_puts:                    284,883,828
receipt_removes:                   5,411,851
receipts_without_state_root:    37,280,004   (all — validation via header roots)
legacy_dropped_tombstone_blocks:          1
legacy_dropped_tombstones:                1
legacy_dropped_puts:                      0
unexplained_mismatch_blocks:              1
final_height:                    37,280,004
final_block_id:        0x12205fd14f5c2d504646bf69e88ef2e8d8db41e60b4ff6c087430a852e286cd2ada0
final_state_merkle_root: 0x1220b674199c1c179e1446691324b10bfbb27181b03f621da23b45474c80427007a6
```

### Anomaly 1 — legacy tombstone drop (height 32,789,377)

- Block id
  `0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586`.
- Receipt records 12 delta entries, 2 of them removes. The consensus root
  (child's `previous_state_merkle_root`) is reproduced exactly when entry #8
  — a remove with key
  `0x3032303736343330323334323533303630393939393936` — is omitted from the
  Merkle computation; the other remove must be kept.
- This matches the documented legacy semantics bit-for-bit:
  `state_delta::erase()` under `preserve_tombstone=false` records a remove of
  an existing key but silently drops a remove of a parent-absent key
  (transient tombstone) from the delta, while the receipt records both. See
  `STATE_DELTA_TOMBSTONE_REPLAY_REPORT.md` for the code-level analysis.
- Interpretation: the receipt is the more complete record; the era's
  consensus root under-counted one transient tombstone. Data is internally
  consistent with the known bug; nothing is corrupt.

### Anomaly 2 — unexplained mismatch (height 30,504,202)

- Block id
  `0x1220f0ca713b49490ff60f5636e2848f48a7b31c95f583074a30ce7e3cb35d154524`.
- Receipt records 8 delta entries, all puts, no removes.
- Expected root
  `0x12209d2d9592ddf831e892a5d4d38e93324f6834e255f84509b5e1c907ccfaa685e6`,
  computed root
  `0x12207fb526273e706238cef899350facfd1ddcfa5e19ae352284be53e68d5c516f45`.
  No subset of the 8 recorded entries (255 combinations) reproduces the
  expected root.
- Working hypothesis: the inverse legacy failure — the receipt in this block
  store copy is missing an entry (most plausibly a transient tombstone
  stripped by an old replay-based sync) that the consensus root includes.
  Missing data cannot be reconstructed locally by subset search.
- Deterministic across runs; immediate neighbors validate cleanly, ruling out
  systematic computation or selection error at that region.

### Limitations and follow-ups

- **The audit validates recorded data, not crash durability.** The RocksDB
  synced-batch hardening (deletes/tombstones/metadata fsynced with puts) is a
  crash-consistency fix; verifying it requires kill-and-restart testing, not
  replay.
- **Head root cross-check pending**: compare
  `0x1220b674...07a6` at height 37,280,004 against a live node's state root
  for the end-to-end anchor.
- **Height 30,504,202** should be re-audited from an independent block-store
  copy to distinguish local receipt degradation from an on-chain-era
  inconsistency shared by all copies.
- **Prefix audits (`--to-height`)** anchor on the first stored candidate at
  the tip height; if fork siblings exist exactly there, only the tip block
  itself is ambiguous (an orphan's ancestry is canonical below its fork
  point). Full audits anchor on the recorded head id and have no ambiguity.

### Reproduction

```bash
cmake --build node/teleno-node/build --target koinos_state_delta_replay_audit --parallel

node/teleno-node/build/koinos_state_delta_replay_audit \
  --source-basedir /path/to/restored/basedir \
  --scratch-state-dir /path/to/audit-scratch \
  --progress-every 100000
```

Exit 0 + `state delta replay audit: ok` = clean; exit 2 +
`completed with unexplained mismatches` = completed inventory with
unexplained anomalies (see the audit log for `legacy_entry_drop` and
`unexplained_state_root_mismatch` lines). The journal
(`<scratch>.delta-journal`) is reusable; replay-only reruns take ~2.7 h on
the reference hardware.
