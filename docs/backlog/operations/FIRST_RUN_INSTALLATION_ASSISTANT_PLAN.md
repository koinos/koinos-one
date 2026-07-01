# First-Run Installation Assistant Plan

Status: partially implemented on 2026-07-01. This document records the intended
UX contract and the current implementation status for the first-run assistant.

Implemented:

- Welcome step before data folder selection.
- Mainnet-first first-run flow with no testnet choice in the assistant.
- Single `Data Folder` value instead of competing saved/selected paths.
- `Restore` / `Restore Public Backup` user-facing terminology.
- Public backup URL visible on the restore step.
- Shared restore progress component reused by the normal backup/restore screen
  and the first-run assistant.
- `Previous` navigation from safe steps, including restore back to data folder
  before restore starts.

Still future-gated:

- A separate expert-only testnet setup surface in the running app if the
  existing advanced settings are not enough.
- Producer setup assistant and producer activation flow; these remain outside
  first-run setup.

## Current Constraint

The packaged first-run assistant should be observer-first and mainnet-first. It
should guide a new operator through choosing a base data folder, restoring from
the mainnet public backup, and starting a local mainnet observer node.

It must not silently configure a wallet, fund an account, burn VHP, register a
producer, enable block production, or write producer settings. Any future
producer path needs a separate explicit safety design and confirmation gate.

## Initial Network Scope

Remove testnet selection from the initial installation assistant.

The first-run assistant is for the normal end-user installation path. It should
not ask non-expert users to choose between mainnet and testnet during first run.
The default installation should prepare a mainnet observer using the standard
public backup restore path.

Testnet should become an expert-only mode. It should be available only after
Koinos One is already running, through Advanced Settings or another explicit
expert surface. Switching to testnet must remain an intentional operator action,
not a first-run default choice.

Future implementation notes:

- Remove the network choice cards from first-run setup.
- Replace network selection with an implicit mainnet observer setup.
- Keep testnet copy and controls out of the simple first-run path.
- Add an expert-only testnet control in the running app if it does not already
  provide a safe explicit path.
- Ensure restore URLs, presets, labels, and receipts make clear that first-run
  setup restored the mainnet public backup.

## Welcome Screen

Add a dedicated first screen before the current data/restore/start steps.
The goal is to orient a non-expert operator before asking technical questions.

Proposed structure:

- Title: `Welcome to Koinos One`
- Short description: explain that Koinos One is a desktop app for installing,
  restoring, and running a native Koinos node.
- Assistant promise: explain that the assistant will guide the user through the
  safe installation flow.
- Safety statement: make clear that the first run starts as an observer and
  does not activate block production automatically.
- Producer direction: mention that a producer setup can be prepared later from
  inside Koinos One, after the node is healthy and the operator explicitly
  confirms producer-related actions.
- Primary action: `Get started`
- Secondary action: `Skip setup`

Draft copy:

```text
Welcome to Koinos One

Koinos One helps you install, restore, and operate a native Koinos node from a
desktop app.

This assistant will guide you through the first safe setup: selecting where the
node data will live, restoring the mainnet public backup when it is available,
and starting the node as an observer.

Block production is not enabled automatically. After the node is running and
healthy, Koinos One can guide you through producer preparation as a separate,
explicit step.
```

Avoid promising a "full producer node" in the first-run welcome screen until the
producer setup flow has its own completed plan, safety gates, tests, and mainnet
approval path. A safer future-facing phrase is:

```text
This assistant will prepare a full mainnet Koinos node in observer mode.
Producer setup is available only after the observer node is healthy and you
explicitly choose to continue.
```

## Flow Placement

The welcome screen should become step 1 of the assistant:

1. Welcome and expectations.
2. Base Data Folder.
3. Restore Public Backup.
4. Start mainnet observer node.
5. Finish and continue to Koinos One.

The progress UI should show the welcome step without making the stepper
clickable.

## Data Folder Step

Use one data path in the first-run assistant.

The folder step should show a single user-facing value labeled `Data Folder`.
Do not show separate `Saved Data Folder` and `Selected Folder` cards in the
first-run flow, because that makes the user wonder which path will actually be
used.

Expected behavior:

- If Koinos One already has a saved data folder, use it as the initial value.
- When the user chooses a different folder, replace the visible `Data Folder`
  value with that draft selection.
- Save the selected folder only when the user continues through the explicit
  setup action.
- Before restore starts, the user must be able to go back from the restore step
  to this folder step with `Previous` and choose a different destination
  folder.
- If the selected folder has not been saved yet, use short helper copy such as
  `This folder will be saved when you continue` instead of showing a second
  competing path.
- Keep capacity guidance on the same step, including the estimated free space
  needed for mainnet data, restores, and local backups.
- Because first-run setup is mainnet-only, avoid showing `Network` as a
  competing summary card on this step. Mainnet can be communicated in the step
  title, helper text, or restore step.

## Restore Public Backup Step

Use user-facing restore terminology consistently across Koinos One.

The first-run assistant step should be called `Restore`, and the main action or
step title should be `Restore Public Backup`. Do not call this step
`Bootstrap`, `Public Bootstrap`, or `Prepare the observer data` in the GUI.

Application-wide copy should use `public backup` instead of `public bootstrap`
for user-facing labels, headings, helper text, button text, progress messages,
receipts, and non-technical documentation. Technical implementation names,
internal identifiers, or legacy URLs can keep their current names if renaming
them would create unnecessary migration risk, but they should not leak into
simple user-facing copy.

