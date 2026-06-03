# Koinos Protocol Compatibility Reference

This document explains the parts of Koinos that must remain compatible across all network clients, regardless of implementation language, process layout, database engine, or user interface.

Knodel may replace microservices with a monolithic C++ node, change local storage, remove AMQP from the local execution path, or optimize process management. It must not change the externally observable protocol behavior described here.

## Protocol Boundary

The Koinos protocol is the shared contract that allows independently built nodes to agree on the same chain. A compatible client must:

- derive the same chain ID from the same genesis data;
- serialize and deserialize protocol objects with the same protobuf schemas;
- compute the same transaction IDs, block IDs, merkle roots, and state roots;
- validate transactions and blocks with the same rules;
- execute system calls and smart contracts deterministically;
- apply the same fork-choice and finality rules for the configured network;
- speak the same peer-to-peer sync and gossip protocol;
- expose compatible RPC envelopes and service behavior where wallets, tools, peers, or other Koinos services depend on them.

Anything outside that boundary is an implementation detail. Examples include whether a node is split into services or runs as one binary, whether local calls use AMQP or direct function calls, whether block data is stored in Badger or RocksDB, and how a desktop app supervises the node.

## Canonical Data Model

The canonical wire data model is defined by the Koinos protobuf schemas under `koinos/protocol`, `koinos/chain`, `koinos/rpc`, and related packages.

The most important protocol objects are:

| Object | Purpose |
|--------|---------|
| `protocol::transaction` | Signed user intent. Contains a header, operations, and signatures. |
| `protocol::transaction_header` | Chain ID, RC limit, nonce, operation merkle root, payer, and optional payee. |
| `protocol::operation` | One executable action: upload contract, call contract, set system call, or set system contract. |
| `protocol::block` | Signed block containing a header, ordered transactions, and a block signature. |
| `protocol::block_header` | Previous block ID, height, timestamp, previous state merkle root, transaction merkle root, signer, and approved proposals. |
| `protocol::transaction_receipt` | Result of transaction execution, including resource usage, events, logs, and state deltas. |
| `protocol::block_receipt` | Result of block execution, including resource usage, events, transaction receipts, and state deltas. Block stores use this for replay and indexing, but historical receipt persistence details can differ between services. |
| `protocol::state_delta_entry` | A deterministic state write or removal in a specific object space. |

Compatibility requirement: two clients that validate the same block on the same parent state through full execution must make the same accept/reject decision and produce the same logical state transition. For live consensus, the critical externally checked value is that the next block's `previous_state_merkle_root` matches the local parent state root.

## Chain Identity and Genesis

A Koinos network is identified by its chain ID. The chain ID is derived from the genesis data protobuf, so genesis data is part of the protocol for that network.

All nodes on the same network must use the same genesis data. If two nodes use different genesis entries, contract bytecode, system call mappings, initial balances, or initial contract metadata, they are on different chains even if they connect to the same P2P endpoint.

For Knodel, this means:

- mainnet must use mainnet genesis and descriptors;
- public testnet must use the public testnet genesis and descriptors;
- private testnets may generate custom genesis data, but every node in that private network must use the exact same generated file;
- changing genesis is never a local optimization.

## Transaction Protocol

A transaction is valid only if its protobuf content, ID, signatures, nonce, payer/payee data, and resource limits satisfy Koinos rules.

Important compatibility points:

- The transaction header includes the chain ID. A transaction signed for one chain must not be accepted on another chain.
- The transaction ID is the SHA2-256 multihash of the serialized transaction header.
- The operation merkle root must match the ordered operations in the transaction. The current chain path verifies this during transaction application.
- Signature recovery and authority checks must match the network rules and system contract behavior.
- Nonce handling must match the account nonce rules implemented by the chain and mempool. Current execution accepts the next `uint64` nonce for the payer or payee nonce account, with mempool-aware pending nonce handling for transaction submission.
- RC accounting must be deterministic. The same transaction on the same state must consume the same disk, network, and compute resources.
- Reverted transactions still have deterministic receipts and resource effects according to protocol rules.

