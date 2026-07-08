# Integration gate: full mainnet resync with checked delta replay

Decisive validation (§5.3 of `LEGACY_DELTA_REPLAY_FIX_BRIEF.md`) for the fix
delivered on:

- `koinos-state-db-cpp` `fix/preserve-tombstone-remove` (tag **v1.2.1**, head `3a1c904`)
- `koinos-chain` `fix/860-state-delta-tombstone-replay` (head `52fe6e08`)
- `koinos-cmake` `fix/macos-arm64` (`3068555`, pins state-db v1.2.1)

This run takes hours to days and needs a full-history mainnet block store —
run it manually when machine time is available.

## Prerequisites

1. **Binaries.** Build koinos-chain from the branch above:
   ```bash
   cd ~/code/forks/koinos-chain
   HUNTER_ROOT=/Volumes/external/.hunter cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
     -DFETCHCONTENT_SOURCE_DIR_KOINOS_CMAKE=$HOME/code/forks/koinos-cmake
   HUNTER_ROOT=/Volumes/external/.hunter cmake --build build -j
   ```
   The binary is `build/src/koinos_chain`. Confirm the fix is present:
   `strings build/src/koinos_chain | grep -c delta_replay_fallback` → ≥ 1.

2. **Block store with full history.** A mainnet block store copy covering
   genesis → ≥ 32,789,378 (through both anomalies; a head at 37,280,004
   matches the audited reference exactly). Restore one of the Knodel backups
   or copy from an archival node.

3. **Service stack.** Chain syncs from the block store over AMQP. Use the
   Knodel legacy-native harness (GarageMQ + block_store + chain), pointing the
   chain service at the fixed binary, or run the services by hand:
   GarageMQ → koinos_block_store (existing data) → fixed koinos_chain.

## Run

Fresh chain data directory (do NOT reuse existing chain state), with:

```yaml
# chain config
verify-blocks: false
```

Start block_store first, then chain with `--basedir` pointing at the fresh
directory. Chain enters indexing mode and replays receipts from the block
store. Capture the chain log to a file.

## Pass criteria (ALL required)

1. **Sync completes** from genesis to the block store head without manual
   intervention.

2. **Exactly two fallback lines**, at exactly these blocks:
   ```
   grep delta_replay_fallback chain.log
   ```
   must print exactly two lines (order as below) and nothing else:
   - `height=30504202 id=0x1220f0ca713b49490ff60f5636e2848f48a7b31c95f583074a30ce7e3cb35d154524`
     (receipt lost an entry — 8 puts recorded, no subset reproduces consensus)
   - `height=32789377 id=0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586`
     (legacy tombstone drop — remove of KFS vote key `02076430234253060999996`
     excluded from consensus but recorded in the receipt)

   The indexer completion message must read
   `Delta replay re-execution fallbacks: 2`.

3. **Head root matches the audit.** If the block store head is 37,280,004:
   - head block id `0x12205fd14f5c2d504646bf69e88ef2e8d8db41e60b4ff6c087430a852e286cd2ada0`
   - head delta merkle root `0x1220b674199c1c179e1446691324b10bfbb27181b03f621da23b45474c80427007a6`
   If syncing past that height, the chain check is implicit: the sync not
   halting at 37,280,005 proves the root at 37,280,004.

4. **Live transition.** After indexing, the node applies the first live/new
   block normally (its `previous_state_merkle_root` check passes) — no
   `state merkle mismatch` in the log after the completion message.

Any additional `delta_replay_fallback` line, any `state_merkle_mismatch`
halt, or a differing head root is a FAIL — capture the log and the failing
height's receipt for analysis.

## Negative control (recommended)

Repeat a bounded restore-through-failure-heights run (e.g. genesis →
30,600,000) with an UNPATCHED chain build (upstream master or fork commit
`5a00d133`): it must silently produce a wrong root at 30,504,202 and only
fail much later (or reach the bound with wrong state), demonstrating the
failure mode the fix removes. With PR2-only (commit `51124213`, asserts but
no fallback) the same run must halt fail-fast at 30,504,203 with
`block previous state merkle mismatch`.

## Performance check (§5.4)

Compare blocks/s of the indexing phase against a previous
`verify-blocks=false` sync on the same hardware. The added cost is one
`pending_merkle_root` (sort + SHA2-256 over ~7.8 entries/block mean) per
block plus the parent-root comparison; regression must stay < 5%.

## Cross-implementation parity (§5.5, optional)

Sync the same block store copy through the Teleno monolithic node with the
equivalent fix (koinos-one) and require identical head state merkle roots
and identical fallback heights. Reference totals: 37,280,002 blocks clean,
290,295,679 delta entries (284,883,828 puts / 5,411,851 removes).
