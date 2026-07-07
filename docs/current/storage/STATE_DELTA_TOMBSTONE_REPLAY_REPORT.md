# State Delta Tombstone Replay Report

Date: 2026-06-26

## Scope And Evidence Sources

This report analyzes the state-delta replay failure discussed around Koinos
Fund System (KFS) activity and the reported `block previous state merkle
mismatch` failures near heights `30488260`, `32770790`, `32789378`, and
`32900351`.

Evidence used here:

- local code inspection of the fast receipt-delta replay path in
  `node/teleno-node/src/koinos/chain/controller.cpp`;
- local code inspection of state-delta tombstone serialization in
  `node/teleno-node/src/koinos/state_db/state_delta.cpp`;
- local code inspection of the state-node mutation API in
  `node/teleno-node/src/koinos/state_db/state_db.cpp` and
  `node/teleno-node/src/koinos/state_db/state_db.hpp`;
- focused native tests in
  `node/teleno-node/tests/chain/controller_delta_test.cpp`;
- decoded block-store receipt data from a local restored block store, queried
  in block-store-only mode with chain, mempool, P2P, gRPC, producer,
  transaction-store, contract-meta-store, and account-history services disabled.

The block-store query was read-only. It did not execute contracts, connect to
peers, produce blocks, submit transactions, mutate mainnet state, or modify the
restored chain database.

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

## Block Where The Replay Shape Appears

The strongest production candidate from the decoded block-store data is:

```text
reported failing block: 32789378
causal receipt-delta block: 32789377
causal block id: 0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586
KFS contract: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
KFS object-space zone, raw base64: AGODyCuhi5XqbJWB30tP4BYEWmCH6mq2zg==
KFS object-space id carrying the remove-only entries: 2
receipt state-delta shape: 12 entries, 9 puts, 3 removes
KFS remove-only keys:
  02076430234253060999996
  02076434190761140999996
  02076434345629600999996
next block id: 0x122086d9090d82fceb9900293bd3f870c4d2ac769682a85f997fd847f4f716a96344
next block receipt state-delta shape: 8 entries, 8 puts, 0 removes
```

That does not mean block `32789378` contains the bad KFS remove pattern. It
means old replay semantics can compute the wrong parent state after replaying
block `32789377`, and the next call to `apply_block_delta()` then rejects block
`32789378` because its `previous_state_merkle_root` no longer matches the local
parent node.

The same causal/reported-height separation explains the other candidate
windows:

| Reported failure height | Likely causal block | Causal block id | Relevant KFS remove-only keys |
|-------------------------|---------------------|-----------------|-------------------------------|
| `30488260` | `30488259` | `0x1220b3b40956db24054353baceb370f2511325aa980fcfb95fb38bdec54593df5672` | `00797079599230148999998`, `00797081952840770999998`, `00797082044967476999998` |
| `32770790` | `32770789` | `0x1220e71404cefd0058f9d24fbad2b99c0606903029cfe819ce3b1bd2f103e4d510d1` | `02075891930478830999996`, `02075895886712530999996`, `02075896041570250999996` |
| `32789378` | `32789377` | `0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586` | `02076430234253060999996`, `02076434190761140999996`, `02076434345629600999996` |
| `32900351` | `32900350` | `0x1220a85e1705c62c836a9fee421b0e8a88b5b1bd0c80efb1a0a44fabca5badd5e47d` | `02128925575276130999996`, `02128929533422740999996`, `02128929688355340999996` |

The exact parent key among those three removes cannot be proven from a compacted
receipt alone without the pre-block state snapshot for that object space. The
important invariant is that the receipt contains remove entries which must be
preserved as committed delta entries during replay, even when one of those keys
is absent from the replay parent and therefore looks like a no-op to normal
mutation code.

## Raw Stored Receipt Excerpts

The following excerpts are the decoded KFS-relevant subset of the stored block
receipt state deltas. They are intentionally limited to the object-space and key
data needed for this replay analysis; unrelated receipt entries and large value
payloads are omitted.

For the main candidate causal block:

```text
height: 32789377
block_id: 0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586
receipt_state_merkle_root: <not present in decoded receipt JSON>
state_delta_entries: 12
puts: 9
removes: 3

entry[remove]:
  object_space.system: false
  object_space.zone_raw_base64: AGODyCuhi5XqbJWB30tP4BYEWmCH6mq2zg==
  object_space.zone_decoded: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
  object_space.id: 2
  key_ascii: 02076430234253060999996
  has_value: false

entry[remove]:
  object_space.system: false
  object_space.zone_raw_base64: AGODyCuhi5XqbJWB30tP4BYEWmCH6mq2zg==
  object_space.zone_decoded: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
  object_space.id: 2
  key_ascii: 02076434190761140999996
  has_value: false

entry[remove]:
  object_space.system: false
  object_space.zone_raw_base64: AGODyCuhi5XqbJWB30tP4BYEWmCH6mq2zg==
  object_space.zone_decoded: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
  object_space.id: 2
  key_ascii: 02076434345629600999996
  has_value: false
```

