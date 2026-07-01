import path from 'node:path'

import { BrowserWindow, dialog, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'

import type {
  TelenoAppPreferences,
  TelenoNodeSettingsInput,
  TelenoNodeStatus,
  NativeServiceProcessState
} from './main-types'

type AppLifecycleServiceDeps = {
  isDev: boolean
  platform?: NodeJS.Platform
  viteDevServerUrl?: string
  preloadPath: string
  nodeSettingsStorageKey: string
  languageStorageKey: string
  getAppPreferences: () => TelenoAppPreferences
  parsePersistedNodeSettings: (input: unknown) => TelenoNodeSettingsInput | undefined
  telenoNodeStatus: (input?: TelenoNodeSettingsInput) => Promise<TelenoNodeStatus>
  isComposeServiceRunning: (service: TelenoNodeStatus['services'][number]) => boolean
  telenoNodeAction: (action: 'start' | 'stop', input?: TelenoNodeSettingsInput) => Promise<unknown>
  hasActiveBackupOperation: () => boolean
  cancelBackupOperation: () => Promise<{ ok: boolean; output: string }>
  isFirstRunSetupActive?: () => Promise<boolean>
  nativeServiceProcesses: Map<string, NativeServiceProcessState>
  getLogsFollowStreamIds: () => string[]
  stopLogsFollowStream: (streamId: string) => void
  getMainWindow: () => BrowserWindow | null
  setMainWindow: (win: BrowserWindow | null) => void
  getAppShutdownApproved: () => boolean
  setAppShutdownApproved: (value: boolean) => void
  getAppShutdownInProgress: () => boolean
  setAppShutdownInProgress: (value: boolean) => void
  setDockIconVisible?: (visible: boolean) => void
  onWindowHiddenToMenuBar?: () => void
  onWindowShown?: () => void
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
      confirmMessage: 'Koinos One debe detener los servicios activos del nodo antes de cerrar.',
      confirmDetailPrefix: 'Servicios activos',
      confirmAction: 'Detener y cerrar',
      cancelAction: 'Cancelar',
      stoppingWindowTitle: 'Koinos One - Deteniendo nodo...',
      stopFailedTitle: 'No se pudo detener el nodo',
      stopFailedMessage: 'Koinos One no pudo detener todos los servicios antes de cerrar.',
      stopFailedDetailPrefix: 'Salida del stop',
      keepOpenAction: 'Mantener abierta',
      forceCloseAction: 'Forzar cierre'
    }
  }

  return {
    confirmTitle: 'Stop node before closing',
    confirmMessage: 'Koinos One needs to stop running node services before it closes.',
    confirmDetailPrefix: 'Running services',
    confirmAction: 'Stop and close',
    cancelAction: 'Cancel',
    stoppingWindowTitle: 'Koinos One - Stopping node...',
    stopFailedTitle: 'Could not stop the node',
    stopFailedMessage: 'Koinos One could not stop all managed services before closing.',
    stopFailedDetailPrefix: 'Stop output',
    keepOpenAction: 'Keep open',
    forceCloseAction: 'Force close'
  }
}

