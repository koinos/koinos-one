# Knodel — Electron App Architecture

## Overview

Knodel is a desktop application built with **Electron + React + TypeScript** that provides a complete development and operations toolkit for the Koinos blockchain. It combines a React renderer with a Node.js main process that orchestrates native microservices (C++/CMake), manages encrypted wallet storage, handles blockchain backup/restore, and provides block producer operations.

**Tech Stack:** Electron 33, React 18, Vite 6, TypeScript, koilib 9.2

---

## Project Structure

```
knodel/
├── electron/                    # Electron main process
│   ├── main.ts                  # App core (~11K lines): window, services, IPC
│   ├── preload.ts               # Context bridge (window.knodel API)
│   └── lib/                     # Service layer
│       ├── ipc-handlers.ts      # IPC channel registration (45+ handlers)
│       ├── backup-service.ts    # Blockchain backup/restore
│       ├── wallet-service.ts    # Wallet & account management
│       ├── producer-service.ts  # Block producer operations
│       ├── knodel-storage.ts    # Encrypted persistence (AES-256-GCM)
│       ├── main-types.ts        # All shared type definitions
│       ├── native-runtime-service.ts  # Service process orchestration
│       ├── native-build-service.ts    # CMake/Go/Yarn build detection
│       ├── logs-service.ts      # Log streaming & follow sessions
│       ├── workspace-service.ts # Koinos repo & config management
│       ├── constants.ts         # Paths, contract addresses, defaults
│       └── platform.ts          # OS detection, executable resolution
│
├── src/                         # React renderer
│   ├── App.tsx                  # Monolithic UI component (all state)
│   ├── i18n.ts                  # Translations (EN + ES)
│   ├── styles.css               # All styling
│   ├── app/                     # Utilities, types, constants
│   │   ├── utils.tsx            # Formatters, RPC helpers
│   │   └── types.ts             # UI state types
│   ├── components/panels/       # Tab panel components
│   │   ├── ExplorerPanel.tsx    # Chain head, recent blocks
│   │   ├── DashboardPanel.tsx   # Producers, peers, performance
│   │   ├── WalletPanel.tsx      # Accounts, balances, transfers
│   │   ├── ProducerPanel.tsx    # Producer registration, APY
│   │   ├── SettingsPanel.tsx    # General, backup, microservices
│   │   ├── BlockDetailDialog.tsx # Block/tx inspection modal
│   │   ├── MicroservicesConfigPanel.tsx # Service management
│   │   └── NodeFileEditorModal.tsx     # config.yml editor
│   └── knodel-electron.d.ts     # Type declarations for window.knodel
│
├── vendor/                      # Vendored dependencies
│   ├── koinos/                  # 11 git submodules (C++ microservices)
│   └── amqp-broker/             # GarageMQ binary + config
│
├── scripts/                     # Build, packaging, icon generation
├── backend/                     # Express server (secondary)
├── vite.config.ts               # Renderer bundler config
├── tsconfig.json                # Renderer TypeScript config
└── tsconfig.electron.json       # Main process TypeScript config
```

---

## IPC Communication Pattern

Knodel uses Electron's `contextBridge` + `ipcRenderer.invoke` pattern for all renderer ↔ main communication.

### Flow

```
React (App.tsx)
  │
  │  window.knodel.koinosNode.status()
  ▼
preload.ts (contextBridge)
  │
  │  ipcRenderer.invoke('knodel:koinos-node:status', input)
  ▼
ipc-handlers.ts (ipcMain.handle)
  │
  │  deps.koinosNodeStatus(input)
  ▼
main.ts (service functions)
  │
  │  Calls service layer (backup-service, wallet-service, etc.)
  ▼
Result returned via Promise
```

### Event Streams (main → renderer)

For real-time data (logs, backup progress), the main process pushes events:

```typescript
// Main process
mainWindow.webContents.send('knodel:koinos-node:backup-progress:event', event)

// Renderer (via preload bridge)
window.knodel.koinosNode.onBackupProgressEvent((event) => {
  setNodeBackupProgress(event)
})
```

### Context Bridge API (`window.knodel`)

```typescript
window.knodel = {
  version: string,
  appConfig: { loadPublicRpcUrls, savePublicRpcUrls },
  koinosNode: {
    // Lifecycle
    defaults(), status(), presets(), start(), stop(),
    // Build
    nativeBuildAll(), nativeBuildService(), nativeBuildStatus(),
    // Backup
    createBackup(), cancelCreateBackup(), restoreBackup(), restoreLocalBackup(),
    // Dashboard
    dashboardProducers(), dashboardPeers(), dashboardPerformance(),
    // Producer
    producerOverview(), producerRegister(), producerDelete(),
    // Services
    serviceStart(), serviceStop(), serviceRestart(),
    // Logs
    logs(), logsFollowStart(), logsFollowStop(),
    // Events
    onLogsFollowEvent(listener), onBackupProgressEvent(listener),
  },
  wallet: {
    generate(), import(), overview(), unlock(), listAccounts(),
    transferKoin(), transferVhp(), burn(), balance(), readContract(),
  }
}
```

