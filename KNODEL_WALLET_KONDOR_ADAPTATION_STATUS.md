# Knodel Wallet Kondor Adaptation Status

## Implemented in this branch

### Backend

- wallet storage migrated to a vault-v2-compatible shape with legacy migration
- multi-account vault support:
  - list accounts
  - set active account
  - create derived account
  - import additional WIF account
  - import watch-only account
  - rename account
  - remove account
- unlocked wallet session now exposes all unlocked accounts, not only one implicit signer
- wallet transaction flows now sign with the selected active account
- producer registration now accepts the active wallet account id and stores signer/burn references by account id
- new Electron IPC / preload / bridge surface added for wallet account operations

### Renderer

- Wallet tab reorganized into a modular shell with focused components
- new wallet layout:
  - account bar
  - overview strip
  - subtabs: `Portfolio`, `Activity`, `Accounts`, `Secrets`, `Advanced`
- empty state kept simple for create/import
- locked state improved with vault summary
- accounts UI added:
  - activate account
  - create derived account
  - import WIF account
  - import watch-only account
  - rename account
  - remove account
- secrets moved into a dedicated `Secrets` subtab
- advanced actions kept available through the `Advanced` subtab
- session-level wallet activity list added for recent wallet actions inside Knodel

### Tests

- added storage tests for:
  - legacy wallet migration
  - multi-account vault mutations
- added wallet service tests for multi-account account management
- extended IPC tests for the new wallet account channels

## Validation

- baseline before changes: `npm test`
- final validation after changes:
  - `npm test`
  - `npm run build`

## Still pending from the full long-term plan

These items remain outside the scope of this implementation pass:

- true on-chain account activity/history with pagination
- generic token transfer flow for arbitrary tokens
- token watchlist persistence and richer token portfolio management
- token pricing beyond the current core balance view
- receive QR generation
- NFT support
- external request approval / signing center

## Recommended next steps

1. Implement a real wallet activity backend service instead of session-only activity.
2. Add generic token transfer and custom token watchlist persistence.
3. Add receive QR and copy helpers in the receive modal.
4. Add renderer tests for the new wallet subtabs and account flows.
