# Observer-Only Installation Assistant Implementation Plan

- Date: 2026-06-26
- Status: planning only
- Scope: Koinos One first-run installation assistant, Electron UX, observer
  preset launch path, i18n, and tests

## Goal

Improve the Koinos One installation assistant so a first-time user can launch
an observer node through one simple linear wizard:

```text
Next -> Next -> Next
```

The assistant is not a producer setup assistant. It must not activate,
configure, register, fund, or manage block production. Its only runtime outcome
is a started observer node.

## Scope And Non-Goals

In scope:

- Replace the current first-run producer-address and producer-key steps with an
  observer-only install flow.
- Keep the wizard linear and predictable, with one primary action per step.
- Ask only concrete setup questions required to launch an observer.
- Use safe defaults for mainnet/testnet observer profiles.
- Start the node with observer profiles and `features.block_producer=false`.
- Keep public bootstrap restore as a recommended automatic bootstrap source
  when it is available.
- Keep all visible copy in `src/i18n.ts` for English and Spanish.
- Preserve the current Koinos One operational settings visual language.

Non-goals:

- Producer activation.
- Producer key generation, registration, replacement, or deletion.
- Asking for producer addresses.
- Asking for producer private keys, WIF keys, seed phrases, wallet passwords, or
  signing credentials.
- VHP transfer, KOIN burn, producer funding, or any chain-mutating transaction.
- Mainnet producer config writes.
- Wallet creation or import from the installation assistant.
- Remote multi-node management.

## Current UX Assumptions To Inspect

The current code has enough observer-safe plumbing, but the first-run UX still
mixes observer launch with producer setup.

Current first-run modal:

- `src/components/panels/FirstRunSetupModal.tsx`
  - Current steps are `data`, `restore`, `wallet`, `producer`, `start`.
  - The `wallet` step says "Create a new producer address" and asks for wallet
    password confirmation.
  - The `producer` step shows producer address, local public key, registered
    public key, and a producer registration action.
  - Progress steps are clickable, so the path is not strictly linear.
  - Most first-run copy is hardcoded instead of routed through `src/i18n.ts`.

Current first-run integration:

- `src/App.tsx`
  - `startObserverNodeFromSetup()` already forces observer profiles through
    `defaultNodeProfilesForNetwork(nodeSettings.network)`.
  - It chooses `profile:mainnet_observer`, `profile:testnet_observer`, or
    `profile:custom_advanced` before calling `presetReconcile`.
  - The modal still receives producer props and callbacks:
    `producerAddress`, `producerLocalPublicKey`, `producerRegisteredPublicKey`,
    `producerSetupComplete`, `producerRegisterDisabled`,
    `producerRegisterHintText`, `producerRegisterActionText`,
    `useExistingProducerAddress`, and `registerProducer`.

Current native/Electron preset behavior:

- `electron/lib/network-profiles.ts`
  - `mainnet` defaults to `['mainnet_observer']`.
  - `testnet` defaults to `['testnet_observer']`.
- `electron/main.ts`
  - `MONOLITH_OBSERVER_FEATURES` sets `block_producer: false`.
  - `profile:mainnet_observer` and `profile:testnet_observer` use observer
    feature flags.
  - Producer presets use `MONOLITH_PRODUCER_FEATURES` and run producer config
    preflight, which should remain outside first-run.
- `node/teleno-node/src/main.cpp`
  - Backup restore first start disables `block_producer` and forces
    `verify-blocks`, matching the observer-first safety model.

Current tests:

- `src/components/panels/FirstRunSetupModal.test.tsx`
  - Existing tests currently expect producer-address and producer-key setup
    content. These should be replaced with observer-only wizard tests.

Current documentation:

- `docs/current/backup-restore/PUBLIC_BOOTSTRAP_RESTORE.md`
  - Public bootstrap restore is designed as a read-only bootstrap source and
    writes observer-safe config when needed.
- `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`
  - Restore starts observer-first, disables block production, and excludes
    producer keys and wallet files.
- `docs/backlog/operations/MULTI_NODE_REMOTE_INSTALL_AND_MANAGEMENT_PLAN.md`
  - Remote install planning also treats observer install as the default safe
    role and producer activation as a separate explicit workflow.

## Proposed Linear Wizard Flow

Keep one modal and one route through it. Do not make separate branches for
producer setup, wallet setup, or advanced configuration.

Proposed steps:

| Step | Title | Primary button | Purpose |
|------|-------|----------------|---------|
| 1 | Network | Next | Confirm which network this observer follows. |
| 2 | Data Folder | Next | Confirm where node data will live. |
| 3 | Bootstrap | Next | Use public bootstrap if available, otherwise continue with peer sync. |
| 4 | Start Observer | Next | Start the node with observer profile and block production disabled. |
| 5 | Done | Finish | Show observer status and enter the app. |

