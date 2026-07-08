import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localeForLanguage, translate, type AppLanguage } from './i18n'
import {
  DEFAULT_NODE_SETTINGS,
  DEFAULT_PUBLIC_RPC_URLS,
  DEFAULT_SETTINGS,
  FIRST_RUN_SETUP_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  LEGACY_NODE_SETTINGS_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  LOCAL_RPC_SOURCE,
  NODE_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  AUTO_RESTART_CHAIN_CHECK_INTERVAL_MS,
  SYNC_GAP_BLOCK_THRESHOLD,
  SYNC_GAP_TIME_THRESHOLD_MS
} from './app/constants'
import type {
  AppTab,
  AppPreferences,
  BlockRow,
  DashboardSubtab,
  ExplorerSettings,
  HeadSnapshot,
  NodeAction,
  NodeBackupSettings,
  NodeBackupProgressState,
  NodeBaseDirChangeDialogState,
  NodeBaseDirValidationState,
  NodeConflictDialogState,
  NodeManagerSettings,
  NodeNativeBuildActionState,
  NodeProducerActionState,
  NodeServiceAction,
  NodeServiceActionState,
  NodeServiceCapabilities,
  NodeServiceContextMenuState
} from './app/types'
import {
  getProducerOperationalNotice,
  getProducerPublicKeyRegistrationState,
  getProducerSetupBlockReason,
  isProducerActivelyProducingFromLogs,
  isProducerSetupComplete,
  resolveConfiguredProducerAddress,
  resolveProducerTargetAddress
} from './app/producer'
import {
  DEFAULT_LOG_COMPONENT_FILTERS,
  LOG_LEVEL_FILTERS,
  filterLogOutput,
  listLogComponents,
  type LogLevelFilter
} from './app/log-filters'
import {
  canKillNodeConflict,
  clamp,
  expandNodeProfiles,
  fetchHeadSnapshot,
  fetchLatestBlocks,
  filterBlocksByProducer,
  defaultNodeProfilesForNetwork,
  formatDateTime,
  formatDurationSeconds,
  formatExplorerRpcSourceTarget,
  formatNodeServicePorts,
  formatNodeServiceTooltip,
  formatPresetProfiles,
  formatProducerWalletBalanceError,
  formatTime,
  getAppConfigBridge,
  getTelenoNodeBridge,
  getWalletBridge,
  isNodeServiceRunning,
  loadInitialLanguage,
  loadInitialNodeSettings,
  loadInitialSettings,
  looksLikeNodeErrorOutput,
  normalizeDashboardProducerWindowBlocks,
  normalizeDashboardRefreshSeconds,
  normalizeBackupTarGzUrl,
  normalizeExternalHttpsUrl,
  normalizeExplorerRpcSource,
  normalizeNodeBaseDirInput,
  normalizeNodeBackupSettings,
  parseProfilesCsv,
  parsePublicRpcUrlsInput,
  renderAnsiLog,
  remoteBackupDefaults,
  resolveNodeBaseDirForNetwork,
  resolveExplorerRpcUrl,
  formatBytes,
  resolveLocalNodeRpcUrl,
  resolveProducerRpcUrl,
  resolveNodeFileDisplayPath,
  sameProfiles,
  sameNodeBackupSettings,
  sameStringList,
  storeNodeBaseDirForNetwork,
  toNodeApiSettings
} from './app/utils'
import {
  resolveWalletBurnTargetAddress,
  resolveWalletSendTargetAddress,
  walletDefaultReceiverAddress
} from './app/wallet-actions'
import { AppFooter } from './components/panels/AppFooter'
import { DashboardPanel } from './components/panels/DashboardPanel'
import { DocumentationPanel } from './components/panels/DocumentationPanel'
import { ExplorerPanel } from './components/panels/ExplorerPanel'
import { BlockDetailDialog } from './components/panels/BlockDetailDialog'
import { NodeFileEditorModal } from './components/panels/NodeFileEditorModal'
import { NodeBackupsPanel } from './components/panels/NodeBackupsPanel'
import { FirstRunSetupModal } from './components/panels/FirstRunSetupModal'
import { ProducerPanel } from './components/panels/ProducerPanel'
import { SettingsPanel } from './components/panels/SettingsPanel'
import { WalletPanel } from './components/panels/WalletPanel'
import { createAutoRestartState, createP2pRestartState, evaluateAutoRestart, evaluateP2pRestart, hasStateMerkleMismatch, parseIndexerProgress, shouldDisableVerifyBlocks } from './app/chain-sync'
import type { AutoRestartState, IndexerProgress, P2pRestartState } from './app/chain-sync'
import { KOINOS_NETWORK_OPTIONS, nativeTokenSymbolForNetwork, publicRpcUrlsForNetwork, type KoinosNetworkId } from './app/network'
import {
  TERMINAL_BACKUP_PHASES,
  clampBackupProgress,
  createBackupProgressState,
  numericOrNull,
  parseNativeBackupSelection,
  type BackupProgressSample
} from './app/native-backups'
import { publicBootstrapUrlForNetwork } from './app/public-bootstrap'
import pkg from '../package.json'

const appLogoUrl = new URL('../assets/newbranding/logo.svg', import.meta.url).href
const REMOTE_NODE_MANAGEMENT_ENABLED = false
const DEFAULT_APP_PREFERENCES: AppPreferences = {
  keepRunningInMenuBar: false
}
const DEFAULT_DOCUMENTATION_PATH = 'manual-site/index.html'

function changelogAnchorForVersion(version: string): string {
  return version.trim().toLowerCase().replace(/^v/, '').replace(/[^a-z0-9.-]+/g, '-')
}

function changelogPathForVersion(version: string): string {
  return `manual-site/reference/changelog.html#version-${changelogAnchorForVersion(version)}`
}

type WalletActivityEntry = {
  id: string
  title: string
  output: string
  at: number
  ok: boolean
  accountId: string | null
  accountName: string | null
  accountAddress: string | null
}

type WalletBalanceCacheEntry = {
  balance: TelenoWalletBalanceResult
  refreshedAt: number
}

type PublicRpcUrlsByNetwork = Record<KoinosNetworkId, string[]>
type NodeSubtab = 'overview' | 'backups'

const publicRpcNetworks: KoinosNetworkId[] = ['mainnet', 'testnet', 'custom']
const nodePanelOptionalComponentOrder = [
  'jsonrpc',
  'grpc',
  'block_producer',
  'contract_meta_store',
  'transaction_store',
  'account_history'
]

function formatNodePresetText(value: string): string {
  return value.replace(/\bObserver\b/g, 'Seed').replace(/\bobserver\b/g, 'seed')
}

function formatNodePresetLabel(preset: TelenoNodePreset): string {
  return formatNodePresetText(preset.label)
}

function formatNodePresetProfileText(preset: TelenoNodePreset, language: AppLanguage): string {
  return formatNodePresetText(formatPresetProfiles(preset, language))
}

function formatNodePresetDescription(preset: TelenoNodePreset): string {
  return formatNodePresetText(preset.description)
}

function formatNetworkLabel(network: KoinosNetworkId): string {
  return KOINOS_NETWORK_OPTIONS.find((option) => option.id === network)?.label ?? network
}

function findTelenoNodeConflictService(
  status: TelenoNodeStatus | null
): TelenoNodeServiceStatus | null {
  return (
    status?.services.find(
      (service) =>
        service.id === 'teleno-node' &&
        service.state === 'conflict' &&
        (service.conflictPids?.length ?? 0) > 0
    ) ?? null
  )
}

function defaultPublicRpcUrlsByNetwork(): PublicRpcUrlsByNetwork {
  return {
    mainnet: publicRpcUrlsForNetwork('mainnet'),
    testnet: publicRpcUrlsForNetwork('testnet'),
    custom: publicRpcUrlsForNetwork('custom')
  }
}

function publicRpcUrlsForActiveNetwork(network: KoinosNetworkId, urlsByNetwork: PublicRpcUrlsByNetwork): string[] {
  const urls = urlsByNetwork[network]
  return urls.length > 0 ? urls : publicRpcUrlsForNetwork(network)
}

function mergePublicRpcUrlsByNetwork(input?: Partial<Record<KoinosNetworkId, string[]>>): PublicRpcUrlsByNetwork {
  const merged = defaultPublicRpcUrlsByNetwork()
  if (!input || typeof input !== 'object') return merged

  for (const network of publicRpcNetworks) {
    const urls = input[network]
    if (Array.isArray(urls) && urls.length > 0) {
      merged[network] = urls
    }
  }

  return merged
}

function walletBalanceCacheKeys(network: KoinosNetworkId, address?: string | null, accountId?: string | null): string[] {
  const keys: string[] = []
  const normalizedAccountId = `${accountId || ''}`.trim()
  const normalizedAddress = `${address || ''}`.trim().toLowerCase()
  if (normalizedAccountId) keys.push(`${network}:id:${normalizedAccountId}`)
  if (normalizedAddress) keys.push(`${network}:address:${normalizedAddress}`)
  return keys
}

function rendererHasExistingSetupStorage(): boolean {
  try {
    const storage = window.localStorage
    if (storage.getItem(FIRST_RUN_SETUP_STORAGE_KEY) === 'complete') return true
    if (storage.getItem(NODE_SETTINGS_STORAGE_KEY) || storage.getItem(LEGACY_NODE_SETTINGS_STORAGE_KEY)) return true
    if (storage.getItem(SETTINGS_STORAGE_KEY) || storage.getItem(LEGACY_SETTINGS_STORAGE_KEY)) return true
  } catch {
    return false
  }

  return false
}

