# Node Fleet Strategy

- Date: 2026-07-09
- Scope: unified strategy for running and managing multiple nodes from Koinos
  One — local and remote, observer and producer, single node and fleet
- Supersedes and archives:
  - `MULTI_NODE_REMOTE_INSTALL_AND_MANAGEMENT_PLAN.md` (2026-06-26)
  - `REMOTE_NODES_REMAINING_MVP_IMPLEMENTATION.md` (2026-06-29)
  - `DISTRIBUTED_PRODUCER_FLEET_AND_VHP_PLAN.md` (2026-06-24)
  - archived under `docs/archive/implementation-plans/fleet/`
- Related: `docs/adr/0001-node-flavors-and-native-runtime.md` (proposed) defines
  the architectural axes this strategy builds on
- Mainnet status: producer mutation remains read-only planning until explicit
  mainnet-safe approval

## Mission

Koinos One evolves from "one managed local Teleno node" into a fleet product:
an operator — expert or not — can install, run, monitor, upgrade, and recover
any number of Koinos nodes, locally or on their own servers, and can later
promote validated observers into independent producers. The native runtime
(`teleno_node`) now lives in its own repository (`koinos/teleno`) and is the
first node flavor; the architecture must not assume it is the only one.

## Architecture Model

Per ADR 0001, a managed node is the tuple **(flavor, location, supervisor)**
with one lifecycle contract (install, start, stop, upgrade, rollback, health,
logs, backup/restore):

- **Flavor** — what runs: `teleno-monolith` today; `multiservice` and other
  compatible implementations later. Artifacts for the Teleno flavor come from
  the `koinos/teleno` repository: the container image `ghcr.io/koinos/teleno`
  (digest-pinned) and native builds identified by `teleno-node-v<version>`
  tags.
- **Location** — where it runs: `local` (direct process exec) or `remote`
  (SSH-executed command plan). Both execute the *same generated plan* over a
  different transport; this property is already implemented and must be
  preserved.
- **Supervisor** — how it stays alive: `docker`, `systemd`, `launchd`, or
  `foreground`.

Above the runtime sit four fleet layers (all four exist today in MVP form):

1. **Fleet inventory** — local desired-state catalog: nodes, flavors, roles,
   networks, artifacts, ports, backup policy, safety flags. Sanitized records
   only; private connection data stays in local-only references (SSH aliases,
   keychain/secret-manager refs).
2. **Execution adapter** — generates deterministic per-node command plans and
   executes them one node at a time after exact confirmation. No ad hoc shell.
3. **Verification loop** — read-only health checks compare expected vs
   observed state before, during, and after every mutation.
4. **Provider layer (optional)** — bring-your-own-server checklist and
   sanitized metadata import. Live provider APIs are deliberately out of the
   core model (see Discarded Ideas).

## Safety Invariants

These apply to every flavor, location, and phase. They are the merged guardrail
set of the three source plans and are non-negotiable:

1. **Observer-first.** Every installed or restored node starts as an observer
   with `block_producer` disabled. Producer mode is a separate, explicit
   activation after health, chain, key, registration, and VHP checks pass.
2. **No hidden mainnet mutation.** Producer registration, VHP burns/transfers,
   wallet sends, producer-key or default-account changes, and enabling mainnet
   production each require a fresh explicit user request, a dry-run or
   reviewable plan, and confirmation naming network, signer, addresses, and
   operation.
3. **Loopback by default.** JSON-RPC and backup/admin APIs bind to loopback.
   Public P2P is opt-in. Public exposure of admin surfaces is a stop criterion.
4. **Sanitization everywhere.** Inventory, receipts, logs, screenshots, and
   docs never contain raw hostnames, IPs, SSH users, tokens, keys, wallet
   data, or real producer addresses. Committed examples use placeholders.
5. **One node at a time.** Multi-node operations expand into per-node plans;
   execution is sequential and stops at the first failed, blocked, or unsafe
   result. Fleet batches require a fleet phrase plus per-node phrases.
6. **State DB is sacred.** On merkle mismatch, restore failure, digest
   mismatch, or unknown state: preserve the DB, never clear
   `chain/blockchain`, never force a fresh resync as the first action.
   Validation-based recovery first; destructive recovery only after operator
   approval.
7. **Independent producer identities.** A fleet of producers is N profiles,
   each with its own control address, registered hot key, basedir, ports, and
   VHP allocation. Key/address/basedir/port duplication is flagged and blocks
   activation outside explicit standby mode.
8. **No hidden custody.** No embedded funded key, no generic signing account,
   no sponsor behavior the user did not configure. Signer, payer, amounts, and
   targets are always shown before signing.
