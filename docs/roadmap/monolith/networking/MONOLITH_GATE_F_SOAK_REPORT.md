# Monolith Gate F Soak Report

- Started: 2026-05-24T04:07:31Z
- Duration target: 18000s
- Sample interval: 60s
- BASEDIR: /var/folders/xq/pg_jh6zd6tx41p0nd1qvlyvc0000gn/T/knodel-mainnet-soak.XXXXXX.EIgOyH0M83
- Log file: /var/folders/xq/pg_jh6zd6tx41p0nd1qvlyvc0000gn/T/knodel-mainnet-soak.XXXXXX.log.AmM4XhCTrS
- JSON-RPC: 127.0.0.1:18082
- P2P listen: /ip4/0.0.0.0/tcp/8888

| UTC time | pid | RSS KB | head height | peer log rows | note |
|---|---:|---:|---:|---:|---|
| 2026-05-24T04:07:31Z | 16978 | 704 | 0 | 0 | ok |
| 2026-05-24T04:08:32Z | 16978 | 21616 | 0 | 0 | ok |
| 2026-05-24T04:09:32Z | 16978 | 11616 | 0 | 0 | ok |
| 2026-05-24T04:10:32Z | 16978 | 11648 | 0 | 0 | ok |

Aborted: 2026-05-24T04:10:xxZ

Result: invalid soak. The process stayed alive, but it had `0` connected peer rows and head height stayed at `0`, so this does not satisfy Gate F mainnet soak criteria.

Follow-up diagnostics run after abort:

- TCP connectivity to `seed.koinosfoundation.org:8888` and `seed.koinosblocks.com:8888` succeeded.
- `seed-east.burnkoin.com:8888` timed out from this host.
- cpp-libp2p seed dials failed before establishing peers:
  - `seed.koinosblocks.com`: `End of file` / `Connection reset by peer`
  - `seed.koinosfoundation.org`: Noise handshake `Bad address`
  - `seed-east.burnkoin.com`: `Operation timed out`
- Retested with `/dns4`, `/ip4`, public listen, loopback listen, and traced logs; all remained at `0` connected peers.

Resolution note, 2026-05-24:

- A minimal Go libp2p dial diagnostic showed `seed.koinosfoundation.org:8888` was serving peer ID `QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`, while the soak harness still used stale ID `QmQVBuhg2j2BV1hvMMNoLVrZ9T9gPb8F9bRgifCspBz6WW`.
- With the corrected peer ID, Go connected in `188ms` and read `ProtocolVersion=koinos/p2p/1.0.0`.
- With the corrected peer ID, cpp-libp2p connected to the mainnet seed, completed the P2P handshake, and applied `500` blocks:
  - `Peer connected: QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`
  - `Handshake complete with QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`
  - `Syncing from ... applied 500 blocks (height 500/36189362)`
- Short validation command:
  `KOINOS_LIBP2P_TRACE=1 SOAK_DURATION_SECONDS=90 SOAK_INTERVAL_SECONDS=10 JSONRPC_PORT=18082 P2P_LISTEN=/ip4/127.0.0.1/tcp/0 P2P_PEERS=/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF MONOLITH_SOAK_REPORT=/private/tmp/knodel-soak-foundation-fixed-report.md MONOLITH_SOAK_LOG=/private/tmp/knodel-soak-foundation-fixed.log scripts/soak-mainnet-p2p.sh`
- Result: process stayed alive for `90s`; report samples stayed at head height `500` with connected peer rows. This fixes the seed handshake blocker for Gate F preflight when targeting the corrected foundation seed. The harness default was narrowed to that validated seed; additional seeds can be supplied with `P2P_PEERS` once their peer IDs/connectivity are revalidated. A production-duration Gate F soak is still required for final signoff.
- Follow-up hardening: `P2PNode` now delays seed reconnect attempts and uses a `60s` reconnect interval so startup does not duplicate the initial `Libp2pTransport` seed dial or hammer public seeds every `10s`.
- Follow-up validation after repeated rapid tests: a `120s` run with the corrected default seed stayed alive but received `Connection reset by peer` from `seed.koinosfoundation.org` and remained at `0` peers / height `0`. Treat this as public seed availability/rate limiting until a later cooldown run or additional working seed list is available; it does not invalidate the earlier successful handshake/sync proof, but it means Gate F production soak is not signed off.
- Added `scripts/probe-mainnet-seeds.sh`, backed by `vendor/koinos/koinos-p2p/cmd/mainnet-seed-probe`, to validate go-libp2p handshakes before starting a long soak. Latest 5-attempt probe result:
  - `seed.koinosfoundation.org`: `Connection reset by peer`
  - `seed.koinosblocks.com`: `Connection reset by peer`
  - `seed-east.burnkoin.com`: TCP timeout
