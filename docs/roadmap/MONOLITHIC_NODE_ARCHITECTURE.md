# Monolithic Node Architecture — Implementation Plan

## Table of Contents

1. [Motivation and Goals](#1-motivation-and-goals)
2. [Current vs Target Architecture](#2-current-vs-target-architecture)
3. [Internal Communication: Replacing AMQP](#3-internal-communication-replacing-amqp)
4. [Threading Model](#4-threading-model)
5. [Go-to-C++ Rewrites](#5-go-to-c-rewrites)
6. [Database Consolidation](#6-database-consolidation)
7. [Build System](#7-build-system)
8. [Configuration Changes](#8-configuration-changes)
9. [Network Compatibility](#9-network-compatibility)
10. [Knodel Integration: Process Management](#10-knodel-integration-process-management)
11. [Knodel Integration: Build System](#11-knodel-integration-build-system)
12. [Knodel Integration: Types and IPC](#12-knodel-integration-types-and-ipc)
13. [Knodel Integration: UI Changes](#13-knodel-integration-ui-changes)
14. [Knodel Integration: Config and Profiles](#14-knodel-integration-config-and-profiles)
15. [Knodel Integration: Log Streaming](#15-knodel-integration-log-streaming)
16. [Implementation Phases](#16-implementation-phases)
17. [Risk Assessment](#17-risk-assessment)
18. [Performance Targets](#18-performance-targets)
19. [File-Level Change Map](#19-file-level-change-map)

---

## 1. Motivation and Goals

### The Problem: AMQP Overhead

Every inter-service RPC call currently traverses this path:

```
Caller → serialize protobuf → AMQP publish → TCP loopback → GarageMQ route →
TCP loopback → AMQP consume → deserialize protobuf → Handler →
serialize response → AMQP publish → TCP loopback → GarageMQ route →
TCP loopback → AMQP consume → deserialize response → Caller
```

**Overhead per RPC round-trip: ~250-600μs.** During block indexing, the chain makes thousands of RPC calls to block_store per second. The AMQP overhead becomes the bottleneck.

### Goals

1. **Eliminate AMQP overhead** — replace serialization + message routing with direct C++ function calls (~0.01-0.1μs)
2. **Single binary deployment** — one executable instead of 12 processes + AMQP broker
3. **Reduced memory** — shared address space, single RocksDB instance, no broker process
4. **Faster startup** — no sequential service startup, no AMQP broker wait
5. **Simplified operations** — one process to monitor, one log stream, one config

### Non-Goals

- Changing the blockchain protocol or consensus
- Breaking network compatibility with existing Koinos nodes
- Rewriting the WASM VM (Fizzy stays)
- Changing the wallet or Knodel UI paradigm

---

## 2. Current vs Target Architecture

### Current: 12 Processes + AMQP Broker

```
┌─────────────────────────────────────────────────────────────┐
│  Knodel (Electron)                                          │
│  spawns 12 processes, monitors each via TCP port probing    │
└─────────┬───────────────────────────────────────────────────┘
          │ spawn()
          ▼
┌──────────┐  ┌───────┐  ┌─────────┐  ┌─────────────┐  ┌─────┐
│ GarageMQ │  │ chain │  │ mempool │  │ block_store │  │ p2p │  ...7 more
│ (AMQP)   │  │ (C++) │  │ (C++)   │  │ (Go/Badger) │  │(Go) │
└────┬─────┘  └───┬───┘  └────┬────┘  └──────┬──────┘  └──┬──┘
     │            │           │               │            │
     └────────────┴───────────┴───────────────┴────────────┘
                    AMQP 0.9.1 (localhost:5672)
```

**Services by language:**
| Language | Services |
|----------|----------|
| C++ | chain, mempool, block_producer, grpc, account_history |
| Go | block_store, p2p, jsonrpc, transaction_store, contract_meta_store |
| Go (broker) | GarageMQ (AMQP broker) |
| Node.js | rest (optional, wraps jsonrpc) |

### Target: Single C++ Binary

```
┌─────────────────────────────────────────────────────────────┐
│  Knodel (Electron)                                          │
│  spawns 1 process, monitors via health endpoint             │
└─────────┬───────────────────────────────────────────────────┘
          │ spawn()
          ▼
┌─────────────────────────────────────────────────────────────┐
│  koinos_node (single C++ binary)                            │
│                                                             │
│  ┌───────┐ ┌─────────┐ ┌─────────────┐ ┌─────┐            │
│  │ chain │ │ mempool │ │ block_store │ │ p2p │  ...        │
│  └───┬───┘ └────┬────┘ └──────┬──────┘ └──┬──┘            │
│      │          │             │            │               │
│      └──────────┴─────────────┴────────────┘               │
│           Direct function calls + EventBus                  │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │  RocksDB (single instance,           │                   │
│  │  multiple column families)           │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Internal Communication: Replacing AMQP

### RPC: Direct Function Calls via Interface Classes

Each service's AMQP RPC surface becomes a C++ abstract interface. The protobuf request/response types are retained but passed by reference — no serialization.

```cpp
// CURRENT: chain indexer calls block_store via AMQP
auto response_bytes = client->rpc("koinos.rpc.block_store", request.SerializeAsString()).get();
rpc::block_store::block_store_response response;
response.ParseFromString(response_bytes);

// NEW: direct call, zero serialization
auto response = block_store_->get_blocks_by_height(request);
```

**Interface definitions** (one per former service):

```cpp
class IBlockStore {
public:
    virtual ~IBlockStore() = default;
    virtual rpc::block_store::get_blocks_by_height_response
        get_blocks_by_height(const rpc::block_store::get_blocks_by_height_request&) = 0;
    virtual rpc::block_store::get_blocks_by_id_response
        get_blocks_by_id(const rpc::block_store::get_blocks_by_id_request&) = 0;
    virtual rpc::block_store::get_highest_block_response
        get_highest_block(const rpc::block_store::get_highest_block_request&) = 0;
    virtual rpc::block_store::add_block_response
        add_block(const rpc::block_store::add_block_request&) = 0;
};

class IChain {
public:
    virtual ~IChain() = default;
    virtual rpc::chain::submit_block_response
        submit_block(const rpc::chain::submit_block_request&) = 0;
    virtual rpc::chain::submit_transaction_response
        submit_transaction(const rpc::chain::submit_transaction_request&) = 0;
    virtual rpc::chain::get_head_info_response
        get_head_info(const rpc::chain::get_head_info_request&) = 0;
    virtual rpc::chain::read_contract_response
        read_contract(const rpc::chain::read_contract_request&) = 0;
    // ... remaining RPC methods
};

class IMempool {
public:
    virtual ~IMempool() = default;
    virtual rpc::mempool::get_pending_transactions_response
        get_pending_transactions(const rpc::mempool::get_pending_transactions_request&) = 0;
    virtual rpc::mempool::check_pending_account_resources_response
        check_pending_account_resources(const rpc::mempool::check_pending_account_resources_request&) = 0;
};
```

### Broadcasts: boost::signals2 EventBus

AMQP topic exchanges become typed signals. No serialization, handlers invoked synchronously on the emitter's thread (with async dispatch where needed).

```cpp
// core/event_bus.hpp
#include <boost/signals2.hpp>

class EventBus {
public:
    // Replaces koinos.block.accept
    boost::signals2::signal<void(const broadcast::block_accepted&)> on_block_accepted;

    // Replaces koinos.block.irreversible
    boost::signals2::signal<void(const broadcast::block_irreversible&)> on_block_irreversible;

    // Replaces koinos.transaction.accept
    boost::signals2::signal<void(const broadcast::transaction_accepted&)> on_transaction_accepted;

    // Replaces koinos.transaction.fail
    boost::signals2::signal<void(const broadcast::transaction_failed&)> on_transaction_failed;

    // Replaces koinos.gossip.status
    boost::signals2::signal<void(bool)> on_gossip_status;

    // Replaces koinos.block.forks
    boost::signals2::signal<void(const broadcast::fork_heads&)> on_fork_heads;
};
```

**Why boost::signals2:** Already a Boost dependency, thread-safe by default, supports connection management, zero serialization — signals pass const references.

**Subscription wiring in main.cpp:**

```cpp
// Mempool subscribes to block events
event_bus.on_block_accepted.connect(
    [&mempool](const broadcast::block_accepted& ba) {
        mempool.handle_block_accepted(ba);
    });

// Block store subscribes to block.accept
event_bus.on_block_accepted.connect(
    [&block_store](const broadcast::block_accepted& ba) {
        block_store.handle_block_accepted(ba);
    });

// P2P needs async dispatch (networking thread)
event_bus.on_block_accepted.connect(
    [&p2p_ioc, &p2p](const broadcast::block_accepted& ba) {
        auto ba_copy = ba;
        boost::asio::post(p2p_ioc, [&p2p, ba = std::move(ba_copy)]() {
            p2p.gossip_block(ba);
        });
    });
```

### Current AMQP Subscriptions → EventBus Mapping

| AMQP Topic | Subscribers | EventBus Signal |
|---|---|---|
| `koinos.block.accept` | mempool, block_store, p2p, contract_meta_store | `on_block_accepted` |
| `koinos.block.irreversible` | mempool | `on_block_irreversible` |
| `koinos.transaction.accept` | p2p (gossip) | `on_transaction_accepted` |
| `koinos.transaction.fail` | (logging) | `on_transaction_failed` |
| `koinos.gossip.status` | block_producer | `on_gossip_status` |
| `koinos.block.forks` | (monitoring) | `on_fork_heads` |

---

## 4. Threading Model

The monolith consolidates the thread pools that currently exist across 12 separate processes into a single process with multiple `boost::asio::io_context` instances:

```
Main thread
  ├── Signal handling (SIGINT, SIGTERM)
  └── Component lifecycle coordination

Chain io_context (N threads, default = CPU cores, min 2)
  ├── Block processing (submit_block, apply_block_delta)
  ├── RPC request handling (read_contract, get_head_info)
  └── 8 MB stack per thread (deep WASM call stacks)

P2P io_context (M threads, default = min(8, CPU cores))
  ├── libp2p networking (connection management, streams)
  ├── GossipSub message processing
  ├── Peer sync loops
  └── Block/transaction application queue

API io_context (K threads, default = 4)
  ├── JSON-RPC HTTP server (Boost.Beast)
  ├── gRPC server
  └── Health endpoint

Background io_context (1-2 threads)
  ├── Mempool transaction pruning (1s timer)
  ├── Block producer production loop
  ├── P2P periodic tasks (peer logging, seed reconnect)
  ├── Contract meta store event processing
  └── Account history indexing
```

**Total threads:** N + M + K + 2 (roughly 2x CPU cores). Comparable to aggregate threads across all 12 current processes but eliminates inter-process context switching.

---

## 5. Go-to-C++ Rewrites

### 5.1 Block Store (Go → C++)

**Current:** Go binary, Badger DB, ~800 lines core logic.

**Rewrite scope:**
- **Storage:** Badger DB → RocksDB column family `blocks` (already a dependency via koinos_state_db)
- **Skip-list:** Port the power-of-2 based `previous_block_ids` ancestor system. Pure math + DB lookups, ~100 lines of algorithmic code
- **RPC methods:** `get_blocks_by_height`, `get_blocks_by_id`, `get_highest_block`, `add_block` — each becomes a method on `BlockStore` class
- **Broadcast handler:** `on_block_accepted` → `add_block()` via EventBus
- **Stats reporter:** Timer-based logging of recent block additions (every 60s)

**Complexity:** Medium. Clean separation between storage and logic.

### 5.2 P2P Service (Go → C++)

**Current:** Go binary, go-libp2p, ~3000 lines core logic. **Largest and most complex rewrite.**

**Rewrite scope:**
- **Networking:** go-libp2p → **cpp-libp2p** (libp2p/cpp-libp2p). Uses boost::asio internally, aligns with chain architecture
- **GossipSub:** cpp-libp2p includes GossipSub. Topics `koinos.blocks` and `koinos.transactions`
- **Peer RPC:** Replace `go-libp2p-gorpc` with custom protocol `/koinos/peerrpc/1.0.0` over libp2p streams. Must replicate gorpc framing exactly: MessagePack `ServiceID` followed by MessagePack args for requests, and MessagePack `Response` followed by MessagePack data for responses.
- **Connection manager:** Port peer lifecycle state machine (handshake, sync loop, reconnection)
- **Applicator:** Port block/transaction application queue with concurrency control
- **Error handler:** Port peer error scoring with exponential decay
- **Gossip toggle:** Port sync-state-based gossip enable/disable
- **Transaction cache:** Port time-based duplicate detection
- **Identity:** Generate/load Ed25519 key for peer ID (cpp-libp2p handles this)

**Complexity:** High. Async networking, state machines, wire-protocol compatibility.

**cpp-libp2p notes:**
- Maintained by Soramitsu (used in Kagome/Polkadot C++)
- Supports: Noise encryption, mplex/yamux, GossipSub, Kademlia DHT
- NAT traversal may need verification against Go implementation

### 5.3 JSON-RPC Gateway (Go → C++)

**Current:** Go binary, ~500 lines core logic.

**Rewrite scope:**
- **HTTP server:** Go `net/http` → **Boost.Beast** (already in Boost, uses boost::asio)
- **JSON parsing:** **nlohmann::json** (already a dependency in chain) for JSON-RPC 2.0
- **Request routing:** Method `chain.get_head_info` → `chain_->get_head_info()` directly. No AMQP routing
- **Protobuf JSON translation:** `google::protobuf::util::JsonStringToMessage()` and `MessageToJsonString()` (already used in chain for genesis data)
- **Whitelist/blacklist:** Config-based method filtering
- **Batch requests:** JSON array processed serially

**Complexity:** Low-Medium. Simple routing, the protobuf reflection is the trickiest part.

### 5.4 Contract Meta Store (Go → C++)

**Current:** Go binary, ~200 lines core logic. **Simplest service.**

**Rewrite scope:**
- **Storage:** Badger DB → RocksDB column family `contract_meta`
- **Event handler:** Subscribe to `on_block_accepted`, extract contract metadata events, store ABI
- **RPC method:** `get_contract_meta(contract_id)` — simple key-value lookup

**Complexity:** Low.

### 5.5 Transaction Store (Go → C++)

**Current:** Go binary, similar to contract_meta_store.

**Rewrite scope:**
- **Storage:** Badger DB → RocksDB column family `transaction_index`
- **Event handler:** Subscribe to block events, index transactions by ID
- **RPC methods:** Transaction lookup by ID

**Complexity:** Low.

---

## 6. Database Consolidation

### Single RocksDB Instance with Column Families

**Current state:**
| Component | Database | Location | Size |
|---|---|---|---|
| Chain state | RocksDB | `{basedir}/chain/blockchain/` | ~1 GB |
| Block store | Badger DB | `{basedir}/block_store/db/` | ~350 GB |
| Contract meta | Badger DB | `{basedir}/contract_meta_store/db/` | ~10 MB |
| Transaction store | Badger DB | `{basedir}/transaction_store/db/` | variable |
| AMQP broker | Badger/BuntDB | `{basedir}/amqp/` | ~100 MB |
| Mempool | In-memory (state_db) | — | — |

**Target: single RocksDB at `{basedir}/db/`**

| Column Family | Data | Source | Approx Size |
|---|---|---|---|
| `default` | Chain state (fork tree, state objects) | chain | ~1 GB |
| `blocks` | Block records (block + receipt + skip-list) | block_store | ~350 GB |
| `block_meta` | Highest block topology | block_store | bytes |
| `contract_meta` | Contract ABI metadata | contract_meta_store | ~10 MB |
| `transaction_index` | Transaction ID → block location | transaction_store | variable |
| `account_history` | Account activity index | account_history | variable |

**Benefits of single instance:**
- Single WAL — reduces fsync overhead
- Shared block cache across column families
- Single compaction thread pool — less resource contention
- Atomic cross-CF writes where needed (store block + update index atomically)
- Simplified backup: one RocksDB checkpoint for entire node state

**Column family tuning:**
- `blocks`: Large block sizes (64 KB), zstd compression, bloom filters for point lookups
- `default` (chain state): Smaller blocks (4 KB), optimized for point lookups + iterators
- Others: Default settings, modest size

**Integration with koinos_state_db:** The existing chain state_db library wraps RocksDB with fork-tree support. Pass the same `rocksdb::DB*` instance — state_db uses its own column families, other stores use additional CFs.

**Data directory layout:**

```
{basedir}/
├── db/                    # Single RocksDB (all column families)
├── p2p/
│   └── identity.key       # libp2p peer identity
├── block_producer/
│   └── private.key        # Producer private key
└── config.yml             # Unified config
```

**Migration tool:** One-time script to import existing Badger DB block data into RocksDB. Run offline with checksum verification. Keep Badger DB as backup until verified.

---

## 7. Build System

### Single CMake Project

```
koinos-node/
├── CMakeLists.txt              # Top-level: deps, add_subdirectory
├── cmake/
│   └── FindCppLibp2p.cmake
├── src/
│   ├── CMakeLists.txt          # Main executable target
│   ├── main.cpp                # Entry point, component wiring
│   ├── core/
│   │   ├── CMakeLists.txt      # Static lib: koinos_core_lib
│   │   ├── event_bus.hpp/.cpp
│   │   ├── config.hpp/.cpp
│   │   └── service_registry.hpp/.cpp
│   ├── chain/
│   │   ├── CMakeLists.txt      # Static lib: koinos_chain_lib
│   │   └── ... (existing chain source, minus AMQP)
│   ├── mempool/
│   │   ├── CMakeLists.txt      # Static lib: koinos_mempool_lib
│   │   └── ...
│   ├── block_producer/
│   │   ├── CMakeLists.txt      # Static lib: koinos_block_producer_lib
│   │   └── ...
│   ├── block_store/
│   │   ├── CMakeLists.txt      # Static lib: koinos_block_store_lib (NEW)
│   │   └── ...
│   ├── p2p/
│   │   ├── CMakeLists.txt      # Static lib: koinos_p2p_lib (NEW)
│   │   └── ...
│   ├── jsonrpc/
│   │   ├── CMakeLists.txt      # Static lib: koinos_jsonrpc_lib (NEW)
│   │   └── ...
│   ├── contract_meta_store/    # NEW
│   ├── transaction_store/      # NEW
│   ├── account_history/
│   └── grpc/
├── tests/
│   └── ... (per-module test files)
└── proto/
    └── ... (or FetchContent for koinos_proto)
```

**Dependency changes:**
- **Remove:** `koinos_mq` (AMQP client), `rabbitmq-c` (AMQP C library)
- **Add:** `cpp-libp2p` (P2P networking)
- **Keep:** Boost, RocksDB, Protobuf, yaml-cpp, nlohmann_json, fizzy, OpenSSL, libsecp256k1-vrf, ethash, gRPC, koinos_proto, koinos_util, koinos_exception, koinos_crypto, koinos_log, koinos_state_db

**Build target:**

```cmake
add_executable(koinos_node src/main.cpp)
target_link_libraries(koinos_node PRIVATE
    koinos_core_lib
    koinos_chain_lib koinos_mempool_lib koinos_block_producer_lib
    koinos_block_store_lib koinos_p2p_lib koinos_jsonrpc_lib
    koinos_contract_meta_store_lib koinos_transaction_store_lib
    koinos_account_history_lib koinos_grpc_lib
)
```

---

## 8. Configuration Changes

### Unified config.yml

The `global.amqp` field is removed. Per-component sections remain. Feature flags replace profiles.

```yaml
global:
  log-level: info
  instance-id: Koinos
  fork-algorithm: pob
  basedir: ~/.koinos
  # amqp: REMOVED

chain:
  jobs: 4
  verify-blocks: false
  read-compute-bandwidth-limit: 10000000
  pending-transaction-limit: 10

p2p:
  listen: /ip4/0.0.0.0/tcp/8888
  peer:
    - /dns4/seed.koinosblocks.com/tcp/8888/p2p/Qm...
  jobs: 4

jsonrpc:
  listen: 0.0.0.0:8080
  jobs: 4

block_producer:
  algorithm: pob
  resources-lower-bound: 75
  resources-upper-bound: 90

mempool:
  transaction-expiration: 120

# NEW: Feature flags (replaces Knodel profile-based service selection)
features:
  chain: true             # always on
  mempool: true           # always on
  block_store: true       # always on
  p2p: true               # always on
  jsonrpc: true           # default on
  grpc: false             # default off
  block_producer: false   # enable for producers
  contract_meta_store: true
  transaction_store: true
  account_history: false
```

**CLI flags:**

```
koinos_node [OPTIONS]
  --basedir, -d          Base data directory (default: ~/.koinos)
  --config, -c           Config file path (default: {basedir}/config.yml)
  --log-level, -l        Log level override
  --enable <component>   Enable a component (repeatable)
  --disable <component>  Disable a component (repeatable)
  --jobs, -j             Chain worker threads
  --p2p-listen           P2P listen address override
  --jsonrpc-listen       JSON-RPC listen address override
  --version, -v          Print version
  --help, -h             Print help
```

---

## 9. Network Compatibility

The monolith must participate in the existing Koinos P2P network alongside Docker/microservice nodes.

### Wire Protocol Requirements

1. **GossipSub topics:** `koinos.blocks` and `koinos.transactions` use protobuf encoding. Both Go and C++ use the same `koinos_proto` definitions → byte-identical encoding.

2. **Peer RPC protocol (gorpc framing):** The Go P2P service uses `go-libp2p-gorpc` with protocol ID `/koinos/peerrpc/1.0.0`. Framing: MessagePack `ServiceID{Name, Method}` followed by a MessagePack args struct. Responses are MessagePack `Response{Service, Error, ErrType}` followed by a MessagePack data struct. **The C++ implementation must replicate this exact framing — this is the highest-risk compatibility area.** Offline fixtures now validate the C++ codec byte-for-byte; next step is live Go↔C++ interop.

3. **Peer ID format:** Both Go and C++ libp2p use the same derivation (multihash of public key) → compatible.

4. **Chain ID validation:** `SHA2-256(genesis_data_protobuf)` — deterministic protobuf encoding guarantees compatibility.

5. **NAT traversal:** Verify cpp-libp2p's UPnP, AutoRelay, and hole-punching against go-libp2p behavior. These are standardized libp2p specs but implementation differences may exist.

### External API Compatibility

- **JSON-RPC:** Method names, error codes, and response formats must be identical. `google::protobuf::util::MessageToJsonString()` follows the same proto3 JSON mapping as Go's `protojson`.
- **gRPC:** Service definitions come from the same `.proto` files → automatic compatibility.

---

## 10. Knodel Integration: Process Management

### Current: 12 Processes + AMQP Broker

**`electron/main.ts`** currently:
- Defines `KOINOS_MANAGED_SERVICES` array with 12 service definitions
- `readNativeServiceDefinitions()` returns per-service metadata (ports, dependencies, profiles)
- `startNativeServiceProcess()` spawns each service binary with `--basedir` and `--amqp` args
- `stopNativeServiceProcess()` sends SIGTERM → waits → SIGKILL per process
- `sortManagedServiceIdsByDependencies()` does topological sort for startup order
- `nativeComposeStatus()` aggregates status from all 12 processes
- AMQP broker has special lifecycle management (GarageMQ binary vs Homebrew RabbitMQ detection)

**`electron/lib/native-runtime-service.ts`** manages:
- `nativeServiceProcesses: Map<string, NativeServiceProcessState>` — per-service process tracking
- Per-service TCP port health checks via `waitForTcpListener()`
- Per-service conflict detection via `listTcpListenerOwners()`
- Per-service log capture (stdout/stderr → circular buffer per service)

### Target: Single Process

**Changes to `electron/main.ts`:**

```typescript
// BEFORE: 12 service definitions
const KOINOS_MANAGED_SERVICES: ManagedKoinosServiceDefinition[] = [
  { id: 'amqp', ... }, { id: 'chain', ... }, ... // 12 entries
]

// AFTER: 1 monolith definition
const KOINOS_MANAGED_SERVICES: ManagedKoinosServiceDefinition[] = [
  {
    id: 'koinos-node',
    displayName: 'Koinos Node',
    ports: [
      { target: 8080, host: '127.0.0.1', protocol: 'tcp' },  // jsonrpc
      { target: 8888, host: '0.0.0.0', protocol: 'tcp' },    // p2p
    ],
    dependencies: [],  // no dependencies — it's one binary
    profile: null,     // always included
  }
]
```

**Deleted code in main.ts:**
- All AMQP broker management: `nativeAmqpUsesBrewService()`, `ensureNativeAmqpRuntimeFiles()`, `startNativeAmqpBrewService()`, `stopNativeAmqpBrewService()`, `nativeAmqpBrewServiceState()`
- Dependency ordering: `sortManagedServiceIdsByDependencies()` — no longer needed (one process)
- Per-service process maps: `nativeServiceProcesses` becomes a single `monolithProcess: ChildProcess | null`
- Per-service health checks: replace multi-port probing with single health check on jsonrpc port (8080)
- AMQP environment variables: `NODENAME`, `RABBITMQ_*` — all removed

**Simplified launch spec:**

```typescript
// BEFORE: complex per-service launch specs with AMQP URLs
const spec = nativeServiceLaunchSpec(settings, 'chain', definitions)
// → { command: '/path/to/koinos_chain.exe', args: ['--basedir=...', '--amqp=amqp://...'] }

// AFTER: single binary with feature flags
const spec = {
  command: '/path/to/koinos_node',
  args: [
    `--basedir=${settings.baseDir}`,
    `--log-level=${settings.logLevel || 'info'}`,
    ...enabledFeatures.map(f => `--enable=${f}`),
    ...disabledFeatures.map(f => `--disable=${f}`),
  ],
  cwd: settings.baseDir,
  env: {},  // no AMQP env vars needed
}
```

**Simplified process lifecycle:**

```typescript
// BEFORE: sequential startup with dependency ordering
for (const serviceId of sortedServiceIds) {
  if (serviceId === 'amqp') await startAmqpWithSpecialHandling()
  else await startNativeServiceProcess(settings, serviceId, definitions)
  if (serviceId === 'amqp') await waitForTcpListener('127.0.0.1', 5672, 90000)
}

// AFTER: single spawn
const child = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
await waitForTcpListener('127.0.0.1', 8080, 30000)  // wait for jsonrpc health
```

**Changes to `electron/lib/native-runtime-service.ts`:**
- `nativeServiceProcesses: Map` → `monolithProcess: NativeServiceProcessState | null`
- Remove `nativeLogsStreamIdsByService: Map<string, Set<string>>` — single log stream
- Remove `nativeServiceVersionCache: Map` — single binary version
- Simplify `startNativeServiceProcess()` to `startMonolith()`
- Simplify `stopNativeServiceProcess()` to `stopMonolith()`
- Remove per-service conflict detection (only check ports 8080 and 8888)

---

## 11. Knodel Integration: Build System

### Current: Per-Service Build Definitions

**`electron/lib/native-tooling.ts`** defines build configs for each service:
- C++ services: CMake configure → CMake build → artifact at `vendor/koinos/{service}/build/`
- Go services: `go build -o artifact .`
- REST: `yarn install && yarn build`

**`electron/lib/native-build-service.ts`** returns build status for each of the 11-12 services separately.

### Target: Single Build Target

**Changes to `electron/lib/native-tooling.ts`:**

```typescript
// BEFORE: 11 build definitions
function nativeServiceBuildDefinitions(sourceRoot: string): Map<string, BuildDefinition> {
  return new Map([
    ['chain', { system: 'cmake', sourcePath: 'vendor/koinos/koinos-chain', ... }],
    ['block_store', { system: 'go', sourcePath: 'vendor/koinos/koinos-block-store', ... }],
    // ... 9 more
  ])
}

// AFTER: 1 build definition
function nativeServiceBuildDefinitions(sourceRoot: string): Map<string, BuildDefinition> {
  return new Map([
    ['koinos-node', {
      system: 'cmake',
      sourcePath: 'vendor/koinos/koinos-node',  // monolith repo
      artifactPath: 'vendor/koinos/koinos-node/build/koinos_node',
      configureArgs: [/* unified cmake args */],
    }]
  ])
}
```

**Changes to `electron/lib/native-build-service.ts`:**
- `nativeBuildStatus()` returns a single build entry instead of 12
- Remove Go build detection (no more Go services)
- Remove Yarn build detection (no more REST service)
- Tool requirements simplify to: CMake + C++ compiler only

---

## 12. Knodel Integration: Types and IPC

### Status Model Change

**`electron/lib/main-types.ts`:**

```typescript
// CURRENT: per-service status
type KoinosNodeStatus = {
  ok: boolean
  services: ServiceStatus[]  // 12 entries
  // ...
}

type ServiceStatus = {
  id: string              // 'chain', 'mempool', etc.
  status: 'running' | 'stopped' | 'exited' | 'conflict' | ...
  ports: ServicePort[]
  // ...
}

// NEW: monolith status with component health
type KoinosNodeStatus = {
  ok: boolean
  services: ServiceStatus[]  // 1 entry: 'koinos-node'
  components: ComponentHealth[]  // derived from monolith stdout or health endpoint
}

type ComponentHealth = {
  name: string        // 'chain', 'mempool', 'p2p', etc.
  enabled: boolean
  healthy: boolean
  details?: string    // e.g., "syncing block 5000000"
}
```

**Backward compatibility:** The `services` array still exists with one entry. The `components` array is new. Existing UI code that iterates `services` still works — it just sees one service. The MicroservicesConfigPanel adapts to show component toggles instead of per-service start/stop.

### IPC Changes

**`electron/preload.ts`:**

```typescript
// CURRENT: per-service operations
koinosNode: {
  serviceStart({ service: string })   // start individual service
  serviceStop({ service: string })    // stop individual service
  serviceRestart({ service: string }) // restart individual service
}

// NEW: monolith operations
koinosNode: {
  start()                              // start the monolith
  stop()                               // stop the monolith
  restart()                            // restart the monolith
  componentToggle({ component, enabled }) // enable/disable component (writes config, restarts)
  // serviceStart/Stop/Restart still work for backward compat but are no-ops or restart the monolith
}
```

**`src/knodel-electron.d.ts`:** Updated type declarations matching the above changes.

---

## 13. Knodel Integration: UI Changes

### MicroservicesConfigPanel

**Current behavior:** Shows a grid of 12 services, each with:
- Status indicator (running/stopped/error)
- Start/Stop/Restart buttons per service
- Port information
- Dependency chain visualization

**New behavior:** Shows the monolith process status with:
- Single Start/Stop/Restart for the node
- Component toggle switches (chain, mempool, p2p, jsonrpc, etc.)
- Component health indicators (derived from health endpoint or log parsing)
- Port information (8080 for jsonrpc, 8888 for p2p)

**`src/components/panels/MicroservicesConfigPanel.tsx`:**
- Rename to `NodeComponentsPanel.tsx` or keep name but change rendering
- Replace per-service start/stop buttons with component toggles
- Component toggles write to config.yml `features:` section and trigger node restart
- Health status per component from the `components` array in status

### App.tsx State Changes

```typescript
// CURRENT: per-service action loading
const [nodeServiceActionLoading, setNodeServiceActionLoading] =
  useState<{ serviceId: string; action: string } | null>(null)

// NEW: simplified — only node-level actions
const [nodeActionLoading, setNodeActionLoading] =
  useState<'start' | 'stop' | 'restart' | null>(null)
// nodeServiceActionLoading becomes componentToggleLoading for feature flag changes
```

### Settings Panel

**`src/components/panels/SettingsPanel.tsx`:**
- Remove any AMQP-related settings
- The "Microservices" tab becomes "Node Components"

### Workspace Service

**`electron/lib/workspace-service.ts`:**
- Remove `rabbitmq.conf` from required config files
- Keep: `config.yml`, `genesis_data.json`, `koinos_descriptors.pb`
- Remove AMQP directory creation (`{basedir}/amqp/`)

### i18n

**`src/i18n.ts`:** Update ~30 keys (EN + ES):
- `services` → `components` in various labels
- Remove AMQP-related strings
- Add component toggle labels
- Update status descriptions

---

## 14. Knodel Integration: Config and Profiles

### Feature Flags Replace Profiles

**Current profile system:**
- Knodel defines presets (e.g., `block_producer` preset includes chain, mempool, block_store, p2p, jsonrpc, contract_meta_store, block_producer)
- `selectedManagedComposeServiceIds()` filters KOINOS_MANAGED_SERVICES by active profiles
- Each preset starts/stops different subsets of the 12 processes

**New system:**
- Knodel presets map to `features:` config flags
- `block_producer` preset → `features.block_producer: true, features.jsonrpc: true, features.contract_meta_store: true`
- Preset change writes config.yml and restarts the monolith (one process restart vs starting/stopping multiple)

**`electron/main.ts` — `buildProfilePresets()`:**

```typescript
// BEFORE: maps preset → service IDs to start
const presets = {
  block_producer: ['amqp', 'chain', 'mempool', 'block_store', 'p2p', 'jsonrpc', 'block_producer'],
  jsonrpc: ['amqp', 'chain', 'mempool', 'block_store', 'p2p', 'jsonrpc'],
}

// AFTER: maps preset → feature flags
const presets = {
  block_producer: { block_producer: true, jsonrpc: true, contract_meta_store: true },
  jsonrpc: { jsonrpc: true },
  minimal: {},  // core only (chain, mempool, block_store, p2p — always on)
}
```

**Preset reconciliation:** Instead of starting/stopping individual services, Knodel:
1. Writes feature flags to config.yml
2. Restarts the monolith (stop + start)
3. Monolith reads config, enables/disables components internally

---

## 15. Knodel Integration: Log Streaming

### Current: Per-Service Log Capture

Each of the 12 processes has its own stdout/stderr captured independently:
- `nativeServiceProcesses.get(serviceId).output` — circular buffer per service
- Log follow sessions keyed by service: `nativeLogsStreamIdsByService: Map<serviceId, Set<streamId>>`
- UI can follow logs of individual services

### Target: Single Stream with Component Prefixes

The monolith outputs a single log stream with component-prefixed lines:

```
[chain] 2024-01-15T10:30:00 INFO  Indexing to target block 5000000
[p2p]   2024-01-15T10:30:01 INFO  Connected peers: 5
[chain] 2024-01-15T10:30:02 INFO  Applied block 4999950 (3600 blocks/sec)
[jsonrpc] 2024-01-15T10:30:03 INFO  Listening on 0.0.0.0:8080
[block_producer] 2024-01-15T10:30:04 INFO  Produced block at height 5000001
```

**Knodel log service changes:**

```typescript
// BEFORE: per-service log buffers
const output = nativeServiceProcesses.get(serviceId)?.output

// AFTER: single buffer with component-based filtering
const output = monolithProcess?.output
// Filter by component prefix when UI requests logs for a specific component
function filterLogsByComponent(logs: string, component: string): string {
  return logs.split('\n')
    .filter(line => line.startsWith(`[${component}]`))
    .join('\n')
}
```

**Log follow sessions:**
- `logsFollowStart({ service: 'chain' })` → starts streaming the monolith stdout, filters lines starting with `[chain]`
- `logsFollowStart()` (no service filter) → streams all lines
- The `nativeLogsStreamIdsByService` map simplifies — all streams read from the same source, just with different filters

---

## 16. Implementation Phases

### Phase 0: Foundation (2-3 weeks)

**Goal:** Monolith skeleton with EventBus and interfaces. Compiles and runs but does nothing.

1. Create CMake project structure
2. Implement `EventBus` using boost::signals2
3. Define interface classes (`IBlockStore`, `IMempool`, `IChain`, etc.)
4. Implement `main.cpp` with component lifecycle (init, start, shutdown)
5. Implement unified config parser (yaml-cpp)
6. Implement health endpoint (Boost.Beast HTTP on configurable port)

**Verification:** Binary compiles, starts, reads config, responds to health check, shuts down cleanly on SIGTERM.

### Phase 1: Integrate Existing C++ Services (3-4 weeks)

**Goal:** Wire chain, mempool, and block_producer into the monolith with direct calls.

1. Extract chain logic from `koinos_chain.cpp` — remove `mq::client` and `mq::request_handler`, replace AMQP RPC calls with interface method calls, replace AMQP broadcasts with EventBus emissions
2. Extract mempool logic — remove AMQP, wire EventBus subscriptions for block.accept, block.irreversible
3. Extract block_producer logic — remove AMQP, wire direct calls to chain and mempool
4. Wire the three components in main.cpp

**Verification:** Chain opens state DB, mempool tracks transactions, block producer assembles blocks. All internal communication uses direct calls and EventBus. Tested with a mock IBlockStore.

### Phase 2: Block Store C++ (2-3 weeks)

**Goal:** Replace Go block_store with C++ implementation using RocksDB.

1. Implement `BlockStore` class with RocksDB column families
2. Port skip-list ancestor system
3. Implement all RPC methods
4. Wire EventBus subscription for `on_block_accepted`
5. Write data migration tool (Badger DB → RocksDB)

**Verification:** Unit tests for skip-list. Integration test: load blocks, verify ancestry queries. Benchmark against Go implementation. Successfully import existing Badger DB data.

### Phase 3: JSON-RPC Gateway C++ (1-2 weeks)

**Goal:** HTTP JSON-RPC 2.0 server in C++.

1. Implement Boost.Beast HTTP server
2. Implement JSON-RPC 2.0 parser (nlohmann::json)
3. Implement method routing to internal components
4. Implement protobuf JSON serialization
5. Implement whitelist/blacklist, batch requests

**Verification:** curl-based tests matching existing JSON-RPC responses. Load test comparing latency against Go implementation.

### Phase 4: Contract Meta Store + Transaction Store (1 week)

**Goal:** Port the two simplest services.

1. ContractMetaStore with RocksDB column family
2. TransactionStore with RocksDB column family
3. Wire EventBus subscriptions

**Verification:** Unit tests, data correctness with known contract metadata.

### Phase 5: P2P Service C++ (4-6 weeks)

**Goal:** Largest rewrite. Must maintain wire compatibility with existing network.

1. **Week 1-2:** cpp-libp2p integration — host setup, Noise encryption, mplex/yamux, basic connectivity test between C++ and Go nodes
2. **Week 2-3:** Peer RPC protocol — replicate gorpc framing, implement `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, `GetBlocks`, test against Go peers
3. **Week 3-4:** Connection manager + sync — peer lifecycle, error scoring, seed reconnection
4. **Week 4-5:** GossipSub — topics, gossip toggle, fork bomb detection, transaction cache
5. **Week 5-6:** Applicator + end-to-end — block/transaction application queue, wire to chain/block_store, full sync test with mainnet peers

**Verification (critical):**
- Connect monolith to testnet or local network of Go nodes
- Block sync from genesis completes
- Live block reception via gossip works
- Transaction gossip bidirectional
- C++ node serves blocks to Go peers

### Phase 6: gRPC + Account History (1-2 weeks)

**Goal:** Integrate remaining C++ services.

1. Wire existing gRPC code into monolith
2. Wire existing account_history code
3. Add feature flag support for optional components

**Verification:** gRPC calls work, account history indexes correctly.

### Phase 7: Knodel Integration (2-3 weeks)

**Goal:** Electron app fully manages the monolith binary.

1. **main.ts:** Replace `KOINOS_MANAGED_SERVICES` with single entry, remove AMQP management functions, simplify process lifecycle
2. **native-runtime-service.ts:** Single process spawn/stop, remove dependency ordering
3. **native-tooling.ts + native-build-service.ts:** Single CMake build target
4. **main-types.ts + knodel-electron.d.ts:** Add `ComponentHealth[]`, update status types
5. **preload.ts:** Add `componentToggle()`, keep backward-compatible service methods
6. **workspace-service.ts:** Remove rabbitmq.conf, simplify config setup
7. **MicroservicesConfigPanel.tsx:** Component toggles instead of per-service start/stop
8. **App.tsx:** Simplified service action state, component health display
9. **i18n.ts:** Update ~30 keys (EN + ES)
10. **constants.ts:** Remove AMQP broker paths, add monolith binary path
11. **Profile system:** Map presets to feature flags, write config + restart

**Verification:** Full lifecycle test: build monolith via Knodel, start, sync blocks, produce blocks, toggle components, view logs, stop. All existing panels (Explorer, Dashboard, Producer, Wallet) work against the monolith.

### Phase 8: Performance Validation (2 weeks)

**Goal:** Measure improvements, optimize hot paths.

1. Benchmark indexing speed (blocks/sec during sync) — target 3-4x improvement
2. Benchmark JSON-RPC latency (p50, p99) — target 10-100x improvement
3. Benchmark block production latency — target 4-5x improvement
4. Profile hot paths, optimize remaining serialization boundaries
5. Tune RocksDB settings per column family
6. Load test P2P with many concurrent connections
7. Memory profiling — target 2x reduction

---

## 17. Risk Assessment

### High Risk

1. **P2P wire protocol compatibility.** The gorpc framing used by `go-libp2p-gorpc` is not formally specified. If the C++ implementation's framing differs, nodes reject each other. **Mitigation:** Capture and replay network traffic. Write a compatibility harness running Go peer + C++ peer to validate byte-level compatibility.

2. **cpp-libp2p maturity.** Less battle-tested than go-libp2p. NAT traversal, relay, and hole-punching may differ. **Mitigation:** Extensive testing on various network configs. Could temporarily run Go P2P binary alongside monolith during transition via a thin local protocol.

3. **State database corruption during migration.** Badger DB → RocksDB conversion risks data loss. **Mitigation:** Offline migration tool with checksum verification. Keep Badger DB as backup.

### Medium Risk

4. **Thread safety.** Process-level isolation → shared address space. Use-after-free in one component crashes everything. **Mitigation:** ASAN/TSAN during development. The chain's io_context pattern is well-tested.

5. **Build complexity.** cpp-libp2p adds significant dependency graph. **Mitigation:** Hunter package manager (already used by Koinos) or Conan.

6. **Memory usage.** Single process with 350 GB data set + WASM VM + P2P connections. **Mitigation:** Configure RocksDB block cache limits per column family. Monitor RSS.

### Low Risk

7. **JSON-RPC compatibility.** `MessageToJsonString` and Go `protojson` both follow proto3 JSON mapping spec. Minor differences in field ordering possible but unlikely to break clients. **Mitigation:** Regression tests.

8. **Config backward compatibility.** Existing config.yml has `global.amqp` that monolith ignores. yaml-cpp silently ignores unknown fields.

---

## 18. Performance Targets

### AMQP Overhead Elimination

| Stage | Current Overhead |
|---|---|
| Serialize protobuf request | ~1-50 μs |
| AMQP publish + TCP loopback + broker route | ~100-200 μs |
| AMQP consume + deserialize protobuf | ~50-100 μs |
| Response path (serialize + route + consume) | ~150-300 μs |
| **Total per RPC round-trip** | **~250-600 μs** |
| **Direct function call** | **~0.01-0.1 μs** |

### Expected Improvements

| Metric | Current (Microservices) | Target (Monolith) | Improvement |
|---|---|---|---|
| Indexing speed (verify-blocks=false) | ~3,600 blocks/sec | ~10,000-15,000 blocks/sec | 3-4x |
| Indexing speed (verify-blocks=true) | ~5-50 blocks/sec | ~8-80 blocks/sec | 1.5-2x |
| JSON-RPC `get_head_info` latency | ~2-5 ms | ~0.05-0.2 ms | 10-100x |
| Transaction submission latency | ~5-15 ms | ~0.5-2 ms | 5-10x |
| Block production latency | ~50-200 ms | ~10-50 ms | 4-5x |
| Memory usage (total) | ~500-800 MB (12 processes) | ~200-400 MB (1 process) | 2x |
| Startup time | 10-30s (sequential services + AMQP) | 2-5s (single process init) | 5-10x |

**Indexing speed explanation:** Chain indexer currently makes AMQP RPCs to block_store for each block batch. Each involves full protobuf serialize/deserialize + broker routing. With direct calls, chain reads block data directly via the `IBlockStore` interface — zero serialization, same-process memory access. Additionally, Badger DB → RocksDB may itself improve sequential scan performance.

---

## 19. File-Level Change Map

### New Files (Monolith C++ Repo)

| File | Purpose |
|---|---|
| `koinos-node/src/main.cpp` | Entry point, component wiring, lifecycle |
| `koinos-node/src/core/event_bus.hpp/.cpp` | boost::signals2 EventBus replacing AMQP broadcasts |
| `koinos-node/src/core/config.hpp/.cpp` | Unified YAML config parser |
| `koinos-node/src/core/service_registry.hpp/.cpp` | Component lifecycle management |
| `koinos-node/src/core/health.hpp/.cpp` | HTTP health endpoint |
| `koinos-node/src/block_store/block_store.hpp/.cpp` | C++ block store (replaces Go) |
| `koinos-node/src/block_store/skip_list.hpp/.cpp` | Skip-list ancestor system |
| `koinos-node/src/p2p/node.hpp/.cpp` | cpp-libp2p P2P node (replaces Go) |
| `koinos-node/src/p2p/connection_manager.hpp/.cpp` | Peer connection lifecycle |
| `koinos-node/src/p2p/gossip.hpp/.cpp` | GossipSub handler |
| `koinos-node/src/p2p/applicator.hpp/.cpp` | Block/transaction application queue |
| `koinos-node/src/p2p/error_handler.hpp/.cpp` | Peer error scoring |
| `koinos-node/src/jsonrpc/gateway.hpp/.cpp` | Boost.Beast HTTP JSON-RPC (replaces Go) |
| `koinos-node/src/contract_meta_store/meta_store.hpp/.cpp` | C++ contract meta (replaces Go) |
| `koinos-node/src/transaction_store/tx_store.hpp/.cpp` | C++ transaction store (replaces Go) |
| `koinos-node/CMakeLists.txt` | Top-level CMake project |

### Modified Files (Existing C++ — Remove AMQP)

| File | Change |
|---|---|
| `koinos-chain/src/koinos_chain.cpp` | Remove `mq::client`, `mq::request_handler`. Export as library |
| `koinos-chain/src/koinos/chain/controller.hpp/.cpp` | Replace `client->rpc()` with `IBlockStore*`, `IMempool*` |
| `koinos-chain/src/koinos/chain/indexer.hpp/.cpp` | Direct `block_store_->get_blocks_by_height()` calls |
| `koinos-mempool/src/koinos_mempool.cpp` | Remove AMQP. EventBus subscriptions |
| `koinos-block-producer/src/koinos_block_producer.cpp` | Remove AMQP. Direct chain/mempool calls |
| `koinos-grpc/src/koinos_grpc.cpp` | Remove AMQP. Direct interface calls |
| `koinos-account-history/src/koinos_account_history.cpp` | Remove AMQP. EventBus subscriptions |

### Modified Files (Knodel Electron App)

| File | Change |
|---|---|
| `electron/main.ts` | `KOINOS_MANAGED_SERVICES` 12→1, remove all AMQP management, simplify startup/shutdown, map presets to feature flags |
| `electron/lib/native-runtime-service.ts` | Single process spawn/stop, remove per-service Maps, remove dependency ordering |
| `electron/lib/native-tooling.ts` | Single CMake build definition instead of 11 per-service definitions |
| `electron/lib/native-build-service.ts` | Single build status, remove Go/Yarn detection |
| `electron/lib/workspace-service.ts` | Remove rabbitmq.conf, remove AMQP directory setup |
| `electron/lib/main-types.ts` | Add `ComponentHealth[]` to status, update service types |
| `electron/lib/constants.ts` | Remove AMQP paths/ports, add monolith binary path |
| `electron/lib/logs-service.ts` | Single log stream with component-prefix filtering |
| `electron/preload.ts` | Add `componentToggle()`, keep backward-compat service methods |
| `src/knodel-electron.d.ts` | Updated type declarations for monolith status model |
| `src/App.tsx` | Simplified service action state, component health display |
| `src/components/panels/MicroservicesConfigPanel.tsx` | Component toggles instead of per-service start/stop |
| `src/components/panels/SettingsPanel.tsx` | Remove AMQP settings |
| `src/i18n.ts` | Update ~30 keys (EN + ES) for component terminology |
| `package.json` | No Go/Yarn build tool requirements |

### Deleted Files/Dependencies

| Item | Reason |
|---|---|
| `vendor/amqp-broker/` | No AMQP broker needed |
| `koinos_mq` library | AMQP client library — replaced by direct calls + EventBus |
| `rabbitmq-c` library | AMQP C bindings — no longer needed |
| Go service binaries | Rewritten in C++ |
| `{basedir}/amqp/` directory | No AMQP broker data |

---

## Implementation Status

| Phase | Scope | Status | Notes |
|---|---|---|---|
| Phase 0: Foundation | CMake skeleton, EventBus, interfaces | **DONE** | `vendor/koinos/koinos-node/src/core/` |
| Phase 1: C++ Services Integration | chain + vm_manager + mempool internalized, AMQP → IRpcClient | **DONE** | 44 source files, MonolithRpcClient, MempoolAdapter |
| Phase 2: Block Store C++ | RocksDB block store, skip-list O(log n) | **DONE** | `block_store/`, 4 RPC methods, EventBus wired |
| Phase 3: JSON-RPC C++ | Boost.Beast HTTP server, 21 methods | **DONE** | `jsonrpc/`, all 6 services dispatched, batch support |
| Phase 4: Meta + Tx Store | Contract ABI indexer + tx index | **DONE** | `contract_meta_store/`, `transaction_store/` |
| Phase 5: P2P C++ | Sync protocol, error scoring, gossip toggle, cpp-libp2p transport | **DONE** | `p2p/`, Libp2pTransport with gorpc framing, `-DKOINOS_ENABLE_LIBP2P=ON` |
| Phase 6: gRPC + Account History | AsyncGenericService + address history indexer | **DONE** | `grpc_server/`, `account_history/`, 6 RocksDB CFs |
| Phase 7: Knodel Integration | Electron app adaptation | **DONE** | Types, IPC, UI, i18n, mode detection, process mgmt, log filtering |
| Phase 8: Performance Validation | Benchmarks, tuning, optimization | **PENDING** | See remaining work below |

### What Works Now

- 18MB arm64 binary compiles and runs on macOS
- Chain initializes with 3,761 Koinos mainnet genesis objects
- Chain ID calculated: `0x1220592bf18654fd07fdf5d500cde3e8402ecf7f81fa5dde8f14527b08bba8805f48`
- JSON-RPC serves 21 methods on port 8080 (chain, block_store, mempool, contract_meta, tx_store, account_history)
- gRPC serves chain/block_store/mempool via AsyncGenericService on port 50051
- RocksDB with 6 column families
- EventBus connects all services (block_accepted, block_irreversible, transaction events)
- Chain indexer syncs from block_store on startup
- Block producer loop (optional, 3s interval)
- SIGTERM triggers clean ordered shutdown
- Knodel detects monolith binary and auto-switches from multi-service mode

### Remaining Work for Production

#### 1. P2P Networking Validation

| Task | Priority | Description |
|------|----------|-------------|
| cpp-libp2p build | Done | Compile with `-DKOINOS_ENABLE_LIBP2P=ON`; current build links against Koinos-compatible cpp-libp2p install |
| gorpc wire compatibility | High | Offline MessagePack fixtures from the Go codec pass in `koinos_gorpc_codec_test`; next capture wire traces from a Go koinos-p2p node and validate live interop for protocol `/koinos/peerrpc/1.0.0`, service `PeerRPCService` |
| GossipSub interop | High | Connect C++ monolith to a Go peer, verify blocks and transactions propagate via `koinos.blocks` and `koinos.transactions` topics |
| NAT traversal | Medium | Test UPnP, AutoRelay, and hole punching against Go libp2p — may differ in behavior |
| Peer RPC methods | High | Validate `GetChainID`, `GetHeadBlock`, `GetAncestorBlockID`, `GetBlocks` request/response structs match `vendor/koinos/koinos-p2p/internal/rpc/peer_rpc_service.go` exactly |

#### 2. Block Sync End-to-End

| Task | Priority | Description |
|------|----------|-------------|
| P2P sync from mainnet | High | Connect to seed peers, handshake, batch fetch 500 blocks, apply sequentially — full sync to chain head |
| Indexer + MonolithRpcClient | Medium | Validate indexer handles edge cases: timeouts, partial block responses, block_store gaps |
| Backup restore | Medium | Restore from `.tar.gz` backup, verify chain re-indexes correctly with `verify-blocks: true` |

#### 3. Block Producer

| Task | Priority | Description |
|------|----------|-------------|
| Private key loading | High | Read `block_producer.private-key-file` from config.yml and pass to controller |
| VHP check | Medium | Verify `propose_block()` correctly checks VHP balance before producing |
| Production E2E | High | Full cycle: configure producer address + key → propose_block → submit_block → broadcast via EventBus → P2P gossip |

#### 4. Mempool Integration

| Task | Priority | Description |
|------|----------|-------------|
| submit_transaction E2E | High | JSON-RPC `chain.submit_transaction` → mempool → block production → block_accepted |
| Resource checking | Medium | Verify `check_pending_account_resources` correctly validates RC limits |
| Nonce handling | Medium | Validate nonce conflict detection and pending nonce tracking |
| Expiration pruning | Low | Verify mempool prunes expired transactions (120s default) |

#### 5. gRPC Validation

| Task | Priority | Description |
|------|----------|-------------|
| Client compatibility | Medium | Test with `koinos-cli`, `koinosctl`, and other gRPC clients against the AsyncGenericService |
| Method coverage | Medium | Validate all dispatched methods return correct protobuf envelopes |
| Error propagation | Low | Verify gRPC error codes match original koinos-grpc behavior |

#### 6. Data Migration

| Task | Priority | Description |
|------|----------|-------------|
| Badger → RocksDB tool | Medium | Create a Go utility that reads existing `block_store/db/` (Badger) and writes to RocksDB `blocks` + `block_meta` column families, preserving skip-list pointers |
| Chain state_db | Low | Already RocksDB — can be reused directly (just needs path mapping) |
| Checksum verification | Medium | Verify imported data integrity with SHA-256 checksums |
| Rollback support | Low | Keep Badger DB as backup until verification passes |

#### 7. Performance (Phase 8)

| Metric | Current (Multi-Service) | Target (Monolith) | How to Measure |
|--------|------------------------|-------------------|----------------|
| Indexing speed (verify-blocks=false) | ~3,600 blocks/sec | ~10,000-15,000 blocks/sec | Time full sync from block 0 to head |
| JSON-RPC `get_head_info` latency | ~2-5 ms | ~0.05-0.2 ms | `wrk` or `hey` benchmark tool |
| Transaction submission latency | ~5-15 ms | ~0.5-2 ms | Submit tx via JSON-RPC, measure round-trip |
| Block production latency | ~50-200 ms | ~10-50 ms | Time from propose_block to block_accepted |
| Memory usage | ~500-800 MB (12 processes) | ~200-400 MB (1 process) | `ps` RSS monitoring |
| Startup time | 10-30s (sequential services) | 2-5s (single process) | Time from spawn to JSON-RPC responsive |
| RocksDB tuning | N/A | Per-CF optimization | Tune block sizes, bloom filters, compression per column family |

#### 8. Testing

| Test Type | Coverage | Description |
|-----------|----------|-------------|
| Unit: skip-list | `block_store/skip_list.hpp` | Verify `get_previous_heights()` and `get_previous_height_index()` for edge cases (height 0, 1, powers of 2, large heights) |
| Unit: error scoring | `p2p/error_handler.hpp` | Verify exponential decay, threshold disconnect, reconnect blocking |
| Unit: fork watchdog | `p2p/fork_watchdog.hpp` | Verify max 3 forks, purge below LIB |
| Integration: block pipeline | main.cpp | submit_block → EventBus → block_store + contract_meta + tx_store + account_history |
| Integration: tx pipeline | main.cpp | submit_transaction → mempool → propose_block → submit_block → broadcast |
| Wire compat: gorpc | `p2p/gorpc_codec.cpp`, `p2p/libp2p_transport.cpp` | Fixtures verify C++ encode/decode produces Go-identical MessagePack bytes; live Go peer interop remains |
| Wire compat: JSON-RPC | `jsonrpc/jsonrpc_server.cpp` | Compare responses against running Go koinos-jsonrpc for all 21 methods |
| Stress: concurrent RPC | `jsonrpc/` | 1000 concurrent JSON-RPC requests, verify no crashes or deadlocks |
| Stress: P2P connections | `p2p/` | 50+ concurrent peers, verify connection manager stability |
