# Teleno Documentation

This directory is organized by document lifecycle, not by the order in which the
work originally happened.

## User-Facing Manual

Use `manual/` for the documentation that is exposed through the Koinos One app
and intended for users, operators, and contributors.

- `manual/README.md` - publishable documentation entrypoint.
- `manual/concepts/` - basic Koinos blockchain concepts.
- `manual/koinos-one/` - desktop app user guide.
- `manual/teleno-node/` - command-line guide for the native `teleno_node`
  binary.
- `manual/developers/` - contributor documentation for the GUI and native node.
- `manual/reference/` - glossary, ports, paths, config, security, and release
  reference.

## Current Implementation

Use `current/` for behavior that exists in the active Koinos One / Teleno
codebase.

- `current/README.md` - current implementation index.
- `current/monolith/` - monolithic node architecture, status, and service
  coverage.
- `current/backup-restore/` - implemented native backup, restore, and public
  bootstrap behavior.
- `current/storage/` - current storage layout.
- `operations/` - operator-facing run and container guides.
- `koinos/` - protocol compatibility references.

## Backlog

Use `backlog/` for missing work, deferred implementation, and product ideas that
are documented but not yet fully implemented or signed off.

- `backlog/README.md` - prioritized missing-work index.
- `backlog/backup-restore/` - remaining native backup and public bootstrap
  work.
- `backlog/producer/` - producer wallet, distributed producer, and VHP workflow
  ideas.
- `backlog/strategy/` - product strategy, positioning, and market-direction
  ideas that are not yet current implementation.
- `backlog/storage/` - storage migration and unified database follow-up work.

## Legacy And Compatibility

Use `legacy/` for legacy Koinos microservice references that are still useful as
compatibility evidence. Legacy service docs are not the active Teleno operator
surface.

- `legacy/README.md` - legacy boundary and retained topics.
- `legacy/compatibility/README.md` - retained compatibility evidence map.

## Historical Roadmaps And Archive

Use `roadmap/` for historical validation reports and long-running roadmap
records. Use `archive/` for superseded implementation plans and archived project
memory that should not be treated as current work instructions.
