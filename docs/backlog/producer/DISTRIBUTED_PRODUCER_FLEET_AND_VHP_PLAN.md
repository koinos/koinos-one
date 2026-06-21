# Distributed Producer Fleet And VHP Allocation Plan

- Date: 2026-06-19
- Scope: product and implementation plan for easy multi-producer operation
- First target: testnet simulation and testnet producer workflows
- Mainnet status: read-only planning only until explicit mainnet-safe approval

## Goal

Make it easy for a Teleno operator to run more than one producer node and distribute VHP across multiple independent producer addresses instead of concentrating all production weight in one node.

The desired operator experience is:

1. Install Teleno.
2. Restore a public bootstrap database without SSH credentials.
3. Create or import several producer profiles.
4. Assign each producer profile to a local or remote node.
5. Register each producer hot key.
6. Distribute VHP across producers.
7. Monitor the fleet from one dashboard.

This is not a protocol change. It is an operator workflow and safety layer around existing Koinos producer/VHP mechanics.

## Product Principle

A Teleno producer should not be treated as one monolithic identity forever. Operators should be able to split stake and production across multiple independent producer addresses, each with its own:

- producer-control address;
- registered hot public key;
- private producer key file;
- node basedir;
- node network;
- JSON-RPC port;
- P2P port;
- backup policy;
- health and production history.

Running several nodes with the same producer address and same key is not distributed production. That pattern can be useful for standby/failover, but active distributed production requires separate producer identities.

## Non-Goals

- Do not change PoB/VHP consensus rules.
- Do not automatically mutate mainnet producer registration, VHP burns, or transfers.
- Do not move mainnet VHP without explicit user review and transaction confirmation.
- Do not run multiple active producers with the same hot key by default.
- Do not expose local backup/admin APIs over the network.
- Do not make public bootstrap backups a trustless source until signed manifests are implemented.

## Safety Guardrails

Mainnet guardrails:

- Mainnet producer actions are read-only by default.
- Mainnet registration, VHP burn, VHP transfer, or producer-key changes require explicit confirmation.
- The UX must show network, signer, producer address, public key, transaction type, and estimated amount before signing.
- The UX must refuse hidden mainnet mutations from presets or background setup tasks.

Producer identity guardrails:

- A producer profile owns exactly one producer address.
- A producer profile owns exactly one active hot public key at a time.
- A hot private key must not be reused across unrelated producers unless the operator explicitly imports it.
- The UI must warn if two active profiles point to the same producer address or the same private key file.

Runtime guardrails:

- Every producer instance must have a distinct basedir.
- Every simultaneously running local node must have distinct JSON-RPC and P2P ports.
- A restored node must start as observer first.
- Block production must be enabled only after chain ID, head progress, registered key, and producer address checks pass.

## Core Concepts

### Producer Profile

A producer profile is a logical identity that can be assigned to a node runtime.

```ts
type ProducerProfile = {
  id: string
  label: string
  network: 'mainnet' | 'testnet'
  producerAddress: string
  hotPublicKey?: string
  hotPrivateKeyFile?: string
  registeredPublicKey?: string
  registrationStatus: 'unknown' | 'not_registered' | 'registered' | 'mismatch'
  vhpBalance?: string
  liquidKoinBalance?: string
  mana?: string
}
```

### Node Instance

A node instance is a runtime target that can run observer or producer mode.

```ts
type NodeInstance = {
  id: string
  label: string
  network: 'mainnet' | 'testnet'
  basedir: string
  configPath: string
  binaryPath: string
  jsonrpcListen: string
  p2pListen: string
  role: 'observer' | 'producer' | 'standby'
  assignedProducerProfileId?: string
  status: 'stopped' | 'starting' | 'running' | 'conflict' | 'error'
}
```

### VHP Allocation Plan

A VHP allocation plan is a proposed distribution of stake across producer profiles.

```ts
type VhpAllocationPlan = {
  network: 'mainnet' | 'testnet'
  sourceAddress: string
  totalAvailableVhp: string
  allocations: Array<{
    producerProfileId: string
    producerAddress: string
    targetVhp: string
    currentVhp?: string
    delta?: string
  }>
  mode: 'simulate' | 'dry_run' | 'submit'
}
```

The first implementation should support simulation and dry-run before any live transaction submission.

## Implementation Phases

### Phase 1 - Model And Read-Only Fleet Inventory

