# Repository Tour

Koinos One combines a desktop app, an Electron native runtime layer, a native
monolithic Koinos node, packaging scripts, validation scripts, and manual
documentation.

## Active Project Boundary

Koinos One owns the desktop app, release packaging, native backup and restore,
first-run setup, and the `teleno_node` monolith. Treat the repository root as
the active workspace for these areas.

Do not edit, build, launch, or commit Knodel or legacy microservice work unless
the user explicitly asks for it. Legacy material is retained only when it proves
protocol parity, migration safety, or validation evidence.

## Top-Level Areas

| Path | Purpose |
| --- | --- |
| [`src/`](https://github.com/koinos/koinos-one/tree/main/src) | React renderer, app state, i18n, styles, and GUI panels. |
| [`electron/`](https://github.com/koinos/koinos-one/tree/main/electron) | Electron main process, preload bridge, IPC handlers, native runtime services, wallet services, and local storage helpers. |
| [`node/teleno-node/`](https://github.com/koinos/teleno) | Native node git submodule. The `teleno_node` C++ source, tests, CMake projects, native build scripts, and network/bootstrap config templates live in the [koinos/teleno](https://github.com/koinos/teleno) repository. |
| [`scripts/`](https://github.com/koinos/koinos-one/tree/main/scripts) | Build wrapper, staging, smoke, benchmark, migration, parity, and validation scripts. |
| [`tests/`](https://github.com/koinos/koinos-one/tree/main/tests) | Vitest, Playwright, package, promotion, and UI validation tests. |
| [`docs/current/`](https://github.com/koinos/koinos-one/tree/main/docs/current) | Current implementation source of truth. |
| [`docs/backlog/`](https://github.com/koinos/koinos-one/tree/main/docs/backlog) | Planned or missing work that is not fully implemented or approved. |
| [Manual](../README.md) | User-facing and contributor-facing manual. |
| [`docs/legacy/`](https://github.com/koinos/koinos-one/tree/main/docs/legacy) | Compatibility evidence for old microservice behavior. |

## Common Development Entry Points

- [`AGENTS.md`](https://github.com/koinos/koinos-one/blob/main/AGENTS.md)
  - project guardrails, GUI copy rules, GUI visual rules, mainnet
  safety, and recovery safety.
- [`docs/current/README.md`](https://github.com/koinos/koinos-one/blob/main/docs/current/README.md)
  - entrypoint before changing architecture, backup,
  storage, producer, or release behavior.
- [`docs/backlog/README.md`](https://github.com/koinos/koinos-one/blob/main/docs/backlog/README.md)
  - missing work and deferred ideas; read it before
  claiming complete service parity.
- [`package.json`](https://github.com/koinos/koinos-one/blob/main/package.json)
  - supported app build, test, docs, and packaging commands.
- [`node/teleno-node/src/CMakeLists.txt`](https://github.com/koinos/teleno/blob/main/src/CMakeLists.txt)
  - native library and executable target
  boundaries.
- [`mkdocs.yml`](https://github.com/koinos/koinos-one/blob/main/mkdocs.yml)
  - manual site configuration and navigation.

## Source Of Truth Rules

Implementation docs under
[`docs/current/`](https://github.com/koinos/koinos-one/tree/main/docs/current)
describe what exists now. Backlog docs describe missing work or future ideas.
Archive docs are historical and must not be treated as current instructions.

Developer manual pages should summarize and route contributors to the right
source. They should not duplicate long validation transcripts or private local
operational details.

## Generated Outputs

Common generated outputs are intentionally not the source of truth:

- `dist/` - Vite renderer build.
- `dist-electron/` - Electron main process build.
- `build/docs/manual-site/` - MkDocs static manual output.
- `node/teleno-node/build/` - CMake build tree for native targets.
- packaged application artifacts under Electron Builder output directories.

Regenerate these outputs from source commands instead of editing them by hand.
