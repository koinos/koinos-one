# What Is Koinos?

Koinos is a blockchain protocol and network family. A Koinos node follows a
chain, checks blocks and transactions, stores blockchain data, talks to peers,
and exposes RPC APIs used by wallets, explorers, tools, and operators.

Koinos One is not the blockchain itself. Koinos One is a desktop app that helps
run and monitor a native Koinos-compatible node called Teleno Node
(`teleno_node`).

## Network Identity

Every Koinos network has a chain ID. The chain ID is derived from the genesis
data for that network.

Genesis is the first shared starting point of the chain. It defines the initial
network state, including the contracts and initial data that every node on that
network must agree on. If two nodes use different genesis data, they are not on
the same chain, even if they connect to similar peers.

For Koinos One users, this means:

- mainnet nodes must use mainnet genesis and network settings;
- testnet nodes must use testnet genesis and network settings;
- private networks may use custom genesis data, but every node in that private
  network must use the same generated data.

Changing genesis is not a local preference or performance setting. It changes
the chain identity.

## What A Node Does

A node keeps a local view of the chain. In practical terms, it:

- connects to peers;
- learns which chain ID those peers follow;
- fetches blocks;
- checks whether blocks and transactions are valid;
- stores block, transaction, receipt, and state data needed by the node;
- serves local or public RPC requests, depending on how it is configured.

Koinos One manages one native `teleno_node` process. That process contains the
runtime components that were historically separate services, including chain,
block store, mempool, P2P, JSON-RPC, gRPC, block producer, transaction store,
contract metadata store, account history, and backup tooling.

## Blocks, Transactions, And State

A transaction is a signed user intent. It contains one or more operations, such
as calling a contract or uploading contract code.

A block is an ordered set of transactions plus a header signed by a producer.
Each block points to a previous block and commits to the previous chain state.

State is the current data of the chain: balances, contract storage, system
contract configuration, producer information, and other values needed to
execute the next transaction or validate the next block.

Koinos consensus depends on nodes reaching the same state from the same valid
history. A node can store data differently internally, but it must produce the
same protocol-visible results.

## Peers And RPC

Koinos nodes talk to other nodes through P2P networking. P2P is used for sync,
live block propagation, and transaction propagation.

RPC is the interface used by wallets, explorers, CLIs, and other tools. Koinos
One and Teleno Node expose Koinos-compatible JSON-RPC and gRPC surfaces where
configured.

P2P and RPC are different surfaces:

| Surface | Used For |
| --- | --- |
| P2P | Node-to-node sync, block gossip, transaction gossip. |
| JSON-RPC | Common wallet, explorer, CLI, and operator requests. |
| gRPC | Typed protobuf-based service access for compatible clients. |

## Protocol Rules And Implementation Choices

Protocol rules are the parts all compatible Koinos clients must agree on:
serialization, IDs, signatures, block validity, transaction validity, state
roots, fork choice, P2P behavior, and externally consumed RPC behavior.

Implementation choices are local engineering decisions. Teleno Node may run as
one monolithic binary, use direct in-process calls, use RocksDB internally, and
be supervised by a desktop app. Those choices are allowed only because they do
not change Koinos protocol behavior.

For deeper detail, see the
[Koinos Protocol Compatibility Reference](../developers/deeper-references/koinos-protocol.md).