function localizedBackgroundModeCopy(language: string | null | undefined): {
  closeTitle: string
  closeMessage: string
  keepRunningAction: string
  stopAndQuitAction: string
  cancelAction: string
  runningDetailPrefix: string
  producerRunningDetail: string
  backupActiveDetail: string
  hiddenTitle: string
  managedServicesFallback: string
  activeBackupQuitTitle: string
  activeBackupQuitMessage: string
  activeBackupQuitDetail: string
  stopOperationAndQuitAction: string
  keepOpenAction: string
  cancelOperationFailedTitle: string
} {
  const spanish = `${language || ''}`.toLowerCase().startsWith('es')
  if (spanish) {
    return {
      closeTitle: 'Mantener Koinos One en la barra de menus',
      closeMessage: 'Koinos One puede seguir ejecutando el nodo aunque la ventana este oculta.',
      keepRunningAction: 'Mantener en barra de menus',
      stopAndQuitAction: 'Detener y salir',
      cancelAction: 'Cancelar',
      runningDetailPrefix: 'Servicios activos',
      producerRunningDetail: 'Producer activo: la produccion de bloques puede continuar mientras la ventana esta oculta.',
      backupActiveDetail: 'Hay un backup o restore activo. Puede seguir en segundo plano, pero salir debe detenerlo explicitamente.',
      hiddenTitle: 'Koinos One seguira en la barra de menus.',
      managedServicesFallback: 'servicios gestionados del nodo',
      activeBackupQuitTitle: 'Backup o restore en curso',
      activeBackupQuitMessage: 'Hay una operacion de backup o restore activa.',
      activeBackupQuitDetail: 'Detenla antes de salir para evitar datos parciales o staging incompleto.',
      stopOperationAndQuitAction: 'Detener operacion y salir',
      keepOpenAction: 'Mantener abierta',
      cancelOperationFailedTitle: 'No se pudo detener la operacion'
    }
  }

  return {
    closeTitle: 'Keep Koinos One in the menu bar',
    closeMessage: 'Koinos One can keep the node running while the window is hidden.',
    keepRunningAction: 'Keep running in menu bar',
    stopAndQuitAction: 'Stop and quit',
    cancelAction: 'Cancel',
    runningDetailPrefix: 'Running services',
    producerRunningDetail: 'Producer active: block production can continue while the window is hidden.',
    backupActiveDetail: 'A backup or restore is active. It can continue in the background, but quitting must stop it explicitly.',
    hiddenTitle: 'Koinos One will stay available from the menu bar.',
    managedServicesFallback: 'managed node services',
    activeBackupQuitTitle: 'Backup or restore in progress',
    activeBackupQuitMessage: 'A backup or restore operation is active.',
    activeBackupQuitDetail: 'Stop it before quitting to avoid partial data or incomplete staging.',
    stopOperationAndQuitAction: 'Stop operation and quit',
    keepOpenAction: 'Keep open',
    cancelOperationFailedTitle: 'Could not stop the operation'
  }
}

function serviceLooksRunning(service: TelenoNodeStatus['services'][number]): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

function producerLooksRunning(status: TelenoNodeStatus): boolean {
  const producerService = status.services.find((service) => service.id === 'block_producer' || service.name === 'block_producer')
  const producerComponent = status.components.find((component) => component.name === 'block_producer')
  const nodeRunning = status.runningServices > 0 || status.services.some((service) => service.managedByTeleno && serviceLooksRunning(service))
  return Boolean(
    (producerService && serviceLooksRunning(producerService)) ||
    (nodeRunning && producerComponent?.enabled && producerComponent.healthy && producerComponent.state !== 'disabled')
  )
}

