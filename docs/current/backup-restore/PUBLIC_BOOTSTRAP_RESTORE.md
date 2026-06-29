# Public Bootstrap Restore Implementation

- Date: 2026-06-20
- Scope: Mac `teleno_node` CLI, Linux/Docker `teleno_node`, local admin API, and Teleno UX
- Status: CLI/admin API/UX integration completed; signed testnet public snapshot validated end-to-end; HTTPS prodnet public snapshot restored into a Dockerized observer on VPS1

## Goal

Let a first-time Teleno node operator restore a network database from a public, read-only backup repository without entering an SSH user, SSH key, or password.

This is intentionally separate from authenticated remote backup creation:

- `backup.remote` remains the operator-owned SFTP upload target for creating private remote backups.
- `backup.public-restore` is the read-only bootstrap source used by new installations.
- Publishing or maintaining the public bootstrap repository is a maintainer
  release workflow. It should not be presented as a normal operator backup
  feature in simple UX.

The current implementation covers the Mac CLI flow, Linux/Docker CLI flow, local backup admin API orchestration, Teleno UX restore/list integration, and Ed25519 signed-manifest verification for the published testnet bootstrap snapshot. Prodnet bootstrap restore has also been validated from the public HTTPS repository into an observer-only Docker node on VPS1. Prodnet signature enforcement remains follow-up work; the current prodnet acceptance relies on HTTPS origin validation plus per-object SHA-256 verification.

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
- `latest.json` includes `signature: snapshots/20260617T215046Z-ms-1781733046440-files-72/public-bootstrap-signature.json`.
- CORS headers are present for public GET/HEAD access.
- The published repository contains 75 content-addressed objects and 3.11 GB of backup payload.

Pinned testnet verification key:

```text
config/public-bootstrap/testnet-ed25519.pub
```

Public key SHA-256 over SPKI DER:

```text
b8a4c7573eea54c86a4ed2649b0de525dd7bd21bcdbd8e99eef0c629e4ab7c00
```

Prodnet public bootstrap repository:

```text
https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap
```

Validated prodnet public snapshot:

```text
20260620T201059Z-ms-1781986259826-files-452
```

Validated prodnet metadata:

- `latest.json` is reachable over HTTPS.
- The validated snapshot metadata reports `network: mainnet`.
- The snapshot contains 455 content-addressed objects and about 26.96 GB of backup payload.
- The prodnet snapshot has been restored on VPS1 `<VPS1_PUBLIC_IP>` into a Dockerized observer basedir at `<VPS1_PRODNET_OBSERVER_BASEDIR>`.
- The restored VPS1 observer starts with block production disabled and publishes P2P on port `18889`; JSON-RPC is bound to localhost on port `18080`.
- Current prodnet snapshot publication is unsigned from the client perspective: `signature_required=false` and `signature_verified=false`. Prodnet signing is still tracked as follow-up hardening.

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
    signature-required: true
    signature-public-key-file: /path/to/config/public-bootstrap/testnet-ed25519.pub
```

Parsed fields:

- `backup.public-restore.enabled`
- `backup.public-restore.base-url`
- `backup.public-restore.network`
- `backup.public-restore.require-https`
- `backup.public-restore.timeout-seconds`
- `backup.public-restore.retries`
- `backup.public-restore.signature-required`
- `backup.public-restore.signature-public-key-file`

The config test suite now covers parsing of this section.

Teleno UX-generated testnet native backup configs now set
`signature-required: true` when the bundled testnet verification key exists.
Teleno UX-generated mainnet configs enable the standard prodnet public
bootstrap source without signature enforcement until prodnet signing is
completed. Custom networks keep public restore disabled.

## Public Repository Format

The public repository serves the same content-addressed native backup layout over HTTP(S):

```text
<public-base-url>/
  latest.json
  snapshots/
    <backup-id>/
      manifest.json
      files.json
      public-bootstrap.json
      public-bootstrap-signature.json   # optional
      COMPLETE
  objects/
    sha256/
      <aa>/
        <bb>/
          <sha256>