export function App() {
  const appBuildInfo = window.teleno?.buildInfo || {
    schemaVersion: 1,
    productVersion: window.teleno?.version?.trim() || pkg.version,
    releaseChannel: 'dev',
    buildTimestamp: null,
    gitCommit: null,
    gitShortCommit: null,
    gitBranch: null,
    gitDirty: null,
    nativeNode: {
      binaryName: 'teleno_node',
      sha256: null,
      shortSha256: null,
      sizeBytes: null,
      mtime: null
    },
    source: 'runtime'
  }
  const appVersion = appBuildInfo.productVersion?.trim() || window.teleno?.version?.trim() || pkg.version
  const [language, setLanguage] = useState<AppLanguage>(() => loadInitialLanguage())
  const [settings, setSettings] = useState<ExplorerSettings>(() => loadInitialSettings())
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(() => DEFAULT_APP_PREFERENCES)
  const [savedAppPreferences, setSavedAppPreferences] = useState<AppPreferences>(() => DEFAULT_APP_PREFERENCES)
  const [savedLanguage, setSavedLanguage] = useState<AppLanguage>(() => language)
  const [savedSettings, setSavedSettings] = useState<ExplorerSettings>(() => settings)
  const [nodeSettings, setNodeSettings] = useState<NodeManagerSettings>(() => loadInitialNodeSettings())
  const [publicRpcUrlsByNetwork, setPublicRpcUrlsByNetwork] = useState<PublicRpcUrlsByNetwork>(() => ({
    ...defaultPublicRpcUrlsByNetwork(),
    [nodeSettings.network]: settings.publicRpcUrls
  }))
  const [rows, setRows] = useState<BlockRow[]>([])
  const [head, setHead] = useState<HeadSnapshot | null>(null)
  const [publicChainHead, setPublicChainHead] = useState<HeadSnapshot | null>(null)
  const [localChainHead, setLocalChainHead] = useState<HeadSnapshot | null>(null)
  const [blocksPerSecond, setBlocksPerSecond] = useState<number | null>(null)
  const [indexerProgress, setIndexerProgress] = useState<IndexerProgress>(null)
  const [indexerBlocksPerSec, setIndexerBlocksPerSec] = useState<number | null>(null)
  const prevIndexerRef = useRef<{ height: number; time: number } | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<any>(null)
  const [selectedBlockRpcUrl, setSelectedBlockRpcUrl] = useState<string | null>(null)
  const selectedBlockRef = useRef<any>(null)
  const prevChainHeadRef = useRef<{ height: number; time: number } | null>(null)
  const autoRestartStateRef = useRef<AutoRestartState>(createAutoRestartState())
  const p2pRestartStateRef = useRef<P2pRestartState>(createP2pRestartState())
  const verifyBlocksCheckDoneRef = useRef(false)
  const nativeBackupConfigLoadKeyRef = useRef('')
  const nativeBackupUserEditedRef = useRef(false)
  const backupProgressSampleRef = useRef<BackupProgressSample | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [freshBlockIds, setFreshBlockIds] = useState<string[]>([])
  const [draftPublicRpcUrls, setDraftPublicRpcUrls] = useState(settings.publicRpcUrls.join('\n'))
  const [draftKoinscanUrl, setDraftKoinscanUrl] = useState(settings.koinscanUrl)
  const [publicRpcConfigLoaded, setPublicRpcConfigLoaded] = useState(() => !Boolean(getAppConfigBridge()?.loadPublicRpcUrls))
  const [appPreferencesLoaded, setAppPreferencesLoaded] = useState(() => !Boolean(getAppConfigBridge()?.loadPreferences))
  const [draftPollMs, setDraftPollMs] = useState(String(settings.pollMs))
  const [draftRowLimit, setDraftRowLimit] = useState(String(settings.rowLimit))
  const [draftDashboardProducerWindowBlocks, setDraftDashboardProducerWindowBlocks] = useState(
    String(settings.dashboardProducerWindowBlocks)
  )
  const [draftDashboardRefreshSeconds, setDraftDashboardRefreshSeconds] = useState(
    String(settings.dashboardRefreshSeconds)
  )
  const [draftNodeRepoPath, setDraftNodeRepoPath] = useState(nodeSettings.repoPath)
  const [draftNodeNetwork, setDraftNodeNetwork] = useState<KoinosNetworkId>(nodeSettings.network)
  const [draftNodeBaseDir, setDraftNodeBaseDir] = useState(nodeSettings.baseDir)
  const [draftNodeProfiles, setDraftNodeProfiles] = useState(nodeSettings.profiles)
  const [draftNodeBlockchainBackupUrl, setDraftNodeBlockchainBackupUrl] = useState(nodeSettings.blockchainBackupUrl)
  const [draftNodeBackup, setDraftNodeBackup] = useState(() => normalizeNodeBackupSettings(nodeSettings.backup))
  const [draftNodeBackupPassword, setDraftNodeBackupPassword] = useState('')
  const [nodeBaseDirPickerLoading, setNodeBaseDirPickerLoading] = useState(false)
  const [nodeBaseDirValidationLoading, setNodeBaseDirValidationLoading] = useState(false)
  const [nodeBaseDirValidation, setNodeBaseDirValidation] = useState<NodeBaseDirValidationState | null>(null)
  const [nodeStatus, setNodeStatus] = useState<TelenoNodeStatus | null>(null)
  const [nodeStatusLoading, setNodeStatusLoading] = useState(false)
  const [nodeActionLoading, setNodeActionLoading] = useState<NodeAction | null>(null)
  const [nodeRestoreBackupLoading, setNodeRestoreBackupLoading] = useState(false)
  const [nodeRestoreBackupVerifyLoading, setNodeRestoreBackupVerifyLoading] = useState(false)
  const [nodeCreateBackupLoading, setNodeCreateBackupLoading] = useState(false)
  const [nodeNativeBackupDryRunLoading, setNodeNativeBackupDryRunLoading] = useState(false)
  const [nodeNativeBackupLocalListLoading, setNodeNativeBackupLocalListLoading] = useState(false)
  const [nodeNativeBackupRemoteListLoading, setNodeNativeBackupRemoteListLoading] = useState(false)
  const [nodeNativeBackupPublicListLoading, setNodeNativeBackupPublicListLoading] = useState(false)
  const [nodeNativeBackupLocalList, setNodeNativeBackupLocalList] = useState<TelenoNodeNativeBackupListResult | null>(null)
  const [nodeNativeBackupRemoteList, setNodeNativeBackupRemoteList] = useState<TelenoNodeNativeBackupListResult | null>(null)
  const [nodeNativeBackupPublicList, setNodeNativeBackupPublicList] = useState<TelenoNodeNativeBackupListResult | null>(null)
  const [nodeNativeBackupPreflightLoading, setNodeNativeBackupPreflightLoading] = useState(false)
  const [nodeNativeBackupPreflight, setNodeNativeBackupPreflight] = useState<TelenoNodeNativeBackupPreflightResult | null>(null)
  const [selectedNativeBackupId, setSelectedNativeBackupId] = useState('latest')
  const [nodeRestoreNativeBackupLoading, setNodeRestoreNativeBackupLoading] = useState(false)
  const [nodeNativeBackupPurgeLoading, setNodeNativeBackupPurgeLoading] = useState<string | null>(null)
  const [simpleRemoteBackupSaving, setSimpleRemoteBackupSaving] = useState(false)
  const nodeNativeBackupListLoading = nodeNativeBackupLocalListLoading || nodeNativeBackupRemoteListLoading || nodeNativeBackupPublicListLoading
  const [nodeServiceActionLoading, setNodeServiceActionLoading] = useState<NodeServiceActionState | null>(null)
  const [nodeCloneLoading, setNodeCloneLoading] = useState(false)
  const [nodeProducerOverview, setNodeProducerOverview] = useState<TelenoNodeProducerOverviewResult | null>(null)
  const [nodeProducerLoading, setNodeProducerLoading] = useState(false)
  const [nodeProducerError, setNodeProducerError] = useState<string | null>(null)
  const [producerLocalInfo, setProducerLocalInfo] = useState<TelenoNodeProducerLocalInfoResult | null>(null)
  const [producerPreviewRegisteredPublicKey, setProducerPreviewRegisteredPublicKey] = useState<string | null>(null)
  const [producerRecentBlocks, setProducerRecentBlocks] = useState<BlockRow[]>([])
  const [producerRecentBlocksLoading, setProducerRecentBlocksLoading] = useState(false)
  const [producerRecentBlocksError, setProducerRecentBlocksError] = useState<string | null>(null)
  const [dashboardProducers, setDashboardProducers] = useState<TelenoNodeDashboardProducersResult | null>(null)
  const [dashboardProducersLoading, setDashboardProducersLoading] = useState(false)
  const [dashboardProducersError, setDashboardProducersError] = useState<string | null>(null)
  const [dashboardPeers, setDashboardPeers] = useState<TelenoNodeDashboardPeersResult | null>(null)
  const [dashboardPeersLoading, setDashboardPeersLoading] = useState(false)
  const [dashboardPeersError, setDashboardPeersError] = useState<string | null>(null)
  const [dashboardPerformance, setDashboardPerformance] = useState<TelenoNodeDashboardPerformanceResult | null>(null)
  const [dashboardPerformanceLoading, setDashboardPerformanceLoading] = useState(false)
  const [dashboardPerformanceError, setDashboardPerformanceError] = useState<string | null>(null)
  const [nodeProducerActionLoading, setNodeProducerActionLoading] = useState<NodeProducerActionState>(null)
  const [nodeProducerAddressDraft, setNodeProducerAddressDraft] = useState('')
  const [producerUnlockPassword, setProducerUnlockPassword] = useState('')
  const [nodePresets, setNodePresets] = useState<TelenoNodePreset[]>([])
  const [nodePresetsLoading, setNodePresetsLoading] = useState(false)
  const [nodePresetsError, setNodePresetsError] = useState<string | null>(null)
  const [nodePresetActionLoading] = useState<string | null>(null)
  const [nodeNativeBuilds, setNodeNativeBuilds] = useState<TelenoNodeNativeBuildsResult | null>(null)
  const [nodeNativeBuildsLoading, setNodeNativeBuildsLoading] = useState(false)
  const [nodeNativeBuildsError, setNodeNativeBuildsError] = useState<string | null>(null)
  const [nodeNativeBuildActionLoading, setNodeNativeBuildActionLoading] = useState<NodeNativeBuildActionState | null>(
    null
  )
  const [nodeOutput, setNodeOutput] = useState<string>('')
  const [nodeError, setNodeError] = useState<string | null>(null)
  const [nodeFileEditorOpen, setNodeFileEditorOpen] = useState(false)
  const [nodeFileEditorKind, setNodeFileEditorKind] = useState<'config'>('config')
  const [nodeFileEditorPath, setNodeFileEditorPath] = useState('')
  const [nodeFileEditorContent, setNodeFileEditorContent] = useState('')
  const [nodeFileEditorLoading, setNodeFileEditorLoading] = useState(false)
  const [nodeFileEditorSaving, setNodeFileEditorSaving] = useState(false)
  const [nodeFileEditorError, setNodeFileEditorError] = useState<string | null>(null)
  const [nodeFileEditorLastSavedAt, setNodeFileEditorLastSavedAt] = useState<number | null>(null)
  const [nodeBackupProgress, setNodeBackupProgress] = useState<NodeBackupProgressState | null>(null)
  const [nodeLogsService, setNodeLogsService] = useState<string>('')
  const [nodeLogsTail, setNodeLogsTail] = useState<string>('200')
  const [nodeLogsLevelFilter, setNodeLogsLevelFilter] = useState<LogLevelFilter>('all')
  const [nodeLogsComponentFilter, setNodeLogsComponentFilter] = useState<string>('all')
  const [nodeLogsOutput, setNodeLogsOutput] = useState<string>('')
  const [nodeLogsLoading, setNodeLogsLoading] = useState(false)
  const [nodeLogsError, setNodeLogsError] = useState<string | null>(null)
  const [nodeLogsModalOpen, setNodeLogsModalOpen] = useState(false)
  const [nodeLogsLastRefreshAt, setNodeLogsLastRefreshAt] = useState<number | null>(null)
  const [nodeLogsStreamId, setNodeLogsStreamId] = useState<string | null>(null)
  const [nodeServiceContextMenu, setNodeServiceContextMenu] = useState<NodeServiceContextMenuState | null>(null)
  const [nodeConflictDialog, setNodeConflictDialog] = useState<NodeConflictDialogState | null>(null)
  const [nodeConflictKillLoading, setNodeConflictKillLoading] = useState<string | null>(null)
  const [nodeBaseDirChangeDialog, setNodeBaseDirChangeDialog] = useState<NodeBaseDirChangeDialogState | null>(null)
  const [nodeBaseDirCopyLoading, setNodeBaseDirCopyLoading] = useState(false)
  const [nodeBaseDirRestartLoading, setNodeBaseDirRestartLoading] = useState(false)
  const [settingsUnsavedDialogOpen, setSettingsUnsavedDialogOpen] = useState(false)
  const [settingsUnsavedTargetTab, setSettingsUnsavedTargetTab] = useState<AppTab | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>('explorer')
  const [documentationPath, setDocumentationPath] = useState(DEFAULT_DOCUMENTATION_PATH)
  const [nodeSubtab, setNodeSubtab] = useState<NodeSubtab>('overview')
  const [dashboardSubtab, setDashboardSubtab] = useState<DashboardSubtab>('producers')
  const [nodeProfilesModalOpen, setNodeProfilesModalOpen] = useState(false)
  const [firstRunSetupOpen, setFirstRunSetupOpen] = useState(false)
  const [firstRunPublicBootstrapUsed, setFirstRunPublicBootstrapUsed] = useState(false)
  const [walletOverview, setWalletOverview] = useState<TelenoWalletOverviewResult | null>(null)
  const [producerSigningWalletBalance, setProducerSigningWalletBalance] = useState<TelenoWalletBalanceResult | null>(null)
  const [producerSigningWalletBalanceNetwork, setProducerSigningWalletBalanceNetwork] = useState<KoinosNetworkId | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [producerSigningWalletBalanceLoading, setProducerSigningWalletBalanceLoading] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [producerSigningWalletBalanceError, setProducerSigningWalletBalanceError] = useState<string | null>(null)
  const [walletActionLoading, setWalletActionLoading] = useState<string | null>(null)
  const [walletResultTitle, setWalletResultTitle] = useState('')
  const [walletResultData, setWalletResultData] = useState<unknown>(null)
  const [walletActivityEntries, setWalletActivityEntries] = useState<WalletActivityEntry[]>([])
  const [walletBalanceRefreshedAt, setWalletBalanceRefreshedAt] = useState<number | null>(null)
  const [walletBalanceCache, setWalletBalanceCache] = useState<Record<string, WalletBalanceCacheEntry>>({})
  const [walletImportPrivateKey, setWalletImportPrivateKey] = useState('')
  const [walletImportPassword, setWalletImportPassword] = useState('')
  const [walletImportSeedPhrase, setWalletImportSeedPhrase] = useState('')
  const [walletImportSeedPassword, setWalletImportSeedPassword] = useState('')
  const [walletTransferAddressDraft, setWalletTransferAddressDraft] = useState('')
  const [walletTransferAsset, setWalletTransferAsset] = useState<'koin' | 'vhp'>('koin')
  const [walletTransferAmountDraft, setWalletTransferAmountDraft] = useState('')
  const [walletTransferDryRun, setWalletTransferDryRun] = useState(true)
  const [walletTransferUseFreeMana, setWalletTransferUseFreeMana] = useState(false)
  const [walletBurnPercentDraft, setWalletBurnPercentDraft] = useState('95')
  const [walletBurnAmountDraft, setWalletBurnAmountDraft] = useState('')
  const [walletBurnTargetAddressDraft, setWalletBurnTargetAddressDraft] = useState('')
  const [walletBurnDryRun, setWalletBurnDryRun] = useState(true)
  const [walletBurnUseFreeMana, setWalletBurnUseFreeMana] = useState(false)
  const [producerProfile, setProducerProfile] = useState<TelenoNodeProducerProfileResult | null>(null)
  const [producerUseWalletAddress, setProducerUseWalletAddress] = useState(true)
  const [producerAllowDelegatedSigner, setProducerAllowDelegatedSigner] = useState(false)
  const [producerFooterState, setProducerFooterState] = useState<'unknown' | 'producing'>('unknown')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const rowsRef = useRef<BlockRow[]>([])
  const nodeOutputRef = useRef(nodeOutput)
  const nodeLogsStreamIdRef = useRef<string | null>(null)
  const nodeLogsPreRef = useRef<HTMLPreElement | null>(null)
  const nodeRepoBootstrapAttemptsRef = useRef<Set<string>>(new Set())
  const simpleBackupPerformanceRefreshKeyRef = useRef<string | null>(null)
  const nodeBackupOperationActiveRef = useRef(false)
  const locale = localeForLanguage(language)
  const t = useMemo(() => {
    return (key: string, values?: Record<string, string | number>) => translate(language, key, values)
  }, [language])
  const hasNodeControls = Boolean(getTelenoNodeBridge())
  const hasWalletControls = Boolean(getWalletBridge())
  const effectiveExplorerRpcUrl = useMemo(
    () => resolveExplorerRpcUrl(settings, nodeStatus),
    [settings, nodeStatus]
  )
  const primaryPublicRpcUrl = settings.publicRpcUrls[0] ?? DEFAULT_PUBLIC_RPC_URLS[0]
  const nodeNetworkPublicRpcUrl = primaryPublicRpcUrl
  const localNodeRpcUrl = useMemo(() => resolveLocalNodeRpcUrl(nodeStatus), [nodeStatus])
  const producerRpcUrl = useMemo(
    () => resolveProducerRpcUrl(nodeStatus, nodeNetworkPublicRpcUrl),
    [nodeStatus, nodeNetworkPublicRpcUrl]
  )
  // Wallet RPC: use local node only when synced (gap ≤ threshold), else fall back to public
  const walletRpcUrl = useMemo(() => {
    if (settings.rpcSource !== LOCAL_RPC_SOURCE) return settings.rpcSource
    const gap = (publicChainHead?.height ?? 0) - (localChainHead?.height ?? 0)
    const localSynced = localChainHead && publicChainHead && gap <= SYNC_GAP_BLOCK_THRESHOLD
    return localSynced ? localNodeRpcUrl : primaryPublicRpcUrl
  }, [settings.rpcSource, publicChainHead, localChainHead, localNodeRpcUrl, primaryPublicRpcUrl])
  const footerRpcUrl = activeTab === 'producer' ? producerRpcUrl : activeTab === 'wallet' ? walletRpcUrl : effectiveExplorerRpcUrl
  const walletAccounts = walletOverview?.accounts || []
  const activeWalletAccountId = `${walletOverview?.activeAccountId || ''}`.trim()
  const activeWalletAccount =
    walletAccounts.find((account) => account.id === activeWalletAccountId) || walletAccounts[0] || null
  const activeWalletAddress = activeWalletAccount?.address?.trim() || walletOverview?.walletAddress?.trim() || ''
  const activeWalletCanSign = Boolean(walletOverview?.unlocked && activeWalletAccount?.hasPrivateKey)
  const nativeTokenSymbol = nativeTokenSymbolForNetwork(nodeSettings.network)
  const firstRunPublicBootstrapUrl = useMemo(
    () => publicBootstrapUrlForNetwork('mainnet'),
    []
  )
  const activeWalletBalanceCacheEntry = useMemo(() => {
    const keys = walletBalanceCacheKeys(nodeSettings.network, activeWalletAddress, activeWalletAccountId)
    for (const key of keys) {
      const entry = walletBalanceCache[key]
      if (entry) return entry
    }
    return null
  }, [walletBalanceCache, nodeSettings.network, activeWalletAddress, activeWalletAccountId])
  const liveWalletBalanceMatchesActive = Boolean(
    producerSigningWalletBalanceNetwork === nodeSettings.network &&
    producerSigningWalletBalance?.address &&
      activeWalletAddress &&
      producerSigningWalletBalance.address.toLowerCase() === activeWalletAddress.toLowerCase()
  )
  const walletDisplayBalance = activeWalletBalanceCacheEntry?.balance || (liveWalletBalanceMatchesActive ? producerSigningWalletBalance : null)
  const walletDisplayBalanceRefreshedAt =
    activeWalletBalanceCacheEntry?.refreshedAt || (liveWalletBalanceMatchesActive ? walletBalanceRefreshedAt : null)
  const configFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, 'config/config.yml')
  const settingsDirty = useMemo(() => {
    const savedPublicRpcUrls = publicRpcUrlsForActiveNetwork(draftNodeNetwork, publicRpcUrlsByNetwork)
    let publicRpcUrlsChanged = false
    try {
      publicRpcUrlsChanged = !sameStringList(parsePublicRpcUrlsInput(draftPublicRpcUrls, language), savedPublicRpcUrls)
    } catch {
      publicRpcUrlsChanged = draftPublicRpcUrls.trim() !== savedPublicRpcUrls.join('\n').trim()
    }

    const effectivePollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
    const effectiveRowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)
    const effectiveDashboardProducerWindowBlocks = normalizeDashboardProducerWindowBlocks(draftDashboardProducerWindowBlocks)
    const effectiveDashboardRefreshSeconds = normalizeDashboardRefreshSeconds(draftDashboardRefreshSeconds)
    const effectiveKoinscanUrl = normalizeExternalHttpsUrl(draftKoinscanUrl, DEFAULT_SETTINGS.koinscanUrl)
    const effectiveRepoPath = draftNodeRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
    const effectiveBaseDir = normalizeNodeBaseDirInput(draftNodeBaseDir)
    const effectiveProfiles = expandNodeProfiles(parseProfilesCsv(draftNodeProfiles)).join(',')
    const rawBlockchainBackupUrl = draftNodeBlockchainBackupUrl.trim()
    const effectiveBlockchainBackupUrl = rawBlockchainBackupUrl
      ? rawBlockchainBackupUrl
      : draftNodeNetwork === 'mainnet'
        ? DEFAULT_NODE_SETTINGS.blockchainBackupUrl
        : ''
    const effectiveBackup = normalizeNodeBackupSettings(draftNodeBackup)

    return (
      language !== savedLanguage ||
      appPreferences.keepRunningInMenuBar !== savedAppPreferences.keepRunningInMenuBar ||
      Boolean(draftNodeBackupPassword) ||
      settings.nodeAdvancedMode !== savedSettings.nodeAdvancedMode ||
      settings.producerAdvancedMode !== savedSettings.producerAdvancedMode ||
      publicRpcUrlsChanged ||
      effectiveKoinscanUrl !== settings.koinscanUrl ||
      effectivePollMs !== settings.pollMs ||
      effectiveRowLimit !== settings.rowLimit ||
      effectiveDashboardProducerWindowBlocks !== settings.dashboardProducerWindowBlocks ||
      effectiveDashboardRefreshSeconds !== settings.dashboardRefreshSeconds ||
      draftNodeNetwork !== nodeSettings.network ||
      effectiveRepoPath !== nodeSettings.repoPath ||
      effectiveBaseDir !== nodeSettings.baseDir ||
      effectiveProfiles !== nodeSettings.profiles ||
      effectiveBlockchainBackupUrl !== nodeSettings.blockchainBackupUrl ||
      !sameNodeBackupSettings(effectiveBackup, nodeSettings.backup)
    )
  }, [
    draftDashboardProducerWindowBlocks,
    draftDashboardRefreshSeconds,
    draftNodeBaseDir,
    draftNodeBlockchainBackupUrl,
    draftNodeBackup,
    draftNodeBackupPassword,
    draftNodeNetwork,
    draftNodeProfiles,
    draftNodeRepoPath,
    draftKoinscanUrl,
    draftPollMs,
    draftPublicRpcUrls,
    draftRowLimit,
    appPreferences.keepRunningInMenuBar,
    language,
    nodeSettings,
    publicRpcUrlsByNetwork,
    savedLanguage,
    savedAppPreferences.keepRunningInMenuBar,
    savedSettings.nodeAdvancedMode,
    savedSettings.producerAdvancedMode,
    settings.dashboardProducerWindowBlocks,
    settings.dashboardRefreshSeconds,
    settings.koinscanUrl,
    settings.nodeAdvancedMode,
    settings.pollMs,
    settings.producerAdvancedMode,
    settings.rowLimit
  ])

  useEffect(() => {
    let disposed = false

    const loadFirstRunSetupState = async () => {
      try {
        const state = await window.teleno?.app?.firstRunSetupState?.()
        if (!disposed && state?.ok) {
          let completed = state.completed === true
          const canMigrateRendererState =
            Boolean(state.install?.packaged) &&
            !completed &&
            (state.source === 'missing' || state.source === 'unreadable') &&
            rendererHasExistingSetupStorage()

          if (canMigrateRendererState && window.teleno?.app?.completeFirstRunSetup) {
            const migrated = await window.teleno.app.completeFirstRunSetup({
              appVersion: pkg.version,
              network: nodeSettings.network,
              baseDir: nodeSettings.baseDir,
              observerProfile: nodeSettings.profiles || defaultNodeProfilesForNetwork(nodeSettings.network),
              completedFrom: 'existing-renderer-storage-migration'
            })
            completed = migrated?.completed === true
          }

          if (!disposed) {
            setFirstRunSetupOpen(Boolean(state.install?.packaged) && !completed)
          }
          return
        }
      } catch {
        // Fall through to the closed default below.
      }

      if (disposed) return
      setFirstRunSetupOpen(false)
    }

    void loadFirstRunSetupState()

    return () => {
      disposed = true
    }
  }, [nodeSettings.baseDir, nodeSettings.network, nodeSettings.profiles])

  useEffect(() => {
    setDraftPublicRpcUrls(settings.publicRpcUrls.join('\n'))
    setDraftKoinscanUrl(settings.koinscanUrl)
    setDraftPollMs(String(settings.pollMs))
    setDraftRowLimit(String(settings.rowLimit))
    setDraftDashboardProducerWindowBlocks(String(settings.dashboardProducerWindowBlocks))
    setDraftDashboardRefreshSeconds(String(settings.dashboardRefreshSeconds))
  }, [
    settings.publicRpcUrls,
    settings.koinscanUrl,
    settings.pollMs,
    settings.rowLimit,
    settings.dashboardProducerWindowBlocks,
    settings.dashboardRefreshSeconds
  ])

  useEffect(() => {
    const bridge = getAppConfigBridge()
    if (!bridge?.loadPublicRpcUrls) {
      setPublicRpcConfigLoaded(true)
      return
    }

    let disposed = false
    void bridge.loadPublicRpcUrls()
      .then((result) => {
        if (disposed || !result.ok || result.publicRpcUrls.length === 0) return
        const nextPublicRpcUrlsByNetwork = mergePublicRpcUrlsByNetwork(result.publicRpcUrlsByNetwork)
        if (result.network && result.publicRpcUrls.length > 0) {
          nextPublicRpcUrlsByNetwork[result.network] = result.publicRpcUrls
        }
        const activePublicRpcUrls = publicRpcUrlsForActiveNetwork(nodeSettings.network, nextPublicRpcUrlsByNetwork)
        setPublicRpcUrlsByNetwork(nextPublicRpcUrlsByNetwork)
        setSettings((current) => ({
          ...current,
          publicRpcUrls: activePublicRpcUrls,
          rpcSource: normalizeExplorerRpcSource(current.rpcSource, activePublicRpcUrls, current.rpcSource)
        }))
        setSavedSettings((current) => ({
          ...current,
          publicRpcUrls: activePublicRpcUrls,
          rpcSource: normalizeExplorerRpcSource(current.rpcSource, activePublicRpcUrls, current.rpcSource)
        }))
      })
      .finally(() => {
        if (!disposed) setPublicRpcConfigLoaded(true)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const bridge = getAppConfigBridge()
    if (!bridge?.loadPreferences) {
      setAppPreferencesLoaded(true)
      return
    }

    let disposed = false
    void bridge.loadPreferences()
      .then((result) => {
        if (disposed || !result.ok) return
        const nextPreferences = {
          keepRunningInMenuBar: result.preferences.keepRunningInMenuBar === true
        }
        setAppPreferences(nextPreferences)
        setSavedAppPreferences(nextPreferences)
      })
      .finally(() => {
        if (!disposed) setAppPreferencesLoaded(true)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const activePublicRpcUrls = publicRpcUrlsForActiveNetwork(nodeSettings.network, publicRpcUrlsByNetwork)
    setSettings((current) => {
      const rpcSource = normalizeExplorerRpcSource(current.rpcSource, activePublicRpcUrls, current.rpcSource)
      if (current.rpcSource === rpcSource && sameStringList(current.publicRpcUrls, activePublicRpcUrls)) {
        return current
      }
      return {
        ...current,
        publicRpcUrls: activePublicRpcUrls,
        rpcSource
      }
    })
  }, [nodeSettings.network, publicRpcUrlsByNetwork])

  useEffect(() => {
    setDraftNodeRepoPath(nodeSettings.repoPath)
    setDraftNodeNetwork(nodeSettings.network)
    setDraftNodeBaseDir(nodeSettings.baseDir)
    setDraftNodeProfiles(nodeSettings.profiles)
    setDraftNodeBlockchainBackupUrl(nodeSettings.blockchainBackupUrl)
    setDraftNodeBackup(normalizeNodeBackupSettings(nodeSettings.backup))
    setDraftNodeBackupPassword('')
    nativeBackupUserEditedRef.current = false
    setNodeBaseDirValidation((current) => current?.baseDir === nodeSettings.baseDir ? current : null)
  }, [nodeSettings])

  useEffect(() => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBackupConfig) return
    if (nativeBackupUserEditedRef.current) return
    const baseDir = normalizeNodeBaseDirInput(nodeSettings.baseDir)
    const loadKey = `${nodeSettings.network}|${baseDir}`
    if (nativeBackupConfigLoadKeyRef.current === loadKey) return
    nativeBackupConfigLoadKeyRef.current = loadKey

    let cancelled = false
    void bridge.nativeBackupConfig(toNodeApiSettings(nodeSettings))
      .then((result: TelenoNodeNativeBackupConfigResult) => {
        if (cancelled || !result?.ok || !result.backup) return
        if (nativeBackupUserEditedRef.current) return
        const backup = normalizeNodeBackupSettings(result.backup)
        setFormError(null)
        setNodeSettings((current) => {
          const currentKey = `${current.network}|${normalizeNodeBaseDirInput(current.baseDir)}`
          if (currentKey !== loadKey || sameNodeBackupSettings(backup, current.backup)) return current
          return { ...current, backup }
        })
      })
      .catch(() => {
        // Missing or unreadable native backup config is not fatal; defaults/localStorage remain active.
      })

    return () => {
      cancelled = true
    }
  }, [nodeSettings.network, nodeSettings.baseDir])

  useEffect(() => {
    if (!formError) return
    const backup = normalizeNodeBackupSettings(draftNodeBackup)
    const shouldClear =
      (formError === t('settings.backupRemoteHostRequired') && (!backup.remoteEnabled || Boolean(backup.sshHost.trim()))) ||
      (formError === t('settings.backupRemoteUserRequired') && (!backup.remoteEnabled || Boolean(backup.sshUser.trim()))) ||
      (formError === t('settings.backupRemoteDirectoryRequired') && (!backup.remoteEnabled || backup.remoteDirectory.trim().startsWith('/'))) ||
      (formError === t('settings.backupPrivateKeyRequired') && (!backup.remoteEnabled || backup.sshAuth !== 'private-key' || Boolean(backup.sshPrivateKeyFile.trim()))) ||
      (formError === t('settings.backupPasswordFileRequired') && (
        !backup.remoteEnabled ||
        backup.sshAuth !== 'password-file' ||
        Boolean(backup.sshPasswordFile.trim()) ||
        Boolean(draftNodeBackupPassword)
      )) ||
      (formError === t('settings.backupScheduleIntervalInvalid') && (!backup.scheduleEnabled || /^\d+(ms|s|m|h|d)?$/.test(backup.scheduleInterval.trim())))

    if (shouldClear) setFormError(null)
  }, [draftNodeBackup, draftNodeBackupPassword, formError, t])

  useEffect(() => {
    setNodeNativeBackupPreflight(null)
  }, [selectedNativeBackupId])

  useEffect(() => {
    if (!settings.producerAdvancedMode) return
    if (nodeProducerAddressDraft.trim()) return
    const nextAddress = nodeProducerOverview?.producerAddress?.trim() || ''
    if (nextAddress) {
      setNodeProducerAddressDraft(nextAddress)
    }
  }, [settings.producerAdvancedMode, nodeProducerOverview, nodeProducerAddressDraft])

  useEffect(() => {
    const profileAddress = producerProfile?.profile?.producerAddress?.trim() || ''
    const walletAddress = activeWalletAddress
    if (!profileAddress || !walletAddress) return
    setProducerUseWalletAddress(profileAddress.toLowerCase() === walletAddress.toLowerCase())
  }, [producerProfile?.profile?.producerAddress, activeWalletAddress])

  useEffect(() => {
    if (producerUseWalletAddress && producerAllowDelegatedSigner) {
      setProducerAllowDelegatedSigner(false)
    }
  }, [producerUseWalletAddress, producerAllowDelegatedSigner])

  useEffect(() => {
    const defaultBurnTarget = walletDefaultReceiverAddress(activeWalletAddress)
    const defaultTransferTarget = walletDefaultReceiverAddress(activeWalletAddress)

    if (!walletBurnTargetAddressDraft.trim() && defaultBurnTarget) {
      setWalletBurnTargetAddressDraft(defaultBurnTarget)
    }
    if (!walletTransferAddressDraft.trim() && defaultTransferTarget) {
      setWalletTransferAddressDraft(defaultTransferTarget)
    }
  }, [
    activeWalletAddress,
    walletBurnTargetAddressDraft,
    walletTransferAddressDraft
  ])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const bridge = getAppConfigBridge()
    if (!publicRpcConfigLoaded || !bridge?.savePublicRpcUrls) return
    void bridge.savePublicRpcUrls({
      network: nodeSettings.network,
      publicRpcUrls: settings.publicRpcUrls,
      publicRpcUrlsByNetwork
    })
  }, [nodeSettings.network, publicRpcConfigLoaded, publicRpcUrlsByNetwork, settings.publicRpcUrls])

  useEffect(() => {
    window.localStorage.setItem(NODE_SETTINGS_STORAGE_KEY, JSON.stringify(nodeSettings))
    storeNodeBaseDirForNetwork(nodeSettings.network, nodeSettings.baseDir)
  }, [nodeSettings])

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!freshBlockIds.length) return
    const timer = window.setTimeout(() => setFreshBlockIds([]), 1400)
    return () => window.clearTimeout(timer)
  }, [freshBlockIds])

  useEffect(() => {
    const services = nodeStatus?.services.map((svc) => svc.id) ?? []
    if (nodeLogsService && !services.includes(nodeLogsService)) {
      setNodeLogsService(services.includes('jsonrpc') ? 'jsonrpc' : '')
      setNodeLogsModalOpen(false)
    }
  }, [nodeStatus, nodeLogsService])

  useEffect(() => {
    setProducerSigningWalletBalance(null)
    setProducerSigningWalletBalanceNetwork(null)
    setProducerSigningWalletBalanceError(null)
    setWalletBalanceRefreshedAt(null)

    if (firstRunSetupOpen || activeTab === 'wallet' || activeTab === 'producer' || (activeTab === 'dashboard' && dashboardSubtab === 'forecast')) {
      void refreshWalletOverview()
      if (activeWalletAddress) {
        void refreshProducerSigningWalletBalance(activeWalletAddress, activeWalletAccountId || undefined, {
          silent: activeTab === 'wallet'
        })
      }
    }
  }, [nodeSettings.network, firstRunSetupOpen])

  useEffect(() => {
    if (!firstRunSetupOpen && activeTab !== 'producer' && activeTab !== 'wallet' && !(activeTab === 'dashboard' && dashboardSubtab === 'forecast')) return
    if (!getWalletBridge()) return
    void refreshWalletOverview()
  }, [activeTab, dashboardSubtab, effectiveExplorerRpcUrl, firstRunSetupOpen, nodeSettings.network, walletRpcUrl])

  useEffect(() => {
    if (activeTab !== 'producer' && activeTab !== 'wallet' && !(activeTab === 'dashboard' && dashboardSubtab === 'forecast')) return
    if (!getTelenoNodeBridge()) return
    void refreshProducerProfile()
  }, [activeTab, dashboardSubtab])

  useEffect(() => {
    const producerProfileReady = isProducerSetupComplete(producerProfile)
    const shouldRefreshBalance =
      activeTab === 'wallet' ||
      (activeTab === 'producer' && producerProfileReady) ||
      (activeTab === 'dashboard' && dashboardSubtab === 'forecast')

    if (!shouldRefreshBalance) {
      if (activeTab === 'producer') {
        setProducerSigningWalletBalance(null)
        setProducerSigningWalletBalanceNetwork(null)
        setProducerSigningWalletBalanceError(null)
        setProducerSigningWalletBalanceLoading(false)
      }
      return
    }

    if (!activeWalletAddress) {
      if (activeTab !== 'wallet') {
        setProducerSigningWalletBalance(null)
        setProducerSigningWalletBalanceNetwork(null)
        setProducerSigningWalletBalanceError(null)
        setProducerSigningWalletBalanceLoading(false)
      }
      return
    }
    void refreshProducerSigningWalletBalance(activeWalletAddress, activeWalletAccountId || undefined, {
      silent: activeTab === 'wallet'
    })
  }, [activeTab, dashboardSubtab, producerProfile, producerRpcUrl, nodeSettings.network, activeWalletAddress, activeWalletAccountId])

  useEffect(() => {
    if (activeTab !== 'wallet') return
    if (!walletOverview?.unlocked || !activeWalletAddress) return

    let disposed = false
    let inFlight = false

    const tick = async () => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        await refreshProducerSigningWalletBalance(activeWalletAddress, activeWalletAccountId || undefined, {
          silent: true
        })
      } finally {
        inFlight = false
      }
    }

    const timer = window.setInterval(() => {
      void tick()
    }, settings.dashboardRefreshSeconds * 1000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [
    activeTab,
    settings.dashboardRefreshSeconds,
    producerRpcUrl,
    nodeSettings.network,
    activeWalletAddress,
    activeWalletAccountId,
    walletOverview?.unlocked
  ])

  useEffect(() => {
    if (activeTab !== 'dashboard') return
    if (!hasNodeControls) return

    let disposed = false
    let inFlight = false

    const tick = async () => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        await refreshDashboardCurrentSubtab()
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, settings.dashboardRefreshSeconds * 1000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [
    activeTab,
    dashboardSubtab,
    hasNodeControls,
    nodeSettings,
    producerRpcUrl,
    settings.dashboardProducerWindowBlocks,
    settings.dashboardRefreshSeconds,
    activeWalletAddress,
    producerUseWalletAddress,
    nodeProducerAddressDraft
  ])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (nodeServiceContextMenu) {
        setNodeServiceContextMenu(null)
        return
      }
      if (nodeFileEditorOpen) {
        setNodeFileEditorOpen(false)
        return
      }
      if (nodeLogsModalOpen) {
        setNodeLogsModalOpen(false)
        return
      }
      if (nodeProfilesModalOpen) {
        setNodeProfilesModalOpen(false)
        return
      }
      if (nodeConflictDialog) {
        setNodeConflictDialog(null)
        return
      }
      if (nodeBaseDirChangeDialog) {
        setNodeBaseDirChangeDialog(null)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [nodeServiceContextMenu, nodeFileEditorOpen, nodeLogsModalOpen, nodeProfilesModalOpen, nodeConflictDialog, nodeBaseDirChangeDialog])

  useEffect(() => {
    nodeLogsStreamIdRef.current = nodeLogsStreamId
  }, [nodeLogsStreamId])

  useEffect(() => {
    nodeOutputRef.current = nodeOutput
  }, [nodeOutput])

  useEffect(() => {
    if (!nodeLogsModalOpen) return
    const pre = nodeLogsPreRef.current
    if (!pre) return
    const frame = window.requestAnimationFrame(() => {
      pre.scrollTop = pre.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nodeLogsModalOpen, nodeLogsOutput, nodeLogsLevelFilter, nodeLogsComponentFilter])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getTelenoNodeBridge()
    if (!bridge?.onLogsFollowEvent) return

    const unsubscribe = bridge.onLogsFollowEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as TelenoNodeLogsFollowEvent
      if (!payload.streamId || payload.streamId !== nodeLogsStreamIdRef.current) return

      if (payload.type === 'start') {
        setNodeLogsLoading(false)
        setNodeLogsError(null)
        setNodeLogsLastRefreshAt(Date.now())
        return
      }

      if (payload.type === 'chunk') {
        const chunk = payload.chunk ?? ''
        if (chunk) {
          setNodeLogsOutput((current) => current + chunk)
        }
        setNodeLogsLoading(false)
        setNodeLogsLastRefreshAt(Date.now())
        return
      }

      if (payload.type === 'error') {
        setNodeLogsLoading(false)
        setNodeLogsError(payload.message || t('node.logsStreamError'))
        setNodeLogsStreamId(null)
        return
      }

      if (payload.type === 'end') {
        setNodeLogsLoading(false)
        setNodeLogsStreamId(null)
        if (typeof payload.code === 'number' && payload.code !== 0) {
          setNodeLogsError(t('node.logsStreamEnded', { code: payload.code }))
        }
      }
    })

    return unsubscribe
  }, [hasNodeControls, t])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getTelenoNodeBridge()
    if (!bridge?.onBackupProgressEvent) return

    const unsubscribe = bridge.onBackupProgressEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as TelenoNodeBackupProgressEvent
      if (!payload.action || typeof payload.progress !== 'number') return

      const now = Date.now()
      const totalBytes = numericOrNull(payload.totalBytes)
      const completedBytes = numericOrNull(payload.completedBytes)
      const previousSample = backupProgressSampleRef.current
      const sameSampleSeries = Boolean(
        previousSample &&
        previousSample.action === payload.action &&
        previousSample.phase === payload.phase &&
        completedBytes !== null &&
        previousSample.completedBytes !== null
      )
      const sampleIntervalMs = sameSampleSeries ? Math.max(1, now - previousSample!.sampledAt) : null
      const measuredBytesPerSecond = sameSampleSeries && completedBytes! >= previousSample!.completedBytes!
        ? ((completedBytes! - previousSample!.completedBytes!) / sampleIntervalMs!) * 1000
        : null
      const payloadBytesPerSecond = numericOrNull(payload.bytesPerSecond)
      const previousBytesPerSecond = sameSampleSeries ? previousSample?.bytesPerSecond ?? null : null
      const bytesPerSecond = payloadBytesPerSecond !== null
        ? payloadBytesPerSecond
        : measuredBytesPerSecond !== null
          ? previousBytesPerSecond !== null && previousBytesPerSecond > 0
            ? (previousBytesPerSecond * 0.65) + (measuredBytesPerSecond * 0.35)
            : measuredBytesPerSecond > 0
              ? measuredBytesPerSecond
              : null
          : null
      const etaSeconds = numericOrNull(payload.etaSeconds) ??
        (totalBytes !== null && completedBytes !== null && bytesPerSecond !== null && bytesPerSecond > 0
          ? Math.max(0, (totalBytes - completedBytes) / bytesPerSecond)
          : null)

      setNodeBackupProgress((current) => {
        const rawProgress = clampBackupProgress(payload.progress)
        const previousDisplay = current?.action === payload.action &&
          (!TERMINAL_BACKUP_PHASES.has(payload.phase) || payload.phase === 'cancelled')
          ? current.displayProgress
          : rawProgress
        return createBackupProgressState(
          payload.action,
          payload.phase,
          rawProgress,
          payload.message || '',
          now,
          {
            displayProgress: Math.max(rawProgress, previousDisplay),
            completedBytes,
            totalBytes,
            bytesPerSecond,
            etaSeconds,
            completedBatches: numericOrNull(payload.completedBatches),
            totalBatches: numericOrNull(payload.totalBatches),
            phaseProgress: numericOrNull(payload.phaseProgress),
            progressRangeStart: numericOrNull(payload.progressRangeStart),
            progressRangeEnd: numericOrNull(payload.progressRangeEnd),
            sampleIntervalMs
          }
        )
      })

      backupProgressSampleRef.current = {
        action: payload.action,
        phase: payload.phase,
        completedBytes,
        bytesPerSecond,
        sampledAt: now
      }

      if (payload.phase === 'error') {
        backupProgressSampleRef.current = null
      }

      if (payload.phase === 'complete') {
        window.setTimeout(() => {
          setNodeBackupProgress((current) =>
            current?.action === payload.action && current.phase === payload.phase ? null : current
          )
          backupProgressSampleRef.current = null
        }, 2500)
      }
    })

    return unsubscribe
  }, [hasNodeControls])

  useEffect(() => {
    if (!nodeBackupProgress || TERMINAL_BACKUP_PHASES.has(nodeBackupProgress.phase)) return
    if (
      nodeBackupProgress.completedBytes === null ||
      nodeBackupProgress.totalBytes === null ||
      nodeBackupProgress.bytesPerSecond === null ||
      nodeBackupProgress.bytesPerSecond <= 0 ||
      nodeBackupProgress.progressRangeStart === null ||
      nodeBackupProgress.progressRangeEnd === null ||
      nodeBackupProgress.progressRangeEnd <= nodeBackupProgress.progressRangeStart
    ) return

    const timer = window.setInterval(() => {
      setNodeBackupProgress((current) => {
        if (!current || TERMINAL_BACKUP_PHASES.has(current.phase)) return current
        if (
          current.completedBytes === null ||
          current.totalBytes === null ||
          current.bytesPerSecond === null ||
          current.bytesPerSecond <= 0 ||
          current.progressRangeStart === null ||
          current.progressRangeEnd === null ||
          current.progressRangeEnd <= current.progressRangeStart
        ) return current

        const elapsedSeconds = Math.max(0, (Date.now() - current.updatedAt) / 1000)
        const sampleIntervalSeconds = Math.max(1, (current.sampleIntervalMs ?? 1000) / 1000)
        const predictedLeadSeconds = Math.min(elapsedSeconds, sampleIntervalSeconds * 2)
        const predictedCompletedBytes = Math.min(
          current.totalBytes,
          current.completedBytes + (current.bytesPerSecond * predictedLeadSeconds)
        )
        const predictedFraction = current.totalBytes > 0
          ? Math.max(0, Math.min(1, predictedCompletedBytes / current.totalBytes))
          : 0
        const phaseTarget = current.progressRangeStart +
          ((current.progressRangeEnd - current.progressRangeStart) * predictedFraction)
        const phaseCap = Math.max(current.progressRangeStart, current.progressRangeEnd - 0.5)
        const nextDisplayProgress = Math.min(
          phaseCap,
          Math.max(current.displayProgress, current.progress, phaseTarget)
        )
        const nextEtaSeconds = current.bytesPerSecond > 0
          ? Math.max(0, (current.totalBytes - predictedCompletedBytes) / current.bytesPerSecond)
          : current.etaSeconds

        if (
          Math.abs(nextDisplayProgress - current.displayProgress) < 0.05 &&
          Math.abs((nextEtaSeconds ?? 0) - (current.etaSeconds ?? 0)) < 0.5
        ) return current

        return {
          ...current,
          displayProgress: nextDisplayProgress,
          etaSeconds: nextEtaSeconds
        }
      })
    }, 500)

    return () => window.clearInterval(timer)
  }, [
    nodeBackupProgress?.action,
    nodeBackupProgress?.phase,
    nodeBackupProgress?.updatedAt,
    nodeBackupProgress?.completedBytes,
    nodeBackupProgress?.totalBytes,
    nodeBackupProgress?.bytesPerSecond,
    nodeBackupProgress?.progressRangeStart,
    nodeBackupProgress?.progressRangeEnd
  ])

  useEffect(() => {
    if (!hasNodeControls) return

    let disposed = false

    const loadNodePresets = async () => {
      const bridge = getTelenoNodeBridge()
      if (!bridge?.presets) return
      setNodePresetsLoading(true)
      setNodePresetsError(null)
      try {
        const result = await bridge.presets(toNodeApiSettings(nodeSettings))
        if (disposed) return
        setNodePresets(result.presets ?? [])
        if (!result.ok) setNodePresetsError(result.output || t('node.unableReadProfiles'))
      } catch (error) {
        if (disposed) return
        setNodePresetsError(error instanceof Error ? error.message : t('node.unableReadProfiles'))
      } finally {
        if (!disposed) setNodePresetsLoading(false)
      }
    }

    const loadInitialNodeStatus = async () => {
      const bridge = getTelenoNodeBridge()
      if (!bridge) return
      setNodeStatusLoading(true)
      try {
        const status = await bridge.status(toNodeApiSettings(nodeSettings))
        if (disposed) return
        syncNodeStatusState(status)

        if (!status.ok && /repo path not found/i.test(status.output || '')) {
          const repoKey = nodeSettings.repoPath.trim()
          if (repoKey && !nodeRepoBootstrapAttemptsRef.current.has(repoKey)) {
            nodeRepoBootstrapAttemptsRef.current.add(repoKey)
            void cloneKoinosRepo(repoKey)
          }
        }
      } catch (error) {
        if (disposed) return
        setNodeError(error instanceof Error ? error.message : t('node.unableQueryNode'))
      } finally {
        if (!disposed) setNodeStatusLoading(false)
      }
    }

    void loadNodePresets()
    void loadInitialNodeStatus()

    return () => {
      disposed = true
    }
  }, [hasNodeControls, nodeSettings, t])

  useEffect(() => {
    if (!hasNodeControls) return

    let disposed = false

    const loadNativeBuilds = async () => {
      const bridge = getTelenoNodeBridge()
      if (!bridge?.nativeBuilds) return
      setNodeNativeBuildsLoading(true)
      setNodeNativeBuildsError(null)

      try {
        const builds = await bridge.nativeBuilds()
        if (disposed) return
        setNodeNativeBuilds(builds)
        if (!builds.ok) {
          setNodeNativeBuildsError(builds.output || t('node.unableInspectNativeWorkspace'))
        }
      } catch (error) {
        if (disposed) return
        setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.unableInspectNativeWorkspace'))
      } finally {
        if (!disposed) setNodeNativeBuildsLoading(false)
      }
    }

    void loadNativeBuilds()

    return () => {
      disposed = true
    }
  }, [hasNodeControls, t])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getTelenoNodeBridge()
    if (!bridge) return

    let disposed = false
    const timer = window.setInterval(async () => {
      if (
        disposed ||
        nodeActionLoading ||
        nodeRestoreBackupLoading ||
        nodeRestoreNativeBackupLoading ||
        nodeNativeBackupListLoading ||
        nodeNativeBackupPreflightLoading ||
        nodeServiceActionLoading ||
        nodePresetActionLoading ||
        nodeNativeBuildActionLoading
      )
        return
      try {
        const status = await bridge.status(toNodeApiSettings(nodeSettings))
        if (disposed) return
        syncNodeStatusState(status, { preserveOutputOnSuccess: true })
      } catch {
        // keep last known status; manual refresh/start/stop will surface error
      }
    }, 6000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [
    hasNodeControls,
    nodeSettings,
    nodeActionLoading,
    nodeRestoreBackupLoading,
    nodeRestoreNativeBackupLoading,
    nodeNativeBackupListLoading,
    nodeNativeBackupPreflightLoading,
    nodeServiceActionLoading,
    nodePresetActionLoading,
    nodeNativeBuildActionLoading
  ])

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pollTimer: number | null = null
    let controller: AbortController | null = null
    let revealTimers: number[] = []

    const clearRevealTimers = () => {
      revealTimers.forEach((id) => window.clearTimeout(id))
      revealTimers = []
    }

    const tick = async (initial: boolean) => {
      if (disposed || inFlight) return
      if (!initial && selectedBlockRef.current) return // Pause polling while block detail is open
      inFlight = true
      controller = new AbortController()

      if (initial) setIsInitialLoading(true)
      else setIsRefreshing(true)

      try {
        const snapshot = await fetchLatestBlocks(language, effectiveExplorerRpcUrl, settings.rowLimit, controller.signal)
        if (disposed) return

        const previousIds = new Set(rowsRef.current.map((row) => row.blockId))
        const hadPreviousRows = previousIds.size > 0
        const incomingFresh = snapshot.rows
          .filter((row) => !previousIds.has(row.blockId))
          .map((row) => row.blockId)

        clearRevealTimers()
        rowsRef.current = snapshot.rows
        setHead(snapshot.head)
        setLastSuccessAt(Date.now())
        setErrorMessage(null)

        if (!hadPreviousRows || incomingFresh.length <= 1) {
          setRows(snapshot.rows)
          setFreshBlockIds(hadPreviousRows ? incomingFresh.slice(0, 3) : [])
        } else {
          // Several blocks arrived in one poll: reveal them one at a time
          // (oldest first) so the list ticks like a live feed instead of
          // jumping by two or three rows at once.
          const revealOrder = [...incomingFresh].reverse()
          const stepMs = Math.max(
            250,
            Math.min(650, Math.floor((settings.pollMs || 3000) / (revealOrder.length + 1)))
          )
          const hidden = new Set(incomingFresh)
          const revealNext = (index: number) => {
            if (disposed) return
            hidden.delete(revealOrder[index])
            setRows(rowsRef.current.filter((row) => !hidden.has(row.blockId)))
            setFreshBlockIds([revealOrder[index]])
          }
          revealNext(0)
          for (let i = 1; i < revealOrder.length; i++) {
            revealTimers.push(window.setTimeout(() => revealNext(i), stepMs * i))
          }
        }
      } catch (error) {
        if (disposed) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setErrorMessage(error instanceof Error ? error.message : t('status.connectionError'))
      } finally {
        if (!disposed) {
          setIsInitialLoading(false)
          setIsRefreshing(false)
        }
        inFlight = false
      }
    }

    void tick(true)
    pollTimer = window.setInterval(() => {
      void tick(false)
    }, settings.pollMs)

    return () => {
      disposed = true
      clearRevealTimers()
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [settings, effectiveExplorerRpcUrl, language, t])

  const statusText = useMemo(() => {
    if (errorMessage) return t('status.rpcError', { message: errorMessage })
    if (isInitialLoading) {
      return t('status.connectingTo', { target: formatExplorerRpcSourceTarget(settings.rpcSource, language) })
    }
    if (isRefreshing) return t('status.updatingBlocks')
    return t('status.liveBlocksVisible', { count: rows.length })
  }, [errorMessage, isInitialLoading, isRefreshing, language, rows.length, settings.rpcSource, t])

  const lastUpdateText = lastSuccessAt ? formatTime(lastSuccessAt, locale, t('common.na')) : t('common.na')
  const headBlockTimeText = head ? formatDateTime(head.timestampMs, locale, t('common.na')) : t('common.na')
  const nodeBusy =
    nodeActionLoading !== null ||
    nodeRestoreBackupLoading ||
    nodeRestoreBackupVerifyLoading ||
    nodeCreateBackupLoading ||
    nodeNativeBackupDryRunLoading ||
    nodeNativeBackupListLoading ||
    nodeNativeBackupPreflightLoading ||
    nodeRestoreNativeBackupLoading ||
    nodeCloneLoading ||
    nodeBaseDirPickerLoading ||
    nodeBaseDirCopyLoading ||
    nodeBaseDirRestartLoading ||
    nodeServiceActionLoading !== null ||
    nodeConflictKillLoading !== null ||
    nodePresetActionLoading !== null ||
    nodeNativeBuildActionLoading !== null
  const nodeCurrentProfiles = parseProfilesCsv(nodeSettings.profiles)
  const selectedNodePreset =
    nodePresets.find((preset) => sameProfiles(preset.profiles, nodeCurrentProfiles)) ?? null
  const nodeNativeBuildServices = nodeNativeBuilds?.services ?? []
  const nodeNativeSupportedCount = nodeNativeBuildServices.filter((service) => service.supported).length
  const nodeNativeBuiltCount = nodeNativeBuildServices.filter(
    (service) => service.supported && service.artifactExists
  ).length
  const nodeNativeBlockedCount = nodeNativeBuildServices.filter(
    (service) => service.supported && !service.artifactExists && !service.buildable
  ).length
  const nodeNativePendingCount = nodeNativeBuildServices.filter(
    (service) => service.supported && !service.artifactExists && service.buildable
  ).length
  const nodeNativeBuildSummaryText = nodeNativeBuilds
    ? t('node.nativeBuild.summary', {
        built: nodeNativeBuiltCount,
        supported: nodeNativeSupportedCount,
        blocked:
          nodeNativeBlockedCount > 0 ? t('node.nativeBuild.blockedSuffix', { count: nodeNativeBlockedCount }) : '',
        pending:
          nodeNativePendingCount > 0 ? t('node.nativeBuild.pendingSuffix', { count: nodeNativePendingCount }) : ''
      })
    : nodeNativeBuildsLoading
      ? t('node.nativeBuild.inspecting')
      : t('node.nativeBuild.noState')
  void nodeNativeBuildsError
  void nodeNativeBuildSummaryText
  const nodeServices = nodeStatus?.services ?? []
  const nodeComponents = nodeStatus?.components ?? []
  const nodeComponentByName = useMemo(
    () => new Map(nodeComponents.map((component) => [component.name, component] as const)),
    [nodeComponents]
  )
  const nodeLogsKnownComponents = useMemo(
    () => [
      ...DEFAULT_LOG_COMPONENT_FILTERS,
      ...nodeComponents.map((component) => component.name)
    ],
    [nodeComponents]
  )
  const nodeLogsComponentOptions = useMemo(
    () => listLogComponents(nodeLogsOutput, nodeLogsKnownComponents),
    [nodeLogsOutput, nodeLogsKnownComponents]
  )
  useEffect(() => {
    if (nodeLogsComponentFilter !== 'all' && !nodeLogsComponentOptions.includes(nodeLogsComponentFilter)) {
      setNodeLogsComponentFilter('all')
    }
  }, [nodeLogsComponentFilter, nodeLogsComponentOptions])
  const nodeServiceById = useMemo(
    () => new Map(nodeServices.map((service) => [service.id, service] as const)),
    [nodeServices]
  )
  const nodeProfileDependentsByServiceId = useMemo(() => {
    const dependents = new Map<string, TelenoNodeServiceStatus[]>()

    for (const service of nodeServices) {
      for (const dependencyId of service.dependsOn) {
        const current = dependents.get(dependencyId)
        if (current) current.push(service)
        else dependents.set(dependencyId, [service])
      }
    }

    return dependents
  }, [nodeServices])
  const nodeServiceCapabilities = useMemo(() => {
    const capabilities = new Map<string, NodeServiceCapabilities>()
    const serviceLabel = (serviceId: string) => nodeServiceById.get(serviceId)?.name ?? serviceId

    for (const service of nodeServices) {
      const running = isNodeServiceRunning(service)
      const conflictReason =
        service.state === 'conflict' ? service.lastError || t('node.serviceConflictNative') : null
      const restartRequiredReason =
        service.state === 'restart required'
          ? service.lastError || t('node.serviceRestartRequired')
          : null
      const dependencyNames = service.dependsOn.map(serviceLabel)
      const missingDependencyNames = service.dependsOn
        .filter((dependencyId) => {
          const dependency = nodeServiceById.get(dependencyId)
          return !dependency || !isNodeServiceRunning(dependency)
        })
        .map(serviceLabel)
      const profileDependentNames = (nodeProfileDependentsByServiceId.get(service.id) ?? []).map(
        (dependent) => dependent.name
      )

      capabilities.set(service.id, {
        running,
        dependencyNames,
        missingDependencyNames,
        profileDependentNames,
        conflictReason: conflictReason || restartRequiredReason,
        conflictPids: service.conflictPids ?? [],
        startBlockedReason:
          conflictReason ||
          (restartRequiredReason
            ? t('node.serviceRestartUseRestart', { reason: restartRequiredReason })
            : null) ||
          (running
            ? t('node.serviceAlreadyActive')
            : missingDependencyNames.length > 0
              ? t('node.inactiveDependencies', { services: missingDependencyNames.join(', ') })
              : null),
        stopBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : !running
            ? t('node.serviceAlreadyStopped')
            : profileDependentNames.length > 0
              ? t('node.profileDependentServices', { services: profileDependentNames.join(', ') })
              : null),
        restartBlockedReason:
          conflictReason ||
          (restartRequiredReason ? null : null) ||
          (!running && missingDependencyNames.length > 0
            ? t('node.inactiveDependencies', { services: missingDependencyNames.join(', ') })
            : null)
      })
    }

    return capabilities
  }, [nodeProfileDependentsByServiceId, nodeServiceById, nodeServices])
  const nodeRunningServiceIds = useMemo(
    () => nodeServices.filter((service) => isNodeServiceRunning(service)).map((service) => service.id),
    [nodeServices]
  )
  const nodeContextService = nodeServiceContextMenu
    ? nodeServices.find((service) => service.id === nodeServiceContextMenu.serviceId) ?? null
    : null
  const nodeLogsTargetService = nodeLogsService ? nodeServiceById.get(nodeLogsService) ?? null : null
  const nodeContextServiceCapabilities = nodeContextService
    ? nodeServiceCapabilities.get(nodeContextService.id) ?? null
    : null
  const nodePrimaryService = nodeServices[0] ?? null
  const nodePrimaryCapabilities = nodePrimaryService
    ? nodeServiceCapabilities.get(nodePrimaryService.id) ?? null
    : null
  const nodePrimaryRunning = Boolean(nodePrimaryCapabilities?.running)
  const nodePrimaryStatusTone = nodePrimaryService?.state === 'conflict'
    ? 'is-conflict'
    : nodePrimaryRunning
      ? 'is-running'
      : 'is-stopped'
  const nodePrimaryTooltip = nodePrimaryService && nodePrimaryCapabilities
    ? formatNodeServiceTooltip(nodePrimaryService, nodePrimaryCapabilities, language)
    : ''
  const nodePrimaryVersion = nodePrimaryService?.version?.trim() || t('common.na')
  const nodePrimaryPid = nodePrimaryService?.nativePid
    ? `${nodePrimaryService.nativePid}`
    : nodePrimaryService?.conflictPids.length
      ? nodePrimaryService.conflictPids.join(', ')
      : t('common.na')
  const nodePrimaryPorts = nodePrimaryService ? formatNodeServicePorts(nodePrimaryService) : t('common.na')
  const nodePrimaryBinaryPath = nodePrimaryService?.binaryPath?.trim() || t('common.na')
  const nodePrimaryConfigPath =
    nodePrimaryService?.configPath?.trim() ||
    (nodeStatus?.baseDir || nodeSettings.baseDir ? `${nodeStatus?.baseDir || nodeSettings.baseDir}/config.yml` : t('common.na'))
  const nodePrimaryLogPath = nodePrimaryService?.logPath?.trim() || t('common.na')
  const nodeP2pPort = nodePrimaryService?.ports.find((port) => {
    const label = `${port.label} ${port.targetPort ?? ''} ${port.publishedPort ?? ''}`
    return /8888/.test(label)
  }) ?? null
  const nodeP2pEndpoint = nodeP2pPort
    ? `${nodeP2pPort.host?.trim() || '0.0.0.0'}:${nodeP2pPort.publishedPort ?? nodeP2pPort.targetPort ?? 8888}/${nodeP2pPort.protocol || 'tcp'}`
    : t('common.na')
  const nodePanelOptionalComponents = nodePanelOptionalComponentOrder.flatMap((componentName) => {
    const component = nodeComponentByName.get(componentName)
    return component ? [component] : []
  })
  const nodeEnabledComponents = nodePanelOptionalComponents.filter((component) => component.enabled)
  const nodeDisabledComponents = nodePanelOptionalComponents.filter((component) => !component.enabled)
  const blockProducerService = nodeServiceById.get('block_producer') ?? null
  const blockProducerRunning = blockProducerService ? isNodeServiceRunning(blockProducerService) : false
  const nodeServiceCount = nodeServices.length
  const nodeRunningCount = nodeStatus?.runningServices ?? 0
  const nodeStoppedServices = nodeServices.filter((service) => !isNodeServiceRunning(service))
  const nodeHasStoppedServices = nodeStoppedServices.length > 0
  const nodeHasPartialOutage = nodeRunningCount > 0 && nodeHasStoppedServices
  const isLocalRpc = settings.rpcSource === 'local'
  const localNodeNotRunning = isLocalRpc && nodeRunningCount === 0
  const presetMatchesNodeState = (preset: TelenoNodePreset) => {
    if (preset.featureFlags) {
      return nodeRunningCount > 0 && Object.entries(preset.featureFlags).every(([component, enabled]) => {
        return nodeComponentByName.get(component)?.enabled === enabled
      })
    }
    return sameStringList(preset.services, nodeRunningServiceIds)
  }
  const selectedNodePresetMatchesRunningState = selectedNodePreset
    ? presetMatchesNodeState(selectedNodePreset)
    : false
  const runningNodePreset =
    nodeRunningCount > 0
      ? nodePresets.find((preset) => presetMatchesNodeState(preset)) ?? null
      : null
  const activeNodePresetLabel =
    nodeRunningCount > 0
      ? runningNodePreset
        ? formatNodePresetLabel(runningNodePreset)
        : t('node.presetCustomLabel')
      : selectedNodePreset
        ? formatNodePresetLabel(selectedNodePreset)
        : t('node.presetCustomLabel')
  const pendingNodePresetLabel =
    selectedNodePreset && nodeRunningCount > 0 && !selectedNodePresetMatchesRunningState
      ? formatNodePresetLabel(selectedNodePreset)
      : ''
  const nodePresetSummaryText = selectedNodePreset
    ? t('node.presetSummarySelected', {
        label: formatNodePresetLabel(selectedNodePreset),
        count: selectedNodePreset.services.length,
        pending: selectedNodePresetMatchesRunningState ? '' : t('node.presetSummaryPendingSuffix')
      })
    : t('node.presetSummaryCustom', {
        profiles: nodeCurrentProfiles.length ? nodeCurrentProfiles.join(', ') : t('common.core')
      })
  const nodeStateText = !hasNodeControls
    ? t('status.electronOnly')
    : nodeCloneLoading
      ? t('status.syncingRepo')
    : nodeRestoreBackupLoading
      ? t('status.restoringBackup')
    : nodeNativeBuildActionLoading
      ? nodeNativeBuildActionLoading === 'all'
        ? t('status.compilingNativeAll')
        : t('status.compilingNativeService', { service: nodeNativeBuildActionLoading })
    : nodeStatusLoading
      ? t('status.checkingNode')
    : nodePresetActionLoading
        ? t('status.applyingProfile')
      : nodeActionLoading
        ? nodeActionLoading === 'start'
          ? t('status.startingNode')
          : t('status.stoppingNode')
        : nodeStatus
          ? nodeHasPartialOutage
            ? t('status.degraded', { running: nodeRunningCount, total: nodeServiceCount })
            : nodeRunningCount > 0
              ? t('status.running', { running: nodeRunningCount, total: nodeServiceCount })
              : nodeStatus.ok
                ? t('status.stopped')
                : t('status.error')
          : t('status.noState')
  const nodeStatusClass = nodeError || nodeHasPartialOutage ? 'is-error' : nodeRunningCount > 0 ? 'is-live' : 'is-idle'
  const nodeActionTooltip = (fallback: string, ...reasons: Array<string | null | false | undefined>) =>
    reasons.find((reason): reason is string => Boolean(reason)) ?? fallback
  const nodeControlsUnavailableReason = !hasNodeControls ? t('node.actionDisabled.electronOnly') : null
  const nodeActionBusyReason = nodeBusy ? t('node.actionDisabled.busy', { state: nodeStateText }) : null
  const nodeStartAlreadyRunningReason = nodeRunningCount > 0 ? t('node.actionDisabled.alreadyRunning') : null
  const producerStartBlockedReason =
    nodeSettings.network === 'mainnet' &&
    nodeCurrentProfiles.some((profile) => profile.toLowerCase().includes('producer')) &&
    nodeProducerOverview !== null &&
    !nodeProducerOverview.configHasProducer &&
    !isProducerSetupComplete(producerProfile)
      ? t('node.actionDisabled.producerSetupIncomplete')
      : null
  const nodePrimaryUnavailableReason = !nodePrimaryService ? t('node.actionDisabled.noPrimaryService') : null
  const nodePrimaryStatusUnavailableReason =
    nodePrimaryService && !nodePrimaryCapabilities ? t('node.actionDisabled.statusUnavailable') : null
  const nodePresetsTooltip = nodeActionTooltip(
    t('node.actionTooltip.presets'),
    nodeControlsUnavailableReason
  )
  const nodeStartTooltip = nodeActionTooltip(
    t('node.actionTooltip.start'),
    nodeControlsUnavailableReason,
    producerStartBlockedReason,
    nodeStartAlreadyRunningReason,
    nodeActionBusyReason
  )
  const nodeLogsTooltip = nodeActionTooltip(
    t('node.actionTooltip.logs'),
    nodeControlsUnavailableReason,
    nodeActionBusyReason,
    nodePrimaryUnavailableReason
  )
  const nodeRestartTooltip = nodeActionTooltip(
    t('node.actionTooltip.restart'),
    nodeControlsUnavailableReason,
    nodeActionBusyReason,
    nodePrimaryUnavailableReason,
    nodePrimaryStatusUnavailableReason,
    nodePrimaryCapabilities?.restartBlockedReason
  )
  const nodeStopTooltip = nodeActionTooltip(
    t('node.actionTooltip.stop'),
    nodeControlsUnavailableReason,
    nodeActionBusyReason
  )
  // Calculate blocks/sec from chain head height changes
  useEffect(() => {
    if (!localChainHead) return
    const now = Date.now()
    const prev = prevChainHeadRef.current
    if (prev && localChainHead.height > prev.height) {
      const elapsedSec = (now - prev.time) / 1000
      if (elapsedSec > 0.5) {
        const rate = (localChainHead.height - prev.height) / elapsedSec
        setBlocksPerSecond(Math.round(rate * 10) / 10)
        prevChainHeadRef.current = { height: localChainHead.height, time: now }
      }
    } else if (!prev || localChainHead.height !== prev.height) {
      prevChainHeadRef.current = { height: localChainHead.height, time: now }
    }
  }, [localChainHead?.height]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncGapBlocks =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.height - localChainHead.height) : null
  const syncGapTimeMs =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.timestampMs - localChainHead.timestampMs) : null
  const showIndexerProgress = Boolean(nodeRunningCount > 0 && indexerProgress)
  const showChainSyncProgress = showIndexerProgress || Boolean(
    nodeRunningCount > 0 &&
      publicChainHead &&
      localChainHead &&
      ((syncGapBlocks ?? 0) > SYNC_GAP_BLOCK_THRESHOLD || (syncGapTimeMs ?? 0) > SYNC_GAP_TIME_THRESHOLD_MS)
  )
  const chainSyncPercent = showIndexerProgress
    ? clamp(indexerProgress!.percent, 0, 100)
    : showChainSyncProgress && publicChainHead
      ? clamp((localChainHead!.height / publicChainHead.height) * 100, 0, 100)
      : null
  const walletResultText = useMemo(
    () => (walletResultData ? JSON.stringify(walletResultData, null, 2) : ''),
    [walletResultData]
  )
  const producerVaultExists = Boolean(walletOverview?.walletExists)
  const producerVaultUnlocked = Boolean(walletOverview?.unlocked)
  const appAdvancedMode = settings.nodeAdvancedMode || settings.producerAdvancedMode
  const producerAdvancedMode = settings.producerAdvancedMode
  const signingWalletAddress = activeWalletAddress
  const draftedProducerAddress = nodeProducerAddressDraft.trim()
  const signingWalletManaValue = producerSigningWalletBalance?.mana
    ? Number.parseFloat(producerSigningWalletBalance.mana)
    : null
  const signingWalletVhpValue = producerSigningWalletBalance?.vhp
    ? Number.parseFloat(producerSigningWalletBalance.vhp)
    : null
  const effectiveProducerTargetAddress = resolveProducerTargetAddress({
    walletAddress: signingWalletAddress,
    draftedProducerAddress,
    configProducerAddress: nodeProducerOverview?.producerAddress || '',
    useWalletAddress: producerUseWalletAddress
  })
  const signingWalletHasRegistrationMana =
    signingWalletManaValue !== null && Number.isFinite(signingWalletManaValue) ? signingWalletManaValue >= 0.5 : null
  const signingWalletHasProducerVhp =
    signingWalletVhpValue !== null && Number.isFinite(signingWalletVhpValue) ? signingWalletVhpValue > 0 : null
  const producerSetupComplete = isProducerSetupComplete(producerProfile)
  const producerLocalPublicKey = producerLocalInfo?.localPublicKey || nodeProducerOverview?.localPublicKey || ''
  const producerRegisteredPublicKey =
    nodeProducerOverview?.registeredPublicKey ||
    producerProfile?.profile?.registeredPublicKey ||
    producerPreviewRegisteredPublicKey ||
    null
  const producerPublicKeyRegistrationState = getProducerPublicKeyRegistrationState({
    localPublicKey: producerLocalPublicKey,
    registeredPublicKey: producerRegisteredPublicKey
  })
  const producerPublicKeyAlreadyRegistered = producerPublicKeyRegistrationState === 'match'
  const producerPublicKeyRegisteredWithAnotherKey = producerPublicKeyRegistrationState === 'mismatch'
  const runtimeConfiguredProducerAddress = producerLocalInfo?.producerAddress?.trim() || ''
  const producerConfiguredAddress = resolveConfiguredProducerAddress({
    runtimeConfigAddress: runtimeConfiguredProducerAddress,
    overviewAddress: nodeProducerOverview?.producerAddress,
    overviewAddressSource: nodeProducerOverview?.producerAddressSource,
    profileAddress: producerProfile?.profile?.producerAddress
  })
  const producerAndSigningWalletMatch =
    Boolean(producerConfiguredAddress && signingWalletAddress) &&
    producerConfiguredAddress.toLowerCase() === signingWalletAddress.toLowerCase()
  const producerConfiguredWalletMismatch =
    Boolean(producerConfiguredAddress && signingWalletAddress) &&
    producerConfiguredAddress.toLowerCase() !== signingWalletAddress.toLowerCase()
  const producerRegistrationStatusText = (() => {
    switch (nodeProducerOverview?.registrationStatus) {
      case 'match':
        return t('producer.status.match')
      case 'mismatch':
        return t('producer.status.mismatch')
      case 'unregistered':
        return t('producer.status.unregistered')
      case 'missing-local-key':
        return t('producer.status.missingLocalKey')
      case 'missing-address':
      default:
        return t('producer.status.missingAddress')
    }
  })()
  const producerAddressSourceText = (() => {
    if (producerUseWalletAddress) {
      if (signingWalletAddress) return t('producer.source.vault')
      if (nodeProducerOverview?.producerAddress?.trim()) return t('producer.source.config')
      return t('producer.source.walletMissing')
    }
    if (draftedProducerAddress) {
      return t('producer.source.draft')
    }
    switch (nodeProducerOverview?.producerAddressSource) {
      case 'config':
        return t('producer.source.config')
      case 'manual':
        return t('producer.source.manual')
      default:
        return t('producer.source.none')
    }
  })()
  const producerSigningWalletStatusText = (() => {
    if (!signingWalletAddress) return t('producer.signingWalletMissing')
    if (producerSigningWalletBalanceLoading) return t('common.loading')
    if (producerSigningWalletBalanceError) return producerSigningWalletBalanceError
    if (signingWalletHasRegistrationMana === null) return t('producer.signingWalletManaUnknown')
    return signingWalletHasRegistrationMana
      ? t('producer.signingWalletManaReady')
      : t('producer.signingWalletManaLow')
  })()
  const producerSigningWalletRelationText = signingWalletAddress
    ? producerAndSigningWalletMatch
      ? t('producer.signingWalletSame')
      : t('producer.signingWalletDifferent')
    : t('producer.signingWalletMissing')
  const producerSetupBlockedReason = getProducerSetupBlockReason({
    walletExists: producerVaultExists,
    walletUnlocked: producerVaultUnlocked,
    hasLocalPublicKey: Boolean(producerLocalPublicKey),
    hasTargetAddress: Boolean(effectiveProducerTargetAddress),
    isWalletBalanceLoading: producerSigningWalletBalanceLoading,
    hasEnoughMana: producerPublicKeyAlreadyRegistered ? true : signingWalletHasRegistrationMana,
    useWalletAddress: producerUseWalletAddress,
    producerAdvancedMode
  })
  const producerRegisterHintText = (() => {
    if (producerSigningWalletBalanceError) return producerSigningWalletBalanceError
    switch (producerSetupBlockedReason) {
      case 'wallet-missing':
        return t('producer.createNeedsWallet')
      case 'wallet-locked':
        return t('producer.createNeedsUnlock')
      case 'address-missing':
        return t('producer.registerNeedsAddress')
      case 'advanced-required':
        return t('settings.producerAdvancedHelpOff')
      case 'local-key-missing':
        return t('producer.registerNeedsLocalKey')
      case 'wallet-balance-loading':
        return t('producer.registerCheckingWallet')
      case 'insufficient-mana':
        return t('producer.registerNeedsMana')
      default:
        break
    }

    if (!producerVaultExists) return t('producer.registerNeedsSigningWallet')
    if (!producerVaultUnlocked) return t('producer.registerNeedsUnlock')
    if (!effectiveProducerTargetAddress) return t('producer.registerNeedsAddress')
    if (!producerUseWalletAddress && !producerAdvancedMode) return t('settings.producerAdvancedHelpOff')
    if (!producerLocalPublicKey) return t('producer.registerNeedsLocalKey')
    if (producerPublicKeyAlreadyRegistered) return t('producer.registerHintExisting')
    if (producerPublicKeyRegisteredWithAnotherKey) return t('producer.registerHintReplace')
    return t('producer.registerHint')
  })()
  const producerRegisterActionText = producerPublicKeyRegisteredWithAnotherKey
      ? t('producer.replaceRegisteredKeyAction')
      : t('producer.createAction')
  const producerOperationalNotice = getProducerOperationalNotice({
    configuredAddress: producerConfiguredAddress,
    localPublicKey: producerLocalPublicKey,
    registeredPublicKey: producerRegisteredPublicKey,
    recentBlocksCount: producerRecentBlocks.length
  })
  const producerRegisterDisabled =
    !hasNodeControls ||
    nodeProducerActionLoading !== null ||
    nodeProducerLoading ||
    Boolean(producerSigningWalletBalanceError) ||
    producerPublicKeyAlreadyRegistered ||
    producerSetupBlockedReason !== null
  const producerReconfigureDisabled =
    !hasNodeControls ||
    nodeProducerActionLoading !== null ||
    nodeProducerLoading ||
    !producerVaultExists ||
    !producerVaultUnlocked ||
    !signingWalletAddress ||
    !producerLocalPublicKey ||
    Boolean(producerSigningWalletBalanceError)
  const producerRegisterHintClass =
    producerPublicKeyAlreadyRegistered
      ? 'is-ok'
      : producerSetupBlockedReason === 'wallet-balance-loading'
      ? ''
      : producerRegisterDisabled
        ? 'is-error'
        : signingWalletHasRegistrationMana === true
          ? 'is-ok'
          : ''
  const chainSyncPercentLabel = chainSyncPercent === null
    ? ''
    : chainSyncPercent >= 99
      ? chainSyncPercent.toFixed(2)
      : chainSyncPercent >= 90
        ? chainSyncPercent.toFixed(1)
        : chainSyncPercent.toFixed(0)
  const activeBackupProgress =
    nodeBackupProgress && !TERMINAL_BACKUP_PHASES.has(nodeBackupProgress.phase) ? nodeBackupProgress : null
  const activeBackupActionLabel = activeBackupProgress
    ? activeBackupProgress.action === 'create-backup'
      ? t('status.creatingBackup')
      : activeBackupProgress.action === 'restore-backup-verify'
        ? t('status.verifyingBackup')
        : t('status.restoringBackup')
    : ''
  const activeBackupPercent = activeBackupProgress
    ? Math.max(0, Math.min(100, Math.round(activeBackupProgress.displayProgress)))
    : null
  const activeBackupMeta = activeBackupProgress
    ? [
        activeBackupPercent !== null ? `${activeBackupPercent}%` : '',
        activeBackupProgress.bytesPerSecond && activeBackupProgress.bytesPerSecond > 0
          ? `${formatBytes(activeBackupProgress.bytesPerSecond, locale)}/s`
          : '',
        activeBackupProgress.etaSeconds && activeBackupProgress.etaSeconds > 0
          ? t('status.syncEta', { eta: formatDurationSeconds(activeBackupProgress.etaSeconds) })
          : ''
      ].filter(Boolean).join(' · ')
    : ''
  const footerStatusClass = activeBackupProgress
    ? 'is-live'
    : !hasNodeControls
    ? errorMessage
      ? 'is-error'
      : 'is-idle'
    : nodeStatusClass
  const footerStatusText = activeBackupProgress
    ? activeBackupActionLabel
    : !hasNodeControls
    ? localNodeNotRunning && errorMessage
      ? t('status.startServicesToExplore')
      : statusText
    : showIndexerProgress
      ? t('status.indexingChain')
      : showChainSyncProgress
        ? t('status.syncingChain')
        : nodeRunningCount > 0 && !nodeHasPartialOutage
          ? blockProducerRunning && producerSetupComplete && producerFooterState === 'producing'
            ? t('status.liveProducing')
            : t('status.liveSynchronized')
          : nodeStateText
  const blocksPerSecLabel = blocksPerSecond !== null && blocksPerSecond > 0 && showChainSyncProgress && !showIndexerProgress
    ? ` · ${blocksPerSecond} blk/s`
    : ''
  const chainSyncEtaLabel =
    syncGapBlocks !== null &&
    syncGapBlocks > 0 &&
    blocksPerSecond !== null &&
    blocksPerSecond > 0 &&
    showChainSyncProgress &&
    !showIndexerProgress
      ? ` · ${t('status.syncEta', { eta: formatDurationSeconds(syncGapBlocks / blocksPerSecond) })}`
      : ''
  const indexerPercentLabel = showIndexerProgress
    ? indexerProgress!.percent >= 99
      ? indexerProgress!.percent.toFixed(2)
      : indexerProgress!.percent >= 10
        ? indexerProgress!.percent.toFixed(1)
        : indexerProgress!.percent.toFixed(2)
    : ''
  const indexerBlkSecLabel = showIndexerProgress && indexerBlocksPerSec !== null && indexerBlocksPerSec > 0
    ? ` · ${indexerBlocksPerSec} blk/s`
    : ''
  const footerStatusMeta = activeBackupProgress
    ? activeBackupMeta || null
    : showIndexerProgress
    ? t('status.indexProgress', {
        height: indexerProgress!.height.toLocaleString(locale),
        percent: indexerPercentLabel
      }) + indexerBlkSecLabel
    : showChainSyncProgress && publicChainHead && localChainHead
      ? t('status.syncProgress', {
          current: localChainHead.height.toLocaleString(locale),
          target: publicChainHead.height.toLocaleString(locale),
          percent: chainSyncPercentLabel
        }) + blocksPerSecLabel + chainSyncEtaLabel
      : hasNodeControls &&
          nodeRunningCount > 0 &&
          !nodeHasPartialOutage &&
          !showIndexerProgress &&
          !showChainSyncProgress &&
          localChainHead &&
          !(blockProducerRunning && producerSetupComplete && producerFooterState === 'producing')
        ? t('status.headBlock', { height: localChainHead.height.toLocaleString(locale) })
      : null
  const hasAppOverlayOpen =
    nodeProfilesModalOpen ||
    nodeLogsModalOpen ||
    nodeFileEditorOpen ||
    nodeConflictDialog !== null ||
    nodeBaseDirChangeDialog !== null ||
    settingsUnsavedDialogOpen

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let pollTimer: number | null = null
    const pollMs = Math.max(5000, Math.min(settings.pollMs, 15000))
    const shouldQueryLocalHead =
      hasNodeControls &&
      (nodeRunningCount > 0 ||
        nodeStatusLoading ||
        nodeActionLoading === 'start' ||
        nodeRestoreBackupLoading ||
        nodeRestoreBackupVerifyLoading)

    const tick = async () => {
      controller?.abort()
      controller = new AbortController()

      try {
        const [nextPublicHead, nextLocalHead] = await Promise.all([
          fetchHeadSnapshot(language, primaryPublicRpcUrl, controller.signal).catch(() => null),
          shouldQueryLocalHead
            ? fetchHeadSnapshot(language, localNodeRpcUrl, controller.signal).catch(() => null)
            : Promise.resolve<HeadSnapshot | null>(null)
        ])

        if (disposed) return
        setPublicChainHead(nextPublicHead)
        setLocalChainHead(nextLocalHead)
      } catch {
        if (disposed) return
      }
    }

    void tick()
    pollTimer = window.setInterval(() => {
      void tick()
    }, pollMs)

    return () => {
      disposed = true
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [
    hasNodeControls,
    language,
    localNodeRpcUrl,
    nodeActionLoading,
    nodeRestoreBackupLoading,
    nodeRestoreBackupVerifyLoading,
    nodeRunningCount,
    nodeStatusLoading,
    primaryPublicRpcUrl,
    settings.pollMs
  ])

  // Refs for auto-restart timer — read fresh values inside 60s interval without re-creating it
	  const autoRestartDepsRef = useRef<{
	    localChainHead: typeof localChainHead
	    publicChainHead: typeof publicChainHead
	    nodeSettings: typeof nodeSettings
	    nodeServices: typeof nodeServices
	    nodeComponents: typeof nodeComponents
	  }>({ localChainHead: null, publicChainHead: null, nodeSettings, nodeServices: [], nodeComponents: [] })
	  autoRestartDepsRef.current = { localChainHead, publicChainHead, nodeSettings, nodeServices, nodeComponents }

  // Auto-restart chain when sync gap is detected and chain is stalled
  // Also auto-disable verify-blocks when chain catches up after restore
  useEffect(() => {
    if (!hasNodeControls || nodeRunningCount === 0) return

    let disposed = false

    const timer = window.setInterval(() => {
      if (disposed) return
      if (nodeBackupOperationActiveRef.current) return

      const bridge = getTelenoNodeBridge()
      const now = Date.now()
	      const {
	        localChainHead: lHead,
	        publicChainHead: pHead,
	        nodeSettings: settings,
	        nodeServices: services,
	        nodeComponents: components
	      } = autoRestartDepsRef.current
	      const gap = (pHead?.height ?? 0) - (lHead?.height ?? 0)
	      const syncGapExists = gap > SYNC_GAP_BLOCK_THRESHOLD
	      const monolithService = services.find((service) => service.id === 'teleno-node') ?? null
	      const resolveRestartService = (componentService: string) =>
	        services.some((service) => service.id === componentService) ? componentService : monolithService?.id ?? componentService
	      const chainRestartService = resolveRestartService('chain')
	      const p2pRestartService = resolveRestartService('p2p')
	      // --- Auto-disable verify-blocks when chain is synced ---
      if (!verifyBlocksCheckDoneRef.current && bridge?.getVerifyBlocks && bridge?.setVerifyBlocks && bridge?.serviceRestart) {
        void (async () => {
          try {
            const vbResult = await bridge.getVerifyBlocks!(toNodeApiSettings(settings))
            if (shouldDisableVerifyBlocks({
              localHeight: lHead?.height ?? null,
              publicHeight: pHead?.height ?? null,
              verifyBlocksEnabled: vbResult.enabled
            })) {
              console.log('[verify-blocks] Chain synced — disabling verify-blocks and restarting chain for performance')
              const setResult = await bridge.setVerifyBlocks!({ ...toNodeApiSettings(settings), enabled: false })
              console.log(`[verify-blocks] ${setResult.output}`)
              if (setResult.ok) {
                verifyBlocksCheckDoneRef.current = true
	                const restartResult = await bridge.serviceRestart!({ ...toNodeApiSettings(settings), service: chainRestartService })
                if (!disposed && restartResult.status) {
                  setNodeStatus(restartResult.status)
                }
                console.log(`[verify-blocks] Chain restart ${restartResult.ok ? 'succeeded' : 'failed'}`)
              }
            } else if (vbResult.enabled === false) {
              // Already disabled, no need to check again
              verifyBlocksCheckDoneRef.current = true
            }
          } catch (err) {
            console.error('[verify-blocks] Error checking verify-blocks:', err)
          }
        })()
      }

      // --- Auto-enable verify-blocks when p2p sees a local state merkle mismatch ---
      if (syncGapExists && bridge?.logs && bridge?.getVerifyBlocks && bridge?.setVerifyBlocks && bridge?.serviceRestart) {
        void (async () => {
          try {
            const logsResult = await bridge.logs!({ ...toNodeApiSettings(settings), service: 'p2p', tail: 400 })
            if (!logsResult.ok || !hasStateMerkleMismatch(logsResult.output)) return

            const vbResult = await bridge.getVerifyBlocks!(toNodeApiSettings(settings))
            if (vbResult.enabled !== false) return

            console.log(
	              `[verify-blocks] Detected block previous state merkle mismatch at local height ${lHead?.height ?? 0}. Enabling verify-blocks and restarting ${chainRestartService}.`
	            )
            const setResult = await bridge.setVerifyBlocks!({ ...toNodeApiSettings(settings), enabled: true })
            console.log(`[verify-blocks] ${setResult.output}`)
            if (!setResult.ok) return

            verifyBlocksCheckDoneRef.current = false
            autoRestartStateRef.current = createAutoRestartState()
            p2pRestartStateRef.current = createP2pRestartState()

	            const restartResult = await bridge.serviceRestart!({ ...toNodeApiSettings(settings), service: chainRestartService })
            if (!disposed && restartResult.status) {
              setNodeStatus(restartResult.status)
            }
            console.log(`[verify-blocks] Recovery restart ${restartResult.ok ? 'succeeded' : 'failed'}: ${restartResult.output || ''}`)
          } catch (err) {
            console.error('[verify-blocks] Merkle recovery check error:', err)
          }
        })()
      }

	      // --- Auto-restart P2P when no peers and sync gap exists ---
	      if (bridge?.dashboardPeers && bridge?.serviceRestart) {
	        const p2pService = services.find((s) => s.id === 'p2p')
	        const p2pComponent = components.find((component) => component.name === 'p2p')
	        const p2pRunning = p2pService
	          ? isNodeServiceRunning(p2pService)
	          : Boolean(monolithService && isNodeServiceRunning(monolithService) && p2pComponent?.enabled && p2pComponent.healthy)

        if (p2pRunning && syncGapExists) {
          void (async () => {
            try {
              const peersResult = await bridge.dashboardPeers!(toNodeApiSettings(settings))
              const peerCount = peersResult.ok ? peersResult.rows.length : 0
              if (peerCount === 0) console.log(`[auto-restart] P2P: 0 peers, gap=${gap}, noPeersChecks=${p2pRestartStateRef.current.noPeersCount + 1}`)
              const p2pResult = evaluateP2pRestart(p2pRestartStateRef.current, {
                peerCount,
                syncGapExists,
                p2pRunning,
                now
              })
              p2pRestartStateRef.current = p2pResult.state

	              if (p2pResult.shouldRestart) {
	                console.log(`[auto-restart] P2P has 0 peers with sync gap=${gap} blocks. Restarting ${p2pRestartService} to reconnect.`)
	                const restartResult = await bridge.serviceRestart!({ ...toNodeApiSettings(settings), service: p2pRestartService })
                if (!disposed && restartResult.status) {
                  setNodeStatus(restartResult.status)
                }
                console.log(`[auto-restart] P2P restart ${restartResult.ok ? 'succeeded' : 'failed'}: ${restartResult.output || ''}`)
              }
            } catch (err) {
              console.error('[auto-restart] P2P peers check error:', err)
            }
          })()
        } else {
          p2pRestartStateRef.current = createP2pRestartState()
        }
      }

      // --- Auto-restart stalled chain (with merkle mismatch auto-recovery) ---
      const result = evaluateAutoRestart(autoRestartStateRef.current, {
        localHeight: lHead?.height ?? null,
        publicHeight: pHead?.height ?? null,
        now
      })
      autoRestartStateRef.current = result.state

      if (!result.shouldRestart) return

      if (bridge?.serviceRestart) {
        void (async () => {
          try {
            // When chain is stalled, check if enabling verify-blocks could help
            if (bridge?.getVerifyBlocks && bridge?.setVerifyBlocks) {
              const vbResult = await bridge.getVerifyBlocks!(toNodeApiSettings(settings))
              if (vbResult.enabled === false) {
                console.log(
	                  `[auto-restart] Chain stalled at height ${lHead?.height ?? 0} with verify-blocks=false (likely merkle mismatch). Enabling verify-blocks and restarting ${chainRestartService}.`
                )
                const setResult = await bridge.setVerifyBlocks!({ ...toNodeApiSettings(settings), enabled: true })
                console.log(`[auto-restart] ${setResult.output}`)
                verifyBlocksCheckDoneRef.current = false // re-arm auto-disable for when chain catches up
              } else {
	                console.log(
	                  `[auto-restart] Chain stalled at height ${lHead?.height ?? 0}, gap=${gap} blocks. Restarting ${chainRestartService} to trigger indexer.`
	                )
	              }
	            }
	            const res = await bridge.serviceRestart!({ ...toNodeApiSettings(settings), service: chainRestartService })
            if (!disposed && res.status) {
              setNodeStatus(res.status)
            }
            console.log(`[auto-restart] Chain restart ${res.ok ? 'succeeded' : 'failed'}: ${res.output || ''}`)
          } catch (err) {
            console.error('[auto-restart] Chain restart error:', err)
          }
        })()
      }
    }, AUTO_RESTART_CHAIN_CHECK_INTERVAL_MS)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [hasNodeControls, nodeRunningCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll chain logs for indexer progress when RPC is not available
  useEffect(() => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.logs || !hasNodeControls || nodeRunningCount === 0) {
      setIndexerProgress(null)
      setIndexerBlocksPerSec(null)
      prevIndexerRef.current = null
      return
    }
    // If localChainHead is available, RPC is working = indexing is done
    if (localChainHead) {
      setIndexerProgress(null)
      setIndexerBlocksPerSec(null)
      prevIndexerRef.current = null
      return
    }

    let disposed = false
    let pollTimer: number | null = null

    const tick = async () => {
      try {
        const result = await bridge.logs({
          ...toNodeApiSettings(nodeSettings),
          service: 'chain',
          tail: 20
        })
        if (disposed) return
        const progress = result.ok ? parseIndexerProgress(result.output) : null
        setIndexerProgress(progress)

        // Calculate blocks/sec from height changes
        if (progress) {
          const now = Date.now()
          const prev = prevIndexerRef.current
          if (prev && progress.height > prev.height) {
            const elapsedSec = (now - prev.time) / 1000
            if (elapsedSec > 1) {
              const rate = (progress.height - prev.height) / elapsedSec
              setIndexerBlocksPerSec(Math.round(rate))
              prevIndexerRef.current = { height: progress.height, time: now }
            }
          } else if (!prev || progress.height !== prev.height) {
            prevIndexerRef.current = { height: progress.height, time: now }
          }
        }
      } catch {
        if (!disposed) {
          setIndexerProgress(null)
          setIndexerBlocksPerSec(null)
        }
      }
    }

    void tick()
    pollTimer = window.setInterval(() => { void tick() }, 5000)

    return () => {
      disposed = true
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [hasNodeControls, nodeRunningCount, localChainHead, nodeSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.logs || !hasNodeControls || !blockProducerRunning || !producerSetupComplete) {
      setProducerFooterState('unknown')
      return
    }

    let disposed = false
    let pollTimer: number | null = null
    const pollMs = Math.max(5000, settings.dashboardRefreshSeconds * 1000)

    const tick = async () => {
      try {
        const result = await bridge.logs({
          ...toNodeApiSettings(nodeSettings),
          service: 'block_producer',
          tail: 120
        })
        if (disposed) return

        setProducerFooterState(
          result.ok && isProducerActivelyProducingFromLogs(result.output) ? 'producing' : 'unknown'
        )
      } catch {
        if (!disposed) {
          setProducerFooterState('unknown')
        }
      }
    }

    void tick()
    pollTimer = window.setInterval(() => {
      void tick()
    }, pollMs)

    return () => {
      disposed = true
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [
    blockProducerRunning,
    hasNodeControls,
    nodeSettings,
    producerSetupComplete,
    settings.dashboardRefreshSeconds
  ])

  const syncNodeStatusState = (
    status: TelenoNodeStatus,
    options?: { preserveOutputOnSuccess?: boolean }
  ) => {
    setNodeStatus(status)

    if (status.ok) {
      setNodeError(null)
      if (!options?.preserveOutputOnSuccess || looksLikeNodeErrorOutput(nodeOutputRef.current)) {
        setNodeOutput('')
      }
      return
    }

    const output = status.output || t('node.unableQueryNode')
    setNodeError(output)
    setNodeOutput(output)
  }

  const refreshNodeStatus = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge) return
    const effectiveSettings = settingsOverride ?? nodeSettings
    setNodeStatusLoading(true)
    setNodeError(null)
    try {
      const status = await bridge.status(toNodeApiSettings(effectiveSettings))
      syncNodeStatusState(status)
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableQueryNode'))
    } finally {
      setNodeStatusLoading(false)
    }
  }

  const refreshNodeNativeBuilds = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBuilds) return
    setNodeNativeBuildsLoading(true)
    setNodeNativeBuildsError(null)
    try {
      const builds = await bridge.nativeBuilds()
      setNodeNativeBuilds(builds)
      if (!builds.ok) {
        setNodeNativeBuildsError(builds.output || t('node.unableInspectNativeWorkspace'))
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.unableInspectNativeWorkspace'))
    } finally {
      setNodeNativeBuildsLoading(false)
    }
  }
  void refreshNodeNativeBuilds

  const resolveNodeSettingsForPreset = (preset: TelenoNodePreset): NodeManagerSettings => {
    const nextProfiles = preset.profiles.join(',')
    const nextNetwork = preset.network ?? nodeSettings.network
    const nextBaseDir =
      nextNetwork === nodeSettings.network
        ? nodeSettings.baseDir
        : resolveNodeBaseDirForNetwork(nextNetwork)

    return { ...nodeSettings, network: nextNetwork, baseDir: nextBaseDir, profiles: nextProfiles }
  }

  const applyNodePreset = (preset: TelenoNodePreset) => {
    const nextSettings = resolveNodeSettingsForPreset(preset)
    const nextProfiles = nextSettings.profiles
    const nextNetwork = nextSettings.network
    setNodeSettings(nextSettings)
    setDraftNodeNetwork(nextNetwork)
    setDraftNodeBaseDir(nextSettings.baseDir)
    setDraftNodeProfiles(nextProfiles)
    if (nextNetwork !== nodeSettings.network) {
      const nextPublicRpcUrls = publicRpcUrlsForActiveNetwork(nextNetwork, publicRpcUrlsByNetwork)
      setDraftPublicRpcUrls(nextPublicRpcUrls.join('\n'))
      setSettings((current) => ({
        ...current,
        publicRpcUrls: nextPublicRpcUrls,
        rpcSource: current.rpcSource === LOCAL_RPC_SOURCE ? LOCAL_RPC_SOURCE : nextPublicRpcUrls[0] ?? current.rpcSource
      }))
    }
    setFormError(null)
    setNodeError(null)
    setNodeOutput(
      t('node.profileSelected', {
        label: formatNodePresetLabel(preset),
        profiles: formatNodePresetProfileText(preset, language)
      })
    )
    void refreshNodeStatus(nextSettings)
  }

  const cloneKoinosRepo = async (targetRepoPath: string) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.cloneRepo) return

    const repoPath = targetRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
    setNodeCloneLoading(true)
    setNodeError(null)
    setFormError(null)

    try {
      const result = await bridge.cloneRepo({ repoPath })
      setNodeOutput(result.output || '')
      setDraftNodeRepoPath(result.repoPath || repoPath)

      if (result.ok) {
        const nextNodeSettings = { ...nodeSettings, repoPath: result.repoPath || repoPath }
        setNodeSettings(nextNodeSettings)
        // Refresh immediately so the UI picks up services/status if the user cloned or refreshed the repo.
        void refreshNodeStatus(nextNodeSettings)
      } else {
        setNodeError(result.output || t('node.unableSyncRepo'))
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRunningGit'))
    } finally {
      setNodeCloneLoading(false)
    }
  }

  const refreshNodeProducerOverview = async (
    settingsOverride?: NodeManagerSettings,
    producerAddressOverride?: string
  ): Promise<TelenoNodeProducerOverviewResult | null> => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerOverview) return null

    setNodeProducerLoading(true)
    setNodeProducerError(null)
    try {
      const producerAddress =
        producerAddressOverride !== undefined
          ? producerAddressOverride.trim()
          : resolveProducerTargetAddress({
              walletAddress: activeWalletAddress,
              draftedProducerAddress: nodeProducerAddressDraft,
              configProducerAddress: nodeProducerOverview?.producerAddress,
              useWalletAddress: producerUseWalletAddress
            })
      const result = await bridge.producerOverview({
        ...toNodeApiSettings(settingsOverride ?? nodeSettings),
        rpcUrl: producerRpcUrl,
        producerAddress: producerAddress || undefined
      })
      setNodeProducerOverview(result)
      if (!result.ok) {
        setNodeProducerError(result.output || t('producer.unableLoadOverview'))
      }
      return result
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableLoadOverview'))
      return null
    } finally {
      setNodeProducerLoading(false)
    }
  }

  const refreshProducerLocalInfo = async (
    settingsOverride?: NodeManagerSettings
  ): Promise<TelenoNodeProducerLocalInfoResult | null> => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerLocalInfo) return null

    try {
      const result = await bridge.producerLocalInfo(toNodeApiSettings(settingsOverride ?? nodeSettings))
      setProducerLocalInfo(result)
      return result
    } catch {
      setProducerLocalInfo(null)
      return null
    }
  }

  const refreshProducerRegisteredPublicKeyPreview = async (
    producerAddressOverride?: string,
    rpcUrlOverride?: string
  ): Promise<string | null> => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerRegisteredKey) return null
    const producerAddress = producerAddressOverride?.trim() || activeWalletAddress || ''

    if (!producerAddress) {
      setProducerPreviewRegisteredPublicKey(null)
      return null
    }

    try {
      const result = await bridge.producerRegisteredKey({
        ...toNodeApiSettings(nodeSettings),
        rpcUrl: rpcUrlOverride || producerRpcUrl,
        producerAddress
      })
      const registeredPublicKey = result.ok ? result.registeredPublicKey || null : null
      setProducerPreviewRegisteredPublicKey(registeredPublicKey)
      return registeredPublicKey
    } catch {
      setProducerPreviewRegisteredPublicKey(null)
      return null
    }
  }

  const refreshProducerRecentBlocks = async (
    producerAddressOverride?: string,
    signal?: AbortSignal,
    rpcUrlOverride?: string
  ) => {
    const producerAddress =
      producerAddressOverride?.trim() ||
      producerProfile?.profile?.producerAddress?.trim() ||
      nodeProducerOverview?.producerAddress?.trim() ||
      resolveProducerTargetAddress({
        walletAddress: activeWalletAddress,
        draftedProducerAddress: nodeProducerAddressDraft,
        configProducerAddress: nodeProducerOverview?.producerAddress,
        useWalletAddress: producerUseWalletAddress
      }).trim()

    if (!producerAddress) {
      setProducerRecentBlocks([])
      setProducerRecentBlocksError(null)
      setProducerRecentBlocksLoading(false)
      return
    }

    setProducerRecentBlocksLoading(true)
    setProducerRecentBlocksError(null)
    try {
      const requestSignal = signal ?? new AbortController().signal
      const snapshot = await fetchLatestBlocks(
        language,
        rpcUrlOverride || producerRpcUrl,
        settings.dashboardProducerWindowBlocks,
        requestSignal
      )
      setProducerRecentBlocks(filterBlocksByProducer(snapshot.rows, producerAddress))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setProducerRecentBlocksError(error instanceof Error ? error.message : t('producer.unableLoadBlocks'))
    } finally {
      setProducerRecentBlocksLoading(false)
    }
  }

  const refreshDashboardProducers = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.dashboardProducers) return

    setDashboardProducersLoading(true)
    setDashboardProducersError(null)
    try {
      const result = await bridge.dashboardProducers({
        ...toNodeApiSettings(settingsOverride ?? nodeSettings),
        rpcUrl: producerRpcUrl,
        windowBlocks: settings.dashboardProducerWindowBlocks
      })
      setDashboardProducers(result)
      if (!result.ok) {
        setDashboardProducersError(result.output || t('dashboard.unableLoadProducers'))
      }
    } catch (error) {
      setDashboardProducersError(error instanceof Error ? error.message : t('dashboard.unableLoadProducers'))
    } finally {
      setDashboardProducersLoading(false)
    }
  }

  const refreshDashboardPeers = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.dashboardPeers) return

    setDashboardPeersLoading(true)
    setDashboardPeersError(null)
    try {
      const result = await bridge.dashboardPeers({
        ...toNodeApiSettings(settingsOverride ?? nodeSettings)
      })
      setDashboardPeers(result)
      if (!result.ok) {
        setDashboardPeersError(result.output || t('dashboard.unableLoadPeers'))
      }
    } catch (error) {
      setDashboardPeersError(error instanceof Error ? error.message : t('dashboard.unableLoadPeers'))
    } finally {
      setDashboardPeersLoading(false)
    }
  }

  const refreshDashboardPerformance = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.dashboardPerformance) return

    setDashboardPerformanceLoading(true)
    setDashboardPerformanceError(null)
    try {
      const result = await bridge.dashboardPerformance({
        ...toNodeApiSettings(settingsOverride ?? nodeSettings)
      })
      setDashboardPerformance(result)
      if (!result.ok) {
        setDashboardPerformanceError(result.output || t('dashboard.unableLoadPerformance'))
      }
    } catch (error) {
      setDashboardPerformanceError(error instanceof Error ? error.message : t('dashboard.unableLoadPerformance'))
    } finally {
      setDashboardPerformanceLoading(false)
    }
  }

  const refreshDashboardCurrentSubtab = async () => {
    if (dashboardSubtab === 'producers') {
      await refreshDashboardProducers()
      return
    }

    if (dashboardSubtab === 'peers') {
      await refreshDashboardPeers()
      return
    }

    if (dashboardSubtab === 'performance') {
      await refreshDashboardPerformance()
      return
    }

    await refreshNodeProducerOverview()
  }

  useEffect(() => {
    if (activeTab !== 'producer') {
      setProducerPreviewRegisteredPublicKey(null)
      setProducerRecentBlocks([])
      setProducerRecentBlocksError(null)
      setProducerRecentBlocksLoading(false)
      return
    }
    if (!hasNodeControls) return

    let disposed = false
    let controller: AbortController | null = null
    let inFlight = false

    const tick = async () => {
      if (disposed || inFlight) return
      inFlight = true
      controller?.abort()
      controller = new AbortController()

      try {
        if (!producerSetupComplete) {
          const localInfo = await refreshProducerLocalInfo()
          const nextSigningWalletAddress = activeWalletAddress
          const configuredRuntimeProducerAddress =
            localInfo?.producerAddress?.trim() ||
            producerConfiguredAddress ||
            ''
          const requests: Promise<unknown>[] = []
          if (nextSigningWalletAddress) {
            requests.push(
              refreshProducerRegisteredPublicKeyPreview(nextSigningWalletAddress),
              refreshProducerSigningWalletBalance(nextSigningWalletAddress, activeWalletAccountId || undefined)
            )
          } else if (configuredRuntimeProducerAddress) {
            requests.push(refreshProducerRegisteredPublicKeyPreview(configuredRuntimeProducerAddress, nodeNetworkPublicRpcUrl))
            setProducerSigningWalletBalance(null)
            setProducerSigningWalletBalanceNetwork(null)
            setProducerSigningWalletBalanceError(null)
            setProducerSigningWalletBalanceLoading(false)
          } else {
            setProducerPreviewRegisteredPublicKey(null)
            setProducerSigningWalletBalance(null)
            setProducerSigningWalletBalanceNetwork(null)
            setProducerSigningWalletBalanceError(null)
            setProducerSigningWalletBalanceLoading(false)
          }
          if (configuredRuntimeProducerAddress) {
            requests.push(refreshProducerRecentBlocks(configuredRuntimeProducerAddress, controller.signal, nodeNetworkPublicRpcUrl))
          } else {
            setProducerRecentBlocks([])
            setProducerRecentBlocksError(null)
            setProducerRecentBlocksLoading(false)
          }
          await Promise.all(requests)
          return
        }

        const nextSigningWalletAddress = activeWalletAddress
        const requests: Promise<unknown>[] = [
          refreshNodeProducerOverview(undefined, producerConfiguredAddress || undefined),
          refreshProducerRecentBlocks(producerConfiguredAddress, controller.signal)
        ]

        if (nextSigningWalletAddress) {
          requests.push(refreshProducerSigningWalletBalance(nextSigningWalletAddress, activeWalletAccountId || undefined))
        } else {
          setProducerSigningWalletBalance(null)
          setProducerSigningWalletBalanceNetwork(null)
          setProducerSigningWalletBalanceError(null)
          setProducerSigningWalletBalanceLoading(false)
        }

        await Promise.all(requests)
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, settings.dashboardRefreshSeconds * 1000)

    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(timer)
    }
  }, [
    activeTab,
    hasNodeControls,
    nodeSettings.repoPath,
    nodeSettings.baseDir,
    nodeSettings.network,
    nodeSettings.profiles,
    nodeStatus?.runningServices,
    nodeNetworkPublicRpcUrl,
    producerRpcUrl,
    settings.dashboardProducerWindowBlocks,
    settings.dashboardRefreshSeconds,
    settings.producerAdvancedMode,
    activeWalletAddress,
    activeWalletAccountId,
    producerUseWalletAddress,
    nodeProducerAddressDraft,
    producerSetupComplete,
    producerConfiguredAddress
  ])

  const createNodeProducerLocalKey = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerCreateLocalKey) return

    try {
      setNodeProducerActionLoading('create-key')
      setNodeProducerError(null)
      const result = await bridge.producerCreateLocalKey(toNodeApiSettings(nodeSettings))
      if (!result?.ok) {
        setNodeProducerError(result?.output || t('producer.createLocalKeyFailed'))
        return
      }
      await refreshNodeProducerOverview()
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.createLocalKeyFailed'))
    } finally {
      setNodeProducerActionLoading(null)
    }
  }

  const registerNodeProducer = async (producerAddressOverride?: string) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerRegister) return

    try {
      const signerAccountId = activeWalletAccountId || signingWalletAddress.trim()
      const producerAddress = producerAddressOverride?.trim() || effectiveProducerTargetAddress

      if (!producerVaultExists || !signerAccountId) {
        setNodeProducerError(t('producer.registerNeedsSigningWallet'))
        return
      }

      if (!producerVaultUnlocked) {
        setNodeProducerError(t('producer.registerNeedsUnlock'))
        return
      }

      if (!producerAddress) {
        setNodeProducerError(t('producer.registerNeedsAddress'))
        return
      }

      if (!producerLocalPublicKey) {
        setNodeProducerError(t('producer.registerNeedsLocalKey'))
        return
      }

      setNodeProducerActionLoading('register')
      setNodeProducerError(null)
      setNodeError(null)

      const balanceResult = await refreshProducerSigningWalletBalance(
        signingWalletAddress || undefined,
        activeWalletAccountId || undefined
      )
      const signerManaValue = balanceResult?.mana ? Number.parseFloat(balanceResult.mana) : null
      const hasRegistrationMana =
        balanceResult?.ok &&
        signerManaValue !== null &&
        Number.isFinite(signerManaValue) &&
        signerManaValue >= 0.5

      if (!hasRegistrationMana) {
        if (!balanceResult?.ok) {
          setNodeProducerError(
            balanceResult
              ? formatProducerWalletBalanceError(
                  balanceResult.output || 'Could not load signing wallet balances',
                  producerRpcUrl,
                  language
                )
              : t('producer.signingWalletManaUnknown')
          )
        } else if (signerManaValue === null || !Number.isFinite(signerManaValue)) {
          setNodeProducerError(t('producer.signingWalletManaUnknown'))
        } else {
          setNodeProducerError(t('producer.registerNeedsMana'))
        }
        return
      }

      const result = await bridge.producerRegister({
        ...toNodeApiSettings(nodeSettings),
        rpcUrl: producerRpcUrl,
        producerAddress,
        signerAccountId,
        allowDelegatedSigner: producerAddressOverride ? false : producerAllowDelegatedSigner,
        persistConfig: true,
        persistProfile: true
      })

      setNodeProducerOverview(result.overview)
      setNodeOutput(result.output || '')

      if (!result.ok) {
        setNodeProducerError(result.output || t('producer.unableRegister'))
      } else {
        if (producerAdvancedMode) {
          setNodeProducerAddressDraft(result.overview.producerAddress || nodeProducerAddressDraft.trim())
        }
        await refreshProducerProfile()
        await Promise.all([
          refreshProducerRecentBlocks(result.overview.producerAddress || producerAddress),
          refreshProducerSigningWalletBalance(signingWalletAddress || undefined, activeWalletAccountId || undefined)
        ])
        void refreshNodeStatus()
      }
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableRegister'))
    } finally {
      setNodeProducerActionLoading(null)
    }
  }

  const deleteNodeProducer = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerDelete) return false

    setNodeProducerActionLoading('delete')
    setNodeProducerError(null)
    setNodeError(null)

    try {
      const result = await bridge.producerDelete(toNodeApiSettings(nodeSettings))
      setNodeProducerOverview(result.overview)
      setNodeOutput(result.output || '')

      if (!result.ok) {
        setNodeProducerError(result.output || t('producer.unableDelete'))
        return false
      }

      setNodeProducerAddressDraft('')
      setProducerUseWalletAddress(true)
      setProducerAllowDelegatedSigner(false)
      setProducerRecentBlocks([])
      setProducerRecentBlocksError(null)
      setProducerRecentBlocksLoading(false)
      await refreshProducerProfile()
      return true
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableDelete'))
      return false
    } finally {
      setNodeProducerActionLoading(null)
    }
  }

  const unlockProducerAccount = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.unlock) return false

    setWalletActionLoading('wallet-unlock')
    setWalletError(null)

    try {
      const result = await bridge.unlock({
        password: producerUnlockPassword,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('producer.unlockTitle'))
      setWalletResultData(result)

      if (!result.ok) {
        setWalletError(result.output || t('producer.unlockError'))
        return false
      }

      setProducerUnlockPassword('')
      appendWalletActivity(t('producer.unlockTitle'), result)
      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : result.walletAddress || undefined)
      await refreshProducerSigningWalletBalance(result.walletAddress || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('producer.unlockError'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const importProducerAccount = async (
    privateKeyOverride?: string,
    passwordOverride?: string,
    confirmPasswordOverride?: string
  ) => {
    const bridge = getWalletBridge()
    if (!bridge?.importWallet) return false

    const password = passwordOverride === undefined ? walletImportPassword : passwordOverride
    const confirmPassword = confirmPasswordOverride === undefined ? password : confirmPasswordOverride
    if (password !== confirmPassword) {
      setWalletError(t('wallet.passwordMismatch'))
      return false
    }

    setWalletActionLoading('wallet-import')
    setWalletError(null)

    try {
      const privateKey = privateKeyOverride === undefined ? walletImportPrivateKey.trim() : privateKeyOverride.trim()
      const importResult = await bridge.importWallet({
        privateKey,
        password,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })

      if (importResult.ok && importResult.address) {
        setWalletImportPrivateKey('')
        setWalletImportPassword('')
      }

      setWalletResultTitle(t('wallet.importKeyTitle'))
      setWalletResultData(importResult)
      appendWalletActivity(t('wallet.importKeyTitle'), importResult)

      if (!importResult.ok) {
        setWalletError(importResult.output || t('producer.unableImport'))
        return false
      }

      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : importResult.address || undefined)
      await refreshProducerSigningWalletBalance(importResult.address || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('producer.unableImport'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const importWalletFromSeed = async (
    seedPhraseOverride?: string,
    passwordOverride?: string,
    confirmPasswordOverride?: string
  ) => {
    const bridge = getWalletBridge()
    if (!bridge?.deriveFromSeed || !bridge?.importWallet) return false

    const password = passwordOverride === undefined ? walletImportSeedPassword : passwordOverride
    const confirmPassword = confirmPasswordOverride === undefined ? password : confirmPasswordOverride
    if (password !== confirmPassword) {
      setWalletError(t('wallet.passwordMismatch'))
      return false
    }

    setWalletActionLoading('wallet-import-seed')
    setWalletError(null)

    try {
      const seedPhrase =
        seedPhraseOverride === undefined ? walletImportSeedPhrase.trim() : seedPhraseOverride.trim()
      const derivedResult = await bridge.deriveFromSeed({
        seedPhrase,
        numAccounts: 1
      })

      if (!derivedResult.ok || !derivedResult.accounts[0]?.privateKeyWif) {
        setWalletResultTitle(t('wallet.importSeedTitle'))
        setWalletResultData({
          ok: false,
          output: derivedResult.output,
          address: null,
          derivationPath: null,
          walletFilePath: null,
          unlocked: false
        })
        setWalletError(derivedResult.output || t('wallet.unableImportSeed'))
        return false
      }

      const derivedAccount = derivedResult.accounts[0]
      const importResult = await bridge.importWallet({
        privateKey: derivedAccount.privateKeyWif,
        password,
        seedPhrase,
        derivationPath: derivedAccount.derivationPath,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      const seedImportResult = {
        ok: importResult.ok,
        output: importResult.ok
          ? t('wallet.importSeedSuccess', { address: importResult.address || derivedAccount.address })
          : importResult.output,
        address: importResult.address || derivedAccount.address,
        derivationPath: derivedAccount.derivationPath,
        walletFilePath: importResult.walletFilePath,
        unlocked: importResult.unlocked
      }

      setWalletResultTitle(t('wallet.importSeedTitle'))
      setWalletResultData(seedImportResult)
      appendWalletActivity(t('wallet.importSeedTitle'), seedImportResult)

      if (!importResult.ok) {
        setWalletError(importResult.output || t('wallet.unableImportSeed'))
        return false
      }

      setWalletImportSeedPhrase('')
      setWalletImportSeedPassword('')
      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : importResult.address || undefined)
      await refreshProducerSigningWalletBalance(importResult.address || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableImportSeed'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const createWalletAccount = async (
    password: string,
    confirmPassword: string,
    generatedWalletOverride?: {
      ok?: boolean
      output?: string
      address?: string | null
      privateKeyWif?: string | null
      seedPhrase?: string | null
      derivationPath?: string | null
    } | null
  ) => {
    const bridge = getWalletBridge()
    if (!bridge?.generate || !bridge?.importWallet) return false

    if (password.length < 8) {
      setWalletError(t('wallet.passwordMinLength'))
      return false
    }

    if (password !== confirmPassword) {
      setWalletError(t('wallet.passwordMismatch'))
      return false
    }

    setWalletActionLoading('wallet-create')
    setWalletError(null)

    try {
      const generatedWallet = generatedWalletOverride ?? await bridge.generate()
      if (!generatedWallet.ok || !generatedWallet.privateKeyWif || !generatedWallet.seedPhrase) {
        setWalletResultTitle(t('wallet.createTitle'))
        setWalletResultData(generatedWallet)
        setWalletError(generatedWallet.output || t('wallet.unableCreate'))
        return false
      }

      const importResult = await bridge.importWallet({
        privateKey: generatedWallet.privateKeyWif,
        password,
        seedPhrase: generatedWallet.seedPhrase,
        derivationPath: generatedWallet.derivationPath || undefined,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      const createResult = {
        ok: importResult.ok,
        output: importResult.ok
          ? t('wallet.createSuccess', { address: importResult.address || generatedWallet.address || '' })
          : importResult.output,
        address: importResult.address || generatedWallet.address,
        derivationPath: generatedWallet.derivationPath || null,
        walletFilePath: importResult.walletFilePath,
        unlocked: importResult.unlocked
      }

      setWalletResultTitle(t('wallet.createTitle'))
      setWalletResultData(createResult)
      appendWalletActivity(t('wallet.createTitle'), createResult)

      if (!importResult.ok) {
        setWalletError(importResult.output || t('wallet.unableCreate'))
        return false
      }

      setWalletImportPrivateKey('')
      setWalletImportPassword('')
      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : importResult.address || undefined)
      await refreshProducerSigningWalletBalance(importResult.address || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableCreate'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const generateWalletDraft = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.generate) {
      return {
        ok: false,
        output: t('wallet.unableCreate'),
        address: null,
        privateKeyWif: null,
        seedPhrase: null,
        derivationPath: null
      }
    }

    try {
      return await bridge.generate()
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : t('wallet.unableCreate'),
        address: null,
        privateKeyWif: null,
        seedPhrase: null,
        derivationPath: null
      }
    }
  }

  const showWalletSeed = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.showSeed) {
      return {
        ok: false,
        output: t('wallet.unableShowSeed'),
        walletAddress: activeWalletAddress || null,
        firstAccountAddress: null,
        firstAccountPrivateKeyWif: null,
        firstAccountDerivationPath: null,
        seedPhrase: null
      }
    }

    try {
      return await bridge.showSeed({ network: nodeSettings.network, baseDir: nodeSettings.baseDir })
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : t('wallet.unableShowSeed'),
        walletAddress: activeWalletAddress || null,
        firstAccountAddress: null,
        firstAccountPrivateKeyWif: null,
        firstAccountDerivationPath: null,
        seedPhrase: null
      }
    }
  }

  const appendWalletActivity = (title: string, result: unknown, accountIdOverride?: string | null) => {
    const ok = !(result && typeof result === 'object' && 'ok' in result && !result.ok)
    const output =
      result && typeof result === 'object' && 'output' in result && typeof result.output === 'string'
        ? result.output
        : title
    const accountId = `${accountIdOverride || activeWalletAccountId || ''}`.trim() || null
    const account =
      (accountId ? walletAccounts.find((entry) => entry.id === accountId) : null) ||
      activeWalletAccount ||
      null

    setWalletActivityEntries((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        output,
        at: Date.now(),
        ok,
        accountId: account?.id || accountId,
        accountName: account?.name || null,
        accountAddress: account?.address || activeWalletAddress || null
      },
      ...current
    ].slice(0, 40))
  }

  const setWalletActiveAccount = async (accountId: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.setActiveAccount) return false
    const requestedAccountId = accountId.trim()
    const nextActiveAccount = walletAccounts.find((entry) => entry.id === requestedAccountId) || null
    if (!requestedAccountId || !nextActiveAccount) {
      setWalletError(t('wallet.unableSetActiveAccount'))
      return false
    }
    const previousOverview = walletOverview
    const previousBalance = producerSigningWalletBalance
    const previousBalanceNetwork = producerSigningWalletBalanceNetwork
    const previousBalanceRefreshedAt = walletBalanceRefreshedAt
    const previousBalanceError = producerSigningWalletBalanceError
    const nextCachedBalanceEntry =
      walletBalanceCacheKeys(nodeSettings.network, nextActiveAccount.address, requestedAccountId)
        .map((key) => walletBalanceCache[key])
        .find(Boolean) || null

    setWalletError(null)
    setWalletOverview((current) => {
      if (!current) return current
      return {
        ...current,
        activeAccountId: requestedAccountId,
        activeAccountName: nextActiveAccount.name,
        activeAccountKind: nextActiveAccount.kind,
        walletAddress: nextActiveAccount.address || current.walletAddress
      }
    })

    if (nextCachedBalanceEntry) {
      setProducerSigningWalletBalance(nextCachedBalanceEntry.balance)
      setProducerSigningWalletBalanceNetwork(nodeSettings.network)
      setWalletBalanceRefreshedAt(nextCachedBalanceEntry.refreshedAt)
      setProducerSigningWalletBalanceError(null)
    }

    try {
      const result = await bridge.setActiveAccount({
        accountId: requestedAccountId,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.accountsTitle'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.accountsTitle'), result, result.activeAccountId || requestedAccountId)

      if (!result.ok) {
        setWalletOverview(previousOverview)
        setProducerSigningWalletBalance(previousBalance)
        setProducerSigningWalletBalanceNetwork(previousBalanceNetwork)
        setWalletBalanceRefreshedAt(previousBalanceRefreshedAt)
        setProducerSigningWalletBalanceError(previousBalanceError)
        setWalletError(result.output || t('wallet.unableSetActiveAccount'))
        return false
      }

      const nextActiveAccountId = result.activeAccountId || requestedAccountId
      const confirmedActiveAccount =
        walletAccounts.find((entry) => entry.id === nextActiveAccountId) || nextActiveAccount

      setWalletOverview((current) => {
        if (!current) return current
        return {
          ...current,
          activeAccountId: nextActiveAccountId,
          activeAccountName: confirmedActiveAccount?.name || current.activeAccountName,
          activeAccountKind: confirmedActiveAccount?.kind || current.activeAccountKind,
          walletAddress: confirmedActiveAccount?.address || current.walletAddress
        }
      })

      void refreshWalletOverview()
      void refreshProducerSigningWalletBalance(confirmedActiveAccount?.address, nextActiveAccountId, { silent: true })
      void refreshProducerRegisteredPublicKeyPreview(confirmedActiveAccount?.address || undefined)
      void refreshNodeProducerOverview(
        undefined,
        producerUseWalletAddress
          ? confirmedActiveAccount?.address || undefined
          : producerConfiguredAddress || confirmedActiveAccount?.address || undefined
      )
      return true
    } catch (error) {
      setWalletOverview(previousOverview)
      setProducerSigningWalletBalance(previousBalance)
      setProducerSigningWalletBalanceNetwork(previousBalanceNetwork)
      setWalletBalanceRefreshedAt(previousBalanceRefreshedAt)
      setProducerSigningWalletBalanceError(previousBalanceError)
      setWalletError(error instanceof Error ? error.message : t('wallet.unableSetActiveAccount'))
      return false
    }
  }

  const setWalletAccountAsProducer = async (accountId: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.setProducerAccount) return false

    const requestedAccountId = accountId.trim()
    const targetAccount = walletAccounts.find((entry) => entry.id === requestedAccountId) || null
    if (!requestedAccountId || !targetAccount) {
      setWalletError(t('wallet.unableSetProducerAccount'))
      return false
    }

    setWalletActionLoading('wallet-set-producer')
    setWalletError(null)
    try {
      const result = await bridge.setProducerAccount({
        accountId: requestedAccountId,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.setAsProducerAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.setAsProducerAction'), result, result.activeAccountId || requestedAccountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableSetProducerAccount'))
        return false
      }

      setProducerUseWalletAddress(true)
      setProducerAllowDelegatedSigner(false)
      setNodeProducerAddressDraft('')
      await Promise.all([
        refreshNodeProducerOverview(undefined, targetAccount.address || undefined),
        refreshProducerProfile(),
        refreshProducerRecentBlocks(targetAccount.address || undefined),
        refreshNodeStatus()
      ])
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableSetProducerAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const createWalletDerivedAccount = async (name: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.createDerivedAccount) return false

    setWalletActionLoading('wallet-create-derived-account')
    setWalletError(null)
    try {
      const result = await bridge.createDerivedAccount({
        name: name.trim() || undefined,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.createDerivedAccountAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.createDerivedAccountAction'), result, result.activeAccountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableCreateDerivedAccount'))
        return false
      }

      await refreshWalletOverview()
      await refreshProducerSigningWalletBalance(undefined, result.activeAccountId || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableCreateDerivedAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const importWalletVaultAccount = async (
    privateKey: string,
    password: string,
    confirmPassword: string,
    name = ''
  ) => {
    if (!walletOverview?.walletExists || !walletOverview?.unlocked) {
      return importProducerAccount(privateKey, password, confirmPassword)
    }

    const bridge = getWalletBridge()
    if (!bridge?.importAccount) return false

    if (password !== confirmPassword) {
      setWalletError(t('wallet.passwordMismatch'))
      return false
    }

    setWalletActionLoading('wallet-import-account')
    setWalletError(null)
    try {
      const result = await bridge.importAccount({
        privateKey: privateKey.trim(),
        password,
        name: name.trim() || undefined,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.importAccountAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.importAccountAction'), result, result.activeAccountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableImportAccount'))
        return false
      }

      setWalletImportPrivateKey('')
      setWalletImportPassword('')
      await refreshWalletOverview()
      await refreshProducerSigningWalletBalance(undefined, result.activeAccountId || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableImportAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const importWalletWatchAccount = async (address: string, name = '') => {
    const bridge = getWalletBridge()
    if (!bridge?.importWatchAccount) return false

    setWalletActionLoading('wallet-import-watch-account')
    setWalletError(null)
    try {
      const result = await bridge.importWatchAccount({
        address: address.trim(),
        name: name.trim() || undefined,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.importWatchAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.importWatchAction'), result, result.activeAccountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableImportWatchAccount'))
        return false
      }

      await refreshWalletOverview()
      await refreshProducerSigningWalletBalance(undefined, result.activeAccountId || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableImportWatchAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const restorePublicBootstrapFromSetup = async (backupId: string): Promise<boolean> => {
    const ok = await runRestoreNativeBackupSelected(backupId)
    setFirstRunPublicBootstrapUsed(ok)
    return ok
  }

  const renameWalletVaultAccount = async (accountId: string, name: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.renameAccount) return false

    setWalletActionLoading('wallet-rename-account')
    setWalletError(null)
    try {
      const result = await bridge.renameAccount({
        accountId,
        name: name.trim(),
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir
      })
      setWalletResultTitle(t('wallet.renameAccountAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.renameAccountAction'), result, accountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableRenameAccount'))
        return false
      }

      await refreshWalletOverview()
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableRenameAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const removeWalletVaultAccount = async (accountId: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.removeAccount) return false

    setWalletActionLoading('wallet-remove-account')
    setWalletError(null)
    try {
      const result = await bridge.removeAccount({ accountId, network: nodeSettings.network, baseDir: nodeSettings.baseDir })
      setWalletResultTitle(t('wallet.removeAccountAction'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.removeAccountAction'), result, accountId)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableRemoveAccount'))
        return false
      }

      await refreshWalletOverview()
      await refreshProducerSigningWalletBalance(undefined, result.activeAccountId || undefined)
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableRemoveAccount'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const deleteWalletAccount = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.deleteWallet) return false

    setWalletActionLoading('wallet-delete')
    setWalletError(null)

    try {
      const result = await bridge.deleteWallet({ network: nodeSettings.network, baseDir: nodeSettings.baseDir })
      setWalletResultTitle(t('wallet.deleteTitle'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.deleteTitle'), result)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableDelete'))
        return false
      }

      setWalletImportPrivateKey('')
      setWalletImportPassword('')
      setProducerUnlockPassword('')
      setProducerSigningWalletBalance(null)
      setProducerSigningWalletBalanceNetwork(null)
      setProducerSigningWalletBalanceError(null)
      setProducerSigningWalletBalanceLoading(false)
      await refreshWalletOverview()
      await refreshProducerProfile()
      await refreshNodeProducerOverview()
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableDelete'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const closeWalletAccount = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.closeWallet) return false

    setWalletActionLoading('wallet-close')
    setWalletError(null)

    try {
      const result = await bridge.closeWallet({ network: nodeSettings.network, baseDir: nodeSettings.baseDir })
      setWalletResultTitle(t('wallet.closeTitle'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.closeTitle'), result)

      if (!result.ok) {
        setWalletError(result.output || t('wallet.unableClose'))
        return false
      }

      setProducerUnlockPassword('')
      await refreshWalletOverview()
      return true
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('wallet.unableClose'))
      return false
    } finally {
      setWalletActionLoading(null)
    }
  }

  const refreshWalletOverview = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.overview) return
    setWalletLoading(true)
    setWalletError(null)
    try {
      const result = await bridge.overview({ network: nodeSettings.network, rpcUrl: walletRpcUrl })
      setWalletOverview(result)
      if (!result.ok) {
        setWalletError(result.output || 'Could not load wallet overview')
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Could not load wallet overview')
    } finally {
      setWalletLoading(false)
    }
  }

  const refreshProducerProfile = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerProfileGet) {
      setProducerProfile(null)
      return
    }
    try {
      const result = await bridge.producerProfileGet()
      setProducerProfile(result)
    } catch (error) {
      setProducerProfile({
        ok: false,
        output: error instanceof Error ? error.message : 'Could not load producer profile',
        profileFilePath: '',
        profile: null
      })
    }
  }

  const clearProducerSetup = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.producerProfileClear) return
    try {
      const result = await bridge.producerProfileClear()
      setProducerProfile(result)
      await refreshNodeProducerOverview()
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : 'Could not clear producer setup profile')
    }
  }

  const refreshProducerSigningWalletBalance = async (
    addressOverride?: string,
    accountIdOverride?: string,
    options?: {
      silent?: boolean
      rpcUrlOverride?: string
    }
  ): Promise<TelenoWalletBalanceResult | null> => {
    const bridge = getWalletBridge()
    if (!bridge?.balance) return null
    const silent = Boolean(options?.silent)
    const rpcUrl = options?.rpcUrlOverride?.trim() || producerRpcUrl
    const accountId = accountIdOverride?.trim() || activeWalletAccountId || ''
    const accountAddress =
      (accountId ? walletAccounts.find((account) => account.id === accountId)?.address?.trim() : '') || ''
    const address = addressOverride?.trim() || accountAddress || activeWalletAddress || ''
    if (!address && !accountId) {
      if (!silent) {
        setProducerSigningWalletBalance(null)
        setProducerSigningWalletBalanceNetwork(null)
        setProducerSigningWalletBalanceError(null)
        setProducerSigningWalletBalanceLoading(false)
      }
      return null
    }

    if (!silent) {
      setProducerSigningWalletBalanceLoading(true)
      setProducerSigningWalletBalanceError(null)
    }
    try {
      const result = await bridge.balance({
        network: nodeSettings.network,
        rpcUrl,
        address: address || undefined,
        accountId: accountId || undefined
      })

      if (result.ok) {
        const refreshedAt = Date.now()
        setWalletBalanceCache((current) => {
          const keys = walletBalanceCacheKeys(nodeSettings.network, result.address, accountId)
          if (keys.length === 0) return current
          const nextEntry: WalletBalanceCacheEntry = { balance: result, refreshedAt }
          const next = { ...current }
          for (const key of keys) {
            next[key] = nextEntry
          }
          return next
        })
        setProducerSigningWalletBalance((current) => {
          if (
            current?.ok === result.ok &&
            current?.rpcUrl === result.rpcUrl &&
            current?.address === result.address &&
            current?.koin === result.koin &&
            current?.vhp === result.vhp &&
            current?.mana === result.mana &&
            current?.output === result.output
          ) {
            return current
          }
          return result
        })
        setProducerSigningWalletBalanceNetwork(nodeSettings.network)
        if (!silent) {
          setWalletBalanceRefreshedAt(refreshedAt)
        }
        setProducerSigningWalletBalanceError((current) => (current === null ? current : null))
      } else {
        const nextError = formatProducerWalletBalanceError(
          result.output || 'Could not load signing wallet balances',
          rpcUrl,
          language
        )
        setProducerSigningWalletBalanceError((current) => (current === nextError ? current : nextError))
      }
      return result
    } catch (error) {
      const nextError = formatProducerWalletBalanceError(
        error instanceof Error ? error.message : 'Could not load signing wallet balances',
        rpcUrl,
        language
      )
      setProducerSigningWalletBalanceError((current) => (current === nextError ? current : nextError))
      return null
    } finally {
      if (!silent) {
        setProducerSigningWalletBalanceLoading(false)
      }
    }
  }

  const runWalletAction = async (
    actionId: string,
    title: string,
    runner: () => Promise<unknown>,
    options?: { refreshOverview?: boolean; refreshProducer?: boolean; refreshBalance?: boolean }
  ) => {
    setWalletActionLoading(actionId)
    setWalletError(null)
    try {
      const result = await runner()
      setWalletResultTitle(title)
      setWalletResultData(result)
      appendWalletActivity(title, result)

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setWalletError(
          'output' in result && typeof result.output === 'string' ? result.output : `${title} failed.`
        )
      }

      if (options?.refreshOverview) {
        await refreshWalletOverview()
      }

      if (options?.refreshProducer) {
        await refreshNodeProducerOverview()
      }

      if (options?.refreshBalance) {
        await refreshProducerSigningWalletBalance(
          activeWalletAddress || signingWalletAddress || undefined,
          activeWalletAccountId || undefined,
          { rpcUrlOverride: walletRpcUrl }
        )
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : `${title} failed.`)
    } finally {
      setWalletActionLoading(null)
    }
  }

  const transferWalletToken = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.transferVhp || !bridge?.transferKoin) return
    const amount = Number.parseFloat(walletTransferAmountDraft)
    const toAddress = resolveWalletSendTargetAddress(walletTransferAddressDraft, activeWalletAddress)
    const actionId = walletTransferAsset === 'koin' ? 'wallet-transfer-koin' : 'wallet-transfer-vhp'
    await runWalletAction(actionId, t('wallet.transferTitle'), async () => {
      if (walletTransferAsset === 'koin') {
        return bridge.transferKoin({
          network: nodeSettings.network,
          rpcUrl: walletRpcUrl,
          toAddress,
          amount,
          accountId: activeWalletAccountId || undefined,
          useFreeMana: walletTransferUseFreeMana,
          dryRun: walletTransferDryRun
        })
      }
      return bridge.transferVhp({
        network: nodeSettings.network,
        rpcUrl: walletRpcUrl,
        toAddress,
        amount,
        accountId: activeWalletAccountId || undefined,
        useFreeMana: walletTransferUseFreeMana,
        dryRun: walletTransferDryRun
      })
    }, { refreshProducer: true, refreshBalance: true })
  }

  const burnKoinToVhp = async () => {
    const bridge = getWalletBridge()
    if (!bridge?.burn) return
    const percent = walletBurnPercentDraft.trim() ? Number.parseFloat(walletBurnPercentDraft) : undefined
    const amount = walletBurnAmountDraft.trim() ? Number.parseFloat(walletBurnAmountDraft) : undefined
    const targetAddress = resolveWalletBurnTargetAddress(walletBurnTargetAddressDraft, activeWalletAddress)
    await runWalletAction('wallet-burn', t('wallet.burnTitle'), async () => {
      return bridge.burn({
        network: nodeSettings.network,
        rpcUrl: walletRpcUrl,
        percent,
        amount,
        dryRun: walletBurnDryRun,
        accountId: activeWalletAccountId || undefined,
        targetAddress,
        useFreeMana: walletBurnUseFreeMana,
        useProducerBurnAccount: false
      })
    }, { refreshOverview: true, refreshProducer: true, refreshBalance: true })
  }

  const currentDraftNodeApiSettings = (
    overrides?: Partial<TelenoNodeSettings>
  ): TelenoNodeSettings => {
    return {
      network: overrides?.network ?? draftNodeNetwork,
      repoPath: overrides?.repoPath ?? draftNodeRepoPath.trim(),
      baseDir: overrides?.baseDir ?? draftNodeBaseDir.trim(),
      profiles: overrides?.profiles ?? expandNodeProfiles(parseProfilesCsv(draftNodeProfiles)),
      blockchainBackupUrl: overrides?.blockchainBackupUrl ?? draftNodeBlockchainBackupUrl.trim(),
      backup: overrides?.backup ?? normalizeNodeBackupSettings(draftNodeBackup)
    }
  }

  const setDraftNodeBackupFromUser = useCallback((
    nextBackup: NodeBackupSettings | ((current: NodeBackupSettings) => NodeBackupSettings)
  ) => {
    nativeBackupUserEditedRef.current = true
    setFormError(null)
    setDraftNodeBackup(nextBackup)
  }, [])

  const validateDraftNodeBaseDir = async (baseDirInput: string) => {
    const bridge = getTelenoNodeBridge()
    const rawBaseDir = baseDirInput.trim() || DEFAULT_NODE_SETTINGS.baseDir
    if (!bridge?.validateBaseDir) {
      const normalizedBaseDir = normalizeNodeBaseDirInput(rawBaseDir)
      return {
        ok: true,
        baseDir: normalizedBaseDir,
        restoreWorkspaceParent: normalizedBaseDir.replace(/[\\/]+\.koinos$/, '') || normalizedBaseDir,
        writable: true,
        output: ''
      } satisfies TelenoNodeValidateBaseDirResult
    }

    setNodeBaseDirValidationLoading(true)
    try {
      const result = await bridge.validateBaseDir(currentDraftNodeApiSettings({ baseDir: rawBaseDir }))
      setNodeBaseDirValidation({
        ok: result.ok,
        baseDir: result.baseDir,
        restoreWorkspaceParent: result.restoreWorkspaceParent,
        localCopy: result.localCopy,
        message: result.output || ''
      })
      return result
    } finally {
      setNodeBaseDirValidationLoading(false)
    }
  }

  const pickNodeBaseDir = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.selectBaseDir) return false

    setNodeBaseDirPickerLoading(true)
    setFormError(null)
    setNodeError(null)

    try {
      const result = await bridge.selectBaseDir(currentDraftNodeApiSettings())
      if (!result.ok) {
        setNodeBaseDirValidation({
          ok: false,
          baseDir: result.path,
          restoreWorkspaceParent: result.restoreWorkspaceParent,
          localCopy: result.localCopy,
          message: result.output || ''
        })
        setFormError(result.output || t('node.unableSelectBaseDir'))
        return false
      }

      if (!result.canceled && result.path.trim()) {
        setDraftNodeBaseDir(result.path)
        setNodeBaseDirValidation({
          ok: result.ok,
          baseDir: result.path,
          restoreWorkspaceParent: result.restoreWorkspaceParent,
          localCopy: result.localCopy,
          message: result.output || ''
        })
        setNodeOutput(result.output || `BASEDIR seleccionado: ${result.path}`)
        return true
      }
      return false
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('node.errorOpeningFolderPicker'))
      return false
    } finally {
      setNodeBaseDirPickerLoading(false)
    }
  }

  const loadNodeManagedFile = async (kind: 'config') => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.fileRead) return

    setNodeFileEditorLoading(true)
    setNodeFileEditorSaving(false)
    setNodeFileEditorError(null)
    setNodeFileEditorLastSavedAt(null)

    try {
      const result = await bridge.fileRead({
        ...currentDraftNodeApiSettings(),
        kind
      })

      setNodeFileEditorKind(kind)
      setNodeFileEditorPath(result.filePath)
      setNodeFileEditorContent(result.content ?? '')

      if (!result.ok) {
        setNodeFileEditorError(result.output || t('node.unableReadFile', { kind }))
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : t('node.errorReadingFile', { kind }))
      setNodeFileEditorPath(configFileDisplayPath)
      setNodeFileEditorContent('')
    } finally {
      setNodeFileEditorLoading(false)
    }
  }

  const openNodeFileEditor = async (kind: 'config') => {
    setNodeFileEditorOpen(true)
    setNodeFileEditorKind(kind)
    setNodeFileEditorPath(configFileDisplayPath)
    setNodeFileEditorContent('')
    setNodeFileEditorError(null)
    setNodeFileEditorLastSavedAt(null)
    await loadNodeManagedFile(kind)
  }

  const saveNodeManagedFile = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.fileWrite) return

    setNodeFileEditorSaving(true)
    setNodeFileEditorError(null)
    try {
      const result = await bridge.fileWrite({
        ...currentDraftNodeApiSettings(),
        kind: nodeFileEditorKind,
        content: nodeFileEditorContent
      })

      setNodeFileEditorPath(result.filePath || nodeFileEditorPath)
      if (!result.ok) {
        setNodeFileEditorError(result.output || t('node.unableSaveFile'))
      } else {
        setNodeFileEditorLastSavedAt(Date.now())
        setNodeOutput(result.output || '')
      }
    } catch (error) {
      setNodeFileEditorError(error instanceof Error ? error.message : t('node.errorSavingFile'))
    } finally {
      setNodeFileEditorSaving(false)
    }
  }

  const openServiceLogsModal = (serviceId: string) => {
    setNodeLogsService(serviceId)
    setNodeLogsLevelFilter('all')
    setNodeLogsComponentFilter('all')
    setNodeLogsModalOpen(true)
    setNodeServiceContextMenu(null)
    setNodeLogsError(null)
    setNodeLogsOutput('')
    setNodeLogsLastRefreshAt(null)
    setNodeLogsStreamId(null)
  }

  const stopNodeLogsStream = async (streamIdOverride?: string | null) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.logsFollowStop) return

    const streamId = (streamIdOverride ?? nodeLogsStreamIdRef.current)?.trim() || ''
    if (!streamId) return

    if (nodeLogsStreamIdRef.current === streamId) {
      nodeLogsStreamIdRef.current = null
      setNodeLogsStreamId(null)
    }

    try {
      await bridge.logsFollowStop({ streamId })
    } catch {
      // best effort stop
    }
  }

  const refreshNodeLogs = async (serviceOverride?: string) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.logsFollowStart || !bridge?.logs) return

    const tail = clamp(Number.parseInt(nodeLogsTail, 10) || 200, 20, 2000)
    const serviceId = (serviceOverride ?? nodeLogsService).trim()
    if (!serviceId) {
      setNodeLogsError(t('node.selectServiceForLogs'))
      return
    }

    setNodeLogsLoading(true)
    setNodeLogsError(null)
    setNodeLogsOutput('')
    setNodeLogsLastRefreshAt(null)
    try {
      await stopNodeLogsStream()
      const logsResult = await bridge.logs({
        ...toNodeApiSettings(nodeSettings),
        service: serviceId || undefined,
        tail
      })
      if (!logsResult.ok) {
        throw new Error(logsResult.output || t('node.unableReadLogs', { service: serviceId }))
      }
      setNodeLogsOutput(logsResult.output ?? '')
      setNodeLogsLastRefreshAt(Date.now())

      const result = await bridge.logsFollowStart({
        ...toNodeApiSettings(nodeSettings),
        service: serviceId || undefined,
        tail
      })
      if (!result.ok) {
        setNodeLogsStreamId(null)
        setNodeLogsLoading(false)
        setNodeLogsError(result.output || t('node.unableOpenLogsStream', { service: serviceId }))
        return
      }
      setNodeLogsService(serviceId)
      setNodeLogsStreamId(result.streamId)
      setNodeLogsLoading(false)
    } catch (error) {
      setNodeLogsStreamId(null)
      setNodeLogsError(error instanceof Error ? error.message : t('node.errorLoadingLogs'))
      setNodeLogsLoading(false)
    } finally {
      // loading ends when "start" or first chunk event arrives
    }
  }

  useEffect(() => {
    if (!nodeLogsModalOpen || !nodeLogsService || !hasNodeControls) {
      void stopNodeLogsStream()
      return
    }

    void refreshNodeLogs(nodeLogsService)

    return () => {
      void stopNodeLogsStream()
    }
  }, [nodeLogsModalOpen, nodeLogsService, nodeLogsTail, nodeSettings, hasNodeControls])

  const filteredNodeLogsOutput = useMemo(
    () => filterLogOutput(nodeLogsOutput, {
      level: nodeLogsLevelFilter,
      component: nodeLogsComponentFilter
    }),
    [nodeLogsOutput, nodeLogsLevelFilter, nodeLogsComponentFilter]
  )
  const renderedNodeLogsOutput = useMemo(
    () => (filteredNodeLogsOutput ? renderAnsiLog(filteredNodeLogsOutput) : null),
    [filteredNodeLogsOutput]
  )
  const formatNodeLogsComponentFilterLabel = (component: string) => {
    if (component === 'all') return t('node.logsComponentAll')
    const labelKey = `config.field.features.${component}`
    const label = t(labelKey)
    return label === labelKey
      ? component.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      : label
  }

  const runNodeAction = async (action: NodeAction) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge) return
    setNodeActionLoading(action)
    setNodeError(null)
    try {
      const result =
        action === 'start'
          ? await bridge.start(toNodeApiSettings(nodeSettings))
          : await bridge.stop(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')
      if (!result.ok) {
        setNodeError(
          result.output || (action === 'start' ? t('node.unableStartNode') : t('node.unableStopNode'))
        )
      } else if (action === 'start' && nodeLogsModalOpen && nodeLogsService) {
        void refreshNodeLogs(nodeLogsService)
      }
    } catch (error) {
      setNodeError(
        error instanceof Error
          ? error.message
          : action === 'start'
            ? t('node.errorStartingNode')
            : t('node.errorStoppingNode')
      )
    } finally {
      setNodeActionLoading(null)
    }
  }

  const startObserverNodeFromSetup = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge) {
      return { ok: false, output: t('node.electronOnlyWarning') }
    }

    const observerProfiles = defaultNodeProfilesForNetwork(nodeSettings.network)
    const observerPresetId =
      nodeSettings.network === 'mainnet'
        ? 'profile:mainnet_observer'
        : nodeSettings.network === 'testnet'
          ? 'profile:testnet_observer'
          : 'profile:custom_advanced'
    const observerSettings = {
      ...nodeSettings,
      profiles: observerProfiles
    }
    setNodeActionLoading('start')
    setNodeError(null)
    try {
      const result = bridge.presetReconcile
        ? await bridge.presetReconcile({
            ...toNodeApiSettings(observerSettings),
            presetId: observerPresetId
          })
        : await bridge.start(toNodeApiSettings(observerSettings))
      setNodeSettings(observerSettings)
      setDraftNodeProfiles(observerProfiles)
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')
      if (!result.ok || !result.status.ok) {
        const output = result.output || result.status.output || t('node.unableStartNode')
        setNodeError(output)
        return { ok: false, output }
      }
      setNodeSubtab('overview')
      setActiveTab('node')
      if (nodeLogsModalOpen && nodeLogsService) {
        void refreshNodeLogs(nodeLogsService)
      }
      return { ok: true, output: result.output || result.status.output || '' }
    } catch (error) {
      const output = error instanceof Error ? error.message : t('node.errorStartingNode')
      setNodeError(output)
      return { ok: false, output }
    } finally {
      setNodeActionLoading(null)
    }
  }

  const runNodeRestoreBackup = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.restoreBackup) return

    setNodeRestoreBackupLoading(true)
    setNodeError(null)
    backupProgressSampleRef.current = null
    setNodeBackupProgress(createBackupProgressState('restore-backup', 'prepare', 0, t('node.preparingRestore')))

    try {
      const result = await bridge.restoreBackup(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableRestoreBackup'))
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRestoringBackup'))
    } finally {
      setNodeRestoreBackupLoading(false)
    }
  }
  void runNodeRestoreBackup

  const runNodeRestoreBackupVerify = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.restoreBackupVerify) return

    setNodeRestoreBackupVerifyLoading(true)
    setNodeError(null)
    backupProgressSampleRef.current = null
    setNodeBackupProgress(createBackupProgressState('restore-backup-verify', 'prepare', 0, t('node.preparingRestoreVerify')))

    try {
      const result = await bridge.restoreBackupVerify(toNodeApiSettings(nodeSettings))
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableRestoreVerify'))
      } else {
        setNodeError(null)
        if (nodeLogsModalOpen) {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorRestoringVerify'))
    } finally {
      setNodeRestoreBackupVerifyLoading(false)
    }
  }

  const runCreateBackup = async (backupOverrides: Partial<NodeBackupSettings> = {}) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.createBackup) return

    const backupSettings = normalizeNodeBackupSettings({
      ...normalizeNodeBackupSettings(nodeSettings.backup),
      ...backupOverrides,
      adminEnabled: true
    })
    const createSettings = {
      ...nodeSettings,
      backup: backupSettings.remoteEnabled ? withRemoteBackupDefaults(backupSettings) : backupSettings
    }

    setNodeCreateBackupLoading(true)
    nodeBackupOperationActiveRef.current = true
    setNodeError(null)
    backupProgressSampleRef.current = null
    setNodeBackupProgress(createBackupProgressState('create-backup', 'prepare', 0, t('node.creatingBackup')))

    try {
      const result = await bridge.createBackup(toNodeApiSettings(createSettings))
      if (!result.ok) {
        if (result.status === 'cancelled') {
          setNodeError(null)
          return
        }
        setNodeError(result.output || 'Error creating backup')
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Error creating backup')
    } finally {
      nodeBackupOperationActiveRef.current = false
      setNodeCreateBackupLoading(false)
    }
  }

  const runNativeBackupDryRun = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBackupDryRun) return

    setNodeNativeBackupDryRunLoading(true)
    setNodeError(null)
    backupProgressSampleRef.current = null
    setNodeBackupProgress(createBackupProgressState('create-backup', 'prepare', 0, t('node.checkingNativeBackupConfig')))

    try {
      const result = await bridge.nativeBackupDryRun(toNodeApiSettings(nodeSettings))
      setNodeOutput([
        result.configPath ? `Native backup config: ${result.configPath}` : '',
        result.repositoryDir ? `Native backup repository: ${result.repositoryDir}` : '',
        result.workspaceDir ? `Native backup workspace: ${result.workspaceDir}` : '',
        result.output || ''
      ].filter(Boolean).join('\n'))
      setNodeBackupProgress(createBackupProgressState(
        'create-backup',
        result.ok ? 'complete' : 'error',
        result.ok ? 100 : 0,
        result.ok ? t('node.nativeBackupDryRunComplete') : (result.output || t('node.nativeBackupDryRunFailed'))
      ))
      if (!result.ok) {
        setNodeError(result.output || t('node.nativeBackupDryRunFailed'))
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.nativeBackupDryRunFailed'))
      setNodeBackupProgress(createBackupProgressState(
        'create-backup',
        'error',
        0,
        error instanceof Error ? error.message : t('node.nativeBackupDryRunFailed')
      ))
    } finally {
      setNodeNativeBackupDryRunLoading(false)
    }
  }

  const runNativeBackupList = async (sourceArg: boolean | 'local' | 'remote' | 'public' = false) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBackupList) return null

    const source = sourceArg === true
      ? 'remote'
      : sourceArg === 'remote' || sourceArg === 'public'
        ? sourceArg
        : 'local'
    const setLoading = source === 'public'
      ? setNodeNativeBackupPublicListLoading
      : source === 'remote'
        ? setNodeNativeBackupRemoteListLoading
        : setNodeNativeBackupLocalListLoading
    setLoading(true)
    setNodeError(null)

    try {
      const result = await bridge.nativeBackupList({
        ...toNodeApiSettings(nodeSettings),
        remote: source === 'remote',
        public: source === 'public'
      })
      if (source === 'public') {
        setNodeNativeBackupPublicList(result)
      } else if (source === 'remote') {
        setNodeNativeBackupRemoteList(result)
      } else {
        setNodeNativeBackupLocalList(result)
      }
      setNodeOutput([
        `Native backup list source: ${result.source || source}`,
        result.configPath ? `Native backup config: ${result.configPath}` : '',
        result.repositoryDir ? `Native backup repository: ${result.repositoryDir}` : '',
        result.workspaceDir ? `Native backup workspace: ${result.workspaceDir}` : '',
        result.output || ''
      ].filter(Boolean).join('\n'))
      if (result.ok) {
        const availableIds = new Set([
          'latest',
          ...(source === 'local' ? result.snapshots : nodeNativeBackupLocalList?.snapshots ?? [])
            .map((snapshot) => `local:${snapshot.backupId}`),
          ...(source === 'remote' ? result.snapshots : nodeNativeBackupRemoteList?.snapshots ?? [])
            .map((snapshot) => `remote:${snapshot.backupId}`),
          ...(source === 'public' ? result.snapshots : nodeNativeBackupPublicList?.snapshots ?? [])
            .map((snapshot) => `public:${snapshot.backupId}`)
        ])
        setSelectedNativeBackupId((current) =>
          current === 'latest' || !availableIds.has(current)
            ? result.latestBackupId ? `${source}:${result.latestBackupId}` : 'latest'
            : current
        )
      } else {
        setNodeError(result.output || `Unable to list ${source} native backups`)
      }
      return result
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : `Unable to list ${source} native backups`)
      return null
    } finally {
      setLoading(false)
    }
  }

  const runNativeBackupRestorePreflight = async (backupId = selectedNativeBackupId) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBackupRestorePreflight) return

    setNodeNativeBackupPreflightLoading(true)
    setNodeNativeBackupPreflight(null)
    setNodeError(null)

    try {
      const selectedBackup = parseNativeBackupSelection(
        backupId || 'latest',
        nodeNativeBackupLocalList,
        nodeNativeBackupRemoteList,
        nodeNativeBackupPublicList
      )
      const apiSettings = toNodeApiSettings(nodeSettings)
      const result = await bridge.nativeBackupRestorePreflight({
        ...apiSettings,
        backupId: selectedBackup.backupId,
        backupSource: selectedBackup.source
      })
      setNodeNativeBackupPreflight(result)
      setNodeOutput([
        result.configPath ? `Native backup config: ${result.configPath}` : '',
        result.repositoryDir ? `Native backup repository: ${result.repositoryDir}` : '',
        result.workspaceDir ? `Native backup workspace: ${result.workspaceDir}` : '',
        result.output || ''
      ].filter(Boolean).join('\n'))
      if (!result.ok) {
        setNodeError(result.output || 'Native backup restore preflight failed')
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : 'Native backup restore preflight failed')
    } finally {
      setNodeNativeBackupPreflightLoading(false)
    }
  }

  const runRestoreNativeBackup = async (backupId: string): Promise<boolean> => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.restoreNativeBackupLatest) return false

    const selectedBackup = parseNativeBackupSelection(
      backupId,
      nodeNativeBackupLocalList,
      nodeNativeBackupRemoteList,
      nodeNativeBackupPublicList
    )
    const trimmedBackupId = selectedBackup.backupId
    const apiSettings = toNodeApiSettings(nodeSettings)
    const confirmed = window.confirm(t('node.nativeRestoreConfirm', {
      backupId: trimmedBackupId,
      baseDir: apiSettings.baseDir || nodeSettings.baseDir || ''
    }))
    if (!confirmed) return false

    setNodeRestoreNativeBackupLoading(true)
    setNodeError(null)
    backupProgressSampleRef.current = null
    setNodeBackupProgress(createBackupProgressState('restore-backup', 'prepare', 0, t('node.preparingNativeRestore')))

    try {
      const result =
        !bridge.restoreNativeBackup
          ? await bridge.restoreNativeBackupLatest(apiSettings)
          : await bridge.restoreNativeBackup({
              ...apiSettings,
              backupId: trimmedBackupId,
              backupSource: selectedBackup.source
      })
      setNodeOutput(result.output || '')
      if (!result.ok) {
        if (result.status === 'cancelled') {
          setNodeError(null)
          return false
        }
        setNodeError(result.output || t('node.unableRestoreNativeBackup'))
        return false
      } else {
        setNodeError(null)
        return true
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableRestoreNativeBackup'))
      return false
    } finally {
      setNodeRestoreNativeBackupLoading(false)
    }
  }

  const runRestoreNativeBackupSelected = async (backupId = selectedNativeBackupId): Promise<boolean> => {
    return runRestoreNativeBackup(backupId || 'latest')
  }

  const runPurgeNativeBackup = async (backupId: string) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBackupPurge) return

    const selectedBackup = parseNativeBackupSelection(
      backupId,
      nodeNativeBackupLocalList,
      nodeNativeBackupRemoteList,
      nodeNativeBackupPublicList
    )
    if (selectedBackup.source === 'auto' || selectedBackup.source === 'public' || !selectedBackup.backupId || selectedBackup.backupId === 'latest') {
      setNodeError('Select an exact local or remote backup to purge.')
      return
    }

    const confirmed = window.confirm(t('node.nativePurgeConfirm', {
      backupId: selectedBackup.backupId,
      source: selectedBackup.source
    }))
    if (!confirmed) return

    const purgeSelection = `${selectedBackup.source}:${selectedBackup.backupId}`
    setNodeNativeBackupPurgeLoading(purgeSelection)
    setNodeError(null)

    try {
      const result = await bridge.nativeBackupPurge({
        ...toNodeApiSettings(nodeSettings),
        backupId: selectedBackup.backupId,
        backupSource: selectedBackup.source
      })
      setNodeOutput([
        result.configPath ? `Native backup config: ${result.configPath}` : '',
        result.repositoryDir ? `Native backup repository: ${result.repositoryDir}` : '',
        result.workspaceDir ? `Native backup workspace: ${result.workspaceDir}` : '',
        result.output || ''
      ].filter(Boolean).join('\n'))
      if (!result.ok) {
        setNodeError(result.output || t('node.unablePurgeNativeBackup'))
        return
      }

      setSelectedNativeBackupId('latest')
      await runNativeBackupList(selectedBackup.source === 'remote')
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unablePurgeNativeBackup'))
    } finally {
      setNodeNativeBackupPurgeLoading(null)
    }
  }

  useEffect(() => {
    if (!hasNodeControls || activeTab !== 'node' || nodeSubtab !== 'backups') return

    const backup = normalizeNodeBackupSettings(draftNodeBackup)
    const backupKey = `${nodeSettings.network}|${normalizeNodeBaseDirInput(nodeSettings.baseDir)}`
    if (!dashboardPerformanceLoading && simpleBackupPerformanceRefreshKeyRef.current !== backupKey) {
      simpleBackupPerformanceRefreshKeyRef.current = backupKey
      void refreshDashboardPerformance()
    }

    if (!nodeNativeBackupLocalList && !nodeNativeBackupLocalListLoading) {
      void runNativeBackupList(false)
    }

    if (backup.remoteEnabled && !nodeNativeBackupRemoteList && !nodeNativeBackupRemoteListLoading) {
      void runNativeBackupList(true)
    }

    const publicBootstrapAvailable = Boolean(publicBootstrapUrlForNetwork(nodeSettings.network))
    if (publicBootstrapAvailable && !nodeNativeBackupPublicList && !nodeNativeBackupPublicListLoading) {
      void runNativeBackupList('public')
    }

  }, [
    activeTab,
    dashboardPerformanceLoading,
    draftNodeBackup,
    hasNodeControls,
    nodeNativeBackupLocalList,
    nodeNativeBackupLocalListLoading,
    nodeNativeBackupPublicList,
    nodeNativeBackupPublicListLoading,
    nodeNativeBackupRemoteList,
    nodeNativeBackupRemoteListLoading,
    nodeSettings.baseDir,
    nodeSettings.network,
    nodeSubtab
  ])

  const runCancelBackup = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.cancelCreateBackup) return
    try {
      await bridge.cancelCreateBackup()
    } catch { /* ignore */ }
  }

  const restartNodeForNewBaseDir = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge || !nodeBaseDirChangeDialog) return

    setNodeBaseDirRestartLoading(true)
    setNodeError(null)

    try {
      const stopResult = await bridge.stop(toNodeApiSettings(nodeSettings))
      const startResult = await bridge.start(toNodeApiSettings(nodeSettings))
      setNodeStatus(startResult.status)
      setNodeOutput([stopResult.output, startResult.output].filter(Boolean).join('\n'))

      if (!stopResult.ok || !startResult.ok || !startResult.status.ok) {
        setNodeError(startResult.output || startResult.status.output || t('node.unableRestartBaseDir'))
      } else {
        setNodeError(null)
        setNodeBaseDirChangeDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableRestartBaseDir'))
    } finally {
      setNodeBaseDirRestartLoading(false)
    }
  }

  const copyNodeBaseDirData = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.copyBaseDirData || !nodeBaseDirChangeDialog) return

    setNodeBaseDirCopyLoading(true)
    setNodeError(null)

    try {
      const result = await bridge.copyBaseDirData({
        ...toNodeApiSettings(nodeSettings),
        sourceBaseDir: nodeBaseDirChangeDialog.previousBaseDir,
        targetBaseDir: nodeBaseDirChangeDialog.nextBaseDir,
        stopSourceRuntime: nodeBaseDirChangeDialog.nodeWasRunning
      })
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableCopyBaseDir'))
      } else {
        setNodeError(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.unableCopyBaseDir'))
    } finally {
      setNodeBaseDirCopyLoading(false)
    }
  }

  const runNodeServiceAction = async (serviceId: string, action: NodeServiceAction) => {
    const bridge = getTelenoNodeBridge()
    const serviceStart = bridge?.serviceStart
    const serviceStop = bridge?.serviceStop
    const serviceRestart = bridge?.serviceRestart
    if (!serviceId.trim()) return
    if (action === 'start' && !serviceStart) return
    if (action === 'stop' && !serviceStop) return
    if (action === 'restart' && !serviceRestart) return

    setNodeServiceActionLoading({ serviceId, action })
    setNodeServiceContextMenu(null)
    setNodeError(null)

    try {
      const result =
        action === 'start'
          ? await serviceStart!({ ...toNodeApiSettings(nodeSettings), service: serviceId })
          : action === 'stop'
            ? await serviceStop!({ ...toNodeApiSettings(nodeSettings), service: serviceId })
            : await serviceRestart!({ ...toNodeApiSettings(nodeSettings), service: serviceId })

      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(
          result.output ||
            result.status.output ||
            (action === 'start'
              ? t('node.unableStartService', { service: serviceId })
              : action === 'stop'
                ? t('node.unableStopService', { service: serviceId })
                : t('node.unableRestartService', { service: serviceId }))
        )

        const conflictedService =
          result.status.services.find((service) => service.id === serviceId && service.state === 'conflict') ?? null
        if (conflictedService && canKillNodeConflict(conflictedService)) {
          setNodeConflictDialog({
            serviceId: conflictedService.id,
            serviceName: conflictedService.name,
            conflictPids: conflictedService.conflictPids,
            message:
              conflictedService.lastError ||
              t('node.conflictingProcessDetected', { service: conflictedService.name })
          })
        }
      } else {
        setNodeError(null)
      }

      if ((action === 'start' || action === 'restart') && nodeLogsModalOpen && nodeLogsService === serviceId) {
        void refreshNodeLogs(serviceId)
      }
      if (action === 'stop' && nodeLogsModalOpen && nodeLogsService === serviceId) {
        setNodeLogsModalOpen(false)
      }
    } catch (error) {
      setNodeError(
        error instanceof Error
          ? error.message
          : action === 'start'
            ? t('node.errorStartingService', { service: serviceId })
            : action === 'stop'
              ? t('node.errorStoppingService', { service: serviceId })
              : t('node.errorRestartingService', { service: serviceId })
      )
    } finally {
      setNodeServiceActionLoading(null)
    }
  }

  const openNodeConflictDialog = (service: TelenoNodeServiceStatus) => {
    if (!canKillNodeConflict(service)) return
    setNodeServiceContextMenu(null)
    setNodeConflictDialog({
      serviceId: service.id,
      serviceName: service.name,
      conflictPids: service.conflictPids,
      message: service.lastError || t('node.conflictingProcessDetected', { service: service.name })
    })
  }

  const runNodeKillConflict = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.serviceKillConflict || !nodeConflictDialog) return

    setNodeConflictKillLoading(nodeConflictDialog.serviceId)
    setNodeError(null)

    try {
      const result = await bridge.serviceKillConflict({
        ...toNodeApiSettings(nodeSettings),
        service: nodeConflictDialog.serviceId
      })

      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableKillConflict'))
      } else {
        setNodeError(null)
        setNodeConflictDialog(null)
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorKillingConflict'))
    } finally {
      setNodeConflictKillLoading(null)
    }
  }

  const runNodeNativeBuildAll = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBuildAll) return

    setNodeNativeBuildActionLoading('all')
    setNodeNativeBuildsError(null)

    try {
      const result = await bridge.nativeBuildAll()
      setNodeNativeBuilds(result.builds)
      setNodeOutput(result.output || result.builds.output || '')

      if (!result.ok || !result.builds.ok) {
        setNodeNativeBuildsError(result.output || result.builds.output || t('node.unableCompileWorkspace'))
      }
    } catch (error) {
      setNodeNativeBuildsError(error instanceof Error ? error.message : t('node.errorCompilingServices'))
    } finally {
      setNodeNativeBuildActionLoading(null)
    }
  }
  void runNodeNativeBuildAll

  const runNodeNativeBuildService = async (serviceId: string) => {
    const bridge = getTelenoNodeBridge()
    if (!bridge?.nativeBuildService || !serviceId.trim()) return

    setNodeNativeBuildActionLoading(serviceId)
    setNodeNativeBuildsError(null)

    try {
      const result = await bridge.nativeBuildService({ serviceId })
      setNodeNativeBuilds(result.builds)
      setNodeOutput(result.output || result.builds.output || '')

      if (!result.ok || !result.builds.ok) {
        setNodeNativeBuildsError(
          result.output || result.builds.output || t('node.unableCompileService', { service: serviceId })
        )
      }
    } catch (error) {
      setNodeNativeBuildsError(
        error instanceof Error ? error.message : t('node.errorCompilingService', { service: serviceId })
      )
    } finally {
      setNodeNativeBuildActionLoading(null)
    }
  }
  void runNodeNativeBuildService

  const validateDraftNodeBackup = (
    candidateBackup: NodeBackupSettings | Partial<NodeBackupSettings> = draftNodeBackup,
    options: { sshPassword?: string } = {}
  ) => {
    const backup = normalizeNodeBackupSettings(candidateBackup)
    if (backup.remoteEnabled) {
      if (!backup.sshHost.trim()) throw new Error(t('settings.backupRemoteHostRequired'))
      if (!backup.sshUser.trim()) throw new Error(t('settings.backupRemoteUserRequired'))
      if (!backup.remoteDirectory.trim().startsWith('/')) throw new Error(t('settings.backupRemoteDirectoryRequired'))
      if (backup.sshAuth === 'private-key' && !backup.sshPrivateKeyFile.trim()) {
        throw new Error(t('settings.backupPrivateKeyRequired'))
      }
      if (backup.sshAuth === 'password-file' && !backup.sshPasswordFile.trim() && !options.sshPassword) {
        throw new Error(t('settings.backupPasswordFileRequired'))
      }
    }
    if (backup.scheduleEnabled && !/^\d+(ms|s|m|h|d)?$/.test(backup.scheduleInterval.trim())) {
      throw new Error(t('settings.backupScheduleIntervalInvalid'))
    }
    return backup
  }

  const saveCurrentSettings = async (overrides: {
    backup?: NodeBackupSettings
    suppressBaseDirChangeDialog?: boolean
  } = {}) => {
    if (!settingsDirty && !overrides.backup) return true
    setFormError(null)

    try {
      const publicRpcUrls = parsePublicRpcUrlsInput(draftPublicRpcUrls, language)
      const koinscanUrl = normalizeExternalHttpsUrl(draftKoinscanUrl, DEFAULT_SETTINGS.koinscanUrl)
      const pollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
      const rowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)
      const dashboardProducerWindowBlocks = normalizeDashboardProducerWindowBlocks(draftDashboardProducerWindowBlocks)
      const dashboardRefreshSeconds = normalizeDashboardRefreshSeconds(draftDashboardRefreshSeconds)
      const previousNodeSettings = nodeSettings
      const previousNetwork = previousNodeSettings.network
      const previousBaseDir = normalizeNodeBaseDirInput(previousNodeSettings.baseDir)
      const network = draftNodeNetwork
      const repoPath = draftNodeRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
      const profiles = expandNodeProfiles(parseProfilesCsv(draftNodeProfiles)).join(',')
      const rawBlockchainBackupUrl = draftNodeBlockchainBackupUrl.trim()
      const blockchainBackupUrl = rawBlockchainBackupUrl
        ? normalizeBackupTarGzUrl(rawBlockchainBackupUrl, language)
        : network === 'mainnet'
          ? normalizeBackupTarGzUrl(DEFAULT_NODE_SETTINGS.blockchainBackupUrl, language)
          : ''
      let backup = validateDraftNodeBackup(overrides.backup ?? draftNodeBackup, {
        sshPassword: draftNodeBackupPassword
      })

      if (!repoPath) throw new Error(t('settings.repoRequired'))
      if (!draftNodeBaseDir.trim()) throw new Error(t('settings.baseDirRequired'))

      const baseDirValidation = await validateDraftNodeBaseDir(draftNodeBaseDir)
      if (!baseDirValidation.ok) {
        throw new Error(baseDirValidation.output || t('settings.baseDirNotUsable', { baseDir: draftNodeBaseDir }))
      }
      const baseDir = baseDirValidation.baseDir
      if (backup.remoteEnabled && backup.sshAuth === 'password-file' && draftNodeBackupPassword) {
        const bridge = getTelenoNodeBridge()
        if (!bridge?.saveBackupPasswordFile) {
          throw new Error(t('settings.backupPasswordFileRequired'))
        }
        const passwordResult = await bridge.saveBackupPasswordFile({
          network,
          password: draftNodeBackupPassword
        })
        if (!passwordResult.ok || !passwordResult.filePath) {
          throw new Error(passwordResult.output || t('settings.backupPasswordFileRequired'))
        }
        backup = normalizeNodeBackupSettings({
          ...backup,
          sshPasswordFile: passwordResult.filePath
        })
      }
      const networkChanged = previousNetwork !== network
      const baseDirChanged = previousBaseDir !== baseDir
      const previousNodeWasRunning = (nodeStatus?.services ?? []).some(
        (service) => service.managedByTeleno || isNodeServiceRunning(service)
      )
      let networkStopOutput = ''

      if (networkChanged) {
        const bridge = getTelenoNodeBridge()
        if (bridge?.stop) {
          setNodeActionLoading('stop')
          setNodeError(null)
          try {
            const stopResult = await bridge.stop(toNodeApiSettings(previousNodeSettings))
            setNodeStatus(stopResult.status)
            networkStopOutput = stopResult.output || stopResult.status.output || ''

            if (!stopResult.ok) {
              const output = networkStopOutput || t('node.unableStopNode')
              setNodeError(output)
              throw new Error(output)
            }

            const conflictService = findTelenoNodeConflictService(stopResult.status)
            if (conflictService && bridge.serviceKillConflict) {
              const killResult = await bridge.serviceKillConflict({
                ...toNodeApiSettings(previousNodeSettings),
                service: conflictService.id
              })
              setNodeStatus(killResult.status)
              networkStopOutput = [networkStopOutput, killResult.output || killResult.status.output || '']
                .filter(Boolean)
                .join('\n')

              if (!killResult.ok) {
                const output = killResult.output || killResult.status.output || t('node.unableStopNode')
                setNodeError(output)
                throw new Error(output)
              }
            }
          } catch (error) {
            const output = error instanceof Error ? error.message : t('node.errorStoppingNode')
            setNodeError(output)
            throw new Error(t('settings.networkChangeStopFailed', { output }))
          } finally {
            setNodeActionLoading(null)
          }
        }
      }

      const nextSettings: ExplorerSettings = {
        ...settings,
        publicRpcUrls,
        rpcSource: normalizeExplorerRpcSource(settings.rpcSource, publicRpcUrls, settings.rpcSource),
        koinscanUrl,
        pollMs,
        rowLimit,
        dashboardProducerWindowBlocks,
        dashboardRefreshSeconds
      }
      const nextAppPreferences: AppPreferences = {
        keepRunningInMenuBar: appPreferences.keepRunningInMenuBar === true
      }
      const appConfigBridge = getAppConfigBridge()
      if (appPreferencesLoaded && appConfigBridge?.savePreferences) {
        const preferencesResult = await appConfigBridge.savePreferences(nextAppPreferences)
        if (!preferencesResult.ok) {
          throw new Error(preferencesResult.output || t('settings.menuBarSaveFailed'))
        }
      }

      setSettings(nextSettings)
      setSavedSettings(nextSettings)
      setAppPreferences(nextAppPreferences)
      setSavedAppPreferences(nextAppPreferences)
      setSavedLanguage(language)
      setPublicRpcUrlsByNetwork((current) => ({
        ...current,
        [network]: publicRpcUrls
      }))
      setNodeSettings({ network, repoPath, baseDir, profiles, blockchainBackupUrl, backup })
      setDraftNodeNetwork(network)
      setDraftNodeBaseDir(baseDir)
      setDraftNodeBackup(backup)
      setDraftNodeBackupPassword('')
      const settingsSummary = networkChanged
        ? t('settings.savedNetworkChangedStopped', {
            previous: formatNetworkLabel(previousNetwork),
            next: formatNetworkLabel(network),
            baseDir
          })
        : baseDirChanged
        ? t('settings.savedBaseDirChanged', { previous: previousBaseDir, next: baseDir })
        : t('settings.savedBaseDir', { baseDir })
      setNodeOutput([settingsSummary, networkStopOutput].filter(Boolean).join('\n'))
      if (baseDirChanged && !networkChanged && !overrides.suppressBaseDirChangeDialog) {
        setNodeBaseDirChangeDialog({
          previousBaseDir,
          nextBaseDir: baseDir,
          nodeWasRunning: previousNodeWasRunning
        })
      } else {
        setNodeBaseDirChangeDialog(null)
      }
      setRows([])
      rowsRef.current = []
      setHead(null)
      setIsInitialLoading(true)
      setErrorMessage(null)
      setSettingsUnsavedDialogOpen(false)
      return true
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('settings.invalidConfig'))
      return false
    }
  }

  const applySettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await saveCurrentSettings()
  }

  const restoreDraftSettingsFromSaved = () => {
    const savedPublicRpcUrls = publicRpcUrlsForActiveNetwork(nodeSettings.network, publicRpcUrlsByNetwork)
    setLanguage(savedLanguage)
    setSettings(savedSettings)
    setAppPreferences(savedAppPreferences)
    setDraftPublicRpcUrls(savedPublicRpcUrls.join('\n'))
    setDraftKoinscanUrl(savedSettings.koinscanUrl)
    setDraftPollMs(String(savedSettings.pollMs))
    setDraftRowLimit(String(savedSettings.rowLimit))
    setDraftDashboardProducerWindowBlocks(String(savedSettings.dashboardProducerWindowBlocks))
    setDraftDashboardRefreshSeconds(String(savedSettings.dashboardRefreshSeconds))
    setDraftNodeRepoPath(nodeSettings.repoPath)
    setDraftNodeNetwork(nodeSettings.network)
    setDraftNodeBaseDir(nodeSettings.baseDir)
    setDraftNodeProfiles(nodeSettings.profiles)
    setDraftNodeBlockchainBackupUrl(nodeSettings.blockchainBackupUrl)
    setDraftNodeBackup(normalizeNodeBackupSettings(nodeSettings.backup))
    setDraftNodeBackupPassword('')
    nativeBackupUserEditedRef.current = false
    setNodeBaseDirValidation(null)
    setFormError(null)
  }

  const closeSettingsUnsavedDialog = () => {
    setSettingsUnsavedDialogOpen(false)
    setSettingsUnsavedTargetTab(null)
  }

  const discardSettingsChanges = () => {
    const targetTab = settingsUnsavedTargetTab
    restoreDraftSettingsFromSaved()
    setSettingsUnsavedDialogOpen(false)
    setSettingsUnsavedTargetTab(null)
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab)
    }
  }

  const saveSettingsFromUnsavedDialog = async () => {
    const targetTab = settingsUnsavedTargetTab
    const ok = await saveCurrentSettings()
    if (!ok) return
    setSettingsUnsavedTargetTab(null)
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab)
    }
  }

  const withRemoteBackupDefaults = (backup: NodeBackupSettings): NodeBackupSettings => {
    if (!backup.remoteEnabled) return backup
    const defaults = remoteBackupDefaults(draftNodeNetwork)
    return normalizeNodeBackupSettings({
      ...backup,
      sshAuth: backup.sshAuth || 'private-key',
      sshHost: backup.sshHost || defaults.sshHost,
      sshUser: backup.sshUser || defaults.sshUser,
      remoteDirectory: backup.remoteDirectory || defaults.remoteDirectory,
      sshPrivateKeyFile: backup.sshPrivateKeyFile || defaults.sshPrivateKeyFile,
      sshKnownHostsFile: backup.sshKnownHostsFile || defaults.sshKnownHostsFile,
      adminEnabled: true
    })
  }

  const setSimpleRemoteBackupEnabled = async (enabled: boolean) => {
    const nextBackup = withRemoteBackupDefaults({
      ...normalizeNodeBackupSettings(draftNodeBackup),
      remoteEnabled: enabled
    })
    nativeBackupUserEditedRef.current = true
    setFormError(null)
    setDraftNodeBackup(nextBackup)
    setSimpleRemoteBackupSaving(true)
    try {
      await saveCurrentSettings({ backup: nextBackup })
    } finally {
      setSimpleRemoteBackupSaving(false)
    }
  }

  const resetDefaults = () => {
    setDraftPublicRpcUrls(DEFAULT_SETTINGS.publicRpcUrls.join('\n'))
    setDraftKoinscanUrl(DEFAULT_SETTINGS.koinscanUrl)
    setDraftPollMs(String(DEFAULT_SETTINGS.pollMs))
    setDraftRowLimit(String(DEFAULT_SETTINGS.rowLimit))
    setDraftDashboardProducerWindowBlocks(String(DEFAULT_SETTINGS.dashboardProducerWindowBlocks))
    setDraftDashboardRefreshSeconds(String(DEFAULT_SETTINGS.dashboardRefreshSeconds))
    setSettings((current) => ({
      ...current,
      nodeAdvancedMode: DEFAULT_SETTINGS.nodeAdvancedMode,
      producerAdvancedMode: DEFAULT_SETTINGS.producerAdvancedMode
    }))
    setDraftNodeRepoPath(DEFAULT_NODE_SETTINGS.repoPath)
    setDraftNodeNetwork(DEFAULT_NODE_SETTINGS.network)
    setDraftNodeBaseDir(DEFAULT_NODE_SETTINGS.baseDir)
    setDraftNodeProfiles(DEFAULT_NODE_SETTINGS.profiles)
    setDraftNodeBlockchainBackupUrl(DEFAULT_NODE_SETTINGS.blockchainBackupUrl)
    setDraftNodeBackup(normalizeNodeBackupSettings(DEFAULT_NODE_SETTINGS.backup))
    setNodeBaseDirValidation(null)
    setFormError(null)
  }

  const updateDraftNodeNetwork = (network: KoinosNetworkId) => {
    storeNodeBaseDirForNetwork(draftNodeNetwork, draftNodeBaseDir)
    setDraftNodeNetwork(network)
    setDraftNodeBaseDir(resolveNodeBaseDirForNetwork(network))
    setDraftNodeProfiles(defaultNodeProfilesForNetwork(network))
    setNodeNativeBackupPublicList(null)
    setFirstRunPublicBootstrapUsed(false)
    setNodeBaseDirValidation(null)
    setFormError(null)
    const nextPublicRpcUrls = publicRpcUrlsForActiveNetwork(network, publicRpcUrlsByNetwork)
    setDraftPublicRpcUrls(nextPublicRpcUrls.join('\n'))
    if (network === 'mainnet') {
      setDraftNodeBlockchainBackupUrl((current) => current.trim() || DEFAULT_NODE_SETTINGS.blockchainBackupUrl)
    } else {
      setDraftNodeBlockchainBackupUrl('')
    }
  }

  const completeFirstRunSetup = () => {
    const simpleModeSettings: ExplorerSettings = {
      ...settings,
      nodeAdvancedMode: false,
      producerAdvancedMode: false
    }
    if (window.teleno?.app?.completeFirstRunSetup) {
      void window.teleno.app.completeFirstRunSetup({
        appVersion: pkg.version,
        network: nodeSettings.network,
        baseDir: nodeSettings.baseDir,
        observerProfile: defaultNodeProfilesForNetwork(nodeSettings.network),
        publicBootstrapUsed: firstRunPublicBootstrapUsed,
        completedFrom: 'observer-install-assistant'
      })
    }
    try {
      window.localStorage.setItem(FIRST_RUN_SETUP_STORAGE_KEY, 'complete')
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(simpleModeSettings))
    } catch {
      // If localStorage is unavailable, this session can continue but setup will be required again next launch.
    }
    setSettings(simpleModeSettings)
    setSavedSettings(simpleModeSettings)
    setNodeBaseDirChangeDialog(null)
    setFirstRunSetupOpen(false)
  }

  const runFirstRunSetupAgain = () => {
    if (settingsDirty) {
      setSettingsUnsavedDialogOpen(true)
      return
    }
    if (window.teleno?.app?.resetFirstRunSetup) {
      void window.teleno.app.resetFirstRunSetup()
    }
    try {
      window.localStorage.removeItem(FIRST_RUN_SETUP_STORAGE_KEY)
    } catch {
      // The Electron marker is the source of truth for packaged installs.
    }
    setFirstRunPublicBootstrapUsed(false)
    setNodeBaseDirChangeDialog(null)
    setFirstRunSetupOpen(true)
  }

  const quitUnfinishedFirstRunSetup = () => {
    if (window.teleno?.app?.resetFirstRunSetup) {
      void window.teleno.app.resetFirstRunSetup()
    }
    try {
      window.localStorage.removeItem(FIRST_RUN_SETUP_STORAGE_KEY)
    } catch {
      // If localStorage is unavailable, the assistant will open again on next launch.
    }
    if (window.teleno?.app?.quit) {
      void window.teleno.app.quit()
    } else {
      window.close()
    }
  }

  const requestActiveTab = (nextTab: AppTab) => {
    if (!REMOTE_NODE_MANAGEMENT_ENABLED && nextTab === 'remote') return
    if (nextTab === activeTab) return
    if (activeTab === 'settings' && nextTab !== 'settings' && settingsDirty) {
      setSettingsUnsavedTargetTab(nextTab)
      setSettingsUnsavedDialogOpen(true)
      return
    }
    if (nextTab === 'settings') {
      setFormError(null)
    }
    setActiveTab(nextTab)
  }

  const openVersionChangelog = () => {
    setDocumentationPath(changelogPathForVersion(appVersion))
    requestActiveTab('documentation')
  }

  const renderWalletPanel = (setupMode = false) => (
    <WalletPanel
      t={t}
      hasWalletControls={hasWalletControls}
      walletOverview={walletOverview}
      walletLoading={walletLoading}
      walletActionLoading={walletActionLoading}
      walletError={walletError}
      producerConfiguredAddress={producerConfiguredAddress}
      network={nodeSettings.network}
      nativeTokenSymbol={nativeTokenSymbol}
      walletBalance={walletDisplayBalance}
      walletBalanceLoading={producerSigningWalletBalanceLoading}
      walletBalanceError={producerSigningWalletBalanceError}
      walletBalanceRefreshedAt={walletDisplayBalanceRefreshedAt}
      walletImportPrivateKey={walletImportPrivateKey}
      setWalletImportPrivateKey={setWalletImportPrivateKey}
      walletImportPassword={walletImportPassword}
      setWalletImportPassword={setWalletImportPassword}
      walletImportSeedPhrase={walletImportSeedPhrase}
      setWalletImportSeedPhrase={setWalletImportSeedPhrase}
      walletImportSeedPassword={walletImportSeedPassword}
      setWalletImportSeedPassword={setWalletImportSeedPassword}
      walletUnlockPassword={producerUnlockPassword}
      setWalletUnlockPassword={setProducerUnlockPassword}
      importWalletAccount={importWalletVaultAccount}
      replaceWalletAccount={importProducerAccount}
      importWalletFromSeed={importWalletFromSeed}
      createWalletAccount={createWalletAccount}
      generateWalletDraft={generateWalletDraft}
      showWalletSeed={showWalletSeed}
      closeWalletAccount={closeWalletAccount}
      deleteWalletAccount={deleteWalletAccount}
      unlockWalletAccount={unlockProducerAccount}
      walletTransferAsset={walletTransferAsset}
      setWalletTransferAsset={setWalletTransferAsset}
      walletTransferAddressDraft={walletTransferAddressDraft}
      setWalletTransferAddressDraft={setWalletTransferAddressDraft}
      walletTransferAmountDraft={walletTransferAmountDraft}
      setWalletTransferAmountDraft={setWalletTransferAmountDraft}
      walletTransferDryRun={walletTransferDryRun}
      setWalletTransferDryRun={setWalletTransferDryRun}
      walletTransferUseFreeMana={walletTransferUseFreeMana}
      setWalletTransferUseFreeMana={setWalletTransferUseFreeMana}
      transferWalletToken={transferWalletToken}
      walletBurnTargetAddressDraft={walletBurnTargetAddressDraft}
      setWalletBurnTargetAddressDraft={setWalletBurnTargetAddressDraft}
      walletBurnPercentDraft={walletBurnPercentDraft}
      setWalletBurnPercentDraft={setWalletBurnPercentDraft}
      walletBurnAmountDraft={walletBurnAmountDraft}
      setWalletBurnAmountDraft={setWalletBurnAmountDraft}
      walletBurnDryRun={walletBurnDryRun}
      setWalletBurnDryRun={setWalletBurnDryRun}
      walletBurnUseFreeMana={walletBurnUseFreeMana}
      setWalletBurnUseFreeMana={setWalletBurnUseFreeMana}
      burnKoinToVhp={burnKoinToVhp}
      advancedMode={appAdvancedMode}
      walletResultData={walletResultData}
      walletResultTitle={walletResultTitle}
      walletResultText={walletResultText}
      walletActivityEntries={walletActivityEntries}
      activeWalletAccount={activeWalletAccount}
      activeWalletAccountId={activeWalletAccountId}
      activeWalletAddress={activeWalletAddress}
      activeWalletCanSign={activeWalletCanSign}
      setWalletActiveAccount={setWalletActiveAccount}
      setWalletAccountAsProducer={setWalletAccountAsProducer}
      createWalletDerivedAccount={createWalletDerivedAccount}
      importWalletWatchAccount={importWalletWatchAccount}
      renameWalletVaultAccount={renameWalletVaultAccount}
      removeWalletVaultAccount={removeWalletVaultAccount}
      setupMode={setupMode}
    />
  )

  const openBlockInExplorer = (block: BlockRow) => {
    const existingBlock = rowsRef.current.find((row) => row.blockId === block.blockId)
    const nextSelectedBlock = existingBlock ?? block

    if (!existingBlock) {
      const nextRows = [...rowsRef.current, block].sort((a, b) => b.height - a.height)
      rowsRef.current = nextRows
      setRows(nextRows)
    }

    selectedBlockRef.current = nextSelectedBlock
    setSelectedBlockRpcUrl(producerRpcUrl)
    setSelectedBlock(nextSelectedBlock)
    requestActiveTab('explorer')
  }

  return (
    <div className={`app-shell ${firstRunSetupOpen ? 'is-first-run-locked' : ''}`.trim()}>
      <div className="app-background" aria-hidden="true" />

      <div className="app-chrome">
        <nav className="tabs-bar" aria-label={t('sections.aria')}>
          <div className="app-brand" aria-label={t('app.name')}>
            <img className="app-brand-logo" src={appLogoUrl} alt="" aria-hidden="true" />
            {(activeTab === 'settings' ? draftNodeNetwork : nodeSettings.network) === 'testnet' && (
              <span className="app-brand-network">(Testnet)</span>
            )}
          </div>
          <div className="tabs-list" role="tablist" aria-label={t('tabs.aria')}>
            <button
              id="tab-explorer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'explorer'}
              aria-controls="panel-explorer"
              className={`tab-button ${activeTab === 'explorer' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('explorer')}
            >
              {t('tab.explorer')}
            </button>
            <button
              id="tab-dashboard"
              type="button"
              role="tab"
              aria-selected={activeTab === 'dashboard'}
              aria-controls="panel-dashboard"
              className={`tab-button ${activeTab === 'dashboard' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('dashboard')}
            >
              {t('tab.dashboard')}
            </button>
            <button
              id="tab-node"
              type="button"
              role="tab"
              aria-selected={activeTab === 'node'}
              aria-controls="panel-node"
              className={`tab-button ${activeTab === 'node' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('node')}
            >
              {t('tab.node')}
            </button>
            {REMOTE_NODE_MANAGEMENT_ENABLED && (
              <button
                id="tab-remote"
                type="button"
                role="tab"
                aria-selected={activeTab === 'remote'}
                aria-controls="panel-remote"
                className={`tab-button ${activeTab === 'remote' ? 'is-active' : ''}`.trim()}
                onClick={() => requestActiveTab('remote')}
              >
                {t('tab.remote')}
              </button>
            )}
            <button
              id="tab-producer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'producer'}
              aria-controls="panel-producer"
              className={`tab-button ${activeTab === 'producer' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('producer')}
            >
              {t('tab.producer')}
            </button>
            <button
              id="tab-wallet"
              type="button"
              role="tab"
              aria-selected={activeTab === 'wallet'}
              aria-controls="panel-wallet"
              className={`tab-button ${activeTab === 'wallet' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('wallet')}
            >
              {t('tab.wallet')}
            </button>
            <button
              id="tab-documentation"
              type="button"
              role="tab"
              aria-selected={activeTab === 'documentation'}
              aria-controls="panel-documentation"
              className={`tab-button ${activeTab === 'documentation' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('documentation')}
            >
              {t('tab.documentation')}
            </button>
            <button
              id="tab-settings"
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              aria-controls="panel-settings"
              className={`tab-button ${activeTab === 'settings' ? 'is-active' : ''}`.trim()}
              onClick={() => requestActiveTab('settings')}
            >
              {t('tab.settings')}
            </button>
          </div>
        </nav>
      </div>

      <div className={`app-content ${hasAppOverlayOpen ? 'has-overlay' : ''} ${activeTab === 'documentation' ? 'is-documentation' : ''}`.trim()}>

      {activeTab === 'settings' && (
        <SettingsPanel
          t={t}
          applySettings={applySettings}
          language={language}
          setLanguage={setLanguage}
          settings={settings}
          setSettings={setSettings}
          appPreferences={appPreferences}
          setAppPreferences={setAppPreferences}
          draftPublicRpcUrls={draftPublicRpcUrls}
          setDraftPublicRpcUrls={setDraftPublicRpcUrls}
          draftKoinscanUrl={draftKoinscanUrl}
          setDraftKoinscanUrl={setDraftKoinscanUrl}
          draftPollMs={draftPollMs}
          setDraftPollMs={setDraftPollMs}
          draftRowLimit={draftRowLimit}
          setDraftRowLimit={setDraftRowLimit}
          draftDashboardProducerWindowBlocks={draftDashboardProducerWindowBlocks}
          setDraftDashboardProducerWindowBlocks={setDraftDashboardProducerWindowBlocks}
          draftDashboardRefreshSeconds={draftDashboardRefreshSeconds}
          setDraftDashboardRefreshSeconds={setDraftDashboardRefreshSeconds}
          draftNodeNetwork={draftNodeNetwork}
          setDraftNodeNetwork={updateDraftNodeNetwork}
          hasNodeControls={hasNodeControls}
          draftNodeBackup={draftNodeBackup}
          setDraftNodeBackup={setDraftNodeBackupFromUser}
          draftNodeBackupPassword={draftNodeBackupPassword}
          setDraftNodeBackupPassword={setDraftNodeBackupPassword}
          runNativeBackupDryRun={runNativeBackupDryRun}
          nodeBusy={nodeBusy}
          nodeSettings={nodeSettings}
          nodeNativeBackupDryRunLoading={nodeNativeBackupDryRunLoading}
          draftNodeBaseDir={draftNodeBaseDir}
          setDraftNodeBaseDir={setDraftNodeBaseDir}
          setNodeBaseDirValidation={setNodeBaseDirValidation}
          validateDraftNodeBaseDir={validateDraftNodeBaseDir}
          setFormError={setFormError}
          pickNodeBaseDir={pickNodeBaseDir}
          nodeBaseDirPickerLoading={nodeBaseDirPickerLoading}
          nodeBaseDirValidationLoading={nodeBaseDirValidationLoading}
          nodeBaseDirValidation={nodeBaseDirValidation}
          formError={formError}
          resetDefaults={resetDefaults}
          settingsDirty={settingsDirty}
          onBlockedSettingsNavigation={() => setSettingsUnsavedDialogOpen(true)}
          onRunFirstRunSetup={runFirstRunSetupAgain}
          appBuildInfo={appBuildInfo}
        />
      )}

      {activeTab === 'dashboard' && (
        <DashboardPanel
          t={t}
          locale={locale}
          hasNodeControls={hasNodeControls}
          dashboardSubtab={dashboardSubtab}
          setDashboardSubtab={setDashboardSubtab}
          dashboardProducerWindowBlocks={settings.dashboardProducerWindowBlocks}
          dashboardProducers={dashboardProducers}
          dashboardProducersLoading={dashboardProducersLoading}
          dashboardProducersError={dashboardProducersError}
          dashboardPeers={dashboardPeers}
          dashboardPeersLoading={dashboardPeersLoading}
          dashboardPeersError={dashboardPeersError}
          dashboardPerformance={dashboardPerformance}
          dashboardPerformanceLoading={dashboardPerformanceLoading}
          dashboardPerformanceError={dashboardPerformanceError}
          nodeProducerOverview={nodeProducerOverview}
          ownProducerAddress={nodeProducerOverview?.producerAddress || producerConfiguredAddress}
          nodeProducerLoading={nodeProducerLoading}
          nodeProducerError={nodeProducerError}
        />
      )}

      <NodeFileEditorModal
        t={t}
        nodeFileEditorOpen={nodeFileEditorOpen}
        setNodeFileEditorOpen={setNodeFileEditorOpen}
        nodeFileEditorKind={nodeFileEditorKind}
        nodeFileEditorPath={nodeFileEditorPath}
        loadNodeManagedFile={loadNodeManagedFile}
        hasNodeControls={hasNodeControls}
        nodeFileEditorLoading={nodeFileEditorLoading}
        nodeFileEditorSaving={nodeFileEditorSaving}
        saveNodeManagedFile={saveNodeManagedFile}
        nodeFileEditorLastSavedAt={nodeFileEditorLastSavedAt}
        locale={locale}
        nodeFileEditorError={nodeFileEditorError}
        nodeFileEditorContent={nodeFileEditorContent}
        setNodeFileEditorContent={setNodeFileEditorContent}
      />

      {activeTab === 'node' && (
      <section id="panel-node" className="node-panel" aria-label={t('node.panelAria')} role="tabpanel" aria-labelledby="tab-node">
        {!hasNodeControls && (
          <div className="node-warning" role="note">
            {t('node.electronOnlyWarning')}
          </div>
        )}

        {hasNodeControls && nodeStatus && !nodeStatus.ok && /repo path not found/i.test(nodeStatus.output) && (
          <div className="node-warning" role="note">
            {t('node.repoMissingWarning', { repoPath: nodeSettings.repoPath })}
          </div>
        )}

        {hasNodeControls && nodeHasPartialOutage && (
          <div className="node-warning" role="note">
            {t('node.partialOutagePrefix')} <strong>{nodeStoppedServices.map((service) => service.name).join(', ')}</strong>.
            {t('node.partialOutageNativeDetail')}
          </div>
        )}

        {nodeError && (
          <div className="error-banner node-error-banner" role="alert">
            <span>{nodeError}</span>
          </div>
        )}

        {producerStartBlockedReason && (
          <div className="node-warning node-busy-banner" role="alert">
            <strong>{t('node.startBlockedTitle')}</strong>
            <span>{t('node.startBlockedProducerSetup')}</span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setActiveTab('producer')}
            >
              {t('node.openProducerTab')}
            </button>
          </div>
        )}

        {(activeBackupProgress || nodeRestoreBackupLoading || nodeRestoreNativeBackupLoading || nodeCreateBackupLoading) && (
          <div className="node-warning node-busy-banner" role="status">
            <strong>{activeBackupActionLabel || t('status.restoringBackup')}</strong>
            <span>
              {t('node.busyBackupNotice')}
              {activeBackupMeta ? ` · ${activeBackupMeta}` : ''}
            </span>
          </div>
        )}

        <div className="node-subtabs settings-tabs" role="tablist" aria-label="Node views">
          <button
            type="button"
            role="tab"
            aria-selected={nodeSubtab === 'overview'}
            className={`settings-tab-button ${nodeSubtab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setNodeSubtab('overview')}
          >
            {t('node.subtabOverview')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={nodeSubtab === 'backups'}
            className={`settings-tab-button ${nodeSubtab === 'backups' ? 'is-active' : ''}`}
            onClick={() => setNodeSubtab('backups')}
          >
            {t('node.subtabBackups')}
          </button>
        </div>

        {nodeSubtab === 'overview' && (
        <div className="node-services node-single-node">
          <div className="node-panel-actions node-operation-actions">
            <span className="node-active-preset">
              {t('node.activePreset', { label: activeNodePresetLabel })}
            </span>
            {pendingNodePresetLabel && (
              <span className="node-pending-preset">
                {t('node.pendingPreset', { label: pendingNodePresetLabel })}
              </span>
            )}
            <span className="node-action-tooltip-wrap" title={nodePresetsTooltip}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setNodeProfilesModalOpen(true)}
                disabled={!hasNodeControls}
              >
                {t('node.profilesTitle')}
              </button>
            </span>
            <span className="node-action-tooltip-wrap" title={nodeStartTooltip}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void runNodeAction('start')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeRunningCount > 0 || producerStartBlockedReason !== null}
              >
                {nodeActionLoading === 'start' ? t('common.starting') : t('node.startNode')}
              </button>
            </span>
            <span className="node-action-tooltip-wrap" title={nodeLogsTooltip}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  if (nodePrimaryService) openServiceLogsModal(nodePrimaryService.id)
                }}
                disabled={!hasNodeControls || nodeBusy || !nodePrimaryService}
              >
                {t('common.logs')}
              </button>
            </span>
            <span className="node-action-tooltip-wrap" title={nodeRestartTooltip}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  if (nodePrimaryService) void runNodeServiceAction(nodePrimaryService.id, 'restart')
                }}
                disabled={
                  !hasNodeControls ||
                  nodeBusy ||
                  !nodePrimaryService ||
                  producerStartBlockedReason !== null ||
                  nodePrimaryCapabilities?.restartBlockedReason !== null
                }
              >
                {nodePrimaryService &&
                nodeServiceActionLoading?.serviceId === nodePrimaryService.id &&
                nodeServiceActionLoading.action === 'restart'
                  ? t('common.restarting')
                  : t('common.restart')}
              </button>
            </span>
            <span className="node-action-tooltip-wrap" title={nodeStopTooltip}>
              <button
                type="button"
                className="ghost-button danger-button"
                onClick={() => {
                  void runNodeAction('stop')
                }}
                disabled={!hasNodeControls || nodeBusy}
              >
                {nodeActionLoading === 'stop' ? t('common.stopping') : t('node.stopNode')}
              </button>
            </span>
          </div>
          {nodePrimaryService && nodePrimaryCapabilities ? (
            <section
              className="node-control-surface"
              title={nodePrimaryTooltip}
              onContextMenu={(event) => {
                event.preventDefault()
                setNodeServiceContextMenu({
                  serviceId: nodePrimaryService.id,
                  x: event.clientX,
                  y: event.clientY
                })
              }}
            >
              <div className="node-control-summary">
                <article>
                  <span>{t('node.detailPid')}</span>
                  <strong className="mono">{nodePrimaryPid}</strong>
                  <small>{t('common.version')}: {nodePrimaryVersion}</small>
                </article>
                <article>
                  <span>{t('node.detailJsonRpc')}</span>
                  <strong className="mono">{localNodeRpcUrl}</strong>
                  <small>{nodePrimaryRunning ? t('status.live') : t('common.status')}: {nodePrimaryService.state}</small>
                </article>
                <article>
                  <span>{t('node.detailP2p')}</span>
                  <strong className="mono">{nodeP2pEndpoint}</strong>
                  <small>{t('node.detailPorts')}: {nodePrimaryPorts}</small>
                </article>
              </div>

              <div className="node-control-details">
                {appAdvancedMode && (
                  <section className="node-runtime-detail">
                    <h4>{t('node.detailRuntime')}</h4>
                    <div className="node-runtime-cards">
                      <article>
                        <span>{t('node.detailPreset')}</span>
                        <strong>{activeNodePresetLabel}</strong>
                        {pendingNodePresetLabel && (
                          <small>{t('node.pendingPreset', { label: pendingNodePresetLabel })}</small>
                        )}
                      </article>
                      <article>
                        <span>{t('common.version')}</span>
                        <strong className="mono" title={nodePrimaryVersion}>
                          {nodePrimaryVersion}
                        </strong>
                      </article>
                      <article>
                        <span>{t('node.detailBaseDir')}</span>
                        <strong className="mono" title={nodeStatus?.baseDir || nodeSettings.baseDir}>
                          {nodeStatus?.baseDir || nodeSettings.baseDir || t('common.na')}
                        </strong>
                      </article>
                      <article>
                        <span>{t('node.detailConfigPath')}</span>
                        <strong className="mono" title={nodePrimaryConfigPath}>
                          {nodePrimaryConfigPath}
                        </strong>
                      </article>
                      <article>
                        <span>{t('node.detailBinaryPath')}</span>
                        <strong className="mono" title={nodePrimaryBinaryPath}>
                          {nodePrimaryBinaryPath}
                        </strong>
                      </article>
                      <article>
                        <span>{t('node.detailLogPath')}</span>
                        <strong className="mono" title={nodePrimaryLogPath}>
                          {nodePrimaryLogPath}
                        </strong>
                      </article>
                    </div>
                  </section>
                )}

                <section className="node-components-detail">
                  <h4>{t('node.detailComponents')}</h4>
                  {nodePanelOptionalComponents.length > 0 ? (
                    <div className="component-health-grid node-component-health-grid">
                      {nodePanelOptionalComponents.map((component) => {
                        const labelKey = `config.field.features.${component.name}`
                        const label = t(labelKey) === labelKey ? component.name : t(labelKey)
                        const componentState = component.state ?? (
                          !component.enabled ? 'disabled' : component.healthy ? 'running' : 'waiting'
                        )
                        return (
                          <span
                            key={component.name}
                            className={`component-health-item is-${component.enabled ? 'enabled' : 'disabled'} runtime-${componentState}`.trim()}
                            title={`${label}: ${component.enabled ? t('node.componentEnabled') : t('node.componentDisabled')}${component.details ? ` · ${component.details}` : ''}`}
                          >
                            <span className="component-health-indicator" aria-hidden="true" />
                            <span className="component-health-name">{label}</span>
                            <span className="component-health-state">
                              {component.enabled ? t('node.componentEnabledShort') : t('node.componentDisabledShort')}
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="node-empty">{t('node.noComponentHealth')}</p>
                  )}
                  <p className="node-control-meta">
                    {t('node.componentSummary', {
                      enabled: nodeEnabledComponents.length,
                      disabled: nodeDisabledComponents.length
                    })}
                  </p>
                </section>
              </div>

              {nodePrimaryService.lastError && (
                <p className="node-inline-error" role="alert">{nodePrimaryService.lastError}</p>
              )}
            </section>
          ) : (
            <p className="node-empty">
              {nodeStatusLoading ? t('node.checkingServices') : t('node.noServices')}
            </p>
          )}
        </div>
        )}

        {nodeSubtab === 'backups' && (
          <NodeBackupsPanel
            t={t}
            locale={locale}
            hasNodeControls={hasNodeControls}
            nodeBusy={nodeBusy}
            settingsDirty={settingsDirty}
            advancedMode={settings.nodeAdvancedMode}
            nodeSettings={nodeSettings}
            draftNodeBackup={draftNodeBackup}
            nodeStatus={nodeStatus}
            nodePrimaryConfigPath={nodePrimaryConfigPath}
            runCreateBackup={runCreateBackup}
            runCancelBackup={runCancelBackup}
            runNativeBackupList={runNativeBackupList}
            runNativeBackupRestorePreflight={runNativeBackupRestorePreflight}
            runRestoreNativeBackupSelected={runRestoreNativeBackupSelected}
            runPurgeNativeBackup={runPurgeNativeBackup}
            nodeCreateBackupLoading={nodeCreateBackupLoading}
            nodeNativeBackupListLoading={nodeNativeBackupListLoading}
            nodeNativeBackupLocalListLoading={nodeNativeBackupLocalListLoading}
            nodeNativeBackupRemoteListLoading={nodeNativeBackupRemoteListLoading}
            nodeNativeBackupPublicListLoading={nodeNativeBackupPublicListLoading}
            nodeNativeBackupLocalList={nodeNativeBackupLocalList}
            nodeNativeBackupRemoteList={nodeNativeBackupRemoteList}
            nodeNativeBackupPublicList={nodeNativeBackupPublicList}
            nodeNativeBackupPreflightLoading={nodeNativeBackupPreflightLoading}
            nodeNativeBackupPreflight={nodeNativeBackupPreflight}
            selectedNativeBackupId={selectedNativeBackupId}
            setSelectedNativeBackupId={setSelectedNativeBackupId}
            nodeRestoreNativeBackupLoading={nodeRestoreNativeBackupLoading}
            nodeNativeBackupPurgeLoading={nodeNativeBackupPurgeLoading}
            simpleRemoteBackupSaving={simpleRemoteBackupSaving}
            setSimpleRemoteBackupEnabled={setSimpleRemoteBackupEnabled}
            dashboardPerformance={dashboardPerformance}
            dashboardPerformanceLoading={dashboardPerformanceLoading}
            formError={formError}
            nodeBackupProgress={nodeBackupProgress}
            openSettings={() => requestActiveTab('settings')}
          />
        )}

        {appAdvancedMode && nodeOutput && (
          <div className="node-output">
            <div className="node-services-header">
              <h3>{t('node.commandOutput')}</h3>
            </div>
            <pre>{nodeOutput}</pre>
          </div>
        )}

        {nodeProfilesModalOpen && (
          <div
            className="log-modal-backdrop node-profiles-backdrop"
            role="presentation"
            onClick={() => setNodeProfilesModalOpen(false)}
          >
            <section
              className="log-modal node-profiles-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-profiles-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <h3 id="node-profiles-modal-title" className="log-modal-title">
                    {t('node.profilesTitle')}
                  </h3>
                  <p className="log-modal-meta">{nodePresetSummaryText}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeProfilesModalOpen(false)}
                >
                  {t('common.close')}
                </button>
              </header>

              <div className="node-profiles-modal-body">
                {nodePresetsError && (
                  <div className="node-inline-error node-presets-error" role="alert">
                    {nodePresetsError}
                  </div>
                )}

                {nodePresetsLoading ? (
                  <p className="node-empty">{t('node.loadingProfiles')}</p>
                ) : nodePresets.length > 0 ? (
                  <div className="node-preset-list">
                    {nodePresets.map((preset) => {
                      const selected = selectedNodePreset?.id === preset.id
                      const matchesRunningState = presetMatchesNodeState(preset)
                      const presetLabel = formatNodePresetLabel(preset)
                      const presetDescription = formatNodePresetDescription(preset)
                      return (
                        <article
                          key={preset.id}
                          className={`node-preset-card ${selected ? 'is-selected' : ''} ${nodeBusy ? 'is-disabled' : ''}`.trim()}
                          title={presetDescription}
                        >
                          <span className="node-preset-label">{presetLabel}</span>
                          <span className="node-preset-profiles mono">{formatNodePresetProfileText(preset, language)}</span>
                          <span className="node-preset-description">{presetDescription}</span>
                          <span className="node-preset-services mono">{preset.services.join(', ') || t('common.none')}</span>
                          <span className={`node-preset-state ${matchesRunningState ? 'is-live' : 'is-pending'}`.trim()}>
                            {matchesRunningState ? t('node.profileStateMatch') : t('node.profileStatePending')}
                          </span>
                          <div className="node-preset-actions">
                            <button
                              type="button"
                              className="primary-button node-preset-button"
                              onClick={() => applyNodePreset(preset)}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {selected ? t('common.selected') : t('common.apply')}
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="node-empty">{t('node.noProfiles')}</p>
                )}
              </div>
            </section>
          </div>
        )}

        {nodeServiceContextMenu && (
          <>
            <button
              type="button"
              className="context-menu-backdrop"
              aria-label={t('node.closeServiceMenu')}
              onClick={() => setNodeServiceContextMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                setNodeServiceContextMenu(null)
              }}
            />
            <div
              className="service-context-menu"
              role="menu"
              aria-label={t('node.contextMenuAria', {
                service: nodeContextService?.name ?? nodeServiceContextMenu.serviceId
              })}
              style={{ left: nodeServiceContextMenu.x, top: nodeServiceContextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => openServiceLogsModal(nodeServiceContextMenu.serviceId)}
              >
                {t('node.showLogs')}
              </button>
              {nodeContextService?.state === 'conflict' && nodeContextService && canKillNodeConflict(nodeContextService) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openNodeConflictDialog(nodeContextService)}
                >
                  {t('node.killConflictingProcess')}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'start')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.startBlockedReason !== null}
                title={nodeContextServiceCapabilities?.startBlockedReason || t('node.startService')}
              >
                {t('node.startService')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'restart')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.restartBlockedReason !== null}
                title={nodeContextServiceCapabilities?.restartBlockedReason || t('node.restartService')}
              >
                {t('node.restartService')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void runNodeServiceAction(nodeServiceContextMenu.serviceId, 'stop')
                }}
                disabled={!hasNodeControls || nodeBusy || nodeContextServiceCapabilities?.stopBlockedReason !== null}
                title={nodeContextServiceCapabilities?.stopBlockedReason || t('node.stopService')}
              >
                {t('node.stopService')}
              </button>
            </div>
          </>
        )}

        {nodeConflictDialog && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => {
              if (!nodeConflictKillLoading) setNodeConflictDialog(null)
            }}
          >
            <section
              className="log-modal conflict-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-conflict-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.conflictEyebrow')}</p>
                  <h3 id="node-conflict-modal-title" className="log-modal-title">
                    {nodeConflictDialog.serviceName}
                  </h3>
                  <p className="log-modal-meta">{nodeConflictDialog.message}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeConflictDialog(null)}
                  disabled={Boolean(nodeConflictKillLoading)}
                >
                  {t('common.close')}
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  {t('node.conflictCopy')}
                </p>
                <pre className="conflict-modal-pids mono">{nodeConflictDialog.conflictPids.join(', ')}</pre>
                <div className="conflict-modal-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setNodeConflictDialog(null)}
                    disabled={Boolean(nodeConflictKillLoading)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void runNodeKillConflict()
                    }}
                    disabled={!hasNodeControls || nodeBusy || Boolean(nodeConflictKillLoading)}
                  >
                    {nodeConflictKillLoading === nodeConflictDialog.serviceId
                      ? t('common.loading')
                      : t('node.killConflictingProcess')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {nodeBaseDirChangeDialog && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => {
              if (!nodeBaseDirCopyLoading && !nodeBaseDirRestartLoading) setNodeBaseDirChangeDialog(null)
            }}
          >
            <section
              className="log-modal conflict-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="node-basedir-change-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.basedirChangedEyebrow')}</p>
                  <h3 id="node-basedir-change-title" className="log-modal-title">
                    {t('node.basedirChangedTitle')}
                  </h3>
                  <p className="log-modal-meta">
                    {t('node.basedirChangedMeta')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeBaseDirChangeDialog(null)}
                  disabled={nodeBaseDirCopyLoading || nodeBaseDirRestartLoading}
                >
                  {t('common.close')}
                </button>
              </header>
              <div className="conflict-modal-body">
                <p className="conflict-modal-copy">
                  {t('node.basedirPrevious')} <span className="mono">{nodeBaseDirChangeDialog.previousBaseDir}</span>
                  <br />
                  {t('node.basedirNew')} <span className="mono">{nodeBaseDirChangeDialog.nextBaseDir}</span>
                </p>
                <p className="conflict-modal-copy">
                  {nodeBaseDirChangeDialog.nodeWasRunning
                    ? t('node.basedirRunningHelp')
                    : t('node.basedirStoppedHelp')}
                </p>
                <div className="conflict-modal-actions conflict-modal-actions-spread">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void copyNodeBaseDirData()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeBaseDirCopyLoading ? t('common.copying') : t('node.copyLocalState')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setNodeBaseDirChangeDialog(null)
                      void runNodeRestoreBackupVerify()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeRestoreBackupVerifyLoading ? t('node.restoringVerify') : t('node.restoreVerify')}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void restartNodeForNewBaseDir()
                    }}
                    disabled={!hasNodeControls || nodeBusy}
                  >
                    {nodeBaseDirRestartLoading ? t('common.restarting') : t('node.restartNodeNow')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {nodeLogsModalOpen && nodeLogsService && (
          <div
            className="log-modal-backdrop"
            role="presentation"
            onClick={() => setNodeLogsModalOpen(false)}
          >
            <section
              className="log-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="service-log-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="log-modal-header">
                <div>
                  <p className="eyebrow">{t('node.serviceLogsEyebrow')}</p>
                  <h3 id="service-log-modal-title" className="log-modal-title mono">
                    {nodeLogsTargetService?.name ?? nodeLogsService}
                  </h3>
                  <p className="log-modal-meta">
                    {nodeLogsStreamId
                      ? t('node.logsStreamingNative')
                      : t('node.logsConnectingStream')}
                    {nodeLogsLastRefreshAt ? ` · ${t('node.logsLastActivity', { time: formatTime(nodeLogsLastRefreshAt, locale) })}` : ''}
                  </p>
                </div>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setNodeLogsModalOpen(false)}
                >
                  {t('common.close')}
                </button>
              </header>

              <div className="node-logs-controls log-modal-toolbar">
                <label className="node-field node-field-tail">
                  <span>{t('node.tail')}</span>
                  <input
                    type="number"
                    min={20}
                    max={2000}
                    step={10}
                    value={nodeLogsTail}
                    onChange={(event) => setNodeLogsTail(event.target.value)}
                    disabled={nodeLogsLoading}
                  />
                </label>

                <label className="node-field node-field-log-filter">
                  <span>{t('node.logsLevel')}</span>
                  <select
                    value={nodeLogsLevelFilter}
                    onChange={(event) => setNodeLogsLevelFilter(event.target.value as LogLevelFilter)}
                  >
                    {LOG_LEVEL_FILTERS.map((level) => (
                      <option key={level} value={level}>
                        {t(`node.logsLevel.${level}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="node-field node-field-log-filter">
                  <span>{t('node.logsComponent')}</span>
                  <select
                    value={nodeLogsComponentFilter}
                    onChange={(event) => setNodeLogsComponentFilter(event.target.value)}
                  >
                    {nodeLogsComponentOptions.map((component) => (
                      <option key={component} value={component}>
                        {formatNodeLogsComponentFilterLabel(component)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void refreshNodeLogs(nodeLogsService)
                  }}
                  disabled={!hasNodeControls || nodeLogsLoading}
                >
                  {nodeLogsLoading ? t('common.connecting') : t('node.reconnectStream')}
                </button>
              </div>

              {nodeLogsError && (
                <div className="node-inline-error log-modal-inline-error" role="alert">
                  {nodeLogsError}
                </div>
              )}

              <pre ref={nodeLogsPreRef} className="node-log-pre log-modal-pre ansi-log-pre">
                {nodeLogsOutput
                  ? filteredNodeLogsOutput.trim()
                    ? renderedNodeLogsOutput
                    : t('node.noLogsForFilters')
                  : nodeLogsLoading
                    ? t('node.connectingLogs')
                    : t('node.waitingLogs')}
              </pre>
            </section>
          </div>
        )}
      </section>
      )}

      {activeTab === 'producer' && (
        <ProducerPanel
          t={t}
          deleteNodeProducer={deleteNodeProducer}
          refreshNodeProducerOverview={refreshNodeProducerOverview}
          producerAdvancedMode={producerAdvancedMode}
          nodeProducerAddressDraft={nodeProducerAddressDraft}
          signingWalletAddress={signingWalletAddress}
          refreshWalletOverview={refreshWalletOverview}
          refreshProducerSigningWalletBalance={refreshProducerSigningWalletBalance}
          hasNodeControls={hasNodeControls}
          walletLoading={walletLoading}
          walletActionLoading={walletActionLoading}
          nodeProducerError={nodeProducerError}
          walletError={walletError}
          nodeProducerOverview={nodeProducerOverview}
          effectiveProducerTargetAddress={effectiveProducerTargetAddress}
          producerConfiguredAddress={producerConfiguredAddress}
          producerLocalPublicKey={producerLocalPublicKey}
          producerRegisteredPublicKey={producerRegisteredPublicKey}
          producerAddressSourceText={producerAddressSourceText}
          producerRegistrationStatusText={producerRegistrationStatusText}
          producerSigningWalletRelationText={producerSigningWalletRelationText}
          producerSigningWalletBalanceLoading={producerSigningWalletBalanceLoading}
          producerSigningWalletBalance={producerSigningWalletBalance}
          producerRecentBlocks={producerRecentBlocks}
          producerRecentBlocksError={producerRecentBlocksError}
          producerBlocksWindowBlocks={settings.dashboardProducerWindowBlocks}
          producerRefreshSeconds={settings.dashboardRefreshSeconds}
          locale={locale}
          signingWalletHasRegistrationMana={signingWalletHasRegistrationMana}
          producerSigningWalletStatusText={producerSigningWalletStatusText}
          nodeProducerActionLoading={nodeProducerActionLoading}
          registerNodeProducer={registerNodeProducer}
          createNodeProducerLocalKey={createNodeProducerLocalKey}
          producerRegisterDisabled={producerRegisterDisabled}
          producerConfiguredWalletMismatch={producerConfiguredWalletMismatch}
          producerReconfigureDisabled={producerReconfigureDisabled}
          producerRegisterHintClass={producerRegisterHintClass}
          producerRegisterHintText={producerRegisterHintText}
          producerRegisterActionText={producerRegisterActionText}
          producerOperationalNotice={producerOperationalNotice}
          setNodeProducerAddressDraft={setNodeProducerAddressDraft}
          producerSigningWalletBalanceError={producerSigningWalletBalanceError}
          producerSetupComplete={producerSetupComplete}
          producerSetupBlockedReason={producerSetupBlockedReason}
          producerUseWalletAddress={producerUseWalletAddress}
          setProducerUseWalletAddress={setProducerUseWalletAddress}
          producerAllowDelegatedSigner={producerAllowDelegatedSigner}
          setProducerAllowDelegatedSigner={setProducerAllowDelegatedSigner}
          producerProfile={producerProfile}
          clearProducerSetup={clearProducerSetup}
          openWalletTab={() => requestActiveTab('wallet')}
          onProducerBlockClick={openBlockInExplorer}
        />
      )}

      {activeTab === 'wallet' && (
        renderWalletPanel(false)
      )}

      {activeTab === 'documentation' && (
        <DocumentationPanel
          t={t}
          manualSitePath={documentationPath}
        />
      )}

      {activeTab === 'explorer' && (
        <ExplorerPanel
          t={t}
          ownProducerAddress={nodeProducerOverview?.producerAddress || producerConfiguredAddress}
          effectiveExplorerRpcUrl={effectiveExplorerRpcUrl}
          settings={settings}
          language={language}
          koinscanUrl={settings.koinscanUrl}
          head={head}
          locale={locale}
          headBlockTimeText={headBlockTimeText}
          lastUpdateText={lastUpdateText}
          isInitialLoading={isInitialLoading}
          setSettings={setSettings}
          errorMessage={errorMessage}
          localNodeNotRunning={localNodeNotRunning}
          rows={rows}
          freshBlockIds={freshBlockIds}
          nowMs={nowMs}
          selectedBlockId={selectedBlock?.blockId ?? null}
          onBlockClick={(block: any) => {
            const next = selectedBlock?.blockId === block.blockId ? null : block
            selectedBlockRef.current = next
            setSelectedBlockRpcUrl(next ? effectiveExplorerRpcUrl : null)
            setSelectedBlock(next)
          }}
          rpcUrl={selectedBlockRpcUrl ?? effectiveExplorerRpcUrl}
        />
      )}

      </div>

      {settingsUnsavedDialogOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeSettingsUnsavedDialog}>
          <section
            className="log-modal conflict-modal settings-unsaved-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-unsaved-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="log-modal-header">
              <div>
                <h3 id="settings-unsaved-modal-title" className="log-modal-title">
                  {t('settings.unsavedTitle')}
                </h3>
                <p className="log-modal-meta">{t('settings.unsavedDescription')}</p>
              </div>
            </header>
            <div className="conflict-modal-body">
              <p className="conflict-modal-copy">{t('settings.unsavedCopy')}</p>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="conflict-modal-actions conflict-modal-actions-spread settings-unsaved-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={closeSettingsUnsavedDialog}
                >
                  {t('settings.unsavedStay')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={discardSettingsChanges}
                >
                  {t('settings.unsavedDiscard')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => { void saveSettingsFromUnsavedDialog() }}
                >
                  {t('settings.saveSettings')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {firstRunSetupOpen && (
        <FirstRunSetupModal
          t={t}
          locale={locale}
          network={draftNodeNetwork === 'testnet' ? 'testnet' : 'mainnet'}
          baseDir={nodeSettings.baseDir}
          draftBaseDir={draftNodeBaseDir}
          settingsDirty={settingsDirty}
          formError={formError}
          nodeError={nodeError}
          publicBootstrapUrl={firstRunPublicBootstrapUrl}
          publicBootstrapList={nodeNativeBackupPublicList}
          publicBootstrapListLoading={nodeNativeBackupPublicListLoading}
          publicBootstrapRestoreLoading={nodeRestoreNativeBackupLoading}
          baseDirLocalCopy={nodeBaseDirValidation?.baseDir === draftNodeBaseDir ? nodeBaseDirValidation.localCopy : null}
          localChainHead={draftNodeBaseDir.trim() === nodeSettings.baseDir.trim() ? localChainHead : null}
          nodeActionLoading={nodeActionLoading}
          nodeRunning={nodeRunningCount > 0}
          syncStatusClass={footerStatusClass}
          syncStatusText={footerStatusText}
          syncStatusMeta={footerStatusMeta}
          syncStatusProgressVisible={showChainSyncProgress}
          syncStatusPercent={chainSyncPercent}
          nodeBackupProgress={nodeBackupProgress}
          selectNetwork={updateDraftNodeNetwork}
          chooseDataFolder={pickNodeBaseDir}
          saveSettings={() => saveCurrentSettings({ suppressBaseDirChangeDialog: true })}
          checkPublicBootstrap={() => runNativeBackupList('public')}
          restorePublicBootstrap={restorePublicBootstrapFromSetup}
          cancelRestorePublicBackup={runCancelBackup}
          startObserverNode={startObserverNodeFromSetup}
          walletSetupContent={renderWalletPanel(true)}
          walletReady={Boolean(walletOverview?.walletExists && walletOverview?.unlocked)}
          onQuitSetup={quitUnfinishedFirstRunSetup}
          onComplete={completeFirstRunSetup}
        />
      )}

      <AppFooter
        footerStatusClass={footerStatusClass}
        footerStatusText={footerStatusText}
        footerStatusMeta={footerStatusMeta}
        footerRpcUrl={footerRpcUrl}
        showChainSyncProgress={activeBackupProgress ? activeBackupPercent !== null : showChainSyncProgress}
        chainSyncPercent={activeBackupProgress ? activeBackupPercent : chainSyncPercent}
        t={t}
        appVersion={appVersion}
        openVersionChangelog={openVersionChangelog}
      />
    </div>
  )
}
