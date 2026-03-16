# Knodel Wallet Upgrade Plan Based on Kondor

## Goal

Bring the Knodel wallet much closer to Kondor's wallet feature set, but adapted to Knodel's role as a desktop node manager instead of a browser extension.

This document does **not** propose an exact visual clone of Kondor. It proposes:

- feature parity where the feature still makes sense in Knodel
- a Knodel-native wallet information architecture
- a detailed phased implementation plan
- migration, testing, and acceptance criteria

## Source Analysis

### Kondor files reviewed

- `kondor/src/index/router.js`
- `kondor/src/index/views/2-NewWallet.vue`
- `kondor/src/index/views/3a-ImportSeedPhrase.vue`
- `kondor/src/index/views/3b-ImportPrivateKey.vue`
- `kondor/src/index/views/3c-GenerateSeed.vue`
- `kondor/src/index/views/3d-ConfirmSeed.vue`
- `kondor/src/index/views/4-Dashboard.vue`
- `kondor/src/index/views/5-Signers.vue`
- `kondor/src/index/views/setting-CreateAccount.vue`
- `kondor/src/index/views/setting-ImportAccount.vue`
- `kondor/src/index/views/setting-UpdateAccount.vue`
- `kondor/src/index/views/tokens/SendToken.vue`
- `kondor/src/index/views/tokens/ReceiveToken.vue`
- `kondor/src/index/views/tokens/AddToken.vue`
- `kondor/src/index/views/tokens/Settings.vue`
- `kondor/src/index/views/AccountHistory.vue`
- `kondor/src/index/components/WalletInfo.vue`
- `kondor/src/index/components/WidgetTokens.vue`
- `kondor/src/index/components/TabPanel.vue`
- `kondor/src/index/components/AccountMenu.vue`
- `kondor/src/shared/components/Unlock.vue`
- `kondor/src/shared/mixins/Storage.js`
- `kondor/src/shared/store.js`
- `kondor/src/services/tokenPriceService.js`
- `kondor/src/services/accountService.js`
- `kondor/src/popup/views/1-GetAccounts.vue`
- `kondor/src/popup/views/2-SignSendTransaction.vue`
- `kondor/src/popup/views/3-SignMessage.vue`

### Knodel files reviewed

- `src/components/panels/WalletPanel.tsx`
- `src/App.tsx`
- `electron/lib/wallet-service.ts`
- `electron/lib/main-types.ts`
- `src/knodel-electron.d.ts`

## Executive Assessment

Kondor wallet is not just a send/receive screen. It is a broader wallet product with these domains:

1. wallet onboarding and recovery
2. encrypted vault unlock flow
3. multiple accounts inside one wallet
4. imported private-key accounts
5. watch-only accounts
6. token portfolio management
7. send/receive flows
8. mana visibility
9. activity history
10. token list management
11. NFT view
12. account rename and switching
13. secrets management
14. popup approval flows for external websites

Knodel today has a much narrower wallet:

- one encrypted wallet file
- one active address
- create/import/unlock/close/delete
- show secrets
- KOIN and VHP balances
- send KOIN
- transfer VHP
- burn KOIN to VHP
- optional free mana
- several low-level RPC methods already exposed in Electron, but not surfaced in the UI

The main conclusion is:

- the Knodel backend already has a useful wallet foundation
- the current UI is producer-oriented and single-account
- the biggest missing piece is the wallet data model and renderer shell, not cryptography

## Kondor Feature Inventory and Knodel Adaptation

