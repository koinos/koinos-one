# Monolithic Node — Production Roadmap

Plan secuencial para llevar el monolito desde su estado actual (compila y arranca localmente) hasta un nodo funcional en mainnet.

## Estado actual

- Binario de 18MB arm64 que compila, arranca, inicializa chain con genesis, sirve JSON-RPC
- 7 servicios internalizados, 6 column families RocksDB, 21 métodos JSON-RPC
- P2P lógica completa pero transport layer (cpp-libp2p) no compilado aún
- Block producer loop implementado pero sin carga de private key
- Mempool wired pero no validado end-to-end

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
- [ ] Copiar el binario compilado a la ruta que Knodel espera (`resolveMonolithBinaryPath()`)
- [ ] Verificar que Knodel detecta el monolito y lo arranca en vez de los 12 servicios
- [ ] Verificar que el panel Node Components muestra health de los componentes
- [ ] Verificar logs con filtrado por `[component]`

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
- [ ] Resolver build con `-DKOINOS_ENABLE_LIBP2P=ON` (puede requerir ajustar deps de cpp-libp2p)
- [ ] Si cpp-libp2p da problemas, evaluar alternativa: mantener Go P2P como proceso separado con thin bridge
- [ ] Verificar que el binario con libp2p arranca sin crash

### 3.2 gorpc wire compatibility
- [ ] Capturar tráfico de red de un nodo Go con tcpdump/Wireshark
- [ ] Extraer frames gorpc (varint + service + method + payload)
- [ ] Validar que `encode_rpc_request()` y `decode_rpc_response()` producen bytes idénticos
- [ ] Si hay discrepancias, ajustar el framing

### 3.3 Handshake + sync
- [ ] Conectar a un seed peer de mainnet
- [ ] Completar handshake (chain ID verification)
- [ ] Batch fetch 500 bloques y aplicarlos
- [ ] Verificar que el indexer progresa correctamente
- [ ] Medir velocidad de sync (blocks/sec)

### 3.4 GossipSub
- [ ] Verificar que bloques llegan via gossip (`koinos.blocks` topic)
- [ ] Verificar que transacciones llegan via gossip (`koinos.transactions` topic)
- [ ] Verificar gossip toggle: se activa cuando head < 45s de wall clock

### 3.5 Stability
- [ ] Correr el nodo 48h con 20+ peers conectados
- [ ] Monitorizar: memory leaks, connection drops, error scoring
- [ ] Verificar que fork watchdog detecta fork bombs correctamente
- [ ] Verificar reconnect a seed peers después de disconnects

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
| cpp-libp2p no compila o tiene bugs | Sprint 3 bloqueado | Fallback: mantener Go P2P como proceso externo, comunica con monolito via IPC local |
| gorpc framing incompatible | Peers rechazan el nodo | Wire traces + test harness con Go peer + C++ peer lado a lado |
| RocksDB corruption durante migración | Pérdida de datos | Mantener Badger DB como backup hasta verificación completa |
| Xcode/toolchain incompatibilidad | Build roto | Usar CI con Xcode estable (16/17), no beta |
| Memory leaks en operación prolongada | Crash después de horas/días | ASAN/TSAN durante desarrollo, 48h soak tests |
| Performance no alcanza targets | Justificación del proyecto débil | Profile hot paths con `perf`/Instruments, optimizar bottlenecks |
