# Multi-Node Remote Installation And Management Plan

> Archived 2026-07-09. Superseded by
> [`docs/backlog/operations/NODE_FLEET_STRATEGY.md`](../../../backlog/operations/NODE_FLEET_STRATEGY.md),
> which merges, prunes, and re-sequences this plan. Retained for the
> detailed test matrices, live-evidence records, and design rationale.


- Date: 2026-06-26
- Scope: remote installation and management of multiple Koinos One / Teleno
  nodes
- Status: safe MVP implemented for dry-run planning, local-only inventory
  persistence, confirmed one-node testnet observer execution adapter, remote
  health parsing, sanitized receipts, GUI review flow, simple human UX,
  provider-neutral server checklist and sanitized metadata import, real
  Electron/IPC validation, sanitized LAN read-only validation, and one VPS1
  testnet observer install/restore/start live validation; prodnet mutation is
  limited to the gated one-node observer path

## Goal

Define an operator-safe plan for installing, upgrading, monitoring, recovering,
and managing multiple local and remote `teleno_node` instances without exposing
private inventory data or creating hidden mainnet mutation paths.

The target outcome is a plan that another engineer can implement later without
inventing the architecture, safety model, rollout order, or acceptance gates.

## Implemented MVP Slices

The first implementation slice converted Phase 1 and Phase 2 into a local
dry-run product surface:

- `src/app/remote-nodes.ts` defines sanitized fleet records, node roles,
  observer-first safety defaults, inventory validation, and deterministic
  per-node command-plan generation.
- `src/components/panels/RemoteNodesPanel.tsx` adds a `Remote` GUI surface that
  shows sanitized node inventory and reviewable command plans.
- Simple mode exposes only add server, restore public backup and start
  observer, stop/restart, health, logs, and receipts. It hides command plans,
  rollback, cleanup, raw config editing, backup-publication controls, and
  producer controls.
- Expert mode adds guarded diagnostics and host-mutation plans: logs, stop,
  restart, upgrade, rollback, and cleanup.
- Public bootstrap restore is the standard restore path in generated observer
  plans, and generated configs keep `block_producer: false`.

The second implementation slice adds the first execution-capable but gated
remote management layer:

- `src/app/remote-node-execution.ts` defines renderer-side confirmation,
  redaction, health parsing, stop criteria, and sanitized receipt helpers.
- `electron/lib/teleno-storage.ts` persists local-only remote inventory and
  execution receipts under the Electron `userData` config area, not in the Git
  worktree.
- `electron/lib/remote-node-service.ts` adds an SSH-backed command-plan executor
  that only accepts generated SSH heredoc steps for one selected testnet
  observer after exact confirmation.
- `electron/preload.ts`, `electron/main.ts`, and
  `electron/lib/ipc-handlers.ts` expose inventory load/save, receipt loading,
  and confirmed execution through explicit IPC channels.
- `src/components/panels/RemoteNodesPanel.tsx` now supports local inventory
  editing, save/remove/add, dry-run command preview, exact confirmation,
  streamed per-step execution progress/output, health state updates, and local
  receipt display.
- Remote health plans collect read-only host, runtime, config, loopback bind,
  log, and JSON-RPC head signals where safely reachable.
- Execution and receipts redact secret-looking values, raw SSH targets, and IP
  addresses from output.
- Remote execution streams sanitized step lifecycle events over Electron IPC
  while SSH is running. Simple mode shows human phase states; expert mode can
  show sanitized excerpts, and receipts store per-step summaries.
- Expert rollback and cleanup are executable for safe testnet observer cases
  only after strong `PRESERVE_DB` confirmation, prior evidence, DB preservation
  steps, stop-criteria checks, and sanitized receipts. Prodnet/mainnet mutation
  stays blocked.
- The generated Docker testnet observer plan now matches the live proven flow:
  safe user-home basedir, Docker-based public restore/list, loopback JSON-RPC,
  expected testnet P2P container mapping, no invalid shell `pipefail` dependency,
  and observer-only config with block production disabled.
- `RemoteNodesPanel` includes a provider-neutral "bring your own server"
  checklist and a sanitized metadata import flow for existing VPS records.
  Provider API provisioning remains out of scope for this MVP.
- Playwright screenshots cover simple mode, expert mode, confirmation,
  execution result/receipts, and Spanish simple mode under
  `test-results/remote-mvp/`.
- Real Electron/IPC Playwright coverage launches the packaged Electron entry
  with the real preload bridge and a temporary `userData` directory. It verifies
  inventory load/save, reload persistence, local receipt loading, simple-mode
  hidden dangerous controls, expert diagnostics visibility, and screenshot
  capture under `.run/remote-node-ui-screenshots/`.
- LAN Server read-only integration is covered by an opt-in real Electron/IPC
  Playwright test. The test discovers the local-only LAN observer target at
  runtime, imports a sanitized node record through the real preload bridge,
  executes one confirmed read-only health plan through IPC/SSH, stores a
  sanitized healthy receipt, reviews expert logs diagnostics, and verifies that
  a mutating prodnet stop plan remains blocked. Screenshots are captured with
  sensitive values masked.
- `RemoteNodesPanel` now selects the node referenced by the newest local
  receipt on initial load when the user has not chosen another node, avoiding a
  confusing prodnet selection next to a testnet receipt after reload.
- Sanitized real-environment validation was completed with LAN Server read-only
  checks and VPS1 testnet observer execution. LAN validation performed no
  service mutation and detected active legacy/prod workloads plus a separate
  Teleno observer service. VPS1 validation used a disposable testnet basedir
  and one sanitized local SSH alias. The first confirmed GUI/IPC run executed
  the public bootstrap restore path and preserved the restored state when the
  test harness stopped before runtime start. A follow-up confirmed GUI/IPC
  `start-observer` run started the observer container from that preserved
  state. Initial post-start diagnostics found the generated observer config was
  missing seed peers, leaving the node running but not syncing. The generator
  now writes observer-safe P2P listen and seed-peer config, and a confirmed
  GUI/IPC `restart` reconciled the VPS1 testnet observer config without
  clearing state. A final confirmed GUI/IPC `status` run plus read-only
  post-checks verified the observer was running, configured for testnet, had
  block production disabled, used the public bootstrap source, answered local
  JSON-RPC head checks, had connected-peer signal, advanced head, had no public
  JSON-RPC/admin exposure, and showed no recent stop-criteria signals in the
  sampled logs. Existing unrelated services were not stopped, cleaned, or
  overwritten.