Clients may choose different mempool policies for local admission, eviction, or prioritization, but once a transaction is included in a block, block validation is governed by consensus rules, not by local mempool policy.

## Block Protocol

A block commits to an ordered set of transactions and to the previous chain state.

A compatible node must validate at least:

- the block has all required fields;
- the block ID is the SHA2-256 multihash of the serialized block header;
- the parent exists and the height is exactly parent height plus one;
- the timestamp is greater than the parent block time and not more than five seconds ahead of the chain application time;
- the `previous_state_merkle_root` matches the parent state root;
- the transaction merkle root matches the ordered transaction headers and signatures. The current producer builds this as a SHA2-256 merkle tree over each transaction header hash and concatenated-signatures hash;
- the block signature is processed successfully by the active chain/system-contract path;
- applying every transaction produces a state transition accepted by the chain.

During historical indexing, an implementation may replay trusted receipts instead of re-executing every WASM transaction when configured to do so. In the current chain service this is `apply_block_delta()` with `verify-blocks=false`: it applies receipt state deltas and finalizes a node without validating the resulting merkle root against the block header. That is a local sync optimization and can expose restore-time merkle mismatches later. For trustless validation of live blocks, the `submit_block()` path executes the block and checks the block's `previous_state_merkle_root` against the parent state before applying it.

## Deterministic Execution

Koinos execution is contract-driven. System contracts implement critical chain behavior such as resource accounting, authority, token balances, name service, PoB/VHP logic, and other kernel-visible rules.

Determinism requirements:

- WASM execution must produce identical results for identical inputs.
- System call IDs and dispatch targets must match the active chain state.
- Contract metadata must be interpreted identically.
- State object spaces, keys, values, and removals must be applied in the same order.
- Event, log, state delta, and resource accounting behavior must match protocol semantics.
- Any mainnet rectification behavior must be preserved exactly where applicable.

The VM engine is an implementation choice only if it preserves Koinos semantics. Replacing or optimizing the VM cannot change observable execution results.

## State and Merkle Roots

Koinos consensus depends on deterministic state roots. The storage engine itself is not the protocol; the key/value state content and merkle calculation are.

A compatible implementation may store data in RocksDB, Badger, memory, or another database, but for chain validation it must:

- use the same logical object spaces;
- encode keys and values exactly as expected by the protobuf and contract layers;
- apply state deltas exactly once and in the correct order;
- maintain a state root that is compatible with the block header chain it is validating;
- preserve enough historical block and receipt data to serve peer sync and local RPC requirements.

If a node reaches a different live parent state root than the one required by the next valid block's `previous_state_merkle_root`, that node has diverged from the chain it is trying to follow. The existing Knodel restore notes call out one practical risk here: replaying stored receipt deltas with `verify-blocks=false` can be fast, but it does not perform the same merkle validation as full block execution.

## Consensus and Fork Choice

Koinos clients must agree on which blocks are valid and which fork is canonical. The configured fork algorithm is therefore protocol-relevant.

The fork tree supports these configured algorithms in the current chain service:

- `fifo`: first block received at a given height wins;
- `block-time`: earliest timestamp wins;
- `pob`: highest Proof-of-Burn score wins.

In current Knodel validation work, `fifo`/federated-style private networks are used for controlled mechanics tests, while `pob` is the production-style Proof of Burn / VHP path.

For PoB/VHP behavior, clients must preserve the same on-chain contract semantics for producer registration, public key lookup, VHP accounting, burn behavior, difficulty metadata, block signature processing, fork comparison, and finality.

Private federated tests are useful for validating mechanics such as block assembly, signing, gossip, and observer sync. They are not a substitute for PoB/VHP compatibility.

## Peer-to-Peer Protocol

Koinos P2P compatibility has three layers:

1. libp2p transport and peer identity;
2. Koinos Peer RPC for direct sync;
3. GossipSub topics for live blocks and transactions.

The advertised protocol version is:

```text
koinos/p2p/1.0.0
```

Peer RPC uses the Koinos Go peer RPC service contract and `go-libp2p-gorpc` MessagePack framing. The protocol ID is:

