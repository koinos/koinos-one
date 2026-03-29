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

### Backup System (Settings > Backup tab)
- **Create local backup:** Stops services, tar.gz of chain/ + block_store/, disk space check, SHA-256 checksum
- **Cancel support:** Button toggles Create/Cancel, kills tar process via SIGTERM
- **Progress bar:** Visible in Backup tab for both create and restore, polls file size every 2-3s
- **Restore from local file:** Opens dialog defaulting to last backup dir, extracts, restores to BASEDIR
- Files: `backup-service.ts` (spawnTar with progress polling), `ipc-handlers.ts`, `preload.ts`, `SettingsPanel.tsx`

### GarageMQ
- Binary at `vendor/amqp-broker/garagemq`, config at `vendor/amqp-broker/etc/config.yaml`
- Takes priority over Homebrew RabbitMQ (fixed in `nativeAmqpUsesBrewService()`)

### Chain State
- BASEDIR: `/Volumes/external/.koinos/` (external drive)
- Chain ~1GB (state DB), block_store ~38GB (blocks + receipts)
- Merkle mismatch fix: toggle `verify-blocks: true` in config.yml, restart chain to re-index

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

- **Backup compression optimization:** pigz/zstd support (see `docs/roadmap/BACKUP_COMPRESSION_OPTIMIZATION.md`)
- **Service status sync during backup:** UI should reflect stopped services during backup/restore
- **Post-packaging smoke tests:** Plan in `docs/roadmap/POST_PACKAGING_SMOKE_TESTS_PLAN.md`
- **Docs tab in UI:** Render markdown docs from repo inside the app
