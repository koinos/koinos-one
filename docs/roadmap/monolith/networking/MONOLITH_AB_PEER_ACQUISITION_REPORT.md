# Monolith A/B Peer Acquisition Report

> Historical note: This file preserves command output, validation context, and artifact paths from runs that predate the Teleno repository and runtime cleanup. Old `knodel-*`, `koinosgui`, `Knodel.app`, or `/code/knodel` paths are evidence references only; current active repo paths and generated artifacts use Teleno names.

Updated: 2026-05-25T18:30:24Z

## Result

- Status: blocked
- Classification: go-discovery-found-no-peer-rpc-targets
- Git HEAD at run: de5f460
- Run root: /private/tmp/knodel-ab-peer-acquisition

## Inputs

- Peer file: /Users/pgarcgo/code/knodel/scripts/mainnet-peer-candidates.txt
- Explicit P2P_PEERS: not-set
- Go discovery attempts: 1
- Go discovery timeout: 8s
- Go stability attempts: 1
- Go stability timeout: 8s
- Go stability delay: 0s
- Run monolith: 0

## Go Legacy Direct-Dial Baseline

This baseline uses the same go-libp2p/gorpc stack and Peer RPC protocol as legacy `koinos-p2p`, but it does not start the full legacy microservice stack. The full legacy service still requires AMQP, chain, and block_store.

- Discovery output: /private/tmp/knodel-ab-peer-acquisition/go-discovery-validated.txt
- Discovery log: /private/tmp/knodel-ab-peer-acquisition/go-discovery.log
- Discovery Peer RPC peers: 0
- Stability output: /private/tmp/knodel-ab-peer-acquisition/go-stable-validated.txt
- Stability log: /private/tmp/knodel-ab-peer-acquisition/go-stability.log
- Stable Peer RPC peers: 0

## C++ Monolith

- Monolith exit code: skipped
- Monolith report: /private/tmp/knodel-ab-peer-acquisition/monolith-soak-report.md
- Monolith log: /private/tmp/knodel-ab-peer-acquisition/monolith-soak.log
- Duration seconds: 300
- Interval seconds: 15
- Startup grace seconds: 240
- Minimum head height: 1000
- JSON-RPC port: 18082
- P2P listen: /ip4/127.0.0.1/tcp/0

## Decision Rule

- If Go has no stable Peer RPC peer, do not treat C++ failure as evidence of a C++ bug.
- If Go has a stable Peer RPC peer and C++ fails against that same peer list, continue C++ compatibility debugging.
- If both pass, Gate F can move back to longer soak duration.
