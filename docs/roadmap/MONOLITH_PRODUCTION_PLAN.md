# Monolithic Node — Production Roadmap

Sequential plan to take the monolith from its current state (builds and starts locally) to a functional mainnet node.

## Current Status

- arm64 binary builds, starts, initializes chain from genesis, and serves JSON-RPC.
- 7 services are internalized, with 6 RocksDB column families and 21 JSON-RPC methods.
- C++ P2P builds and links with `cpp-libp2p` using `-DKOINOS_ENABLE_LIBP2P=ON`.
- Peer RPC uses the real `go-libp2p-gorpc` MessagePack framing, passes offline fixtures generated from Go, passes live interop against a controlled Go peer, and controlled one-peer sync applies blocks by RPC. GossipSub crosses blocks/transactions in both directions against a controlled Go peer. Knodel local mode no longer forces `p2p` off. The 48h soak against real peers is still pending.
- Block producer backend is implemented: it loads WIF keys, assembles resource-bounded blocks, signs `federated` and PoB blocks, prunes failed transactions, gates production on gossip readiness, and submits populated `propose_block_request` messages. Local build and unit validation pass. Private three-node federated validation passes with observer P2P sync and store health checks. Private three-node PoB validation also passes with a deterministic generated genesis that includes system-contract bytecode, system-call dispatch, name-service records, producer hot-key registration, KOIN/RC, VHP, and VHP burn allowance. A 30-minute private PoB soak passed with continuous producer/observer progress and no severe log matches. Isolated seed-host external validation passed on `seed.koinosfoundation.org` without touching the production Docker stack: the branch was built on `/mnt/HC_Volume_105581636`, then a three-node private PoB soak ran for `300s` on high localhost ports with final producer head `8736`, observer head `8384`, observer block-store height `8384`, `0` stalled samples, and clean shutdown. Shared/external testnet validation tooling remains available in `scripts/external-pob-testnet-signoff.sh` for future independently reachable producer/observer RPC endpoints.
- Sprint 1.3 mempool end-to-end is implemented and locally verified: `chain.submit_transaction` has the in-process mempool RPCs it depends on, accepted transactions are inserted into the real mempool implementation through the monolith event bus, account RC/nonce/count checks are covered, and the 120s expiration boundary is tested.

---

## Current Critical Path

This is the work order that minimizes technical risk before investing further in UX, packaging, or optimization.

