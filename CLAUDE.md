# Teleno Project Memory

Teleno is the monolithic Koinos node desktop app. The active project memory is `AGENTS.md`; keep this file short so it does not conflict with Codex project instructions.

## Active Shape

- Desktop app: Electron + React + TypeScript in `electron/` and `src/`.
- Node runtime: monolithic `teleno_node`, currently built from `node/teleno-node`.
- Packaging: `scripts/stage-bundle.js` stages only Teleno node resources, config templates, and core contract ABIs.
- Compatibility evidence: `docs/compatibility/README.md` lists retained legacy-facing scripts and reports.

## Cleanup Rule

Legacy microservice build/start/operator material should not be reintroduced as active Teleno documentation or release tooling. Legacy references are acceptable only when they prove protocol parity, migration safety, client compatibility, or release-gate validation.
