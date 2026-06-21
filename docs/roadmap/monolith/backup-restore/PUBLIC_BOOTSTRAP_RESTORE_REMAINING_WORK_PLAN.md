# Public Bootstrap Restore Remaining Work Plan

- Date: 2026-06-21
- Scope: remaining work after Mac CLI/admin/UX testnet implementation and ProdNet operator validation
- Status: CLI implementation, admin API, Teleno UX integration, promotion tooling, sanitized signed testnet publication, real HTTPS restore validation, pinned testnet verification key, signature-required HTTPS validation, richer public metadata, longer Linux observer acceptance, and ProdNet public bootstrap publication are complete; ProdNet node operation is operator-validated

## Baseline

Already implemented in `teleno_node`:

- `--backup-public-list`
- `--backup-public-fetch`
- `--backup-public-restore`
- `--backup-public-url <url>`
- `backup.public-restore` config parsing
- HTTP(S) and `file://` fetch support
- SHA-256 verification for downloaded objects
- restore preflight, staging, activation, and observer-safe first-install config generation
- local admin API public restore routes for config, snapshots, fetch, preflight, stage, and activation
- Teleno UX Node > Backups integration with separate local, private SFTP remote, and public bootstrap inventories
- optional Ed25519 public-bootstrap signature verification through `backup.public-restore.signature-required` and `backup.public-restore.signature-public-key-file`
- optional signed snapshot promotion through `scripts/promote-public-bootstrap-backup.js --signing-private-key-file`
- pinned testnet public verification key at `config/public-bootstrap/testnet-ed25519.pub`
- unit tests and synthetic CLI fixture validation

Configured public testnet route:

```text
https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap
```

Server path:

```text
/srv/teleno-backups/testnet/public/teleno-bootstrap
```

Published public snapshot:

```text
20260617T215046Z-ms-1781733046440-files-72
```

Publication and restore validation completed on 2026-06-20:

- `latest.json` is published at the public HTTPS route.
- `latest.json` points at `public-bootstrap-signature.json`.
- Public list from a clean basedir succeeds.
- Public list over HTTPS with `signature-required: true` succeeds using `config/public-bootstrap/testnet-ed25519.pub`.
- Public fetch downloaded 75 objects and `3,113,463,513` bytes with zero retries.
- Public restore activated into `/Volumes/external/teleno-public-bootstrap-https-validate/basedir`.
- Restored-node smoke opened RocksDB and reached `[node] teleno_node ready`.
- Linux Ubuntu validation on `192.168.178.188` passed:
  - HTTPS signed public list with `signature-required: true`;
  - full signed public restore of 75 objects and `3,113,463,513` bytes with zero retries;
  - `signature_required: true` and `signature_verified: true` in restore JSON;
  - DB-open smoke reached `[node] teleno_node ready`;
  - temporary `/tmp` restore data was removed.

Signed publication details:

```text
signature_key_id: teleno-testnet-bootstrap-20260620
signature_public_key_sha256: b8a4c7573eea54c86a4ed2649b0de525dd7bd21bcdbd8e99eef0c629e4ab7c00
public_key_file: config/public-bootstrap/testnet-ed25519.pub
private_key_file: ~/.teleno/public-bootstrap-signing/testnet-ed25519.pem
```

## Key Constraint

Native snapshots currently include:

- `db/**`
- `config.yml`
- `chain/genesis_data.json`
- `jsonrpc/descriptors/koinos_descriptors.pb`

Restore activation does not overwrite active `config.yml`; restored config is copied to `.teleno-restored-config.yml`. Still, the public snapshot publishes `config.yml` as a content-addressed object, so it must be sanitized before publication.

If `config.yml` is rewritten during promotion, the promotion process must also:

- compute the new SHA-256 object;
- write the new object under `objects/sha256/<aa>/<bb>/<sha256>`;
- update the `config.yml` entry in `files.json`;
- update manifest counts, byte totals, and public metadata if they change.

## Required Public Snapshot Contract

The public snapshot may contain only:

- `db/**`
- `chain/genesis_data.json`
- `jsonrpc/descriptors/koinos_descriptors.pb`
- sanitized `config.yml`

The public snapshot must not contain:

- producer private keys;
- wallet files;
- SSH keys, password files, or passphrase files;
- admin tokens;
- `.teleno-native-backups/admin.token`;
- `.teleno-native-backups/teleno-native-backup-config.yml`;
- private remote SFTP configuration or credential references.

The sanitized `config.yml` must be observer-safe:

- testnet network;
- public testnet seed;
- loopback JSON-RPC by default;
- normal P2P default;
- `features.block_producer: false`;
- `chain.verify-blocks: true`;
- no backup admin token path;
- no private remote backup credentials.