- Added fail-fast protection to `scripts/soak-mainnet-p2p.sh`: by default `SOAK_REQUIRE_PROGRESS=1`, with `SOAK_STARTUP_GRACE_SECONDS=900` so slow mainnet peer discovery has room to settle. Short validation runs can override the grace; a validation run with `SOAK_STARTUP_GRACE_SECONDS=60` aborted correctly after no peer rows and no head height progress were observed.
- Production p2p log from `seed.koinosfoundation.org` was used to add `scripts/mainnet-peer-candidates.txt`. A one-attempt probe from this machine found these Koinos peers accepting handshake:
  - `/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`
  - `/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi`
  - `/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea`
- Those peers are now stored in `scripts/mainnet-peer-validated.txt`, which is the default peer file for `scripts/soak-mainnet-p2p.sh`. The broader candidate file remains for discovery.
- A 10m soak against `scripts/mainnet-peer-validated.txt` on 2026-05-24 proved the production log list can connect from this host when public peers accept dials:
  - `95.216.68.185` connected, completed handshake, and applied `500` blocks (`height 500/36193004`).
  - The process stayed alive for the requested `600s` and shut down cleanly.
  - The run stalled at head height `500`, so it is not a valid Gate F signoff.
  - The log repeatedly emitted `Disconnecting peer ... (score threshold exceeded)`, revealing a local disconnect lifecycle bug rather than just a startup timing problem.
- Code hardening after that run:
  - `Libp2pTransport::disconnect_peer` now removes the peer from `_connected` and invokes the registered disconnect callback.
  - `Libp2pTransport::connect_peer` now invokes the registered connect callback on successful reconnect dials so `P2PNode` starts a fresh sync loop.
  - `P2PNode::report_peer_error` now returns whether the threshold triggered a disconnect and logs the accumulated score plus the last error at warning level.
  - `P2PNode::peer_sync_loop` now exits after a disconnect threshold instead of repeatedly retrying against a peer that has already been dropped.
  - Build validation passed: `cmake --build vendor/koinos/koinos-node/build --target koinos_node --parallel`.
  - Local regression validation passed: `vendor/koinos/koinos-node/build/koinos_p2p_one_peer_sync_test`.
- A post-fix 180s soak could not externally validate sustained sync because all validated peers returned `EOF` or `Connection reset by peer` during the `120s` startup grace. The report correctly marked it invalid with head height `0` and `0` peer rows. Treat this as public peer availability/rate limiting after rapid test cycles; the next useful Gate F run should happen after cooldown or with a fresher production peer list.
- Follow-up on 2026-05-24:
  - Re-probed `scripts/mainnet-peer-validated.txt` with 3 attempts and all three peers returned `Connection reset by peer`.
  - Re-probed `scripts/mainnet-peer-candidates.txt` with 1 attempt. The only peer that accepted a libp2p connection was `/ip4/82.121.133.93/tcp/4001/p2p/12D3KooWStKQDsuSjRHhKFPqGJJE4hhBpPXKamw2H1cA74g6KuEk`, but Identify returned `protocol_version=unknown`.
  - A targeted monolith soak against that peer established a libp2p connection but did not complete Koinos Peer RPC handshake and did not advance head height.
  - `scripts/soak-mainnet-p2p.sh` was hardened to track peer rows, Koinos handshake rows, sync rows, and head height separately. By default `SOAK_REQUIRE_HEAD_PROGRESS=1`, so a peer socket without block progress is now marked invalid.
  - Validation command for the hardened harness:
    `SOAK_DURATION_SECONDS=90 SOAK_INTERVAL_SECONDS=15 SOAK_STARTUP_GRACE_SECONDS=60 SOAK_REQUIRE_PROGRESS=1 JSONRPC_PORT=18082 P2P_LISTEN=/ip4/127.0.0.1/tcp/0 P2P_PEERS=/ip4/82.121.133.93/tcp/4001/p2p/12D3KooWStKQDsuSjRHhKFPqGJJE4hhBpPXKamw2H1cA74g6KuEk MONOLITH_SOAK_REPORT=/private/tmp/knodel-soak-unknown-peer-head-required-report.md MONOLITH_SOAK_LOG=/private/tmp/knodel-soak-unknown-peer-head-required.log scripts/soak-mainnet-p2p.sh`
  - Result: invalid soak after `60s` grace with `Max head height: 0; max peer rows: 0; max handshake rows: 0; max sync rows: 0`.