Current hard limits:

- No remote action runs automatically or in the background.
- Prodnet/mainnet remote mutation remains blocked except for the narrow
  one-node observer install/restore/start path after artifact trust, bootstrap
  policy, dry-run proof, loopback, observer-only, and strong confirmation gates
  pass. Read-only health and log diagnostics can execute after exact per-node
  confirmation.
- Producer activation remains unavailable.
- Provider integration is local metadata import only. No provider API token,
  infrastructure creation, resize, reboot, deletion, firewall mutation, or
  billing action exists in this MVP.
- Rollback and cleanup execution are available only for selected testnet
  observers when prior evidence and DB-preservation gates pass. They do not
  delete chain/state DB.
- The testnet observer install/restore/start path is implemented as a confirmed
  execution path and has sanitized live acceptance evidence. Re-running install
  over an existing restored basedir is blocked; follow-up start/status actions
  require exact per-node confirmation. Automatic prodnet rollback/cleanup and
  deep DB compaction remain future-gated.

## Non-Goals

- Do not execute prodnet producer, wallet, VHP, registration, or ungated
  prodnet remote mutations from this flow.
- Do not mutate producer profiles, wallets, VHP, or chain state.
- Do not publish or commit private hostnames, IP addresses, SSH users, producer
  addresses, wallet data, tokens, private keys, or live server inventory.
- Do not expose backup admin APIs, JSON-RPC, producer controls, or secret
  material on public network interfaces.
- Do not enable mainnet block production, producer registration, VHP burns, or
  producer-key changes from any background or preset workflow.

## Planning Inputs

This plan is based on the current public project documentation:

- `AGENTS.md`
- `docs/README.md`
- `docs/current/README.md`
- `docs/current/monolith/CURRENT_MONOLITH_STATUS.md`
- `docs/current/operations/README.md`
- `docs/backlog/README.md`
- teleno startup guide: https://github.com/koinos/teleno/blob/main/docs/operations/start-node.md
- teleno container guide: https://github.com/koinos/teleno/blob/main/docs/operations/container.md
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- `docs/current/operations/PRODNET_OBSERVER_DOCKER_DEPLOYMENT.md`
- `docs/backlog/backup-restore/NATIVE_BACKUP_REMAINING_WORK_PLAN.md`
- `docs/backlog/backup-restore/PUBLIC_BOOTSTRAP_RESTORE_REMAINING_WORK_PLAN.md`
- `docs/backlog/backup-restore/PRODNET_PUBLIC_BOOTSTRAP_PUBLICATION_PLAN.md`
- `docs/backlog/backup-restore/PUBLIC_BOOTSTRAP_DISK_OPTIMIZATION_IDEA.md`
- `docs/backlog/networking/P2P_PUBLIC_PEER_IDENTITY_PLAN.md`
- `docs/backlog/producer/NETWORK_SCOPED_PRODUCER_WALLET_PLAN.md`
- `docs/backlog/producer/DISTRIBUTED_PRODUCER_FLEET_AND_VHP_PLAN.md`

Private inventory files and real host records are intentionally not copied into
this plan. Implementation must keep local-only inventory data out of committed
documentation.

Remaining MVP implementation tracking lives in
`REMOTE_NODES_REMAINING_MVP_IMPLEMENTATION.md`.

## Operating Principles

1. Observer-first is mandatory. A restored or newly installed node starts as an
   observer. Producer mode is a separate explicit activation after health,
   chain, key, and registration checks pass.
2. Remote control is conservative. The first implementation should use SSH to
   run explicit, reviewable commands on known hosts. A persistent remote agent
   is a later option, not the default.
3. Public bootstrap and private backup are different flows. Public bootstrap is
   read-only and used for first install. Private backup is operator-owned and
   authenticated.
4. Admin APIs remain local-only. Remote UX may reach local admin endpoints only
   through SSH tunnels or host-local helpers. Public interfaces must not expose
   backup or producer controls.
5. Every action is scoped to one node instance. A multi-node operation expands
   into per-node plans with per-node preflight, execution, verification, and
   rollback. The first implementation includes an expert batch review surface,
   but execution remains strictly sequential and stops before the next node
   after any unsafe result.
6. Mainnet mutation is never implicit. The first prodnet mutation path is
   observer-only install/restore/start, one node at a time, and requires
   artifact digest pinning, reviewed bootstrap policy, prior dry-run proof,
   loopback RPC/admin, producer disabled, matching plan evidence, and strong
   `OBSERVER_ONLY` confirmation. Producer registration, VHP changes,
   producer-key changes, wallet sends, and enabling mainnet production require a
   fresh explicit user request and a reviewable dry-run.
7. Inventory is split into public metadata and private secrets. Committed docs
   may define schema and examples with placeholders only. Real values belong in
   ignored local inventory or the operator's secret manager.
8. Rollout is phased. Testnet observers come first, then testnet producers,
   then prodnet observers, and only later controlled prodnet producer workflows.
9. Simple mode must be human-first. The default experience should feel like
   restoring and starting a safe observer, not like editing infrastructure.
   Advanced node, SSH, command, backup-publication, and producer concepts must
   stay hidden until they are needed or expert mode is enabled.

## Target Simple Human Experience

The remote-node flow should become easy enough for a non-specialist operator to
launch and understand without reading command output. The ideal simple-mode path
is:

1. Choose or add a server by a friendly alias.
2. Choose the network.
3. Click one primary action: restore public backup and start observer.
4. Let Koinos One propose a safe default basedir:
   `~/koinos-one/nodes/<network>/<node-alias>/basedir`.
5. Show a short preflight summary: available disk, selected public bootstrap,
   JSON-RPC loopback binding, public P2P port, and observer-only status.
6. Ask for one clear confirmation.
7. Install, restore, start, and verify the observer.
8. End on a plain state: running, syncing, stopped, failed, or unsafe.

Simple mode should expose only:

- add server;
- restore public backup and start observer;
- stop;
- restart;
- health;
- sanitized logs;
- receipts.

Simple mode should not expose command plans, SSH internals, producer controls,
backup-publication controls, raw config editing, cleanup, rollback, or public
admin options as primary actions. Those controls belong in expert mode, behind
explicit context and safety gates.

The UI should translate technical failures into action-oriented states:

- `Needs server`: no reachable server or connection reference.
- `Needs space`: disk floor failed before restore.
- `Installing`: artifact and config are being prepared.
- `Restoring`: public bootstrap restore is active.
- `Starting`: observer process is being launched.
- `Syncing`: node is running and head is advancing.
- `Running`: observer is healthy.
- `Unsafe`: role, network, public bind, producer, or chain invariant failed.
- `Failed`: the operation stopped and the receipt points to sanitized logs.

The operator should be able to ignore expert details unless an error occurs.
When an error occurs, simple mode should show the human reason and next safe
action; expert mode can reveal the generated commands and diagnostics.

## Virtual Server Provider Integration

Provider integration is possible, but it should be treated as an optional layer
above the SSH-based remote-node model. The core product should remain able to
manage any user-provided Linux server through an SSH alias, because that keeps
Koinos One portable and avoids locking the safety model to one vendor API.

Recommended provider integration depth by phase:

### Phase A - Bring Your Own Server

Use the current model: the user creates a VPS manually, adds an SSH alias, and
Koinos One installs a safe observer. This is the safest first release because
the app does not hold provider API tokens or create billable infrastructure.

### Phase B - Guided Provider Checklist

Koinos One can show a provider-neutral checklist:

- minimum disk, CPU, RAM, and bandwidth profile;
- recommended region selection guidance;
- SSH key requirement;
- firewall rule summary: public P2P allowed only when requested, JSON-RPC and
  admin APIs loopback-only;
- suggested server name and basedir;
- copyable SSH alias template.

No provider token is required in this phase.

### Phase C - Provider Adapter For Existing Instances

Implemented for the current MVP as a local metadata import, not as a live
provider API client. The operator may paste sanitized JSON or key/value provider
CLI output for existing instances. Koinos One redacts the preview, validates the
input, and converts approved records into observer-only inventory entries.

The importer supports:

- instance label;
- provider name and provider instance ID/reference;
- region;
- OS image;
- CPU/RAM/disk summary;
- basic lifecycle state;
- public/private address presence only as booleans or redacted placeholders;
- suggested local SSH alias.

The committed fleet record must still store only sanitized provider references,
not raw IPs, hostnames, usernames, provider tokens, paths, or private
inventory. No provider token is accepted or stored by this MVP path, and the app
does not create, resize, delete, reboot, or firewall provider resources.

### Phase D - One-Click Testnet Observer Provisioning

After the SSH install flow is proven, Koinos One can provision a disposable
testnet observer from a provider API:

1. user selects provider, region, and size profile;
2. Koinos One shows estimated monthly cost if the provider exposes it;
3. user confirms infrastructure creation;
4. app creates or selects an SSH key;
5. app creates the VPS;
6. app applies firewall rules: P2P public if selected, JSON-RPC/admin blocked
   from public internet;
7. app waits for SSH readiness;
8. app imports the instance into local-only inventory;
9. app runs the normal observer-first install/restore/start flow.

This should be testnet-only until the provider and SSH flows have repeated
acceptance evidence.

### Phase E - Production Provider Operations

Only after prodnet observer canaries are proven, provider adapters may support:

- start/stop/reboot instance;
- resize disk or server size with explicit downtime warning;
- provider snapshot before upgrade;
- firewall audit;
- controlled destruction with typed confirmation;
- receipt export without private provider data.

Provider automation must not enable producer mode, change wallet state, or
submit transactions. It manages infrastructure only; node role changes remain
governed by the Koinos One safety model.

Provider tokens should never be stored raw in project files. Acceptable storage
options are OS keychain references, external secret-manager references, or
session-only tokens. All logs and receipts must redact provider tokens,
instance addresses, and account identifiers unless the user explicitly exports a
private local report.

## Target Architecture

The remote management model should use four layers:

1. **Fleet inventory**: a local desired-state catalog describing nodes, roles,
   networks, release channels, ports, backup policies, and safety flags.
2. **Execution adapter**: an SSH-backed executor for Linux remote hosts and a
   local executor for the desktop host. The executor runs generated command
   plans, not ad hoc shell snippets.
3. **Verification loop**: per-node health checks that compare expected state
   against observed state before moving to the next rollout step.
4. **Provider adapter**: an optional provisioning layer that creates or imports
   VPS instances and then hands them to the same fleet inventory and SSH
   execution flow.

The first implementation should not require a long-running remote daemon. It
can use:

- Docker for Linux observer/producer runtime where the container image is the
  release artifact;
- systemd for long-running Linux services when the binary is installed directly;
- launchd only for macOS local managed nodes;
- SSH tunnels for remote loopback JSON-RPC or backup admin checks;
- signed or hash-pinned artifacts before any upgrade.

A later implementation may add a remote agent after the SSH-based model has
clear command semantics, auth boundaries, and audit logs.

## Safe Inventory Model

Inventory must be structured enough to drive automation, but safe enough to
review and export without secrets.

### Public/Sanitized Fleet Record

Example schema using placeholders only:

```yaml
fleet:
  version: 1
  nodes:
    - id: prodnet-observer-a
      label: "Prodnet Observer A"
      network: mainnet
      role: observer
      environment: prodnet
      host_ref: host-prodnet-a
      connection_ref: ssh-prodnet-a
      runtime:
        kind: docker
        image: ghcr.io/koinos/teleno:beta
        expected_version: "<teleno_node-version-or-commit>"
      paths:
        basedir: "<remote-basedir>"
        config: "<remote-basedir>/config.yml"
      ports:
        jsonrpc_host_bind: "127.0.0.1:<host-jsonrpc-port>"
        p2p_public: "<public-p2p-port>"
      backup:
        public_bootstrap_url: "<public-bootstrap-url>"
        private_backup_policy_ref: optional-private-backup-policy
      producer:
        enabled: false
        profile_ref: null
      safety:
        observer_first_required: true
        mainnet_mutation_allowed: false
        remote_admin_public_exposure_allowed: false
```

### Private Inventory And Secrets

Private inventory must remain outside committed docs and code. It may contain:

- real hostnames, IP addresses, SSH usernames, and SSH aliases;
- provider instance IDs;
- firewall management details;
- private backup SFTP targets;
- key-file paths;
- token-file paths;
- operator contact and escalation details.

Raw secrets must not be stored in the fleet record. Store only references to
operator-managed files or secret-manager entries:

```yaml
connections:
  - id: ssh-prodnet-a
    host_alias: "<local-ssh-config-alias>"
    auth_ref: "<operator-secret-manager-ref-or-key-file-ref>"
```

### Inventory Acceptance Criteria

- A sanitized inventory can be committed without exposing host IPs, SSH users,
  producer addresses, tokens, or key paths.
- A private inventory can be ignored by Git and loaded locally.
- Every node has a unique `id`, `basedir`, JSON-RPC port, P2P port, and runtime
  label.
- Duplicate producer addresses, duplicate hot-key files, duplicate basedirs,
  and duplicate ports are flagged before any command runs.

## Node Roles

### Observer

Observer nodes sync, serve local JSON-RPC, optionally expose P2P, and do not
mount wallet or producer-key material.

Required defaults:

- `features.block_producer: false`
- startup flag disables `block_producer`
- JSON-RPC bound to host loopback
- P2P may be public if the operator intentionally exposes it
- backup admin bound to loopback only when enabled

### Public Bootstrap Source

A public bootstrap source publishes sanitized read-only backup snapshots.

Required defaults:

- source basedir is observer-only;
- published snapshot contains only allowed runtime files;
- public metadata is signed when signature enforcement is available;
- `latest.json` is published last;
- previous `latest.json` is retained for rollback.

### Private Backup Source

A private backup source creates authenticated local or remote SFTP backups for
the operator.

Required defaults:

- private backup credentials are file references or secret-manager references;
- remote SFTP write access is not reused for public bootstrap;
- retention policy is explicit;
- restore starts observer-first.

### Producer

Producer nodes can produce only after a producer profile is explicitly assigned
and validated.

Required defaults:

- no producer private key in public bootstrap snapshots;
- one active producer profile per producer node;
- chain ID, network, producer address, derived public key, registered public
  key, VHP, and head progress verified before enabling production;
- mainnet producer activation requires a fresh explicit request.

### Standby

Standby nodes are prepared observers with producer configuration staged but
block production disabled. They are useful for disaster recovery but must not be
confused with distributed active production.

Required defaults:

- producer key may be present only if explicitly provisioned;
- block production remains disabled;
- activation requires the same checks as a producer.

## Installation Workflow

Remote installation should be generated as a node-specific command plan with
the following phases.

### 1. Host Preflight

Collect and verify:

- OS and architecture;
- CPU, RAM, disk size, disk free space, filesystem type;
- Docker availability or systemd availability;
- inbound P2P firewall status when a public peer is intended;
- outbound HTTPS access to the public bootstrap URL;
- outbound access to configured seed peers;
- whether the target basedir is empty, existing, or requires migration;
- whether JSON-RPC and P2P ports are already in use.

Refuse install when:

- disk free space is below the selected restore mode's minimum;
- JSON-RPC would bind publicly by default;
- a non-empty basedir would be overwritten without explicit confirmation;
- block production would be enabled before observer validation;
- the configured network does not match the selected bootstrap metadata.

### 2. Artifact Selection

Select one artifact source:

- Docker image tag pinned by release channel and commit tag;
- signed native binary package;
- local development binary only for testnet or explicit developer validation.

Every install plan must record:

- product version;
- build timestamp when available;
- Git commit;
- release channel;
- native node build identity;
- expected SHA-256 or container digest.

### 3. Base Directory Preparation

Create only the directories required for the selected node:

- basedir;
- config path;
- logs path if externalized;
- backup repository or workspace path when configured;
- P2P identity path when public identity persistence is implemented.

Do not create wallet, producer-key, or signing-key paths for observer installs.

### 4. Observer-Safe Config Generation

Generate network-specific config with:

- correct chain/network profile;
- `chain.verify-blocks: true` after restore;
- `features.block_producer: false`;
- loopback JSON-RPC host binding;
- public P2P only when requested;
- backup admin disabled or loopback-only with token-file reference;
- public bootstrap URL and signature policy;
- no private remote backup credentials unless the node is explicitly configured
  as a private backup source.

### 5. Public Bootstrap Restore

For a first install:

1. list the public snapshot;
2. verify network, chain ID, metadata, signature policy, object count, and byte
   estimates;
3. run disk-space preflight;
4. restore into the empty basedir;
5. preserve active config behavior and restored config receipt;
6. write restore evidence;
7. start observer only.

When low-disk restore modes are implemented, the install plan must make the
restore mode explicit:

- retain repository;
- restore and prune;
- streaming restore.

### 6. First Start

Start the node as observer and require:

- process/container is running;
- RocksDB opens;
- `[node] teleno_node ready` appears;
- chain ID matches expected network;
- head height and LIB are readable;
- head advances or is already near the configured target;
- peer count is above the role-specific minimum;
- block production is disabled.

### 7. Install Evidence

Write an install receipt outside the chain database:

```yaml
install_receipt:
  node_id: prodnet-observer-a
  operation_id: "<uuid>"
  started_at: "<timestamp>"
  completed_at: "<timestamp>"
  artifact: "<image-digest-or-binary-sha256>"
  network: mainnet
  role: observer
  bootstrap_id: "<backup-id-or-none>"
  result: success
  checks:
    chain_id: passed
    observer_first: passed
    jsonrpc_loopback: passed
    p2p_listen: passed
    head_progress: passed
```

The receipt must not contain secrets, raw tokens, private host data, or producer
private-key paths.

## Upgrade Workflow

Upgrades must be staged and reversible.

### Upgrade Preflight

Before upgrading a node:

- confirm current artifact version and target artifact version;
- confirm current node role and network;
- confirm head, LIB, peer count, disk free space, and recent severe log status;
- create or verify a recent backup when the node has state worth preserving;
- verify target artifact signature/hash/digest;
- verify the new artifact includes required CLI/config surfaces for the node
  role;
- verify rollback artifact is still available.

### Upgrade Execution

Recommended order:

1. canary one testnet observer;
2. expand to testnet observers;
3. canary one testnet producer;
4. expand to testnet producers;
5. canary one prodnet observer;
6. expand to prodnet observers;
7. consider prodnet producer upgrades only after explicit review.

Per node:

1. stop service/container cleanly;
2. keep basedir intact;
3. replace or pull artifact;
4. start with the same role and network;
5. verify health gates;
6. record upgrade receipt.

### Upgrade Rollback

Rollback is allowed when the state database has not been migrated in a
forward-only way. Rollback steps:

1. stop the node;
2. restore previous artifact;
3. keep basedir unchanged;
4. start as observer unless producer reactivation is explicitly approved;
5. verify chain ID, head/LIB, peer count, and logs;
6. if state is incompatible, restore from the pre-upgrade backup as observer.

## Remote Management Operations

Each remote operation should be generated as a dry-run plan before execution.

Required operation classes:

- install observer;
- restore from public bootstrap;
- start node;
- stop node;
- restart node;
- upgrade artifact;
- run health check;
- collect sanitized logs;
- list local/private/public backups;
- create private backup;
- restore backup as observer;
- assign producer profile;
- enable producer mode;
- disable producer mode;
- rollback artifact;
- rollback restore.

Every operation should declare:

- target node IDs;
- required role;
- required network;
- whether chain mutation is possible;
- whether host mutation is possible;
- required confirmations;
- preflight checks;
- execution steps;
- verification checks;
- rollback steps.

## Confirmation Policy

### No Fresh Confirmation Required

These operations can be offered as normal remote management actions after
preflight:

- observer health check;
- sanitized log collection;
- public snapshot list;
- local node status;
- stop/restart observer;
- upgrade testnet observer;
- install testnet observer into an empty basedir.

### Explicit Confirmation Required

These operations require a confirmation naming the node, network, role, and
target artifact or backup:

- prodnet observer install;
- prodnet observer upgrade;
- restore into a non-empty basedir;
- private backup deletion;
- rollback from backup;
- firewall changes;
- exposing a public P2P port;
- enabling backup admin, even loopback-only;
- assigning a producer profile.

### Fresh Mainnet Producer Confirmation Required

These operations require a fresh explicit user request, dry-run, and reviewable
plan:

- enabling mainnet block production;
- writing mainnet producer config;
- producer-key registration;
- VHP burn or transfer;
- wallet send;
- changing default account;
- any transaction signing/submission.

## Configuration By Network

### Testnet

Allowed first:

- public bootstrap restore;
- observer install;
- producer assignment validation;
- VHP allocation simulator;
- explicit testnet producer-key registration and VHP workflows after dry-run.

Defaults:

- JSON-RPC loopback;
- public P2P optional;
- producer disabled after restore;
- separate testnet wallet/profile namespace.

### Mainnet / Prodnet

Allowed first:

- read-only inventory;
- observer install;
- observer public bootstrap restore;
- observer backup;
- observer health monitoring.

Defaults:

- JSON-RPC loopback;
- producer disabled;
- `chain.verify-blocks: true` after restore;
- no wallet or producer-key files mounted for observer roles;
- public bootstrap signature required once signed prodnet publication is
  approved.

Disallowed without fresh explicit approval:

- producer activation;
- producer-key registration;
- VHP or wallet mutation;
- config writes targeting a mainnet producer.

### Custom Network

Custom networks require:

- explicit chain ID;
- explicit genesis/descriptors source;
- explicit bootstrap source or empty genesis sync plan;
- isolated wallet/profile namespace;
- no assumption that testnet or mainnet safety checks apply unchanged.

## Runtime Supervisors

### Docker

Preferred first target for Linux remote observers because it provides a stable
release artifact and does not require build dependencies on the host.

Plan requirements:

- pin image by digest or commit tag for controlled rollout;
- mount basedir as a host volume;
- bind JSON-RPC to host loopback;
- expose P2P only when requested;
- never bake secrets into the image;
- mount key files only for explicitly producer-enabled nodes.

### systemd

Useful for native binary installations after direct Linux packaging is signed
off.

Plan requirements:

- unit file generated from node inventory;
- environment file contains no raw secrets;
- service user is restricted;
- restart policy is explicit;
- logs are available through journald and optional file logs;
- stop timeout is long enough for clean RocksDB shutdown.

### launchd

Limited to local macOS managed nodes.

Plan requirements:

- one launchd label per node instance;
- separate basedirs and ports;
- no background producer activation;
- GUI remains source of truth for visible node state.

## Health Checks

Health checks should be read-only and safe to run repeatedly.

### Required Checks

