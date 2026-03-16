import type { CSSProperties } from 'react'

export type ExplorerSettings = {
  rpcSource: ExplorerRpcSource
  publicRpcUrls: string[]
  pollMs: number
  rowLimit: number
  producerAdvancedMode: boolean
  dashboardProducerWindowBlocks: number
  dashboardRefreshSeconds: number
}

export type ExplorerRpcSource = 'local' | string

export type NodeManagerSettings = {
  repoPath: string
  composeFile: string
  envFile: string
  baseDir: string
  profiles: string
  blockchainBackupUrl: string
  runtimeMode: KnodelKoinosNodeServiceRuntime
}

export type NodeAction = 'start' | 'stop'
export type NodeServiceAction = 'start' | 'stop' | 'restart'
export type AppTab = 'explorer' | 'dashboard' | 'node' | 'producer' | 'wallet' | 'settings'
export type DashboardSubtab = 'producers' | 'peers' | 'forecast' | 'performance'
export type NodeManagedFileKind = 'compose' | 'env' | 'config'

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
  action: 'restore-backup' | 'restore-backup-verify'
  phase: KnodelKoinosNodeBackupProgressEvent['phase']
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
