# Monolith External Testnet Report

Updated: 2026-05-30T13:13:02Z

## Result

- Status: passed
- Failure reason: none
- Started: 2026-05-24T15:44:58Z
- Finished: 2026-05-24T15:50:06Z
- Commit: ec1d737
- Dirty worktree entries on seed-host checkout at report time: 0

## Public Testnet Observer Check

- Status: passed
- Date: 2026-05-25
- Public JSON-RPC: `https://testnet.koinosfoundation.org/jsonrpc`
- Public P2P multiaddr: `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`
- Chain ID observed from the initial monolith observer before public JSON encoding normalization: `EiAIKVvm6+V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`; current client-facing JSON-RPC returns the websafe value `EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`.
- Runtime mode: non-producing monolith observer with `chain`, `block_store`, `mempool`, `p2p`, `jsonrpc`, `contract_meta_store`, and `transaction_store` enabled; `block_producer`, `grpc`, and `account_history` disabled.
- Genesis/descriptors source: copied from `/root/koinos/config/genesis_data.json` and `/root/koinos/config/koinos_descriptors.pb` on `testnet.koinosfoundation.org` because the bundled local example genesis does not match the live public testnet chain ID.
- Exposure diagnosis: public TCP `8888` reaches the `koinos-p2p-1` container. A packet trace showed earlier resets were emitted by the p2p process after accept, consistent with temporary source-IP error scoring caused by repeated lightweight probe attempts. Restarting only `koinos-p2p-1` cleared the score without touching JSON-RPC or chain services.
- Raw exposure check: `scripts/probe-mainnet-seeds.sh` with `SEED_PROBE_PEER_RPC=0` succeeded over the public endpoint in `281ms` and observed protocol version `koinos/p2p/1.0.0`.
- Observer result: `koinos_node` connected to the public seed, completed Koinos handshake, logged connected peer snapshots, and synced from height `0` to `4000` in about `54s`.
- Error counters: `0` score-threshold rows; no peer disconnect rows during the observer run.
- Shutdown: clean SIGTERM shutdown after the observer check.

Operational note: use the raw libp2p-only probe for exposure checks. The default Peer RPC probe is useful for mainnet discovery, but against this single-node testnet it is not a full Koinos peer and repeated attempts can temporarily make the Go p2p error scorer reject the probing source IP before security negotiation. The authoritative validation for the monolith path is the non-producing observer run above.

## Producer Preparation

- Status: live monolith producer accepted on the public testnet.
- Producer-control wallet: `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- Funding: the account was faucet-funded in multiple rounds for producer validation.
- VHP burns: `95` KOIN in tx `0x1220b4954d9d4b5be350326a4a246d6ee4cdfa7f4ca12a379b68dc205053ed434ff3` at block `5248232`; `350,000` KOIN in tx `0x12203c7ac43e032ed02d614fecb41518265b6ae5da8e9d537fe16d3582364bb4108b` at block `5377934`; `2,500,000` KOIN in tx `0x1220081f1e69449f04ffdbb333ed82ff34435947196b9844527f11cdd65d1eb188a4` at block `5378193`.
- Latest producer-control balance check after the live transfer: `357.12936826` KOIN, `2,849,756.12511139` VHP, about `256.70108774` Mana.
- Producer-key registration: tx `0x1220ddc565480f6689f11735e9e2dd5b1add9949bb373e63ecba8e48eb148eb62505`, confirmed in block `5248344`.
- Registered producer public key: `AjyRoy9QlZP-AuojYV-cBlHC64mP-ZliaibjmjVnHL97`; `kcli get-producer-key` returns the expected 33-byte key.
- Generation: created with `kcli generate-wallet`, encrypted into the active `kcli` wallet, and set as both `defaultAccount` and `mainProducerAddress`.
- Previous wallet/config backup: `/Users/pgarcgo/.kcli/backups/`
- Monolith hot-key address: `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX`
- Monolith hot-key public key: `AjyRoy9QlZP-AuojYV-cBlHC64mP-ZliaibjmjVnHL97`
- Private hot-key material: stored only in local `0600` files under `/Users/pgarcgo/.kcli/knodel-testnet-producer`; do not commit it.
- Prepared monolith basedir: `/Users/pgarcgo/.kcli/knodel-testnet-producer/basedir`
- Prepared config: `/Users/pgarcgo/.kcli/knodel-testnet-producer/basedir/config.yml`
- Producer setting: `features.block_producer: true` since the 2026-05-30 controlled producer cutover.

The prepared basedir was also started as a non-producing observer with the same live-testnet seed and key paths. In a short check it reached head `3157`, had one connected peer, one completed handshake, six sync rows, and zero score-threshold rows. This verifies the future producer basedir can connect and sync before block production is enabled.

A later catch-up pass after on-chain producer-key registration advanced from height `3164` to `13664` in `120s`, but it also revealed one false peer-scoring event: while far behind, the node received a live future gossiped block and scored the seed for `unknown previous block`. The P2P gossip handler now ignores future gossiped blocks when local head is more than one block behind the gossiped height, and `koinos_p2p_one_peer_sync_test` covers this case. After rebuilding, a `90s` non-producing live catch-up advanced from height `13664` to `20738` with one handshake, 35 sync rows, nine connected-peer snapshots, zero warnings, and zero score-threshold rows.

A long non-producing catch-up was launched in a detached `screen` session with `caffeinate` guarding the node process. It reached height `4649031` before crashing with an uncaught RocksDB write exception while the internal macOS data volume had only `1.9 GiB` free. The prepared basedir was moved to `/Volumes/external/knodel-testnet-producer/basedir`, and `/Users/pgarcgo/.kcli/knodel-testnet-producer/basedir` is now a symlink to that external SSD path. This freed the internal data volume to about `11 GiB`. The observer sync was restarted from the symlinked basedir on 2026-05-30 and advanced from `4649615` to the live testnet head. At head `5376554`, local JSON-RPC and `https://testnet.koinosfoundation.org/jsonrpc` returned matching head height, LIB, state merkle root, and block time. The observer was then cleanly stopped, a config backup was written next to `config.yml`, and `features.block_producer` was changed to `true`.

