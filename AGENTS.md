# Teleno Codex Project Memory

Last updated: 2026-07-01

This file is intentionally short. It is operational memory for Codex sessions,
not the full project history. Long benchmark results, sprint logs, validation
transcripts, and implementation plans belong in `docs/`.

The previous long project-memory file is archived at:

```text
docs/archive/AGENTS_FULL_20260621.md
```

## Active Project Boundary

- Active repository: `/Users/pgarcgo/code/koinos-one`
- Active remote: `https://github.com/koinos/koinos-one.git`
- Active branch for the current release track: `main`
- Product name: Koinos One.
- Native runtime: `teleno_node`.
- `Teleno` owns the monolithic Koinos node app, release packaging, native backup
  and restore, first-run setup, and monolith validation.
- `Knodel` is the separate legacy/microservice app. Do not edit, build, launch,
  or commit Knodel/microservice work unless the user explicitly asks for it.
- If a resumed session starts in `/Users/pgarcgo/code/teleno`,
  `/Users/pgarcgo/code/knodel`, or another stale repo, switch to
  `/Users/pgarcgo/code/koinos-one` before monolith work.

## Documentation Map

- Documentation entrypoint: `docs/README.md`
- Current implementation: `docs/current/README.md`
- Current monolith status: `docs/current/monolith/CURRENT_MONOLITH_STATUS.md`
- Current service coverage and parity gaps:
  `docs/current/monolith/SERVICE_COVERAGE.md`
- Current backup implementation:
  `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
- Public bootstrap restore:
  `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
- Missing work and documented ideas: `docs/backlog/README.md`
- Legacy compatibility evidence: `docs/legacy/compatibility/README.md`
- Historical validation reports: `docs/roadmap/README.md`
- Archived implementation plans: `docs/archive/implementation-plans/README.md`

Read the relevant current/backlog doc before making broad architectural,
backup, producer, storage, or release decisions.

## Project Mission

Build an optimized monolithic Koinos block-producing node app that is easy for
end users to launch and operate. The current primary target is macOS; Windows
optimization follows later. Implementation decisions must preserve Koinos
protocol compatibility and avoid shortcuts that diverge from mainnet behavior.

All project documentation must be written in English, even when discussion with
the user happens in Spanish.

## Documentation Static Site Guardrail

The Koinos One manual uses MkDocs-compatible Markdown as its authoring format.
The source documentation lives in `docs/manual/`, and the navigation, theme, and
static output location are defined by `mkdocs.yml`.

MkDocs is a build-time documentation tool, not a runtime dependency of Koinos
One. Generate the static documentation with `mkdocs build --strict`; the output
is written to `build/docs/manual-site/` unless the configuration is explicitly
changed. Packaged or in-app documentation should consume the generated static
HTML, not start a live MkDocs server.

Keep `use_directory_urls: false` in `mkdocs.yml`. The Documentation tab embeds
the generated site inside the React app, and directory-style MkDocs links such
as `concepts/` can be handled by the Vite/Electron app fallback instead of the
static docs server, causing Koinos One to render recursively inside the docs
iframe. Static documentation links must resolve to concrete HTML files such as
`concepts/index.html` or `concepts/what-is-koinos.html`.

Keep `docs/manual/` readable both in GitHub and in MkDocs. Use normal Markdown
links for pages inside `docs/manual/`. When a manual page points to another
manual page, use a relative MkDocs link so it opens inside the Documentation
tab. When a manual page points to source code, repository folders, or Markdown
files outside `docs/manual/`, link to the corresponding file or folder in the
official GitHub repository instead of leaving a plain local path.

## GUI Copy Consistency Guardrail

When updating or adding a user-facing feature, verify that the visible GUI
text, labels, descriptions, empty states, status messages, and documentation in
the affected screen still match the implemented behavior. Do this as part of
the same change, especially when a feature gains a new source of truth,
fallback path, safety behavior, or operational mode.

Any GUI text added or changed must be represented in `src/i18n.ts` for both
English and Spanish. Keep each locale internally consistent: do not leave
hybrid messages that mix English and Spanish terms when a clear translated
equivalent exists.

## GUI Visual Consistency Guardrail

When modifying or adding GUI surfaces, preserve the existing visual language of
the application. Match the surrounding panel hierarchy, spacing, typography,
border radius, contrast, color palette, and control style before introducing a
new component treatment.

