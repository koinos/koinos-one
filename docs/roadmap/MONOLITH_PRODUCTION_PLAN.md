# Monolithic Node — Production Roadmap

Plan secuencial para llevar el monolito desde su estado actual (compila y arranca localmente) hasta un nodo funcional en mainnet.

## Estado actual

- Binario arm64 que compila, arranca, inicializa chain con genesis, sirve JSON-RPC
- 7 servicios internalizados, 6 column families RocksDB, 21 métodos JSON-RPC
- P2P C++ compila y enlaza con `cpp-libp2p` usando `-DKOINOS_ENABLE_LIBP2P=ON`
- Peer RPC usa el framing real de `go-libp2p-gorpc` (MessagePack) y pasa fixtures offline generados desde Go; falta interop live contra un Go peer y sync contra peers reales
- Block producer loop implementado con carga de private key; falta validar bloque producido contra chain/testnet
- Mempool acepta `chain.submit_transaction`; faltan recursos reales, expiración y producción end-to-end

---

## Ruta crítica actual

Este es el orden de trabajo que minimiza riesgo técnico antes de invertir tiempo en UX, packaging o optimización.

| Gate | Objetivo | Criterio de salida |
|------|----------|--------------------|
| A. Build reproducible | `koinos_node` se puede compilar con libp2p desde una workspace limpia | Script o documentación exacta produce el binario y `koinos_node --help` pasa |
| B. Peer RPC wire compatibility | El framing gorpc C++ coincide con Go byte-for-byte | Fixtures capturados desde Go pasan en tests C++ y un Go peer acepta llamadas C++ |
| C. One-peer sync | El monolito conecta a un peer y aplica bloques por RPC | `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, `GetBlocks` funcionan contra Go |
| D. Gossip interop | Bloques y transacciones cruzan entre Go y C++ | Mensajes en `koinos.blocks` y `koinos.transactions` se reciben y se validan |
| E. Knodel local mode | Knodel arranca el monolito como reemplazo del stack multi-servicio | UI muestra health/logs y JSON-RPC funciona contra el proceso monolítico |
| F. Mainnet soak | El nodo permanece estable sincronizado | 48h con peers reales sin leaks, forks falsos, deadlocks ni drift de head |

La prioridad inmediata sigue siendo cerrar Gate B con interop live. La parte offline ya valida bytes contra fixtures Go; falta probar un peer Go real aceptando llamadas C++ antes de avanzar a sync completo.

---

## Sprint 1: Nodo local funcional (1-2 semanas)

**Objetivo:** Un nodo que restaura un backup y sirve queries correctamente.

### 1.1 Backup restore flow
- [ ] Adaptar `migrate_block_store.sh` para copiar bloques desde un backup `.tar.gz` al layout del monolito
- [x] Verificar que el chain indexer sincroniza correctamente desde block_store después de un restore
- [ ] Probar: restaurar backup → arrancar monolito → `chain.get_head_info` devuelve height correcto (needs real backup data)

### 1.2 Validar JSON-RPC contra nodo Go
- [ ] Arrancar un nodo multi-servicio con los mismos datos
- [ ] Comparar respuestas de los 21 métodos JSON-RPC entre monolito y nodo Go
- [ ] Documentar diferencias (si las hay) en el encoding protobuf→JSON

### 1.3 Mempool end-to-end
- [x] `chain.submit_transaction` → mempool acepta → verificar con `mempool.get_pending_transactions`
- [ ] Verificar `check_pending_account_resources` con cuentas reales
- [ ] Verificar expiración de transacciones (120s)

### 1.4 Knodel integración local
- [ ] Mover el build temporal desde `/private/tmp/koinos-node-libp2p-build` a la ruta esperada por Knodel: `vendor/koinos/koinos-node/build/koinos_node`
- [ ] Actualizar `monolithBuildDefinition()` para pasar las flags CMake requeridas por cpp-libp2p (`KOINOS_ENABLE_LIBP2P`, prelude, shims, prefixes)
- [ ] Verificar que `resolveMonolithBinaryPath()` encuentra el binario en dev y en packaged app
- [ ] Verificar que Knodel detecta el monolito y lo arranca en vez de los 12 servicios
- [ ] Verificar que start/stop/restart usan un solo proceso `koinos-node` y no dejan procesos legacy vivos
- [ ] Verificar que el panel Node Components muestra health de los componentes derivados del log o de endpoint de health
- [ ] Verificar logs con filtrado por `[component]` para `chain`, `mempool`, `block_store`, `p2p`, `jsonrpc`, `grpc`, `block_producer`
- [ ] Validar presets: cambios de feature flags escriben config y reinician el monolito
- [ ] Definir fallback UX: si el binario monolítico falta o falla al arrancar, Knodel muestra causa y permite volver al modo multi-servicio

**Entregables 1.4:**
- Build local reproducible desde Knodel
- Start/stop/status monolítico funcionando por IPC
- Capturas o logs que prueben detección de componentes y filtrado por logs

**Entregable Sprint 1:** Nodo local que restaura backup, sirve queries, y Knodel lo gestiona.

---

## Sprint 2: Block producer (1 semana)

**Objetivo:** El monolito produce bloques en testnet.

### 2.1 Private key loading
- [x] Leer `block_producer.private-key-file` del config.yml
- [x] Cargar Ed25519 key y pasarla al controller vía `propose_block_request`
- [ ] Verificar que `propose_block()` genera un bloque válido

### 2.2 Producer address config
- [x] Leer `block_producer.producer` (address) del config.yml
- [ ] Integrar con el wallet de Knodel (producer profile)

### 2.3 Production loop tuning
- [x] Ajustar intervalo de producción (actualmente 3s fijo → debería usar consensus timing)
- [ ] Verificar que los bloques producidos son aceptados por el propio chain
- [ ] Verificar broadcast via EventBus → block_store + contract_meta + tx_store

### 2.4 Testnet validation
- [ ] Desplegar en testnet con VHP staked
- [ ] Producir bloques y verificar que otros nodos los aceptan
- [ ] Monitorizar durante 24h: uptime, bloques producidos, errores

**Entregable Sprint 2:** Monolito produciendo bloques en testnet con Knodel.

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
- [ ] Capturar tráfico de un nodo Go con un peer Go controlado y guardar `.pcap` + frames decodificados
- [x] Extraer frames gorpc: header `ServiceID`, nombre de servicio, método, payload, respuesta y error
- [x] Convertir los helpers privados de `libp2p_transport.cpp` en una unidad testeable (`p2p/gorpc_codec.*`)
- [x] Validar que el encoder C++ genera bytes idénticos a Go para requests vacíos y requests con payload
- [x] Validar que el decoder C++ interpreta respuestas Go con éxito y respuestas con error
- [x] Conectar `peer_get_chain_id`, `peer_get_head_block`, `peer_get_ancestor_block_id` y `peer_get_blocks` al codec MessagePack
- [ ] Probar interop live: Go peer responde a llamadas C++ para los 4 métodos
- [ ] Si hay discrepancias, ajustar el framing antes de tocar sync

**Entregables 3.2:**
- Fixtures binarios versionados en el test C++ para cada método Peer RPC
- Test C++ `koinos_gorpc_codec_test` de encode/decode que falla ante cualquier cambio de bytes
- Log de interop Go↔C++ con peer ID, protocolo, método, tamaño de request, tamaño de response
- Decisión documentada: el framing vive fuera de `Libp2pTransport`, en `p2p/gorpc_codec.*`

### 3.3 Handshake + sync
- [ ] Replicar handshake Go en orden: local `GetChainID` → remote `GetChainID` → remote `GetHeadBlock` → checkpoints via `GetAncestorBlockID`
- [ ] Mapear errores Go a scoring C++: `chain_id_mismatch`, `checkpoint_mismatch`, `chain_not_connected`, `peer_rpc_timeout`
- [ ] Validar timeouts: local RPC 6s, remote RPC 6s, block request timeout proporcional al batch
- [ ] Conectar a un seed peer de mainnet con base dir temporal y gossip deshabilitado al inicio
- [ ] Completar chain ID verification contra un peer Go conocido
- [ ] Pedir `GetHeadBlock` y comprobar que height/head no son cero
- [ ] Pedir `GetAncestorBlockID(peer_head, local_lib_height)` y confirmar continuidad de chain
- [ ] Batch fetch 500 bloques con `GetBlocks(head, lib+1, 500)`
- [ ] Aplicar bloques secuencialmente y confirmar que block_store, chain, contract_meta, tx_store y account_history reciben eventos
- [ ] Verificar que el indexer progresa correctamente después de reiniciar el proceso
- [ ] Medir velocidad de sync: blocks/sec, RPC latency p50/p95, apply latency p50/p95, error score por peer

**Entregables 3.3:**
- Script de smoke test `one-peer-sync` o procedimiento documentado reproducible
- Log con primer handshake exitoso C++↔Go
- Métricas de un batch de 500 bloques y resultado de re-arranque

### 3.4 GossipSub
- [ ] Confirmar nombres exactos de topics Go para bloques y transacciones antes de publicar
- [ ] Verificar que bloques llegan via gossip (`koinos.blocks` topic) y se deserializan como `protocol::block`
- [ ] Verificar que transacciones llegan via gossip (`koinos.transactions` topic) y se deserializan como `protocol::transaction`
- [ ] Verificar deduplicación: el mismo block/tx recibido por RPC y gossip no se aplica dos veces
- [ ] Verificar gossip toggle: se activa cuando head < 45s de wall clock y no publica mientras el nodo está atrasado
- [ ] Probar C++ publica bloque/tx y Go peer lo recibe
- [ ] Probar Go publica bloque/tx y C++ lo recibe

**Entregables 3.4:**
- Interop log de publish/receive en ambos sentidos
- Conteo de mensajes aceptados/rechazados por validator
- Lista de errores de deserialización con peer ID y topic

### 3.5 Stability
- [ ] Correr 2h con 1 peer Go controlado y ASAN/TSAN cuando sea viable
- [ ] Correr 12h con 5-10 peers reales, sin block production
- [ ] Correr 48h con 20+ peers conectados
- [ ] Monitorizar: RSS, heap growth, open file descriptors, peer count, RPC timeouts, connection drops, error scoring
- [ ] Verificar que fork watchdog detecta fork bombs correctamente y no dispara en sync normal
- [ ] Verificar reconnect a seed peers después de disconnects y network blips
- [ ] Verificar shutdown limpio: SIGTERM cierra libp2p, RocksDB y threads sin colgar
- [ ] Documentar umbrales de alerta para Knodel: peer count bajo, sync estancado, RPC timeout rate, memory growth

**Entregables 3.5:**
- Reporte de soak test con timestamp, commit, build flags, peers, RSS inicial/final
- Lista de issues bloqueantes antes de mainnet canary
- Config recomendada para peers, batch size y timeouts

**Entregable Sprint 3:** Monolito sincronizado con mainnet via P2P.

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