| Capability | Kondor status | Knodel status today | Recommended adaptation for Knodel |
| --- | --- | --- | --- |
| Create wallet from seed | Implemented | Implemented | Keep, but fold into a multi-account vault model |
| Seed confirmation step | Implemented | Not implemented | Add as optional safety step during wallet creation |
| Import from seed | Implemented | Implemented | Keep |
| Import from private key / WIF | Implemented | Implemented | Keep |
| Unlock wallet session | Implemented | Implemented | Keep |
| Multiple derived accounts | Implemented | Not implemented | Add as a first-class Accounts feature |
| Import extra accounts into same wallet | Implemented | Not implemented | Add |
| Watch-only accounts | Implemented | Not implemented | Add |
| Rename accounts | Implemented | Not implemented | Add |
| Switch active account | Implemented | Not implemented | Add |
| Token portfolio list | Implemented | Not implemented | Add |
| USD pricing | Implemented | Only partial KOIN/VHP context elsewhere | Add with Knodel-adapted price sources |
| Mana visualization | Implemented | Partial backend value exists, UI barely surfaces it | Add as a core overview metric |
| Receive screen with QR | Implemented | Not implemented | Add |
| Generic token send | Implemented | Only KOIN and VHP actions | Add generic token transfer |
| Memo support | Implemented | Not implemented | Add |
| Recipient resolution by nickname / KAP | Implemented | Not implemented | Add |
| Free mana advanced controls | Implemented | Basic checkbox only | Expand |
| Token add/remove | Implemented | Not implemented | Add |
| Activity history | Implemented | Not implemented | Add |
| NFT list | Implemented via Kollection | Not implemented | Optional, phase after core wallet parity |
| Account links / explorer shortcuts | Implemented | Very limited | Add simple desktop-adapted shortcuts |
| Signers management | Placeholder / partial | Not implemented | Treat as low-priority advanced feature |
| External dApp account selection | Implemented in popup | Not applicable yet | Future separate request-approval feature |
| Sign message | Implemented in popup | Not implemented | Future separate request-approval feature |
| Sign/send transaction review | Implemented in popup | Not implemented | Future separate request-approval feature |
| Approval / allowance helper | Implemented in popup | Not implemented | Future separate request-approval feature |

## What Should Not Be Copied 1:1

Some Kondor features are specific to being a browser extension and should not be copied directly into the Wallet tab:

- popup account picker for websites
- popup transaction approval window
- popup sign-message flow
- origin-based trust prompts

Those flows require an external requester. Knodel does not currently expose a wallet-connect or browser-injected signing API. They should be planned as a later feature family, not forced into the Wallet tab now.

## Recommended Product Scope

### Phase A: must-have wallet parity inside Knodel

- multi-account vault
- seed-based and WIF-based accounts in one vault
- watch-only accounts
- account switching and renaming
- receive with QR
- portfolio and token list
- generic token send
- improved KOIN / VHP / mana overview
- activity history
- secrets screen
- token management

### Phase B: good additions after core parity

- NFT view
- explorer and profile shortcuts
- buy / swap links
- better token metadata sources

### Phase C: future wallet platform features

- transaction approval center
- sign message
- dApp connection / get accounts
- allowance management

## Proposed Wallet Tab UX for Knodel

### Design principle

Do not turn Knodel into a tiny Kondor popup clone.

Knodel has more horizontal space and already uses:

- stat cards
- horizontal subtabs
- card grids
- modal dialogs for secrets / destructive actions
- footer status strip

The wallet redesign should stay consistent with that system.

### High-level layout

When unlocked, the Wallet tab should have four layers:

1. account bar
2. overview strip
3. wallet subtabs
4. subtab content

### 1. Account bar

A compact top row inside the Wallet panel, containing:

- active account selector
- account type badge: `Derived`, `Imported WIF`, or `Watch-only`
- quick action buttons: `Receive`, `Send`, `Show secrets`
- secondary actions menu: `Create account`, `Import account`, `Rename`, `Close wallet`, `Delete wallet`

Why:

- Kondor makes account identity very central
- Knodel currently hides account identity too deeply
- this keeps the wallet producer-friendly while enabling future multicuenta work

### 2. Overview strip

A row of 4 to 6 stat cards, always visible while unlocked:

- Total portfolio value
- Available KOIN
- Available VHP
- Available mana or liquid KOIN
- Last balance refresh
- Optional current RPC source

Behavior:

- refresh asynchronously in the background
- no blocking loaders
- no `...` placeholder flicker once a value has been loaded at least once

### 3. Wallet subtabs

Recommended subtabs:

- `Portfolio`
- `Activity`
- `Accounts`
- `Secrets`
- `Advanced`

This is better than putting every function on one long screen.

### 4. Subtab content

#### Portfolio

This becomes the main default view.

It should include:

- token list table
- token balances
- token USD values
- mana indicator
- quick row actions: `Send`, `Receive`, `Open in explorer`
- section for `KOIN` and `VHP` pinned at the top
- optional action card for `Burn KOIN -> VHP`

