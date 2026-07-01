# Distributed Producer Fleet And VHP Allocation Plan

- Date: 2026-06-24
- Scope: staged product and implementation plan for one-click producer onboarding, distributed producer fleets, VHP allocation, local-first decentralization, optional remote deployment, and Fogata pool integration
- First target: local Mac and testnet workflows with read-only simulation before transaction submission
- Mainnet status: read-only planning only until explicit mainnet-safe approval

## Goal

Make Koinos One capable of guiding a non-expert operator from an empty app to a running Koinos producer with a clear, KISS workflow:

1. Choose local Mac, user-owned remote server, or future managed background deployment.
2. Choose a budget, KOIN amount, or VHP target.
3. Generate or import a producer-control address and local hot key.
4. Fund the producer-control address explicitly.
5. Burn KOIN into VHP for the producer address, or transfer existing VHP when that is the selected strategy.
6. Register the local producer hot public key.
7. Bootstrap the node from a public snapshot.
8. Start observer-first, validate chain state and producer identity, then enable block production.
9. Monitor one producer or a fleet of independent producers from one dashboard.

This is not a protocol change. It is an operator workflow and safety layer around existing Koinos producer, VHP, wallet, public bootstrap, and node-runtime mechanics.

The strategic product direction is "click, fund, deploy, validate, produce", not "hide custody". Koinos One can make the workflow feel one-click, but every mainnet signer, payment source, transaction, target address, and producer key change must stay visible and reviewable.

## Product Principles

### Local-First Decentralization

The default product should make running a node locally on a Mac practical. Server and RAM prices can rise faster than end-user hardware costs, and local nodes reduce reliance on hosted infrastructure. Remote VPS and managed deployment are useful options, but they should not become the only ergonomic path.

Public bootstrap restore is the key enabler for local-first onboarding: the user should not need SSH backup credentials or a full genesis resync before running an observer.

### Distributed Production Means Independent Producer Identities

A producer fleet is not several processes sharing one producer key. Active distributed production requires separate producer-control addresses, registered hot keys, basedirs, ports, health history, and VHP allocations.

Running several nodes with the same producer address and same key can be modeled later as standby/failover. It is not the default distributed-production workflow.

### One-Click Means Orchestrated Explicit Steps

The UX may present a single "Set up producer" command, but the implementation must run a visible state machine:

1. Plan.
2. Generate identity.
3. Fund.
4. Burn or allocate VHP.
5. Register hot key.
6. Bootstrap and sync.
7. Validate.
8. Enable producer.
9. Monitor.

Each state must be resumable, inspectable, and safe to stop. Failed states must leave the user with a clear next action rather than retrying hidden mainnet mutations.

### No Hidden Custody

Koinos One must not embed a hardcoded funded private key, a generic signing account, or any hidden custody account. A first transaction can be sponsored only by a user-selected and user-controlled source, a clearly configured sponsor flow, or an explicit future payment/on-ramp provider integration.

## Non-Goals

- Do not change PoB, KOIN, VHP, or producer-key consensus rules.
- Do not automatically mutate mainnet producer registration, burns, transfers, or pool contracts.
- Do not move mainnet KOIN or VHP without explicit user review and transaction confirmation.
- Do not store a generic funded private key in the app, repo, installer, or updater.
- Do not run multiple active producers with the same hot key by default.
- Do not expose local backup, wallet, or producer admin APIs over the network.
- Do not treat PayPal, card payments, DEX routing, fiat on-ramps, or managed server provisioning as MVP features.

## Safety Guardrails

### Mainnet Guardrails

- Mainnet producer actions are read-only by default.
- Mainnet registration, VHP burn, VHP transfer, Fogata deployment, or producer-key changes require explicit confirmation.
- The UX must show network, signer, payer, producer address, target address, hot public key, transaction type, amount, RC/mana source, and estimated result before signing.
- The UX must refuse hidden mainnet mutations from presets, background setup tasks, first-run setup, restore activation, or remote-deployment automation.
- Mainnet workflows must support dry-run or transaction preview before submission.
- Sensitive producer addresses, private server inventory, SSH users, hostnames, private keys, WIFs, and operational notes must remain in local-only ignored files. Public docs and committed examples must use placeholders such as `<PRODUCER_ADDRESS>` and `<REMOTE_HOST>`.

### Producer Identity Guardrails

- A producer profile owns exactly one producer-control address.
- A producer profile owns exactly one active hot public key at a time.
- A producer hot private key must not be reused across unrelated producers unless the operator explicitly imports it and accepts the warning.
- The UI must warn if two active profiles point to the same producer address, same hot public key, same hot private-key file, same basedir, or same public P2P port.
- A restored or newly created node must start as observer first.
- Block production can be enabled only after chain ID, network, head progress, local hot key, registered hot key, producer address, and VHP checks pass.

