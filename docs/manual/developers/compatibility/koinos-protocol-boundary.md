# Koinos Protocol Boundary

Koinos compatibility is the shared contract that lets independent nodes agree on
the same chain. Teleno can optimize implementation details, but it must not
change externally observable protocol behavior.

## Protocol-Sensitive Behavior

Treat these as compatibility-sensitive:

- genesis and chain ID derivation;
- protobuf wire data;
- transaction IDs and block IDs;
- operation, transaction, and state merkle roots;
- block and transaction validation rules;
- deterministic WASM execution;
- system calls and system contracts;
- fork choice and finality behavior;
- P2P protocol IDs, Peer RPC methods, framing, and gossip topics;
- JSON-RPC and gRPC envelopes where clients depend on them.

## Implementation Details

These can change when compatibility is preserved:

- one process instead of many microservices;
- direct calls instead of AMQP;
- process supervision and desktop presets;
- local storage layout;
- local backup and restore tooling;
- peer acquisition strategy;
- mempool admission policy before block inclusion.

## Rule Of Thumb

If a change affects bytes on the wire, object IDs, signatures, merkle roots,
state transitions, block validity, Peer RPC behavior, gossip payloads, or public
RPC semantics, treat it as protocol-sensitive.

If a change only affects how Koinos One stores data, starts processes, schedules
work, or displays state, it is usually an implementation change.

For full details, read `docs/koinos/KOINOS_PROTOCOL.md`.

## Contributor Checklist

Before merging protocol-adjacent work, verify that the change preserves:

- target network genesis and chain ID;
- protobuf encoding and decoding;
- transaction and block ID calculation;
- merkle root and state root behavior;
- block validation and fork choice;
- Peer RPC handshake and sync behavior;
- GossipSub topic and payload behavior;
- JSON-RPC and gRPC compatibility for externally consumed methods.

Private or federated testnets are useful for mechanics, but they are not a
substitute for PoB/VHP compatibility evidence when production-style behavior is
affected.
