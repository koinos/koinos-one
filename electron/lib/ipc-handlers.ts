import type { IpcMain, WebContents } from 'electron'

import type {
  KoinosJsonRpcProxyInput,
  KoinosNodeBaseDirCopyInput,
  KoinosNodeDashboardPerformanceInput,
  KoinosNodeFileReadInput,
  KoinosNodeFileReadResult,
  KoinosNodeFileWriteInput,
  KoinosNodeFileWriteResult,
  KoinosNodeLogsFollowStartInput,
  KoinosNodeLogsFollowStartResult,
  KoinosNodeLogsFollowStopInput,
  KoinosNodeLogsFollowStopResult,
  KoinosNodeLogsInput,
  KoinosNodeManagedFileKind,
  KoinosNodeNativeBuildCommandInput,
  KoinosNodePresetCommandInput,
  KoinosNodeProducerOverviewInput,
  KoinosNodeProducerRegisterInput,
  KoinosNodeProducerRegisteredKeyInput,
  KoinosNodeServiceCommandInput,
  KoinosNodeSettingsInput,
  PublicRpcConfigInput,
  WalletAddressInput,
  WalletAddressQueryInput,
  WalletCreateDerivedAccountInput,
  WalletBlockInput,
  WalletBurnInput,
  WalletDeriveFromSeedInput,
  WalletImportAccountInput,
  WalletImportInput,
  WalletImportWatchAccountInput,
  WalletRemoveAccountInput,
  WalletRenameAccountInput,
  WalletReadContractInput,
  WalletRpcInput,
  WalletSetActiveAccountInput,
  WalletTokenBalanceInput,
  WalletTransferKoinInput,
  WalletTransferVhpInput,
  WalletUnlockInput
} from './main-types'

type Awaitable<T> = T | Promise<T>

