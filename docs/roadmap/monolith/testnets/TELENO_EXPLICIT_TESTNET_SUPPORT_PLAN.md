# Teleno Explicit Testnet Support Plan

Updated: 2026-06-07

## Purpose

Add first-class testnet support to Teleno so an operator can intentionally run the monolithic `koinos_node` against either mainnet or the public Koinos Foundation testnet without manual config surgery, hidden mainnet defaults, or accidental chain-data corruption.

The monolithic node already works against the public testnet when launched manually with a verified testnet basedir. The GUI is only partially prepared: it has a `Testnet Observer` preset, but network selection, config-template handling, public RPC defaults, local port strategy, and producer workflows are still mainnet-biased.

## Current Findings

- `electron/main.ts` already defines `MAINNET_P2P_PEERS`, `TESTNET_P2P_PEERS`, and a `profile:testnet_observer` preset.
- `electron/lib/node-paths.ts` still defaults native profiles to `mainnet_observer`.
- `src/app/constants.ts` and `electron/lib/constants.ts` default public RPCs to mainnet.
- `electron/main.ts` still has hardcoded `8080` readiness behavior for the monolith JSON-RPC listener.
- `electron/lib/workspace-service.ts` preserves an existing `config.yml`, but overwrites `chain/genesis_data.json` and `jsonrpc/descriptors/koinos_descriptors.pb` from the selected config source. This is unsafe when the source config is mainnet and the target basedir is testnet.
- `electron/lib/node-paths.ts` appends `.koinos` to any basedir that does not already end in `.koinos` or `.teleno`. That is correct for generic parent directories, but it would turn the verified live testnet basedir `/Volumes/external/teleno-testnet-producer/basedir` into `/Volumes/external/teleno-testnet-producer/basedir/.koinos`, which is the wrong data path.
- `scripts/stage-bundle.js` copies a Harbinger/testnet config folder, but the live public testnet report notes that local bundled Harbinger files must not be assumed to match the current Koinos Foundation testnet without chain-id verification.
- The current live public testnet producer basedir is verified manually at `/Volumes/external/teleno-testnet-producer/basedir`, with JSON-RPC on `127.0.0.1:18122`, P2P on `0.0.0.0:18888`, and public RPC `https://testnet.koinosfoundation.org/jsonrpc`.
- Mainnet contract constants are currently global in `electron/lib/constants.ts` and are consumed by wallet and producer services. Testnet PoB/VHP addresses are known to differ from mainnet in the live monolith producer logs, so these constants must become network-scoped before testnet producer UX can be trusted.

## Goals

- Add an explicit network model: `mainnet`, `testnet`, and future `custom`.
- Make the active network visible in the Node, Dashboard, Producer, Wallet, Explorer, and Settings surfaces.
- Provide safe network-scoped presets:
  - Mainnet Observer
  - Testnet Observer
  - Mainnet Producer
  - Testnet Producer
  - Custom Advanced
- Keep the GUI as a single-node manager. It should switch networks intentionally; it does not need to run mainnet and testnet simultaneously in this release.
- Use network-scoped default local ports to avoid accidental conflicts:
  - Mainnet default JSON-RPC: `127.0.0.1:8080`
  - Mainnet default P2P: `/ip4/0.0.0.0/tcp/8888`
  - Testnet default JSON-RPC: `127.0.0.1:18122`
  - Testnet default P2P: `/ip4/0.0.0.0/tcp/18888`
- Prevent mainnet genesis/descriptors from being copied into a non-empty testnet basedir, and prevent testnet genesis/descriptors from being copied into a non-empty mainnet basedir.
- Route public RPC, wallet, producer stats, and chain checks through the selected network unless the user explicitly overrides the RPC URL.
- Make the existing verified external testnet basedir importable/selectable without rewriting its chain files.

## Non-Goals

- Do not change Koinos protocol behavior.
- Do not implement simultaneous multi-node management in this release.
- Do not automate faucet funding, VHP burn, or producer-key registration beyond existing Producer-tab workflows.
- Do not treat arbitrary private networks as fully supported; `custom` may exist as an advanced escape hatch only.
- Do not migrate mainnet data into testnet or testnet data into mainnet.

## Two-Pass Review Result

The plan was reviewed twice after the initial draft.

### Pass 1 - Core Safety and Sequencing