- process/container status;
- artifact version and commit;
- config network;
- chain ID;
- head height;
- LIB height;
- head progress over a sample window;
- peer count and peer churn;
- JSON-RPC loopback reachability;
- P2P listen state;
- disk free space and basedir size;
- severe log scan;
- backup freshness when backup policy is enabled;
- producer disabled/enabled state matches intended role.

### Producer-Specific Checks

- producer address matches assigned profile;
- hot public key derived from the private key matches profile;
- registered public key matches hot key;
- VHP and liquid KOIN state are readable;
- latest produced block is recent enough for expected stake;
- no duplicate active node uses the same producer profile unless explicitly in
  standby/failover mode.

### Health States

Use a small state model:

- `unknown`: no recent check;
- `preflight_failed`: action must not run;
- `installing`: operation active;
- `recovering`: node is applying validation or restore recovery;
- `healthy`: all required checks pass;
- `degraded`: running but one or more non-fatal checks fail;
- `unsafe`: role or network safety invariant failed;
- `stopped`: process intentionally stopped;
- `failed`: process or required check failed.

## Logs And Diagnostics

Remote diagnostics must produce sanitized bundles.

Allowed contents:

- node version;
- config with secrets redacted;
- recent logs with token, key, and credential patterns redacted;
- health-check JSON;
- disk and memory summary;
- Docker/systemd status;
- backup metadata without credential paths;
- public peer ID and public multiaddr when intentionally configured.

Disallowed contents:

- private keys;
- wallet files;
- raw admin bearer tokens;
- SSH passwords/passphrases;
- private inventory files;
- real producer private key paths in committed reports;
- unredacted private hostnames/IPs in public docs.

## Backup And Restore Policy

### Public Bootstrap

Use for first install and low-trust read-only restore. It must:

- require HTTPS;
- verify content-addressed object hashes;
- verify signatures where configured;
- validate network and chain ID;
- start restored nodes as observers;
- never include wallet files, producer private keys, SSH credentials, admin
  tokens, or private backup config.

### Private Backup

Use for operator-owned recovery and migration. It must:

- use local repository and optional private SFTP;
- keep credentials outside committed config;
- support list, preflight, restore, and selected backup IDs;
- expose admin routes only on loopback with bearer token;
- preserve existing state under `.pre-restore` during activation;
- force observer-first restart after restore.

### Recovery From State Merkle Mismatch

If a node reports `block previous state merkle mismatch` or a persistent state
merkle mismatch:

1. stop rollout for that node group;
2. preserve the existing state DB;
3. do not clear `chain/blockchain`;
4. do not start from an empty state DB as the first action;
5. do not force a full resync as the first action;
6. start recovery as observer with validation enabled;
7. collect sanitized logs and exact block height/error;
8. compare with known replay/recovery documentation;
9. consider restore from a known-good backup only after validation recovery
   fails and the operator approves;
10. re-enable producer mode only after observer health passes.

## Producer Safety Plan

Producer management is a separate layer above node management.

### Producer Profile Rules

- A profile belongs to one network namespace.
- A profile owns one producer address.
- A profile owns one active hot public key.
- A node can have zero or one assigned producer profile.
- Two active producers must not share one private key by default.
- Duplicate producer address or key-file use is a hard warning and may be a
  hard stop outside explicit standby mode.

### Producer Activation Flow

1. install or restore node as observer;
2. verify chain ID and head progress;
3. assign producer profile;
4. validate private key file presence locally on the target node;
5. derive hot public key;
6. compare derived key with profile;
7. compare registered public key with profile;
8. verify VHP and account state;
9. run dry-run config diff;
10. require explicit operator confirmation;
11. enable producer mode;
12. monitor first production window;
13. record activation receipt.

### Mainnet Producer Hard Stops

The tool must refuse to proceed when:

- selected network is not clearly mainnet but the producer profile is mainnet;
- signer/profile namespace does not match selected network;
- registered public key is missing or mismatched;
- node has not passed observer health;
- the operation was triggered by install, restore, startup, backup, or upgrade
  without a fresh explicit producer activation request.

## Rollout Strategy

### Phase 0 - Documentation And Dry-Run Design

Deliver this plan, command-plan schema, inventory schema, safety model, and test
matrix before writing implementation code.

### Phase 1 - Read-Only Fleet Inventory

Implement only inventory loading, duplicate detection, and read-only health
modeling. No remote commands yet.

Implementation status: completed as local-only inventory persistence, sanitized
validation, and read-only remote health command planning/parsing.

Exit criteria:

- sanitized inventory validates;
- duplicate ports/basedirs/profiles are flagged;
- no secrets are required.

### Phase 2 - Remote Observer Dry-Run

Generate install/upgrade/check command plans without executing them.

Implementation status: completed in the Remote GUI and shared command-plan
generator.

Exit criteria:

- dry-run plans are deterministic;
- plans name every host mutation;
- plans classify required confirmations.

### Phase 3 - Testnet Remote Observer Install

Execute install on one testnet observer using public bootstrap.

Implementation status: adapter implemented behind exact confirmation for one
selected testnet observer. Sanitized live acceptance evidence has been recorded
for one explicitly selected testnet observer.

Exit criteria:

- observer restores and starts;
- chain ID matches;
- head advances;
- block production disabled.

### Phase 4 - Testnet Multi-Node Operations

Manage at least two testnet observers.

Exit criteria:

- separate basedirs and ports;
- independent health status;
- restart/upgrade one node without disrupting the other.

### Phase 4.5 - Simple-Mode Human UX Signoff

Validate the end-to-end simple-mode experience with a non-expert operator
mental model before adding broader prodnet automation.

Implementation status: implemented for the Remote panel. Simple mode now keeps
commands and dangerous controls hidden, proposes the safe basedir, shows a
provider-neutral server checklist, and has Playwright screenshot evidence.

Exit criteria:

- add server, restore public backup, start observer, stop/restart, health,
  sanitized logs, and receipts are usable without reading command output;
