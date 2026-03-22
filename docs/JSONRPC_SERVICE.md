# JSON-RPC Gateway — Exhaustive Technical Reference

The JSON-RPC gateway (`koinos-jsonrpc.exe`) provides an HTTP API that translates JSON-RPC 2.0 requests into AMQP messages, routing them to the appropriate microservice and returning the response.

## Binary & Version

- **Binary:** `koinos-jsonrpc.exe` (Go)
- **Version:** v1.1.0
- **Source:** `vendor/koinos/koinos-jsonrpc/`

---

## Startup Sequence

1. Parse CLI flags and YAML config
2. Initialize logging
3. Load protobuf descriptors from `--descriptors` directory
4. Connect AMQP client
5. Start HTTP server on configured listen address
6. Initialize worker pool (job queue)
7. Begin accepting requests

---

## Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--basedir, -d` | `~/.koinos` | Base data directory |
| `--amqp, -a` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL |
| `--listen` | `/ip4/127.0.0.1/tcp/8080` | HTTP listen address (multiaddr format) |
| `--endpoint` | `/` | HTTP endpoint path |
| `--gateway-timeout` | 3 | Seconds to enqueue request |
| `--mq-timeout` | 5 | Seconds to wait for MQ response |
| `--descriptors` | `descriptors/` | Protobuf descriptor directory |
| `--jobs` | 16 | Worker threads |
| `--whitelist` | all | Allowed RPC methods |
| `--blacklist` | none | Blocked RPC methods |

---

## Request Pipeline

```
HTTP POST /
  ↓
Parse JSON-RPC 2.0 request
  ↓
Validate: id, jsonrpc version, params
  ↓
Enqueue to job queue (size: 2 * jobs)
  ↓
Worker picks up job:
  ↓
Translate method name → service + protobuf request
  ↓
AMQP RPC call to target service
  ↓
Parse protobuf response
  ↓
Translate back to JSON-RPC 2.0 response
  ↓
HTTP response
```

---

## Method Translation

### Format

Methods follow the pattern: `service.method` or `koinos.rpc.service.method`

Examples:
```
chain.get_head_info        → routes to "chain" service, method "get_head_info"
block_store.get_blocks_by_height → routes to "block_store" service
mempool.get_pending_transactions → routes to "mempool" service
p2p.get_peer_count         → routes to "p2p" service
```

### Translation Process

1. Split method name on `.` (max 3 namespace levels)
2. Identify target service from penultimate segment
3. Construct service-specific protobuf request message
4. Set method field within the service request
5. Serialize params JSON into protobuf fields using descriptor reflection
6. Send via AMQP RPC to target service queue

### Dynamic Schema

The gateway uses **protobuf reflection** (loaded from descriptor files) to dynamically construct request and response messages. No hardcoded service definitions — all routing is descriptor-driven.

---

## Available Methods

The JSON-RPC gateway routes to any microservice. Common methods:

### Chain Service

| Method | Description |
|--------|-------------|
| `chain.get_head_info` | Current head block, LIB, block time |
| `chain.get_chain_id` | Chain identifier |
| `chain.get_fork_heads` | All fork tips |
| `chain.submit_block` | Submit block for validation |
| `chain.submit_transaction` | Submit transaction |
| `chain.read_contract` | Read-only contract call |
| `chain.get_account_nonce` | Account transaction nonce |
| `chain.get_account_rc` | Account resource credits |
| `chain.get_resource_limits` | Global resource limits |
| `chain.invoke_system_call` | Call system function |

### Block Store

| Method | Description |
|--------|-------------|
| `block_store.get_blocks_by_height` | Blocks at height range |
| `block_store.get_blocks_by_id` | Blocks by ID |
| `block_store.get_highest_block` | Highest stored block |

### Mempool

| Method | Description |
|--------|-------------|
| `mempool.get_pending_transactions` | Pending transaction list |
| `mempool.check_pending_account_resources` | RC availability check |
| `mempool.get_reserved_account_rc` | Reserved RC for account |

### P2P

| Method | Description |
|--------|-------------|
| `p2p.get_gossip_status` | Current gossip state |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Missing required fields |
| -32601 | Method not found | Unknown service or method |
| -32602 | Invalid params | Params don't match schema |
| -32603 | Internal error | Server-side failure |
| -32001 | Application error | Service-level error (from microservice) |

---

## Whitelist / Blacklist

Method filtering uses prefix matching:

```yaml
# In config.yml
jsonrpc:
  blacklist:
    - chain.propose_block     # Block production is internal-only
    - block_store.add_block   # Block addition is internal-only
```

Entries are auto-prefixed with `koinos.rpc.` for matching.

Default blacklist (from Koinos config):
- `block_store.add_block` — prevent external block injection
- `chain.propose_block` — prevent external block production

---

## AMQP Integration

### Outbound RPC

For each JSON-RPC request, the gateway:

1. Identifies target service from method name
2. Serializes request as protobuf
3. Sends AMQP RPC to `koinos.rpc.{service}` queue
4. Waits for response with configurable timeout
5. Deserializes protobuf response
6. Translates back to JSON

### Timeouts

| Timeout | Default | Description |
|---------|---------|-------------|
| Gateway timeout | 3s | Time to enqueue request to worker |
| MQ timeout | 5s | Time to wait for AMQP response |

---

## Message Size Limit

Maximum AMQP message size: **536 MB** (512 MiB).

Responses exceeding this limit return an error.

---

## HTTP Details

- **Method:** POST only
- **Content-Type:** `application/json`
- **Supports batch requests:** Multiple JSON-RPC calls in a single HTTP request (JSON array)
- **CORS:** Not configured by default (add via reverse proxy if needed)
- **Default port:** 8080

### Example Request

```bash
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "chain.get_head_info",
    "params": {},
    "id": 1
  }'
```

### Example Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "head_topology": {
      "id": "0x1220...",
      "height": "34392446",
      "previous": "0x1220..."
    },
    "last_irreversible_block": "34392386",
    "head_state_merkle_root": "...",
    "head_block_time": "1774049511600"
  },
  "id": 1
}
```