Do not add isolated dark cards, marketing-style panels, oversized typography,
or visually heavy blocks inside operational settings screens unless the
surrounding screen already uses that treatment. New GUI elements must look like
they belong to the same Settings, Node, Backup, Wallet, or Producer surface
where they appear.

Before considering a GUI change complete, inspect the affected screen in the
running app or with a screenshot and verify that text remains readable, labels
and values do not clash, the layout works at the expected window size, and the
new UI does not draw more attention than the feature warrants.

### First-Run Assistant Visual Direction

The first-run setup assistant is the preferred color and visual reference for
the rest of the Koinos One application. When redesigning or touching existing
screens, gradually move the app toward that look and feel: light neutral
surfaces, soft lavender/purple accents, restrained blue-gray text, subtle
borders, gentle shadows, clear progress/status treatments, and quiet rounded
controls that feel operational rather than decorative.

Do not introduce unrelated palettes that fight the assistant direction. New or
refreshed Node, Settings, Backup, Wallet, Producer, Dashboard, and
Documentation surfaces should feel like they belong to the same product family
as the assistant. Preserve usability and density for operational screens, but
use the assistant's calmer color rhythm as the default visual target.

## GUI Box Model And Spacing Guardrail

When adding or modifying panels, cards, tab bars, button rows, forms, or nested
UI surfaces, explicitly account for the CSS box model. A child element inside a
bordered parent must not use `width: 100%` together with horizontal margins,
padding, or borders unless the total rendered width is constrained with
`calc(...)`, `max-width`, or an equivalent layout rule. Prefer `width: auto`,
parent padding, and `gap` on flex/grid containers for internal spacing.

Every bordered container must preserve visible breathing room on all sides. As a
default, keep at least 12-16px between a parent's border and its child controls,
and at least 10-16px between sibling panels or action groups, unless the
surrounding component already uses a tighter established rhythm. Do not let
buttons, cards, tables, lists, or nested panels touch or visually overlap the
rightmost or leftmost border of their parent.

Before completing any GUI layout change, verify the affected screen for box
overflow and spacing:

- inspect the screen in the running app or a screenshot at the expected window
  size;
- check that `scrollWidth` does not exceed `clientWidth` unless horizontal
  scrolling is an intentional feature;
- compare parent and child bounding boxes when a panel contains nested cards,
  button rows, or controls near the edges;
- confirm left/right padding appears balanced and sibling bordered surfaces have
  a visible gap between borders.

## First-Run Setup Guardrail

The first-run installation assistant must not open during normal development
runs, Vite browser runs, or Electron dev runs. It should open only when the app
is running as a packaged installation, such as the macOS DMG-installed app, and
Electron reports an incomplete first-run setup state for that packaged install.

First-run completion is setup-scoped, not package-install scoped. A DMG
reinstall, app replacement, app path change, or product version update must not
reopen the assistant after setup has completed. Provide an explicit Settings
action for users or QA to run the setup assistant again.

Do not use browser `localStorage` alone as a fallback trigger to launch the
assistant. If the Electron first-run bridge is unavailable, fails, or reports a
non-packaged/dev runtime, keep the assistant closed and show the normal app.

The assistant is observer-only. It launches an observer node and must not
configure, register, fund, or activate a producer.

When the user selects a data folder that already contains local node database
data, the assistant must explain that local copy before restoring a public
backup. Offer a simple choice to keep the local copy and skip public backup
restore, compare the best available local age evidence with the public backup
age, and preserve the existing database unless the user explicitly chooses a
restore.

Keep the assistant simple and guided. Do not show raw command output, JSON
payloads, wallet action result dumps, expert logs, or debug panels inside the
first-run assistant. Reuse underlying wallet, restore, and node functions where
useful, but adapt their presentation to compact human states such as ready,
working, failed, or next action.

When the assistant wallet step already has an unlocked wallet, show an explicit
choice instead of a passive ready-only state: keep the current wallet, create a
new wallet, or import an existing wallet. This matters when a user goes back
from later setup steps and wants to reconsider the wallet created earlier.

The restore step must explain both trust paths: restoring the public backup is
the fastest way to prepare an observer, while skipping restore starts from an
empty chain database and syncs from seed peers. The seed-peer path is slower but
must remain available as the safest option for users who do not want to trust a
backup.

## Versioning And Build Identity Guardrail

Every packaged Koinos One app build must have a traceable build identity:
product version, build timestamp, Git commit, release channel, and native node
build identity. Use SemVer for product versions and unique build metadata for
every packaged canary, beta, or stable build.