Objective: model multiple producer profiles and node instances without changing chain state.

Tasks:

1. Add persisted producer-profile storage.
2. Add persisted node-instance storage.
3. Detect duplicate basedirs, duplicate ports, duplicate producer addresses, and duplicate private-key paths.
4. Add read-only chain queries per profile:
   - producer key registration;
   - VHP balance;
   - liquid KOIN balance;
   - Mana;
   - recent produced blocks.
5. Add a Fleet view that lists all producer profiles and node instances.
6. Add testnet-only fixtures/tests first.

Exit criteria:

- Teleno can display several producer profiles without starting several nodes.
- Teleno can show which producer address has which registered key.
- Teleno can identify unsafe duplication before runtime.

### Phase 2 - Public Bootstrap For New Node Instances

Objective: create a new node instance quickly from a public read-only bootstrap backup.

Dependencies:

- `../../current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- implemented `--backup-public-list`
- implemented `--backup-public-fetch`
- implemented `--backup-public-restore`

Tasks:

1. Add "Create Node Instance" workflow.
2. Select network, basedir, ports, and role.
3. Check disk space before restore.
4. Restore from public testnet bootstrap.
5. Start as observer.
6. Verify chain ID and head progress.
7. Only then allow producer assignment.

Exit criteria:

- A new testnet observer can be created from the public bootstrap route.
- The operator does not need SSH credentials.
- The node starts observer-first and does not produce blocks automatically.

### Phase 3 - Assign Producer Profile To Node Instance

Objective: make producer assignment explicit and safe.

Tasks:

1. Add "Assign Producer" action on a node instance.
2. Require the node network to match the producer profile network.
3. Write `block_producer.producer` and `block_producer.private-key-file` only for the selected node instance.
4. Keep `features.block_producer: false` until validation passes.
5. Validate:
   - private key exists;
   - public key can be derived;
   - derived public key matches profile hot key;
   - registered public key matches the hot key;
   - node is synced enough to produce safely.
6. Add an explicit "Enable Producer" step after validation.

Exit criteria:

- Assigning a profile updates only the selected instance.
- The UI refuses producer mode when key registration is missing or mismatched.
- Testnet producer assignment can be validated without touching mainnet.

### Phase 4 - VHP Allocation Simulator

Objective: help operators plan a distributed VHP layout before moving stake.

Tasks:

1. Add a read-only VHP allocation screen.
2. Show current VHP per producer profile.
3. Show total VHP controlled by selected accounts.
4. Add allocation modes:
   - equal split;
   - weighted split;
   - manual amounts;
   - minimum per producer;
   - leave reserve.
5. Compute deltas between current and target allocations.
6. Flag concentration risk:
   - one producer above a configurable percentage;
   - too few producers;
   - stale/offline assigned node;
   - registered key mismatch.
7. Export the plan as JSON/Markdown for review.

Exit criteria:

- The operator can see how VHP would be distributed before submitting anything.
- The UI can explain whether VHP is concentrated in too few producers.
- No transaction submission is needed for this phase.

### Phase 5 - Testnet VHP Allocation Execution

Objective: execute allocation changes on testnet first.

Tasks:

1. Add testnet-only transaction dry-run for:
   - VHP burn;
   - VHP transfer/allocation operation, if supported by the contract flow;
   - producer-key registration.
2. Show exact transaction preview:
   - network;
   - signer;
   - producer address;
   - hot public key;
   - amount;
   - expected resulting allocation.
3. Require explicit confirmation for each submitted transaction.
4. Poll confirmation and refresh profile state.
5. Record transaction IDs in the profile history.

Exit criteria:

- Testnet allocation can be executed safely with explicit confirmations.
- Resulting VHP and registration state refresh correctly.
- No mainnet mutation code path is used.

### Phase 6 - Multi-Instance Local Runtime

Objective: run more than one local node instance from Teleno.

Tasks:

1. Extend the process manager from single managed node to multiple named node instances.
2. Allocate default ports per instance:
   - testnet JSON-RPC base `18122`, then `18123`, `18124`, ...
   - testnet P2P base `18888`, then `18889`, `18890`, ...
   - mainnet JSON-RPC base `8080`, then `8081`, `8082`, ...
   - mainnet P2P base `8888`, then `8889`, `8890`, ...
3. Detect port conflicts before start.
4. Keep logs separated per instance.
5. Show per-instance:
   - PID;
   - config path;
   - basedir;
   - version;
   - head height;
   - peer count;
   - producer status;
   - latest produced block.
6. Support start/stop/restart per instance.

Exit criteria:

- Two testnet observer instances can run locally without port conflict.
- One observer and one producer instance can run locally with separate basedirs.
- Teleno correctly attributes logs/status to each instance.

### Phase 7 - Remote Node Assignment

Objective: support remote distributed nodes without turning the local UX into an unsafe remote-control surface.

Tasks:

1. Add remote node records:
   - host;
   - SSH user;
   - base path;
   - node instance ID;
   - backup/bootstrap URL;
   - status endpoint or SSH health check.
2. Support bootstrap/install commands through SSH for Ubuntu hosts.
3. Keep remote backups and public bootstrap restore separate.
4. Use restricted users where possible.
5. Avoid storing raw passwords in app settings.

Exit criteria:

- A testnet remote observer can be installed from public bootstrap.
- A testnet remote producer can be assigned a producer profile after validation.
- Local and remote instances appear in the same Fleet view.

### Phase 8 - Mainnet Controlled Rollout

Objective: enable mainnet distributed-producer workflows only after testnet evidence.

Required evidence before implementation:

- Testnet public bootstrap restore validated from a fresh Mac basedir.
- Multi-profile testnet producer assignment validated.
- Testnet VHP allocation simulator validated.
- Testnet transaction submission validated with explicit confirmations.
- Multi-instance process manager validated.
- Backup/restore for producer-relevant files documented.

Mainnet rollout steps:

1. Read-only mainnet fleet inventory.
2. Mainnet VHP allocation simulator.
3. Mainnet dry-run transaction previews.
4. Explicitly gated mainnet transaction submission.
5. Small controlled mainnet operation with user review.

Exit criteria:

- Mainnet flows are impossible to trigger accidentally.
- The user can understand and approve every transaction before signing.
- Mainnet producer state is never changed by presets, startup, restore, or background jobs.

## UX Surfaces

### Fleet Tab

Recommended top-level or Node-panel surface:

- Producer Profiles
- Node Instances
- VHP Allocation
- Health/Warnings

### Producer Profile Details

Show:

- network;
- producer address;
- hot public key;
- registered public key;
- registration status;
- VHP;
- liquid KOIN;
- Mana;
- assigned node;
- last produced block;
- backup status.

### Node Instance Details

Show:

- basedir;
- config path;
- binary path;
- JSON-RPC listen;
- P2P listen;
- role;
- process status;
- public/private bootstrap source;
- assigned producer profile;
- validation checklist.

### VHP Allocation Screen

Show:

- total VHP;
- current distribution;
- target distribution;
- concentration warnings;
- proposed deltas;
- transaction previews;
- exportable plan.

## Test Plan

Unit tests:

- producer profile normalization;
- duplicate producer address detection;
- duplicate private-key path detection;
- duplicate basedir detection;
- port allocation;
- VHP allocation math;
- concentration warning thresholds;
- network mismatch rejection.

Integration tests:

- create testnet observer instance from public bootstrap fixture;
- assign testnet producer profile to instance;
- validate registered-key mismatch behavior;
- simulate VHP allocation plan;
- start two local testnet instances with separate ports;
- verify logs/status separation.

Manual testnet acceptance:

- Create two testnet producer profiles.
- Bootstrap two testnet basedirs from public read-only backup.
- Assign one profile to each basedir.
- Register producer keys on testnet.
- Split testnet VHP across both producers.
- Run both producers and verify produced blocks through public testnet RPC.

## Open Questions

- Whether Koinos VHP can be directly transferred or whether the workflow should model VHP distribution as KOIN funding plus per-producer burn.
- Whether the first Fleet UI should be single-machine only or include remote node records immediately.
- Whether standby/failover nodes with the same producer profile should be explicitly modeled separately from distributed active producers.
- What default concentration threshold should trigger warnings: 50%, 67%, or operator-configurable.

## Recommended Sequencing

1. Finish public bootstrap restore with a sanitized testnet snapshot.
2. Add producer-profile and node-instance models.
3. Add read-only Fleet view.
4. Add testnet producer assignment validation.
5. Add VHP allocation simulator.
6. Add testnet allocation execution.
7. Add multi-instance runtime.
8. Add remote-node installation.
9. Only then consider mainnet mutation workflows.
