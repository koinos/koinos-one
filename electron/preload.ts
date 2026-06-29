import { contextBridge, ipcRenderer } from 'electron'

const LOGS_FOLLOW_EVENT_CHANNEL = 'teleno:node:logs-follow:event'
const BACKUP_PROGRESS_EVENT_CHANNEL = 'teleno:node:backup-progress:event'
const REMOTE_EXECUTION_PROGRESS_EVENT_CHANNEL = 'teleno:remote-nodes:execution-progress:event'

// Read version via IPC from main process (preload can't require package.json reliably)
const appVersion = ipcRenderer.sendSync('teleno:app-version') || '0.10.1'
const appBuildInfo = ipcRenderer.sendSync('teleno:app-build-info') || {
  schemaVersion: 1,
  productVersion: appVersion,
  releaseChannel: 'dev',
  buildTimestamp: null,
  gitCommit: null,
  gitShortCommit: null,
  gitBranch: null,
  gitDirty: null,
  nativeNode: {
    binaryName: 'teleno_node',
    sha256: null,
    shortSha256: null,
    sizeBytes: null,
    mtime: null
  },
  source: 'runtime'
}

type LaunchDefaults = {
  nodeSettings?: Record<string, unknown>
}

function parseLaunchDefaults(): LaunchDefaults {
  const rawNodeSettings = process.env.TELENO_LAUNCH_NODE_SETTINGS_JSON
  if (!rawNodeSettings) return {}

  try {
    const nodeSettings = JSON.parse(rawNodeSettings) as Record<string, unknown>
    return nodeSettings && typeof nodeSettings === 'object' ? { nodeSettings } : {}
  } catch {
    return {}
  }
}