```text
/koinos/peerrpc/1.0.0
```

The required Peer RPC service is `PeerRPCService` with these methods:

| Method | Purpose |
|--------|---------|
| `GetChainID` | Return the peer chain ID. |
| `GetHeadBlock` | Return the peer head block ID and height. |
| `GetAncestorBlockID` | Return the block ID at a requested height on a given peer head chain. |
| `GetBlocks` | Return serialized protobuf blocks for a requested height range. |

The normal compatibility handshake is:

1. learn or tolerate the peer protocol version according to current network behavior;
2. compare local and remote chain IDs;
3. read the peer head block;
4. verify configured checkpoints through `GetAncestorBlockID`;
5. sync missing blocks through `GetBlocks`;
6. apply received blocks through the local chain validation path.

The GossipSub topics are:

| Topic | Payload |
|-------|---------|
| `koinos.blocks` | Serialized `protocol::block` messages. |
| `koinos.transactions` | Serialized `protocol::transaction` messages. |

A node may tune dialing cadence, connection limits, peer scoring, logging, or scheduling, but it must not change the Peer RPC protocol ID, service name, method names, MessagePack framing compatibility, topic names, payload types, protobuf encoding, or chain validation behavior.

## External RPC Compatibility

Public RPC surfaces are not all consensus-critical, but they are part of client compatibility. Wallets, CLIs, explorers, and operational tools expect stable request and response envelopes.

Important RPC groups include:

- `chain`: head info, chain ID, read contract, submit block, submit transaction;
- `block_store`: block lookup by ID and height;
- `mempool`: pending transaction queries and admission;
- `transaction_store`: transaction lookup and indexing;
- `contract_meta_store`: contract metadata lookup for uploaded contract ABIs and related metadata;
- `account_history`: account-oriented history queries where enabled;
- JSON-RPC and gRPC envelope behavior expected by existing Koinos clients.

Knodel may route these requests directly inside the monolith, but responses, byte encodings, errors, and edge cases must remain compatible with the legacy service behavior where external clients depend on them. Some of these services are indexes rather than consensus engines, so their internal storage is not protocol-critical even when their public API behavior is compatibility-critical.

## What Knodel Can Change

The following are implementation details and may be optimized as long as the protocol boundary above remains unchanged:

- one process instead of many microservices;
- direct in-process calls instead of AMQP;
- unified logging and health checks;
- RocksDB column-family layout for monolith-owned stores;
- local backup, restore, and migration tooling;
- desktop presets and process supervision;
- peer acquisition strategy and connection scheduling;
- local mempool eviction and prioritization policy before block inclusion.

These changes are acceptable only when they preserve network interoperability with existing Koinos nodes and produce the same chain results.

## Compatibility Checklist for a New Client

A Koinos client implementation should not be considered network-compatible until it can pass these checks:

- It derives the expected chain ID from the target network genesis.
- It can decode and encode canonical protobuf transactions, blocks, receipts, and RPC messages.
- It computes transaction IDs, block IDs, operation merkle roots, transaction merkle roots, and live state roots compatibly.
- It rejects blocks with wrong parent linkage, height, timestamp bounds, previous state root, transaction root, or invalid block signature processing.
- It executes live blocks deterministically and produces matching state transitions.
- It handles the active fork-choice algorithm and finality rules.
- It can complete Peer RPC handshake with a reference Koinos node.
- It can fetch and apply blocks with `GetBlocks`.
- It can receive and validate `koinos.blocks` gossip.
- It can receive, validate, and forward `koinos.transactions` gossip.
- It passes JSON-RPC and gRPC compatibility checks for externally consumed methods.
- It syncs from genesis or a valid restored state to the same head as reference nodes.

## Knodel Rule of Thumb

If a change affects only how Knodel stores data, starts processes, schedules work, or displays state, it is probably an implementation change.

If a change affects bytes on the wire, protobuf schemas, object IDs, signatures, merkle roots, state transitions, block validity, fork choice, Peer RPC behavior, gossip payloads, or externally consumed RPC semantics, it is a protocol compatibility change and must be treated as consensus-sensitive.