For the next block, where the failure is expected to be reported if the parent
root was already replayed incorrectly:

```text
height: 32789378
block_id: 0x122086d9090d82fceb9900293bd3f870c4d2ac769682a85f997fd847f4f716a96344
receipt_state_merkle_root: <not present in decoded receipt JSON>
state_delta_entries: 8
puts: 8
removes: 0
```

For the later candidate window:

```text
height: 32900350
block_id: 0x1220a85e1705c62c836a9fee421b0e8a88b5b1bd0c80efb1a0a44fabca5badd5e47d
receipt_state_merkle_root: <not present in decoded receipt JSON>
state_delta_entries: 12
puts: 9
removes: 3

KFS remove-only entries:
  object_space.zone_decoded: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
  object_space.id: 2
  key_ascii: 02128925575276130999996
  key_ascii: 02128929533422740999996
  key_ascii: 02128929688355340999996

height: 32900351
block_id: 0x1220db86231a22a6a28d084476a9592037ef3c80beaeaeb2dd06c4addc6cba97a26f
state_delta_entries: 8
puts: 8
removes: 0
```

For the older candidate window:

```text
height: 30488259
block_id: 0x1220b3b40956db24054353baceb370f2511325aa980fcfb95fb38bdec54593df5672
receipt_state_merkle_root: <not present in decoded receipt JSON>
state_delta_entries: 12
puts: 9
removes: 3

KFS remove-only entries:
  object_space.zone_decoded: 1A5BmMqV5jN5zBrdkhQumAfDZBzXLPBeN9
  object_space.id: 4
  key_ascii: 00797079599230148999998
  key_ascii: 00797081952840770999998
  key_ascii: 00797082044967476999998

height: 30488260
block_id: 0x122014d3be588fb8791d56f6dbc2b96bb9fe9bfc6bc722b92414a4c367208bf9ba69
state_delta_entries: 8
puts: 8
removes: 0
```

These block-store observations line up with the deterministic unit test shape:
an execution-time sequence can create a transient key and remove it in the same
block, while the persisted receipt contains only the compacted final delta.
The compacted receipt is correct; replay must preserve its remove entries.

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

## Code-Path Deep Dive

The fast path under analysis is `controller_impl::apply_block_delta()` in
`node/teleno-node/src/koinos/chain/controller.cpp`.

Before applying a receipt delta, the controller checks that the local parent
node root equals the block header's declared parent root:

```cpp
KOINOS_ASSERT( block.header().previous_state_merkle_root()
                 == util::converter::as< std::string >( parent_node->merkle_root() ),
               state_merkle_mismatch_exception,
               "block previous state merkle mismatch" );
```

That is why the visible error can be one block after the causal receipt. If
block `N` is replayed with an incorrect tombstone set, local state at block `N`
is wrong. The next block, `N + 1`, still carries the canonical
`previous_state_merkle_root` for block `N`, so `apply_block_delta()` fails before
it even applies block `N + 1`.

The replay loop now distinguishes value entries from remove entries:

```cpp
for( const auto& delta_entry: receipt.state_delta_entries() )
{
  chain::object_space object_space;
  object_space.set_system( delta_entry.object_space().system() );
  object_space.set_zone( delta_entry.object_space().zone() );
  object_space.set_id( delta_entry.object_space().id() );

  if( delta_entry.has_value() )
    block_node->put_object( object_space, delta_entry.key(), &delta_entry.value() );
  else
    block_node->remove_object_preserve_tombstone( object_space, delta_entry.key() );
}
```

The critical distinction is in the state-delta erase primitive:

```cpp
void state_delta::erase( const key_type& k, bool preserve_tombstone )
{
  if( find( k ) || preserve_tombstone )
  {
    _backend->erase( k );
    _removed_objects.insert( k );
  }
}
```

With normal mutation semantics, `preserve_tombstone=false`, so an absent key is
not inserted into `_removed_objects`. That is correct while executing contracts,
because a contract may try to remove a missing key and that should not invent a
state change.

