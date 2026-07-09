# Goal Prompt: Teleno Node CLI Guide

Historical note: the full CLI guide moved to the standalone
[koinos/teleno](https://github.com/koinos/teleno) repository (`docs/`).
The Koinos One manual keeps only a pointer page at
`docs/manual/teleno-node/README.md`. Use this prompt in the teleno
repository when regenerating that guide.

Write the `docs/` operator guide of the teleno repository.

## Objective

Create an operator guide for running the native `teleno_node` binary from the
command line. The guide should support observer-first operation, safe backup and
restore, diagnostics, RPC exposure awareness, and carefully gated producer
operation.

## Files To Create Or Update

- `docs/manual/teleno-node/README.md`
- `docs/manual/teleno-node/install-or-build.md`
- `docs/manual/teleno-node/quickstart.md`
- `docs/manual/teleno-node/configuration.md`
- `docs/manual/teleno-node/running-observer-node.md`
- `docs/manual/teleno-node/running-producer-node.md`
- `docs/manual/teleno-node/backup-restore-cli.md`
- `docs/manual/teleno-node/rpc-endpoints.md`
- `docs/manual/teleno-node/logs-and-diagnostics.md`
- `docs/manual/teleno-node/command-reference.md`
- `docs/manual/teleno-node/troubleshooting.md`
- Update `docs/manual/reference/glossary.md` if new terms are introduced.
- Update `mkdocs.yml` navigation if pages are added, removed, renamed, or
  reordered.
- Preserve `use_directory_urls: false` in `mkdocs.yml` so the in-app
  Documentation iframe uses concrete HTML files instead of React fallback
  routes.

## Read First

- `AGENTS.md`
- `docs/manual/README.md`
- `mkdocs.yml`
- teleno startup guide: https://github.com/koinos/teleno/blob/main/docs/operations/start-node.md
- teleno container guide: https://github.com/koinos/teleno/blob/main/docs/operations/container.md
- `docs/current/operations/README.md`
- `docs/current/monolith/ARCHITECTURE.md`
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- `node/teleno-node/src/main.cpp`

## Audience

Operators and developers who need to run the native node directly without the
Koinos One GUI.

## Content Requirements

- Explain how to build or locate `teleno_node`.
- Explain observer quickstart, configuration files, profiles, base directories,
  ports, JSON-RPC, gRPC, P2P, local admin APIs, logs, diagnostics, backup, and
  restore.
- Include command examples only when they are validated against current docs or
  source behavior.
- Mark commands that mutate state, write config, activate production, sign
  transactions, burn VHP, or register producers as high-risk.
- Include verification steps after startup, restore, and config changes.
- Link to current implementation docs for deep storage, backup, and service
  coverage details.

## Safety And Scope

- Do not publish private server inventory, protected addresses, hostnames, IPs,
  SSH users, or local-only operational notes.
- Do not expose backup admin endpoints as public surfaces.
- Do not use real producer addresses or secrets in examples.
- For persistent merkle mismatch troubleshooting, preserve the existing state DB
  and do not recommend clearing chain data as the first step.

## Style

- Write in English.
- Use MkDocs-compatible Markdown.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- Link source files, source folders, and Markdown files outside `docs/manual/`
  to the official GitHub repository instead of leaving plain local paths.
- Use command blocks for commands, but keep explanations concise.
- Separate observer and producer workflows clearly.
- Prefer repeatable checklists for CLI operations.

## Done Criteria

- Every planned CLI guide page exists and is linked from the section index.
- Commands are current, conservative, and clearly scoped.
- Mainnet and producer safety warnings are present where needed.
- The guide does not duplicate private or obsolete legacy microservice
  operation docs.
- `mkdocs.yml` includes every CLI guide page in the static-site navigation.
- Generated MkDocs navigation links point to concrete `.html` files, not
  directory-style URLs such as `teleno-node/`.
- `mkdocs build --strict` passes and generates the updated static site under
  `build/docs/manual-site/`.
- If the app or dev server is available, clicking at least one MkDocs
  side-navigation link inside the Documentation tab stays within
  `/manual-site/...html` and does not render Koinos One recursively in the
  iframe.
