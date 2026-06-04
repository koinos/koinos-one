# Monolith Mainnet Canary Report

Updated: 2026-06-04T01:05:39Z

## Result

- Status: short disposable observer canary passed
- Classification: stable mainnet Peer RPC window from VPS1; local Mac peer availability remains unreliable
- Sprint: 6.1 Mainnet canary
- Block production: disabled for all checks

## What Ran

1. Built the monolith on VPS1 at `/opt/knodel-mainnet-canary`.
2. Fixed the reproducible remote build so cpp-libp2p and `koinos_node` both use the Koinos Hunter OpenSSL 3 headers/libraries.
3. Fixed final monolith CMake configuration so `koinos_node` links the same Koinos Hunter `yaml-cpp` that its config parser is compiled against.
4. Hardened monolith YAML config lookup so the runtime reads the provided observer config correctly even with the Hunter `yaml-cpp` build used by the production host.
5. Ran a direct `300s` disposable observer canary from height `0` with JSON-RPC bound to `127.0.0.1:18182`, P2P listening on loopback only, and block production disabled.

## Canary Result

- Started: `2026-06-04T01:00:30Z`
- Completed: `2026-06-04T01:05:39Z`
- Exit status: `0`
- Process health: stayed alive for the requested duration and accepted clean shutdown
- Max observed head height: `20282`
- Peer snapshot rows: `87`
- Connected-peer snapshots: `3`
- Disconnected-peer rows: `0`
- Handshake rows: `3`
- Sync rows: `48`
- Warning, score-threshold, checkpoint-mismatch, and disconnect rows: `0`

Observed peers during the successful canary:

- `/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP`
- `/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi`
- `/ip4/46.62.204.73/tcp/8888/p2p/QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP`
- `/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea`

## Evidence

- A/B report: `docs/roadmap/monolith/networking/MONOLITH_AB_PEER_ACQUISITION_REPORT.md`
- Go discovery log: `/private/tmp/knodel-ab-peer-acquisition/go-discovery.log`
- Go stability log: `/private/tmp/knodel-ab-peer-acquisition/go-stability.log`
- Previous local short C++ canary report: `/private/tmp/knodel-sprint6-mainnet-canary-short-report.md`
- Previous local short C++ canary log: `/private/tmp/knodel-sprint6-mainnet-canary-short.log`
- Successful VPS1 canary report: `/tmp/knodel-mainnet-canary-run/monolith-soak-report.md`
- Successful VPS1 canary log: `/tmp/knodel-mainnet-canary-run/monolith-soak.log`
- Successful VPS1 binary: `/opt/knodel-mainnet-canary/vendor/koinos/koinos-node/build/src/koinos_node`

## Public Head Gap

- Public mainnet RPC `https://api.koinos.io/` returned head height `36489056`.
- Restored monolith mainnet basedir verification head is `36180957`.
- Current restored-data catch-up target is therefore about `309099` blocks.

## Candidate Maintenance

The latest probe observed that `seed.koinosfoundation.org:8888` now presents peer ID `QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP`. The top-level canary inputs were updated to remove older stale peer IDs from:

- `scripts/mainnet-peer-candidates.txt`
- `scripts/probe-mainnet-seeds.sh`
- `scripts/soak-mainnet-p2p.sh`

This only removes a known peer-ID mismatch. It does not count the foundation seed as validated because the current validation attempt still reset during security negotiation.

## Previous Local Attempt

The 2026-06-03 local Mac A/B run found three peers that completed libp2p plus Koinos Peer RPC once:

- `/dns4/seed.koinosblocks.com/tcp/8888/p2p/QmUNURuZxSu5wLnmBNJdwGtwjLmV5JxGhu4uNSAS8ZNcze`
- `/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea`
- `/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8`

Immediate repeat stability probing failed for all three peers with security-negotiation resets. A short disposable C++ monolith observer canary on the local Mac started cleanly and kept JSON-RPC available, but observed no peer session, handshake, sync row, or head progress before the `120s` startup grace expired. Treat the local result as peer availability/source-IP behavior, not as the latest monolith runtime result.

## Decision

Sprint 6.1 now has a successful short mainnet observer canary from VPS1. This validates the remote monolith build path, config loading, mainnet peer acquisition, handshake, and early sync under block-production-disabled conditions.

This is not yet the full mainnet signoff. The next valid step is a restored-data or longer fresh-data observer canary on the production server, followed by a parallel legacy comparison and a `48h` stability window. Do not enable mainnet block production until the observer gate is complete.
