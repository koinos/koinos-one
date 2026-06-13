# Native SSH Hot Backup Implementation Plan

- Date: 2026-06-13
- Scope: Native `teleno_node` backup, upload, and restore orchestration
- Status: implementation plan

## Goal

Move backup and restore ownership from the Electron UX into the native `teleno_node` binary.

The native node must be able to:

1. Create a hot backup while the node process remains running.
2. Upload the backup over SSH/SFTP to an operator-provided Ubuntu server.
3. Read backup configuration from the same `config.yml` used by the node.
4. Restore a node database from a remote backup in a controlled operator flow.
5. Expose CLI commands first, then a local authenticated admin control path for the future Teleno UX.

The first production target is macOS running `teleno_node`, backing up to an Ubuntu server over SSH.

## Non-Goals

- Do not back up GUI wallet files by default.
- Do not back up producer private keys by default.
- Do not expose backup or restore as public Koinos JSON-RPC methods.
- Do not perform a destructive restore into a running RocksDB database.
- Do not mutate prodnet data during implementation or validation.
- Do not require Electron to perform the archive, upload, or restore logic.

## Existing State

The current Electron implementation lives in:

```text
electron/lib/backup-service.ts
electron/preload.ts
electron/lib/ipc-handlers.ts
src/components/panels/SettingsPanel.tsx
```

That implementation is UX-owned and legacy-shaped:

- Downloads or reads `.tar.gz` blockchain backups.
- Extracts legacy directories such as `chain` and `block_store`.
- Stops the node before restore.
- Uses Electron IPC progress events.
- Writes `.backup-just-restored` and toggles `chain.verify-blocks`.

The native node currently supports these storage command modes:

```text
--storage-report
--migrate-chain-db-to-unified-rocksdb
--rollback-unified-chain-db-migration
--require-rocksdb-compression
--compact-db
--compact-cf
--all
```

The older plan in `ONLINE_ROCKSDB_CHECKPOINT_BACKUP_PLAN.md` covers online checkpoint creation but still leaves archive/upload ownership mostly in Electron. This plan supersedes that direction for new native backup work.

## Critical Design Constraint: Restore Cannot Replace Open RocksDB

Hot backup is feasible because RocksDB can create a consistent checkpoint while the database is open.

Hot restore into the same running database is not safe. The node cannot replace `BASEDIR/db` or `BASEDIR/chain/blockchain` while those RocksDB handles are open.

Therefore restore has two stages:

1. **Hot restore preparation:** while the node is running, download and verify the selected backup into a staging directory.
2. **Restore activation:** stop or restart the node, atomically swap the restored database into place, then start as an observer first.

This can still be triggered by an admin API at runtime, but activation must close the live DB first. The admin API should return a clear `requires_restart` or `requires_shutdown` status rather than pretending a live in-place restore is possible.

## Storage Layout Support

The implementation must support both current and target layouts.

### Current Two-DB Layout

Current populated nodes may still use:

```text
BASEDIR/db
BASEDIR/chain/blockchain
```

In this layout, backup must checkpoint both RocksDB roots under one application-level write pause:

```text
checkpoint/
  db/
  chain/blockchain/
  chain/genesis_data.json
  jsonrpc/descriptors/koinos_descriptors.pb
  config.yml
  backup-manifest.json
```

### Unified One-DB Layout

Migrated nodes use:

```text
BASEDIR/db
```

with column families:

```text
default
blocks
block_meta
contract_meta
transaction_index
account_history
chain_state
chain_metadata
storage_metadata
```

For unified layout, backup needs one RocksDB checkpoint plus runtime files:

```text
checkpoint/
  db/
  chain/genesis_data.json
  jsonrpc/descriptors/koinos_descriptors.pb
  config.yml
  backup-manifest.json
```

The manifest must identify which layout was captured.

## Native CLI Surface

Keep the current Boost program-options style for the first implementation. Add command modes rather than a separate Electron-only flow.

Recommended flags:

```text
--backup-create
--backup-list
--backup-verify
--backup-restore
--backup-restore-stage
--backup-restore-activate
--backup-id <id|latest>
--backup-output <local-path>
--backup-remote-path <remote-path>
--backup-retention-prune
--backup-dry-run
--backup-json
--force
```

