# Electron Main Refactor

## Objective

Split [`/Users/pgarcgo/code/knodel/electron/main.ts`](/Users/pgarcgo/code/knodel/electron/main.ts) into smaller, focused modules without intentionally changing Knodel behavior, so future changes can be done with smaller contexts and clearer boundaries.

## Baseline Before Refactor

- `electron/main.ts`: `10,631` lines
- Electron-side tests discovered by Vitest: `2` files / `24` tests
- Baseline verification:
  - `npm test`

Observed baseline:

- `24` tests passed

## Final Result

- `electron/main.ts`: `3,905` lines
- extracted modules under [`/Users/pgarcgo/code/knodel/electron/lib`](/Users/pgarcgo/code/knodel/electron/lib)
- Electron-side tests after refactor: `14` files / `61` tests

Final verification:

- `npm test`
- `npm run build`

Observed final state:

- `61` tests passed
- renderer build passed
- Electron TypeScript build passed

## Extracted Modules

- [`/Users/pgarcgo/code/knodel/electron/lib/constants.ts`](/Users/pgarcgo/code/knodel/electron/lib/constants.ts)
  - central shared constants
- [`/Users/pgarcgo/code/knodel/electron/lib/node-paths.ts`](/Users/pgarcgo/code/knodel/electron/lib/node-paths.ts)
  - node settings, paths, base-dir helpers
- [`/Users/pgarcgo/code/knodel/electron/lib/knodel-storage.ts`](/Users/pgarcgo/code/knodel/electron/lib/knodel-storage.ts)
  - secure wallet/profile persistence and session state
- [`/Users/pgarcgo/code/knodel/electron/lib/producer-keys.ts`](/Users/pgarcgo/code/knodel/electron/lib/producer-keys.ts)
  - producer config/key resolution helpers
- [`/Users/pgarcgo/code/knodel/electron/lib/native-tooling.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-tooling.ts)
  - native tooling/build metadata helpers
- [`/Users/pgarcgo/code/knodel/electron/lib/compose-helpers.ts`](/Users/pgarcgo/code/knodel/electron/lib/compose-helpers.ts)
  - compose/env parsing and normalization
- [`/Users/pgarcgo/code/knodel/electron/lib/main-types.ts`](/Users/pgarcgo/code/knodel/electron/lib/main-types.ts)
  - shared main-process type surface
- [`/Users/pgarcgo/code/knodel/electron/lib/native-versions.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-versions.ts)
  - native version resolver and cache
- [`/Users/pgarcgo/code/knodel/electron/lib/producer-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/producer-service.ts)
  - producer overview, register/delete, dashboard producer/peer logic
- [`/Users/pgarcgo/code/knodel/electron/lib/wallet-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/wallet-service.ts)
  - wallet lifecycle, balance queries, send/burn/free-mana flow
- [`/Users/pgarcgo/code/knodel/electron/lib/ipc-handlers.ts`](/Users/pgarcgo/code/knodel/electron/lib/ipc-handlers.ts)
  - IPC registration table
- [`/Users/pgarcgo/code/knodel/electron/lib/logs-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/logs-service.ts)
  - docker/native logs, follow streams, log-buffer fanout
- [`/Users/pgarcgo/code/knodel/electron/lib/workspace-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/workspace-service.ts)
  - repo/config/runtime file management and managed file I/O
- [`/Users/pgarcgo/code/knodel/electron/lib/backup-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/backup-service.ts)
  - backup restore, restore+verify, RPC proxy, base-dir copy/select
- [`/Users/pgarcgo/code/knodel/electron/lib/native-build-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-build-service.ts)
  - native build status and build execution
- [`/Users/pgarcgo/code/knodel/electron/lib/native-runtime-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-runtime-service.ts)
  - native/docker orchestration actions and preset reconcile
- [`/Users/pgarcgo/code/knodel/electron/lib/app-lifecycle-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/app-lifecycle-service.ts)
  - Electron window creation, shutdown ordering, runtime cleanup

## New Unit Tests

Added or expanded:

- [`/Users/pgarcgo/code/knodel/electron/lib/node-paths.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/node-paths.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/knodel-storage.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/knodel-storage.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/producer-keys.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/producer-keys.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/native-tooling.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-tooling.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/compose-helpers.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/compose-helpers.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/producer-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/producer-service.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/wallet-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/wallet-service.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/ipc-handlers.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/ipc-handlers.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/workspace-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/workspace-service.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/backup-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/backup-service.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/native-build-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-build-service.test.ts)
- [`/Users/pgarcgo/code/knodel/electron/lib/native-runtime-service.test.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-runtime-service.test.ts)

Also updated:

- [`/Users/pgarcgo/code/knodel/vitest.config.ts`](/Users/pgarcgo/code/knodel/vitest.config.ts)

## Behavior Preservation

This refactor did not intentionally change product behavior.

The work was structural:

- moving domain logic into dedicated services
- moving IPC registration and main-process types out of `main.ts`
- replacing large inline implementations with thin wrappers/delegation
- increasing Electron-side unit coverage and validating with full build

## Current Shape of `electron/main.ts`

`main.ts` now mainly keeps:

- imports and shared process state
- constant maps and bootstrap wiring
- helper functions still shared across services
- thin wrappers used by IPC/service composition
- Electron startup hooks

The remaining content is much smaller, but there are still helper-level clusters that could be reduced further if desired, especially:

- Darwin Hunter workaround preparation helpers
- some runtime status/process helper functions
- some compose/status normalization helpers still shared by multiple services

## Summary

This refactor achieved four practical outcomes:

1. `electron/main.ts` dropped from `10,631` to `3,905` lines.
2. producer, wallet, logs, workspace, backup, runtime orchestration, build orchestration, lifecycle, IPC registration, and shared types now live in dedicated modules.
3. Electron-side tests increased from `24` to `61` passing tests.
4. the refactor was validated with both `npm test` and `npm run build`.
