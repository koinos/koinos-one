# Executive Native Backup Implementation Plan

- Date: 2026-06-13
- Scope: Native `teleno_node` backup, restore, remote repository, and scheduling
- Status: implementation and live testnet validation in progress

## Executive Summary

Teleno backup and restore should be owned by the native `teleno_node` binary. The UX should become a controller and progress viewer, not the component that copies live databases.

The operator goal is simple:

1. A running node can create local or remote backups without restart.
2. A new node can bootstrap from the latest backup with one command.
3. A new-node restore checks local disk capacity before downloading large backup data.
4. Backups can run automatically on a configurable interval.
5. Restore is safe by default and starts as an observer before production is re-enabled.

The technical foundation is RocksDB checkpointing. The node must never archive or copy the live `BASEDIR/db` directory directly while it is open. A hot backup is created from a RocksDB checkpoint, then archived or uploaded from that checkpoint while the live node continues syncing or producing.

## Product Workflows

### Create A Manual Backup

```bash
teleno_node \
  --basedir /path/to/basedir \
  --config /path/to/basedir/config.yml \
  --backup-create
```

The command creates a hot checkpoint through the running node when possible, writes a manifest, stores the backup locally and/or uploads it to the configured SSH repository, then reports the backup ID, height, checksum, and remote path.

### Restore A New Node From Latest Backup

```bash
teleno_node \
  --basedir /path/to/new/basedir \
  --config /path/to/new/basedir/config.yml \
  --backup-restore \
  --backup-id latest
```

The command downloads the latest manifest and required backup objects, reconstructs the database, verifies checksums, writes restore metadata, and prints the exact observer-start command.

Before downloading large backup data, the command fetches only `latest.json`, `manifest.json`, and `files.json`, estimates the required local space, checks the selected target volume, and refuses the restore if the Mac does not have enough free space. The operator should see an actionable message before any multi-GB download starts, for example:

```text
Backup latest requires at least 96 GB free on /Users/operator/.teleno/mainnet.
The selected volume has 54 GB free.

Choose a BASEDIR on an external APFS volume, for example:
  --basedir /Volumes/TelenoData/mainnet

Or free at least 42 GB and retry.
```

### Configure Automatic Backups

```yaml
backup:
  enabled: true
  node-id: mac-mainnet-producer-1
  workspace: /Volumes/external/teleno-backup-work

  schedule:
    enabled: true
    interval: 6h
    run-on-startup-if-missed: true
    jitter-seconds: 300
    minimum-head-progress: 1
    skip-if-syncing-from-genesis: true
    max-concurrent-backups: 1

  local:
    enabled: true
    directory: /Volumes/backup/teleno-backups
    retention-count: 7

  ssh:
    enabled: true
    host: 46.0.0.10
    port: 22
    user: teleno-backup
    auth: password-file
    password-file: /Users/operator/.config/teleno/backup-ssh-password
    known-hosts-file: /Users/operator/.ssh/known_hosts
    strict-host-key-checking: true

  remote:
    enabled: true
    directory: /srv/teleno-backups
    retention-count: 14
    retention-days: 30

  admin:
    enabled: false
    listen: 127.0.0.1:18088
    token-file: /Users/operator/.config/teleno/backup-admin-token
    jobs: 1
```

Automatic backup uses the same code path as manual backup. It never starts a second backup when one is already active. If the node was offline during the scheduled time, it may run once after startup when `run-on-startup-if-missed` is enabled.

## Testnet Backup Validation Server

The current testnet backup validation target is:

```text
host: testnet.koinosfoundation.org
ssh user: teleno_backup
remote directory: /srv/teleno-backups/testnet/teleno-dev
auth: SSH public key
local private key path: /Users/pgarcgo/.ssh/id_ed25519
known hosts path: /Users/pgarcgo/.ssh/known_hosts
```

The account is intentionally restricted:

- password authentication disabled;
- no sudo/admin groups;
- shell commands blocked;
- SFTP-only access through `ForceCommand internal-sftp`;
- write access only to the testnet backup repository directory.