Examples:

```bash
teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --backup-create
```

```bash
teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --backup-list
```

```bash
teleno_node \
  --basedir /Volumes/external/new-node/basedir \
  --config /Volumes/external/new-node/basedir/config.yml \
  --backup-restore \
  --backup-id latest
```

```bash
teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml \
  --backup-restore-stage \
  --backup-id latest
```

CLI command modes must not start P2P, JSON-RPC, gRPC, or block production unless explicitly requested after restore.

## Config Schema

Add a `backup:` section to the same runtime config file.

Recommended initial schema:

```yaml
backup:
  enabled: true
  workspace: /Volumes/external/teleno-backup-work
  node-id: local-mac-producer-1
  include:
    database: true
    config: true
    genesis: true
    jsonrpc-descriptors: true
    producer-keys: false
    wallets: false
    logs: false
  archive:
    format: tar.zst
    compression-level: 3
    local-retain: 1
  ssh:
    enabled: true
    host: 46.0.0.10
    port: 22
    user: teleno-backup
    auth: password-file
    password-file: /Users/operator/.config/teleno/backup-ssh-password
    private-key-file: ""
    known-hosts-file: /Users/operator/.ssh/known_hosts
    strict-host-key-checking: true
    connect-timeout-seconds: 15
  remote:
    directory: /srv/teleno-backups
    retention-count: 7
    retention-days: 14
    upload-temp-suffix: .partial
```

For passwords, prefer a `password-file` with `0600` permissions. Do not encourage raw passwords in `config.yml`. If a raw password field is added for UX compatibility, it must be treated as deprecated and logged with a warning that only says the field is insecure, never the password.

Optional credential mechanisms:

```yaml
backup:
  ssh:
    auth: private-key
    private-key-file: /Users/operator/.ssh/teleno_backup_ed25519
    passphrase-file: /Users/operator/.config/teleno/backup-key-passphrase
```

```yaml
backup:
  ssh:
    auth: env-password
    password-env: TELENO_BACKUP_SSH_PASSWORD
```

The UX can later write credentials to macOS Keychain and generate a temporary `password-file` or passphrase file at runtime. The native node should not depend on Electron for that.

## SSH Transport Choice

Use a native SSH/SFTP library instead of shelling out to `scp` or `rsync` as the primary path.

Recommended dependency:

```text
libssh2
```

Reasons:

- Supports password and private-key auth in-process.
- Avoids `sshpass`.
- Avoids parsing OpenSSH command output.
- Works with future Windows builds.
- Lets the node implement progress, resume, temp upload names, and atomic rename.

Build impact:

- Add static `libssh2` dependency to the macOS build cache.
- Link against existing static OpenSSL where possible.
- Add a release check similar to zstd/GMP to avoid Homebrew dynamic library leaks.

Fallback for development only:

- An optional `backup.ssh.transport: openssh` mode may spawn `/usr/bin/ssh`/`sftp` for local experiments.
- It must not be the default because password auth is not cleanly automatable without insecure helper tooling.

## Remote Backup Layout

Use a directory-per-backup layout on the Ubuntu server.

```text
/srv/teleno-backups/
  <network>/
    <node-id>/
      latest.json
      backups/
        20260613T102241Z-height-5766248-<short-head>/
          backup.tar.zst
          backup.tar.zst.sha256
          backup-manifest.json
          backup-manifest.json.sha256
          COMPLETE
```

Upload must be atomic:

1. Create remote temp directory:

```text
backups/<backup-id>.partial/
```

2. Upload archive and manifest.
3. Verify uploaded sizes and checksums.
4. Write `COMPLETE`.
5. Rename temp directory to final backup directory.
6. Update `latest.json` by upload-to-temp plus rename.

If upload fails, leave `.partial` for inspection or cleanup. `--backup-retention-prune` may delete old `.partial` directories older than a configured threshold.

## Backup Archive Format

Use a new native format, not the legacy Koinos seed backup format.

Filename:

```text
teleno-rocksdb-<network>-<height>-<YYYYMMDDTHHMMSSZ>.tar.zst
```