```

The client only needs ordinary `GET` requests. Static HTTP directory enumeration is not required.

Public metadata now carries operator-facing provenance fields in both the public `manifest.json` and `public-bootstrap.json`:

- network;
- chain ID when present in the source manifest;
- public base URL;
- promotion time;
- source backup ID;
- source created time;
- source node ID and node version;
- source storage layout;
- source head and LIB height when present in the source manifest;
- restore-space byte estimates split by database, runtime files, object download bytes, minimum free space, and recommended free space;
- sanitized config SHA-256 and size;
- explicit `producer_mode: false`.

The native snapshot list JSON exposes these fields for public bootstrap snapshots so CLI, local admin API, and Teleno UX can show provenance without reading raw metadata files.

## Restore Flow

`--backup-public-restore` currently performs this flow:

1. Resolve the public base URL from CLI override or config.
2. Resolve `latest.json` or the requested exact `--backup-id`.
3. Download metadata first: `manifest.json`, `files.json`, and `COMPLETE`.
4. Validate manifest format, backup ID, file inventory, sizes, and SHA-256 object references.
5. When configured, download `public-bootstrap.json` and `public-bootstrap-signature.json`, verify the Ed25519 signature, and verify the signed hashes for `latest.json`, `manifest.json`, `files.json`, and public metadata.
6. Run disk-space preflight before staging.
7. Download only missing content-addressed objects into the local native backup repository.
8. Verify every downloaded object by size and SHA-256.
9. Run existing native restore preflight.
10. Stage restored files into the existing restore staging path.
11. Activate restore through the existing stopped-node restore activation path.
12. Write an observer-safe config if the target config file does not already exist.

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
- Optional Ed25519 signature verification covers the selected backup ID, network, chain ID, `latest.json`, `manifest.json`, `files.json`, public metadata, object count, and total bytes.
- Signature verification is enforced when `backup.public-restore.signature-required=true`. It is also attempted when a `signature-public-key-file` is configured, but unsigned repositories can still be used only when signature-required is false.

The implementation does not shell out to `curl`, `scp`, `rsync`, or `ssh`.

### Why HTTPS Remains Required

Public bootstrap restore uses a public, unauthenticated repository. That is intentional: first-time node operators should be able to download a bootstrap DB without SSH credentials. Because there is no login step, the restore path must get origin authentication and transport integrity from HTTPS, then get repository integrity from the signed metadata envelope and object SHA-256 checks.

The production default is therefore:

- HTTPS required for public network sources;
- Ed25519 signature required for published bootstrap metadata;
- SHA-256 verification required for every content-addressed object;
- `file://` allowed for deterministic local tests;
- plain `http://` only allowed when `require-https: false`, which is a developer/test override and not a user default.

If plain HTTP were accepted for normal public bootstrap, the following risks remain even with signed manifests:

- A network attacker could replay an older signed `latest.json` and make a new node restore an outdated but still validly signed snapshot. Signatures prove that Teleno signed the payload; HTTPS helps prove the client received the current response from the intended server.
- If signature enforcement were disabled, misconfigured, or temporarily bypassed during development, an attacker controlling the HTTP path could replace metadata and point the client at attacker-selected objects. Object hashes help only when the trusted metadata is also protected.
- Captive portals, proxies, routers, ISPs, or compromised Wi-Fi could inject redirects, HTML login pages, partial content, or corrupted files. The best case is a failed restore; the worse operational outcome is wasted bandwidth, confusing errors, or a bootstrap process that looks unreliable to a new operator.
- DNS or local-network interception could silently point a first-install node at a fake bootstrap origin. HTTPS certificate validation blocks that class of fake-origin response.
- Allowing insecure transport in the first-install path trains operators and tooling to accept weaker bootstrap practices. That is especially dangerous for prodnet bootstrap because first-run operators may not have any independent local chain state yet.

The signed manifest and object hashes are still necessary because HTTPS alone only protects the connection to the server; it does not prove that the published repository content is a Teleno-approved bootstrap snapshot. Conversely, signatures and hashes do not fully replace HTTPS because they do not, by themselves, provide freshness, origin authentication, or protection from network-level interference. The intended trust model is layered: HTTPS for server origin and transport integrity, Ed25519 for Teleno publication authorization, and SHA-256 for object integrity.

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

Restore a prodnet observer with Docker:

```bash
docker run --rm \
  -v "$HOME/teleno-prodnet-observer/basedir:/data" \
  ghcr.io/pgarciagon/teleno-node:beta \
  --basedir /data \
  --config /data/config.yml \
  --backup-public-restore \
  --backup-public-url https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap \
  --backup-id latest \
  --backup-json
```

Start the restored prodnet observer with Docker:

```bash
docker run -d --name teleno-prodnet-observer \
  --restart unless-stopped \
  -v "$HOME/teleno-prodnet-observer/basedir:/data" \
  -p 127.0.0.1:18080:18080 \
  -p 18889:18889 \
  ghcr.io/pgarciagon/teleno-node:beta \
  --basedir /data \
  --config /data/config.yml \
  --disable block_producer grpc contract_meta_store transaction_store account_history
```

