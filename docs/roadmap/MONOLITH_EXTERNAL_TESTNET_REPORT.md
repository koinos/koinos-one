# Monolith External Testnet Report

Updated: 2026-05-24T15:50:06Z

## Result

- Status: passed
- Failure reason: none
- Started: 2026-05-24T15:44:58Z
- Finished: 2026-05-24T15:50:06Z
- Commit: ec1d737
- Dirty worktree entries on seed-host checkout at report time: 0

## Seed Host Isolation

- Host: `seed.koinosfoundation.org`
- Server clone path: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel`
- Run root: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel-private-testnet`
- Production safety decision: do not touch production containers, production basedir, RabbitMQ, nginx, or standard Koinos ports.
- Production stack observed earlier on the host: legacy Koinos Docker services are running, including p2p on public port `8888` and JSON-RPC bound to localhost.
- Isolated validation ports: seed RPC `28880`, producer RPC `28881`, observer RPC `28882`, seed p2p `28888`, producer p2p `28889`, observer p2p `28890`.
- Cleanup check after the run: `pgrep -fl 'koinos_node|private-testnet'` returned no matching external test processes.

## Build

- The remote branch `feat/monolithic-node-migration` was pulled through the GitHub deploy key.
- `scripts/build-cpp-libp2p-koinos.sh` completed on the external volume.
- Built node binary: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel/vendor/koinos/koinos-node/build/src/koinos_node`
- Built private-testnet keygen: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel/vendor/koinos/koinos-node/build/src/koinos_private_testnet_keygen`
- The private PoB genesis builder now uses the staged contract artifacts directly and does not require the `koinos-contracts-as` source tree or `koinos-proto-js` npm dependency on the seed host.

## Network Smoke

- Runtime shape: three monolith nodes on the seed host: `seed-1`, `producer-1`, `observer-1`
- Mode: `pob`
- Genesis runtime file: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel-private-testnet/genesis_data.json`
- Producer address: `1B8wp8A2gWGxDGLpgFHR8vtsH9ydP2Dv6W`
- Seed peer ID: `12D3KooWNMV1PsjzGnaXS6c6pk3ih3Q3asqtVBUQSj3NZYmWBmUM`
- Producer peer ID: `12D3KooWNhbwgL1KzaJ7jQ8vzfnxaRUt1Li76129RLRf3hidxENU`
- Chain IDs: seed `EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==`, producer `EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==`, observer `EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==`
- Produced height used for observer sync: `42`
- Final producer head height: `8736`
- Final observer head height: `8384`
- Final observer block-store highest height: `8384`
- Last produced height observed during soak: `8749`

## Soak

- Status: passed
- Requested duration seconds: 300
- Interval seconds: 30
- Samples file: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel-private-testnet/soak-samples.tsv`
- Samples: 11
- Initial producer head: 87
- Final producer head: 8736
- Initial observer head: 44
- Final observer head: 8384
- Initial observer block-store highest height: 44
- Final observer block-store highest height: 8384
- Stalled samples: 0
- Max consecutive stalled samples: 0
- Severe log matches: 0

## Store Checks

- Observer block-store check: ok
- Observer transaction-store check: ok
- Observer contract-meta-store check: ok
- Shutdown: clean

## Command

```bash
PRIVATE_TESTNET_MODE=pob \
PRIVATE_TESTNET_ROOT=/mnt/HC_Volume_105581636/knodel-external-signoff/knodel-private-testnet \
PRIVATE_TESTNET_BUILD=0 \
SOAK_DURATION_SECONDS=300 \
SOAK_INTERVAL_SECONDS=30 \
SEED_P2P_PORT=28888 \
PRODUCER_P2P_PORT=28889 \
OBSERVER_P2P_PORT=28890 \
SEED_RPC_PORT=28880 \
PRODUCER_RPC_PORT=28881 \
OBSERVER_RPC_PORT=28882 \
scripts/private-testnet-sprint2.sh
```
