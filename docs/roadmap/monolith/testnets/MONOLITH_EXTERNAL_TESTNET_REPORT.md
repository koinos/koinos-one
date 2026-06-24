# Monolith External Testnet Report

> Historical note: This file preserves command output, validation context, and artifact paths from runs that predate the Teleno repository and runtime cleanup. Old `knodel-*`, `koinosgui`, `Knodel.app`, or `/code/knodel` paths are evidence references only; current active repo paths and generated artifacts use Teleno names.

Updated: 2026-05-31T09:27:39Z

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

Follow-up producer soak check at `2026-05-30T15:19:04Z`: the live producer process was still running as PID `32977`, guarded by `caffeinate -dims -w 32977`, connected to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, and local JSON-RPC matched public RPC at head `5382991` with the same block id, LIB, state merkle root, and block time. The recent log window contained `126` produced-block rows and `0` warning, score-threshold, checkpoint-mismatch, or gossip-gate rows. External SSD free space was about `19 GiB`, above the current `10 GiB` stop floor but close enough to keep monitoring during longer soaks.

The first reusable regression runner implementation was added as `scripts/live-producer-transaction-regression.sh` with Python-backed result generation in `scripts/live-producer-transaction-regression.py`. A Level 1 run at `2026-05-30T15:38:46Z` passed: Phase 1 health gate and Phase 2 `kcli` read compatibility both passed, local/public heads matched at height `5383384`, recent log sampling found `774` produced-block rows, `0` warning rows, `0` score-threshold rows, and external SSD free space was `18.81 GiB`. The run wrote machine-readable output to `/private/tmp/knodel-transaction-regression/20260530T153846Z/result.json` and Markdown output to `/private/tmp/knodel-transaction-regression/20260530T153846Z/result.md`.

Level 2 is executable end-to-end without exposing the wallet password. `kcli` gained `--password-file <path>` for `transfer`, `token-transfer`, `register-producer-key`, and `burn`, plus `--yes` for explicit non-interactive confirmation. `kcli transfer` and `kcli token-transfer` now also support `--no-wait` and `--nonce <base64url>` so higher regression levels can submit multiple signed transfers without waiting for block inclusion while controlling nonce values deterministically. The regression runner passes the password-file path without reading or printing the secret and uses `--yes` only for real submit phases. A Level 2 run at `2026-05-30T16:04:50Z` passed with `--submit-transfers`: tx `0x12200870e83d9d6f65c9f8e09f9686c945bea1a751787097b53d0e105c2f9978d769` transferred `0.001` KOIN to `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX`, was confirmed in block `5383945`, appeared in the public block output, and the local producer log showed the monolith produced block `5383945` with `1 transaction`. Result files: `/private/tmp/knodel-transaction-regression/20260530T160450Z/result.json` and `/private/tmp/knodel-transaction-regression/20260530T160450Z/result.md`.

Level 3 passed at `2026-05-31T06:31:56Z` with `--submit-transfers`: Phase 1 through Phase 6 all passed. The valid transfer smoke tx `0x1220c9031596e8960d0800cba757e68e38699af9bbf67446dd0502cfa621ed5995a4` was confirmed in locally produced public block `5400851`. The functional batch then submitted five additional `0.001` KOIN transfers, confirmed in public blocks `5400858`, `5400864`, `5400872`, `5400878`, and `5400882`. The negative dry-run check initially exposed a runner convention mismatch because `kcli --dry-run` returns exit code `0` while printing `Insufficient token balance`; the runner now treats that explicit rejection marker as a passing negative test. Contract reads and producer state reads passed after the batch. Result files: `/private/tmp/knodel-transaction-regression/20260531T063156Z/result.json` and `/private/tmp/knodel-transaction-regression/20260531T063156Z/result.md`.

