# Koinos Node Scripts

## Build Scripts

### `build-native-mac.sh`

Compiles all 12 Koinos microservices natively on macOS (Intel + Apple Silicon).

```bash
./scripts/build-native-mac.sh          # build everything
./scripts/build-native-mac.sh go       # Go services only
./scripts/build-native-mac.sh cpp      # C++ services only (Hunter patched tarballs)
./scripts/build-native-mac.sh rest     # koinos-rest only
./scripts/build-native-mac.sh amqp     # GarageMQ only
```

Prerequisites: Xcode CLI Tools, CMake 3.28.x, Go 1.22+, Node.js 20+, GMP (`brew install gmp`).

First C++ build takes ~1 hour (Hunter downloads + compiles all dependencies). Subsequent builds use cached packages.

### `build-native-win.bat`

Windows equivalent. Compiles using MSVC + CMake + Hunter.

```cmd
scripts\build-native-win.bat
```

### `stage-bundle.js` / `stage-bundle-win.js`

Collects all built binaries into `build/bundle-staging/koinos/` for Electron packaging.

```bash
node scripts/stage-bundle.js       # macOS
node scripts/stage-bundle-win.js   # Windows
```

## Runtime Scripts

### `start-native.sh`

Launches all Koinos services natively with proper configuration.

```bash
./scripts/start-native.sh [basedir]
```

### `reindex-chain.sh`

Re-indexes the chain state from an existing block_store with `verify-blocks: true`. This produces correct merkle roots for all receipts, enabling future restores with `verify-blocks: false`.

```bash
./scripts/reindex-chain.sh [basedir]
```

**Why you need this**: If you restored from a third-party backup and synced with `verify-blocks: false`, the chain state may have incorrect merkle roots (see [CHAIN_STATE_ARCHITECTURE.md](../docs/CHAIN_STATE_ARCHITECTURE.md#merkle-mismatch-deep-investigation) for the full analysis). This script rebuilds the chain state by re-executing all blocks with WASM verification.

**What it does**:
1. Stops all Koinos services
2. Backs up the current chain state (`chain/` → `chain.backup.YYYYMMDD-HHMMSS`)
3. Sets `verify-blocks: true` in `config.yml`
4. Starts only the 4 services needed for re-indexing (garagemq, block_store, chain, jsonrpc)
5. Monitors progress with speed and ETA estimates
6. On completion, the block_store has correct merkle roots for all receipts

**Duration**: ~50 blocks/sec with WASM execution. For 34M blocks, expect ~8 days. You can interrupt with Ctrl+C and resume — progress is saved in the chain state.

**After completion**:
```bash
# Stop services, then copy block_store for a clean backup
cp -r /path/to/.koinos/block_store /path/to/backup/
# This backup can be restored on any node with verify-blocks: false
```

## Diagnostic Scripts

### `verify-backup-receipts.py`

Checks internal receipt consistency by verifying that each block's `receipt.state_merkle_root` matches the next block's `header.previous_state_merkle_root`.

```bash
python3 scripts/verify-backup-receipts.py                     # check all blocks
python3 scripts/verify-backup-receipts.py 34309000 34310000   # specific range
python3 scripts/verify-backup-receipts.py 1 34000000 100      # sample 100 blocks
```

This is a fast check (no WASM execution) that detects receipt-level inconsistencies.

### `compare-receipts.py`

Cross-references local block_store receipts against a public Koinos node (api.koinos.io) to detect delta divergence.

```bash
python3 scripts/compare-receipts.py                            # sample 200 blocks
python3 scripts/compare-receipts.py 34309000 34310000          # specific range
python3 scripts/compare-receipts.py 1 34309560 500             # sample 500 from backup range
```

Compares `state_delta_entries` and `state_merkle_root` between local and public nodes. Useful for determining if a backup has corrupt deltas or just different merkle roots.

### `patch-hunter-config.py`

Patches Hunter's `config.cmake` with local patched tarballs for macOS ARM64 builds. Used internally by `build-native-mac.sh`.

```bash
python3 scripts/patch-hunter-config.py <config.cmake> \
  <zlib_url> <zlib_sha1> \
  <abseil_url> <abseil_sha1> \
  <exc_url> <exc_sha1> \
  [--arm64]
```

## macOS Patches (`mac-patches/`)

Helper scripts for setting up Hunter build patches on macOS:
- `setup-hunter-patches.sh` — downloads and patches ZLIB, abseil, koinos_exception tarballs
- `patch-abseil-arm64.sh` — patches abseil's `AbseilConfigureCopts.cmake` for ARM64

## Windows Patches (`win-patches/`)

CMake and source patches for MSVC compilation:
- `KoinosCompilerOptions.cmake` — MSVC-compatible compiler flags
- `msvc_compat.h` — compatibility header for MSVC
- `patch_secp256k1.cmake` — secp256k1 MSVC build fix
- `setup-hunter-patches.bat` — Windows Hunter patch setup

## Documentation

Detailed technical documentation is in [`docs/`](../docs/):
- [CHAIN_STATE_ARCHITECTURE.md](../docs/CHAIN_STATE_ARCHITECTURE.md) — state_db, merkle tree, receipts, block application pipeline, backup analysis
- [MICROSERVICES_ARCHITECTURE.md](../docs/MICROSERVICES_ARCHITECTURE.md) — overview of all Koinos microservices
- Individual service docs: CHAIN_SERVICE.md, BLOCK_STORE_SERVICE.md, P2P_SERVICE.md, etc.
