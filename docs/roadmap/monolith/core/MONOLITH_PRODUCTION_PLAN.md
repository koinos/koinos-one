# Monolithic Node — Production Roadmap

> Historical note: This file preserves command output, validation context, and artifact paths from runs that predate the Teleno repository and runtime cleanup. Old `knodel-*`, `koinosgui`, `Knodel.app`, or `/code/knodel` paths are evidence references only; current active repo paths and generated artifacts use Teleno names.

Sequential plan to take the monolith from its current state to a release-ready Teleno node, with public-testnet producer signoff, mainnet observer signoff, and finalized storage/backup work tracked separately.

## Monolith Overview

The monolithic node replaces the legacy Koinos multi-service runtime with a single native `koinos_node` process. The goal is not to change the Koinos protocol or create a Teleno-specific fork. The goal is to make a Koinos block-producing node easier to install, operate, package, debug, and optimize while preserving compatibility with existing peers, wallets, JSON-RPC/gRPC clients, chain data, PoB/VHP rules, and block validation behavior.

The legacy node architecture runs many services behind an AMQP broker. That structure creates operational complexity and adds internal round-trip overhead because frequent calls between services serialize protobuf messages, route through AMQP, cross process boundaries, and deserialize responses. The monolith keeps the service responsibilities but moves the internal calls into one C++ process through direct interfaces, a service registry, and typed events.

Expected benefits:

- One native binary instead of a full microservice stack plus AMQP broker.
- One main process, log stream, health surface, and configuration path for Teleno to manage.
- Lower internal latency by replacing AMQP round trips with direct C++ calls or in-process events.
- Better resource usage through shared address space, consolidated storage access, fewer duplicate buffers, and no broker process.
- Faster startup and shutdown because the node does not sequence many independent services through broker readiness.
- Easier macOS and Windows packaging.
- Better performance tuning across RocksDB, caches, thread pools, logging, P2P, mempool, and block production.
- Easier debugging of producer issues across chain, mempool, P2P, stores, JSON-RPC, gRPC, and block producer code.

Target architecture:

- `chain` validates blocks and transactions, tracks head/LIB state, and executes contract reads.
- `block_store` persists blocks and metadata in the monolith storage layout.
- `transaction_store`, `contract_meta_store`, and optional stores preserve legacy service semantics.
- `mempool` handles pending transaction admission, nonce/resource checks, expiration, and pending queries.
- `p2p` handles libp2p networking, Koinos Peer RPC, sync, gossip, seed connectivity, peer snapshots, and gossip production readiness.
- `jsonrpc` exposes the public JSON-RPC API used by wallets and tools such as `kcli`.
- `grpc` exposes the generated typed `koinos.services.koinos` protobuf service.
- `block_producer` assembles resource-bounded blocks, signs federated or PoB blocks, prunes/retries failed transactions, and submits produced blocks through the same chain path used for received blocks.

## Current Status

Last reviewed: 2026-06-09.

- The monolith binary builds and runs on macOS arm64 from `node/teleno-node/build/koinos_node`. It internalizes the core chain, mempool, block store, P2P, block producer, JSON-RPC, gRPC, transaction store, contract meta store, and account history surfaces inside one process.
- Public JSON-RPC is the primary client API and is live-compatible with `kcli`/koilib request conventions. The server normalizes Base58 addresses, `0x` hashes/ids, and websafe byte fields on input, returns websafe byte fields where public Koinos JSON clients expect them, and supports HTTP keep-alive reuse. The selected JSON-RPC parity and upstream integration-test suites pass.
- gRPC compatibility uses the generated typed `koinos.services.koinos` protobuf service. Focused tests and saved legacy-vs-monolith comparison runs cover routing, protobuf JSON/bytes, disabled optional stores, validation errors, and `get_gossip_status`. gRPC ACL mapping remains deferred.
- The standalone legacy REST API has not been migrated into the monolith. Current monolith scope is JSON-RPC plus gRPC; REST remains a legacy packaged artifact only unless it is explicitly re-scoped.
- P2P is implemented with `cpp-libp2p`, Koinos Peer RPC gorpc MessagePack framing, controlled Go-peer interop, one-peer sync, and GossipSub interop. Testnet live sync and production are validated. Mainnet public peer availability is still the open readiness gate; a short VPS1 mainnet observer canary passed, but restored-data/longer mainnet observer soak and parallel legacy comparison remain pending.
- Block production is implemented and validated. Private federated and PoB networks pass; the public Koinos Foundation testnet producer produced accepted blocks, submitted real transfers through local monolith JSON-RPC, passed explicit-nonce mempool pressure, passed real PoB burn/system-operation validation behind explicit flags, and reached a 48h live-producer stability milestone.
- `kcli` local setup is complete for testnet. The active testnet producer-control address used for validation is `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`; private material remains outside the repo. Mainnet producer address `14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb` is a real funded producer and must remain read-only unless the user gives an explicit, verified mainnet-safe instruction.
- External testnet topology has two legacy observer hosts. VPS1 caught up and passed as the independent Level 5 observer witness. VM2 is externally reachable but still needs a later full Peer RPC validation after initial catch-up pressure and source-IP scoring clear.
- Sprint 5 performance and hardening are substantially complete: read-only RPC/process benchmark, live submit benchmark, startup benchmark, live P2P sync benchmark, thread-matrix benchmark, mixed RPC/submit/sync stress, offline replay indexing, RocksDB tuning, JSON-RPC session limits, error handling, and logging/metrics hardening all have recorded evidence.
- Teleno has moved from Knodel inheritance toward the independent `Teleno` product. The app has a bright UI, network-aware mainnet/testnet settings, network-filtered presets, separate base dirs per network, dirty-settings leave guards, wallet import/create/delete flows, producer registration flows, and a simplified Node panel focused on the single monolith process and optional components.
- Storage is partially consolidated, not final. The monolith uses `BASEDIR/db` for block/index data and still uses `BASEDIR/chain/blockchain` for chain state. The restored mainnet external basedir has been cleaned of obsolete legacy microservice directories; final one-DB layout requires the new Unified RocksDB Layout phase before online checkpoint backup.
- Packaging has an unsigned macOS directory smoke with staged Koinos resources, but the final Teleno-branded signed/notarized release package is still pending. Current app version remains `0.10.1`; planned release target remains a future `v0.11.0`.

---

## Current Critical Path

This is the current work order that minimizes technical risk. Earlier Gates A-E are complete and retained as historical milestones; the active work is mainnet observer signoff, release readiness, and storage finalization.

| Gate | Objective | Exit Criteria |
|------|----------|--------------------|
| A-E. Build, Peer RPC, one-peer sync, gossip, local GUI mode | Core technical feasibility | **Complete**. Build scripts, gorpc fixtures, Go interop, one-peer sync, GossipSub interop, and Teleno monolith management are in place. |
| F. Public testnet producer signoff | Prove real PoB production and client compatibility | **Complete**. Accepted public-testnet blocks, real transfers, mempool pressure, real PoB burn validation, independent VPS1 witness, and 48h producer soak are recorded. |
| G. Mainnet observer signoff | Prove sustained mainnet sync without block production | **In progress**. VPS1 short disposable observer canary passed; restored-data or longer fresh-data observer canary, parallel legacy comparison, and 48h stability monitoring remain pending. |
| H. Teleno release readiness | Ship a trustworthy monolith operator app | **In progress**. Bright Teleno UI, network-aware presets/settings, wallet/producer flows, and settings guards are implemented in the working tree; signed/notarized package and final release docs remain pending. |
| I. Unified RocksDB layout | Finish storage consolidation | **Pending**. Move chain state from `BASEDIR/chain/blockchain` into the shared `BASEDIR/db` layout with migration manifests, rollback, and restored-mainnet/testnet validation. |
| J. Online checkpoint backup | Backup without stopping the node | **Pending**. Depends on Gate I so the final backup can checkpoint one unified RocksDB handle instead of a temporary two-DB layout. |

Historical Gate F peer-acquisition notes remain in `docs/roadmap/monolith/networking/MONOLITH_AB_PEER_ACQUISITION_REPORT.md` and `docs/roadmap/monolith/networking/MONOLITH_MAINNET_CANARY_REPORT.md`. The current mainnet decision is not to enable production; the next safe mainnet step is a non-producing observer canary against restored or fresh data, then a parallel legacy comparison.

---

## Sprint 1: Functional Local Node (1-2 weeks)

**Objective:** A node that restores a backup and serves queries correctly.

### 1.1 Backup restore flow
- [x] Adaptar flujo de restore para leer un backup `.tar.gz` legacy, extraerlo en un `basedir` externo y convertir `block_store/db` Badger a RocksDB monolítico
- [x] Verificar que el chain indexer sincroniza correctamente desde block_store después de un restore
- [x] Probar: restaurar backup → arrancar monolito → `chain.get_head_info` devuelve height correcto con datos reales

**Nota 2026-05-24:** Restore real completado en `/Volumes/external/teleno-monolith-restore` usando `https://seed.koinosfoundation.org/backups/koinos-backup.tar.gz`. El backup es legacy: `chain/blockchain` se reutiliza, pero `block_store/db` debe transformarse desde Badger al RocksDB del monolito en `basedir/db`. Resultado de conversión: `records=40278912 blocks=40278911 meta=1 bytes=83883179053`; el monolito abrió 6 column families y `chain.get_head_info` respondió con datos restaurados. La observación inicial donde el indexer se quedaba 60 bloques detrás quedó corregida en Sprint 1.2 capando el último batch al número de bloques restantes.

### 1.2 Validar JSON-RPC contra nodo Go
- [x] Arrancar un nodo multi-servicio con los mismos datos
- [x] Comparar respuestas de los 21 métodos JSON-RPC entre monolito y nodo Go
- [x] Documentar diferencias (si las hay) en el encoding protobuf→JSON

**Nota 2026-05-24:** Sprint 1.2 completado con `scripts/compare-jsonrpc-parity.py`. Se levantó el stack legacy local con RabbitMQ en `127.0.0.1:5673` y JSON-RPC en `127.0.0.1:18084`, se capturó baseline de 21 métodos y se comparó contra el monolito en `127.0.0.1:18083`. Resultado final: `failures=0 cases=21`. Las diferencias observadas fueron de encoding de bytes (`0x` hex / base64 URL-safe legacy frente a base64 estándar/hex monolito), normalizadas semánticamente. Durante la validación se corrigió el batch cap del indexer monolítico para no pedir bloques más allá del highest block y se alinearon errores para requests inválidos vacíos en block store, contract meta store y transaction store.

### 1.3 Mempool end-to-end
- [x] `chain.submit_transaction` can use in-process mempool RPCs for RC, nonce, pending nonce, and pending transaction count checks.
- [x] `koinos.transaction.accept` is wired through the monolith event bus into the real mempool implementation and is verified with `mempool.get_pending_transactions`.
- [x] Verify `check_pending_account_resources` with concrete payer/payee accounts and real pending RC reservations.
- [x] Verify transaction expiration at the 120s default boundary.

**2026-05-25 status:** Sprint 1.3 is locally complete. `IMempool`, `MempoolAdapter`, and `MonolithRpcClient` now cover `check_account_nonce`, `get_pending_nonce`, and `get_pending_transaction_count`, which are required by `chain.submit_transaction` when broadcasting transactions. The monolith subscribes mempool to `koinos.transaction.accept`, inserts the accepted transaction plus receipt resource usage into the real mempool implementation, and runs a 1s prune loop using `mempool.transaction-expiration` (default `120s`). `koinos_mempool_adapter_test` verifies accepted transaction insertion, `get_pending_transactions`, reserved RC accounting, `check_pending_account_resources`, duplicate/next nonce behavior, pending nonce/count, and the 119s/120s expiration boundary. The focused build and CTest set passed for `koinos_node`, `koinos_mempool_adapter_test`, `koinos_block_producer_test`, `koinos_gorpc_codec_test`, and `koinos_p2p_one_peer_sync_test`.

### 1.4 Teleno local integration
- [x] Move the temporary build from `/private/tmp/teleno-node-libp2p-build` to the current Teleno path: `node/teleno-node/build/koinos_node`
- [x] Actualizar `monolithBuildDefinition()` para pasar las flags CMake requeridas por cpp-libp2p (`KOINOS_ENABLE_LIBP2P`, prelude, shims, prefixes)
- [x] Verificar que `resolveMonolithBinaryPath()` encuentra el binario en dev y en packaged app (`release/mac-arm64/Knodel.app` resuelve `Contents/Resources/koinos/bin/koinos_node`; smoke packaged start/RPC/stop OK)
- [x] Verify that Teleno detects the monolith and starts it instead of the legacy service stack (Electron renderer/preload/main bridge verified with `serviceStart` and `p2p` disabled in the historical smoke)
- [x] Verificar que start/stop/restart usan un solo proceso `teleno-node` y no dejan procesos legacy vivos (Electron bridge `serviceStart`/`serviceStop`/`serviceRestart`; `chain.get_head_info` responde; sin procesos legacy tras stop)
- [x] Verificar que el panel Node Components muestra health de los componentes derivados del log o de endpoint de health (parser acepta el formato real con timestamp antes de `[component]`)
- [x] Verificar logs con filtrado por `[component]` para `chain`, `mempool`, `block_store`, `p2p`, `jsonrpc`, `grpc`, `block_producer` (targets de logs monolíticos resueltos desde `status.components`; smoke verificado con `jsonrpc`)
- [x] Validar presets: cambios de feature flags escriben config y reinician el monolito (smoke `profile:jsonrpc`: escribe `features`, arranca `koinos_node`, responde JSON-RPC; `p2p` queda habilitado por defecto salvo override explícito)
- [x] Definir fallback UX: si el binario monolítico falta o falla al arrancar, Teleno muestra causa y permite volver al modo multi-servicio (startup failure activa fallback de sesion; status/presets/actions pasan a native multi-service; rebuild monolitico exitoso limpia el fallback)