When changing user-facing functionality, update changelog or release notes as
appropriate, and ensure the GUI About/Build Info surface can show the exact
version and commit included in the build.

When the user asks to create a new release, treat versioning and release notes
as required release work, not optional cleanup:

- increase the SemVer product version in `package.json` and `package-lock.json`;
- move relevant `CHANGELOG.md` entries into the new version section with the
  release date;
- update or regenerate the rendered manual changelog so the Documentation tab
  can show the corresponding version entry;
- run the relevant tests, docs build, package build, and packaged-app
  verification before tagging or publishing;
- only create/push a release tag and GitHub release after the version,
  changelog, manual changelog, and package artifacts match.

After a release has been created, start the next user-facing feature track on a
feature branch instead of continuing directly on `main`. Pick the next intended
SemVer version for that branch early, keep `CHANGELOG.md` updated under that
version while the feature evolves, and keep related documentation current in the
same branch. For the assistant feature track, this means first-run assistant
changes, changelog entries, manual pages, tests, and UI footer/version-link
behavior should advance together on the feature branch.

When the user says to release that feature branch, interpret it as the full
release workflow: finish the changelog section with the release date, update the
manual changelog and affected documentation, ensure the bottom/footer version
link opens the changelog section for the released version, merge the feature
branch into `main`, run the required verification, create the release tag, build
and publish the release artifacts, and only then report the release as done.

## Mainnet Safety Guardrails

- Protected mainnet producer addresses are private local project memory. If
  `AGENTS.local.md` exists, read it before any producer, wallet, or chain-
  mutating mainnet work. `AGENTS.local.md` is intentionally ignored by Git and
  must never be committed or quoted in public documentation.
- Live server inventory is private local project memory. If
  `docs/current/operations/SERVER_INVENTORY.md` exists, treat it as local-only,
  read it for host context when needed, and never commit, quote, or summarize
  its confidential hostnames, IPs, users, workloads, or resource details into
  public files.
- Public docs, tests, GUI placeholders, and committed code must use generic
  placeholders such as `<YOUR_MAINNET_PRODUCER_ADDRESS>` instead of real local
  producer addresses.
- Do not perform hidden or background mainnet mutations.
- Do not transfer funds away from a protected local mainnet producer address.
- Treat mainnet producer registration, VHP burns, producer setup changes,
  default-account changes, config writes targeting a producer, or any
  transaction signing/submission as high-risk work requiring a fresh explicit
  user request, clear target network/address confirmation, and a dry-run or
  reviewable plan first.
- Before any chain-mutating operation, verify the selected network, signer,
  target address, and operation type.

## Recovery Guardrail

If the monolith reports `block previous state merkle mismatch` or another
persistent state merkle mismatch:

- Do not clear `chain/blockchain`.
- Do not start from an empty state DB as the first action.
- Do not force a fresh full resync as the first action.
- Preserve the existing state DB.
- Only consider deleting/moving state after explicit user approval and evidence
  that validation-based recovery failed.

## Current Operational Cautions

- Live hostnames, IPs, SSH users, workloads, and reachability notes are
  private local project memory. Read local-only inventory files when needed,
  but do not commit or quote those details into public files.
- Some local hosts may run legacy prod Koinos services and separate
  observer-only deployments. Check local inventory and current service paths
  before touching any server.
- Public bootstrap and native backup behavior changes must stay local-admin
  only unless explicitly scoped otherwise. Public bootstrap means public
  read-only backup source, not public admin API exposure.
- Restored nodes should start as observers first. Enable block production only
  after database health, network, producer address, VHP, and producer-key checks
  pass.
- Account history is not full legacy parity yet. Check
  `docs/current/monolith/SERVICE_COVERAGE.md` and `docs/backlog/README.md`
  before claiming complete legacy-service coverage.

## Legacy Boundary

- Old GarageMQ, microservice build/start, packaging, and operator docs are not
  part of the active Koinos One command surface.
- Retain or add legacy material only when it proves protocol parity, client
  compatibility, migration/restore safety, or a release-gate validation result.
- Compatibility evidence lives in `docs/legacy/compatibility/README.md`.

## Useful Commands

```bash
npm run dev
npm run build
cmake --build node/teleno-node/build --target teleno_node --parallel
ctest --test-dir node/teleno-node/build --output-on-failure
```

For backup, restore, public bootstrap, packaging, or live validation commands,
use the relevant current/backlog docs instead of expanding this file.
