# Native BASEDIR Config Override Bug

## Summary

In Knodel's `native` runtime, starting or restarting the node could silently overwrite an existing runtime config file at `<BASEDIR>/config.yml` with the repository template from `<repoPath>/config/config.yml`.

This was a problem because `BASEDIR/config.yml` is the effective runtime configuration actually consumed by native services such as `koinos_chain`. Any local operator override added there was lost on the next Knodel-managed start.

In the reported case, the lost override was:

```yaml
chain:
  verify-blocks: true
```

Without that flag, `chain` rebuilt state from stored block deltas during indexing, and the node repeatedly failed on:

```text
block previous state merkle mismatch
```

at block `33484184`.

## User-visible Impact

The failure mode was confusing because it looked like a blockchain or P2P problem, but the immediate trigger was Knodel reverting the runtime config behind the user's back.

Observed symptoms:

- `chain` restarted normally and connected to `block_store`, `mempool`, and AMQP.
- `p2p` successfully connected to peers and requested blocks.
- `chain` repeatedly failed while applying the next block with `block previous state merkle mismatch`.
- A debug artifact was generated repeatedly at:
  `/Volumes/external/.koinos/chain/logs/merkle_mismatch_debug_0x1220805ebbaf4c6050329a415543d3e0d626369b7f968b130ecfec4deaa183a88941.json`

Because Knodel kept restoring the template config, the node could appear to "ignore" a user fix even though the user had edited the correct runtime file.

## Why `verify-blocks` mattered here

This report sat on top of a separate chain-state issue.

The local node had historical state that could not be reconstructed correctly by trusting stored deltas alone. During indexing, the node reached height `33484183`, but the local merkle root produced for that head did not match the `previous_state_merkle_root` claimed by block `33484184`.

The important distinction is:

- `receipt persistence` fixes in `koinos-chain` can prevent future bad persisted data.
- They do not automatically repair already-persisted historical data in an existing `block_store`.

For that specific node, the practical recovery path was enabling:

```yaml
chain:
  verify-blocks: true
```

With that option enabled, `chain` re-executes blocks during indexing instead of trusting persisted deltas. That allowed the node to reconstruct the correct state and continue syncing.

## Root Cause

The bug was in Knodel's runtime file preparation logic.

### Effective config flow

For native runtime, Knodel prepares runtime files under `BASEDIR` before launching services:

- source config directory: `<repoPath>/config`
- effective runtime config: `<BASEDIR>/config.yml`

The helper responsible for this is:

- [electron/main.ts#L1789](/Users/pgarcgo/code/knodel/electron/main.ts#L1789)

Before this change, that helper always copied:

- `config.yml`
- `chain/genesis_data.json`
- `jsonrpc/descriptors/koinos_descriptors.pb`

from the repo config directory into `BASEDIR`, unconditionally.

### Where the overwrite happened

That helper is invoked from the native runtime startup flow:

- [electron/main.ts#L4806](/Users/pgarcgo/code/knodel/electron/main.ts#L4806)
- [electron/main.ts#L5085](/Users/pgarcgo/code/knodel/electron/main.ts#L5085)
- [electron/main.ts#L5229](/Users/pgarcgo/code/knodel/electron/main.ts#L5229)

It is also invoked after blockchain restore:

- [electron/main.ts#L6319](/Users/pgarcgo/code/knodel/electron/main.ts#L6319)

That meant the overwrite could happen in at least these scenarios:

1. Starting the native node.
2. Restarting an individual native service.
3. Restoring a blockchain backup.

### Why the overwrite was silent

Knodel treated `BASEDIR/config.yml` as a generated runtime artifact, not as a file that may contain intentional local overrides. There was no merge, no preservation rule, and no warning that an existing runtime config was being replaced.

In the reported case, that caused the following sequence:

1. The operator enabled `verify-blocks: true` in `/Volumes/external/.koinos/config.yml`.
2. Knodel restarted the native services.
3. Knodel copied `/Users/pgarcgo/code/koinos_code/koinos/config/config.yml` over `/Volumes/external/.koinos/config.yml`.
4. The copied file did not contain `verify-blocks: true`.
5. `chain` started without the override and re-entered the merkle mismatch loop.

## Reproduction

The issue was reproducible with the following workflow:

1. Run Knodel in `native` mode with a real `BASEDIR`.
2. Edit `<BASEDIR>/config.yml` and add a runtime-only override, for example:

   ```yaml
   chain:
     verify-blocks: true
   ```

3. Start or restart the node from Knodel.
4. Inspect `<BASEDIR>/config.yml`.

Before the fix, the override disappeared if the repo-side template did not contain the same change.

In this incident, both of these files were byte-identical after Knodel restarted the node:

- `/Users/pgarcgo/code/koinos_code/koinos/config/config.yml`
- `/Volumes/external/.koinos/config.yml`

That confirmed the runtime file had been rewritten from the repo template.

## Fix

The fix is intentionally narrow:

- Preserve an existing `BASEDIR/config.yml`.
- Continue refreshing runtime artifacts that are expected to track the repo:
  - `chain/genesis_data.json`
  - `jsonrpc/descriptors/koinos_descriptors.pb`

Implementation:

- [electron/main.ts#L1789](/Users/pgarcgo/code/knodel/electron/main.ts#L1789)

The runtime file mapping now distinguishes between:

- files that should be preserved if they already exist,
- files that should still be copied unconditionally.

`config.yml` is now marked as `preserveExisting: true`.

If the target file already exists, Knodel:

- leaves it untouched,
- records it in the operation output as a preserved runtime file.

## Why this fix is correct

`config.yml` is qualitatively different from the other runtime files copied into `BASEDIR`.

- `config.yml` is operator-authored configuration and may legitimately diverge from the repo template.
- `genesis_data.json` and `koinos_descriptors.pb` behave more like versioned runtime assets and are safer to keep aligned with the repo.

Preserving `config.yml` aligns Knodel with operator expectations:

- local runtime overrides survive restarts,
- recovery flags such as `verify-blocks` remain effective,
- the app stops silently reverting operational changes.

## Scope

This fix does **not** attempt to solve the underlying historical chain-state inconsistency by itself.

What it does solve:

- Knodel no longer destroys the runtime config override required to recover from that state.

What it does not solve:

- existing bad historical deltas or receipts in external data,
- automatic detection of when `verify-blocks` should be enabled,
- UI-level editing or visibility of this setting.

## Validation

Validation performed for this change:

- `npm run build:electron` passed after the patch.
- Runtime investigation confirmed the original overwrite path:
  - the active `koinos_chain` process was launched as a child of Electron,
  - the active `/Volumes/external/.koinos/config.yml` matched the repo template exactly before the fix was applied to the source config,
  - once `verify-blocks: true` remained available at startup, the node resumed syncing and the head continued increasing.

## Follow-up Ideas

This patch is deliberately minimal. Reasonable follow-ups would be:

1. Expose selected chain settings such as `verify-blocks` in the Knodel UI.
2. Add a warning when the repo template and runtime `config.yml` diverge significantly.
3. Support an explicit override file or merge strategy instead of treating `config.yml` as either fully generated or fully user-managed.
4. Add an integration test around native startup that verifies an existing `BASEDIR/config.yml` is preserved.

## Suggested PR framing

If this document is later adapted into a PR description against the main branch, a good framing would be:

- **Problem**: native startup overwrites user runtime config in `BASEDIR/config.yml`
- **Impact**: local operational overrides are lost; recovery settings such as `chain.verify-blocks` do not persist across restarts
- **Fix**: preserve existing `BASEDIR/config.yml` while still refreshing required runtime assets
- **Validation**: electron build passes; node recovery no longer depends on reapplying the config after every restart