**Nota 2026-05-23:** Gate E queda implementado: Teleno ya no añade `--disable=p2p` por defecto, los presets monolíticos mantienen `p2p=true` salvo override explícito y `scripts/smoke-monolith-p2p-local.sh` valida arranque local con `p2p` + `jsonrpc`. Smoke Electron dev previo: `serviceStart`/`serviceStop`/`serviceRestart` desde el renderer usan un solo `koinos_node` y dejan `nativePid=null` al parar. El health de componentes se deriva de líneas reales con timestamp y el endpoint de logs acepta componentes como `jsonrpc`/`p2p` filtrando el buffer monolítico. Si el monolito existe pero falla al arrancar, Teleno devuelve la causa como error visible y activa fallback de sesión a native multi-service; un rebuild monolítico exitoso limpia ese estado.

**Entregables 1.4:**
- Build local reproducible desde Teleno
- Start/stop/status monolítico funcionando por IPC
- Capturas o logs que prueben detección de componentes y filtrado por logs

**Entregable Sprint 1:** Nodo local que restaura backup, sirve queries, y Teleno lo gestiona.

---

## Sprint 2: Block Producer (1 week)

**Objective:** The monolith can produce blocks on testnet.

### 2.1 Private key loading
- [x] Read `block_producer.private-key-file` from `config.yml`, defaulting to `BASEDIR/block_producer/private.key`.
- [x] Load the WIF Ed25519 key, write `BASEDIR/block_producer/public.key`, and sign locally assembled blocks.
- [x] Verify that the producer submits a populated `propose_block_request` and receives an accepted receipt in focused C++ tests.

### 2.2 Producer address config
- [x] Read `block_producer.producer` from `config.yml` for PoB producer identity.
- [x] Keep compatibility with the existing Teleno producer profile/runtime config flow, which persists `block_producer.producer` and `block_producer.private-key-file`.

### 2.3 Production loop tuning
- [x] Replace the old empty 3s proposal loop with local block assembly, mempool transaction selection, signing, and chain proposal.
- [x] Use PoB consensus timing (`quantum_length`) for PoB retries; federated mode uses a short fixed retry interval.
- [x] Honor `resources-lower-bound`, `resources-upper-bound`, `max-inclusion-attempts`, and `approve-proposals`.
- [x] Retry after chain-reported failed transaction indices by pruning failed transactions and recomputing merkle root, block id, and signature.
- [x] Gate production on P2P gossip readiness by default through `block_producer.gossip-production`.
- [x] Verify accepted-block and failed-transaction retry behavior in `koinos_block_producer_test`.
- [x] Verify EventBus fanout to block_store, contract_meta_store, and transaction_store with a private three-node federated produced block.

### 2.4 Testnet validation
- [x] Run a private three-node federated smoke with `seed-1`, `producer-1`, and `observer-1`.
- [x] Produce a signed federated block and verify that the observer accepts and syncs it over P2P.
- [x] Run a private three-node PoB smoke with a deterministic VHP-staked producer genesis.
- [x] Produce PoB blocks and verify that the observer accepts and syncs them over P2P.
- [x] Run a 30-minute private PoB soak without observer stalls, producer error loops, or severe log matches.
- [x] Add shared/external PoB signoff harness for independent producer/observer RPC endpoints.
- [x] Run isolated seed-host private PoB external validation from `/mnt/HC_Volume_105581636/knodel-external-signoff` without touching production services.
- [x] Identify and verify the live external Koinos Foundation testnet: `https://testnet.koinosfoundation.org/jsonrpc`, public P2P `testnet.koinosfoundation.org:8888`, chain ID `EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`.
- [x] Configure locally installed `kcli` for the live testnet RPC and verify `kcli testnet-info`, `kcli chain-info`, and `kcli faucet-info`.
- [x] Use `kcli` as the testnet wallet: generate or import a producer-control wallet, request faucet vKOIN, and verify KOIN/VHP/Mana with `kcli balance`.
- [x] Run the monolith as a non-producing observer on the live external testnet and verify chain ID, peer handshake, head progress, and stable sync.
- [x] Use `kcli burn --dry-run` and then `kcli burn` to convert testnet KOIN into VHP for the producer account.
- [x] Register the monolith block-producer public key on the testnet PoB contract after dry-run validation.
- [x] Sync or otherwise catch up the prepared monolith basedir to the live external testnet head before enabling production.
- [x] Deploy the monolith on the live external testnet with a VHP-staked producer.
- [x] Produce blocks and verify that other nodes accept them.
- [x] Submit a real transfer with `kcli` through the local monolith JSON-RPC and verify public-chain inclusion.
- [x] Run and maintain the transaction/operation/performance regression suite against the live monolith producer: Level 5 now passes with real transfers, explicit-nonce mempool pressure, independent VPS1 legacy observer witness, soak sampling, and bounded performance sampling.
- [x] Add one externally reachable legacy observer VPS for live topology and Peer RPC compatibility checks.
- [x] Add a second externally reachable legacy observer VM for live topology diversity.
- [x] Let VPS1 catch up and use it as an independent near-head legacy observer witness.
- [ ] Re-run full Peer RPC validation against VM2 after initial catch-up pressure drops.
- [x] Monitor for 48h: uptime, produced blocks, rejected proposals, peer count, and errors.

**2026-05-24 status:** Backend implementation is complete and locally verified. Phase A private validation passes through `scripts/private-testnet-sprint2.sh`: the monolith producer creates a federated block, the observer syncs that block from the producer over P2P, and observer block store, transaction store, and contract meta store checks pass. Phase B private PoB validation also passes through the same harness with `PRIVATE_TESTNET_MODE=pob`: the generated runtime genesis is statically PoB-ready, the producer creates PoB blocks, the observer syncs them over P2P, and service health checks pass. The 30-minute private PoB soak also passes: 31 samples, zero stalled samples, zero severe log matches, final producer head `74362`, final observer head `73842`, and final observer block-store height `73842`. External seed-host validation also passes: commit `ec1d737` was pulled into `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel` on `seed.koinosfoundation.org`, `scripts/build-cpp-libp2p-koinos.sh` produced the cpp-libp2p-enabled monolith there, and `scripts/private-testnet-sprint2.sh` ran a `300s` private PoB soak on high localhost ports with final producer head `8736`, observer head `8384`, observer block-store height `8384`, zero stalled samples, zero severe log matches, transaction/contract-meta checks `ok`, and clean shutdown. The production stack was not touched. `scripts/external-pob-testnet-signoff.sh` remains available for a future shared/external validation step against independently reachable producer and observer RPC endpoints.

**2026-05-25 status:** The live public testnet documented in `pgarciagon/koinos_testnet` is reachable. Verified endpoints: `/health` returned `ok`, and `chain.get_head_info` over `https://testnet.koinosfoundation.org/jsonrpc` returned a live head. This shifts Sprint 2.4 from "find/create an external testnet" to "join the existing testnet first as a monolith observer, then as a VHP-staked producer."

**2026-05-25 kcli update:** `kcli` is available locally at `/opt/homebrew/bin/kcli`. The plan now uses `kcli` as the Koinos wallet/client for the live testnet: configure the RPC, create or import the producer-control wallet, request faucet funds, verify balances, burn KOIN to VHP, register the monolith producer public key, and monitor producer visibility.

**2026-05-25 kcli configuration:** `kcli` was configured through `/Users/pgarcgo/.kcli/config.json` with default network `testnet` and RPC `https://testnet.koinosfoundation.org/jsonrpc`. The local client was later updated to `1.4.0`. Verification passed: `kcli testnet-info` returned the expected chain ID and contract IDs, `kcli faucet-info` returned the Telegram faucet command, and `kcli chain-info` returned head block `5247425` with last irreversible block `5247365`.

**2026-05-25 observer validation:** Public P2P exposure is corrected and validated. After clearing a temporary source-IP score on `koinos-p2p-1`, a raw libp2p-only probe reached `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W` and observed protocol version `koinos/p2p/1.0.0`. A non-producing monolith observer using the live testnet genesis/descriptors then completed handshake and synced to height `4000` with no score-threshold rows. This completes the observer prerequisite for the VHP-staked producer test.

**2026-05-25 producer preparation:** A dedicated producer-control wallet was generated with `kcli` and set as the active `kcli` default account and main producer address: `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`. A separate monolith hot key was generated outside the repo in `/Users/pgarcgo/.kcli/teleno-testnet-producer`, with public key `AjyRoy9QlZP-AuojYV-cBlHC64mP-ZliaibjmjVnHL97` and hot-key address `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX`. The user faucet-funded the producer-control wallet with `100` testnet KOIN; `kcli burn` converted `95` KOIN to VHP in tx `0x1220b4954d9d4b5be350326a4a246d6ee4cdfa7f4ca12a379b68dc205053ed434ff3`, confirmed at block `5248232`. The monolith hot-key public key was registered for the producer-control address in tx `0x1220ddc565480f6689f11735e9e2dd5b1add9949bb373e63ecba8e48eb148eb62505`, confirmed at block `5248344`; `kcli get-producer-key` returns the expected 33-byte key. Current balance verification shows `5` KOIN, `95` VHP, and about `4.85` Mana. The producer basedir `/Users/pgarcgo/.kcli/teleno-testnet-producer/basedir` has the live testnet genesis/descriptors, the private key file with `0600` permissions, `block_producer.producer` set to the control wallet, and `features.block_producer: false` for safety. A short non-producing startup check from this basedir reached head `3157` with one connected peer, one handshake, six sync rows, and zero score-threshold rows. Next step is catch-up/sync to the live testnet head before enabling production.

**2026-05-25 catch-up hardening:** A post-registration non-producing catch-up run advanced from height `3164` to `13664` in `120s`, but exposed one false score-threshold disconnect when a far-behind node received a future gossiped block and chain rejected it as `unknown previous block`. `P2PNode::on_gossip_block` now checks local head before applying gossip and ignores blocks whose height is more than one above local head; this prevents penalizing a healthy seed while normal sync is still catching up. `koinos_p2p_one_peer_sync_test` covers future gossip without disconnect. After rebuilding, a `90s` live non-producing catch-up advanced from height `13664` to `20738` with one handshake, 35 sync rows, nine connected-peer snapshots, zero warnings, and zero score-threshold rows.

**2026-05-30 catch-up restart:** The long non-producing observer sync reached height `4649031` before an uncaught RocksDB write exception stopped the process. Diagnosis showed the internal macOS data volume had only `1.9 GiB` free, so the likely immediate cause was exhausted write space. The prepared basedir was moved to `/Volumes/external/teleno-testnet-producer/basedir`, and `/Users/pgarcgo/.kcli/teleno-testnet-producer/basedir` now symlinks there so existing config paths continue to work. Internal free space recovered to about `11 GiB`. Observer sync restarted from the symlinked basedir, with `features.block_producer: false`, and advanced from `4649615` to the live testnet head with one handshake, active sync rows, and no score-threshold rows.

**2026-05-30 producer cutover:** At local and remote head `5376554`, the observer was cleanly stopped and restarted from the same basedir with `features.block_producer: true`. The producer process started at `2026-05-30T10:39:22Z`, loaded the configured producer, completed P2P handshake, opened the gossip production gate, and kept local/remote heads equal through `5376801` during a 10-minute monitor. The checked log window had zero warnings and zero score-threshold rows. No local `[block_producer] Produced block` row appeared during that first window, so the live producer is running but the accepted-produced-block criterion remains open.

**2026-05-30 accepted producer signoff:** The producer-control account was increased to `2,850,095` effective VHP while leaving `5` KOIN liquid. With that much stake, the absence of produced blocks indicated a code issue rather than unlucky PoB selection. Root cause: `BlockProducer` cached a PoB candidate block and did not refresh it when the local head changed, so a later winning VRF could propose against an obsolete `previous` block. `BlockProducer::produce_pob_once` now rebuilds the PoB bundle when the head changes, and `koinos_block_producer_test` covers the regression. After rebuilding and restarting at `2026-05-30T12:10:08Z`, the live monolith producer immediately produced blocks accepted by the public testnet RPC: height `5378368` (`0x12204c466d782f00435bfab17a47b6d9636da67995965692e4eea6fd42eb27619dbb`) and height `5378369` (`0x1220b80ace4aaf138f0e9ab3077d70a28795b20ebc883e02d6828108cb12bcd63e31`) both show signer `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi` through `kcli --network testnet block`. Local and remote heads matched at `5378374` after the restart, and the checked producer log window had zero warning or score-threshold rows.

