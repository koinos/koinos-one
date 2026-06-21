# Teleno Codex Project Memory

Last updated: 2026-06-21

This file is intentionally short. It is operational memory for Codex sessions,
not the full project history. Long benchmark results, sprint logs, validation
transcripts, and implementation plans belong in `docs/`.

The previous long project-memory file is archived at:

```text
docs/archive/AGENTS_FULL_20260621.md
```

## Active Project Boundary

- Active repository: `/Users/pgarcgo/code/teleno`
- Active remote: `https://github.com/pgarciagon/teleno.git`
- Active branch for the current release track: `main`
- Product name: Koinos One.
- Native runtime: `teleno_node`.
- `Teleno` owns the monolithic Koinos node app, release packaging, native backup
  and restore, first-run setup, and monolith validation.
- `Knodel` is the separate legacy/microservice app. Do not edit, build, launch,
  or commit Knodel/microservice work unless the user explicitly asks for it.
- If a resumed session starts in `/Users/pgarcgo/code/knodel` or another stale
  repo, switch to `/Users/pgarcgo/code/teleno` before monolith work.

## Documentation Map

- Documentation entrypoint: `docs/README.md`
- Current implementation: `docs/current/README.md`
- Current monolith status: `docs/current/monolith/CURRENT_MONOLITH_STATUS.md`
- Current service coverage and parity gaps:
  `docs/current/monolith/SERVICE_COVERAGE.md`
- Current backup implementation:
  `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- Public bootstrap restore:
  `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- Missing work and documented ideas: `docs/backlog/README.md`
- Legacy compatibility evidence: `docs/legacy/compatibility/README.md`
- Historical validation reports: `docs/roadmap/README.md`
- Archived implementation plans: `docs/archive/implementation-plans/README.md`

Read the relevant current/backlog doc before making broad architectural,
backup, producer, storage, or release decisions.

## Project Mission

Build an optimized monolithic Koinos block-producing node app that is easy for
end users to launch and operate. The current primary target is macOS; Windows
optimization follows later. Implementation decisions must preserve Koinos
protocol compatibility and avoid shortcuts that diverge from mainnet behavior.

All project documentation must be written in English, even when discussion with
the user happens in Spanish.

## Mainnet Safety Guardrails

- Address `14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb` is a real funded mainnet
  producer address.
- Do not perform hidden or background mainnet mutations.
- Do not transfer funds away from this address.
- Treat mainnet producer registration, VHP burns, producer setup changes,
  default-account changes, config writes targeting a producer, or any
  transaction signing/submission as high-risk work requiring a fresh explicit
  user request, clear target network/address confirmation, and a dry-run or
  reviewable plan first.
- Before any chain-mutating operation, verify the selected network, signer,
  target address, and operation type.

## Recovery Guardrail

If the monolith reports `block previous state merkle mismatch` or another
persistent state merkle mismatch:

- Do not clear `chain/blockchain`.
- Do not start from an empty state DB as the first action.
- Do not force a fresh full resync as the first action.
- Preserve the existing state DB.
- Only consider deleting/moving state after explicit user approval and evidence
  that validation-based recovery failed.

## Current Operational Cautions

- LAN Linux host `192.168.178.188` runs a legacy prod Koinos node. Be careful
  not to disturb it.
- Teleno has also been deployed on that host as an observer-only service using
  separate data paths and ports. Check current service paths/status before
  touching anything on the server.
- Public bootstrap and native backup behavior changes must stay local-admin
  only unless explicitly scoped otherwise. Public bootstrap means public
  read-only backup source, not public admin API exposure.
- Restored nodes should start as observers first. Enable block production only
  after database health, network, producer address, VHP, and producer-key checks
  pass.
- Account history is not full legacy parity yet. Check
  `docs/current/monolith/SERVICE_COVERAGE.md` and `docs/backlog/README.md`
  before claiming complete legacy-service coverage.

## Legacy Boundary

- Old GarageMQ, microservice build/start, packaging, and operator docs are not
  part of the active Koinos One command surface.
- Retain or add legacy material only when it proves protocol parity, client
  compatibility, migration/restore safety, or a release-gate validation result.
- Compatibility evidence lives in `docs/legacy/compatibility/README.md`.

## Useful Commands

```bash
npm run dev
npm run build
cmake --build node/teleno-node/build --target teleno_node --parallel
ctest --test-dir node/teleno-node/build --output-on-failure
```

For backup, restore, public bootstrap, packaging, or live validation commands,
use the relevant current/backlog docs instead of expanding this file.
