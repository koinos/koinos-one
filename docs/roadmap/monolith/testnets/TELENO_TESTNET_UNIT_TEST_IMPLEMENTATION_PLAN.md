# Teleno Testnet Support Unit Test Implementation Plan

Updated: 2026-06-07

## Purpose

Define the unit-test implementation path for explicit testnet support in Teleno. These tests should prove the safety invariants before the GUI starts launching testnet nodes from user-selected basedirs.

This plan covers TypeScript unit tests run by `npm run test` through Vitest. It does not cover Playwright UI tests, Electron smoke tests, live testnet smokes, or C++ `koinos_node` tests.

## Test Principles

- Unit tests must not require a live `koinos_node`, live RPC, network access, `screen`, `caffeinate`, or the external SSD.
- Filesystem tests should use temporary directories and small fixture files.
- Network behavior should be represented through explicit network profiles and deterministic fixtures.
- Safety tests should be written before implementation changes where practical, so the current unsafe behavior is captured as a failing test.
- The highest-priority tests are the ones preventing irreversible mistakes: wrong basedir, wrong genesis/descriptors, wrong RPC network, and wrong producer contract addresses.

## Required Testable Extraction

Some current logic is embedded in `electron/main.ts`, which makes focused unit testing difficult. Before or during test implementation, extract these helpers into small modules:

| New or Updated Module | Responsibility | Why |
| --- | --- | --- |
| `electron/lib/network-profiles.ts` | Mainnet/testnet/custom registry, RPC defaults, ports, peers, contract addresses, expected chain evidence. | Central source of truth for every network-scoped value. |
| `electron/lib/node-presets.ts` | Build and validate network-aware presets. | Avoid testing preset behavior through Electron main process side effects. |
| `electron/lib/runtime-listen.ts` | Parse `jsonrpc.listen` and `p2p.listen`, resolve readiness/check ports. | Replace hardcoded `8080` with unit-testable parsing. |
| `electron/lib/basedir-identity.ts` | Detect existing node layout, fingerprint genesis/descriptors, classify empty/non-empty basedirs. | Keeps basedir safety testable without launching a node. |
| `src/app/network.ts` | Renderer-safe network labels/default public RPC helpers. | Keeps renderer defaults testable without coupling to Electron internals. |

## Phase 0 - Red Safety Tests

Add tests that initially fail or document current unsafe behavior. These should be implemented before large refactors.

### `electron/lib/node-paths.test.ts`

Add cases:

- `parsePersistedNodeSettings` preserves `network`.
- Missing `network` falls back to `mainnet`.
- `profiles: "testnet_observer"` infers `network: "testnet"` when no network is stored.
- Existing node-layout path is preserved exactly:
  - input: `/Volumes/external/teleno-testnet-producer/basedir`
  - fixture contains `config.yml`, `chain/`, or `db/`
  - output must not append `.koinos`.
- Parent directory still appends `.koinos` when it is not a node layout.

### `electron/lib/workspace-service.test.ts`

Add cases:

- Existing basedir with `chain/genesis_data.json` is preserved.
- Existing basedir with descriptors is preserved.
- Existing testnet basedir selected as mainnet is rejected.
- Existing mainnet basedir selected as testnet is rejected.
- Empty testnet basedir receives the testnet config source.
- Empty mainnet basedir receives the mainnet config source.

Implementation note: use small fixture files and fingerprints. The unit test does not need real full genesis files.

Exit criteria:

- The tests describe the required behavior even if implementation is still incomplete.
- The failure messages make clear whether the bug is path normalization, file overwrite, or network mismatch.

## Phase 1 - Network Registry Tests

Create `electron/lib/network-profiles.test.ts`.

Test cases:

- `mainnet` profile includes:
  - public RPC `https://api.koinos.io/`
  - JSON-RPC listen `127.0.0.1:8080`
  - P2P listen `/ip4/0.0.0.0/tcp/8888`
  - mainnet seed peers.