The primary action should be visually consistent and predictable. The button may
show a short progress state such as `Starting...`, but the user-facing flow
should still feel like a single path.

Do not include clickable step navigation. The progress indicator may show the
current step and completed steps, but it should not let the user jump to future
steps.

## Exact Questions Asked At Each Step

Use concise, concrete questions. Avoid explanatory paragraphs unless a status or
error needs context.

### Step 1. Network

Question:

```text
Which network should this observer follow?
```

Controls:

- segmented control or radio group:
  - `Mainnet`
  - `Testnet`

Default:

- `Mainnet`

Validation:

- Custom network remains outside the simple first-run assistant.
- If custom is required later, expose it only from advanced Settings, not from
  this linear first-run flow.

Spanish copy:

```text
Que red debe seguir este observador?
Mainnet
Testnet
```

### Step 2. Data Folder

Question:

```text
Use this folder for node data?
```

Controls:

- folder path display;
- `Choose folder` secondary action;
- `Next` primary action.

Default:

- mainnet: current default `~/.teleno`
- testnet: current default `~/.teleno/testnet/.koinos`

Validation:

- Folder must be writable.
- If the folder contains an existing Koinos One basedir, show that it will be
  reused.
- If the folder contains a producer-enabled config, block the wizard and ask the
  user to choose a different folder or exit first-run. Do not rewrite producer
  config from the installer assistant.

Spanish copy:

```text
Usar esta carpeta para los datos del nodo?
Elegir carpeta
Siguiente
```

### Step 3. Bootstrap

Question:

```text
Use the recommended public bootstrap if it is available?
```

Controls:

- one primary `Next` button;
- passive status:
  - `Checking public bootstrap...`
  - `Public bootstrap available`
  - `No public bootstrap available. The observer will sync from peers.`

Default:

- Use public bootstrap automatically when the network has a configured public
  bootstrap URL and metadata is available.
- If metadata is unavailable or the network has no public bootstrap URL,
  continue with peer sync.

Validation:

- Public bootstrap must be read-only.
- HTTPS remains required where configured.
- Signature and hash verification behavior remains owned by the native public
  restore path.
- Restore output must state that the node remains observer-only.

Spanish copy:

```text
Usar el bootstrap publico recomendado si esta disponible?
Comprobando bootstrap publico...
Bootstrap publico disponible
No hay bootstrap publico disponible. El observador sincronizara desde peers.
```

### Step 4. Start Observer

Question:

```text
Start this node as an observer now?
```

Controls:

- `Next` primary action starts the node.
- Show network, data folder, and bootstrap choice as read-only summary rows.

Runtime action:

- Call the existing observer start path, not producer registration.
- Use `profile:mainnet_observer` or `profile:testnet_observer`.
- Ensure `features.block_producer=false`.
- Do not write `block_producer.producer`.
- Do not read or create `BASEDIR/block_producer/private.key`.
- Do not ask for wallet material.

Spanish copy:

```text
Iniciar este nodo como observador ahora?
El nodo se iniciara con produccion de bloques desactivada.
```

### Step 5. Done

Question:

```text
Observer is running. Continue to Koinos One?
```

Controls:

- `Finish` primary action.
- Show sync status from the existing footer/status model:
  - syncing;
  - current local head;
  - public/reference head when available;
  - peer count when available.

Completion:

- Write first-run completion state only after the observer has started or an
  already-running observer has been detected.

Spanish copy:

```text
El observador esta en ejecucion. Continuar a Koinos One?
```

## Observer-Only Safety Guardrails

Hard requirements:

- The assistant must never call `registerNodeProducer()`.
- The assistant must never call `producerRegister`.
- The assistant must never call wallet create/import/unlock APIs.
- The assistant must never call `useExistingProducerAddressFromSetup()`.
- The assistant must never write `block_producer.producer`.
- The assistant must never enable `features.block_producer`.
- The assistant must never ask for producer address, private key, seed phrase,
  wallet password, VHP, KOIN burn amount, or signing confirmation.
- The assistant must not present producer setup as optional during first-run.
  Producer setup belongs to the Producer tab after the observer is running.

Runtime guard:

- Before starting, derive a `firstRunObserverSettings` object from
  `nodeSettings` with:
  - `profiles: defaultNodeProfilesForNetwork(network)`;
  - no producer address override;
  - no wallet fields;
  - no producer profile mutation.
- `presetReconcile()` must receive only the observer preset ID:
  - `profile:mainnet_observer` for mainnet;
  - `profile:testnet_observer` for testnet.
