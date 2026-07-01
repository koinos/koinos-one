# GUI Packaging

Packaging combines the React renderer, Electron main process, assets, build
identity metadata, the generated manual site, and the bundled native
`teleno_node` binary.

## Build Identity

Every packaged app build must be traceable by:

- product version;
- build timestamp;
- Git commit;
- release channel;
- native node binary identity.

`npm run build` runs `scripts/generate-build-info.js` before building renderer
and Electron outputs. The app exposes build identity through the About/Build
Info surface.

## Main Commands

```bash
npm run build
npm run stage
npm run test:package-staging
npm run test:packaged
```

macOS packaging commands:

```bash
npm run package:mac
npm run package:mac:dir
npm run package:mac:unsigned
```

`package:mac` includes notarization preflight. Use unsigned or dir packaging for
local development when signing is not available.

## Staging Checks

`scripts/stage-bundle.js` stages bundle assets. `scripts/verify-package-staging.js`
and `scripts/verify-packaged-app.js` verify that required packaged artifacts are
present. Packaged verification also checks the shipped `teleno_node --help`
surface for expected native backup flags.

The build command also runs the strict MkDocs build. If documentation navigation
is broken, packaging should fail before an app artifact is produced.

## First-Run Packaging Rule

The first-run assistant should open only in packaged installation contexts when
Electron reports incomplete packaged setup state. It must not open in Vite
browser runs or normal Electron development runs.

## Release Notes And Changelog

When a user-facing feature changes, update the relevant changelog or release
notes in the same release track. The packaged app should be able to show the
exact product version, commit, release channel, build timestamp, and native node
identity for the build being tested.
