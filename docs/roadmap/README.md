# Historical Roadmap And Validation Reports

The active documentation entrypoint is now `../README.md`.

This directory keeps long-running roadmap records and validation reports that
are still useful as historical release evidence. It is no longer the primary
place for current implementation docs or backlog planning.

## Current Implementation

- `../current/README.md` - current implementation index.
- `../current/monolith/CURRENT_MONOLITH_STATUS.md` - detailed current status.
- `../current/monolith/SERVICE_COVERAGE.md` - service coverage and known parity
  limits.
- `../current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md` - current
  native backup implementation.
- `../current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md` - current public
  bootstrap restore implementation.

## Backlog

- `../backlog/README.md` - missing work and new ideas.
- `../backlog/backup-restore/` - remaining backup and bootstrap work.
- `../backlog/producer/` - producer wallet and fleet ideas.
- `../backlog/storage/` - unified RocksDB migration follow-up.

## Legacy And Compatibility

- `../legacy/README.md` - legacy boundary.
- `../legacy/compatibility/README.md` - retained compatibility evidence map.

## Archived Implementation Plans

- `../archive/implementation-plans/README.md` - old implementation plans that
  should not be treated as current work instructions.

## Reports Retained Here

- `monolith/core/MONOLITH_PRODUCTION_PLAN.md` - historical production roadmap and
  long-running validation record.
- `monolith/core/MONOLITH_JSONRPC_PARITY_REPORT.md` - JSON-RPC parity report.
- `monolith/networking/` - networking, P2P, soak, and mainnet canary reports.
- `monolith/testnets/` - private and external testnet validation reports.
- `monolith/storage/` - unified RocksDB validation reports.
- `monolith/backup-restore/` - backup and restore validation reports plus
  compatibility stubs for moved current docs.
