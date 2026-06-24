# Live Peer Admin Endpoint Implementation Guide

Last updated: 2026-06-24

## Purpose

Koinos One currently displays connected peers in the desktop dashboard by reading the latest `Connected peers:` snapshot from local P2P logs. This is useful as a fallback, but it is not a true live query: the GUI only sees the most recent peer snapshot emitted by `teleno_node`.

This guide describes how to expose live peer state from the native node to the desktop GUI through the existing local admin API.

## Current Behavior

The current peer dashboard path is:

```text
React dashboard
  -> window.teleno.telenoNode.dashboardPeers(settings)
  -> Electron IPC: teleno:node:dashboard-peers
  -> electron/lib/producer-service.ts
  -> read p2p logs
  -> parse the latest "Connected peers:" block
  -> return rows[] to React
```

Relevant files:

- `src/App.tsx`: `refreshDashboardPeers`
- `electron/preload.ts`: `telenoNode.dashboardPeers`
- `electron/lib/ipc-handlers.ts`: `teleno:node:dashboard-peers`
- `electron/lib/producer-service.ts`: `telenoNodeDashboardPeers` and `parseLatestP2pPeersSnapshot`
- `src/components/panels/DashboardPanel.tsx`: peer table rendering
- `node/teleno-node/src/p2p/p2p_node.cpp`: `P2PNode::log_peer_snapshot`

Native P2P already has live peer state in memory:

- `P2PNode::connected_peer_count()`
- `Transport::connected_peers()`
- `Transport::known_peers()`
- `Libp2pTransport::connected_peers()`
- `Libp2pTransport::known_peers()`

The missing piece is a stable local API that returns this state without relying on log parsing.

## Design Summary

Add a new local admin route:

```http
GET /admin/p2p/peers
Authorization: Bearer <admin-token>
```

It should be served by the existing admin listener that currently handles backup routes:

```text
http://127.0.0.1:18088/admin/backup/...
```

The new route should use the same listener, loopback-only guard, and bearer-token authentication:

```text
http://127.0.0.1:18088/admin/p2p/peers
```

The GUI should prefer this live endpoint and keep the current log parser as a compatibility fallback.

## Goals

- Return live connected peer data from the running native node.
- Keep the endpoint local and authenticated.
- Preserve the existing log-snapshot parser as a fallback.
- Avoid exposing peer administration through public JSON-RPC.
- Keep the first implementation read-only.
- Make the response useful for both local GUI and future remote-admin-over-tunnel workflows.

## Non-Goals

- Do not expose this route on public JSON-RPC.
- Do not add mutating peer controls in the first implementation.
- Do not open the admin listener to non-loopback addresses by default.
- Do not require P2P to be enabled for the admin server to start.
- Do not remove the current log parser until live endpoint adoption is validated.

## API Contract

### Request

```http
GET /admin/p2p/peers HTTP/1.1
Host: 127.0.0.1:18088
Authorization: Bearer <admin-token>
```

Optional query parameters:

- `include_known=true`: include known/discovered peers in addition to connected peers.
- `limit=<n>`: cap returned peer rows. Default should be high enough for normal GUI use, for example `100`.

### Success Response

```json
{
  "ok": true,
  "source": "p2p-live",
  "snapshot_at": "2026-06-24T18:00:00.000Z",
  "p2p_running": true,
  "connected_count": 2,
  "known_count": 18,
  "self_address": "/ip4/192.168.1.10/tcp/8888/p2p/12D3KooW...",
  "connected": [
    {
      "peer_id": "12D3KooWM3nYEPprGvueaRuWV5tWnFJW1phPSdbTJy3R6vQT6C2j",
      "address": "/ip4/<VPS1_PUBLIC_IP>/tcp/18889/p2p/12D3KooWM3nYEPprGvueaRuWV5tWnFJW1phPSdbTJy3R6vQT6C2j",
      "host": "<VPS1_PUBLIC_IP>",
      "port": 18889
    }
  ],
  "known": [
    {
      "peer_id": "12D3...",
      "address": "/ip4/203.0.113.10/tcp/8888/p2p/12D3...",
      "host": "203.0.113.10",
      "port": 8888,
      "connected": false
    }
  ]
}
```

### Failure Responses

Unauthenticated:

```http
401 Unauthorized
WWW-Authenticate: Bearer
```

P2P is disabled or unavailable:

```json
{
  "ok": false,
  "source": "p2p-live",
  "p2p_running": false,
  "connected_count": 0,
  "known_count": 0,
  "connected": [],
  "known": [],
  "error": "p2p is not running"
}
```

The GUI should treat this as a soft failure and fall back to the existing log parser.

## Native Node Implementation

### 1. Expose live peers from `P2PNode`

`P2PNode` currently exposes only `connected_peer_count()` publicly. Add read-only accessors:

```cpp
std::vector< PeerID > connected_peers() const;
std::vector< PeerID > known_peers() const;
```

Expected implementation in `node/teleno-node/src/p2p/p2p_node.cpp`:

```cpp
std::vector< PeerID > P2PNode::connected_peers() const
{
  return _transport ? _transport->connected_peers() : std::vector< PeerID >{};
}

std::vector< PeerID > P2PNode::known_peers() const
{
  return _transport ? _transport->known_peers() : std::vector< PeerID >{};
}
```

`Libp2pTransport` already protects peer maps with `_peers_mutex` and also inspects the active connection manager, so this accessor should remain cheap and read-only.

### 2. Add a peer status provider for the admin server

Avoid making the admin server depend directly on the full P2P implementation. Add a small provider/callback type, for example:

```cpp
struct AdminPeerRow
{
  std::string peer_id;
  std::string address;
};

struct AdminPeerSnapshot
{
  bool p2p_running = false;
  std::string self_address;
  std::vector< AdminPeerRow > connected;
  std::vector< AdminPeerRow > known;
};

using PeerSnapshotProvider = std::function< AdminPeerSnapshot() >;
```

Short-term location:

- `node/teleno-node/src/backup/backup_admin_server.hpp`

Long-term cleanup:

- Rename `BackupAdminServer` to a generic `AdminServer`, or move shared admin routing into `node/teleno-node/src/admin/`.

The short-term change is acceptable because the listener, auth, loopback guard, and lifecycle already exist there.

### 3. Extend admin route matching

`BackupAdminServer::is_admin_target()` currently accepts only `/admin/backup/...`.

Change it to accept:

```cpp
target.rfind( "/admin/backup/", 0 ) == 0
  || target.rfind( "/admin/p2p/", 0 ) == 0
```

This makes the same bearer auth apply to `/admin/p2p/peers`.

### 4. Add `GET /admin/p2p/peers`

In `BackupAdminServer::handle_session`, add a route before the final `not found` response:

```cpp
else if( req.method() == http::verb::get && target == "/admin/p2p/peers" )
{
  res.result( http::status::ok );
  res.body() = p2p_peers_response( req.target() );
}
```

Implementation details:

- Return `application/json`.
- Parse query string only for simple options such as `include_known=true` and `limit`.
- Never mutate P2P state from this endpoint.
- If no provider is installed, return a JSON soft failure with `ok: false`.

### 5. Serialize peer rows

The native `PeerID` has:

- `id`
- `address`

The GUI already has parsing logic in TypeScript, but the endpoint should return `host` and `port` directly to avoid duplicated parsing.

Implement a small C++ helper equivalent to the current TypeScript parser:

```text
/p2p/<id>       -> peer_id
/ip4/<host>     -> host
/ip6/<host>     -> host
/dns4/<host>    -> host
/dns6/<host>    -> host
/tcp/<port>     -> port
```

Keep parsing permissive: if a field is missing, return `null` or omit the value rather than failing the whole response.

### 6. Wire provider in `main.cpp`

When constructing the admin server, pass a lambda that captures `p2p_node` weakly or safely checks the pointer:

```cpp
auto peer_provider = [&]() -> AdminPeerSnapshot {
  AdminPeerSnapshot snapshot;
  snapshot.p2p_running = static_cast< bool >( p2p_node );
  if( !p2p_node )
    return snapshot;

  for( const auto& peer: p2p_node->connected_peers() )
    snapshot.connected.push_back( { peer.id, peer.address } );

  for( const auto& peer: p2p_node->known_peers() )
    snapshot.known.push_back( { peer.id, peer.address } );

  return snapshot;
};
```

Care points:

- The admin server can outlive or stop after P2P during shutdown, so the callback must handle null/stopped P2P safely.
- Do not hold locks while serializing large JSON responses.
- Keep route behavior valid when P2P is disabled.

## Electron Implementation

### 1. Add an admin fetch helper

The backup service already knows how to reach the admin API and token. Reuse that pattern rather than duplicating auth logic.

Add a helper such as:

```ts
async function fetchAdminP2pPeers(settings: TelenoNodeSettings): Promise<TelenoNodeDashboardPeersResult>
```

It should call:

```text
GET http://<backup.admin.listen>/admin/p2p/peers
Authorization: Bearer <token>
```

Expected file:

- `electron/lib/producer-service.ts`, or a shared admin client module if backup admin HTTP helpers are extracted.

### 2. Preserve fallback behavior

Update `telenoNodeDashboardPeers`:

```text
try live admin endpoint
  if success, return source: "p2p-live"
  if unavailable, fall back to current p2p-log parser
```

Fallback conditions should include:

- admin API disabled
- admin token file missing
- connection refused
- 404 from older native node
- timeout
- P2P unavailable soft failure

Do not show a hard error if the log parser can still return a snapshot.