- `testnet` profile includes:
  - public RPC `https://testnet.koinosfoundation.org/jsonrpc`
  - JSON-RPC listen `127.0.0.1:18122`
  - P2P listen `/ip4/0.0.0.0/tcp/18888`
  - `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`
  - testnet PoB/VHP/KOIN contract addresses after Phase 0 evidence is recorded.
- Invalid network IDs fall back to `mainnet` only in compatibility paths; command/start paths should reject invalid IDs.
- Mainnet and testnet contract addresses are not accidentally shared for PoB/VHP when evidence shows they differ.

Exit criteria:

- Every network-scoped constant used by runtime, wallet, producer, and renderer has a unit-tested source.

## Phase 2 - Persisted Settings and Storage Tests

Update existing tests rather than creating broad new suites.

### `electron/lib/node-paths.test.ts`

Add cases:

- String and array profile parsing still works.
- Network migration preserves old settings:
  - old payload with no network and `mainnet_observer` becomes mainnet.
  - old payload with no network and `testnet_observer` becomes testnet.
  - old payload with explicit `network: "testnet"` keeps testnet even if profiles are empty.
- Unsupported network strings are ignored in storage parsing but rejected by runtime validation.

### `electron/lib/teleno-storage.test.ts`

Add cases if public RPC config becomes network-scoped:

- Existing global public RPC config migrates into mainnet defaults.
- Testnet public RPC defaults are returned when no testnet override exists.
- Saving testnet public RPCs does not overwrite mainnet public RPCs.
- Invalid testnet RPC entries fall back to the testnet default, not mainnet.

Exit criteria:

- Existing users keep mainnet behavior.
- Testnet users do not silently inherit mainnet public RPCs.

## Phase 3 - Basedir Identity and Runtime File Tests

Create `electron/lib/basedir-identity.test.ts` or extend `workspace-service.test.ts` if the helper remains local.

Test cases:

- `detectNodeBaseDirLayout` returns true for:
  - `config.yml`
  - `chain/genesis_data.json`
  - `jsonrpc/descriptors/koinos_descriptors.pb`
  - `db/`
- Empty directories are classified as safe for template preparation.
- Non-empty unknown directories require explicit confirmation or are rejected, depending on implementation.
- Genesis/descriptors fingerprints are stable.
- Mismatched genesis fingerprint produces a clear network mismatch error.
- Existing `config.yml` is preserved unless preset application explicitly writes it.

Exit criteria:

- Unit tests prove the GUI cannot rewrite chain identity files in an existing basedir.

## Phase 4 - Preset Tests

Create `electron/lib/node-presets.test.ts` after extracting preset construction from `electron/main.ts`.

Test cases:

- Mainnet observer preset:
  - `network: mainnet`
  - block producer disabled.
  - mainnet peers and ports.
- Testnet observer preset:
  - `network: testnet`
  - block producer disabled.
  - testnet seed, `18122`, `18888`.
- Mainnet producer preset:
  - `network: mainnet`
  - block producer enabled.
  - does not set or rewrite private key paths.
- Testnet producer preset:
  - `network: testnet`
  - block producer enabled.
  - contract meta store enabled if required by producer/wallet views.
  - does not set or rewrite private key paths.
- Applying a testnet preset to mainnet settings either switches network explicitly or returns a validation error.
- Applying a mainnet preset to testnet settings either switches network explicitly or returns a validation error.

Exit criteria:

- Preset behavior can be verified without starting Electron.
- Producer presets are proven not to mutate private material.

## Phase 5 - Runtime Listen and Conflict Tests

Create `electron/lib/runtime-listen.test.ts` or extend `native-runtime-service.test.ts` if no helper extraction is needed.

Test cases:

- `127.0.0.1:8080` resolves to host `127.0.0.1`, port `8080`.
- `127.0.0.1:18122` resolves to host `127.0.0.1`, port `18122`.
- `/ip4/0.0.0.0/tcp/18888` resolves to bind host `0.0.0.0`, port `18888`.
- Invalid listen values fall back to network defaults only during config creation, not during launch preflight.
- Runtime start waits on the parsed JSON-RPC port, not hardcoded `8080`.
- Testnet launch preflight reports conflict when `18122` or `18888` is already owned.
- Mainnet launch preflight reports conflict when `8080` or `8888` is already owned.

