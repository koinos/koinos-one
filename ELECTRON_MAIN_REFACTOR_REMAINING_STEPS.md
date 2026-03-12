# Electron Main Refactor Follow-Up

## Status

The planned refactor phases have been executed.

Current state:

- [`/Users/pgarcgo/code/knodel/electron/main.ts`](/Users/pgarcgo/code/knodel/electron/main.ts): `3,905` lines
- extracted services now exist for:
  - logs
  - workspace/config
  - backup/restore
  - native build
  - runtime orchestration
  - app lifecycle
  - producer
  - wallet
  - IPC registration
- latest validation:
  - `npm test`
  - `npm run build`
- observed passing state:
  - `14` test files
  - `61` tests

## What Is Still In `main.ts`

The remaining content is no longer the original monolith, but there are still helper-level clusters that could be reduced further in a follow-up cleanup if needed:

### 1. Darwin/Hunter patch helpers

These are still in `main.ts` because they are tightly tied to the native build workaround flow:

- tarball patch preparation
- Hunter config patching
- SHA1 helper for patched archives

Suggested optional next step:

- move these into either:
  - [`/Users/pgarcgo/code/knodel/electron/lib/native-build-service.ts`](/Users/pgarcgo/code/knodel/electron/lib/native-build-service.ts)
  - or a dedicated `electron/lib/native-build-workarounds.ts`

### 2. Shared runtime/status helpers

Some lower-level helpers still remain in `main.ts` because they are reused by multiple services:

- process snapshot parsing
- TCP listener parsing
- compose status normalization
- service sorting and dependency ordering
- RabbitMQ runtime environment helpers
- native/docker status readers

Suggested optional next step:

- split them into one or two helper modules, for example:
  - `electron/lib/runtime-status-helpers.ts`
  - `electron/lib/runtime-process-helpers.ts`

### 3. Service composition glue

`main.ts` still wires:

- global process/session maps
- service constructors
- thin wrappers used by IPC
- Electron app bootstrap hooks

This is acceptable, but a final cleanup could reduce wrapper noise by:

- grouping wrapper declarations together
- moving constructor wiring into a small `electron/lib/main-services.ts`
- leaving `main.ts` as pure bootstrap

## Acceptance State

The original refactor objective is already met:

- the application behavior was preserved through the refactor
- `main.ts` is far smaller and easier to navigate
- feature domains now live in focused modules
- Electron-side testing is materially stronger than before

## If Another Refactor Pass Is Needed

Recommended order:

1. extract runtime helper-only modules
2. move Darwin/Hunter workaround helpers out of `main.ts`
3. optionally reduce wrapper/composition noise
4. rerun:
   - `npm test`
   - `npm run build`
