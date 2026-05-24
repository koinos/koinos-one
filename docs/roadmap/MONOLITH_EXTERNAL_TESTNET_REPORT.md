# Monolith External Testnet Report

Updated: 2026-05-24T13:36:58Z

## Result

- Status: blocked
- Failure reason: PRODUCER_RPC_URL and OBSERVER_RPC_URL are required for shared/external testnet signoff
- Started: 2026-05-24T13:36:58Z
- Finished: 2026-05-24T13:36:58Z
- Commit: edc588d
- Dirty worktree entries at report time: 71

## Endpoints

- Producer RPC: not-configured
- Observer RPC: not-configured
- Seed RPC: not-configured

## Chain IDs

- Producer chain ID: not-run
- Observer chain ID: not-run
- Seed chain ID: not-run

## Soak

- Duration seconds: 1800
- Interval seconds: 60
- Samples file: /private/tmp/knodel-external-testnet-samples.tsv
- Samples: 0
- Initial producer head: not-run
- Final producer head: not-run
- Initial observer head: not-run
- Final observer head: not-run
- Initial observer block-store highest height: not-run
- Final observer block-store highest height: not-run
- Final observer lag: not-run
- Max allowed observer lag: 2000
- Stalled samples: 0
- Max consecutive stalled samples: 0
- Severe log matches: not-run

## Store Checks

- Enabled: 1
- Observer block-store check: not-run
- Observer transaction-store check: not-run
- Observer contract-meta-store check: not-run

## Seed Host Attempt

- Host: `seed.koinosfoundation.org`
- Date: 2026-05-24
- Production stack observed: legacy Koinos Docker services are running, including p2p on public port `8888` and JSON-RPC bound to localhost.
- Isolation decision: do not touch production containers, production basedir, RabbitMQ, nginx, or standard Koinos ports.
- Available isolated storage: `/mnt/HC_Volume_105581636` has enough space for a separate build/test workspace.
- GitHub deploy key: configured on `seed.koinosfoundation.org` and accepted by GitHub for `pgarciagon/knodel`.
- Server clone path: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel`.
- Current blocker: the remote clone succeeds, but the pushed `feat/monolithic-node-migration` branch is behind this local working tree and does not contain `scripts/external-pob-testnet-signoff.sh`, `scripts/private-testnet-sprint2.sh`, or the private PoB tooling yet.
- Required unblock: publish a scoped commit/branch containing the native monolith producer, private PoB contract artifacts/tools, and external signoff harness, then pull that branch on the seed host.
