# Network-Scoped Producer Wallet Binding Plan

Last updated: 2026-06-09

## Goal

Bind the producer address, producer profile, and producer wallet vault to the active Teleno network mode. A producer identity configured for testnet must never be shown, unlocked, registered, burned, transferred from, or persisted as a mainnet producer identity, and the reverse must also be true.

## Current Problem

Teleno currently uses global producer storage:

- `secure-storage/producer-wallet.json`
- `secure-storage/producer-profile.v1.json`

That layout lets the UI switch from testnet to mainnet while still resolving the same wallet vault or producer profile. Even when RPC calls use the selected network, the local signer identity can leak across network contexts. This is especially risky on mainnet because a real funded producer address must never be mutated accidentally.

## Target Model

Use a network-scoped identity model:

- Mainnet producer wallet: `secure-storage/mainnet/producer-wallet.json`
- Mainnet producer profile: `secure-storage/mainnet/producer-profile.v1.json`
- Testnet producer wallet: `secure-storage/testnet/producer-wallet.json`
- Testnet producer profile: `secure-storage/testnet/producer-profile.v1.json`
- Custom producer wallet: `secure-storage/custom/producer-wallet.json`
- Custom producer profile: `secure-storage/custom/producer-profile.v1.json`

The legacy global files remain readable only for compatibility and migration support, but all active GUI operations must use the selected network-specific path.

## Implementation Steps

1. Add network-aware storage selectors in `electron/lib/teleno-storage.ts`.
   - Accept an optional `network` argument for wallet/profile path resolution.
   - Normalize missing or invalid network values to `mainnet`.
   - Write all new wallet/profile data into network-specific directories.
   - Keep legacy global path helpers available for migration and tests.

2. Thread network through wallet service calls.
   - Extend wallet import, overview, list accounts, unlock, close, delete, account mutation, and secret-loading flows with `network`.
   - Use the active network wallet vault for every wallet operation.
   - Clear the in-memory unlocked wallet when a different network is requested.

3. Thread network through producer profile calls.
   - Resolve profile get/clear/save/delete/register through `settings.network`.
   - Store `network` in `TelenoProducerProfile`.
   - Reject or ignore a loaded profile whose stored network does not match the requested network.

4. Update renderer calls.
   - Pass `nodeSettings.network` into Wallet and Producer IPC calls.
   - Refresh wallet/producer state on network changes.
   - Ensure Producer and Wallet tabs show empty state when the selected network has no wallet/profile, rather than falling back to another network.

5. Add unit tests.
   - Storage tests: mainnet and testnet wallets/profiles use distinct paths and do not cross-load.
   - Wallet service tests: switching networks closes or ignores an unlocked wallet from the previous network.
   - Producer service tests: profile get/clear/register uses the requested network path.

6. Validation.
   - Run focused unit tests for storage/wallet/producer behavior.
   - Run `npm run build`.

## Safety Rules

- No automatic reuse of testnet wallets on mainnet.
- No automatic reuse of mainnet wallets on testnet.
- No mutating mainnet producer operation unless the selected network is explicitly mainnet and the signer/profile belong to the mainnet storage namespace.
- The known funded mainnet producer address `<PROTECTED_MAINNET_PRODUCER_ADDRESS>` remains protected by the project memory guardrail.

## Acceptance Criteria

- Changing Settings from mainnet to testnet changes the wallet/profile namespace.
- Wallet tab on testnet does not show a mainnet wallet.
- Producer tab on testnet does not show a mainnet producer profile.
- Producer registration on testnet persists only the testnet producer profile.
- Deleting the testnet wallet/profile does not delete the mainnet wallet/profile.
- Unit tests prove network isolation at the storage and service layers.
