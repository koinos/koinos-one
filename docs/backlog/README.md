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

3. Mainnet/prodnet long-run validation.
   - Current status: observer and bootstrap flows have evidence, but full
     production signoff still needs longer mainnet observation, comparison, and
     operator reports.

4. Signed prodnet public bootstrap publication and governance.
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

## Producer And Wallet Backlog

- `producer/NETWORK_SCOPED_PRODUCER_WALLET_PLAN.md` - network-scoped producer
  wallet/profile isolation and safety rules.
- `producer/DISTRIBUTED_PRODUCER_FLEET_AND_VHP_PLAN.md` - multi-producer fleet
  and VHP allocation product direction.

## Storage Backlog

- `storage/UNIFIED_ROCKSDB_IMPLEMENTATION_PLAN.md` - remaining migration,
  validation, and prodnet rollout work for the unified storage model.

## Additional Deferred Work

- Deterministic P2P identity persistence/runtime support.
- gRPC ACL enforcement matching the intended JSON-RPC access-control model.
- Mainnet producer activation signoff.
- Runtime component restart/supervision hardening.
- Remaining log-prefix normalization below the monolith wrapper.
- Final signed/notarized Koinos One DMG validation and first-run UX signoff.
