# koinosGUI Two-Repository App Plan

Last updated: 2026-06-03

## Decision

The monolithic desktop implementation will become a separate app, separate codebase, and separate repository named `koinosGUI`.

`Knodel` remains the microservice desktop app. It should manage the legacy/native Koinos microservice stack and should not silently switch into monolith mode.

`koinosGUI` becomes the monolithic desktop app. It should be copied from Knodel first so the user experience remains the same, then changed only where needed for product identity, repository identity, app storage, packaging, and monolith-only runtime behavior.

## Implementation Status

First local split started on 2026-06-03.

- Created `/Users/pgarcgo/code/koinosgui` as an independent Git repository cloned from the current Knodel repository and overlaid with the current working-tree monolith state.
- Renamed the copied repository remote from `origin` to `source-knodel` so the source remains auditable without pretending that the new repository already has its final GitHub remote.
- Updated `koinosGUI` repository identity: package name, product name, app ID, README, workspace file, and project memory.
- Set `koinosGUI` to monolith-only runtime behavior and removed microservice fallback after monolith startup failure.
- Set `koinosGUI` default local basedir and renderer/Electron settings keys to `koinosgui`-scoped values.
- Set Knodel to microservice-only runtime behavior by making monolith mode unavailable and routing native build controls to microservice build actions.
- Deferred package-resource pruning and broad internal `Knodel*` renaming until after side-by-side build/package smoke validation.

## Goals

- Maintain two independent repositories:
  - `knodel`: microservice app.
  - `koinosgui` / `koinosGUI`: monolithic app.
- Keep both apps installable and runnable side by side.
- Keep the `koinosGUI` UI and workflows as close as possible to Knodel.
- Keep first implementation low-churn by copying the current Electron app and then applying targeted changes.
- Make runtime mode explicit in each repository:
  - Knodel: microservices only.
  - `koinosGUI`: monolith only.
- Split persistent application state so wallets, producer profiles, public RPC config, node settings, and UI preferences do not collide.
- Preserve Koinos protocol compatibility and all validated monolith behavior.

## Non-Goals

- Do not maintain a single shared app variant system.
- Do not make Knodel a launcher for `koinosGUI`.
- Do not rewrite the UI.
- Do not change Koinos protocol behavior, JSON-RPC/gRPC compatibility, block production, P2P, storage format, or migration semantics.
- Do not rename every internal `Knodel*` TypeScript type in the first `koinosGUI` import unless required for correctness or user-facing clarity.
- Do not aggressively prune package resources in the first split if that adds risk; package pruning can follow after both apps are independently validated.

## Repository Model

| Repository | Product | Runtime | Purpose |
|---|---|---|---|
| `knodel` | `Knodel` | Microservices only | User-facing app for legacy/native Koinos microservice operation. |
| `koinosgui` or `koinosGUI` | `koinosGUI` | Monolith only | User-facing app for the optimized single-process monolithic Koinos node. |

Recommended remote slug: `koinosgui`, because lowercase repository names are easier for scripts, packaging, and release URLs. Product text should remain `koinosGUI`.

## Product Identity

| Surface | Knodel repo | koinosGUI repo |
|---|---|---|
| Product name | `Knodel` | `koinosGUI` |
| Package name | `knodel` | `koinosgui` |
| macOS app name | `Knodel.app` | `koinosGUI.app` |
| Suggested app ID | `io.knodel.desktop` | `io.koinosgui.desktop` |
| Runtime role | Microservice node app | Monolithic node app |
| Default app data | Knodel Electron data path | `koinosGUI` Electron data path |
| Default node basedir | Existing Knodel default | Separate monolith-safe default |

The app ID can be adjusted before signing/notarization if the final publisher namespace requires `io.knodel.koinosgui`, but the two apps must not share one app ID.

## Split Strategy

The first split should use a controlled copy, not a rewrite.

1. Create the new `koinosGUI` repository from the current Knodel repository state.
2. Keep enough history to audit the origin of the code and monolith validation work.
3. In the Knodel repository, remove or disable monolith-first behavior so Knodel is microservice-only.
4. In the `koinosGUI` repository, remove or disable microservice fallback so `koinosGUI` is monolith-only.
5. Keep UI structure, panels, wallet flows, dashboard, backup/restore, explorer, and producer workflows the same unless a visible runtime label must change.
6. Optimize and prune each repository only after both apps pass independent packaging and runtime smokes.

## Runtime Rules

### Knodel Repository