**2026-05-30 post-signoff soak fix:** A later producer soak disconnected from the single public testnet seed with `checkpoint mismatch` after normal competing blocks appeared above LIB. Local block `5378534` matched public RPC, which pointed to an overly strict C++ P2P check rather than local chain corruption. Legacy `koinos-p2p` validates that the peer contains the local LIB and requests blocks from `LIB+1`; it does not require the peer branch to contain the volatile current head. `P2PNode::peer_handshake` and `P2PNode::request_sync_blocks` now follow that behavior, and `koinos_p2p_one_peer_sync_test` covers a local-head/peer-head fork above the same LIB. After rebuilding and restarting at `2026-05-30T12:26:38Z`, the producer reconnected, caught up, reopened the gossip gate, and produced public-testnet block `5378792` (`0x1220d2a5bdd51fe1de9b25fb798f851ca1006214db9e2fb66f4d48207d1764e3aee5`) signed by `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi`; local and public RPC matched at head `5378802`, with zero warning or score-threshold rows in the reporter.

**2026-05-30 kcli transfer signoff:** A real wallet/client transaction was executed through the monolith JSON-RPC using `kcli -r http://127.0.0.1:18122 transfer`. During this validation, the JSON-RPC server was hardened for `kcli`/koilib compatibility: it normalizes public Koinos JSON request fields into protobuf JSON bytes, returns websafe/base64url byte fields on chain/read-contract responses, and serves repeated keep-alive requests on one HTTP socket. Dry-run succeeded first, then tx `0x12209ffc21122d2dfd36b01be685bb88a6867b8325c350df5312714b7f316e0f27cb` transferred `0.01` KOIN from producer-control `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi` to hot key `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX`. `kcli` confirmed inclusion in block `5380195`; the local producer log shows the monolith produced that block with `1 transaction`, public `kcli block 5380195` shows the same tx id, and public balance checks showed the recipient at `0.01` KOIN. Focused tests passed after the change for `koinos_p2p_one_peer_sync_test` and `koinos_block_producer_test`.

**2026-05-30 producer soak heartbeat:** At `2026-05-30T15:19:04Z`, the live monolith producer remained healthy after the post-signoff P2P fix. Local JSON-RPC and public testnet RPC matched at head `5382991` with the same block id, LIB, state merkle root, and block time. The process was still running as PID `32977`, guarded by `caffeinate -dims -w 32977`, connected to the public seed, and the checked log window contained `126` produced-block rows with zero warning, score-threshold, checkpoint-mismatch, or gossip-gate rows. External SSD free space was about `19 GiB`; keep the soak running but continue watching disk because the performance-regression stop floor is `10 GiB`.

**Transaction/operation/performance regression suite:** The external testnet report now defines a reusable live-producer transaction and performance regression suite, not just a one-off Sprint 2.4 test plan. The suite gates on node health first, then tests `kcli` read compatibility, a valid transfer smoke, true explicit-nonce mempool pressure, non-destructive negative transaction rejection, contract/producer state reads, safe PoB/producer-key dry-runs, independent legacy observer verification after catch-up, transaction injection during the longer soak, and bounded performance sampling. Any future feature that can affect JSON-RPC encoding, wallet/client compatibility, mempool behavior, block production, transaction execution, P2P propagation, store persistence, performance, or release packaging should run the appropriate regression level before signoff. `kcli transfer` and `kcli token-transfer` now support `--no-wait` and explicit `--nonce <base64url>`, so the live suite can submit multiple signed transactions without waiting for inclusion while keeping nonce control deterministic. Live public-testnet negative tests default to dry-run/client-side rejection unless the failure mode is known safe. Performance regression is Level 5 and records RPC latency, transaction inclusion latency, local-to-public propagation delay, observer propagation delay, produced-block transaction counts, CPU, memory, disk growth, log growth, and stability signals. The goal is to prove more than empty-block production: client compatibility, mempool acceptance/rejection, block assembly with transactions, state transition correctness, cross-node acceptance, and bounded performance stability.

**2026-05-30 regression runner start:** `scripts/live-producer-transaction-regression.sh` and `scripts/live-producer-transaction-regression.py` now implement the first reusable runner for the suite. Level 1 covers the baseline health gate plus `kcli` read compatibility against local and public RPC. Higher levels are wired with explicit safety controls: real transfers require `--submit-transfers`, negative live-testnet checks use dry-run rejection by default, observer verification requires `--observer-rpc`, and performance sampling records bounded latency/resource data. `kcli` now supports `--password-file <path>` for wallet unlock and `--yes` for explicit non-interactive confirmation on mutating commands, so the runner can submit low-value transfer tests without logging wallet passwords. The first Level 1 run passed at local/public head `5383384` with `0` warning rows and `0` score-threshold rows. A Level 2 real transfer run then passed at `2026-05-30T16:04:50Z`: tx `0x12200870e83d9d6f65c9f8e09f9686c945bea1a751787097b53d0e105c2f9978d769` was confirmed in locally produced public block `5383945` with `1 transaction`, and result files were written under `/private/tmp/teleno-transaction-regression/20260530T160450Z/`.

**2026-05-31 regression Level 3/5:** Level 3 passed end-to-end with real low-value transfers: valid transfer smoke tx `0x1220c9031596e8960d0800cba757e68e38699af9bbf67446dd0502cfa621ed5995a4` was confirmed in locally produced public block `5400851`, the functional batch submitted five more transfers confirmed in blocks `5400858`, `5400864`, `5400872`, `5400878`, and `5400882`, the oversized-transfer negative dry-run was accepted as a proper rejection after fixing the runner's marker detection, and contract/producer state reads passed. A bounded Level 5 run then passed Phases 1-6, Phase 8, and Phase 9; it included smoke tx `0x1220775cfa8d646cb5a580f3033973fea5b1a6274de61895d5f6285b45eafc65429d` in locally produced public block `5400903`, two more functional batch transfers in blocks `5400906` and `5400912`, eight performance samples, local RPC p95/max `2.38ms`, matching sampled heads, and no warning/score/checkpoint/gossip rows. That Level 5 run stayed `blocked` only because Phase 7 still needed a near-head external observer RPC.

**2026-06-02 regression Level 5 external witness signoff:** VPS1 caught up and became a usable legacy observer witness. A full Level 5 rerun with an SSH tunnel to VPS1 JSON-RPC, real low-value transfers, and `TX_INTERVAL=0` passed every phase. Transfer smoke tx `0x12208e5456da712437310fb617915f588a27576b6702acfa0023ea3a006d11d512f1` was confirmed in locally produced public block `5468691`. The explicit-nonce burst submitted five `0.001` KOIN transfers without waiting, local mempool samples rose from `0` to `5` and drained to `0`, and public block `5468695` contained all five burst transactions. Phase 7 passed with VPS1 observer head matching public RPC at height `5468696` and `observer_lag=0`. Phase 9 collected 20 samples with local RPC p95 `3.45ms` and max `4.67ms`. No system operations or producer-key registration were submitted in this run. Result files: `/private/tmp/teleno-transaction-regression/20260602T163636Z/result.json` and `/private/tmp/teleno-transaction-regression/20260602T163636Z/result.md`.

**2026-05-31 true mempool pressure and complex-operation dry-runs:** The live regression runner now performs Phase 4 with explicit nonce control instead of sequential confirmation waits. It reads `chain.get_account_nonce`, encodes Koinos `value_type.uint64_value` nonces, submits transfers with `kcli --no-wait --nonce`, samples local `mempool.get_pending_transactions`, and polls public blocks for every submitted transaction id while accepting both `0x` and base64 encodings. A Level 3 run at `2026-05-31T09:07:17Z` submitted three signed `0.001` KOIN transfers through local monolith JSON-RPC without waiting; mempool samples showed counts `1`, `2`, and `3` after submission, the final sample drained to `0`, and public block `5403845` included all three transactions. This proves real mempool pressure plus block assembly with multiple live transactions. Phase 6 now includes safe complex operation checks: PoB `burn --amount 0.001 --dry-run` and `register-producer-key --dry-run` using the current registered key. Both dry-runs passed. The run result was `warn` only because the rolling log window contained one known transient `[block_producer] cannot retrieve pending transactions from an unknown block` warning; severe warnings, score-threshold, checkpoint-mismatch, and gossip-gate rows were zero.

**2026-05-31 real PoB/system operation validation:** The runner now exposes real system-contract mutations behind explicit `--submit-system-ops`. The first attempt correctly exposed two harness/client issues: `kcli register-producer-key` printed an error while returning exit code `0`, and its default RC limit was too high after a just-confirmed burn, causing `insufficient pending account resources`. The runner now treats printed CLI error markers as failures, and `kcli register-producer-key` caps RC limit to 10% of available mana. After rebuilding, Level 3 with `--submit-transfers --submit-system-ops` passed at `2026-05-31T09:18:55Z`: transfer smoke tx `0x1220133750d4b183a83914f95f77c71373458fcef80f896474f0bca621555c8a119a` was confirmed in locally produced public block `5404089`; the non-waiting burst showed mempool counts `1` and `2`, drained to `0`, and both burst txs appeared in public block `5404093`; real PoB burn tx `0x1220f05585d81f302b9cfe600ea2acd14d7db63c49d3f4bb910687d557a5a91c97c9` confirmed in block `5404099`; and same-key producer registration tx `0x1220e0a72b37541a065a496fbc29a98a507b4770fb85e5401e1d51446b99ad3c4907` confirmed in block `5404105`. `kcli get-producer-key` still returned `AjyRoy9QlZP-AuojYV-cBlHC64mP-ZliaibjmjVnHL97`, but re-registering the same key briefly triggered protocol-level `public key not yet active` rows while the activation window refreshed. The node stayed synced and later resumed accepted own production at heights `5404127` and `5404129`. Future regression runs therefore require the separate `--submit-producer-registration` flag for real key registration; `--submit-system-ops` alone performs the real PoB burn and skips key registration by default.

**2026-05-30 longer live-producer soak checkpoint:** At `2026-05-30T23:19:05Z`, the keep-alive producer process had been running for more than `10h`, still guarded by `caffeinate -dims -w 32977`. Local JSON-RPC and public testnet RPC matched at head `5392416` with the same block id and LIB. The checked rolling log window contained `778` produced-block rows and `552` public-seed peer rows, with `0` warning, score-threshold, checkpoint-mismatch, or gossip-gate rows. External SSD free space was `18.78 GiB`, above the `10 GiB` stop floor.

**2026-06-01 48h live-producer soak milestone:** At `2026-06-01T13:46:44Z`, the same live monolith producer process `32977` had been running for more than `2d`, still protected by `caffeinate -dims -w 32977`. Local JSON-RPC and public testnet RPC matched at head `5437363` with the same block id and LIB. The rolling log window showed recent produced blocks through local produced-block count `#23027`, continuous public-seed peer snapshots for `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, and `0` warning, score-threshold, checkpoint-mismatch, or gossip-gate rows. External SSD free space was about `18.5 GiB`, still above the `10 GiB` stop floor. This completes the 48h live-producer stability milestone while keeping the producer running for longer soak evidence.

**2026-05-30 external legacy observer VPS1:** VPS1 `46.225.170.6` was configured as a non-producing legacy observer for the live testnet under `/opt/koinos-testnet-legacy-observer`. It runs the Docker microservice stack with the live testnet genesis/descriptors, connects to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, exposes public P2P on `28888/tcp`, and keeps JSON-RPC private on remote localhost `18080`. The P2P identity is persistent: `/ip4/46.225.170.6/tcp/28888/p2p/QmeJnbWzRZ91zgTDTxs1UdsbRFFM6B26PntLdk69N63ePY`. Validation from the Mac confirmed TCP reachability, raw libp2p, full Peer RPC, protocol `koinos/p2p/1.0.0`, and the expected chain ID. The node was actively syncing from genesis and reached head `12775` during setup.

**2026-05-30 external legacy observer VM2:** VM2 `46.62.155.105` was configured as a second non-producing legacy observer under `/opt/koinos-testnet-legacy-observer`. It uses the same live testnet genesis/descriptors, connects to the public seed, exposes public P2P on `28888/tcp`, and keeps JSON-RPC private on remote localhost `18080`. The persistent P2P identity is `/ip4/46.62.155.105/tcp/28888/p2p/QmXfSaJjSPSivJURC9RrCGKGmKtB3EA3AWEUksY2e189R3`. The stack started cleanly, all eight expected observer containers stayed running, and JSON-RPC advanced from height `23` to `6194`. TCP `28888` was reachable from the Mac, and the first full Peer RPC probe reached `GetChainID`; `GetHeadBlock` reset while the 2-vCPU host was under heavy initial catch-up, then later probes from this Mac hit security resets consistent with temporary source-IP scoring. Full Peer RPC signoff remains pending.

Private-testnet signoff plan: `docs/archive/implementation-plans/monolith/testnets/MONOLITH_PRIVATE_TESTNET_PLAN.md`.
Latest private-testnet report: `docs/roadmap/monolith/testnets/MONOLITH_PRIVATE_TESTNET_REPORT.md`.
Latest external-testnet report: `docs/roadmap/monolith/testnets/MONOLITH_EXTERNAL_TESTNET_REPORT.md`.

**Sprint 2 Deliverable:** Monolith producing blocks on testnet with Teleno.

---

## Sprint 3: P2P networking (2-3 semanas)

**Objetivo:** El monolito sincroniza con peers reales de mainnet.

### 3.1 cpp-libp2p compilation
- [x] Resolver build con `-DKOINOS_ENABLE_LIBP2P=ON` (cpp-libp2p reconstruido contra deps compatibles de Koinos)
- [x] Descartar fallback de Go P2P para esta etapa: el binario C++ ya compila con libp2p enlazado
- [x] Verificar que el binario con libp2p arranca sin crash (`koinos_node --help`)

### 3.2 gorpc wire compatibility
- [x] Confirmar contrato real desde Go: `PeerRPCID = "/koinos/peerrpc/1.0.0"`, service `PeerRPCService`, methods `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, `GetBlocks`
- [x] Confirmar framing real: `go-libp2p-gorpc` escribe dos objetos MessagePack consecutivos en el stream (`ServiceID`, args) y responde con (`Response`, data)
- [x] Crear fixtures offline desde el codec Go para requests/responses/error de Peer RPC
- [x] Sustituir captura `.pcap` por un fixture Go vivo determinista que ejerce el protocolo real libp2p/gorpc end-to-end
- [x] Extraer frames gorpc: header `ServiceID`, nombre de servicio, método, payload, respuesta y error
- [x] Convertir los helpers privados de `libp2p_transport.cpp` en una unidad testeable (`p2p/gorpc_codec.*`)
- [x] Validar que el encoder C++ genera bytes idénticos a Go para requests vacíos y requests con payload
- [x] Validar que el decoder C++ interpreta respuestas Go con éxito y respuestas con error
- [x] Conectar `peer_get_chain_id`, `peer_get_head_block`, `peer_get_ancestor_block_id` y `peer_get_blocks` al codec MessagePack
- [x] Probar interop live: Go peer responde a llamadas C++ para los 4 métodos
- [x] Si hay discrepancias, ajustar el framing antes de tocar sync

