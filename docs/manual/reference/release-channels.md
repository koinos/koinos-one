# Release Channels

Release identity must make every packaged Koinos One build traceable.

## Current Product Identity

| Field | Current source |
| --- | --- |
| Product name | `KoinosOne` in [`electron-builder.yml`](https://github.com/pgarciagon/koinos-one/blob/main/electron-builder.yml). |
| App ID | `io.koinosone.desktop` in [`electron-builder.yml`](https://github.com/pgarciagon/koinos-one/blob/main/electron-builder.yml). |
| Product version | `1.0.3` in [`package.json`](https://github.com/pgarciagon/koinos-one/blob/main/package.json). |
| Native binary | `teleno_node`. |
| Package artifacts | `${productName}-${version}-${arch}.${ext}` for macOS DMG and Windows NSIS outputs. |
| Static manual site | `build/docs/manual-site/` from `mkdocs build --strict`. |

## Build Info File

`npm run build` runs
[`scripts/generate-build-info.js`](https://github.com/pgarciagon/koinos-one/blob/main/scripts/generate-build-info.js),
and
[`electron-builder.yml`](https://github.com/pgarciagon/koinos-one/blob/main/electron-builder.yml)
includes the generated file as packaged `build-info.json`.

The generated schema currently includes:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Build-info schema version. |
| `productVersion` | Version read from [`package.json`](https://github.com/pgarciagon/koinos-one/blob/main/package.json). |
| `releaseChannel` | Explicit env override, prerelease-derived channel, or `dev`. |
| `buildTimestamp` | ISO timestamp generated at build time. |
| `gitCommit` | Full Git commit hash. |
| `gitShortCommit` | 12-character Git commit hash. |
| `gitBranch` | Current Git branch. |
| `gitDirty` | Whether `git status --porcelain` had changes. |
| `nativeNode.binaryName` | Native binary name, normally `teleno_node`. |
| `nativeNode.sha256` | SHA-256 of the staged native binary when available. |
| `nativeNode.shortSha256` | First 12 characters of the native binary SHA-256. |
| `nativeNode.sizeBytes` | Native binary size when available. |
| `nativeNode.mtime` | Native binary modification time when available. |

## Channel Resolution

| Case | Result |
| --- | --- |
| `KOINOS_ONE_RELEASE_CHANNEL` set | Uses that value. |
| `TELENO_RELEASE_CHANNEL` set and `KOINOS_ONE_RELEASE_CHANNEL` unset | Uses that value. |
| [`package.json`](https://github.com/pgarciagon/koinos-one/blob/main/package.json) version has a prerelease segment, such as `1.2.3-beta.1` | Uses the first prerelease token, such as `beta`. |
| No explicit channel and no prerelease segment | Uses `dev`. |

Use SemVer product versions. Canary, beta, and stable packaged builds should
carry unique build metadata and a traceable native node identity.

## Packaging Flow

| Command | Purpose |
| --- | --- |
| `npm run build` | Build docs, generate build info, build renderer, and build Electron main output. |
| `npm run stage` | Stage bundled native resources under `build/bundle-staging/teleno/`. |
| `npm run test:package-staging` | Verify staged resources, config, public bootstrap key, native binary, and expected backup CLI flags. |
| `npm run test:packaged` | Verify packaged app resources and native CLI surface after Electron Builder runs. |
| `npm run package:mac` | Build, stage, verify, package a notarized macOS DMG, and verify the packaged app. |
| `npm run package:mac:unsigned` | Build an unsigned macOS DMG for local development. |
| `npm run package:mac:dir` | Build an unpacked macOS app directory for local development. |
| `npm run package:win` | Build and package the Windows NSIS target. |

## Release Expectations

- The About/Build Info surface should be able to show product version, release
  channel, build timestamp, Git commit, and native node identity.
- Do not ship a native node build that diverges from Koinos protocol behavior.
- Validate producer, backup, restore, storage, and RPC changes according to
  their risk before publishing a release.
- Automatic update behavior is not documented yet in current source or manual
  docs.