Public metadata includes, when available:

- network;
- chain ID;
- source head height;
- source LIB height;
- created time;
- source backup ID;
- source node version;
- public restore schema version through the metadata `version`;
- restore-space byte estimates split by DB/runtime/object cache;
- sanitized config hash and size;
- producer mode disabled.

## Completed Implementation

### 1. Promotion Script

Created:

```text
scripts/promote-public-bootstrap-backup.js
```

Inputs:

- source native backup repository;
- backup ID or `latest`;
- destination public repository path;
- network;
- public base URL;
- observer-safe config template path;
- `--dry-run`.

Implemented behavior:

1. Resolve the source snapshot.
2. Parse `latest.json`, `manifest.json`, and `files.json`.
3. Validate every referenced object exists and matches its SHA-256.
4. Enforce the public allowlist and denylist.
5. Replace `config.yml` with the observer-safe template.
6. Recompute the config object hash and update `files.json`.
7. Update manifest totals and public metadata.
8. Stage objects and metadata in a temporary destination.
9. Validate the staged tree.
10. Publish atomically by writing `latest.json` last.
11. Emit a machine-readable report.

Dry-run performs validation and emits a machine-readable report without changing the public directory.

Tests added:

```text
tests/helpers/public-bootstrap-fixture.js
tests/promote-public-bootstrap-backup.test.js
scripts/smoke-public-bootstrap-promotion.sh
```

Validated with:

```bash
node --check scripts/promote-public-bootstrap-backup.js
node --check tests/promote-public-bootstrap-backup.test.js
node --check tests/helpers/public-bootstrap-fixture.js
node --test tests/promote-public-bootstrap-backup.test.js
scripts/smoke-public-bootstrap-promotion.sh
```

### 2. Published Sanitized Testnet Snapshot

The promotion script dry-run passed against the real local testnet native backup repository. The sanitized repository was then published to:

```text
/srv/teleno-backups/testnet/public/teleno-bootstrap
```

Publication order:

1. Stage content under a temporary server directory.
2. Copy or hardlink content-addressed objects.
3. Write snapshot metadata: `manifest.json`, `files.json`, `COMPLETE`.
4. Move the snapshot into `snapshots/<backup-id>`.
5. Write `latest.json.partial`.
6. Rename `latest.json.partial` to `latest.json`.

Validation over HTTPS:

- `GET latest.json` returns `200`.
- `GET snapshots/<backup-id>/manifest.json` returns `200`.
- `GET snapshots/<backup-id>/files.json` returns `200`.
- `GET snapshots/<backup-id>/COMPLETE` returns `200`.
- at least one referenced object URL returns `200`.
- HTTP write methods remain rejected.

### 3. Real CLI Restore From HTTPS

Validated with a clean non-producer basedir:

```text
/Volumes/external/teleno-public-bootstrap-https-validate/basedir
```

Commands:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-list \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-json
```

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-fetch \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-restore \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

Acceptance checks:

- no SSH credentials are required: passed;
- disk-space preflight runs before staging: passed;
- hash mismatch would abort through object SHA-256 verification: covered by unit tests and fetch implementation;
- restore activates successfully: passed;
- active config is observer-safe: passed;
- restored snapshot config is only copied to `.teleno-restored-config.yml`: covered by restore activation behavior;
- node starts as testnet observer: smoke started with `--disable block_producer`;
- block production remains disabled: observer config and restore marker enforce this;
- restored DB opens: passed;
- no secret-looking files are expected in the restored basedir because promotion allowlist excludes them.

### 4. Local Admin API Support

Implemented after the CLI path was validated against the real HTTPS route.

Endpoints:

```text
GET  /admin/backup/public/config
GET  /admin/backup/public/snapshots
POST /admin/backup/public/fetch
POST /admin/backup/public/preflight
POST /admin/backup/public/restore/stage
POST /admin/backup/public/restore/activate
```

Implemented rules:

- loopback-only through the existing backup admin server;
- bearer-token protected through the existing admin token model;
- long fetch operations report status through the existing backup operation status model;
- cancel interrupts between object downloads;
- activation writes a request only and does not replace a live open RocksDB database;
- CLI fallback remains required for first-install and stopped-node flows.

Covered by `koinos_backup_admin_server_test` with a synthetic `file://` public repository.

## Remaining Implementation Plan

### 5. Improve CLI Metadata Only Where Needed

After the first real HTTPS restore, add only the missing metadata needed by UX or diagnostics.

Likely useful additions:

- public source URL;
- repository cache path;
- target basedir;
- required cache bytes;
- required restore bytes;
- network;
- created time;
- backup ID;
- approximate head height.

