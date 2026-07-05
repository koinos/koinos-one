# Contributing To Koinos One

Koinos One combines a desktop app, Electron runtime services, the native
`teleno_node` runtime, packaging, validation scripts, and user-facing
documentation. Keep changes scoped to the active Koinos One repository unless a
maintainer explicitly asks for legacy or external work.

## Before You Start

- Read `README.md` for the current product boundary and common commands.
- Read `docs/README.md` before changing implementation, backlog, legacy, or
  manual documentation.
- Read `docs/manual/developers/repository-tour.md` before broad structural
  changes.
- Do not edit, build, launch, or commit Knodel or legacy microservice work
  unless the issue or maintainer request explicitly scopes that work.

## Development Setup

```bash
git clone --recurse-submodules git@github.com:koinos/koinos-one.git
cd koinos-one
npm ci
npm run dev
```

If the repository was cloned without submodules, run:

```bash
npm run submodules:init
```

## Pull Request Expectations

- Keep each pull request focused on one feature, fix, or documentation update.
- Update visible GUI copy in `src/i18n.ts` for both English and Spanish.
- Keep all project documentation in English.
- Update `CHANGELOG.md` and the rendered manual changelog when a user-facing
  change warrants release notes.
- Do not commit generated outputs such as `dist/`, `dist-electron/`, `build/`,
  `release/`, `.run/`, `outputs/`, or `test-results/`.
- Do not include private hostnames, IPs, SSH users, wallet secrets, producer
  addresses, or local inventory data in commits, logs, screenshots, issues, or
  pull requests.

## Validation

Use the smallest validation loop that covers the change, then widen it when the
change crosses boundaries.

```bash
npm run test
npm run build
```

Common focused checks:

```bash
npm run test:backend
npm run test:ui
npm run test:ui:backup
npm run test:ui:electron
mkdocs build --strict
cmake --build node/teleno-node/build --target teleno_node --parallel
ctest --test-dir node/teleno-node/build --output-on-failure
```

For GUI layout changes, inspect the affected screen and check that controls do
not overflow their parent containers.

## Mainnet Safety

Do not run or hide mainnet-mutating work in a pull request. Producer
registration, VHP burns, producer setup changes, default-account changes,
config writes targeting a producer, and transaction signing or submission
require a fresh explicit maintainer request and a reviewable plan.

## Contribution Terms

By submitting a contribution, you certify that you have the right to submit it
and that it may be included in this repository under the repository's current
license terms.
