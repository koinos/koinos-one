# App State And Native Bridge

Koinos One keeps user-facing state in the renderer and privileged state in the
Electron main process.

## Renderer State

[`src/App.tsx`](https://github.com/pgarciagon/koinos-one/blob/main/src/App.tsx)
owns:

- active tab and subtab state;
- language and settings drafts;
- node settings and runtime status;
- dashboard polling state;
- backup progress and restore state;
- wallet and producer view state;
- error banners, modal state, and form validation state.

Renderer helpers under
[`src/app/`](https://github.com/pgarciagon/koinos-one/tree/main/src/app)
normalize settings, parse config fields, format values, filter logs, inspect
producer readiness, and resolve RPC URLs.

## Bridge Access

The renderer reaches native behavior through bridge helpers such as:

- `getAppConfigBridge()`
- `getTelenoNodeBridge()`
- `getWalletBridge()`

These helpers read the `window.teleno` API exposed by
[`electron/preload.ts`](https://github.com/pgarciagon/koinos-one/blob/main/electron/preload.ts).
Vite/browser-only runs may not have Electron bridges available, so UI code
must handle missing bridges gracefully.

Missing bridges should degrade to disabled actions, explanatory status, or
browser-safe fallbacks. They should not trigger first-run setup or native
side-effects during a plain Vite development run.

## IPC Registration

[`electron/lib/ipc-handlers.ts`](https://github.com/pgarciagon/koinos-one/blob/main/electron/lib/ipc-handlers.ts)
registers the named IPC channels exposed by the preload bridge. Keep IPC names
explicit and stable. Add types in
[`electron/lib/main-types.ts`](https://github.com/pgarciagon/koinos-one/blob/main/electron/lib/main-types.ts)
and
[`src/teleno-electron.d.ts`](https://github.com/pgarciagon/koinos-one/blob/main/src/teleno-electron.d.ts)
when a new bridge contract is added.

## Native Runtime Services

Runtime logic belongs in
[`electron/lib/`](https://github.com/pgarciagon/koinos-one/tree/main/electron/lib),
not in React components. Examples:

- `native-runtime-service.ts` starts, stops, restarts, and checks managed native
  services.
- `backup-service.ts` writes generated native backup config and runs backup
  actions.
- `wallet-service.ts` handles encrypted wallet data and signing workflows.
- `producer-service.ts` and `producer-keys.ts` inspect producer identity and
  registration inputs.

## Event Streams

Logs and backup progress use event channels exposed from preload:

- `teleno:node:logs-follow:event`
- `teleno:node:backup-progress:event`

Renderer code should subscribe and unsubscribe cleanly so modals and panels do
not leak listeners.

## Native Backup Flow

Backup and restore UI actions use the bridge to reach Electron backup services.
Electron writes generated native backup config, chooses admin API or CLI
fallbacks, and passes operation progress back to the renderer. The native binary
owns checkpointing, repository manifests, SFTP transfer, public bootstrap
fetching, restore staging, and restore activation.

The renderer should present source, backup ID, BASEDIR, preflight output, and
observer-first restore consequences clearly. It should not manipulate live
RocksDB directories directly.

## Adding State

Before adding new top-level `App.tsx` state, check whether the data is:

- purely presentational and can stay inside a panel;
- shared renderer state that belongs in `App.tsx`;
- persisted preference/config state that belongs behind Electron storage;
- privileged runtime state that belongs in
  [`electron/lib/`](https://github.com/pgarciagon/koinos-one/tree/main/electron/lib);
- native state that belongs in `teleno_node`.

Prefer the narrowest ownership that still keeps the workflow clear.