9. **Escalating confirmation policy.** Read-only checks run after per-node
   confirmation; host mutations require explicit confirmation naming node,
   network, role, and artifact; testnet destructive actions require
   `PRESERVE_DB` evidence gates; the narrow prodnet observer path requires
   digest pinning, reviewed bootstrap policy, prior dry-run proof, and
   `OBSERVER_ONLY` confirmation; mainnet producer actions require all of the
   above plus a fresh request.

## Where We Are (Implemented, Validated)

The remote MVP shipped and has sanitized live evidence (LAN read-only
validation; VPS1 testnet observer install/restore/start/restart/status through
real Electron/IPC):

- Sanitized fleet inventory with local-only persistence, duplicate detection,
  and observer-safe defaults (`src/app/remote-nodes.ts`,
  `electron/lib/teleno-storage.ts`).
- Deterministic command-plan generation and an SSH-backed executor gated by
  exact confirmation, with streamed sanitized per-step progress and receipts
  (`electron/lib/remote-node-service.ts`).
- Simple mode (add server, restore public backup + start observer,
  stop/restart, health, sanitized logs, receipts) with human phase states;
  expert mode adds diagnostics, upgrade, rollback/cleanup behind `PRESERVE_DB`
  and evidence gates, and a sequential fleet rollout review.
- Public bootstrap restore as the standard first-install path; generated
  observer configs carry seed peers, loopback bindings, and
  `block_producer: false`.
- Provider-neutral server checklist plus sanitized metadata import (no tokens,
  no provider APIs).
- The narrow prodnet observer install/restore/start path behind artifact
  digest, bootstrap policy, prior proof receipt, observer-only, one-node-only
  gates. Prodnet batch mutation and producer activation remain unavailable.
- Health parsing with explicit degraded signals (no seed peers, no connected
  peers, stalled head) and hard stop criteria (chain mismatch, merkle
  mismatch, public exposure, producer-enabled-unexpectedly, digest mismatch,
  disk floor).

Known hardening debt carried forward from the MVP tracking doc:

- Move the fleet rollout orchestration loop from the renderer into Electron
  main for interruption/resume robustness.
- Map native public-bootstrap JSON progress into restore subprogress
  percentages.
- Automatic artifact-history capture so rollback evidence does not depend on
  manual preparation.
- Artifact signing and prodnet bootstrap signature enforcement once signed
  artifacts/manifests are published.
- Optional trusted network head source for head-lag comparison.

## Roadmap

One roadmap replaces the three overlapping phase lists. Layers build bottom-up;
a layer ships when its exit criteria hold on testnet (and, where stated, on a
prodnet canary).

### Layer 1 — Runtime and flavor foundation

Goal: make "node flavor" first-class instead of implicitly `teleno_node`.

- Promote `flavor` to a persisted field in fleet records (migration for
  existing inventory).
- Pin Teleno artifacts to `koinos/teleno` releases: container digest for
  Docker, `teleno-node-v<version>` + SHA-256 for native binaries.
- Extract the per-flavor runtime knowledge (layout, launch, config, supervise,
  health) behind one interface, per ADR 0001; Koinos One consumes it for the
  local location, the SSH executor for the remote location.
- Multi-instance local runtime: N named local instances with per-instance
  basedirs, port allocation (testnet JSON-RPC from 18122, P2P from 18888;
  mainnet from 8080/8888), conflict detection, separated logs, and
  per-instance start/stop/restart.

Exit: two local testnet instances plus one remote testnet observer visible in
one fleet view, each with independent health, no port/basedir conflicts.

### Layer 2 — Fleet operations hardening

Goal: dependable day-2 operations across the fleet.

- Rollout orchestration in Electron main with stop-after-current and resume.
- Upgrade workflow with canary order (testnet observer → testnet fleet →
  prodnet observer canary → prodnet fleet), digest verification, rollback
  artifact availability, and automatic pre-upgrade evidence capture.
- Restore-progress percentages and richer receipts.
- Prodnet observer fleet expansion after canary evidence (multi-node prodnet
  remains sequential and observer-only).
- Signed artifacts and signed prodnet bootstrap enforcement when available.

Exit: a two-node testnet upgrade with a forced failure stops the rollout,
rolls back the canary, and leaves receipts proving DB preservation; prodnet
observer canary completes catch-up with no manual SSH.

### Layer 3 — Producer identity and funding (testnet first)

Goal: from validated observer to independent producer, without hidden custody.

- Producer profiles: one control address, one active hot key, network-scoped,
  duplicate-guarded (builds on
  `producer/NETWORK_SCOPED_PRODUCER_WALLET_PLAN.md`).
- Read-only chain queries per profile: registration status, VHP, liquid KOIN,
  mana, recent produced blocks; fleet view shows profiles next to instances.