type IpcHandlerDeps = {
  loadPublicRpcConfig: () => Awaitable<unknown>
  savePublicRpcConfig: (input?: PublicRpcConfigInput) => Awaitable<unknown>
  getNodeDefaults: () => Awaitable<unknown>
  cloneKoinosRepo: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  readKoinosManagedFile: (input: KoinosNodeFileReadInput) => Awaitable<KoinosNodeFileReadResult>
  writeKoinosManagedFile: (input: KoinosNodeFileWriteInput) => Awaitable<KoinosNodeFileWriteResult>
  selectNodeBaseDir: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  validateNodeBaseDirAccess: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  copyNodeBaseDirData: (input?: KoinosNodeBaseDirCopyInput) => Awaitable<unknown>
  koinosNodeStatus: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  composePresets: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  nativeBuildStatus: () => Awaitable<unknown>
  nativeBuildAll: () => Awaitable<unknown>
  nativeBuildServiceAction: (input?: KoinosNodeNativeBuildCommandInput) => Awaitable<unknown>
  koinosNodeAction: (action: 'start' | 'stop', input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  koinosNodeRestoreBackup: (input: KoinosNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  koinosNodeRestoreBackupAndVerify: (input: KoinosNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  koinosJsonRpcProxy: (input?: KoinosJsonRpcProxyInput) => Awaitable<unknown>
  koinosNodeDashboardProducers: (input?: KoinosNodeSettingsInput & { rpcUrl?: string; windowBlocks?: number }) => Awaitable<unknown>
  koinosNodeDashboardPeers: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  koinosNodeDashboardPerformance: (input?: KoinosNodeDashboardPerformanceInput) => Awaitable<unknown>
  koinosNodeProducerOverview: (input?: KoinosNodeProducerOverviewInput) => Awaitable<unknown>
  koinosNodeProducerRegisteredKey: (input?: KoinosNodeProducerRegisteredKeyInput) => Awaitable<unknown>
  koinosNodeProducerLocalInfo: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  koinosNodeProducerRegister: (input?: KoinosNodeProducerRegisterInput) => Awaitable<unknown>
  koinosNodeProducerProfileGet: () => Awaitable<unknown>
  koinosNodeProducerProfileClear: () => Awaitable<unknown>
  koinosNodeProducerDelete: (input?: KoinosNodeSettingsInput) => Awaitable<unknown>
  walletOverview: (input?: WalletRpcInput) => Awaitable<unknown>
  walletGenerate: () => Awaitable<unknown>
  walletImport: (input?: WalletImportInput) => Awaitable<unknown>
  walletListAccounts: () => Awaitable<unknown>
  walletSetActiveAccount: (input?: WalletSetActiveAccountInput) => Awaitable<unknown>
  walletCreateDerivedAccount: (input?: WalletCreateDerivedAccountInput) => Awaitable<unknown>
  walletImportAccount: (input?: WalletImportAccountInput) => Awaitable<unknown>
  walletImportWatchAccount: (input?: WalletImportWatchAccountInput) => Awaitable<unknown>
  walletRenameAccount: (input?: WalletRenameAccountInput) => Awaitable<unknown>
  walletRemoveAccount: (input?: WalletRemoveAccountInput) => Awaitable<unknown>
  walletUnlock: (input?: WalletUnlockInput) => Awaitable<unknown>
  walletClose: () => Awaitable<unknown>
  walletDelete: () => Awaitable<unknown>
  walletAddressFromWif: (input?: WalletAddressInput) => Awaitable<unknown>
  walletDeriveFromSeed: (input?: WalletDeriveFromSeedInput) => Awaitable<unknown>
  walletShowSeed: () => Awaitable<unknown>
  walletChainInfo: (input?: WalletRpcInput) => Awaitable<unknown>
  walletBlock: (input?: WalletBlockInput) => Awaitable<unknown>
  walletBalance: (input?: WalletAddressQueryInput) => Awaitable<unknown>
  walletVhp: (input?: WalletAddressQueryInput) => Awaitable<unknown>
  walletNonce: (input?: WalletAddressQueryInput) => Awaitable<unknown>
  walletRc: (input?: WalletAddressQueryInput) => Awaitable<unknown>
  walletTokenBalance: (input?: WalletTokenBalanceInput) => Awaitable<unknown>
  walletReadContract: (input?: WalletReadContractInput) => Awaitable<unknown>
  walletBurn: (input?: WalletBurnInput) => Awaitable<unknown>
  walletTransferVhp: (input?: WalletTransferVhpInput) => Awaitable<unknown>
  walletTransferKoin: (input?: WalletTransferKoinInput) => Awaitable<unknown>
  koinosNodeServiceAction: (action: 'start' | 'stop' | 'restart' | 'kill-conflict', input?: KoinosNodeServiceCommandInput) => Awaitable<unknown>
  koinosNodePresetReconcile: (input?: KoinosNodePresetCommandInput) => Awaitable<unknown>
  koinosNodeLogs: (input?: KoinosNodeLogsInput) => Awaitable<unknown>
  koinosNodeLogsFollowStart: (sender: WebContents, input?: KoinosNodeLogsFollowStartInput) => Awaitable<KoinosNodeLogsFollowStartResult>
  stopLogsFollowStream: (streamId: string) => Awaitable<KoinosNodeLogsFollowStopResult>
}

function isManagedFileKind(kind: unknown): kind is KoinosNodeManagedFileKind {
  return kind === 'compose' || kind === 'env' || kind === 'config'
}

export function registerKnodelIpcHandlers(ipcMain: IpcMain, deps: IpcHandlerDeps): void {
  const handlers = [
    'knodel:app-config:public-rpcs:load',
    'knodel:app-config:public-rpcs:save',
    'knodel:koinos-node:defaults',
    'knodel:koinos-node:clone-repo',
    'knodel:koinos-node:file-read',
    'knodel:koinos-node:file-write',
    'knodel:koinos-node:select-base-dir',
    'knodel:koinos-node:validate-base-dir',
    'knodel:koinos-node:copy-base-dir-data',
    'knodel:koinos-node:status',
    'knodel:koinos-node:presets',
    'knodel:koinos-node:native-builds',
    'knodel:koinos-node:native-build-all',
    'knodel:koinos-node:native-build-service',
    'knodel:koinos-node:start',
    'knodel:koinos-node:stop',
    'knodel:koinos-node:restore-backup',
    'knodel:koinos-node:restore-backup-verify',
    'knodel:koinos-node:rpc-call',
    'knodel:koinos-node:dashboard-producers',
    'knodel:koinos-node:dashboard-peers',
    'knodel:koinos-node:dashboard-performance',
    'knodel:koinos-node:producer-overview',
    'knodel:koinos-node:producer-registered-key',
    'knodel:koinos-node:producer-local-info',
    'knodel:koinos-node:producer-register',
    'knodel:koinos-node:producer-profile-get',
    'knodel:koinos-node:producer-profile-clear',
    'knodel:koinos-node:producer-delete',
    'knodel:koinos-node:service-start',
    'knodel:koinos-node:service-stop',
    'knodel:koinos-node:service-restart',
    'knodel:koinos-node:service-kill-conflict',
    'knodel:koinos-node:preset-reconcile',
    'knodel:koinos-node:logs',
    'knodel:koinos-node:logs-follow-start',
    'knodel:koinos-node:logs-follow-stop',
    'knodel:wallet:overview',
    'knodel:wallet:generate',
    'knodel:wallet:import',
    'knodel:wallet:list-accounts',
    'knodel:wallet:set-active-account',
    'knodel:wallet:create-derived-account',
    'knodel:wallet:import-account',
    'knodel:wallet:import-watch-account',
    'knodel:wallet:rename-account',
    'knodel:wallet:remove-account',
    'knodel:wallet:unlock',
    'knodel:wallet:close',
    'knodel:wallet:delete',
    'knodel:wallet:address-from-wif',
    'knodel:wallet:derive-from-seed',
    'knodel:wallet:show-seed',
    'knodel:wallet:chain-info',
    'knodel:wallet:block',
    'knodel:wallet:balance',
    'knodel:wallet:vhp',
    'knodel:wallet:nonce',
    'knodel:wallet:rc',
    'knodel:wallet:token-balance',
    'knodel:wallet:read-contract',
    'knodel:wallet:burn',
    'knodel:wallet:transfer-vhp',
    'knodel:wallet:transfer-koin'
  ] as const

  for (const channel of handlers) ipcMain.removeHandler(channel)

  ipcMain.handle('knodel:app-config:public-rpcs:load', async () => deps.loadPublicRpcConfig())
  ipcMain.handle('knodel:app-config:public-rpcs:save', async (_event, input?: PublicRpcConfigInput) => deps.savePublicRpcConfig(input))
  ipcMain.handle('knodel:koinos-node:defaults', async () => deps.getNodeDefaults())
  ipcMain.handle('knodel:koinos-node:clone-repo', async (_event, input?: KoinosNodeSettingsInput) => deps.cloneKoinosRepo(input))

  ipcMain.handle('knodel:koinos-node:file-read', async (_event, input?: KoinosNodeFileReadInput) => {
    if (!isManagedFileKind(input?.kind)) {
      return {
        ok: false,
        kind: 'config',
        filePath: '',
        content: '',
        output: 'Parametro kind invalido'
      } satisfies KoinosNodeFileReadResult
    }
    return deps.readKoinosManagedFile(input)
  })

  ipcMain.handle('knodel:koinos-node:file-write', async (_event, input?: KoinosNodeFileWriteInput) => {
    if (!isManagedFileKind(input?.kind)) {
      return {
        ok: false,
        kind: 'config',
        filePath: '',
        output: 'Parametro kind invalido'
      } satisfies KoinosNodeFileWriteResult
    }
    return deps.writeKoinosManagedFile(input)
  })

  ipcMain.handle('knodel:koinos-node:select-base-dir', async (_event, input?: KoinosNodeSettingsInput) => deps.selectNodeBaseDir(input))
  ipcMain.handle('knodel:koinos-node:validate-base-dir', async (_event, input?: KoinosNodeSettingsInput) => deps.validateNodeBaseDirAccess(input))
  ipcMain.handle('knodel:koinos-node:copy-base-dir-data', async (_event, input?: KoinosNodeBaseDirCopyInput) => deps.copyNodeBaseDirData(input))
  ipcMain.handle('knodel:koinos-node:status', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeStatus(input))
  ipcMain.handle('knodel:koinos-node:presets', async (_event, input?: KoinosNodeSettingsInput) => deps.composePresets(input))
  ipcMain.handle('knodel:koinos-node:native-builds', async () => deps.nativeBuildStatus())
  ipcMain.handle('knodel:koinos-node:native-build-all', async () => deps.nativeBuildAll())
  ipcMain.handle('knodel:koinos-node:native-build-service', async (_event, input?: KoinosNodeNativeBuildCommandInput) => deps.nativeBuildServiceAction(input))
  ipcMain.handle('knodel:koinos-node:start', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeAction('start', input))
  ipcMain.handle('knodel:koinos-node:stop', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeAction('stop', input))
  ipcMain.handle('knodel:koinos-node:restore-backup', async (event, input?: KoinosNodeSettingsInput) => deps.koinosNodeRestoreBackup(input, event.sender))
  ipcMain.handle('knodel:koinos-node:restore-backup-verify', async (event, input?: KoinosNodeSettingsInput) => deps.koinosNodeRestoreBackupAndVerify(input, event.sender))
  ipcMain.handle('knodel:koinos-node:backup-info', async (_event, url?: string) => {
    if (!url || typeof url !== 'string') return { ok: false, lastModified: null, sizeBytes: null }
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
      const lastModified = response.headers.get('last-modified')
      const contentLength = response.headers.get('content-length')
      return {
        ok: response.ok,
        lastModified: lastModified || null,
        sizeBytes: contentLength ? parseInt(contentLength, 10) : null
      }
    } catch {
      return { ok: false, lastModified: null, sizeBytes: null }
    }
  })
  ipcMain.handle('knodel:koinos-node:rpc-call', async (_event, input?: KoinosJsonRpcProxyInput) => deps.koinosJsonRpcProxy(input))
  ipcMain.handle('knodel:koinos-node:dashboard-producers', async (_event, input?: KoinosNodeSettingsInput & { rpcUrl?: string; windowBlocks?: number }) => deps.koinosNodeDashboardProducers(input))
  ipcMain.handle('knodel:koinos-node:dashboard-peers', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeDashboardPeers(input))
  ipcMain.handle('knodel:koinos-node:dashboard-performance', async (_event, input?: KoinosNodeDashboardPerformanceInput) => deps.koinosNodeDashboardPerformance(input))
  ipcMain.handle('knodel:koinos-node:producer-overview', async (_event, input?: KoinosNodeProducerOverviewInput) => deps.koinosNodeProducerOverview(input))
  ipcMain.handle('knodel:koinos-node:producer-registered-key', async (_event, input?: KoinosNodeProducerRegisteredKeyInput) => deps.koinosNodeProducerRegisteredKey(input))
  ipcMain.handle('knodel:koinos-node:producer-local-info', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeProducerLocalInfo(input))
  ipcMain.handle('knodel:koinos-node:producer-register', async (_event, input?: KoinosNodeProducerRegisterInput) => deps.koinosNodeProducerRegister(input))
  ipcMain.handle('knodel:koinos-node:producer-profile-get', async () => deps.koinosNodeProducerProfileGet())
  ipcMain.handle('knodel:koinos-node:producer-profile-clear', async () => deps.koinosNodeProducerProfileClear())
  ipcMain.handle('knodel:koinos-node:producer-delete', async (_event, input?: KoinosNodeSettingsInput) => deps.koinosNodeProducerDelete(input))

  ipcMain.handle('knodel:wallet:overview', async (_event, input?: WalletRpcInput) => deps.walletOverview(input))
  ipcMain.handle('knodel:wallet:generate', async () => deps.walletGenerate())
  ipcMain.handle('knodel:wallet:import', async (_event, input?: WalletImportInput) => deps.walletImport(input))
  ipcMain.handle('knodel:wallet:list-accounts', async () => deps.walletListAccounts())
  ipcMain.handle('knodel:wallet:set-active-account', async (_event, input?: WalletSetActiveAccountInput) => deps.walletSetActiveAccount(input))
  ipcMain.handle('knodel:wallet:create-derived-account', async (_event, input?: WalletCreateDerivedAccountInput) =>
    deps.walletCreateDerivedAccount(input)
  )
  ipcMain.handle('knodel:wallet:import-account', async (_event, input?: WalletImportAccountInput) =>
    deps.walletImportAccount(input)
  )
  ipcMain.handle('knodel:wallet:import-watch-account', async (_event, input?: WalletImportWatchAccountInput) =>
    deps.walletImportWatchAccount(input)
  )
  ipcMain.handle('knodel:wallet:rename-account', async (_event, input?: WalletRenameAccountInput) =>
    deps.walletRenameAccount(input)
  )
  ipcMain.handle('knodel:wallet:remove-account', async (_event, input?: WalletRemoveAccountInput) =>
    deps.walletRemoveAccount(input)
  )
  ipcMain.handle('knodel:wallet:unlock', async (_event, input?: WalletUnlockInput) => deps.walletUnlock(input))
  ipcMain.handle('knodel:wallet:close', async () => deps.walletClose())
  ipcMain.handle('knodel:wallet:delete', async () => deps.walletDelete())
  ipcMain.handle('knodel:wallet:address-from-wif', async (_event, input?: WalletAddressInput) => deps.walletAddressFromWif(input))
  ipcMain.handle('knodel:wallet:derive-from-seed', async (_event, input?: WalletDeriveFromSeedInput) => deps.walletDeriveFromSeed(input))
  ipcMain.handle('knodel:wallet:show-seed', async () => deps.walletShowSeed())
  ipcMain.handle('knodel:wallet:chain-info', async (_event, input?: WalletRpcInput) => deps.walletChainInfo(input))
  ipcMain.handle('knodel:wallet:block', async (_event, input?: WalletBlockInput) => deps.walletBlock(input))
  ipcMain.handle('knodel:wallet:balance', async (_event, input?: WalletAddressQueryInput) => deps.walletBalance(input))
  ipcMain.handle('knodel:wallet:vhp', async (_event, input?: WalletAddressQueryInput) => deps.walletVhp(input))
  ipcMain.handle('knodel:wallet:nonce', async (_event, input?: WalletAddressQueryInput) => deps.walletNonce(input))
  ipcMain.handle('knodel:wallet:rc', async (_event, input?: WalletAddressQueryInput) => deps.walletRc(input))
  ipcMain.handle('knodel:wallet:token-balance', async (_event, input?: WalletTokenBalanceInput) => deps.walletTokenBalance(input))
  ipcMain.handle('knodel:wallet:read-contract', async (_event, input?: WalletReadContractInput) => deps.walletReadContract(input))
  ipcMain.handle('knodel:wallet:burn', async (_event, input?: WalletBurnInput) => deps.walletBurn(input))
  ipcMain.handle('knodel:wallet:transfer-vhp', async (_event, input?: WalletTransferVhpInput) => deps.walletTransferVhp(input))
  ipcMain.handle('knodel:wallet:transfer-koin', async (_event, input?: WalletTransferKoinInput) => deps.walletTransferKoin(input))

  ipcMain.handle('knodel:koinos-node:service-start', async (_event, input?: KoinosNodeServiceCommandInput) => deps.koinosNodeServiceAction('start', input))
  ipcMain.handle('knodel:koinos-node:service-stop', async (_event, input?: KoinosNodeServiceCommandInput) => deps.koinosNodeServiceAction('stop', input))
  ipcMain.handle('knodel:koinos-node:service-restart', async (_event, input?: KoinosNodeServiceCommandInput) => deps.koinosNodeServiceAction('restart', input))
  ipcMain.handle('knodel:koinos-node:service-kill-conflict', async (_event, input?: KoinosNodeServiceCommandInput) => deps.koinosNodeServiceAction('kill-conflict', input))
  ipcMain.handle('knodel:koinos-node:preset-reconcile', async (_event, input?: KoinosNodePresetCommandInput) => deps.koinosNodePresetReconcile(input))
  ipcMain.handle('knodel:koinos-node:logs', async (_event, input?: KoinosNodeLogsInput) => deps.koinosNodeLogs(input))
  ipcMain.handle('knodel:koinos-node:logs-follow-start', async (event, input?: KoinosNodeLogsFollowStartInput) => deps.koinosNodeLogsFollowStart(event.sender, input))

  ipcMain.handle('knodel:koinos-node:logs-follow-stop', async (_event, input?: KoinosNodeLogsFollowStopInput) => {
    const streamId = input?.streamId?.trim() || ''
    if (!streamId) return { ok: false, streamId: null }
    return deps.stopLogsFollowStream(streamId)
  })
}
