import { describe, expect, it, vi } from 'vitest'

import { registerKnodelIpcHandlers } from './ipc-handlers'

type FakeHandler = (event: { sender: unknown }, input?: unknown) => Promise<unknown>

function createFakeIpcMain() {
  const handlers = new Map<string, FakeHandler>()
  return {
    handlers,
    removeHandler(channel: string) {
      handlers.delete(channel)
    },
    handle(channel: string, handler: FakeHandler) {
      handlers.set(channel, handler)
    }
  }
}

function createDeps() {
  return {
    loadPublicRpcConfig: vi.fn(async () => ({ ok: true })),
    savePublicRpcConfig: vi.fn(async () => ({ ok: true })),
    getNodeDefaults: vi.fn(async () => ({ ok: true, baseDir: '/tmp' })),
    cloneKoinosRepo: vi.fn(async () => ({ ok: true })),
    readKoinosManagedFile: vi.fn(async () => ({ ok: true })),
    writeKoinosManagedFile: vi.fn(async () => ({ ok: true })),
    selectNodeBaseDir: vi.fn(async () => ({ ok: true })),
    validateNodeBaseDirAccess: vi.fn(async () => ({ ok: true })),
    copyNodeBaseDirData: vi.fn(async () => ({ ok: true })),
    koinosNodeStatus: vi.fn(async () => ({ ok: true })),
    composePresets: vi.fn(async () => ({ ok: true })),
    nativeBuildStatus: vi.fn(async () => ({ ok: true })),
    nativeBuildAll: vi.fn(async () => ({ ok: true })),
    nativeBuildServiceAction: vi.fn(async () => ({ ok: true })),
    koinosNodeAction: vi.fn(async () => ({ ok: true })),
    koinosNodeRestoreBackup: vi.fn(async () => ({ ok: true })),
    koinosNodeRestoreBackupAndVerify: vi.fn(async () => ({ ok: true })),
    koinosJsonRpcProxy: vi.fn(async () => ({ ok: true })),
    koinosNodeDashboardProducers: vi.fn(async () => ({ ok: true })),
    koinosNodeDashboardPeers: vi.fn(async () => ({ ok: true })),
    koinosNodeDashboardPerformance: vi.fn(async () => ({ ok: true, rows: [] })),
    koinosNodeProducerOverview: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerRegisteredKey: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerLocalInfo: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerRegister: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerProfileGet: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerProfileClear: vi.fn(async () => ({ ok: true })),
    koinosNodeProducerDelete: vi.fn(async () => ({ ok: true })),
    walletOverview: vi.fn(async () => ({ ok: true })),
    walletGenerate: vi.fn(async () => ({ ok: true })),
    walletImport: vi.fn(async () => ({ ok: true })),
    walletListAccounts: vi.fn(async () => ({ ok: true, accounts: [] })),
    walletSetActiveAccount: vi.fn(async () => ({ ok: true })),
    walletCreateDerivedAccount: vi.fn(async () => ({ ok: true })),
    walletImportAccount: vi.fn(async () => ({ ok: true })),
    walletImportWatchAccount: vi.fn(async () => ({ ok: true })),
    walletRenameAccount: vi.fn(async () => ({ ok: true })),
    walletRemoveAccount: vi.fn(async () => ({ ok: true })),
    walletUnlock: vi.fn(async () => ({ ok: true })),
    walletClose: vi.fn(async () => ({ ok: true })),
    walletDelete: vi.fn(async () => ({ ok: true })),
    walletAddressFromWif: vi.fn(async () => ({ ok: true })),
    walletDeriveFromSeed: vi.fn(async () => ({ ok: true })),
    walletShowSeed: vi.fn(async () => ({ ok: true })),
    walletChainInfo: vi.fn(async () => ({ ok: true })),
    walletBlock: vi.fn(async () => ({ ok: true })),
    walletBalance: vi.fn(async () => ({ ok: true })),
    walletVhp: vi.fn(async () => ({ ok: true })),
    walletNonce: vi.fn(async () => ({ ok: true })),
    walletRc: vi.fn(async () => ({ ok: true })),
    walletTokenBalance: vi.fn(async () => ({ ok: true })),
    walletReadContract: vi.fn(async () => ({ ok: true })),
    walletBurn: vi.fn(async () => ({ ok: true })),
    walletTransferVhp: vi.fn(async () => ({ ok: true })),
    walletTransferKoin: vi.fn(async () => ({ ok: true })),
    koinosNodeServiceAction: vi.fn(async () => ({ ok: true })),
    koinosNodeComponentToggle: vi.fn(async () => ({ ok: true, component: '', enabled: true, output: '', status: {} })),
    koinosNodePresetReconcile: vi.fn(async () => ({ ok: true })),
    koinosNodeLogs: vi.fn(async () => ({ ok: true })),
    koinosNodeLogsFollowStart: vi.fn(async () => ({ ok: true })),
    stopLogsFollowStream: vi.fn(async () => ({ ok: true, streamId: 'stream-1' }))
  }
}

describe('ipc-handlers', () => {
  it('registers handlers and uses getNodeDefaults', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerKnodelIpcHandlers(ipcMain as any, deps as any)

    const defaults = await ipcMain.handlers.get('knodel:koinos-node:defaults')?.({ sender: {} })
    expect(defaults).toEqual({ ok: true, baseDir: '/tmp' })
    expect(deps.getNodeDefaults).toHaveBeenCalledTimes(1)
  })

  it('returns the invalid kind error without calling file-read deps', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerKnodelIpcHandlers(ipcMain as any, deps as any)

    const result = await ipcMain.handlers.get('knodel:koinos-node:file-read')?.({ sender: {} }, { kind: 'bogus' })
    expect(result).toEqual({
      ok: false,
      kind: 'config',
      filePath: '',
      content: '',
      output: 'Parametro kind invalido'
    })
    expect(deps.readKoinosManagedFile).not.toHaveBeenCalled()
  })

  it('registers the dashboard performance handler', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerKnodelIpcHandlers(ipcMain as any, deps as any)

    const payload = { repoPath: '/tmp/koinos' }
    const result = await ipcMain.handlers.get('knodel:koinos-node:dashboard-performance')?.({ sender: {} }, payload)

    expect(result).toEqual({ ok: true, rows: [] })
    expect(deps.koinosNodeDashboardPerformance).toHaveBeenCalledWith(payload)
  })

  it('registers the wallet account handlers', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerKnodelIpcHandlers(ipcMain as any, deps as any)

    const setActivePayload = { accountId: 'acc_1' }
    await ipcMain.handlers.get('knodel:wallet:set-active-account')?.({ sender: {} }, setActivePayload)
    expect(deps.walletSetActiveAccount).toHaveBeenCalledWith(setActivePayload)

    const importWatchPayload = { address: '1WatchOnlyAddress', name: 'Observer' }
    await ipcMain.handlers.get('knodel:wallet:import-watch-account')?.({ sender: {} }, importWatchPayload)
    expect(deps.walletImportWatchAccount).toHaveBeenCalledWith(importWatchPayload)
  })
})