| Gate | Objective | Exit Criteria |
|------|----------|--------------------|
| A. Reproducible build | `koinos_node` can be built with libp2p from a clean workspace | Exact script or documentation produces the binary and `koinos_node --help` passes |
| B. Peer RPC wire compatibility | C++ gorpc framing matches Go byte-for-byte | Go-captured fixtures pass in C++ tests and a Go peer accepts C++ calls |
| C. One-peer sync | The monolith connects to one peer and applies blocks by RPC | `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, and `GetBlocks` work against Go |
| D. Gossip interop | Blocks and transactions cross between Go and C++ | Messages on `koinos.blocks` and `koinos.transactions` are received and validated |
| E. Knodel local mode | Knodel starts the monolith as the multi-service stack replacement | Complete: UI shows health/logs, JSON-RPC works, and `p2p` is no longer disabled by default |
| F. Mainnet soak | The node remains stable while synchronized | In progress: stale peer ID fixed and reconnect path hardened; still needs a stable peer window for a production-duration soak |

Gate F has a harness and short preflight path. The 5h production-style attempt on 2026-05-24 was aborted as invalid because the node remained at `0` peers and height `0`; the primary cause was a stale peer ID for `seed.koinosfoundation.org`. The seed now responds as `QmTCgDNrPDYVNmZNt58jixgtVjTveSpWsEbqPqGuEzZhWF`; with that ID, cpp-libp2p connected, completed handshake, and applied `500` blocks in a `90s` preflight. `scripts/probe-mainnet-seeds.sh` validates Go libp2p handshakes before long soaks, and the soak aborts by default if it does not observe required progress within the startup grace window. The harness now also requires head progress by default, so a raw libp2p socket without Koinos Peer RPC sync cannot be counted as Gate F progress.

The latest Gate F hardening focuses on matching legacy p2p behavior and avoiding local false failures: cpp-libp2p now advertises `koinos/p2p/1.0.0`, libp2p callbacks run on one IO runner, seed dialing is paced from `P2PNode` instead of fired as an async burst, duplicate in-flight dials are suppressed, incoming Peer RPC is served from local `chain`/`block_store`, EOF/reset closes stale peers without escalating into score-threshold disconnects, sync application is serialized, and already-irreversible local races are not scored as peer misconduct. The candidate peer file now prioritizes the legacy `config-example` seeds and keeps production-log peers as fallbacks.

Latest validation after those fixes proved build/test health and showed that this machine currently has no reachable Peer RPC-capable public target: a Go libp2p probe failed against all five official legacy seeds during security negotiation/timeout/refused, and the only raw libp2p peers that accepted dials advertised `protocol_version=unknown` and rejected `/koinos/peerrpc/1.0.0`. The probe now enforces this distinction by default: `OK` requires `PeerRPCService.GetChainID` and `PeerRPCService.GetHeadBlock`, and `SEED_PROBE_OUTPUT=scripts/mainnet-peer-validated.txt` writes only peers that passed that stricter validation. The current next critical step is therefore to repeat Gate F in a fresh peer window: first get a successful Go probe against a peer that serves Koinos Peer RPC, then require the C++ soak to complete Koinos handshake and advance beyond height `1000`. If Go succeeds while C++ fails, inspect cpp-libp2p security negotiation and Identify/client-version behavior.

---

## Sprint 1: Functional Local Node (1-2 weeks)

**Objective:** A node that restores a backup and serves queries correctly.

### 1.1 Backup restore flow
- [x] Adaptar flujo de restore para leer un backup `.tar.gz` legacy, extraerlo en un `basedir` externo y convertir `block_store/db` Badger a RocksDB monolítico
- [x] Verificar que el chain indexer sincroniza correctamente desde block_store después de un restore
- [x] Probar: restaurar backup → arrancar monolito → `chain.get_head_info` devuelve height correcto con datos reales

**Nota 2026-05-24:** Restore real completado en `/Volumes/external/knodel-monolith-restore` usando `https://seed.koinosfoundation.org/backups/koinos-backup.tar.gz`. El backup es legacy: `chain/blockchain` se reutiliza, pero `block_store/db` debe transformarse desde Badger al RocksDB del monolito en `basedir/db`. Resultado de conversión: `records=40278912 blocks=40278911 meta=1 bytes=83883179053`; el monolito abrió 6 column families y `chain.get_head_info` respondió con datos restaurados. La observación inicial donde el indexer se quedaba 60 bloques detrás quedó corregida en Sprint 1.2 capando el último batch al número de bloques restantes.

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

### 1.4 Knodel integración local
- [x] Mover el build temporal desde `/private/tmp/koinos-node-libp2p-build` a la ruta esperada por Knodel: `vendor/koinos/koinos-node/build/koinos_node`
- [x] Actualizar `monolithBuildDefinition()` para pasar las flags CMake requeridas por cpp-libp2p (`KOINOS_ENABLE_LIBP2P`, prelude, shims, prefixes)
- [x] Verificar que `resolveMonolithBinaryPath()` encuentra el binario en dev y en packaged app (`release/mac-arm64/Knodel.app` resuelve `Contents/Resources/koinos/bin/koinos_node`; smoke packaged start/RPC/stop OK)
- [x] Verificar que Knodel detecta el monolito y lo arranca en vez de los 12 servicios (Electron renderer/preload/main bridge verificado con `serviceStart` y `p2p` deshabilitado)
- [x] Verificar que start/stop/restart usan un solo proceso `koinos-node` y no dejan procesos legacy vivos (Electron bridge `serviceStart`/`serviceStop`/`serviceRestart`; `chain.get_head_info` responde; sin procesos legacy tras stop)
- [x] Verificar que el panel Node Components muestra health de los componentes derivados del log o de endpoint de health (parser acepta el formato real con timestamp antes de `[component]`)
- [x] Verificar logs con filtrado por `[component]` para `chain`, `mempool`, `block_store`, `p2p`, `jsonrpc`, `grpc`, `block_producer` (targets de logs monolíticos resueltos desde `status.components`; smoke verificado con `jsonrpc`)
- [x] Validar presets: cambios de feature flags escriben config y reinician el monolito (smoke `profile:jsonrpc`: escribe `features`, arranca `koinos_node`, responde JSON-RPC; `p2p` queda habilitado por defecto salvo override explícito)
- [x] Definir fallback UX: si el binario monolítico falta o falla al arrancar, Knodel muestra causa y permite volver al modo multi-servicio (startup failure activa fallback de sesion; status/presets/actions pasan a native multi-service; rebuild monolitico exitoso limpia el fallback)

