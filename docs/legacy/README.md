# Legacy And Compatibility Documentation

Legacy Koinos microservice material is retained only when it proves externally
observable compatibility, migration safety, or release-gate validation for the
current monolithic node.

## Current Boundary

The active Koinos One runtime is `teleno_node`, not the legacy multi-service
stack. Legacy service docs should not be used as operator instructions for a
current Koinos One install.

## Retained Legacy Topics

- JSON-RPC parity against legacy services.
- gRPC typed-client compatibility.
- P2P Peer RPC and gossip interop.
- Legacy backup/migration evidence.
- Historical testnet/mainnet validation reports that remain useful as release
  evidence.

## Evidence Map

- `compatibility/README.md` - retained compatibility scripts, reports, and
  cleanup rules.