---

## Service Layer Architecture

All services follow a **factory + dependency injection** pattern:

```typescript
const backupService = createBackupService({
  normalizeNodeSettings,
  koinosNodeAction,
  runCommand,
  // ... other deps
})
```

### Services

| Service | File | Purpose |
|---------|------|---------|
| **backup-service** | `backup-service.ts` | Download, create, restore blockchain backups. Progress tracking, disk space checks, cancel support. |
| **wallet-service** | `wallet-service.ts` | Generate/import wallets, manage accounts (derived, imported, watch-only), encrypt/decrypt with AES-256-GCM, execute transfers. |
| **producer-service** | `producer-service.ts` | Query producer status, register on-chain, calculate APY, block production metrics. |
| **knodel-storage** | `knodel-storage.ts` | Encrypted file persistence. PBKDF2 (100K iterations) + AES-256-GCM. Stores wallet data in `userData/secure-storage/`. |
| **native-runtime** | `native-runtime-service.ts` | Start/stop native services, manage AMQP broker, handle port conflicts, coordinate service dependencies. |
| **native-build** | `native-build-service.ts` | Detect build tools (cmake, clang, go, yarn), report build status, provide compilation commands. |
| **workspace** | `workspace-service.ts` | Clone/refresh Koinos repo, ensure config files (config.yml, genesis_data.json), validate BASEDIR. |
| **logs** | `logs-service.ts` | Stream logs from running services, create follow sessions, buffer limits (512KB per service). |

---

## Native Microservice Management

### Managed Services (12)

```
amqp, chain, mempool, block_store, p2p, block_producer,
jsonrpc, grpc, transaction_store, contract_meta_store,
account_history, rest
```

### Startup Order

1. **AMQP broker** first (all services depend on it)
2. **Chain** service
3. Remaining services (respecting dependency graph)

### Process Tracking

```typescript
// Map-based registry of spawned native processes
const nativeServiceProcesses = new Map<string, {
  processId: number
  serviceId: string
  childProcess: ChildProcess
  startedAt: number
}>()
```

### AMQP Broker Priority

1. Check for GarageMQ binary at `vendor/amqp-broker/garagemq`
2. If exists → spawn GarageMQ directly
3. If not → check Homebrew RabbitMQ (`brew services start rabbitmq`)
4. Health check: TCP 5672 (AMQP) + 15672 (Admin), timeout 90s

### Build System

| Service | Build | Language |
|---------|-------|----------|
| chain, mempool, p2p, block_producer, block_store, jsonrpc, grpc, account_history, contract_meta_store, transaction_store | CMake | C++ |
| rest | Yarn | TypeScript |
| amqp | Precompiled | (vendored) |

---

## Renderer Architecture

### State Management

**Pattern:** `useState` hooks in monolithic `App.tsx`, props drilled to panel components.

No Redux, Context API, or external state library — all state lives at the top level.

**Key State Buckets:**

| State | Type | Purpose |
|-------|------|---------|
| `language` | `'en' \| 'es'` | UI language |
| `nodeSettings` | `NodeManagerSettings` | Koinos node config |
| `nodeStatus` | `KoinosNodeStatus` | Current service states |
| `activeTab` | `AppTab` | Selected main tab |
| `recentBlocks` | `BlockRow[]` | Cached blockchain blocks |
| `headSnapshot` | `HeadSnapshot` | Current chain head |
| `nodeBackupProgress` | `NodeBackupProgressState` | Backup/restore progress |
| `walletActivityLog` | `WalletActivityEntry[]` | Transaction history |
| `producerProfile` | `KnodelProducerProfile` | Producer config |
| `nativeBuilds` | `NativeBuildsResult` | Build status per service |

### Persistence

```typescript
// localStorage keys
'knodel.ui.language.v1'              → AppLanguage
'knodel.explorer.settings.v1'       → ExplorerSettings (JSON)
'knodel.koinos-node.settings.v1'    → NodeManagerSettings (JSON)
```

### RPC Polling

- **Explorer:** chain head every 3s (configurable `pollMs`)
- **Dashboard:** producers/peers every 5s (configurable)
- **Debounce:** 500ms to prevent excessive requests

### Panel Components

| Panel | Purpose |
|-------|---------|
| `ExplorerPanel` | Chain head, recent blocks, sync status |
| `DashboardPanel` | Producer rankings, peer network, performance metrics |
| `WalletPanel` | Account management, balances, transfers, burn |
| `ProducerPanel` | Producer registration, APY calculator, key management |
| `SettingsPanel` | General settings, backup/restore, microservices config |
| `BlockDetailDialog` | Full block inspection (transactions, receipts, events) |
| `MicroservicesConfigPanel` | Start/stop individual services, profiles, native builds |
| `NodeFileEditorModal` | Inline config.yml editor |

