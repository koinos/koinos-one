# Producer + Wallet Account Integration Plan (Post Wallet Tab)

## Status
- Branch: `codex/wallet-tab-integration-plan`
- Purpose: define the next integration stage after Wallet tab delivery
- Scope of this document: upgrade `Producer` flows so producer registration and burn operations are wallet-account driven

## 1. Problem to Solve
Today, producer registration and burn rely on a single stored "producer wallet" path and session unlock.  
After Wallet is promoted to a top-level feature, Producer must consume wallet accounts as the source of truth.

Requested target behavior:
1. Initial producer registration must require a wallet account created/imported in Wallet first.
2. Registration should bind a selected producer address to the local producer public key (`BASEDIR/block_producer/public.key`).
3. During setup, user must choose whether producer address is the selected wallet account address or a different address.
4. Producer startup readiness must include VHP allocation path for the producer account (transfer VHP or burn KOIN via Wallet).
5. Once producer setup is complete, burn operations must require the producer account to exist/selected in Wallet.

## 2. Desired End State
- Wallet owns account lifecycle (import/create/unlock/select).
- Producer owns node-specific registration and producer status.
- A producer profile links:
  - target producer address (on-chain producer record)
  - local node public key fingerprint/path
  - wallet account used to sign registration
  - wallet account used for burn (default same as registration signer, editable)
- Burn is blocked unless a valid producer burn account is configured and unlocked in Wallet.
- Registration default policy enforces `signerAccount.address === producerAddress`.
- Delegated signer is supported only as an explicit advanced override.
- Producer setup cannot start without at least one wallet account in Wallet.
- Wallet provides producer funding actions (VHP transfer and KOIN->VHP burn) required for production readiness.

## 3. Key Architectural Decision
Separate responsibilities:
- `Wallet` module:
  - account vault, account list, unlock state, active/default account, signing capabilities
- `Producer` module:
  - registration status, local key detection, runtime config updates, producer analytics
- Shared bridge contract between them:
  - explicit account identifier input for producer register/burn operations

This avoids Producer owning wallet secrets/UI and eliminates duplicated import/unlock flows.

## 4. Data Model and Persistence
Add a producer linkage model (renderer + backend typed):
- `producerAddress: string`
- `registrationSignerAccountId: string`
- `burnAccountId: string` (default = `registrationSignerAccountId`)
- `localPublicKey: string`
- `localPublicKeyPath: string`
- `registeredPublicKey: string | null`
- `lastRegistrationTxId: string | null`
- `updatedAt: string`

Persistence options:
- Fixed: `secure-storage/producer-profile.v1.json`
- Resolved path: `path.join(app.getPath('userData'), 'secure-storage', 'producer-profile.v1.json')`
- File write policy: `mode 0o600` with atomic temp-write + rename
- Keep runtime `config.yml` producer address write behavior unchanged for node compatibility.

## 5. API/Bridge Changes
## 5.1 Producer register API
Current register flow infers one unlocked producer wallet.  
Upgrade to explicit signer selection:
- `koinosNode.producerRegister(params)` additions:
  - `signerAccountId: string` (required)
  - `producerAddress?: string` (required in advanced mode; default derived in normal mode)
  - `allowDelegatedSigner?: boolean` (default `false`)
  - `persistProfile?: boolean` (default true)

Backend behavior:
- resolve signer from Wallet account vault by `signerAccountId`
- verify account unlocked (or support password prompt flow through wallet unlock API)
- enforce `signerAccount.address === producerAddress` when `allowDelegatedSigner !== true`
- if delegated signer is enabled, require explicit confirmation metadata/logging before signing
- sign `register_public_key(producer, localPublicKey)` with selected signer
- persist producer profile and runtime config when successful

## 5.2 Burn API
Current `wallet.burn` uses the single producer wallet.  
Upgrade to account-aware execution:
- `wallet.burn(params)` additions:
  - `accountId?: string` (required unless producer profile has `burnAccountId`)
  - `useProducerBurnAccount?: boolean` (default true)

Backend behavior:
- resolve account from wallet vault
- if `useProducerBurnAccount`, enforce `accountId === producerProfile.burnAccountId`
- block if producer burn account missing/unlocked state false

## 5.3 Producer profile APIs
Add focused endpoints:
- `koinosNode.producerProfileGet()`
- `koinosNode.producerProfileSet(params)`
- `koinosNode.producerProfileClear()`

## 6. UI/UX Plan
## 6.1 Producer tab (post-upgrade)
- UI has two explicit states:
  - `Not Setup`: show only setup CTA and minimal setup requirements.
  - `Setup Complete`: show read-only producer dashboard.
- `Not Setup` state rules:
  - show `Setup Producer` button as primary action
  - step 1: require at least one Wallet account; if none exists, show CTA `Create/Import Wallet Account` and block setup
  - step 2: select funding/signer wallet account (must be unlocked and have enough KOIN/mana for registration)
  - step 3: ask `Use this wallet address as producer address?`
  - if yes: producer address = selected wallet account address
  - if no: show producer address input + optional delegated signer advanced toggle
  - step 4: registration preflight checks (local key exists, address valid, signer ready, mana ready)
  - step 5: post-registration readiness checks for producer account VHP and RC
  - hide dashboard metrics/cards until setup succeeds
