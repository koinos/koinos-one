# Goal Prompt: Koinos One User Guide

Write the `docs/manual/koinos-one/` section of the Koinos One manual.

## Objective

Create a task-based user guide for operating a local Koinos node through the
Koinos One desktop app. The guide should explain what users can do in the GUI,
what each workflow means, how to verify success, and what to do safely when
something goes wrong.

## Files To Create Or Update

- `docs/manual/koinos-one/README.md`
- `docs/manual/koinos-one/install-macos.md`
- `docs/manual/koinos-one/first-run-setup.md`
- `docs/manual/koinos-one/node-dashboard.md`
- `docs/manual/koinos-one/syncing-a-node.md`
- `docs/manual/koinos-one/backup-and-restore.md`
- `docs/manual/koinos-one/public-bootstrap-restore.md`
- `docs/manual/koinos-one/wallet-and-accounts.md`
- `docs/manual/koinos-one/producer-mode.md`
- `docs/manual/koinos-one/troubleshooting.md`
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
- `docs/current/README.md`
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- `docs/current/monolith/CURRENT_MONOLITH_STATUS.md`
- `docs/current/monolith/SERVICE_COVERAGE.md`
- Relevant GUI files under `src/App.tsx`, `src/components/panels/`, and
  `src/i18n.ts` for visible labels and implemented behavior.

## Audience

End users and node operators who prefer the desktop app over direct CLI
operation.

## Content Requirements

- Explain install, first-run setup, network choice, base data folder, observer
  startup, sync monitoring, logs, settings, backup, restore, public bootstrap,
  wallet management, and producer setup.
- Keep visible GUI labels and documentation terminology aligned with
  `src/i18n.ts`.
- Include "How to verify it worked" sections for important workflows.
- Include "Stop and ask before continuing" warnings for producer setup,
  transaction signing, VHP burn, mainnet registration, and config changes that
  affect block production.
- Explain that public bootstrap is a public read-only backup source, not public
  admin API exposure.
- Explain that restored nodes should start as observers first.

## Safety And Scope

- Do not include private host details, protected producer addresses, or local
  server inventory content.
- Do not suggest clearing `chain/blockchain` or forcing a fresh full resync as a
  first action for state merkle mismatch recovery.
- Use placeholders for all addresses and secrets.
- Avoid promising complete legacy account-history parity unless current docs
  confirm it.

## Style

- Write in English.
- Use MkDocs-compatible Markdown.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- Reference docs outside `docs/manual/` as plain code paths unless they are
  intentionally included in the MkDocs source tree.
- Prefer task-oriented pages with these sections where useful: "When to use
  this", "Before you start", "Steps", "How to verify it worked",
  "Troubleshooting", and "Related pages".
- Keep copy concise and operational.

## Done Criteria

- Every planned user-guide page exists and is linked from the section index.
- The guide matches current GUI behavior and visible labels.
- High-risk workflows include clear safety boundaries.
- The guide does not expose local-only private project memory.
- `mkdocs.yml` includes every user-guide page in the static-site navigation.
- Generated MkDocs navigation links point to concrete `.html` files, not
  directory-style URLs such as `koinos-one/`.
- `mkdocs build --strict` passes and generates the updated static site under
  `build/docs/manual-site/`.
- If the app or dev server is available, clicking at least one MkDocs
  side-navigation link inside the Documentation tab stays within
  `/manual-site/...html` and does not render Koinos One recursively in the
  iframe.
