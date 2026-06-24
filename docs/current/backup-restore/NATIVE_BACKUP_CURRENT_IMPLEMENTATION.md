# Native Backup Current Implementation

- Date: 2026-06-15
- Branch: `codex/unified-rocksdb-storage`
- Status: implemented and validated for local smoke, restricted testnet SFTP smoke, and small live-testnet observer data
- Production status: not yet approved for guided prodnet operator use

## Summary

Native backup and restore are now owned by `teleno_node`. The Electron UX is no longer responsible for copying live RocksDB directories for the native backup path. The UX can call native dry-run, backup creation, and latest-backup restore commands, while the native binary owns checkpointing, repository manifests, remote SFTP transfer, restore staging, restore activation, and observer-first safety policy.

The implementation is centered on the unified RocksDB layout. Native backup rejects unsupported layouts and expects chain state to be migrated into the shared `BASEDIR/db` column-family database before checkpoint backup is used.

## Native CLI Surface

Implemented CLI modes:

```text
--backup-dry-run
--backup-checkpoint
--backup-create
--backup-create-local
--backup-upload-latest
--backup-list
--backup-list-remote
--backup-delete
--backup-scope local|remote|both
--backup-delete-confirm <backup-id>
--backup-restore
--backup-restore-preflight
--backup-restore-fetch
--backup-restore-stage
--backup-restore-activate
--backup-output <path>
--backup-id <backup-id>
--backup-json
```

Implemented public read-only bootstrap CLI modes:

```text
--backup-public-list
--backup-public-fetch
--backup-public-restore
--backup-public-url <url>
```

Important behavior:

- `--backup-dry-run` validates backup configuration and does not open RocksDB or connect to SSH.
- `--backup-create` creates the configured native backup: local hot snapshot plus remote upload when `backup.remote.enabled=true`.
- `--backup-list` lists completed local repository snapshots without opening RocksDB.
- `--backup-list-remote` lists completed remote SFTP snapshots by fetching only `latest.json`, `manifest.json`, `files.json`, and `COMPLETE` metadata into the local repository cache.
- `--backup-delete --backup-id <backup-id>` plans deletion of an exact backup ID. It is a dry-run by default. Passing `--backup-delete-confirm <backup-id>` executes deletion. `--backup-scope` selects `local`, `remote`, or `both`.
- Local delete removes `snapshots/<backup-id>`, recomputes `latest.json` when needed, and garbage-collects only objects no remaining local snapshot references.
- Remote delete uses native libssh SFTP, removes the selected remote snapshot, recomputes remote `latest.json` when needed, and deletes only remote objects no remaining remote snapshot references.
- `--backup-restore` fetches remote data when enabled, runs metadata-first disk-space preflight, stages the restore, activates it while RocksDB is closed, and prints an observer-first start command.
- `--backup-id <backup-id>` selects a completed local snapshot for local restore/preflight/stage commands and selects a remote snapshot for remote fetch/restore when `backup.remote.enabled=true`. Omit it or pass `latest` to keep the latest-snapshot behavior for restore/list-fetch commands. Delete commands require an exact backup ID and reject `latest`.
- `--backup-json` returns machine-readable output for CLI automation and UX integration.

## Config Surface

The native node parses a `backup:` section from the same `config.yml` used by the node.

Implemented areas:

- `backup.enabled`
- `backup.node-id`
- `backup.workspace`
- `backup.local.enabled`
- `backup.local.directory`
- `backup.local.retention-count`
- `backup.ssh.enabled`
- `backup.ssh.transport`
- `backup.ssh.host`
- `backup.ssh.port`
- `backup.ssh.user`
- `backup.ssh.auth`
- `backup.ssh.private-key-file`
- `backup.ssh.password-file`
- `backup.ssh.passphrase-file`
- `backup.ssh.known-hosts-file`
- `backup.ssh.strict-host-key-checking`
- `backup.ssh.connect-timeout-seconds`
- `backup.remote.enabled`
- `backup.remote.directory`
- `backup.remote.retention-count`
- `backup.remote.retention-days`
- `backup.remote.upload-temp-suffix`
- `backup.schedule.enabled`
- `backup.schedule.interval`
- `backup.schedule.run-on-startup-if-missed`
- `backup.schedule.jitter-seconds`
- `backup.schedule.minimum-head-progress`
- `backup.schedule.skip-if-syncing-from-genesis`
- `backup.schedule.max-concurrent-backups`
- `backup.admin.enabled`
- `backup.admin.listen`
- `backup.admin.token-file`
- `backup.admin.jobs`