The practical-route Level 3 implementation now includes true mempool pressure and safe complex-operation checks. At `2026-05-31T09:07:17Z`, the runner read the producer account nonce from local `chain.get_account_nonce`, encoded explicit Koinos `value_type.uint64_value` nonces, submitted three signed `0.001` KOIN transfers through `http://127.0.0.1:18122` with `kcli --no-wait --nonce`, sampled `mempool.get_pending_transactions`, and then polled public blocks until every submitted tx id was found. Mempool samples showed counts `1`, `2`, and `3` after the submissions, followed by a final drain to `0`; public block `5403845` contained all three burst transactions. This is no longer just a sequential functional batch. The same run also executed PoB `burn --amount 0.001 --dry-run` and `register-producer-key --dry-run` using the currently registered producer key; both dry-runs passed. The overall result was `warn` because the rolling log window still contained one known transient `[block_producer] cannot retrieve pending transactions from an unknown block` warning, while severe warnings, score-threshold, checkpoint-mismatch, and gossip-gate rows were zero. Result files: `/private/tmp/knodel-transaction-regression/20260531T090717Z/result.json` and `/private/tmp/knodel-transaction-regression/20260531T090717Z/result.md`.

Real system-contract mutation mode is now implemented behind explicit `--submit-system-ops`. The first real attempt confirmed a PoB burn but exposed that `kcli register-producer-key` could print `insufficient pending account resources` while returning process exit code `0`; the runner now detects printed CLI error markers, and `kcli register-producer-key` now uses a bounded 10% mana RC limit instead of allowing the transaction builder to reserve too much. After that fix, a Level 3 run at `2026-05-31T09:18:55Z` passed with both transfer load and real system operations. Transfer smoke tx `0x1220133750d4b183a83914f95f77c71373458fcef80f896474f0bca621555c8a119a` confirmed in block `5404089`. The non-waiting burst showed local mempool counts `1` and `2`, drained to `0`, and both burst txs appeared in public block `5404093`. Real PoB burn tx `0x1220f05585d81f302b9cfe600ea2acd14d7db63c49d3f4bb910687d557a5a91c97c9` confirmed in block `5404099`. Same-key producer registration tx `0x1220e0a72b37541a065a496fbc29a98a507b4770fb85e5401e1d51446b99ad3c4907` confirmed in block `5404105`, and `kcli get-producer-key` still returned `AjyRoy9QlZP-AuojYV-cBlHC64mP-ZliaibjmjVnHL97`. Re-registering the same key briefly refreshed the protocol activation window and produced `public key not yet active` rows, then the monolith producer resumed accepted own block production at heights `5404127` and `5404129`. The runner was tightened so future real key registration requires `--submit-producer-registration`; `--submit-system-ops` alone performs the real PoB burn and skips producer-key registration. The overall result remained `warn` only because of the known transient block-producer warning in the rolling log window; severe warnings, score-threshold, checkpoint-mismatch, and gossip-gate rows were zero. Result files: `/private/tmp/knodel-transaction-regression/20260531T091855Z/result.json` and `/private/tmp/knodel-transaction-regression/20260531T091855Z/result.md`.

A bounded Level 5 run started at `2026-05-31T06:34:52Z` and finished at `2026-05-31T06:39:05Z`. It passed Phases 1 through 6, Phase 8 soak sampling, and Phase 9 performance sampling, but the overall result is intentionally `blocked` because Phase 7 has no configured near-head external observer RPC yet. The run included smoke tx `0x1220775cfa8d646cb5a580f3033973fea5b1a6274de61895d5f6285b45eafc65429d` in locally produced public block `5400903`, plus two functional batch transfers confirmed in blocks `5400906` and `5400912`. Performance sampling collected eight samples with local RPC latency p95/max `2.38ms`, heads matching in the sampled windows, disk free around `18.75 GiB`, and `0` warning, score-threshold, checkpoint-mismatch, or gossip-gate rows at the health gate. Result files: `/private/tmp/knodel-transaction-regression/20260531T063452Z/result.json` and `/private/tmp/knodel-transaction-regression/20260531T063452Z/result.md`.

VPS1 later caught up and became a valid independent legacy observer witness. A first Level 5 rerun at `2026-06-02T16:24:58Z` used an SSH tunnel to the VPS1 localhost JSON-RPC and passed Phase 7 with observer/public head match and `observer_lag=0`, but the overall result was `warn` because the mempool burst was configured with the default `TX_INTERVAL=10`, so all transactions were included but no sampled block contained more than one burst transaction. The run still passed health, client reads, transfer smoke, negative dry-run rejection, contract/producer state reads, independent observer verification, soak sampling, and performance sampling. Result files: `/private/tmp/knodel-transaction-regression/20260602T162458Z/result.json` and `/private/tmp/knodel-transaction-regression/20260602T162458Z/result.md`.

