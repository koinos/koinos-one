# Public Bootstrap Restore Implementation

- Date: 2026-06-20
- Scope: Mac `teleno_node` CLI, local admin API, and Teleno UX, testnet only
- Status: CLI/admin API/UX integration completed; sanitized testnet public snapshot promoted and validated end-to-end over HTTPS

## Goal

Let a first-time Teleno node operator restore a testnet database from a public, read-only backup repository without entering an SSH user, SSH key, or password.

This is intentionally separate from authenticated remote backup creation:

- `backup.remote` remains the operator-owned SFTP upload target for creating private remote backups.
- `backup.public-restore` is the read-only bootstrap source used by new installations.

The current implementation covers the Mac CLI testnet flow, local backup admin API orchestration, and Teleno UX restore/list integration. Signed public manifests and prodnet publication remain follow-up work.

## Server State

The public bootstrap repository uses the same testnet server as the restricted SFTP backup repository, but not the same writable path.

Private SFTP repository:

```text
/srv/teleno-backups/testnet/teleno-dev/teleno-ux-testnet
```

Public read-only bootstrap repository:

```text
/srv/teleno-backups/testnet/public/teleno-bootstrap
```

Public HTTPS base URL:

```text
https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap
```

Server validation completed:

- `GET /backups/testnet/teleno-bootstrap/README.txt` returns `200`.
- `POST /backups/testnet/teleno-bootstrap/README.txt` returns `405`.
- `GET /health` still returns `ok`.

Published public snapshot:

```text
20260617T215046Z-ms-1781733046440-files-72
```

Published metadata:

- `GET /backups/testnet/teleno-bootstrap/latest.json` returns `200`.
- `GET /backups/testnet/teleno-bootstrap/snapshots/20260617T215046Z-ms-1781733046440-files-72/manifest.json` returns `200`.
- CORS headers are present for public GET/HEAD access.
- The published repository contains 75 content-addressed objects and 3.11 GB of backup payload.

## Implemented Code

Implemented native files:

```text
node/teleno-node/src/backup/public_restore.hpp
node/teleno-node/src/backup/public_restore.cpp
node/teleno-node/tests/backup/backup_public_restore_test.cpp
```

Updated existing files:

```text
node/teleno-node/src/CMakeLists.txt
node/teleno-node/src/core/config.hpp
node/teleno-node/src/core/config.cpp
node/teleno-node/src/main.cpp
node/teleno-node/tests/core/config_test.cpp
```

Promotion and smoke-test files:

```text
config/testnet-public-bootstrap-observer.yml
scripts/promote-public-bootstrap-backup.js
scripts/smoke-public-bootstrap-promotion.sh
tests/helpers/public-bootstrap-fixture.js
tests/promote-public-bootstrap-backup.test.js
```

New CMake targets:

```text
koinos_backup_public_restore_lib
koinos_backup_public_restore_test
```

The implementation reuses the existing native backup repository, restore preflight, restore staging, and restore activation logic. It adds only the public read-only fetch/list layer and the CLI orchestration needed for first-install restore.

## CLI Surface

Implemented in `teleno_node`:

```text
--backup-public-list
--backup-public-fetch
--backup-public-restore
--backup-public-url <url>
```

Related existing options:

```text
--backup-id <backup-id|latest>
--backup-json
--basedir <path>
--config <path>
```

Behavior:

- `--backup-public-list` lists the public `latest` snapshot, or an exact `--backup-id` when one is provided.
- `--backup-public-fetch` downloads public metadata and missing objects into the local native backup repository, then exits without opening RocksDB.
- `--backup-public-restore` fetches the selected public snapshot, validates disk space and hashes, stages the restore, activates it, writes an observer-safe config when needed, then exits.
- `--backup-public-url` overrides `backup.public-restore.base-url` and enables public restore mode for that invocation.
- Public backup modes default the local repository to `<BASEDIR>/.teleno-native-backups/repository` when `backup.local.directory` is not configured.

The existing SFTP commands keep their existing meaning and are not used for public restore:

```text
--backup-list-remote
--backup-restore-fetch
--backup-upload-latest
```

Those remain authenticated restricted-SFTP operations.

## Local Admin API Surface

Implemented in the local loopback-only backup admin API:

```text
GET  /admin/backup/public/config
GET  /admin/backup/public/snapshots
POST /admin/backup/public/fetch
POST /admin/backup/public/preflight
POST /admin/backup/public/restore/stage
POST /admin/backup/public/restore/activate
```

Behavior:

- The endpoints reuse the existing bearer-token protected backup admin server.
- Public config returns sanitized public restore settings and resolved local paths, not SSH secrets.
- Public snapshots fetch public metadata into the local repository cache and return the snapshot inventory.
- Public fetch runs asynchronously through the existing backup operation status model.
- Public fetch supports cancellation between object downloads.
- Public restore stage reuses the existing native restore staging path.
- Public restore activate writes an activation request only; it does not replace a live open RocksDB database.

## Config Surface

Implemented config namespace:

```yaml
backup:
  public-restore:
    enabled: true
    base-url: https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap
    network: testnet
    require-https: true
    timeout-seconds: 30
    retries: 3
```

Parsed fields:

- `backup.public-restore.enabled`
- `backup.public-restore.base-url`
- `backup.public-restore.network`
- `backup.public-restore.require-https`
- `backup.public-restore.timeout-seconds`
- `backup.public-restore.retries`