Root SSH access was used only to provision this account. Backup implementation and validation should use `teleno_backup`, not root.

Recommended testnet config:

```yaml
backup:
  enabled: true
  node-id: teleno-testnet-dev
  workspace: /Volumes/external/teleno-testnet-producer/backup-work

  ssh:
    enabled: true
    host: testnet.koinosfoundation.org
    port: 22
    user: teleno_backup
    auth: private-key
    private-key-file: /Users/pgarcgo/.ssh/id_ed25519
    known-hosts-file: /Users/pgarcgo/.ssh/known_hosts
    strict-host-key-checking: true

  remote:
    enabled: true
    directory: /srv/teleno-backups/testnet/teleno-dev
```

## Storage Strategy

Use a repository/snapshot format as the preferred remote model, not only full `tar.zst` files.

```text
/srv/teleno-backups/
  <network>/
    <node-id>/
      latest.json
      snapshots/
        20260613T120000Z-height-123456-1220abcd/
          manifest.json
          files.json
          COMPLETE
      objects/
        sha256/
          ab/
            cd/
              <sha256>
```

Each backup:

1. Creates a RocksDB checkpoint.
2. Hashes checkpoint files.
3. Uploads only missing objects.
4. Writes a snapshot manifest.
5. Atomically updates `latest.json`.
6. Prunes old complete snapshots according to retention.

This avoids uploading the entire database every time. RocksDB SST files are immutable, so repeated backups should upload mostly new files and small metadata changes after the first full snapshot.

`tar.zst` export remains useful as an optional portability artifact, but it should not be the only recurring remote backup mechanism.

## Installation Disk-Space Preflight

Most future operators will run Teleno on a local Mac, where internal storage is often limited. Restore must therefore perform a mandatory capacity check before downloading backup data.

### Required Manifest Fields

Each snapshot manifest and file inventory must include enough size metadata to make the preflight deterministic:

```json
{
  "sizes": {
    "source_basedir_bytes": 3000000000,
    "restored_database_bytes": 2950000000,
    "runtime_files_bytes": 128000,
    "object_download_bytes": 120000000,
    "archive_bytes": null,
    "minimum_target_free_bytes": 3800000000,
    "recommended_target_free_bytes": 5900000000
  }
}
```

Definitions:

- `restored_database_bytes`: Sum of DB files that will exist after restore.
- `runtime_files_bytes`: Config, genesis, descriptors, and restore metadata.
- `object_download_bytes`: Bytes that must be fetched from the remote repository for this restore.
- `archive_bytes`: Size of a standalone archive when restoring from `tar.zst`; `null` for object-repository restore.
- `minimum_target_free_bytes`: Hard floor required before restore can start.
- `recommended_target_free_bytes`: Safer value that leaves growth and compaction headroom.

### Preflight Algorithm

For a new installation restore:

1. Resolve `latest` or the selected backup ID.
2. Download only metadata: `latest.json`, `manifest.json`, and `files.json`.
3. Validate backup format, network, and storage layout.
4. Calculate target free-space requirements.
5. Check the filesystem containing the selected `BASEDIR`.
6. If free space is below `minimum_target_free_bytes`, refuse before downloading DB objects.
7. If free space is above minimum but below recommended, warn and require explicit `--force-low-disk`.
8. If there is enough space, create restore staging and continue.

The preflight must run before creating large partial downloads. A failed preflight should leave no multi-GB files behind.

### Space Formula

For the object-repository restore path, download objects directly into restore staging and verify each file while it is written. The minimum space for an empty new `BASEDIR` is:

```text
restored_database_bytes
+ runtime_files_bytes
+ restore_metadata_overhead
+ safety_margin
```

Recommended safety margin:

```text
max(10 GB, 20% of restored_database_bytes)
```

For standalone archive restore, if streaming extraction is not implemented yet:

```text
archive_bytes
+ restored_database_bytes
+ runtime_files_bytes
+ safety_margin
```

