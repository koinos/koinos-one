import { contextBridge, ipcRenderer } from 'electron'

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'
const BACKUP_PROGRESS_EVENT_CHANNEL = 'knodel:koinos-node:backup-progress:event'

// Read version via IPC from main process (preload can't require package.json reliably)
const appVersion = ipcRenderer.sendSync('knodel:app-version') || '0.10.1'

contextBridge.exposeInMainWorld('knodel', {
  version: appVersion,
  appConfig: {
    loadPublicRpcUrls: () => ipcRenderer.invoke('knodel:app-config:public-rpcs:load'),
    savePublicRpcUrls: (params?: unknown) => ipcRenderer.invoke('knodel:app-config:public-rpcs:save', params)
  },
  koinosNode: {
    defaults: () => ipcRenderer.invoke('knodel:koinos-node:defaults'),
    cloneRepo: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:clone-repo', settings),
    fileRead: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:file-read', params),
    fileWrite: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:file-write', params),
    selectBaseDir: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:select-base-dir', settings),
    validateBaseDir: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:validate-base-dir', settings),
    copyBaseDirData: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:copy-base-dir-data', params),
    status: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:status', settings),
    presets: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:presets', settings),
    nativeBuilds: () => ipcRenderer.invoke('knodel:koinos-node:native-builds'),
    nativeBuildAll: () => ipcRenderer.invoke('knodel:koinos-node:native-build-all'),
    nativeBuildService: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:native-build-service', params),
    start: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:start', settings),
    stop: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:stop', settings),
    restoreBackup: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:restore-backup', settings),
    restoreBackupVerify: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:restore-backup-verify', settings),
    createBackup: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:create-backup', settings),
    cancelCreateBackup: () => ipcRenderer.invoke('knodel:koinos-node:cancel-create-backup'),
    restoreLocalBackup: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:restore-local-backup', settings),
    getVerifyBlocks: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:get-verify-blocks', settings),
    setVerifyBlocks: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:set-verify-blocks', settings),
    backupInfo: (url?: string) => ipcRenderer.invoke('knodel:koinos-node:backup-info', url),
    rpcCall: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:rpc-call', params),
    dashboardProducers: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:dashboard-producers', params),
    dashboardPeers: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:dashboard-peers', params),
    dashboardPerformance: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:dashboard-performance', params),
    producerOverview: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:producer-overview', settings),
    producerRegisteredKey: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:producer-registered-key', settings),
    producerLocalInfo: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:producer-local-info', settings),
    producerRegister: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:producer-register', params),
    producerProfileGet: () => ipcRenderer.invoke('knodel:koinos-node:producer-profile-get'),
    producerProfileClear: () => ipcRenderer.invoke('knodel:koinos-node:producer-profile-clear'),
    producerDelete: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:producer-delete', settings),
    serviceStart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-start', params),
    serviceStop: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-stop', params),
    serviceRestart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-restart', params),
    serviceKillConflict: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-kill-conflict', params),
    componentToggle: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:component-toggle', params),
    presetReconcile: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:preset-reconcile', params),
    logs: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:logs', params),
    logsFollowStart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:logs-follow-start', params),
    logsFollowStop: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:logs-follow-stop', params),
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
    overview: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:overview', params),
    generate: () => ipcRenderer.invoke('knodel:wallet:generate'),
    importWallet: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:import', params),
    listAccounts: () => ipcRenderer.invoke('knodel:wallet:list-accounts'),
    setActiveAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:set-active-account', params),
    createDerivedAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:create-derived-account', params),
    importAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:import-account', params),
    importWatchAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:import-watch-account', params),
    renameAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:rename-account', params),
    removeAccount: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:remove-account', params),
    unlock: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:unlock', params),
    closeWallet: () => ipcRenderer.invoke('knodel:wallet:close'),
    deleteWallet: () => ipcRenderer.invoke('knodel:wallet:delete'),
    addressFromWif: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:address-from-wif', params),
    deriveFromSeed: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:derive-from-seed', params),
    showSeed: () => ipcRenderer.invoke('knodel:wallet:show-seed'),
    chainInfo: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:chain-info', params),
    block: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:block', params),
    balance: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:balance', params),
    vhp: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:vhp', params),
    nonce: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:nonce', params),
    rc: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:rc', params),
    tokenBalance: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:token-balance', params),
    readContract: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:read-contract', params),
    transferKoin: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:transfer-koin', params),
    burn: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:burn', params),
    transferVhp: (params?: unknown) => ipcRenderer.invoke('knodel:wallet:transfer-vhp', params)
  }
})