### GUI And Documentation Guardrails

- Future GUI copy for this feature must be represented in `src/i18n.ts` in English and Spanish.
- User-facing text must not mix English and Spanish in one locale.
- The Producer, Wallet, Backup, and Fleet surfaces must follow the existing Koinos One visual language.
- Documentation must stay in English.

## First Funding And Mana Problem

A newly generated producer-control address has no KOIN and no mana. It cannot pay RC/mana for:

- its first KOIN receive or transfer flow if the operation requires the new account as signer;
- producer hot-key registration;
- KOIN burn into VHP;
- VHP transfer;
- Fogata contract deployment or pool setup;
- pool staking transactions where the new address is the signer.

This is the core onboarding problem. The app must make it easy to solve, but the solution cannot be a hidden generic Koinos One account.

### Funding Strategy Options

| Strategy | MVP Suitability | User Experience | Custody And Risk |
| --- | --- | --- | --- |
| User-owned funding wallet in Koinos One | Best MVP path | User imports or creates a wallet that already has KOIN/mana, then funds new producer profiles from it | Non-custodial; explicit signing; requires user to already have KOIN |
| Explicit sponsor wallet/account | Good testnet and advanced path | User selects a sponsor/funder account with mana to pay setup RC and optionally transfer initial KOIN | Non-custodial if user owns the sponsor; must show signer and payer clearly |
| Existing free-mana support | Useful helper, not full solution | Use configured free-mana payer where available for supported KOIN/VHP operations | Must be bounded, visible, and never treated as a generic hidden funding key |
| Manual funding fallback | Required | App displays the generated address and waits for funds before continuing | Safest; less "one-click"; works before provider integrations exist |
| Payment provider or fiat on-ramp | Future product/compliance track | User pays with PayPal/card/on-ramp, provider delivers KOIN to the generated address | Requires legal, compliance, provider, refund, KYC/AML, pricing, and custody review |
| DEX purchase flow | Future product track | User swaps another asset into KOIN, then bridges or transfers to Koinos as required | Requires routing, slippage, chain support, custody model, user approvals, and failure recovery |
| Managed deployment provider credit | Future product track | User pays for server and funding bundle in one guided flow | Requires operational, legal, billing, custody, and support model |

MVP recommendation: implement the user-owned funding wallet plus manual funding fallback first. Add sponsor-wallet support only when the transaction preview can clearly separate signer, payer, source account, and target producer. Treat payment providers, DEX routing, and managed servers as future integrations with a compliance gate.

### ETH-To-KOIN Funding Possibilities

This section is planning only. It does not authorize implementation, live swaps,
bridge operations, KOIN burns, producer registration, or producer activation.

Problem statement: a user may have ETH or another EVM asset but no KOIN in the
Koinos One wallet. To become a block producer, the user still needs a safe route
from external funds to liquid KOIN, then from KOIN to VHP, then to producer-key
registration and observer-first producer activation.

Current reference assumptions to verify again before implementation:

- Koinos Proof-of-Burn producer setup requires KOIN, a KOIN-to-VHP burn, and
  producer hot-key registration.
- The Vortex bridge has been described publicly as a bridge path for KOIN,
  USDT, and ETH between Koinos and Ethereum, with KOIN liquidity on Uniswap.
- Uniswap integration docs treat the app as the transaction integrator: the app
  must handle wallet connection or local key management, RPC, approvals, signing,
  transaction submission, gas, slippage, and failure handling.

Do not assume an Ethereum-side asset name such as `vKOIN` unless official current
bridge metadata uses that name. In Koinos One, `vKOIN` can also refer to testnet
native token naming, so UI copy must avoid ambiguous token names.

#### Option A - Guide-Only External Funding Assistant

Recommended first implementation.

Koinos One shows the target Koinos address, required funding/VHP checklist,
official links, warnings, and balance watchers. The user performs Uniswap,
Vortex, exchange, or wallet actions outside Koinos One. Koinos One only verifies
incoming KOIN/VHP state and resumes the producer setup once funds are present.

Pros:

- no ETH private-key handling in Koinos One;
- no in-app swap, bridge, approval, or gas logic;
- lowest legal, security, and implementation risk;
- works with MetaMask, Rabby, WalletConnect wallets, CEX withdrawals, and manual
  transfers.

Cons:

- user leaves the app;
- harder to make fully one-click;
- troubleshooting depends on external wallet and bridge state.

#### Option B - External EVM Wallet Integration

