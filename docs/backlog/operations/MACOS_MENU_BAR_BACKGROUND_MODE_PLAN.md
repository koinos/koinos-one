# macOS Menu Bar Background Mode Plan

Status: implemented in code on 2026-07-01; packaged macOS directory build,
smoke launch, and macOS Accessibility status-item validation passed. Screenshot
capture and Computer Use inspection were attempted, but screenshots are still
limited by the current validation environment.

Implemented:

- macOS `Tray` status item service with a template PNG icon.
- Tray icon uses a transparent monochrome Koinos cube template mark, not a
  filled square or full-color app icon.
- Local app preference `keepRunningInMenuBar`, persisted in Electron userData.
- General Settings checkbox and helper copy in English and Spanish.
- Minimize-to-menu-bar behavior when background mode is enabled.
- While hidden in background mode, the Dock icon is hidden so Koinos One lives
  only in the upper-right macOS menu bar; showing the window restores the Dock
  icon.
- Close-to-menu-bar prompt with `keep running`, `stop and quit`, and `cancel`
  when managed node services, producer mode, or backup/restore activity matter.
- Ordered quit still uses the managed shutdown flow.
- Active backup/restore quit path requires explicit cancellation before quit.
- Sanitized tray status for node and producer state; no BASEDIR, RPC URL,
  producer address, wallet data, key, token, or log text is shown.
- Tray actions for showing the app, stopping the managed node, and quitting.
- First-run setup is not silently hidden on window close.

Validation so far:

- `npm run build:electron`
- `npm run build:renderer`
- `npx vitest run electron/lib/app-lifecycle-service.test.ts electron/lib/menu-bar-service.test.ts electron/lib/teleno-storage.test.ts electron/lib/ipc-handlers.test.ts`
  - 30 focused tests passed.
- `npm run build`
- `npm test`
  - 301 tests passed after adding Dock hide/show coverage.
- `npm run package:mac:dir`
- Local unsigned DMG generated and verified:
  `release/KoinosOne-1.0.1-arm64.dmg`
- Packaged `app.asar` contains `assets/branding/trayTemplate.png`.
- Packaged app smoke launch:
  `release/mac-arm64/KoinosOne.app/Contents/MacOS/KoinosOne`
- Packaged app smoke launch with an isolated Electron user data directory.
- macOS Accessibility validation against the packaged app found a `status menu`
  for the Koinos One process with non-zero status item size.
- The packaged status menu exposed sanitized items:
  `Node: stopped`, `Producer: stopped`, `Show Koinos One`, `Stop node`,
  `Quit Koinos One`.
- Selecting `Quit Koinos One` from the status menu closed the packaged app and
  left no Koinos One process running.
- Computer Use was attempted three times against the packaged app, but
  Accessibility/Screen Recording permissions remained pending, so the screen
  state could not be inspected.
- No node, producer, wallet, backup, restore, or chain-mutating action was
  performed during packaged validation.

Optional follow-up validation:

- Capture screenshots of the menu bar item if the validation environment allows
  it without exposing private data.
- Light/dark menu bar rendering can still be checked manually on a normal
  macOS desktop session; the implementation uses a macOS template image and
  calls `setTemplateImage(true)`.

## Goal

Allow Koinos One to keep running as a macOS menu bar status item when the main
window is minimized or closed, so an operator can leave a managed node running
without keeping the full app window visible.

The long-term product goal includes producer nodes, not only observers. A
producer that was explicitly configured and started by the operator should be
able to remain running while Koinos One is minimized to the menu bar. The menu
bar feature must not activate production by itself; it only preserves and
controls the running state the operator already chose.

On macOS this should appear as a small Koinos One icon in the top-right menu
bar, near other always-running processes. The app must still make shutdown
behavior explicit and safe.

## Product Contract

- When enabled, minimizing the main window hides it and leaves Koinos One
  available from the macOS menu bar.
- While the main window is hidden by background mode, Koinos One should not
  remain visible in the Dock. The Dock icon should return when the app window is
  shown again.
- Closing the main window while node services are running should not silently
  stop the node. It should offer a clear choice:
  - keep running in the menu bar;
  - stop the node and quit;
  - cancel.
- The same close/minimize behavior must work for observer nodes and explicitly
  configured producer nodes.
- `Cmd+Q`, `Quit` from the app menu, and `Quit` from the menu bar item should
  continue to use the ordered shutdown flow that stops managed services before
  quitting.
- A visible menu bar item should provide at least:
  - `Show Koinos One`;
  - current node state summary, read-only;
  - `Stop node` when a managed node is running;
  - `Quit Koinos One`.
- The feature must not start, stop, register, fund, or activate a producer
  without an explicit user action.
- If a producer is already running, the close dialog and menu status should make
  that clear enough that the operator understands block production can continue
  while the window is hidden.
- Background mode must preserve the existing mainnet safety guardrails and state
  merkle recovery guardrails.

## Implementation Plan

### 1. Electron Status Item Service

Add a small Electron service, for example
`electron/lib/menu-bar-service.ts`, owned by the main process.

Responsibilities:

- Create an Electron `Tray` only on macOS for the first implementation.
- Use a template-style monochrome icon so macOS can render it correctly in
  light and dark menu bar modes.
- Keep a strong reference to the `Tray` instance for the app lifetime.
- Rebuild the context menu whenever node status or settings change.
- Route `Show Koinos One` to the existing `BrowserWindow` creation/show path.
- Route `Quit Koinos One` through the existing ordered shutdown path.