- `Setup Complete` state rules:
  - show read-only dashboard (registration status, local key, registered key, balances/stats, data sources)
  - show no editable registration form by default
  - show explicit `Reconfigure` action to return to setup flow when needed
- Add explicit warnings:
  - "No wallet accounts available"
  - "Selected account locked"
  - "Burn account not configured"
- Remove burn execution form from Producer UI and show Wallet deep-link for burn actions.

## 6.2 Wallet tab
- Add Producer Account section:
  - show linked producer profile
  - assign/change burn account
  - quick action to unlock linked account
- Add Producer Funding section:
  - `Transfer VHP` to producer account from another wallet account
  - `Burn KOIN -> VHP` for producer account
  - default target account = current producer account
- Burn action:
  - default account = producer burn account
  - block or confirm if user selects non-linked account
- Wallet is the only place where burn transactions are executed in UI.

## 6.3 Migration UX
If legacy `producer-wallet.json` exists:
- migrate to wallet account store on first run
- create producer profile with migrated account as registration + burn account
- show one-time migration notice in Producer/Wallet

## 7. Delivery Phases
1. Phase A: Wallet prerequisites
- Confirm Wallet feature provides account IDs, list, active account, unlock status, and signing by account ID.

2. Phase B: Producer profile backend
- Implement producer profile model + storage + typed bridge contracts.

3. Phase C: Registration refactor
- Update `producerRegister` to require account ID and persist profile on success.
- Keep current config write to `block_producer.producer`.

4. Phase D: Burn refactor
- Update burn flow to resolve signer from profile burn account.
- Enforce account presence/unlock preconditions.
- Remove Producer burn form and replace with Wallet shortcut/context.

5. Phase E: UI migration
- Remove Producer wallet import/unlock duplication.
- Add account selectors/profile cards in Producer.
- Add producer-account controls and funding actions in Wallet.
- Implement Producer state machine: `not-setup` and `setup-complete` with dedicated UI paths.

6. Phase F: Migration + compatibility
- Legacy wallet migration path + fallback states + rollback-safe behavior.

7. Phase G: Testing and hardening
- unit, component, and smoke/e2e coverage for account selection and gating rules.

## 8. Testing Plan
Unit tests:
- producer profile validation and persistence
- register precondition checks (missing account, locked account, missing local key, invalid address)
- burn precondition checks (missing/locked burn account, mismatched account)
- setup precondition checks (missing wallet account, insufficient KOIN/mana, missing VHP readiness path)

Component tests:
- Producer tab account selector + register CTA state matrix
- Producer `not-setup` state only shows setup flow and CTA
- Producer `setup-complete` state shows read-only dashboard and hides setup inputs
- Wallet producer account settings interactions
- Wallet producer funding actions (VHP transfer and burn to target producer account)
- Migration banner visibility and actions

Integration/smoke:
- legacy wallet migration path
- register producer using selected wallet account updates on-chain and local profile
- burn succeeds only with configured producer burn account

## 9. Acceptance Criteria
- Producer registration cannot run without selecting/unlocking a wallet account.
- Registration writes local node public key for the target producer address and persists producer profile linkage.
- By default, producer registration rejects signer accounts that do not match producer address.
- Delegated signer registrations work only through explicit advanced override.
- In `not-setup`, setup is blocked until at least one wallet account exists in Wallet.
- In `not-setup`, user must explicitly choose same-address or different-address producer registration path.
- Wallet exposes producer funding operations: transfer VHP to producer account and burn KOIN into VHP for producer account.
- Burn cannot run unless a producer burn account is configured in Wallet and unlocked.
- Producer tab no longer owns wallet import/unlock flows duplicated from Wallet.
- Producer UI is stateful:
  - if not configured, show setup-only experience
  - if configured, show read-only dashboard by default
- Burn execution is available in Wallet UI only.
- Existing nodes with legacy producer wallet can migrate without losing capability.

## 10. Risks and Mitigations
- Risk: breaking existing single-wallet setups.
  - Mitigation: one-time migration from legacy file + backward compatibility window.
- Risk: confusion between "active wallet account" and "producer burn account".
  - Mitigation: explicit labels and enforced defaults in UI.
- Risk: signing with wrong account for producer actions.
  - Mitigation: strict preflight checks and confirmation dialogs with account/address summary.

## 11. Open Decisions (to lock before implementation)
- None.

## 12. Locked Decisions
- Producer registration policy: enforce `signerAccount.address === producerAddress` by default.
- Delegated signer: allowed only in advanced mode with explicit user opt-in.
- Burn UI policy: execute burn operations in Wallet only (Producer shows status + link to Wallet).
- Producer profile metadata storage: `secure-storage/producer-profile.v1.json` (under `app.getPath('userData')`).
- Producer tab UX: two states only (`Not Setup` with setup button; `Setup Complete` read-only dashboard).

## 13. Recommended PR Breakdown
1. Producer profile backend + types + tests
2. Account-aware producer registration refactor
3. Account-aware burn refactor
4. Producer/Wallet UI wiring and migration UX
5. Documentation and end-to-end validation checklist
