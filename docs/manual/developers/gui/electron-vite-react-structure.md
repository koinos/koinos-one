# Electron, Vite, React, And TypeScript Structure

The desktop app has three JavaScript/TypeScript layers:

| Layer | Main files | Responsibility |
| --- | --- | --- |
| Renderer | `src/main.tsx`, `src/App.tsx`, `src/components/` | React UI, local UI state, polling, display formatting, and user interactions. |
| Preload | `electron/preload.ts` | Exposes a controlled `window.teleno` API to the renderer. |
| Main process | `electron/main.ts`, `electron/lib/` | Filesystem access, subprocesses, native node control, wallet actions, backup calls, and IPC handlers. |

## Renderer

`src/main.tsx` mounts `<App />` and imports `src/styles.css`. `src/App.tsx`
contains the top-level app state and routes between major tabs such as Explorer,
Dashboard, Node, Producer, Wallet, Documentation, and Settings.

Panel components live under `src/components/panels/`. Keep new screens in that
area unless they are shared helpers. Utility code for normalization, network
data, producer readiness, log filtering, chain sync, public bootstrap defaults,
and settings conversion belongs under `src/app/`.

## Preload Bridge

`electron/preload.ts` exposes `window.teleno` through Electron
`contextBridge`. It wraps IPC calls for app lifecycle, app config, remote nodes,
native node actions, logs, backup progress, and wallet actions.

The renderer should call the bridge through helper functions in `src/app/utils`
instead of directly depending on Electron APIs.

## Main Process

`electron/main.ts` composes services from `electron/lib/` and registers IPC
handlers through `registerTelenoIpcHandlers`.

Important service areas include:

- native runtime and process supervision;
- node path and basedir handling;
- backup configuration and native backup actions;
- wallet storage and signing workflows;
- producer profile and key lookup;
- logs, build identity, packaging checks, and local app preferences.

## Build Outputs

`npm run build` produces the Vite renderer in `dist/` and the Electron main
process in `dist-electron/`. It also builds the manual site and generates app
build identity metadata. Packaging commands stage the native binary and assets
before invoking Electron Builder.

## Adding A New GUI Capability

When a new UI action needs privileged behavior:

1. Add or reuse a typed bridge contract in `src/teleno-electron.d.ts` and
   `electron/lib/main-types.ts`.
2. Expose the call in `electron/preload.ts`.
3. Register an explicit IPC handler in `electron/lib/ipc-handlers.ts`.
4. Implement privileged work in an `electron/lib/` service.
5. Call the bridge from renderer helpers or panel code.
6. Add English and Spanish copy in `src/i18n.ts`.
7. Add tests at the lowest layer that can catch the behavior.

Keep bridge names stable once UI code and tests depend on them.
