# The January 2026 Halt and the Sync Fix, Explained For Koinos Users

A plain-language companion to the technical reports in this folder. No
blockchain-engineering background needed — just familiarity with Koinos as a
user. If you want the deep technical version, see
`LEGACY_DELTA_REPLAY_FIX_BRIEF.md` and
`LEGACY_DELTA_REPLAY_ANOMALY1_HALT_ANALYSIS.md`.

## First, the important part

**Your funds and balances were never at risk.** Nothing in this story
involves stolen, lost, or wrongly-assigned tokens. Every issue described here
is about *bookkeeping checksums* — the way nodes double-check each other's
records — not about the records themselves.

## The notebook and the checksum

Think of every Koinos node as keeping the same giant notebook. Every ~10
seconds a new block arrives, and the node writes down what changed: this
account's balance went up, that vote was recorded, this contract stored a new
value.

To make sure nobody's notebook silently drifts, every block also carries a
**checksum of the previous block's changes** — a fingerprint. When a node
applies a block, it computes the fingerprint of what it just wrote and
compares it with the fingerprint the network agreed on. If they differ, the
node stops rather than continue with wrong data. That's a good thing: a loud
stop is much safer than silently keeping bad records.

## The two ways a node can catch up

A node that's behind (new node, or restarted after downtime) has two options:

1. **Re-do all the homework** (`verify-blocks=true`): re-execute every
   transaction of every block since the beginning. Guaranteed correct, but
   slow — days.
2. **Copy the answer sheet** (`verify-blocks=false`, the default): every block
   comes with a *receipt* listing exactly what changed. The node just applies
   those changes directly. Much faster.

The fast path is where the bug lived.

## The bug: the disappearing sticky note

Some blocks create a value and delete it *within the same block*. The receipt
records the deletion as a "tombstone" — a sticky note saying "this key was
removed here".

The fast-path code had a subtle flaw: when replaying a receipt, if it was
told to delete something it couldn't see, it shrugged and skipped it —
dropping the sticky note. The *data* ended up right, but the **fingerprint**
of the changes came out different, because the network's fingerprint included
that sticky note.

The result: a fast-syncing node would copy answer sheets for millions of
blocks, feel perfectly fine, and then — sometimes weeks later, at the first
live block — fail the fingerprint check and stop, far from the block that
actually caused it. Confusing to debug, and it's what stranded nodes in
January 2026.

## The January halt left a scar

Here is the part that surprised even us during the investigation (credit to
the team's questions for forcing it into the open).

On January 21, 2026, the main producing node went down and the chain halted
for about 22 hours at block **32,789,377**. When production resumed, the
restarted node had rebuilt its own records using the *fast path* — the one
with the sticky-note bug. So the fingerprint it computed for that last
pre-halt block was the buggy one (missing one sticky note), and that
fingerprint got **written into the next block and signed by the network**.

In other words: the chain's own official fingerprint for block 32,789,377 is
the bugged one, permanently. The block's receipt — the 12 changes everyone
can see on koinosblocks.com — is honest and correct. The fingerprint stapled
to it is not. It's a scar from the incident, frozen into history. (Again: the
*data* is fine; one checksum in one block is off.)

## The other odd block: the October 2025 hardfork

There's one more block with a mismatch, for a completely different reason. On
October 31, 2025 the Koinos Fund contract was fixed via a coordinated
hardfork: at one specific block, every node quietly swapped in the corrected
contract code. Those changes were counted in the network's fingerprint —
but due to a separate small bug (#858, since fixed), they were **left out of
the stored receipt**. So that block's answer sheet is missing two lines that
the fingerprint expects. Copying the answer sheet can never work there; the
only way through is to re-do that one block's homework, which automatically
re-applies the hardfork.

## What the fix does

The repaired fast path works like this for every block:

1. **Copy the answer sheet, keeping the sticky notes** (this fixes the
   original bug for essentially the entire chain — 37.28 million blocks
   verified).
2. **Check the fingerprint immediately** against the one the network signed —
   at every block, not weeks later. A problem now stops the node *at* the
   problem, with a clear message.
3. **If the fingerprint doesn't match, re-do that one block's homework**
   (full re-execution) and continue. This handles the October 2025 hardfork
   block automatically.
4. For the January scar block, re-doing the homework produces the *honest*
   fingerprint — which doesn't match the *bugged* one the chain recorded. So
   the fix needs one more trick for that single block: recognize the
   known-scar pattern and match what the chain actually signed, while logging
   it loudly. (The exact mechanism is being decided; the options are in the
   technical report.)

The end result for users: nodes can fast-sync the entire chain from scratch,
quickly, and either finish correctly or stop *immediately and loudly* at a
real problem — no more silent drift and mysterious failures weeks later.

## Frequently asked questions

**Was any balance or transaction wrong?** No. Every issue here is about
checksums of change-lists, not the changes themselves. The audit re-verified
all 290 million recorded changes across the whole chain.

**Is koinosblocks.com showing wrong data?** No. The receipts it shows are the
honest record, including the 12 entries at block 32,789,377.

**Could the January scar cause problems later?** It's permanent but inert:
one fingerprint in one historical block. Nodes that re-execute history
(`verify-blocks=true`) and nodes using the fixed fast path both handle it.
It's documented so future developers don't rediscover it the hard way.

**Why not just fix the chain's record?** Rewriting a signed historical header
would be a chain-governance action with its own risks. Documenting and
handling the single scar is safer than editing history.

**What should node operators do?** Once the fix ships in an official release:
upgrade, and fast sync becomes trustworthy end-to-end. Until then, the safe
option for a fresh sync remains `verify-blocks=true`.
