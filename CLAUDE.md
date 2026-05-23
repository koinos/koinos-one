# Knodel — Claude Code Project Memory

## What is Knodel

Knodel is an Electron + React + TypeScript desktop app for operating Koinos blockchain nodes. It manages native C++ microservices, encrypted wallets, block producer operations, and blockchain backup/restore. See `docs/knodel/ARCHITECTURE.md` for full architecture details.

## Project Layout

```
electron/           → Main process (main.ts ~11K lines, lib/ services)
electron/lib/       → Service layer (backup, wallet, producer, storage, native runtime)
electron/preload.ts → IPC context bridge (window.knodel API)
src/                → React renderer (App.tsx monolith, panels, i18n)
vendor/koinos/      → 11 git submodules (C++ microservices, forked to pgarciagon/)
vendor/amqp-broker/ → GarageMQ binary + config
docs/knodel/        → Knodel app docs (architecture, patches, contribution workflow)
docs/microservices/ → Koinos microservice architecture docs
docs/roadmap/       → Optimization plans and future ideas
```

## Key Patterns

- **IPC:** `ipcRenderer.invoke` → `ipcMain.handle` → service layer (all async)
- **Events:** `webContents.send` for logs/backup progress streams
- **Services:** Factory functions with dependency injection (`createBackupService(deps)`)
- **State:** `useState` hooks in monolithic App.tsx, props drilled to panels
- **Types:** `electron/lib/main-types.ts` (main) + `src/knodel-electron.d.ts` (renderer)
- **i18n:** EN + ES translations in `src/i18n.ts`, template interpolation `{placeholder}`
- **Encryption:** AES-256-GCM + PBKDF2 (100K iterations) for wallet data

## Git & Submodules

- All 12 koinos microservice submodules point to **pgarciagon/** forks with `branch = knodel-patches`
- Upstream contribution workflow documented in `docs/knodel/UPSTREAM_CONTRIBUTION.md`
- macOS ARM64 patches documented in `docs/knodel/MACOS_ARM64_PATCHES.md`
- Fork repos live at `~/code/forks/` (koinos-cmake, fizzy, zlib)

## Current State & Recent Work

### Monolithic Node Migration (Primary Focus)
- **Gate A build reproducibility:** Local monolith build is wired into Knodel tooling (`monolithBuildDefinition`, CMake flags for `KOINOS_ENABLE_LIBP2P`, cpp-libp2p prelude/prefix setup). Binary output target is `vendor/koinos/koinos-node/build/koinos_node`.
- **Electron runtime mode:** Knodel runs a single `koinos_node` process in monolith mode and maps service actions (`start`/`stop`/`restart`) through `koinosNodeServiceAction` for `koinos-node`.
- **Current safety gate:** `p2p` is disabled by default at launcher level until Gate B is closed. With `p2p` enabled, current build still crashes after genesis; with `--disable=p2p`, chain/block_store/jsonrpc run and JSON-RPC responds.
- **Status + health model:** `nativeComposeStatus` returns one managed service (`koinos-node`) plus component health derived from monolith logs. Health parsing accepts real log format (timestamp + `[component]`).
- **Component logs:** Log endpoints now accept component targets (`jsonrpc`, `chain`, etc.) and filter monolith output by `[component]`, including follow streams.
- **Preset reconcile (monolith):** Applying a preset writes `features.*` to active `BASEDIR/config.yml`, translates flags to CLI `--enable/--disable`, restarts monolith, and preserves `p2p=false` during Gate B.

### End-to-End Validation Completed
- Electron bridge smoke for `serviceStart`/`serviceStop`/`serviceRestart` against monolith runtime.
- JSON-RPC probe (`chain.get_head_info`) successful while monolith is running with `p2p` disabled.
- Component logs smoke successful for `jsonrpc` (snapshot + follow stream).
- Preset smoke successful for `profile:jsonrpc` (config write + restart + RPC response).

### Supporting Status Docs
- `docs/roadmap/MONOLITH_PRODUCTION_PLAN.md` tracks checklist progress for Sprint 1.4 and critical path.
- `docs/roadmap/CPP_LIBP2P_INTEGRATION_STATUS.md` tracks cpp-libp2p integration details and current Gate B blockers.

## Build & Dev

```bash
npm run dev          # Vite (5173) + tsc --watch + Electron
npm run build        # vite build + tsc
npm run package:mac  # electron-builder → DMG
```

- Renderer: `tsconfig.json` (Bundler module)
- Main process: `tsconfig.electron.json` (CommonJS → dist-electron/)

## Conventions

- All IPC result types: `{ ok: boolean; output: string; ... }`
- Progress events via channel: `knodel:koinos-node:backup-progress:event`
- Service IDs match Koinos compose names: chain, mempool, p2p, block_store, etc.
- Spanish is the primary user language; UI supports EN/ES toggle
- Commit messages in English

## Roadmap / Pending

- **Monolith critical path (now):**
- `resolveMonolithBinaryPath()` packaged-app verification is still pending.
- Fallback UX is still pending: when monolith binary is missing or startup fails, UI should expose clear cause and allow multi-service fallback.
- Gate B remains open: live libp2p Peer RPC interop + stable P2P runtime in C++ monolith.
- **Existing non-monolith items (secondary):**
- Backup compression optimization (`docs/roadmap/BACKUP_COMPRESSION_OPTIMIZATION.md`).
- Docs tab in UI for markdown browsing.