With receipt replay semantics, `preserve_tombstone=true`, because the remove
entry is not an attempted contract operation. It is already part of a committed
historical delta. Dropping it changes the delta merkle root.

Serialization confirms why this matters. `state_delta::get_delta_entries()`
collects both backend keys and `_removed_objects`, sorts them, and emits entries
without a value for removed keys:

```cpp
for( const auto& removed: _removed_objects )
{
  object_keys.push_back( removed );
}

std::sort( object_keys.begin(), object_keys.end() );

for( const auto& key: object_keys )
{
  protocol::state_delta_entry entry;
  ...
  auto value = _backend->get( key );

  if( value != nullptr )
    entry.set_value( *value );

  deltas.push_back( entry );
}
```

So the merkle material is not just the final live key/value map. The block delta
also includes explicit removals. When a replay path drops a remove-only
tombstone, it is replaying a different receipt delta than the one that was
committed.

The public state-node API therefore has two delete operations:

```cpp
int64_t remove_object( const object_space& space, const object_key& key );
int64_t remove_object_preserve_tombstone( const object_space& space, const object_key& key );
```

`remove_object_preserve_tombstone()` is documented as only for replaying
serialized historical state deltas. It delegates to the same internal
`remove_object(..., true)` implementation, preserving the tombstone without
changing normal contract execution behavior.

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

## Offline Full-History Auditor

A separate native binary is available for final offline validation against a
restored or copied block-store database:

```bash
cmake --build node/teleno-node/build --target koinos_state_delta_replay_audit --parallel

node/teleno-node/build/koinos_state_delta_replay_audit \
  --source-basedir /path/to/restored/basedir \
  --scratch-state-dir /path/to/state-delta-audit-scratch \
  --reset-scratch \
  --progress-every 10000
```

When stderr is attached to a terminal, `--progress-every` renders a live
progress bar with percentage, current height, checked block count, throughput,
and ETA. When stderr is redirected, the same interval emits line-oriented
progress records. Use `--progress-every 0` to disable progress output.

The auditor also appends persistent run, progress, completion, and failure
records to:

```text
SCRATCH_STATE_DIR/state-delta-replay-audit.log
```

Use `--log-file /path/to/audit.log` to choose another path, or
`--no-log-file` to disable file logging.

By default, before replay starts, the auditor builds or reuses a local bucketed
flat-file replay journal:

```text
SCRATCH_STATE_DIR.delta-journal
```

The journal is built with a sequential scan of the source block-store column
family and stores only the block id, block header, and receipt needed for audit
replay. Journaled receipts are pruned to the fields the audit consumes (id,
height, `state_merkle_root`, `state_delta_entries`); events, transaction
receipts, and logs are dropped, which substantially shrinks the journal and
speeds up bucket loads. The journal build always scans the full source column
family, because the scan is in block id order and a fork candidate for an
already-covered height can appear arbitrarily late in the scan. New journals
record a `full_source_scan` marker in their metadata; a `--to-height` prefix
journal built by an earlier auditor version (which could stop the scan early
and drop canonical candidates) lacks the marker and is rebuilt automatically
instead of being reused. The journal is
append-only and split into height-range bucket files, so replay
can validate blocks in chain order without performing one random source RocksDB
lookup per block id, without one random seek per journal record, and without
using RocksDB for the journal itself. This avoids LSM compaction stalls while
preserving support for multiple block candidates at the same height. A full
default audit therefore has two visible phases:

1. `journal`: build, upgrade, or verify the local bucketed header/receipt
   journal;
2. `replay`: compute each receipt state-delta Merkle root directly from the
   serialized receipt entries, validate it against the next block's
   `previous_state_merkle_root`, and compare it with the stored receipt root
   when that root is present.

Use `--journal-dir /path/to/journal` to choose another journal location, or
`--rebuild-journal` to force a fresh journal rebuild. The journal is derived
from the read-only source database and can be deleted at any time; it is only an
audit acceleration artifact.

The default replay path does not rebuild the full state DB. It applies the same
state-delta Merkle hashing rules as the corrected node path to the serialized
receipt entries, including preserved tombstones for receipt remove entries. It
then chains those computed roots through each next block's
`previous_state_merkle_root`. This is the practical full-history validation path
for proving that historical receipt state deltas reproduce the expected parent
state roots and `block_receipt.state_merkle_root` values.

Because each block's delta Merkle root depends only on that block's own receipt
entries, the default replay decodes journal records and computes their roots on
all available CPU cores, one journal bucket at a time. Only the id/root chain
validation is sequential, and it is a cheap string comparison per block, so
replay throughput scales close to linearly with core count.

