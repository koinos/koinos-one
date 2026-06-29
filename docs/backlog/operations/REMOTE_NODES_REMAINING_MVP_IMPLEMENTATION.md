# Remote Nodes Remaining MVP Implementation

- Date: 2026-06-28
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
- Cleanup and rollback are review-only in this MVP. Execution is future-gated.
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

- A fully clean install receipt should be captured again on a fresh disposable
  node alias when a new empty target is explicitly approved.

### 2. Human Progress UX

Implemented:

- Simple mode now shows an ordered operation phase list with non-shell
  descriptions for preflight, artifact, prepare, config, bootstrap, runtime,
  verify, diagnostics, rollback, and cleanup.
- Expert mode keeps raw generated commands visible only when advanced mode is
  enabled.

Future hardening:

- Add real streaming per-step IPC progress instead of updating the UI only when
  the command plan returns.

### 3. Rollback And Cleanup Safety

Implemented:

- Rollback and cleanup command plans are review-only and do not stop services,
  remove containers, remove directories, or delete state.
- Cleanup execution remains unavailable.
- Rollback execution is now also unavailable in the execution gates.
- Cleanup copy explicitly says to preserve state on merkle mismatch, restore
  failure, digest mismatch, or interrupted restore.

Future gate:

- Real rollback/cleanup execution requires a separate design with artifact
  history, state preservation checks, explicit downtime confirmation, and
  receipts.

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
3. Treat rollback and cleanup as review-only.
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
  review-only rollback/cleanup;
- artifact evidence without executable placeholders;
- renderer execution gates for prodnet, rollback, cleanup, placeholders,
  unsafe public binds, and producer mode;
- Electron execution gates and receipt sanitization;
- health parsing for no peers/no head progress degraded states;
- stop-criteria parsing for chain ID mismatch, digest mismatch, state merkle
  mismatch, public exposure, and producer-enabled unsafe states;
- Remote UI simple/expert visibility and simple operation phases;
- opt-in VPS1 real Electron/IPC E2E branches.

Future coverage:

- real streaming progress IPC;
- provider adapter skeleton tests if an adapter is introduced;
- fresh clean VPS1 disposable install receipt after explicit approval.

## Current Local Validation

Last run: 2026-06-28.

- `npm test -- src/app/remote-nodes.test.ts src/app/remote-node-execution.test.ts electron/lib/remote-node-service.test.ts src/components/panels/RemoteNodesPanel.test.tsx`
  passed with 38 focused tests.
- `npm run build` passed for renderer and Electron TypeScript.
- `TELENO_PLAYWRIGHT_ELECTRON=1 npx playwright test --config=playwright.electron.config.ts tests/ui/electron-remote-nodes.spec.ts`
  passed through the real Electron preload/IPC path.
- No live remote mutation was performed during this validation pass.
