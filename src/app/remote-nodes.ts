import type { KoinosNetworkId } from './network'
import { publicBootstrapUrlForNetwork } from './public-bootstrap'

export type RemoteNodeRole = 'observer' | 'producer' | 'standby' | 'public-bootstrap-source' | 'private-backup-source'
export type RemoteNodeRuntimeKind = 'docker' | 'systemd'
export type RemoteNodeHealthState =
  | 'unknown'
  | 'needs-server'
  | 'needs-space'
  | 'installing'
  | 'restoring'
  | 'starting'
  | 'syncing'
  | 'healthy'
  | 'degraded'
  | 'unsafe'
  | 'stopped'
  | 'failed'
export type RemoteNodeInstallStatus = 'planned' | 'installed' | 'needs-upgrade' | 'unknown'
export type RemoteNodeRestoreStatus = 'not-restored' | 'restored' | 'needs-restore' | 'unknown'

export type RemoteFleetNode = {
  id: string
  label: string
  network: KoinosNetworkId
  role: RemoteNodeRole
  environment: string
  hostRef: string
  connectionRef: string
  runtime: {
    kind: RemoteNodeRuntimeKind
    image: string
    expectedVersion: string
    serviceName: string
  }
  paths: {
    baseDir: string
    config: string
  }
  ports: {
    jsonrpcHostBind: string
    p2pPublic: string
    backupAdminListen: string
  }
  backup: {
    publicBootstrapUrl: string
    privateBackupPolicyRef: string
  }
  producer: {
    enabled: boolean
    profileRef: string
  }
  safety: {
    observerFirstRequired: boolean
    mainnetMutationAllowed: boolean
    remoteAdminPublicExposureAllowed: boolean
  }
  status: {
    installStatus: RemoteNodeInstallStatus
    restoreStatus: RemoteNodeRestoreStatus
    version: string
    health: RemoteNodeHealthState
    lastCheck: string
  }
}

export type RemoteFleetInventory = {
  version: 1
  nodes: RemoteFleetNode[]
}

export type RemoteFleetInventoryInput = {
  version?: 1
  nodes?: Array<Partial<RemoteFleetNode>>
}

export type RemoteNodeAction =
  | 'install-observer'
  | 'restore-public-bootstrap'
  | 'start-observer'
  | 'status'
  | 'logs'
  | 'stop'
  | 'restart'
  | 'upgrade'
  | 'rollback'
  | 'cleanup'

export type RemotePlanNoticeCode =
  | 'observerFirstRequired'
  | 'producerUnavailable'
  | 'mainnetMutationBlocked'
  | 'publicAdminBlocked'
  | 'jsonrpcPublicBlocked'
  | 'rawHostRefBlocked'
  | 'secretReferenceBlocked'
  | 'duplicateNodeId'
  | 'duplicateBaseDir'
  | 'duplicatePort'
  | 'duplicateProducerProfile'
  | 'publicBootstrapMissing'
  | 'destructiveConfirmationRequired'
  | 'prodnetConfirmationRequired'
  | 'dryRunOnly'

export type RemotePlanNotice = {
  code: RemotePlanNoticeCode
  field?: string
  value?: string
}

export type RemotePlanPhase =
  | 'preflight'
  | 'artifact'
  | 'prepare'
  | 'config'
  | 'bootstrap'
  | 'runtime'
  | 'verify'
  | 'diagnostics'
  | 'rollback'
  | 'cleanup'

export type RemoteCommandStep = {
  phase: RemotePlanPhase
  command: string
  hostMutation: boolean
  chainMutation: boolean
  destructive: boolean
}

export type RemoteCommandPlan = {
  action: RemoteNodeAction
  nodeId: string
  blocked: boolean
  notices: RemotePlanNotice[]
  steps: RemoteCommandStep[]
}