Recommended composition:

- left: token portfolio table
- right: quick action cards for `Send`, `Receive`, `Burn`

#### Activity

A transaction history list scoped to the active account.

Each row should show:

- direction: sent / received / contract call / burn / producer-related
- token symbol
- amount
- counterparty summary
- timestamp
- tx id
- explorer link

Optional filters:

- `All`
- `Transfers`
- `Burns`
- `Producer`

#### Accounts

This is where Knodel catches up to Kondor.

The Accounts subtab should include:

- account list inside the current vault
- active account marker
- account name
- address
- type badge
- quick actions: `Make active`, `Rename`, `Show QR`, `Remove`
- create/import controls

Create/import actions:

- create next derived account from existing seed
- import WIF account
- import watch-only account

Important adaptation:

- if the vault was created from WIF only and has no seed, `Create account` must be disabled with a clear explanation
- the user can still import more WIF or watch-only accounts

#### Secrets

This subtab replaces today's single-purpose modal as the persistent secure-information area.

It should show the active account secrets only after an explicit action.

Suggested sections:

- Account Address
- WIF
- Key Path
- Seed Phrase
- Copy buttons
- warning note

Rules:

- if the active account is WIF-only, show WIF and address only
- if the active account is watch-only, show no secrets
- if the vault has a seed, show the root seed plus the selected account derivation path

Modal use:

- keep a modal for the final reveal confirmation
- show the actual data inside the subtab after confirmation, not only in a transient pop-up

#### Advanced

This subtab should contain low-frequency tools that clutter the main wallet if shown by default:

- raw KOIN transfer advanced options
- generic token transfer advanced options
- payer / payee / RC limit options
- free mana status
- read contract helper
- address resolution diagnostics
- optional chain info block

This is where the richer Kondor `SendToken` advanced section can live without making the main wallet feel heavy.

## Locked State UX

Keep the current Knodel direction:

- centered unlock card
- address visible
- password field
- `Unlock` button

But after the wallet expansion, add a very small secondary line:

- vault summary: `5 accounts, seed-backed`

Do not show Portfolio, Activity, Accounts, or Secrets while locked.

## Empty State UX

Keep a simple empty state, but make the choices more product-complete:

- `Create wallet`
- `Import with seed`
- `Import with WIF`
- `Import watch-only account`

Short supporting text:

- for a new user: create a new seed-based vault
- for an existing user: import seed or WIF
- for monitoring-only usage: add a watch-only account

## Proposed Data Model Refactor

### Current problem

Knodel currently stores one encrypted wallet with this shape:

- one address
- one encrypted private key
- optional encrypted seed phrase
- optional derivation path

That model is too narrow for Kondor-like capabilities.

### Proposed new vault model

Replace the current single-wallet model with a vault model.

Suggested shape:

```json
{
  "version": 2,
  "createdAt": "2026-03-12T00:00:00.000Z",
  "defaultAccountId": "acc_derived_0",
  "encryptedSeedPhrase": {
    "encrypted": "...",
    "salt": "...",
    "iv": "...",
    "authTag": "..."
  },
  "seedFingerprint": "optional-non-secret-id",
  "accounts": [
    {
      "id": "acc_derived_0",
      "name": "Account 1",
      "kind": "derived",
      "address": "1...",
      "derivationPath": "m/44'/659'/0'/0/0",
      "createdAt": "2026-03-12T00:00:00.000Z",
      "archived": false
    },
    {
      "id": "acc_imported_wif_0",
      "name": "Treasury",
      "kind": "imported-wif",
      "address": "1...",
      "encryptedKey": {
        "encrypted": "...",
        "salt": "...",
        "iv": "...",
        "authTag": "..."
      },
      "createdAt": "2026-03-12T00:00:00.000Z",
      "archived": false
    },
    {
      "id": "acc_watch_0",
      "name": "Producer monitor",
      "kind": "watch-only",
      "address": "1...",
      "createdAt": "2026-03-12T00:00:00.000Z",
      "archived": false
    }
  ],
  "preferences": {
    "tokensByChainId": {
      "mainnet": ["koin", "vhp"]
    }
  }
}
```

### Session model

In-memory unlocked session should also change from one address to a vault session:

- unlocked vault metadata
- decrypted seed phrase if available
- decrypted WIFs for imported accounts
- active account id

### Producer coupling

The wallet is currently still conceptually "producer wallet" in several places.

That coupling should be reduced:

- the wallet vault should become generic
- the producer profile should reference an account address or account id, not assume the only wallet account is the producer signer

This is critical, because once multicuenta exists, producer and wallet cannot stay hard-coupled to one implicit address.

## Network Model Recommendation

Kondor thinks in terms of named networks like `mainnet` and `harbinger`.

Knodel should not copy that directly.

Because Knodel can point to:

- local jsonrpc
- public fallback RPC
- custom RPCs
- possibly private/dev chains

the wallet should key token preferences, activity cache, and portfolio data by a stable network identity:

- preferably `chain_id`
- with a readable fallback label

This is more future-proof than hardcoding two network names.

## Required Backend Surface

Knodel already has useful wallet APIs:

- `overview`
- `generate`
- `importWallet`
- `unlock`
- `closeWallet`
- `deleteWallet`
- `deriveFromSeed`
- `showSeed`
- `balance`
- `vhp`
- `nonce`
- `rc`
- `tokenBalance`
- `readContract`
- `transferKoin`
- `transferVhp`
- `burn`
- `chainInfo`
- `block`

To reach Kondor-like wallet behavior, add these new IPC capabilities.

### Vault and accounts

- `wallet.vaultOverview()`
- `wallet.listAccounts()`
- `wallet.setActiveAccount({ accountId })`
- `wallet.createDerivedAccount({ name })`
- `wallet.importAccountWif({ name, wif })`
- `wallet.importWatchAccount({ name, address })`
- `wallet.renameAccount({ accountId, name })`
- `wallet.removeAccount({ accountId })`
- `wallet.accountSecrets({ accountId })`

### Portfolio and tokens

- `wallet.tokenList({ chainId, accountId })`
- `wallet.tokenAdd({ chainId, tokenSource, nickname, contractId })`
- `wallet.tokenRemove({ chainId, contractId })`
- `wallet.tokenMetadata({ chainId, contractId })`
- `wallet.portfolio({ accountId })`
- `wallet.tokenPrices({ chainId, accountId })`
- `wallet.resolveRecipient({ value })`

### Transactions

- `wallet.transferToken({ accountId, contractId, to, amount, memo, freeMana, payer, rcLimit, dryRun })`
- `wallet.receiveInfo({ accountId })`
- `wallet.activity({ accountId, cursor, limit })`

### Optional parity

- `wallet.nfts({ accountId })`
- `wallet.signMessage(...)`
- `wallet.reviewTransaction(...)`
- `wallet.getAccountsForRequester(...)`

## UI Component Refactor Recommendation

Do not continue growing a single `WalletPanel.tsx` file.

Split the wallet renderer into focused components.

Suggested structure:

```text
src/components/panels/wallet/
  WalletShell.tsx
  WalletLockedState.tsx
  WalletEmptyState.tsx
  WalletAccountBar.tsx
  WalletOverviewStrip.tsx
  WalletPortfolioTab.tsx
  WalletActivityTab.tsx
  WalletAccountsTab.tsx
  WalletSecretsTab.tsx
  WalletAdvancedTab.tsx
  WalletSendCard.tsx
  WalletBurnCard.tsx
  WalletReceiveModal.tsx
  WalletCreateModal.tsx
  WalletImportSeedModal.tsx
  WalletImportWifModal.tsx
  WalletImportWatchModal.tsx
  WalletDeleteModal.tsx
```

This refactor is necessary even before feature parity, otherwise the Wallet tab will become the next oversized context file.

## Price Source Strategy

Kondor uses MEXC for `KOIN/USDT` and external token quote sources.

Knodel should adapt that rather than copy it blindly.

Recommended strategy:

1. `KOIN -> USD`
   - use the same price source family already used elsewhere in Knodel if possible
   - otherwise use a dedicated price service module with source fallback

2. non-KOIN token pricing
   - use KoinDX or other on-chain quote aggregation where reliable
   - if a token has no trustworthy quote, show `N/A`

3. price service must be optional
   - wallet functionality must not fail if pricing is unavailable

## Activity Source Strategy

Kondor mixes account history APIs and event decoding.