**Entregables 3.2:**
- Fixtures binarios versionados en el test C++ para cada método Peer RPC
- Test C++ `koinos_gorpc_codec_test` de encode/decode que falla ante cualquier cambio de bytes
- Test live `koinos_libp2p_peer_rpc_live_test` against the Go fixture at `compat/koinos-p2p-fixtures/cmd/peer-rpc-fixture`, validating `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, and `GetBlocks`.
- Decisión documentada: el framing vive fuera de `Libp2pTransport`, en `p2p/gorpc_codec.*`

### 3.3 Handshake + sync
- [x] Replicar handshake Go en orden: local `GetChainID` → remote `GetChainID` → remote `GetHeadBlock` → checkpoints via `GetAncestorBlockID`
- [x] Mapear errores Go a scoring C++: `chain_id_mismatch`, `checkpoint_mismatch`, `chain_not_connected`, `peer_rpc_timeout`
- [x] Validar timeouts: Peer RPC remoto usa deadline de 6s y errores `timeout` puntuan como `score_peer_rpc_timeout`
- [x] Conectar a un seed peer Go controlado con base dir temporal y gossip sin publicar durante el smoke
- [x] Completar chain ID verification contra un peer Go conocido
- [x] Pedir `GetHeadBlock` y comprobar que height/head no son cero
- [x] Pedir `GetAncestorBlockID(peer_head, local_head_height)` y confirmar continuidad de chain
- [x] Batch fetch 500 bloques con `GetBlocks(head, local_head+1, 500)`
- [x] Aplicar bloques secuencialmente y confirmar que `P2PNode` llama `chain.submit_block` en orden
- [x] Verificar que el cursor progresa por head local y no repite batches al no avanzar LIB inmediatamente
- [x] Medir resultado del batch en smoke reproducible: 12/12 bloques aplicados contra fixture Go

**Entregables 3.3:**
- Script de smoke test reproducible: `scripts/smoke-one-peer-sync.sh`
- Log con primer handshake exitoso C++↔Go desde `koinos_libp2p_one_peer_sync_live_test`
- Smoke controlado: `koinos_p2p_one_peer_sync_test`, `koinos_libp2p_peer_rpc_live_test`, `koinos_libp2p_one_peer_sync_live_test`

### 3.4 GossipSub
- [x] Confirmar nombres exactos de topics Go para bloques y transacciones antes de publicar: `koinos.blocks`, `koinos.transactions`
- [x] Verificar que bloques llegan via gossip (`koinos.blocks` topic) y se deserializan como `protocol::block`
- [x] Verificar que transacciones llegan via gossip (`koinos.transactions` topic) y se deserializan como `protocol::transaction`
- [x] Verificar deduplicación: el mismo block/tx recibido por RPC y gossip no se aplica dos veces
- [x] Verificar gossip toggle: se activa cuando head < 45s de wall clock y no publica mientras el nodo está atrasado
- [x] Probar C++ publica bloque/tx y Go peer lo recibe
- [x] Probar Go publica bloque/tx y C++ lo recibe

**Entregables 3.4:**
- Script de smoke reproducible: `scripts/smoke-gossip-interop.sh`
- Go fixture `compat/koinos-p2p-fixtures/cmd/gossip-fixture` publishes block/transaction gossip and confirms receipt of C++ messages.
- Live test `koinos_libp2p_gossip_live_test` confirms receiving Go messages from C++.
- Bidirectional publish/receive interop log: the fixture prints `fixture received cpp transaction`, `fixture received cpp block`, and `gossip fixture interop ok`.
- Deserialization errors with peer ID and topic are covered by `Libp2pTransport::on_gossip_message` and `P2PNode` scoring.

### 3.5 Stability
- [x] Add reproducible soak harness: `scripts/soak-mainnet-p2p.sh` generates `docs/roadmap/monolith/networking/MONOLITH_GATE_F_SOAK_REPORT.md`
- [x] Add local Gate E smoke with monolith `p2p` + `jsonrpc`: `scripts/smoke-monolith-p2p-local.sh`
- [x] Run short Gate F preflight: 20s, JSON-RPC `node.get_status` responds, one peer snapshot row is recorded, clean shutdown
- [x] Fix cpp-libp2p dialing against mainnet seeds: `seed.koinosfoundation.org` had a stale peer ID; the harness now uses `QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF` as the validated default seed and the preflight connected, completed handshake, and applied blocks
- [x] Add mainnet seed probe: `scripts/probe-mainnet-seeds.sh` uses go-libp2p and reports handshake/protocol version or the real error
- [x] Add fail-fast soak behavior: if `SOAK_REQUIRE_PROGRESS=1` and required progress is not observed within `SOAK_STARTUP_GRACE_SECONDS`, the report is marked invalid
- [x] Add peers observed in production `p2p.log` to `scripts/mainnet-peer-candidates.txt`; move peers accepting Koinos handshakes to `scripts/mainnet-peer-validated.txt`
- [x] Fix the local disconnect/reconnect loop after `score threshold exceeded`: transport removes the peer, fires connect/disconnect callbacks, and the sync loop stops retrying an already disconnected peer
- [x] Harden soak criteria: `SOAK_REQUIRE_HEAD_PROGRESS=1` by default prevents false positives where there is only a libp2p socket but no Koinos handshake/sync progress
- [x] Align C++ libp2p identity metadata with Koinos by advertising `koinos/p2p/1.0.0` and logging the host peer ID plus advertised version
- [x] Fix seed reconnect cadence and ownership so `P2PNode` paces seed dials, avoids duplicate in-flight dials, and does not let `Libp2pTransport` fire an async startup burst
- [x] Implement inbound Peer RPC server handling in the monolith for `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, and `GetBlocks`
- [x] Treat EOF/reset/closed-stream transport errors as stale-peer disconnects without converting a single remote close into `score threshold exceeded`
- [x] Serialize sync application and ignore already-irreversible local catch-up races from overlapping peers
- [x] Confirm latest invalid soak/probe state is also reproduced by Go libp2p in the same peer window, pointing to peer availability/backoff rather than a proven C++ wire mismatch
- [x] Harden `scripts/probe-mainnet-seeds.sh` so validated peers must support Koinos Peer RPC, not just raw libp2p dial
- [x] Add A/B legacy-vs-monolith peer acquisition harness: `scripts/ab-mainnet-peer-acquisition.sh` runs a Go legacy direct-dial Peer RPC discovery/stability baseline and only starts the C++ monolith soak when Go finds stable Peer RPC targets
- [x] Run A/B harness against the current mainnet candidate list before spending more time on C++-only Gate F soaks: first report-only run was blocked because the Go baseline found `0` Peer RPC-capable targets
- [x] Port legacy-style peer acquisition/fanout instead of relying only on configured seed dials: track all libp2p network connections, keep a bounded candidate table, dial discovered candidates toward a target peer count, wire cpp-libp2p Kademlia/GossipSub peer discovery where available, and validate discovered peers through the existing Koinos Peer RPC handshake before using them for sync
- [ ] Add a mainnet comparison run against a legacy Go p2p observer showing the monolith can maintain more than seed-only connectivity under the same network window
- [ ] Run 2h with 1 controlled Go peer and ASAN/TSAN when viable
- [ ] Run 12h with 5-10 real peers, without block production
- [ ] Run 48h with 20+ connected peers
- [ ] Monitor RSS, heap growth, open file descriptors, peer count, RPC timeouts, connection drops, and error scoring
- [ ] Verify fork watchdog detects fork bombs correctly and does not trigger during normal sync
- [ ] Verify reconnect to seed peers after disconnects and network blips
- [ ] Verify clean shutdown: SIGTERM closes libp2p, RocksDB, and threads without hanging
- [ ] Document Teleno alert thresholds: low peer count, stalled sync, RPC timeout rate, memory growth

**3.5 Deliverables:**
- Soak test report with timestamp, commit, build flags, peers, initial/final RSS
- List of blocking issues before mainnet canary
- Recommended config for peers, batch size, and timeouts

**Sprint 3 Deliverable:** Monolith synchronized with mainnet via P2P.

---

## Sprint 4: Data migration + gRPC + legacy functional regressions (1 week)

**Objective:** Existing users can migrate without a full resync.

### 4.1 Badger → RocksDB migration tool
- [x] Add an offline migration entry point for legacy `block_store/db` Badger data: `node/teleno-node/tools/migrate_block_store.sh`
- [x] Reuse the proven restore pipeline: Go Badger exporter streams byte-for-byte records into the C++ RocksDB importer for the monolith `blocks` and `block_meta` column families.
- [x] Preserve embedded skip-list pointers by copying legacy `block_record` values without protobuf re-encoding.
- [x] Verify migration pipeline integrity by comparing exported/imported record and byte counts and requiring at least one imported block-store metadata record.
- [x] Add optional SHA-256 sampling/full verification mode for large migrations: `--verify sample` hashes sampled source Badger records and target RocksDB readback records; `--verify full` hashes every block-store record.
- [ ] Measure full migration time on a large block store (~350GB target class).

### 4.2 Chain state_db migration
- [x] Verify path mapping: monolith opens chain state from `BASEDIR/chain/blockchain`, so the legacy chain state_db is reused in place.
- [x] Document the migration tool behavior in `migrate_block_store.sh --help`.
- [x] Add an end-to-end migration smoke that starts `koinos_node` from a migrated basedir and verifies `chain.get_head_info`.

### 4.3 gRPC client compatibility
- [x] Replace the generic gRPC server with the generated `koinos.services.koinos::Service` so clients using the public protobuf service/method names can route correctly.
- [x] Route typed protobuf calls for chain, block store, mempool, contract meta store, transaction store, and account history into the same in-process service implementations used by JSON-RPC and the producer.
- [x] Test protobuf routing and responses through a generated gRPC stub: `get_chain_id`, `get_head_info`, `get_highest_block`, `get_pending_transactions`, `check_pending_account_resources`, contract-meta misses, and transaction-store misses.
- [x] Test error propagation: disabled optional service returns `UNAVAILABLE`, invalid request validation errors return `INVALID_ARGUMENT` with the underlying service error, unexpected service exceptions return `INTERNAL`, and `get_gossip_status` returns a typed protobuf response from the monolith gossip gate state.
- [x] Add a reusable legacy-vs-monolith comparison harness: `scripts/compare-grpc-parity.sh` with `koinos_grpc_parity_probe`.
- [x] Run the harness against an exposed legacy gRPC endpoint and compare it with a monolith endpoint on the restored dataset.
- [x] Run client compatibility validation: generated protobuf stub probe plus `grpcurl` against the typed `koinos.services.koinos` service, and audit locally installed `koinos-cli`/`koinosctl` behavior.
- [ ] Re-run against `koinosctl` if/when that binary is added to the local toolchain.

**2026-05-25 status:** The migration wrapper has replaced the old placeholder script that claimed Badger data could not be imported. A dry run against `/Volumes/external/teleno-monolith-restore/basedir` passed path/tool checks and correctly reported that the existing target RocksDB is non-empty and the external volume only has `28.3 GiB` free for a `41.3 GiB` legacy Badger source. The full migration was not rerun because that basedir already contains a verified converted RocksDB from Sprint 1.1 and the current free space is below the conservative `2x` recommendation. SHA-256 verification now supports sampled and full modes: the source Badger exporter writes selected record hashes, the C++ importer hashes the corresponding RocksDB readback values, and the wrapper fails if the manifests differ. The same wrapper now supports `--verify-node` and `--verify-node-only`; the migrated-basedir smoke passed against `/Volumes/external/teleno-monolith-restore/basedir` on JSON-RPC port `18113`, with `chain.get_head_info` returning height `36180957` and head id `EiD8tgieMpEReeqtJG8SR0iT/DSwvuLwk5Io63iaYpT4hA==`.