---

## i18n System

**Languages:** English (EN), Spanish (ES)

**Pattern:** Key-value message maps with template interpolation.

```typescript
// i18n.ts
const messages: Record<AppLanguage, Record<string, string>> = {
  en: { 'tab.explorer': 'Explorer', ... },
  es: { 'tab.explorer': 'Explorador', ... }
}

// Usage in React
const t = (key: string, values?) => translate(key, language, values)
return <h1>{t('app.subtitle')}</h1>

// Template interpolation
// Key: 'app.versionTitle': 'Knodel version {version}'
t('app.versionTitle', { version: '0.10.0' })
// → 'Knodel version 0.10.0'
```

**Key Naming Convention:**
```
app.*        — Main app strings
tab.*        — Tab names
node.*       — Node/service operations
wallet.*     — Wallet operations
producer.*   — Producer mode
settings.*   — Settings panel
common.*     — Shared UI labels
```

---

## Encryption & Security

### Wallet Encryption

- **Algorithm:** AES-256-GCM
- **Key Derivation:** PBKDF2 (100,000 iterations, SHA-256)
- **Per-account:** Random salt + IV for each encrypted secret

### Storage Layout

```
{userData}/
├── secure-storage/
│   ├── producer-wallet.json              # Encrypted wallet
│   └── wallet-accounts/
│       └── {accountId}.json              # Encrypted account keys
└── config/
    ├── producer-profile.v1.json          # Producer settings (unencrypted)
    └── public-rpcs.json                  # RPC URL list (unencrypted)
```

### Account Types

| Type | Description |
|------|-------------|
| `derived` | HD wallet derived from seed (path: `m/44'/0'/0'/0'/N`) |
| `imported-wif` | Imported via WIF (Wallet Import Format) |
| `watch-only` | Address only, no signing capability |

---

## Build & Packaging

### Development

```bash
npm run dev
# Concurrently runs:
#   dev:renderer  → vite (port 5173)
#   dev:main      → tsc --watch (tsconfig.electron.json → dist-electron/)
#   dev:electron  → wait-on tcp:5173 + main.js, then launch Electron
```

### Production Build

```bash
npm run build          # vite build + tsc
npm run package:mac    # electron-builder → DMG
npm run package:win    # electron-builder → NSIS installer
```

### Output

```
dist/                  # Vite renderer output (HTML + JS + CSS)
dist-electron/         # Compiled main process (CommonJS)
```

### TypeScript Configs

| Config | Target | Module | Scope |
|--------|--------|--------|-------|
| `tsconfig.json` | ES2020 | Bundler (Vite) | `src/` (renderer) |
| `tsconfig.electron.json` | ES2020 | CommonJS | `electron/` (main process) |

---

## Key Constants

```typescript
// Paths
DEFAULT_BASEDIR = '~/.koinos'

// Contract addresses
KOIN_CONTRACT  = '19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK'
VHP_CONTRACT   = '12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq'
POB_CONTRACT   = '159myq5YUhhoVWu3wsHKHiJYKPKGUrGiyv'

// RPC
PUBLIC_KOINOS_RPC_URL = 'https://api.koinos.io/'

// Dashboard
DASHBOARD_PRODUCER_WINDOW_BLOCKS_DEFAULT = 200
DASHBOARD_REFRESH_SECONDS_DEFAULT = 5

// Encryption
KNODEL_PBKDF2_ITERATIONS = 100_000
KNODEL_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
```

---

## Platform Support

```typescript
// Detection (platform.ts)
currentPlatform()     → 'darwin' | 'win32' | 'linux'
isAppleSilicon()      → os.arch() === 'arm64'
homebrewPrefix()      → '/opt/homebrew' | null
findExecutableInPath(cmd) → full path | null

// Path branching
if (isPackagedBuild()) {
  binRoot = process.resourcesPath + '/koinos/bin'
} else {
  binRoot = 'vendor/koinos'  // dev mode
}
```

---

## Architecture Patterns Summary

| Pattern | Implementation |
|---------|---------------|
| **IPC** | `ipcRenderer.invoke` / `ipcMain.handle` (async RPC) |
| **Events** | `webContents.send` for logs/progress streams |
| **Services** | Factory functions with dependency injection |
| **State** | `useState` hooks, prop drilling (no Redux/Context) |
| **Persistence** | localStorage (UI), encrypted JSON files (wallet) |
| **i18n** | Key-value maps with `{placeholder}` interpolation |
| **Types** | Shared via `main-types.ts` (main) + `knodel-electron.d.ts` (renderer) |
| **Result types** | Always `{ ok: boolean; output: string; ... }` |
| **Native processes** | `child_process.spawn` with Map-based registry |
| **Encryption** | AES-256-GCM + PBKDF2 per-account |