The implementation order is correct only if network and basedir safety land before visible UI affordances. The highest-risk bug is not a missing tab or label; it is accidental mutation of chain files when a user points the app at an existing basedir. Therefore the refined path starts with a network registry and immutable basedir guardrails, then moves to presets and UI.

Pass 1 decisions:

- Treat network selection as a runtime invariant, not just a UI preference.
- Refuse to start if selected network and basedir chain identity do not match.
- Derive JSON-RPC readiness from the selected config instead of any hardcoded port.
- Keep producer key and producer address mutation out of presets.
- Keep `custom` as an advanced fallback, not a first-class private-network workflow.

### Pass 2 - Operator UX and Live Testnet Reality

The second pass focused on gaps discovered from the current code and live testnet evidence. Two items were promoted from "nice to have" to required: exact existing basedir handling and network-scoped contract constants.

Pass 2 decisions:

- The basedir picker must support exact existing basedirs. It must not blindly append `.koinos` when the selected path already contains a Koinos node layout.
- Testnet public RPC must be the default public RPC when the selected network is testnet; mainnet RPC must never appear as the implicit testnet fallback.
- Producer and wallet services must use network-scoped KOIN/VHP/PoB contract addresses.
- Testnet producer verification must prove acceptance through the public testnet RPC, not only local produced-block logs.
- The final release path should include a live smoke with a fresh temporary testnet observer and a separate smoke that attaches to the verified external SSD testnet basedir without rewriting it.

## Implementation Invariants

These constraints should remain true throughout the implementation:

- Network identity is explicit in persisted settings and in every node command that can touch a basedir.
- Existing chain files are immutable unless the operator explicitly runs a destructive reset workflow.
- A non-empty basedir must be identified before runtime files are copied into it.
- Config templates are network-scoped and must carry expected chain-id evidence.
- Local RPC URLs, public RPC URLs, producer stats, wallet calls, and contract addresses are network-scoped.
- Mainnet defaults remain backward compatible for existing users.
- Presets are allowed to patch config and feature flags; they are not allowed to rewrite private key material.

## Proposed Network Model

Introduce a shared network profile type in the Electron/backend layer and mirror the required shape in the renderer types.

```ts
type KoinosNetworkId = 'mainnet' | 'testnet' | 'custom'

type KoinosNetworkProfile = {
  id: KoinosNetworkId
  label: string
  expectedChainId?: string
  expectedGenesisFingerprint?: string
  publicRpcUrls: string[]
  p2pPeers: string[]
  defaultJsonrpcListen: string
  defaultP2pListen: string
  defaultBackupUrl?: string
  configTemplate: 'mainnet' | 'testnet-foundation' | 'custom'
  defaultBaseDirStrategy: 'append-dot-koinos' | 'exact-existing'
  producerContracts: {
    koin: string
    vhp: string
    pob: string
  }
}
```

Recommended initial profiles:

| Network | Public RPC | JSON-RPC listen | P2P listen | Seed |
| --- | --- | --- | --- | --- |
| Mainnet | `https://api.koinos.io/` | `127.0.0.1:8080` | `/ip4/0.0.0.0/tcp/8888` | `seed.koinosfoundation.org:8888` |
| Testnet | `https://testnet.koinosfoundation.org/jsonrpc` | `127.0.0.1:18122` | `/ip4/0.0.0.0/tcp/18888` | `testnet.koinosfoundation.org:8888` |

## Implementation Phases

### Phase 0 - Baseline and Safety Snapshot

1. Record the current manual testnet state:
   - Binary path and hash.
   - Basedir path.
   - Config path.
   - Local/public head match.
   - Latest accepted produced block.
2. Add a short note to the testnet report with the latest GUI-readiness finding.
3. Record exact testnet contract evidence:
   - PoB address observed by the monolith producer.
   - VHP address observed by the monolith producer.
   - KOIN address from verified testnet contract metadata or testnet setup notes.
4. Add a failing safety test for the desired behavior: runtime file preparation must not overwrite genesis/descriptors for an existing basedir, and must reject a network mismatch.
5. Add a failing normalization test for the desired behavior: selecting an existing node basedir that already contains `config.yml`, `chain/`, or `db/` must preserve that exact path instead of appending `.koinos`.

Exit criteria:

- A test or documented finding proves why network-aware runtime-file preparation is required.
- The plan does not rely on unverified Harbinger config as the live public testnet source.
- The current verified testnet basedir can be recognized as an exact basedir path.
- Testnet contract constants are identified before producer/wallet changes are made.

### Phase 1 - Network Registry and Persisted Network Selection

1. Add a shared network registry module in the Electron layer.
2. Mirror the network ID and minimal network metadata in renderer types.
3. Extend `NodeManagerSettings` with `network: KoinosNetworkId`.
4. Extend persisted node settings parsing/normalization to preserve `network`.
5. Keep existing installs compatible:
   - Missing `network` defaults to `mainnet`.
   - Existing `profiles: mainnet_observer` implies `mainnet`.
   - Existing `profiles: testnet_observer` implies `testnet`.
6. Add network-scoped public RPC defaults.
7. Add renderer state and Settings UI for network selection.
8. Disable network changes while the managed node is running, or require an explicit stop/restart action.

Exit criteria:

- Restarting the GUI preserves the selected network.
- Existing settings files load without breaking.
- The UI clearly shows the active network.
- Mainnet remains the default network for old settings.

### Phase 2 - Network-Scoped Config Templates

1. Add a config-template resolver that maps network to source files:
   - Mainnet: `vendor/koinos/koinos/config-example` or packaged `koinos/config`.
   - Testnet: a verified `config/testnet-foundation` source, not blindly `harbinger/config-example`.
2. Create or stage `config/testnet-foundation` from verified live public testnet genesis/descriptors.
3. Store expected chain IDs and genesis fingerprints for mainnet and testnet profiles.
4. Update basedir normalization:
   - Parent-directory selection may still append `.koinos`.
   - Existing node-layout selection must preserve the exact path.
   - The GUI should clearly show the final resolved basedir before starting.
5. Change `ensureBaseDirKoinosRuntimeFiles`:
   - For an empty basedir, copy network-scoped config, genesis, and descriptors.
   - For a non-empty basedir, preserve genesis/descriptors and verify their chain ID.
   - If the basedir chain ID mismatches the selected network, fail with a clear message.
   - Never overwrite chain files in a basedir that already has chain state.
   - Preserve an existing `config.yml` unless the user explicitly applies a preset or edits node settings.
6. Add tests for:
   - Empty mainnet basedir receives mainnet files.
   - Empty testnet basedir receives testnet files.
   - Existing testnet basedir is preserved.
   - Existing mainnet basedir selected as testnet is rejected.
   - Existing testnet basedir selected as mainnet is rejected.
   - Existing `/Volumes/external/.../basedir`-style paths are not rewritten to `.../basedir/.koinos`.

Exit criteria:

- The GUI cannot corrupt an existing basedir by mixing genesis/descriptors across networks.
- Testnet can be started from an empty basedir using verified testnet templates.
- The verified external SSD testnet basedir can be selected exactly.

### Phase 3 - Network-Scoped Presets

1. Replace profile-only preset logic with network-aware preset construction.
2. Add these presets:
   - `profile:mainnet_observer`
   - `profile:testnet_observer`
   - `profile:mainnet_producer`
   - `profile:testnet_producer`
   - `profile:custom_advanced`
3. Testnet presets must set:
   - `p2p.peer` to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`
   - `p2p.listen` to `/ip4/0.0.0.0/tcp/18888`
   - `jsonrpc.listen` to `127.0.0.1:18122`
4. Mainnet presets keep mainnet peers and standard ports unless the operator overrides them.
5. Producer presets must not overwrite producer address or private-key paths without explicit Producer-tab action.
6. Preset application must be network-compatible:
   - Applying a testnet preset while `network=mainnet` should first switch network or fail with a clear prompt.
   - Applying a mainnet preset while `network=testnet` should first switch network or fail with a clear prompt.

Exit criteria:

- Applying `Testnet Observer` writes a testnet-safe config patch.
- Applying `Testnet Producer` enables `block_producer` and required stores without changing private key material.
- Preset labels and descriptions make network and producer status unambiguous.

### Phase 4 - Dynamic Runtime Readiness and Conflict Checks

1. Replace the hardcoded JSON-RPC readiness wait on `127.0.0.1:8080` with a parser for `jsonrpc.listen`.
2. Add port conflict checks for the selected network before launch.
3. Detect external/manual `koinos_node` processes:
   - If the process uses the selected basedir, offer to attach/read status where possible.
   - If the process uses a different basedir or conflicting ports, warn and block managed start.
4. Update status derivation to display the active network and actual JSON-RPC URL.
5. Add a launch preflight that compares:
   - Selected network.
   - Resolved basedir.
   - Configured chain files.
   - JSON-RPC listen address.
   - P2P listen address.

Exit criteria:

- The GUI can start testnet on `18122` and wait for that port, not `8080`.
- The GUI refuses to start testnet if another node already owns `18122` or `18888`.
- The GUI does not confuse a running mainnet node with a running testnet node.

### Phase 5 - Explorer, Dashboard, Producer, and Wallet RPC Routing

1. Make default public RPC URLs network-scoped.
2. When the selected network is testnet, populate Explorer RPC choices with:
   - Local node RPC.
   - `https://testnet.koinosfoundation.org/jsonrpc`
