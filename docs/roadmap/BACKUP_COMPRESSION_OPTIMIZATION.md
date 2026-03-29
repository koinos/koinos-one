# Backup Compression Optimization Plan

## Overview

The Knodel Electron app currently uses single-threaded `gzip` via `tar -czf` / `tar -xzf` for blockchain backup creation and restoration. With ~39 GB of uncompressed blockchain data (~24 GB compressed), these operations take a very long time on macOS because gzip cannot use multiple CPU cores. This plan introduces three optimization strategies, layered by priority, to dramatically reduce backup and restore times.

## Current Architecture

All backup logic lives in `electron/lib/backup-service.ts`, created via `createBackupService()`. Key functions:

- **`spawnTar(args, cwd, progressOpts)`** — Spawns `tar` directly via `child_process.spawn`, tracks the child process for cancellation support, and polls output file size for progress reporting.
- **`createLocalBackup(input, sender)`** — Builds args `['-czf', destPath, '-C', baseDir, 'chain', 'block_store', ...]` and passes them to `spawnTar`.
- **`extractBlockchainBackupDirectories()`** — Calls `runCommand('tar', ['-xzf', archivePath, ...])` for extraction.
- **`scanBlockchainBackupArchive()`** — Spawns `tar -tzf` for listing archive contents.

---

## Strategy 1: pigz (Parallel gzip) — Drop-in Replacement

### Rationale
pigz is a parallel implementation of gzip that uses all available CPU cores. On an M-series Mac with 8+ cores, this provides **2-4x speedup** with zero format change. Existing `.tar.gz` files remain fully compatible.

### Detection
- Add `resolveCompressionProgram()` helper using existing `findExecutableInPath('pigz')` from `platform.ts` (already searches `/opt/homebrew/bin`).
- Cache the result at module level inside `createBackupService` closure.
- If pigz not found, fallback to gzip silently.

### Changes Required

| File | Change |
|------|--------|
| `backup-service.ts` → `spawnTar()` | Accept optional `compressProgram` parameter. When provided, prepend `--use-compress-program=<program>` and replace `-czf` → `-cf`, `-xzf` → `-xf` (remove `-z` flag). |
| `backup-service.ts` → `createLocalBackup()` | If pigz available: `['--use-compress-program=pigz', '-cf', ...]` instead of `['-czf', ...]` |
| `backup-service.ts` → `extractBlockchainBackupDirectories()` | If pigz available: `['--use-compress-program=pigz', '-xf', ...]` instead of `['-xzf', ...]` |
| `backup-service.ts` → `scanBlockchainBackupArchive()` | If pigz available: `['--use-compress-program=pigz', '-tf', ...]` instead of `['-tzf', ...]` |

### Installation
The app should NOT auto-install pigz. Show an optional info banner in Backup settings suggesting `brew install pigz` for faster backups.

---

## Strategy 2: zstd Compression — Faster Format

### Rationale
zstd decompresses **3-5x faster** than gzip even single-threaded, and with `-T0` (all cores) it is dramatically faster for both directions. Tradeoff: new file format (`.tar.zst`), requiring backwards compatibility.

### Archive Format Detection
Add `detectArchiveFormat(filePath)` helper:
- `.tar.gz` / `.tgz` → `'gzip'`
- `.tar.zst` → `'zstd'`
- `.tar` → `'none'`

### Changes Required

| File | Change |
|------|--------|
| `main-types.ts` | Add `BackupCompressionMethod = 'gzip' \| 'zstd' \| 'none'` |
| `createLocalBackup()` | Save dialog offers `.tar.zst` when zstd available. Args: `['--use-compress-program=zstd -T0', '-cf', ...]` |
| `restoreFromLocalFile()` | Open dialog accepts `.tar.zst`, `.tar.gz`, `.tgz`, `.tar`. Routes to correct decompressor via `detectArchiveFormat()`. |
| `extractBlockchainBackupDirectories()` | For `.tar.zst`: `['--use-compress-program=zstd -d -T0', '-xf', ...]` |
| `scanBlockchainBackupArchive()` | For `.tar.zst`: `['--use-compress-program=zstd -d -T0', '-tf', ...]` |
| `normalizeBlockchainBackupArchiveUrl()` | Accept `.tar.zst` in addition to `.tar.gz` |
| Backup manifest | Add `compression: 'zstd'` field |