Canonical block selection walks the chain backward from the audit tip. Fork
siblings can share a parent block (mainnet history retains roughly 4.2M fork
candidates alongside 37.3M canonical blocks), so forward greedy parent chaining
can follow an orphan and abort one height later with a spurious missing-parent
error. Walking backward avoids the ambiguity: the tip block is known — the
source head id for full audits, or the stored candidate for `--to-height`
prefix audits — and each block's `previous` pointer then uniquely selects the
canonical block below it. The walk also validates each block's computed delta
root against the block above's `previous_state_merkle_root`, and terminates at
genesis against the zero-hash anchor for both the parent id and the parent
state root. Because the walk anchors on the tip rather than genesis,
`--from-height` above 1 is supported for the direct replay path; the genesis
anchor is only checked when the walk reaches height 1.

### Legacy tombstone-drop blocks

Full-history replay on a mainnet copy surfaced confirmed on-chain instances of
the old normal-remove semantics. At height 32,789,377 (block id
`0x1220a97d7b0567ad55e3b04446a2bef447335cfd676668b069544b04a4719146d586`), the
recorded receipt holds 12 delta entries including 2 removes, but the state root
committed by consensus (the next block's `previous_state_merkle_root`) matches
the Merkle computation only when exactly one of the removes — a transient
tombstone for a key absent from the parent — is dropped. This is precisely the
`erase()` behavior described above: `if( find( k ) || preserve_tombstone )`
records a remove of an existing key but silently drops a remove of an absent
key from the era's delta Merkle computation, while the receipt records both.

The auditor treats these blocks as a documented, quantified legacy class
rather than corruption. When a block's preserve-tombstone root does not match
the consensus root, it searches remove-entry subsets (up to 16 removes per
block) for one whose omission reproduces the consensus root exactly. A match
increments `legacy_dropped_tombstone_blocks` and `legacy_dropped_tombstones`
in the final statistics and logs a `legacy_tombstone_drop` line with the
height, block id, and dropped-entry count. A mismatch that no remove subset
explains still aborts the audit as a genuine inconsistency.

For deeper diagnostics, `--state-db-replay` switches back to the older
height-index/source-DB replay path. That path builds or reuses a local height
index:

```text
SCRATCH_STATE_DIR.height-index
```

The index maps block heights to source block ids using a sequential scan of the
source block-store column family. State DB replay still reads the original block
records from the read-only source database by id. This avoids repeatedly walking
from the current head through the block-store skip-list for early mainnet
heights, but it still performs random source block-store reads during replay and
is therefore much slower than the default journal path.

Use `--height-index-dir /path/to/index` to choose another state DB replay index
location, or `--rebuild-height-index` to force a fresh index rebuild.

Known `--state-db-replay` limitation: the height index keeps one block id per
height, chosen as the first record seen in the block-id-ordered source scan. If
the source block store retains an applied-then-reverted fork block at some
height, the index can map that height to the fork block and the replay aborts
with a parent mismatch. The default journal replay path does not have this
limitation because it stores every candidate per height and resolves the
canonical block by walking the chain backward from the known audit tip.

When `--state-db-replay` is used, the scratch state DB uses asynchronous RocksDB
writes by default because it is a rebuildable audit artifact and a full fsync for
every replayed block makes full-history validation impractically slow on many
disks. Use `--sync-scratch-writes` to force a durable fsync on every scratch
state commit when testing the slow conservative mode.

The auditor opens the source unified RocksDB block store read-only, reads local
block headers and receipts, and writes only local audit artifacts under the
scratch, journal, or index paths. It does not start P2P, JSON-RPC, gRPC,
mempool, producer, transaction-store, contract-meta-store, account-history, or
any other runtime service.

For each block in the default journal replay path, the auditor:

1. verifies the local parent state root against
   `block.header.previous_state_merkle_root`;
2. applies `block_receipt.state_delta_entries` in order;
3. applies receipt remove entries with preserved tombstone semantics;
4. computes the receipt state-delta Merkle root directly from the serialized
   entries;
5. verifies the computed root against the next block's parent root and against
   `block_receipt.state_merkle_root` when that root is present.

The default direct replay is not resumable because it does not write state; it
is fast enough to restart from height `1` using the reusable journal. The
`--state-db-replay` scratch state DB is resumable. If it already contains a
replay through height `N`, the next state DB replay starts at `N + 1`. Use
`--reset-scratch` to restart from genesis. Passing `--normal-removes` with
`--state-db-replay` intentionally uses the old remove semantics and is useful
only for reproducing the historical failure mode.

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
