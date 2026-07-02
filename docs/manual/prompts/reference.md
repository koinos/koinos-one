# Goal Prompt: Manual Reference

Write the `docs/manual/reference/` section of the Koinos One manual.

## Objective

Create short lookup pages that users, operators, and developers can use while
reading the rest of the manual. Reference pages should be concise, factual, and
easy to scan.

## Files To Create Or Update

- `docs/manual/reference/README.md`
- `docs/manual/reference/glossary.md`
- `docs/manual/reference/ports.md`
- `docs/manual/reference/config-files.md`
- `docs/manual/reference/environment-variables.md`
- `docs/manual/reference/security-model.md`
- `docs/manual/reference/release-channels.md`
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
- `docs/current/monolith/ARCHITECTURE.md`
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- `docs/operations/START_TELENO_NODE.md`
- `electron-builder.yml`
- `package.json`
- Relevant config files under `config/`.

## Audience

Readers who need quick answers: definitions, ports, paths, config files,
environment variables, release identity, and security boundaries.

## Content Requirements

- Expand the glossary as terms are introduced by the manual.
- Document local endpoints, public endpoints, P2P ports, JSON-RPC, gRPC, and
  backup/admin exposure rules.
- Document important config files and data directories without exposing local
  private paths or secrets.
- Document supported environment variables only when confirmed by source or
  current docs.
- Document security rules around local-only admin APIs, wallets, private keys,
  protected producer addresses, public bootstrap, and mainnet mutation.
- Document product version, release channel, build timestamp, Git commit, and
  native node build identity expectations.

## Safety And Scope

- Do not include private hostnames, IPs, users, inventory data, producer
  addresses, wallet secrets, tokens, or key material.
- Use placeholders for examples.
- Do not present public bootstrap as public administrative control.
- Do not document speculative configuration keys or environment variables.

## Style

- Write in English.
- Use MkDocs-compatible Markdown.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- Link source files, source folders, and Markdown files outside `docs/manual/`
  to the official GitHub repository instead of leaving plain local paths.
- Prefer tables for lookup values.
- Keep each page short and link to detailed guide pages.
- Use "Unknown" or "Not documented yet" only when the current implementation
  cannot be confirmed from source or current docs.

## Done Criteria

- Every planned reference page exists and is linked from the section index.
- Lookup values are sourced from current docs or source files.
- Security and exposure boundaries are explicit.
- The section remains concise and avoids duplicating long guide content.
- `mkdocs.yml` includes every reference page in the static-site navigation.
- Generated MkDocs navigation links point to concrete `.html` files, not
  directory-style URLs such as `reference/`.
- `mkdocs build --strict` passes and generates the updated static site under
  `build/docs/manual-site/`.
- If the app or dev server is available, clicking at least one MkDocs
  side-navigation link inside the Documentation tab stays within
  `/manual-site/...html` and does not render Koinos One recursively in the
  iframe.
