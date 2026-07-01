# Transactions, Blocks, And Finality

Koinos nodes agree on a chain by validating transactions and blocks in the same
way. This page explains the practical concepts behind that validation.

## Transactions

A transaction is a signed request to do something on the chain. A transaction
contains a header, one or more operations, and signatures.

Operations are the actions inside a transaction. Examples include calling a
contract, uploading a contract, or changing system contract configuration.

A transaction is valid only if the protocol rules accept it. Important checks
include:

- the transaction is for the correct chain ID;
- signatures and authority checks pass;
- nonce handling is valid;
- resource use is acceptable;
- the operations are encoded and ordered correctly.

Local nodes may have different mempool policies for pending transactions, but
once a transaction is included in a block, block validation follows consensus
rules.

## The Mempool

The mempool is where a node tracks pending transactions before they are
included in a block. Pending transactions are not final. They may expire, be
rejected locally, be replaced by another valid transaction, or never appear in
a block.

Teleno Node includes a mempool component that handles pending transactions,
nonce checks, resource reservation, and expiration.

## Blocks

A block contains an ordered set of transactions and a signed block header. The
header links the block to the previous block and commits to important values
such as the transaction merkle root and previous state merkle root.

A compatible node must reject a block if required protocol checks fail. These
checks include parent linkage, height, timestamp bounds, previous state root,
transaction root, block signature processing, and transaction execution.

## State And State Roots

State is the current data the chain uses to validate the next action. A state
root is a compact cryptographic commitment to that state.

The important user-facing point is this: if two nodes validate the same chain
history, they must reach the same state. If a node reaches a different state
root from the one required by the next valid block, that node has diverged from
the chain it is trying to follow.

Storage layout is not itself the protocol. A node may use a different local
database engine, but the state content and state-root behavior must remain
compatible.

## Deterministic Execution

Koinos execution is contract-driven. System contracts implement critical chain
behavior such as authority, resource accounting, token behavior, name service,
Proof of Burn and VHP rules, and other kernel-visible logic.

Deterministic execution means that the same valid transaction on the same state
must produce the same result on compatible nodes. A node implementation may
optimize the execution engine only if the observable result stays the same.

## Fork Choice And Finality

Sometimes nodes may see competing blocks or forks. The configured fork-choice
rules determine which valid chain becomes canonical.

The current chain service supports configured fork algorithms including:

| Algorithm | Meaning |
| --- | --- |
| `fifo` | First received block at a height wins. |
| `block-time` | Earliest timestamp wins. |
| `pob` | Highest Proof-of-Burn score wins. |

Production-style Koinos behavior uses Proof of Burn and VHP semantics. Private
or controlled tests may use other configurations to validate mechanics, but
those tests are not a substitute for production Proof-of-Burn compatibility.

Finality is the point at which a block is considered settled according to the
network rules and fork-choice behavior. Operators should still treat local
sync, peer health, and node configuration as part of operational confidence.

## Restore And Validation Note

Fast restore and indexing workflows can use stored data to catch up quickly,
but restored nodes should still start as observers first. Production should be
enabled only after the node is healthy, following the expected network, and the
producer setup is explicitly verified.

For deeper protocol detail, see `docs/koinos/KOINOS_PROTOCOL.md`.