## Local Snapshot Repository

Native backup stores snapshots in a content-addressed object repository.

Repository layout:

```text
<backup.local.directory>/
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

Implemented behavior:

- RocksDB checkpoint is created from the live unified DB handle.
- Snapshot manifests and file inventories are written locally.
- Immutable files are stored by SHA-256, so later backups reuse unchanged objects.
- `latest.json` is updated atomically.
- Local retention prunes old completed snapshots and garbage-collects unreferenced objects.

## Native SSH/SFTP

Remote upload and remote restore fetch use native `libssh` SFTP inside `teleno_node`; no `scp`, `rsync`, or `sshpass` subprocess is used for the production path.

Implemented behavior:

- Static macOS `libssh` build and link path.
- Private-key auth.
- Password-file auth.
- Environment-password auth.
- Known-host verification through native `libssh`.
- Remote `.partial` snapshot publication.
- Atomic `latest.json.partial` rename.
- Retry count, retry delay, cancellation checks between batches, and progress callbacks.

The latest static dependency check showed the tested `teleno_node` binary had no Homebrew `libssh`, OpenSSL, or zlib dylib dependency. See `NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md`.

## Restore Path

Implemented restore stages:

1. Resolve latest local or remote snapshot metadata.
2. Fetch only metadata first for remote restore.
3. Validate manifest, file inventory, and `COMPLETE`.
4. Check target volume free space before large object downloads.
5. Fetch only missing content-addressed objects.
6. Verify file size and SHA-256 before making each object visible locally.
7. Stage restored files into a restore staging directory.
8. Activate staged restore while RocksDB is closed.
9. Preserve existing DB/runtime paths under `.pre-restore/<timestamp>-<backup-id>`.
10. Restore `db`, genesis, and descriptors.
11. Write `.backup-just-restored` and `.teleno-restore-manifest.json`.
12. Keep active `config.yml`; restored config is saved as `.teleno-restored-config.yml`.
13. Force observer-first recovery on next start by enabling verify-blocks and disabling block production.

Restore does not include producer private keys or wallet files.

## Runtime Admin API

The native node has a local-only backup admin component.

Implemented endpoints:

```text
GET  /health
GET  /healthz
GET  /admin/backup/config
GET  /admin/backup/snapshots/local
GET  /admin/backup/snapshots/remote
POST /admin/backup/create
POST /admin/backup/upload-latest
POST /admin/backup/delete
GET  /admin/backup/status
GET  /admin/backup/status/<operation-id>
POST /admin/backup/cancel
POST /admin/backup/cancel/<operation-id>
POST /admin/backup/restore/fetch
POST /admin/backup/restore/preflight
POST /admin/backup/restore/stage
POST /admin/backup/restore/activate
GET  /admin/backup/public/config
GET  /admin/backup/public/snapshots
POST /admin/backup/public/fetch
POST /admin/backup/public/preflight
POST /admin/backup/public/restore/stage
POST /admin/backup/public/restore/activate
```

Security behavior:

- Backup admin binds only to loopback addresses.
- Backup admin requires a bearer token loaded from `backup.admin.token-file`.
- If UX enables backup admin with no custom token path, Electron generates a random `0600` token at `<basedir>/.teleno-native-backups/admin.token` and writes that path into the generated native backup config.
- Enabling admin with a configured but unreadable or empty token file fails closed.
- Public Koinos JSON-RPC exposes no backup or restore methods.
- Public bootstrap restore through admin remains local-only and token-protected; public refers only to the read-only HTTP(S) backup source.

## Scheduler

The native `BackupScheduler` runs inside `teleno_node` when enabled.

Implemented behavior:

- Uses the same `BackupService` path as manual/admin backup.
- Starts only after node readiness and chain indexing recovery.
- Supports `ms`, `s`, `m`, `h`, and `d` interval suffixes.
- Supports missed-startup run, jitter, skip-at-genesis, and minimum-head-progress checks.
- Does not overlap backups.
- Uploads remote backup after successful local snapshot when remote backup is enabled.
- Logs remote upload failures as retryable.
- Advances successful-backup watermark only after local and configured remote work complete.

## Teleno UX Integration

Electron now exposes native backup actions through IPC and preload:

```text
teleno:node:native-backup-dry-run
teleno:node:create-backup
teleno:node:native-backup-list
teleno:node:native-backup-purge
teleno:node:native-backup-restore-preflight
teleno:node:restore-native-backup
teleno:node:restore-native-backup-latest
```

Settings > Backup is now configuration-only. It shows:

- first-class native backup configuration fields for local repository, remote SFTP, scheduler, and admin API settings;
- `Check native backup config`.

Node > Backups now owns backup operation controls. It shows:

- runtime context for BASEDIR, config path, local repository, workspace, private SFTP target, public bootstrap URL, and admin API listen address;
- local native backup inventory;
- private remote SFTP backup inventory;
- public read-only bootstrap inventory for testnet;
- create local backup and create remote backup actions;
- verify, restore, and local/remote purge actions on selected snapshots;
- progress and preflight status.

Current UX behavior:

- `Check native backup config` runs `teleno_node --backup-dry-run --backup-json`.
- `Create Backup` uses the native backup admin API when backup admin is enabled and the managed node is running. Otherwise it falls back to `teleno_node --backup-create --backup-json`.
- `Refresh local list` uses `GET /admin/backup/snapshots/local` while the node is running, with CLI fallback to `teleno_node --backup-list --backup-json`.
- `Refresh remote list` uses `GET /admin/backup/snapshots/remote` while the node is running, with CLI fallback to `teleno_node --backup-list-remote --backup-json`.
- `Refresh public list` uses `GET /admin/backup/public/snapshots` while the node is running, with CLI fallback to `teleno_node --backup-public-list --backup-json`.
- `Verify selected backup` uses the matching admin preflight route while the node is running. For stopped-node public restore, the CLI fallback uses `--backup-public-fetch` because public restore has no separate CLI preflight-only command.
- `Restore selected native backup` routes local, private SFTP remote, and public bootstrap selections separately. Running-node restores use admin fetch/preflight/stage/activate routes; stopped-node restores use the matching native CLI path.
- `Restore latest native backup` stops the managed node if needed, runs `teleno_node --backup-restore --backup-json`, and leaves the restored node for observer-first restart.
- Backup deletion is available from Node > Backups for exact local or private SFTP remote snapshot IDs. Public bootstrap snapshots are read-only and are not purgeable from UX.
- Restore activation requires an explicit UX confirmation that names the backup ID and BASEDIR, explains `.pre-restore` preservation, and states observer-first / block-production-disabled behavior.
- The UX writes a scoped generated config at `<basedir>/.teleno-native-backups/teleno-native-backup-config.yml`.
- The generated config uses the operator-selected local repository and workspace, or defaults to `<basedir>/.teleno-native-backups/repository` and `<basedir>/.teleno-native-backups/workspace`.
- The generated config writes `backup.public-restore` for testnet with `https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap` and keeps it disabled for mainnet/custom.
- Remote SFTP settings are configured from UX fields for host, port, user, auth method, credential file paths, known hosts, strict host-key checking, remote directory, retention, and upload temp suffix.
- Scheduler settings are configured from UX fields for enabled state, interval, startup catch-up, jitter, minimum head progress, and genesis-sync skipping.
- Backup admin settings are configured from UX fields for enabled state, loopback listen address, optional token file, and job count.
- The UX validates obvious mistakes before saving: missing remote host/user, non-absolute remote directory, missing private-key/password file for the selected auth method, invalid scheduler interval, and missing admin token file when admin is enabled.
- The UX stores credential references as file paths only. It does not store raw SSH passwords in localStorage or generated YAML.
- `TELENO_BACKUP_*` environment variables still work as an explicit developer override when set.

Current limitation: remote listing caches metadata only; the actual objects are fetched during selected remote restore/fetch. Richer public metadata, longer signed public restore observer validation, richer admin status views, richer restore preflight screens, and larger validation are tracked in the remaining-work plans.

## Public Read-Only Bootstrap Restore

The first public bootstrap restore slice is implemented for Mac CLI testnet workflows. It lets a new operator restore from an HTTP(S) read-only native backup repository without SSH credentials.

Implemented behavior:

- `backup.public-restore` config parsing for `enabled`, `base-url`, `network`, `require-https`, `timeout-seconds`, `retries`, `signature-required`, and `signature-public-key-file`.
- `--backup-public-url` CLI override for testing or first-install workflows.
- `--backup-public-list` to read public `latest.json` or a selected backup ID over HTTP(S).
- `--backup-public-fetch` to fetch public metadata and missing objects into the local content-addressed repository.
- `--backup-public-restore` to fetch, preflight, stage, activate, and generate an observer-safe config when the target config does not exist.
- `file://` support for deterministic local tests.
- `http://` and `https://` support for public repositories.
- SHA-256 verification for every accepted object.
- Ed25519 signature verification for public bootstrap metadata when `signature-required` is true or a verification key file is configured.
- Reuse of the same local native repository, restore preflight, restore staging, and activation logic used by authenticated backup restore.
- Sanitized public testnet snapshot promotion through `scripts/promote-public-bootstrap-backup.js`, including optional signed-envelope generation with `--signing-private-key-file`.
- Bundled testnet public verification key at `config/public-bootstrap/testnet-ed25519.pub`.
- Local public-bootstrap fixture/unit tests and promotion smoke test through `scripts/smoke-public-bootstrap-promotion.sh`.

