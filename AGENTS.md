# Teleno Codex Project Memory

Last updated: 2026-06-24

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

## GUI Copy Consistency Guardrail

When updating or adding a user-facing feature, verify that the visible GUI
text, labels, descriptions, empty states, status messages, and documentation in
the affected screen still match the implemented behavior. Do this as part of
the same change, especially when a feature gains a new source of truth,
fallback path, safety behavior, or operational mode.

Any GUI text added or changed must be represented in `src/i18n.ts` for both
English and Spanish. Keep each locale internally consistent: do not leave
hybrid messages that mix English and Spanish terms when a clear translated
equivalent exists.

## GUI Visual Consistency Guardrail

When modifying or adding GUI surfaces, preserve the existing visual language of
the application. Match the surrounding panel hierarchy, spacing, typography,
border radius, contrast, color palette, and control style before introducing a
new component treatment.

Do not add isolated dark cards, marketing-style panels, oversized typography,
or visually heavy blocks inside operational settings screens unless the
surrounding screen already uses that treatment. New GUI elements must look like
they belong to the same Settings, Node, Backup, Wallet, or Producer surface
where they appear.

Before considering a GUI change complete, inspect the affected screen in the
running app or with a screenshot and verify that text remains readable, labels
and values do not clash, the layout works at the expected window size, and the
new UI does not draw more attention than the feature warrants.

## Versioning And Build Identity Guardrail

Every packaged Koinos One app build must have a traceable build identity:
product version, build timestamp, Git commit, release channel, and native node
build identity. Use SemVer for product versions and unique build metadata for
every packaged canary, beta, or stable build.

When changing user-facing functionality, update changelog or release notes as
appropriate, and ensure the GUI About/Build Info surface can show the exact
version and commit included in the build.

## Mainnet Safety Guardrails

- Protected mainnet producer addresses are private local project memory. If
  `AGENTS.local.md` exists, read it before any producer, wallet, or chain-
  mutating mainnet work. `AGENTS.local.md` is intentionally ignored by Git and
  must never be committed or quoted in public documentation.
- Live server inventory is private local project memory. If
  `docs/current/operations/SERVER_INVENTORY.md` exists, treat it as local-only,
  read it for host context when needed, and never commit, quote, or summarize
  its confidential hostnames, IPs, users, workloads, or resource details into
  public files.
- Public docs, tests, GUI placeholders, and committed code must use generic
  placeholders such as `<YOUR_MAINNET_PRODUCER_ADDRESS>` instead of real local
  producer addresses.
- Do not perform hidden or background mainnet mutations.
- Do not transfer funds away from a protected local mainnet producer address.
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

- Live hostnames, IPs, SSH users, workloads, and reachability notes are
  private local project memory. Read local-only inventory files when needed,
  but do not commit or quote those details into public files.
- Some local hosts may run legacy prod Koinos services and separate
  observer-only deployments. Check local inventory and current service paths
  before touching any server.
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