- default basedir is proposed automatically and is understandable;
- all dangerous or advanced controls are hidden from simple mode;
- failure states give a human reason and next safe action;
- screenshots or Playwright evidence prove the UI fits and text does not
  collide at expected desktop window sizes.

### Phase 4.6 - Provider-Neutral Server Checklist And Metadata Import

Add a guided "bring your own server" path before any provider API integration.

Implementation status: implemented as a checklist plus a sanitized existing-VPS
metadata import flow in the Remote panel. No provider API token handling or
infrastructure creation has been added.

Exit criteria:

- the app recommends minimum server resources and the safe default basedir;
- the app explains required SSH and firewall setup without exposing secrets;
- the user can import the server through a local-only connection reference;
- sanitized JSON or key/value provider metadata can be reviewed and converted
  into observer-only inventory records;
- raw addresses, hostnames, users, provider tokens, and private paths are
  redacted and blocked before saving;
- no provider token is required.

### Phase 4.7 - Testnet Provider Adapter Prototype

Prototype one live provider API adapter for testnet observers only after Phase
4.6 is validated. This is separate from the implemented local metadata import.

Exit criteria:

- provider token is stored only as a keychain, secret-manager, or session
  reference;
- instance creation is explicit, cost/risk is shown, and no infrastructure is
  created silently;
- firewall policy keeps JSON-RPC and admin APIs off the public internet;
- created instance is imported into the same sanitized inventory model;
- install/restore/start still uses the normal observer-first SSH flow.

### Phase 5 - Testnet Producer Assignment

Assign a testnet producer profile to one restored observer.

Exit criteria:

- profile validation passes;
- producer activation requires explicit confirmation;
- produced blocks are verified on testnet.

### Phase 6 - Prodnet Observer Canary

Install or upgrade one prodnet observer only.

Exit criteria:

- public bootstrap restore passes;
- observer stays healthy through catch-up and steady state;
- no wallet or producer material mounted;
- JSON-RPC remains loopback-only.

### Phase 7 - Prodnet Observer Fleet

Expand to multiple prodnet observers after canary evidence.

Exit criteria:

- phased rollout succeeds;
- canary metrics define expected catch-up and steady-state behavior;
- rollback plan has been tested.

### Phase 8 - Mainnet Producer Planning

Only after the observer fleet is proven, design controlled mainnet producer
operations. This phase remains read-only until separately approved.

## Rollout Stop Criteria

Stop rollout immediately for the affected group if any of these occur:

- chain ID mismatch;
- state merkle mismatch;
- node starts with producer enabled when observer was expected;
- JSON-RPC or backup admin is exposed publicly by mistake;
- disk free space drops below the safety floor;
- restored node fails to open RocksDB;
- head does not advance within the planned window;
- severe logs repeat after restart;
- image/binary digest does not match the expected artifact;
- duplicate producer key/profile is detected outside explicit standby mode;
- public bootstrap signature or hash verification fails;
- operator confirmation text does not match the planned operation.

## Rollback Plan

Rollback must be planned before rollout.

### Artifact Rollback

- keep previous artifact available;
- stop node cleanly;
- restore previous artifact;
- restart as observer unless producer mode is explicitly re-approved;
- verify health.

### Config Rollback

- store pre-change sanitized config diff;
- restore previous config;
- restart node;
- verify network, ports, role, and health.

### Restore Rollback

- preserve `.pre-restore/<timestamp>-<backup-id>`;
- stop node;
- restore previous active DB only after operator approval;
- restart as observer;
- verify chain ID and head progress.

### Public Bootstrap Publication Rollback

- keep previous signed `latest.json`;
- atomically repoint `latest.json` to previous snapshot;
- do not delete objects during rollback;
- validate list/fetch from the previous snapshot.

## Pre-Implementation Test Matrix

| Area | Test | Required Evidence |
|------|------|-------------------|
| Inventory | Sanitized inventory validates without secrets | validation report with placeholder-only sample |
| Inventory | Duplicate basedir/ports/profiles rejected | unit test or dry-run output |
| UX | Simple-mode remote observer path has one primary action and hides expert controls | screenshot and UI test |
| UX | Safe default basedir is proposed from network and node alias | unit test and UI test |
| UX | Failure state gives human reason and next safe action | UI test with mocked failure |
| Provider | Bring-your-own-server checklist requires no provider token | UI test |
| Provider | Sanitized provider metadata import stores only observer inventory refs | unit test and UI test |
| Provider | Provider import blocks raw addresses, hostnames, users, private paths, and token-like values | unit test and UI test |
| Artifact | Image/binary digest mismatch blocks rollout | unit test or dry-run output |
| Install | Testnet observer install dry-run is deterministic | golden dry-run plan |
| Install | Non-empty basedir requires confirmation | unit test or dry-run output |
| Config | JSON-RPC public bind rejected by default | unit test |
| Config | Backup admin public bind rejected | unit test |
| Bootstrap | Public metadata network mismatch rejected | integration or fixture test |
| Bootstrap | Signature/hash failure aborts restore | fixture test |
| Runtime | Observer starts with producer disabled | testnet acceptance report |
| Health | Head progress check detects stalled node | integration test |
| Logs | Diagnostic bundle redacts secrets | unit test with seeded secret patterns |
| Backup | Private backup list/preflight works over loopback/admin or CLI | integration test |
| Recovery | State merkle mismatch plan preserves DB first | dry-run recovery plan |
| Producer | Network mismatch rejects profile assignment | unit test |
| Producer | Registered hot-key mismatch blocks activation | testnet or fixture test |
| Producer | Mainnet producer activation requires fresh confirmation | unit test and UX test |
| Upgrade | Canary upgrade can roll back artifact | testnet acceptance report |
| Rollout | Stop criteria prevent expansion after failed canary | orchestration test |

