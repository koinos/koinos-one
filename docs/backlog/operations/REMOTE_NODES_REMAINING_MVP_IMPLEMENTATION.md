# Remote Nodes Remaining MVP Implementation

- Date: 2026-06-29
- Scope: remaining Remote Nodes hardening after the VPS1 real GUI/IPC
  validation
- Status: implementation tracking for the current safe MVP; private inventory
  values are intentionally omitted

## Safety Boundaries

- Prodnet/mainnet mutation remains blocked.
- Producer activation remains unavailable.
- Real remote mutation is testnet-only unless the operation is read-only.
- Remote execution is one selected node at a time.
- Inventory, receipts, logs, screenshots, and public docs must not contain raw
  hostnames, IPs, SSH users, ports, producer addresses, tokens, wallet data,
  private keys, or provider credentials.
- Cleanup and rollback are executable only for explicitly selected testnet
  observers when strong confirmation, prior evidence, DB preservation, and
  stop-criteria gates pass.
- State DB is preserved on merkle mismatch, restore failure, digest mismatch,
  interrupted restore, or unknown recovery status.

## Remaining MVP Checklist

### 1. Cleaner Repeatable VPS1 Testnet E2E

Implemented:

- The opt-in VPS1 test handles clean install, restored-but-not-running resume,
  already-running status, and explicit restart reconciliation branches.
- The test stores only a sanitized inventory record and uses a local-only SSH
  alias wrapper for private connection details.
- Existing restored state is never deleted or overwritten automatically.

Remaining risk:

- The fresh disposable target validation is complete for this MVP. Future
  release work should add richer public-restore percentage mapping so long
  restore jobs show byte or batch progress inside each streamed step.

### 2. Human Progress UX

Implemented:

- Simple mode now shows an ordered operation phase list with non-shell
  descriptions for preflight, artifact, prepare, config, bootstrap, runtime,
  verify, diagnostics, rollback, and cleanup.
- Electron remote execution now emits sanitized per-step progress events over
  `teleno:remote-nodes:execution-progress:event` while SSH is still running.
- Each progress event includes a plan id, node id, action, step index/count,
  phase, status, timestamps, exit code when known, health snapshot when
  available, and a sanitized output excerpt.
- The real preload bridge exposes `remoteNodes.onExecutionProgressEvent()`, and
  the Remote panel subscribes to it.
- Simple mode updates live with queued, running, succeeded, failed, blocked,
  and skipped phase states without showing shell output.
- Expert mode can show sanitized per-step output excerpts and receipt step
  summaries.
- Execution receipts now include sanitized per-step summaries, so a failed or
  blocked plan records the step that stopped execution and the later skipped
  steps.
- Expert mode keeps raw generated commands visible only when advanced mode is
  enabled.

Future hardening:

- Map native public bootstrap JSON progress into richer bootstrap subprogress
  percentages without exposing raw remote paths or host details.

### 3. Rollback And Cleanup Safety

Implemented:

- Rollback and cleanup are no longer merely review-only for safe testnet
  observer cases.
- The required confirmation phrase for rollback and cleanup includes
  `PRESERVE_DB`.
- Prodnet/mainnet rollback and cleanup mutation remains blocked by renderer and
  Electron execution gates.
- Rollback requires prior remote rollback evidence before mutation:
  a previous reviewed artifact reference and previous observer config under the
  node's local rollback evidence area.
- Cleanup requires prior receipt evidence before mutation.
- Both flows write DB-preservation evidence before any runtime or temporary-file
  mutation.
- Rollback stops/removes only the selected observer runtime container, restores
  the previous observer config, starts the previous reviewed artifact with the
  existing BASEDIR mounted, verifies producer disabled, and writes a sanitized
  receipt.
- Cleanup lists candidates first, then removes only non-state temporary
  candidates. Chain, blockchain, state, config, wallet, and producer paths are
  protected and trigger stop criteria if selected.
- State DB is preserved on merkle mismatch, restore failure, digest mismatch,
  unknown state, missing evidence, interrupted restore, or protected cleanup
  path detection.
- Receipts include streamed per-step summaries, skipped steps, stop criteria,
  and sanitized DB-preservation evidence.