**Nota 2026-05-23:** Gate E queda implementado: Knodel ya no añade `--disable=p2p` por defecto, los presets monolíticos mantienen `p2p=true` salvo override explícito y `scripts/smoke-monolith-p2p-local.sh` valida arranque local con `p2p` + `jsonrpc`. Smoke Electron dev previo: `serviceStart`/`serviceStop`/`serviceRestart` desde el renderer usan un solo `koinos_node` y dejan `nativePid=null` al parar. El health de componentes se deriva de líneas reales con timestamp y el endpoint de logs acepta componentes como `jsonrpc`/`p2p` filtrando el buffer monolítico. Si el monolito existe pero falla al arrancar, Knodel devuelve la causa como error visible y activa fallback de sesión a native multi-service; un rebuild monolítico exitoso limpia ese estado.

**Entregables 1.4:**
- Build local reproducible desde Knodel
- Start/stop/status monolítico funcionando por IPC
- Capturas o logs que prueben detección de componentes y filtrado por logs

**Entregable Sprint 1:** Nodo local que restaura backup, sirve queries, y Knodel lo gestiona.

---

## Sprint 2: Block Producer (1 week)

**Objective:** The monolith can produce blocks on testnet.

### 2.1 Private key loading
- [x] Read `block_producer.private-key-file` from `config.yml`, defaulting to `BASEDIR/block_producer/private.key`.
- [x] Load the WIF Ed25519 key, write `BASEDIR/block_producer/public.key`, and sign locally assembled blocks.
- [x] Verify that the producer submits a populated `propose_block_request` and receives an accepted receipt in focused C++ tests.

### 2.2 Producer address config
- [x] Read `block_producer.producer` from `config.yml` for PoB producer identity.
- [x] Keep compatibility with the existing Knodel producer profile/runtime config flow, which persists `block_producer.producer` and `block_producer.private-key-file`.

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
- [ ] Deploy on testnet with a VHP-staked producer.
- [ ] Produce blocks and verify that other nodes accept them.
- [ ] Monitor for 24h: uptime, produced blocks, rejected proposals, peer count, and errors.

**2026-05-24 status:** Backend implementation is complete and locally verified. Phase A private validation passes through `scripts/private-testnet-sprint2.sh`: the monolith producer creates a federated block, the observer syncs that block from the producer over P2P, and observer block store, transaction store, and contract meta store checks pass. Phase B private PoB validation also passes through the same harness with `PRIVATE_TESTNET_MODE=pob`: the generated runtime genesis is statically PoB-ready, the producer creates PoB blocks, the observer syncs them over P2P, and service health checks pass. The 30-minute private PoB soak also passes: 31 samples, zero stalled samples, zero severe log matches, final producer head `74362`, final observer head `73842`, and final observer block-store height `73842`. External seed-host validation also passes: commit `ec1d737` was pulled into `/mnt/HC_Volume_105581636/knodel-external-signoff/knodel` on `seed.koinosfoundation.org`, `scripts/build-cpp-libp2p-koinos.sh` produced the cpp-libp2p-enabled monolith there, and `scripts/private-testnet-sprint2.sh` ran a `300s` private PoB soak on high localhost ports with final producer head `8736`, observer head `8384`, observer block-store height `8384`, zero stalled samples, zero severe log matches, transaction/contract-meta checks `ok`, and clean shutdown. The production stack was not touched. `scripts/external-pob-testnet-signoff.sh` remains available for a future shared/external validation step against independently reachable producer and observer RPC endpoints.

