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
  trust: {
    artifactDigest: string
    artifactSignatureRef: string
    bootstrapPolicyId: string
    bootstrapPolicyDigest: string
    prodnetObserverProofRef: string
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
  | 'prodnet-observer-proof'
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
  | 'prodnetArtifactTrustRequired'
  | 'prodnetBootstrapPolicyRequired'
  | 'prodnetDryRunProofRequired'
  | 'prodnetBatchMutationBlocked'
  | 'dryRunOnly'

export type RemotePlanNotice = {
  code: RemotePlanNoticeCode
  field?: string
  value?: string
}

export type RemotePlanPhase =
  | 'preflight'
  | 'artifact'
  | 'trust'
  | 'proof'
  | 'prepare'
  | 'config'
  | 'bootstrap'
  | 'runtime'
  | 'verify'
  | 'diagnostics'
  | 'preserve'
  | 'receipt'
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

export type RemoteFleetRolloutNodeStatus =
  | 'pending'
  | 'reviewing'
  | 'confirmed'
  | 'running'
  | 'skipped'
  | 'failed'
  | 'complete'

export type RemoteFleetRolloutPlanEntry = {
  nodeId: string
  label: string
  network: KoinosNetworkId
  status: RemoteFleetRolloutNodeStatus
  plan: RemoteCommandPlan
  blocked: boolean
  stepCount: number
  notices: RemotePlanNotice[]
  confirmationPhrase: string
}

export type RemoteFleetRolloutPlan = {
  action: RemoteNodeAction
  nodeIds: string[]
  entries: RemoteFleetRolloutPlanEntry[]
  blocked: boolean
  stepCount: number
  networks: KoinosNetworkId[]
}

export type RemoteProviderAddressPresence = 'unknown' | 'absent' | 'present-redacted'

export type RemoteProviderInstanceMetadata = {
  providerName: string
  instanceRef: string
  label: string
  region: string
  os: string
  cpuSummary: string
  ramSummary: string
  diskSummary: string
  lifecycleState: string
  publicAddress: RemoteProviderAddressPresence
  privateAddress: RemoteProviderAddressPresence
  suggestedSshAlias: string
}

export type RemoteProviderImportIssueCode =
  | 'empty-input'
  | 'unsupported-format'
  | 'secret-blocked'
  | 'raw-address-blocked'
  | 'raw-host-blocked'
  | 'user-reference-blocked'
  | 'private-path-blocked'
  | 'duplicate-instance'

export type RemoteProviderImportIssue = {
  code: RemoteProviderImportIssueCode
  field?: string
  value?: string
}

export type RemoteProviderImportResult = {
  ok: boolean
  redactedPreview: string
  instances: RemoteProviderInstanceMetadata[]
  nodes: RemoteFleetNode[]
  issues: RemoteProviderImportIssue[]
}

export type RemoteProviderImportOptions = {
  network?: KoinosNetworkId
  existingInventory?: RemoteFleetInventory
}

const DEFAULT_IMAGE = 'ghcr.io/pgarciagon/teleno-node:beta'
const DEFAULT_VERSION = '<teleno_node-version-or-commit>'
const PRODNET_BOOTSTRAP_POLICY_ID = 'prodnet-public-bootstrap-v1'
const PRODNET_BOOTSTRAP_POLICY_DIGEST = 'sha256:70726f646e65742d7075626c69632d626f6f7473747261702d76310000000000'
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
const PROVIDER_IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g
const PROVIDER_HOSTNAME_RE = /\b(?=[a-z0-9.-]*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi
const PROVIDER_PRIVATE_PATH_RE = /(^|[\s"'=:])(?:~\/|\/Users\/|\/home\/|\/root\/|[A-Za-z]:\\)[^\s"',}]*/g
const PROVIDER_TOKEN_KEY_RE = /\b(?:api[_-]?key|api[_-]?token|access[_-]?key|access[_-]?token|auth(?:orization)?|bearer|credential|password|passwd|private[_-]?key|secret|token)\b/i
const PROVIDER_USER_FIELD_RE = /\b(?:ssh[_-]?user|username|user|login)\b\s*[:=]/i
const PROVIDER_SSH_TARGET_RE = /\b(?:root|ubuntu|admin|debian|ec2-user|opc)@[^\s"',}]+/i
const PROVIDER_PRIVATE_KEY_RE = /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/i

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

function safeProviderText(value: unknown, fallback = 'unknown'): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 96) : fallback
}

function providerFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function providerRecordValue(record: Record<string, unknown>, aliases: string[]): unknown {
  const normalized = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) normalized.set(providerFieldKey(key), value)
  for (const alias of aliases) {
    const value = normalized.get(providerFieldKey(alias))
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function slugifyProviderValue(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}

function safeSshAlias(value: unknown, fallback: string): string {
  const alias = safeProviderText(value, '')
  if (
    /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(alias) &&
    !looksLikeRawHostReference(alias) &&
    !looksLikeSecretReference(alias) &&
    !PROVIDER_USER_FIELD_RE.test(alias)
  ) {
    return alias
  }
  return fallback
}

function providerAddressPresence(value: unknown): RemoteProviderAddressPresence {
  if (value === true) return 'present-redacted'
  if (value === false) return 'absent'
  const text = safeProviderText(value, '').toLowerCase()
  if (!text) return 'unknown'
  if (/^(false|no|none|absent|0)$/.test(text)) return 'absent'
  if (/^(true|yes|present|redacted|hidden|masked|1)$/.test(text)) return 'present-redacted'
  return 'present-redacted'
}

function providerLifecycleState(value: unknown): string {
  const state = safeProviderText(value, 'unknown').toLowerCase()
  if (/^(running|active|started|on)$/.test(state)) return 'running'
  if (/^(stopped|off|shutoff|halted)$/.test(state)) return 'stopped'
  if (/^(pending|provisioning|starting)$/.test(state)) return 'pending'
  if (/^(terminated|deleted|destroyed)$/.test(state)) return 'terminated'
  return state.replace(/[^a-z0-9_.-]+/g, '-') || 'unknown'
}

function providerInstanceKey(instance: RemoteProviderInstanceMetadata): string {
  return `${slugifyProviderValue(instance.providerName, 'provider')}:${slugifyProviderValue(instance.instanceRef, 'instance')}`
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
    trust: {
      artifactDigest: '',
      artifactSignatureRef: '',
      bootstrapPolicyId: network === 'mainnet' ? PRODNET_BOOTSTRAP_POLICY_ID : '',
      bootstrapPolicyDigest: network === 'mainnet' ? PRODNET_BOOTSTRAP_POLICY_DIGEST : '',
      prodnetObserverProofRef: ''
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
    trust: {
      artifactDigest: safeText(input.trust?.artifactDigest, base.trust.artifactDigest),
      artifactSignatureRef: safeText(input.trust?.artifactSignatureRef, base.trust.artifactSignatureRef),
      bootstrapPolicyId: safeText(input.trust?.bootstrapPolicyId, base.trust.bootstrapPolicyId),
      bootstrapPolicyDigest: safeText(input.trust?.bootstrapPolicyDigest, base.trust.bootstrapPolicyDigest),
      prodnetObserverProofRef: safeText(input.trust?.prodnetObserverProofRef, base.trust.prodnetObserverProofRef)
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

export function redactRemoteProviderMetadataInput(input: string): string {
  return input
    .replace(PROVIDER_PRIVATE_KEY_RE, '[redacted-secret]')
    .replace(/\b(api[_-]?key|api[_-]?token|access[_-]?key|access[_-]?token|auth(?:orization)?|bearer|credential|password|passwd|private[_-]?key|secret|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,}\]]+)/gi, '$1=[redacted-secret]')
    .replace(PROVIDER_SSH_TARGET_RE, '[redacted-ssh-target]')
    .replace(PROVIDER_IPV4_RE, '[redacted-address]')
    .replace(PROVIDER_PRIVATE_PATH_RE, '$1[redacted-path]')
    .replace(PROVIDER_HOSTNAME_RE, '[redacted-host]')
    .trim()
    .slice(0, 4000)
}

function providerInputIssues(input: string): RemoteProviderImportIssue[] {
  const issues: RemoteProviderImportIssue[] = []
  if (!input.trim()) return [{ code: 'empty-input' }]
  if (PROVIDER_PRIVATE_KEY_RE.test(input) || PROVIDER_TOKEN_KEY_RE.test(input)) {
    issues.push({ code: 'secret-blocked', value: '[redacted-secret]' })
  }
  PROVIDER_IPV4_RE.lastIndex = 0
  if (PROVIDER_IPV4_RE.test(input)) {
    issues.push({ code: 'raw-address-blocked', value: '[redacted-address]' })
  }
  PROVIDER_IPV4_RE.lastIndex = 0
  PROVIDER_HOSTNAME_RE.lastIndex = 0
  if (PROVIDER_HOSTNAME_RE.test(input)) {
    issues.push({ code: 'raw-host-blocked', value: '[redacted-host]' })
  }
  PROVIDER_HOSTNAME_RE.lastIndex = 0
  if (PROVIDER_SSH_TARGET_RE.test(input) || PROVIDER_USER_FIELD_RE.test(input)) {
    issues.push({ code: 'user-reference-blocked', value: '[redacted-user]' })
  }
  PROVIDER_PRIVATE_PATH_RE.lastIndex = 0
  if (PROVIDER_PRIVATE_PATH_RE.test(input)) {
    issues.push({ code: 'private-path-blocked', value: '[redacted-path]' })
  }
  PROVIDER_PRIVATE_PATH_RE.lastIndex = 0
  return issues
}

function jsonProviderRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  const record = value as Record<string, unknown>
  for (const key of ['instances', 'servers', 'nodes', 'vms', 'droplets']) {
    const nested = record[key]
    if (Array.isArray(nested)) return jsonProviderRecords(nested)
  }
  return [record]
}

function keyValueProviderRecords(input: string): Record<string, unknown>[] {
  const blocks = input
    .split(/\n\s*(?:---+|\n)\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
  const records: Record<string, unknown>[] = []

  for (const block of blocks.length ? blocks : [input]) {
    const record: Record<string, unknown> = {}
    for (const line of block.split(/\n/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_. -]{1,40})\s*[:=]\s*(.*?)\s*$/)
      if (!match) continue
      record[match[1]] = match[2]
    }
    if (Object.keys(record).length > 0) records.push(record)
  }

  return records
}

function parseProviderRecords(input: string): { records: Record<string, unknown>[]; parsed: boolean } {
  try {
    const parsed = JSON.parse(input)
    const records = jsonProviderRecords(parsed)
    return { records, parsed: records.length > 0 }
  } catch {
    const records = keyValueProviderRecords(input)
    return { records, parsed: records.length > 0 }
  }
}

function normalizeProviderInstanceMetadata(record: Record<string, unknown>, index: number): RemoteProviderInstanceMetadata {
  const providerName = safeProviderText(providerRecordValue(record, ['providerName', 'provider', 'cloud', 'vendor']), 'provider')
  const fallbackRef = `${slugifyProviderValue(providerName, 'provider')}-${index + 1}`
  const instanceRef = safeProviderText(providerRecordValue(record, [
    'instance',
    'instanceRef',
    'instanceId',
    'server',
    'serverRef',
    'serverId',
    'dropletId',
    'vmId',
    'id',
    'ref'
  ]), fallbackRef)
  const label = safeProviderText(providerRecordValue(record, ['label', 'name', 'serverName', 'instanceName']), instanceRef)
  const aliasFallback = `ssh-${slugifyProviderValue(label || instanceRef, fallbackRef)}`

  return {
    providerName,
    instanceRef,
    label,
    region: safeProviderText(providerRecordValue(record, ['region', 'location', 'datacenter', 'zone']), 'unknown'),
    os: safeProviderText(providerRecordValue(record, ['os', 'image', 'distro', 'distribution']), 'unknown'),
    cpuSummary: safeProviderText(providerRecordValue(record, ['cpuSummary', 'cpu', 'cpus', 'vcpu', 'vcpus']), 'unknown'),
    ramSummary: safeProviderText(providerRecordValue(record, ['ramSummary', 'ram', 'memory', 'memoryMb', 'memoryGb']), 'unknown'),
    diskSummary: safeProviderText(providerRecordValue(record, ['diskSummary', 'disk', 'diskGb', 'storage', 'storageGb']), 'unknown'),
    lifecycleState: providerLifecycleState(providerRecordValue(record, ['lifecycleState', 'state', 'status', 'powerState'])),
    publicAddress: providerAddressPresence(providerRecordValue(record, [
      'publicAddress',
      'publicIp',
      'publicIpPresent',
      'publicAddressPresent',
      'hasPublicAddress'
    ])),
    privateAddress: providerAddressPresence(providerRecordValue(record, [
      'privateAddress',
      'privateIp',
      'privateIpPresent',
      'privateAddressPresent',
      'hasPrivateAddress'
    ])),
    suggestedSshAlias: safeSshAlias(providerRecordValue(record, [
      'suggestedSshAlias',
      'sshAlias',
      'connectionRef',
      'sshRef'
    ]), aliasFallback)
  }
}

function uniqueProviderNodeId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

export function remoteProviderMetadataToFleetNode(
  metadata: RemoteProviderInstanceMetadata,
  options: RemoteProviderImportOptions = {},
  usedIds = new Set(options.existingInventory?.nodes.map((node) => node.id) || [])
): RemoteFleetNode {
  const network = safeNetwork(options.network ?? 'testnet')
  const baseId = slugifyProviderValue(metadata.label || metadata.instanceRef, 'provider-node')
  const id = uniqueProviderNodeId(baseId, usedIds)
  const baseDir = recommendedRemoteBaseDir(network, id)
  const node = normalizeRemoteFleetNode({
    id,
    label: metadata.label,
    network,
    role: 'observer',
    environment: network === 'mainnet' ? 'prodnet' : network,
    hostRef: `provider-${slugifyProviderValue(metadata.providerName, 'provider')}-${slugifyProviderValue(metadata.instanceRef, 'instance')}`,
    connectionRef: metadata.suggestedSshAlias,
    paths: {
      baseDir,
      config: `${baseDir}/config.yml`
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
      health: metadata.lifecycleState === 'running' ? 'unknown' : 'needs-server',
      lastCheck: ''
    }
  })
  return node
}

export function importRemoteProviderMetadata(
  input: string,
  options: RemoteProviderImportOptions = {}
): RemoteProviderImportResult {
  const redactedPreview = redactRemoteProviderMetadataInput(input)
  const issues = providerInputIssues(input)
  const parsed = parseProviderRecords(input)
  const instances = parsed.records.map((record, index) => normalizeProviderInstanceMetadata(record, index))
  const seenInstances = new Set<string>()
  const existingHostRefs = new Set(options.existingInventory?.nodes.map((node) => node.hostRef) || [])

  if (!parsed.parsed && input.trim()) {
    issues.push({ code: 'unsupported-format' })
  }

  for (const instance of instances) {
    const key = providerInstanceKey(instance)
    const hostRef = `provider-${slugifyProviderValue(instance.providerName, 'provider')}-${slugifyProviderValue(instance.instanceRef, 'instance')}`
    if (seenInstances.has(key) || existingHostRefs.has(hostRef)) {
      issues.push({ code: 'duplicate-instance', field: instance.label, value: key })
    }
    seenInstances.add(key)
  }

  const usedIds = new Set(options.existingInventory?.nodes.map((node) => node.id) || [])
  const nodes = instances.map((instance) => remoteProviderMetadataToFleetNode(instance, options, usedIds))
  return {
    ok: issues.length === 0 && nodes.length > 0,
    redactedPreview,
    instances,
    nodes,
    issues
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

function isProdnetObserverMutation(action: RemoteNodeAction, node: RemoteFleetNode): boolean {
  return node.network === 'mainnet' && (
    action === 'install-observer' ||
    action === 'restore-public-bootstrap' ||
    action === 'start-observer'
  )
}

function hasPinnedArtifactDigest(node: RemoteFleetNode): boolean {
  const digest = node.trust.artifactDigest
  return /^sha256:[a-f0-9]{64}$/i.test(digest) && node.runtime.image.includes(`@${digest}`)
}

function hasProdnetBootstrapPolicy(node: RemoteFleetNode): boolean {
  return (
    node.trust.bootstrapPolicyId === PRODNET_BOOTSTRAP_POLICY_ID &&
    node.trust.bootstrapPolicyDigest === PRODNET_BOOTSTRAP_POLICY_DIGEST &&
    node.backup.publicBootstrapUrl === publicBootstrapUrlForNetwork('mainnet')
  )
}

function hasProdnetDryRunProof(node: RemoteFleetNode): boolean {
  return /^(remote|proof)-[A-Za-z0-9_-]+$/.test(node.trust.prodnetObserverProofRef)
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
      node.trust.artifactSignatureRef,
      node.trust.prodnetObserverProofRef,
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
    const digest = node.trust.artifactDigest
    return [
      `docker pull ${q(node.runtime.image)}`,
      `artifact_id=$(docker image inspect ${q(node.runtime.image)} --format '{{.Id}}')`,
      `artifact_digests=$(docker image inspect ${q(node.runtime.image)} --format '{{range .RepoDigests}}{{.}} {{end}}')`,
      digest ? `case " $artifact_digests " in *${digest}*) echo "TELENO_ARTIFACT_DIGEST_PINNED ${digest}" ;; *) echo "TELENO_STOP_CRITERIA: digest mismatch"; exit 65;; esac` : 'true',
      `printf 'TELENO_ARTIFACT_IMAGE id=%s digests=%s expected=%s\\n' "$artifact_id" "$artifact_digests" ${q(expectedVersion)}`
    ].join('\n')
  }
  return `teleno_node --version || true; echo "TELENO_ARTIFACT_BINARY expected=${expectedVersion}"`
}

function prodnetArtifactTrustCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `case ${q(node.runtime.image)} in *@${node.trust.artifactDigest}) echo "TELENO_ARTIFACT_DIGEST_PINNED ${node.trust.artifactDigest}" ;; *) echo "TELENO_STOP_CRITERIA: digest mismatch"; exit 65;; esac`,
    node.trust.artifactSignatureRef
      ? `echo "TELENO_ARTIFACT_SIGNATURE_REF reviewed ${q(node.trust.artifactSignatureRef)}"`
      : 'echo "TELENO_ARTIFACT_SIGNATURE_REF none digest-pin-required"',
    `echo "TELENO_ARTIFACT_TRUST_READY expected=${q(reviewedArtifactVersion(node))}"`
  ].join('\n')
}

function prodnetBootstrapTrustCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `test ${q(node.backup.publicBootstrapUrl)} = ${q(publicBootstrapUrlForNetwork('mainnet') || '')}`,
    `echo "TELENO_BOOTSTRAP_POLICY ${node.trust.bootstrapPolicyId}"`,
    `echo "TELENO_BOOTSTRAP_POLICY_DIGEST ${node.trust.bootstrapPolicyDigest}"`,
    'echo "TELENO_BOOTSTRAP_TRUST https-origin object-sha256 network-mainnet signature-when-published"',
    `curl --fail --silent --max-time 8 ${q(`${node.backup.publicBootstrapUrl}/latest.json`)} | grep -E '"network"\\s*:\\s*"mainnet"|"network":"mainnet"' >/dev/null`,
    'echo "TELENO_BOOTSTRAP_TRUST_READY prodnet-public-bootstrap-v1"'
  ].join('\n')
}

function prodnetObserverProofCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `test ${q(node.network)} = mainnet`,
    `test ${q(node.role)} = observer`,
    'echo "TELENO_PRODNET_PROOF observer-only"',
    'echo "TELENO_PRODNET_PROOF loopback-rpc-admin"',
    `echo "TELENO_PRODNET_PROOF artifact=${node.trust.artifactDigest}"`,
    `echo "TELENO_PRODNET_PROOF bootstrap_policy=${node.trust.bootstrapPolicyId}"`,
    'echo "TELENO_PRODNET_PROOF_READY dry-run reviewed commands only"'
  ].join('\n')
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
    `if grep -R -E -i "state merkle mismatch|previous state merkle mismatch|digest mismatch|restore failed|chain[_ -]?id mismatch|block_producer: true" ${logPath} ${remotePath(`${node.paths.baseDir}/.teleno/receipts`)} 2>/dev/null; then`,
    '  echo "TELENO_STOP_CRITERIA: preserve state DB and stop remote rollout";',
    '  exit 65;',
    'fi'
  ].join('\n')
}

function telenoControlDir(node: RemoteFleetNode): string {
  return `${node.paths.baseDir}/.teleno`
}

function rollbackHistoryDir(node: RemoteFleetNode): string {
  return `${telenoControlDir(node)}/rollback`
}

