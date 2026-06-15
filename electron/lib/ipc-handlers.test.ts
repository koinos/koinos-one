import { describe, expect, it, vi } from 'vitest'

import { registerTelenoIpcHandlers } from './ipc-handlers'

type FakeHandler = (event: { sender: unknown }, input?: unknown) => Promise<unknown>

function createFakeIpcMain() {
  const handlers = new Map<string, FakeHandler>()
  const syncHandlers = new Map<string, unknown>()
  return {
    handlers,
    syncHandlers,
    removeHandler(channel: string) {
      handlers.delete(channel)
    },
    handle(channel: string, handler: FakeHandler) {
      handlers.set(channel, handler)
    },
    on(channel: string, handler: unknown) {
      syncHandlers.set(channel, handler)
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
    telenoNodeStatus: vi.fn(async () => ({ ok: true })),
    composePresets: vi.fn(async () => ({ ok: true })),
    nativeBuildStatus: vi.fn(async () => ({ ok: true })),
    nativeBuildAll: vi.fn(async () => ({ ok: true })),
    nativeBuildServiceAction: vi.fn(async () => ({ ok: true })),
    telenoNodeAction: vi.fn(async () => ({ ok: true })),
    telenoNodeRestoreBackup: vi.fn(async () => ({ ok: true })),
    telenoNodeRestoreBackupAndVerify: vi.fn(async () => ({ ok: true })),
    nativeBackupDryRun: vi.fn(async () => ({ ok: true })),
    nativeBackupList: vi.fn(async () => ({ ok: true, snapshots: [] })),
    restoreNativeBackup: vi.fn(async () => ({ ok: true })),
    restoreNativeBackupLatest: vi.fn(async () => ({ ok: true })),
    koinosJsonRpcProxy: vi.fn(async () => ({ ok: true })),
    telenoNodeDashboardProducers: vi.fn(async () => ({ ok: true })),
    telenoNodeDashboardPeers: vi.fn(async () => ({ ok: true })),
    telenoNodeDashboardPerformance: vi.fn(async () => ({ ok: true, rows: [] })),
    telenoNodeProducerOverview: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerRegisteredKey: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerLocalInfo: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerRegister: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerProfileGet: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerProfileClear: vi.fn(async () => ({ ok: true })),
    telenoNodeProducerDelete: vi.fn(async () => ({ ok: true })),
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
    telenoNodeServiceAction: vi.fn(async () => ({ ok: true })),
    telenoNodeComponentToggle: vi.fn(async () => ({ ok: true, component: '', enabled: true, output: '', status: {} })),
    telenoNodePresetReconcile: vi.fn(async () => ({ ok: true })),
    telenoNodeLogs: vi.fn(async () => ({ ok: true })),
    telenoNodeLogsFollowStart: vi.fn(async () => ({ ok: true })),
    stopLogsFollowStream: vi.fn(async () => ({ ok: true, streamId: 'stream-1' }))
  }
}

describe('ipc-handlers', () => {
  it('registers handlers and uses getNodeDefaults', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerTelenoIpcHandlers(ipcMain as any, deps as any)

    const defaults = await ipcMain.handlers.get('teleno:node:defaults')?.({ sender: {} })
    expect(defaults).toEqual({ ok: true, baseDir: '/tmp' })
    expect(deps.getNodeDefaults).toHaveBeenCalledTimes(1)
  })

  it('returns the invalid kind error without calling file-read deps', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerTelenoIpcHandlers(ipcMain as any, deps as any)

    const result = await ipcMain.handlers.get('teleno:node:file-read')?.({ sender: {} }, { kind: 'bogus' })
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

    registerTelenoIpcHandlers(ipcMain as any, deps as any)

    const payload = { repoPath: '/tmp/koinos' }
    const result = await ipcMain.handlers.get('teleno:node:dashboard-performance')?.({ sender: {} }, payload)

    expect(result).toEqual({ ok: true, rows: [] })
    expect(deps.telenoNodeDashboardPerformance).toHaveBeenCalledWith(payload)
  })

  it('registers native backup command handlers', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerTelenoIpcHandlers(ipcMain as any, deps as any)

    const payload = { baseDir: '/tmp/teleno-node' }
    const sender = { id: 1 }
    await ipcMain.handlers.get('teleno:node:native-backup-dry-run')?.({ sender }, payload)
    await ipcMain.handlers.get('teleno:node:native-backup-list')?.({ sender }, payload)
    await ipcMain.handlers.get('teleno:node:restore-native-backup')?.({ sender }, { ...payload, backupId: 'backup-1' })
    await ipcMain.handlers.get('teleno:node:restore-native-backup-latest')?.({ sender }, payload)

    expect(deps.nativeBackupDryRun).toHaveBeenCalledWith(payload)
    expect(deps.nativeBackupList).toHaveBeenCalledWith(payload)
    expect(deps.restoreNativeBackup).toHaveBeenCalledWith({ ...payload, backupId: 'backup-1' }, sender)
    expect(deps.restoreNativeBackupLatest).toHaveBeenCalledWith(payload, sender)
  })

  it('registers the wallet account handlers', async () => {
    const ipcMain = createFakeIpcMain()
    const deps = createDeps()

    registerTelenoIpcHandlers(ipcMain as any, deps as any)

    const setActivePayload = { accountId: 'acc_1' }
    await ipcMain.handlers.get('teleno:wallet:set-active-account')?.({ sender: {} }, setActivePayload)
    expect(deps.walletSetActiveAccount).toHaveBeenCalledWith(setActivePayload)

    const importWatchPayload = { address: '1WatchOnlyAddress', name: 'Observer' }
    await ipcMain.handlers.get('teleno:wallet:import-watch-account')?.({ sender: {} }, importWatchPayload)
    expect(deps.walletImportWatchAccount).toHaveBeenCalledWith(importWatchPayload)
  })
})
