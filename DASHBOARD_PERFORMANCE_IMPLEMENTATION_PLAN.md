# Dashboard Performance Tab Implementation Plan

## Status
- Branch: `codex/wallet-tab-integration-plan`
- Purpose: define the implementation plan for a new `Performance` subtab inside `Dashboard`
- Scope of this document: show how Knodel can expose system and process resource consumption for the app and all running microservices

## 1. Problem to Solve
Today, `Dashboard` shows:
- producer activity
- peer activity
- producer forecast metrics

What is missing is runtime visibility:
- how much CPU and memory Knodel itself is using
- how much CPU and memory each running microservice is using
- how much of the host system is currently being consumed overall

The goal is to add a `Performance` subtab that gives a real-time operational view without blocking the UI.

## 2. Current Baseline
- `Dashboard` already supports multiple subtabs in [src/components/panels/DashboardPanel.tsx](/Users/pgarcgo/code/knodel/src/components/panels/DashboardPanel.tsx).
- Renderer polling for dashboard data already exists in [src/App.tsx](/Users/pgarcgo/code/knodel/src/App.tsx).
- Electron main process already tracks native microservice status and knows each service `nativePid` in [electron/main.ts](/Users/pgarcgo/code/knodel/electron/main.ts).
- The Electron bridge pattern for dashboard data already exists through `dashboardProducers` and `dashboardPeers`.

This means the right extension point already exists. The missing part is performance sampling.

## 3. Objectives
- Add a new `Performance` subtab under `Dashboard`.
- Show host-level system usage relevant to Knodel operation.
- Show per-process resource consumption for:
  - Knodel Electron processes
  - running native Koinos microservices managed by Knodel
- Refresh the data asynchronously in the background using the existing dashboard refresh interval.
- Keep the renderer thin and perform resource inspection only in Electron main.

## 4. Recommended Architecture
- Collect all performance snapshots in `electron/main.ts`.
- Expose one new typed IPC endpoint:
  - `koinosNode.dashboardPerformance()`
- Keep the renderer responsible only for:
  - requesting the snapshot
  - storing the latest result
  - rendering cards and tables

### Why this is the best fit
- Electron main already has service lifecycle and PID ownership data.
- Renderer should not shell out to `ps`, inspect PIDs, or access OS-level process metrics directly.
- The pattern matches the current Dashboard design and minimizes architectural drift.

## 5. Data Sources
Use two classes of data sources.

### 5.1 Knodel app processes
Use Electron's built-in:
- `app.getAppMetrics()`

This should provide metrics for:
- main process
- renderer process
- GPU process
- utility processes when present

### 5.2 Native microservices
Use existing native runtime process tracking:
- service status already exposes `nativePid`

For each live PID, sample with:
- `ps`

Suggested command shape on macOS/Linux:
- `ps -o pid=,%cpu=,rss=,vsz=,etime=,state=,command= -p <pid>`

Fields to capture:
- `pid`
- `%cpu`
- `rss`
- `vsz`
- `etime`
- `state`
- `command`

### 5.3 Host snapshot
Use Node `os` APIs for host-level context:
- `os.cpus().length`
- `os.totalmem()`
- `os.freemem()`
- `os.loadavg()`
- `os.uptime()`

## 6. Phase 1 Scope
Phase 1 should be intentionally simple and useful.

### In scope
- live snapshot only
- no historical storage
- no charts
- native runtime services only
- one table with per-process metrics
- a few top summary cards

### Out of scope
- Docker stats integration
- historical sparklines
- per-core CPU graphs
- disk I/O and network I/O
- alerting thresholds

## 7. Proposed Backend Contract
Add a new result type in Electron main and the preload/renderer type definitions.

### Suggested result shape
- `ok: boolean`
- `output: string`
- `sampledAt: number`
- `host:`
  - `cpuCount: number`
  - `totalMemoryBytes: number`
  - `freeMemoryBytes: number`
  - `loadAverage: number[]`
  - `uptimeSeconds: number`
- `totals:`
  - `knodelCpuPercent: number | null`
  - `knodelMemoryBytes: number | null`
  - `servicesCpuPercent: number | null`
  - `servicesMemoryBytes: number | null`
- `rows: DashboardPerformanceRow[]`

### Suggested row shape
- `id: string`
- `label: string`
- `kind: 'knodel' | 'service'`
- `serviceId: string | null`
- `pid: number | null`
- `cpuPercent: number | null`
- `rssBytes: number | null`
- `virtualBytes: number | null`
- `uptimeSeconds: number | null`
- `state: string | null`
- `command: string | null`
- `managedByKnodel: boolean`

