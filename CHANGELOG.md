# Changelog

All notable changes to this project are documented in this file.

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

- Bumped Knodel from `v0.2.0` to `v0.9.0` as an almost-stable release.
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
