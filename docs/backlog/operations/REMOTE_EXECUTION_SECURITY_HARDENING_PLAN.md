# Remote Execution Security Hardening Plan

- Date: 2026-07-05
- Scope: Electron remote-node execution, command-plan validation, prodnet
  observer gates, receipt persistence, and remote output redaction
- Status: implementation plan
- Source: defensive review of `audit.md` received 2026-07-03, rechecked
  against `origin/main` at `92f65fe`

## Problem

The Remote Nodes MVP currently treats the renderer as a cooperative caller. The
main process validates the command text it receives, but it does not regenerate
the plan from trusted local inventory before execution. It also executes each
renderer-supplied command through a local shell.

This creates two high-risk failure modes:

- A compromised renderer can submit a command string that starts with the
  expected SSH heredoc prefix but includes additional local shell commands after
  the heredoc body.
- Prodnet observer gates can be satisfied with renderer-supplied node fields
  and renderer-supplied marker lines instead of evidence regenerated and checked
  in the main process.

The issue is local desktop security, not consensus safety. The desktop is still
high value because it may hold wallets, SSH config, release credentials, or
operator inventory.

## Confirmed Evidence

- `electron/lib/remote-node-service.ts` validates executable steps with
  `command.startsWith("ssh ... <<'TELENO_REMOTE'\n")`, not a complete parsed
  command structure.
- `electron/lib/remote-node-service.ts` runs the full command with
  `spawn('/bin/bash', ['-c', command])`.
- `electron/main.ts` passes the IPC payload directly into
  `remoteNodeExecutionService.executeRemoteCommandPlan(...)`.
- `src/app/remote-nodes.ts` owns canonical plan generation, but that generation
  happens in renderer-owned code.
- Prodnet evidence checks in `electron/lib/remote-node-service.ts` inspect
  supplied node fields plus marker strings in supplied step text.
- Receipt append IPC can persist arbitrary renderer-provided receipt objects
  through `telenoStorage.appendRemoteReceipt(...)`.

## Goals

1. Treat the renderer as untrusted for remote execution.
2. Ensure Electron main regenerates the canonical remote command plan from
   persisted local inventory and the requested `(nodeId, action)`.
3. Remove local shell interpretation from the executor.
4. Keep prodnet observer mutation narrow, explicit, and evidence-backed.
5. Keep all receipt and streamed output redacted at the persistence boundary.
6. Preserve the current simple-mode user experience and exact human
   confirmations.

## Non-Goals

- Do not add producer activation, wallet signing, VHP burns, registration, or
  other chain-mutating remote workflows.
- Do not introduce provider API provisioning.
- Do not expose private hostnames, raw IP addresses, SSH users, tokens, wallet
  data, or local inventory in committed docs, tests, screenshots, or receipts.
- Do not make prodnet fleet/batch mutation available.

## Implementation Plan

### 1. Narrow the IPC Contract

Replace execution IPC input with a minimal request:

```ts
type RemoteExecutionIpcRequest = {
  nodeId: string
  action: RemoteNodeAction
  confirmation: string
}
```

Electron main should ignore renderer-supplied `node`, `plan`, `steps`,
`trust`, `runtime`, and command text for execution. The renderer may still show
its preview plan for UX, but the executed plan must be regenerated in main.

Update:

- `electron/preload.ts`
- `electron/lib/ipc-handlers.ts`
- `electron/main.ts`
- `src/components/panels/RemoteNodesPanel.tsx`
- `src/teleno-electron.d.ts`

### 2. Move Canonical Plan Generation Into Shared Main-Safe Code

Make plan generation usable from Electron main without importing React or
browser-only modules. Prefer one of these approaches:

- Keep `src/app/remote-nodes.ts` framework-neutral and import it from main.
- Or move shared remote inventory and plan-generation logic into
  `electron/lib/remote-node-plans.ts` and re-export browser-safe helpers.

Main execution flow:

1. Load persisted inventory with `telenoStorage.loadRemoteInventory()`.
2. Find the requested node by `nodeId`.
3. Regenerate `generateRemoteCommandPlan(inventory, nodeId, action)`.
4. Validate the regenerated plan.
5. Compute confirmation from the regenerated node and action.
6. Execute only the regenerated steps.

The returned receipt should include a flag such as
`planRegeneratedInMain: true` so later audits can distinguish hardened
receipts from legacy receipts.

### 3. Replace Shell Execution With SSH Args And Stdin

Change the executor model from "command string" to structured SSH invocation:

```ts
type RemoteExecutionStep = {
  connectionRef: string
  stdinScript: string
  phase: RemoteExecutionPhase
  destructive?: boolean
  hostMutation?: boolean
  chainMutation?: boolean
}
```

