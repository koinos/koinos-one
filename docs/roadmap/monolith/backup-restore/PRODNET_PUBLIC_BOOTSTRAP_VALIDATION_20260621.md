# Prodnet Public Bootstrap Validation

- Date: 2026-06-21
- Scope: Prodnet public bootstrap metadata, operator ProdNet node validation, and release-readiness status
- Status: ProdNet public bootstrap and ProdNet node operation are marked working for the current release track

## Validation Sources

This status combines two validation inputs:

- Operator validation: the operator confirmed on 2026-06-21 that the ProdNet node has been validated in production and that production tests passed.
- Local CLI verification: `teleno_node --backup-public-list` successfully listed the public ProdNet bootstrap repository over HTTPS from the local Mac.

No prodnet wallet files, producer private keys, or chain-mutating operations were used by this documentation update.

## Public ProdNet Bootstrap Route

```text
https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
```

The route is separate from the testnet public bootstrap route and from private SFTP backup repositories.

## CLI Verification

Command:

```bash
node/teleno-node/build/src/teleno_node \
  --backup-public-list \
  --backup-public-url https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap \
  --backup-json
```

Result summary:

```text
source: public_http
snapshot_count: 1
latest_backup_id: 20260620T201059Z-ms-1781986259826-files-452
network: mainnet
public_base_url: https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
```

Published snapshot:

| Field | Value |
| --- | --- |
| Backup ID | `20260620T201059Z-ms-1781986259826-files-452` |
| Created | `20260620T201506Z` |
| Promoted | `20260621T004828Z` |
| Node ID | `public-bootstrap-mainnet` |
| Source node version | `0.1.0+2b55452664c7-dirty` |
| Storage layout | `unified` |
| File/object count | `455` |
| Total object bytes | `26,959,549,655` |
| Minimum restore free bytes | `27,093,767,383` |
| Recommended restore free bytes | `37,831,185,623` |

## Acceptance Result

ProdNet is now accepted as working for:

- public read-only bootstrap metadata listing over HTTPS;
- published mainnet native backup inventory visibility;
- operator-validated production node operation;
- operator-completed production tests.

Restored ProdNet nodes should still start as observers first. Mainnet block production remains an explicit operator action and must not be enabled automatically by restore, bootstrap, or first-run setup.

## Remaining Release Hardening

These are release-process tasks, not blockers for marking the current ProdNet validation as working:

- attach detailed production test transcripts if a formal release audit requires them;
- document the ProdNet public-bootstrap signing key/reviewer evidence when available;
- define snapshot freshness and retention policy;
- decide whether future ProdNet `latest.json` promotions require two-person approval;
- keep signed/notarized Mac DMG and CI release automation tracked separately from ProdNet runtime validation.
