# Teleno

Teleno is a desktop app for operating a monolithic **Koinos** node implementation. It includes Teleno UX, the dashboard, block explorer, wallet, producer tools, local configuration, and lifecycle management for the single `teleno_node` runtime.

## Stack

- **Desktop app:** Teleno, built with Electron + React + TypeScript
- **Node runtime:** monolithic `teleno_node`
- **Runtime model:** one local process with in-process Koinos components
- **Platforms:** macOS first, Windows planned

## Quick Start

```bash
git clone --recurse-submodules git@github.com:pgarciagon/koinosgui.git
cd koinosgui
npm install
npm run dev
```

If the repository was cloned without submodules, run:

```bash
git submodule update --init --recursive
```

## Build The Monolithic Node

The upstream C++ source tree lives under `vendor/koinos/koinos-node`. CMake still builds the upstream target as `koinos_node`; packaging stages that binary as `teleno_node`.

```bash
cmake -S vendor/koinos/koinos-node -B vendor/koinos/koinos-node/build
cmake --build vendor/koinos/koinos-node/build --target koinos_node
```

The legacy native build scripts are retained during the first split for compatibility and packaging traceability. They should be pruned only after the first side-by-side app smoke is complete.

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
