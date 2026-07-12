# Missing Work And New Ideas

This index tracks documented work that is not yet fully implemented, validated,
or approved for production use. It should be the first place to look before
starting a new feature or claiming full legacy parity.

## Highest Priority Gaps

1. Full account-history parity and historical backfill.
   - Current status: simplified service exists, but it is not full legacy parity
     and is disabled in the current prodnet deployment.
   - Required outcome: restored/bootstrap nodes can answer historical
     account-history queries with legacy-compatible behavior.

2. Historical index backfill for transaction and contract metadata stores.
   - Current status: forward indexing exists.
   - Required outcome: restored/bootstrap databases either include these column
     families or can rebuild them safely from retained block data.

3. Signed prodnet public bootstrap publication and governance.
   - Detailed plan: `backup-restore/PRODNET_PUBLIC_BOOTSTRAP_PUBLICATION_PLAN.md`.
   - Required outcome: a public prodnet bootstrap source with signed metadata,
     validation evidence, and clear publication/retention rules.

## Backup And Restore Backlog

- `backup-restore/NATIVE_BACKUP_REMAINING_WORK_PLAN.md` - UX/productization,
  admin-backed restore, richer status, validation, and release hardening.
- `backup-restore/PUBLIC_BOOTSTRAP_RESTORE_REMAINING_WORK_PLAN.md` - remaining
  public bootstrap restore validation, metadata, and UX polish.
- `backup-restore/PRODNET_PUBLIC_BOOTSTRAP_PUBLICATION_PLAN.md` - prodnet public
  bootstrap publication workflow.
- `backup-restore/PUBLIC_BOOTSTRAP_DISK_OPTIMIZATION_IDEA.md` - proposed
  low-disk public restore modes for cost-efficient VPS observer deployment.

## Separate Node Manager Product

Multi-node, fleet, and remote-node management now belong to the separate
[Koinos Node Manager](https://github.com/pgarciagon/koinos-node-manager)
product. Koinos One remains focused on installing and operating one primary
local Teleno node. Shared runtime, health, artifact, plan, and receipt contracts
may be extracted into independently versioned libraries used by both products.

## Producer And Wallet Backlog

- `producer/NETWORK_SCOPED_PRODUCER_WALLET_PLAN.md` - network-scoped producer
  wallet/profile isolation and safety rules.
- Multi-producer fleet and VHP planning now lives in
  [Koinos Node Manager](https://github.com/pgarciagon/koinos-node-manager).

## GUI Backlog

- `gui/EXPERIMENTAL_3D_EXPLORER_PLAN.md` - experimental real-time 3D scene of
  transaction flow (mempool, ordering, block sealing) inside the Explorer tab.

## Strategy And Product Direction

- `strategy/KOINOS_ONE_CLICK_NODE_AND_AGENT_STRATEGY.md` - market and product
  strategy for Koinos One as a click-to-run node, producer onboarding surface,
  and future agent trust layer.

## Storage Backlog

- `storage/UNIFIED_ROCKSDB_IMPLEMENTATION_PLAN.md` - remaining migration,
  validation, and prodnet rollout work for the unified storage model.

## Networking Backlog

- `networking/P2P_PUBLIC_PEER_IDENTITY_PLAN.md` - deterministic P2P identity
  persistence, legacy `p2p.seed` compatibility, public multiaddr reporting, and
  public-peer validation.
- `networking/LIBP2P_STREAM_EXCEPTION_HARDENING_PLAN.md` - plan to contain
  cpp-libp2p stream exceptions, prevent P2P peer churn from aborting
  `teleno_node`, and restore reliable scheduled public-backup publication.

## Additional Deferred Work

- gRPC ACL enforcement matching the intended JSON-RPC access-control model.
- Runtime component restart/supervision hardening.
- Remaining log-prefix normalization below the monolith wrapper.

Mainnet observer and producer validation is complete. Continued mainnet soak,
legacy/Teleno comparison, and operational monitoring are ongoing regression
work, not an uncompleted activation gate.