const DEFAULT_IMAGE = 'ghcr.io/pgarciagon/teleno-node:beta'
const DEFAULT_VERSION = '<teleno_node-version-or-commit>'
const DEFAULT_TESTNET_JSONRPC_BIND = '127.0.0.1:18122'
const DEFAULT_MAINNET_JSONRPC_BIND = '127.0.0.1:18080'
const DEFAULT_TESTNET_P2P_PUBLIC = '28890'
const DEFAULT_MAINNET_P2P_PUBLIC = '18889'
const DEFAULT_TESTNET_BACKUP_ADMIN = '127.0.0.1:18188'
const DEFAULT_MAINNET_BACKUP_ADMIN = '127.0.0.1:18088'
const TESTNET_P2P_PEERS = [
  '/dns4/testnet.koinosfoundation.org/tcp/8888/p2p/QmYV414G6xRzkSUytntEsBsCSjXrVGubfYJn4vpeER2s2W'
]
const MAINNET_P2P_PEERS = [
  '/ip4/46.62.204.73/tcp/8888/p2p/QmPcF1YrxamfKGpyvP6uAZcPxnmK2WUBC4K4N5ZaWky8Sh',
  '/ip4/37.27.7.221/tcp/8888/p2p/QmY8NBHwoVrxBvrjS3wQoeTmWG4UUKMxmYHss7QYRXktrs',
  '/ip4/95.216.68.185/tcp/8888/p2p/QmeTy5SE79ksZruNZ1DJJqR6UCe1oZvWcYaUnn6MuYE8Ea',
  '/ip4/46.62.245.240/tcp/8888/p2p/QmWmxqE6WhcMWZEKwqUAbu87Qgm6JroZLdM4Xmxouu1Mmi',
  '/ip4/94.130.148.114/tcp/8888/p2p/QmQ841mUuYeCtbZXdEMeKcYCx4CZydgz84zSDqWVCeJ4H8'
]

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeNetwork(value: unknown): KoinosNetworkId {
  return value === 'testnet' || value === 'custom' ? value : 'mainnet'
}

function safeRole(value: unknown): RemoteNodeRole {
  if (
    value === 'producer' ||
    value === 'standby' ||
    value === 'public-bootstrap-source' ||
    value === 'private-backup-source'
  ) {
    return value
  }
  return 'observer'
}

function safeRuntimeKind(value: unknown): RemoteNodeRuntimeKind {
  return value === 'systemd' ? 'systemd' : 'docker'
}

export function recommendedRemoteBaseDir(network: KoinosNetworkId, id: string): string {
  return `~/koinos-one/nodes/${network}/${id}/basedir`
}

function defaultJsonRpcBind(network: KoinosNetworkId): string {
  return network === 'testnet' ? DEFAULT_TESTNET_JSONRPC_BIND : DEFAULT_MAINNET_JSONRPC_BIND
}

function defaultP2pPublic(network: KoinosNetworkId): string {
  return network === 'testnet' ? DEFAULT_TESTNET_P2P_PUBLIC : DEFAULT_MAINNET_P2P_PUBLIC
}

function defaultBackupAdminListen(network: KoinosNetworkId): string {
  return network === 'testnet' ? DEFAULT_TESTNET_BACKUP_ADMIN : DEFAULT_MAINNET_BACKUP_ADMIN
}

function defaultNode(id: string, network: KoinosNetworkId): RemoteFleetNode {
  const baseDir = recommendedRemoteBaseDir(network, id)
  return {
    id,
    label: id,
    network,
    role: 'observer',
    environment: network === 'mainnet' ? 'prodnet' : network,
    hostRef: `host-${id}`,
    connectionRef: `ssh-${id}`,
    runtime: {
      kind: 'docker',
      image: DEFAULT_IMAGE,
      expectedVersion: DEFAULT_VERSION,
      serviceName: ''
    },
    paths: {
      baseDir,
      config: `${baseDir}/config.yml`
    },
    ports: {
      jsonrpcHostBind: defaultJsonRpcBind(network),
      p2pPublic: defaultP2pPublic(network),
      backupAdminListen: defaultBackupAdminListen(network)
    },
    backup: {
      publicBootstrapUrl: publicBootstrapUrlForNetwork(network) || '<public-bootstrap-url>',
      privateBackupPolicyRef: ''
    },
    producer: {
      enabled: false,
      profileRef: ''
    },
    safety: {
      observerFirstRequired: true,
      mainnetMutationAllowed: false,
      remoteAdminPublicExposureAllowed: false
    },
    status: {
      installStatus: 'planned',
      restoreStatus: 'not-restored',
      version: DEFAULT_VERSION,
      health: 'unknown',
      lastCheck: ''
    }
  }
}

export function defaultRemoteFleetInventory(): RemoteFleetInventory {
  return {
    version: 1,
    nodes: [
      {
        ...defaultNode('prodnet-observer-a', 'mainnet'),
        label: 'Prodnet Observer A'
      },
      {
        ...defaultNode('testnet-observer-a', 'testnet'),
        label: 'Testnet Observer A',
        environment: 'testnet'
      }
    ]
  }
}