The public bootstrap route currently configured for testnet is:

```text
https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap
```

This public path is separate from the private restricted-SFTP backup repository. A sanitized testnet snapshot is now published:

```text
20260617T215046Z-ms-1781733046440-files-72
```

Public HTTPS validation completed:

- `latest.json` and snapshot metadata return `200`.
- `--backup-public-list` sees the published snapshot.
- `--backup-public-fetch` downloaded 75 objects and `3,113,463,513` bytes from the public HTTPS route with zero retries.
- `--backup-public-restore` activated the snapshot in a clean external-drive basedir and returned `ok: true`.
- A restored-node smoke opened RocksDB and reached `[node] teleno_node ready` with block production disabled.
- Local admin API public restore routes are implemented and covered by `koinos_backup_admin_server_test`.
- Teleno UX lists public bootstrap snapshots separately from local and private SFTP remote snapshots, and can verify/restore them through admin API or CLI fallback.
- The currently published public testnet snapshot is signed with key ID `teleno-testnet-bootstrap-20260620`.
- `--backup-public-list` over HTTPS passed with `signature-required: true` and the pinned `config/public-bootstrap/testnet-ed25519.pub` verification key.
- Teleno UX-generated testnet native backup configs now require that public bootstrap signature when the bundled key exists; mainnet/custom public restore remains disabled.
- Linux Ubuntu validation on node `<LOCAL_LINUX_HOST>` passed for signed HTTPS list, full signed restore, and DB-open smoke. This required adding `/etc/ssl/certs/ca-certificates.crt` to the public restore HTTPS CA bundle search path.

