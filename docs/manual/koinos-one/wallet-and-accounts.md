# Wallet And Accounts

The `Wallet` tab manages local wallet accounts stored by Koinos One. A wallet
is not required to run an observer, but it is required for actions that sign
transactions.

## When To Use This

Use this page when creating a wallet, importing a seed phrase or WIF private key,
unlocking a wallet, managing accounts, sending tokens, burning KOIN into VHP, or
preparing a producer wallet.

## Before You Start

- Back up any seed phrase or WIF outside Koinos One before funding the account.
- Never paste private keys, seed phrases, wallet passwords, or screenshots of
  secrets into public docs, issues, or chats.
- Confirm the selected network before checking balances or signing.
- Keep `Dry run` enabled for transaction workflows until you have reviewed the
  target, amount, fee/mana behavior, and network.

## Wallet States

The `Wallet` tab can show:

- empty wallet state with `Import with WIF`, `Import with seed`, and `Create`;
- locked wallet state with `Unlock`;
- unlocked wallet state with account balances and actions;
- account management views for derived, imported WIF, and watch-only accounts.

Watch-only accounts can monitor an address but cannot sign.

## Create Or Import A Wallet

To create a new wallet:

1. Open `Wallet`.
2. Choose `Create`.
3. Write down the seed phrase before creating the wallet.
4. Enter and confirm a password.
5. Confirm that the new account address appears.

To import an existing wallet:

1. Open `Wallet`.
2. Choose `Import with seed` or `Import with WIF`.
3. Enter the seed phrase or WIF.
4. Enter and confirm a password.
5. Confirm the imported address.

## Unlock And Use Accounts

1. Open `Wallet`.
2. Enter the wallet password.
3. Choose `Unlock`.
4. Select the `Current account` when multiple accounts exist.
5. Use `Receive`, `Send`, or `Burn` from the account view.

The app refreshes balances while the wallet tab is open. Balance queries depend
on the active RPC source for the selected network.

## Send Or Burn

`Send` transfers KOIN or VHP from the current account.

`Burn KOIN into VHP` burns KOIN and allocates the resulting VHP to the receiver
account. By default, the receiver is the current account address.

`Use free mana` can be enabled when you intentionally want to use available free
mana for the operation.

## How To Verify It Worked

- The `Current account` shows the expected address.
- The account is `Unlocked` for the current app session.
- Balances refresh without an RPC error.
- A successful send or burn appears in `Activity` for the session.
- The transaction result matches the target account, asset, and amount you
  intended.

## Think Twice Before These Actions

Stop before disabling `Dry run`, sending funds, burning KOIN into VHP, or using
a wallet to register or replace a producer key on mainnet. Confirm the network,
signer address, receiver address, amount, and operation type first.

## Security Notes

`Show secrets` displays stored wallet secrets for the selected account when the
wallet can reveal them. Use it only in a private environment.

`Delete wallet` removes the encrypted wallet stored on this computer. It does
not recover funds. Continue only if you have the seed phrase or WIF for every
funded account you still need.

## Related Pages

- [Producer Mode](producer-mode.md)
- [First-Run Setup](first-run-setup.md)
- [Troubleshooting](troubleshooting.md)