function receiptDir(node: RemoteFleetNode): string {
  return `${telenoControlDir(node)}/receipts`
}

function preserveReceiptCommand(node: RemoteFleetNode, action: 'rollback' | 'cleanup'): string {
  return [
    'set -eu',
    `mkdir -p ${remotePath(`${telenoControlDir(node)}/preserved`)} ${remotePath(receiptDir(node))}`,
    `test -f ${remotePath(node.paths.config)} && cp ${remotePath(node.paths.config)} ${remotePath(`${telenoControlDir(node)}/preserved/config.before-${action}.yml`)}`,
    `if test -d ${remotePath(`${node.paths.baseDir}/chain`)} || test -d ${remotePath(`${node.paths.baseDir}/blockchain`)} || test -d ${remotePath(`${node.paths.baseDir}/state`)}; then`,
    '  echo "TELENO_DB_PRESERVED existing chain/state DB paths were detected and left untouched";',
    'else',
    '  echo "TELENO_STOP_CRITERIA: cleanup state unknown";',
    '  exit 65;',
    'fi',
    `printf 'action=%s\\ndb_preserved=true\\n' ${q(action)} > ${remotePath(`${receiptDir(node)}/${action}-preserve.receipt`)}`,
    stopCriteriaGuardCommand(node)
  ].join('\n')
}

function rollbackEvidencePreflightCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `test -f ${remotePath(node.paths.config)}`,
    `grep -R "network: ${node.network}" ${remotePath(node.paths.config)}`,
    `grep -R "block_producer: false" ${remotePath(node.paths.config)}`,
    `test -f ${remotePath(`${rollbackHistoryDir(node)}/previous_image`)} || { echo "TELENO_STOP_CRITERIA: rollback evidence missing"; exit 65; }`,
    `test -f ${remotePath(`${rollbackHistoryDir(node)}/previous_config.yml`)} || { echo "TELENO_STOP_CRITERIA: rollback evidence missing"; exit 65; }`,
    `previous_image=$(cat ${remotePath(`${rollbackHistoryDir(node)}/previous_image`)})`,
    'case "$previous_image" in *[!A-Za-z0-9_./:@+-]*|"") echo "TELENO_STOP_CRITERIA: rollback evidence invalid"; exit 65;; esac',
    'echo "TELENO_ROLLBACK_EVIDENCE previous artifact and config present"',
    stopCriteriaGuardCommand(node)
  ].join('\n')
}

function cleanupEvidencePreflightCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `test -f ${remotePath(node.paths.config)}`,
    `grep -R "network: ${node.network}" ${remotePath(node.paths.config)}`,
    `grep -R "block_producer: false" ${remotePath(node.paths.config)}`,
    `if ! ls ${remotePath(receiptDir(node))}/*.receipt >/dev/null 2>&1; then echo "TELENO_STOP_CRITERIA: cleanup receipt evidence missing"; exit 65; fi`,
    stopCriteriaGuardCommand(node)
  ].join('\n')
}

function rollbackConfigCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `cp ${remotePath(`${rollbackHistoryDir(node)}/previous_config.yml`)} ${remotePath(node.paths.config)}`,
    `grep -R "network: ${node.network}" ${remotePath(node.paths.config)}`,
    `grep -R "block_producer: false" ${remotePath(node.paths.config)}`,
    'echo "TELENO_ROLLBACK_CONFIG applied previous observer config with producer disabled"'
  ].join('\n')
}

function rollbackRuntimeCommand(node: RemoteFleetNode): string {
  if (node.runtime.kind !== 'docker') {
    return 'echo "TELENO_STOP_CRITERIA: rollback runtime unsupported for this node"; exit 65'
  }
  const jsonrpcPort = bindPort(node.ports.jsonrpcHostBind) || '8080'
  return [
    'set -eu',
    `previous_image=$(cat ${remotePath(`${rollbackHistoryDir(node)}/previous_image`)})`,
    `docker pull "$previous_image"`,
    `${runtimeStopCommand(node)} || true`,
    `docker rm ${serviceName(node)} 2>/dev/null || true`,
    [
      `docker run -d --name ${serviceName(node)}`,
      `-v ${remotePath(node.paths.baseDir)}:/data`,
      `-p ${node.ports.jsonrpcHostBind}:${jsonrpcPort}`,
      `-p ${node.ports.p2pPublic}:${p2pInternalPort(node)}`,
      '"$previous_image"',
      '--basedir /data --config /data/config.yml'
    ].join(' '),
    'echo "TELENO_ROLLBACK_ARTIFACT started previous reviewed artifact with existing DB preserved"'
  ].join('\n')
}