### Backwards Compatibility
- Old `.tar.gz` backups restore normally (format detected by extension).
- If `.tar.zst` backup exists but zstd not installed → friendly error suggesting `brew install zstd`.

---

## Strategy 3: Uncompressed Option

### Rationale
For users with ample disk space (~39 GB vs ~24 GB), skipping compression makes backup creation and restoration nearly I/O-bound only. **Near-instant** on fast SSDs.

### Settings UI
Add compression selector to `SettingsPanel.tsx` backup tab:
- **Standard (gzip)** — best compatibility, smallest file, slowest
- **Fast (zstd)** — fast compression/decompression, similar size (if zstd available)
- **None** — largest file, fastest create/restore

### Changes Required

| File | Change |
|------|--------|
| `main-types.ts` | Add `backupCompression?: BackupCompressionMethod` to `KoinosNodeSettings` |
| `knodel-electron.d.ts` | Mirror `backupCompression` in renderer-side types |
| `SettingsPanel.tsx` | Compression dropdown in backup tab |
| `createLocalBackup()` | Read compression preference, adjust args and default filename extension |
| Progress messages | "Comprimiendo" → "Archivando" when `none` |
| Disk space estimates | `sourceSizeBytes * 0.7` for gzip/zstd, `sourceSizeBytes * 1.05` for none |

---

## Implementation Sequence

### Phase 1: Internal Refactoring
1. Add `resolveCompressionProgram()` and `detectArchiveFormat()` helpers.
2. Refactor `spawnTar()` to accept `compressProgram` parameter.
3. Extract tar argument construction into a helper `buildTarArgs()`.

### Phase 2: pigz Integration
1. Wire `resolveCompressionProgram()` into all tar call sites.
2. No UI changes — pigz is auto-detected.
3. Test: create/restore with pigz, restore pigz backup without pigz (same format).

### Phase 3: zstd Support
1. Add `BackupCompressionMethod` type.
2. Update dialogs and URL validation for `.tar.zst`.
3. Add `compression` field to backup manifest.
4. Test: create/restore zstd, restore old gzip with zstd available.

### Phase 4: Uncompressed Option + Settings UI
1. Add `backupCompression` to settings types.
2. Add compression selector to SettingsPanel.
3. Wire through `createLocalBackup()`.
4. Adjust estimates and messages.

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| pigz/zstd not installed | Graceful fallback to gzip; info banner suggesting installation |
| `--use-compress-program` not supported on Windows bsdtar | Skip on Windows (line 770-772 already uses `System32\tar.exe`); use gzip only |
| User renames `.tar.zst` → `.tar.gz` | tar fails with clear format error; future: magic-byte check |
| Cancel with `--use-compress-program` | tar spawns pigz/zstd as child; `SIGTERM` propagates. Verify process group kill if needed (`detached: true` + `process.kill(-child.pid)`) |
| Disk space estimation for zstd | zstd default level ≈ gzip size; existing 70% margin sufficient |

---

## Expected Performance (Apple Silicon M-series, ~39 GB data)

| Method | Create Time | Restore Time | File Size |
|--------|------------|--------------|-----------|
| gzip (current) | ~25 min | ~20 min | ~24 GB |
| pigz | ~8 min | ~7 min | ~24 GB |
| zstd -T0 | ~5 min | ~4 min | ~24 GB |
| none | ~2 min | ~1 min | ~39 GB |

*Times are estimates based on typical compression benchmarks for database-like data on NVMe SSDs.*

---

## Files to Modify

1. `electron/lib/backup-service.ts` — Primary file: compression helpers, all tar operations
2. `electron/lib/main-types.ts` — `BackupCompressionMethod` type, settings field
3. `src/knodel-electron.d.ts` — Mirror settings in renderer types
4. `src/components/panels/SettingsPanel.tsx` — Compression selector UI
5. `electron/lib/platform.ts` — No changes needed (`findExecutableInPath` already works)