3. Update Producer and Wallet services to receive selected network context.
4. Ensure producer stats and block scans use the selected network's RPC unless the user explicitly chooses another RPC.
5. Fix `kcli`-like assumptions by always passing explicit RPC URLs in validation workflows.
6. Replace global KOIN/VHP/PoB constants with network-scoped contract addresses.
7. Add tests that prove producer and wallet services use testnet PoB/VHP/KOIN addresses when `network=testnet`.
8. Keep explicit RPC override support, but warn if the override chain ID does not match the selected network.

Exit criteria:

- Explorer on testnet does not default to `https://api.koinos.io/`.
- Producer dashboard on testnet shows blocks from the public testnet.
- Wallet balance calls use the selected network RPC.
- Producer key, VHP, burn, and dashboard reads use testnet contract addresses on testnet.

### Phase 6 - Testnet Producer UX

1. Add a Producer-tab network badge and selected producer address summary.
2. Add warnings when:
   - The selected network is testnet but producer key is missing.
   - Producer address is not configured.
   - Public RPC and local RPC report different chain IDs.
3. Add a "Verify Testnet Producer Setup" action:
   - Check local node head.
   - Check public testnet head.
   - Check local/public chain ID match.
   - Check registered producer key.
   - Check VHP balance.
   - Check latest produced blocks in the configured scan window.
   - Confirm latest locally produced block IDs are visible through public testnet RPC.
4. Keep funding, burn, and producer-key registration explicit user actions.

Exit criteria:

- The user can see whether testnet producer setup is complete before pressing Start.
- The GUI can prove that produced testnet blocks are accepted by public RPC.
- The GUI does not report "producing" from local logs alone.

### Phase 7 - Tests

Add focused coverage before shipping:

- Unit tests:
  - Network setting normalization and migration.
  - Network profile resolution.
  - Runtime file preservation and chain-id mismatch rejection.
  - Exact existing basedir preservation.
  - Preset patches for mainnet/testnet observer/producer.
  - Dynamic JSON-RPC readiness port parsing.
  - Network-scoped contract constants for producer and wallet services.
- Playwright tests:
  - Settings network selector.
  - Node preset list includes mainnet/testnet observer/producer.
  - Applying testnet preset shows `18122`, `18888`, and testnet seed.
  - Explorer RPC source switches to testnet public RPC.
  - Existing node settings remain light-themed and readable.
- Electron smoke:
  - Start mocked testnet preset.
  - Confirm IPC returns network-aware status.
- Optional live smoke:
  - Use an empty temporary testnet basedir.
  - Start testnet observer.
  - Verify local `chain.get_head_info` advances against the public testnet.
  - Select the existing external SSD testnet basedir and verify no chain files are rewritten.

Exit criteria:

- `npm run test`
- `npm run test:ui`
- `npm run test:ui:electron`
- Optional live smoke passes when explicitly enabled.

### Phase 8 - Rollout and Documentation

1. Add operator docs:
   - Mainnet observer quick start.
   - Testnet observer quick start.
   - Testnet producer quick start.
   - How to import the existing external SSD testnet basedir.
2. Document safe network switching:
   - Stop node.
   - Select network.
   - Select matching basedir.
   - Apply matching preset.
   - Start node.