Implemented evidence currently includes unit coverage for inventory
normalization/persistence, command-plan generation, execution gating, output
redaction, health parsing, stop criteria, sanitized receipts, IPC registration,
mocked SSH execution, simple/expert Remote UI visibility, provider-neutral
checklist rendering, default basedir generation, Docker port mapping, and
placeholder execution blocking. The Remote UI also has an expert fleet rollout
review path that composes per-node plans, requires a fleet phrase plus per-node
phrases, executes one node at a time through the existing IPC executor, and
stores sanitized fleet rollout receipts. The first prodnet observer
install/restore/start path is implemented behind artifact digest, bootstrap
policy, prior proof receipt, observer-only, and one-node-only execution gates;
prodnet batch mutation and producer activation remain unavailable. Real
Electron/IPC coverage verifies
the Remote surface through the actual preload bridge with temporary local
inventory and receipts. Live evidence includes sanitized LAN Server read-only
validation and VPS1 testnet observer validation through real Electron/IPC. The
VPS1 run used a
sanitized local SSH alias, public bootstrap restore, observer-only config,
confirmed `start-observer`, confirmed config-reconciling `restart`, confirmed
`status`, masked screenshots, sanitized receipts, and read-only post-checks.
The seed-peer gap discovered during live validation is covered by command-plan
tests. No prodnet/mainnet mutation was performed, producer activation remained
unavailable, and no unrelated service was disturbed.

## Acceptance Criteria For This Plan

This planning work is complete when:

- the remote multi-node target architecture is documented;
- inventory and secret-handling rules are documented;
- observer, producer, standby, bootstrap source, and backup source roles are
  documented;
- install, upgrade, health, logs, backup/restore, recovery, producer activation,
  rollout, stop criteria, and rollback are documented;
- the test matrix is concrete enough to drive implementation;
- the plan contains no real private hosts, IPs, SSH users, producer addresses,
  tokens, or key paths;
- no code, scripts, service units, or operational configs were implemented.

## Open Decisions

- Whether the first implementation should support SSH-only execution or include
  a local remote-agent prototype behind a feature flag.
- Whether Docker should be the only supported remote Linux runtime for the first
  prodnet observer release.
- What minimum prodnet observer freshness and peer-count thresholds should gate
  fleet expansion.
- Whether public P2P identity persistence must land before public-peer fleet
  management.
- Whether private backup creation should be mandatory before every prodnet
  observer upgrade.
- How many human approvals are required before any future mainnet producer
  fleet mutation.
- Which provider should be the first optional adapter target, based on API
  simplicity, region availability, firewall support, snapshot support, and cost
  transparency.
- Whether provider API tokens should be session-only for the first release, or
  stored through OS keychain references.
- Whether one-click provisioning should stay testnet-only until multiple manual
  prodnet observer canaries have passed.

## Iteration Log

### Iteration 1 - Inventory And Role Boundary

- Section improved: `Safe Inventory Model` and `Node Roles`.
- Design decision added: split sanitized fleet records from private inventory
  and make observer, producer, standby, public bootstrap source, and private
  backup source separate roles.
- Risk reduced: avoids committing host details or accidentally treating a
  standby node as an active distributed producer.
- Next review: ensure the install workflow consumes this model without adding
  hidden secrets.

### Iteration 2 - Installation Flow

- Section improved: `Installation Workflow`.
- Design decision added: remote install is a generated per-node command plan
  with host preflight, artifact selection, observer-safe config, public
  bootstrap restore, first start, and install receipt.
- Risk reduced: prevents ad hoc SSH installs from skipping disk, port, network,
  and observer-first checks.
- Next review: ensure upgrades and rollback are as explicit as installation.

### Iteration 3 - Upgrade And Remote Operations

- Section improved: `Upgrade Workflow` and `Remote Management Operations`.
- Design decision added: upgrades proceed by canary and require hash/digest
  verification, backup readiness, health gates, and rollback artifact
  availability.
- Risk reduced: avoids pushing a bad artifact across the fleet without a
  per-node rollback path.
- Next review: classify which operations require explicit confirmation.

### Iteration 4 - Confirmation And Network Safety

- Section improved: `Confirmation Policy` and `Configuration By Network`.
- Design decision added: mainnet producer mutations require a fresh explicit
  request, separate from normal remote management actions.
- Risk reduced: prevents install, restore, startup, or upgrade flows from
  becoming hidden mainnet mutation paths.
- Next review: cover health checks, logs, and operator diagnostics.

### Iteration 5 - Monitoring And Diagnostics

- Section improved: `Health Checks` and `Logs And Diagnostics`.
- Design decision added: health states are explicit and diagnostic bundles must
  be sanitized before export.
- Risk reduced: prevents private host or credential data from leaking through
  support bundles while still giving enough evidence for operations.
- Next review: integrate backup/restore and state-merkle recovery behavior.

### Iteration 6 - Backup, Restore, And Recovery

- Section improved: `Backup And Restore Policy`.
- Design decision added: public bootstrap, private backup, and state-merkle
  recovery have separate workflows and restore always returns to observer-first
  mode.
- Risk reduced: avoids destructive first actions such as clearing state DB or
  forcing full resync when validation-based recovery may work.
- Next review: add producer-specific activation rules.

### Iteration 7 - Producer Safety

- Section improved: `Producer Safety Plan`.
- Design decision added: producer profile assignment is separate from producer
  activation, and activation requires key, registration, network, VHP, and head
  checks.
- Risk reduced: avoids accidental reuse of producer keys and prevents mainnet
  production from being enabled by background workflows.
- Next review: finish rollout, stop criteria, rollback, and test matrix.

### Iteration 8 - Rollout And Verification

- Section improved: `Rollout Strategy`, `Rollout Stop Criteria`, `Rollback
  Plan`, and `Pre-Implementation Test Matrix`.
- Design decision added: implementation must start with read-only inventory and
  dry-runs before any testnet remote observer execution.
- Risk reduced: creates a measurable path from plan to implementation without
  skipping canaries, stop gates, or rollback proof.
- Next review: convert open decisions into implementation issues after the plan
  is accepted.