If streaming archive extraction is implemented and verified, `archive_bytes` can be removed from the hard minimum but still counted in warnings for failed/resumable downloads.

For restore into a non-empty basedir with `--force`, add the size of preserved `.pre-restore/<timestamp>` data unless the operator explicitly chooses a destructive discard mode. The default must move old data aside, not delete first.

### Operator UX Requirements

The install wizard and CLI must ask the operator to choose the `BASEDIR` before restore. On macOS, if the selected volume does not have enough space, show:

- required minimum free space;
- recommended free space;
- current free space;
- selected volume/path;
- the backup height and network;
- a clear recommendation to use an external volume when internal disk is insufficient.

The UX should offer a direct "Choose external volume" action. The CLI should print a concrete example using `/Volumes/<Name>/...`.

### Validation Requirements

Add tests for:

- preflight passes when free space is above recommended;
- preflight warns between minimum and recommended;
- preflight fails below minimum before any DB object download;
- archive restore requires archive plus extracted size unless streaming extraction is enabled;
- object-repository restore does not require an extra full archive-sized temporary file;
- non-empty target basedir includes `.pre-restore` preservation space;
- user-facing error text includes required, available, and selected target path.

## Hot Backup Algorithm

1. Load `backup:` config.
2. Validate workspace, local repository, SSH credentials, and known-host settings.
3. Reject if another backup or restore is active.
4. Capture network, chain ID, head height, head block ID, LIB, storage layout, compression, and node version.
5. Acquire a backup write-quiesce guard.
6. Flush RocksDB WAL when configured.
7. Create RocksDB checkpoint.
8. Release the write-quiesce guard immediately.
9. Write manifest and file inventory.
10. Store local snapshot and/or upload remote objects.
11. Verify object checksums.
12. Write `COMPLETE`.
13. Atomically update `latest.json`.
14. Apply retention pruning after successful completion.

Only the checkpoint phase pauses writes. Hashing, compression, and upload happen from the checkpoint and must not block normal sync or production.

## Restore Algorithm

### New Node

1. Resolve `latest` or selected backup ID.
2. Download manifest and file inventory only.
3. Validate format, version, network, storage layout, and checksums.
4. Run installation disk-space preflight against the selected `BASEDIR` volume.
5. Refuse before large downloads if the selected volume is too small.
6. Download required objects into restore staging.
7. Reconstruct the checkpoint directory.
8. Refuse to overwrite a non-empty target DB unless `--force`.
9. Move existing DB paths to `.pre-restore/<timestamp>` before replacement.
10. Move restored DB into place.
11. Restore runtime files: `config.yml`, genesis data, JSON-RPC descriptors.
12. Write `.backup-just-restored` and `.teleno-restore-manifest.json`.
13. Force first start to observer mode.

### Running Node

Runtime restore is two stage:

1. Stage: download, verify, and reconstruct backup while the node keeps running.
2. Activate: write a restore intent, stop services cleanly, exit with a specific restore activation code, then apply the restore while RocksDB is closed.

The node must never replace an open RocksDB database.

## Producer Identity Policy

Blockchain-state backup and producer-identity backup are separate features.

Default blockchain backup excludes:

```text
block_producer/private.key
wallets
GUI secure storage
logs
```

The manifest may record public producer metadata, such as producer address and public key, but private key material must require a separate encrypted export flow.

This keeps one database backup safe to reuse for observers and prevents accidental remote upload of producer signing keys.

## Native CLI Surface

Phase 1 uses option-style commands to match the current `teleno_node` CLI:

```bash
teleno_node --backup-dry-run
teleno_node --backup-dry-run --backup-json
teleno_node --backup-create
teleno_node --backup-create --backup-json
teleno_node --backup-restore
teleno_node --backup-restore --backup-json
```

Final operator commands can later be promoted to a clearer subcommand wrapper while keeping compatibility flags:

```bash
teleno_node backup create
teleno_node backup list
teleno_node backup verify latest
teleno_node backup restore latest
```

