<p align="center">
  <img src="assets/newbranding/logo.png" alt="Teleno logo" width="520" />
</p>

# Teleno

Teleno is a desktop app for operating a monolithic **Koinos** node implementation. It includes Teleno UX, the dashboard, block explorer, wallet, producer tools, local configuration, and lifecycle management for the single `teleno_node` runtime.

## Stack

- **Desktop app:** Teleno, built with Electron + React + TypeScript
- **Node runtime:** monolithic `teleno_node`
- **Runtime model:** one local process with in-process Koinos components
- **Platforms:** macOS first, Windows planned

## Quick Start

```bash
git clone --recurse-submodules git@github.com:pgarciagon/teleno.git
cd teleno
npm install
npm run dev
```

If the repository was cloned without submodules, run:

```bash
git submodule update --init --recursive
```

## Build The Monolithic Node

The C++ source tree lives under `node/teleno-node`. CMake builds the monolith executable as `teleno_node`, and packaging stages the same binary name.

```bash
./scripts/build-cpp-libp2p-koinos.sh
```

Legacy microservice build/start scripts are not part of the active Teleno command surface. Legacy-facing scripts are retained only when they prove protocol compatibility, migration safety, or parity with existing Koinos clients and peers.

For direct command-line startup on public testnet or mainnet, see `docs/operations/START_TELENO_NODE.md`.

## Building For Distribution

```bash
npm run package:mac:dir       # unsigned local .app directory
npm run package:mac           # signed and notarized DMG, when credentials are configured
npm run package:mac:unsigned  # unsigned development DMG
```

## Development

```bash
npm run dev:renderer
npm run build
npm run test
```

Open the renderer-only build at `http://localhost:5173`.

## Architecture

```text
Electron UI
  |
  +-- Dashboard      (node, peer, producer, and performance views)
  +-- Explorer       (blocks, transactions, inline detail)
  +-- Wallet         (accounts, transfers, burn, producer setup)
  +-- Settings       (runtime config, language, paths)
  |
  +-- electron/main.ts
        |
        +-- teleno_node
              |
              +-- chain, mempool, p2p, block store, jsonrpc, grpc,
                  account history, transaction store, contract metadata,
                  and block producer components
```

## References

- Koinos: https://koinos.io
- Blockchain backups: https://seed.koinosfoundation.org/backups
- Compatibility evidence: `docs/compatibility/README.md`