Archive contents for current two-DB layout:

```text
backup-manifest.json
db/
chain/blockchain/
chain/genesis_data.json
jsonrpc/descriptors/koinos_descriptors.pb
config.yml
```

Archive contents for unified layout:

```text
backup-manifest.json
db/
chain/genesis_data.json
jsonrpc/descriptors/koinos_descriptors.pb
config.yml
```

Do not include by default:

```text
block_producer/private.key
wallets
GUI secure storage
logs
legacy block_store/
legacy account_history/
legacy transaction_store/
legacy contract_meta_store/
.teleno-blockchain-backup-cache/
.teleno-checkpoints/
.teleno-backup-work/
```

Producer key export should be a separate encrypted identity backup feature. It should not be silently bundled with blockchain-state backups.

## Manifest Schema

Add a versioned manifest. Example:

```json
{
  "format": "teleno-native-rocksdb-backup",
  "version": 1,
  "backup_id": "20260613T102241Z-height-5766248-1220abcd",
  "created_at": "2026-06-13T10:22:41Z",
  "node": {
    "name": "teleno_node",
    "version": "0.1.0+b1208669ebfe-dirty",
    "binary": "/Users/operator/Teleno.app/Contents/Resources/teleno/bin/teleno_node"
  },
  "source": {
    "basedir": "/Volumes/external/teleno-testnet-producer/basedir",
    "network": "testnet",
    "node_id": "local-mac-producer-1",
    "storage_layout": "legacy-two-db"
  },
  "head": {
    "height": "5766248",
    "id": "0x1220...",
    "lib": "5766188",
    "state_merkle_root": "Ei..."
  },
  "rocksdb": {
    "compression": {
      "default": "zstd",
      "blocks": "zstd",
      "supported": ["none", "zstd", "zstd-not-final"]
    },
    "databases": [
      {
        "name": "shared",
        "path": "db",
        "column_families": [
          "default",
          "blocks",
          "block_meta",
          "contract_meta",
          "transaction_index",
          "account_history",
          "chain_state",
          "chain_metadata",
          "storage_metadata"
        ]
      },
      {
        "name": "legacy_chain_state",
        "path": "chain/blockchain",
        "column_families": ["default", "objects", "metadata"]
      }
    ]
  },
  "archive": {
    "path": "backup.tar.zst",
    "sha256": "abc...",
    "size_bytes": 123456789,
    "compression": "zstd",
    "compression_level": 3
  },
  "restore": {
    "restore_mode": "replace-basedir-databases",
    "requires_node_stop": true,
    "start_as_observer_first": true,
    "force_block_producer_disabled_on_first_start": true,
    "requires_verify_blocks": false
  },
  "exclusions": [
    "block_producer/private.key",
    "wallets",
    "logs"
  ]
}
```

The manifest is consensus-critical restore metadata. It must be validated before restore.

## Hot Backup Algorithm

### High-Level Flow

1. Load `backup:` config.
2. Validate SSH credentials and remote directory.
3. Reject if another backup or restore is running.
4. Capture current node status:
   - network
   - chain ID
   - head height
   - head block ID
   - LIB
   - storage layout
   - compression
5. Acquire the backup write-quiesce guard.
6. Flush WAL if configured.
7. Create RocksDB checkpoint(s).
8. Release the write-quiesce guard.
9. Write manifest into checkpoint workspace.
10. Archive checkpoint to local `tar.zst`.
11. Compute SHA-256.
12. Upload to remote `.partial` directory over SFTP.
13. Verify remote size/checksum.
14. Atomically rename remote backup into place.
15. Update `latest.json`.
16. Apply retention pruning if configured.
17. Remove local checkpoint workspace, subject to `local-retain`.

### Write-Quiesce Guard

RocksDB checkpoints are internally consistent per RocksDB database. The node still needs an application-level guard so a two-DB backup does not capture `BASEDIR/db` and `BASEDIR/chain/blockchain` at different logical points.

Add a `BackupCoordinator` shared by state-changing services.

Responsibilities:

- Track backup state: `idle`, `quiescing`, `checkpointing`, `archiving`, `uploading`, `complete`, `failed`.
- Provide a read/write gate:
  - normal block writes acquire shared access
  - backup checkpoint creation acquires exclusive access