The public bootstrap trust model is intentionally layered: HTTPS authenticates the bootstrap server and protects transport integrity, Ed25519 signatures authorize the published bootstrap metadata, and SHA-256 verifies every content-addressed object. The detailed rationale for keeping HTTPS required is documented in `PUBLIC_BOOTSTRAP_RESTORE.md`.

Detailed implementation notes and commands are in `PUBLIC_BOOTSTRAP_RESTORE.md`.

## Validation Completed

Completed validation includes:

- C++ backup unit tests for plan, checkpoint, snapshot repository, SFTP planning, backup service, and admin server.
- Native static `libssh` testnet validation against the restricted `teleno_backup` SFTP-only account.
- Local and remote runs of `scripts/smoke-native-backup-restore.sh`.
- Electron/UX build and IPC tests.
- Playwright/Electron UX dry-run check using an isolated testnet basedir.
- Package staging and packaged-app verification now inspect the shipped `teleno_node --help` surface and fail if the native backup CLI flags are missing.

The detailed live-testnet evidence is in `NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md`.

## Safety Boundaries

- Do not use this flow first on a mainnet producer.
- Do not include producer private keys or wallet files in blockchain-state backups.
- Do not restore over an open RocksDB handle.
- Restore must start as observer before any block production is re-enabled.
- Mainnet production migration remains a guided operator flow after larger testnet and copied-mainnet observer validation.

## Remaining Work

The active remaining-work plan is `../../backlog/backup-restore/NATIVE_BACKUP_REMAINING_WORK_PLAN.md`.