**2026-05-31 gRPC status:** Sprint 4.3 no longer depends on the old `AsyncGenericService` envelope-path assumption. The public Koinos gRPC contract in `services.proto` is the typed service `koinos.services.koinos`, so the monolith now registers that generated service directly and dispatches each method to the matching in-process component. `koinos_grpc_server_test` covers routing, protobuf responses, disabled optional service handling, validation-error mapping, the gossip-status response, and propagated service exceptions. `scripts/compare-grpc-parity.sh` now builds `koinos_grpc_parity_probe` and can run endpoint probes or compare saved legacy/monolith result files through `GRPC_PARITY_LEGACY_INPUT` and `GRPC_PARITY_MONOLITH_INPUT`; this is needed because the restored dataset cannot be opened by the legacy stack and the monolith at the same time. A local legacy gRPC stack was started on `127.0.0.1:50052`, a temporary monolith was started on `127.0.0.1:50151`, and strict sequential comparison passed 8 of 10 cases byte-for-byte/status-for-status: chain ID, head info, highest block, pending transactions, pending-account-resource check, contract-meta DB miss, invalid transaction IDs, and transaction-store DB miss. Two differences remain documented rather than emulated: legacy times out through AMQP for missing `contract_id` while the monolith returns deterministic `INVALID_ARGUMENT`, and legacy times out for `get_gossip_status` when the P2P backend is absent while the monolith now returns a typed `enabled=false` response. Evidence files: legacy baseline `/private/tmp/teleno-grpc-legacy-baseline-20260531T214846Z.json`, monolith probe `/private/tmp/teleno-grpc-monolith-probe-20260531T215543Z.json`, comparison `/private/tmp/teleno-grpc-file-comparison-20260531T215543Z.json`. The temporary smoke node was stopped cleanly. The live testnet producer was not restarted and no producer-key registration was submitted; final check at `2026-05-31T21:58Z` found PID `32977` still guarded by `caffeinate -dims -w 32977`, local and public RPC matching at head `5418907`, and about `19 GiB` free on `/Volumes/external`. The remaining compatibility item is to exercise `koinos-cli`/`koinosctl` against the typed gRPC surface.

**2026-06-01 gRPC client validation:** `scripts/validate-grpc-client-compatibility.sh` was added to make the client audit reproducible. Against a temporary restored-data monolith on gRPC `127.0.0.1:50151` and JSON-RPC `127.0.0.1:18124`, the generated protobuf probe passed all 10 monolith cases with the expected statuses, and `grpcurl` successfully listed `koinos.services.koinos` and invoked typed `get_chain_id`, `get_head_info`, `get_pending_transactions`, and `get_gossip_status`; malformed `get_contract_meta` returned the expected gRPC `InvalidArgument` status. The installed `/usr/local/bin/koinos-cli` is `v0.3.1` and was audited as an HTTP JSON-RPC client, not a gRPC client: it passed a JSON-RPC `balance` smoke against the monolith JSON-RPC port and failed as expected when pointed at the gRPC port. No `koinosctl` binary was present in `PATH`, so there was no local koinosctl surface to exercise. Evidence files: `/private/tmp/teleno-grpc-client-validation-script-20260601T051041Z.txt` and `/private/tmp/teleno-grpc-client-validation-script-20260601T051041Z-probe.json`.

### 4.4 Legacy integration-test compatibility
- [x] Add a reproducible fetch/pin step for `koinos/koinos-integration-tests`, recording the upstream commit used for every run.
- [x] Build an inventory report that classifies each upstream test by topology and safety: single-node, multi-node, producer-required, JSON-RPC-only, direct AMQP/RPC, mutates state, requires Docker legacy services, or can run directly against a monolith endpoint.
- [x] Add a baseline mode that runs selected tests unchanged against the original Docker Compose legacy stack and stores logs, commit, service image tags, head progression, and pass/fail evidence.
- [x] Add a native legacy baseline mode for macOS that runs selected single-node tests unchanged against Knodel's native microservice binaries and GarageMQ, avoiding Docker daemon dependency while preserving the legacy AMQP/microservice topology.
- [x] Add a monolith compatibility mode that starts `koinos_node` with equivalent local genesis/config/descriptors and compatible JSON-RPC ports such as `127.0.0.1:28080`, then runs the same Go test entry point without requiring a public testnet.
- [x] Pass the first high-value single-node upstream test, `publish_transaction`, against both native legacy and monolith compatibility runners.
- [x] Add the remaining high-value single-node baseline tests: `pending_nonce`, `pending_transaction_limit`, `transaction_error`, `koin`, `vhp`, `pob`, and `propose_block`.
- [x] Classify the multi-node upstream tests (`sequential_nonce`, `bucket_brigade`, and tests that require independent producer/API/observer roles) as future regression expansion rather than part of the Sprint 4.4 release gate.
- [x] Treat `koinos-grpc` unit tests as supplemental only. The upstream `koinos-grpc` test suite exists, but it is shallow compared with the integration suite; gRPC compatibility remains covered by `scripts/compare-grpc-parity.sh`, `koinos_grpc_parity_probe`, `grpcurl`, and `koinos_grpc_server_test`.
- [x] Document every intentional difference between legacy and monolith behavior. A test may pass through a compatibility shim only when the shim reflects public API behavior, not a shortcut that hides protocol divergence.
- [x] Add a release gate: before Sprint 5/6 signoff, the selected local integration suite must pass against the monolith, or any blocked tests must have an explicit reason and replacement coverage.

**2026-06-01 integration-test closeout:** The public `koinos/koinos-integration-tests` repository is now part of the monolith validation plan as a functional regression source. It is not meant to run directly against the shared public testnet because the tests mint, burn, register keys, produce blocks, and otherwise mutate their local chain. `scripts/fetch-koinos-integration-tests.sh` pins upstream commit `74b64d739a98045630cb61557e1f141c04cd1eb1`, and `scripts/run-koinos-integration-compat.sh inventory` generated the first classification report at `/private/tmp/teleno-integration-compat/20260601T124202Z/inventory.md`. Docker legacy mode still exists, but local Docker is no longer required for the selected baseline: `scripts/run-koinos-integration-compat.sh legacy-native <test-name>` starts GarageMQ plus the native legacy `chain`, `mempool`, `block_store`, `jsonrpc`, optional `p2p`, and optional `block_producer` binaries in a temporary basedir, then runs the upstream Go test unchanged against `127.0.0.1:28080`.

| Runner | Tests | Status | Evidence |
|---|---|---|---|
| `legacy-native` | `publish_transaction`, `pending_nonce`, `pending_transaction_limit`, `transaction_error`, `koin`, `vhp`, `pob`, `propose_block` | Pass | `/private/tmp/teleno-integration-compat/20260601T175222Z/`, `20260601T175239Z/`, `20260601T175251Z/`, `20260601T175303Z/`, `20260601T175315Z/`, `20260601T175327Z/`, `20260601T175518Z/`, `20260601T175617Z/` |
| `monolith` | `publish_transaction`, `pending_nonce`, `pending_transaction_limit`, `koin`, `vhp`, `pob` | Pass | `/private/tmp/teleno-integration-compat/20260601T175129Z/`, `20260601T174855Z/`, `20260601T175048Z/`, `20260601T175917Z/`, `20260601T175113Z/`, `20260601T175546Z/` |

The first monolith `publish_transaction` run exposed a real API compatibility bug: the transaction was accepted and included by the monolith, but generic protobuf JSON encoded typed byte fields as Base64, so the upstream Go test could not unmarshal transaction/block ids with `koinos-proto-golang/encoding/json`. `jsonrpc_server.cpp` now recursively rewrites response byte fields using `koinos.btype`, matching legacy public JSON behavior. The later `pending_transaction_limit` run exposed the matching input-side gap for `submit_block`: upstream Go clients send block and transaction ids in Koinos JSON form, while protobuf JSON expects Base64. `jsonrpc_server.cpp` now normalizes full block payloads recursively before protobuf parsing.

Intentional differences are limited to legacy AMQP surfaces. `transaction_error` validates raw AMQP protobuf envelope errors, and `propose_block` injects mempool/gossip events directly through AMQP. Those are kept as native legacy baselines because the monolith intentionally has no public AMQP API. Replacement monolith coverage is Sprint 4.3 gRPC protobuf envelope/error parity, `koinos_grpc_server_test`, `koinos_block_producer_test`, `koinos_mempool_adapter_test`, upstream `publish_transaction` and `pob`, and the live public-testnet transaction inclusion signoff. The `koin` test uses only contract semantics but instantiates a legacy AMQP client directly, so the monolith runner adapts only the client construction to public JSON-RPC and leaves the upstream assertions unchanged.

**Sprint 4 Deliverable:** Functional migration tool, validated gRPC compatibility, and a pinned local legacy-integration regression path for the monolith.

---

## Sprint 5: Performance + hardening (2 weeks)

**Goal:** Prove the monolith is faster than the legacy multi-service stack and harden it for mainnet canary operation.

### 5.1 Benchmarks
- [x] Add a repeatable benchmark harness for read-only JSON-RPC latency, head progress, RSS/CPU sampling, optional log-derived indexing speed, and opt-in startup measurement for a launched `koinos_node` process.
- [x] Add a same-machine native legacy JSON-RPC benchmark wrapper for local microservice-stack comparison.
- [x] Add a dedicated live P2P sync/catch-up benchmark wrapper for an isolated non-producing observer.
- [x] Add a mixed RPC/submit/sync stress wrapper that runs live producer RPC sampling, low-value transaction submission, and temporary observer sync concurrently.
- [x] Indexing speed: live P2P catch-up is measured separately from offline replay; the offline/replay chain indexer benchmark passed the old `10,000-15,000` blocks/sec target.
- [~] JSON-RPC latency: benchmark `chain.get_head_info` against the monolith and legacy stack (target: <0.2ms vs 2-5ms)
- [~] Transaction submission: round-trip time (target: <2ms vs 5-15ms)
- [~] Memory usage: RSS during operation (target: <400MB vs 500-800MB)
- [x] Startup time: spawn to JSON-RPC responsive (target: <5s vs 10-30s)

**2026-06-01 status:** `scripts/benchmark-monolith.py` is now the Sprint 5 baseline runner. By default it is read-only and attaches to an existing node, so it can sample the live testnet producer without restarting it or mutating chain state. It writes both `result.json` and `result.md` under `/private/tmp/teleno-monolith-benchmarks/<timestamp>`. Launch mode is opt-in through `--launch-bin`, `--launch-basedir`, and `--jsonrpc-listen`; in that mode it measures startup until `chain.get_head_info` succeeds and then terminates the launched process unless `--keep-running` is supplied. A short attach-mode smoke against the live producer passed with `chain.get_head_info` at p50 `0.328 ms`, p95 `0.443 ms`, zero RPC errors, PID `32977` sampled through the live producer PID file, RSS around `30.8 MB`, and CPU around `5.6%`; result files were written to `/private/tmp/teleno-monolith-benchmarks/20260601T214350Z`. The first release-gate use should capture a longer local producer baseline, then a comparable legacy endpoint baseline before tuning RocksDB/thread pools.

**2026-06-02 live monolith baseline:** A 5-minute read-only benchmark against the live monolith producer passed without restarting the node or mutating chain state. Command shape: `scripts/benchmark-monolith.py --rpc-url http://127.0.0.1:18122/ --pid-file /Users/pgarcgo/.kcli/teleno-testnet-producer/live-testnet-sync.pid --duration-seconds 300 --interval-seconds 5 --latency-requests 1000 --warmup-requests 20`. Result: `chain.get_head_info` count `1000`, errors `0`, mean `0.272 ms`, p50 `0.218 ms`, p95 `0.575 ms`, p99 `0.826 ms`, max `3.136 ms`; RSS mean `38.432 MB`, p95 `44.299 MB`, max `44.891 MB`; CPU mean `9.395%`, p95 `11.93%`; live head advanced `111` blocks over `300.339s`. Result files: `/private/tmp/teleno-monolith-benchmarks/sprint5-live-monolith-20260602/result.json` and `/private/tmp/teleno-monolith-benchmarks/sprint5-live-monolith-20260602/result.md`.

**2026-06-02 legacy observer reference:** VPS1 legacy observer was also benchmarked through a temporary SSH tunnel to its localhost JSON-RPC. This is not an apples-to-apples local latency baseline because it includes SSH/network/remote-host effects, and process RSS/CPU were intentionally not sampled. Clean result: `chain.get_head_info` count `500`, warmup errors `5` from legacy RPC `context deadline exceeded`, mean `51.272 ms`, p50 `42.982 ms`, p95 `127.605 ms`, p99 `132.529 ms`, max `136.747 ms`; head advanced `106` blocks over `91.796s`. Result files: `/private/tmp/teleno-monolith-benchmarks/sprint5-vps1-legacy-observer-clean-20260602/result.json` and `/private/tmp/teleno-monolith-benchmarks/sprint5-vps1-legacy-observer-clean-20260602/result.md`. The next benchmark task is to capture a same-machine local legacy baseline, because only that can fairly guide JSON-RPC latency and memory tuning against the monolith.

