import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('knodel', {
  version: '0.1.0'
})