- Stop new block application while exclusive checkpoint is active.
- Wait for in-flight writes to finish.
- Release writes immediately after checkpoint creation.

This pause should be short. Archive and upload happen after the checkpoint and must not block normal syncing or production.

Producer impact:

- While the exclusive checkpoint guard is active, production may skip a slot or delay a proposal.
- Log this clearly:

```text
[backup] Pausing block application for checkpoint
[backup] Checkpoint created in 421ms
[backup] Resumed block application
```

If the pause exceeds a threshold, emit:

```text
[backup] Checkpoint pause exceeded producer warning threshold: 2500ms
```

### Current Two-DB Checkpoint

For `legacy-two-db` layout:

1. Acquire exclusive backup guard.
2. Create checkpoint for shared DB.
3. Create checkpoint for chain state DB.
4. Release exclusive backup guard.

If checkpoint creation fails after one DB succeeds, delete the partial checkpoint directory and return failure.

### Unified One-DB Checkpoint

For `unified` layout:

1. Acquire exclusive backup guard.
2. Create checkpoint for shared DB.
3. Release exclusive backup guard.

## Archive Implementation

Use native archive creation inside `teleno_node`.

Recommended dependency:

```text
libarchive + zstd
```

Reasons:

- Avoids shelling out to `tar`.
- Gives predictable file filtering.
- Works with future Windows packaging.
- Can stream directly to a file while computing SHA-256.

Initial compromise if dependency work is too large:

- Phase 1 can write an uncompressed checkpoint directory and upload it as a directory tree over SFTP for testnet-only validation.
- Phase 2 adds `tar.zst` with libarchive.

Preferred final behavior:

- Create `backup.tar.zst`.
- Stream archive creation through SHA-256.
- Write `backup.tar.zst.sha256`.
- Upload archive and manifest.

## SSH Upload Implementation

Add a native `SshBackupClient`.

Recommended files:

```text
node/teleno-node/src/backup/ssh_client.hpp
node/teleno-node/src/backup/ssh_client.cpp
```

Core operations:

```cpp
connect()
authenticate_password()
authenticate_private_key()
ensure_directory(path)
upload_file(local_path, remote_path, progress_callback)
read_file(remote_path)
write_file(remote_path, bytes)
rename(remote_tmp_path, remote_final_path)
stat(remote_path)
remove(remote_path)
list_directory(path)
```

Upload safety:

- Always upload to a `.partial` path.
- Never overwrite a completed backup unless `--force` is provided.
- Verify remote file size.
- Optionally verify remote SHA-256 by uploading a small helper command in a later phase. In the first implementation, verify by re-reading the remote `.sha256` and comparing known sizes.
- Remote Ubuntu server should use a restricted user with write access only to the backup directory.

## Restore Design

### New Installation Restore

Primary command:

```bash
teleno_node \
  --basedir /path/to/new/basedir \
  --config /path/to/new/basedir/config.yml \
  --backup-restore \
  --backup-id latest
```

Flow:

1. Read `backup:` SSH config.
2. Connect to remote.
3. Resolve `latest.json` or selected `backup-id`.
4. Download manifest.
5. Validate manifest:
   - format
   - version
   - network
   - storage layout
   - archive checksum
   - required runtime files
6. Download archive to staging:

```text
BASEDIR/.teleno-restore-staging/<backup-id>/
```

7. Verify SHA-256.
8. Extract into staging.
9. Refuse to overwrite non-empty live DB paths unless `--force`.
10. Move existing DB paths to:

```text
BASEDIR/.pre-restore/<timestamp>/
```

11. Move restored DB paths into place.
12. Write:

```text
BASEDIR/.backup-just-restored
BASEDIR/.teleno-restore-manifest.json
```

13. Force first start to observer-safe mode:
   - block producer disabled
   - P2P enabled only after explicit operator choice, or start local JSON-RPC-only verification first
   - `chain.verify-blocks` according to manifest
14. Print exact next command.

### Runtime-Triggered Restore

Do not expose this through public chain JSON-RPC.

Add a private local admin API:

```text
POST /admin/backup/restore/stage
POST /admin/backup/restore/activate
GET  /admin/backup/status/<id>
POST /admin/backup/cancel/<id>
```

Runtime restore flow:

1. Node is running.
2. Operator or UX calls `restore/stage`.
3. Node downloads, verifies, and extracts backup to staging while current node continues running.
4. Operator reviews manifest and target.
5. Operator calls `restore/activate`.
6. Node writes a restore-intent file:

```text
BASEDIR/.teleno-pending-restore.json
```

7. Node stops services cleanly and exits with a specific exit code, for example `73`.
8. Supervisor or UX restarts:

```bash
teleno_node --basedir <basedir> --config <config> --backup-restore-activate
```

9. Activation applies the staged restore, then starts as observer or exits with next-step instructions.

This gives runtime control without unsafe live DB replacement.

## Private Admin Control

Future UX integration should use a private admin channel, not public JSON-RPC.

Recommended first implementation:

```yaml
admin:
  enabled: true
  listen: 127.0.0.1:0
  token-file: /Users/operator/.config/teleno/admin-token
```

Admin endpoint requirements:

- Bind loopback only by default.
- Require bearer token for every request.
- Never log token values.
- Return JSON status for backup/restore operations.
- Reject if `admin.enabled` is false.

Future hardening:

- Unix domain socket on macOS/Linux.
- Named pipe on Windows.
- Per-request nonce or mTLS is not needed for the first local-only version.

## Status Model

Add a persistent status file for long-running operations:

```text
BASEDIR/.teleno-backup-status/<operation-id>.json
```

Fields:

```json
{
  "operation_id": "backup-20260613T102241Z",
  "operation": "backup-create",
  "status": "uploading",
  "phase": "sftp-upload",
  "progress": {
    "bytes_done": 123,
    "bytes_total": 456
  },
  "started_at": "2026-06-13T10:22:41Z",
  "updated_at": "2026-06-13T10:23:41Z",
  "message": "Uploading backup.tar.zst",
  "error": null
}
```

This lets CLI, logs, and later UX show the same operation status.

## Retention

Implement remote retention after a successful upload.

Config:

```yaml
backup:
  remote:
    retention-count: 7
    retention-days: 14
```

Rules:

- Never delete the backup just created.
- Only delete backups with `COMPLETE`.
- Leave `.partial` directories for at least 24 hours unless `--backup-retention-prune --force`.
- Retention errors should warn but not mark the backup as failed after upload success.

## Restore Safety Policy

Restore must be conservative.

Rules:

- Refuse restore if selected backup network does not match config network unless `--force-network`.
- Refuse restore into non-empty DB paths unless `--force`.
- Before replacing DB paths, move current DB paths to `.pre-restore/<timestamp>`, never delete first.
- Always write restore manifest into basedir.
- First post-restore start must disable block production unless operator explicitly re-enables it after verification.
- Mainnet restore must start as observer.
- If `.backup-just-restored` exists, preserve the existing validation-first recovery behavior.
- If restored state reports merkle mismatch, follow the existing merkle recovery guardrail: observer first, `verify-blocks: true`, no clean-state delete without explicit approval.

## Interaction With Producer Data

Blockchain-state backup and producer-identity backup are separate features.

Default blockchain-state backup excludes:

```text
block_producer/private.key
```

Reason:

- The same database backup may be copied to observers.
- Producer private keys need stronger encryption and user intent.

Future producer backup command:

```bash
teleno_node --producer-identity-export --encrypt-to <recipient>
```

or UX-managed encrypted export.

For now, the manifest should include whether producer files were excluded:

```json
"producer_identity": {
  "included": false,
  "local_public_key": "Ajy...",
  "producer_address": "1Kj..."
}
```

Public key and producer address are safe to record. Private key material is not.

## Code Structure

Recommended new C++ files:

```text
node/teleno-node/src/backup/backup_config.hpp
node/teleno-node/src/backup/backup_config.cpp
node/teleno-node/src/backup/backup_coordinator.hpp
node/teleno-node/src/backup/backup_coordinator.cpp
node/teleno-node/src/backup/backup_manager.hpp
node/teleno-node/src/backup/backup_manager.cpp
node/teleno-node/src/backup/backup_manifest.hpp
node/teleno-node/src/backup/backup_manifest.cpp
node/teleno-node/src/backup/backup_archive.hpp
node/teleno-node/src/backup/backup_archive.cpp
node/teleno-node/src/backup/ssh_client.hpp
node/teleno-node/src/backup/ssh_client.cpp
node/teleno-node/src/admin/admin_server.hpp
node/teleno-node/src/admin/admin_server.cpp
```

Modify:

```text
node/teleno-node/src/core/config.hpp
node/teleno-node/src/core/config.cpp
node/teleno-node/src/storage/rocksdb_manager.hpp
node/teleno-node/src/storage/rocksdb_manager.cpp
node/teleno-node/src/koinos/chain/controller.hpp
node/teleno-node/src/koinos/chain/controller.cpp
node/teleno-node/src/main.cpp
node/teleno-node/src/CMakeLists.txt
```

Tests:

```text
node/teleno-node/tests/backup/backup_config_test.cpp
node/teleno-node/tests/backup/backup_manifest_test.cpp
node/teleno-node/tests/backup/backup_checkpoint_test.cpp
node/teleno-node/tests/backup/ssh_client_mock_test.cpp
node/teleno-node/tests/backup/restore_plan_test.cpp
```

## Implementation Phases

### Phase 1: Native Config And Manifest

Implement:

- Parse `backup:` config.
- Validate credential path permissions.
- Validate remote directory syntax.
- Build manifest from node status.
- Add JSON output for `--backup-dry-run --backup-json`.

Exit criteria:

- Config tests pass.
- Manifest tests pass.
- CLI dry run prints a complete plan and does not open network connections.

### Phase 2: RocksDB Hot Checkpoint

Implement:

- `BackupCoordinator`.
- Checkpoint for `BASEDIR/db`.
- Checkpoint for `BASEDIR/chain/blockchain` when layout is `legacy-two-db`.
- Temporary checkpoint workspace under `backup.workspace`.
- Cleanup on failure.

Exit criteria:

- Unit test opens checkpoint DB independently.
- Concurrent write test proves writes resume after checkpoint.
- A local testnet basedir can create a checkpoint without stopping the node.

### Phase 3: Native Archive

Implement:

- Archive checkpoint directory to `tar.zst`.
- SHA-256 generation.
- Manifest embedding.
- Local verification command.

Exit criteria:

- Archive can be extracted.
- Manifest checksum matches.
- Restore staging validates archive before touching basedir.

### Phase 4: SSH/SFTP Upload

Implement:

- Static `libssh2` build.
- Password-file auth.
- Private-key auth.
- Known-host verification.
- Remote temp upload and atomic rename.
- Remote `latest.json`.
- Retention pruning.

Exit criteria:

- Upload to a test Ubuntu server succeeds.
- Interrupted upload leaves `.partial`.
- Completed upload has `COMPLETE`.
- Listing remote backups works.

### Phase 5: CLI Restore

Implement:

- `--backup-list`.
- `--backup-restore --backup-id <id|latest>`.
- Staging download.
- SHA-256 verification.
- Safe DB path replacement.
- Pre-restore preservation.
- Observer-first restore policy.

Exit criteria:

- Restore into an empty basedir works.
- Restore into non-empty basedir refuses without `--force`.
- Restored node starts with P2P disabled and answers `chain.get_head_info`.

### Phase 6: Runtime Admin Control

Implement:

- Private admin listener.
- Token auth.
- Backup create/status/cancel endpoints.
- Restore stage/status/activate endpoints.
- Specific exit code for pending restore activation.

Exit criteria:

- Public JSON-RPC cannot call backup methods.
- Admin token required.
- Runtime stage works while node continues syncing.
- Activate cleanly stops node and applies restore on restart.

### Phase 7: Teleno UX Integration

Replace UX-owned implementation with native calls:

- Settings backup UI writes `backup:` config.
- UX calls native admin endpoint for running node backups.
- UX calls CLI restore for new installations.
- Existing legacy restore remains behind an advanced compatibility label.

Exit criteria:

- UX no longer archives live database directories itself.
- UX no longer stops node for native checkpoint backup.
- Progress comes from native status JSON.