## 8. Backend Implementation Plan
1. Add new types in `electron/main.ts`.
2. Add new types to `src/knodel-electron.d.ts`.
3. Expose the IPC in `electron/preload.ts`.
4. Implement `dashboardPerformance(settings?)` in `electron/main.ts`.

### Implementation details
1. Resolve current node status using existing native service status path.
2. Extract active managed service PIDs from service rows that contain `nativePid`.
3. Sample host metrics with `os`.
4. Sample Knodel process metrics from `app.getAppMetrics()`.
5. Sample service metrics by PID using `ps`.
6. Normalize everything into one flat list of rows.
7. Compute totals for:
   - Knodel group
   - service group
8. Return a single snapshot even if some PIDs fail.

### Important behavior
- If one process disappears between status read and `ps`, do not fail the whole response.
- Mark that row as partial or return null fields.
- The endpoint should degrade gracefully.

## 9. Renderer Implementation Plan
### State
Add new state in `src/App.tsx`:
- `dashboardPerformance`
- `dashboardPerformanceLoading`
- `dashboardPerformanceError`

### Refresh function
Add:
- `refreshDashboardPerformance()`

Then extend `refreshDashboardCurrentSubtab()` so:
- `producers` refreshes producer dashboard
- `peers` refreshes peers
- `forecast` refreshes forecast data
- `performance` refreshes the performance snapshot

### Polling
Reuse the existing dashboard refresh interval.

Do not add a new setting in phase 1.

## 10. UI Plan
Add a fourth Dashboard subtab:
- `Performance`

### Top cards
Show:
- `Knodel CPU`
- `Knodel RAM`
- `Services CPU`
- `Services RAM`
- `Free system RAM`
- `Last sample`

### Main table
Columns:
- `Name`
- `Kind`
- `PID`
- `CPU %`
- `RAM`
- `Virtual`
- `Uptime`
- `State`

### Recommended sort
Default sort by:
1. highest CPU
2. then highest RSS

This makes the most useful rows visible first.

## 11. Formatting Helpers
Likely add or reuse formatting helpers in `src/app/utils.tsx`:
- bytes to MB/GB
- CPU percentage formatting
- uptime formatting

Keep formatting logic centralized, not inside the panel JSX.

## 12. Docker Runtime Follow-Up
Phase 1 should target native runtime only because that is what Knodel currently manages directly.

For future Docker support:
- detect `runtimeType === 'docker'`
- use `docker stats --no-stream --format ...`
- normalize the output into the same `DashboardPerformanceRow`

This should be phase 2 or later, not part of the first delivery.

## 13. Testing Plan
### Unit tests
- parser for `ps` row output
- total aggregation logic
- formatting helpers for bytes, uptime, CPU

### Integration tests
- `dashboardPerformance()` returns valid empty state when no services are running
- `dashboardPerformance()` tolerates missing/exited PID
- renderer subtab switches correctly and displays rows

### Manual smoke test
- start a subset of services
- verify CPU/RAM rows appear for each service with `nativePid`
- verify Knodel Electron processes also appear
- verify repeated refresh does not block the UI

## 14. Risks and Mitigations
- Risk: CPU percentages from different sources are not directly comparable.
  - Mitigation: label CPU as process CPU percent and avoid pretending it is normalized against full system unless confirmed.

- Risk: process sampling may be platform-specific.
  - Mitigation: implement a macOS/Linux-compatible `ps` parser first and isolate it in one helper.

- Risk: short-lived processes may disappear during sampling.
  - Mitigation: tolerate partial rows and never fail the whole snapshot.

- Risk: renderer flicker if each refresh clears the current data first.
  - Mitigation: keep the previous snapshot visible until the new one arrives.

## 15. Delivery Phases
1. Phase 1: backend snapshot + typed bridge
2. Phase 2: Dashboard `Performance` subtab UI
3. Phase 3: sorting, formatting, and empty/error states
4. Phase 4: tests and hardening
5. Phase 5: optional Docker provider and historical charts

## 16. Acceptance Criteria
- `Dashboard` contains a `Performance` subtab.
- The subtab shows Knodel and microservice resource usage in one live snapshot.
- The data refreshes in the background using the current dashboard interval.
- The UI remains usable while refresh happens.
- Native service rows resolve from the real `nativePid` values already managed by Knodel.
- Missing or exited PIDs do not break the whole panel.

## 17. Recommended First Implementation
Implement only:
- native services
- Electron app metrics
- host RAM/load context
- cards + sortable table

This will deliver immediate operational value with low implementation risk and strong alignment with the current codebase.
