# Teleno Scripts

This directory is for the monolithic Teleno node, desktop packaging, validation, and compatibility evidence. Legacy microservice build/start scripts are intentionally not part of the active command surface.

## Build And Package

- `build-cpp-libp2p-koinos.sh` builds the monolithic node with the Koinos-compatible cpp-libp2p dependency set, native `libssh` SFTP support, a zstd-enabled RocksDB override, and local static zstd/GMP by default. If network fetch fails after `cpp-libp2p` has been cached, it reuses the cached tag.
- `build-gmp-static.sh` builds or reuses the pinned static GMP package for Teleno's macOS deployment target; pass `GMP_SOURCE_TARBALL=/path/to/gmp.tar.xz` when network source download is unavailable.
- `build-zstd-static.sh` builds or reuses the pinned static zstd package for Teleno's macOS deployment target; pass `ZSTD_SOURCE_TARBALL=/path/to/zstd.tar.gz` when network source download is unavailable.
- `build-rocksdb-zstd.sh` builds or reuses the zstd-enabled RocksDB package used by the monolith build; it uses the local static zstd package by default and records the zstd library fingerprint before reusing an install. Set `TELENO_ROCKSDB_WITH_ZSTD=0` only when intentionally testing the old no-zstd RocksDB path.
- `stage-bundle.js` stages `teleno_node`, network config templates, and core contract ABIs for Electron packaging.
- `verify-package-staging.js` verifies the staged Teleno bundle before packaging.
- `verify-packaged-app.js` verifies the final packaged app contains the expected Teleno resources.
- `build-mac-icon.js` generates the macOS icon.
- `check-notarize-credentials.js` validates signing/notarization environment variables.

## Runtime And Validation

- `soak-mainnet-p2p.sh` runs a non-producing mainnet observer soak.
- `private-testnet-sprint2.sh` runs private monolith producer/observer validation.
- `external-pob-testnet-signoff.sh` validates an external PoB testnet signoff.
- `live-producer-transaction-regression.sh` and `.py` run live producer transaction/regression levels.
- `benchmark-monolith*.py` and `benchmark-monolith*.sh` collect monolith startup, sync, RPC, thread, mixed-stress, and replay/indexing evidence.
- `benchmark-transaction-submission.js` measures live transaction submission behavior.

## Compatibility Evidence

These scripts are retained because they prove Teleno remains compatible with Koinos protocol/client behavior:

- `compare-jsonrpc-parity.py` compares legacy JSON-RPC responses with monolith responses.
- `compare-grpc-parity.sh` compares generated protobuf gRPC responses and status codes.
- `run-koinos-integration-compat.sh` runs selected upstream `koinos-integration-tests` against legacy and monolith modes.
- `fetch-koinos-integration-tests.sh` fetches the pinned upstream integration-test suite.
- `benchmark-legacy-native-jsonrpc.sh` captures same-machine legacy JSON-RPC baselines for comparison.
- `probe-mainnet-seeds.sh` uses the Go Koinos P2P probe path to classify mainnet Peer RPC availability before C++ canaries.
- `smoke-gossip-interop.sh` and `smoke-one-peer-sync.sh` validate Go/C++ P2P interop.
- `validate-grpc-client-compatibility.sh` validates external gRPC client behavior.
- `compare-receipts.py`, `verify-backup-receipts.py`, and `verify-monolith-backup-restore.sh` support backup/migration parity checks.

See `docs/compatibility/README.md` for the retained evidence map.

Native legacy baseline scripts do not use bundled legacy service submodules. Set external binary paths such as `LEGACY_GARAGEMQ_BIN`, `LEGACY_CHAIN_BIN`, `LEGACY_MEMPOOL_BIN`, `LEGACY_BLOCK_STORE_BIN`, and `LEGACY_JSONRPC_BIN` when those modes are needed.