**2026-06-02 same-machine native legacy baseline:** `scripts/benchmark-legacy-native-jsonrpc.sh` now starts an isolated local legacy stack with GarageMQ, `koinos_chain`, `koinos-block-store`, `koinos_mempool`, and `koinos-jsonrpc` on private ports `25674`, `35674`, and `28081`, using the cached `koinos-integration-tests` genesis/descriptors. It intentionally leaves P2P and block production disabled, samples the JSON-RPC process PID through `scripts/benchmark-monolith.py`, records a separate service-level RSS/CPU CSV for the whole microservice stack, and cleans up all native services before exit. Full baseline result: `chain.get_head_info` count `500`, errors `0`, mean `0.585 ms`, p50 `0.387 ms`, p95 `1.43 ms`, p99 `3.393 ms`, max `15.588 ms`; JSON-RPC process RSS mean `12.258 MB`, p95 `12.539 MB`, max `18.734 MB`; total minimal-stack RSS mean `45.413 MB`, max `59.672 MB`; total stack CPU mean `1.236%`, max `1.9%`. Result files: `/private/tmp/teleno-legacy-native-benchmark/20260602T175845Z/benchmark/result.json`, `/private/tmp/teleno-legacy-native-benchmark/20260602T175845Z/benchmark/result.md`, and `/private/tmp/teleno-legacy-native-benchmark/20260602T175845Z/service-samples-summary.txt`. This closes the local JSON-RPC overhead baseline. The remaining Sprint 5.1 measurements are transaction submission round-trip, startup time, and true sync/indexing speed.

**2026-06-02 live transaction-submit baseline:** `scripts/benchmark-transaction-submission.js` now builds valid KOIN transfers with koilib, decrypts the local kcli wallet only in memory through the existing `0600` password-file path, signs transactions without printing or writing private material, times operation build, prepare, sign, and direct `chain.submit_transaction`, samples local mempool growth/drain, and verifies public inclusion. A dry-run first prepared and signed two transactions without submission. The live submit run used five `0.001` KOIN transfers from `1Kjfrv3qxWvb3afwUdFevZHS1WdT4ginPi` to the controlled hot-key address `1FFpnG9ev9ZsZ91uDWF19ro7zaKodcBtzX`, with total cap `0.01` KOIN. Result: status `pass`; direct submit mean `7.302 ms`, p50 `5.578 ms`, p95 `12.155 ms`, p99 `13.241 ms`, max `13.512 ms`; full client prepare/sign/submit mean `11.787 ms`, p95 `17.173 ms`; local mempool samples rose from `0` to `5` pending transactions and drained to `0`; all five transactions were included in public block `5470571`, which the local producer log also recorded as a produced block with `5 transactions`. Result files: `/private/tmp/teleno-transaction-benchmarks/sprint5-live-submit-20260602/result.json` and `/private/tmp/teleno-transaction-benchmarks/sprint5-live-submit-20260602/result.md`. This closes a first live monolith submit baseline but does not meet the aspirational `<2 ms` target yet; keep it as tuning input for JSON-RPC/chain/mempool path investigation.

**2026-06-02 monolith startup baseline:** `scripts/benchmark-monolith-startup.sh` now wraps `scripts/benchmark-monolith.py` launch mode for repeated startup measurement. It prepares temporary basedirs from the cached `koinos-integration-tests` genesis/descriptors, starts local monolith nodes with chain, mempool, block_store, transaction_store, contract_meta_store, and JSON-RPC enabled, keeps P2P/gRPC/block_producer disabled, and terminates each node after JSON-RPC readiness and a small read-only sample. Five iterations on localhost ports `28100-28104` passed with no warning/error log matches and no leftover startup processes. Startup-to-JSON-RPC summary: min `229.397 ms`, mean `263.672 ms`, p50 `232.715 ms`, p95 `348.374 ms`, p99 `367.853 ms`, max `372.723 ms`, comfortably below the `<5s` target. Result files: `/private/tmp/teleno-monolith-startup-benchmark/sprint5-startup-20260602/summary.json` and `/private/tmp/teleno-monolith-startup-benchmark/sprint5-startup-20260602/summary.md`.

**2026-06-02 live P2P sync baseline:** `scripts/benchmark-monolith-sync.py` now launches a temporary non-producing observer from height `0`, copies only the live testnet genesis/descriptors from `/Volumes/external/teleno-testnet-producer/basedir`, connects to `/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W`, samples local chain head, local block-store head, public remote head, RSS/CPU, and P2P log counters, then terminates the observer. A 30s smoke advanced `2260` blocks at `75.308` blocks/sec. The 120s Sprint 5.1 run passed on JSON-RPC port `28200`: startup-to-JSON-RPC `181.387 ms`, local head `0 -> 9300`, average `77.494` blocks/sec, window p95 `88.221` blocks/sec, block-store head `458 -> 9300`, one handshake, one connected peer, `21` sync rows, zero warnings, zero score-threshold rows, zero checkpoint mismatches, zero block-application failures, RSS p95 `49.605 MB`, and CPU p95 `100%` while catch-up saturated one core. The benchmark observer shut down cleanly with no leftover process, and the live producer on `127.0.0.1:18122` remained healthy at public-testnet head `5471215`. Result files: `/private/tmp/teleno-monolith-sync-benchmark/sprint5-testnet-sync-20260602/result.json` and `/private/tmp/teleno-monolith-sync-benchmark/sprint5-testnet-sync-20260602/result.md`. This closes the live P2P catch-up baseline, but it does not prove the old `10,000-15,000` blocks/sec indexing target because that target is not comparable to single-peer live-network sync; keep an offline/replay benchmark as follow-up if the target remains a release gate.

**2026-06-03 mixed RPC/submit/sync stress:** `scripts/benchmark-monolith-mixed-stress.py` now composes the existing live observer sync benchmark, read-only live producer RPC/process benchmark, and koilib transaction submission benchmark into one pass/warn/fail report. Real transfers remain opt-in through `--submit-transfers`. A 30s dry run passed sync/RPC and warned only because submit was intentionally dry-run. The 120s live-submit gate then passed on commit `da2f21c` with command shape: `scripts/benchmark-monolith-mixed-stress.py --duration-seconds 120 --sample-interval-seconds 5 --sync-jsonrpc-port 28610 --latency-requests 300 --warmup-requests 10 --tx-count 3 --amount 0.001 --max-total-koin 0.005 --confirm-timeout-ms 180000 --submit-transfers --report-dir /private/tmp/teleno-monolith-mixed-stress/live-submit-20260603`. Results: temporary observer local head `0 -> 9300`, average `77.494` blocks/sec, one handshake, one peer, `21` sync rows, zero warning/score-threshold/checkpoint/block-application rows; live producer RPC p95 `0.685 ms` for `chain.get_head_info`, `0.342 ms` for `block_store.get_highest_block`, and `1.436 ms` for `mempool.get_pending_transactions`; three `0.001` KOIN transfers submitted through local monolith JSON-RPC were all included in public block `5479327`, with direct submit p95 `10.806 ms` and full client prepare/sign/submit p95 `17.038 ms`. The live producer was not restarted and remained healthy at local head `5479367` after the run. Result files: `/private/tmp/teleno-monolith-mixed-stress/live-submit-20260603/summary.json` and `/private/tmp/teleno-monolith-mixed-stress/live-submit-20260603/summary.md`. This closes the mixed load/deadlock regression gate.

**2026-06-03 offline/replay indexing benchmark:** `scripts/benchmark-monolith-index-replay.py` now prepares bounded block-store subsets from the restored external-SSD basedir, opens the source with `chain` disabled so the source is not indexed/mutated, copies blocks through JSON-RPC `block_store.get_blocks_by_height` -> `block_store.add_block`, restarts the target node, and parses the chain indexer `Finished indexing ... blocks` row. `jsonrpc_server.cpp` now normalizes public Koinos JSON byte/address encodings for `block_store.add_block`, which lets blocks returned by block-store read APIs round-trip back through JSON-RPC. Receipts remain optional through `--include-receipts`; the default omits them because chain replay/indexing only requires blocks and full receipts can produce oversized JSON-RPC payloads. A 100-block smoke passed at `19,849.146` blocks/sec with zero warning/error rows. The representative 10,000-block sample passed on commit `da2f21c`: copy phase `10,000` blocks in `15.547s` (`643.215` blocks/sec, preparation only), replay/index phase `10,000` blocks in `0.59243s` (`16,879.631` blocks/sec), final head `10000`, zero warning/error rows, and target basedir size `7.9 MiB`. Result files: `/Volumes/external/teleno-monolith-index-replay-benchmark/sample-10000-20260603/result.json` and `/Volumes/external/teleno-monolith-index-replay-benchmark/sample-10000-20260603/result.md`. This satisfies the old indexing throughput target as an offline replay metric; live P2P sync remains bounded by peer/network/application pacing and is tracked separately.

### 5.2 RocksDB tuning
- [~] `blocks` CF: Large block size (`64KB`), Bloom filters, and requested `zstd` compression with runtime fallback when the linked RocksDB build does not support the codec.
- [x] `default` (chain state): Small block size (`4KB`), shared block cache, Bloom filters, and point-lookup/memtable whole-key filtering.
- [x] Configure a shared LRU block cache across column families.
- [x] Make the compaction/flush thread pool and write-buffer sizing configurable through `config.yml`.

**2026-06-02 RocksDB tuning implementation:** `NodeConfig` now accepts a `rocksdb:` section with `block-cache-mb`, `max-background-jobs`, `bytes-per-sync`, `default-block-size`, `blocks-block-size`, `target-file-size-base`, `max-bytes-for-level-base`, `write-buffer-size`, `db-write-buffer-size`, `max-write-buffer-number`, and `blocks-compression`. The monolith creates one shared LRU block cache for all six RocksDB column families, enables cached index/filter blocks, pins L0 filters/indexes, applies `4KB` table blocks for chain/default and metadata/index column families, applies `64KB` table blocks for the `blocks` column family, enables Bloom filters for point-lookups and prefix Bloom filtering for account history, sets `max_background_jobs`, `max_subcompactions`, shared DB write-buffer limits, and pipelined writes, and logs the selected tuning at startup. Compression selection now prefers the configured codec (`zstd` by default), then `snappy`, then no compression based on `rocksdb::GetSupportedCompressions()`, so deployments with ZSTD support can use it without breaking local builds that lack the codec. Verification: `cmake --build node/teleno-node/build --target koinos_node --parallel` passed; an isolated startup smoke on port `28210` passed with RocksDB opening six column families and logging `block_cache_mb=256`, `default_block_size=4096`, `blocks_block_size=65536`, and `blocks_compression=none` because the current Hunter RocksDB build has ZSTD/Snappy disabled. Evidence: `/private/tmp/teleno-rocksdb-tuning-smoke-20260602/summary.json` and `/private/tmp/teleno-rocksdb-tuning-smoke-20260602/iteration-1/koinos_node.log`. The live producer on `127.0.0.1:18122` was not restarted and remained healthy at public-testnet head `5472216`.

### 5.3 Thread pool optimization
- [x] Measure contention between `chain_ioc`, JSON-RPC session concurrency, P2P IO/sync threads, and RocksDB background jobs.
- [x] Adjust per-component thread counts based on CPU usage and the cpp-libp2p single-runner constraint.
- [x] Verify there are no deadlocks under mixed RPC/submit/sync load for the current live-testnet release gate.

**2026-06-02 thread-pool tuning implementation:** The monolith now logs its effective runtime thread topology at startup, including `main_ioc`, configured chain jobs, JSON-RPC session limit, gRPC pollers, requested P2P IO threads, effective P2P IO threads, per-peer P2P sync threads, and RocksDB background jobs. cpp-libp2p remains intentionally serialized on one effective IO runner because the current transport code documents that connection and muxer state is not safe to drive from multiple runners; when `p2p.jobs` requests more than one IO thread, the transport logs the requested count and the effective serialized runner count. JSON-RPC no longer creates unbounded detached session threads: `jsonrpc.jobs` is now normalized to at least one and enforced as a hard active-session limit, returning `503` with a JSON-RPC error body if the limit is reached. `scripts/benchmark-monolith-sync.py` now writes explicit `chain.jobs`, `jsonrpc.jobs`, `grpc.jobs`, `p2p.jobs`, and RocksDB background-job settings into each temporary observer config and records the logged runtime topology and RocksDB tuning in the result. `scripts/benchmark-monolith-thread-matrix.py` runs a reproducible isolated live-sync matrix across thread settings. Verification: Python syntax checks passed, `cmake --build node/teleno-node/build --target koinos_node --parallel` passed, and a short three-row matrix against the live testnet seed passed with no leftover temporary observers and the live producer untouched. Results: `baseline` (`jsonrpc=4`, requested `p2p=4`, RocksDB jobs `4`) advanced `1568` blocks at `78.38` blocks/sec with CPU p95 `98.48%`; `bounded` (`jsonrpc=2`, requested `p2p=1`, RocksDB jobs `2`) advanced `1564` blocks at `78.165` blocks/sec with CPU p95 `99.98%`; `db-heavy` (`jsonrpc=2`, requested `p2p=1`, RocksDB jobs `6`) advanced `1526` blocks at `76.281` blocks/sec with CPU p95 `99.24%`. All three rows had zero warnings, score-threshold rows, checkpoint mismatches, or block-application failures. Evidence: `/private/tmp/teleno-monolith-thread-matrix/sprint5-thread-matrix-20260602/summary.json` and `/private/tmp/teleno-monolith-thread-matrix/sprint5-thread-matrix-20260602/summary.md`. The data shows live catch-up remains dominated by one saturated sync/apply path and peer/network pacing, so raising RocksDB background jobs or pretending P2P has multiple safe IO runners does not improve the current live-sync benchmark. The recommended live-sync profile for now is the bounded profile: `jsonrpc.jobs: 2`, `p2p.jobs: 1`, `grpc.jobs: 1` when gRPC is disabled, and `rocksdb.max-background-jobs: 2-4` depending on disk headroom.

