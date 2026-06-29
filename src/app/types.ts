import type { CSSProperties } from 'react'
import type { KoinosNetworkId } from './network'

export type ExplorerSettings = {
  rpcSource: ExplorerRpcSource
  publicRpcUrls: string[]
  koinscanUrl: string
  pollMs: number
  rowLimit: number
  producerAdvancedMode: boolean
  nodeAdvancedMode: boolean
  dashboardProducerWindowBlocks: number
  dashboardRefreshSeconds: number
}

export type ExplorerRpcSource = 'local' | string

export type NodeManagerSettings = {
  network: KoinosNetworkId
  repoPath: string
  baseDir: string
  profiles: string
  blockchainBackupUrl: string
  backup: NodeBackupSettings
}

export type NodeBackupAuthMethod = 'private-key' | 'password-file' | 'env-password'

export type NodeBackupSettings = {
  localEnabled: boolean
  localDirectory: string
  workspace: string
  localRetentionCount: number
  remoteEnabled: boolean
  remoteDirectory: string
  remoteRetentionCount: number
  remoteRetentionDays: number
  uploadTempSuffix: string
  sshHost: string
  sshPort: number
  sshUser: string
  sshAuth: NodeBackupAuthMethod
  sshPrivateKeyFile: string
  sshPasswordFile: string
  sshPassphraseFile: string
  sshKnownHostsFile: string
  sshStrictHostKeyChecking: boolean
  sshConnectTimeoutSeconds: number
  scheduleEnabled: boolean
  scheduleInterval: string
  scheduleRunOnStartupIfMissed: boolean
  scheduleJitterSeconds: number
  scheduleMinimumHeadProgress: number
  scheduleSkipIfSyncingFromGenesis: boolean
  scheduleMaxConcurrentBackups: number
  adminEnabled: boolean
  adminListen: string
  adminTokenFile: string
  adminJobs: number
}

export type NodeAction = 'start' | 'stop'
export type NodeServiceAction = 'start' | 'stop' | 'restart'
export type AppTab = 'explorer' | 'dashboard' | 'node' | 'remote' | 'producer' | 'wallet' | 'settings'
export type DashboardSubtab = 'producers' | 'peers' | 'forecast' | 'performance'
export type NodeManagedFileKind = 'config'

export type NodeServiceContextMenuState = {
  serviceId: string
  x: number
  y: number
}

export type NodeServiceActionState = {
  serviceId: string
  action: NodeServiceAction
}

export type NodeNativeBuildActionState = 'all' | string

export type NodeServiceCapabilities = {
  running: boolean
  dependencyNames: string[]
  missingDependencyNames: string[]
  profileDependentNames: string[]
  conflictReason: string | null
  conflictPids: number[]
  startBlockedReason: string | null
  stopBlockedReason: string | null
  restartBlockedReason: string | null
}

export type NodeConflictDialogState = {
  serviceId: string
  serviceName: string
  conflictPids: number[]
  message: string
}

export type NodeBackupProgressState = {
  action: 'restore-backup' | 'restore-backup-verify' | 'create-backup'
  phase: TelenoNodeBackupProgressEvent['phase']
  progress: number
  message: string
  updatedAt: number
}

export type NodeBaseDirValidationState = {
  ok: boolean
  baseDir: string
  restoreWorkspaceParent: string
  message: string
}

export type NodeBaseDirChangeDialogState = {
  previousBaseDir: string
  nextBaseDir: string
  nodeWasRunning: boolean
}

export type BlockRow = {
  height: number
  blockId: string
  previousId: string
  signer: string
  timestampMs: number
}

export type HeadSnapshot = {
  id: string
  height: number
  timestampMs: number
}

export type NodeProducerActionState = 'register' | 'delete' | null

export type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse<T> = {
  jsonrpc: string
  id: number | string | null
  result?: T
  error?: JsonRpcError
}

export type HeadInfoResult = {
  head_topology?: {
    id?: string
    height?: string
  }
  head_block_time?: string
}

export type BlockStoreItem = {
  block_id?: string
  block_height?: string
  block?: {
    id?: string
    header?: {
      previous?: string
      height?: string
      timestamp?: string
      signer?: string
    }
  }
}

export type BlocksByHeightResult = {
  block_items?: BlockStoreItem[]
}

// --- Rich block detail types ---

export type BlockDetailStoreItem = {
  block_id?: string
  block_height?: string
  block?: {
    id?: string
    header?: {
      previous?: string
      height?: string
      timestamp?: string
      signer?: string
      transaction_merkle_root?: string
      previous_state_merkle_root?: string
      approved_proposals?: string[]
    }
    transactions?: RawTransaction[]
    signature?: string
  }
  receipt?: {
    id?: string
    transaction_receipts?: RawTransactionReceipt[]
    state_delta_entries?: unknown[]
  }
}

export type RawTransaction = {
  id?: string
  header?: {
    chain_id?: string
    rc_limit?: string
    nonce?: string
    operation_merkle_root?: string
    payer?: string
    payee?: string
  }
  operations?: RawOperation[]
  signatures?: string[]
}

export type RawOperation = {
  call_contract?: { contract_id?: string; entry_point?: number; args?: string }
  upload_contract?: { contract_id?: string; bytecode?: string; abi?: string; authorizes_call_contract?: boolean; authorizes_transaction_application?: boolean; authorizes_upload_contract?: boolean }
  set_system_call?: { call_id?: number; target?: { system_call_bundle?: { contract_id?: string; entry_point?: number } } }
  set_system_contract?: { contract_id?: string; system_contract?: boolean }
}

export type RawTransactionReceipt = {
  id?: string
  payer?: string
  max_payer_rc?: string
  rc_limit?: string
  rc_used?: string
  disk_storage_used?: string
  network_bandwidth_used?: string
  compute_bandwidth_used?: string
  reverted?: boolean
  events?: RawEvent[]
  logs?: string[]
  state_delta_entries?: unknown[]
}

export type RawEvent = {
  source?: string
  name?: string
  data?: string
  impacted?: string[]
}

export type BlockDetail = {
  height: number
  blockId: string
  previousId: string
  signer: string
  timestampMs: number
  signature: string
  transactionMerkleRoot: string
  previousStateMerkleRoot: string
  approvedProposals: string[]
  transactions: TransactionDetail[]
  raw: object
}

export type TransactionDetail = {
  id: string
  payer: string
  payee: string
  rcLimit: number
  nonce: string
  operations: OperationDetail[]
  signatures: string[]
  receipt: TransactionReceiptDetail | null
}

export type TransactionReceiptDetail = {
  rcUsed: number
  rcLimit: number
  diskStorageUsed: number
  networkBandwidthUsed: number
  computeBandwidthUsed: number
  reverted: boolean
  events: EventDetail[]
  logs: string[]
}

export type OperationDetail = {
  type: string
  contractId: string
  entryPoint: number
  args: string
}

export type EventDetail = {
  source: string
  name: string
  data: string
  impacted: string[]
}

export type BlocksByIdResult = {
  block_items?: BlockDetailStoreItem[]
}

export type AnsiStyleState = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export type AnsiTextSegment = {
  text: string
  style?: CSSProperties
}

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string