### 3. Normalize result shape

The GUI already expects:

```ts
type TelenoNodeDashboardPeersResult = {
  ok: boolean
  output: string
  service: string
  source: string
  snapshotAt: number | null
  selfAddress: string | null
  omittedPeerCount: number
  rows: TelenoNodeDashboardPeerRow[]
}
```

Keep this shape stable. Map endpoint JSON to the existing camelCase result:

```text
snapshot_at      -> snapshotAt
self_address     -> selfAddress
connected         -> rows
source            -> "p2p-live"
omittedPeerCount  -> 0
```

### 4. Update types

Update these files only if needed:

- `electron/lib/main-types.ts`
- `src/teleno-electron.d.ts`

Recommended `source` values:

- `p2p-live`
- `p2p-log`

## GUI Implementation

Minimal GUI changes are needed if the existing result shape is preserved.

Recommended small UI improvement:

- Show the source in the dashboard note:
  - `Loaded 2 live peer(s) from admin API.`
  - `Loaded 2 peer(s) from latest p2p log snapshot.`

Existing rendering can stay in:

- `src/components/panels/DashboardPanel.tsx`

## Tests

### Native C++ tests

Add or extend tests for:

- unauthorized `/admin/p2p/peers` returns `401`
- authorized `/admin/p2p/peers` returns live connected peer rows
- missing P2P provider returns soft JSON failure
- `include_known=true` includes known peers
- malformed peer address does not crash serialization

Likely file:

- `node/teleno-node/tests/backup/backup_admin_server_test.cpp`

If the admin server is renamed or split, move new tests to an `admin` test file.

### Electron tests

Add tests for:

- live endpoint success maps to `TelenoNodeDashboardPeersResult`
- 404/connection-refused falls back to log parser
- live endpoint timeout falls back to log parser
- live endpoint hard failure with no log snapshot returns a useful error

Likely file:

- `electron/lib/producer-service.test.ts`

### Renderer tests

Only needed if UI copy or source badges are added.

Likely file:

- `src/components/panels/DashboardPanel.test.tsx`

## Validation Commands

Native:

```bash
cmake --build node/teleno-node/build --target teleno_node koinos_backup_admin_server_test --parallel
ctest --test-dir node/teleno-node/build --output-on-failure -R 'koinos_backup_admin_server_test'
```

Electron/renderer:

```bash
npm run build
npm test -- --run electron/lib/producer-service.test.ts
```

Manual smoke:

```bash
curl -sS \
  -H "Authorization: Bearer $(cat <BASEDIR>/.teleno-native-backups/admin.token)" \
  http://127.0.0.1:18088/admin/p2p/peers | jq .
```

Then open the dashboard peers tab and verify:

- connected peer count matches the curl response
- host, port, and peer ID render correctly
- source note says live/admin API
- stopping admin API or running an older node falls back to log snapshots

## Security Model

Default behavior must stay loopback-only:

```text
127.0.0.1:18088
```

Remote administration should not be enabled by simply binding the admin API to `0.0.0.0`.

Recommended remote path:

```text
Koinos One GUI
  -> SSH tunnel, Tailscale, WireGuard, or VPN
  -> remote node 127.0.0.1:18088
```

Future remote mode can be added later, but it must include:

- TLS required
- explicit remote-admin config flag
- strong auth token or key-based auth
- read-only and mutating permission separation
- IP allowlist support
- request audit log
- rate limiting
- no private key exposure
- extra confirmation for restore, delete, producer, or signing operations

## Rollout Plan

1. Add live read-only endpoint behind the existing admin API.
2. Keep admin API loopback-only.
3. Update Electron to prefer live endpoint and fall back to logs.
4. Add tests for native endpoint and Electron fallback.
5. Validate with a local running mainnet/testnet observer.
6. Add a source indicator in dashboard output.
7. Document remote administration through SSH/Tailscale tunnel.
8. Only after validation, consider a formal remote read-only admin mode.

## Open Questions

- Should known peers be shown in the same table or a separate dashboard tab?
- Should the endpoint include connection direction, latency, last seen, or sync state when available?
- Should `BackupAdminServer` be renamed before adding non-backup routes, or should that cleanup wait until more admin routes exist?
- Should the GUI enable live peers only when backup admin settings are enabled, or should the admin listener be generalized and configurable independently of backup features?

## Recommended First Patch Scope

Keep the first patch small:

- Add `P2PNode::connected_peers()` and `P2PNode::known_peers()`.
- Extend existing admin server routing with `GET /admin/p2p/peers`.
- Wire a read-only peer snapshot provider in `main.cpp`.
- Update Electron `telenoNodeDashboardPeers` to try live endpoint first.
- Preserve the log parser fallback unchanged.

This delivers the live peer view without changing public JSON-RPC behavior or remote exposure.