Koinos One integrates WalletConnect or a browser-wallet style provider and asks
the user's external EVM wallet to sign approvals, swaps, bridge transactions, and
claims. Koinos One can still build the guided state machine and monitor progress,
but the ETH key stays in the external wallet.

Pros:

- avoids storing ETH private keys in Koinos One;
- can support MetaMask, Rabby, and mobile wallets through one integration model;
- keeps the app non-custodial while improving UX.

Cons:

- more complex than guide-only;
- requires wallet-session security, chain switching, transaction status tracking,
  and clear user recovery when the wallet rejects or drops a transaction;
- still depends on official bridge and swap contract metadata.

#### Option C - Embedded Local EVM Wallet

Koinos One can implement a local Ethereum wallet so the user does not need
MetaMask. That means Koinos One must generate or import an EVM account, derive
an Ethereum address, encrypt and store the seed/private key locally, connect to
an Ethereum RPC, estimate gas, sign EIP-1559 transactions, and broadcast them.

This is possible, but it changes the product boundary: Koinos One becomes a
multi-chain wallet. It needs a stronger security review, backup/recovery UX,
keychain integration, redaction rules, seed export rules, and a clear migration
story before it is exposed to non-expert users.

#### Option D - In-App Uniswap Quote And Swap

Koinos One can use Uniswap API/SDK flows to quote ETH-to-KOIN or token-to-KOIN
swaps, show price impact and slippage, request approval only when needed, build
the swap transaction, sign through Option B or Option C, broadcast, and track the
transaction until final.

This is not a standalone option. It requires an external EVM wallet integration
or an embedded local EVM wallet first. It also requires an allowlist for token
contracts, chain ID, router/API source, maximum slippage, approval scope, and
sanitized receipts.

#### Option E - Vortex Bridge Integration

Koinos One can start with a guide/deep-link flow to the official bridge and later
integrate bridge status or bridge transactions directly if official production
contracts, APIs, event semantics, and claim/finality rules are stable and pinned.

The app must be able to explain pending, failed, partially completed, and
claim-required bridge states. It must never hide the fact that funds are crossing
chain boundaries and may need confirmations or guardian validation before they
arrive on Koinos.

#### Option F - CEX, On-Ramp, Or Manual Deposit

Koinos One can show a deposit address and wait for KOIN, regardless of whether
the user buys on an exchange, receives a transfer, or uses a future on-ramp. This
is the most generic fallback and should remain available even if DEX and bridge
integrations are added later.

#### Option G - Fully Automated ETH-To-Producer Flow

The attractive product shape is:

1. sign with ETH wallet;
2. swap ETH to Ethereum-side KOIN;
3. bridge KOIN to Koinos;
4. verify KOIN balance;
5. burn selected KOIN into VHP;
6. register producer hot key;
7. start observer-first production after health checks.

This must not be MVP. It chains several irreversible or failure-prone operations.
It should be considered only after guide-only funding, external wallet signing,
swap quotes, bridge monitoring, Koinos burn/register dry-runs, and observer-first
producer activation have all been validated independently.

Recommended product order:

1. Build a guide-only Producer Funding Assistant with balance watching.
2. Add external wallet or bridge deep links, but keep the user signing outside
   Koinos One.
3. Add WalletConnect/external EVM wallet support if the guide-only path is too
   manual.
4. Add Uniswap quotes as read-only estimates before enabling in-app swap signing.
5. Add Vortex status monitoring before bridge transaction construction.
6. Consider embedded EVM wallet only as an expert-mode feature after a security
   review.
7. Chain swap, bridge, burn, registration, and producer start only after each
   individual step has receipts, dry-runs, confirmations, and recovery paths.

## Core Concepts

### Producer Profile

A producer profile is a logical on-chain producer identity that can be assigned to one node runtime.

```ts
type ProducerProfile = {
  id: string
  label: string
  network: 'mainnet' | 'testnet' | 'custom'
  producerAddress: string
  hotPublicKey?: string
  hotPrivateKeyFile?: string
  registeredPublicKey?: string
  registrationStatus: 'unknown' | 'not_registered' | 'registered' | 'mismatch'
  vhpBalance?: string
  liquidKoinBalance?: string
  mana?: string
  fundingStatus: 'unfunded' | 'funded' | 'burn_ready' | 'producer_ready'
}
```

### Node Instance

A node instance is a runtime target that can run observer, producer, or standby mode.

```ts
type NodeInstance = {
  id: string
  label: string
  network: 'mainnet' | 'testnet' | 'custom'
  deploymentTargetId: string
  basedir: string
  configPath: string
  binaryPath: string
  jsonrpcListen: string
  p2pListen: string
  role: 'observer' | 'producer' | 'standby'
  assignedProducerProfileId?: string
  status: 'stopped' | 'starting' | 'syncing' | 'running' | 'conflict' | 'error'
}
```