function cleanupCandidateListCommand(node: RemoteFleetNode): string {
  const candidates = [
    `${node.paths.baseDir}/tmp`,
    `${node.paths.baseDir}/restore-work`,
    `${node.paths.baseDir}/backup-work`,
    `${telenoControlDir(node)}/tmp`
  ]
  return [
    'set -eu',
    `for item in ${candidates.map(remotePath).join(' ')}; do`,
    '  if test -e "$item"; then echo "TELENO_CLEANUP_CANDIDATE non-state temporary item present"; fi',
    'done',
    'echo "TELENO_DB_PRESERVED cleanup candidates exclude chain, blockchain, state, config, wallet, and producer data"'
  ].join('\n')
}

function cleanupTemporaryCommand(node: RemoteFleetNode): string {
  const candidates = [
    `${node.paths.baseDir}/tmp`,
    `${node.paths.baseDir}/restore-work`,
    `${node.paths.baseDir}/backup-work`,
    `${telenoControlDir(node)}/tmp`
  ]
  return [
    'set -eu',
    `for item in ${candidates.map(remotePath).join(' ')}; do`,
    '  case "$item" in',
    '    *chain*|*blockchain*|*state*|*wallet*|*producer*|*config.yml) echo "TELENO_STOP_CRITERIA: cleanup attempted protected path"; exit 65;;',
    '  esac',
    '  test -e "$item" && rm -rf -- "$item"',
    'done',
    `printf 'action=cleanup\\ndb_preserved=true\\n' > ${remotePath(`${receiptDir(node)}/cleanup.receipt`)}`,
    'echo "TELENO_DB_PRESERVED cleanup removed only non-state temporary items"'
  ].join('\n')
}