export function normalizeRemoteFleetNode(input: Partial<RemoteFleetNode> = {}): RemoteFleetNode {
  const id = safeText(input.id, 'remote-node')
  const network = safeNetwork(input.network)
  const base = defaultNode(id, network)
  const baseDir = safeText(input.paths?.baseDir, base.paths.baseDir)

  return {
    ...base,
    ...input,
    id,
    label: safeText(input.label, base.label),
    network,
    role: safeRole(input.role),
    environment: safeText(input.environment, base.environment),
    hostRef: safeText(input.hostRef, base.hostRef),
    connectionRef: safeText(input.connectionRef, base.connectionRef),
    runtime: {
      kind: safeRuntimeKind(input.runtime?.kind),
      image: safeText(input.runtime?.image, base.runtime.image),
      expectedVersion: safeText(input.runtime?.expectedVersion, base.runtime.expectedVersion),
      serviceName: safeText(input.runtime?.serviceName, base.runtime.serviceName)
    },
    paths: {
      baseDir,
      config: safeText(input.paths?.config, `${baseDir}/config.yml`)
    },
    ports: {
      jsonrpcHostBind: safeText(input.ports?.jsonrpcHostBind, base.ports.jsonrpcHostBind),
      p2pPublic: safeText(input.ports?.p2pPublic, base.ports.p2pPublic),
      backupAdminListen: safeText(input.ports?.backupAdminListen, base.ports.backupAdminListen)
    },
    backup: {
      publicBootstrapUrl: safeText(input.backup?.publicBootstrapUrl, base.backup.publicBootstrapUrl),
      privateBackupPolicyRef: safeText(input.backup?.privateBackupPolicyRef)
    },
    producer: {
      enabled: input.producer?.enabled === true,
      profileRef: safeText(input.producer?.profileRef)
    },
    safety: {
      observerFirstRequired: input.safety?.observerFirstRequired !== false,
      mainnetMutationAllowed: input.safety?.mainnetMutationAllowed === true,
      remoteAdminPublicExposureAllowed: input.safety?.remoteAdminPublicExposureAllowed === true
    },
    status: {
      installStatus: input.status?.installStatus ?? base.status.installStatus,
      restoreStatus: input.status?.restoreStatus ?? base.status.restoreStatus,
      version: safeText(input.status?.version, base.status.version),
      health: input.status?.health ?? base.status.health,
      lastCheck: safeText(input.status?.lastCheck)
    }
  }
}

export function normalizeRemoteFleetInventory(input?: RemoteFleetInventoryInput): RemoteFleetInventory {
  if (!input?.nodes?.length) return defaultRemoteFleetInventory()
  return {
    version: 1,
    nodes: input.nodes.map((node) => normalizeRemoteFleetNode(node))
  }
}

function looksLikeRawHostReference(value: string): boolean {
  return /@/.test(value) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value) || /\.[a-z]{2,}\b/i.test(value)
}

function looksLikeSecretReference(value: string): boolean {
  return /(password|passwd|private.?key|token|secret|seed|wif)/i.test(value)
}

function isLoopbackBind(value: string): boolean {
  return value.startsWith('127.0.0.1:') || value.startsWith('localhost:')
}

function addDuplicateNotices(
  nodes: RemoteFleetNode[],
  notices: RemotePlanNotice[],
  selector: (node: RemoteFleetNode) => string,
  code: RemotePlanNoticeCode,
  field: string,
  scopeSelector?: (node: RemoteFleetNode) => string
) {
  const seen = new Map<string, string>()
  for (const node of nodes) {
    const value = selector(node)
    if (!value || value.includes('<')) continue
    const scope = scopeSelector ? scopeSelector(node) : ''
    const scopedValue = `${scope}\u0000${value}`
    const existing = seen.get(scopedValue)
    if (existing) {
      notices.push({ code, field, value: scope ? `${existing}, ${node.id} on ${scope}: ${value}` : `${existing}, ${node.id}: ${value}` })
    } else {
      seen.set(scopedValue, node.id)
    }
  }
}

function hostConflictScope(node: RemoteFleetNode): string {
  return node.connectionRef || node.hostRef || node.id
}