### Phase 8: Live Validation

Validation order:

1. Unit tests.
2. Isolated private testnet.
3. Public testnet observer.
4. Public testnet producer.
5. Copied mainnet observer data.
6. Guided prodnet operator flow only after evidence is accepted.

No first validation on a mainnet producer.

## Test Matrix

### Unit Tests

- Backup config parses password-file auth.
- Backup config rejects missing credential file.
- Backup config rejects group/world-readable password file.
- Manifest round-trips JSON.
- Manifest rejects network mismatch.
- Manifest rejects unsupported format version.
- Checkpoint manager creates a readable checkpoint.
- Checkpoint manager cleans partial output on failure.
- Restore planner refuses non-empty basedir without force.
- Restore planner preserves existing DB paths before replacement.

### Integration Tests

- Local two-DB basedir checkpoint and restore.
- Unified basedir checkpoint and restore.
- Backup while block sync is active.
- Backup while block producer loop is enabled on testnet.
- Remote SFTP upload to Ubuntu test server.
- Restore from remote `latest`.
- Interrupted upload recovery.
- Retention pruning.

### Release Gates

Commands:

```bash
cmake --build node/teleno-node/build --target teleno_node backup_config_test backup_manifest_test backup_checkpoint_test --parallel
ctest --test-dir node/teleno-node/build --output-on-failure -R 'backup|rocksdb_manager'
scripts/check-rocksdb-compression.sh
scripts/smoke-native-backup-restore.sh
```

New smoke script:

```text
scripts/smoke-native-backup-restore.sh
```

Flow:

1. Start temporary testnet/private basedir.
2. Wait for JSON-RPC readiness.
3. Create native hot backup.
4. Upload to local test SSH server or mocked SFTP target.
5. Restore into second basedir.
6. Start restored node as observer.
7. Compare `chain.get_head_info`.
8. Clean up processes.

## Operational Runbook

### Create Backup

```bash
teleno_node \
  --basedir <basedir> \
  --config <basedir>/config.yml \
  --backup-create
```

Expected output:

```text
backup_id: 20260613T102241Z-height-5766248-1220abcd
local_archive: /.../backup.tar.zst
remote_archive: /srv/teleno-backups/testnet/local-mac-producer-1/backups/.../backup.tar.zst
sha256: abc...
status: complete
```

### List Backups

```bash
teleno_node \
  --basedir <basedir> \
  --config <basedir>/config.yml \
  --backup-list
```

### Restore New Node

```bash
teleno_node \
  --basedir <new-basedir> \
  --config <new-basedir>/config.yml \
  --backup-restore \
  --backup-id latest
```

Then start observer:

```bash
teleno_node \
  --basedir <new-basedir> \
  --config <new-basedir>/config.yml \
  --disable block_producer
```

Only enable block production after local head, network, producer address, and registered key are verified.

## Security Notes

- Password files must be `0600`.
- Known-host verification must default to enabled.
- Remote backup user should not have shell write access outside backup root.
- Admin token must never be printed.
- Backup archives should not contain private keys by default.
- Future archive encryption should be planned before producer identity export.

## Open Questions

1. Should the first SSH transport implementation support password-file only, or password-file plus private-key immediately?
2. Should the first archive implementation upload a directory tree before adding `tar.zst`, or should `tar.zst` be mandatory from the start?
3. Should remote checksum verification re-download the archive hash, run a remote `sha256sum`, or both?
4. Should restore activation relaunch the node directly, or should it always exit and let UX/CLI supervisor restart?
5. Should `latest.json` be per network only, or per network plus node ID?
6. Should backup scheduling live in the native node in the first implementation, or remain manual CLI/admin only until UX integration?

## Recommendation

Implement native backup in this order:

1. Config and manifest.
2. Hot RocksDB checkpoint for both current two-DB and unified layouts.
3. Native archive and local restore verification.
4. Native SSH/SFTP upload.
5. CLI restore from remote backup.
6. Private admin runtime control.
7. Teleno UX integration.

Do not start with UX integration. The native binary must own the durable semantics first; the UX should become a controller and progress viewer over native commands/status.