export function createAppLifecycleService(deps: AppLifecycleServiceDeps) {
  const platform = deps.platform ?? process.platform

  async function loadRendererShutdownContext(
    win: BrowserWindow | null
  ): Promise<{ nodeSettings?: TelenoNodeSettingsInput; language: string | null }> {
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

  function listRunningManagedServiceNames(status: TelenoNodeStatus): string[] {
    return status.services.filter(deps.isComposeServiceRunning).map((service) => service.name)
  }

  function menuBarBackgroundModeEnabled(): boolean {
    return platform === 'darwin' && deps.getAppPreferences().keepRunningInMenuBar === true
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
    const backgroundCopy = localizedBackgroundModeCopy(language)

    if (deps.hasActiveBackupOperation()) {
      const backupConfirmation = await showMessageBoxForWindow(win, {
        type: 'warning',
        title: backgroundCopy.activeBackupQuitTitle,
        message: backgroundCopy.activeBackupQuitMessage,
        detail: backgroundCopy.activeBackupQuitDetail,
        buttons: [backgroundCopy.stopOperationAndQuitAction, backgroundCopy.keepOpenAction],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      if (backupConfirmation.response !== 0) return false

      const cancelResult = await deps.cancelBackupOperation()
      if (!cancelResult.ok) {
        await showMessageBoxForWindow(win, {
          type: 'error',
          title: backgroundCopy.cancelOperationFailedTitle,
          message: cancelResult.output || backgroundCopy.cancelOperationFailedTitle,
          buttons: ['OK'],
          defaultId: 0,
          noLink: true
        })
        return false
      }
    }

    const status = await deps.telenoNodeStatus(nodeSettings)
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
      const stopResult = (await deps.telenoNodeAction('stop', nodeSettings)) as { ok?: boolean; output?: string }
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
        title: 'Koinos One',
        message,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true
      })
    } finally {
      if (!deps.getAppShutdownApproved()) deps.setAppShutdownInProgress(false)
    }
  }

  function hideWindowToMenuBar(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    try {
      win.hide()
      deps.setDockIconVisible?.(false)
      deps.onWindowHiddenToMenuBar?.()
    } catch {
      // ignore hide errors during shutdown
    }
  }

  async function requestCloseToMenuBar(win: BrowserWindow): Promise<void> {
    if (deps.getAppShutdownApproved() || deps.getAppShutdownInProgress()) return

    if (await deps.isFirstRunSetupActive?.()) {
      void requestOrderedAppShutdown(win)
      return
    }

    const { nodeSettings, language } = await loadRendererShutdownContext(win)
    const copy = localizedBackgroundModeCopy(language)
    const status = await deps.telenoNodeStatus(nodeSettings).catch(() => null)
    const runningServiceNames = status ? listRunningManagedServiceNames(status) : []
    const runningServices = Math.max(status?.runningServices ?? 0, runningServiceNames.length, deps.nativeServiceProcesses.size)
    const producerRunning = status ? producerLooksRunning(status) : false
    const activeBackup = deps.hasActiveBackupOperation()

    if (runningServices > 0 || activeBackup) {
      const detailLines = [
        runningServices > 0
          ? `${copy.runningDetailPrefix} (${runningServices}): ${runningServiceNames.length ? runningServiceNames.join(', ') : copy.managedServicesFallback}`
          : '',
        producerRunning ? copy.producerRunningDetail : '',
        activeBackup ? copy.backupActiveDetail : ''
      ].filter(Boolean)
      const confirmation = await showMessageBoxForWindow(win, {
        type: producerRunning ? 'warning' : 'info',
        title: copy.closeTitle,
        message: copy.closeMessage,
        detail: detailLines.join('\n\n'),
        buttons: [copy.keepRunningAction, copy.stopAndQuitAction, copy.cancelAction],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })

      if (confirmation.response === 1) {
        void requestOrderedAppShutdown(win)
        return
      }
      if (confirmation.response !== 0) return
    }

    hideWindowToMenuBar(win)
  }

  function showMainWindow(): BrowserWindow {
    let win = deps.getMainWindow()
    if (!win || win.isDestroyed()) {
      win = createWindow()
    }
    deps.setDockIconVisible?.(true)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    deps.onWindowShown?.()
    return win
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      title: 'Koinos One',
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
      if (menuBarBackgroundModeEnabled() && !deps.getAppShutdownInProgress()) {
        void requestCloseToMenuBar(win)
        return
      }
      void requestOrderedAppShutdown(win)
    })

    ;(win as BrowserWindow & {
      on(event: 'minimize', listener: (event: { preventDefault: () => void }) => void): BrowserWindow
    }).on('minimize', (event: { preventDefault: () => void }) => {
      if (!menuBarBackgroundModeEnabled() || deps.getAppShutdownInProgress()) return
      event.preventDefault()
      hideWindowToMenuBar(win)
    })

    win.on('closed', () => {
      if (deps.getMainWindow() === win) deps.setMainWindow(null)
    })

    return win
  }

  return {
    createWindow,
    cleanupAppRuntimeResources,
    requestOrderedAppShutdown,
    showMainWindow,
    loadRendererAppContext: loadRendererShutdownContext
  }
}
