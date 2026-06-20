import type { IpcMain, WebContents } from 'electron'

import type {
  KoinosJsonRpcProxyInput,
  TelenoNodeBaseDirCopyInput,
  TelenoNodeComponentToggleInput,
  TelenoNodeComponentToggleResult,
  TelenoNodeDashboardPerformanceInput,
  TelenoNodeFileReadInput,
  TelenoNodeFileReadResult,
  TelenoNodeFileWriteInput,
  TelenoNodeFileWriteResult,
  TelenoNodeLogsFollowStartInput,
  TelenoNodeLogsFollowStartResult,
  TelenoNodeLogsFollowStopInput,
  TelenoNodeLogsFollowStopResult,
  TelenoNodeLogsInput,
  TelenoNodeManagedFileKind,
  TelenoNodeNativeBackupPurgeInput,
  TelenoNodeNativeBackupRestoreInput,
  TelenoNodeNativeBuildCommandInput,
  TelenoNodePresetCommandInput,
  TelenoNodeProducerOverviewInput,
  TelenoNodeProducerRegisterInput,
  TelenoNodeProducerRegisteredKeyInput,
  TelenoNodeServiceCommandInput,
  TelenoNodeSettingsInput,
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
  WalletSetProducerAccountInput,
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
  cloneKoinosRepo: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  readKoinosManagedFile: (input: TelenoNodeFileReadInput) => Awaitable<TelenoNodeFileReadResult>
  writeKoinosManagedFile: (input: TelenoNodeFileWriteInput) => Awaitable<TelenoNodeFileWriteResult>
  selectNodeBaseDir: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  validateNodeBaseDirAccess: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  copyNodeBaseDirData: (input?: TelenoNodeBaseDirCopyInput) => Awaitable<unknown>
  telenoNodeStatus: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  composePresets: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  nativeBuildStatus: () => Awaitable<unknown>
  nativeBuildAll: () => Awaitable<unknown>
  nativeBuildServiceAction: (input?: TelenoNodeNativeBuildCommandInput) => Awaitable<unknown>
  telenoNodeAction: (action: 'start' | 'stop', input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  telenoNodeRestoreBackup: (input: TelenoNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  telenoNodeRestoreBackupAndVerify: (input: TelenoNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  createLocalBackup: (input: TelenoNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  nativeBackupDryRun: (input: TelenoNodeSettingsInput | undefined) => Awaitable<unknown>
  nativeBackupConfig: (input: TelenoNodeSettingsInput | undefined) => Awaitable<unknown>
  nativeBackupList: (input: (TelenoNodeSettingsInput & { remote?: boolean; public?: boolean }) | undefined) => Awaitable<unknown>
  nativeBackupPurge: (input: TelenoNodeNativeBackupPurgeInput | undefined) => Awaitable<unknown>
  nativeBackupRestorePreflight: (input: TelenoNodeNativeBackupRestoreInput | undefined) => Awaitable<unknown>
  restoreNativeBackup: (input: TelenoNodeNativeBackupRestoreInput | undefined, sender: WebContents) => Awaitable<unknown>
  restoreNativeBackupLatest: (input: TelenoNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  cancelCreateBackup: () => Awaitable<{ ok: boolean; output: string }>
  restoreFromLocalFile: (input: TelenoNodeSettingsInput | undefined, sender: WebContents) => Awaitable<unknown>
  getVerifyBlocks: (input?: TelenoNodeSettingsInput) => Awaitable<{ ok: boolean; enabled: boolean | null; output: string }>
  setVerifyBlocks: (input?: TelenoNodeSettingsInput & { enabled?: boolean }) => Awaitable<{ ok: boolean; output: string }>
  koinosJsonRpcProxy: (input?: KoinosJsonRpcProxyInput) => Awaitable<unknown>
  telenoNodeDashboardProducers: (input?: TelenoNodeSettingsInput & { rpcUrl?: string; windowBlocks?: number }) => Awaitable<unknown>
  telenoNodeDashboardPeers: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  telenoNodeDashboardPerformance: (input?: TelenoNodeDashboardPerformanceInput) => Awaitable<unknown>
  telenoNodeProducerOverview: (input?: TelenoNodeProducerOverviewInput) => Awaitable<unknown>
  telenoNodeProducerRegisteredKey: (input?: TelenoNodeProducerRegisteredKeyInput) => Awaitable<unknown>
  telenoNodeProducerLocalInfo: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  telenoNodeProducerRegister: (input?: TelenoNodeProducerRegisterInput) => Awaitable<unknown>
  telenoNodeProducerProfileGet: () => Awaitable<unknown>
  telenoNodeProducerProfileClear: () => Awaitable<unknown>
  telenoNodeProducerDelete: (input?: TelenoNodeSettingsInput) => Awaitable<unknown>
  walletOverview: (input?: WalletRpcInput) => Awaitable<unknown>
  walletGenerate: () => Awaitable<unknown>
  walletImport: (input?: WalletImportInput) => Awaitable<unknown>
  walletListAccounts: () => Awaitable<unknown>
  walletSetActiveAccount: (input?: WalletSetActiveAccountInput) => Awaitable<unknown>
  walletSetProducerAccount: (input?: WalletSetProducerAccountInput) => Awaitable<unknown>
  walletCreateDerivedAccount: (input?: WalletCreateDerivedAccountInput) => Awaitable<unknown>
  walletImportAccount: (input?: WalletImportAccountInput) => Awaitable<unknown>
  walletImportWatchAccount: (input?: WalletImportWatchAccountInput) => Awaitable<unknown>
  walletRenameAccount: (input?: WalletRenameAccountInput) => Awaitable<unknown>
  walletRemoveAccount: (input?: WalletRemoveAccountInput) => Awaitable<unknown>
  walletUnlock: (input?: WalletUnlockInput) => Awaitable<unknown>
  walletClose: (input?: WalletRpcInput) => Awaitable<unknown>
  walletDelete: (input?: WalletRpcInput) => Awaitable<unknown>
  walletAddressFromWif: (input?: WalletAddressInput) => Awaitable<unknown>
  walletDeriveFromSeed: (input?: WalletDeriveFromSeedInput) => Awaitable<unknown>
  walletShowSeed: (input?: WalletRpcInput) => Awaitable<unknown>
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
  telenoNodeServiceAction: (action: 'start' | 'stop' | 'restart' | 'kill-conflict', input?: TelenoNodeServiceCommandInput) => Awaitable<unknown>
  telenoNodeComponentToggle: (input?: TelenoNodeComponentToggleInput) => Awaitable<TelenoNodeComponentToggleResult>
  telenoNodePresetReconcile: (input?: TelenoNodePresetCommandInput) => Awaitable<unknown>
  telenoNodeLogs: (input?: TelenoNodeLogsInput) => Awaitable<unknown>
  telenoNodeLogsFollowStart: (sender: WebContents, input?: TelenoNodeLogsFollowStartInput) => Awaitable<TelenoNodeLogsFollowStartResult>
  stopLogsFollowStream: (streamId: string) => Awaitable<TelenoNodeLogsFollowStopResult>
}

function isManagedFileKind(kind: unknown): kind is TelenoNodeManagedFileKind {
  return kind === 'compose' || kind === 'env' || kind === 'config'
}

export function registerTelenoIpcHandlers(ipcMain: IpcMain, deps: IpcHandlerDeps): void {
  const handlers = [
    'teleno:app-config:public-rpcs:load',
    'teleno:app-config:public-rpcs:save',
    'teleno:node:defaults',
    'teleno:node:clone-repo',
    'teleno:node:file-read',
    'teleno:node:file-write',
    'teleno:node:select-base-dir',
    'teleno:node:validate-base-dir',
    'teleno:node:copy-base-dir-data',
    'teleno:node:status',
    'teleno:node:presets',
    'teleno:node:native-builds',
    'teleno:node:native-build-all',
    'teleno:node:native-build-service',
    'teleno:node:start',
    'teleno:node:stop',
    'teleno:node:restore-backup',
    'teleno:node:restore-backup-verify',
    'teleno:node:create-backup',
    'teleno:node:native-backup-dry-run',
    'teleno:node:native-backup-list',
    'teleno:node:native-backup-purge',
    'teleno:node:native-backup-restore-preflight',
    'teleno:node:restore-native-backup',
    'teleno:node:restore-native-backup-latest',
    'teleno:node:cancel-create-backup',
    'teleno:node:restore-local-backup',
    'teleno:node:get-verify-blocks',
    'teleno:node:set-verify-blocks',
    'teleno:node:backup-info',
    'teleno:node:rpc-call',
    'teleno:node:dashboard-producers',
    'teleno:node:dashboard-peers',
    'teleno:node:dashboard-performance',
    'teleno:node:producer-overview',
    'teleno:node:producer-registered-key',
    'teleno:node:producer-local-info',
    'teleno:node:producer-register',
    'teleno:node:producer-profile-get',
    'teleno:node:producer-profile-clear',
    'teleno:node:producer-delete',
    'teleno:node:service-start',
    'teleno:node:service-stop',
    'teleno:node:service-restart',
    'teleno:node:service-kill-conflict',
    'teleno:node:component-toggle',
    'teleno:node:preset-reconcile',
    'teleno:node:logs',
    'teleno:node:logs-follow-start',
    'teleno:node:logs-follow-stop',
    'teleno:wallet:overview',
    'teleno:wallet:generate',
    'teleno:wallet:import',
    'teleno:wallet:list-accounts',
    'teleno:wallet:set-active-account',
    'teleno:wallet:set-producer-account',
    'teleno:wallet:create-derived-account',
    'teleno:wallet:import-account',
    'teleno:wallet:import-watch-account',
    'teleno:wallet:rename-account',
    'teleno:wallet:remove-account',
    'teleno:wallet:unlock',
    'teleno:wallet:close',
    'teleno:wallet:delete',
    'teleno:wallet:address-from-wif',
    'teleno:wallet:derive-from-seed',
    'teleno:wallet:show-seed',
    'teleno:wallet:chain-info',
    'teleno:wallet:block',
    'teleno:wallet:balance',
    'teleno:wallet:vhp',
    'teleno:wallet:nonce',
    'teleno:wallet:rc',
    'teleno:wallet:token-balance',
    'teleno:wallet:read-contract',
    'teleno:wallet:burn',
    'teleno:wallet:transfer-vhp',
    'teleno:wallet:transfer-koin'
  ] as const

  for (const channel of handlers) ipcMain.removeHandler(channel)

  // Sync handler for app version (used by preload before contextBridge)
  ipcMain.on('teleno:app-version', (event) => {
    try {
      event.returnValue = require('../../package.json').version
    } catch {
      event.returnValue = '0.10.0'
    }
  })

  ipcMain.handle('teleno:app-config:public-rpcs:load', async () => deps.loadPublicRpcConfig())
  ipcMain.handle('teleno:app-config:public-rpcs:save', async (_event, input?: PublicRpcConfigInput) => deps.savePublicRpcConfig(input))
  ipcMain.handle('teleno:node:defaults', async () => deps.getNodeDefaults())
  ipcMain.handle('teleno:node:clone-repo', async (_event, input?: TelenoNodeSettingsInput) => deps.cloneKoinosRepo(input))

  ipcMain.handle('teleno:node:file-read', async (_event, input?: TelenoNodeFileReadInput) => {
    if (!isManagedFileKind(input?.kind)) {
      return {
        ok: false,
        kind: 'config',
        filePath: '',
        content: '',
        output: 'Parametro kind invalido'
      } satisfies TelenoNodeFileReadResult
    }
    return deps.readKoinosManagedFile(input)
  })

  ipcMain.handle('teleno:node:file-write', async (_event, input?: TelenoNodeFileWriteInput) => {
    if (!isManagedFileKind(input?.kind)) {
      return {
        ok: false,
        kind: 'config',
        filePath: '',
        output: 'Parametro kind invalido'
      } satisfies TelenoNodeFileWriteResult
    }
    return deps.writeKoinosManagedFile(input)
  })

  ipcMain.handle('teleno:node:select-base-dir', async (_event, input?: TelenoNodeSettingsInput) => deps.selectNodeBaseDir(input))
  ipcMain.handle('teleno:node:validate-base-dir', async (_event, input?: TelenoNodeSettingsInput) => deps.validateNodeBaseDirAccess(input))
  ipcMain.handle('teleno:node:copy-base-dir-data', async (_event, input?: TelenoNodeBaseDirCopyInput) => deps.copyNodeBaseDirData(input))
  ipcMain.handle('teleno:node:status', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeStatus(input))
  ipcMain.handle('teleno:node:presets', async (_event, input?: TelenoNodeSettingsInput) => deps.composePresets(input))
  ipcMain.handle('teleno:node:native-builds', async () => deps.nativeBuildStatus())
  ipcMain.handle('teleno:node:native-build-all', async () => deps.nativeBuildAll())
  ipcMain.handle('teleno:node:native-build-service', async (_event, input?: TelenoNodeNativeBuildCommandInput) => deps.nativeBuildServiceAction(input))
  ipcMain.handle('teleno:node:start', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeAction('start', input))
  ipcMain.handle('teleno:node:stop', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeAction('stop', input))
  ipcMain.handle('teleno:node:restore-backup', async (event, input?: TelenoNodeSettingsInput) => deps.telenoNodeRestoreBackup(input, event.sender))
  ipcMain.handle('teleno:node:restore-backup-verify', async (event, input?: TelenoNodeSettingsInput) => deps.telenoNodeRestoreBackupAndVerify(input, event.sender))
  ipcMain.handle('teleno:node:create-backup', async (event, input?: TelenoNodeSettingsInput) => deps.createLocalBackup(input, event.sender))
  ipcMain.handle('teleno:node:native-backup-dry-run', async (_event, input?: TelenoNodeSettingsInput) => deps.nativeBackupDryRun(input))
  ipcMain.handle('teleno:node:native-backup-config', async (_event, input?: TelenoNodeSettingsInput) => deps.nativeBackupConfig(input))
  ipcMain.handle('teleno:node:native-backup-list', async (_event, input?: TelenoNodeSettingsInput & { remote?: boolean; public?: boolean }) => deps.nativeBackupList(input))
  ipcMain.handle('teleno:node:native-backup-purge', async (_event, input?: TelenoNodeNativeBackupPurgeInput) => deps.nativeBackupPurge(input))
  ipcMain.handle('teleno:node:native-backup-restore-preflight', async (_event, input?: TelenoNodeNativeBackupRestoreInput) => deps.nativeBackupRestorePreflight(input))
  ipcMain.handle('teleno:node:restore-native-backup', async (event, input?: TelenoNodeNativeBackupRestoreInput) => deps.restoreNativeBackup(input, event.sender))
  ipcMain.handle('teleno:node:restore-native-backup-latest', async (event, input?: TelenoNodeSettingsInput) => deps.restoreNativeBackupLatest(input, event.sender))
  ipcMain.handle('teleno:node:cancel-create-backup', async () => deps.cancelCreateBackup())
  ipcMain.handle('teleno:node:restore-local-backup', async (event, input?: TelenoNodeSettingsInput) => deps.restoreFromLocalFile(input, event.sender))
  ipcMain.handle('teleno:node:get-verify-blocks', async (_event, input?: TelenoNodeSettingsInput) => deps.getVerifyBlocks(input))
  ipcMain.handle('teleno:node:set-verify-blocks', async (_event, input?: TelenoNodeSettingsInput & { enabled?: boolean }) => deps.setVerifyBlocks(input))
  ipcMain.handle('teleno:node:backup-info', async (_event, url?: string) => {
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
  ipcMain.handle('teleno:node:rpc-call', async (_event, input?: KoinosJsonRpcProxyInput) => deps.koinosJsonRpcProxy(input))
  ipcMain.handle('teleno:node:dashboard-producers', async (_event, input?: TelenoNodeSettingsInput & { rpcUrl?: string; windowBlocks?: number }) => deps.telenoNodeDashboardProducers(input))
  ipcMain.handle('teleno:node:dashboard-peers', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeDashboardPeers(input))
  ipcMain.handle('teleno:node:dashboard-performance', async (_event, input?: TelenoNodeDashboardPerformanceInput) => deps.telenoNodeDashboardPerformance(input))
  ipcMain.handle('teleno:node:producer-overview', async (_event, input?: TelenoNodeProducerOverviewInput) => deps.telenoNodeProducerOverview(input))
  ipcMain.handle('teleno:node:producer-registered-key', async (_event, input?: TelenoNodeProducerRegisteredKeyInput) => deps.telenoNodeProducerRegisteredKey(input))
  ipcMain.handle('teleno:node:producer-local-info', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeProducerLocalInfo(input))
  ipcMain.handle('teleno:node:producer-register', async (_event, input?: TelenoNodeProducerRegisterInput) => deps.telenoNodeProducerRegister(input))
  ipcMain.handle('teleno:node:producer-profile-get', async () => deps.telenoNodeProducerProfileGet())
  ipcMain.handle('teleno:node:producer-profile-clear', async () => deps.telenoNodeProducerProfileClear())
  ipcMain.handle('teleno:node:producer-delete', async (_event, input?: TelenoNodeSettingsInput) => deps.telenoNodeProducerDelete(input))

  ipcMain.handle('teleno:wallet:overview', async (_event, input?: WalletRpcInput) => deps.walletOverview(input))
  ipcMain.handle('teleno:wallet:generate', async () => deps.walletGenerate())
  ipcMain.handle('teleno:wallet:import', async (_event, input?: WalletImportInput) => deps.walletImport(input))
  ipcMain.handle('teleno:wallet:list-accounts', async () => deps.walletListAccounts())
  ipcMain.handle('teleno:wallet:set-active-account', async (_event, input?: WalletSetActiveAccountInput) => deps.walletSetActiveAccount(input))
  ipcMain.handle('teleno:wallet:set-producer-account', async (_event, input?: WalletSetProducerAccountInput) =>
    deps.walletSetProducerAccount(input)
  )
  ipcMain.handle('teleno:wallet:create-derived-account', async (_event, input?: WalletCreateDerivedAccountInput) =>
    deps.walletCreateDerivedAccount(input)
  )
  ipcMain.handle('teleno:wallet:import-account', async (_event, input?: WalletImportAccountInput) =>
    deps.walletImportAccount(input)
  )
  ipcMain.handle('teleno:wallet:import-watch-account', async (_event, input?: WalletImportWatchAccountInput) =>
    deps.walletImportWatchAccount(input)
  )
  ipcMain.handle('teleno:wallet:rename-account', async (_event, input?: WalletRenameAccountInput) =>
    deps.walletRenameAccount(input)
  )
  ipcMain.handle('teleno:wallet:remove-account', async (_event, input?: WalletRemoveAccountInput) =>
    deps.walletRemoveAccount(input)
  )
  ipcMain.handle('teleno:wallet:unlock', async (_event, input?: WalletUnlockInput) => deps.walletUnlock(input))
  ipcMain.handle('teleno:wallet:close', async (_event, input?: WalletRpcInput) => deps.walletClose(input))
  ipcMain.handle('teleno:wallet:delete', async (_event, input?: WalletRpcInput) => deps.walletDelete(input))
  ipcMain.handle('teleno:wallet:address-from-wif', async (_event, input?: WalletAddressInput) => deps.walletAddressFromWif(input))
  ipcMain.handle('teleno:wallet:derive-from-seed', async (_event, input?: WalletDeriveFromSeedInput) => deps.walletDeriveFromSeed(input))
  ipcMain.handle('teleno:wallet:show-seed', async (_event, input?: WalletRpcInput) => deps.walletShowSeed(input))
  ipcMain.handle('teleno:wallet:chain-info', async (_event, input?: WalletRpcInput) => deps.walletChainInfo(input))
  ipcMain.handle('teleno:wallet:block', async (_event, input?: WalletBlockInput) => deps.walletBlock(input))
  ipcMain.handle('teleno:wallet:balance', async (_event, input?: WalletAddressQueryInput) => deps.walletBalance(input))
  ipcMain.handle('teleno:wallet:vhp', async (_event, input?: WalletAddressQueryInput) => deps.walletVhp(input))
  ipcMain.handle('teleno:wallet:nonce', async (_event, input?: WalletAddressQueryInput) => deps.walletNonce(input))
  ipcMain.handle('teleno:wallet:rc', async (_event, input?: WalletAddressQueryInput) => deps.walletRc(input))
  ipcMain.handle('teleno:wallet:token-balance', async (_event, input?: WalletTokenBalanceInput) => deps.walletTokenBalance(input))
  ipcMain.handle('teleno:wallet:read-contract', async (_event, input?: WalletReadContractInput) => deps.walletReadContract(input))
  ipcMain.handle('teleno:wallet:burn', async (_event, input?: WalletBurnInput) => deps.walletBurn(input))
  ipcMain.handle('teleno:wallet:transfer-vhp', async (_event, input?: WalletTransferVhpInput) => deps.walletTransferVhp(input))
  ipcMain.handle('teleno:wallet:transfer-koin', async (_event, input?: WalletTransferKoinInput) => deps.walletTransferKoin(input))

  ipcMain.handle('teleno:node:service-start', async (_event, input?: TelenoNodeServiceCommandInput) => deps.telenoNodeServiceAction('start', input))
  ipcMain.handle('teleno:node:service-stop', async (_event, input?: TelenoNodeServiceCommandInput) => deps.telenoNodeServiceAction('stop', input))
  ipcMain.handle('teleno:node:service-restart', async (_event, input?: TelenoNodeServiceCommandInput) => deps.telenoNodeServiceAction('restart', input))
  ipcMain.handle('teleno:node:service-kill-conflict', async (_event, input?: TelenoNodeServiceCommandInput) => deps.telenoNodeServiceAction('kill-conflict', input))
  ipcMain.handle('teleno:node:component-toggle', async (_event, input?: TelenoNodeComponentToggleInput) => deps.telenoNodeComponentToggle(input))
  ipcMain.handle('teleno:node:preset-reconcile', async (_event, input?: TelenoNodePresetCommandInput) => deps.telenoNodePresetReconcile(input))
  ipcMain.handle('teleno:node:logs', async (_event, input?: TelenoNodeLogsInput) => deps.telenoNodeLogs(input))
  ipcMain.handle('teleno:node:logs-follow-start', async (event, input?: TelenoNodeLogsFollowStartInput) => deps.telenoNodeLogsFollowStart(event.sender, input))

  ipcMain.handle('teleno:node:logs-follow-stop', async (_event, input?: TelenoNodeLogsFollowStopInput) => {
    const streamId = input?.streamId?.trim() || ''
    if (!streamId) return { ok: false, streamId: null }
    return deps.stopLogsFollowStream(streamId)
  })
}
