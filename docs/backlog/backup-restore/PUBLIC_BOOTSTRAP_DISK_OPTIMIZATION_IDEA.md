# Public Bootstrap Disk Optimization Idea

- Date: 2026-06-21
- Scope: future optimization for first-install public bootstrap restore on low-cost VPS hosts
- Status: idea / implementation backlog

## Problem

The current public bootstrap restore flow is safe but disk-heavy. A prodnet
restore on VPS1 showed this layout after a successful restore:

```text
26G  basedir/db
26G  basedir/.teleno-native-backups/repository/objects
51G  basedir
```

The live RocksDB is the expected size, about 26 GB. The extra 26 GB is the
downloaded public bootstrap object repository that was retained after restore.

That is useful for audit, retry, and local restore reuse, but it doubles the
disk required for a first-time observer install. For low-cost VPS deployment,
the operator usually wants the restored live database, not a retained copy of
the public backup objects.

## Goal

Reduce the minimum local disk required to bootstrap a prodnet observer from a
public backup, without weakening restore safety.

The target first-install flow should require approximately:

```text
live DB size + small metadata + one temporary download file
```

instead of:

```text
live DB size + full public object repository
```

For the current prodnet snapshot size, that means moving from roughly 51 GB
final basedir usage to roughly 26-30 GB final basedir usage.

## Proposed Restore Modes

### 1. Retain Repository

This is the current behavior.

```text
download public objects -> verify -> stage restore -> activate DB -> keep objects
```

Properties:

- safest for audit and retry;
- supports local re-restore without downloading again;
- highest disk usage;
- good default for Mac/external-drive users with enough space.

Suggested CLI/config naming:

```text
--backup-public-retain-repository=true
```

### 2. Restore And Prune

This is the lowest-risk first improvement.

```text
download public objects -> verify -> stage restore -> activate DB -> delete public object cache
```

Properties:

- uses the existing restore implementation;
- reduces final disk use after successful activation;
- does not reduce peak disk use during restore;
- useful when the server can temporarily fit both copies but should not keep
  both copies long term.

Suggested CLI/config naming:

```text
--backup-public-retain-repository=false
```

or:

```text
--backup-public-prune-after-restore
```

The command should delete only public-restore cache objects that are not needed
by configured private/local backup repositories. It must not delete operator
backups created through private SFTP or local native backup workflows.

### 3. Streaming Public Restore

This is the real disk-minimizing mode for first-install VPS deployments.

```text
read manifest
download each object directly into restore staging
hash verify while streaming
fsync completed files
activate staged DB
remove temporary metadata/cache
```

Properties:

- lowest peak and final disk usage;
- best fit for low-cost VPS bootstrap;
- does not retain a reusable local backup repository;
- requires careful implementation because the restore code can no longer assume
  that every object exists in the local native repository before staging.

Suggested CLI/config naming:

```text
--backup-public-stream-restore
```

or:

```text
backup:
  public-restore:
    mode: streaming
```

## Safety Rules

Streaming public restore should initially be limited to first-install or
stopped-node flows.

Required guardrails:

- Refuse streaming restore when the live node has an open RocksDB.
- Prefer an empty target basedir for the first implementation.
- If the target basedir is not empty, require an explicit `--backup-restore-force`
  style confirmation and move existing DB state to `.pre-restore` before
  activation.
- Never overwrite `config.yml` during activation. Continue writing restored
  config to `.teleno-restored-config.yml`.
- Verify SHA-256 for every streamed object before it is accepted.
- Verify public metadata/signature before downloading large objects when
  signature enforcement is configured.
- Activate only after all files in the staged DB have been fully written,
  verified, and fsynced.
- On failure, leave the previous live DB untouched and make the partial staging
  directory clearly removable.
- Keep restored nodes observer-first, with block production disabled.

## Implementation Outline

### Phase 1: Restore And Prune

Add a retain/prune option to the existing public restore path.

Implementation tasks:

- Add CLI/config parsing for retaining or pruning the public restore repository.
- After successful restore activation, delete only the public restore object
  cache and public restore metadata for the selected backup.
- Leave snapshot metadata or a small restore receipt if useful for audit:
  backup ID, source URL, byte count, object count, network, restore time, and
  verification status.
- Add a dry-run/log line showing expected reclaimable bytes before pruning.
- Add tests that prove private/local backup repositories are not pruned.

This phase reduces final disk usage but not peak disk usage.

### Phase 2: Streaming Staging Adapter

Add an object provider abstraction so restore staging can read from either:

- the local native backup repository;
- a public HTTP(S) object source;
- a streaming file writer that verifies content while downloading.

Implementation tasks:

- Define an interface such as `BackupObjectProvider`.
- Keep the existing repository-backed provider for current restore behavior.
- Add a public HTTP(S) streaming provider.
- Stream each manifest file into the restore staging path.
- Verify each object hash and size before marking a staged file complete.
- Preserve existing restore preflight output, but make it report streaming peak
  disk requirements separately from repository-backed requirements.

### Phase 3: First-Install Streaming CLI

Expose streaming restore as a specific first-install operator command.

Example:

```bash
teleno_node \
  --basedir /data \
  --config /data/config.yml \
  --backup-public-restore \
  --backup-public-url https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap \
  --backup-public-mode streaming \
  --backup-id latest \
  --backup-json
```

The JSON output should include:

```text
mode: streaming
repository_retained: false
peak_required_bytes
final_expected_bytes
downloaded_bytes
verified_bytes
staged_bytes
```

### Phase 4: UX And Docker Documentation

Update the first-run and Docker paths:

- Default low-cost VPS docs to streaming public restore once validated.
- Show a clear UX choice:
  - "Fast restore, keep local backup copy"
  - "Low disk restore, do not keep backup copy"
- Keep the observer-first warning.
- Show peak disk and final disk estimates before restore.

## Disk-Space Preflight Changes

Current preflight should continue to report repository-backed requirements.
Streaming mode needs separate estimates:

```text
repository-backed peak = live DB + object repository + staging overhead
restore-and-prune peak = live DB + object repository + staging overhead
restore-and-prune final = live DB + metadata
streaming peak = staged DB + one in-flight object + metadata
streaming final = live DB + metadata
```

The operator-facing output should avoid one ambiguous "required space" number.
It should show both peak required space and expected final disk use.

## Acceptance Criteria

- Restore-and-prune reclaims the public object repository after successful
  activation and never deletes private/local backups.
- Streaming restore can restore a public testnet snapshot into an empty basedir
  without writing a full local object repository.
- Streaming restore can restore a prodnet observer snapshot on a VPS with much
  less free disk than the current repository-backed flow.
- A failed streaming restore leaves no partial live DB replacement.
- Restored nodes still start as observers and keep block production disabled.
- Tests cover interrupted download, hash mismatch, insufficient disk, non-empty
  basedir refusal, and successful restore.

## Cost-Reduction Hypothesis

If streaming public restore is implemented and validated, prodnet observer
servers can likely be sized around:

```text
2 vCPU
4 GB RAM
80-100 GB SSD/NVMe-class disk
```

The disk lower bound still needs real soak validation. The current 51 GB basedir
result should not be used as a permanent requirement because it includes a
retained public backup object cache.
