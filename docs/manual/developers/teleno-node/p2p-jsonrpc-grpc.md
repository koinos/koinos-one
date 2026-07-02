# P2P, JSON-RPC, And gRPC

Networking and RPC are the main external compatibility surfaces.

## P2P

The P2P component handles:

- libp2p transport when enabled;
- Koinos Peer RPC sync;
- block and transaction gossip topics;
- peer identity;
- seed dialing and peer acquisition;
- sync block application and gossip readiness.

Protocol-sensitive values include the Koinos Peer RPC protocol ID, service and
method names, MessagePack framing compatibility, GossipSub topic names, payload
types, protobuf encoding, chain ID checks, and block validation behavior.

The Koinos Peer RPC protocol ID is `/koinos/peerrpc/1.0.0`. Gossip topics are
`koinos.blocks` and `koinos.transactions`. These names are compatibility
surfaces, not local preferences.

## JSON-RPC

JSON-RPC is the primary compatibility surface for wallets, explorers, CLIs, and
the Koinos One renderer. It routes public Koinos methods into monolith
components such as chain, block store, mempool, transaction store, contract meta
store, and account history.

Public JSON-RPC must not expose native backup or restore admin behavior.

When JSON-RPC accepts or returns byte values, addresses, block IDs, transaction
IDs, protobuf JSON, or errors, match the behavior expected by Koinos clients.
Normalize inputs at the API boundary rather than changing internal canonical
data.

## gRPC

The gRPC server exposes typed protobuf service methods and maps component
responses into gRPC status behavior. It is separate from JSON-RPC but must stay
compatible where clients depend on protobuf service behavior.

Current backlog includes gRPC ACL enforcement matching the intended access
control model.

## Developer Guidance

Treat byte encodings, envelope shapes, error behavior, service names, method
names, and protocol IDs as compatibility-sensitive. Local scheduling, logging,
connection cadence, and peer scoring can be tuned only when observable protocol
behavior remains compatible.

Use
[`scripts/compare-jsonrpc-parity.py`](https://github.com/pgarciagon/koinos-one/blob/main/scripts/compare-jsonrpc-parity.py),
[`scripts/compare-grpc-parity.sh`](https://github.com/pgarciagon/koinos-one/blob/main/scripts/compare-grpc-parity.sh),
and
[`scripts/validate-grpc-client-compatibility.sh`](https://github.com/pgarciagon/koinos-one/blob/main/scripts/validate-grpc-client-compatibility.sh)
when a change touches public API behavior.
