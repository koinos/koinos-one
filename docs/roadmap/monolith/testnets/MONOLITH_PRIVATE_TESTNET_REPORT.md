# Monolith Private Testnet Report

Updated: 2026-05-24T12:45:28Z

## Result

- Status: passed
- Failure reason: none
- Started: 2026-05-24T12:14:54Z
- Finished: 2026-05-24T12:45:28Z
- Commit: edc588d
- Dirty worktree entries at report time: 69
- Run root: /private/tmp/knodel-private-testnet
- Mode: pob

## Network Smoke

- Runtime shape: three local monolith nodes: seed-1, producer-1, observer-1
- Genesis source: /Users/pgarcgo/code/knodel/vendor/koinos/koinos/harbinger/config-example/genesis_data.json
- Genesis runtime file: /private/tmp/knodel-private-testnet/genesis_data.json
- Genesis patch: deterministic private PoB bootstrap with system-contract bytecode, dispatch, name-service records, producer public-key registration, KOIN/RC balance, VHP stake, and VHP burn allowance
- Producer address: 1B8wp8A2gWGxDGLpgFHR8vtsH9ydP2Dv6W
- Seed peer ID: 12D3KooWLU6PtGwYMxNqdktkfFcNg3PEJXYS3X3NwQ5KXBuN3VJP
- Producer peer ID: 12D3KooWQiBT8N4CknQmymBqqkQCf7xgxaGZPFW1zLfdJ5kfeKcg
- Seed RPC: http://127.0.0.1:18880/
- Producer RPC: http://127.0.0.1:18881/
- Observer RPC: http://127.0.0.1:18882/
- Chain IDs: seed=EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==, producer=EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==, observer=EiBsk/wG9kMpO98mGY0uBuvFIu0lfIFMLfHdrZz2dqmcQA==
- Produced height used for observer sync: 65
- Producer head height: 74362
- Observer head height: 73842
- Observer block-store highest height: 73842
- Produced block log: 2026-05-24 14:14:58.695339 (koinos_node.ptZ3a) [block_producer.cpp:323] <info>: [block_producer] Produced block - Height: 65, ID: 0x1220a6528c4323cd35b0dd4eaad88e96f78a5030ef303a83f08c83b71472bb10bfaa (0 transactions)

## Soak

- Status: passed
- Requested duration seconds: 1800
- Interval seconds: 60
- Started: 2026-05-24T12:15:10Z
- Finished: 2026-05-24T12:45:11Z
- Samples file: /private/tmp/knodel-private-testnet/soak-samples.tsv
- Samples: 31
- Initial producer head: 584
- Final producer head: 74362
- Initial observer head: 235
- Final observer head: 73842
- Initial observer block-store highest height: 252
- Final observer block-store highest height: 73842
- Stalled samples: 0
- Max consecutive stalled samples: 0
- Severe log matches: 0
- Last produced height: 74424
- Last produced block log: 2026-05-24 14:45:13.052233 (koinos_node.ptZ3a) [block_producer.cpp:323] <info>: [block_producer] Produced block - Height: 74424, ID: 0x12207706d0c1a7cd6700bb134501717d5d82216d0745234725e73b4464c5c55d9cca (0 transactions)

## Verification

- Producer uses block_producer.gossip-production: true.
- Private smoke uses p2p.force-gossip: true to avoid the genesis-height circularity where a new network has no recent head block yet.
- Observer is seeded with both the seed node and producer node multiaddrs so direct producer sync is exercised after bootstrap.
- Observer acceptance is verified through chain.get_head_info.
- EventBus fanout to block store is verified through block_store.get_highest_block on observer.
- Transaction store health check: ok
- Contract meta store health check: ok
- Shutdown: clean

## Phase B PoB/VHP

PoB/VHP signoff status: passed. Inspection on 2026-05-24 found that the Harbinger genesis used for Phase A has only six metadata entries, and the full Koinos config-example genesis contains launch KOIN balances but not a complete private PoB/VHP/name-service state that can be safely patched by adding one balance row. The deterministic bootstrap path now builds a private PoB genesis from the staged system-contract artifacts, registers the producer hot public key, gives the producer KOIN/RC and effective VHP, seeds the producer-to-PoB VHP burn allowance needed by private bootstrap, and enables block_producer.algorithm: pob when PRIVATE_TESTNET_MODE=pob.

Bootstrap summary: /private/tmp/knodel-private-testnet/bootstrap-summary.json

## Phase B Genesis Readiness Probe

| Genesis | Entries | Federated-ready | PoB-ready | System dispatch | Contract bytecode | Contract metadata | KOIN balances |
|---------|---------|-----------------|-----------|-----------------|-------------------|-------------------|---------------|
| `/private/tmp/knodel-private-testnet/genesis_data.json` | 37 | yes | yes | 5 | 4 | 4 | 1 |
| `vendor/koinos/koinos/harbinger/config-example/genesis_data.json` | 6 | yes | no | 0 | 0 | 0 | 0 |
| `vendor/koinos/koinos/config-example/genesis_data.json` | 3761 | yes | no | 0 | 0 | 0 | 3754 |

- `/private/tmp/knodel-private-testnet/genesis_data.json`: static PoB prerequisites detected.
  Warning: no transaction nonce entries detected; bootstrap transactions must initialize nonce state through chain execution.
- `vendor/koinos/koinos/harbinger/config-example/genesis_data.json`: not PoB-ready: missing kernel system-call dispatch entries for post-genesis contract-backed calls; missing kernel contract bytecode entries; missing kernel contract metadata entries; missing system-call dispatch key 101 (process_block_signature); missing system-call dispatch key 201 (get_account_rc); missing system-call dispatch key 202 (consume_account_rc); missing system-call dispatch key 10000 (get_contract_name); missing system-call dispatch key 10001 (get_contract_address).
  Warning: no launch KOIN metadata/balance state detected.
  Warning: no transaction nonce entries detected; bootstrap transactions must initialize nonce state through chain execution.
- `vendor/koinos/koinos/config-example/genesis_data.json`: not PoB-ready: missing kernel system-call dispatch entries for post-genesis contract-backed calls; missing kernel contract bytecode entries; missing kernel contract metadata entries; missing system-call dispatch key 101 (process_block_signature); missing system-call dispatch key 201 (get_account_rc); missing system-call dispatch key 202 (consume_account_rc); missing system-call dispatch key 10000 (get_contract_name); missing system-call dispatch key 10001 (get_contract_address).
  Warning: contract storage exists without matching checked-in contract bytecode entries.
  Warning: no transaction nonce entries detected; bootstrap transactions must initialize nonce state through chain execution.