- If the selected basedir already has `features.block_producer=true`, the
  wizard should block with a plain safety message instead of silently editing
  producer configuration.

Suggested safety message:

```text
This folder already has block production enabled. The installation assistant
only starts observer nodes. Choose another folder or close setup and review this
node from Settings.
```

Spanish:

```text
Esta carpeta ya tiene produccion de bloques activada. El asistente de
instalacion solo inicia nodos observadores. Elige otra carpeta o cierra el
setup y revisa este nodo desde Settings.
```

## Data And Config Written By The Assistant

The assistant may write:

- first-run completion metadata through `completeFirstRunSetup()`;
- selected network;
- selected basedir;
- selected observer profile:
  - `mainnet_observer`;
  - `testnet_observer`;
- public bootstrap restore request state;
- observer-safe runtime config generated by the existing public restore path
  when no target config exists;
- monolith observer feature flags through existing preset reconcile:
  - `features.chain=true`;
  - `features.mempool=true`;
  - `features.block_store=true`;
  - `features.p2p=true`;
  - `features.jsonrpc=true`;
  - `features.grpc=false`;
  - `features.block_producer=false`;
  - `features.contract_meta_store=false`;
  - `features.transaction_store=false`;
  - `features.account_history=false`.

The assistant must not write:

- `block_producer.producer`;
- `block_producer.private-key-file`;
- producer profile files;
- producer wallet files;
- wallet account files;
- VHP or burn settings;
- signing transaction payloads;
- any config value whose purpose is to activate block production.

## UI And i18n Copy Requirements

All visible text introduced or changed for this assistant must be represented in
`src/i18n.ts` for English and Spanish.

Implementation guidance:

- Replace hardcoded strings in `FirstRunSetupModal.tsx` with translation keys.
- Use a `firstRun.*` key namespace.
- Keep Spanish copy internally Spanish. Do not mix "producer", "wallet", or
  "setup" into Spanish strings where clear equivalents exist.
- Keep button labels short:
  - English: `Next`, `Choose folder`, `Finish`, `Close app`.
  - Spanish: `Siguiente`, `Elegir carpeta`, `Finalizar`, `Cerrar app`.
- Do not use visible instructional text about keyboard shortcuts or internal
  implementation details.
- Keep error messages direct and actionable.

Suggested key groups:

```text
firstRun.step.network
firstRun.step.dataFolder
firstRun.step.bootstrap
firstRun.step.startObserver
firstRun.step.done
firstRun.network.question
firstRun.dataFolder.question
firstRun.bootstrap.question
firstRun.start.question
firstRun.done.question
firstRun.action.next
firstRun.action.chooseFolder
firstRun.action.finish
firstRun.error.producerConfigDetected
firstRun.status.bootstrapChecking
firstRun.status.bootstrapAvailable
firstRun.status.bootstrapUnavailable
firstRun.status.observerStarting
firstRun.status.observerRunning
```

## Visual Design Requirements

Preserve the current Koinos One operational UI style:

- Keep the modal/panel structure already used by first-run setup.
- Keep compact summary rows for network, basedir, bootstrap status, and start
  mode.
- Use restrained operational copy, not marketing copy.
- Do not add a landing page or hero section.
- Do not introduce visually heavy cards inside settings-like surfaces.
- Keep controls familiar:
  - segmented control or radio buttons for network;
  - standard folder picker button;
  - status pill/progress component for sync status;
  - one primary button per step.
- At expected desktop window sizes, verify that labels and values do not
  overlap and long basedir paths truncate or wrap cleanly.

## Implementation Tasks By File Or Module

### `src/components/panels/FirstRunSetupModal.tsx`

- Replace `FirstRunSetupStep` with:
  - `network`;
  - `data`;
  - `bootstrap`;
  - `start`;
  - `done`.
- Remove wallet and producer props from the modal contract.
- Remove wallet draft state, wallet password state, existing producer address
  state, and producer registration handlers.
- Remove the `wallet` and `producer` render branches.
- Add the network confirmation step.
- Keep public bootstrap checking/restoring, but make it a linear automatic
  step with one primary action.
- Make progress steps non-clickable.
- Gate completion on observer running or observer start success.
- Route all visible text through `t()`.

### `src/App.tsx`

- Stop passing producer and wallet callbacks into `FirstRunSetupModal`.
- Keep `startObserverNodeFromSetup()` and tighten it as the only first-run
  runtime launcher.
- Ensure the setup completion payload records:
  - `completedFrom: 'observer-install-assistant'`;
  - network;
  - basedir;
  - observer profile;
  - whether public bootstrap was used.
- Add a basedir safety check before start if existing config has
  `features.block_producer=true`.

