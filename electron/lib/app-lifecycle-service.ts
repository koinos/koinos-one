import path from 'node:path'

import { BrowserWindow, dialog, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'

import type { KoinosNodeSettingsInput, KoinosNodeStatus, NativeServiceProcessState } from './main-types'

type AppLifecycleServiceDeps = {
  isDev: boolean
  viteDevServerUrl?: string
  preloadPath: string
  nodeSettingsStorageKey: string
  languageStorageKey: string
  parsePersistedNodeSettings: (input: unknown) => KoinosNodeSettingsInput | undefined
  koinosNodeStatus: (input?: KoinosNodeSettingsInput) => Promise<KoinosNodeStatus>
  isComposeServiceRunning: (service: KoinosNodeStatus['services'][number]) => boolean
  koinosNodeAction: (action: 'start' | 'stop', input?: KoinosNodeSettingsInput) => Promise<unknown>
  nativeServiceProcesses: Map<string, NativeServiceProcessState>
  getLogsFollowStreamIds: () => string[]
  stopLogsFollowStream: (streamId: string) => void
  getMainWindow: () => BrowserWindow | null
  setMainWindow: (win: BrowserWindow | null) => void
  getAppShutdownApproved: () => boolean
  setAppShutdownApproved: (value: boolean) => void
  getAppShutdownInProgress: () => boolean
  setAppShutdownInProgress: (value: boolean) => void
  quitApp: () => void
}

function localizedShutdownCopy(language: string | null | undefined): {
  confirmTitle: string
  confirmMessage: string
  confirmDetailPrefix: string
  confirmAction: string
  cancelAction: string
  stoppingWindowTitle: string
  stopFailedTitle: string
  stopFailedMessage: string
  stopFailedDetailPrefix: string
  keepOpenAction: string
  forceCloseAction: string
} {
  const spanish = `${language || ''}`.toLowerCase().startsWith('es')
  if (spanish) {
    return {
      confirmTitle: 'Detener nodo antes de cerrar',
      confirmMessage: 'Knodel debe detener los servicios activos del nodo antes de cerrar.',
      confirmDetailPrefix: 'Servicios activos',
      confirmAction: 'Detener y cerrar',
      cancelAction: 'Cancelar',
      stoppingWindowTitle: 'Knodel - Deteniendo nodo...',
      stopFailedTitle: 'No se pudo detener el nodo',
      stopFailedMessage: 'Knodel no pudo detener todos los servicios antes de cerrar.',
      stopFailedDetailPrefix: 'Salida del stop',
      keepOpenAction: 'Mantener abierta',
      forceCloseAction: 'Forzar cierre'
    }
  }

  return {
    confirmTitle: 'Stop node before closing',
    confirmMessage: 'Knodel needs to stop running node services before it closes.',
    confirmDetailPrefix: 'Running services',
    confirmAction: 'Stop and close',
    cancelAction: 'Cancel',
    stoppingWindowTitle: 'Knodel - Stopping node...',
    stopFailedTitle: 'Could not stop the node',
    stopFailedMessage: 'Knodel could not stop all managed services before closing.',
    stopFailedDetailPrefix: 'Stop output',
    keepOpenAction: 'Keep open',
    forceCloseAction: 'Force close'
  }
}

export function createAppLifecycleService(deps: AppLifecycleServiceDeps) {
  async function loadRendererShutdownContext(
    win: BrowserWindow | null
  ): Promise<{ nodeSettings?: KoinosNodeSettingsInput; language: string | null }> {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return { language: null }
    }

    try {
      const context = (await win.webContents.executeJavaScript(
        `(() => {
          try {
            const rawNodeSettings = window.localStorage.getItem(${JSON.stringify(deps.nodeSettingsStorageKey)})
            const rawLanguage = window.localStorage.getItem(${JSON.stringify(deps.languageStorageKey)})
            return {
              nodeSettings: rawNodeSettings ? JSON.parse(rawNodeSettings) : null,
              language: typeof rawLanguage === 'string' ? rawLanguage : null
            }
          } catch {
            return { nodeSettings: null, language: null }
          }
        })()`,
        true
      )) as { nodeSettings?: unknown; language?: unknown } | null

      return {
        nodeSettings: deps.parsePersistedNodeSettings(context?.nodeSettings),
        language: typeof context?.language === 'string' ? context.language : null
      }
    } catch {
      return { language: null }
    }
  }

  function listRunningManagedServiceNames(status: KoinosNodeStatus): string[] {
    return status.services.filter(deps.isComposeServiceRunning).map((service) => service.name)
  }

  function withShutdownWindowState(win: BrowserWindow | null, title: string): () => void {
    if (!win || win.isDestroyed()) return () => {}
    const previousTitle = win.getTitle()
    try {
      win.setProgressBar(2)
      win.setTitle(title)
    } catch {
      return () => {}
    }

    return () => {
      if (win.isDestroyed()) return
      try {
        win.setProgressBar(-1)
        win.setTitle(previousTitle)
      } catch {
        // ignore UI reset errors during shutdown
      }
    }
  }

  function showMessageBoxForWindow(
    win: BrowserWindow | null,
    options: MessageBoxOptions
  ): Promise<MessageBoxReturnValue> {
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }

  async function confirmNodeShutdownBeforeQuit(win: BrowserWindow | null): Promise<boolean> {
    const { nodeSettings, language } = await loadRendererShutdownContext(win)
    const copy = localizedShutdownCopy(language)
    const status = await deps.koinosNodeStatus(nodeSettings)
    const runningServiceNames = listRunningManagedServiceNames(status)
    const needsManagedShutdown = status.runningServices > 0 || deps.nativeServiceProcesses.size > 0
    const runningServiceCount = Math.max(status.runningServices, runningServiceNames.length, deps.nativeServiceProcesses.size)

    if (!needsManagedShutdown) return true

    const detailLines = [
      `${copy.confirmDetailPrefix} (${runningServiceCount}): ${
        runningServiceNames.length
          ? runningServiceNames.join(', ')
          : language?.toLowerCase().startsWith('es')
            ? 'servicios gestionados del nodo'
            : 'managed node services'
      }`,
      '',
      language?.toLowerCase().startsWith('es')
        ? 'Detenerlos antes de salir ayuda a evitar corrupcion de archivos y de estado.'
        : 'Stopping them before quit helps prevent file and runtime state corruption.'
    ]

    const confirmation = await showMessageBoxForWindow(win, {
      type: 'warning',
      title: copy.confirmTitle,
      message: copy.confirmMessage,
      detail: detailLines.join('\n'),
      buttons: [copy.confirmAction, copy.cancelAction],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (confirmation.response !== 0) return false

    const restoreWindow = withShutdownWindowState(win, copy.stoppingWindowTitle)

    try {
      const stopResult = (await deps.koinosNodeAction('stop', nodeSettings)) as { ok?: boolean; output?: string }
      if (stopResult.ok) return true

      const failure = await showMessageBoxForWindow(win, {
        type: 'error',
        title: copy.stopFailedTitle,
        message: copy.stopFailedMessage,
        detail: [stopResult.output ? `${copy.stopFailedDetailPrefix}:\n${stopResult.output}` : '', '']
          .filter(Boolean)
          .join('\n'),
        buttons: [copy.forceCloseAction, copy.keepOpenAction],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      return failure.response === 0
    } finally {
      restoreWindow()
    }
  }

  function terminateNativeRuntimeProcesses(): void {
    for (const state of deps.nativeServiceProcesses.values()) {
      if (state.closed) continue
      state.stopRequested = true
      const pid = state.child.pid ?? null
      try {
        state.child.kill('SIGTERM')
      } catch {
        // ignore shutdown errors
      }
      // On Windows, SIGTERM may not kill child processes. Use taskkill /T for tree kill.
      if (process.platform === 'win32' && pid) {
        try {
          require('node:child_process').execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' })
        } catch {
          // ignore - process may already be dead
        }
      }
    }
  }

  function cleanupAppRuntimeResources(): void {
    for (const streamId of deps.getLogsFollowStreamIds()) {
      deps.stopLogsFollowStream(streamId)
    }
    terminateNativeRuntimeProcesses()
  }

  async function requestOrderedAppShutdown(win: BrowserWindow | null): Promise<void> {
    if (deps.getAppShutdownApproved() || deps.getAppShutdownInProgress()) return
    deps.setAppShutdownInProgress(true)

    try {
      const shouldQuit = await confirmNodeShutdownBeforeQuit(win)
      if (!shouldQuit) return
      deps.setAppShutdownApproved(true)
      deps.quitApp()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not prepare the app shutdown.'
      void showMessageBoxForWindow(win, {
        type: 'error',
        title: 'Knodel',
        message,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true
      })
    } finally {
      if (!deps.getAppShutdownApproved()) deps.setAppShutdownInProgress(false)
    }
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      icon: path.join(__dirname, '../../assets/branding/icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: deps.preloadPath,
        sandbox: false
      }
    })
    deps.setMainWindow(win)

    if (deps.isDev && deps.viteDevServerUrl) {
      void win.loadURL(deps.viteDevServerUrl)
    } else {
      void win.loadFile(path.join(__dirname, '../../dist/index.html'))
    }

    win.on('close', (event) => {
      if (deps.getAppShutdownApproved()) return
      event.preventDefault()
      void requestOrderedAppShutdown(win)
    })

    win.on('closed', () => {
      if (deps.getMainWindow() === win) deps.setMainWindow(null)
    })

    return win
  }

  return {
    createWindow,
    cleanupAppRuntimeResources,
    requestOrderedAppShutdown
  }
}
