# Goal Prompt: Developer Documentation

Write the `docs/manual/developers/` section of the Koinos One manual.

## Objective

Create contributor documentation for understanding, developing, testing,
packaging, and maintaining Koinos One and the native Teleno Node. The docs
should help a new contributor orient themselves without replacing the deeper
current implementation and validation docs.

## Files To Create Or Update

- `docs/manual/developers/README.md`
- `docs/manual/developers/repository-tour.md`
- `docs/manual/developers/local-development.md`
- `docs/manual/developers/architecture-overview.md`
- `docs/manual/developers/gui/README.md`
- `docs/manual/developers/gui/electron-vite-react-structure.md`
- `docs/manual/developers/gui/app-state-and-native-bridge.md`
- `docs/manual/developers/gui/i18n-and-gui-copy.md`
- `docs/manual/developers/gui/settings-screens.md`
- `docs/manual/developers/gui/packaging.md`
- `docs/manual/developers/teleno-node/README.md`
- `docs/manual/developers/teleno-node/source-layout.md`
- `docs/manual/developers/teleno-node/component-overview.md`
- `docs/manual/developers/teleno-node/chain-block-store-mempool.md`
- `docs/manual/developers/teleno-node/p2p-jsonrpc-grpc.md`
- `docs/manual/developers/teleno-node/backup-restore-internals.md`
- `docs/manual/developers/teleno-node/storage-and-rocksdb.md`
- `docs/manual/developers/teleno-node/testing-and-validation.md`
- `docs/manual/developers/teleno-node/release-builds.md`
- `docs/manual/developers/compatibility/koinos-protocol-boundary.md`
- `docs/manual/developers/compatibility/legacy-service-parity.md`
- `docs/manual/developers/compatibility/mainnet-safety.md`
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
- `docs/current/monolith/ARCHITECTURE.md`
- `docs/current/monolith/CURRENT_MONOLITH_STATUS.md`
- `docs/current/monolith/SERVICE_COVERAGE.md`
- `docs/current/storage/UNIFIED_ROCKSDB_CURRENT_IMPLEMENTATION.md`
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- `docs/koinos/KOINOS_PROTOCOL.md`
- `docs/backlog/README.md`
- Relevant source files under `src/`, `electron/`, `node/teleno-node/src/`,
  `scripts/`, and test directories.

## Audience

Developers who need to contribute to the GUI, Electron bridge, packaging,
native node, backup/restore, storage, networking, tests, or release workflow.

## Content Requirements

- Explain repository boundaries, including that Knodel/microservice work is out
  of scope unless explicitly requested.
- Explain the Electron + React + TypeScript GUI structure and how it supervises
  the native node.
- Explain the native monolithic node at a high level: chain, block store,
  mempool, P2P, JSON-RPC, gRPC, producer, transaction store, contract metadata,
  account history, storage, and backup scheduler/admin API.
- Explain how to develop, run, test, build, package, and validate changes.
- Explain GUI i18n and copy requirements for English and Spanish.
- Explain visual consistency expectations for operational screens.
- Explain protocol compatibility boundaries and legacy parity limitations.

## Safety And Scope

- Do not quote private local files such as `AGENTS.local.md` or private server
  inventory.
- Do not document protected producer addresses or confidential host details.
- Do not suggest shortcuts that diverge from mainnet protocol behavior.
- Keep future/backlog ideas clearly separate from implemented behavior.

## Style

- Write in English.
- Use MkDocs-compatible Markdown.
- Use normal relative Markdown links for pages inside `docs/manual/`.
- Link source files, source folders, and Markdown files outside `docs/manual/`
  to the official GitHub repository instead of leaving plain local paths.
- Use links to current implementation docs for deep detail.
- Keep architecture pages high-level and readable.
- Use file paths and command examples where they help contributors act.

## Done Criteria

- Developer section index links to every page.
- GUI and native-node docs are clearly separated.
- Implemented behavior, backlog work, legacy compatibility, and private
  local-only material are not mixed together.
- Build/test commands match the current repository.
- `mkdocs.yml` includes every developer documentation page in the static-site
  navigation.
- Generated MkDocs navigation links point to concrete `.html` files, not
  directory-style URLs such as `developers/`.
- `mkdocs build --strict` passes and generates the updated static site under
  `build/docs/manual-site/`.
- If the app or dev server is available, clicking at least one MkDocs
  side-navigation link inside the Documentation tab stays within
  `/manual-site/...html` and does not render Koinos One recursively in the
  iframe.
