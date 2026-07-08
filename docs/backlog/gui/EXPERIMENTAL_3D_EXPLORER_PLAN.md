# Experimental 3D Explorer — Implementation Plan

Status: planned (backlog). Nothing in this document is implemented yet.

## Goal

A game-like, smooth, GPU-accelerated 3D scene inside Koinos One that visualizes
the life of transactions in real time: broadcast through API nodes, waiting in
the mempool, being selected and ordered by the producer, sealed into a signed
block, and validated onto the chain. It lives inside the existing Explorer tab
as an experimental sub-view called **3D Explorer**.

## What the app can actually observe (data honesty)

The visualization must be driven by real observable events, not invented ones:

| Visual stage | Real data source | Poll |
| --- | --- | --- |
| Broadcast / arrival | Transaction first seen in `mempool.get_pending_transactions` (implemented in the monolith JSON-RPC, `jsonrpc_server.cpp:946`) | ~2s |
| Waiting / ordering | Transaction still pending across polls (age = orbit time) | ~2s |
| Sealed into a block | Transaction id appears in a new block (existing 1s head/delta block poll) | 1s |
| Validated / applied | Block accepted by the node (it is in the canonical chain the poll follows) | 1s |
| Dropped / expired | Pending transaction disappears without appearing in a block | derived |

Notes:
- Client-side signing happens before broadcast and is not observable; the
  "signed" moment shown in the scene is the **producer sealing the block**
  (block signature), which is real.
- P2P gossip hops are not exposed over JSON-RPC. The "API node gates" at the
  scene edge represent the RPC entry point, not fake peer topology. A future
  iteration can tail local node gossip logs over a new IPC to animate real
  peer arrival, but that is explicitly out of scope for v1.
- If the selected RPC source does not expose the mempool method (some public
  endpoints), the scene degrades gracefully to blocks-only mode: transactions
  spawn at the moment their block arrives.

## Technology

- **three.js + @react-three/fiber + @react-three/drei** (npm, self-contained,
  no CDN — packaged app has a strict local-only posture).
- WebGL2 via Electron's GPU acceleration (verify hardware acceleration is not
  disabled at app startup; log fallback).
- **Lazy loading**: the 3D bundle (~600 KB gzipped) is dynamically imported
  only when the user opens the 3D sub-view, so the normal app bundle and
  startup stay untouched.
- Postprocessing: soft bloom only (drei/postprocessing), quality-gated.
- All animation runs in the scene graph clock; React state only carries
  lifecycle events. Instanced meshes for transaction particles.

## Scene design (assistant visual language, game-like but calm)

- Light neutral fog background matching the app palette; lavender/purple
  accents (`--accent`), soft shadows, rounded geometry. No harsh neon.
- **API gate** at the scene edge: a portal ring. Each transaction spawns there
  as a glowing particle with a short trail.
- **Mempool** at center: a slowly swirling orbital cluster. Pending particles
  orbit; orbit radius/az speed derived from tx age and RC. Hovering shows a
  small overlay (tx id, payer, ops count).
- **Producer beacon**: when a new block arrives, the block producer's beacon
  pulses, pulls the included particles into a forming cube over ~400 ms,
  the cube flashes on seal (block signature), then slides onto the **chain
  track** — a receding line of the last N blocks (reusing the Explorer row
  data). Blocks signed by the configured/active producer get the purple
  own-producer highlight and a stronger pulse.
- **Camera**: slow automatic orbit by default; drag to rotate, wheel/pinch to
  zoom, double-click to focus an object. Clicking a block opens the existing
  block detail dialog; clicking a particle opens tx detail.
- Empty-network moments (no pending tx) keep gentle idle motion so the scene
  never looks frozen.

## UX integration

- Explorer tab gains sub-views: **List** (current table, default) and
  **3D Explorer** with an "Experimental" badge. Deep link from the 3D scene
  back to list rows.
- Settings > App gets a "3D Explorer quality" select: Off / Low / Medium /
  High (default Medium; Low disables bloom and halves particle budget).
- Respect `prefers-reduced-motion`: static layout with fades only.
- Pause rendering entirely when the sub-view is hidden, the window is
  minimized, or the app loses focus for >30 s (battery/CPU care on the same
  machine that runs the node).
- i18n: all labels EN/ES from `src/i18n.ts` as usual.

## Data plumbing (renderer only, no new Electron IPC for v1)

1. `src/app/explorer3d.ts` — a small event store:
   `TxLifecycle = { id, firstSeenAt, payer?, opCount?, stage: 'pending' | 'included' | 'dropped', blockHeight?, includedAt? }`.
   Pure functions + unit tests; no three.js imports.
2. Mempool poller (2 s, only while the 3D view is open): diff pending ids,
   emit `tx-seen` / `tx-dropped`.
3. Block feed: subscribe to the existing Explorer delta poll results; emit
   `block-arrived { height, id, signer, txIds }` (block bodies already carry
   transactions — extend `mapBlockItem` to surface tx ids).
4. The scene consumes the store; nothing else in the app depends on it.

## Delivery phases (each phase is a separate PR, feature-flagged)

- **Phase 0 — Spike (1 PR)**: add deps, lazy-loaded empty scene behind the
  sub-view, GPU/HW-acceleration check, FPS/memory counter in dev mode,
  bundle-size guard in CI notes. Exit criteria: 60 fps empty scene on the
  8 GB test Mac, zero impact when the sub-view is closed.
- **Phase 1 — Data layer (1 PR)**: `explorer3d.ts` store + mempool poller +
  block-feed adapter + unit tests. No visuals.
- **Phase 2 — Static scene (1 PR)**: gate, mempool cluster, chain track with
  the last N real blocks, palette/lighting, camera controls.
- **Phase 3 — Life (1 PR)**: particle spawn/orbit, pull-in and seal
  animation on block arrival, own-producer highlight, drip-feed timing reuse.
- **Phase 4 — Interactivity (1 PR)**: picking, hover overlays, block/tx
  detail links, quality settings, reduced-motion path.
- **Phase 5 — Polish (1 PR)**: instancing/LOD passes, memory caps (max 2k
  particles, oldest culled), pause-on-hidden, QA on low-end hardware, manual
  page (`docs/manual/koinos-one/`), changelog + manual changelog sync.

## Risks and mitigations

- **Bundle size**: dynamic import; verify `npm run build` size delta and
  document it. The packaged app must not load three.js at startup.
- **CPU/GPU contention with the running node**: quality presets, pause when
  hidden, cap at 30 fps on Low.
- **Public RPC without mempool method**: blocks-only degraded mode (detected
  at first poll failure, with a small notice in the scene).
- **Electron GPU disabled/blacklisted**: detect WebGL2 context failure and
  show a friendly fallback card with a link back to the list view.
- **Memory growth**: hard particle cap, dispose geometries/materials on
  unmount, verify with repeated open/close cycles.

## Out of scope for v1

- Real P2P gossip topology (needs new node-side event surface).
- Multi-node views (Remote tab nodes in the same scene).
- Historical replay mode (time-travel through past blocks) — natural v2.

## Estimate

Phases 0-2 ≈ 2-3 sessions; phases 3-5 ≈ 3-4 sessions, dominated by animation
tuning and low-end performance QA.