3. Add troubleshooting:
   - Chain ID mismatch.
   - Port conflict.
   - Missing testnet genesis/descriptors.
   - Public RPC mismatch.
   - Producer key missing or not registered.
4. Update screenshots after UI changes.

Exit criteria:

- A non-developer operator can launch testnet observer or producer without manual shell commands.
- The docs explicitly warn that mainnet and testnet basedirs are not interchangeable.

## Recommended File-Level Work

| Area | Files | Change |
| --- | --- | --- |
| Types | `electron/lib/main-types.ts`, `src/app/types.ts`, `src/teleno-electron.d.ts` | Add network IDs, network profiles, and persisted network settings. |
| Defaults | `electron/lib/constants.ts`, `src/app/constants.ts` | Replace mainnet-only RPC defaults with network-scoped defaults. |
| Paths/config | `electron/lib/node-paths.ts`, `electron/lib/workspace-service.ts` | Resolve network config templates, preserve exact existing basedirs, and protect existing genesis/descriptors. |
| Presets/runtime | `electron/main.ts`, `electron/lib/native-runtime-service.ts` | Build network-aware presets and wait on the selected JSON-RPC listener. |
| UI | `src/App.tsx`, `src/components/panels/SettingsPanel.tsx`, `src/components/panels/MicroservicesConfigPanel.tsx` | Add network selector, badges, preset copy, and warnings. |
| Producer/wallet | `electron/lib/producer-service.ts`, `electron/lib/wallet-service.ts` | Route RPC and KOIN/VHP/PoB contract constants by selected network. |
| Tests | `electron/lib/*.test.ts`, `src/app/*.test.ts`, `tests/ui/*.spec.ts` | Cover settings migration, presets, chain-file safety, and testnet UI. |
| Docs | `docs/roadmap/monolith/testnets/*` | Add operator guidance and live-smoke evidence. |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mainnet files copied into a testnet basedir | Basedir becomes unusable or misleading | Never overwrite chain files in a non-empty basedir; verify chain ID first. |
| Testnet preset conflicts with running mainnet ports | Start failure or wrong RPC target | Use `18122`/`18888` defaults for testnet and preflight port checks. |
| Public RPC defaults stay mainnet while node is testnet | Dashboard and producer stats show wrong network | Make public RPC defaults network-scoped and show network badges everywhere. |
| Bundled Harbinger config does not match live testnet | Wrong chain ID from fresh testnet basedir | Add a verified `testnet-foundation` config source and assert chain ID. |
| Existing testnet basedir is normalized to `basedir/.koinos` | GUI starts from an empty/wrong path and appears unsynced | Preserve exact paths that already contain a node layout. |
| Mainnet contract constants are used on testnet | Wallet/producer reads and registration workflows query wrong contracts | Move KOIN/VHP/PoB addresses into the network registry and test both networks. |
| Existing users lose settings on migration | Bad upgrade experience | Backward-compatible parser; infer network from existing profiles. |
| Producer workflow accidentally changes key material | Production risk | Producer presets must not rewrite keys; Producer-tab actions stay explicit. |

## Acceptance Criteria for Release

- A fresh testnet observer can be launched from the GUI and reaches a non-zero head.
- The existing external SSD testnet basedir can be selected exactly, without `.koinos` suffix rewriting and without chain files being overwritten.
- A testnet producer can be launched from the GUI using existing key material and shows accepted produced blocks through public testnet RPC.
- Mainnet and testnet are visibly distinct in the UI.
- Mainnet defaults are unchanged for existing users.
- Automated UI and unit tests cover testnet presets, RPC routing, and basedir safety.
- Producer and wallet workflows use network-scoped contract constants.

## Suggested Implementation Order

1. Add the network registry, network-scoped constants, and persisted network setting.
2. Fix basedir normalization so existing node layouts are preserved exactly.
3. Add network-scoped config-template resolution and basedir safety checks.
4. Add network-aware presets and dynamic readiness port handling.
5. Add UI network selector and visible badges.
6. Route Explorer, Dashboard, Producer, and Wallet RPC plus contract constants by network.
7. Add testnet producer verification action.
8. Add tests and operator docs.

This order prevents the most dangerous failures first: selecting the wrong basedir, mixing chain files across networks, and querying the wrong network contracts. After those invariants are locked down, the remaining work is mainly UX, routing, and validation.
