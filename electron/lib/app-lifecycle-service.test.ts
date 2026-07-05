import { describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  nextWindow: null as any,
  showMessageBox: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function MockBrowserWindow() {
    return electronMock.nextWindow
  }),
  dialog: {
    showMessageBox: electronMock.showMessageBox
  }
}))

import { createAppLifecycleService } from './app-lifecycle-service'
import type { NativeServiceProcessState, TelenoNodeStatus } from './main-types'

function createFakeWindow() {
  const handlers = new Map<string, (...args: any[]) => void>()
  const webContentsHandlers = new Map<string, (...args: any[]) => void>()
  let windowOpenHandler: ((details: { url: string }) => unknown) | null = null
  return {
    handlers,
    webContentsHandlers,
    getWindowOpenHandler: () => windowOpenHandler,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler)
      return undefined
    }),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    getTitle: vi.fn(() => 'Koinos One'),
    setTitle: vi.fn(),
    setProgressBar: vi.fn(),
    webContents: {
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        webContentsHandlers.set(event, handler)
        return undefined
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => unknown) => {
        windowOpenHandler = handler
      }),
      executeJavaScript: vi.fn(async () => ({
        nodeSettings: { network: 'mainnet', baseDir: '/private/basedir' },
        language: 'en'
      }))
    }
  }
}

function stoppedStatus(): TelenoNodeStatus {
  return {
    ok: true,
    network: 'mainnet',
    repoPath: '/private/repo',
    baseDir: '/private/basedir',
    profiles: [],
    configReady: true,
    configDir: '/private/basedir/config',
    services: [],
    components: [],
    runningServices: 0,
    output: ''
  }
}

function producerRunningStatus(): TelenoNodeStatus {
  return {
    ...stoppedStatus(),
    profiles: ['block_producer'],
    runningServices: 1,
    services: [{
      id: 'teleno-node',
      name: 'Koinos One Node',
      service: 'teleno-node',
      runtimeName: 'teleno_node',
      version: null,
      state: 'running',
      status: 'Running',
      ports: [],
      dependsOn: [],
      lastError: null,
      nativePid: 1234,
      conflictPids: [],
      managedByTeleno: true
    }],
    components: [{
      name: 'block_producer',
      enabled: true,
      healthy: true,
      state: 'running'
    }]
  }
}

function createDeps(overrides: Partial<Parameters<typeof createAppLifecycleService>[0]> = {}) {
  let mainWindow: any = null
  let shutdownApproved = false
  let shutdownInProgress = false
  const nativeServiceProcesses = new Map<string, NativeServiceProcessState>()
  return {
    isDev: false,
    platform: 'darwin' as NodeJS.Platform,
    preloadPath: '/tmp/preload.js',
    nodeSettingsStorageKey: 'node-settings',
    languageStorageKey: 'language',
    getAppPreferences: vi.fn(() => ({ keepRunningInMenuBar: true })),
    parsePersistedNodeSettings: vi.fn((input: unknown) => input as any),
    telenoNodeStatus: vi.fn(async () => stoppedStatus()),
    isComposeServiceRunning: vi.fn((service: TelenoNodeStatus['services'][number]) => /running|up/i.test(`${service.state} ${service.status}`)),
    telenoNodeAction: vi.fn(async () => ({ ok: true, output: '' })),
    hasActiveBackupOperation: vi.fn(() => false),
    cancelBackupOperation: vi.fn(async () => ({ ok: true, output: '' })),
    isFirstRunSetupActive: vi.fn(async () => false),
    nativeServiceProcesses,
    getLogsFollowStreamIds: vi.fn(() => []),
    stopLogsFollowStream: vi.fn(),
    getMainWindow: vi.fn(() => mainWindow),
    setMainWindow: vi.fn((win: any) => {
      mainWindow = win
    }),
    getAppShutdownApproved: vi.fn(() => shutdownApproved),
    setAppShutdownApproved: vi.fn((value: boolean) => {
      shutdownApproved = value
    }),
    getAppShutdownInProgress: vi.fn(() => shutdownInProgress),
    setAppShutdownInProgress: vi.fn((value: boolean) => {
      shutdownInProgress = value
    }),
    setDockIconVisible: vi.fn(),
    onWindowHiddenToMenuBar: vi.fn(),
    onWindowShown: vi.fn(),
    openExternalUrl: vi.fn(),
    quitApp: vi.fn(),
    ...overrides
  }
}