### `src/i18n.ts`

- Add `firstRun.*` English and Spanish keys.
- Remove stale first-run producer wording from the setup flow.
- Keep Producer tab copy separate and unchanged unless a string incorrectly
  implies producer setup happens during first-run.

### `src/components/panels/FirstRunSetupModal.test.tsx`

- Replace producer-oriented expectations with observer-only tests.
- Add tests that assert:
  - the wizard asks the five concrete questions;
  - no "producer address", "register", "VHP", "burn", "wallet password", or
    "seed phrase" text appears in first-run;
  - progress steps are not clickable navigation buttons;
  - bootstrap unavailable still advances along the same path;
  - completion is disabled until observer start succeeds;
  - observer sync status appears after start.

### `electron/main.ts`

- No broad rewrite expected.
- Confirm `profile:mainnet_observer` and `profile:testnet_observer` keep
  `featureFlags.block_producer=false`.
- Add or keep tests around `telenoNodePresetReconcile()` proving observer
  presets do not invoke producer preflight and do not write producer fields.

### `electron/lib/network-profiles.ts`

- Keep default profiles observer-only:
  - mainnet: `mainnet_observer`;
  - testnet: `testnet_observer`.
- Do not expose producer profiles through first-run.

### `src/styles.css`

- Reuse existing first-run classes where possible.
- Only add small layout rules needed for the network selector and non-clickable
  progress indicator.
- Verify text fit for long basedir paths and bootstrap snapshot identifiers.

## Validation Plan

Static checks:

- `rg -n "producer|VHP|burn|wallet password|seed phrase|register" src/components/panels/FirstRunSetupModal.tsx`
  should return no first-run visible setup copy after implementation.
- `rg -n "firstRun\\." src/i18n.ts` should show matching English and Spanish
  keys.
- Search first-run code for forbidden calls:
  - `registerNodeProducer`;
  - `producerRegister`;
  - `useExistingProducerAddress`;
  - wallet create/import/unlock callbacks.

Frontend tests:

- Update and run:

```bash
npm test -- FirstRunSetupModal
```

- If the project test runner uses a different filter, use the nearest existing
  Vitest command for that file.

Electron/unit tests:

- Add or update tests proving observer preset reconcile writes
  `features.block_producer=false`.
- Add or update tests proving first-run observer start does not write
  `block_producer.producer`.

Manual app verification:

- Launch the app with first-run incomplete.
- Confirm the path is:

```text
Network -> Data Folder -> Bootstrap -> Start Observer -> Done
```

- Confirm all primary actions advance linearly.
- Confirm public bootstrap unavailable is shown as guidance, not a raw error.
- Confirm the node starts with observer profile.
- Confirm block production remains disabled.
- Confirm there is no producer, wallet, VHP, burn, or signing prompt in the
  first-run assistant.
- Switch language to Spanish and repeat the flow enough to verify all first-run
  strings are translated.

Native runtime verification:

- Start mainnet observer from first-run and inspect generated config:

```text
features.block_producer: false
```

- Repeat for testnet observer.
- If a public bootstrap restore is used, confirm restore metadata still reports
  observer-first behavior and the first start keeps block production disabled.

## Risks And Rollback Plan

Risks:

- Removing wallet/producer steps may leave stale props or callbacks in
  `App.tsx`.
- Existing tests may still assert producer setup content in first-run.
- Hardcoded strings may remain outside `src/i18n.ts`.
- A reused basedir with producer config could be started accidentally if safety
  detection is not added.
- Public bootstrap unavailable states can become confusing if the linear flow
  hides too much detail.

Mitigations:

- Keep producer setup fully available from the Producer tab after first-run.
- Add a forbidden-copy test for first-run.
- Add an observer preset test for `features.block_producer=false`.
- Block reused producer-enabled basedirs instead of silently changing producer
  config.
- Keep public bootstrap status visible while preserving one primary path.

Rollback:

- Revert the first-run modal and i18n changes as a single UI rollback.
- Leave native observer preset and public bootstrap behavior unchanged.
- If a release candidate shows confusion, keep first-run disabled behind the
  existing first-run completion reset path and let users start observers from
  Settings/Node while the assistant is revised.

## Completion Criteria

The implementation is complete only when:

- First-run setup contains no producer setup step.
- First-run setup contains no wallet/signing step.
- The only runtime launch path starts an observer.
- `features.block_producer=false` is enforced for first-run starts.
- All visible first-run strings live in `src/i18n.ts` in English and Spanish.
- The UI remains visually consistent with current Koinos One operational
  surfaces.
- Tests cover the linear flow and observer-only guardrails.
- Manual verification confirms `Next -> Next -> Next` without producer prompts.