Private-testnet signoff plan: `docs/roadmap/MONOLITH_PRIVATE_TESTNET_PLAN.md`.
Latest private-testnet report: `docs/roadmap/MONOLITH_PRIVATE_TESTNET_REPORT.md`.
Latest external-testnet report: `docs/roadmap/MONOLITH_EXTERNAL_TESTNET_REPORT.md`.

**Sprint 2 Deliverable:** Monolith producing blocks on testnet with Knodel.

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
- Test live `koinos_libp2p_peer_rpc_live_test` contra fixture Go (`cmd/peer-rpc-fixture`) que valida `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID` y `GetBlocks`
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
- Fixture Go `cmd/gossip-fixture` que publica bloque/transacción y confirma recepción de mensajes C++
- Live test `koinos_libp2p_gossip_live_test` confirms receiving Go messages from C++.
- Bidirectional publish/receive interop log: the fixture prints `fixture received cpp transaction`, `fixture received cpp block`, and `gossip fixture interop ok`.
- Deserialization errors with peer ID and topic are covered by `Libp2pTransport::on_gossip_message` and `P2PNode` scoring.

### 3.5 Stability
- [x] Add reproducible soak harness: `scripts/soak-mainnet-p2p.sh` generates `docs/roadmap/MONOLITH_GATE_F_SOAK_REPORT.md`
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
- [ ] Run 2h with 1 controlled Go peer and ASAN/TSAN when viable
- [ ] Run 12h with 5-10 real peers, without block production
- [ ] Run 48h with 20+ connected peers
- [ ] Monitor RSS, heap growth, open file descriptors, peer count, RPC timeouts, connection drops, and error scoring
- [ ] Verify fork watchdog detects fork bombs correctly and does not trigger during normal sync
- [ ] Verify reconnect to seed peers after disconnects and network blips
- [ ] Verify clean shutdown: SIGTERM closes libp2p, RocksDB, and threads without hanging
- [ ] Document Knodel alert thresholds: low peer count, stalled sync, RPC timeout rate, memory growth

**3.5 Deliverables:**
- Soak test report with timestamp, commit, build flags, peers, initial/final RSS
- List of blocking issues before mainnet canary
- Recommended config for peers, batch size, and timeouts

**Sprint 3 Deliverable:** Monolith synchronized with mainnet via P2P.

---

## Sprint 4: Data migration + gRPC (1 semana)

**Objetivo:** Usuarios existentes pueden migrar sin re-sync completo.

### 4.1 Badger → RocksDB migration tool
- [ ] Crear utilidad Go que lee `block_store/db/` (Badger) y escribe en RocksDB
- [ ] Preservar skip-list pointers durante la migración
- [ ] Verificar integridad con checksums (SHA-256 de cada bloque)
- [ ] Medir tiempo de migración (~350GB block_store)

### 4.2 Chain state_db migration
- [ ] Verificar que el chain state_db (ya RocksDB) se puede reusar directamente
- [ ] Mapear paths: `chain/blockchain/` → monolith puede leerlo in-place
- [ ] Documentar el proceso completo de migración

### 4.3 gRPC client compatibility
- [ ] Testear con `koinos-cli` y `koinosctl`
- [ ] Verificar que AsyncGenericService maneja correctamente el protobuf envelope routing
- [ ] Testear error propagation (service unavailable, invalid request)

**Entregable Sprint 4:** Herramienta de migración funcional, gRPC validado.

---

## Sprint 5: Performance + hardening (2 semanas)

**Objetivo:** El monolito es más rápido que el multi-servicio y está listo para mainnet.

### 5.1 Benchmarks
- [ ] Indexing speed: medir blocks/sec durante sync (target: 10,000-15,000 vs 3,600)
- [ ] JSON-RPC latency: `wrk` benchmark de `get_head_info` (target: <0.2ms vs 2-5ms)
- [ ] Transaction submission: round-trip time (target: <2ms vs 5-15ms)
- [ ] Memory usage: RSS during operation (target: <400MB vs 500-800MB)
- [ ] Startup time: spawn to JSON-RPC responsive (target: <5s vs 10-30s)

