import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
      mainFrame: { url: '', isDestroyed: vi.fn(() => false) },
      getURL: vi.fn(() => ''),
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
    isPackaged: false,
    platform: 'darwin' as NodeJS.Platform,
    bundledEntryPath: path.join(__dirname, '../../dist/index.html'),
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

  it('loads and trusts the Vite entry and permits same-origin manual links and search', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps({
      viteDevServerUrl: 'http://localhost:5173/'
    })
    const service = createAppLifecycleService(deps)
    service.createWindow()

    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173/')
    expect(win.loadFile).not.toHaveBeenCalled()
    const frame = win.webContents.mainFrame
    frame.url = 'http://localhost:5173/'
    win.webContents.getURL.mockReturnValue(frame.url)
    expect(service.isTrustedIpcSender(win.webContents as any, frame as any)).toBe(true)

    const guide = 'http://localhost:5173/manual-site/developers/gui/i18n-and-gui-copy.html'
    const navigate = (url: string) => {
      const event = { url, frame: {}, preventDefault: vi.fn() }
      win.webContentsHandlers.get('will-frame-navigate')?.(event)
      return event.preventDefault
    }

    expect(navigate(guide + '#examples')).not.toHaveBeenCalled()
    expect(navigate('http://localhost:5173/manual-site/search.html?q=GUI+copy')).not.toHaveBeenCalled()
    expect(navigate(guide + '?q=GUI+copy')).toHaveBeenCalledOnce()
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

  it('denies non-HTTP navigation and child windows without opening them externally', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps()
    const service = createAppLifecycleService(deps)
    service.createWindow()

    const event = { url: 'data:text/html,inert', frame: {}, preventDefault: vi.fn() }
    win.webContentsHandlers.get('will-frame-navigate')?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    win.webContentsHandlers.get('will-redirect')?.(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(win.getWindowOpenHandler()?.({ url: 'file:///tmp/inert.html' })).toEqual({ action: 'deny' })
    expect(deps.openExternalUrl).not.toHaveBeenCalled()
  })

  it('selects and trusts the exact bundled entry in a packaged app even with a Vite URL configured', () => {
    const win = createFakeWindow()
    electronMock.nextWindow = win
    const deps = createDeps({ isPackaged: true, viteDevServerUrl: 'http://localhost:5173/' })
    const service = createAppLifecycleService(deps)
    service.createWindow()
    expect(win.loadURL).not.toHaveBeenCalled()
    expect(win.loadFile).toHaveBeenCalledWith(deps.bundledEntryPath)
    const entry = pathToFileURL(deps.bundledEntryPath).href
    const frame = win.webContents.mainFrame
    frame.url = entry
    win.webContents.getURL.mockReturnValue(entry)

    expect(service.isTrustedIpcSender(win.webContents as any, frame as any)).toBe(true)
    expect(service.isTrustedIpcSender(win.webContents as any, { url: entry } as any)).toBe(false)
    frame.url = 'http://localhost:5173/'
    win.webContents.getURL.mockReturnValue(frame.url)
    expect(service.isTrustedIpcSender(win.webContents as any, frame as any)).toBe(false)
  })

  it('permits local bundled HTML only in a child frame and checks its canonical location', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'koinos-one-manual-'))
    try {
      const renderer = path.join(directory, 'dist')
      const manual = path.join(renderer, 'manual-site')
      const other = path.join(directory, 'other')
      mkdirSync(manual, { recursive: true })
      mkdirSync(other)
      const entry = path.join(renderer, 'index.html')
      const guide = path.join(manual, 'guide.html')
      const search = path.join(manual, 'search.html')
      writeFileSync(entry, 'Test entry')
      writeFileSync(guide, 'Test guide')
      writeFileSync(search, 'Test search page')
      writeFileSync(path.join(other, 'guide.html'), 'Separate test guide')
      symlinkSync(other, path.join(manual, 'linked'), 'junction')

      const win = createFakeWindow()
      electronMock.nextWindow = win
      const deps = createDeps({ isPackaged: true, bundledEntryPath: entry })
      createAppLifecycleService(deps).createWindow()
      const localGuide = pathToFileURL(guide)
      localGuide.hash = 'section'
      const searchResult = pathToFileURL(search)
      searchResult.searchParams.set('q', 'Build information')
      const otherAuthority = new URL(localGuide)
      otherAuthority.host = 'manual.example.invalid'
      const frame = {}
      const navigate = (url: URL, sender = frame) => {
        const event = { url: url.href, frame: sender, preventDefault: vi.fn() }
        win.webContentsHandlers.get('will-frame-navigate')?.(event)
        return event.preventDefault
      }

      expect(navigate(localGuide)).not.toHaveBeenCalled()
      expect(navigate(localGuide, win.webContents.mainFrame)).toHaveBeenCalledOnce()
      expect(navigate(searchResult)).not.toHaveBeenCalled()
      expect(navigate(searchResult, win.webContents.mainFrame)).toHaveBeenCalledOnce()
      const multipleFields = new URL(searchResult)
      multipleFields.searchParams.set('page', '2')
      expect(navigate(multipleFields)).toHaveBeenCalledOnce()
      expect(navigate(otherAuthority)).toHaveBeenCalledOnce()
      expect(navigate(pathToFileURL(path.join(manual, 'linked', 'guide.html')))).toHaveBeenCalledOnce()
      expect(deps.openExternalUrl).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
