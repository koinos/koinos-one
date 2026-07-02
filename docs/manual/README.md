# Koinos One Manual

This manual is the user-facing documentation entrypoint for Koinos One and
Teleno Node. It is organized by audience and task, while the existing
[current implementation docs](https://github.com/pgarciagon/koinos-one/tree/main/docs/current),
[backlog docs](https://github.com/pgarciagon/koinos-one/tree/main/docs/backlog),
[legacy docs](https://github.com/pgarciagon/koinos-one/tree/main/docs/legacy),
and [archive docs](https://github.com/pgarciagon/koinos-one/tree/main/docs/archive)
remain the engineering source of truth for implementation state, future work,
compatibility evidence, and historical material.

## Sections

- [concepts/](concepts/README.md) - basic Koinos blockchain concepts for users
  and operators.
- [koinos-one/](koinos-one/README.md) - desktop app user guide.
- [teleno-node/](teleno-node/README.md) - command-line guide for the native
  `teleno_node` binary.
- [developers/](developers/README.md) - contributor documentation for the GUI
  and native node.
- [reference/](reference/README.md) - glossary, ports, paths, config, and
  security reference.

## Static Site

The manual is authored as MkDocs-compatible Markdown. Build the static site
from the repository root:

```bash
mkdocs build --strict
```

The generated HTML is written to `build/docs/manual-site/`.

## Documentation Principles

- Start with practical workflows before low-level internals.
- Keep mainnet safety visible anywhere producer, wallet, backup, restore, or
  signing behavior is discussed.
- Keep GUI documentation aligned with the visible app behavior and i18n copy.
- Link to current implementation docs for deeper technical details instead of
  duplicating long validation history.
