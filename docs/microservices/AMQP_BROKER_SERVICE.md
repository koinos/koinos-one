# AMQP Broker (GarageMQ) — Exhaustive Technical Reference

GarageMQ is a lightweight AMQP 0.9.1 message broker that replaces RabbitMQ for the Koinos node. It provides the message bus through which all microservices communicate.

## Binary & Version

- **Binary:** `garagemq.exe` (Go)
- **Source:** `vendor/amqp-broker/`

---

## Startup Sequence

1. Load YAML configuration
2. Initialize storage backend (Badger or BuntDB)
3. Create default virtual host (`/`)
4. Start TCP listener on AMQP port (default 5672)
5. Start admin HTTP server (default 15672)
6. Accept connections

---

## Configuration

### Default Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 5672 | AMQP 0.9.1 | Message broker |
| 15672 | HTTP | Admin interface |

### YAML Config Structure

```yaml
server:
  ip: "0.0.0.0"
  port: 5672

admin:
  ip: "0.0.0.0"
  port: 15672

users:
  - username: "guest"
    password: "guest"

tcp:
  readBufSize: 196608
  writeBufSize: 196608
  nodelay: true

queue:
  shardSize: 8192
  maxMessagesInRAM: 131072

db:
  defaultPath: "db"
  engine: "badger"  # or "buntdb"

vhost:
  defaultPath: "/"
```

---

## Core Architecture

### Connection Model

```
TCP Connection
  ↓
AMQP Handshake (protocol negotiation)
  ↓
Channel(s) — multiplexed over single connection
  ↓
Each channel can: publish, consume, declare, bind, ack
```

### Virtual Hosts

- Default: `/` (created on startup)
- Isolation boundary for exchanges and queues
- Each vhost has independent storage

---

## Exchange Types

| Type | Routing Logic | Use in Koinos |
|------|---------------|---------------|
| `direct` | Exact match on routing key | RPC request/response |
| `fanout` | Broadcast to all bound queues | Event broadcasting |
| `topic` | Pattern matching (`*`, `#` wildcards) | Selective event subscription |
| `headers` | Attribute matching | Not used |

### Koinos Exchange Configuration

| Exchange | Type | Durable | Purpose |
|----------|------|---------|---------|
| `koinos.rpc` | direct | yes | RPC request routing |
| `koinos.event` | topic | yes | Event broadcasting |

---

## Queue Implementation

### Structure

```
Queue:
  name: string
  durable: bool          // Survives broker restart
  exclusive: bool        // Single consumer, auto-delete on disconnect
  autoDelete: bool       // Delete when last consumer disconnects
  consumers: []Consumer  // Round-robin delivery
```

### Koinos Queue Configuration

| Queue | Durable | Purpose |
|-------|---------|---------|
| `koinos.rpc.chain` | yes | Chain service RPC inbox |
| `koinos.rpc.block_store` | yes | Block store RPC inbox |
| `koinos.rpc.mempool` | yes | Mempool RPC inbox |
| `koinos.rpc.p2p` | yes | P2P service RPC inbox |
| `koinos.rpc.block_producer` | yes | Block producer RPC inbox |
| `koinos.rpc.jsonrpc` | yes | JSON-RPC gateway RPC inbox |
| `koinos.rpc.contract_meta_store` | yes | Contract meta store RPC inbox |
| Reply queues | no | Temporary per-client reply queues |

### Memory Management

| Parameter | Default | Description |
|-----------|---------|-------------|
| `shardSize` | 8,192 | Internal queue sharding |
| `maxMessagesInRAM` | 131,072 | Threshold for disk swap |

When in-memory messages exceed `maxMessagesInRAM`, overflow messages are written to the storage backend (Badger/BuntDB).

---

## Message Flow

### RPC Pattern (Request/Response)

```
Client                    Broker                    Service
  |                         |                         |
  |-- Publish to ---------->|                         |
  |   exchange: koinos.rpc  |                         |
  |   routing_key: chain    |                         |
  |   reply_to: reply-queue |                         |
  |   correlation_id: xxx   |                         |
  |                         |-- Route to ------------>|
  |                         |   queue: koinos.rpc.chain
  |                         |                         |
  |                         |<-- Publish to ----------|
  |                         |   exchange: koinos.rpc  |
  |                         |   routing_key: reply-q  |
  |                         |   correlation_id: xxx   |
  |<-- Deliver from --------|                         |
  |   queue: reply-queue    |                         |
```

### Broadcast Pattern (Pub/Sub)

```
Publisher                 Broker                    Subscribers
  |                         |                         |
  |-- Publish to ---------->|                         |
  |   exchange: koinos.event|                         |
  |   routing_key: topic    |                         |
  |                         |-- Fan out to ---------->| (all bound queues)
  |                         |                         |
```

---

## Storage Backends

### Badger (Default)

- LSM-tree key-value store
- File-based persistence
- Supports transactions
- Good for large message volumes
- Path: `{basedir}/amqp/db/`

### BuntDB (Alternative)

- In-memory with disk sync
- Simpler, lower overhead
- Better for small deployments

---

## QOS (Quality of Service)

```
basic.qos(prefetch_count, prefetch_size, global):
  - prefetch_count: Max unacknowledged messages per consumer
  - prefetch_size: Max unacknowledged bytes (not commonly used)
  - global: Apply to connection (true) or channel (false)
```

Koinos services typically use `prefetch_count=1` to process messages sequentially.

---

## Admin HTTP API

Read-only REST API on port 15672:

| Endpoint | Description |
|----------|-------------|
| `/api/connections` | Active connections |
| `/api/channels` | Open channels |
| `/api/exchanges` | Declared exchanges |
| `/api/queues` | Declared queues |
| `/api/bindings` | Exchange-queue bindings |

---

## Connection Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Read buffer | 192 KB | TCP read buffer size |
| Write buffer | 192 KB | TCP write buffer size |
| TCP_NODELAY | true | Disable Nagle's algorithm (low latency) |
| Frame max | 65,536 | Max AMQP frame size |
| Heartbeat | 10s | Connection keepalive interval |

---

## Metrics

GarageMQ tracks the following metrics:

| Metric | Description |
|--------|-------------|
| `publish` | Messages published |
| `deliver` | Messages delivered to consumers |
| `confirm` | Publisher confirms sent |
| `acknowledge` | Consumer acknowledgments |
| `get` | Messages retrieved via basic.get |
| `ready` | Messages ready for delivery |
| `unacked` | Messages delivered but not acknowledged |
| `total` | Total messages processed |
| `traffic_in` | Bytes received |
| `traffic_out` | Bytes sent |

---

## Differences from RabbitMQ

| Feature | RabbitMQ | GarageMQ |
|---------|----------|----------|
| Language | Erlang | Go |
| Management UI | Full web UI | Basic REST API |
| Clustering | Yes | No (single node) |
| Plugins | Extensive ecosystem | None |
| Memory footprint | ~100+ MB | ~20-50 MB |
| AMQP version | 0.9.1 + extensions | 0.9.1 (core) |
| Persistence | Mnesia | Badger/BuntDB |
| Authentication | Multiple backends | YAML user list |

GarageMQ is specifically chosen for Koinos because:
- Compiles to a single Go binary (no Erlang runtime)
- Lightweight enough to bundle with the node
- Supports all AMQP features Koinos needs
- Easy to ship in an installer

---

## Failure Modes

- **Port conflict:** If port 5672 or 15672 is already in use, startup fails with a panic
- **Storage corruption:** Badger DB recovery on startup
- **Connection flood:** TCP backlog handles connection queuing
- **Message overflow:** Swaps to disk when RAM threshold exceeded
