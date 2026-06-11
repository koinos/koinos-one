# Monolith Gate E/F Report

> Historical note: This file preserves command output, validation context, and artifact paths from runs that predate the Teleno repository and runtime cleanup. Old `knodel-*`, `koinosgui`, `Knodel.app`, or `/code/knodel` paths are evidence references only; current active repo paths and generated artifacts use Teleno names.

Date: 2026-05-23

## Scope

This report covers the next critical-path step after Gate D: enabling Knodel local monolith mode with C++ P2P active by default, and preparing the Gate F mainnet soak path.

## Gate E Work Completed

- Removed the default monolith CLI disable for `p2p` in Electron main process startup.
- Updated monolith preset feature generation so core components, including `p2p`, stay enabled unless a user explicitly disables them.
- Added a local monolith P2P smoke script: `scripts/smoke-monolith-p2p-local.sh`.
- The smoke script builds `koinos_node`, creates an isolated temporary basedir, enables `p2p` and `jsonrpc`, verifies JSON-RPC with `chain.get_head_info`, verifies P2P startup logs, and then shuts the process down.
- Added monolith P2P peer snapshot logging in `P2PNode` so Knodel can consume `[p2p] Connected peers:` snapshots from the single-process log stream.
- Added a parser test for monolith-prefixed P2P peer snapshot logs in `electron/lib/producer-service.test.ts`.

## Gate F Work Completed

- Added `scripts/soak-mainnet-p2p.sh` as the Gate F soak harness.
- The soak harness builds the monolith, creates an isolated mainnet-style config, enables `p2p` and `jsonrpc`, connects to real seed peers, samples PID/RSS/head height from `node.get_status`/peer log rows, and writes a Markdown report.
- Default soak duration is 172800 seconds, matching the 48h Gate F criterion.
- The harness supports short preflight runs through `SOAK_DURATION_SECONDS`, `SOAK_INTERVAL_SECONDS`, `JSONRPC_PORT`, `P2P_LISTEN`, `MONOLITH_SOAK_BASEDIR`, `MONOLITH_SOAK_LOG`, and `MONOLITH_SOAK_REPORT`.

## What Works Now

- Monolith build with `cpp-libp2p` is integrated into the local Knodel build path.
- Controlled Peer RPC, one-peer sync, and GossipSub interop passed before Gate E/F.
- Knodel local monolith mode no longer treats `p2p` as a permanently disabled component.
- The dashboard parser can read both legacy Go-style P2P snapshots and monolith-prefixed `[p2p]` snapshots.
- Gate F can now be run as a reproducible command instead of an ad hoc manual process.

## Remaining Production Signoff

Gate F is not production-signed until the full 48h soak has actually completed on wall-clock time with real peers. The required command is:

```bash
SOAK_DURATION_SECONDS=172800 scripts/soak-mainnet-p2p.sh
```

The generated `docs/roadmap/monolith/networking/MONOLITH_GATE_F_SOAK_REPORT.md` must be reviewed for process exits, stalled head height, unacceptable RSS growth, repeated JSON-RPC timeouts, peer reconnect failures, fork watchdog false positives, and shutdown problems before marking Gate F complete.

## Verification Run

Commands run on 2026-05-23:

```bash
cmake --build build --target koinos_node --parallel
npm test -- --run electron/lib/producer-service.test.ts
scripts/smoke-monolith-p2p-local.sh
npm run build
SOAK_DURATION_SECONDS=20 SOAK_INTERVAL_SECONDS=5 JSONRPC_PORT=18082 P2P_LISTEN=/ip4/127.0.0.1/tcp/0 scripts/soak-mainnet-p2p.sh
git diff --check
```

Results:

- `koinos_node` rebuilt successfully. Linker emitted the existing macOS deployment-version warnings from Hunter dependencies.
- Producer service helper tests passed, including the new monolith-prefixed P2P snapshot parser case.
- Gate E local smoke passed with `p2p` and `jsonrpc` enabled.
- Electron/renderer production build passed; Vite emitted the existing large chunk warning.
- Gate F 20s preflight passed: JSON-RPC `node.get_status` returned head height 0 after startup, one peer snapshot row was logged, and SIGTERM shutdown completed.
- `git diff --check` passed.