### 5.4 Error handling hardening
- [x] Review every `catch(...)` path in the monolith wrapper and ensure errors are not swallowed silently
- [~] Add graceful degradation so a component failure does not unnecessarily stop unrelated components. Startup and shutdown cleanup are covered; runtime component restart/supervision remains a future hardening step.
- [~] Verify SIGTERM always produces clean shutdown under load. Short live-sync load proof passed, and the mixed stress wrapper terminates its temporary observer while live RPC/submit load is active; a full live-producer SIGTERM-under-load drill remains a future canary-operations test.

**2026-06-02 error-handling hardening implementation:** The monolith wrapper now handles broad exception paths explicitly instead of silently swallowing them. `ServiceRegistry` tracks which components actually started, logs start failures, stops already-started components in reverse order when a later component fails to start, skips never-started components during shutdown, and continues stopping remaining components when one stop handler throws a standard or unknown exception. JSON-RPC sessions now log unknown session exceptions, JSON-RPC dispatch returns an internal-error response for unknown service exceptions, incoming Peer RPC returns a server-error response for unknown handler exceptions, periodic metrics collection logs standard and unknown collection failures, and `main()` reports unknown top-level exceptions instead of falling through. The remaining broad catches were reviewed: config fallback catches are intentionally preserved because config parsing runs before logging is initialized and keeps legacy compatibility, while the async monolith RPC client still propagates unknown failures through its promise/future boundary. A new `koinos_service_registry_test` covers standard and unknown startup failures plus standard and unknown stop failures. Verification: `cmake --build node/teleno-node/build --target koinos_node --parallel` rebuilt the node, `cmake --build node/teleno-node/build --target koinos_service_registry_test --parallel && ctest --test-dir node/teleno-node/build --output-on-failure -R koinos_service_registry_test` passed, and a short isolated live-testnet sync/SIGTERM smoke passed through `scripts/benchmark-monolith-sync.py --duration-seconds 20 --sample-interval-seconds 5 --jsonrpc-port 28400 --report-dir /private/tmp/teleno-error-hardening-sync-20260602`. The smoke advanced `1555` blocks at `77.719` blocks/sec, recorded one handshake, two connected-peer snapshots, zero warning/error/score-threshold/checkpoint/block-application rows, and no leftover observer process. The live producer on `127.0.0.1:18122` was not restarted and remained healthy at public-testnet head `5473896`.

### 5.5 Logging
- [~] Verify every component consistently uses the `[component]` prefix. Monolith wrapper lifecycle and subsystem rows are normalized; deeper legacy chain/mempool internals still have some old unprefixed rows.
- [x] Add periodic metrics for blocks/sec, pending transactions, peer count, and memory
- [x] Verify log rotation works with the Teleno 512KB log buffer

**2026-06-02 logging hardening implementation:** The monolith now emits compact startup, readiness, signal, and shutdown lifecycle rows with the `[node]` prefix, and the RocksDB open failure path uses the `[db]` prefix. The periodic `[metrics]` row now emits immediately at readiness and then every `60s`, and includes `head_height`, `lib`, derived `blocks_per_sec`, `pending_txs`, `peer_count`, `rss_bytes`, `rss_mb`, and `components`. RSS collection uses `task_info` on macOS and `/proc/self/statm` on Linux, with `0` as the fallback value when the platform cannot report current RSS. Teleno's desktop log-buffer behavior is covered by `electron/lib/logs-service.test.ts`: the new test appends more than `512KB` of native output, then verifies the compact `[metrics]` row remains parseable after trimming. Verification passed: `cmake --build node/teleno-node/build --target koinos_node --parallel`, `npx vitest run electron/lib/logs-service.test.ts`, and `REPORT_DIR=/private/tmp/teleno-logging-smoke-20260602 ITERATIONS=1 START_PORT=28500 scripts/benchmark-monolith-startup.sh`. The isolated startup smoke emitted `[node] koinos_node ready`, `[metrics] head_height=0 lib=0 blocks_per_sec=0.000 pending_txs=0 peer_count=0 rss_bytes=24379392 rss_mb=23.250 components=3`, `[node] Received signal 15`, and `[node] koinos_node shutdown complete`, with no leftover temporary process. The live producer on `127.0.0.1:18122` was not restarted and remained healthy at public-testnet head `5474776`.

**Sprint 5 deliverable:** Documented benchmarks, tuned RocksDB, and a hardened node.

---

## Sprint 6: Mainnet deployment (1 week)

**Goal:** deploy the monolith on mainnet and prepare a Teleno release that can safely ship the native monolith runtime.

### 6.1 Mainnet canary
- [~] Deploy the monolith on a production server without block production. Short disposable VPS1 observer canary passed; restored-data/longer production observer deployment remains pending.
- [ ] Complete sync from mainnet peers.
- [ ] Compare head height and block IDs against a parallel legacy multi-service node.
- [ ] Monitor 48h: stability, memory, CPU, peer churn, warning/error rows.

**2026-06-03 canary attempt:** Sprint 6.1 was blocked on stable mainnet Peer RPC availability from this host. The A/B harness found three Peer RPC-capable peers during discovery, but the repeat stability probe failed for all three with security-negotiation resets. A short disposable C++ monolith observer canary against the discovered peers started cleanly and kept JSON-RPC available, but observed no peer session, handshake, sync row, or head progress before the `120s` startup grace expired. Public mainnet RPC was at height `36489056`; the restored monolith basedir is verified at `36180957`, leaving about `309099` blocks to catch up once a stable peer window exists. Report: `docs/roadmap/monolith/networking/MONOLITH_MAINNET_CANARY_REPORT.md`.

**2026-06-04 VPS1 short canary:** The monolith now builds on VPS1 at `/opt/knodel-mainnet-canary` after forcing cpp-libp2p and `koinos_node` onto the same Koinos Hunter OpenSSL 3 and `yaml-cpp` dependencies. A `300s` disposable mainnet observer canary with block production disabled passed on the server: process exit `0`, clean shutdown, max observed head `20282`, `3` handshakes, `48` sync rows, `0` disconnects, and `0` warning/score-threshold/checkpoint-mismatch rows. This validates the remote build, config loading, mainnet peer acquisition, handshake, and early sync path. It does not complete Sprint 6.1; the remaining gate is a restored-data or longer fresh-data observer canary, parallel legacy comparison, and `48h` stability monitoring. Report: `docs/roadmap/monolith/networking/MONOLITH_MAINNET_CANARY_REPORT.md`.

### 6.2 Mainnet producer
- [ ] Enable `block_producer` in the monolith.
- [ ] Verify produced blocks are accepted by the network.
- [ ] Monitor 48h: produced blocks, expected share, missed slots, warning/error rows.

### 6.3 Teleno release
- [~] Package the native monolith through electron-builder. Unsigned macOS `.app` directory packaging passed before final release naming; current Teleno-branded signed/notarized DMG remains pending.
- [~] Verify the UI clearly shows the single monolith node runtime, network mode, optional component status, and fallback/error status.
- [ ] Document the end-user migration process.
- [ ] Release as Teleno v0.11.0.

**2026-06-11 packaging readiness:** macOS packaging now has two automated gates for the Teleno layout. `npm run test:package-staging` runs `scripts/verify-package-staging.js` before electron-builder and verifies the staged native bundle under `build/bundle-staging/teleno`, including `teleno_node`, config templates, and core contract ABIs. `npm run test:packaged` runs `scripts/verify-packaged-app.js` after electron-builder and verifies the final packaged app contains `app.asar`, `Resources/teleno/bin/teleno_node`, and config templates. All macOS package scripts use the existing `build:icon:mac` command, run `stage`, run the staging smoke, run electron-builder, and then run the packaged-app smoke. `package:mac:dir` is explicitly unsigned through `CSC_IDENTITY_AUTO_DISCOVERY=false`, making it the local release-candidate smoke command. Signed/notarized DMG verification remains pending because it depends on release credentials.

**2026-06-11 release status:** The repository package identity is now `teleno` and app version is `0.10.1`. The final release gate must re-run package staging and packaged-app verification after this Teleno cleanup, then produce the signed/notarized artifact for `v0.11.0`. Historical `Knodel.app` package evidence remains useful only as old native-bundle completeness evidence, not as final release evidence for the renamed product.

### 6.4 Monolith node-settings cleanup and advanced hardening

**Goal:** make `Settings > Node Settings` trustworthy for a simple monolith node operator. A visible field must either be parsed and effective in `koinos_node`, or be clearly removed/hidden until the backend support exists. This is a release-readiness task for Teleno because stale microservice-era settings can make users believe they changed storage, networking, or RPC security when the monolith ignored the key.

**Audit source:** the GUI schema is `src/app/koinos-config-schema.ts`; the monolith parser is `node/teleno-node/src/core/config.cpp`; runtime use is in `node/teleno-node/src/main.cpp`, `src/p2p`, `src/jsonrpc`, `src/grpc_server`, and `src/block_production`.

**Planning refinement log:**
- **Pass 1 - raw cleanup:** split every current GUI setting into `effective`, `parsed-only`, `not parsed because obsolete`, and `not parsed but real TODO`. The first draft removed only obvious microservice leftovers and kept the rest visible.
- **Pass 2 - operator safety:** refine the plan so no ineffective setting remains editable. Fields that are real TODOs must be hidden or disabled until implementation lands, then reintroduced only with tests and restart guidance.
- **Pass 3 - release sequencing:** put low-risk renderer cleanup first, then backend protocol/security work, then advanced UI exposure. This avoids shipping misleading controls while keeping protocol-sensitive changes behind focused unit tests and isolated node smokes.

**Action classification:**

| Setting | Current issue | Decision | Rationale |
|---|---|---|---|
| `global.amqp` | Legacy AMQP URL, hidden today | Remove from visible schema; keep only migration tolerance | The monolith intentionally has no AMQP or GarageMQ internal path. |
| `global.blacklist` | GUI-visible but not parsed/effective | Implement as advanced RPC ACL | Needed for public-facing RPC hardening; not needed for simple local-only operation. |
| `global.whitelist` | GUI-visible but not parsed/effective | Implement as advanced RPC ACL | Same security surface as blacklist; whitelist must win over blacklist when set. |
| `block_store.basedir` | GUI-visible but ignored | Remove from UI | Monolith stores block data in shared `BASEDIR/db` RocksDB column families. |
| `transaction_store.basedir` | GUI-visible but ignored | Remove from UI | Monolith transaction index is a shared RocksDB column family. |
| `contract_meta_store.basedir` | GUI-visible but ignored | Remove from UI | Monolith contract metadata index is a shared RocksDB column family. |
| `account_history.basedir` | GUI-visible but ignored | Remove from UI | Monolith account history index is a shared RocksDB column family. |
| `p2p.peer-exchange` | GUI-visible but not parsed | Remove or replace with existing discovery controls | Current monolith equivalent is `peer-discovery` plus candidate acquisition settings. |
| `p2p.checkpoint` | GUI-visible but not parsed | Implement as advanced P2P safety setting | Legacy Go p2p used checkpoints to reject peers not on the configured chain. |
| `p2p.seed` | GUI says identity seed, parser treats it as peer list | Fix schema and parser semantics | Legacy Koinos uses `p2p.seed` as deterministic peer identity seed; seed peers belong in `p2p.peer`. |
| `block_producer.pob-contract-id` | Schema-only/no parser | Do not expose in normal UI | Mainnet/testnet producer resolves `pob` from on-chain name service. A private-chain override can be a future debug-only setting. |
| `block_producer.vhp-contract-id` | Schema-only/no parser | Do not expose in normal UI | Same as PoB contract override. |

**Implementation phases:**

1. **Renderer schema cleanup - no backend behavior change**
   - Remove or hide no-op fields from `src/app/koinos-config-schema.ts`: store-specific `*.basedir`, `p2p.peer-exchange`, and producer PoB/VHP contract overrides.
   - Keep feature flags for `contract_meta_store`, `transaction_store`, and `account_history`; only remove their per-service data-directory fields.
   - Remove empty sections from the rendered config panel so the user does not see tabs/accordions with no effective fields.
   - Update `src/i18n.ts` labels/help to remove stale AMQP/MQ/service-directory language from the visible surface.
   - Preserve unknown keys already present in `config.yml` on save; the cleanup must stop writing no-op fields, not destructively rewrite existing user config.
   - Add a small config-schema unit test that fails if a field marked visible has no corresponding parser/effectiveness classification.

