# Prodnet Public Bootstrap Publication Plan

- Date: 2026-06-21
- Scope: prodnet read-only public bootstrap publication and restore
- Status: published and operator-validated for the current ProdNet release track; see `PRODNET_PUBLIC_BOOTSTRAP_VALIDATION_20260621.md`

## Goal

Provide the same first-install experience that now exists for testnet: a node operator can restore a recent prodnet observer database from a public read-only HTTPS repository without SSH credentials, then start the node as an observer before deciding whether to enable any producer workflow.

Prodnet bootstrap publication must be treated as a release operation, not as an ad hoc backup copy. The published snapshot becomes a trust anchor for new operators, so it needs deterministic promotion steps, validation evidence, rollback, and explicit human approval before it is made visible as `latest`.

## Non-Negotiable Safety Rules

- Do not publish prodnet snapshots from a producer basedir that contains wallet files, producer private keys, admin tokens, SSH credentials, or private backup configuration.
- Do not mutate prodnet chain state during publication, restore validation, or observer acceptance.
- Do not use or inspect prodnet wallet material during this workflow.
- Do not use the funded mainnet producer address `14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb` for any mutating operation.
- Restored prodnet nodes must start with `features.block_producer: false` and `chain.verify-blocks: true`.
- `latest.json` must be published last and must only move after validation passes.
- The prodnet signing key must be separate from testnet and separate from any producer/wallet key.

## Target Repository Shape

Use the same public repository contract already implemented for testnet:

```text
<prodnet-public-base-url>/
  latest.json
  snapshots/
    <backup-id>/
      manifest.json
      files.json
      public-bootstrap.json
      public-bootstrap-signature.json
      COMPLETE
  objects/
    sha256/
      <aa>/
        <bb>/
          <sha256>
```

The prodnet public backup route should live under `seed.koinosfoundation.org/backups`, separated from the testnet route:

```text
https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
```

The important constraint is that testnet and prodnet must not share a `latest.json`, snapshot directory, signing key, or route. The prodnet route root is `https://seed.koinosfoundation.org/backups`; the `prodnet/teleno-bootstrap` suffix keeps the Teleno public-bootstrap repository distinct from any other backup content served by that host.

## Published ProdNet State

The current public ProdNet route is live and listable:

```text
https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
```

Current latest snapshot:

```text
20260620T201059Z-ms-1781986259826-files-452
```

`teleno_node --backup-public-list --backup-json` returned this snapshot on 2026-06-21 with:

- network `mainnet`;
- node ID `public-bootstrap-mainnet`;
- storage layout `unified`;
- `455` files/objects;
- `26,959,549,655` object bytes;
- minimum restore free space `27,093,767,383` bytes;
- recommended restore free space `37,831,185,623` bytes.

The operator also confirmed on 2026-06-21 that the ProdNet node has been validated in production and production tests passed. The acceptance record is `PRODNET_PUBLIC_BOOTSTRAP_VALIDATION_20260621.md`.

## Snapshot Source Requirements

Use an observer-only prodnet source basedir, not a producer basedir.

Required source properties:

- fully synced or acceptably close to current prodnet head at promotion time;
- `chain.verify-blocks: true`;
- `features.block_producer: false`;
- no wallet or producer-key files under the basedir;
- unified RocksDB layout;
- native backup snapshot created through the hot-checkpoint path;
- source manifest includes, when available, chain ID, source node version, source created time, head height, LIB height, and storage layout.

Before promotion, run a source audit:

```bash
find <prodnet-source-basedir> -maxdepth 4 \
  \( -iname '*wallet*' -o -iname '*.pem' -o -iname '*.p12' -o -iname '*.pfx' -o -iname '*private*' -o -iname '*password*' -o -iname '*passphrase*' -o -iname 'admin.token' \) \
  -print
```

The audit must return no publishable secrets. Any positive result must be reviewed and either removed from the source or covered by the public promotion denylist before proceeding.

## Signing Plan

Create or document the prodnet Ed25519 public-bootstrap signing key as part of formal release hardening:

```bash
mkdir -p ~/.teleno/public-bootstrap-signing
openssl genpkey -algorithm ed25519 \
  -out ~/.teleno/public-bootstrap-signing/prodnet-ed25519.pem
chmod 600 ~/.teleno/public-bootstrap-signing/prodnet-ed25519.pem
openssl pkey -in ~/.teleno/public-bootstrap-signing/prodnet-ed25519.pem \
  -pubout \
  -out config/public-bootstrap/prodnet-ed25519.pub
```

The private key remains outside the repo. The public key should be reviewed and committed only after the signed payload and operational ownership are confirmed.

Signed payload coverage must include:

- `latest.json`;
- `manifest.json`;
- `files.json`;
- `public-bootstrap.json`;
- backup ID;
- network;
- chain ID;
- object count;
- total bytes;
- sanitized config hash.

## Promotion Flow

1. Create a native backup from the observer-only prodnet source.
2. Run the public promotion script in dry-run mode with `--network mainnet`.
3. Confirm the dry-run report contains no private source paths or secrets.
4. Confirm the sanitized config disables block production and enables block verification.
5. Promote into a staging directory that is not served as public `latest`.
6. Validate object count, byte totals, `files.json`, manifest, public metadata, and signature envelope.
7. Upload/sync staged content to the prodnet public route without updating `latest.json`.
8. Run exact-backup-ID list/fetch/restore validation against the staged snapshot.
9. Start the restored node as prodnet observer on isolated ports and verify it opens RocksDB, validates blocks, advances head, and stays non-producing.
10. Write the acceptance evidence into this directory.
11. Only after review, publish `latest.json` atomically.

## Restore Validation Gates

Minimum gates before public prodnet `latest` can move:

- C++ public restore tests pass.
- Promotion unit and smoke tests pass.
- HTTPS list with `signature-required: true` passes.
- Full HTTPS restore into a clean basedir passes.
- Restored node starts with producer disabled.
- Restored node opens RocksDB and reaches `[node] teleno_node ready`.
- Live observer run samples head progress for at least 30 minutes.
- No producer-key, wallet, SSH, admin-token, or private backup files exist in the public inventory.
- Disk-space preflight reports clear minimum and recommended byte counts.
- Rollback is tested by restoring the previous `latest.json`.

## Rollback

Never delete the previous prodnet public snapshot during promotion.

Keep:

- previous `latest.json`;
- previous snapshot metadata;
- previous objects;
- validation report for the previous published snapshot.

Rollback is a single atomic replace of `latest.json` back to the previous signed snapshot. Because objects are content-addressed, old objects can be garbage-collected only after a separate retention review.

## Teleno UX Exposure

UX can expose prodnet public restore once the product decision is made, because the ProdNet route is now published and operator-validated. It must still default restored nodes to observer mode.

When enabled, UX must show:

- network `mainnet`;
- public URL;
- backup creation time;
- source node version;
- source head and LIB height when available;
- total restore bytes;
- minimum and recommended free space;
- warning that restore starts as observer and does not enable block production.

## Open Decisions

- Prodnet signing key creation date and reviewer.
- Minimum freshness threshold for published prodnet snapshots.
- Retention policy for old prodnet public bootstrap snapshots.
- Whether prodnet publication should require two-person approval before moving `latest.json`.

## Current Status

ProdNet public bootstrap is no longer blocked as a working path. The public route is published, `--backup-public-list` sees the latest mainnet snapshot over HTTPS, and the operator has confirmed production-node validation and tests. Remaining items are release-governance hardening tasks: signing-key evidence, freshness/retention policy, optional two-person promotion approval, and attaching detailed production test transcripts if needed for a formal release audit.
