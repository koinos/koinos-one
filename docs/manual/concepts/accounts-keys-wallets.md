# Accounts, Keys, And Wallets

Koinos accounts are controlled through cryptographic keys. A wallet is the tool
or local storage that helps manage those keys and sign transactions.

In Koinos One, wallet features exist to help users store accounts locally and
sign explicit actions. A wallet is powerful because it can authorize on-chain
changes. Treat it as sensitive local material.

## Accounts

An account is represented by an address. The address is the public identity
that can hold tokens, control contract actions, or be registered as a producer
address.

Example placeholder:

```text
<YOUR_MAINNET_PRODUCER_ADDRESS>
```

Use placeholders like this in documentation and examples. Do not publish real
local producer addresses or private wallet material.

## Private Keys And Signatures

A private key authorizes actions for an account. When a transaction is signed,
the signature proves that the account owner authorized the transaction.

Anyone with the private key can potentially sign actions for that account. For
that reason:

- never paste private keys into public docs, logs, issues, screenshots, or
  chats;
- do not store private keys in ordinary config examples;
- verify the selected network and account before signing any transaction.

## Wallets In Koinos One

Koinos One can store wallet accounts locally so the app can help with actions
such as transfers, burns, or producer registration. The app should not treat
chain-mutating actions as background automation.

Actions that sign or submit transactions require explicit user intent. This is
especially important on mainnet.

## KOIN

KOIN is the native token commonly used with Koinos accounts. Users may hold
KOIN in an account and use it in workflows that depend on balances, resource
availability, or producer setup.

Koinos One should present balances and account state as information for the
selected network. A balance on one network is not a balance on another network.

## RC

RC means Resource Credits. RC is the resource accounting mechanism used by
Koinos transactions.

Instead of thinking only in terms of a simple transaction fee, Koinos users
should understand that each transaction consumes resources. The same valid
transaction on the same state must consume resources deterministically.

For operators, the practical point is simple: a transaction may fail or be
unavailable if the signing account does not have enough usable resources for
the operation.

## VHP

VHP means Virtual Hash Power. In production-style Proof of Burn behavior, VHP
is part of producer weight and block production economics.

VHP matters when configuring a producer. A node should not be treated as ready
for mainnet production just because it is running. Production should be enabled
only after database health, network, producer address, VHP, and producer-key
checks pass.

## Producer Keys

A producer setup involves more than a normal wallet balance. The runtime node
has local producer key material, and the producer address must be aligned with
the on-chain registration expected by the network.

Registering or replacing a producer key is a chain-mutating action. It must be
treated as high risk on mainnet and should require a fresh explicit request,
network and address confirmation, and a dry-run or reviewable plan.

## Safety Checklist

Before signing or submitting any transaction, verify:

- the selected network;
- the signing account;
- the target address;
- the operation type;
- whether the action mutates mainnet state.

For producer-related actions, also verify:

- the producer address;
- the local producer public key;
- VHP status;
- whether production is currently disabled or enabled.
