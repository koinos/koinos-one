# Plan: Bundle Knodel as a Single Zero-Dependency Windows Installer

## Context

All 11 Koinos microservices now compile natively on Windows (Phase C complete). The user wants the final Knodel app distributed as a **single NSIS installer** that requires no external dependencies — no Docker, no RabbitMQ, no Go/CMake/etc. at runtime.

The main blocker is that Koinos services communicate via AMQP (RabbitMQ), which currently requires a separate Erlang/RabbitMQ install. We replace it with **GarageMQ** — a single-binary Go-based AMQP 0.9.1 broker (~20MB, no dependencies, RabbitMQ protocol compatible).

## Architecture

```
Knodel.exe (Electron)
  ├── resources/koinos/bin/          ← all .exe files
  │   ├── garagemq.exe              ← AMQP broker (replaces RabbitMQ)
  │   ├── koinos-chain.exe
  │   ├── koinos-mempool.exe
  │   ├── koinos-grpc.exe
  │   ├── koinos-block-producer.exe
  │   ├── koinos-account-history.exe
  │   ├── koinos-block-store.exe
  │   ├── koinos-p2p.exe
  │   ├── koinos-jsonrpc.exe
  │   ├── koinos-transaction-store.exe
  │   └── koinos-contract-meta-store.exe
  ├── resources/koinos/rest/         ← koinos-rest Next.js app
  │   └── .next/ + node_modules/ + package.json
  ├── resources/koinos/config/       ← default genesis + config templates
  │   └── (genesis.json, config-example/)
  └── resources/app/                 ← Electron app (dist/ + dist-electron/)
```

## Implementation Steps

### Step 1: Create `scripts/stage-bundle-win.js`
Node.js script that collects all artifacts into `build/bundle-staging/koinos/`:
- Copies each Go service `.exe` from `vendor/koinos/<svc>/<svc>.exe` → `bin/`
- Copies each C++ service `.exe` from `vendor/koinos/<svc>/build-win/src/*.exe` → `bin/`
- Copies `koinos-rest/.next/` + `node_modules/` + `package.json` → `rest/`
- Copies GarageMQ binary → `bin/garagemq.exe`
- Copies genesis/config templates → `config/`

### Step 2: Build GarageMQ AMQP broker (DONE)
- Cloned GarageMQ (Go-based AMQP 0.9.1 broker) to `vendor/amqp-broker/`
- Built with `go build -o garagemq.exe .` (~20MB single binary)
- Verified: starts on port 5672, creates default AMQP exchanges
- Stage script copies binary + config to `bin/`

### Step 3: Modify `electron-builder.yml`
Add `extraResources` to bundle the staging directory:
```yaml
extraResources:
  - from: build/bundle-staging/koinos
    to: koinos
    filter:
      - "**/*"
```

### Step 4: Modify `electron/lib/constants.ts`
Add packaged-mode path resolution:
```typescript
export function isPackagedBuild(): boolean {
  return !process.defaultApp; // true when running from packaged .exe
}

export function resolveKoinosBinRoot(): string {
  if (isPackagedBuild()) {
    return path.join(process.resourcesPath!, 'koinos', 'bin');
  }
  return resolveDefaultKoinosSourceRoot(); // dev mode: vendor/koinos
}
```

### Step 5: Modify `electron/lib/native-tooling.ts`
Update `resolveServiceArtifact()` and service definitions to use dual-mode paths:
- **Packaged mode**: look in `resources/koinos/bin/<service>.exe`
- **Dev mode**: keep current `vendor/koinos/<service>/` paths
- Key function: switch on `isPackagedBuild()` to choose path strategy

### Step 6: Modify `electron/main.ts`
- Add GarageMQ as a managed service in the service dependency graph
- GarageMQ starts first (before all Koinos services that need AMQP)
- Launch spec: `garagemq.exe --config <basedir>/amqp/garagemq.yaml`
- Health check: TCP connect to `127.0.0.1:5672` before starting dependent services
- For koinos-rest in packaged mode: use `ELECTRON_RUN_AS_NODE=1` with `process.execPath` as the Node runtime, running the bundled Next.js server

### Step 7: Modify `electron/lib/workspace-service.ts`
- Config provisioning: if no user config exists, copy from `resources/koinos/config/` instead of `vendor/koinos/*/config-example/`
- Use `isPackagedBuild()` to choose source

### Step 8: Update `package.json` scripts
```json
"stage:win": "node scripts/stage-bundle-win.js",
"package:win": "npm run build && npm run stage:win && electron-builder --win nsis"
```

### Step 9: Update `.gitignore`
```
build/bundle-staging/
vendor/amqp-broker/
```

## Files to Modify
1. **NEW** `scripts/stage-bundle-win.js` — staging script
2. `electron-builder.yml` — add extraResources
3. `electron/lib/constants.ts` — add `isPackagedBuild()`, `resolveKoinosBinRoot()`
4. `electron/lib/native-tooling.ts` — dual-mode artifact resolution
5. `electron/main.ts` — GarageMQ service management, packaged-mode spawning
6. `electron/lib/workspace-service.ts` — config fallback to bundled
7. `package.json` — add `stage:win` script, update `package:win`
8. `.gitignore` — add staging/lavinmq exclusions

## Estimated Installer Size
- 10 C++ + Go binaries: ~120MB
- koinos-rest (Next.js + node_modules): ~80MB
- GarageMQ: ~15MB
- Electron runtime: ~100MB
- **Total uncompressed**: ~315MB → **~200-250MB compressed NSIS installer**

## Verification
1. Run `npm run stage:win` → verify all files present in `build/bundle-staging/koinos/`
2. Run `npm run package:win` → produces NSIS installer in `release/`
3. Install on a clean Windows machine (no dev tools)
4. Launch Knodel → verify GarageMQ starts, all services come up, blockchain syncs
5. Check Task Manager: all 12 processes (GarageMQ + 11 services) running under Knodel

## Integration Test Results (2026-03-19)
GarageMQ required a patch: auto-generate queue name when client sends empty name
(AMQP 0.9.1 spec for temporary/exclusive queues). Patch in `server/queueMethods.go`.

| Service | Type | AMQP | Status |
|---|---|---|---|
| garagemq | broker | - | RUNNING (port 5672) |
| koinos-chain | C++ | Connected | RUNNING |
| koinos-block-store | Go | Connected | RUNNING |
| koinos-mempool | C++ | Connected | RUNNING |
| koinos-p2p | Go | Connected | RUNNING |
| koinos-jsonrpc | Go | Connected | RUNNING (port 8080) |
| koinos-transaction-store | Go | Connected | RUNNING |
| koinos-contract-meta-store | Go | Connected | RUNNING |
| koinos-grpc | C++ | Connected | RUNNING (port 50051) |
| koinos-account-history | C++ | Connected | RUNNING |
| koinos-block-producer | C++ | Connected | Expected exit (no producer wallet configured) |

**10/11 services running** — all connected via GarageMQ AMQP broker.
Staging: 15/15 artifacts, 266 MB total.
