# Knodel Project Status (Codex Memory)

Last updated: 2026-05-23

## Current Focus

Monolithic node migration (single `koinos_node` process replacing multi-service runtime).

## What Is Done

- Monolith build reproducibility integrated into Knodel native build flow.
- `koinos_node` build target moved to:
  `vendor/koinos/koinos-node/build/koinos_node`
- CMake integration updated for libp2p build path (`KOINOS_ENABLE_LIBP2P`, prelude, prefixes, shims).
- Electron runtime now supports monolith service actions (`start`, `stop`, `restart`) through existing IPC bridge.
- Node status model updated for monolith mode:
  one managed service (`koinos-node`) + component-level health.
- Component health parsing updated to real monolith log format (timestamp + `[component]`).
- Component logs implemented in monolith mode:
  `logs` and `logsFollowStart` accept component targets (`jsonrpc`, `chain`, etc.) and filter by `[component]`.
- Preset reconcile implemented for monolith mode:
  writes `features.*` to active `BASEDIR/config.yml`, maps feature flags to CLI `--enable/--disable`, and restarts monolith.
- Default safety behavior in Knodel monolith launcher:
  `p2p` is disabled until Gate B is closed.

## Validated End-to-End

- Electron bridge smoke tests for `serviceStart` / `serviceStop` / `serviceRestart`.
- JSON-RPC probe (`chain.get_head_info`) succeeds with monolith running in local mode.
- Logs filtering validated for component target `jsonrpc` (snapshot + follow stream).
- Preset smoke validated (`profile:jsonrpc`):
  writes feature flags, restarts monolith, JSON-RPC responds, `p2p` remains disabled.

## Critical Open Items (Current)

1. Verify `resolveMonolithBinaryPath()` behavior in packaged app (dev is already verified).
2. Implement fallback UX when monolith is missing or fails to start:
   clear error + explicit path back to multi-service mode.
3. Close Gate B (libp2p/P2P):
   live Go<->C++ Peer RPC interop and stable P2P runtime with peers.

## Known Constraint

With `p2p` enabled, current monolith build reaches genesis then fails when starting P2P.
With `p2p` disabled, `chain`, `block_store`, and `jsonrpc` run and shut down cleanly.

## Source of Truth

- `docs/roadmap/MONOLITH_PRODUCTION_PLAN.md`
- `docs/roadmap/CPP_LIBP2P_INTEGRATION_STATUS.md`
- `CLAUDE.md`
