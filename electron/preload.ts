import fs from 'node:fs'
import path from 'node:path'
import { contextBridge, ipcRenderer } from 'electron'

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'
const BACKUP_PROGRESS_EVENT_CHANNEL = 'knodel:koinos-node:backup-progress:event'
const FALLBACK_KNODEL_VERSION = '0.2.0'

function resolveKnodelVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json')
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : FALLBACK_KNODEL_VERSION
  } catch {
    return FALLBACK_KNODEL_VERSION
  }
}

const KNODEL_VERSION = resolveKnodelVersion()

contextBridge.exposeInMainWorld('knodel', {
  version: KNODEL_VERSION,
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
    rpcCall: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:rpc-call', params),
    serviceStart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-start', params),
    serviceStop: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-stop', params),
    serviceRestart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-restart', params),
    serviceKillConflict: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-kill-conflict', params),
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
  }
})
