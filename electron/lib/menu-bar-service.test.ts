import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => {
  const trayInstances: any[] = []
  const buildFromTemplate = vi.fn((template) => template)
  const createFromPath = vi.fn(() => ({
    setTemplateImage: vi.fn()
  }))
  const Tray = vi.fn(function MockTray(this: any) {
    this.destroy = vi.fn()
    this.setContextMenu = vi.fn()
    this.setToolTip = vi.fn()
    this.on = vi.fn()
    trayInstances.push(this)
    return this
  })
  return {
    trayInstances,
    buildFromTemplate,
    createFromPath,
    Tray
  }
})

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate
  },
  Tray: electronMock.Tray,
  nativeImage: {
    createFromPath: electronMock.createFromPath
  }
}))

import { createMenuBarService, summarizeMenuBarStatus } from './menu-bar-service'
import type { TelenoNodeStatus } from './main-types'

function status(overrides: Partial<TelenoNodeStatus> = {}): TelenoNodeStatus {
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
    output: '',
    ...overrides
  }
}

describe('menu bar service', () => {
  beforeEach(() => {
    electronMock.trayInstances.length = 0
    electronMock.buildFromTemplate.mockClear()
    electronMock.createFromPath.mockClear()
    electronMock.Tray.mockClear()
  })

  it('summarizes stopped, running, and producer states without private details', () => {
    const stopped = summarizeMenuBarStatus(status())
    expect(stopped).toMatchObject({
      nodeRunning: false,
      producerRunning: false,
      nodeLabel: 'Node: stopped',
      producerLabel: null
    })

    const running = summarizeMenuBarStatus(status({
      runningServices: 1,
      services: [{
        id: 'teleno-node',
        name: 'Koinos One Node',
        service: 'teleno-node',
        runtimeName: 'teleno_node',
        version: null,
        state: 'running',
        status: 'Running (pid 1234)',
        ports: [],
        dependsOn: [],
        lastError: null,
        nativePid: 1234,
        conflictPids: [],
        managedByTeleno: true
      }]
    }))
    expect(running.nodeLabel).toBe('Node: running')
    expect(JSON.stringify(running)).not.toContain('/private/')

    const producer = summarizeMenuBarStatus(status({
      runningServices: 1,
      profiles: ['block_producer'],
      components: [{
        name: 'block_producer',
        enabled: true,
        healthy: true,
        state: 'running'
      }]
    }))
    expect(producer).toMatchObject({
      nodeRunning: true,
      producerRunning: true,
      producerLabel: 'Producer: running'
    })
  })

  it('localizes status labels in Spanish', () => {
    const summary = summarizeMenuBarStatus(status({ runningServices: 1 }), 'es')
    expect(summary.nodeLabel).toBe('Nodo: en ejecucion')
  })

  it('does not create a tray outside macOS', () => {
    const service = createMenuBarService({
      platform: 'linux',
      iconPath: '/tmp/trayTemplate.png',
      getPreferences: () => ({ keepRunningInMenuBar: true }),
      getLanguage: vi.fn(async () => 'en'),
      getNodeStatus: vi.fn(async () => status()),
      showMainWindow: vi.fn(),
      requestQuit: vi.fn(),
      stopNode: vi.fn(async () => ({ ok: true })),
      showError: vi.fn()
    })

    expect(service.ensure()).toBe(false)
    expect(electronMock.Tray).not.toHaveBeenCalled()
  })

  it('creates a sanitized tray menu and routes actions through safe callbacks', async () => {
    const showMainWindow = vi.fn()
    const requestQuit = vi.fn()
    const stopNode = vi.fn(async () => ({ ok: true }))
    const service = createMenuBarService({
      platform: 'darwin',
      iconPath: '/tmp/trayTemplate.png',
      getPreferences: () => ({ keepRunningInMenuBar: true }),
      getLanguage: vi.fn(async () => 'en'),
      getNodeStatus: vi.fn(async () => status({
        runningServices: 1,
        baseDir: '/private/basedir',
        services: [{
          id: 'teleno-node',
          name: 'Koinos One Node',
          service: 'teleno-node',
          runtimeName: 'teleno_node',
          version: null,
          state: 'running',
          status: 'Running on http://127.0.0.1:8080',
          ports: [],
          dependsOn: [],
          lastError: null,
          nativePid: 1234,
          conflictPids: [],
          managedByTeleno: true
        }]
      })),
      showMainWindow,
      requestQuit,
      stopNode,
      showError: vi.fn()
    })

    await service.refresh()

    const tray = electronMock.trayInstances[0]
    expect(tray.setToolTip).toHaveBeenCalledWith('Koinos One')
    const menu = tray.setContextMenu.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(menu)).toContain('Node: running')
    expect(JSON.stringify(menu)).not.toContain('/private/basedir')
    expect(JSON.stringify(menu)).not.toContain('127.0.0.1')

    menu.find((item: any) => item.label === 'Show Koinos One').click()
    menu.find((item: any) => item.label === 'Stop node').click()
    menu.find((item: any) => item.label === 'Quit Koinos One').click()

    await vi.waitFor(() => expect(stopNode).toHaveBeenCalledTimes(1))
    expect(showMainWindow).toHaveBeenCalledTimes(1)
    expect(requestQuit).toHaveBeenCalledTimes(1)
  })
})
