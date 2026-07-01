# Producer Mode

Producer mode is for configuring a node to sign and produce blocks for a
producer address. It is intentionally separate from observer setup.

## When To Use This

Use this page only after the node has run as a healthy observer and you are ready
to review producer identity, wallet funding, VHP, local producer keys, and
registration state.

## Before You Start

- Confirm the node is on the intended network.
- Confirm `BASEDIR` and `Config` point to the intended node data.
- Confirm the node is healthy as an observer.
- Back up the producer wallet seed or WIF.
- Confirm the producer address has enough KOIN, VHP, and mana/RC for the action
  you intend to perform.
- Confirm the local public key shown in `Producer` is the one you intend to
  register.

## Default And Advanced Modes

In default mode, Koinos One keeps the producer address, producer wallet, and burn
wallet aligned. The active producer wallet is the signer and the producer
address.

Enable advanced producer mode in `Settings` only when you intentionally need a
producer address that is different from the unlocked signing wallet.

## Producer Tab

The `Producer` tab can show:

- `Producer address`;
- `Local public key`;
- `Registered public key`;
- producer wallet KOIN, VHP, and mana status;
- registration status;
- latest produced blocks;
- `Register producer`, `Replace key`, `Reconfigure setup`, or `Delete producer`
  actions depending on state.

If the local producer key is missing, Koinos One may ask you to start the
`block_producer` component once so `BASEDIR/block_producer/private.key` and
`BASEDIR/block_producer/public.key` can be created.

## High-Level Setup Flow

1. Start and monitor the node as an observer.
2. Open `Wallet` and create or import the producer wallet.
3. Unlock the wallet for the current app session.
4. Confirm balances and mana.
5. Open `Producer`.
6. Confirm the target producer address.
7. Confirm the local public key.
8. Register the local producer public key only after reviewing the on-chain
   effect.
9. Burn KOIN into VHP or transfer VHP only after reviewing the wallet action.
10. Enable block production only after the observer, wallet, VHP, and key checks
    pass.

## How To Verify It Worked

- `Producer address` matches the intended account.
- `Local public key` is present.
- `Registered public key` matches the local public key after registration.
- The producer wallet has enough VHP and mana.
- The node remains connected and synced.
- After production is intentionally enabled, `Latest produced blocks` shows
  blocks from this producer when the producer wins slots.

## Stop And Ask Before Continuing

Stop before any of these actions:

- registering or replacing a producer key on mainnet;
- burning KOIN into VHP;
- transferring VHP;
- enabling `Block Producer`;
- changing `Producer Address`;
- editing `Private Key File`;
- exposing JSON-RPC or gRPC outside localhost while producer controls exist.

For mainnet, verify the selected network, signer, target producer address, local
public key, VHP balance, and operation type before submitting anything.

## Delete Producer

`Delete producer` clears the producer link in Koinos One and removes the runtime
producer address from `config.yml`. It does not unregister the producer key
on-chain.

## Related Pages

- [Wallet And Accounts](wallet-and-accounts.md)
- [Syncing A Node](syncing-a-node.md)
- [Troubleshooting](troubleshooting.md)
