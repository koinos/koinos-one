<!-- This file is generated from ../../CHANGELOG.md by scripts/sync-manual-changelog.js. -->

# Changelog

All notable changes to this project are documented in this file.


<a id="unreleased"></a>
## Unreleased


<a id="version-1.0.2"></a>
<a id="v1.0.2"></a>
## [1.0.2] - 2026-07-01

### Added

- Added a Documentation tab in Koinos One with the initial manual structure for
  Koinos concepts, the Koinos One user guide, the `teleno_node` CLI guide,
  developer documentation, and reference material.
- Added MkDocs static documentation rendering inside the Documentation tab.
- Added the project changelog to the local rendered Documentation manual, with
  stable anchors for each released version.
- Added footer-version navigation so clicking the version badge opens the
  Documentation tab at the matching local changelog entry.
- Added macOS menu bar background mode, enabled by default on macOS and
  configurable from Settings.
- Added a macOS template Koinos cube tray icon, sanitized status menu, and
  menu actions to show Koinos One, stop the managed node, and quit safely.
- Added menu-bar-only hidden-window behavior on macOS: while backgrounded, the
  Dock icon is hidden and is restored when the app window is shown.
- Added first-run assistant refinements for the welcome, data-folder, public
  backup restore, progress, and previous-step flows.

### Changed

- Updated Settings copy to explain that background mode hides both the window
  and Dock icon while managed node services can continue from the menu bar.
- Updated release documentation so creating a release requires a version bump,
  changelog update, and rendered manual changelog entry.
- Improved the first-run assistant by keeping testnet setup out of the default
  first-install path and making public backup restore terminology consistent.

### Fixed

- Fixed MkDocs side-navigation links opening the Koinos One app recursively
  inside the Documentation tab.
- Improved the Documentation tab layout so rendered MkDocs pages use more of
  the app window and center better on wide screens.
- Fixed the macOS tray asset so it is a transparent template mark instead of a
  filled square in the upper-right menu bar.
- Fixed first-run restore visibility so the assistant can reuse the same
  restore progress surface as the main app.


<a id="version-1.0.1"></a>
<a id="v1.0.1"></a>
## [1.0.1] - 2026-06-30

### Added

- Added native restore staging progress so public bootstrap restores report live file and byte progress after download.
- Added a safe **Stop restore** action for in-progress backup restores. Cancelled restores preserve staging data and do not activate a partial database.
- Added recovery handling for stale `restore-staging.partial` directories. A retry can clear only the stale staging folder and keeps the node database, config, wallet data, and producer data untouched.
- Added disabled-control tooltips in the Node and Wallet screens so operators can see why an action is unavailable.

### Changed

- Improved the simple backup restore UI with clearer phases, realistic progress text, safer cancelled-state handling, and readable failure messages.
- Simplified wallet recovery visibility so import, create, and delete recovery actions appear only after an unlock attempt fails.
- Refined Settings and backup path copy to make the selected Base Data Folder the default source for local backup paths.

### Fixed

- Fixed restore progress that could appear stalled at the end of download while native staging continued.
- Fixed restore cancellation being treated as an error in the renderer.
- Fixed backup helper commands being detected as an external `teleno_node` process conflict.
- Fixed low-contrast wallet warning text and several disabled wallet button states.
- Fixed release build metadata so a clean source tree is reported as clean instead of unknown.


<a id="version-0.10.1"></a>
<a id="v0.10.1"></a>
## [0.10.1] - 2026-03-29

### Added

- Auto-enable `verify-blocks` on merkle mismatch: when chain stalls with `verify-blocks: false`, it is automatically enabled and chain restarted.
- Auto-disable `verify-blocks` when chain catches up (gap ≤ 50 blocks) for performance.
- P2P auto-restart when 0 peers detected during sync gap (after 2 consecutive checks).
- Smart wallet RPC selection: wallet uses local node only when synced, falls back to public RPC otherwise.
- Copy address button next to the wallet account selector.
- Tokens/Security subtab navigation restored in the wallet panel.
- Wallet command result text box restored (shows transaction output).

### Changed

- Compact wallet portfolio card (max-width 420px) with Send/Burn buttons inside.
- Reduced chain stall detection threshold from 3 to 2 checks (~2 min instead of 3 min).

### Fixed

- Fixed auto-restart timer never firing: the 60s `setInterval` was destroyed and recreated every 3s by React due to frequently-changing useEffect dependencies. Moved reactive values to refs.
- Fixed auto-restart state (stall count, peer count) resetting on every React re-render by using `useRef`.
- Fixed wallet balance not updating after transactions when local node is behind (now queries the same RPC used for the transaction).


<a id="version-0.9.0"></a>
<a id="v0.9.0"></a>
## [0.9.0] - 2026-03-11

### Added

- Added a new `Dashboard` tab with `Producers`, `Peers`, and `Forecast` subtabs for live node visibility.
- Added configurable dashboard producer window and refresh intervals in Settings.
- Added a redesigned wallet workflow with empty, locked, and unlocked states.
- Added wallet creation from a generated seed phrase by default, plus import flows for both seed phrase and WIF.
- Added wallet secret viewing with `Show secrets`, including seed phrase, first account, WIF, and key path when available.
- Added wallet session controls for closing and deleting the stored wallet.
- Added free mana support for send and burn operations, aligned with the koinos-wallet and Kondor flow.
- Added a simplified producer setup flow centered on registering the local producer key to the wallet address.
- Added producer deletion/unlink support and recent produced-block tracking for the configured producer only.
- Added a shared panel refactor with dedicated React panel components and Vitest coverage for the new helpers.

### Changed

- Bumped the app from `v0.2.0` to `v0.9.0` as an almost-stable release.
- Extended the `block_producer` profile so it also brings up `jsonrpc` and `contract_meta_store`.
- Moved producer, wallet, and dashboard refresh behavior to asynchronous background polling to avoid blocking the UI.
- Reduced the Producer tab to the essential identity, balance, and latest-produced-block information.
- Simplified Wallet, Producer, Dashboard, and Microservices headers and footer presentation.
- Standardized modal behavior, copy, and visual styling across the application.

### Fixed

- Fixed producer overview failures caused by local and public RPC timeouts by improving fallback behavior.
- Fixed producer setup hint flicker caused by transient wallet-balance loading states.
- Fixed the renderer black-screen crash caused by producer setup state initialization order.
- Fixed wallet balance refresh flicker and modal error visibility issues.
- Fixed multiple producer and wallet UI inconsistencies around button labels, modal layout, and state transitions.