- Always uses the microservice runtime.
- Shows and manages individual services.
- Uses GarageMQ/native microservice binaries as the primary local runtime.
- Does not auto-detect `koinos_node` and switch into monolith mode.
- If monolith resources remain in the repository temporarily, they should not affect runtime behavior.
- Longer-term cleanup can remove monolith-specific UI, scripts, and package resources after the microservice-only release is stable.

### koinosGUI Repository

- Always uses the monolith runtime.
- Starts, stops, restarts, and monitors one `koinos_node` process.
- Shows component health derived from monolith logs and status.
- Does not fall back to microservices on monolith startup failure.
- On startup failure, reports the missing binary/config/error clearly.
- Longer-term cleanup can remove GarageMQ and individual microservice management code after the monolith-only release is stable.

## Persistent State Isolation

The apps must not share Electron `userData`. This prevents accidental wallet/profile/config collisions and allows both apps to be installed side by side.

Required separation:

- wallet vault files
- producer profile files
- public RPC config
- language/UI settings
- node manager settings
- log-follow state
- backup/restore temporary app metadata

The default Koinos basedir should also be separate for `koinosGUI`. The first safe default should be explicit and monolith-specific, for example:

- Knodel: current default behavior.
- `koinosGUI`: `~/.koinosgui` or `~/.koinos-gui`.

Existing manually selected basedirs should still be allowed, but the UI should warn before using a basedir that appears to be actively owned by the other app.

## Minimal UI Changes

The renderer should stay structurally the same in both repositories.

Required user-facing differences:

- App title and version text use the product name from that repository.
- Footer/performance labels use `Knodel` or `koinosGUI` correctly.
- Knodel keeps `Microservices` wording.
- `koinosGUI` should use `Node`, `Components`, or `Runtime` wording where the current UI says `Microservices`.
- Runtime descriptions become repository-specific:
  - Knodel: local microservice runtime.
  - `koinosGUI`: local monolithic runtime.
- Service actions in `koinosGUI` should describe `koinos_node` as one process with components, not as separate microservices.

The component layout, dashboard, wallet, producer panel, explorer, backup/restore, config editor, and logs UI should remain as close as possible between the two apps.

## Implementation Phases

### Phase 1: Create the koinosGUI Repository

Exit criteria:

- A new repository exists for `koinosGUI`.
- The repository builds from the copied Knodel code.
- Remote name, README, package name, product name, workspace file, and basic docs identify it as `koinosGUI`.
- Git history or an import tag preserves traceability to the source Knodel revision.

Recommended steps:

1. Choose the source commit from `knodel`.
2. Create the `koinosGUI` repository from that commit.
3. Update repository-level identity:
   - `package.json`
   - `package-lock.json`
   - `README.md`
   - workspace/project files
   - top-level project memory/docs
4. Keep submodule pointers identical initially.

### Phase 2: Make Knodel Microservice-Only

Exit criteria:

- Knodel never enters monolith mode.
- Knodel startup/status/manage actions use the microservice runtime.
- Existing microservice service management remains intact.
- Knodel packaging and package verification target microservice resources.

Primary files:

- `electron/main.ts`
- `electron/lib/constants.ts`
- `electron/lib/native-runtime-service.ts`
- `electron/lib/native-build-service.ts`
- `scripts/stage-bundle.js`
- `scripts/verify-package-staging.js`
- `scripts/verify-packaged-app.js`
- runtime selection tests

### Phase 3: Make koinosGUI Monolith-Only

Exit criteria:

- `koinosGUI` never enters microservice mode.
- `koinosGUI` does not fall back to microservices if `koinos_node` fails.
- Status shows one managed `koinos_node` process plus monolith components.
- Component toggles and presets write monolith `features.*` config.
- Monolith build/status actions remain available.

Primary files:

- `electron/main.ts`
- `electron/lib/constants.ts`
- `electron/lib/native-runtime-service.ts`
- `electron/lib/native-build-service.ts`
- `electron/lib/logs-service.ts`
- `electron/lib/producer-service.ts`
- runtime selection tests

### Phase 4: Split Storage and Defaults

Exit criteria:

- Knodel and `koinosGUI` use different Electron `userData` paths.
- Wallets and producer profiles are isolated.
- `koinosGUI` has a separate default basedir.
- Existing Knodel data is not migrated or modified automatically by `koinosGUI`.

Primary files:

- `electron/main.ts`
- `electron/lib/knodel-storage.ts`
- `electron/lib/constants.ts`
- `src/app/constants.ts`
- storage tests

### Phase 5: Product and UI Copy

Exit criteria:

- `koinosGUI` has correct visible product identity.
- Knodel keeps microservice terminology.
- `koinosGUI` avoids calling the monolith a microservice stack.
- Internal type names can remain unchanged where they are not user-facing.

Primary files:

- `src/i18n.ts`
- `src/App.tsx`
- `src/components/panels/*`
- `src/app/utils.tsx`
- renderer tests

### Phase 6: Packaging and Side-by-Side Validation

Exit criteria:

- Knodel produces `Knodel.app`.
- `koinosGUI` produces `koinosGUI.app`.
- Both apps pass package verification.
- Both apps can be installed and launched side by side.
- Knodel status shows microservices only.
- `koinosGUI` status shows monolith only.

Primary files:

- `electron-builder.yml`
- `package.json`
- `scripts/stage-bundle.js`
- `scripts/verify-package-staging.js`
- `scripts/verify-packaged-app.js`

### Phase 7: Repository Cleanup

Exit criteria:

- Knodel no longer carries active monolith-only docs or package checks unless deliberately retained as historical references.
- `koinosGUI` no longer carries active microservice-only docs or package checks unless deliberately retained as compatibility references.
- Roadmaps and release docs clearly identify which repository owns which runtime.
- Shared upstream Koinos submodule work remains traceable.

Cleanup should happen after the first side-by-side release smoke, not before, to avoid destabilizing the split.

## Validation Matrix

| Check | Knodel repo | koinosGUI repo |
|---|---|---|
| TypeScript build | Required | Required |
| Renderer build | Required | Required |
| Runtime status | Microservices only | Monolith only |
| Start action | Starts native services | Starts `koinos_node` |
| Stop action | Stops managed services | Stops `koinos_node` |
| Fallback behavior | No monolith fallback | No microservice fallback |
| User data | Knodel path | `koinosGUI` path |
| Default basedir | Existing default | Separate monolith default |
| Package artifact | `Knodel.app` | `koinosGUI.app` |
| Package app ID | `io.knodel.desktop` | distinct app ID |
| Wallet/profile collision | Must not collide | Must not collide |

## Recommended Test Commands

The exact scripts may diverge between repositories, but the intended checks are:

```sh
npm run build
npm run test
npm run package:mac:dir
```

Then run manual or scripted app smokes:

- Launch `Knodel.app`; verify it reports microservice runtime and never starts `koinos_node`.
- Launch `koinosGUI.app`; verify it reports monolith runtime and never starts GarageMQ or individual microservices.
- Confirm both apps have separate Electron data directories.
- Confirm selecting a basedir in one app does not mutate the other app's stored settings.
- Confirm `koinosGUI` can start the bundled `koinos_node` and expose JSON-RPC.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Two repositories drift in common UI logic | Accept this as the cost of independent products; copy fixes deliberately only when needed. |
| Split loses traceability to monolith validation work | Create `koinosGUI` from a known Knodel commit and preserve import tags/history. |
| Accidental state sharing between apps | Use distinct app IDs, userData paths, settings keys, and default basedirs. |
| Too much rename churn delays the split | Keep internal `Knodel*` types and `window.knodel` IPC names in the first `koinosGUI` import if they are not user-facing. |
| Knodel silently using monolith because the binary exists | Make Knodel runtime microservice-only in code, not binary-detection-driven. |
| `koinosGUI` hiding monolith failures behind microservice fallback | Disable fallback and surface the real monolith error. |
| Package bloat in the first split | Accept shared resources for first signoff, then prune each repository separately. |

## Open Decisions

- Exact remote repository slug: `koinosgui` versus `koinosGUI`.
- Final `koinosGUI` app ID namespace: `io.koinosgui.desktop` versus `io.knodel.koinosgui`.
- Final default basedir spelling: `~/.koinosgui` versus `~/.koinos-gui`.
- Whether `koinosGUI` UI tab label should be `Node`, `Components`, or `Runtime`.
- Whether package pruning should happen before the first signed DMG or after side-by-side app validation.

## First Implementation Recommendation

Start by creating the `koinosGUI` repository from the current Knodel code, then make each repository runtime-specific with the smallest possible edits:

1. Create `koinosGUI` from the selected Knodel commit.
2. Update repository/product/package identity in `koinosGUI`.
3. Make Knodel microservice-only.
4. Make `koinosGUI` monolith-only.
5. Isolate `koinosGUI` userData and default basedir.
6. Update only visible product/runtime labels.
7. Package and smoke both apps side by side.
8. Prune each repository only after the split is proven.

This gives two independent codebases and repositories while preserving the current Knodel user experience as the baseline for `koinosGUI`.