Expected behavior:

- Show the public backup URL on the restore step before the user starts the
  restore.
- Label the URL as `Public Backup URL` or `Public Backup Repository`.
- Keep the full URL visible enough for review and copying, with truncation only
  if the UI also provides a tooltip or copy affordance.
- Make the primary action read `Restore Public Backup`.
- Use restore progress copy such as `Restoring public backup` instead of
  `Preparing observer data` or `Bootstrapping`.
- Receipts should say that the node was restored from the public backup and
  include the sanitized backup URL/source identifier.

### Restore Progress UI

The assistant must show the same real restore progress experience as the normal
backup/restore screen in the running application.

The current assistant-style restore state can look stuck because it only shows a
disabled action button and broad step progress. That is not enough for a
long-running public backup restore. Operators need to see the active phase,
bytes, files, transfer speed, ETA, updated timestamp, and any actionable
restore error in the same format they already see outside the assistant.

Implementation direction:

- Extract the normal backup/restore progress panel into a reusable component
  instead of duplicating a simplified assistant-only version.
- Reuse the same progress parsing, status mapping, cancellation state, error
  mapping, and receipt/result handling behind both the normal restore screen
  and the first-run assistant.
- Allow small layout adaptations for the modal size, but keep the same
  information hierarchy, progress bar, phase text, speed, ETA, byte/file
  counters, and error treatment.
- Show the reusable progress panel inside the `Restore Public Backup` step as
  soon as restore starts.
- Keep the restore step title and button copy aligned with the application-wide
  `public backup` terminology.
- If restore appears stalled, show a clear active/stalled state based on real
  progress timestamps instead of leaving the user with only a disabled button.
- Any stop/cancel affordance added to the normal restore panel should be
  available in the assistant version only when it is safe for the current phase.

## Navigation Controls

Add a `Previous` button where it improves usability.

The assistant should not force users to close or restart the setup just because
they want to correct an earlier choice. However, the back action must remain
state-aware and safe.

Expected behavior:

- Show `Previous` on setup steps after the welcome screen when the previous step
  can be revisited safely.
- Show `Previous` on the `Restore` step before restore starts, so the user can
  return to `Data Folder` and change the destination folder.
- Hide or disable `Previous` on the welcome screen.
- Hide or disable `Previous` while a destructive, long-running, or stateful
  operation is active, such as public backup restore or observer startup.
- Do not allow `Previous` to undo an activated restore, stop a running observer,
  or silently rewrite saved settings.
- If going back would leave saved settings different from draft settings, show
  clear copy and require the user to save again before continuing.
- Keep the stepper itself non-clickable; navigation should happen through the
  explicit `Previous`, `Next`, `Get started`, `Skip setup`, and `Finish`
  actions.

## Copy And Localization

All visible copy must be added to `src/i18n.ts` in English and Spanish when
implemented. The English copy in this plan is the source of truth for the future
implementation.

Spanish copy should keep the same safety meaning:

- do not imply automatic producer activation;
- do not imply wallet funding or VHP burn during first run;
- keep observer-first setup clear;
- keep mainnet as the simple first-run path;
- keep testnet described as expert-only and available from the running app, not
  from the first-run assistant.

## Acceptance Criteria For Future Implementation

- A welcome screen appears before the base data folder step in packaged
  first-run setup.
- Development and browser runs still do not auto-open the assistant.
- The welcome screen explains Koinos One and the setup flow in non-technical
  language.
- First-run setup no longer asks the user to choose testnet.
- First-run setup defaults to mainnet observer installation.
- Testnet remains available only through Advanced Settings or an equivalent
  explicit expert path in the running app.
- The data folder step shows one `Data Folder` value only, with no separate
  `Saved Data Folder` and `Selected Folder` cards.
- The restore step is called `Restore`, its main action is
  `Restore Public Backup`, and the GUI does not use `Bootstrap`,
  `Public Bootstrap`, or `Prepare the observer data` for this flow.
- The restore step shows the public backup URL before restore starts.
- User-facing copy across the application uses `public backup` instead of
  `public bootstrap` unless the text is an unavoidable internal technical
  identifier.
- The assistant reuses the same restore progress component and restore progress
  logic as the normal backup/restore screen, with only size/layout adaptations
  where needed.
- Restore progress in the assistant shows phase, byte/file counters, speed, ETA,
  updated timestamp, errors, and receipts instead of only a disabled action
  button.
- The copy is clear that the first-run path starts an observer node only.
- Producer setup is presented only as a later, explicit, separately gated path.
- `Previous` navigation exists only on safe steps and is hidden or disabled
  during restore/start operations.
- `src/i18n.ts` contains all new visible copy in English and Spanish.
- UI tests cover the welcome screen, `Get started`, `Skip setup`, and the
  transition into the base data folder step.
- UI tests verify that changing the folder updates the single `Data Folder`
  value and does not show competing saved/selected path labels.
- UI tests verify that `Previous` from the restore step returns to
  `Data Folder` before restore starts and allows changing the destination
  folder.
- UI tests verify that the assistant restore step renders the shared progress
  component and updates progress while restore is running.
- UI tests cover `Previous` visibility, disabled states during restore/start,
  and safe backwards navigation.
- UI tests verify that testnet is not visible in the first-run assistant.
