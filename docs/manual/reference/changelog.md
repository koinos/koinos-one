<!-- This file is generated from ../../CHANGELOG.md by scripts/sync-manual-changelog.js. -->

# Changelog

All notable changes to this project are documented in this file.


<a id="version-1.1.0-dev.0"></a>
<a id="v1.1.0-dev.0"></a>
## [1.1.0-dev.0] - Unreleased

### Added

- Settings > Build information now shows the native `teleno_node` version. The
  packaged build identity captures the binary's reported version (parsed from
  `teleno_node --version`) alongside its name and SHA-256.

- Aligned the native `teleno_node` semantic version with the app development
  track (0.1.0 -> 1.1.0). Native build identity remains
  `<version>+<git-commit>[-dirty]`.

- Added `koinos_state_delta_replay_audit`, an offline native binary that opens a
  restored unified block store read-only and validates historical receipt state
  delta Merkle roots without using peers or node services. The auditor now reports a live terminal
  progress bar with percentage, height, throughput, and ETA, and writes a
  persistent audit log file by default under the scratch state directory. It
  also builds a reusable local height index so full-history audits do not depend
  on expensive head-anchored block range traversal before visible replay
  progress starts. The auditor uses asynchronous writes for the rebuildable
  scratch state DB by default, avoiding a full disk sync per replayed block, and
  still offers `--sync-scratch-writes` for conservative durability testing. For
  the default replay path, it now builds a bucketed append-only flat-file
  header/receipt journal and computes each receipt delta Merkle root directly
  from the serialized entries, avoiding per-block random reads from the source
  block store, per-block random reads inside the journal, RocksDB journal
  compaction stalls, and a full scratch state DB rebuild while preserving
  parent-root and receipt-root validation. The older height-index/source-DB
  replay path remains available with `--state-db-replay`.

### Fixed

- Fixed a circular deadlock that could make a mainnet producer impossible to
  start: the start gate requires `block_producer.producer` in the runtime
  config, but the Producer tab told the user to start the node once to create
  the local producer key. The Producer tab now offers a "Create local producer
  key" action that writes the same WIF key file the node would create,
  unblocking registration and producer startup without starting the node
  first. Also fixed the Producer overview mislabeling a manually selected
  address as "runtime config" when the config did not actually contain it.

- Fixed several look-and-feel inconsistencies left over from an earlier dark
  theme: primary and danger buttons, Settings/Wallet form labels, wallet
  activity badges, error pills, and inline error text used light-on-light
  colors that were hard to read; footer status pills and the node runtime tag
  rendered as isolated dark chips inside the light UI; and the Explorer block
  detail dialog fell back to a dark navy card because its CSS variables were
  never defined. All of these now use the app's design tokens (assistant
  palette, system success/danger colors, soft shadows).

### Changed

- Added a Producer tab notice when recent blocks show the configured producer
  address is active on-chain but the local installation has not created or
  registered the matching producer key yet.
- Parallelized the state delta replay auditor's default journal replay: record
  decoding and per-block delta Merkle hashing now run on all CPU cores one
  journal bucket at a time, with only the cheap parent-root chain validation
  kept sequential. Journaled receipts are also pruned to the fields the audit
  consumes (id, height, state Merkle root, and state delta entries), shrinking
  the journal and speeding up bucket loads.
- Pipelined the state delta replay auditor's journal build: a reader thread
  streams the source block store with 16 MiB readahead while parser threads
  decode and encode records in parallel and the main thread writes bucket
  files, instead of doing scan, parse, encode, and write serially on one core.
- Progress rate and ETA for the auditor now use an exponentially smoothed
  recent-window throughput instead of the cumulative average, so ETA no longer
  grows without bound when early progress was faster than steady-state disk
  throughput.

### Fixed

- Fixed external source-code links in the Documentation tab so they open in the
  system browser instead of navigating the embedded manual iframe to a blank
  page.
- Hardened RocksDB state DB commits so object deletes, tombstones, and metadata
  write through the same synced batch as object puts.
- Fixed a state delta replay auditor journal build bug where `--to-height`
  prefix audits could stop the source scan as soon as every height had one
  candidate. Because the scan is in block id order, that early stop could drop
  the canonical block for a height that a fork candidate had already covered,
  causing replay to fail with a spurious missing-parent error. New journals
  record a full-source-scan marker, and prefix journals built by earlier
  versions (which may be missing candidates) are detected and rebuilt
  automatically instead of being reused.
