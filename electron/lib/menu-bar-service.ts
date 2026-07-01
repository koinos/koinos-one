import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'

import type { TelenoAppPreferences, TelenoNodeStatus } from './main-types'

type MenuBarLanguage = 'en' | 'es'

export type MenuBarStatusSummary = {
  nodeRunning: boolean
  producerRunning: boolean
  nodeLabel: string
  producerLabel: string | null
}

type MenuBarServiceDeps = {
  platform?: NodeJS.Platform
  iconPath: string
  getPreferences: () => TelenoAppPreferences
  getLanguage: () => Promise<string | null>
  getNodeStatus: () => Promise<TelenoNodeStatus | null>
  showMainWindow: () => void
  requestQuit: () => void
  stopNode: () => Promise<{ ok?: boolean; output?: string }>
  showError: (title: string, message: string) => void
}

function menuLanguage(language: string | null | undefined): MenuBarLanguage {
  return `${language || ''}`.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function menuCopy(language: string | null | undefined) {
  const spanish = menuLanguage(language) === 'es'
  if (spanish) {
    return {
      tooltip: 'Koinos One',
      show: 'Mostrar Koinos One',
      quit: 'Salir de Koinos One',
      stop: 'Detener nodo',
      stopping: 'Deteniendo nodo...',
      stopFailedTitle: 'No se pudo detener el nodo',
      nodeUnknown: 'Nodo: desconocido',
      nodeStopped: 'Nodo: detenido',
      nodeRunning: 'Nodo: en ejecucion',
      nodeUnsafe: 'Nodo: inseguro',
      producerRunning: 'Producer: en ejecucion',
      producerStopped: 'Producer: detenido'
    }
  }

  return {
    tooltip: 'Koinos One',
    show: 'Show Koinos One',
    quit: 'Quit Koinos One',
    stop: 'Stop node',
    stopping: 'Stopping node...',
    stopFailedTitle: 'Could not stop the node',
    nodeUnknown: 'Node: unknown',
    nodeStopped: 'Node: stopped',
    nodeRunning: 'Node: running',
    nodeUnsafe: 'Node: unsafe',
    producerRunning: 'Producer: running',
    producerStopped: 'Producer: stopped'
  }
}

function serviceLooksRunning(service: TelenoNodeStatus['services'][number]): boolean {
  return /running|up/i.test(`${service.state} ${service.status}`) && !service.lastError
}

export function summarizeMenuBarStatus(
  status: TelenoNodeStatus | null | undefined,
  language?: string | null
): MenuBarStatusSummary {
  const copy = menuCopy(language)
  if (!status) {
    return {
      nodeRunning: false,
      producerRunning: false,
      nodeLabel: copy.nodeUnknown,
      producerLabel: null
    }
  }

  const nodeRunning =
    status.runningServices > 0 ||
    status.services.some((service) => service.managedByTeleno && serviceLooksRunning(service))
  const producerService = status.services.find((service) => service.id === 'block_producer' || service.name === 'block_producer')
  const producerComponent = status.components.find((component) => component.name === 'block_producer')
  const producerRunning = Boolean(
    (producerService && serviceLooksRunning(producerService)) ||
    (nodeRunning && producerComponent?.enabled && producerComponent.healthy && producerComponent.state !== 'disabled')
  )
  const producerConfigured = Boolean(
    producerRunning ||
    producerService ||
    producerComponent?.enabled ||
    status.profiles.some((profile) => /producer/i.test(profile))
  )
  const unsafe = !status.ok && !nodeRunning

  return {
    nodeRunning,
    producerRunning,
    nodeLabel: unsafe ? copy.nodeUnsafe : nodeRunning ? copy.nodeRunning : copy.nodeStopped,
    producerLabel: producerConfigured ? (producerRunning ? copy.producerRunning : copy.producerStopped) : null
  }
}

export function createMenuBarService(deps: MenuBarServiceDeps) {
  const platform = deps.platform ?? process.platform
  let tray: Tray | null = null
  let lastStatus: TelenoNodeStatus | null = null
  let lastLanguage: string | null = null

  function shouldUseMenuBar(): boolean {
    return platform === 'darwin' && deps.getPreferences().keepRunningInMenuBar === true
  }

  function destroy(): void {
    if (!tray) return
    tray.destroy()
    tray = null
  }

  function buildMenu(status: TelenoNodeStatus | null = lastStatus): void {
    if (!tray) return

    const copy = menuCopy(lastLanguage)
    const summary = summarizeMenuBarStatus(status, lastLanguage)
    const template: MenuItemConstructorOptions[] = [
      { label: summary.nodeLabel, enabled: false },
      ...(summary.producerLabel ? [{ label: summary.producerLabel, enabled: false } satisfies MenuItemConstructorOptions] : []),
      { type: 'separator' },
      {
        label: copy.show,
        click: () => deps.showMainWindow()
      },
      {
        label: copy.stop,
        enabled: summary.nodeRunning,
        click: () => {
          void deps.stopNode()
            .then((result) => {
              if (!result.ok) {
                deps.showError(copy.stopFailedTitle, result.output || copy.stopFailedTitle)
              }
            })
            .finally(() => {
              void refresh()
            })
        }
      },
      { type: 'separator' },
      {
        label: copy.quit,
        click: () => deps.requestQuit()
      }
    ]
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  function ensure(): boolean {
    if (!shouldUseMenuBar()) {
      destroy()
      return false
    }
    if (tray) return true

    const image = nativeImage.createFromPath(deps.iconPath)
    image.setTemplateImage(true)
    tray = new Tray(image)
    tray.setToolTip(menuCopy(lastLanguage).tooltip)
    tray.on('click', () => deps.showMainWindow())
    buildMenu()
    return true
  }

  async function refresh(): Promise<void> {
    if (!ensure()) return
    try {
      const [language, status] = await Promise.all([
        deps.getLanguage(),
        deps.getNodeStatus()
      ])
      lastLanguage = language
      lastStatus = status
    } catch {
      lastStatus = null
    }
    if (tray) {
      tray.setToolTip(menuCopy(lastLanguage).tooltip)
      buildMenu(lastStatus)
    }
  }

  function syncFromPreferences(): void {
    if (!ensure()) return
    void refresh()
  }

  return {
    ensure,
    refresh,
    syncFromPreferences,
    destroy
  }
}