Remaining risk:

- Rollback depends on prior local evidence files being created by an earlier
  safe workflow or operator-approved preparation step. Automatic artifact
  history capture should be improved before production observer rollback is
  allowed.
- Cleanup intentionally does not reclaim chain/state DB space. Deep DB
  compaction or state pruning remains separate future work.

### 4. Multi-Node Flow

Implemented:

- Multi-node actions expand into per-node command plans.
- Expert UI states that multi-node operations are reviewed per node and still
  execute one node at a time.

Future gate:

- Add a batch review screen only after single-node execution receipts are
  stable enough to compose into a fleet rollout receipt.

### 5. Provider-Neutral Server Integration

Implemented:

- The Remote panel keeps the bring-your-own-server checklist provider-neutral.
- It tells operators to use a local SSH alias, keep JSON-RPC/admin private, and
  avoid provider tokens or raw server addresses.

Future gate:

- Provider adapters may import existing instance metadata later, but must store
  provider tokens only in OS keychain/session storage or an external secret
  manager reference.

### 6. Prodnet Observer Path

Implemented:

- Prodnet/mainnet mutation remains blocked in renderer and Electron gates.
- Prodnet health/log plans are still read-only and require exact confirmation.

Future gate:

- Prodnet observer install requires signed artifact identity, disk preflight,
  explicit public bootstrap trust policy, read-only dry-run proof, and a fresh
  operator confirmation.

### 7. Artifact Hardening

Implemented:

- Install and upgrade plans now emit Docker artifact identity evidence through
  `TELENO_ARTIFACT_IMAGE` with image ID and repository digest data when
  available.
- Docker artifact evidence also records the reviewed expected version when it
  is known, or `unspecified` when the current record still uses a placeholder.
  Executable plans do not carry placeholder version strings.
- Receipts retain sanitized command output so artifact evidence can be audited
  without exposing private infrastructure.

Future gate:

- Require reviewed digest pinning before allowing production observer mutation.

### 8. Health And Sync Intelligence

Implemented:

- Health checks emit explicit signals for missing seed peers, no connected
  peers, no sampled head progress, sampled head progress, public exposure, and
  stop criteria.
- Renderer and Electron health parsers classify no seed peers, no connected
  peers, and no sampled head progress as `degraded` with actionable summaries.
- Public JSON-RPC/admin exposure, producer enabled, chain mismatch, restore
  failure, digest mismatch, disk floor failure, and state merkle mismatch remain
  stop criteria.

Future gate:

- Compare remote head against a trusted network head source only when the source
  is configured and privacy-safe for the selected network.

### 9. Practical Operator Guide

Simple mode:

1. Add one server using a friendly label and a local SSH alias.
2. Keep the suggested BASEDIR unless there is a deliberate disk layout.
3. Use "Restore backup and start observer" for a fresh testnet observer.
4. Review the phase list.
5. Type the exact confirmation phrase only for the selected node.
6. Wait for a sanitized receipt.
7. Use "Check health" to confirm running/syncing/healthy state.

Expert mode:

1. Review generated commands and diagnostics.
2. Confirm only one selected testnet node at a time.
3. Treat rollback and cleanup as destructive expert actions that require
   `PRESERVE_DB`, prior evidence, DB-preservation receipts, and stop-criteria
   checks.
4. Use status/logs for prodnet diagnostics; do not mutate prodnet.
5. Inspect receipts for sanitized artifact, runtime, health, and stop-criteria
   evidence.

Failure interpretation:

- `Needs server`: fix the SSH alias or host reachability.
- `Needs space`: choose a larger disk or safer BASEDIR before restore.
- `Degraded`: check peers, seed peers, P2P firewall, or head progress.
- `Unsafe`: stop and review exposure, producer, chain, or stop criteria.
- `Failed`: use expert diagnostics; do not delete state without an explicit
  recovery plan.

## Sanitized Live Evidence