## Validation Completed

Build:

```bash
cmake --build node/teleno-node/build --target teleno_node koinos_config_test koinos_backup_public_restore_test koinos_backup_snapshot_test koinos_backup_admin_server_test --parallel
```

Tests:

```bash
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_(config|backup_public_restore|backup_snapshot|backup_admin_server)_test'
```

Result:

```text
100% tests passed, 0 tests failed out of 4
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
6 promotion unit tests passed.
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
- Signed testnet publication completed with key ID `teleno-testnet-bootstrap-20260620`.
- `--backup-public-list` over HTTPS passed with `signature-required: true` and the pinned `config/public-bootstrap/testnet-ed25519.pub` verification key.
- Linux validation on Ubuntu node `<LOCAL_LINUX_HOST>` passed after adding the Ubuntu CA bundle path `/etc/ssl/certs/ca-certificates.crt` to the HTTPS loader:
  - `--backup-public-list` over HTTPS passed with `signature-required: true`;
  - `--backup-public-restore` downloaded 75 objects, `3,113,463,513` bytes, with `retry_count: 0`, `signature_required: true`, and `signature_verified: true`;
  - restore activation wrote `.backup-just-restored`;
  - a DB-open smoke started from the restored basedir, opened RocksDB with 9 column families, indexed 60 blocks, and reached `[node] teleno_node ready`;
  - temporary Linux restore data was removed after validation.
- Longer Linux observer acceptance from a signed public snapshot passed on 2026-06-20:
  - restored snapshot `20260617T215046Z-ms-1781733046440-files-72` from the public HTTPS route with `signature_verified: true`;
  - started as a testnet observer from `/tmp/teleno-linux-observer-acceptance/basedir` with `features.block_producer: false` and `chain.verify-blocks: true`;
  - opened RocksDB with 9 column families and reached `[node] teleno_node ready`;
  - collected 20 JSON-RPC `chain.get_head_info` samples over roughly 10 minutes;
  - advanced from height `5893626` to `5905541`, a delta of `11915` blocks;
  - logged connected peer snapshots every 60 seconds against `testnet.koinosfoundation.org`;
  - a single initial block-application warning at height `5893622` was observed, then sync continued normally and no repeated mismatch/stall occurred;
  - the restored basedir secret scan found no wallet, private key, password, passphrase, PEM/P12/PFX, or admin-token files;
  - SIGINT shutdown completed cleanly.
- Admin API public restore routes are covered by `koinos_backup_admin_server_test`.
- Teleno UX exposes public bootstrap snapshots separately from local and private SFTP backups in Node > Backups.
- Prodnet Docker restore on VPS1 `<VPS1_PUBLIC_IP>` passed on 2026-06-21:
  - listed `https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap` and selected snapshot `20260620T201059Z-ms-1781986259826-files-452`;
  - preflight passed with enough disk space on the 150 GB root filesystem;
  - restored 455 objects into `<VPS1_PRODNET_OBSERVER_BASEDIR>`;
  - restore activation completed with `ok: true` and `start_as_observer_first: true`;
  - started `ghcr.io/pgarciagon/teleno-node:beta` as container `teleno-prodnet-observer` with restart policy `unless-stopped`;
  - opened RocksDB with 9 column families, reached `[node] teleno_node ready`, connected to prodnet peers, and began catch-up from the restored head;
  - JSON-RPC `chain.get_head_info` returned head height `36976616` during catch-up, confirming the restored observer is serving local RPC while syncing.

## Current Limitations

- The current signed publication is testnet-only.
- Prodnet public bootstrap restore is operational over HTTPS, but prodnet signature enforcement is not enabled yet.
- The private signing key is intentionally outside the repo at `~/.teleno/public-bootstrap-signing/testnet-ed25519.pem` on the publishing Mac; only the public verification key is committed.

## Remaining Work

The detailed remaining implementation plan is tracked in `../../backlog/backup-restore/PUBLIC_BOOTSTRAP_RESTORE_REMAINING_WORK_PLAN.md`.

There is no remaining testnet implementation work for the signed public bootstrap restore path. Prodnet public bootstrap restore is operational for observer-first bootstrap, and the remaining prodnet hardening work is to add the same signed-publication enforcement used by testnet.

## Acceptance Criteria

- No SSH user, key, password, or known-hosts file is required.
- The CLI fails before large downloads when disk space is insufficient.
- Hash mismatch aborts the restore.
- The restored node starts as an observer first for the selected network.
- Block production remains disabled after restore.
- The existing private SFTP backup create/upload path is unchanged.
