# Local Development

Koinos One development usually has two loops: the Electron/React desktop app and
the native `teleno_node` binary. Use the smallest loop that exercises the code
you changed, then widen validation for cross-layer, packaging, backup, restore,
producer, storage, or protocol-sensitive behavior.

## Prerequisites

- Node.js and npm for the renderer and Electron build.
- A CMake toolchain for
  [`node/teleno-node`](https://github.com/koinos/teleno).
- Native dependencies required by the Koinos/Teleno C++ build.
- Submodules initialized when native or protocol code is needed.

Initialize submodules when needed:

```bash
npm run submodules:init
```

## GUI And Electron Development

Run the full app development stack:

```bash
npm run dev
```

Run only the Vite renderer:

```bash
npm run dev:renderer
```

`npm run dev` starts the Vite renderer, TypeScript watch for the Electron main
process, and the Electron dev shell. The first-run assistant must remain closed
in normal Vite and Electron development runs.

Build the manual, renderer, Electron main process, and build identity metadata:

```bash
npm run build
```

The build command runs `npm run docs:build`,
[`scripts/generate-build-info.js`](https://github.com/koinos/koinos-one/blob/main/scripts/generate-build-info.js),
the Vite build, and the Electron TypeScript build.

Build only the manual site:

```bash
npm run docs:build
```

## Native Node Development

Build the native node from an existing CMake build directory:

```bash
cmake --build node/teleno-node/build --target teleno_node --parallel
```

Run native tests from the build directory:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure
```

The compatibility target `koinos_node` still depends on `teleno_node` for old
automation, but the active native binary name is `teleno_node`.

Run a focused native test group while iterating:

```bash
ctest --test-dir node/teleno-node/build -R backup --output-on-failure
```

## App Test Commands

General TypeScript and renderer tests:

```bash
npm run test
```

Focused UI tests:

```bash
npm run test:ui
npm run test:ui:backup
```

Electron smoke test:

```bash
npm run test:ui:electron
```

Package staging and packaged-app verification are part of packaging commands,
but can be run directly:

```bash
npm run test:package-staging
npm run test:packaged
```

## Packaging Commands

macOS packaging:

```bash
npm run package:mac
npm run package:mac:dir
npm run package:mac:unsigned
```

Windows packaging is present but secondary to current macOS work:

```bash
npm run package:win
```

## Validation Scripts

Use scripts when the change touches parity, backup, restore, packaging, or
network behavior. Examples:

```bash
scripts/smoke-native-backup-restore.sh
scripts/smoke-public-bootstrap-promotion.sh
scripts/compare-jsonrpc-parity.py
scripts/compare-grpc-parity.sh
scripts/validate-grpc-client-compatibility.sh
scripts/run-koinos-integration-compat.sh
scripts/verify-package-staging.js
scripts/verify-packaged-app.js
```

## Documentation Development

The manual is built by MkDocs from
[`docs/manual/`](https://github.com/koinos/koinos-one/tree/main/docs/manual)
with `use_directory_urls: false`. Keep this setting so the in-app
Documentation iframe loads concrete HTML files under `/manual-site/...html`
rather than falling back to app routes.

After adding, removing, or renaming manual pages:

1. Update
   [`mkdocs.yml`](https://github.com/koinos/koinos-one/blob/main/mkdocs.yml).
2. Use relative Markdown links for pages inside the manual.
3. Link source files, source folders, and Markdown files outside the manual to
   the official GitHub repository.
4. Run:

```bash
mkdocs build --strict
```

The output is generated under `build/docs/manual-site/`.

## Choosing Validation

- GUI-only changes: run `npm run test`, the relevant Playwright test, and
  visually inspect the changed screen.
- Electron bridge changes: run `npm run build`, focused IPC tests, and an
  Electron smoke when behavior crosses the preload boundary.
- Native component changes: rebuild `teleno_node` and run focused CTest suites.
- Backup, restore, packaging, producer, storage, P2P, JSON-RPC, or gRPC changes:
  add the relevant smoke, parity, package, or live-validation script.
- Documentation changes: run `mkdocs build --strict`; run `npm run build` when
  the generated manual is part of the app build being validated.

Do not run live mainnet or producer-mutating scripts without a fresh explicit
user request and a reviewed plan.

## Development Safety

- The first-run assistant must not open during normal Vite or Electron
  development runs.
- GUI copy changes must update
  [`src/i18n.ts`](https://github.com/koinos/koinos-one/blob/main/src/i18n.ts)
  for English and Spanish.
- GUI layout changes must be inspected visually and checked for box overflow.
- Restore and producer workflows must remain observer-first unless explicitly
  and safely activated.
