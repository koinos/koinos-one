# State Delta Tombstone Replay Report

Date: 2026-06-26

## Deterministic Conclusion

The merkle mismatch was a replay bug in the fast receipt-delta path, not evidence that historical block receipt state deltas need to be rewritten.

When `verify-blocks=false`, the node can restore/sync by applying stored `protocol::block_receipt.state_delta_entries` instead of re-executing every transaction and system contract callback. That replay path must treat a remove entry in a serialized receipt as an explicit tombstone, even if the key is not present in the parent state.

The failing pattern is:

1. Parent state contains key `A`.
2. The block execution removes `A`.
3. The same block creates key `B`.
4. The same block removes key `B`.
5. The same block creates key `C`.

The final block receipt is a compacted net delta, not a chronological operation log:

| Key | Receipt entry | Why |
|-----|---------------|-----|
| `A` | remove | It existed in the parent and is gone after the block. |
| `B` | remove | It existed transiently during this block and is gone by the final block state. |
| `C` | put | It exists in the final block state. |

There is no `put B` in the block receipt because `B` is not part of the final block state. That is expected.

The old replay path applied `remove B` with normal mutation semantics. Normal mutation sees that `B` is absent from the parent and absent from the current replay node, so it treats the remove as a no-op. The resulting replay delta loses the `B` tombstone, and the replayed state-delta merkle root differs from the root stored in the block receipt.

The fixed replay path applies serialized remove entries with `remove_object_preserve_tombstone()`. That preserves `remove B` exactly as it was serialized in the historical receipt. The replayed state-delta merkle root then matches the receipt root.

## Why This Can Appear Only Sometimes

This is data-shape dependent. The bug appears only when a block receipt contains a remove entry for a key that is absent from the parent state but must still be represented in the compacted block delta.

That can happen when a key is created and removed inside the same block. It does not happen for every vote or every block that includes project/funding-related activity.

The production discussion that triggered this investigation referred to the Koinos Fund System (KFS), the community funding application at `https://kfs.koinscan.com/`. Its public documentation describes project submissions, KOIN/VHP voting, vote expiration, transfer-triggered vote updates, vote-ranked funding distribution, and monthly payments. Those product-level mechanics are enough to make KFS a plausible source of rich contract state changes, but the KFS contract source is not part of this repository and was not audited here.

The proof below is therefore deliberately contract-agnostic. It does not require KFS to have a specific internal key layout. It proves the replay invariant that any Koinos contract can trigger:

If contract execution produces a compacted block receipt containing a remove entry for a key that is absent from the parent but existed transiently during the block, receipt replay must preserve that remove entry as a tombstone.

So two historical blocks can both look like "a vote happened" at the application level, but produce different state-delta shapes depending on the exact KFS state at that height, token/VHP accounting, vote expiration/renewal, project ranking, payment timing, and any other contract state touched in the same block.

## KFS-Specific Simulation

The KFS frontend bundle currently constructs the fund contract with this contract ID:

```text
1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
```

The same bundle exposes ABI methods including:

```text
get_global_vars
get_project
get_projects
get_user_votes
submit_project
update_vote
update_votes
pay_projects
```

Note: `19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK` also appears in Julian's public Koinos repositories and in the frontend dependency graph, but there it is used as the KOIN token contract, not the KFS fund contract.

The public GitHub repositories under `https://github.com/joticajulian` were searched locally after shallow-cloning the 75 public repositories visible through the GitHub API. No public repository in that set contained `fund.proto`, `set_votes_koinos_fund`, `pay_projects`, `submit_project`, `update_vote`, `get_user_votes`, or the KFS fund contract ID. The ABI used above was recovered from the deployed KFS frontend bundle.

The contract source and private storage prefix layout were not found in this repository or in the public KFS frontend. Therefore the native proof does not claim to execute the KFS WASM. Instead, it simulates a KFS-like project ordering state transition inside the real KFS contract object space:

```text
contract: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
space id: 2
parent key: active/by_votes/0000000100/project/0000000007
transient key: active/by_votes/0000000175/project/0000000007
final key: active/by_votes/0000000250/project/0000000007
```

The simulated KFS block-local execution is:

```text
remove old order key
put intermediate order key
remove intermediate order key
put final order key
```

The compacted receipt delta is:

```text
remove old order key
remove intermediate order key
put final order key
```

That is the exact shape needed to trigger the replay bug if serialized remove entries are applied with normal absent-key delete semantics.

The test `test_kfs_project_order_delta_requires_preserved_tombstone()` proves:

| Replay strategy | Result |
|-----------------|--------|
| Normal `remove_object()` | Merkle root does not match the KFS execution root. |
| `remove_object_preserve_tombstone()` | Merkle root matches the KFS execution root exactly. |

This is the strongest deterministic proof possible from the currently available public KFS artifacts. A full WASM-level KFS replay proof would require the deployed KFS WASM/source plus an exact pre-block state snapshot for the target historical block.

## Why The Stored Delta Is Not The Bug

`state_delta` stores two logical sets:

- current key/value writes in the block-local backend;
- removed keys in `_removed_objects`.

During normal block execution:

```text
remove A -> removed_objects = { A }
put B    -> backend = { B }, removed_objects = { A }
remove B -> backend = { }, removed_objects = { A, B }
put C    -> backend = { C }, removed_objects = { A, B }
```

When `get_delta_entries()` serializes the block receipt, it emits the final compacted state:

```text
remove A
remove B
put C
```

That compacted representation is correct because it commits the final delta from parent state to child state. It is not meant to show every intermediate operation.

## What The Fix Changes

Normal state mutation should still use `remove_object()`. It should not create a tombstone for every absent-key delete because normal contract execution may try to remove missing keys and should not invent state changes.

Receipt replay is different. A remove entry in a persisted receipt is already a committed historical state-delta entry. Replaying it must preserve it exactly.

The fix is therefore intentionally narrow:

```cpp
if( delta_entry.has_value() )
  block_node->put_object( object_space, delta_entry.key(), &delta_entry.value() );
else
  block_node->remove_object_preserve_tombstone( object_space, delta_entry.key() );
```

This lives in `controller_impl::apply_block_delta()`, the `verify-blocks=false` receipt replay path.

## Deterministic Proof Added

The tests `test_transient_contract_state_delta_requires_preserved_tombstone()` and `test_kfs_project_order_delta_requires_preserved_tombstone()` were added to:

```text
node/teleno-node/tests/chain/controller_delta_test.cpp
```

The test creates this exact state transition:

```text
parent: A exists, B absent, C absent
execution: remove A, put B, remove B, put C
receipt delta: remove A, remove B, put C
```

It then replays the same serialized receipt entries twice:

| Replay strategy | Result |
|-----------------|--------|
| Normal `remove_object()` | Merkle root does not match the original execution root. |
| `remove_object_preserve_tombstone()` | Merkle root matches the original execution root exactly. |

That proves the failure mode and the fix without depending on mainnet data, timing, RocksDB, peer sync, or any external API.

## Verification

Commands run:

```bash
cmake -S node/teleno-node -B node/teleno-node/build -DKOINOS_BUILD_TESTS=ON
cmake --build node/teleno-node/build --target koinos_controller_delta_test --parallel
ctest --test-dir node/teleno-node/build --output-on-failure -R '^koinos_controller_delta_test$'
```

Result:

```text
100% tests passed, 0 tests failed out of 1
```

## Operational Implication

For this bug, the corrective action is to replay historical receipt remove entries with tombstone-preserving semantics. Rewriting historical block receipts is not required by this proof.

If a future audit finds a block receipt whose stored state-delta root cannot be reproduced even when serialized remove entries are preserved, that would be a separate evidence class. The proof here only covers the observed mismatch class where compacted receipt removes were replayed with normal absent-key remove semantics.