export function validateRemoteFleetInventory(inventory: RemoteFleetInventory): RemotePlanNotice[] {
  const notices: RemotePlanNotice[] = []

  for (const node of inventory.nodes) {
    if (!node.safety.observerFirstRequired) notices.push({ code: 'observerFirstRequired', field: node.id })
    if (node.safety.mainnetMutationAllowed) notices.push({ code: 'mainnetMutationBlocked', field: node.id })
    if (node.safety.remoteAdminPublicExposureAllowed) notices.push({ code: 'publicAdminBlocked', field: node.id })
    if (node.producer.enabled || node.role === 'producer') notices.push({ code: 'producerUnavailable', field: node.id })
    if (!isLoopbackBind(node.ports.jsonrpcHostBind)) {
      notices.push({ code: 'jsonrpcPublicBlocked', field: `${node.id}.ports.jsonrpcHostBind`, value: node.ports.jsonrpcHostBind })
    }
    if (node.ports.backupAdminListen && !isLoopbackBind(node.ports.backupAdminListen)) {
      notices.push({ code: 'publicAdminBlocked', field: `${node.id}.ports.backupAdminListen`, value: node.ports.backupAdminListen })
    }
    if (looksLikeRawHostReference(node.hostRef) || looksLikeRawHostReference(node.connectionRef)) {
      notices.push({ code: 'rawHostRefBlocked', field: node.id, value: node.hostRef })
    }

    const valuesToScan = [
      node.hostRef,
      node.connectionRef,
      node.runtime.serviceName,
      node.paths.baseDir,
      node.paths.config,
      node.backup.privateBackupPolicyRef,
      node.producer.profileRef
    ]
    for (const value of valuesToScan) {
      if (looksLikeSecretReference(value)) notices.push({ code: 'secretReferenceBlocked', field: node.id, value })
    }
    if (!node.backup.publicBootstrapUrl) notices.push({ code: 'publicBootstrapMissing', field: node.id })
  }

  addDuplicateNotices(inventory.nodes, notices, (node) => node.id, 'duplicateNodeId', 'id')
  addDuplicateNotices(inventory.nodes, notices, (node) => node.paths.baseDir, 'duplicateBaseDir', 'paths.baseDir', hostConflictScope)
  addDuplicateNotices(inventory.nodes, notices, (node) => node.ports.jsonrpcHostBind, 'duplicatePort', 'ports.jsonrpcHostBind', hostConflictScope)
  addDuplicateNotices(inventory.nodes, notices, (node) => node.ports.p2pPublic, 'duplicatePort', 'ports.p2pPublic', hostConflictScope)
  addDuplicateNotices(inventory.nodes, notices, (node) => node.producer.profileRef, 'duplicateProducerProfile', 'producer.profileRef')

  return notices
}