The Level 5 external-observer regression passed fully on `2026-06-02T16:36:36Z` after rerunning with `TX_INTERVAL=0`. Phase 1 through Phase 9 all passed while the live monolith producer stayed running. The valid transfer smoke tx `0x12208e5456da712437310fb617915f588a27576b6702acfa0023ea3a006d11d512f1` was confirmed in locally produced public block `5468691`. Phase 4 submitted five explicit-nonce `0.001` KOIN transfers without waiting; local mempool samples rose from `0` to `1`, `2`, `3`, `4`, and `5`, then drained to `0`, and public block `5468695` included all five burst transactions. Phase 7 passed with VPS1 observer head matching public RPC at height `5468696` and `observer_lag=0`. Phase 9 collected 20 bounded performance samples with local RPC latency p95 `3.45ms` and max `4.67ms`. The run did not submit system operations or producer-key registration. Result files: `/private/tmp/knodel-transaction-regression/20260602T163636Z/result.json` and `/private/tmp/knodel-transaction-regression/20260602T163636Z/result.md`.

Longer live-producer soak checkpoint at `2026-05-30T23:19:05Z`: the producer keep-alive process had been running for more than `10h`, with `caffeinate -dims -w 32977` still active. Local JSON-RPC and public RPC matched at head `5392416` with the same block id and LIB. The checked rolling log window contained `778` produced-block rows and `552` public-seed peer rows, with `0` warning, score-threshold, checkpoint-mismatch, or gossip-gate rows. External SSD free space was `18.78 GiB`, still above the `10 GiB` stop floor.

## Transaction and Operation Regression Suite

Purpose: move the live producer signoff beyond empty-block production and define a reusable regression suite for future monolith changes. Any feature that can affect JSON-RPC encoding, wallet/client compatibility, mempool behavior, block assembly, transaction execution, P2P propagation, producer timing, block-store/transaction-store writes, or contract state reads should run this suite, or a clearly justified subset, before being considered stable.

These tests must use small testnet values, avoid exposing wallet passwords or key material, and keep the monolith producer running unless a safety condition is triggered.

Run this suite for:

- Changes to `jsonrpc_server.cpp`, protobuf JSON normalization, HTTP keep-alive handling, or public client compatibility.
- Changes to mempool admission, pending nonce/resource accounting, transaction expiration, or transaction event routing.
- Changes to block production, PoB timing, transaction selection, failed-transaction retry, Merkle root calculation, signing, or producer gating.
- Changes to P2P sync, gossip, Peer RPC, fork/LIB handling, or peer scoring.
- Changes to block store, transaction store, contract meta store, chain state indexing, or migration code that could affect produced block persistence.
- Release candidates, packaging smoke tests, and any long-running soak intended to sign off a user-facing build.

Minimum regression levels:

- Level 1, client/read smoke: Phase 1 and Phase 2. Use for low-risk UI/packaging changes that should not alter chain behavior but still need to prove the running node remains reachable.
- Level 2, transaction smoke: Phase 1 through Phase 3. Use for JSON-RPC, wallet/client, or small producer changes.
- Level 3, transaction regression: Phase 1 through Phase 6. Use for mempool, block producer, chain, store, or P2P changes.
- Level 4, external acceptance regression: Phase 1 through Phase 8. Use for release candidates, soak signoff, mainnet-readiness work, or any change that previously caused fork, checkpoint, score-threshold, or transaction-inclusion issues.
- Level 5, performance regression: Phase 1 through Phase 9. Use for optimization work, producer/mempool/P2P changes, release candidates, and any change where throughput, latency, resource usage, or propagation behavior could regress.

Each run should record:

- Git commit, dirty worktree state, monolith binary path, config path, and basedir path.
- Local head, public head, LIB, state merkle root, and produced block ids before and after the run.
- Every submitted tx id, inclusion height, producing node evidence, public RPC evidence, and external observer evidence when available.
- Warning count, score-threshold count, checkpoint mismatch count, peer snapshots, disk free space, and whether caffeinate/status reporter were active.
- Performance metrics when Phase 9 is included: RPC latency samples, submit-to-inclusion latency, local-to-public propagation latency, observer propagation latency, produced-block transaction counts, CPU, memory, disk free space, data directory growth, and log growth.
- A clear pass/fail result plus follow-up action for every failed phase.

Safety limits for live testnet runs:

- Use a dedicated low-value regression recipient when possible. The current monolith hot-key address can be used for smoke validation, but repeated regression transfers should prefer a separate sink address so producer/hot-key operational balances remain easy to reason about.
- Keep the default single-transfer amount at or below `0.01` KOIN and the default batch total at or below `0.10` KOIN unless a larger resource test is explicitly required.
- Never print, commit, or export wallet passwords, WIF keys, faucet secrets, Telegram tokens, or raw signed transactions containing sensitive local metadata.
- Do not intentionally submit malformed or stale signed transactions on the live public testnet unless the transaction generator is deterministic, the expected failure mode is known, and wallet nonce state will not be corrupted.
- Stop the suite immediately if the monolith disconnects from the seed, the gossip production gate closes, the local head lags monotonically, or warning/score-threshold/checkpoint rows appear.

Implementation target:

- Reusable runner implemented: `scripts/live-producer-transaction-regression.sh` executes the safe levels of this suite against configurable RPC endpoints and writes JSON plus Markdown result files.
- Suggested environment inputs: `LOCAL_RPC=http://127.0.0.1:18122`, `PUBLIC_RPC=https://testnet.koinosfoundation.org/jsonrpc`, `RUN_ROOT=/Users/pgarcgo/.kcli/knodel-testnet-producer`, `RECIPIENT_ADDRESS=<controlled test address>`, `TRANSFER_AMOUNT=0.001`, `TX_COUNT=5`, and `RESULT_DIR=/private/tmp/knodel-transaction-regression`.
- The runner should write a machine-readable result file with tx ids, block ids, heights, before/after heads, warning counters, and pass/fail status. It must redact secrets and should not require secrets in environment variables.
- The runner should be able to execute `--level 1`, `--level 2`, `--level 3`, `--level 4`, or `--level 5`, matching the regression levels above.
- Negative transaction tests should default to dry-run/client-side validation on the live public testnet. Actual invalid signed transaction submission should be confined to a private testnet or a purpose-built harness.
- Performance mode should support `--sample-seconds`, `--tx-count`, `--tx-interval`, and `--max-total-koin` so load remains bounded and repeatable.
- Transfer phases that use `kcli` can run unattended with `--kcli-password-file <0600-password-file>` or manually with `--interactive-kcli` so the wallet password prompt stays on the user's terminal. Do not pass wallet passwords directly through environment variables or logs.

### Phase 1: Baseline Health Gate

Run this before each transaction batch:

- Compare local monolith head at `http://127.0.0.1:18122` with `https://testnet.koinosfoundation.org/jsonrpc`.
- Verify `koinos_node` PID, caffeinate guard, external SSD free space, peer snapshots, recent produced rows, warnings, and score-threshold rows.
- Abort transaction tests if the node is isolated, lagging, has recent `checkpoint mismatch`, has score-threshold rows, or is not producing accepted blocks.
- Run the head comparison twice a few seconds apart when local/public heads differ by one or two blocks. The producer can be briefly ahead of public RPC during normal live propagation; this is not a failure if the public RPC converges to the same block id.

Exit criteria:

- Local and public heads are equal or within a normal short live-race window and converge on repeat.
- Recent producer log has connected peer snapshots and produced blocks.
- Warning and score-threshold counters are zero for the checked window.

### Phase 2: Client Read Compatibility

Use `kcli` against both the monolith JSON-RPC and the public testnet JSON-RPC:

- `kcli -r http://127.0.0.1:18122 chain-info`
- `kcli -r http://127.0.0.1:18122 balance`
- `kcli -r http://127.0.0.1:18122 vhp 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- `kcli -r http://127.0.0.1:18122 get-producer-key 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- Read recent blocks produced by the monolith with `kcli -r http://127.0.0.1:18122 block <height> --full` and verify the signer, transaction count, and block id against public RPC.

Exit criteria:

- Monolith and public RPC return the same head/LIB after convergence.
- Producer key and balances match public RPC.
- Recent produced block ids match public RPC for the same heights.

### Phase 3: Valid Transfer Smoke

Submit one small transfer through the monolith JSON-RPC, using dry-run first:

- Dry-run a small KOIN transfer from the producer-control wallet to a controlled regression recipient.
- Submit the real transfer only if dry-run succeeds.
- Record tx id, local inclusion block, public RPC inclusion block, and recipient balance delta.
- Inspect the producer log for a produced block containing `1 transaction` or the expected transaction count.

Exit criteria:

- The transaction is accepted through `http://127.0.0.1:18122`.
- It is included in a block produced locally by the monolith when this producer wins the relevant block. If another producer includes it first, record that separately as a propagation/client success but not as a monolith block-assembly success.
- Public RPC returns the same transaction id in the same block.
- Balance delta matches the transfer amount after fees/resource behavior expected by the client.

### Phase 4: Mempool Burst

Submit a small burst of valid transfers through the monolith JSON-RPC. There are two different submodes and they should not be conflated:

- Functional batch: send `5` to `10` small transfers sequentially with `kcli`. This proves repeated wallet/client submission, repeated JSON-RPC keep-alive behavior, inclusion, and state updates. It may not create sustained mempool pressure if `kcli` waits for confirmation between transfers.
- Real mempool pressure: the runner uses `kcli --no-wait --nonce` with explicit Koinos nonce values derived from `chain.get_account_nonce`, submits multiple signed transactions without waiting for block inclusion, and then polls public blocks until every tx id appears. This is the required mode before claiming that the live monolith passed a true mempool pressure test.
- Use conservative testnet amounts, for example `0.001` to `0.01` KOIN per transfer, and keep the default batch total under `0.10` KOIN.
- Track every tx id, inclusion height, producing block id, and whether the including block was produced by the monolith.
- Verify whether transactions are included in one produced block or spread across several produced blocks; both can be acceptable if no transaction is lost and inclusion latency is bounded.

Exit criteria:

- No accepted transaction is lost.
- For functional batch mode, every submitted transaction is eventually included or rejected with a clear client/RPC error.
- For real mempool pressure mode, `mempool.get_pending_transactions` shows pending transactions before inclusion and drains after inclusion.
- Produced blocks include the expected transactions.
- Local and public RPC agree on included transaction ids and block ids.
- No warning, score-threshold, checkpoint mismatch, or producer retry loop appears.

### Phase 5: Negative Transaction Handling

Run non-destructive rejection checks. Keep live public-testnet negative tests conservative:

- Client-side rejection: dry-run a deliberately invalid transfer amount that exceeds liquid KOIN and record the expected failure without submitting.
- RPC/chain rejection: only run on live testnet if the failure is known to be safe and does not mutate wallet nonce state. Otherwise run it in a private testnet.
- Duplicate/stale nonce rejection: do not attempt manually with the active wallet. Use a purpose-built transaction generator or private testnet harness that can control nonce and replay behavior safely.
- Query `kcli nonce <address>` and, where available, pending nonce/account nonce before and after the negative case.

Exit criteria:

- Invalid operations are rejected at the expected layer: client dry-run, JSON-RPC, mempool, or chain. Record which layer rejected the operation.
- Rejected submitted transactions are not included in produced blocks.
- Mempool remains usable for a subsequent valid transfer.
- Producer continues producing accepted blocks after the rejection.

### Phase 6: Contract Reads and Producer State Reads

Exercise read-only contract and chain paths through the monolith:

- `kcli -r http://127.0.0.1:18122 balance 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- `kcli -r http://127.0.0.1:18122 balance <regression-recipient-address>`
- `kcli -r http://127.0.0.1:18122 vhp 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- `kcli -r http://127.0.0.1:18122 get-producer-key 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- Safe mode runs PoB `burn --dry-run` and `register-producer-key --dry-run`.
- Mutating testnet mode requires `--submit-system-ops`; it performs a small real PoB burn and re-registers the currently active producer public key, then verifies `get-producer-key`.
- `kcli -r http://127.0.0.1:18122 nonce 1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`
- `kcli -r http://127.0.0.1:18122 block <height-or-id> --full`

Exit criteria:

- Monolith read responses match public RPC after convergence.
- Byte encodings remain compatible with `kcli`/koilib.
- No keep-alive or repeated-request `ECONNRESET` appears during repeated reads.

### Phase 7: Independent Observer Verification

After VPS1 or VM2 catches up close to the public testnet head:

- Query the external legacy observer JSON-RPC locally over SSH.
- Verify that the observer height is at or beyond the transaction inclusion height before checking the block.
- Verify that it sees the same transaction inclusion block and block id as the local monolith and public RPC.
- Re-run Peer RPC probe against the observer if needed.

Exit criteria:

- At least one legacy observer independently reaches the same block containing a monolith-submitted transaction.
- The observer stays connected and does not report fork or checkpoint errors.
- This witness can be recorded as cross-implementation acceptance, not just public RPC acceptance.

### Phase 8: Soak With Transaction Injection

During the longer producer soak:

- Inject one small valid transfer every `30` to `60` minutes for a limited window, or run a small fixed batch at the start and end of the soak.
- Keep the hourly Telegram/status reporter active.
- Track produced block continuity, transaction inclusion latency, warnings, score-threshold rows, peer snapshots, disk free space, and local/public head convergence.
- Bound the test: define maximum number of transactions, maximum total KOIN spent, start/end time, and stop conditions before the soak begins.

Exit criteria:

- Producer remains up for the target soak window.
- Transaction inclusion latency is bounded and explainable.
- No accepted transaction disappears.
- No checkpoint mismatch, score-threshold disconnect, or gossip production gate closure recurs.
- Local monolith, public RPC, and at least one caught-up external legacy observer agree on transaction/block inclusion.

### Phase 9: Performance Regression

Measure bounded performance under controlled live-testnet load. This is not a maximum-throughput benchmark; it is a regression guard that should detect when a code change makes normal producer operation slower, less stable, or more resource intensive.

Metrics to collect:

- JSON-RPC latency: repeated samples for `chain.get_head_info`, `kcli chain-info`, `kcli balance`, `kcli vhp`, `kcli get-producer-key`, and `kcli block <height> --full`.
- Transaction latency: time from `kcli transfer` submission to local JSON-RPC visibility, public RPC visibility, and external observer visibility when available.
- Inclusion behavior: transaction count per produced block, number of produced blocks needed to include the batch, and whether any submitted transaction remains pending or disappears.
- Producer continuity: produced blocks per minute, skipped opportunities if measurable, failed proposal rows, rejected proposal rows, and block producer retry rows.
- Mempool behavior: pending transaction count before load, during load, and after inclusion when `mempool.get_pending_transactions` is available.
- P2P propagation: delay from local produced block to public RPC visibility and, once caught up, VPS1/VM2 observer visibility.
- Resource usage: `koinos_node` CPU and RSS samples, external SSD free space, basedir growth, log file growth, and RocksDB/write-related warnings.
- Stability signals: warnings, score-threshold rows, checkpoint mismatch rows, gossip production gate closures, peer snapshot count, and local/public head convergence.

Initial thresholds:

- Health gate must pass before performance sampling starts.
- Local/public head should converge within the same short live-race window used by Phase 1.
- Valid transfers should be included within a bounded window defined by the run, initially `10` minutes for live testnet unless the network itself is stalled.
- `p95` JSON-RPC read latency should not regress by more than `2x` against the previous successful baseline for the same machine and network conditions.
- The run must not produce score-threshold rows, checkpoint mismatch rows, gossip production gate closures, uncaught exceptions, or monotonic head lag.
- Disk free space must stay above the configured safety floor; for the current external SSD setup, alert below `15 GiB` free and stop below `10 GiB` free unless storage has been expanded.
- CPU and memory are recorded as baselines first. Do not set hard fail thresholds until at least two successful runs establish normal ranges.

