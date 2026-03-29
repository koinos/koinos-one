# Remote Node Management — Implementation Plan

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SSH Connection Layer](#2-ssh-connection-layer)
3. [Remote Node Provisioning](#3-remote-node-provisioning)
4. [Remote Node Lifecycle Management](#4-remote-node-lifecycle-management)
5. [Multi-Node Architecture](#5-multi-node-architecture)
6. [Remote Dashboard and Monitoring](#6-remote-dashboard-and-monitoring)
7. [Per-Tab Remote Compatibility Analysis](#7-per-tab-remote-compatibility-analysis)
8. [Security Considerations](#8-security-considerations)
9. [UI Changes](#9-ui-changes)
10. [Docker Compose Specifics](#10-docker-compose-specifics)
11. [Error Handling and Edge Cases](#11-error-handling-and-edge-cases)
12. [Implementation Phases](#12-implementation-phases)
13. [File-Level Change Map](#13-file-level-change-map)

---

## 1. Architecture Overview

### Current Architecture (Single Local Node)

The current architecture is hardwired to a single local node:

- **`electron/main.ts`**: Module-level Maps (`nativeServiceProcesses`, `logsFollowSessions`) and a single `knodelStorage` instance. All service factories instantiated once at module scope.
- **`electron/lib/ipc-handlers.ts`**: `IpcHandlerDeps` accepts a single flat set of function references. Every IPC channel maps to exactly one implementation.
- **`electron/preload.ts`**: `window.knodel` exposes a flat API with no node identifier.
- **`src/App.tsx`**: All state in a single component — `nodeSettings`, `nodeStatus`, etc. are singular values, not keyed by node ID.

### Target Architecture (Multi-Node: Local + N Remote)

A **Node Abstraction Layer** sits between IPC handlers and actual node operations. Each node is identified by a unique `nodeId` string. The local node is always present with `nodeId = 'local'`. Remote nodes get UUIDs.

```
React UI (App.tsx)
  │
  │  window.knodel.koinosNode.status({ nodeId: 'remote-1' })
  ▼
preload.ts (context bridge) — passes nodeId through
  │
  ▼
ipc-handlers.ts — routes to correct NodeBackend by nodeId
  │
  ├── LocalNodeBackend (existing native-runtime-service, logs-service, etc.)
  │
  └── RemoteNodeBackend (ssh-service → docker compose commands on remote)
```

### NodeBackend Interface

```typescript
interface NodeBackend {
  readonly nodeId: string
  readonly type: 'local' | 'remote'
  readonly displayName: string

  status(): Promise<KoinosNodeStatus>
  start(input?): Promise<KoinosNodeCommandResult>
  stop(input?): Promise<KoinosNodeCommandResult>
  serviceAction(action: 'start' | 'stop' | 'restart', serviceId: string): Promise<...>
  logs(input?): Promise<KoinosNodeLogsResult>
  logsFollowStart(sender, input?): Promise<KoinosNodeLogsFollowStartResult>
  logsFollowStop(streamId): Promise<KoinosNodeLogsFollowStopResult>
  fileRead(input): Promise<KoinosNodeFileReadResult>
  fileWrite(input): Promise<KoinosNodeFileWriteResult>
  rpcCall(input?): Promise<KoinosJsonRpcProxyResult>
  dashboardProducers(input?): Promise<...>
  dashboardPeers(input?): Promise<...>
  dashboardPerformance(input?): Promise<...>
  producerOverview(input?): Promise<...>
  backupRestore(input?, sender?): Promise<KoinosNodeBackupRestoreResult>
  dispose(): Promise<void>
}
```

---

## 2. SSH Connection Layer

### 2.1 Library Choice

**`ssh2`** npm package (most mature Node.js SSH2 implementation, ~2M weekly downloads):
- SSH connection with password and private key auth
- SFTP for file transfer
- Port forwarding (tunneling)
- Shell and exec command execution
- No native binary dependencies (pure JS)

### 2.2 Credential Storage

New file: `electron/lib/remote-credentials-store.ts`

- Store in `{userData}/secure-storage/remote-nodes/{nodeId}.json`
- Encrypt SSH private keys and passwords with the same AES-256-GCM + PBKDF2 scheme from `knodel-storage.ts`
- Extract shared crypto utilities from `knodel-storage.ts` into `electron/lib/crypto-utils.ts`

```typescript
type RemoteNodeCredentials = {
  nodeId: string
  host: string
  port: number           // SSH port, default 22
  username: string       // typically 'root'
  authMethod: 'password' | 'key'
  encryptedPassword?: KnodelEncryptedSecret
  encryptedPrivateKey?: KnodelEncryptedSecret
  fingerprint?: string   // SHA-256 of server host key (TOFU)
}
```

### 2.3 SSH Connection Manager

New file: `electron/lib/ssh-connection-manager.ts`

- `Map<nodeId, SSH2Connection>` of active connections
- Max 1 connection per node (SSH multiplexes channels)
- Keepalive: `keepaliveInterval: 10000` (10s), `keepaliveCountMax: 3`
- Auto-reconnect: exponential backoff (1s, 2s, 4s, max 30s), up to 5 attempts
- Timeouts: connection 15s, command execution 60s (configurable)
- Event emission: `connection-state-changed` for UI

```typescript
connect(nodeId, credentials): Promise<void>
disconnect(nodeId): Promise<void>
exec(nodeId, command, opts?): Promise<{ stdout, stderr, exitCode }>
sftp(nodeId): Promise<SFTPWrapper>
tunnel(nodeId, remoteHost, remotePort, localPort): Promise<{ localPort, close }>
getConnectionState(nodeId): 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
```

### 2.4 SSH Tunnel for RPC Access

Remote jsonrpc runs on port 8080 inside Docker. Instead of exposing publicly, Knodel creates an SSH tunnel:

- `local:{randomPort}` → SSH tunnel → `remote:localhost:8080`
- Tunnel created on demand when UI needs RPC access
- All RPC calls go through `http://127.0.0.1:{tunnelPort}/`
- **Only SSH (port 22) needs to be reachable from the user's machine**

---

## 3. Remote Node Provisioning

### 3.1 Provisioning Pipeline

New file: `electron/lib/remote-provisioning-service.ts`

**Step 1: Validate SSH connectivity**
- Connect via SSH
- Verify Linux (`uname -s`)
- Check disk space (`df -BG /`) — minimum 50GB, warn if < 200GB
- Check RAM (`free -m`) — minimum 4GB

**Step 2: Install Docker (if needed)**
```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
docker compose version   # verify
```

**Step 3: Deploy Koinos Docker Compose**
- Create `/opt/koinos/` on remote server
- Upload generated `docker-compose.yml` (see Section 9)
- Upload `.env` and `config.yml`
- Create data directories: `/opt/koinos/data/`
- Pull images: `docker compose pull`

**Step 4: Initial configuration**
- Generate `config.yml` based on selected profiles
- Set P2P seed entries for mainnet
- Set `jsonrpc.listen: 0.0.0.0:8080` (inside Docker only, not host-exposed)
- Map volumes from `/opt/koinos/data/`

**Step 5: Optional blockchain backup restore**
```bash
cd /opt/koinos/data && wget -q <backup_url> -O backup.tar.gz
tar xzf backup.tar.gz && rm backup.tar.gz
```
- Stream download progress back to Knodel UI via SSH output parsing

**Step 6: Start node**
```bash
docker compose up -d
docker compose ps   # verify
```

### 3.2 Progress Reporting

New event channel: `knodel:remote-node:provision-progress:event`

Phases: `validate` → `install-docker` → `deploy-compose` → `configure` → `restore-backup` → `start` → `verify` → `complete`

Each phase sends progress (0-100) and a human-readable message.

### 3.3 Firewall Configuration

During provisioning:
- Open port 8888 (Koinos P2P) — required for blockchain sync
- Do NOT open 8080 (jsonrpc) or 5672 (AMQP) — SSH tunnel only
- Implementation: `ufw allow 8888/tcp` or equivalent iptables rule

---

## 4. Remote Node Lifecycle Management

### 4.1 RemoteNodeBackend

New file: `electron/lib/remote-node-backend.ts`

**Service management via SSH:**
```bash
# Start/Stop all
docker compose -f /opt/koinos/docker-compose.yml up -d
docker compose -f /opt/koinos/docker-compose.yml down

# Per-service
docker compose up -d <serviceId>
docker compose stop <serviceId>
docker compose restart <serviceId>
```

**Status polling:**
```bash
docker compose ps --format json
# → { "Name": "koinos-chain-1", "State": "running", "Status": "Up 2 hours" }
```

Maps to existing `ServiceStatus` type with `runtimeName: 'docker'` instead of `'native'`.

**Log streaming:**
- Tail: `docker compose logs --tail=200 <serviceId>`
- Follow: `docker compose logs -f --tail=50 <serviceId>` via SSH streaming channel
- Chunks piped as `KoinosNodeLogsFollowEvent`

**Config file editing:**
- Read: `cat /opt/koinos/config/config.yml` via SSH exec
- Write: SFTP `writeFile`
- Prompt restart after config changes

**Docker image updates:**
- `docker compose pull` → `docker compose up -d`
- Parse pull output for progress

### 4.2 Status Polling Adaptation

- Longer default interval: 10s (vs 3-5s for local) to account for SSH latency
- Single SSH exec per poll (`docker compose ps --format json`)
- Add `latencyMs` field to status result
- Adaptive: if latency > 500ms, double poll interval

---

## 5. Multi-Node Architecture

### 5.1 Node Registry

New file: `electron/lib/node-registry.ts`

```typescript
type RegisteredNode = {
  nodeId: string
  type: 'local' | 'remote'
  displayName: string
  host?: string
  sshPort?: number
  username?: string
  addedAt: string
  lastConnectedAt?: string
  dockerComposePath?: string  // default /opt/koinos
  profiles: string[]
  provisioningState?: 'incomplete' | 'complete'
}
```

Persisted to `{userData}/config/node-registry.json` (no secrets).

Local node is always entry 0, cannot be removed:
```json
{
  "nodes": [{ "nodeId": "local", "type": "local", "displayName": "Local Node" }],
  "activeNodeId": "local"
}
```

### 5.2 NodeBackend Router

New file: `electron/lib/node-backend-router.ts`

- `Map<string, NodeBackend>` keyed by nodeId
- `LocalNodeBackend` wraps existing services
- N `RemoteNodeBackend` instances
- All IPC handlers refactored to accept `nodeId`, defaulting to `activeNodeId`

```typescript
// Before (single node):
koinosNodeStatus: (input?) => Promise<KoinosNodeStatus>

// After (multi-node):
koinosNodeStatus: (input?: { nodeId?: string; ... }) => Promise<KoinosNodeStatus>
```

### 5.3 New IPC Channels

```
knodel:node-registry:list              → list all registered nodes
knodel:node-registry:add               → add remote node (triggers provisioning)
knodel:node-registry:remove            → remove remote node
knodel:node-registry:set-active        → switch active node
knodel:node-registry:test-connection   → test SSH connectivity
knodel:remote-node:provision           → start provisioning pipeline
knodel:remote-node:connection-state    → get SSH connection state
```

New `window.knodel.nodeRegistry` API:
```typescript
nodeRegistry: {
  list(): Promise<RegisteredNodesResult>
  add(params: AddRemoteNodeParams): Promise<AddRemoteNodeResult>
  remove(params: { nodeId: string }): Promise<RemoveNodeResult>
  setActive(params: { nodeId: string }): Promise<SetActiveNodeResult>
  testConnection(params): Promise<TestConnectionResult>
  onProvisionProgress(listener): () => void
  onConnectionStateChange(listener): () => void
}
```

### 5.4 Renderer State Changes

```typescript
const [registeredNodes, setRegisteredNodes] = useState<RegisteredNode[]>([])
const [activeNodeId, setActiveNodeId] = useState<string>('local')
const [remoteConnectionStates, setRemoteConnectionStates] = useState<Map<string, ConnectionState>>()
const [provisionProgress, setProvisionProgress] = useState<ProvisionProgressState | null>(null)
```

On node switch: clear `nodeStatus`, `nodeSettings`, `dashboardProducers`, etc. and refetch from new backend.

---

## 6. Remote Dashboard and Monitoring

### 6.1 RPC Access Strategy

SSH tunnel per remote node → local RPC access:

1. `rpcSource === 'local'` + `node.type === 'local'` → `http://127.0.0.1:8080/`
2. `rpcSource === 'local'` + `node.type === 'remote'` → `http://127.0.0.1:{tunnelPort}/`
3. `rpcSource` = public URL → use directly (no tunnel)

All existing RPC-based panels (Explorer, Dashboard, Producer, Wallet) work unmodified — they already go through an RPC URL.

### 6.2 Performance Metrics for Remote Nodes

Via SSH commands:
```bash
nproc                                    # CPU count
free -b | grep Mem                       # Memory
df -B1 /opt/koinos/data | tail -1       # Disk
cat /proc/loadavg                        # Load average
docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"  # Per-container
```

Parsed into existing `KoinosNodeDashboardPerformanceResult` type.

### 6.3 Producer Management on Remote Nodes

1. User generates/provides producer key pair in Knodel
2. Knodel uploads private key to remote via SFTP (`/opt/koinos/data/block_producer/private.key`)
3. Updates remote `config.yml` with key path
4. Registration transaction submitted via RPC through SSH tunnel using Knodel's wallet

---

## 7. Per-Tab Remote Compatibility Analysis

Every existing UI tab must work transparently when the user switches to a remote node. This section details what each tab currently depends on, what works as-is, and what the `RemoteNodeBackend` must implement.

### 7.1 Compatibility Matrix

| Tab / Feature | Data Source | Works As-Is? | RemoteNodeBackend Requirement |
|---------------|------------|--------------|-------------------------------|
| Explorer | RPC (`chain.get_head_info`, `get_blocks_by_id`) | ✅ Yes | RPC via SSH tunnel |
| Block Detail Dialog | RPC (`chain.get_blocks_by_id`) | ✅ Yes | RPC via SSH tunnel |
| Dashboard: Producers | `bridge.dashboardProducers()` → main.ts → RPC | ⚠️ Needs routing | `dashboardProducers()` via RPC through tunnel |
| Dashboard: Peers | `bridge.dashboardPeers()` → main.ts → P2P log parsing | ❌ No | Parse `docker compose logs p2p` via SSH |
| Dashboard: Forecast | `bridge.producerOverview()` → RPC + local key | ⚠️ Partial | RPC through tunnel + SFTP for key reading |
| Dashboard: Performance | `bridge.dashboardPerformance()` → local host metrics | ❌ No | SSH commands (`free`, `df`, `nproc`, `docker stats`) |
| Wallet | `getWalletBridge()` → local encrypted storage | ✅ Yes (always local) | N/A — wallet stays local, balance queries use RPC |
| Producer: Overview | `bridge.producerOverview()` → RPC + local key | ⚠️ Partial | RPC through tunnel + SFTP for remote key |
| Producer: Register | `bridge.producerRegister()` → RPC tx broadcast | ⚠️ Partial | SFTP to upload key + RPC for registration tx |
| Producer: Local Info | `bridge.producerLocalInfo()` → reads local key file | ❌ No | SFTP read from `/opt/koinos/data/block_producer/` |
| Microservices: Status | `bridge.status()` → PID/port checks | ❌ No | `docker compose ps --format json` via SSH |
| Microservices: Start/Stop | `bridge.serviceAction()` → child process | ❌ No | `docker compose up/stop/restart` via SSH |
| Microservices: Config | `bridge.fileRead/fileWrite()` → local filesystem | ❌ No | SFTP read/write to `/opt/koinos/config/` |
| Node File Editor | `bridge.fileRead/fileWrite()` → local filesystem | ❌ No | SFTP read/write |
| Settings: General | localStorage | ✅ Yes | N/A |
| Settings: Explorer | localStorage | ✅ Yes | N/A |
| Settings: Dashboard | localStorage | ✅ Yes | N/A |
| Settings: Backup (create) | `bridge.createBackup()` → local tar | ❌ No | SSH exec tar on remote server |
| Settings: Backup (restore) | `bridge.restoreLocalBackup()` → local tar | ❌ No | SSH exec wget+tar on remote, or SFTP upload |
| Node Logs | `bridge.logs/logsFollowStart()` → child stdout | ❌ No | `docker compose logs -f` via SSH streaming |

### 7.2 Detailed Gap Analysis

#### Gap 1: Dashboard Peers

**Current implementation:** `dashboardPeers()` in `producer-service.ts` calls `bridge.logs()` to tail the P2P service logs and parses peer connection entries (IP, agent, height).

**Remote implementation required:**
```bash
# Fetch recent P2P logs
docker compose -f /opt/koinos/docker-compose.yml logs --tail=2000 p2p 2>&1
```
- Parse the same log format from Docker output
- The log format is identical (same Koinos P2P binary running inside Docker)
- Add `--since=1h` flag to limit log volume over SSH
- `RemoteNodeBackend.dashboardPeers()` must: SSH exec → parse logs → return same `KoinosNodeDashboardPeersResult`

#### Gap 2: Dashboard Performance (per-container metrics)

**Current implementation:** `dashboardPerformance()` reads host CPU/memory/disk via local commands.

**Remote implementation required:**
```bash
# Host metrics
nproc                                              # CPU count
free -b | grep Mem                                 # Total/used/free RAM
df -B1 /opt/koinos/data | tail -1                 # Disk usage
cat /proc/loadavg                                  # Load average
cat /proc/uptime                                   # Uptime seconds

# Per-container metrics (single call, no streaming)
docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'
```
- Batch all commands in a single SSH exec with `&&` to minimize roundtrips
- Parse `docker stats` output into per-service metrics
- Map container names (`koinos-chain-1`) to service IDs (`chain`)
- Return as `KoinosNodeDashboardPerformanceResult` with added `services[]` array for per-container breakdown

#### Gap 3: Config File Editor (SFTP)

**Current implementation:** `NodeFileEditorModal` calls `bridge.fileRead({ kind: 'config' })` which reads `{baseDir}/config.yml` from local filesystem.

**Remote implementation required:**
- `RemoteNodeBackend.fileRead()`:
  ```typescript
  const sftp = await sshManager.sftp(nodeId)
  const content = await sftp.readFile('/opt/koinos/config/config.yml', 'utf8')
  return { ok: true, content, filePath: '/opt/koinos/config/config.yml' }
  ```
- `RemoteNodeBackend.fileWrite()`:
  ```typescript
  const sftp = await sshManager.sftp(nodeId)
  await sftp.writeFile('/opt/koinos/config/config.yml', content, 'utf8')
  return { ok: true }
  ```
- After write, prompt user to restart affected services (same UX as local)
- The `MicroservicesConfigPanel` YAML editor works unmodified — it only cares about the string content, not how it's fetched

#### Gap 4: Remote Backup Operations (Post-Provisioning)

**Current implementation:** `createLocalBackup()` stops services, runs `tar -czf` locally, checks disk space, generates SHA-256. `restoreFromLocalFile()` opens file picker, extracts tar to BASEDIR.

**Remote backup create:**
```bash
# Stop services
cd /opt/koinos && docker compose down

# Check disk space
df -B1 /opt/koinos/data | tail -1

# Create backup (tar runs on remote server — fast, no network transfer)
tar -czf /opt/koinos/backups/koinos_backup_$(date +%Y-%m-%d).tar.gz \
  -C /opt/koinos/data chain block_store

# Generate checksum
sha256sum /opt/koinos/backups/koinos_backup_*.tar.gz

# Restart
cd /opt/koinos && docker compose up -d
```
- Progress: poll file size via `stat -c %s /opt/koinos/backups/koinos_backup_*.tar.gz` every 2s
- No need to transfer the backup to the user's machine (stays on server)
- Optional: offer SFTP download if user wants a local copy

**Remote backup restore:**
Two modes:
1. **From URL (on remote):** `wget` + `tar` directly on the server — fast, no user upload
   ```bash
   cd /opt/koinos && docker compose down
   cd /opt/koinos/data && wget -q <url> -O backup.tar.gz && tar xzf backup.tar.gz && rm backup.tar.gz
   cd /opt/koinos && docker compose up -d
   ```
2. **From local file (upload):** User picks a local `.tar.gz` → SFTP upload to remote → extract
   - Much slower (network transfer of ~24GB)
   - Progress: monitor SFTP upload bytes transferred
   - After upload: SSH exec `tar xzf` on remote

**Remote backup UI changes in SettingsPanel:**
- "Create remote backup" button → runs tar on server, shows path + size when done
- "Download backup" button → SFTP download to local (optional)
- "Restore from URL" → wget on server (fast)
- "Upload and restore" → SFTP upload + extract (slow, show upload progress)

#### Gap 5: Node Logs Streaming

**Current implementation:** `logsFollowStart()` attaches to `childProcess.stdout/stderr` of native services.

**Remote implementation required:**
```bash
docker compose -f /opt/koinos/docker-compose.yml logs -f --tail=50 <serviceId> 2>&1
```
- Use SSH exec with `stream: true` option from ssh2 library
- Pipe stdout chunks as `KoinosNodeLogsFollowEvent` to renderer via `webContents.send`
- Handle `logsFollowStop()` by killing the SSH exec channel
- Support multiple concurrent log streams (one per service) via separate SSH channels on the same connection
- Color/ANSI codes: Docker compose logs include ANSI colors — the existing `renderAnsiLog()` in `utils.tsx` already handles this

#### Gap 6: Producer Key Management on Remote

**Current implementation:** `producerLocalInfo()` reads the producer public key from `{baseDir}/block_producer/public.key`.

**Remote implementation required:**
- Read key: SFTP read `/opt/koinos/data/block_producer/public.key`
- Upload key: When user registers as producer from Knodel's wallet, generate key pair locally, SFTP upload private key to `/opt/koinos/data/block_producer/private.key`
- Security: the private key transit is encrypted (SSH/SFTP), and stored encrypted at rest on the remote server via Docker volume permissions
- `producerRegisteredKey()` works unmodified — it's a pure RPC call to the blockchain

### 7.3 What Needs NO Changes

These work transparently because they either use RPC (routed through SSH tunnel) or are purely local:

1. **Explorer Panel** — all RPC, tunnel-compatible
2. **Block Detail Dialog** — all RPC, tunnel-compatible
3. **Wallet Panel** — wallet is always local to Knodel; balance queries go through RPC
4. **Settings: General/Explorer/Dashboard tabs** — localStorage only
5. **i18n / theme / language** — renderer-only, no node dependency
6. **Transaction signing and broadcast** — signing is local (wallet), broadcast goes through RPC

### 7.4 NodeBackend Method Coverage

Every method in the `NodeBackend` interface maps to a specific remote implementation:

| NodeBackend Method | Remote Implementation |
|---|---|
| `status()` | `docker compose ps --format json` via SSH |
| `start()` | `docker compose up -d` via SSH |
| `stop()` | `docker compose down` via SSH |
| `serviceAction(action, id)` | `docker compose {up -d\|stop\|restart} {id}` via SSH |
| `logs(input)` | `docker compose logs --tail=N {id}` via SSH |
| `logsFollowStart(sender, input)` | `docker compose logs -f --tail=50 {id}` via SSH stream |
| `logsFollowStop(streamId)` | Kill SSH exec channel |
| `fileRead(input)` | SFTP read from `/opt/koinos/config/` |
| `fileWrite(input)` | SFTP write to `/opt/koinos/config/` |
| `rpcCall(input)` | HTTP fetch through SSH tunnel to `localhost:8080` |
| `dashboardProducers(input)` | RPC through SSH tunnel |
| `dashboardPeers(input)` | `docker compose logs p2p` via SSH → parse |
| `dashboardPerformance(input)` | `free`, `df`, `nproc`, `docker stats` via SSH |
| `producerOverview(input)` | RPC through tunnel + SFTP for key reading |
| `backupCreate()` | SSH exec `tar -czf` on remote server |
| `backupRestore(input)` | SSH exec `wget`+`tar` or SFTP upload + `tar` |
| `dispose()` | Close SSH tunnel + connection |

---

## 8. Security Considerations

### 7.1 SSH Key Management

- Private keys encrypted at rest (AES-256-GCM, same as wallet)
- Decrypted only during active SSH session, held in memory
- On app shutdown, connections closed, decrypted keys dereferenced
- Support RSA and Ed25519 keys
- Option to generate SSH key pair within Knodel

### 7.2 Network Security

| Port | Exposed? | Access method |
|------|----------|---------------|
| 22 (SSH) | Yes | Direct |
| 8888 (P2P) | Yes | Direct (blockchain sync) |
| 8080 (jsonrpc) | **No** | SSH tunnel only |
| 5672 (AMQP) | **No** | Docker internal only |
| 50051 (gRPC) | **No** | SSH tunnel (if needed) |

### 7.3 Host Key Verification (TOFU)

- First connection: display server fingerprint (SHA-256) to user
- Store fingerprint in node registry
- Subsequent connections: verify match
- Mismatch → alert (possible MITM), refuse connection unless user accepts

### 7.4 Audit Logging

- Log all SSH commands (command, timestamp, exit code) to `{userData}/logs/remote-audit-{nodeId}.log`
- Rotate at 10MB
- **Never** log passwords or key material

---

## 9. UI Changes

### 8.1 Node Selector Component

`src/components/NodeSelector.tsx` — always visible in header/footer:

- Dropdown showing all nodes with connection status
- Per entry: display name, type icon (local/remote), status dot (green/yellow/red), latency badge
- Click to switch `activeNodeId`
- "Add Remote Node" button → opens setup wizard

### 8.2 Remote Node Setup Wizard

`src/components/panels/RemoteNodeSetupWizard.tsx` — 4-step wizard:

**Step 1: Server Connection**
- Fields: Display name, IP/hostname, SSH port (default 22), Username (default root)
- Auth toggle: Password or SSH Key (file picker + passphrase)
- "Test Connection" button → shows OS, disk, RAM

**Step 2: Docker Verification**
- Shows Docker status on remote
- "Install Docker" button with progress if needed

**Step 3: Node Configuration**
- Profile selection (same UI as local)
- Backup restore option for fast sync
- Optional config.yml editor

**Step 4: Deploy and Start**
- Progress bar for all provisioning phases
- Real-time log output
- Success → "Open Node Dashboard"

### 8.3 Remote-Specific Indicators

**App Footer:** Active node name, connection state icon, latency

**All panels:** Connection-lost banner with "Reconnect" button when remote node disconnects

**Settings panel:** New "Remote Nodes" tab for managing remote nodes (edit name, update credentials, remove)

### 8.4 i18n

Add all new keys to `src/i18n.ts` (EN + ES):
- `node.selector.*` — node selector labels
- `remote.*` — wizard, provisioning, connection states
- `settings.tabRemoteNodes` — settings tab
- `remote.provision.*` — provisioning phase messages
- Error messages for SSH/Docker failures

---

## 10. Docker Compose Specifics

### 9.1 Docker Images

Official Koinos images from Docker Hub:

```
koinos/koinos-chain
koinos/koinos-mempool
koinos/koinos-block-store
koinos/koinos-p2p
koinos/koinos-block-producer
koinos/koinos-jsonrpc
koinos/koinos-grpc
koinos/koinos-transaction-store
koinos/koinos-contract-meta-store
koinos/koinos-account-history
rabbitmq:3-management-alpine
```

### 9.2 docker-compose.yml Generation

New file: `electron/lib/remote-compose-generator.ts`

Key decisions:
- All services use `latest` tag (user can pin versions)
- AMQP binds only to `127.0.0.1` and internal Docker network
- jsonrpc binds to `0.0.0.0:8080` inside Docker (not published to host)
- P2P published: `ports: ["8888:8888"]`
- Data volumes: `/opt/koinos/data/{service}/`
- Config volume: `/opt/koinos/config/`
- Healthchecks for AMQP, chain, jsonrpc
- `restart: unless-stopped`
- `depends_on` with `condition: service_healthy` for AMQP

### 9.3 Volume Layout

```
/opt/koinos/
├── docker-compose.yml
├── .env
├── config/
│   └── config.yml
└── data/
    ├── chain/
    ├── block_store/
    ├── mempool/
    ├── p2p/
    ├── block_producer/
    ├── account_history/
    ├── transaction_store/
    ├── contract_meta_store/
    └── amqp/
```

### 9.4 Resource Limits (Optional)

```yaml
services:
  chain:
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2.0'
```

Default: no limits. Configurable via advanced settings.

---

## 11. Error Handling and Edge Cases

### 10.1 Lost SSH Connection During Operation

- All SSH exec calls wrapped with timeout (60s default)
- On connection drop: reject with `ConnectionLostError`, begin auto-reconnect
- UI shows "Connection lost" banner
- Docker containers **keep running independently** — they don't stop when Knodel disconnects

### 10.2 Remote Server Out of Disk Space

- Provisioning: check disk before deploying, fail early
- Runtime: periodic performance polling includes disk usage
  - < 10GB free → warning
  - < 2GB free → critical alert
- Crashed containers visible in status poll → show last error from `docker compose logs`

### 10.3 Docker Daemon Not Running

- Detect: `systemctl is-active docker`
- "Restart Docker" button → `systemctl restart docker` via SSH
- Clear error message distinguishing Docker-down from network-down

### 10.4 Partial Deployment Recovery

- Each provisioning step is **idempotent**
- Incomplete nodes stored with `provisioningState: 'incomplete'`
- Retry picks up from where it left off
- User can also remove and start fresh

### 10.5 Network Latency Impact

- All remote operations show loading indicators
- If latency > 500ms, automatically double poll interval
- Batch SSH commands where possible (`docker compose ps && docker stats --no-stream`)
- Log streaming uses SSH channel streaming, not repeated execs

### 10.6 App Shutdown

- Close all SSH connections gracefully
- **Do NOT stop remote Docker containers** — they keep running independently
- Only stop local node services (existing behavior)

---

## 12. Implementation Phases

### Phase 1: Node Abstraction Layer (Foundation)

Refactor existing code to support `NodeBackend` interface. No remote functionality yet — app works exactly as before through the new abstraction.

1. Create `NodeBackend` interface definition
2. Create `LocalNodeBackend` wrapping existing services
3. Create `NodeRegistry` with local-only registry
4. Create `NodeBackendRouter` (nodeId → backend)
5. Refactor `IpcHandlerDeps` to use router
6. Add optional `nodeId` to all IPC input types
7. Update preload, type declarations
8. Add `registeredNodes` + `activeNodeId` state to App.tsx

**Verification:** App behavior identical. No visible UI changes.

### Phase 2: SSH Layer + Basic Connection

1. `npm install ssh2 @types/ssh2`
2. Create `SSHConnectionManager`
3. Extract crypto utils from `knodel-storage.ts`
4. Create `RemoteCredentialsStore`
5. Register node-registry IPC handlers
6. Add `NodeSelector` component
7. Basic "Add Remote Node" form (connection only)
8. Connection state display

**Verification:** User can add remote server, see it in selector, see connection status.

### Phase 3: Remote Provisioning

1. Create `RemoteProvisioningService`
2. Create `RemoteComposeGenerator`
3. Full provisioning pipeline
4. Setup wizard (4 steps)
5. Remote backup restore
6. Firewall configuration

**Verification:** User can provision a fresh Ubuntu server into a running Koinos node.

### Phase 4: Remote Node Backend

1. Create `RemoteNodeBackend` implementing `NodeBackend`
2. SSH tunnel management for RPC
3. Status via `docker compose ps`
4. Start/stop/restart via `docker compose`
5. Log streaming via SSH
6. Config read/write via SSH/SFTP
7. Dashboard performance via SSH system commands + `docker stats`
8. Producer overview with remote key reading

**Verification:** All existing panels work against remote nodes.

### Phase 5: Polish

1. Auto-reconnect with backoff
2. Graceful SSH disconnection handling
3. Disk space monitoring
4. Docker health checking
5. Partial provisioning recovery
6. Latency display + adaptive polling
7. App shutdown handling
8. Audit logging, host key verification (TOFU)
9. Full EN + ES i18n
10. Settings "Remote Nodes" tab
11. Docker image updates

### Phase 6: Advanced (Post-MVP)

1. Multi-node dashboard (all nodes overview)
2. SSH key generation in Knodel
3. Per-service resource limits UI
4. Alert system (node down notifications)
5. Bulk operations across nodes
6. Node cloning from backup

---

## 13. File-Level Change Map

### New Files

| File | Purpose |
|------|---------|
| `electron/lib/node-backend.ts` | NodeBackend interface + shared types |
| `electron/lib/local-node-backend.ts` | Wraps existing services into NodeBackend |
| `electron/lib/remote-node-backend.ts` | NodeBackend via SSH + Docker |
| `electron/lib/node-backend-router.ts` | Routes nodeId → backend |
| `electron/lib/node-registry.ts` | Persisted node registry |
| `electron/lib/ssh-connection-manager.ts` | SSH2 connections, tunnels, keepalive |
| `electron/lib/remote-credentials-store.ts` | Encrypted SSH credentials |
| `electron/lib/remote-provisioning-service.ts` | Docker install, compose deploy |
| `electron/lib/remote-compose-generator.ts` | Generate docker-compose.yml |
| `electron/lib/crypto-utils.ts` | Extracted AES-256-GCM encrypt/decrypt |
| `src/components/NodeSelector.tsx` | Node switcher dropdown |
| `src/components/panels/RemoteNodeSetupWizard.tsx` | Multi-step setup wizard |

### Modified Files

| File | Change |
|------|--------|
| `electron/main.ts` | Extract local logic into LocalNodeBackend, instantiate router |
| `electron/lib/ipc-handlers.ts` | Use NodeBackend router, add node-registry handlers |
| `electron/lib/main-types.ts` | Add `nodeId` to input types, remote node types |
| `electron/preload.ts` | Add `nodeRegistry` namespace, pass `nodeId` |
| `electron/lib/knodel-storage.ts` | Extract crypto utils |
| `electron/lib/constants.ts` | Remote constants (SSH port, Docker paths, timeouts) |
| `src/App.tsx` | Multi-node state, node switching, event listeners |
| `src/app/types.ts` | RegisteredNode, ProvisionProgressState |
| `src/app/utils.tsx` | RPC URL resolution for tunnel ports |
| `src/knodel-electron.d.ts` | nodeId in params, nodeRegistry API types |
| `src/i18n.ts` | EN + ES for all remote node strings |
| `src/components/panels/SettingsPanel.tsx` | "Remote Nodes" tab |
| `src/components/panels/MicroservicesConfigPanel.tsx` | Docker runtime display |
| `package.json` | Add `ssh2` dependency |

---

## Expected Effort

| Phase | Estimated Scope | Files |
|-------|----------------|-------|
| Phase 1: Abstraction | ~15-20 files, refactoring only | 15 |
| Phase 2: SSH + Connection | 6 new + 5 modified | 11 |
| Phase 3: Provisioning | 3 new + 3 modified | 6 |
| Phase 4: Full Backend | 1 new + 8 modified | 9 |
| Phase 5: Polish | ~12 modified | 12 |
| **Total** | **12 new files, ~25 modified** | — |
