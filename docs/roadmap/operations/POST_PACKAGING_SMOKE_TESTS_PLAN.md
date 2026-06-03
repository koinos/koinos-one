# Plan: Post-Packaging Smoke Tests

## Context

Multiple bugs have been found AFTER packaging the installer that could have been caught with automated tests:
1. White screen — renderer path `../dist/index.html` resolved wrong from `dist-electron/lib/`
2. GarageMQ config not found — relative `.koinos` basedir instead of absolute path
3. Chain can't find genesis_data.json — basedir passed as relative path

These are all **path resolution bugs** that only manifest in packaged mode (not dev mode). We need automated smoke tests that run AFTER `electron-builder` produces the output, validating the packaged app structure before shipping.

## Test Framework

Use **Vitest** (already configured in project) with a dedicated test file that inspects the `release-new/win-unpacked/` directory.

## Tests to Implement

### 1. Asar Content Validation (`electron/tests/packaged-smoke.test.ts`)

```typescript
// Verify dist/ and dist-electron/ are in the asar
test('asar contains renderer dist files')
test('asar contains electron main process files')
test('asar package.json has correct main entry')

// Verify the loadFile path resolves correctly
test('renderer loadFile path resolves from dist-electron/lib/ to dist/index.html')
```

### 2. Extra Resources Validation

```typescript
// All 12 binaries present in koinos/bin/
test('all koinos binaries exist in resources/koinos/bin/')

// Config files present
test('config.yml template exists in resources/koinos/config/')
test('genesis_data.json exists in resources/koinos/config/')
test('koinos_descriptors.pb exists in resources/koinos/config/')
test('garagemq.yaml exists in resources/koinos/config/amqp/')
```

### 3. Path Resolution Simulation

```typescript
// Simulate isPackagedBuild() = true and verify all resolve* functions
test('resolveKoinosBinRoot() returns absolute path under resources')
test('resolveAmqpBrokerPath() returns existing garagemq.exe')
test('resolveAmqpBrokerConfigPath() returns existing garagemq.yaml')
test('resolveKoinosConfigRoot() returns existing config directory')

// Simulate nativeServiceLaunchSpec basedir resolution
test('nativeAmqpRuntimeDir uses absolute basedir path')
test('nativeServiceLaunchSpec --basedir argument is absolute')
```

### 4. Runtime File Provisioning

```typescript
// Test ensureBaseDirKoinosRuntimeFiles with a temp BASEDIR
test('copies genesis_data.json to basedir/chain/')
test('copies koinos_descriptors.pb to basedir/jsonrpc/descriptors/')
test('copies config.yml to basedir/ (preserves existing)')
test('copies garagemq.yaml to basedir/amqp/')
```

### 5. Binary Executability

```typescript
// Run each binary with --version or --help to verify they're not corrupted
test('garagemq.exe runs without DLL errors')
test('koinos_chain.exe --help exits cleanly')
test('koinos-block-store.exe --help exits cleanly')
// ... for each binary
```

## Implementation

### File: `electron/tests/packaged-smoke.test.ts`

- Uses `asar` npm package to list/extract asar contents
- Uses `child_process.execSync` to test binary executability
- Uses `fs` to check file existence
- Configurable `PACKAGED_APP_DIR` env var (defaults to `release-new/win-unpacked`)

### npm Script

```json
"test:packaged": "PACKAGED_APP_DIR=release-new/win-unpacked vitest run electron/tests/packaged-smoke.test.ts"
```

### CI Integration

Add to `package:win` script:
```json
"package:win": "npm run build && npm run stage:win && electron-builder --win nsis && npm run test:packaged"
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `electron/tests/packaged-smoke.test.ts` | **NEW** — All smoke tests |
| `package.json` | Add `test:packaged` script |

## Verification

1. Run `npm run package:win`
2. Tests run automatically after packaging
3. All tests pass → safe to upload to GitHub release
4. Any test failure → build fails, prevents shipping broken installer