## Private Admin Control

Hot backup of a running node should be controlled through a private local admin channel, not public Koinos JSON-RPC.

Requirements:

- Loopback or Unix-domain-socket default.
- Bearer token or file-token authentication.
- Token never printed in logs.
- JSON status for long-running operations.
- Public JSON-RPC cannot call backup or restore methods.

Initial endpoints:

```text
POST /admin/backup/create
GET  /admin/backup/status
GET  /admin/backup/status/<operation-id>
GET  /health
POST /admin/backup/cancel
POST /admin/backup/cancel/<operation-id>
POST /admin/backup/restore/stage
POST /admin/backup/restore/activate
```

The implemented backup-admin slice exposes `POST /admin/backup/create`,
`GET /admin/backup/status`, `GET /admin/backup/status/<operation-id>`,
`POST /admin/backup/cancel`, `POST /admin/backup/cancel/<operation-id>`,
`POST /admin/backup/restore/stage`, `POST /admin/backup/restore/activate`,
and health checks. Backup admin routes require a local bearer token loaded from
`backup.admin.token-file`. Operation-specific status and cancel paths validate
against the service's current or most recent operation id and return `404` when
the requested operation is not known to the in-process service. Supervisor
activation callbacks by operation id remain future refinements; the runtime now
detects restore activation intents and shuts down into a safe activation path.

## Scheduler Requirements

`BackupScheduler` runs inside `teleno_node`.

Rules:

- Manual backup and scheduled backup use the same implementation.
- Do not start if another backup or restore is active.
- Add jitter to avoid many nodes hitting the same backup server simultaneously.
- Run once after startup if the previous interval was missed and config allows it.
- Skip if the node is still syncing from genesis and config requests skip.
- Require minimum head progress before creating another scheduled backup.
- Keep failed remote upload retryable without invalidating local snapshot.
- Never perform automatic restore.

## Implementation Phases

### Phase 1: Config, Plan, And Dry Run

Implement `backup:` config parsing, validation, and a dry-run plan. Define the restore disk-space preflight data model and JSON output shape. This phase does not open RocksDB, connect to SSH, download backup data, or write backup data.

Exit criteria:

- `--backup-dry-run` prints a human-readable plan.
- `--backup-dry-run --backup-json` prints machine-readable JSON.
- Config tests cover schedule, local repository, SSH credentials, and remote retention fields.
- Plan tests cover missing credentials and enabled/disabled targets.
- Restore preflight model documents minimum and recommended target free-space fields.

### Phase 2: Hot RocksDB Checkpoint

Implement `BackupCoordinator` and checkpoint creation for the unified DB layout.

Exit criteria:

- Unit test opens checkpoint independently.
- Concurrent write test proves writes resume.
- Checkpoint creation works against a copied testnet basedir without stopping the live node.

### Phase 3: Local Snapshot Repository

Implement local object repository, file inventory, checksums, `latest.json`, restore from local repository, and local restore disk-space preflight.

Exit criteria:

- First backup uploads/stores all objects.
- Second backup stores only changed/missing objects.
- Snapshot manifests include restored DB size, runtime file size, object download size, minimum free space, and recommended free space.
- Restore preflight fails before object download when target free space is too low.
- Restore into an empty basedir starts as observer and matches manifest head.

### Phase 4: SSH/SFTP Remote Repository

Implement native SSH/SFTP transport with password-file and private-key auth.

Exit criteria:

- Upload to Ubuntu test server succeeds.
- Interrupted upload leaves recoverable `.partial` state.
- Complete snapshot has `COMPLETE`.
- Remote `latest.json` is atomically updated.

### Phase 5: CLI Restore

Implement remote restore, metadata-first disk-space preflight, staging, checksum verification, safe DB replacement, and observer-first startup policy.

Exit criteria:

- Restore downloads only metadata before checking local disk space.
- Restore prints required, recommended, and available free space when the target volume is too small.
- Restore from `latest` into an empty basedir works.
- Restore refuses non-empty target without `--force`.
- Existing DB is moved to `.pre-restore/<timestamp>` before replacement.

