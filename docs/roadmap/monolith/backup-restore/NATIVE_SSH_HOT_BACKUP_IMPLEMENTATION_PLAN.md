# Native SSH Hot Backup Implementation Plan

Status: superseded.

This document was the detailed planning source for moving backup and restore ownership from Electron into the native `teleno_node` binary, including native `libssh` SFTP, restore staging, admin control, and scheduler design.

Use these active documents instead:

- `README.md` for the backup documentation index.
- `NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md` for the implemented native CLI, scheduler, admin API, restore, SFTP, and UX state.
- `NATIVE_BACKUP_REMAINING_WORK_PLAN.md` for the remaining work.
- `NATIVE_LIBSSH_TESTNET_VALIDATION_20260614.md` for live-testnet validation evidence.

Historical note: this plan is retained only to preserve the original design trail. It should not be used as the current implementation checklist.