- Funding planner for the first-funding/first-mana problem. MVP sources, in
  order: user-owned funding wallet in Koinos One; manual funding fallback
  (show address, watch balance); existing free-mana support where applicable.
  Sponsor-wallet support only once previews clearly separate signer, payer,
  source, and target.
- Guide-only external funding assistant for users holding non-KOIN assets:
  target address, checklist, official links, balance watcher. Koinos One never
  holds EVM keys and never constructs swap/bridge transactions (see Discarded
  Ideas).
- Testnet execution with explicit confirmation per transaction: fund → burn
  KOIN to VHP → register hot key → verify registration matches the local key.
- Resumable setup state machine (plan → identity → fund → burn → register →
  bootstrap/sync → validate → enable → monitor); every submit step behind
  confirmation; failed states resume without repeating confirmed transactions.
- VHP allocation simulator: current vs target distribution across profiles,
  equal/weighted/manual modes, concentration warnings, exportable plan;
  read-only until the operator explicitly submits the resulting transactions
  on testnet.

Exit: on testnet, a fresh install reaches an actively producing node through
the guided path, with every transaction previewed and confirmed; two producers
run concurrently (one local, one remote) with independent identities; the VHP
simulator matches on-chain state.

### Layer 4 — Mainnet producer rollout (separately approved)

Read-only mainnet inventory and simulators first; dry-run previews next;
explicitly gated single-transaction submission last. Preconditions: all Layer
3 exit evidence, prodnet observer fleet evidence from Layer 2, and a fresh
explicit approval. Mainnet producer state is never changed by presets,
startup, restore, background jobs, or fleet automation.

### Deliberately unscheduled (conditional explorations)

- **Fogata pools.** Smart-contract-controlled pooled production is a real use
  case, but it adds contract deployment risk, beneficiary accounting, and
  upstream listing/approval policy. Explore only after Layer 3 ships and only
  with a confirmed upstream repository/version and a contract security
  review. Model pools as a distinct workflow (owner, payer, contract account,
  node operator) — never as "just another producer address".
- **Testnet provider provisioning.** One-click VPS creation via a provider
  API, testnet-only, tokens held as session/keychain references. Only worth
  building if BYOS demonstrably blocks adoption.
- **WalletConnect-style external EVM signing** for the funding assistant, if
  the guide-only flow proves too manual. The EVM key always stays in the
  external wallet.

## Discarded Ideas

Recorded so they are not re-litigated without new evidence:

- **Embedded local EVM wallet.** Turns a node operations app into a
  multi-chain custody product; demands seed backup UX, security review, and
  migration story disproportionate to the funding problem it solves. The
  guide-only assistant plus an external wallet covers the need.
- **In-app Uniswap swap construction and fully automated ETH→producer
  chains.** Chains several irreversible, failure-prone, custody-sensitive
  operations (swap → bridge → burn → register → produce) behind one button.
  Each link can be guided individually; the composite automation is rejected.
- **Payment providers, fiat on-ramps, DEX routing, managed "click, pay, run"
  hosting.** A separate legal/compliance/billing product, not a feature of
  this app. Out of mission unless a deliberate product decision reopens it.
- **Live provider API adapters as a core dependency.** The SSH/BYOS model is
  portable, vendor-neutral, and already validated; provider APIs remain an
  optional convenience layer at most (see conditional explorations).
- **Shared producer keys across active nodes as a scaling model.** Distributed
  production means independent identities; shared keys exist only as explicit
  standby/failover, never default.
- **A persistent remote agent as the first remote transport.** SSH command
  plans with confirmations and receipts are auditable and sufficient; an agent
  may be reconsidered only after command semantics and audit trails are
  stable.

## Test And Evidence Policy

Every layer keeps the established evidence style: unit coverage for plan
generation, gates, redaction, and parsing; real Electron/IPC Playwright
coverage for the UI surfaces; opt-in live validation against disposable
testnet targets with sanitized receipts and masked screenshots. The detailed
per-area test matrices from the archived plans remain valid references; new
work adds to them rather than replacing them.

Stop criteria (unchanged): chain ID mismatch, state merkle mismatch,
unexpected producer-enabled state, public JSON-RPC/admin exposure, disk floor
breach, RocksDB open failure, stalled head, repeating severe logs, artifact
digest mismatch, duplicate producer identity, signature verification failure,
confirmation text mismatch.

## Open Decisions

- Runtime extraction packaging (per ADR 0001): npm package vs bundled module,
  and whether the standalone CLI ships from the same repo.
- Whether Docker remains the only supported remote Linux runtime through Layer
  2, or systemd-native installs land earlier.
- Minimum prodnet observer freshness/peer thresholds gating fleet expansion.
- Whether private backup creation is mandatory before every prodnet observer
  upgrade.
- Default VHP concentration warning threshold (50%, 67%, or configurable).
- How many human approvals gate any future mainnet producer fleet mutation.