Stop conditions:

- Local producer process exits or caffeinate guard stops.
- Public RPC and local RPC fail to converge after repeated checks.
- Score-threshold, checkpoint mismatch, or gossip gate closure appears.
- A submitted transaction is accepted but cannot be found locally or publicly within the configured inclusion window.
- Disk free space crosses the stop floor.
- RPC latency spikes enough to make the runner unreliable, for example repeated request timeouts across both local and public RPC.

Exit criteria:

- All configured performance samples are recorded with timestamps.
- The transaction batch completes with bounded inclusion latency.
- Local/public heads converge before and after the run.
- No stability stop condition triggers.
- Metrics are compared against the previous baseline, if one exists, and any regression is documented with likely cause or follow-up.

Next external-testnet action: keep the running producer in a longer soak and track uptime, accepted-block continuity, transaction inclusion, rejected proposals, peer count, errors, and disk headroom. Level 5 is now passed with an independent VPS1 legacy observer witness; future release-candidate runs should repeat it with `TX_INTERVAL=0` when Phase 4 is intended to prove multi-transaction block assembly under real mempool pressure.

## External Legacy Observer VPS1

- Status: caught up and usable as an independent legacy observer witness.
- Updated: 2026-06-02T16:47:21Z
- Host: `<VPS1_PUBLIC_IP>`
- Install path: `/opt/koinos-testnet-legacy-observer`
- Runtime shape: legacy Docker microservice observer stack with `block_producer` disabled.
- Public P2P multiaddr: `/ip4/<VPS1_PUBLIC_IP>/tcp/28888/p2p/QmeJnbWzRZ91zgTDTxs1UdsbRFFM6B26PntLdk69N63ePY`
- JSON-RPC: bound to remote localhost only at `http://127.0.0.1:18080/`.
- Firewall: UFW is active and allows `28888/tcp`.
- Safety scope: existing non-Koinos Docker services on the VPS were not modified.

Validation performed from the Mac:

- `nc -vz -w 5 <VPS1_PUBLIC_IP> 28888` succeeded.
- Raw libp2p probe succeeded with protocol `koinos/p2p/1.0.0`.
- Full Peer RPC probe succeeded with the expected live-testnet chain ID `0x122008295be6ebe576aa6b2652f3c9cb4f6f0822dbb67f651c5a70ac96dc4c811645`.
- Latest checked VPS observer head: matched public testnet head at height `5468696` during Level 5 Phase 7.
- VPS JSON-RPC returned head `7918` shortly before the full Peer RPC probe returned `8253`, then a follow-up JSON-RPC check returned `12775`, confirming active catch-up.
- P2P logs show block ranges being requested from `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`.
- Disk at setup time: `109G` free on `/`; observer data was still only `115M`.

Operational note: this node is now valid for external topology, Peer RPC compatibility checks, and independent near-head witness checks for monolith-produced blocks. Its JSON-RPC remains bound to remote localhost, so local validation from the Mac should use a temporary SSH tunnel such as `ssh -M -S /tmp/knodel-vps1-observer.sock -f -N -L 127.0.0.1:18091:127.0.0.1:18080 root@<VPS1_PUBLIC_IP>`.

## External Legacy Observer VM2

- Status: running and syncing from genesis; full external Peer RPC validation pending.
- Updated: 2026-05-30T14:06:06Z
- Host: `<VM2_PUBLIC_IP>`
- Install path: `/opt/koinos-testnet-legacy-observer`
- Runtime shape: legacy Docker microservice observer stack with `block_producer` disabled.
- Public P2P multiaddr: `/ip4/<VM2_PUBLIC_IP>/tcp/28888/p2p/QmXfSaJjSPSivJURC9RrCGKGmKtB3EA3AWEUksY2e189R3`
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
- `nc -vz -w 5 <VM2_PUBLIC_IP> 28888` succeeded.
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
- Built node binary: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel/node/teleno-node/build/src/koinos_node`
- Built private-testnet keygen: `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel/node/teleno-node/build/src/koinos_private_testnet_keygen`
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
