# Monolith Mainnet Canary Report

Updated: 2026-06-04T03:58:32Z

## Result

- Status: short disposable observer canary passed; restored-data local observer catch-up in progress
- Classification: stable mainnet Peer RPC windows from VPS1 and the local Mac restored-data observer
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

## Local Restored-Data Mainnet Catch-Up

On 2026-06-04, a separate local Mac mainnet observer was launched against the restored mainnet basedir at `/Volumes/external/knodel-monolith-restore/basedir`, using block production disabled, JSON-RPC on `127.0.0.1:18132`, and P2P listen port `18988`.

- Started: `2026-06-04T03:53:16Z`
- Latest sampled: `2026-06-04T03:58:32Z`
- Process: running as PID `46481` in screen session `koinos-mainnet-observer`
- Log: `/private/tmp/koinosgui-mainnet-observer/mainnet-observer-latest.log`
- Initial restored head: `36180957`
- Latest sampled local head: `36200760`
- Latest sampled public mainnet head: `36496418`
- Remaining lag at sample: `295658` blocks
- Observed sync rate: about `60-66` blocks/sec from monolith metrics rows
- Established mainnet peers: `4`
- Fault scan: no `score threshold`, `checkpoint mismatch`, fatal, exception, or block-application failure rows observed

Established peers during the local restored-data catch-up:

- `/dns4/seed.koinosblocks.com/tcp/8888/p2p/QmUNURuZxSu5wLnmBNJdwGtwjLmV5JxGhu4uNSAS8ZNcze`
- `/dns4/seed.koinosfoundation.org/tcp/8888/p2p/QmZjGG6eFnLLSskbgikz956DTpPgodo5P7Dxa32qHYZBBP`
- `/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi`
- `/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea`

Two configured candidates were repeatedly unavailable during the local sample and produced expected transport warnings while sync continued through the healthy peers:

- `/dns4/seed-east.burnkoin.com/tcp/8888/p2p/QmYAC9nxqgVt2p8NvmxNFsoMpQS7c4zEBmsZndEBTRHNu4`: operation timed out
- `/ip4/37.27.7.221/tcp/11394/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs`: connection refused

## Evidence

- A/B report: `docs/roadmap/monolith/networking/MONOLITH_AB_PEER_ACQUISITION_REPORT.md`
- Go discovery log: `/private/tmp/knodel-ab-peer-acquisition/go-discovery.log`
- Go stability log: `/private/tmp/knodel-ab-peer-acquisition/go-stability.log`
- Previous local short C++ canary report: `/private/tmp/knodel-sprint6-mainnet-canary-short-report.md`
- Previous local short C++ canary log: `/private/tmp/knodel-sprint6-mainnet-canary-short.log`
- Successful VPS1 canary report: `/tmp/knodel-mainnet-canary-run/monolith-soak-report.md`
- Successful VPS1 canary log: `/tmp/knodel-mainnet-canary-run/monolith-soak.log`
- Successful VPS1 binary: `/opt/knodel-mainnet-canary/node/teleno-node/build/src/koinos_node`
- Local restored-data catch-up log: `/private/tmp/koinosgui-mainnet-observer/mainnet-observer-latest.log`

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

This is not yet the full mainnet signoff. The next valid step is to let the restored-data observer reach the public head, compare it against a legacy observer over a sustained window, and then run the production-server `48h` stability window. Do not enable mainnet block production until the observer gate is complete.