### Deployment Target

A deployment target describes where a node runs.

```ts
type DeploymentTarget = {
  id: string
  kind: 'local_mac' | 'user_owned_ssh' | 'managed_provider'
  label: string
  network: 'mainnet' | 'testnet' | 'custom'
  host?: string
  sshUser?: string
  basePath?: string
  provider?: string
  status: 'not_configured' | 'reachable' | 'unreachable' | 'unsupported'
}
```

The first implementation should fully support `local_mac`. `user_owned_ssh` should be testnet-first. `managed_provider` is future product work.

### Funding Plan

A funding plan is a proposed route from user intent to a producer with enough KOIN, VHP, and mana.

```ts
type ProducerFundingPlan = {
  network: 'mainnet' | 'testnet' | 'custom'
  producerProfileId: string
  targetProducerAddress: string
  desiredKoinBudget?: string
  desiredVhp?: string
  source: 'manual' | 'wallet' | 'sponsor_wallet' | 'free_mana' | 'on_ramp' | 'dex' | 'managed_provider'
  signerAddress?: string
  payerAddress?: string
  transferKoinAmount?: string
  burnKoinAmount?: string
  transferVhpAmount?: string
  mode: 'simulate' | 'dry_run' | 'submit'
}
```

### VHP Allocation Plan

A VHP allocation plan is a proposed distribution of stake across producer profiles.

```ts
type VhpAllocationPlan = {
  network: 'mainnet' | 'testnet' | 'custom'
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

The first implementation should support simulation and dry-run before live transaction submission.

### Fogata Pool Profile

A Fogata pool profile models a smart-contract-controlled producer pool, not a normal single-address producer.

```ts
type FogataPoolProfile = {
  id: string
  network: 'mainnet' | 'testnet' | 'custom'
  poolContractAddress: string
  ownerAddress: string
  nodeOperatorAddress: string
  nodeOperatorHotPublicKey?: string
  paymentPeriodMs: string
  beneficiaries: Array<{
    address: string
    percentage: number
    label?: string
  }>
  deploymentStatus: 'planned' | 'deployed' | 'listed' | 'active' | 'paused' | 'error'
}
```

## One-Click Producer Orchestration

### Local Mac MVP Flow

1. The user selects "Create local producer".
2. The app creates a producer profile and local hot key.
3. The app creates a node instance with a unique basedir and ports.
4. The app restores a public bootstrap snapshot or starts direct sync if no snapshot is available.
5. The node starts as observer with block production disabled.
6. The app checks chain ID, network, head progress, local hot key, producer address, KOIN, VHP, and mana.
7. The app asks the user to choose a funding source:
   - fund from an unlocked wallet in Koinos One;
   - copy address and fund manually;
   - use an explicit sponsor/funding wallet;
   - future on-ramp/DEX/provider flow.
8. The app previews and submits funding transactions only after confirmation.
9. The app previews and submits KOIN burn into VHP only after confirmation.
10. The app previews and submits producer-key registration only after confirmation.
11. The app verifies the registered key matches the local hot key.
12. The app enables block production and restarts or reloads the selected node instance.
13. The app shows producer health, latest blocks, peers, VHP, KOIN, mana, and warnings.

### Remote VPS Flow

Remote deployment should use the same state machine, but the runtime target is a user-owned SSH host. The app can automate installation and bootstrap, but it must keep local wallet signing separate from remote node operation.

Rules:

- Do not copy the funding wallet to the remote server.
- Do not copy the producer-control private key to the remote server unless the user explicitly chooses a remote-signing model.
- Prefer local generation of the node hot key, then install only the hot private key needed by `teleno_node` on the remote node.
- Use SSH keys or system provider tokens stored by the OS keychain, not raw passwords in settings.
- Bind remote JSON-RPC/admin APIs to localhost unless the user explicitly configures secure access.

### Managed Deployment Flow

Managed "click, pay, run" deployment is a future product track. It can reuse the same internal state machine, but it adds billing, support, custody, server provisioning, abuse handling, refunds, uptime commitments, and compliance. It must not be mixed into the local-first MVP.

## Fogata Pool Exploration

### Repository Input

Working assumption from public inspection: Fogata is `https://github.com/joticajulian/fogata`. Confirm the exact repository before implementation if the user provides a different URL or local checkout.

Relevant observed Fogata properties:

- Fogata is a Koinos mining pool where the producer is controlled by a smart contract.
- The pool contract holds common VHP and gives production rights to a node operator.
- Participants can stake KOIN or VHP. KOIN stake is burned into VHP.
- The owner configures name, description, image, beneficiaries, payment period, and node operator.
- The contract supports reburn and snapshot mechanics for scalable reward accounting.
- There are separate Fogata, Pools, and Sponsors contracts.
- Deployment scripts use `koilib`, `yarn build`, `yarn deploy`, contract-account keys, owner keys, and a mana-sharer payer key.
- The Fogata `.env.example` expects separate payer, contract, owner, pools, and sponsors private keys for testnet and mainnet.

### Koinos One Integration Model

Koinos One should not treat Fogata as just another producer address. It should model Fogata as a pool-management workflow with explicit contract ownership and operator roles:

1. Create or import a pool owner wallet.
2. Generate a Fogata contract account.
3. Select a payer/sponsor wallet for deployment RC/mana.
4. Select or generate a node operator hot key.
5. Configure pool metadata, payment period, and beneficiaries.
6. Build or verify the Fogata WASM and ABI version.
7. Deploy the contract on testnet.
8. Register the node operator public key through the pool owner/contract path.
9. Bootstrap and validate the node as observer.
10. Enable production only after the contract-controlled producer key and node hot key match.
11. Optionally submit the pool to a pool-listing contract if the upstream Fogata process still requires approval.
12. Monitor pool state, stake, KOIN/VHP balances, snapshots, reburn readiness, beneficiaries, and produced blocks.

### Fogata And Multi-Server VHP Strategy

The user-facing goal is to let an operator split exposure across many servers or pools while preserving central management. There are two distinct models:

- Independent producers: the operator creates many producer profiles, each with its own producer-control address and VHP allocation.
- Fogata pools: the operator deploys or manages smart-contract-controlled pools, with VHP concentrated in pool contracts and production rights assigned to node operators.

Koinos One should support both, but the app must show the difference clearly. A Fogata pool can simplify pooled participation and central administration, but it introduces contract deployment risk, pool parameter risk, beneficiary accounting, pauser/upgradability assumptions, and external approval/listing policy.

## Implementation Phases

### Phase 0 - Discovery And Design Lock

Objective: turn this plan into implementable requirements without mainnet mutation.

Tasks:

1. Confirm the exact Fogata repository, branch, contract versions, and license.
2. Confirm whether current Fogata contracts are production-ready, deprecated, or require upstream changes.
3. Map Koinos One wallet functions to all needed operations:
   - KOIN transfer;
   - KOIN burn to VHP;
   - VHP transfer;
   - producer-key registration;
   - Fogata contract deployment;
   - Fogata pool configuration;
   - Fogata staking, unstaking, reburn, and listing.
4. Identify which operations can use existing Koinos One free-mana support and which cannot.
5. Define GUI copy keys for English and Spanish before building UI.

Exit criteria:

- A signed-off technical design states exactly which MVP operations are local-only, testnet-only, read-only, dry-run, or submit-capable.
- Fogata integration has a confirmed upstream source and version.

### Phase 1 - Model And Read-Only Fleet Inventory

Objective: model multiple producer profiles, node instances, deployment targets, and funding plans without changing chain state.

Tasks:

1. Add persisted producer-profile storage.
2. Add persisted node-instance storage.
3. Add persisted deployment-target storage.
4. Add persisted funding-plan drafts.
5. Detect duplicate basedirs, duplicate ports, duplicate producer addresses, duplicate hot keys, and duplicate private-key paths.
6. Add read-only chain queries per profile:
   - producer key registration;
   - VHP balance;
   - liquid KOIN balance;
   - mana;
   - recent produced blocks.
7. Add a Fleet view that lists producer profiles, node instances, deployment targets, and safety warnings.
8. Add testnet-only fixtures/tests first.

Exit criteria:

- Koinos One can display several producer profiles without starting several nodes.
- Koinos One can show which producer address has which registered key.
- Koinos One can identify unsafe duplication before runtime.

### Phase 2 - Public Bootstrap For New Local Node Instances

Objective: create a new local observer quickly from a public read-only bootstrap backup.

Dependencies:

- `../../current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- implemented `--backup-public-list`
- implemented `--backup-public-fetch`
- implemented `--backup-public-restore`

Tasks:

1. Add "Create Local Node Instance" workflow.
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

### Phase 3 - Producer Identity Generation And Assignment

Objective: create or import producer identity and assign it safely to a node instance.

Tasks:

1. Add "Create Producer Profile" action.
2. Generate or import producer-control account in the network-scoped wallet.
3. Generate local node hot key.
4. Require the node network to match the producer profile network.
5. Write `block_producer.producer` and `block_producer.private-key-file` only for the selected node instance.
6. Keep `features.block_producer: false` until validation passes.
7. Validate:
   - private key exists;
   - public key can be derived;
   - derived public key matches profile hot key;
   - registered public key matches the hot key;
   - node is synced enough to produce safely.

Exit criteria:

- Assigning a profile updates only the selected instance.
- The UI refuses producer mode when key registration is missing or mismatched.
- Testnet producer assignment can be validated without touching mainnet.

### Phase 4 - Funding Planner

Objective: solve the first-funding and first-mana problem without hidden custody.

Tasks:

1. Add funding-source selection:
   - manual transfer;
   - wallet account;
   - sponsor wallet;
   - free mana where supported.
2. Show funding requirements:
   - KOIN needed for remaining liquid balance;
   - KOIN to burn into target VHP;
   - minimum remaining KOIN/mana reserve;
   - registration RC/mana requirement;
   - expected transaction count.
3. Add dry-run previews for each transaction when supported.
4. Display signer, payer, target address, amount, and network for every operation.
5. Persist funding-plan progress so the flow can resume after app restart.

Exit criteria:

- A user can understand exactly why a new producer cannot register itself before funding.
- The app can produce a safe funding plan without submitting transactions.
- No hidden private key or generic account is introduced.

### Phase 5 - Testnet Funding, Burn, And Registration Execution

Objective: execute the funding plan on testnet first.

Tasks:

1. Submit testnet KOIN transfer from an unlocked wallet to the producer-control address.
2. Submit testnet KOIN burn into VHP for the target producer.
3. Submit testnet producer-key registration.
4. Poll confirmation and refresh profile state.
5. Record transaction IDs in the profile history.
6. Refuse mainnet submission in this phase.

Exit criteria:

- Testnet funding, burn, and registration can be executed safely with explicit confirmations.
- Resulting KOIN, VHP, mana, and registration state refresh correctly.
- No mainnet mutation code path is used.

### Phase 6 - Local One-Click Producer Setup

Objective: combine previous phases into a guided local setup.

Tasks:

1. Implement a resumable setup state machine.
2. Add clear step statuses: identity, node restore, funding, VHP, registration, validation, producer enablement.
3. Add cancellation and resume behavior.
4. Keep every submit step behind explicit confirmation.
5. Enable block production only after the validation checklist passes.

Exit criteria:

- A testnet user can create a local producer from a fresh app install with guided steps.
- The node starts observer-first and only becomes a producer after validation.
- Failed steps can be resumed without repeating already confirmed transactions.

### Phase 7 - VHP Allocation Simulator

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

### Phase 8 - Multi-Instance Local Runtime

Objective: run more than one local node instance from Koinos One.

Tasks:

1. Extend the process manager from a single managed node to multiple named node instances.
2. Allocate default ports per instance:
   - testnet JSON-RPC base `18122`, then `18123`, `18124`, ...
   - testnet P2P base `18888`, then `18889`, `18890`, ...
   - mainnet JSON-RPC base `8080`, then `8081`, `8082`, ...
   - mainnet P2P base `8888`, then `8889`, `8890`, ...
3. Detect port conflicts before start.
4. Keep logs separated per instance.
5. Show per-instance PID, config path, basedir, version, head height, peer count, producer status, and latest produced block.
6. Support start, stop, and restart per instance.

Exit criteria:

- Two testnet observer instances can run locally without port conflict.
- One observer and one producer instance can run locally with separate basedirs.
- Koinos One correctly attributes logs/status to each instance.

### Phase 9 - Remote Node Assignment

Objective: support remote distributed nodes without turning the local UX into an unsafe remote-control surface.

Tasks:

1. Add remote node records:
   - host placeholder;
   - SSH user placeholder;
   - base path;
   - node instance ID;
   - backup/bootstrap URL;
   - status endpoint or SSH health check.
2. Support bootstrap/install commands through SSH for Ubuntu hosts.
3. Keep remote backups and public bootstrap restore separate.
4. Use restricted users where possible.
5. Avoid storing raw passwords in app settings.
6. Keep wallet signing local unless the user explicitly chooses a remote-key model.

Exit criteria:

- A testnet remote observer can be installed from public bootstrap.
- A testnet remote producer can be assigned a producer profile after validation.
- Local and remote instances appear in the same Fleet view.

### Phase 10 - Fogata Testnet Integration

Objective: prove Fogata deployment and administration from Koinos One on testnet.

Tasks:

1. Add Fogata repository/version selector.
2. Verify or build Fogata WASM and ABI.
3. Add pool owner, payer/sponsor, contract account, and node operator role modeling.
4. Add pool parameter form:
   - name;
   - image;
   - description;
   - payment period;
   - beneficiaries;
   - node operator.
5. Add deployment dry-run and explicit transaction preview.
6. Deploy a testnet pool contract.
7. Register the node operator hot public key through the correct Fogata/PoB path.
8. Bootstrap and validate the node instance.
9. Monitor pool balances, stake, snapshots, reburn readiness, and produced blocks.
10. Document whether pool listing/approval is still required upstream.

Exit criteria:

- A Fogata testnet pool can be deployed or imported without mainnet mutation.
- The app can distinguish pool owner, payer, contract account, participant account, and node operator.
- The node can produce only after contract and local key validation pass.

### Phase 11 - Mainnet Controlled Rollout

Objective: enable mainnet workflows only after testnet evidence.

Required evidence before implementation:

- Testnet public bootstrap restore validated from a fresh Mac basedir.
- Local one-click testnet producer setup validated.
- Multi-profile testnet producer assignment validated.
- Testnet funding planner validated.
- Testnet transaction submission validated with explicit confirmations.
- Multi-instance process manager validated.
- Backup/restore for producer-relevant files documented.
- Fogata testnet integration validated if Fogata is included in the mainnet release scope.

Mainnet rollout steps:

1. Read-only mainnet fleet inventory.
2. Mainnet funding and VHP allocation simulator.
3. Mainnet dry-run transaction previews.
4. Explicitly gated mainnet transaction submission.
5. Small controlled mainnet operation with user review.
6. Mainnet Fogata deployment only after separate contract/security review.

Exit criteria:

- Mainnet flows are impossible to trigger accidentally.
- The user can understand and approve every transaction before signing.
- Mainnet producer state is never changed by presets, startup, restore, or background jobs.

### Phase 12 - Future Payment, DEX, And Managed Provider Track

Objective: evaluate "click, pay, run" without pretending payment/compliance work is already solved.

Tasks:

1. Define non-custodial and custodial product variants.
2. Review PayPal/card/on-ramp legal and compliance requirements.
3. Define quote, pricing, slippage, failure, refund, and support behavior.
4. Evaluate whether DEX purchase happens on Koinos, Ethereum-wrapped KOIN, or another route.
5. Define provider abstraction for server provisioning.
6. Keep all payment-provider secrets outside committed code and docs.
7. Add an ETH-to-KOIN feasibility spike:
   - guide-only external flow;
   - WalletConnect or equivalent external EVM wallet signing;
   - optional embedded EVM wallet as expert-only future work;
   - Uniswap quote/swap integration boundaries;
   - Vortex bridge integration boundaries;
   - CEX/on-ramp/manual-deposit fallback.
8. Pin official token, bridge, router/API, and chain metadata before any in-app
   transaction construction.
9. Require transaction receipts and recovery behavior for every step before
   combining swap, bridge, burn, registration, and producer activation.

Exit criteria:

- A product decision exists on whether Koinos One is only a local orchestrator or also a billing/provisioning product.
- No payment-provider integration ships without legal/compliance approval.
- No ETH wallet, DEX, or bridge integration ships without an explicit
  non-custodial security model and current official contract/API metadata.

## UX Surfaces

### Fleet Tab

Recommended top-level or Node-panel surface:

- Producer Profiles
- Node Instances
- Deployment Targets
- Funding Plans
- VHP Allocation
- Fogata Pools
- Health/Warnings

### Producer Setup Wizard

Show:

- selected network;
- selected deployment target;
- generated/imported producer-control address;
- local hot public key;
- funding source;
- required KOIN/VHP/mana;
- public bootstrap status;
- observer-first sync status;
- registration status;
- final enable-producer checklist.

### Producer Profile Details

Show:

- network;
- producer address;
- hot public key;
- registered public key;
- registration status;
- VHP;
- liquid KOIN;
- mana;
- assigned node;
- last produced block;
- backup status;
- funding history.

### Node Instance Details

Show:

- deployment target;
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

### Funding Plan Screen

Show:

- source account;
- payer account;
- target producer address;
- required KOIN transfer;
- planned KOIN burn;
- planned VHP transfer, if any;
- expected remaining KOIN;
- estimated RC/mana source;
- transaction previews;
- dry-run result;
- submit status.

### VHP Allocation Screen

Show:

- total VHP;
- current distribution;
- target distribution;
- concentration warnings;
- proposed deltas;
- transaction previews;
- exportable plan.

### Fogata Pool Screen

Show:

- pool contract address;
- owner address;
- payer/sponsor address;
- node operator address;
- node operator hot public key;
- payment period;
- beneficiaries;
- pool stake;
- pool VHP;
- participant count;
- snapshot/reburn state;
- produced blocks;
- listing/approval status, if applicable.

## Test Plan

Unit tests:

- producer profile normalization;
- deployment target normalization;
- funding plan math;
- duplicate producer address detection;
- duplicate hot-key detection;
- duplicate private-key path detection;
- duplicate basedir detection;
- port allocation;
- VHP allocation math;
- concentration warning thresholds;
- network mismatch rejection;
- transaction preview redaction;
- Fogata pool parameter validation.

Integration tests:

- create testnet observer instance from public bootstrap fixture;
- create testnet producer profile and local hot key;
- assign testnet producer profile to instance;
- validate registered-key mismatch behavior;
- simulate funding plan for an unfunded producer;
- dry-run KOIN transfer, KOIN burn, and producer-key registration;
- simulate VHP allocation plan;
- start two local testnet instances with separate ports;
- verify logs/status separation;
- import Fogata ABI/WASM metadata and validate pool parameters.

Manual testnet acceptance:

- Create two testnet producer profiles.
- Bootstrap two testnet basedirs from public read-only backup.
- Fund both producer-control addresses from a user-owned funding wallet.
- Burn testnet KOIN into VHP for each producer.
- Register producer hot keys on testnet.
- Run both producers and verify produced blocks through public testnet RPC.
- Deploy or import one Fogata testnet pool if upstream status permits.
- Validate Fogata pool owner, payer, node operator, stake, and reburn state in the UI.

Mainnet acceptance:

- Read-only inventory works without unlocking any wallet.
- Dry-run transaction previews work without submission.
- Mainnet transaction submission remains disabled until a separate explicit signoff.
- Sensitive local addresses and server inventory are not present in committed docs, tests, GUI placeholders, or examples.

## Open Product And Compliance Questions

- Should Koinos One remain a purely local non-custodial orchestrator, or should it eventually become a payment/provisioning product?
- Which payment provider or on-ramp can legally deliver KOIN to a user-generated address?
- Is a DEX route practical for acquiring KOIN directly, or does it require wrapped assets, bridge assumptions, and additional custody risk?
- Should the first ETH-to-KOIN experience be guide-only, WalletConnect-based, or
  an embedded local EVM wallet?
- Which official Ethereum token contract, Uniswap pool/route, Vortex bridge
  contract/API, and finality model should Koinos One trust?
- How should the UI explain partial completion when the swap succeeds but the
  bridge is pending, fails, or requires a claim?
- What minimum liquid KOIN reserve should remain after burning so the producer
  address still has enough mana for registration and maintenance?
- What refund and failure recovery flow applies if payment succeeds but KOIN delivery, burn, registration, or server provisioning fails?
- Should Koinos One ever sponsor setup transactions for users, or should sponsorship always be user-owned/configured?
- Does Fogata need code/security review before Koinos One exposes deployment controls?
- Is the public Fogata listing/approval contract still active and appropriate for new pools?
- What minimum VHP and minimum liquid KOIN reserve should the setup wizard recommend?
- What default concentration threshold should trigger warnings: 50%, 67%, or operator-configurable?
- Should standby/failover nodes with the same producer profile be explicitly modeled separately from distributed active producers?

## Concrete Next Engineering Tasks

1. Confirm the Fogata repository and current upstream status with the user or maintainer.
2. Write a small technical design for the producer setup state machine.
3. Add data models for producer profiles, node instances, deployment targets, and funding plans.
4. Add read-only Fleet inventory and duplicate-safety checks.
5. Add funding-plan simulator for a newly generated producer address.
6. Add testnet-only dry-run wiring for KOIN transfer, KOIN burn, and producer-key registration.
7. Add local-node creation from public bootstrap as an explicit node-instance workflow.
8. Add a minimal local producer setup wizard using existing Wallet, Producer, and Backup primitives.
9. Add Fogata ABI/WASM inspection tooling before any deployment UI.
10. Add sensitive-data grep checks to release and docs validation.
11. Write a separate ETH-to-KOIN Producer Funding Assistant technical design
    before adding WalletConnect, embedded EVM wallet, Uniswap, or Vortex code.

## Recommended Sequencing

1. Lock the design for local one-click testnet producer setup.
2. Add producer-profile, node-instance, deployment-target, and funding-plan models.
3. Add read-only Fleet view.
4. Add local public-bootstrap node-instance creation.
5. Add funding simulator for unfunded producer addresses.
6. Add testnet transaction dry-run and submission for funding, burn, and registration.
7. Add local one-click producer wizard.
8. Add VHP allocation simulator.
9. Add multi-instance local runtime.
10. Add user-owned SSH remote-node installation.
11. Add Fogata testnet integration.
12. Only then consider mainnet mutation workflows.
13. Add a guide-only ETH-to-KOIN funding assistant before any in-app EVM signing.
14. Treat PayPal/card/on-ramp/DEX/bridge/managed-provider work as a separate
    product, security, and compliance track.
