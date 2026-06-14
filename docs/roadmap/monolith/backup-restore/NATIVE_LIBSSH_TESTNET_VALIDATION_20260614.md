# Native libssh Testnet Backup Validation

- Date: 2026-06-14
- Branch: `codex/unified-rocksdb-storage`
- Source commit: `ddd2d15`
- Binary tested: `node/teleno-node/build/teleno_node`
- Version reported by binary: `teleno_node 0.1.0+a4541257940e-dirty`
- Network: public Koinos testnet
- Result: passed

## Scope

This validation proved the static native `libssh` backup path against live
testnet data without touching prodnet data or the live testnet producer basedir.

The test covered:

1. Static binary dependency check.
2. Restricted SFTP account authentication.
3. Native scheduler hot checkpoint while an observer node was running.
4. Native `libssh` upload to the testnet backup server.
5. Native `libssh` remote restore into a fresh basedir.
6. Observer-first startup from the restored unified RocksDB database.
7. Live testnet producer health after the test.

## Environment

Live producer basedir:

```text
/Volumes/external/teleno-testnet-producer/basedir
```

Isolated validation root:

```text
/Volumes/external/teleno-backup-validation-20260614T113141Z
```

Remote SFTP root used for this validation:

```text
/srv/teleno-backups/testnet/teleno-dev/codex-static-20260614T113141Z
```

Remote account:

```text
host: testnet.koinosfoundation.org
user: teleno_backup
auth: private-key
known_hosts: /Users/pgarcgo/.ssh/known_hosts
```

The `teleno_backup` account is SFTP-only. Shell commands are blocked for that
account; root SSH was used only to create the validation directory and inspect
remote disk usage.

## Static Binary Check

`otool -L node/teleno-node/build/teleno_node` showed only system libraries:

```text
/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation
/usr/lib/libSystem.B.dylib
/usr/lib/libresolv.9.dylib
/usr/lib/libc++.1.dylib
```

There were no `/opt/homebrew` or `/usr/local` dynamic dependencies. This proves
the tested binary did not depend on Homebrew `libssh`, OpenSSL, or zlib dylibs.

## Testnet Genesis

The bundled Harbinger example genesis does not match the live public testnet.
The correct live-testnet files were copied from the server path documented in
`MONOLITH_EXTERNAL_TESTNET_REPORT.md`:

```text
/root/koinos/config/genesis_data.json
/root/koinos/config/koinos_descriptors.pb
```

The isolated observer calculated and served the expected live-testnet chain ID:

```text
0x122008295be6ebe576aa6b2652f3c9cb4f6f0822dbb67f651c5a70ac96dc4c811645
```

## Hot Backup Validation

The isolated observer was started with:

- `block_producer: false`
- `p2p` connected to the public testnet seed
- `backup.schedule.enabled: true`
- `backup.schedule.interval: 10s`
- `backup.remote.enabled: true`
- `backup.ssh.transport: native`
- `backup.ssh.auth: private-key`

A fresh observer starts with legacy chain state, so the isolated basedir was
stopped after initial sync and migrated with:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-backup-validation-20260614T113141Z/observer \
  --config /Volumes/external/teleno-backup-validation-20260614T113141Z/observer/config.yml \
  --migrate-chain-db-to-unified-rocksdb
```

Migration result:

```text
objects: count=79 bytes=596614
metadata: count=5 bytes=266
```

After restart, the scheduler created and uploaded native hot backups while the
observer continued syncing. Successful remote upload rows:

```text
backup_id=20260614T113553Z-ms-1781436953634-files-11
file_count=18
total_bytes=1140681
retries=0

backup_id=20260614T113609Z-ms-1781436969015-files-19
file_count=27
total_bytes=1746919
retries=0

backup_id=20260614T113627Z-ms-1781436987989-files-19
file_count=31
total_bytes=2505987
retries=0
```

Local validation repository size after the run:

```text
1.7M /Volumes/external/teleno-backup-validation-20260614T113141Z/repo
```

Remote validation repository size after the run:

```text
2.8M /srv/teleno-backups/testnet/teleno-dev/codex-static-20260614T113141Z
```

## Remote Restore Validation

Restore command:

```bash
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-backup-validation-20260614T113141Z/restore/basedir \
  --config /Volumes/external/teleno-backup-validation-20260614T113141Z/restore/config.yml \
  --backup-restore \
  --backup-output /Volumes/external/teleno-backup-validation-20260614T113141Z/restore/staging \
  --backup-json
```

Restore result:

```text
ok: true
transport: native-libssh
backup_id: 20260614T113627Z-ms-1781436987989-files-19
metadata_file_count: 4
object_file_count: 22
object_bytes: 2461662
retry_count: 0
ready_to_stage: true
ready_to_restore: true
restored_file_count: 22
restored_bytes: 2461662
block_producer_disabled_on_first_start: true
start_as_observer_first: true
```

Disk-space preflight passed before restore activation:

```text
available_bytes: 245283270656
minimum_target_free_bytes: 136679390
recommended_target_free_bytes: 10874097630
passes_minimum: true
below_recommended: false
```

## Restored Observer Startup

The restored basedir was started with block production disabled and P2P disabled
on a separate local JSON-RPC port:

```text
127.0.0.1:18252
```

Startup evidence:

```text
[chain] Backup restore detected -- enabling verify-blocks for merkle correction
[chain] State DB opened from shared RocksDB column families
Finished indexing 60 blocks, took 0.524922 seconds
[node] teleno_node ready
```

Restored observer RPC result:

```text
chain_id: 0x122008295be6ebe576aa6b2652f3c9cb4f6f0822dbb67f651c5a70ac96dc4c811645
head_height: 4020
last_irreversible_block: 3960
head_id: 0x1220262a1f960c9a12546194864777ce750588a5cc03a00e6333ecdaa776c31f1ce8
```

The restored observer was then stopped cleanly.

Stopped storage-report verification:

```text
layout.chain_storage: unified
chain_state_db_exists: false
compression.selected_default: zstd
compression.selected_blocks: zstd
blocks estimated_keys: 4020
chain_state estimated_keys: 95
```

## Live Producer Safety Check

The existing live testnet producer was not restarted or edited during this
validation. After the restore test, local producer RPC and public testnet RPC
matched:

```text
height: 5798784
last_irreversible_block: 5798724
head_id: 0x122004ea6755233815716b0288ab5217daace74d034dded3e381f6b7e863caeac8d4
```

Running node process:

```text
node/teleno-node/build/teleno_node \
  --basedir /Volumes/external/teleno-testnet-producer/basedir \
  --config /Volumes/external/teleno-testnet-producer/basedir/config.yml
```

## Operational Lessons

- `backup.remote.directory` must be an absolute server path.
- Fresh testnet observers must use the live public testnet genesis from
  `testnet.koinosfoundation.org`; bundled example genesis files are not valid
  for this network.
- Native backups require unified chain storage. A fresh observer synced from
  genesis must be migrated with `--migrate-chain-db-to-unified-rocksdb` before
  the backup service will checkpoint it.
- The first restored startup correctly enables verify-blocks and disables block
  production, then lets the operator decide when production should be enabled.

## Follow-Up

The native CLI/scheduler/remote-restore path is validated at small live-testnet
scale. Remaining work before production UX exposure:

1. Add an automated smoke wrapper for this flow with a smaller private/local
   SFTP fixture for CI.
2. Wire the Teleno UX to the native admin/status endpoints for remote backup
   configuration and restore.
3. Run a larger testnet backup from a near-head unified basedir before using the
   same flow for a production migration walkthrough.
