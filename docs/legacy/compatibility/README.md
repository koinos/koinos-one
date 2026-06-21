# Teleno Compatibility Evidence

Teleno is the monolithic Koinos node app. Legacy references stay in this repository only when they prove that Teleno preserves externally observable Koinos behavior.

## Retained Compatibility Areas

- JSON-RPC parity: `scripts/compare-jsonrpc-parity.py` and `docs/roadmap/monolith/core/MONOLITH_JSONRPC_PARITY_REPORT.md`.
- gRPC parity and client behavior: `scripts/compare-grpc-parity.sh` and `scripts/validate-grpc-client-compatibility.sh`.
- Upstream functional compatibility: `scripts/run-koinos-integration-compat.sh` and `scripts/fetch-koinos-integration-tests.sh`.
- P2P Peer RPC and gossip interop: `scripts/probe-mainnet-seeds.sh`, `scripts/smoke-gossip-interop.sh`, `scripts/smoke-one-peer-sync.sh`, the fixture module at `compat/koinos-p2p-fixtures`, the compatibility submodule at `compat/legacy-services/koinos-p2p`, and the networking reports under `docs/roadmap/monolith/networking/`.
- Migration and backup parity: `scripts/verify-monolith-backup-restore.sh`, `scripts/compare-receipts.py`, `scripts/verify-backup-receipts.py`, and `docs/roadmap/monolith/backup-restore/`.
- Live testnet/mainnet validation: reports under `docs/roadmap/monolith/testnets/` and `docs/roadmap/monolith/networking/`.

## Cleanup Rule

Do not add legacy microservice build, start, packaging, or operator docs back to the active command surface. If a legacy artifact is needed, it must be tied to one of these compatibility purposes:

- proves protocol parity;
- proves migration or restore safety;
- provides a baseline for a current Teleno release gate;
- documents a historical validation result that is still referenced by the current roadmap.

Everything else belongs outside this repository or in the separate legacy/microservice app repository.

## Legacy Service Binaries

The old GarageMQ, chain, mempool, block store, JSON-RPC, gRPC, producer, REST, and optional index service submodules are not carried in the active Teleno tree. Scripts that still support a native legacy baseline require explicit external binary paths, for example `LEGACY_CHAIN_BIN`, `LEGACY_MEMPOOL_BIN`, `LEGACY_BLOCK_STORE_BIN`, `LEGACY_JSONRPC_BIN`, and `LEGACY_GARAGEMQ_BIN`.
