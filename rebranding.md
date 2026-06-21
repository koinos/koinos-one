# Koinos One Rebranding Strategy

Last updated: 2026-06-21

## Summary

The product should be branded as **Koinos One** for end users, while the native node engine remains **Teleno Node** with the CLI binary name `teleno_node`.

This gives the project two clear distribution surfaces:

- **Koinos One**: the user-friendly Mac GUI app, distributed first as a downloadable `.dmg`.
- **Teleno Node**: the standalone high-performance monolithic node engine, installable through CLI on Linux servers and macOS, and later through Docker.

The immediate goal is not a full repository or package migration. The visual/product rebrand is now implemented in the working tree, while the broader package identity and GitHub strategy remain intentionally deferred until the Mac DMG and Linux/Docker install story are stable.

## Final Naming Architecture

| Surface | Name | Purpose |
| --- | --- | --- |
| Public GUI app | Koinos One | Main user-facing desktop app |
| Mac installer | Koinos One for Mac | Downloadable DMG for normal users |
| Native engine | Teleno Node | Monolithic Koinos node implementation |
| CLI binary | `teleno_node` | Stable command-line executable |
| Source path | `node/teleno-node/` | Native C++ node source |
| App tagline | A high-performance monolithic Koinos node implementation. | Brand/subtitle text |

Do not rename `teleno_node` to `koinos_node`. The latter can be confused with upstream or official protocol node software. `teleno_node` should remain the stable CLI/server binary name.

## Product Positioning

Koinos One exists to make running Koinos dramatically easier.

The core message:

> Koinos One is a high-performance monolithic Koinos node implementation, packaged as an easy-to-install desktop app.

The user-facing mission:

- Make it easy for Mac users to install and run a node.
- Make block production easier for non-expert operators.
- Help increase Koinos network decentralization.
- Hide Docker/microservice complexity from normal users.
- Keep a serious CLI/server path for Linux operators.

## Visual Identity

The rebrand uses the official Koinos media-kit logo as the base identity.

Current visual direction:

- Preserve the official Koinos mark and wordmark geometry.
- Add `ONE` as a product-layer modifier next to the Koinos wordmark.
- Use the Koinos purple identity color.
- Use a small `1` badge for the app icon to distinguish Koinos One without replacing the Koinos mark.

Current subtitle:

```text
A high-performance monolithic Koinos node implementation.
```

This subtitle should be used consistently in the app header, README, release pages, and website/download copy.

## Current Implementation Result

Status: implemented in the working tree, not yet treated as a full package/repository migration.

Already done:

- App header brand changed to **Koinos One**.
- Official Koinos media-kit geometry is now the base for the app logo and icon assets.
- `ONE` is added as a product-layer modifier next to the Koinos wordmark.
- The app icon uses the Koinos purple mark with a small `1` badge to distinguish Koinos One.
- Logo/icon SVG and PNG assets were regenerated under `assets/newbranding/`.
- Mac packaging icon source assets were updated under `assets/branding/`.
- README now introduces the project as Koinos One powered by the Teleno native node engine.
- UI strings now use Koinos One for the public app name.
- Electron smoke test expectation updated to `Koinos One`.
- The visible subtitle was changed to:

```text
A high-performance monolithic Koinos node implementation.
```

Validation already performed after the rebrand:

- `npm run build`
- `TELENO_PLAYWRIGHT_ELECTRON=1 npx playwright test --config=playwright.electron.config.ts tests/ui/electron-smoke.spec.ts`
- `git diff --check`
- Renderer screenshot verification using local Chrome against `http://127.0.0.1:5173/`
- Development Electron app launched successfully with the rebranded UI.

Intentionally unchanged:

- `teleno_node` binary name.
- `node/teleno-node/` source path.
- Internal TypeScript `Teleno*` types and bridge names.
- Existing storage/app support paths.
- Electron `appId` and packaged app bundle name.
- Release asset names and GitHub repository names.

These unchanged areas should be handled later only if we decide to do a full package migration.

## Current Branding Asset Map

The currently updated branding assets are:

```text
assets/newbranding/logo.svg
assets/newbranding/logo.png
assets/newbranding/icon.svg equivalents:
  icon-light.svg
  icon-dark.svg
  icon-mark.svg
assets/newbranding/icon.png
assets/newbranding/icon-light.png
assets/newbranding/icon-dark.png
assets/newbranding/icon-mark.png

assets/branding/icon.svg
assets/branding/icon.png
assets/branding/logo.png
assets/branding/icon.icns
assets/branding/icon.iconset/*
```

The first group is used by the app/README branding. The second group is used by Electron/macOS packaging resources.

The Windows `.ico` resource is not part of the completed first pass and should be revisited when Windows packaging becomes active.

## Distribution Strategy

### Koinos One GUI

Primary target:

```text
Koinos-One-<version>-mac-arm64.dmg
```

The DMG should be the simplest path for normal Mac users:

1. Download.
2. Install.
3. Launch Koinos One.
4. Restore/bootstrap from a public signed backup.
5. Run as observer or configure producer mode.

The GUI should remain the first-class product for non-technical users.

### Teleno Node CLI

CLI/server distribution should remain separate from the GUI artifact:

```text
teleno_node-<version>-macos-arm64.tar.gz
teleno_node-<version>-linux-x86_64.tar.gz
```

The CLI path should support:

- Linux server installs.
- macOS terminal installs.
- Docker image usage.
- Headless producer or observer operation.
- Native backup/restore commands.
- Public bootstrap restore commands.

The CLI documentation should clearly say:

> `teleno_node` is the native monolithic node engine used by Koinos One.

## GitHub Strategy

Do not apply the final GitHub strategy yet.

The preferred future strategy is one official repository with two release artifact families:

```text
koinos/koinos-one
```

Release artifacts should eventually include:

```text
Koinos-One-<version>-mac-arm64.dmg
teleno_node-<version>-macos-arm64.tar.gz
teleno_node-<version>-linux-x86_64.tar.gz
checksums.txt
checksums.txt.sig
```

Docker image naming should eventually be:

```text
ghcr.io/koinos/koinos-one/teleno-node:<version>
ghcr.io/koinos/koinos-one/teleno-node:latest-beta
```

This should wait until:

- The Mac DMG install flow is stable.
- The Linux CLI install flow is stable.
- The Docker story is tested.
- Release scripts can publish both app and node artifacts consistently.

## Repository Layout Direction

Keep `node/teleno-node/`.

This path is still useful because it identifies the engine and avoids a noisy mechanical migration while Docker/Linux work is happening in parallel.

Long-term recommended structure:

```text
apps/
  desktop/                  # Koinos One GUI, future optional move

node/
  teleno-node/              # Teleno native node engine

packaging/
  mac/                      # DMG/app packaging
  linux/                    # CLI tarball/deb/rpm packaging
  docker/                   # Docker image build support

install/
  teleno-node.sh            # CLI/server installer

docs/
  users/                    # Koinos One Mac user docs
  operators/                # Teleno Node server/operator docs
```

Do not flatten `node/teleno-node/` right now.

## Migration Plan

### Phase 1: Current Rebrand

Status: visual/product rebrand implemented; pending commit and release packaging.

- Koinos One public branding has been applied in the app header, README, package description, translation strings, and smoke test expectations.
- Official Koinos-based SVG/PNG assets have replaced the previous custom Teleno mark for the public brand surface.
- Teleno Node binary/source naming has been kept.
- Current repo and branch strategy have been kept.
- App storage paths and app bundle identity have not been changed yet.
- Release packaging has not yet been renamed to a final Koinos One bundle identity.

### Phase 2: Mac Beta Packaging

- Decide whether the first beta DMG still uses the existing Electron package identity internally or performs the optional full app identity migration first.
- Produce unsigned and signed/notarized Mac DMG builds.
- Verify installed app can launch from `/Applications`.
- Verify public bootstrap restore from a clean user profile.
- Verify node start/stop, backup restore, and producer setup from the GUI.

### Phase 3: CLI/Linux Distribution

- Produce standalone Linux `teleno_node` artifact.
- Produce macOS CLI artifact.
- Finish Docker image build and smoke tests.
- Add install docs for Linux server, macOS CLI, and Docker.

### Phase 4: Official GitHub Release Strategy

- Decide whether to move/rename the repository to `koinos/koinos-one`.
- Add protected release branch/tag rules.
- Publish GUI DMG, CLI tarballs, Docker images, and checksums from CI.
- Keep redirects and compatibility docs for the old repository location.

### Phase 5: Optional Full App Identity Migration

Only after beta validation:

- Rename Electron `productName` from Teleno to Koinos One.
- Decide whether to change `appId`.
- Migrate user data paths carefully.
- Keep compatibility with existing Teleno user data.
- Update package verification scripts and app bundle tests.
- Decide whether existing developer shortcuts should stay named with `teleno` or gain new `koinos-one` aliases.

## Explicit Non-Goals For Now

- Do not rename `teleno_node`.
- Do not flatten `node/teleno-node/`.
- Do not migrate GitHub repositories yet.
- Do not change mainnet producer data or prodnet user data.
- Do not force a new app support directory until a migration plan exists.

## Recommended Public Copy

Short:

```text
Koinos One
A high-performance monolithic Koinos node implementation.
```

README:

```text
Koinos One is the Koinos Foundation desktop app for running, restoring, backing up, and producing with a native Koinos node. It is powered by the Teleno native node engine and manages the single teleno_node runtime.
```

CLI docs:

```text
Teleno Node is the high-performance monolithic Koinos node engine used by Koinos One. Use teleno_node for Linux server installs, macOS CLI operation, Docker deployments, backup management, and public bootstrap restore.
```