Latest follow-up on 2026-05-24:

- Added the newer peers observed in the production `p2p.log` snapshot at `08:33`.
- Re-probed the broader candidate list. At that time, these peers accepted a Go libp2p dial:
  - `/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF` with `protocol_version=koinos/p2p/1.0.0`
  - `/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi` with `protocol_version=koinos/p2p/1.0.0`
  - `/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8` briefly accepted and advertised `protocol_version=koinos/p2p/1.0.0`, but later reset connections.
  - Several public peers accepted raw libp2p connections but returned `protocol_version=unknown`; these are not valid Gate F targets unless they complete Koinos Peer RPC handshake and advance head height.
- Updated `scripts/mainnet-peer-validated.txt` to the two currently protocol-valid peers:
  - `/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`
  - `/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi`
- A focused run against `94.130.148.114` connected, completed handshake, and applied `500` blocks, then received a transport EOF. Before the local fix, that stale peer could be retried until `score threshold exceeded`.
- C++ hardening completed after this diagnosis:
  - `Libp2pTransport` now sets the cpp-libp2p client version from `protocol_version` and logs the advertised value (`koinos/p2p/1.0.0`).
  - libp2p IO is driven from one runner thread to avoid callback/muxer races.
  - Seed reconnect cadence now honors the configured `60s` interval instead of effectively sleeping twice.
  - EOF/reset/closed-stream errors disconnect stale peers immediately without converting one transport close into a score-threshold failure.
  - Sync block application is serialized so competing peers do not apply overlapping batches concurrently.
  - Already-irreversible block application errors from multi-peer races are treated as local catch-up races, not peer misconduct.
- Build validation passed after these changes:
  `cmake --build vendor/koinos/koinos-node/build --target koinos_node --parallel`
- Static validation passed:
  `bash -n scripts/soak-mainnet-p2p.sh scripts/probe-mainnet-seeds.sh`
  and `git diff --check`
- A 300s validation soak after the fixes used:
  `SOAK_DURATION_SECONDS=300 SOAK_INTERVAL_SECONDS=15 SOAK_STARTUP_GRACE_SECONDS=240 SOAK_REQUIRE_PROGRESS=1 SOAK_REQUIRE_HEAD_PROGRESS=1 SOAK_MIN_HEAD_HEIGHT=1000 JSONRPC_PORT=18082 P2P_LISTEN=/ip4/127.0.0.1/tcp/0 P2P_PEERS_FILE=scripts/mainnet-peer-validated.txt MONOLITH_SOAK_REPORT=/private/tmp/knodel-soak-validated-v2-report.md MONOLITH_SOAK_LOG=/private/tmp/knodel-soak-validated-v2.log scripts/soak-mainnet-p2p.sh`
- Result: invalid soak, but for the expected reason in the current public-peer window:
  - startup was healthy and JSON-RPC responded
  - the monolith logged `Advertised protocol version: koinos/p2p/1.0.0`
  - reconnect attempts occurred approximately every `60s`
  - both validated peers returned `EOF` or `Connection reset by peer` before Koinos handshake
  - `max head height: 0`
  - `max handshake rows: 0`
  - `max sync rows: 0`
  - `max score threshold rows: 0`
- A Go libp2p probe immediately after the invalid soak failed against the same peers in the same way:
  - `seed.koinosfoundation.org`: security negotiation reset by peer
  - `46.62.245.240`: security negotiation EOF
- Interpretation: the latest failure is not evidence that production peers have different configuration from legacy. The remote peers are the legacy baseline; the current failure window is consistent with public peer backoff/availability. The next useful Gate F attempt should start with a successful Go probe and then compare C++ against the same peer window.

Final follow-up on 2026-05-24:

- Compared current behavior with the Go legacy implementation. The important legacy behaviors are not only timing: Go registers a real `PeerRPCService`, tolerates missing Identify protocol version, retries handshakes while the connection stays open, and `connectInitialPeers()` effectively paces dials because `host.Connect()` blocks per peer.
- Implemented the missing monolith server side of Peer RPC. `Libp2pTransport` now routes incoming `/koinos/peerrpc/1.0.0` requests to `P2PNode`, and `P2PNode` serves:
  - `GetChainID` from local `chain.get_chain_id`
  - `GetHeadBlock` from local `chain.get_head_info`
  - `GetAncestorBlockID` from local `block_store.get_blocks_by_height`
  - `GetBlocks` from local `block_store.get_blocks_by_height` with serialized protobuf blocks
- Added MessagePack encode/decode helpers for Peer RPC request payloads and response payloads in `p2p/gorpc_codec.*`.
- Aligned seed dialing with legacy behavior:
  - `main.cpp` no longer passes configured seeds to `Libp2pTransport` for an immediate async startup burst.
  - `P2PNode` owns seed reconnects and attempts seeds with a `1s` spacing inside each cycle.
  - `Libp2pTransport::connect_peer` now suppresses duplicate dials while a peer is already connected or has a dial in flight.
  - `p2p.seed-reconnect-interval-seconds` remains configurable and defaults to `10s` for faster mainnet acquisition tests.
- Corrected peer list handling:
  - `scripts/mainnet-peer-candidates.txt` now prioritizes the legacy `vendor/koinos/koinos/config-example/config.yml` seeds.
  - Production-log peers remain as fallbacks because many are residential/NAT endpoints and may accept libp2p without serving Koinos Peer RPC.
  - `scripts/probe-mainnet-seeds.sh` defaults were updated to match the legacy seed list.
- Validation after these changes:
  - Build passed: `cmake --build vendor/koinos/koinos-node/build --target koinos_node --parallel`
  - Local tests passed: `ctest --test-dir vendor/koinos/koinos-node/build --output-on-failure`
  - Shell syntax passed: `bash -n scripts/soak-mainnet-p2p.sh scripts/probe-mainnet-seeds.sh`
  - Go seed probe from this machine failed against all five official legacy seeds in the current window:
    - `seed.koinosblocks.com`: security negotiation reset by peer
    - `seed.koinosfoundation.org`: security negotiation reset/EOF
    - `seed-east.burnkoin.com`: timeout
    - `37.27.7.221:11394`: connection refused
    - `46.62.245.240:8888`: security negotiation reset by peer
  - A full one-attempt probe over the broader candidate list found only three raw libp2p peers accepting dials (`82.121.133.93:4001`, `99.127.157.110:4001`, `86.167.88.140:4001`), all with `protocol_version=unknown`.
  - The existing live Peer RPC test confirmed those three raw libp2p peers do not negotiate `/koinos/peerrpc/1.0.0`; each failed with `ProtocolMuxer: protocol negotiation failed`.
- Current interpretation: the immediate blocker is not proven to be a remaining C++ wire incompatibility. In the current network window, the Go reference probe also cannot find a reachable peer that both accepts the libp2p security negotiation and serves Koinos Peer RPC. The next useful Gate F run should start only after a Go probe finds a Peer RPC-capable target, then run the C++ soak against that same target and require head progress beyond height `1000`.

Probe hardening follow-up:

- `cmd/mainnet-seed-probe` now requires Koinos Peer RPC by default. A peer is printed as `OK` only after:
  - libp2p dial succeeds
  - `PeerRPCService.GetChainID` succeeds
  - `PeerRPCService.GetHeadBlock` succeeds and returns a non-zero head
- Raw libp2p-only diagnostics are still available with `SEED_PROBE_PEER_RPC=0`.
- `scripts/probe-mainnet-seeds.sh` can now write the passed peers directly with `SEED_PROBE_OUTPUT=scripts/mainnet-peer-validated.txt`.
- `scripts/mainnet-peer-validated.txt` is currently intentionally empty under this stricter definition, because the latest live probe found no public peer that serves `/koinos/peerrpc/1.0.0` from this machine.
- Live check against the three peers that previously accepted raw libp2p dials now fails correctly:
  - `82.121.133.93:4001`: `protocols not supported: [/koinos/peerrpc/1.0.0]`
  - `99.127.157.110:4001`: `protocols not supported: [/koinos/peerrpc/1.0.0]`
  - `86.167.88.140:4001`: `protocols not supported: [/koinos/peerrpc/1.0.0]`
- Validation:
  - `GOCACHE=/private/tmp/knodel-go-cache go test ./cmd/mainnet-seed-probe`
  - `bash -n scripts/probe-mainnet-seeds.sh scripts/soak-mainnet-p2p.sh`
