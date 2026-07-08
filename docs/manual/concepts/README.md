# Koinos Concepts

This section explains the Koinos blockchain concepts needed to operate Koinos
One safely. It is written for users and operators who need practical context
before using the desktop app or the `teleno_node` command line.

## Reading Path

1. [What Is Koinos?](what-is-koinos.md)
2. [Accounts, Keys, And Wallets](accounts-keys-wallets.md)
3. [Transactions, Blocks, And Finality](transactions-blocks-finality.md)
4. [Observers, Producers, And Mainnet](observers-producers-and-mainnet.md)

## Key Ideas

Koinos is the blockchain protocol and network family. Koinos One is a desktop
app that helps operate a Koinos-compatible node. Teleno Node is the native
`teleno_node` binary managed by Koinos One or run directly by operators.

The most important boundary is protocol compatibility: Koinos nodes can differ
in user interface, internal architecture, storage engine, or local tooling,
but they must agree on the same chain ID, blocks, transactions, state roots,
peer protocol, and externally consumed RPC behavior.

## Deeper References

- [Glossary](../reference/glossary.md) - quick definitions of the terms used
  throughout this manual.
- For developers: the
  [Koinos Protocol Compatibility Reference](../developers/deeper-references/koinos-protocol.md),
  [Current Monolithic Node Architecture](../developers/deeper-references/monolith-architecture.md),
  and [Monolith Service Coverage](../developers/deeper-references/monolith-service-coverage.md).