The config test suite now covers parsing of this section.

## Public Repository Format

The public repository serves the same content-addressed native backup layout over HTTP(S):

```text
<public-base-url>/
  latest.json
  snapshots/
    <backup-id>/
      manifest.json
      files.json
      COMPLETE
  objects/
    sha256/
      <aa>/
        <bb>/
          <sha256>
```

The client only needs ordinary `GET` requests. Static HTTP directory enumeration is not required.

## Restore Flow

`--backup-public-restore` currently performs this flow:

1. Resolve the public base URL from CLI override or config.
2. Resolve `latest.json` or the requested exact `--backup-id`.
3. Download metadata first: `manifest.json`, `files.json`, and `COMPLETE`.
4. Validate manifest format, backup ID, file inventory, sizes, and SHA-256 object references.
5. Run disk-space preflight before staging.
6. Download only missing content-addressed objects into the local native backup repository.
7. Verify every downloaded object by size and SHA-256.
8. Run existing native restore preflight.
9. Stage restored files into the existing restore staging path.
10. Activate restore through the existing stopped-node restore activation path.
11. Write an observer-safe config if the target config file does not already exist.

Observer-first behavior for new installs:

- `features.block_producer` is written as disabled in the generated config.
- `chain.verify-blocks` is written as enabled in the generated config.
- The generated network defaults are testnet-aware when `backup.public-restore.network: testnet`.
- Existing target `config.yml` is not overwritten by the generated observer config path.

## Transport And Integrity

Implemented behavior:

- `file://` support for deterministic local tests.
- `http://` and `https://` support for public repositories.
- HTTPS can load common macOS/Homebrew CA bundle locations explicitly when available.
- Bounded timeout and retry configuration.
- JSON progress events use the same stderr shape as native backup progress.
- Every accepted object is verified by SHA-256.
- Hash or size mismatch aborts the restore.

The implementation does not shell out to `curl`, `scp`, `rsync`, or `ssh`.

## Example Commands

List public backup metadata:

```bash
./node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-list \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-json
```

Fetch public backup metadata and missing objects without activation:

```bash
./node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-fetch \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

Restore from the public bootstrap source:

```bash
./node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-bootstrap/basedir \
  --config /Volumes/external/teleno-testnet-bootstrap/basedir/config.yml \
  --backup-public-restore \
  --backup-public-url https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

## Validation Completed

Build:

```bash
cmake --build node/teleno-node/build --target teleno_node koinos_config_test koinos_backup_public_restore_test koinos_backup_snapshot_test --parallel
```

Tests:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_(config|backup_public_restore|backup_snapshot)_test'
```

Result:

```text
100% tests passed, 0 tests failed out of 3
```

Manual CLI validation:

- `teleno_node --help` exposes the new public backup flags.
- A synthetic `file://` public repository can be listed through `--backup-public-list`.
- A synthetic `file://` public repository can be fetched through `--backup-public-fetch`.
- `git diff --check` passed for the touched public-restore files.

Promotion script validation:

```bash
node --check scripts/promote-public-bootstrap-backup.js
node --check tests/promote-public-bootstrap-backup.test.js
node --check tests/helpers/public-bootstrap-fixture.js
node --test tests/promote-public-bootstrap-backup.test.js
scripts/smoke-public-bootstrap-promotion.sh
```

Result:

```text
5 promotion unit tests passed.
public bootstrap promotion smoke passed.
```

Real public testnet validation:

- Promotion dry-run against the real testnet native backup repository passed.
- Published sanitized snapshot `20260617T215046Z-ms-1781733046440-files-72`.
- `--backup-public-list` against `https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap` returned the published snapshot.
- `--backup-public-fetch` from a clean external-drive basedir downloaded 75 objects, `3,113,463,513` bytes, with `retry_count: 0`.
- Restore preflight reported `missing_object_count: 0`, minimum free space `3,247,681,241` bytes, and recommended free space `13,985,099,481` bytes.
- `--backup-public-restore` activated the snapshot in `/Volumes/external/teleno-public-bootstrap-https-validate/basedir`, wrote `.backup-just-restored`, and returned `ok: true`.
- A restored-node smoke opened RocksDB from the restored basedir, reached `[node] teleno_node ready`, and shut down cleanly.
- Admin API public restore routes are covered by `koinos_backup_admin_server_test`.
- Teleno UX exposes public bootstrap snapshots separately from local and private SFTP backups in Node > Backups.

## Current Limitations

- Public manifests are not signed yet.
- Prodnet publication is intentionally not enabled.

## Remaining Work

The detailed remaining implementation plan is tracked in `PUBLIC_BOOTSTRAP_RESTORE_REMAINING_WORK_PLAN.md`.

1. Add signed public manifests before considering prodnet bootstrap publication.
2. Add richer public metadata only where it improves diagnostics or UX.
3. Run a longer live observer acceptance test from a UX-restored public snapshot.

## Acceptance Criteria

- No SSH user, key, password, or known-hosts file is required.
- The CLI fails before large downloads when disk space is insufficient.
- Hash mismatch aborts the restore.
- The restored node starts as a testnet observer first.
- Block production remains disabled after restore.
- The existing private SFTP backup create/upload path is unchanged.