function destructiveReceiptCommand(node: RemoteFleetNode, action: 'rollback' | 'cleanup'): string {
  return [
    'set -eu',
    `mkdir -p ${remotePath(receiptDir(node))}`,
    `printf 'action=%s\\ndb_preserved=true\\nstatus=complete\\n' ${q(action)} > ${remotePath(`${receiptDir(node)}/${action}.receipt`)}`,
    `test -f ${remotePath(node.paths.config)} && grep -R "block_producer: false" ${remotePath(node.paths.config)}`,
    'echo "TELENO_DB_PRESERVED receipt recorded with state DB untouched"'
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
  const diskFloorKb = node.network === 'testnet' ? 20 * 1024 * 1024 : 120 * 1024 * 1024
  const ports = [
    bindPort(node.ports.jsonrpcHostBind),
    node.ports.p2pPublic,
    bindPort(node.ports.backupAdminListen)
  ].filter(Boolean)
  return [
    'set -eu',
    'uname -a',
    `df -Pk ${remotePath(node.paths.baseDir)} 2>/dev/null || df -Pk "$HOME" / || true`,
    'docker --version || { echo "TELENO_STOP_CRITERIA: docker/systemd prerequisite missing"; exit 65; }',
    `available_kb=$(df -Pk "$HOME" | awk 'NR==2 {print $4}')`,
    `if [ "$available_kb" -lt ${diskFloorKb} ]; then echo "TELENO_STOP_CRITERIA: disk floor violation"; exit 65; fi`,
    `if [ -e ${remotePath(node.paths.baseDir)} ]; then echo "TELENO_STOP_CRITERIA: disposable BASEDIR already exists"; exit 65; fi`,
    `if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Fx ${q(serviceName(node))} >/dev/null; then echo "TELENO_STOP_CRITERIA: container already exists"; exit 65; fi`,
    ...ports.map(portInUseGuard)
  ].join('\n')
}

function prodnetProofReferenceCommand(node: RemoteFleetNode): string {
  return [
    'set -eu',
    `echo "TELENO_PRODNET_PROOF_RECEIPT ${node.trust.prodnetObserverProofRef}"`,
    `echo "TELENO_ARTIFACT_DIGEST_PINNED ${node.trust.artifactDigest}"`,
    `echo "TELENO_BOOTSTRAP_POLICY ${node.trust.bootstrapPolicyId}"`,
    'echo "TELENO_PRODNET_OBSERVER_ONLY block_production_disabled"'
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
  if (node.network === 'mainnet' && ['install-observer', 'restore-public-bootstrap', 'start-observer', 'upgrade', 'rollback', 'cleanup'].includes(action)) {
    notices.push({ code: 'prodnetConfirmationRequired', field: node.id })
  }
  if (isProdnetObserverMutation(action, node) || action === 'prodnet-observer-proof') {
    if (!hasPinnedArtifactDigest(node)) notices.push({ code: 'prodnetArtifactTrustRequired', field: node.id, value: node.trust.artifactDigest || node.runtime.image })
    if (!hasProdnetBootstrapPolicy(node)) notices.push({ code: 'prodnetBootstrapPolicyRequired', field: node.id, value: node.trust.bootstrapPolicyId })
    if (isProdnetObserverMutation(action, node) && !hasProdnetDryRunProof(node)) {
      notices.push({ code: 'prodnetDryRunProofRequired', field: node.id, value: node.trust.prodnetObserverProofRef })
    }
  }

  const prodnetMutation = isProdnetObserverMutation(action, node)
  if (prodnetMutation) {
    steps.push(
      commandStep('proof', ssh(node, prodnetProofReferenceCommand(node))),
      commandStep('trust', ssh(node, prodnetArtifactTrustCommand(node))),
      commandStep('bootstrap', ssh(node, prodnetBootstrapTrustCommand(node)))
    )
  }

  if (action === 'prodnet-observer-proof') {
    steps.push(
      commandStep('preflight', ssh(node, installPreflightCommand(node))),
      commandStep('trust', ssh(node, prodnetArtifactTrustCommand(node))),
      commandStep('bootstrap', ssh(node, prodnetBootstrapTrustCommand(node))),
      commandStep('proof', ssh(node, prodnetObserverProofCommand(node))),
      commandStep('verify', ssh(node, `echo "TELENO_PRODNET_PROOF_READY ${node.id} observer-only"`))
    )
  } else if (action === 'install-observer') {
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
      commandStep('preflight', ssh(node, rollbackEvidencePreflightCommand(node))),
      commandStep('preserve', ssh(node, preserveReceiptCommand(node, 'rollback')), { hostMutation: true }),
      commandStep('runtime', ssh(node, runtimeStopCommand(node)), { hostMutation: true, destructive: true }),
      commandStep('config', ssh(node, rollbackConfigCommand(node)), { hostMutation: true, destructive: true }),
      commandStep('artifact', ssh(node, rollbackRuntimeCommand(node)), { hostMutation: true, destructive: true }),
      commandStep('verify', ssh(node, `${runtimeStatusCommand(node)}; grep -R "block_producer: false" ${remotePath(node.paths.config)}\n${stopCriteriaGuardCommand(node)}`)),
      commandStep('receipt', ssh(node, destructiveReceiptCommand(node, 'rollback')), { hostMutation: true })
    )
  } else if (action === 'cleanup') {
    steps.push(
      commandStep('preflight', ssh(node, cleanupEvidencePreflightCommand(node))),
      commandStep('preserve', ssh(node, preserveReceiptCommand(node, 'cleanup')), { hostMutation: true }),
      commandStep('cleanup', ssh(node, cleanupCandidateListCommand(node))),
      commandStep('cleanup', ssh(node, cleanupTemporaryCommand(node)), { hostMutation: true, destructive: true }),
      commandStep('verify', ssh(node, `test -f ${remotePath(node.paths.config)}; grep -R "block_producer: false" ${remotePath(node.paths.config)}\n${stopCriteriaGuardCommand(node)}`)),
      commandStep('receipt', ssh(node, destructiveReceiptCommand(node, 'cleanup')), { hostMutation: true })
    )
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
    'publicBootstrapMissing',
    'prodnetArtifactTrustRequired',
    'prodnetBootstrapPolicyRequired',
    'prodnetDryRunProofRequired'
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

export function generateRemoteFleetRolloutPlan(
  inventory: RemoteFleetInventory,
  nodeIds: string[],
  action: RemoteNodeAction
): RemoteFleetRolloutPlan {
  const selectedIds = nodeIds.length > 0 ? nodeIds : inventory.nodes.map((node) => node.id)
  const entries = selectedIds.flatMap((nodeId) => {
    const node = inventory.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const plan = generateRemoteCommandPlan(inventory, node.id, action)
    return [{
      nodeId: node.id,
      label: node.label,
      network: node.network,
      status: 'reviewing' as const,
      plan,
      blocked: plan.blocked,
      stepCount: plan.steps.length,
      notices: plan.notices,
      confirmationPhrase: `EXECUTE ${node.id} ${node.network} ${action}${action === 'rollback' || action === 'cleanup' ? ' PRESERVE_DB' : ''}`
    }]
  })

  return {
    action,
    nodeIds: entries.map((entry) => entry.nodeId),
    entries,
    blocked: entries.length === 0 || entries.some((entry) => entry.blocked),
    stepCount: entries.reduce((total, entry) => total + entry.stepCount, 0),
    networks: [...new Set(entries.map((entry) => entry.network))]
  }
}
