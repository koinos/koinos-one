# Observers, Producers, And Mainnet

A Koinos node can follow the chain as an observer, or it can be configured to
produce blocks. Koinos One is designed around an observer-first workflow because
that is the safest way to bring a node online.

## Observer Nodes

An observer node syncs, validates, stores, and serves blockchain data without
producing blocks.

Observer mode is the safest default for:

- first-run setup;
- restored nodes;
- new machines;
- troubleshooting;
- public bootstrap restore;
- test deployments before producer activation.

A healthy observer should be able to follow the selected network, connect to
peers, process blocks, and expose the expected local RPC surfaces.

## Producer Nodes

A producer node is configured to sign and produce blocks for a producer address.
Producer mode is optional and controlled by runtime configuration.

Production requires more than starting the process. Before enabling production,
an operator should verify:

- database health;
- selected network;
- peer and sync health;
- producer address;
- local producer public key;
- on-chain producer key registration;
- VHP status;
- wallet/signing expectations.

Producer setup changes, VHP burns, producer registration, default-account
changes, config writes targeting a producer, and transaction signing or
submission are high-risk mainnet actions. The app always asks for your
explicit confirmation before performing them — take that moment to re-check
the selected network and every address involved.

## Mainnet, Testnet, And Private Networks

| Network Type | Purpose | Operational Notes |
| --- | --- | --- |
| Mainnet | The public production Koinos network. | Treat signing, VHP, producer, and config changes as high risk. |
| Testnet | A public testing network. | Useful for testing workflows with lower real-world risk, but still verify network selection. |
| Private network | A custom network controlled by its operators. | All nodes must share the same generated genesis data and settings. |

Data and balances are network-specific. A wallet address may look the same
across contexts, but chain state belongs to the selected network.

## Why Observer First Matters

Observer-first operation reduces the chance that a node produces from an
unhealthy or misconfigured state.

This matters especially after restore. A restored node should first prove that
it can follow the target network as an observer. Only after sync, database
health, network identity, producer address, VHP, and producer-key checks pass
should production be considered.

## Public Bootstrap Restore

Public bootstrap restore means restoring from a public read-only backup source.
It does not mean exposing public administrative control.

Backup admin endpoints are local-only and protected by local administrative
configuration. Public bootstrap is about making a backup available for download,
not making node administration public.

## Koinos One And Teleno Node Roles

Koinos One provides the desktop interface, settings, first-run setup, backup
and restore workflows, wallet workflows, and process supervision.

Teleno Node is the native monolithic node process. It embeds the Koinos runtime
components that were historically separate services and connects them with
direct in-process calls plus an internal event bus.

That monolithic design is an implementation choice. It must preserve Koinos
protocol compatibility, P2P behavior, and externally consumed RPC behavior.

## Safe Operating Rule

Use observer mode until the node proves it is healthy. Enable producer mode
only when the operator has explicitly confirmed the target network, producer
address, local key, VHP status, and intended operation.