Knodel should use a layered strategy:

1. first choice: a chain/account history service if configured
2. second choice: local RPC plus decoded block/event scans within a bounded window
3. never block the wallet UI on full-chain scans

Important:

- activity must support pagination or cursors
- decoder output should normalize into one UI row model
- if history is unavailable, the user should still have a functional wallet

## NFT Strategy

Kondor uses Kollection API, which is external and non-core.

Recommendation:

- do not make NFTs part of the initial core wallet parity milestone
- implement as an optional sub-feature behind a service boundary
- show an explicit data-source label when enabled

## Detailed Phased Implementation Plan

## Phase 0: Freeze Current Behavior and Add Baseline Tests

### Objective

Create a safe baseline before changing wallet architecture.

### Tasks

- add unit tests around current `wallet-service.ts`
- add tests for current wallet file load/save/unlock/delete behavior
- add tests for `showSeed`, `transferKoin`, `transferVhp`, `burn`, and free mana flows
- add renderer tests for current locked/empty/unlocked Wallet states
- document current wallet IPC contract

### Acceptance criteria

- current wallet flows are covered by tests before refactor
- no functionality changes yet

## Phase 1: Introduce Vault V2 Storage and Migration

### Objective

Move from single-wallet storage to vault storage without breaking existing users.

### Tasks

- define `KnodelWalletVaultV2` and related session types
- create migration logic from current wallet file to vault v2
- keep backward read compatibility during rollout
- migrate the single stored wallet into:
  - one vault
  - one default account
  - same encrypted secrets
- keep the existing file path during transition or create a new `wallet-v2` file and migrate once

### Edge cases

- seed-backed current wallet
- WIF-only current wallet
- locked wallet
- missing or corrupted optional seed fields

### Acceptance criteria

- existing Knodel users do not lose wallet access
- producer registration flows still resolve the same default signer address

## Phase 2: Account Domain and Session Model

### Objective

Enable multi-account operation inside the vault.

### Tasks

- implement account list, create, import, rename, remove, activate
- support account kinds:
  - `derived`
  - `imported-wif`
  - `watch-only`
- implement session unlock that reconstructs all accessible accounts
- persist active account id
- validate imported WIF matches derived address

### Acceptance criteria

- a seed-backed vault can add a second derived account
- a WIF-only vault can import another WIF account
- a watch-only account can coexist with signing accounts

## Phase 3: Wallet Shell Renderer Refactor

### Objective

Refactor the Wallet UI into modular components before feature growth.

### Tasks

- split `WalletPanel.tsx` into subcomponents
- add wallet subtabs
- add account bar and overview strip
- preserve current empty and locked states during the shell migration
- keep current create/import/unlock/delete working through the new shell

### Acceptance criteria

- the visual shell is in place
- current functionality still works
- file size and context size of wallet UI are significantly reduced

## Phase 4: Accounts Subtab

### Objective

Match Kondor's account management model inside Knodel.

### Tasks

- implement account list with type badges
- create derived account flow
- import WIF account flow
- import watch-only account flow
- rename account flow
- remove account flow
- activate account flow

### UX rules

- active account must be visually obvious
- dangerous actions require confirmation
- watch-only accounts must show limited actions

### Acceptance criteria

- the user can manage multiple accounts without leaving the Wallet tab

## Phase 5: Portfolio and Token Management

### Objective

Bring Kondor's token-centric dashboard into Knodel.

### Tasks

- implement portfolio overview endpoint
- fetch balances for KOIN, VHP, and custom tokens
- build token list UI
- pin KOIN and VHP at the top
- add price service integration
- implement `Add token` and `Remove token`
- store watched tokens per network identity
- resolve token metadata and decimals

### UX rules

- prices and balances refresh in background
- keep the last known good values visible during refresh
- never block send/burn actions because a price refresh is happening

### Acceptance criteria

- wallet shows a portfolio table, not only KOIN and VHP cards

## Phase 6: Send, Receive, Burn, and Advanced Controls

### Objective

Upgrade wallet actions to Kondor-level usefulness.

### Tasks

- add generic token send
- add memo field
- add recipient resolution for address / nickname / KAP-like identifiers
- add receive modal with QR
- keep `Burn KOIN -> VHP`
- expand advanced controls:
  - use free mana
  - explicit payer
  - RC limit
  - dry run