function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function remotePath(value: string): string {
  if (value.startsWith('~/')) {
    const rest = value.slice(2).replace(/(["\\`$])/g, '\\$1')
    return `"$HOME/${rest}"`
  }
  return q(value)
}

function ssh(node: RemoteFleetNode, remoteCommand: string): string {
  return `ssh ${node.connectionRef} <<'TELENO_REMOTE'\n${remoteCommand}\nTELENO_REMOTE`
}

function serviceName(node: RemoteFleetNode): string {
  return node.runtime.serviceName || `teleno-${node.id}`
}

function runtimeStatusCommand(node: RemoteFleetNode): string {
  return node.runtime.kind === 'docker'
    ? `docker ps --filter name=${serviceName(node)} --format '{{.Names}} {{.Status}}'`
    : `systemctl status ${serviceName(node)} --no-pager`
}

function runtimeStartCommand(node: RemoteFleetNode): string {
  if (node.runtime.kind === 'docker') {
    const jsonrpcPort = bindPort(node.ports.jsonrpcHostBind) || '8080'
    return [
      `docker start ${serviceName(node)} 2>/dev/null || docker run -d --name ${serviceName(node)}`,
      `-v ${remotePath(node.paths.baseDir)}:/data`,
      `-p ${node.ports.jsonrpcHostBind}:${jsonrpcPort}`,
      `-p ${node.ports.p2pPublic}:${p2pInternalPort(node)}`,
      q(node.runtime.image),
      '--basedir /data --config /data/config.yml'
    ].join(' ')
  }
  return `systemctl start ${serviceName(node)}`
}

function runtimeStopCommand(node: RemoteFleetNode): string {
  return node.runtime.kind === 'docker'
    ? `docker stop ${serviceName(node)}`
    : `systemctl stop ${serviceName(node)}`
}

function bindPort(bind: string): string {
  const match = bind.match(/:(\d+)$/)
  return match?.[1] || ''
}

function p2pInternalPort(node: RemoteFleetNode): string {
  return node.network === 'testnet' ? '18888' : '8888'
}

function dockerContainerListen(bind: string): string {
  const port = bindPort(bind)
  return port ? `0.0.0.0:${port}` : bind
}

function jsonRpcListen(node: RemoteFleetNode): string {
  return node.runtime.kind === 'docker' ? dockerContainerListen(node.ports.jsonrpcHostBind) : node.ports.jsonrpcHostBind
}

function p2pListen(node: RemoteFleetNode): string {
  const listenPort = node.runtime.kind === 'docker' ? p2pInternalPort(node) : node.ports.p2pPublic
  return `/ip4/0.0.0.0/tcp/${listenPort}`
}

function p2pPeers(node: RemoteFleetNode): string[] {
  return node.network === 'testnet' ? TESTNET_P2P_PEERS : MAINNET_P2P_PEERS
}

function portInUseGuard(port: string): string {
  return [
    `if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(:|\\\\])${port}$" >/dev/null; then`,
    `  echo "TELENO_STOP_CRITERIA: planned port ${port} is already in use";`,
    '  exit 65;',
    'fi'
  ].join('\n')
}

function telenoNodeCliCommand(node: RemoteFleetNode, args: string): string {
  if (node.runtime.kind === 'docker') {
    return [
      'docker run --rm',
      `-v ${remotePath(node.paths.baseDir)}:/data`,
      q(node.runtime.image),
      '--basedir /data',
      '--config /data/config.yml',
      args
    ].join(' ')
  }
  return `teleno_node --basedir ${remotePath(node.paths.baseDir)} --config ${remotePath(node.paths.config)} ${args}`
}

function reviewedArtifactVersion(node: RemoteFleetNode): string {
  return node.runtime.expectedVersion.includes('<') ? 'unspecified' : node.runtime.expectedVersion
}

function artifactEvidenceCommand(node: RemoteFleetNode): string {
  const expectedVersion = reviewedArtifactVersion(node)
  if (node.runtime.kind === 'docker') {
    return [
      `docker pull ${q(node.runtime.image)}`,
      `artifact_id=$(docker image inspect ${q(node.runtime.image)} --format '{{.Id}}')`,
      `artifact_digests=$(docker image inspect ${q(node.runtime.image)} --format '{{range .RepoDigests}}{{.}} {{end}}')`,
      `printf 'TELENO_ARTIFACT_IMAGE id=%s digests=%s expected=%s\\n' "$artifact_id" "$artifact_digests" ${q(expectedVersion)}`
    ].join('\n')
  }
  return `teleno_node --version || true; echo "TELENO_ARTIFACT_BINARY expected=${expectedVersion}"`
}

function commandStep(phase: RemotePlanPhase, command: string, options: Partial<RemoteCommandStep> = {}): RemoteCommandStep {
  return {
    phase,
    command,
    hostMutation: options.hostMutation === true,
    chainMutation: options.chainMutation === true,
    destructive: options.destructive === true
  }
}

function observerConfigCommand(node: RemoteFleetNode): string {
  return [
    `mkdir -p ${remotePath(node.paths.baseDir)}`,
    `cat > ${remotePath(node.paths.config)} <<'TELENO_CONFIG'`,
    `network: ${node.network}`,
    'chain:',
    '  verify-blocks: true',
    'p2p:',
    `  listen: ${p2pListen(node)}`,
    '  seed-reconnect-interval-seconds: 10',
    '  peer-log-interval-seconds: 60',
    '  peer:',
    ...p2pPeers(node).map((peer) => `    - ${peer}`),
    'features:',
    '  chain: true',
    '  mempool: true',
    '  block_store: true',
    '  p2p: true',
    '  jsonrpc: true',
    '  grpc: false',
    '  block_producer: false',
    'jsonrpc:',
    `  listen: ${jsonRpcListen(node)}`,
    'backup:',
    '  public-restore:',
    '    enabled: true',
    `    base-url: ${node.backup.publicBootstrapUrl}`,
    'TELENO_CONFIG'
  ].join('\n')
}

function stopCriteriaGuardCommand(node: RemoteFleetNode): string {
  const logPath = remotePath(`${node.paths.baseDir}/logs`)
  return [
    `if grep -R -E -i "state merkle mismatch|previous state merkle mismatch|digest mismatch|restore failed|chain[_ -]?id mismatch|block_producer: true" ${logPath} 2>/dev/null; then`,
    '  echo "TELENO_STOP_CRITERIA: preserve state DB and stop remote rollout";',
    '  exit 65;',
    'fi'
  ].join('\n')
}

function healthCheckCommand(node: RemoteFleetNode): string {
  const rpcPort = bindPort(node.ports.jsonrpcHostBind)
  const adminPort = bindPort(node.ports.backupAdminListen)
  const rpcUrl = rpcPort ? `http://127.0.0.1:${rpcPort}` : `http://${node.ports.jsonrpcHostBind}`
  const adminUrl = adminPort ? `http://127.0.0.1:${adminPort}/health` : ''
  const logReadCommand = `journalctl -u ${serviceName(node)} -n 120 --no-pager 2>/dev/null || docker logs --tail 120 ${serviceName(node)} 2>&1 || true`
  return [
    'set -eu',
    'echo "TELENO_HEALTH_SECTION host"',
    'uname -s; uname -m; df -Pk / || true',
    `df -Pk ${remotePath(node.paths.baseDir)} || true`,
    'docker --version || true',
    'systemctl --version | head -n 1 || true',
    'echo "TELENO_HEALTH_SECTION runtime"',
    `${runtimeStatusCommand(node)} || true`,
    `docker image inspect ${q(node.runtime.image)} --format '{{.Id}} {{.RepoDigests}}' 2>/dev/null || true`,
    'echo "TELENO_HEALTH_SECTION config"',
    `test -f ${remotePath(node.paths.config)} && sed -n '1,220p' ${remotePath(node.paths.config)} | grep -E "network:|block_producer:|listen:|peer:|public-restore|base-url|admin" || true`,
    `if test -f ${remotePath(node.paths.config)} && ! sed -n '/^p2p:/,/^[^[:space:]]/p' ${remotePath(node.paths.config)} | grep -E '^    - ' >/dev/null; then echo "TELENO_HEALTH_SIGNAL no-seed-peers"; fi`,
    `if grep -R -E "block_producer:\\s*true" ${remotePath(node.paths.config)} 2>/dev/null; then echo "TELENO_STOP_CRITERIA: producer unexpectedly enabled"; exit 65; fi`,
    `if ss -ltn 2>/dev/null | grep -E "0\\.0\\.0\\.0:(${rpcPort || '8080'}|${adminPort || '18088'})"; then echo "TELENO_STOP_CRITERIA: public JSON-RPC/admin exposure"; exit 65; fi`,
    'echo "TELENO_HEALTH_SECTION rpc"',
    `curl --fail --silent --max-time 3 ${q(`${rpcUrl}/health`)} || true`,
    `curl --fail --silent --max-time 3 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}' ${q(rpcUrl)} || true`,
    'head_height() {',
    `  curl --fail --silent --max-time 3 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"chain.get_head_info","params":{}}' ${q(rpcUrl)} | tr -d '\\n' | sed -n 's/.*"height"[": ]*\\([0-9][0-9]*\\).*/\\1/p; s/.*"height":"\\([0-9][0-9]*\\)".*/\\1/p'`,
    '}',
    'head_one=$(head_height || true)',
    'sleep 10',
    'head_two=$(head_height || true)',
    'if [ -n "$head_one" ] && [ -n "$head_two" ] && [ "$head_one" = "$head_two" ]; then echo "TELENO_HEALTH_SIGNAL no-head-progress"; fi',
    'if [ -n "$head_one" ] && [ -n "$head_two" ] && [ "$head_one" != "$head_two" ]; then echo "TELENO_HEALTH_SIGNAL head-progress"; fi',
    adminUrl ? `curl --fail --silent --max-time 3 ${q(adminUrl)} || true` : 'true',
    'echo "TELENO_HEALTH_SECTION logs"',
    `remote_logs=$(${logReadCommand})`,
    'printf "%s\\n" "$remote_logs"',
    'if printf "%s\\n" "$remote_logs" | grep -E "peer_count=0|Started with 0 seed peers" >/dev/null; then echo "TELENO_HEALTH_SIGNAL no-peers"; fi',
    stopCriteriaGuardCommand(node)
  ].join('\n')
}

function installPreflightCommand(node: RemoteFleetNode): string {
  const diskFloorKb = node.network === 'testnet' ? 20 * 1024 * 1024 : 80 * 1024 * 1024
  const ports = [
    bindPort(node.ports.jsonrpcHostBind),
    node.ports.p2pPublic,
    bindPort(node.ports.backupAdminListen)
  ].filter(Boolean)
  return [
    'set -eu',
    'uname -a',
    `df -Pk ${remotePath(node.paths.baseDir)} 2>/dev/null || df -Pk "$HOME" / || true`,
    'docker --version || true',
    `available_kb=$(df -Pk "$HOME" | awk 'NR==2 {print $4}')`,
    `if [ "$available_kb" -lt ${diskFloorKb} ]; then echo "TELENO_STOP_CRITERIA: disk floor violation"; exit 65; fi`,
    `if [ -e ${remotePath(node.paths.baseDir)} ]; then echo "TELENO_STOP_CRITERIA: disposable BASEDIR already exists"; exit 65; fi`,
    `if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Fx ${q(serviceName(node))} >/dev/null; then echo "TELENO_STOP_CRITERIA: container already exists"; exit 65; fi`,
    ...ports.map(portInUseGuard)
  ].join('\n')
}

export function generateRemoteCommandPlan(
  inventory: RemoteFleetInventory,
  nodeId: string,
  action: RemoteNodeAction
): RemoteCommandPlan {
  const node = inventory.nodes.find((candidate) => candidate.id === nodeId) ?? inventory.nodes[0]
  const notices = validateRemoteFleetInventory(inventory).filter((notice) => !notice.field || notice.field.includes(node.id) || notice.value?.includes(node.id))
  const steps: RemoteCommandStep[] = []

  if (!node) {
    return {
      action,
      nodeId,
      blocked: true,
      notices: [{ code: 'dryRunOnly', field: nodeId }],
      steps: []
    }
  }

  notices.push({ code: 'dryRunOnly', field: node.id })
  if (action === 'rollback' || action === 'cleanup') notices.push({ code: 'destructiveConfirmationRequired', field: node.id })
  if (node.network === 'mainnet' && ['install-observer', 'restore-public-bootstrap', 'upgrade', 'rollback'].includes(action)) {
    notices.push({ code: 'prodnetConfirmationRequired', field: node.id })
  }

  if (action === 'install-observer') {
    steps.push(
      commandStep('preflight', ssh(node, installPreflightCommand(node))),
      commandStep('artifact', ssh(node, artifactEvidenceCommand(node)), { hostMutation: true }),
      commandStep('prepare', ssh(node, `mkdir -p ${remotePath(node.paths.baseDir)} ${remotePath(`${node.paths.baseDir}/logs`)}`), { hostMutation: true }),
      commandStep('config', ssh(node, observerConfigCommand(node)), { hostMutation: true }),
      commandStep('bootstrap', ssh(node, telenoNodeCliCommand(node, `--backup-public-list --backup-public-url ${q(node.backup.publicBootstrapUrl)} --backup-json`))),
      commandStep('bootstrap', ssh(node, telenoNodeCliCommand(node, `--backup-public-restore --backup-public-url ${q(node.backup.publicBootstrapUrl)} --backup-json`)), { hostMutation: true }),
      commandStep('runtime', ssh(node, runtimeStartCommand(node)), { hostMutation: true }),
      commandStep('verify', ssh(node, `grep -R \"block_producer: false\" ${remotePath(node.paths.config)} && ${runtimeStatusCommand(node)}\n${stopCriteriaGuardCommand(node)}`))
    )
  } else if (action === 'restore-public-bootstrap') {
    steps.push(
      commandStep('preflight', ssh(node, `df -h ${remotePath(node.paths.baseDir)}; test -f ${remotePath(node.paths.config)} && grep -R \"block_producer: false\" ${remotePath(node.paths.config)}`)),
      commandStep('bootstrap', ssh(node, telenoNodeCliCommand(node, `--backup-public-list --backup-public-url ${q(node.backup.publicBootstrapUrl)} --backup-json`))),
      commandStep('bootstrap', ssh(node, telenoNodeCliCommand(node, `--backup-public-restore --backup-public-url ${q(node.backup.publicBootstrapUrl)} --backup-json`)), { hostMutation: true }),
      commandStep('verify', ssh(node, `test -f ${remotePath(`${node.paths.baseDir}/.backup-just-restored`)}; grep -R \"block_producer: false\" ${remotePath(node.paths.config)}\n${stopCriteriaGuardCommand(node)}`))
    )
  } else if (action === 'start-observer') {
    steps.push(
      commandStep('preflight', ssh(node, `grep -R \"block_producer: false\" ${remotePath(node.paths.config)}`)),
      commandStep('config', ssh(node, observerConfigCommand(node)), { hostMutation: true }),
      commandStep('runtime', ssh(node, runtimeStartCommand(node)), { hostMutation: true }),
      commandStep('verify', ssh(node, `${runtimeStatusCommand(node)}; grep -R \"teleno_node ready\" ${remotePath(`${node.paths.baseDir}/logs`)} || true\n${stopCriteriaGuardCommand(node)}`))
    )
  } else if (action === 'status') {
    steps.push(
      commandStep('preflight', ssh(node, healthCheckCommand(node))),
      commandStep('verify', ssh(node, `grep -R \"block_producer: false\" ${remotePath(node.paths.config)} 2>/dev/null || true\n${stopCriteriaGuardCommand(node)}`))
    )
  } else if (action === 'logs') {
    steps.push(commandStep('diagnostics', ssh(node, `journalctl -u ${serviceName(node)} -n 200 --no-pager || docker logs --tail 200 ${serviceName(node)} 2>&1 | sed -E 's/(token|password|secret)=([^ ]+)/\\1=[redacted]/gi'`)))
  } else if (action === 'stop') {
    steps.push(commandStep('runtime', ssh(node, runtimeStopCommand(node)), { hostMutation: true }))
  } else if (action === 'restart') {
    steps.push(
      commandStep('config', ssh(node, observerConfigCommand(node)), { hostMutation: true }),
      commandStep('runtime', ssh(node, `${runtimeStopCommand(node)} && ${runtimeStartCommand(node)}`), { hostMutation: true }),
      commandStep('verify', ssh(node, runtimeStatusCommand(node)))
    )
  } else if (action === 'upgrade') {
    steps.push(
      commandStep('artifact', ssh(node, artifactEvidenceCommand(node)), { hostMutation: true }),
      commandStep('runtime', ssh(node, `${runtimeStopCommand(node)} && ${runtimeStartCommand(node)}`), { hostMutation: true }),
      commandStep('verify', ssh(node, `${runtimeStatusCommand(node)}; grep -R \"block_producer: false\" ${remotePath(node.paths.config)}`))
    )
  } else if (action === 'rollback') {
    steps.push(
      commandStep('rollback', ssh(node, [
        'echo "TELENO_ROLLBACK_PLAN review-only"',
        `echo "preserve basedir: ${node.paths.baseDir}"`,
        'echo "verify current artifact, select previous artifact, stop observer, start previous observer artifact"',
        'echo "rollback execution is future-gated and unavailable in this MVP"'
      ].join('\n')), { destructive: true }),
      commandStep('verify', ssh(node, `grep -R \"block_producer: false\" ${remotePath(node.paths.config)} 2>/dev/null || true; ${runtimeStatusCommand(node)} || true`))
    )
  } else if (action === 'cleanup') {
    steps.push(commandStep('cleanup', ssh(node, [
      'echo "TELENO_CLEANUP_PLAN review-only"',
      `echo "inspect basedir first: ${node.paths.baseDir}"`,
      'echo "preserve chain/state DB on merkle mismatch, restore failure, digest mismatch, or interrupted restore"',
      'echo "cleanup execution is unavailable in this MVP"'
    ].join('\n')), { destructive: true }))
  }

  const blockerCodes: RemotePlanNoticeCode[] = [
    'producerUnavailable',
    'mainnetMutationBlocked',
    'publicAdminBlocked',
    'jsonrpcPublicBlocked',
    'rawHostRefBlocked',
    'secretReferenceBlocked',
    'duplicateNodeId',
    'duplicateBaseDir',
    'duplicatePort',
    'duplicateProducerProfile',
    'publicBootstrapMissing'
  ]
  return {
    action,
    nodeId: node.id,
    blocked: notices.some((notice) => blockerCodes.includes(notice.code)),
    notices,
    steps
  }
}

export function generateRemoteFleetCommandPlans(
  inventory: RemoteFleetInventory,
  nodeIds: string[],
  action: RemoteNodeAction
): RemoteCommandPlan[] {
  const selectedIds = nodeIds.length > 0 ? nodeIds : inventory.nodes.map((node) => node.id)
  return selectedIds.map((nodeId) => generateRemoteCommandPlan(inventory, nodeId, action))
}