- Fixed state delta replay auditor canonical block selection at forks. Forward
  greedy parent chaining could follow an orphan when fork siblings share a
  parent (mainnet history holds ~4.2M fork candidates) and abort one height
  later with a spurious missing-parent error. Replay now resolves the canonical
  chain backward from the known head block id, where each parent pointer
  uniquely selects the block below, and validates the state root chain against
  a genesis zero-hash anchor.
- The state delta replay auditor now inventories historical state-root
  anomalies instead of aborting on the first one. Blocks produced under the
  old normal-remove semantics committed state roots that exclude some recorded
  entries (transient tombstones, observed on mainnet at height 32,789,377, and
  no-op puts); the auditor searches recorded-entry subsets for the exact
  omission that reproduces the consensus root and counts matches in
  `legacy_dropped_tombstone_blocks`/`legacy_dropped_tombstones`/
  `legacy_dropped_puts`. Mismatches no subset explains (observed at height
  30,504,202, likely a receipt that lost an entry consensus included) are
  logged with full forensics and counted in `unexplained_mismatch_blocks`; the
  audit completes the full inventory and exits with status 2 and a
  "completed with unexplained mismatches" verdict instead of "ok". Direct
  journal replay also supports `--from-height` above genesis now, since the
  backward walk anchors on the audit tip rather than on genesis.


<a id="version-1.0.3"></a>
<a id="v1.0.3"></a>
## [1.0.3] - 2026-07-02

### Changed

- Started the next post-`1.0.2` feature track on version `1.0.3` so assistant,
  wallet safety, documentation, and release-preparation changes are tracked
  together before the next release.
- Documented the release-branch policy in project memory: after a release,
  continue user-facing work on a feature branch with the next intended SemVer
  version, keep the changelog and docs current there, and merge/tag/package
  only when the user asks to release it.
- Documented that first-run assistant surfaces must stay compact and guided,
  without raw command output, JSON payloads, expert logs, or debug panels.
- Added an explicit assistant restore choice to skip public backup restore and
  sync from seed peers when the user prefers the slower, backup-free trust path.
- Added assistant detection for existing local node data in the selected data
  folder, with a keep-local-copy option and age comparison against the public
  backup before restore.
- Improved the assistant wallet step so returning after wallet creation asks
  whether to keep the current wallet, create a new one, or import an existing
  wallet.
- Improved Node preset reporting so the active preset reflects the running
  monolith feature flags and a selected-but-not-applied producer preset is shown
  as pending instead of active.
- Changed first-run setup detection so completed setup survives DMG reinstalls
  and app updates, with a Settings action to intentionally run the assistant
  again.
- Updated node startup so the selected monolith preset is applied before
  launch; selecting Mainnet Producer now attempts producer features instead of
  silently reusing stale observer feature flags.
- Updated the app and embedded manual visual style toward the first-run
  assistant palette, with lighter operational surfaces, calmer purple accents,
  and more consistent Documentation tab styling.
- Expanded the rendered MkDocs manual with Koinos protocol, monolith
  architecture, and service-coverage deeper reference pages.
- Removed the Authoring Prompts section from the public manual while keeping
  the internal prompt files excluded from the generated static site.
- Converted manual references to other manual pages into MkDocs links and
  converted repository source references to official GitHub links.
- Documented the one-click local node and agent strategy as backlog product
  planning material.

### Fixed

- Fixed Wallet Send and Burn defaults so the receiver account always starts as
  the active wallet account, not a producer address or stale account from a
  previous operation.
- Hid raw wallet action output from the assistant wallet step after wallet
  creation so the setup flow remains simple.
- Added regression coverage for wallet action receiver defaults.
- Fixed failed preset apply attempts so they no longer persist the requested
  profile when the runtime preflight rejects the change.
- Fixed first-run assistant detection so replacing the packaged app no longer
  looks like a clean first install when local setup was already completed.
- Fixed the Node Start button so it is disabled while a node is already
  running and directs mode changes through Presets > Apply.
- Fixed running-node public restore failures caused by stale local Backup Admin
  tokens by showing a user-facing recovery message instead of leaking the raw
  unauthorized admin route.
- Hardened native libp2p stream, host, gossip, and disconnect callbacks so
  peer transport exceptions are converted into peer-level errors instead of
  aborting `teleno_node`.
- Added stable P2P identity key handling and regression coverage for generated
  and configured libp2p identities.


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
