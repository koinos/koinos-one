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
- The UX validates missing remote host/user, non-absolute remote directory, missing credential file paths, invalid schedule intervals, and missing admin token files before saving.
- Credential secrets are still represented only as file paths or environment-password references; raw SSH passwords are not stored by UX.
- Tests cover normalization and generated native backup YAML.

The first slice of `Backup Listing, Selection, And Verification` is implemented:

- `teleno_node --backup-list --backup-json` lists completed local repository snapshots without opening RocksDB.
- `--backup-id <backup-id>` selects a local snapshot for restore preflight, stage, and full restore.
- Electron exposes `nativeBackupList` and `restoreNativeBackup` IPC/preload calls.
- Settings > Backup can refresh local snapshots, select a backup ID, and restore the selected local snapshot.
- C++ snapshot tests cover local listing and selected preflight.

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

- Status: partially complete for local repository snapshots and selected local restore.
- Remaining work:
  - remote SFTP snapshot listing;
  - selected remote fetch/restore by backup ID;
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

- Running-node backup from UX uses admin API.
- Progress in UX is driven by native operation status JSON.
- Cancel works for safe cancellation points.
- Admin token is never printed in logs or visible output.

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

- UX restore cannot accidentally replace non-empty node state without an explicit operator decision.
- UX warns before any multi-GB download.
- UX gives the exact observer-first next step after activation.

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

## Recommended Next Step

Implement the remaining remote and verification parts of `Backup Listing, Selection, And Verification` next, or proceed to `UX Runtime Admin API Integration` if running-node status/cancel UX is higher priority.