- 2026-06-29 VPS1 clean testnet E2E:
  - one fresh disposable testnet observer alias was selected;
  - the reviewed local plan was unblocked, observer-only, used the public
    bootstrap restore path, kept JSON-RPC/admin loopback-only, mapped P2P
    through the reviewed Docker port mapping, and included guards for existing
    BASEDIR, existing container, port conflicts, producer enablement, public
    exposure, digest mismatch, restore failure, chain mismatch, and state
    merkle mismatch;
  - read-only preflight confirmed the disposable BASEDIR and container were
    absent before mutation, required server software was available, disk was
    above the testnet floor, and the reviewed ports were free;
  - real Electron/IPC execution performed install, public-bootstrap restore,
    observer start, and receipt capture for the selected testnet observer;
  - a post-run verifier path bug was found and fixed: the helper checked a
    literal `$HOME` path instead of the expanded remote home path after the
    install had completed;
  - the same selected observer then passed real Electron/IPC status
    verification with a sanitized JSON receipt, head-progress signal, public
    bootstrap config, producer disabled, no stop criteria, and no public
    JSON-RPC/admin exposure;
  - a follow-up read-only runtime probe verified the actual Docker P2P mapping,
    testnet config, local JSON-RPC health, head-info response, and
    producer-disabled state;
  - screenshots were captured under `.run/remote-node-ui-screenshots/`, and a
    sanitized receipt JSON was written there for the status verification.
- LAN Server validation remained read-only and did not mutate services.
- VPS1 validation used one sanitized local SSH alias and one disposable testnet
  observer BASEDIR.
- The VPS1 observer was restored from public bootstrap, started as observer,
  reconciled with seed peers, verified with connected-peer and head-progress
  signals, and left with producer disabled.
- No prodnet/mainnet mutation was performed.
- No unrelated service was stopped, cleaned, overwritten, or restarted.

## Test Coverage Added Or Required

Implemented coverage:

- inventory normalization and duplicate gates;
- command generation for Docker mapping, seed peers, artifact evidence, and
  DB-preserving rollback/cleanup;
- artifact evidence without executable placeholders;
- renderer execution gates for prodnet, destructive confirmation, placeholders,
  unsafe public binds, and producer mode;
- Electron execution gates, destructive evidence checks, and receipt
  sanitization;
- health parsing for no peers/no head progress degraded states;
- stop-criteria parsing for chain ID mismatch, digest mismatch, state merkle
  mismatch, public exposure, and producer-enabled unsafe states;
- Remote UI simple/expert visibility and simple operation phases;
- streamed per-step remote execution events, output redaction, failure stop,
  skipped-step summaries, and blocked-step receipts;
- real Electron preload/IPC exposure for remote execution progress through a
  read-only fake-alias validation path;
- expert UI visibility and gating for DB-preserving rollback confirmation;
- opt-in VPS1 real Electron/IPC E2E branches.

Future coverage:

- provider adapter skeleton tests if an adapter is introduced;
- fresh clean VPS1 disposable install receipt after explicit approval.

## Current Local Validation

Last run: 2026-06-29.

- `npm test -- src/app/remote-nodes.test.ts src/app/remote-node-execution.test.ts electron/lib/remote-node-service.test.ts src/components/panels/RemoteNodesPanel.test.tsx electron/lib/ipc-handlers.test.ts electron/lib/teleno-storage.test.ts`
  passed with 64 focused tests.
- `npm run build` passed for renderer and Electron TypeScript.
- `TELENO_PLAYWRIGHT_ELECTRON=1 npx playwright test --config=playwright.electron.config.ts tests/ui/electron-remote-nodes.spec.ts`
  passed through the real Electron preload/IPC path, including live progress
  subscription exposure, a read-only fake-alias progress validation, and
  expert rollback `PRESERVE_DB` gating.
- `TELENO_PLAYWRIGHT_ELECTRON=1 TELENO_REMOTE_VPS1_TESTNET_INSTALL_E2E=1 npx playwright test --config=playwright.electron.config.ts tests/ui/electron-remote-nodes-vps1-testnet-install.spec.ts`
  performed the fresh testnet observer install/restore/start path on the
  selected disposable VPS1 target. A follow-up run against the same target
  passed the already-running status branch after the verifier path fix.
- Live remote mutation during this validation was limited to the selected VPS1
  testnet observer target. No prodnet/mainnet mutation was performed.