- keep common action flows simple and hide advanced controls by default

### Acceptance criteria

- the user can send KOIN, VHP, and arbitrary configured tokens from the same wallet surface

## Phase 7: Activity

### Objective

Port Kondor's account history value into Knodel.

### Tasks

- implement history data service
- normalize transfers, burns, and contract interactions into one row model
- decode known token events
- add pagination
- add filter chips
- add explorer links

### Acceptance criteria

- the wallet shows useful recent activity per active account

## Phase 8: Secrets and Recovery

### Objective

Make wallet recovery and secret inspection clear and safe.

### Tasks

- convert current `Show secrets` modal into a structured secrets experience
- show seed only for seed-backed vaults
- show WIF for WIF accounts
- show nothing secret for watch-only accounts
- support copy actions with clear warnings
- optionally add seed confirmation during create-wallet flow

### Acceptance criteria

- users can clearly understand what recovery material exists for each account type

## Phase 9: Optional NFT Support

### Objective

Add Kondor's NFT visibility without destabilizing the core wallet.

### Tasks

- isolate NFT data source behind a service
- add `NFTs` as a nested view under `Portfolio` or as its own subtab
- show data-source label
- tolerate service outages cleanly

### Acceptance criteria

- NFT support is additive and optional

## Phase 10: Optional Request Approval Center

### Objective

Adapt Kondor popup capabilities into a future Knodel-native signer platform.

### Tasks

- define whether Knodel will expose any local wallet API
- if yes, build a `Requests` surface for:
  - get accounts
  - sign message
  - sign/send transaction review
  - allowance approval
- reuse decoded operation and event rendering ideas from Kondor popup

### Acceptance criteria

- only begin this phase if Knodel intentionally becomes an external signer

## Testing Strategy

### Backend tests

- vault migration tests
- account creation/import/remove tests
- seed-backed and WIF-only vault tests
- watch-only account tests
- token metadata resolution tests
- generic token send tests
- free mana tests
- activity normalization tests

### Renderer tests

- empty state
- locked state
- unlocked overview
- account switching
- watch-only restrictions
- token add/remove
- send form validation
- receive modal
- secrets visibility rules

### Integration tests

- create wallet from seed
- unlock and switch accounts
- import WIF account
- import watch-only account
- send KOIN
- send custom token
- burn KOIN to VHP
- show activity
- show secrets
- producer tab still works with selected wallet account

### Manual QA scenarios

- migrate an existing single-account Knodel wallet
- use local RPC only
- use public fallback RPC only
- run with `jsonrpc` unavailable
- run with pricing unavailable
- run with history unavailable

## Major Risks

### 1. Wallet/producer coupling

Current producer logic assumes one wallet address in several flows.

Mitigation:

- define explicit producer signer selection
- do not infer producer signer from "the only wallet account"

### 2. Data migration risk

Changing secret storage is the highest-risk part.

Mitigation:

- migrate once
- keep backup copy
- add migration tests
- expose recovery diagnostics in development

### 3. External dependency drift

Pricing, NFT, and history APIs may fail or change.

Mitigation:

- isolate each external source behind a service
- keep wallet usable without them

### 4. UI bloat

If everything is added to one panel, the Wallet tab will become unreadable.

Mitigation:

- use subtabs
- use focused cards
- reserve modals for secrets, confirmations, and short flows only

## Recommended Delivery Order

If this work starts soon, the best execution order is:

1. baseline tests
2. vault v2 migration
3. account/session model
4. wallet shell refactor
5. accounts UI
6. portfolio/tokens
7. send/receive/generic transfer
8. activity
9. secrets UX
10. optional NFT support
11. optional request approval center

## Final Recommendation

The correct goal is **not** "make Knodel look like Kondor".

The correct goal is:

- give Knodel a real multi-account desktop wallet
- keep it consistent with Knodel's current panel-based design
- port the useful Kondor wallet capabilities
- explicitly defer extension-only approval flows until Knodel has a reason to expose them

In practical terms, the best first milestone is:

- vault v2
- accounts
- portfolio
- generic send/receive
- activity
- secrets

That would already cover most of the wallet value that Kondor delivers, while keeping the implementation aligned with Knodel's architecture.
