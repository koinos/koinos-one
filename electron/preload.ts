import { contextBridge, ipcRenderer } from 'electron'

const LOGS_FOLLOW_EVENT_CHANNEL = 'knodel:koinos-node:logs-follow:event'

contextBridge.exposeInMainWorld('knodel', {
  version: '0.1.0',
  koinosNode: {
    defaults: () => ipcRenderer.invoke('knodel:koinos-node:defaults'),
    cloneRepo: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:clone-repo', settings),
    fileRead: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:file-read', params),
    fileWrite: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:file-write', params),
    status: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:status', settings),
    presets: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:presets', settings),
    start: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:start', settings),
    stop: (settings?: unknown) => ipcRenderer.invoke('knodel:koinos-node:stop', settings),
    serviceStart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-start', params),
    serviceStop: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-stop', params),
    serviceRestart: (params?: unknown) => ipcRenderer.invoke('knodel:koinos-node:service-restart', params),
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
    }
  }
})