### 5.2 RocksDB tuning
- [ ] `blocks` CF: Large block sizes (64KB), zstd compression, bloom filters
- [ ] `default` (chain state): Small blocks (4KB), point lookup optimization
- [ ] Configurar block cache compartido entre CFs
- [ ] Tunear compaction thread pool

### 5.3 Thread pool optimization
- [ ] Medir contención entre chain_ioc, jsonrpc threads, P2P threads
- [ ] Ajustar número de threads por componente basado en CPU usage
- [ ] Verificar que no hay deadlocks bajo carga

### 5.4 Error handling hardening
- [ ] Revisar todos los `catch(...)` — asegurar que no se tragan errores silenciosamente
- [ ] Añadir graceful degradation: si un componente falla, los demás siguen
- [ ] Verificar que SIGTERM siempre produce shutdown limpio bajo carga

### 5.5 Logging
- [ ] Verificar que todos los componentes usan el prefijo `[component]` consistentemente
- [ ] Añadir métricas periódicas: blocks/sec, pending txs, peer count, memory
- [ ] Verificar que el log rotation funciona (512KB buffer en Knodel)

**Entregable Sprint 5:** Benchmarks documentados, RocksDB tuneado, nodo hardened.

---

## Sprint 6: Mainnet deployment (1 semana)

**Objetivo:** Desplegar en mainnet con producción de bloques real.

### 6.1 Mainnet canary
- [ ] Desplegar monolito en un servidor de producción (sin producir bloques)
- [ ] Sync completo desde peers
- [ ] Comparar head height con un nodo multi-servicio en paralelo
- [ ] Monitorizar 48h: stability, memory, CPU

### 6.2 Mainnet producer
- [ ] Activar block_producer en el monolito
- [ ] Verificar que produce bloques aceptados por la red
- [ ] Monitorizar 48h: bloques producidos, share %, errores

### 6.3 Knodel release
- [ ] Empaquetar binario en electron-builder (DMG para macOS)
- [ ] Actualizar UI para mostrar "Monolith mode" vs "Multi-service mode"
- [ ] Documentar el proceso de migración para usuarios finales
- [ ] Release como Knodel v0.11.0

**Entregable Sprint 6:** Knodel con monolito en producción en mainnet.

---

## Resumen de timeline

| Sprint | Duración | Objetivo |
|--------|----------|----------|
| Sprint 1 | 1-2 semanas | Nodo local con backup restore + Knodel |
| Sprint 2 | 1 semana | Block producer en testnet |
| Sprint 3 | 2-3 semanas | P2P sync con mainnet |
| Sprint 4 | 1 semana | Data migration + gRPC |
| Sprint 5 | 2 semanas | Performance + hardening |
| Sprint 6 | 1 semana | Mainnet deployment |
| **Total** | **8-10 semanas** | **Producción completa** |

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Build libp2p no es reproducible desde Knodel | Usuarios no pueden probar monolito local | Convertir el build temporal en flags CMake documentadas + integración en `monolithBuildDefinition()` |
| cpp-libp2p tiene bugs runtime | Sprint 3 bloqueado aunque compile | Soak tests, fallback temporal a Go P2P sidecar via IPC local |
| gorpc framing incompatible | Peers rechazan el nodo | Wire traces + fixtures binarios + test harness con Go peer + C++ peer lado a lado |
| Peer RPC responde pero payload struct difiere | Sync falla al parsear respuestas | Validar structs Go exactos: multihash, heights, `[][]byte` para blocks |
| RocksDB corruption durante migración | Pérdida de datos | Mantener Badger DB como backup hasta verificación completa |
| Xcode/toolchain incompatibilidad | Build roto | Usar CI con Xcode estable (16/17), no beta |
| Memory leaks en operación prolongada | Crash después de horas/días | ASAN/TSAN durante desarrollo, 48h soak tests |
| Performance no alcanza targets | Justificación del proyecto débil | Profile hot paths con `perf`/Instruments, optimizar bottlenecks |
