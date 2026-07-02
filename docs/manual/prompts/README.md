# Manual Authoring Prompts

These files are reusable goal prompts for expanding the Koinos One manual one
section at a time. Each prompt is intended to be pasted into a future Codex
goal or task.

## Prompts

- `concepts.md` - write the Koinos Concepts section.
- `koinos-one-user-guide.md` - write the Koinos One desktop app user guide.
- `teleno-node-cli-guide.md` - write the `teleno_node` command-line guide.
- `developer-documentation.md` - write contributor documentation for the GUI
  and native node.
- `reference.md` - write glossary and lookup reference material.

## Shared Rules

- Documentation must be written in English.
- Manual pages must be authored as MkDocs-compatible Markdown under
  `docs/manual/`.
- Update `mkdocs.yml` whenever pages are added, removed, renamed, or reordered
  so the static site navigation stays complete.
- Keep `use_directory_urls: false` in `mkdocs.yml` so Documentation tab links
  resolve to concrete HTML files instead of falling back to the React app.
- After building, verify generated navigation links use concrete `.html` targets
  such as `concepts/index.html`, not directory targets such as `concepts/`.
- When the app or dev server is available, regression-test one Documentation tab
  side-navigation click and confirm the iframe stays on `/manual-site/...html`
  without rendering Koinos One recursively inside itself.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- When referencing source files, source folders, or Markdown files outside
  `docs/manual/`, link to the corresponding path in the official GitHub
  repository instead of leaving a plain local path.
- Run `mkdocs build --strict` before finishing; the generated static site is
  written to `build/docs/manual-site/`.
- Keep user-facing docs practical and accurate.
- Link to existing current implementation docs instead of duplicating long
  validation history.
- Do not quote or expose private local inventory, hostnames, IPs, users, or
  protected producer addresses.
- Use placeholders such as `<YOUR_MAINNET_PRODUCER_ADDRESS>` for mainnet
  examples.
- Treat producer setup, signing, VHP burns, registration, config writes, and
  transaction submission as high-risk topics requiring explicit user action and
  dry-run or review steps.
