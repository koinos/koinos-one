# Native Backup Remaining Work Plan

- Date: 2026-06-15
- Scope: remaining work after native CLI, scheduler, admin API, libssh, smoke validation, and initial UX integration
- Status: active backlog after UX backup configuration

## Goal

Make native backup and restore ready for ordinary node operators, especially Mac operators with limited internal storage and optional external volumes, without requiring environment variables or manual YAML editing for the normal path.

The native binary already owns the durable backup semantics. The remaining work is primarily productization, UX control, larger validation, and release hardening.

## Completed On 2026-06-15

The first backlog item, `UX Backup Configuration`, is implemented:

- Settings > Backup now has local repository, remote SFTP, scheduler, and backup admin fields.
- Settings persistence includes normalized backup settings.
- Electron writes those settings into the UX-scoped native backup config used by dry-run, create, and restore.
- The UX validates missing remote host/user, non-absolute remote directory, missing credential file paths, and invalid schedule intervals before saving.
- Credential secrets are still represented only as file paths or environment-password references; raw SSH passwords are not stored by UX.
- Tests cover normalization and generated native backup YAML.

The first slice of `Backup Listing, Selection, And Verification` is implemented:

- `teleno_node --backup-list --backup-json` lists completed local repository snapshots without opening RocksDB.
- `teleno_node --backup-list-remote --backup-json` fetches completed remote snapshot metadata into the local repository cache and lists those snapshots without opening RocksDB.
- `--backup-id <backup-id>` selects a local snapshot for restore preflight, stage, and full restore.
- `--backup-id <backup-id>` also selects a remote snapshot for `--backup-restore-fetch` and `--backup-restore` when `backup.remote.enabled=true`.
- Electron exposes `nativeBackupList` and `restoreNativeBackup` IPC/preload calls.
- Settings > Backup can refresh local snapshots, refresh remote snapshot metadata, select a backup ID, and restore the selected snapshot.
- C++ snapshot tests cover local listing and selected preflight.

The first slice of `UX Runtime Admin API Integration` is implemented:

- When backup admin is enabled, the managed node is running, and remote upload is disabled, `Create native backup` uses `POST /admin/backup/create`.
- UX progress follows native admin status for the local snapshot operation.
- The existing cancel button can cancel the active admin operation.
- CLI fallback remains in place for stopped/offline flows and remote-enabled create flows.
- When backup admin is enabled without a custom token path, UX generates a random local token file at `<basedir>/.teleno-native-backups/admin.token` and uses the same file for generated config and admin client calls.

The first slice of `Safer Restore UX` is implemented:

- Settings > Backup can run native selected-backup restore preflight before restore.
- The preflight summary shows readiness, missing object count, disk-space message, available bytes, minimum bytes, and recommended bytes.
- Preflight uses the same native `--backup-restore-preflight --backup-json --backup-id=<selected>` path that restore uses.
- Restore activation now requires an explicit UX confirmation that names the backup ID and BASEDIR and explains `.pre-restore`, observer-first restart, and block-production-disabled behavior.

The first slice of `Release And Operator Polish` is implemented:

- Package staging verification still checks the staged native bundle, config templates, executability, and macOS third-party dylib leaks.
- Packaged-app verification still checks `app.asar`, packaged Teleno resources, executability, and macOS third-party dylib leaks.
- Both package verification scripts now inspect the shipped `teleno_node --help` surface and fail when required native backup CLI flags are missing.

## 1. UX Backup Configuration

### Objective

Operators should configure native backup from Teleno UX without editing YAML or setting `TELENO_BACKUP_*` environment variables.

### Tasks

- Add a Settings > Backup configuration section for local repository settings:
  - local backup enabled;
  - repository directory;
  - workspace directory;
  - local retention count.
- Add remote SFTP settings:
  - remote enabled;
  - host;
  - port;
  - user;
  - auth method;
  - private key file;
  - password file;
  - passphrase file;
  - known hosts file;
  - strict host-key checking;
  - remote directory;
  - remote retention count and days.
- Add scheduler settings:
  - enabled;
  - interval;
  - run on startup if missed;
  - jitter seconds;
  - minimum head progress;
  - skip while still at genesis.
- Validate obvious operator mistakes in the UI before writing config:
  - empty host/user when remote is enabled;
  - non-absolute remote directory;
  - missing key/password file;
  - invalid interval;
  - local repo/workspace on a volume without enough free space when this can be checked locally.
- Store secrets only as file paths or OS-secure credentials. Do not write raw passwords into `config.yml`.
- Generate or update the native `backup:` section in the selected node `config.yml` or in the UX-scoped backup config, depending on the chosen operator mode.

### Exit Criteria

- Status: complete for first-class UX fields and generated config.
- Remaining follow-up: local free-space checking for custom backup repository/workspace paths when reliable volume metadata is available to the renderer.

## 2. Backup Listing, Selection, And Verification

### Objective

Operators should see available backups and choose a specific backup, not only `latest`.

### Tasks

- Add native CLI support or expose existing repository metadata for:
  - list local snapshots;
  - list remote snapshots;
  - verify a selected backup;
  - select by backup ID or `latest`.
- Add JSON output for list/verify commands.
- Show backup metadata in UX:
  - backup ID;
  - created time;
  - network;
  - head height;
  - LIB;
  - total restored bytes;
  - minimum and recommended restore free space;
  - local/remote availability.
- Make restore use a selected backup ID.
- Keep `latest` as the default, not the only option.

### Exit Criteria