Asset work:

- Add a small menu bar icon derived from the existing Koinos One branding, for
  example `assets/branding/trayTemplate.png`.
- Prefer a simple monochrome mark, not the full logo text.
- Verify light mode, dark mode, Retina scaling, and packaged app paths.

### 2. Lifecycle Behavior

Extend `electron/lib/app-lifecycle-service.ts`, because it already owns window
creation, close handling, and ordered shutdown.

Expected behavior:

- On `minimize`, hide the window when menu bar background mode is enabled.
- On window `close`, distinguish between:
  - app quit requested by `Cmd+Q` or explicit quit;
  - ordinary window close while background mode is enabled.
- If ordinary close happens while managed node services are running, show a
  native dialog with the choices described in the product contract.
- If the user chooses background mode, call `win.hide()` and keep the app alive.
- If the user chooses quit, run the existing `requestOrderedAppShutdown`.
- Keep `window-all-closed` behavior compatible with macOS conventions: do not
  quit on macOS while the tray/status item is active.

Dock behavior:

- Hide the Dock icon when the window is hidden to the menu bar.
- Restore the Dock icon before showing/focusing the main window.
- Keep this tied to the existing background-mode preference so non-expert users
  have one clear setting.

### 3. Settings And Persistence

Add a local app preference for background mode.

Suggested setting:

- `keepRunningInMenuBar`: boolean

Storage:

- Store it in the local Electron app userData area through the existing storage
  pattern.
- Do not store secrets.
- Keep the default conservative for the first implementation. A good default is
  to enable the menu bar icon on macOS but still ask the first time a close
  would leave node services running.

GUI:

- Add a setting in the General settings panel:
  `Keep Koinos One running in the menu bar when the window is closed`
- Add English and Spanish copy in `src/i18n.ts`.
- Add tooltip/helper text that explains the node can keep running after the
  window is hidden and that `Quit` still performs an ordered shutdown.

IPC:

- Add app settings IPC methods if the current settings bridge is not enough:
  - load menu bar/background settings;
  - save menu bar/background settings;
  - show main window;
  - request ordered quit, if needed by menu actions.

### 4. Node State In The Menu

The menu bar item should show a simple, sanitized status summary.

Examples:

- `Node: stopped`
- `Node: running`
- `Producer: running`
- `Node: syncing`
- `Node: unsafe`
- `Node: unknown`

Implementation notes:

- Reuse existing `telenoNodeStatus` and component health derivation.
- Do not poll aggressively. Start with a low-frequency refresh or refresh on
  renderer/status events.
- Do not expose private paths, RPC URLs, producer addresses, wallet data, or
  logs in the menu.
- If block production is enabled, show only a sanitized producer state such as
  `Producer: running` or `Producer: stopped`; do not show the producer address
  unless a future privacy review explicitly allows it.
- `Stop node` must call the existing managed stop path and report failure using
  a native dialog or by showing the main window with the error visible.

### 5. Safety And Edge Cases

Handle these cases explicitly:

- A restore or backup is active: close/minimize may hide the window, but quit
  should warn that an operation is active and require confirmation.
- A producer is active: close/minimize may keep it running only after the user
  has enough context to understand that block production continues in the
  background.
- First-run assistant is active: do not hide the window in a way that strands a
  new user. Prefer normal close/cancel behavior during first-run setup.
- App starts without a window because it was launched as a login item later:
  create the tray/status item first and show the main window on click.
- Renderer crash: the tray menu should still allow showing/recreating the
  window or quitting safely.
- Multiple windows are not currently part of the product surface; keep the
  implementation single-window.
- Windows/Linux tray behavior is out of scope for the first pass, but the
  service can be written so cross-platform support can be added later.

### 6. Tests

Add focused Electron-side tests where practical:

- Menu bar service creates no tray on non-macOS platforms for the first pass.
- Close behavior hides the window when background mode is enabled and quit is
  not explicitly requested.
- Explicit quit still calls ordered shutdown.
- Running node close prompt offers keep-running, stop-and-quit, and cancel.
- Menu labels are sanitized and do not include BASEDIR, RPC URLs, producer
  addresses, wallet data, or secrets.
- Settings persistence round-trips `keepRunningInMenuBar`.

Manual validation:

- Packaged macOS app shows a menu bar icon.
- Menu bar icon works in light and dark macOS menu bars.
- Minimize hides the window and leaves the node running.
- Explicitly configured producer mode can remain running in the background with
  sanitized menu status.
- Clicking `Show Koinos One` restores and focuses the window.
- Closing the window while a node is running offers the safe choices.
- `Cmd+Q` stops managed services before quitting.
- No unexpected producer or chain-mutating action is triggered.

## Acceptance Criteria

- Koinos One can run from a macOS menu bar status item while the main window is
  hidden.
- The window can be restored from the menu bar item.
- Closing the window does not silently stop a running managed node.
- Producer nodes are supported as a first-class background-running use case
  after explicit producer setup.
- Explicit quit still follows ordered managed-node shutdown.
- The menu shows only sanitized state.
- The feature has English and Spanish GUI copy.
- Existing first-run, backup/restore, and node shutdown safety behavior is not
  weakened.
- Tests and packaged macOS validation pass, or any remaining failures are
  documented with evidence.
