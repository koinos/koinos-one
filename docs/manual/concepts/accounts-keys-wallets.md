# Accounts, Keys, And Wallets

Koinos accounts are controlled through cryptographic keys. A wallet is the tool
or local storage that helps manage those keys and sign transactions.

In Koinos One, wallet features exist to help users store accounts locally and
sign explicit actions. A wallet is powerful because it can authorize on-chain
changes. Treat it as sensitive local material.

## Accounts

An account is represented by an address. The address is the public identity
that can hold tokens, control contract actions, or be registered as a producer
address. Addresses are visible on chain to everyone; sharing an address is
normal — for example, to receive a transfer.

What must stay secret is the private key behind the address, and any wallet
files or recovery material that contain it. Never share those, and be careful
where screenshots, logs, or support requests might expose them.

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
such as transfers, burns, or producer registration. The app never signs or
submits a transaction in the background: every action that signs or submits
requires your explicit confirmation. This is especially important on mainnet.

## KOIN

KOIN is the native token of the Koinos blockchain. Users may hold KOIN in an
account and use it in workflows that depend on balances, resource
availability, or producer setup.

Koinos One presents balances and account state for the currently selected
network. A balance on one network is not a balance on another network.

## RC

RC means Resource Credits. RC is the resource accounting mechanism used by
Koinos transactions.

Instead of paying a simple transaction fee, each Koinos transaction consumes
resources from the signing account. Resource consumption is deterministic:
the same transaction on the same state always costs the same.

For operators, the practical point is simple: a transaction may fail or be
unavailable if the signing account does not have enough usable resources for
the operation.

## VHP

VHP means Virtual Hash Power. In Koinos Proof of Burn consensus, VHP is the
producer weight: it determines how often a producer can produce blocks and is
central to block production economics.

VHP matters when configuring a producer. A node should not be treated as ready
for mainnet production just because it is running. Production should be enabled
only after database health, network, producer address, VHP, and producer-key
checks pass.

## Producer Keys

A producer setup involves more than a normal wallet balance. The runtime node
has local producer key material, and the producer address must be aligned with
the on-chain registration expected by the network.

Registering or replacing a producer key is a chain-mutating action. Treat it
as high risk on mainnet: double-check the selected network, the producer
address, and the key you are registering before confirming.

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