2. **Config diagnostics before deletion**
   - Add a non-blocking "Ignored legacy settings" diagnostic in the advanced Node Settings panel if an existing config contains no-op keys such as `global.amqp`, store `basedir`, `p2p.peer-exchange`, or old producer contract overrides.
   - The diagnostic should explain that these keys are ignored by the monolith and offer a later cleanup action only after the user confirms.
   - Do not automatically delete ignored keys in the first release; this avoids surprising users who reuse the same basedir with legacy tooling.

3. **Fix `p2p.seed` semantics**
   - Update `NodeConfig` with a dedicated deterministic P2P identity field. Preferred naming is `p2p.identity-seed` for explicit monolith config, while accepting legacy string `p2p.seed` as an alias.
   - Keep `p2p.peer` as the only GUI field for seed/static peer multiaddresses.
   - For backward compatibility, if `p2p.seed` is already a YAML sequence in an experimental config, log a deprecation warning and treat it as extra peer addresses for one release cycle.
   - Wire the deterministic identity into `Libp2pTransport::Config`. The transport already has an `identity_key_path` placeholder; the implementation must either generate a deterministic identity from the configured seed or persist the generated identity key under `BASEDIR/p2p`.
   - Add a transport/unit test that two starts with the same identity seed produce the same peer ID, and two starts without a seed preserve or intentionally rotate identity according to the chosen storage policy.
   - Keep the identity field advanced-only; simple operators normally do not need stable public seed identity.

4. **Implement configured P2P checkpoints**
   - Add a parsed checkpoint structure to `NodeConfig` and `P2POptions`, using `height:block_id` strings from `p2p.checkpoint`.
   - Accept hex block IDs with optional `0x`; consider accepting Koinos JSON/base64url IDs if the current block ID utilities make that safe.
   - Validate configured checkpoints at startup and fail fast on malformed values with a clear `[p2p]` or `[config]` error.
   - During peer handshake, after chain ID and remote head are known, ask the peer for each checkpoint ancestor and reject/score the peer if it does not contain the configured block.
   - Avoid false faults for peers behind the checkpoint: classify them as unusable for this node until they catch up rather than as malicious, unless legacy behavior proves otherwise in comparison.
   - Add focused C++ tests for matching checkpoint, mismatched checkpoint, malformed config, and peer-behind-checkpoint behavior.
   - Add one isolated live/testnet smoke with no checkpoints configured to prove default behavior is unchanged.

5. **Implement RPC whitelist/blacklist**
   - Add `global.blacklist` and `global.whitelist` parsing to `NodeConfig` as canonical RPC target strings such as `chain.get_head_info` or whole-service names such as `block_store`.
   - Introduce a shared `RpcAccessPolicy` helper used by JSON-RPC first, and by gRPC if the policy can map generated method names to the same `service.method` targets cleanly.
   - Policy rules: if whitelist is non-empty, only whitelisted targets are allowed; otherwise all targets are allowed except blacklisted targets. Exact method entries override service-level entries only when this is explicitly documented and tested.
   - Keep HTTP health/CORS/options handling outside the policy; enforce only actual RPC method dispatch.
   - Return deterministic JSON-RPC errors for blocked methods, with a message that does not leak private config beyond the target being denied.
   - Add tests for service-level blacklist, method-level blacklist, whitelist-only mode, whitelist precedence, malformed method names, and disabled optional service interaction.
   - Add an advanced UI warning when the user binds JSON-RPC or gRPC to `0.0.0.0` without any ACL configured.

6. **Re-expose only effective advanced settings**
   - Reintroduce `p2p.checkpoint`, deterministic identity, and RPC ACL fields in the advanced panel only after the backend implementation and tests land.
   - Add missing effective advanced fields that are already parsed but absent from the UI: `chain.jobs`, `p2p.jobs`, `p2p.seed-reconnect-interval-seconds`, `jsonrpc.jobs`, `grpc.jobs`, and selected `rocksdb.*` tuning fields.
   - Keep dangerous fields behind existing advanced/danger confirmation, especially public listen addresses, reset, core feature disabling, and checkpoint edits.
   - Keep producer identity/wallet setup in the Producer tab; do not make users edit producer keys or producer address in raw config unless Advanced producer mode is enabled.

**Implementation status - 2026-06-05:**
- Implemented renderer cleanup for Node Settings: store-specific `*.basedir`, `p2p.peer-exchange`, and producer PoB/VHP override fields are no longer visible; existing unknown/legacy keys are preserved on save.
- Added advanced diagnostics for ignored legacy keys and a public-RPC-without-ACL warning.
- Added effective advanced fields for `chain.jobs`, P2P peer-acquisition tuning, `jsonrpc.jobs`, `grpc.jobs`, and selected `rocksdb.*` tuning.
- Implemented `global.blacklist`/`global.whitelist` parsing and JSON-RPC enforcement. Whitelist mode wins when configured.
- Implemented `p2p.checkpoint` parsing and P2P handshake enforcement, including non-malicious handling for peers behind a configured checkpoint.
- Added focused renderer, config-parser, RPC policy, and P2P checkpoint tests.
- Deferred deterministic P2P identity runtime support: `p2p.identity-seed` and legacy scalar `p2p.seed` are parsed/reserved, but the GUI field remains hidden until cpp-libp2p identity key persistence is wired and tested.
- Deferred gRPC ACL enforcement pending a generated-method-to-`service.method` mapping audit; the UI warning covers public gRPC binds for now.

**Implementation status - 2026-06-09:**
- Network selection is now a first-class Teleno setting. Mainnet and testnet have separate default base dirs, local listen ports, public RPC lists, presets, and explorer source defaults.
- Presets are filtered by the selected network: mainnet users see mainnet observer/full-node/producer choices, and testnet users see testnet observer/full-node/producer choices. Applying a preset from another network switches to that network's default base dir.
- Settings has a dirty-state guard. `Save Settings` is disabled until there are changes, becomes visually prominent when changes exist, and blocks navigation out of Settings until the user saves or resets.
- The Node panel now models one monolithic node instead of a list of microservices. It shows the process, JSON-RPC, P2P, runtime preset, base dir, repository, external-process/lock conflicts, and only optional components: JSON-RPC, gRPC, block producer, contract meta store, transaction store, and account history.
- Teleno detects external native processes and RocksDB lock holders for the same `BASEDIR` before starting the node. This prevents a second node from opening the same RocksDB database and surfaces the owning PIDs in the UI.
- Wallet UI is network-aware: the native token label is `KOIN` on mainnet and `vKOIN` on testnet, and wallet/producer flows use the selected network RPC source.
- The testnet producer process used for earlier live validation was later stopped intentionally during manual operations. That changes the local machine runtime state, not the historical validation result.

**Validation gates:**
- Renderer/unit: `npm test -- src/app/koinos-config-schema.test.ts src/components/panels/MicroservicesConfigPanel.test.ts` or equivalent focused tests.
- Electron build: `npm run build:electron`.
- Renderer build: `npm run build:renderer`.
- C++ parser/P2P/RPC: build `koinos_node` plus focused config, P2P, and JSON-RPC tests through CMake/CTest.
- Config preservation: save a config containing ignored legacy keys and verify unknown keys are preserved unless the explicit cleanup action is used.
- Isolated node smoke: start a temporary non-producing node with JSON-RPC enabled and P2P disabled for ACL tests; start a second temporary node with P2P enabled and no checkpoints to prove default networking still starts.
- Mainnet/testnet safety: do not restart the live producer for this work unless explicitly requested; use temporary basedirs and high private ports.

**Exit criteria:**
- No visible Node Settings field is a silent no-op.
- Any ignored legacy key is either hidden with a diagnostic or implemented with tests.
- `p2p.seed` no longer has ambiguous meaning in the GUI.
- `p2p.checkpoint` works when configured and leaves default sync behavior unchanged when absent.
- Public RPC operators can configure whitelist/blacklist before binding to a public interface.
- The Simple operator mode shows only presets, basedir, backup/restore, and safe runtime controls; protocol and exposure controls remain behind Advanced mode.

**Sprint 6 deliverable:** Teleno with a release-ready monolith operator flow and a signed-off non-producing mainnet observer path. Mainnet block production remains a separate opt-in production decision, not an automatic release gate.

---

## Storage Finalization Addendum

The production roadmap now has an explicit storage-finalization track after the functional monolith and mainnet/testnet validation work. The current runtime is not yet the final one-database layout: `BASEDIR/db` contains the shared monolith block/index database, while the chain controller still opens a separate RocksDB database at `BASEDIR/chain/blockchain`.

**2026-06-09 status:** The restored external mainnet basedir at `/Volumes/external/teleno-monolith-restore/basedir` has been cleaned for monolith use. Obsolete legacy directories such as `block_store/`, `account_history/`, `transaction_store/`, and `contract_meta_store/` were removed after confirming the monolith uses shared RocksDB column families for those stores. The remaining required runtime state is `db/`, `chain/blockchain/`, `chain/genesis_data.json`, `jsonrpc/descriptors/`, and `config.yml`. This cleanup reduced the basedir to the current two-DB monolith layout, not the final one-DB layout.

This track must be completed before the final online backup/restore design:

1. **Unified RocksDB layout**
   - Audit all chain-state read/write paths still using `chain/blockchain`.
   - Design chain-state column families or layout markers inside `BASEDIR/db`.
   - Preserve `koinos_state_db` fork-tree, state-root, LIB, and head semantics.
   - Add safe boot-time detection for legacy/two-DB, unified, mixed, and partially migrated layouts.

2. **Offline chain-state migration**
   - Build a migration tool that copies `chain/blockchain` into the shared `db` layout.
   - Write migration manifests, checksums, source/target metadata, and layout version markers.
   - Keep the original `chain/blockchain` source untouched until verification passes.
   - Do not auto-mutate populated mainnet basedirs without explicit user confirmation.

3. **Validation gates**
   - Validate migrated restored-mainnet data by comparing head, LIB, head block ID, state merkle root, and block time.
   - Start from migrated data and apply additional blocks as an observer.
   - Run live testnet observer and producer canaries before deprecating the old layout.
   - Avoid any mutating mainnet producer validation.

4. **Online checkpoint backup**
   - Implement RocksDB checkpoint backup only after the unified layout is validated.
   - Checkpoint the node-owned shared RocksDB handle from inside `koinos_node`.
   - Archive checkpoint data with manifest, config, genesis, and descriptors.
   - Exclude wallets, secure storage, producer private keys, logs, and legacy microservice directories.

The current native backup implementation is documented in `docs/current/backup-restore/NATIVE_BACKUP_CURRENT_IMPLEMENTATION.md`.
The remaining work is tracked in `docs/backlog/backup-restore/NATIVE_BACKUP_REMAINING_WORK_PLAN.md`.

---

## Resumen de timeline

| Sprint | Duración | Objetivo |
|--------|----------|----------|
| Sprint 1 | 1-2 semanas | Nodo local con backup restore + Teleno |
| Sprint 2 | 1 semana | Block producer en testnet |
| Sprint 3 | 2-3 semanas | P2P sync con mainnet |
| Sprint 4 | 1 semana | Data migration + gRPC + legacy integration regressions |
| Sprint 5 | 2 semanas | Performance + hardening |
| Sprint 6 | 1 semana | Mainnet deployment |
| Sprint 7 | 2-4 semanas | Unified RocksDB layout + chain-state migration |
| Sprint 8 | 1-2 semanas | Online checkpoint backup + restore |
| **Total** | **11-16 semanas** | **Functional production node plus finalized storage/backup layout** |

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Build libp2p no es reproducible desde Teleno | Usuarios no pueden probar monolito local | Convertir el build temporal en flags CMake documentadas + integración en `monolithBuildDefinition()` |
| cpp-libp2p tiene bugs runtime | Sprint 3 bloqueado aunque compile | Soak tests, fallback temporal a Go P2P sidecar via IPC local |
| gorpc framing incompatible | Peers rechazan el nodo | Wire traces + fixtures binarios + test harness con Go peer + C++ peer lado a lado |
| Peer RPC responde pero payload struct difiere | Sync falla al parsear respuestas | Validar structs Go exactos: multihash, heights, `[][]byte` para blocks |
| RocksDB corruption durante migración | Pérdida de datos | Mantener Badger DB como backup hasta verificación completa |
| Chain-state migration corruption | Pérdida o divergencia de estado consensus-critical | Migración offline con manifiestos, checksums, layout markers, retención de `chain/blockchain`, validación mainnet/testnet y rollback |
| Online checkpoint inconsistente | Restore arranca con estado parcialmente aplicado | Ejecutar checkpoint solo tras layout unificado, con guard de writes y restore smoke opcional |
| Xcode/toolchain incompatibilidad | Build roto | Usar CI con Xcode estable (16/17), no beta |
| Memory leaks en operación prolongada | Crash después de horas/días | ASAN/TSAN durante desarrollo, 48h soak tests |
| Performance no alcanza targets | Justificación del proyecto débil | Profile hot paths con `perf`/Instruments, optimizar bottlenecks |