contextBridge.exposeInMainWorld('teleno', {
  version: appVersion,
  buildInfo: appBuildInfo,
  launchDefaults: parseLaunchDefaults(),
  app: {
    quit: () => ipcRenderer.invoke('teleno:app:quit'),
    firstRunSetupState: () => ipcRenderer.invoke('teleno:app:first-run-state'),
    completeFirstRunSetup: (params?: unknown) => ipcRenderer.invoke('teleno:app:first-run-complete', params),
    resetFirstRunSetup: () => ipcRenderer.invoke('teleno:app:first-run-reset')
  },
  appConfig: {
    loadPublicRpcUrls: () => ipcRenderer.invoke('teleno:app-config:public-rpcs:load'),
    savePublicRpcUrls: (params?: unknown) => ipcRenderer.invoke('teleno:app-config:public-rpcs:save', params)
  },
  remoteNodes: {
    loadInventory: () => ipcRenderer.invoke('teleno:remote-nodes:inventory:load'),
    saveInventory: (params?: unknown) => ipcRenderer.invoke('teleno:remote-nodes:inventory:save', params),
    loadReceipts: () => ipcRenderer.invoke('teleno:remote-nodes:receipts:load'),
    executePlan: (params?: unknown) => ipcRenderer.invoke('teleno:remote-nodes:execute-plan', params),
    onExecutionProgressEvent: (listener: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(REMOTE_EXECUTION_PROGRESS_EVENT_CHANNEL, wrapped)
      return () => {
        ipcRenderer.removeListener(REMOTE_EXECUTION_PROGRESS_EVENT_CHANNEL, wrapped)
      }
    }
  },
  telenoNode: {
    defaults: () => ipcRenderer.invoke('teleno:node:defaults'),
    saveBackupPasswordFile: (params?: unknown) => ipcRenderer.invoke('teleno:node:backup-password-file', params),
    cloneRepo: (settings?: unknown) => ipcRenderer.invoke('teleno:node:clone-repo', settings),
    fileRead: (params?: unknown) => ipcRenderer.invoke('teleno:node:file-read', params),
    fileWrite: (params?: unknown) => ipcRenderer.invoke('teleno:node:file-write', params),
    selectBaseDir: (settings?: unknown) => ipcRenderer.invoke('teleno:node:select-base-dir', settings),
    validateBaseDir: (settings?: unknown) => ipcRenderer.invoke('teleno:node:validate-base-dir', settings),
    copyBaseDirData: (params?: unknown) => ipcRenderer.invoke('teleno:node:copy-base-dir-data', params),
    status: (settings?: unknown) => ipcRenderer.invoke('teleno:node:status', settings),
    presets: (settings?: unknown) => ipcRenderer.invoke('teleno:node:presets', settings),
    nativeBuilds: () => ipcRenderer.invoke('teleno:node:native-builds'),
    nativeBuildAll: () => ipcRenderer.invoke('teleno:node:native-build-all'),
    nativeBuildService: (params?: unknown) => ipcRenderer.invoke('teleno:node:native-build-service', params),
    start: (settings?: unknown) => ipcRenderer.invoke('teleno:node:start', settings),
    stop: (settings?: unknown) => ipcRenderer.invoke('teleno:node:stop', settings),
    restoreBackup: (settings?: unknown) => ipcRenderer.invoke('teleno:node:restore-backup', settings),
    restoreBackupVerify: (settings?: unknown) => ipcRenderer.invoke('teleno:node:restore-backup-verify', settings),
    createBackup: (settings?: unknown) => ipcRenderer.invoke('teleno:node:create-backup', settings),
    nativeBackupDryRun: (settings?: unknown) => ipcRenderer.invoke('teleno:node:native-backup-dry-run', settings),
    nativeBackupConfig: (settings?: unknown) => ipcRenderer.invoke('teleno:node:native-backup-config', settings),
    nativeBackupList: (settings?: unknown) => ipcRenderer.invoke('teleno:node:native-backup-list', settings),
    nativeBackupPurge: (settings?: unknown) => ipcRenderer.invoke('teleno:node:native-backup-purge', settings),
    nativeBackupRestorePreflight: (settings?: unknown) => ipcRenderer.invoke('teleno:node:native-backup-restore-preflight', settings),
    restoreNativeBackup: (settings?: unknown) => ipcRenderer.invoke('teleno:node:restore-native-backup', settings),
    restoreNativeBackupLatest: (settings?: unknown) => ipcRenderer.invoke('teleno:node:restore-native-backup-latest', settings),
    cancelCreateBackup: () => ipcRenderer.invoke('teleno:node:cancel-create-backup'),
    restoreLocalBackup: (settings?: unknown) => ipcRenderer.invoke('teleno:node:restore-local-backup', settings),
    getVerifyBlocks: (settings?: unknown) => ipcRenderer.invoke('teleno:node:get-verify-blocks', settings),
    setVerifyBlocks: (settings?: unknown) => ipcRenderer.invoke('teleno:node:set-verify-blocks', settings),
    backupInfo: (url?: string) => ipcRenderer.invoke('teleno:node:backup-info', url),
    rpcCall: (params?: unknown) => ipcRenderer.invoke('teleno:node:rpc-call', params),
    dashboardProducers: (params?: unknown) => ipcRenderer.invoke('teleno:node:dashboard-producers', params),
    dashboardPeers: (params?: unknown) => ipcRenderer.invoke('teleno:node:dashboard-peers', params),
    dashboardPerformance: (params?: unknown) => ipcRenderer.invoke('teleno:node:dashboard-performance', params),
    producerOverview: (settings?: unknown) => ipcRenderer.invoke('teleno:node:producer-overview', settings),
    producerRegisteredKey: (settings?: unknown) => ipcRenderer.invoke('teleno:node:producer-registered-key', settings),
    producerLocalInfo: (settings?: unknown) => ipcRenderer.invoke('teleno:node:producer-local-info', settings),
    producerRegister: (params?: unknown) => ipcRenderer.invoke('teleno:node:producer-register', params),
    producerProfileGet: () => ipcRenderer.invoke('teleno:node:producer-profile-get'),
    producerProfileClear: () => ipcRenderer.invoke('teleno:node:producer-profile-clear'),
    producerDelete: (settings?: unknown) => ipcRenderer.invoke('teleno:node:producer-delete', settings),
    serviceStart: (params?: unknown) => ipcRenderer.invoke('teleno:node:service-start', params),
    serviceStop: (params?: unknown) => ipcRenderer.invoke('teleno:node:service-stop', params),
    serviceRestart: (params?: unknown) => ipcRenderer.invoke('teleno:node:service-restart', params),
    serviceKillConflict: (params?: unknown) => ipcRenderer.invoke('teleno:node:service-kill-conflict', params),
    componentToggle: (params?: unknown) => ipcRenderer.invoke('teleno:node:component-toggle', params),
    presetReconcile: (params?: unknown) => ipcRenderer.invoke('teleno:node:preset-reconcile', params),
    logs: (params?: unknown) => ipcRenderer.invoke('teleno:node:logs', params),
    logsFollowStart: (params?: unknown) => ipcRenderer.invoke('teleno:node:logs-follow-start', params),
    logsFollowStop: (params?: unknown) => ipcRenderer.invoke('teleno:node:logs-follow-stop', params),
    onLogsFollowEvent: (listener: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(LOGS_FOLLOW_EVENT_CHANNEL, wrapped)
      return () => {
        ipcRenderer.removeListener(LOGS_FOLLOW_EVENT_CHANNEL, wrapped)
      }
    },
    onBackupProgressEvent: (listener: (event: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(BACKUP_PROGRESS_EVENT_CHANNEL, wrapped)
      return () => {
        ipcRenderer.removeListener(BACKUP_PROGRESS_EVENT_CHANNEL, wrapped)
      }
    }
  },
  wallet: {
    overview: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:overview', params),
    generate: () => ipcRenderer.invoke('teleno:wallet:generate'),
    importWallet: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:import', params),
    listAccounts: () => ipcRenderer.invoke('teleno:wallet:list-accounts'),
    setActiveAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:set-active-account', params),
    setProducerAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:set-producer-account', params),
    createDerivedAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:create-derived-account', params),
    importAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:import-account', params),
    importWatchAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:import-watch-account', params),
    renameAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:rename-account', params),
    removeAccount: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:remove-account', params),
    unlock: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:unlock', params),
    closeWallet: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:close', params),
    deleteWallet: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:delete', params),
    addressFromWif: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:address-from-wif', params),
    deriveFromSeed: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:derive-from-seed', params),
    showSeed: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:show-seed', params),
    chainInfo: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:chain-info', params),
    block: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:block', params),
    balance: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:balance', params),
    vhp: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:vhp', params),
    nonce: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:nonce', params),
    rc: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:rc', params),
    tokenBalance: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:token-balance', params),
    readContract: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:read-contract', params),
    transferKoin: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:transfer-koin', params),
    burn: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:burn', params),
    transferVhp: (params?: unknown) => ipcRenderer.invoke('teleno:wallet:transfer-vhp', params)
  }
})