The controlled producer restart succeeded at `2026-05-30T10:39:22Z` using the same synced basedir and JSON-RPC port `18122`. Startup loaded the configured producer, opened the existing RocksDB/state DB at head `5376520`, completed P2P handshake with `QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, opened the gossip production gate, and kept local and remote heads equal through `5376801` during a 10-minute monitor. The checked log window had `0` warning rows and `0` score-threshold rows. No local `[block_producer] Produced block` row appeared during that first monitor window.

The missing production was diagnosed after the producer account was increased to `2,850,095` effective VHP, roughly 54% of the observed VHP total supply at the time. The issue was not stake availability: the producer cached a PoB candidate block and could keep it after the local head advanced. When the VRF later won, the stale candidate could be proposed against an obsolete `previous` block and be rejected without a visible produced-block log. `BlockProducer::produce_pob_once` now refreshes the PoB bundle when the local head changes, and `koinos_block_producer_test` covers this regression.

After rebuilding and restarting the live producer at `2026-05-30T12:10:08Z`, the monolith immediately produced accepted public-testnet blocks. Public RPC verification with `kcli --network testnet block` confirmed:

- Height `5378368`, block id `0x12204c466d782f00435bfab17a47b6d9636da67995965692e4eea6fd42eb27619dbb`, signer `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`.
- Height `5378369`, block id `0x1220b80ace4aaf138f0e9ab3077d70a28795b20ebc883e02d6828108cb12bcd63e31`, signer `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`.
- Local JSON-RPC and `https://testnet.koinosfoundation.org/jsonrpc` matched at head `5378374` with the same block id, LIB, state merkle root, and block time.
- Recent producer log window after restart contained produced blocks at heights `5378360`, `5378361`, `5378363`, `5378368`, `5378369`, `5378372`, and `5378374`, with `0` warning or score-threshold rows.

During the post-signoff soak, the producer later disconnected from the only public testnet seed with `checkpoint mismatch` and stopped advancing at height `5378534`. The local block at `5378534` matched the public RPC block ID, so this was not local chain corruption. The root cause was a monolith P2P compatibility issue: C++ sync was checking peer ancestry against the current local head, while legacy `koinos-p2p` anchors live sync on the local LIB and treats competing forks above LIB as normal. `P2PNode::peer_handshake` no longer performs a volatile-head ancestry check, and `P2PNode::request_sync_blocks` now verifies that the peer contains the local LIB, skips sync if the peer head is already known locally, and requests blocks from `LIB+1`. `koinos_p2p_one_peer_sync_test` covers the local-head/peer-head fork-above-LIB case without disconnecting.

After rebuilding and restarting at `2026-05-30T12:26:38Z`, the producer reconnected to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, caught up from the LIB anchor, reopened the gossip production gate, and produced accepted block `5378792` (`0x1220d2a5bdd51fe1de9b25fb798f851ca1006214db9e2fb66f4d48207d1764e3aee5`) signed by `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`. Local JSON-RPC and public RPC matched at head `5378802`, and the status reporter showed `warnings=0` and `score threshold rows=0`.

Live `kcli` transaction validation was completed at `2026-05-30T13:11:57Z` through the monolith JSON-RPC endpoint `http://127.0.0.1:18122`. The compatibility work required two JSON-RPC fixes:

- Koinos public JSON normalization: Base58 account/contract fields and `0x` byte ids are converted to protobuf JSON bytes on input, while `chain.get_chain_id`, `chain.get_head_info`, `chain.get_account_nonce`, and `chain.read_contract` return the websafe/base64url byte encoding expected by `kcli`/koilib.
- HTTP keep-alive handling: the monolith JSON-RPC server now handles multiple requests on the same socket instead of closing after the first request, which prevented `kcli` from seeing `ECONNRESET` during its concurrent read path.

