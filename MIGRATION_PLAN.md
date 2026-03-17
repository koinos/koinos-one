# Knodel Migration Plan: Native Windows + Submodules + Docker Removal

> **Branch:** `feat/native-windows-submodules`
> **Base:** `main` (commit `574dd6c` — merge: wallet account switching fixes)
> **Date:** 2026-03-17
> **Author:** pgarcgo + Claude

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Phase A — Remove Docker Functionality](#3-phase-a--remove-docker-functionality)
4. [Phase B — Internalize Koinos Microservices as Git Submodules](#4-phase-b--internalize-koinos-microservices-as-git-submodules)
5. [Phase C — Native Windows Compilation (+ Mac compatibility)](#5-phase-c--native-windows-compilation--mac-compatibility)
6. [Risk Assessment](#6-risk-assessment)
7. [Implementation Order](#7-implementation-order)

---

## 1. Executive Summary

**Goal:** Transform Knodel from a Docker-dependent desktop app into a fully native, self-contained Electron application that:

- **(A)** Has zero Docker dependencies — all Koinos services compile and run natively.
- **(B)** Bundles all upstream Koinos microservice repositories as git submodules inside the monorepo, making `knodel` the single top-level dependency.
- **(C)** Compiles and runs on Windows 10 natively (primary target), while preserving macOS compilation support.

---

## 2. Current Architecture Analysis

### 2.1 Repository Structure (main branch)

```
knodel/
├── assets/branding/              # Logo, icons
├── backend/                      # Node.js bootstrap + SQLite API (offline indexer)
│   ├── src/
│   │   ├── bootstrap.js          # Downloads/extracts Koinos backup, indexes to SQLite
│   │   ├── config.js             # DATA_DIR, DB_PATH, BACKUP_BASE_URL
│   │   ├── db.js                 # better-sqlite3 schema + upsert
│   │   └── server.js             # Express API (/health, /blocks/latest, /blocks/:height)
│   └── test/
├── electron/
│   ├── main.ts                   # ~1700 lines — monolith main process (ALL logic here)
│   ├── preload.ts                # IPC bridge to renderer
│   ├── lib/
│   │   ├── app-lifecycle-service.ts
│   │   ├── backup-service.ts     # Blockchain backup download + restore
│   │   ├── compose-helpers.ts    # Docker Compose YAML parser + port resolver
│   │   ├── constants.ts          # All defaults (Mac paths, Docker paths, ports, etc.)
│   │   ├── contract-loader.ts    # Koilib contract ABI loader
│   │   ├── ipc-handlers.ts
│   │   ├── knodel-storage.ts     # Encrypted local storage
│   │   ├── logs-service.ts       # Service log tailing
│   │   ├── main-types.ts         # TypeScript interfaces
│   │   ├── native-build-service.ts   # cmake/go/yarn build orchestration
│   │   ├── native-runtime-service.ts # Manages native + Docker process lifecycle
│   │   ├── native-tooling.ts     # Build definitions for 11 Koinos services
│   │   ├── native-versions.ts    # Version detection for native binaries
│   │   ├── node-paths.ts         # Path utilities, normalizeNodeSettings()
│   │   ├── producer-keys.ts      # Producer key management
│   │   ├── producer-service.ts
│   │   ├── wallet-accounts.ts
│   │   ├── wallet-service.ts
│   │   └── workspace-service.ts  # Repo clone, config file management
│   ├── introspect.js / introspect2.js  # Dev debugging helpers
│   └── smoke.js
├── infra/koinos/.env.example     # Docker Compose port mapping config
├── scripts/
│   ├── build-mac-icon.js         # macOS icon generator
│   ├── check-notarize-credentials.js  # macOS notarization check
│   ├── dev-electron.js           # Dev startup
│   ├── koinos-compose-all.sh     # Docker Compose wrapper (bash only)
│   └── koinos-local.js           # Port preflight checker
├── src/                          # React frontend
│   ├── App.tsx                   # ~2000+ lines — monolith UI
│   ├── app/
│   │   ├── constants.ts          # Frontend constants
│   │   ├── producer.ts           # Producer status logic
│   │   ├── types.ts              # Frontend types
│   │   └── utils.tsx             # Utilities
│   ├── components/panels/        # UI panels (Dashboard, Explorer, Settings, etc.)
│   ├── i18n.ts                   # Internationalization
│   └── styles.css
├── electron-builder.yml          # macOS-only packaging config
├── package.json                  # v0.9.0
├── vite.config.ts
└── vitest.config.ts
```

### 2.2 External Koinos Microservices (currently expected at `/Users/pgarcgo/code/koinos_code/`)

The native build system (`native-tooling.ts`) defines **11 Koinos services** that are compiled from **separate git repos** scattered on disk:

| Service ID | Repo Name | Build System | Language |
|---|---|---|---|
| `chain` | `koinos-chain` | cmake | C++ |
| `mempool` | `koinos-mempool` | cmake | C++ |
| `block_store` | `koinos-block-store` | go | Go |
| `p2p` | `koinos-p2p` | go | Go |
| `block_producer` | `koinos-block-producer` | cmake | C++ |
| `jsonrpc` | `koinos-jsonrpc` | go | Go |
| `grpc` | `koinos-grpc` | cmake | C++ |
| `transaction_store` | `koinos-transaction-store` | go | Go |
| `contract_meta_store` | `koinos-contract-meta-store` | go | Go |
| `account_history` | `koinos-account-history` | cmake | C++ |
| `rest` | `koinos-rest` | yarn | TypeScript/Node |

Additionally:
- **`amqp`** (RabbitMQ) — used via `brew install rabbitmq` on Mac (no source build)
- **`koinos`** (umbrella repo) — contains `docker-compose.yml`, config templates, env files

### 2.3 Docker-Related Code (to be removed)

Docker functionality is deeply integrated across:

1. **`electron/lib/compose-helpers.ts`** — Full Docker Compose YAML parser, port resolver, env file reader
2. **`electron/lib/native-runtime-service.ts`** — Dual-mode runtime (Docker vs. native); Docker startup, process management
3. **`electron/lib/constants.ts`** — Docker Desktop constants (`MAC_DOCKER_DESKTOP_*`, `DEFAULT_COMPOSE_FILE`, etc.)
4. **`electron/lib/node-paths.ts`** — `normalizeNodeSettings()` includes `runtimeMode: 'docker' | 'native'`
5. **`electron/lib/main-types.ts`** — `KoinosNodeServiceRuntime = 'docker' | 'native'`; Docker-specific types
6. **`electron/main.ts`** — Docker startup/stop logic, compose detection, Docker Desktop auto-launch
7. **`scripts/koinos-compose-all.sh`** — Bash-only Docker Compose wrapper
8. **`scripts/koinos-local.js`** — Port preflight for Docker-based local node
9. **`infra/koinos/.env.example`** — Docker port mappings
10. **`src/App.tsx`** — UI references to `runtimeMode`, compose file editors, Docker status indicators
11. **Multiple `.md` plan files** on main that reference Docker (these are documentation)

### 2.4 Platform-Specific Code (Mac-centric)

Currently hardcoded for macOS:

- **`constants.ts`**: `DEFAULT_KOINOS_REPO_PATH = '/Users/pgarcgo/code/koinos_code/koinos'`
- **`constants.ts`**: `DEFAULT_KOINOS_SOURCE_ROOT = '/Users/pgarcgo/code/koinos_code'`
- **`constants.ts`**: `MAC_DOCKER_DESKTOP_APP_PATH = '/Applications/Docker.app'`
- **`native-tooling.ts`**: `isAppleSiliconHost()`, Homebrew paths, `.dylib` references, `CMAKE_OSX_ARCHITECTURES`
- **`native-tooling.ts`**: `nativeHomebrewPrefix()` returns `/opt/homebrew`
- **`native-tooling.ts`**: `nativeRabbitmqServerExecutable()` — Homebrew RabbitMQ lookup
- **`koinos-compose-all.sh`**: macOS-only bash script with Darwin detection
- **`scripts/build-mac-icon.js`**: macOS icon generation
- **`electron-builder.yml`**: macOS-only packaging (dmg, icns, notarize)

---

## 3. Phase A — Remove Docker Functionality

### 3.1 Files to Delete Entirely

| File | Reason |
|---|---|
| `scripts/koinos-compose-all.sh` | Docker Compose bash wrapper |
| `infra/koinos/.env.example` | Docker port mappings |
| `infra/` directory entirely | Only contains Docker infra |

### 3.2 Files to Delete (Documentation Artifacts)

These `.md` files on main are Docker-era planning docs that will become stale:

| File | Content |
|---|---|
| `APP_REFACTOR_STRUCTURE.md` | References Docker architecture |
| `DASHBOARD_PERFORMANCE_IMPLEMENTATION_PLAN.md` | Internal plan doc |
| `ELECTRON_MAIN_REFACTOR_PHASE1.md` | References Docker services |
| `ELECTRON_MAIN_REFACTOR_REMAINING_STEPS.md` | References Docker services |
| `KNODEL_WALLET_KONDOR_ADAPTATION_PLAN.md` | Plan doc |
| `KNODEL_WALLET_KONDOR_ADAPTATION_STATUS.md` | Status doc |
| `NATIVE_BASEDIR_CONFIG_OVERRIDE_BUG.md` | Bug doc referencing Docker |
| `PRODUCER_WALLET_ACCOUNT_INTEGRATION_PLAN.md` | Plan doc |
| `WALLET_TAB_IMPLEMENTATION_PLAN.md` | Plan doc |

**Action:** Delete all. These are planning artifacts, not documentation. The migration itself will serve as the new architectural reference.

### 3.3 Files to Modify (Remove Docker Code)

#### `electron/lib/constants.ts`
- **Remove:** `DEFAULT_COMPOSE_FILE`, `DEFAULT_ENV_FILE`, `LEGACY_DEFAULT_ENV_FILE`, all `MAC_DOCKER_DESKTOP_*` constants
- **Keep:** All non-Docker constants (crypto, storage, RPC, port config, Git URLs, etc.)

#### `electron/lib/compose-helpers.ts`
- **Delete entirely.** This file is 100% Docker Compose parsing logic.

#### `electron/lib/compose-helpers.test.ts`
- **Delete entirely.** Tests for the removed module.

#### `electron/lib/main-types.ts`
- **Remove:** `KoinosNodeServiceRuntime` type (always `'native'` now)
- **Remove:** All `runtimeMode` fields from interfaces
- **Remove:** Docker-specific types (`ComposeServiceDefinition.image`, etc.)
- **Simplify:** `KoinosNodeSettings` — remove `composeFile`, `envFile` fields

#### `electron/lib/node-paths.ts`
- **Remove:** `composeFilePath()`, `envFilePath()`, `managedFilePath()` for compose/env kinds
- **Remove:** `runtimeMode` from `normalizeNodeSettings()` — always native
- **Remove:** `LEGACY_DEFAULT_ENV_FILE` import and handling
- **Simplify:** Settings interfaces to remove compose/env file fields

#### `electron/lib/native-runtime-service.ts`
- **Major rewrite.** Currently has dual Docker/native logic. Remove all Docker code paths:
  - Remove `docker compose` command execution
  - Remove Docker status checking
  - Remove Docker Desktop auto-launch
  - Remove compose override file generation
  - Keep all native process management (spawn, stop, status polling)

#### `electron/lib/workspace-service.ts`
- **Remove:** `assertRepoReady()` checks for compose file and env file
- **Remove:** `ensureKoinosConfigFiles()` — manages Docker-era config templates
- **Simplify:** `cloneKoinosRepo()` — remove compose/env rename logic
- **Remove:** `readKoinosManagedFile()` / `writeKoinosManagedFile()` for compose/env file kinds

#### `electron/main.ts`
- **Remove:** All Docker Compose imports and handlers
- **Remove:** Docker Desktop auto-launch logic
- **Remove:** `compose-helpers` imports
- **Remove:** Docker runtime mode switching UI handlers
- **Keep:** Native service orchestration, wallet, producer, explorer, backup logic

#### `electron/preload.ts`
- **Keep as-is.** The IPC bridge is runtime-agnostic. Backend handlers will simply no longer support Docker calls.

#### `src/App.tsx` + `src/app/types.ts` + `src/app/utils.tsx` + `src/app/constants.ts`
- **Remove:** `runtimeMode` state, UI toggles, Docker status indicators
- **Remove:** Compose file editor modal triggers
- **Remove:** `formatNodeRuntimeMode()` utility
- **Simplify:** Settings panel to remove Docker-specific configuration fields

#### `src/components/panels/SettingsPanel.tsx`
- **Remove:** Docker/native mode toggle, compose file path input, env file path input

#### `scripts/koinos-local.js`
- **Evaluate:** This script checks ports for a Docker-based local node. Either **delete** or **repurpose** for native port checking only.

#### `package.json`
- **Remove script:** `koinos:preflight` (Docker-only)
- **Remove dependency:** `yaml` (only used by `compose-helpers.ts` for parsing docker-compose YAML)

---

## 4. Phase B — Internalize Koinos Microservices as Git Submodules

### 4.1 Strategy: Git Submodules

Git submodules are the right choice here because:
- Each Koinos service is an independent upstream repo with its own release cycle
- Submodules pin exact commits, ensuring reproducible builds
- `git clone --recurse-submodules` gives everything in one step
- The knodel repo becomes the single source of truth

### 4.2 Submodule Layout

```
knodel/
├── vendor/koinos/                    # All Koinos dependencies
│   ├── koinos/                       # Umbrella repo (config templates, genesis data)
│   ├── koinos-chain/                 # C++ (cmake)
│   ├── koinos-mempool/               # C++ (cmake)
│   ├── koinos-block-store/           # Go
│   ├── koinos-p2p/                   # Go
│   ├── koinos-block-producer/        # C++ (cmake)
│   ├── koinos-jsonrpc/               # Go
│   ├── koinos-grpc/                  # C++ (cmake)
│   ├── koinos-transaction-store/     # Go
│   ├── koinos-contract-meta-store/   # Go
│   ├── koinos-account-history/       # C++ (cmake)
│   └── koinos-rest/                  # TypeScript/Node (yarn)
```

### 4.3 Submodule Addition Commands

```bash
# Create vendor directory
mkdir -p vendor/koinos

# Add each submodule
git submodule add https://github.com/koinos/koinos.git              vendor/koinos/koinos
git submodule add https://github.com/koinos/koinos-chain.git        vendor/koinos/koinos-chain
git submodule add https://github.com/koinos/koinos-mempool.git      vendor/koinos/koinos-mempool
git submodule add https://github.com/koinos/koinos-block-store.git  vendor/koinos/koinos-block-store
git submodule add https://github.com/koinos/koinos-p2p.git          vendor/koinos/koinos-p2p
git submodule add https://github.com/koinos/koinos-block-producer.git vendor/koinos/koinos-block-producer
git submodule add https://github.com/koinos/koinos-jsonrpc.git      vendor/koinos/koinos-jsonrpc
git submodule add https://github.com/koinos/koinos-grpc.git         vendor/koinos/koinos-grpc
git submodule add https://github.com/koinos/koinos-transaction-store.git vendor/koinos/koinos-transaction-store
git submodule add https://github.com/koinos/koinos-contract-meta-store.git vendor/koinos/koinos-contract-meta-store
git submodule add https://github.com/koinos/koinos-account-history.git vendor/koinos/koinos-account-history
git submodule add https://github.com/koinos/koinos-rest.git         vendor/koinos/koinos-rest
```

### 4.4 Code Changes to Point to Submodules

#### `electron/lib/constants.ts`
```typescript
// BEFORE:
export const DEFAULT_KOINOS_SOURCE_ROOT = '/Users/pgarcgo/code/koinos_code'
export const DEFAULT_KOINOS_REPO_PATH = '/Users/pgarcgo/code/koinos_code/koinos'

// AFTER (relative to app root):
import path from 'node:path'
import { app } from 'electron'

// Resolve relative to the repo root (works in dev and packaged)
function resolveVendorPath(): string {
  const appRoot = app.isPackaged
    ? path.dirname(app.getAppPath())
    : path.resolve(__dirname, '..', '..')
  return path.join(appRoot, 'vendor', 'koinos')
}

export const DEFAULT_KOINOS_SOURCE_ROOT = resolveVendorPath()
export const DEFAULT_KOINOS_REPO_PATH = path.join(DEFAULT_KOINOS_SOURCE_ROOT, 'koinos')
```

#### `electron/lib/native-tooling.ts`
- Update `nativeServiceBuildDefinitions()` to use `vendor/koinos/` relative paths
- The function already takes `sourceRoot` as a parameter, so this is mostly about updating the default

### 4.5 `.gitmodules` File

A `.gitmodules` file will be auto-generated by the `git submodule add` commands and will look like:

```ini
[submodule "vendor/koinos/koinos"]
    path = vendor/koinos/koinos
    url = https://github.com/koinos/koinos.git
[submodule "vendor/koinos/koinos-chain"]
    path = vendor/koinos/koinos-chain
    url = https://github.com/koinos/koinos-chain.git
# ... etc for each submodule
```

### 4.6 Clone Instructions Update (README)

```bash
git clone --recurse-submodules https://github.com/pgarciagon/knodel.git
cd knodel

# Or if already cloned:
git submodule update --init --recursive
```

---

## 5. Phase C — Native Windows Compilation (+ Mac compatibility)

### 5.1 Current Mac-Only Assumptions to Fix

| Location | Mac Assumption | Windows Fix |
|---|---|---|
| `native-tooling.ts: isAppleSiliconHost()` | `process.platform === 'darwin'` | Add `isWindowsHost()` check |
| `native-tooling.ts: nativeCmakeExecutable()` | Homebrew/Python paths | Use `cmake` from PATH on Windows (Visual Studio / choco) |
| `native-tooling.ts: nativeHomebrewPrefix()` | `/opt/homebrew` | Return `null` on Windows |
| `native-tooling.ts: nativeCmakeConfigureArgs()` | `CMAKE_OSX_ARCHITECTURES`, Homebrew GMP paths | Windows: Use vcpkg or system-installed libs, no OSX flags |
| `native-tooling.ts: nativeGitExecutable()` | `/usr/bin/git` | Use `git` from PATH on Windows |
| `native-tooling.ts: nativeRabbitmqServerExecutable()` | Homebrew paths | Use `rabbitmq-server` from PATH or Chocolatey install dir |
| `native-tooling.ts: findExecutableInPath()` | No `.exe` extension handling | Append `.exe` on `win32` when searching PATH |
| `native-build-service.ts` | `go build -o ...` without `.exe` | Append `.exe` to artifact paths on Windows |
| `constants.ts` | Mac-specific Docker paths | Remove (Phase A) |
| `scripts/build-mac-icon.js` | macOS-only | Keep for Mac; add Windows icon build |
| `electron-builder.yml` | Mac-only (dmg, icns, notarize) | Add Windows targets (nsis, ico) |

### 5.2 Platform Abstraction Strategy

Create a new module `electron/lib/platform.ts`:

```typescript
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export type Platform = 'darwin' | 'win32' | 'linux'

export function currentPlatform(): Platform {
  return process.platform as Platform
}

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isDarwin(): boolean {
  return process.platform === 'darwin'
}

export function isAppleSilicon(): boolean {
  return isDarwin() && os.arch() === 'arm64'
}

export function executableExtension(): string {
  return isWindows() ? '.exe' : ''
}

export function findExecutableInPath(command: string): string | null {
  const extensions = isWindows() ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathDirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map(d => d.trim())
    .filter(Boolean)

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}
```

### 5.3 Native Build Changes for Windows

#### C++ Services (cmake) — `chain`, `mempool`, `block_producer`, `grpc`, `account_history`

**Mac (current):** Uses Homebrew GMP, Apple Clang, `cmake` from Homebrew/Python.

**Windows:**
- Requires Visual Studio Build Tools 2019/2022 (or MinGW/MSYS2)
- GMP via vcpkg: `vcpkg install gmp:x64-windows`
- CMake from Visual Studio or Chocolatey: `choco install cmake`
- Configure args change:
  ```
  # Mac
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 ...

  # Windows (MSVC)
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -G "Visual Studio 17 2022" -A x64 ...

  # Windows (MinGW — simpler, closer to Unix)
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -G "MinGW Makefiles" ...
  ```

**Update `nativeCmakeConfigureArgs()` in `native-tooling.ts`:**
```typescript
export function nativeCmakeConfigureArgs(buildDir = 'build'): string[] {
  const args = ['-S', '.', '-B', buildDir, '-D', 'CMAKE_BUILD_TYPE=Release',
                '-D', 'CMAKE_POLICY_VERSION_MINIMUM=3.5']

  if (isWindows()) {
    // Use MinGW for simplicity (closest to Unix toolchain)
    args.push('-G', 'MinGW Makefiles')
    // If using vcpkg for GMP:
    const vcpkgToolchain = process.env.VCPKG_ROOT
      ? path.join(process.env.VCPKG_ROOT, 'scripts', 'buildsystems', 'vcpkg.cmake')
      : null
    if (vcpkgToolchain && fs.existsSync(vcpkgToolchain)) {
      args.push('-D', `CMAKE_TOOLCHAIN_FILE=${vcpkgToolchain}`)
    }
  } else if (isAppleSilicon()) {
    args.push('-D', 'CMAKE_OSX_ARCHITECTURES=arm64')
    args.push('-D', 'CMAKE_APPLE_SILICON_PROCESSOR=arm64')
    const homebrewPrefix = nativeHomebrewPrefix()
    if (homebrewPrefix) {
      args.push('-D', `CMAKE_PREFIX_PATH=${homebrewPrefix}`)
      // ... GMP paths (existing logic)
    }
  }

  args.push('-D', `GIT_EXECUTABLE=${nativeGitExecutable()}`)
  return args
}
```

#### Go Services — `block_store`, `p2p`, `jsonrpc`, `transaction_store`, `contract_meta_store`

Go is inherently cross-platform. Changes needed:

- **Artifact path:** Append `.exe` on Windows
  ```typescript
  artifactPath: path.join(sourceRoot, 'koinos-block-store', 'build', 'bin',
    `koinos-block-store${executableExtension()}`)
  ```
- **Build command:** `CGO_ENABLED=0` works on Windows too (if no CGO deps)
- **Go installation:** User needs Go installed (`choco install golang` or manual)

#### Yarn Service — `rest` (koinos-rest)

Already cross-platform (Node.js/TypeScript). No changes needed.

#### RabbitMQ (AMQP)

**Mac:** `brew install rabbitmq`
**Windows:**
- Install Erlang + RabbitMQ via Chocolatey: `choco install rabbitmq`
- Or download installer from rabbitmq.com
- Service runs as Windows service or manually via `rabbitmq-server.bat`

Update `native-tooling.ts`:
```typescript
export function nativeRabbitmqServerExecutable(): string | null {
  if (isWindows()) {
    // Check common Windows install locations
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const candidates = [
      path.join(programFiles, 'RabbitMQ Server', 'rabbitmq_server-*', 'sbin', 'rabbitmq-server.bat'),
      // Also search PATH
    ]
    // ... glob or findExecutableInPath('rabbitmq-server')
  }
  return findExecutableInPath('rabbitmq-server')
}
```

### 5.4 Electron Builder — Windows Packaging

Update `electron-builder.yml`:

```yaml
appId: io.knodel.desktop
productName: Knodel
directories:
  buildResources: assets/branding
  output: release
files:
  - dist/**
  - dist-electron/**
  - vendor/**           # Include submodules in packaged app
  - package.json

mac:
  artifactName: ${productName}-${version}-${arch}.${ext}
  category: public.app-category.developer-tools
  icon: icon.icns
  notarize: true
  target:
    - dmg

win:
  artifactName: ${productName}-${version}-${arch}.${ext}
  icon: icon.ico
  target:
    - nsis

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

dmg:
  artifactName: ${productName}-${version}-${arch}.${ext}
```

### 5.5 Package.json Script Updates

```json
{
  "scripts": {
    "dev": "concurrently -k \"npm:dev:renderer\" \"npm:dev:main\" \"npm:dev:electron\"",
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.electron.json --watch",
    "dev:electron": "wait-on tcp:5173 dist-electron/main.js && node scripts/dev-electron.js",
    "build": "npm run build:renderer && npm run build:electron",
    "build:renderer": "vite build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "build:web": "vite build",
    "build:icon:mac": "node scripts/build-mac-icon.js",
    "build:icon:win": "node scripts/build-win-icon.js",
    "package:mac": "npm run build:icon:mac && npm run build && electron-builder --mac dmg",
    "package:win": "npm run build && electron-builder --win nsis",
    "package:mac:unsigned": "npm run build:icon:mac && npm run build && cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dmg",
    "bootstrap:offline": "node backend/src/bootstrap.js",
    "api:local": "node backend/src/server.js",
    "test:backend": "node --test backend/test/*.test.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "submodules:init": "git submodule update --init --recursive",
    "native:build:all": "node scripts/native-build-all.js"
  }
}
```

### 5.6 Bootstrap.js Windows Compatibility

Current issues in `backend/src/bootstrap.js`:
- Uses `curl` shell command — not available by default on Windows
- Uses `tar` shell command — available on Windows 10 1803+ but path handling differs
- Uses single quotes in shell commands — fails on Windows cmd

**Fix:** Replace `execSync('curl ...')` with Node.js native `fetch()` + `fs.createWriteStream()`:

```javascript
// Replace curl download with Node.js native fetch
async function downloadFile(url, dest) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const fileStream = fs.createWriteStream(dest)
  const body = response.body
  await pipeline(body, fileStream)
}
```

For `tar` extraction, use the `tar` npm package or Node.js built-in `zlib` + `tar-stream`.

### 5.7 Windows Development Prerequisites

Document in README:

```
## Windows 10 Development Setup

### Required
1. Node.js 20+ (via nvm-windows or direct installer)
2. Git for Windows (includes bash)
3. Go 1.21+ (https://go.dev/dl/ or `choco install golang`)
4. Python 3.x (for node-gyp / better-sqlite3 compilation)

### For C++ Koinos services (optional, for full native build)
5. Visual Studio Build Tools 2022 (or MSYS2 + MinGW)
6. CMake 3.20+ (`choco install cmake` or bundled with VS)
7. vcpkg (for GMP library):
   git clone https://github.com/microsoft/vcpkg.git
   .\vcpkg\bootstrap-vcpkg.bat
   .\vcpkg\vcpkg install gmp:x64-windows

### For RabbitMQ
8. Erlang/OTP (`choco install erlang`)
9. RabbitMQ (`choco install rabbitmq`)
```

---

## 6. Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|---|---|---|
| C++ Koinos services may not compile on Windows | Block producer, chain, mempool, grpc, account_history won't work | Start with Go services (cross-platform by nature); C++ services may need upstream patches or MSYS2/MinGW |
| `better-sqlite3` native addon compilation on Windows | Backend won't start | Ensure Python + VS Build Tools are installed; `npm install` should handle it via node-gyp |
| RabbitMQ on Windows behaves differently | AMQP service may fail | Test Windows RabbitMQ service; fallback to Docker for AMQP only if needed |

### Medium Risk

| Risk | Impact | Mitigation |
|---|---|---|
| Submodule size (all repos combined) | Slow initial clone | Document `--depth 1` shallow submodule option |
| Upstream Koinos repos may have breaking changes | Build failures | Pin submodules to known-good commits |
| Path separator issues (`/` vs `\`) | File operations may fail on Windows | Use `path.join()` everywhere; audit for hardcoded `/` separators |

### Low Risk

| Risk | Impact | Mitigation |
|---|---|---|
| Removing Docker breaks existing Mac users | They need to set up native tools | Document migration steps clearly |
| Electron packaging for Windows | App may not package correctly | Test `electron-builder --win` early |

---

## 7. Implementation Order

### Step 1: Phase A — Docker Removal (estimated: ~15 files changed)
1. Delete Docker-only files (`scripts/koinos-compose-all.sh`, `infra/`, `.md` plan docs)
2. Remove `compose-helpers.ts` and its test
3. Strip `runtimeMode` from types, constants, and settings
4. Clean `native-runtime-service.ts` — remove Docker code paths
5. Clean `workspace-service.ts` — remove compose/env file management
6. Clean `electron/main.ts` — remove Docker handlers
7. Clean frontend (`App.tsx`, settings panel, types, utils) — remove Docker UI
8. Remove `yaml` dependency from `package.json`
9. Run tests, fix any breakage

### Step 2: Phase B — Add Submodules (estimated: ~5 files changed)
1. Add all 12 git submodules under `vendor/koinos/`
2. Update `constants.ts` to point `DEFAULT_KOINOS_SOURCE_ROOT` to `vendor/koinos/`
3. Update `native-tooling.ts` default paths
4. Update `.gitignore` if needed
5. Add `submodules:init` script to `package.json`
6. Update `README.md` with clone instructions

### Step 3: Phase C — Windows Compatibility (estimated: ~10 files changed)
1. Create `electron/lib/platform.ts` with cross-platform utilities
2. Update `native-tooling.ts` for Windows (cmake args, exe extensions, PATH search)
3. Update `native-build-service.ts` — Windows artifact paths, build commands
4. Update `native-runtime-service.ts` — Windows process management
5. Fix `backend/src/bootstrap.js` — replace shell commands with Node.js APIs
6. Update `electron-builder.yml` — add Windows targets
7. Add `scripts/build-win-icon.js`
8. Update `package.json` — add Windows build scripts
9. Update `README.md` — Windows setup instructions
10. Test full build chain on Windows 10

---

> **Next action:** Review this plan, then begin implementation starting with Phase A.
