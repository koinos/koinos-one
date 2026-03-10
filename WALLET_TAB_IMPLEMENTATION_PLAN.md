# Wallet Top-Level Tab Integration Plan

## Status
- Branch: `codex/wallet-tab-integration-plan`
- Document purpose: define implementation plan before executing code changes
- Target: add a first-class `Wallet` tab at top level in Knodel, integrating functionality inspired by [koinos-wallet](https://github.com/pgarciagon/koinos-wallet)

## 1. Objectives
- Add a new top-level `Wallet` tab in Knodel navigation.
- Move wallet UX out of `Producer`-centric placement into a dedicated wallet area.
- Reuse existing Knodel Electron wallet bridge/API where possible.
- Close feature gaps by porting key user flows from `koinos-wallet`:
  - Create/import/unlock wallet
  - Wallet overview (address, balances)
  - Send tokens (KOIN/VHP first)
  - Receive (address + QR)
  - Wallet settings and safety actions
- Provide producer-oriented funding actions through Wallet UI (transfer VHP to producer account, burn KOIN->VHP for producer account).
- Ship with unit/component tests to reduce regression risk.

## 2. Current Baseline (Knodel)
- `src/App.tsx` currently owns top-level tab routing and large amounts of wallet-related state.
- Top tabs include: `explorer`, `node`, `producer`, `settings`.
- Wallet logic already exists in multiple layers:
  - Frontend bridge in preload and `window.knodel.wallet`
  - Electron IPC handlers in `electron/main.ts`
  - UI controls mixed into producer workflows
- Result: `App.tsx` is oversized and wallet functionality is not discoverable as a core user surface.

## 3. Scope
### In scope (phase target)
- Add new top-level tab key: `wallet`.
- Create wallet feature module with isolated state management and UI.
- Implement wallet subviews:
  - `Overview`
  - `Send`
  - `Receive`
  - `Wallet Settings`
- Keep wallet data flow through Electron bridge (no direct node RPC from renderer unless explicitly needed).
- Add tests for wallet state/actions and key UI flows.

### Out of scope (initial delivery)
- Hardware wallet integrations.
- Advanced contact/address book sync.
- Full parity with every mobile-specific feature from `koinos-wallet` (biometric/PIN UX can be adapted later for desktop constraints).
- Complete redesign of non-wallet tabs.

## 4. Proposed Architecture
- Introduce feature folder:
  - `src/features/wallet/`
  - `src/features/wallet/components/`
  - `src/features/wallet/hooks/`
  - `src/features/wallet/services/`
  - `src/features/wallet/types.ts`
  - `src/features/wallet/__tests__/`
- Add container component (single entry for tab):
  - `WalletTab.tsx` (or `WalletPanel.tsx`)
- Extract reusable service wrappers from `App.tsx`:
  - `walletApi.ts` (typed calls to `window.knodel.wallet.*`)
- Use reducer-based state model for predictable transitions:
  - `locked`, `unlocking`, `ready`, `sending`, `error`, etc.
- Keep `App.tsx` as composition/root routing layer only (no wallet business logic).

## 5. Functional Plan (Mapped to koinos-wallet)
1. Navigation and shell
- Add `wallet` to app tab type and top tab buttons.
- Render wallet container when selected.

2. Wallet lifecycle
- Detect existing wallet on load.
- Support create/import/unlock/delete flows using existing bridge methods.
- Persist only minimal UI state in renderer; secrets remain in backend/secure storage path already used by Knodel.

3. Overview screen
- Show active address, balances (KOIN/VHP), nonce/RC where useful.
- Add refresh action and loading/error states.

4. Send screen
- Support transfer flow for KOIN first, then VHP.
- Validate destination + amount.
- Show fee/mana/RC context as available from backend APIs.
- Confirm transaction result and expose tx id or error details.

4.1 Producer funding tools (inside Wallet)
- Add guided actions for producer readiness:
  - transfer VHP from a selected source wallet account to producer account
  - burn KOIN into VHP for producer account
- Default target is current producer account when configured.
- Surface preflight checks (source balance, RC/mana, target account validity).

5. Receive screen
- Show address and copy action.
- Generate QR for receive address (desktop-friendly component).

6. Wallet settings screen
- Lock/unlock state, reveal-sensitive actions with explicit confirmation.
- RPC endpoint or wallet network settings only if consistent with current Knodel architecture.

7. Producer decoupling
- Remove or reduce wallet controls from producer tab once wallet tab is stable, replacing with link/shortcut to `Wallet`.

## 6. Electron/API Gap Check
- Reuse existing methods first (`overview`, `unlock`, `generate`, `importWallet`, `balance`, `vhp`, `nonce`, `rc`, `burn`, etc.).
- If send transfer is missing end-to-end, add focused IPC methods:
  - `knodel:wallet:transferKoin`
  - `knodel:wallet:transferVhp`
- Keep new APIs small and typed in `src/knodel-electron.d.ts` + `electron/preload.ts`.

## 7. Testing Strategy
### Unit tests
- Wallet reducer/state machine transitions.
- Wallet API wrapper behavior and error normalization.
- Input validators (address/amount/precision).

### Component tests
- Tab render and navigation into Wallet.
- Create/import/unlock happy path with mocked bridge.
- Send flow validation and submit behavior.
- Receive copy/QR visibility.
- Producer funding actions in Wallet (VHP transfer + burn target account behavior).

### Integration/smoke
- App loads with new wallet tab without breaking existing tabs.
- Existing producer functionality still works after wallet extraction.

## 8. Delivery Phases
1. Phase 1: Scaffold
- Add tab type + route + empty wallet container.
- Add wallet feature folders/types/services skeleton.

2. Phase 2: Lifecycle + Overview
- Implement create/import/unlock/delete + overview data fetching.
- Add initial tests.

3. Phase 3: Send + Receive
- Implement send and receive flows with validations and tests.

4. Phase 4: Producer cleanup
- Remove duplicated wallet logic from producer area.
- Keep backward-safe compatibility paths where needed.

5. Phase 5: Hardening
- Error handling pass, accessibility pass, test stabilization, docs updates.

## 9. Acceptance Criteria
- New `Wallet` tab appears at top level and is usable.
- User can create/import/unlock wallet from Wallet tab.
- User can view balances and receive address + QR.
- User can send supported assets with clear validation/error feedback.
- Unit/component tests pass locally in CI-equivalent command set.
- `App.tsx` is materially reduced in wallet-specific logic.

## 10. Risks and Mitigations
- Risk: hidden coupling between producer and wallet states.
  - Mitigation: extract behind typed wallet service and reducer before UI migration.
- Risk: Electron API mismatch for send actions.
  - Mitigation: define explicit typed IPC additions with tests before wiring UI.
- Risk: regression due to large `App.tsx` edits.
  - Mitigation: incremental commits/phases + tests at each phase.

## 11. Execution Notes
- Implementation will proceed in this branch only:
  - `codex/wallet-tab-integration-plan`
- Recommended PR structure:
  1. Scaffold + tab routing
  2. Wallet core (lifecycle/overview)
  3. Send/receive + tests
  4. Producer cleanup + docs
