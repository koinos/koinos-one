# Ports And Endpoints

This page lists confirmed ports, listens, and exposure rules from current
source, config files, and implementation docs.

## Runtime Ports

| Surface | Confirmed values | Exposure rule |
| --- | --- | --- |
| P2P, mainnet profile | `/ip4/0.0.0.0/tcp/8888` in Koinos One network profiles and mainnet bootstrap configs. | May be publicly reachable when the operator wants inbound peers. Only publish the chosen P2P port. |
| P2P, testnet profile | `/ip4/0.0.0.0/tcp/18888` in testnet observer configs. Testnet seed peers can still listen on their own ports. | Same as P2P mainnet. Publish only intentionally selected P2P ports. |
| JSON-RPC | Native default is `0.0.0.0:8080`. Koinos One profiles bind mainnet to `127.0.0.1:8080` and testnet to `127.0.0.1:18122`. | Public Koinos JSON-RPC methods only. It must not expose backup or restore admin behavior. Keep loopback unless intentionally publishing an observer RPC. |
| gRPC | Native default is `0.0.0.0:50051` when `features.grpc` is enabled. Current shipped observer configs set `grpc: false`. | Compatibility RPC surface only. Do not treat it as an admin API. Keep private unless an operator intentionally exposes it. |
| Backup admin API | Default and Koinos One generated listen is `127.0.0.1:18088`. | Local loopback only. The native server rejects non-loopback admin listen addresses and admin routes require bearer authorization when a token is configured. |
| Private SFTP backup | Default SSH/SFTP port is `22` when remote backup is enabled. | Authenticated private backup transport. It is separate from public bootstrap restore. |
| Vite renderer dev server | `5173` through `npm run dev`. | Development only. Not a packaged app or node API. |

The Docker prodnet observer guide documents one special case: JSON-RPC listens
on `0.0.0.0` inside the container so Docker can publish it, while the host
publish rule binds it to host `127.0.0.1`. That keeps JSON-RPC local to the
host.

## Public Endpoints

| Endpoint | URL | Purpose |
| --- | --- | --- |
| Mainnet public JSON-RPC | `https://api.koinos.io/` | Public client RPC fallback from Koinos One network profiles. |
| Mainnet public JSON-RPC | `https://api.koinosblocks.com/` | Public client RPC fallback from Koinos One network profiles. |
| Testnet public JSON-RPC | `https://testnet.koinosfoundation.org/jsonrpc` | Public testnet client RPC fallback. |
| Testnet public bootstrap | `https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap` | Public read-only native backup source. |
| Mainnet public bootstrap | `https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap` | Public read-only native backup source. |

Public bootstrap endpoints serve backup metadata and content-addressed objects
over HTTP(S). They are not administrative endpoints and do not accept backup
creation, deletion, restore activation, wallet, producer, or config changes.

## Admin Routes

The backup admin server is local-only and provides routes such as:

| Route group | Purpose |
| --- | --- |
| `/health`, `/healthz` | Local health checks. |
| `/admin/backup/config` | Local backup config summary. |
| `/admin/backup/snapshots/local` | Local native backup inventory. |
| `/admin/backup/snapshots/remote` | Private SFTP backup metadata inventory. |
| `/admin/backup/public/*` | Local orchestration for public read-only bootstrap list, fetch, preflight, stage, and activate. |
| `/admin/backup/create`, `/admin/backup/delete`, `/admin/backup/restore/*` | Local administrative backup and restore operations. |
| `/admin/p2p/peers` | Local P2P peer snapshot. |

`/admin/*` routes require `Authorization: Bearer <token>` when the server is
started with a configured token. Koinos One writes a generated token file for
the managed local node when admin backup support is enabled.

## Legacy Boundary

GarageMQ/AMQP is not part of the active Koinos One runtime surface. Do not open
or document old AMQP ports as a current operator requirement unless a specific
legacy compatibility task calls for it.
