# 3D Explorer (Experimental)

The 3D Explorer is an experimental, GPU-accelerated live view of the chain
inside the Explorer tab. It shows real transactions moving through their
lifecycle: arriving at the RPC gate, waiting in the mempool, and being sealed
into blocks on the chain.

## When To Use This

Use this page when you want a live, visual sense of network activity — for
example while watching your own producer work, or while a node syncs. The
regular list view remains the precise, data-dense surface; the 3D view is a
companion, not a replacement.

## Open It

1. Open the `Explorer` tab.
2. Choose the `3D Explorer` sub-view (marked `Experimental`).

The 3D engine is downloaded and started only when you open this sub-view. The
rest of the app does not pay for it.

## What You See

| Element | Meaning |
| --- | --- |
| Portal ring (left) | The RPC entry point. Transactions appear here when they are first seen in the mempool. |
| Orbiting particles (center) | Pending transactions waiting in the mempool. Each particle keeps a stable orbit slot derived from its transaction id. |
| Cube row (right) | The most recent blocks. A new block flashes when it is sealed and pushes earlier blocks down the track. |
| Purple cubes | Blocks produced by your configured producer address. |

Everything shown is real observable data: a 2-second mempool poll plus the
same one-second block feed the list view uses. Nothing is simulated. If the
selected RPC source does not expose the mempool (most public endpoints), the
view says so and falls back to blocks-only mode.

## Interact

- Drag to rotate the camera; use the mouse wheel to zoom.
- Hover a particle to see the transaction id, payer, and operation count.
- Hover a block to see its height and producer.
- Click a block to open the regular block detail dialog.

## Quality And Performance

`Settings` > `App` > `3D Explorer quality`:

| Preset | Behavior |
| --- | --- |
| Off | Hides the 3D sub-view entirely. |
| Low | Caps rendering at 200 transaction particles and disables antialiasing. Use this on modest hardware or while the node is busy. |
| Medium | Default. Up to 500 particles. |
| High | Higher pixel ratio on sharp displays. |

The scene pauses automatically when the window is hidden and freezes all
motion when the operating system requests reduced motion. Rendering stops
completely when you switch back to the list view.

## Limitations

- Peer-to-peer gossip hops are not shown: they are not observable through the
  RPC surface, and the view does not invent data.
- Client-side signing happens before broadcast, so the "seal" flash you see is
  the block signature, which is the first observable signing moment.
- This view is experimental; visuals and behavior may change between releases.

## Related Pages

- [Node Dashboard](node-dashboard.md)
- [Producer Mode](producer-mode.md)