Validation result:

- `kcli -r http://127.0.0.1:18122 transfer 1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX 0.01 --dry-run` succeeded against the monolith JSON-RPC.
- The real transfer submitted tx `0x12209ffc21122d2dfd36b01be685bb88a6867b8325c350df5312714b7f316e0f27cb`.
- `kcli` confirmed the tx in block `5380195`.
- The local monolith producer log shows block `5380195` was produced locally with `1 transaction` and removed that tx from mempool.
- Public `kcli -r https://testnet.koinosfoundation.org/jsonrpc block 5380195` shows the same tx id.
- Public balance verification showed recipient `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX` at `0.01` KOIN.
- Local and public `chain.get_head_info` matched at head `5380210` after the transfer.
- Focused CTest passed after the JSON-RPC change: `koinos_p2p_one_peer_sync_test` and `koinos_block_producer_test`.

Next external-testnet action: keep the running producer in a longer soak and track uptime, accepted-block continuity, transaction inclusion, rejected proposals, peer count, and errors.

## External Legacy Observer VPS1

- Status: running and syncing from genesis.
- Updated: 2026-05-30T13:57:37Z
- Host: `46.225.170.6`
- Install path: `/opt/koinos-testnet-legacy-observer`
- Runtime shape: legacy Docker microservice observer stack with `block_producer` disabled.
- Public P2P multiaddr: `/ip4/46.225.170.6/tcp/28888/p2p/QmeJnbWzRZ91zgTDTxs1UdsbRFFM6B26PntLdk69N63ePY`
- JSON-RPC: bound to remote localhost only at `http://127.0.0.1:18080/`.
- Firewall: UFW is active and allows `28888/tcp`.
- Safety scope: existing non-Koinos Docker services on the VPS were not modified.

Validation performed from the Mac:

- `nc -vz -w 5 46.225.170.6 28888` succeeded.
- Raw libp2p probe succeeded with protocol `koinos/p2p/1.0.0`.
- Full Peer RPC probe succeeded with the expected live-testnet chain ID `0x122008295be6ebe576aa6b2652f3c9cb4f6f0822dbb67f651c5a70ac96dc4c811645`.
- Latest checked VPS observer head during setup: `12775`.
- VPS JSON-RPC returned head `7918` shortly before the full Peer RPC probe returned `8253`, then a follow-up JSON-RPC check returned `12775`, confirming active catch-up.
- P2P logs show block ranges being requested from `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`.
- Disk at setup time: `109G` free on `/`; observer data was still only `115M`.

Operational note: this node is useful immediately for external topology and Peer RPC compatibility checks, but it should not yet be used as an independent near-head witness for monolith-produced blocks. Wait until its local head catches up to the public testnet head before using it for acceptance signoff.

## External Legacy Observer VM2

- Status: running and syncing from genesis; full external Peer RPC validation pending.
- Updated: 2026-05-30T14:06:06Z
- Host: `46.62.155.105`
- Install path: `/opt/koinos-testnet-legacy-observer`
- Runtime shape: legacy Docker microservice observer stack with `block_producer` disabled.
- Public P2P multiaddr: `/ip4/46.62.155.105/tcp/28888/p2p/QmXfSaJjSPSivJURC9RrCGKGmKtB3EA3AWEUksY2e189R3`
- JSON-RPC: bound to remote localhost only at `http://127.0.0.1:18080/`.
- Firewall: UFW is inactive; host TCP `28888` is reachable externally.
- Host size at setup: `2` vCPU, `4 GiB` RAM, about `29 GiB` free on `/`.
- Safety scope: no unrelated services were present or modified.

Validation performed from the Mac:

- Key-based SSH was installed and verified.
- Docker and Compose were already installed: Docker `28.4.0`, Compose `v2.39.2`.
- All expected observer containers are running: `amqp`, `block_store`, `chain`, `contract_meta_store`, `jsonrpc`, `mempool`, `p2p`, and `transaction_store`.
- Chain logs show the expected live-testnet chain ID `0x122008295be6ebe576aa6b2652f3c9cb4f6f0822dbb67f651c5a70ac96dc4c811645`.
- P2P logs show connection to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W` and block-range requests from that seed.
- VM2 JSON-RPC advanced from height `23` to `6194` during setup.
- `nc -vz -w 5 46.62.155.105 28888` succeeded.
- A full Peer RPC probe reached `GetChainID`, but `GetHeadBlock` reset while the node was under heavy initial catch-up load. Later probes from this Mac hit security resets, consistent with temporary source-IP scoring. Treat full Peer RPC validation as pending until a later probe succeeds.

Operational note: VM2 should not be added as a required monolith sync peer or used as an independent block-acceptance witness until it catches up further and passes the full Peer RPC probe. It is currently useful as a second external legacy observer that proves the public seed can feed another node from genesis.

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
