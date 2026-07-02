# Goal Prompt: Koinos Concepts

Write the `docs/manual/concepts/` section of the Koinos One manual.

## Objective

Create beginner-friendly Koinos blockchain concept documentation that helps a
Koinos One user understand what the desktop app and `teleno_node` are operating.
Keep the explanation practical, accurate, and not overly technical.

## Files To Create Or Update

- `docs/manual/concepts/README.md`
- `docs/manual/concepts/what-is-koinos.md`
- `docs/manual/concepts/accounts-keys-wallets.md`
- `docs/manual/concepts/transactions-blocks-finality.md`
- `docs/manual/concepts/observers-producers-and-mainnet.md`
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
- `docs/koinos/KOINOS_PROTOCOL.md`
- `docs/current/monolith/ARCHITECTURE.md`
- `docs/current/monolith/SERVICE_COVERAGE.md`

## Audience

Users and operators who may understand blockchain basics but do not yet know
Koinos, Proof of Burn, RC, VHP, or how a node participates in the network.

## Content Requirements

- Explain Koinos as a protocol/network family, not as only the Koinos One app.
- Explain chain ID, genesis, blocks, transactions, state, peers, RPC, observers,
  producers, KOIN, RC, and VHP.
- Explain the difference between mainnet, testnet, and private networks.
- Explain observer-first operation and why production must be enabled only after
  health, wallet, key, address, and VHP checks pass.
- Clearly distinguish protocol rules from local implementation choices.
- Link to deeper protocol details instead of copying the full protocol
  reference.

## Safety And Scope

- Do not include private producer addresses, server inventory, hostnames, IPs,
  SSH users, or local-only operational details.
- Do not describe any workflow that mutates mainnet state as automatic or safe
  without explicit user confirmation.
- Use generic placeholders for any address examples.

## Style

- Write in English.
- Use MkDocs-compatible Markdown.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- Link source files, source folders, and Markdown files outside `docs/manual/`
  to the official GitHub repository instead of leaving plain local paths.
- Prefer plain language and short sections.
- Use tables only when they make comparison easier.
- Avoid implementation-heavy detail unless it helps the reader understand an
  operational decision.

## Done Criteria

- The section index links to all concept pages.
- Each page can be read independently by a non-developer.
- Important terms are added or updated in the glossary.
- All claims match the current implementation and protocol references.
- `mkdocs.yml` includes the section pages in the static-site navigation.
- Generated MkDocs navigation links point to concrete `.html` files, not
  directory-style URLs such as `concepts/`.
- `mkdocs build --strict` passes and generates the updated static site under
  `build/docs/manual-site/`.
- If the app or dev server is available, clicking at least one MkDocs
  side-navigation link inside the Documentation tab stays within
  `/manual-site/...html` and does not render Koinos One recursively in the
  iframe.