### Phase 6: Scheduler

Implement native periodic backups.

Exit criteria:

- Interval scheduling works.
- Missed startup run works.
- Jitter is applied.
- Scheduler does not overlap backups.
- Failed upload can retry later.

### Phase 7: Runtime Admin API

Expose backup/create/status/cancel and restore/stage/activate through local admin control.

Exit criteria:

- Missing or wrong token is rejected.
- Public JSON-RPC has no backup surface.
- Running node can create a backup without restart.
- Restore activation exits cleanly and applies on restart.

### Phase 8: Teleno UX Integration

Move the UX to native commands/admin APIs.

Exit criteria:

- UX no longer copies live DB directories.
- UX no longer stops node for native hot backup.
- UX shows native backup status and restore progress.

### Phase 9: Live Validation

Validation order:

1. Unit tests.
2. Isolated private testnet.
3. Public testnet observer.
4. Public testnet producer.
5. Copied mainnet observer data.
6. Guided prodnet operator flow only after evidence is accepted.

Do not first-validate on a mainnet producer.

## Current Implementation Status

Phase 1 has started. The initial implementation adds:

- Native `backup:` config parsing.
- A backup dry-run planner.
- Human and JSON plan output.
- Focused tests for backup config and plan validation.

Phase 2 has started. The initial checkpoint implementation adds:

- A native `CheckpointManager` that creates a RocksDB checkpoint from the open unified `BASEDIR/db` handle.
- A validation CLI mode: `--backup-checkpoint --backup-output <dir>`.
- Guardrails so the current CLI checkpoint mode refuses non-unified storage layouts.
- Focused tests that create a temporary Teleno RocksDB, checkpoint it, open the checkpoint independently, and verify metadata.

Phase 3 has started. The initial local repository implementation adds:

- A local object-store snapshot repository under `backup.local.directory`.
- Snapshot file inventory at `snapshots/<backup-id>/files.json`.
- Snapshot manifest at `snapshots/<backup-id>/manifest.json`.
- Content-addressed objects under `objects/sha256/<aa>/<bb>/<hash>`.
- Atomic completion with `COMPLETE` and `latest.json`.
- Restore disk-space estimates in the manifest, including minimum and recommended target free space.
- A validation CLI mode: `--backup-create-local`.
- Focused tests for snapshot creation, object reuse, `latest.json`, and restore disk-space pass/warn/fail behavior.

Phase 4 has started. The initial SFTP validation implementation adds:

- A validation CLI mode: `--backup-upload-latest`.
- Remote upload of the latest local snapshot repository through the native `libssh` SFTP transport with private-key authentication.
- Atomic remote publication using snapshot `.partial` directories and `latest.json.partial` followed by remote rename.
- Upload validation against the restricted `teleno_backup` SFTP-only user on `testnet.koinosfoundation.org`.
- Cleanup of temporary local SFTP batch files after successful uploads.
- Focused tests for upload batch planning, partial/final remote paths, and JSON/text upload result output.
- Managed transfer options for retry count, retry delay, cancellation checks between batches/attempts, and progress callbacks.

The current Phase 4 backend uses an in-process `libssh` SFTP transport.
Private-key, password-file, and environment-password authentication are handled
inside `teleno_node`; host-key policy is enforced through `libssh` known-hosts
handling without spawning an external SSH client. The macOS build now creates a
pinned static `libssh` package and links it with the same static OpenSSL and
zlib dependency set used by the node, so `teleno_node` no longer depends on
Homebrew `libssh` or OpenSSL dylibs. Live testnet backup/restore validation
against the restricted `teleno_backup` account passed on 2026-06-14; see
`NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md`.

Phase 5 has started. The initial restore preflight implementation adds:

- An operator-facing `--backup-restore` CLI that fetches remote data when `backup.remote.enabled` is true, runs the local disk-space preflight, stages the restore, activates it while RocksDB is closed, writes observer-first recovery markers, and prints the observer restart command.
- A validation CLI mode: `--backup-restore-preflight`.
- A validation CLI mode: `--backup-restore-fetch`.
- A validation CLI mode: `--backup-restore-stage`.
- A validation CLI mode: `--backup-restore-activate`.
- Metadata-first local restore checks using `latest.json`, `manifest.json`, and `files.json`.
- Metadata-first remote restore fetch over native `libssh` SFTP: download `latest.json`, then only the referenced `manifest.json`, `files.json`, and `COMPLETE` marker before any object download.
- Verification that all snapshot objects referenced by the manifest exist before restore can continue.
- Target-volume free-space checks before any large download, reconstruction, or DB replacement.
- Local-repository free-space checks before downloading missing remote objects.
- Remote object fetch downloads only missing content-addressed objects and verifies size plus SHA-256 before making each object visible locally.
- Conservative accounting for existing target DB bytes because restore preserves old data under `.pre-restore/<timestamp>` before replacement.
- Local restore staging that reconstructs the snapshot into `<basedir>/.teleno-restore-staging/<backup-id>` by default, or into `--backup-output <dir>`.
- SHA-256 verification for every staged file and a `RESTORE_STAGE_COMPLETE` marker.
- Restore activation that moves existing DB/runtime paths under `.pre-restore/<timestamp>-<backup-id>`, moves the staged `db` into place, restores genesis/descriptors, and writes `.backup-just-restored` plus `.teleno-restore-manifest.json`.
- Active `config.yml` is not overwritten during activation; the restored config is kept as `.teleno-restored-config.yml` for operator review.
- First post-activation node start consumes `.backup-just-restored`, enables verify-blocks, and disables `block_producer` for observer recovery even if the config enables it.
- Human and JSON preflight/fetch/staging/activation output for CLI and future UX integration.

The current Phase 5 slice supports local-repository restore and remote fetch
through the managed SFTP backend. Runtime restore activation is now supervised:
startup consumes a pending activation intent before opening RocksDB, and a
running node polls for `.teleno-restore-activation-request.json`, stops services,
closes RocksDB, activates the staged DB, and exits for observer-first restart.

Phase 7 has started. The initial runtime service implementation adds:

- A native in-process `BackupService` that creates local backup snapshots from the live `RocksDBManager` handle.
- Centralized operation status with `idle`, `running`, `succeeded`, and `failed` states, plus text and JSON serialization for the upcoming admin API.
- Guardrails that reject backup service snapshots unless `backup.enabled`, `backup.local.enabled`, `backup.workspace`, `backup.local.directory`, an open RocksDB handle, and unified chain storage are present.
- Reuse of the existing checkpoint and local object-repository primitives, including automatic checkpoint cleanup on success or failure.
- The `--backup-create-local` CLI now routes through `BackupService`, so CLI validation and future admin/API execution use the same runtime primitive.
- The operator-facing `--backup-create` CLI creates the configured local hot snapshot and, when `backup.remote.enabled` is true, uploads the latest snapshot through native `libssh` SFTP before returning success.
- Focused tests that create a hot local snapshot from an open temporary RocksDB, stage the resulting snapshot, and verify the staged DB opens with the expected metadata.

The local-only admin control surface has also started. The first slice adds:

- `backup.admin.enabled`, `backup.admin.listen`, `backup.admin.token-file`, and `backup.admin.jobs` config parsing.
- A native `BackupAdminServer` that is registered as the `backup_admin` runtime component only when explicitly enabled.
- Loopback-only binding; non-loopback numeric addresses such as `0.0.0.0` are rejected before listen.
- File-token bearer authentication for `/admin/backup/*`; enabling the admin component without a readable non-empty token file fails closed.
- `POST /admin/backup/create`, which creates a local hot snapshot through `BackupService`.
- `GET /admin/backup/status`, which returns the current backup operation status as JSON.
- `GET /admin/backup/status/<operation-id>`, which returns the current or most recent operation when the id matches and returns `404` otherwise.
- `GET /health` and `GET /healthz` for local supervisor checks.
- No backup or restore methods on public Koinos JSON-RPC.
- Request-handler cleanup that joins active admin sessions during shutdown.
- A heap-backed SHA-256 file buffer so backup inventory hashing is safe on smaller request-thread stacks.
- Asynchronous admin backup creation: `POST /admin/backup/create` now returns `202 Accepted` with a running status while the service-owned worker creates the snapshot.
- Cooperative cancellation through `POST /admin/backup/cancel` and `POST /admin/backup/cancel/<operation-id>`; the service records `cancel_requested` and aborts at safe phase boundaries before checkpointing or before snapshot publication. It does not forcibly interrupt RocksDB checkpointing or file hashing mid-call.
- `BackupService::wait_for_current_operation()` and destructor cleanup so background backup workers are joined before the storage handle is destroyed.
- Authenticated restore staging through `POST /admin/backup/restore/stage`, reusing the existing local repository preflight, checksum, and staging logic while the node stays running.
- Authenticated restore activation request through `POST /admin/backup/restore/activate`; this writes `.teleno-restore-activation-request.json`. The runtime supervisor detects the intent, stops services, closes RocksDB, activates the staged DB, and exits so the next start begins observer-first recovery.
- Focused tests for missing/wrong bearer tokens, status/create, snapshot completion through the admin API, and non-loopback bind rejection.
- Focused tests for direct asynchronous service execution, admin polling to terminal status, admin restore staging, and safe activation-intent creation.

The native scheduler slice is now implemented:

- `BackupScheduler` runs inside `teleno_node` when `backup.schedule.enabled` is true.
- Scheduled backups use the same `BackupService::start_local_snapshot_async()` path as the local admin API.
- Scheduler startup is delayed until after the chain indexer phase and node readiness, so it does not checkpoint before normal startup recovery/indexing completes.
- `backup.schedule.interval` supports integer durations with `ms`, `s`, `m`, `h`, and `d` suffixes; a bare integer means seconds.
- `run-on-startup-if-missed`, `jitter-seconds`, `skip-if-syncing-from-genesis`, and `minimum-head-progress` are enforced.
- Scheduler stop requests cooperative cancellation and joins its worker before shutdown.
- When `backup.remote.enabled` is true, the scheduler uploads the latest local snapshot after a successful local checkpoint using native `libssh` SFTP.
- Remote upload failures are logged and remain retryable; the successful backup height watermark is advanced only after the local snapshot and configured remote upload complete.
- Local repository retention is enforced by `backup.local.retention-count`; old completed snapshot metadata is pruned and unreferenced content-addressed objects are garbage-collected.
- Focused tests cover interval parsing, immediate startup backup, skip-until-head-progress behavior, SFTP cancellation/auth guardrails, restore intent activation, and local retention pruning.

The Teleno UX integration slice has started:

- The existing Create Backup IPC action now invokes `teleno_node --backup-create-local --backup-json` instead of stopping the node and creating a tarball from `chain`/`block_store`.
- The UX writes a scoped native backup config under `<basedir>/.teleno-native-backups/teleno-native-backup-config.yml`, with repository and workspace directories under `<basedir>/.teleno-native-backups/`.
- Existing progress events are preserved for the renderer, while the actual backup behavior now uses the same native hot checkpoint/object-store path as CLI/admin/scheduler.

The remaining Phase 7/8 work is remote restore UX controls, an automated smoke
wrapper for the validated native path, and a larger near-head testnet backup
before guiding production operators through migration.

The automated smoke wrapper now exists at
`scripts/smoke-native-backup-restore.sh`. It runs a local repository
backup/restore by default and can exercise native `libssh` upload/fetch when
`TELENO_BACKUP_REMOTE=1` and the SFTP environment variables are provided.
Local mode and restricted testnet SFTP mode both passed on 2026-06-14; see
`NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md`.