describe('app lifecycle service menu bar behavior', () => {
  it('hides the window on minimize when menu bar mode is enabled', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps()
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = { preventDefault: vi.fn() }
    win.handlers.get('minimize')?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(deps.setDockIconVisible).toHaveBeenCalledWith(false)
    expect(deps.onWindowHiddenToMenuBar).toHaveBeenCalledTimes(1)
  })

  it('keeps a running producer in the menu bar only after explicit close confirmation', async () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const deps = createDeps({
      telenoNodeStatus: vi.fn(async () => producerRunningStatus())
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = { preventDefault: vi.fn() }
    win.handlers.get('close')?.(event)

    await vi.waitFor(() => expect(win.hide).toHaveBeenCalledTimes(1))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(deps.telenoNodeAction).not.toHaveBeenCalled()
    expect(deps.quitApp).not.toHaveBeenCalled()
    expect(electronMock.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
      buttons: ['Keep running in menu bar', 'Stop and quit', 'Cancel']
    }))
  })

  it('does not hide the first-run setup window to the menu bar', async () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps({
      isFirstRunSetupActive: vi.fn(async () => true)
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = { preventDefault: vi.fn() }
    win.handlers.get('close')?.(event)

    await vi.waitFor(() => expect(deps.quitApp).toHaveBeenCalledTimes(1))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(win.hide).not.toHaveBeenCalled()
    expect(deps.setDockIconVisible).not.toHaveBeenCalled()
  })

  it('requires explicit backup cancellation before ordered quit', async () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const deps = createDeps({
      hasActiveBackupOperation: vi.fn(() => true)
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    await service.requestOrderedAppShutdown(win as any)

    expect(deps.cancelBackupOperation).toHaveBeenCalledTimes(1)
    expect(deps.quitApp).toHaveBeenCalledTimes(1)
  })

  it('restores and focuses the main window from showMainWindow', () => {
    const win = createFakeWindow()
    win.isMinimized.mockReturnValueOnce(true)
    electronMock.nextWindow = win
    const deps = createDeps()
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const shown = service.showMainWindow()

    expect(shown).toBe(win)
    expect(deps.setDockIconVisible).toHaveBeenCalledWith(true)
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(deps.onWindowShown).toHaveBeenCalledTimes(1)
  })

  it('runs managed stop before explicit ordered quit when services are active', async () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const deps = createDeps({
      telenoNodeStatus: vi.fn(async () => producerRunningStatus())
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    await service.requestOrderedAppShutdown(win as any)

    expect(deps.telenoNodeAction).toHaveBeenCalledWith('stop', { network: 'mainnet', baseDir: '/private/basedir' })
    expect(deps.quitApp).toHaveBeenCalledTimes(1)
  })

  it('opens external documentation frame links outside the app', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps({
      isDev: true,
      viteDevServerUrl: 'http://localhost:5173/'
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = {
      url: 'https://github.com/koinos/koinos-one/blob/main/src/i18n.ts',
      preventDefault: vi.fn()
    }
    win.webContentsHandlers.get('will-frame-navigate')?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(deps.openExternalUrl).toHaveBeenCalledWith('https://github.com/koinos/koinos-one/blob/main/src/i18n.ts')
  })

  it('keeps documentation iframe navigation inside the app for local manual pages', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps({
      isDev: true,
      viteDevServerUrl: 'http://localhost:5173/'
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = {
      url: 'http://localhost:5173/manual-site/developers/gui/i18n-and-gui-copy.html',
      preventDefault: vi.fn()
    }
    win.webContentsHandlers.get('will-frame-navigate')?.(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(deps.openExternalUrl).not.toHaveBeenCalled()
  })

  it('denies new in-app windows for external URLs after opening them externally', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps()
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const response = win.getWindowOpenHandler()?.({
      url: 'https://github.com/koinos/koinos-one'
    })

    expect(response).toEqual({ action: 'deny' })
    expect(deps.openExternalUrl).toHaveBeenCalledWith('https://github.com/koinos/koinos-one')
  })
})