Execution should call:

```ts
spawn('ssh', ['--', connectionRef, 'bash', '-se'], {
  stdio: ['pipe', 'pipe', 'pipe']
})
```

Then write the reviewed script to `child.stdin` and close stdin. This removes
the local shell, so text after a heredoc delimiter cannot run on the operator's
Mac.

Keep a sanitized command preview for the UI, but make it display-only and
derive it from structured step fields.

### 4. Harden Inventory Field Normalization

Reject command-plan inputs containing control characters before command
generation:

- Newline and carriage return in SSH aliases, service names, image refs,
  base paths, config paths, bootstrap URLs, proof refs, and policy IDs.
- The literal heredoc/config delimiters currently used in generated scripts.
- Leading `-` in SSH aliases.
- Raw `user@host`, raw hostnames, and raw IP values in `connectionRef`.

Keep provider metadata import stricter than manual local alias entry. Provider
imports should continue collapsing or rejecting secret-looking fields.

### 5. Make Prodnet Evidence Real

Prodnet observer mutation should require evidence generated in main from local
state, not supplied by the renderer.

Minimum hardening:

- Match `prodnetObserverProofRef` to an existing local receipt with status
  `succeeded`, matching node id, action `prodnet-observer-proof`, and
  observer-only health evidence.
- Compute the bootstrap policy digest from the actual policy content or a
  committed policy document, not from a static placeholder string.
- For Docker artifacts, require a pinned image digest and record the pulled
  RepoDigest in the receipt.

Future production gate:

- Allow prodnet observer mutation only for signed or allowlisted artifacts once
  release signing is available.
- Require signed prodnet public-bootstrap metadata before the UI presents that
  path as production-ready.

### 6. Redact At Receipt Persistence

`appendRemoteReceipt` should sanitize any object it receives, even if called
directly from renderer IPC. Redaction should cover:

- WIF-like values
- Base58 Koinos addresses and public keys where they appear near sensitive
  labels
- Peer IDs in multiaddrs when logs are intended to be host-private
- Hostnames not preceded by `host:` or `user@`
- IPv6 forms
- Bearer tokens without adjacent keyword labels

The executor should still redact live output before progress events. The
storage layer is the final guardrail.

### 7. Serialize Main-Side Execution

Add an Electron-main execution lock keyed by node id. The first implementation
can be process-local:

- One active remote execution at a time per node.
- Fleet rollout remains sequential.
- Return a clear blocked result when a second request targets the same node.

Receipt writes should be atomic and should avoid unlocked read-modify-write
lost updates.

## Tests

### Unit Tests

- Renderer-supplied command text is ignored when executing.
- Main regenerates the plan from persisted inventory.
- A command with valid SSH prefix plus trailing local shell text does not run.
- Newline-containing fields are rejected before plan generation.
- SSH aliases with a leading `-` are rejected.
- Prodnet proof ref must match a prior local receipt.
- Direct `appendRemoteReceipt` redacts sensitive-looking receipt fields.
- Concurrent execution for the same node returns a blocked result.

### Integration Tests

- Electron IPC test with real preload bridge:
  - save sanitized testnet inventory;
  - preview plan in renderer;
  - execute by sending only node id, action, and confirmation;
  - verify the receipt records `planRegeneratedInMain`.
- Mock runner test proving stdin is passed to `ssh` and no `/bin/bash -c` is
  invoked.

### Regression Tests

- Existing remote-node simple-mode and expert-mode Playwright screenshots still
  pass.
- Existing VPS/testnet opt-in validation still works with a sanitized SSH alias.

## Acceptance Criteria

- `electron/lib/remote-node-service.ts` no longer invokes `/bin/bash -c` for
  remote execution.
- `teleno:remote-nodes:execute-plan` no longer accepts executable step text
  from the renderer.
- Main-side execution can be explained as:
  "load inventory, regenerate plan, validate regenerated plan, check exact
  confirmation, spawn ssh, pipe script over stdin."
- Prodnet observer mutation cannot be authorized by fabricated renderer-only
  marker strings.
- Receipts persisted through any IPC path are sanitized.
- Test coverage includes at least one failed exploit attempt for the old
  heredoc-prefix bypass.

## Release Gate

Before enabling any broader remote-node release:

1. Run `npm test`.
2. Run Electron IPC/Playwright remote-node coverage.
3. Run the opt-in sanitized real SSH validation against a disposable testnet
   observer target.
4. Confirm no generated receipts, screenshots, or test artifacts contain raw
   hostnames, raw IPs, SSH users, tokens, wallet data, or producer addresses.
