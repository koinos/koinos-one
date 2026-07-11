# Koinos Node Manager Integration Boundary

Last updated: 2026-07-11

Koinos One installs and operates one primary local Teleno node. Multi-node,
fleet, and remote-server management belong to the separate
[Koinos Node Manager](https://github.com/pgarciagon/koinos-node-manager)
product.

The separation keeps Koinos One's context unambiguous: Explorer, Dashboard,
Node, Producer, Wallet, and Backup refer to the primary local node and its local
identities. Selecting or managing a remote node must never silently change that
context.

## Shared Integration Surface

The products may share independently versioned, UI-neutral contracts:

- Teleno capability and health schemas;
- native build and artifact identity;
- administrative client requests and responses;
- backup/restore progress and result envelopes;
- deterministic plan, progress, receipt, and redaction primitives;
- network and producer-readiness query types;
- optional visual tokens and low-level controls.

They do not share application navigation, persisted settings, secret stores,
active-node context, or orchestration state. Koinos One must remain fully usable
without Node Manager, and Node Manager must manage a Teleno target without
requiring Koinos One to be installed on that target.

Remote-management code currently present in Koinos One predates this product
boundary. It should be extracted through separately reviewed changes after the
shared contracts and equivalent tests exist in Node Manager. Documentation for
the extraction and future fleet implementation lives in the Node Manager
repository.