Do not add metadata fields until the real CLI validation shows they are useful.

The useful additions now visible from the HTTPS validation are:

- source chain head height and LIB height from the backup source;
- public snapshot creation time in ISO-8601 form;
- explicit network and chain ID;
- sanitized config hash;
- byte totals split between DB, runtime files, and repository cache;
- warning field when the backup is older than a configurable freshness threshold.

### 6. Add Teleno UX Integration

Status: implemented for the current testnet public bootstrap flow.

UX distinguishes clearly between:

- public bootstrap restore;
- local native backups;
- private remote SFTP backups.

Implemented UX behavior:

- no SSH credential fields for public restore;
- show public source URL;
- show backup date/time and size; network and approximate head height will use richer metadata when available;
- check disk space before restore;
- explain whether insufficient space is in the repository cache path, restore target path, or both;
- warn that restored nodes start as observer;
- keep block production disabled after restore;
- show restored basedir and config path.

### 7. Signed Public Manifests Before Prodnet

Status: implemented and validated against the public HTTPS testnet route. The currently published testnet snapshot is signed and Teleno UX-generated testnet configs require the pinned verification key when present.

Implemented signed payload coverage:

- `latest.json`;
- `manifest.json`;
- `files.json`;
- public metadata;
- selected backup ID;
- network;
- chain ID;
- object count and total bytes.

Implemented behavior:

- Promotion can write `snapshots/<backup-id>/public-bootstrap-signature.json` when `--signing-private-key-file` is provided.
- The signature envelope uses Ed25519 and signs a canonical JSON payload.
- Public restore verifies the envelope when `backup.public-restore.signature-required=true`.
- Public restore also attempts verification when `backup.public-restore.signature-public-key-file` is configured.
- Synthetic C++ tests cover successful verification and tampered public metadata rejection.
- Promotion unit tests cover signed envelope creation and Node-side verification with the generated public key.

Completed for testnet:

- create a Teleno public-bootstrap signing key that is separate from producer and wallet keys;
- store and document the private signing key operationally outside the repo;
- pin or bundle the public verification key in the app/binary or generated config;
- publish a signed public testnet snapshot and validate it with `signature-required: true`;

Prodnet planning is now captured in `PRODNET_PUBLIC_BOOTSTRAP_PUBLICATION_PLAN.md`.

Completed for ProdNet:

- public route published at `https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap`;
- latest snapshot `20260620T201059Z-ms-1781986259826-files-452` is listable with `teleno_node --backup-public-list`;
- operator confirmed on 2026-06-21 that the ProdNet node has been validated in production and production tests passed;
- acceptance record added in `PRODNET_PUBLIC_BOOTSTRAP_VALIDATION_20260621.md`.

Still useful for formal release hardening:

- attach detailed production test transcripts if a release audit requires them;
- document prodnet signing-key creation date and reviewer;
- define freshness and retention policy for published prodnet snapshots;
- decide whether future prodnet `latest.json` promotions require two-person approval.

## Tests

Completed promotion script unit tests:

- resolve `latest` and exact backup IDs;
- reject missing content-addressed objects;
- reject object hash mismatch;
- reject unsafe paths and path traversal;
- reject producer/private/wallet/admin-token paths through denylist coverage;
- rewrite `config.yml` and update its `files.json` hash;
- dry-run produces a report and does not write to the public destination;
- publish writes `latest.json` last.
- signed publish writes a signature envelope and verifies it with the generated public key.

Completed promotion script smoke tests:

- local `file://` style repository smoke using a generated fixture and dry-run;
- local publish smoke to a temporary public directory;
- public CLI smoke against that temporary directory using `--backup-public-list` and `--backup-public-fetch`;
- real HTTPS smoke against `testnet.koinosfoundation.org` after sanitized `latest.json` publication.

C++ build:

```bash
cmake --build node/teleno-node/build --target teleno_node koinos_config_test koinos_backup_public_restore_test koinos_backup_snapshot_test koinos_backup_admin_server_test --parallel
```

C++ tests:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_(config|backup_public_restore|backup_snapshot|backup_admin_server)_test'
```

Manual acceptance:

1. Run promotion script in dry-run mode. Complete.
2. Publish one sanitized snapshot. Complete.
3. Validate public list/fetch/restore from a clean Mac basedir. Complete.
4. Start restored node. Complete for DB-open smoke with producer/P2P/JSON-RPC disabled.
5. Verify observer mode, JSON-RPC health, head progress, and no secret files. Complete on Ubuntu with signed public restore.

## Immediate Next Step

No further testnet or basic ProdNet implementation work remains for this path. The next work is formal release governance: signing evidence, retention policy, promotion approval policy, and attaching detailed ProdNet test transcripts if needed.