Exit criteria:

- The test suite would fail if any code path reintroduces hardcoded `8080` readiness for testnet.

## Phase 6 - Producer and Wallet Contract Routing Tests

Update `electron/lib/producer-service.test.ts` and `electron/lib/wallet-service.test.ts`.

Refactor requirement:

- Inject or resolve network contract addresses through the network registry instead of importing global constants directly in business logic.

Producer test cases:

- `network=mainnet` loads mainnet KOIN/VHP/PoB contracts.
- `network=testnet` loads testnet KOIN/VHP/PoB contracts.
- Producer-key lookup uses the selected network's PoB contract.
- VHP/forecast reads use the selected network's VHP/PoB contracts.
- Explicit RPC override with mismatched network can produce a warning.

Wallet test cases:

- Balance overview uses the selected network's KOIN/VHP contracts.
- Burn/allowance flows use the selected network's PoB spender.
- Explicit RPC override does not change contract network unless the network setting changes.

Mock strategy:

- Mock `loadContractWithFetchedAbi` to record requested contract IDs.
- Avoid real koilib network calls.
- Return minimal fake contract methods needed by each service path.

Exit criteria:

- A regression to mainnet constants on testnet is caught by unit tests.

## Phase 7 - Renderer Utility Tests

Update `src/app/utils.test.ts` and add `src/app/network.test.ts` if a renderer network helper is introduced.

Test cases:

- Testnet public RPC defaults include `https://testnet.koinosfoundation.org/jsonrpc`.
- Mainnet public RPC defaults remain unchanged.
- Explorer RPC source normalizes to testnet public RPC when selected network is testnet.
- Local node RPC display uses the actual runtime port from status.
- Exact basedir display does not add `.koinos` for known existing node layouts if renderer participates in normalization.
- Network badges/labels map stable IDs to user-facing labels.

Exit criteria:

- Renderer defaults cannot silently drift back to mainnet while network is testnet.

## Phase 8 - IPC Shape Tests

Update `electron/lib/ipc-handlers.test.ts`.

Test cases:

- IPC accepts node settings with `network`.
- IPC forwards network to:
  - presets.
  - start/stop/restart.
  - producer overview.
  - wallet queries.
- Missing network in old payloads is normalized through the backend, not trusted from renderer.

Exit criteria:

- The renderer-to-Electron boundary carries network context consistently.

## Phase 9 - Test Execution Order

Implement and run in this order:

1. `npm run test -- electron/lib/node-paths.test.ts`
2. `npm run test -- electron/lib/workspace-service.test.ts`
3. `npm run test -- electron/lib/network-profiles.test.ts`
4. `npm run test -- electron/lib/node-presets.test.ts`
5. `npm run test -- electron/lib/runtime-listen.test.ts`
6. `npm run test -- electron/lib/producer-service.test.ts electron/lib/wallet-service.test.ts`
7. `npm run test -- src/app/utils.test.ts src/app/network.test.ts`
8. `npm run test -- electron/lib/ipc-handlers.test.ts`
9. Full `npm run test`

Run the focused commands while implementing each phase, then the full suite before moving to Playwright or live smoke validation.

## Acceptance Criteria

- `npm run test` passes.
- Unit tests fail if:
  - testnet basedir is rewritten to `basedir/.koinos`.
  - genesis/descriptors are overwritten in an existing basedir.
  - testnet starts waiting on `8080`.
  - testnet Explorer/Producer/Wallet defaults to mainnet RPC.
  - testnet Producer/Wallet uses mainnet PoB/VHP/KOIN constants.
  - producer presets rewrite private key material.
- Tests use no live network and no real external SSD dependency.

## Recommended First Commit Scope

The first implementation commit should be narrow:

1. Add `network-profiles.ts`.
2. Add persisted `network` parsing/normalization.
3. Add exact existing basedir detection.
4. Add failing/passing tests for those pieces only.

This creates a safe base for later commits that touch config copying, presets, runtime start, wallet, and producer services.