- Status: mostly complete for local and remote repository snapshots, selected local restore, and selected remote fetch/restore.
- Remaining work:
  - selected backup verification command separated from restore preflight;
  - richer manifest metadata for network, head height, LIB, and restored byte metrics in the list view.

## 3. UX Runtime Admin API Integration

### Objective

When the node is running, UX should use the native local admin API for backup create/status/cancel and restore stage/activate instead of launching separate CLI subprocesses for every runtime operation.

### Tasks

- Surface backup admin configuration in UX:
  - enabled;
  - listen address;
  - token file;
  - job count.
- Generate a local token file safely when the operator enables admin control.
- Detect admin availability from node status/logs/config.
- Implement UX client calls for:
  - `POST /admin/backup/create`;
  - `GET /admin/backup/status`;
  - `GET /admin/backup/status/<operation-id>`;
  - `POST /admin/backup/cancel`;
  - `POST /admin/backup/restore/stage`;
  - `POST /admin/backup/restore/activate`.
- Keep public JSON-RPC completely separate from backup admin control.
- Keep CLI fallback for new-node restore when the node is not running.

### Exit Criteria

- Status: partially complete for local-only running-node backup create/status/cancel and generated local admin tokens.
- Remaining work:
  - remote upload from admin-created backups;
  - admin-backed restore stage/activate UX;
  - richer status view for active/previous operation IDs.

## 4. Safer Restore UX

### Objective

Restore must be understandable and conservative for operators, especially when a selected Mac volume lacks enough space.

### Tasks

- Add a restore preflight view before any large download:
  - selected backup ID;
  - network;
  - target BASEDIR;
  - target volume;
  - available bytes;
  - required minimum bytes;
  - recommended bytes;
  - whether the target is empty or non-empty.
- Refuse restore in UX when:
  - backup network does not match node network;
  - target volume is below minimum free space;
  - target DB paths are non-empty and the operator has not explicitly chosen a force/preserve path.
- Show where existing data will be preserved:
  - `.pre-restore/<timestamp>-<backup-id>`.
- Explain that block production is disabled after restore and must be re-enabled only after observer verification.
- Add a post-restore checklist:
  - start observer;
  - verify `chain.get_head_info`;
  - verify chain ID;
  - verify head/LIB progress;
  - only then enable producer mode if intended.

### Exit Criteria

- Status: partially complete for selected local backup preflight visibility and explicit restore activation confirmation.
- Remaining work:
  - network/head/LIB mismatch display once manifest metadata includes those fields;
  - preserve-path preview before activation;
  - post-restore observer-first checklist in UX.

## 5. Larger Public-Testnet Validation

### Objective

Validate the native backup path against a near-head public-testnet unified basedir, not only tiny smoke fixtures and small observer data.

### Tasks

- Prepare or reuse a near-head unified testnet basedir on external storage.
- Run native backup while the testnet observer or producer-like test node is running.
- Upload to the restricted `teleno_backup` SFTP repository.
- Restore into a fresh basedir.
- Start restored node as observer with block production disabled.
- Compare:
  - chain ID;
  - restored head height;
  - restored LIB;
  - manifest head;
  - remote/public testnet head progress after startup.
- Record:
  - source size;
  - repository size;
  - uploaded bytes;
  - restore staged bytes;
  - backup time;
  - upload time;
  - restore time;
  - startup-to-ready time.

### Exit Criteria

- Larger public-testnet backup/restore passes.
- Restored observer advances normally after startup.
- Report is committed under `docs/roadmap/monolith/backup-restore/`.

## 6. Copied Mainnet Observer Validation

### Objective

Validate mainnet-scale behavior without touching live prodnet producer data or wallets.

### Tasks

- Use a copied/restored mainnet observer basedir only.
- Ensure block production is disabled.
- Migrate to unified RocksDB if required.
- Run native backup locally first.
- Run disk-space preflight for restore target.
- Restore into a fresh copied-mainnet validation basedir.
- Start restored node as observer only.
- Verify:
  - mainnet chain ID;
  - restored head/LIB;
  - verify-blocks observer recovery behavior;
  - no block production config is active after restore.
- Measure disk and time metrics.

### Exit Criteria

- Copied mainnet observer backup/restore passes.
- Report includes exact commands and safety evidence.
- No prodnet wallet or producer private key material is touched.

## 7. Release And Operator Polish

### Objective

Make the feature safe to ship in a beta app and clear enough for operators.

### Tasks

- Update operator docs:
  - create local backup;
  - create remote backup;
  - restore new node from latest;
  - restore selected backup;
  - configure schedule;
  - recover from failed upload;
  - recover from failed restore preflight.
- Add packaged app verification for native backup assets and static dependencies.
- Add UX copy for:
  - remote credentials;
  - disk-space shortage;
  - observer-first restore;
  - producer private key exclusion.
- Add release checklist items:
  - `npm run build`;
  - Electron IPC tests;
  - C++ backup test target;
  - local native smoke;
  - remote native smoke;
  - package staging verification.
- Decide whether the beta exposes restore activation by default or hides it behind an advanced confirmation until larger validation passes.

### Exit Criteria

- Docs and UX copy match actual behavior.
- Release gates include native backup checks.
- Beta release notes clearly state supported and unsupported backup flows.

Current status: partially complete for package verification. Remaining work is operator how-to coverage, release checklist polish, beta release notes, and final decision on whether restore activation stays visible by default before larger validation passes.

## Recommended Next Step

Implement selected-backup verification separated from restore preflight next, then add richer manifest metadata for network/head/LIB so the restore UX can enforce mismatch checks before larger public-testnet validation.
