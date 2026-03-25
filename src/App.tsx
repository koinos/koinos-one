import { useEffect, useMemo, useRef, useState } from 'react'
import { localeForLanguage, translate, type AppLanguage } from './i18n'
import {
  DEFAULT_NODE_SETTINGS,
  DEFAULT_PUBLIC_RPC_URLS,
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  NODE_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SYNC_GAP_BLOCK_THRESHOLD,
  SYNC_GAP_TIME_THRESHOLD_MS
} from './app/constants'
import type {
  AppTab,
  BlockRow,
  DashboardSubtab,
  ExplorerSettings,
  HeadSnapshot,
  NodeAction,
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
  getProducerSetupBlockReason,
  isProducerActivelyProducingFromLogs,
  isProducerSetupComplete,
  resolveProducerTargetAddress
} from './app/producer'
import {
  canKillNodeConflict,
  clamp,
  expandNodeProfiles,
  fetchHeadSnapshot,
  fetchLatestBlocks,
  filterBlocksByProducer,
  formatDateTime,
  formatExplorerRpcSourceTarget,
  formatNodeServicePorts,
  formatNodeServiceRuntimeDetail,
  formatNodeServiceTooltip,
  formatNodeServiceType,
  formatNodeServiceVersion,
  formatPresetProfiles,
  formatProducerWalletBalanceError,
  formatTime,
  getAppConfigBridge,
  getKoinosNodeBridge,
  getWalletBridge,
  isNodeServiceRunning,
  loadInitialLanguage,
  loadInitialNodeSettings,
  loadInitialSettings,
  looksLikeNodeErrorOutput,
  normalizeDashboardProducerWindowBlocks,
  normalizeDashboardRefreshSeconds,
  normalizeBackupTarGzUrl,
  normalizeExplorerRpcSource,
  normalizeNodeBaseDirInput,
  parseProfilesCsv,
  parsePublicRpcUrlsInput,
  renderAnsiLog,
  resolveExplorerRpcUrl,
  resolveLocalNodeRpcUrl,
  resolveProducerRpcUrl,
  resolveNodeFileDisplayPath,
  sameProfiles,
  sameStringList,
  toNodeApiSettings
} from './app/utils'
import { AppFooter } from './components/panels/AppFooter'
import { DashboardPanel } from './components/panels/DashboardPanel'
import { ExplorerPanel } from './components/panels/ExplorerPanel'
import { BlockDetailDialog } from './components/panels/BlockDetailDialog'
import { NodeFileEditorModal } from './components/panels/NodeFileEditorModal'
import { ProducerPanel } from './components/panels/ProducerPanel'
import { SettingsPanel } from './components/panels/SettingsPanel'
import { WalletPanel } from './components/panels/WalletPanel'

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
  balance: KnodelWalletBalanceResult
  refreshedAt: number
}

function walletBalanceCacheKeys(address?: string | null, accountId?: string | null): string[] {
  const keys: string[] = []
  const normalizedAccountId = `${accountId || ''}`.trim()
  const normalizedAddress = `${address || ''}`.trim().toLowerCase()
  if (normalizedAccountId) keys.push(`id:${normalizedAccountId}`)
  if (normalizedAddress) keys.push(`address:${normalizedAddress}`)
  return keys
}

export function App() {
  const appVersion = window.knodel?.version?.trim() || '0.9.0'
  const [language, setLanguage] = useState<AppLanguage>(() => loadInitialLanguage())
  const [settings, setSettings] = useState<ExplorerSettings>(() => loadInitialSettings())
  const [nodeSettings, setNodeSettings] = useState<NodeManagerSettings>(() => loadInitialNodeSettings())
  const [rows, setRows] = useState<BlockRow[]>([])
  const [head, setHead] = useState<HeadSnapshot | null>(null)
  const [publicChainHead, setPublicChainHead] = useState<HeadSnapshot | null>(null)
  const [localChainHead, setLocalChainHead] = useState<HeadSnapshot | null>(null)
  const [blocksPerSecond, setBlocksPerSecond] = useState<number | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<any>(null)
  const selectedBlockRef = useRef<any>(null)
  const prevChainHeadRef = useRef<{ height: number; time: number } | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [freshBlockIds, setFreshBlockIds] = useState<string[]>([])
  const [draftPublicRpcUrls, setDraftPublicRpcUrls] = useState(settings.publicRpcUrls.join('\n'))
  const [publicRpcConfigLoaded, setPublicRpcConfigLoaded] = useState(() => !Boolean(getAppConfigBridge()?.loadPublicRpcUrls))
  const [draftPollMs, setDraftPollMs] = useState(String(settings.pollMs))
  const [draftRowLimit, setDraftRowLimit] = useState(String(settings.rowLimit))
  const [draftDashboardProducerWindowBlocks, setDraftDashboardProducerWindowBlocks] = useState(
    String(settings.dashboardProducerWindowBlocks)
  )
  const [draftDashboardRefreshSeconds, setDraftDashboardRefreshSeconds] = useState(
    String(settings.dashboardRefreshSeconds)
  )
  const [draftNodeRepoPath, setDraftNodeRepoPath] = useState(nodeSettings.repoPath)
  const [draftNodeBaseDir, setDraftNodeBaseDir] = useState(nodeSettings.baseDir)
  const [draftNodeProfiles, setDraftNodeProfiles] = useState(nodeSettings.profiles)
  const [draftNodeBlockchainBackupUrl, setDraftNodeBlockchainBackupUrl] = useState(nodeSettings.blockchainBackupUrl)
  const [nodeBaseDirPickerLoading, setNodeBaseDirPickerLoading] = useState(false)
  const [nodeBaseDirValidationLoading, setNodeBaseDirValidationLoading] = useState(false)
  const [nodeBaseDirValidation, setNodeBaseDirValidation] = useState<NodeBaseDirValidationState | null>(null)
  const [nodeStatus, setNodeStatus] = useState<KnodelKoinosNodeStatus | null>(null)
  const [nodeStatusLoading, setNodeStatusLoading] = useState(false)
  const [nodeActionLoading, setNodeActionLoading] = useState<NodeAction | null>(null)
  const [nodeRestoreBackupLoading, setNodeRestoreBackupLoading] = useState(false)
  const [nodeRestoreBackupVerifyLoading, setNodeRestoreBackupVerifyLoading] = useState(false)
  const [nodeServiceActionLoading, setNodeServiceActionLoading] = useState<NodeServiceActionState | null>(null)
  const [nodeCloneLoading, setNodeCloneLoading] = useState(false)
  const [nodeProducerOverview, setNodeProducerOverview] = useState<KnodelKoinosNodeProducerOverviewResult | null>(null)
  const [nodeProducerLoading, setNodeProducerLoading] = useState(false)
  const [nodeProducerError, setNodeProducerError] = useState<string | null>(null)
  const [producerLocalInfo, setProducerLocalInfo] = useState<KnodelKoinosNodeProducerLocalInfoResult | null>(null)
  const [producerPreviewRegisteredPublicKey, setProducerPreviewRegisteredPublicKey] = useState<string | null>(null)
  const [producerRecentBlocks, setProducerRecentBlocks] = useState<BlockRow[]>([])
  const [producerRecentBlocksLoading, setProducerRecentBlocksLoading] = useState(false)
  const [producerRecentBlocksError, setProducerRecentBlocksError] = useState<string | null>(null)
  const [dashboardProducers, setDashboardProducers] = useState<KnodelKoinosNodeDashboardProducersResult | null>(null)
  const [dashboardProducersLoading, setDashboardProducersLoading] = useState(false)
  const [dashboardProducersError, setDashboardProducersError] = useState<string | null>(null)
  const [dashboardPeers, setDashboardPeers] = useState<KnodelKoinosNodeDashboardPeersResult | null>(null)
  const [dashboardPeersLoading, setDashboardPeersLoading] = useState(false)
  const [dashboardPeersError, setDashboardPeersError] = useState<string | null>(null)
  const [dashboardPerformance, setDashboardPerformance] = useState<KnodelKoinosNodeDashboardPerformanceResult | null>(null)
  const [dashboardPerformanceLoading, setDashboardPerformanceLoading] = useState(false)
  const [dashboardPerformanceError, setDashboardPerformanceError] = useState<string | null>(null)
  const [nodeProducerActionLoading, setNodeProducerActionLoading] = useState<NodeProducerActionState>(null)
  const [nodeProducerAddressDraft, setNodeProducerAddressDraft] = useState('')
  const [producerUnlockPassword, setProducerUnlockPassword] = useState('')
  const [nodePresets, setNodePresets] = useState<KnodelKoinosNodePreset[]>([])
  const [nodePresetsLoading, setNodePresetsLoading] = useState(false)
  const [nodePresetsError, setNodePresetsError] = useState<string | null>(null)
  const [nodePresetActionLoading, setNodePresetActionLoading] = useState<string | null>(null)
  const [nodeNativeBuilds, setNodeNativeBuilds] = useState<KnodelKoinosNodeNativeBuildsResult | null>(null)
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
  const [activeTab, setActiveTab] = useState<AppTab>('explorer')
  const [dashboardSubtab, setDashboardSubtab] = useState<DashboardSubtab>('producers')
  const [nodeProfilesModalOpen, setNodeProfilesModalOpen] = useState(false)
  const [walletOverview, setWalletOverview] = useState<KnodelWalletOverviewResult | null>(null)
  const [producerSigningWalletBalance, setProducerSigningWalletBalance] = useState<KnodelWalletBalanceResult | null>(null)
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
  const [producerProfile, setProducerProfile] = useState<KnodelKoinosNodeProducerProfileResult | null>(null)
  const [producerUseWalletAddress, setProducerUseWalletAddress] = useState(true)
  const [producerAllowDelegatedSigner, setProducerAllowDelegatedSigner] = useState(false)
  const [producerFooterState, setProducerFooterState] = useState<'unknown' | 'producing'>('unknown')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const rowsRef = useRef<BlockRow[]>([])
  const nodeOutputRef = useRef(nodeOutput)
  const nodeLogsStreamIdRef = useRef<string | null>(null)
  const nodeLogsPreRef = useRef<HTMLPreElement | null>(null)
  const nodeRepoBootstrapAttemptsRef = useRef<Set<string>>(new Set())
  const locale = localeForLanguage(language)
  const t = useMemo(() => {
    return (key: string, values?: Record<string, string | number>) => translate(language, key, values)
  }, [language])
  const hasNodeControls = Boolean(getKoinosNodeBridge())
  const hasWalletControls = Boolean(getWalletBridge())
  const effectiveExplorerRpcUrl = useMemo(
    () => resolveExplorerRpcUrl(settings, nodeStatus),
    [settings, nodeStatus]
  )
  const primaryPublicRpcUrl = settings.publicRpcUrls[0] ?? DEFAULT_PUBLIC_RPC_URLS[0]
  const localNodeRpcUrl = useMemo(() => resolveLocalNodeRpcUrl(nodeStatus), [nodeStatus])
  const producerRpcUrl = useMemo(
    () => resolveProducerRpcUrl(nodeStatus, primaryPublicRpcUrl),
    [nodeStatus, primaryPublicRpcUrl]
  )
  const footerRpcUrl = activeTab === 'producer' ? producerRpcUrl : effectiveExplorerRpcUrl
  const walletAccounts = walletOverview?.accounts || []
  const activeWalletAccountId = `${walletOverview?.activeAccountId || ''}`.trim()
  const activeWalletAccount =
    walletAccounts.find((account) => account.id === activeWalletAccountId) || walletAccounts[0] || null
  const activeWalletAddress = activeWalletAccount?.address?.trim() || walletOverview?.walletAddress?.trim() || ''
  const activeWalletCanSign = Boolean(walletOverview?.unlocked && activeWalletAccount?.hasPrivateKey)
  const activeWalletBalanceCacheEntry = useMemo(() => {
    const keys = walletBalanceCacheKeys(activeWalletAddress, activeWalletAccountId)
    for (const key of keys) {
      const entry = walletBalanceCache[key]
      if (entry) return entry
    }
    return null
  }, [walletBalanceCache, activeWalletAddress, activeWalletAccountId])
  const liveWalletBalanceMatchesActive = Boolean(
    producerSigningWalletBalance?.address &&
      activeWalletAddress &&
      producerSigningWalletBalance.address.toLowerCase() === activeWalletAddress.toLowerCase()
  )
  const walletDisplayBalance = activeWalletBalanceCacheEntry?.balance || (liveWalletBalanceMatchesActive ? producerSigningWalletBalance : null)
  const walletDisplayBalanceRefreshedAt =
    activeWalletBalanceCacheEntry?.refreshedAt || (liveWalletBalanceMatchesActive ? walletBalanceRefreshedAt : null)
  const configFileDisplayPath = resolveNodeFileDisplayPath(draftNodeRepoPath, 'config/config.yml')

  useEffect(() => {
    setDraftPublicRpcUrls(settings.publicRpcUrls.join('\n'))
    setDraftPollMs(String(settings.pollMs))
    setDraftRowLimit(String(settings.rowLimit))
    setDraftDashboardProducerWindowBlocks(String(settings.dashboardProducerWindowBlocks))
    setDraftDashboardRefreshSeconds(String(settings.dashboardRefreshSeconds))
  }, [
    settings.publicRpcUrls,
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
        setSettings((current) => ({
          ...current,
          publicRpcUrls: result.publicRpcUrls,
          rpcSource: normalizeExplorerRpcSource(current.rpcSource, result.publicRpcUrls, current.rpcSource)
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
    setDraftNodeRepoPath(nodeSettings.repoPath)
    setDraftNodeBaseDir(nodeSettings.baseDir)
    setDraftNodeProfiles(nodeSettings.profiles)
    setDraftNodeBlockchainBackupUrl(nodeSettings.blockchainBackupUrl)
    setNodeBaseDirValidation(null)
  }, [nodeSettings])

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
    const defaultBurnTarget = activeWalletAddress || ''
    const defaultTransferTarget = producerProfile?.profile?.producerAddress || activeWalletAddress || ''

    if (!walletBurnTargetAddressDraft.trim() && defaultBurnTarget) {
      setWalletBurnTargetAddressDraft(defaultBurnTarget)
    }
    if (!walletTransferAddressDraft.trim() && defaultTransferTarget) {
      setWalletTransferAddressDraft(defaultTransferTarget)
    }
  }, [
    producerProfile?.profile?.producerAddress,
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
    void bridge.savePublicRpcUrls({ publicRpcUrls: settings.publicRpcUrls })
  }, [publicRpcConfigLoaded, settings.publicRpcUrls])

  useEffect(() => {
    window.localStorage.setItem(NODE_SETTINGS_STORAGE_KEY, JSON.stringify(nodeSettings))
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
    if (activeTab !== 'producer' && activeTab !== 'wallet' && !(activeTab === 'dashboard' && dashboardSubtab === 'forecast')) return
    if (!getWalletBridge()) return
    void refreshWalletOverview()
  }, [activeTab, dashboardSubtab, effectiveExplorerRpcUrl])

  useEffect(() => {
    if (activeTab !== 'producer' && activeTab !== 'wallet' && !(activeTab === 'dashboard' && dashboardSubtab === 'forecast')) return
    if (!getKoinosNodeBridge()) return
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
        setProducerSigningWalletBalanceError(null)
        setProducerSigningWalletBalanceLoading(false)
      }
      return
    }

    if (!activeWalletAddress) {
      if (activeTab !== 'wallet') {
        setProducerSigningWalletBalance(null)
        setProducerSigningWalletBalanceError(null)
        setProducerSigningWalletBalanceLoading(false)
      }
      return
    }
    void refreshProducerSigningWalletBalance(activeWalletAddress, activeWalletAccountId || undefined, {
      silent: activeTab === 'wallet'
    })
  }, [activeTab, dashboardSubtab, producerProfile, producerRpcUrl, activeWalletAddress, activeWalletAccountId])

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
  }, [nodeLogsModalOpen, nodeLogsOutput])

  useEffect(() => {
    if (!hasNodeControls) return
    const bridge = getKoinosNodeBridge()
    if (!bridge?.onLogsFollowEvent) return

    const unsubscribe = bridge.onLogsFollowEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as KnodelKoinosNodeLogsFollowEvent
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
    const bridge = getKoinosNodeBridge()
    if (!bridge?.onBackupProgressEvent) return

    const unsubscribe = bridge.onBackupProgressEvent((event) => {
      if (!event || typeof event !== 'object') return
      const payload = event as KnodelKoinosNodeBackupProgressEvent
      if (!payload.action || typeof payload.progress !== 'number') return

      setNodeBackupProgress({
        action: payload.action,
        phase: payload.phase,
        progress: payload.progress,
        message: payload.message || '',
        updatedAt: Date.now()
      })

      if (payload.phase === 'complete') {
        window.setTimeout(() => {
          setNodeBackupProgress((current) =>
            current?.action === payload.action && current.phase === payload.phase ? null : current
          )
        }, 2500)
      }
    })

    return unsubscribe
  }, [hasNodeControls])

  useEffect(() => {
    if (!hasNodeControls) return

    let disposed = false

    const loadNodePresets = async () => {
      const bridge = getKoinosNodeBridge()
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
      const bridge = getKoinosNodeBridge()
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
      const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
    if (!bridge) return

    let disposed = false
    const timer = window.setInterval(async () => {
      if (
        disposed ||
        nodeActionLoading ||
        nodeRestoreBackupLoading ||
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
    nodeServiceActionLoading,
    nodePresetActionLoading,
    nodeNativeBuildActionLoading
  ])

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pollTimer: number | null = null
    let controller: AbortController | null = null

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
        const incomingFresh = snapshot.rows
          .filter((row) => !previousIds.has(row.blockId))
          .map((row) => row.blockId)

        rowsRef.current = snapshot.rows
        setRows(snapshot.rows)
        setHead(snapshot.head)
        setLastSuccessAt(Date.now())
        setErrorMessage(null)
        setFreshBlockIds(incomingFresh.slice(0, 3))
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
      controller?.abort()
      if (pollTimer !== null) window.clearInterval(pollTimer)
    }
  }, [settings, effectiveExplorerRpcUrl, language, t])

  const isLocalRpc = settings.rpcSource === 'local'
  const localNodeNotRunning = isLocalRpc && nodeRunningCount === 0
  const statusText = useMemo(() => {
    if (errorMessage && localNodeNotRunning) return t('status.startServicesToExplore')
    if (errorMessage) return t('status.rpcError', { message: errorMessage })
    if (isInitialLoading) {
      return t('status.connectingTo', { target: formatExplorerRpcSourceTarget(settings.rpcSource, language) })
    }
    if (isRefreshing) return t('status.updatingBlocks')
    return t('status.liveBlocksVisible', { count: rows.length })
  }, [errorMessage, isInitialLoading, isRefreshing, language, localNodeNotRunning, rows.length, settings.rpcSource, t])

  const lastUpdateText = lastSuccessAt ? formatTime(lastSuccessAt, locale, t('common.na')) : t('common.na')
  const headBlockTimeText = head ? formatDateTime(head.timestampMs, locale, t('common.na')) : t('common.na')
  const nodeBusy =
    nodeActionLoading !== null ||
    nodeRestoreBackupLoading ||
    nodeRestoreBackupVerifyLoading ||
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
  const nodeServiceById = useMemo(
    () => new Map(nodeServices.map((service) => [service.id, service] as const)),
    [nodeServices]
  )
  const nodeProfileDependentsByServiceId = useMemo(() => {
    const dependents = new Map<string, KnodelKoinosNodeServiceStatus[]>()

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
  const blockProducerService = nodeServiceById.get('block_producer') ?? null
  const blockProducerRunning = blockProducerService ? isNodeServiceRunning(blockProducerService) : false
  const nodeServiceCount = nodeServices.length
  const nodeRunningCount = nodeStatus?.runningServices ?? 0
  const nodeStoppedServices = nodeServices.filter((service) => !isNodeServiceRunning(service))
  const nodeHasStoppedServices = nodeStoppedServices.length > 0
  const nodeHasPartialOutage = nodeRunningCount > 0 && nodeHasStoppedServices
  const selectedNodePresetMatchesRunningState = selectedNodePreset
    ? sameStringList(selectedNodePreset.services, nodeRunningServiceIds)
    : false
  const nodePresetSummaryText = selectedNodePreset
    ? t('node.presetSummarySelected', {
        label: selectedNodePreset.label,
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
  // Calculate blocks/sec from chain head height changes
  if (localChainHead) {
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
  }

  const syncGapBlocks =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.height - localChainHead.height) : null
  const syncGapTimeMs =
    publicChainHead && localChainHead ? Math.max(0, publicChainHead.timestampMs - localChainHead.timestampMs) : null
  const showChainSyncProgress = Boolean(
    nodeRunningCount > 0 &&
      publicChainHead &&
      localChainHead &&
      ((syncGapBlocks ?? 0) > SYNC_GAP_BLOCK_THRESHOLD || (syncGapTimeMs ?? 0) > SYNC_GAP_TIME_THRESHOLD_MS)
  )
  const chainSyncPercent = showChainSyncProgress && publicChainHead
    ? clamp((localChainHead!.height / publicChainHead.height) * 100, 0, 100)
    : null
  const walletResultText = useMemo(
    () => (walletResultData ? JSON.stringify(walletResultData, null, 2) : ''),
    [walletResultData]
  )
  const producerVaultExists = Boolean(walletOverview?.walletExists)
  const producerVaultUnlocked = Boolean(walletOverview?.unlocked)
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
  const producerConfiguredAddress =
    producerProfile?.profile?.producerAddress?.trim() ||
    nodeProducerOverview?.producerAddress?.trim() ||
    effectiveProducerTargetAddress.trim()
  const producerAndSigningWalletMatch =
    Boolean(effectiveProducerTargetAddress && signingWalletAddress) &&
    effectiveProducerTargetAddress.toLowerCase() === signingWalletAddress.toLowerCase()
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
    hasEnoughMana: signingWalletHasRegistrationMana,
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
    return t('producer.registerHint')
  })()
  const producerRegisterDisabled =
    !hasNodeControls ||
    nodeProducerActionLoading !== null ||
    nodeProducerLoading ||
    Boolean(producerSigningWalletBalanceError) ||
    producerSetupBlockedReason !== null
  const producerRegisterHintClass =
    producerSetupBlockedReason === 'wallet-balance-loading'
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
  const footerStatusClass = !hasNodeControls
    ? errorMessage
      ? 'is-error'
      : 'is-idle'
    : nodeStatusClass
  const footerStatusText = !hasNodeControls
    ? statusText
    : showChainSyncProgress
      ? t('status.syncingChain')
      : nodeRunningCount > 0 && !nodeHasPartialOutage
        ? blockProducerRunning && producerSetupComplete && producerFooterState === 'producing'
          ? t('status.liveProducing')
          : t('status.liveSynchronized')
        : nodeStateText
  const blocksPerSecLabel = blocksPerSecond !== null && blocksPerSecond > 0 && showChainSyncProgress
    ? ` · ${blocksPerSecond} blk/s`
    : ''
  const footerStatusMeta = showChainSyncProgress && publicChainHead && localChainHead
    ? t('status.syncProgress', {
        current: localChainHead.height.toLocaleString(locale),
        target: publicChainHead.height.toLocaleString(locale),
        percent: chainSyncPercentLabel
      }) + blocksPerSecLabel
    : null
  const hasAppOverlayOpen =
    nodeProfilesModalOpen ||
    nodeLogsModalOpen ||
    nodeFileEditorOpen ||
    nodeConflictDialog !== null ||
    nodeBaseDirChangeDialog !== null

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

  useEffect(() => {
    const bridge = getKoinosNodeBridge()
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
    status: KnodelKoinosNodeStatus,
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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

  const applyNodePreset = (preset: KnodelKoinosNodePreset) => {
    const nextProfiles = preset.profiles.join(',')
    const nextSettings = { ...nodeSettings, profiles: nextProfiles }
    setNodeSettings(nextSettings)
    setDraftNodeProfiles(nextProfiles)
    setFormError(null)
    setNodeError(null)
    setNodeOutput(
      t('node.profileSelected', {
        label: preset.label,
        profiles: formatPresetProfiles(preset, language)
      })
    )
    void refreshNodeStatus(nextSettings)
  }

  const reconcileNodePreset = async (preset: KnodelKoinosNodePreset) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.presetReconcile) return

    setNodePresetActionLoading(preset.id)
    setNodeServiceContextMenu(null)
    setNodeError(null)

    try {
      const result = await bridge.presetReconcile({
        ...toNodeApiSettings(nodeSettings),
        presetId: preset.id
      })

      const nextProfiles = preset.profiles.join(',')
      const nextSettings = { ...nodeSettings, profiles: nextProfiles }

      setNodeSettings(nextSettings)
      setDraftNodeProfiles(nextProfiles)
      setNodeStatus(result.status)
      setNodeOutput(result.output || result.status.output || '')

      if (!result.ok || !result.status.ok) {
        setNodeError(result.output || result.status.output || t('node.unableApplyProfile', { label: preset.label }))
      } else {
        setNodeError(null)
      }

      if (nodeLogsModalOpen && nodeLogsService) {
        const logsServiceStillRunning = result.status.services.some(
          (service) => service.id === nodeLogsService && isNodeServiceRunning(service)
        )

        if (logsServiceStillRunning) {
          void refreshNodeLogs(nodeLogsService)
        } else {
          setNodeLogsModalOpen(false)
        }
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : t('node.errorApplyingProfile', { label: preset.label }))
    } finally {
      setNodePresetActionLoading(null)
    }
  }

  const cloneKoinosRepo = async (targetRepoPath: string) => {
    const bridge = getKoinosNodeBridge()
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
  ) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.producerOverview) return

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
    } catch (error) {
      setNodeProducerError(error instanceof Error ? error.message : t('producer.unableLoadOverview'))
    } finally {
      setNodeProducerLoading(false)
    }
  }

  const refreshProducerLocalInfo = async (settingsOverride?: NodeManagerSettings) => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.producerLocalInfo) return

    try {
      const result = await bridge.producerLocalInfo(toNodeApiSettings(settingsOverride ?? nodeSettings))
      setProducerLocalInfo(result)
    } catch {
      setProducerLocalInfo(null)
    }
  }

  const refreshProducerRegisteredPublicKeyPreview = async (
    producerAddressOverride?: string
  ): Promise<string | null> => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.producerRegisteredKey) return null
    const producerAddress = producerAddressOverride?.trim() || activeWalletAddress || ''

    if (!producerAddress) {
      setProducerPreviewRegisteredPublicKey(null)
      return null
    }

    try {
      const result = await bridge.producerRegisteredKey({
        ...toNodeApiSettings(nodeSettings),
        rpcUrl: producerRpcUrl,
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
    signal?: AbortSignal
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
        producerRpcUrl,
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
          const nextSigningWalletAddress = activeWalletAddress
          const requests: Promise<unknown>[] = [refreshProducerLocalInfo()]
          if (nextSigningWalletAddress) {
            requests.push(
              refreshProducerRegisteredPublicKeyPreview(nextSigningWalletAddress),
              refreshProducerSigningWalletBalance(nextSigningWalletAddress, activeWalletAccountId || undefined)
            )
          } else {
            setProducerPreviewRegisteredPublicKey(null)
            setProducerSigningWalletBalance(null)
            setProducerSigningWalletBalanceError(null)
            setProducerSigningWalletBalanceLoading(false)
          }
          await Promise.all(requests)
          setProducerRecentBlocks([])
          setProducerRecentBlocksError(null)
          setProducerRecentBlocksLoading(false)
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
    nodeSettings.profiles,
    nodeStatus?.runningServices,
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

  const registerNodeProducer = async (producerAddressOverride?: string) => {
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
    if (!bridge?.unlock) return

    setWalletActionLoading('wallet-unlock')
    setWalletError(null)

    try {
      const result = await bridge.unlock({ password: producerUnlockPassword })
      setWalletResultTitle(t('producer.unlockTitle'))
      setWalletResultData(result)

      if (!result.ok) {
        setWalletError(result.output || t('producer.unlockError'))
        return
      }

      setProducerUnlockPassword('')
      appendWalletActivity(t('producer.unlockTitle'), result)
      await refreshWalletOverview()
      await refreshNodeProducerOverview(undefined, producerAdvancedMode ? undefined : result.walletAddress || undefined)
      await refreshProducerSigningWalletBalance(result.walletAddress || undefined)
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : t('producer.unlockError'))
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
        password
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
        derivationPath: derivedAccount.derivationPath
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
        derivationPath: generatedWallet.derivationPath || undefined
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
      return await bridge.showSeed()
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
    const previousBalanceRefreshedAt = walletBalanceRefreshedAt
    const previousBalanceError = producerSigningWalletBalanceError
    const nextCachedBalanceEntry =
      walletBalanceCacheKeys(nextActiveAccount.address, requestedAccountId)
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
      setWalletBalanceRefreshedAt(nextCachedBalanceEntry.refreshedAt)
      setProducerSigningWalletBalanceError(null)
    }

    try {
      const result = await bridge.setActiveAccount({ accountId: requestedAccountId })
      setWalletResultTitle(t('wallet.accountsTitle'))
      setWalletResultData(result)
      appendWalletActivity(t('wallet.accountsTitle'), result, result.activeAccountId || requestedAccountId)

      if (!result.ok) {
        setWalletOverview(previousOverview)
        setProducerSigningWalletBalance(previousBalance)
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
      void refreshNodeProducerOverview(undefined, producerConfiguredAddress || confirmedActiveAccount?.address || undefined)
      return true
    } catch (error) {
      setWalletOverview(previousOverview)
      setProducerSigningWalletBalance(previousBalance)
      setWalletBalanceRefreshedAt(previousBalanceRefreshedAt)
      setProducerSigningWalletBalanceError(previousBalanceError)
      setWalletError(error instanceof Error ? error.message : t('wallet.unableSetActiveAccount'))
      return false
    }
  }

  const createWalletDerivedAccount = async (name: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.createDerivedAccount) return false

    setWalletActionLoading('wallet-create-derived-account')
    setWalletError(null)
    try {
      const result = await bridge.createDerivedAccount({ name: name.trim() || undefined })
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
    if (!walletOverview?.walletExists) {
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
        name: name.trim() || undefined
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
        name: name.trim() || undefined
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

  const renameWalletVaultAccount = async (accountId: string, name: string) => {
    const bridge = getWalletBridge()
    if (!bridge?.renameAccount) return false

    setWalletActionLoading('wallet-rename-account')
    setWalletError(null)
    try {
      const result = await bridge.renameAccount({ accountId, name: name.trim() })
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
      const result = await bridge.removeAccount({ accountId })
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
      const result = await bridge.deleteWallet()
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
      const result = await bridge.closeWallet()
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
      const result = await bridge.overview({ rpcUrl: effectiveExplorerRpcUrl })
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
  ): Promise<KnodelWalletBalanceResult | null> => {
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
        rpcUrl,
        address: address || undefined,
        accountId: accountId || undefined
      })

      if (result.ok) {
        const refreshedAt = Date.now()
        setWalletBalanceCache((current) => {
          const keys = walletBalanceCacheKeys(result.address, accountId)
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
        await refreshProducerSigningWalletBalance(signingWalletAddress || undefined, activeWalletAccountId || undefined)
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
    const toAddress = walletTransferAddressDraft.trim() || producerProfile?.profile?.producerAddress || ''
    const actionId = walletTransferAsset === 'koin' ? 'wallet-transfer-koin' : 'wallet-transfer-vhp'
    await runWalletAction(actionId, t('wallet.transferTitle'), async () => {
      if (walletTransferAsset === 'koin') {
        return bridge.transferKoin({
          rpcUrl: effectiveExplorerRpcUrl,
          toAddress,
          amount,
          accountId: activeWalletAccountId || undefined,
          useFreeMana: walletTransferUseFreeMana,
          dryRun: walletTransferDryRun
        })
      }
      return bridge.transferVhp({
        rpcUrl: effectiveExplorerRpcUrl,
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
    const targetAddress = walletBurnTargetAddressDraft.trim() || activeWalletAddress || undefined
    await runWalletAction('wallet-burn', t('wallet.burnTitle'), async () => {
      return bridge.burn({
        rpcUrl: effectiveExplorerRpcUrl,
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
    overrides?: Partial<KnodelKoinosNodeSettings>
  ): KnodelKoinosNodeSettings => {
    return {
      repoPath: overrides?.repoPath ?? draftNodeRepoPath.trim(),
      baseDir: overrides?.baseDir ?? normalizeNodeBaseDirInput(draftNodeBaseDir),
      profiles: overrides?.profiles ?? expandNodeProfiles(parseProfilesCsv(draftNodeProfiles)),
      blockchainBackupUrl: overrides?.blockchainBackupUrl ?? draftNodeBlockchainBackupUrl.trim()
    }
  }

  const validateDraftNodeBaseDir = async (baseDirInput: string) => {
    const bridge = getKoinosNodeBridge()
    const normalizedBaseDir = normalizeNodeBaseDirInput(baseDirInput)
    if (!bridge?.validateBaseDir) {
      return {
        ok: true,
        baseDir: normalizedBaseDir,
        restoreWorkspaceParent: normalizedBaseDir.replace(/[\\/]+\.koinos$/, '') || normalizedBaseDir,
        writable: true,
        output: ''
      } satisfies KnodelKoinosNodeValidateBaseDirResult
    }

    setNodeBaseDirValidationLoading(true)
    try {
      const result = await bridge.validateBaseDir(currentDraftNodeApiSettings({ baseDir: normalizedBaseDir }))
      setNodeBaseDirValidation({
        ok: result.ok,
        baseDir: result.baseDir,
        restoreWorkspaceParent: result.restoreWorkspaceParent,
        message: result.output || ''
      })
      return result
    } finally {
      setNodeBaseDirValidationLoading(false)
    }
  }

  const pickNodeBaseDir = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.selectBaseDir) return

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
          message: result.output || ''
        })
        setFormError(result.output || t('node.unableSelectBaseDir'))
        return
      }

      if (!result.canceled && result.path.trim()) {
        setDraftNodeBaseDir(result.path)
        setNodeBaseDirValidation({
          ok: result.ok,
          baseDir: result.path,
          restoreWorkspaceParent: result.restoreWorkspaceParent,
          message: result.output || ''
        })
        setNodeOutput(result.output || `BASEDIR seleccionado: ${result.path}`)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('node.errorOpeningFolderPicker'))
    } finally {
      setNodeBaseDirPickerLoading(false)
    }
  }

  const loadNodeManagedFile = async (kind: 'config') => {
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
    setNodeLogsModalOpen(true)
    setNodeServiceContextMenu(null)
    setNodeLogsError(null)
    setNodeLogsOutput('')
    setNodeLogsLastRefreshAt(null)
    setNodeLogsStreamId(null)
  }

  const stopNodeLogsStream = async (streamIdOverride?: string | null) => {
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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

  const renderedNodeLogsOutput = useMemo(
    () => (nodeLogsOutput ? renderAnsiLog(nodeLogsOutput) : null),
    [nodeLogsOutput]
  )

  const runNodeAction = async (action: NodeAction) => {
    const bridge = getKoinosNodeBridge()
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

  const runNodeRestoreBackup = async () => {
    const bridge = getKoinosNodeBridge()
    if (!bridge?.restoreBackup) return

    setNodeRestoreBackupLoading(true)
    setNodeError(null)
    setNodeBackupProgress({
      action: 'restore-backup',
      phase: 'prepare',
      progress: 0,
      message: t('node.preparingRestore'),
      updatedAt: Date.now()
    })

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
    const bridge = getKoinosNodeBridge()
    if (!bridge?.restoreBackupVerify) return

    setNodeRestoreBackupVerifyLoading(true)
    setNodeError(null)
    setNodeBackupProgress({
      action: 'restore-backup-verify',
      phase: 'prepare',
      progress: 0,
      message: t('node.preparingRestoreVerify'),
      updatedAt: Date.now()
    })

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

  const restartNodeForNewBaseDir = async () => {
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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

  const openNodeConflictDialog = (service: KnodelKoinosNodeServiceStatus) => {
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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
    const bridge = getKoinosNodeBridge()
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

  const applySettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    try {
      const publicRpcUrls = parsePublicRpcUrlsInput(draftPublicRpcUrls, language)
      const pollMs = clamp(Number.parseInt(draftPollMs, 10) || DEFAULT_SETTINGS.pollMs, 1000, 30000)
      const rowLimit = clamp(Number.parseInt(draftRowLimit, 10) || DEFAULT_SETTINGS.rowLimit, 5, 50)
      const dashboardProducerWindowBlocks = normalizeDashboardProducerWindowBlocks(draftDashboardProducerWindowBlocks)
      const dashboardRefreshSeconds = normalizeDashboardRefreshSeconds(draftDashboardRefreshSeconds)
      const previousBaseDir = normalizeNodeBaseDirInput(nodeSettings.baseDir)
      const repoPath = draftNodeRepoPath.trim() || DEFAULT_NODE_SETTINGS.repoPath
      const baseDir = normalizeNodeBaseDirInput(draftNodeBaseDir)
      const profiles = expandNodeProfiles(parseProfilesCsv(draftNodeProfiles)).join(',')
      const blockchainBackupUrl = normalizeBackupTarGzUrl(
        draftNodeBlockchainBackupUrl.trim() || DEFAULT_NODE_SETTINGS.blockchainBackupUrl,
        language
      )

      if (!repoPath) throw new Error(t('settings.repoRequired'))
      if (!baseDir) throw new Error(t('settings.baseDirRequired'))

      const baseDirValidation = await validateDraftNodeBaseDir(baseDir)
      if (!baseDirValidation.ok) {
        throw new Error(baseDirValidation.output || t('settings.baseDirNotUsable', { baseDir }))
      }

      setSettings((current) => ({
        ...current,
        publicRpcUrls,
        rpcSource: normalizeExplorerRpcSource(current.rpcSource, publicRpcUrls, current.rpcSource),
        pollMs,
        rowLimit,
        dashboardProducerWindowBlocks,
        dashboardRefreshSeconds
      }))
      setNodeSettings({ repoPath, baseDir, profiles, blockchainBackupUrl })
      setDraftNodeBaseDir(baseDir)
      const baseDirChanged = previousBaseDir !== baseDir
      const settingsSummary = baseDirChanged
        ? t('settings.savedBaseDirChanged', { previous: previousBaseDir, next: baseDir })
        : t('settings.savedBaseDir', { baseDir })
      setNodeOutput(settingsSummary)
      if (baseDirChanged) {
        setNodeBaseDirChangeDialog({
          previousBaseDir,
          nextBaseDir: baseDir,
          nodeWasRunning: (nodeStatus?.services ?? []).some((service) => service.managedByKnodel || isNodeServiceRunning(service))
        })
      } else {
        setNodeBaseDirChangeDialog(null)
      }
      setRows([])
      rowsRef.current = []
      setHead(null)
      setIsInitialLoading(true)
      setErrorMessage(null)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('settings.invalidConfig'))
    }
  }

  const resetDefaults = () => {
    setDraftPublicRpcUrls(DEFAULT_SETTINGS.publicRpcUrls.join('\n'))
    setDraftPollMs(String(DEFAULT_SETTINGS.pollMs))
    setDraftRowLimit(String(DEFAULT_SETTINGS.rowLimit))
    setDraftDashboardProducerWindowBlocks(String(DEFAULT_SETTINGS.dashboardProducerWindowBlocks))
    setDraftDashboardRefreshSeconds(String(DEFAULT_SETTINGS.dashboardRefreshSeconds))
    setDraftNodeRepoPath(DEFAULT_NODE_SETTINGS.repoPath)
    setDraftNodeBaseDir(DEFAULT_NODE_SETTINGS.baseDir)
    setDraftNodeProfiles(DEFAULT_NODE_SETTINGS.profiles)
    setDraftNodeBlockchainBackupUrl(DEFAULT_NODE_SETTINGS.blockchainBackupUrl)
    setNodeBaseDirValidation(null)
    setFormError(null)
  }

  return (
    <div className="app-shell">
      <div className="app-background" aria-hidden="true" />

      <div className="app-chrome">
        <nav className="tabs-bar" aria-label={t('sections.aria')}>
          <div className="tabs-list" role="tablist" aria-label={t('tabs.aria')}>
            <button
              id="tab-explorer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'explorer'}
              aria-controls="panel-explorer"
              className={`tab-button ${activeTab === 'explorer' ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveTab('explorer')}
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
              onClick={() => setActiveTab('dashboard')}
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
              onClick={() => setActiveTab('node')}
            >
              {t('tab.node')}
            </button>
            <button
              id="tab-producer"
              type="button"
              role="tab"
              aria-selected={activeTab === 'producer'}
              aria-controls="panel-producer"
              className={`tab-button ${activeTab === 'producer' ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveTab('producer')}
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
              onClick={() => setActiveTab('wallet')}
            >
              {t('tab.wallet')}
            </button>
            <button
              id="tab-settings"
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              aria-controls="panel-settings"
              className={`tab-button ${activeTab === 'settings' ? 'is-active' : ''}`.trim()}
              onClick={() => {
                setActiveTab('settings')
                setFormError(null)
              }}
            >
              {t('tab.settings')}
            </button>
          </div>
        </nav>
      </div>

      <div className={`app-content ${hasAppOverlayOpen ? 'has-overlay' : ''}`.trim()}>

      {activeTab === 'settings' && (
        <SettingsPanel
          t={t}
          applySettings={applySettings}
          language={language}
          setLanguage={setLanguage}
          settings={settings}
          setSettings={setSettings}
          draftPublicRpcUrls={draftPublicRpcUrls}
          setDraftPublicRpcUrls={setDraftPublicRpcUrls}
          draftPollMs={draftPollMs}
          setDraftPollMs={setDraftPollMs}
          draftRowLimit={draftRowLimit}
          setDraftRowLimit={setDraftRowLimit}
          draftDashboardProducerWindowBlocks={draftDashboardProducerWindowBlocks}
          setDraftDashboardProducerWindowBlocks={setDraftDashboardProducerWindowBlocks}
          draftDashboardRefreshSeconds={draftDashboardRefreshSeconds}
          setDraftDashboardRefreshSeconds={setDraftDashboardRefreshSeconds}
          draftNodeRepoPath={draftNodeRepoPath}
          setDraftNodeRepoPath={setDraftNodeRepoPath}
          cloneKoinosRepo={cloneKoinosRepo}
          hasNodeControls={hasNodeControls}
          nodeCloneLoading={nodeCloneLoading}
          nodeActionLoading={nodeActionLoading}
          openNodeFileEditor={openNodeFileEditor}
          nodeFileEditorLoading={nodeFileEditorLoading}
          nodeFileEditorSaving={nodeFileEditorSaving}
          draftNodeProfiles={draftNodeProfiles}
          setDraftNodeProfiles={setDraftNodeProfiles}
          draftNodeBlockchainBackupUrl={draftNodeBlockchainBackupUrl}
          setDraftNodeBlockchainBackupUrl={setDraftNodeBlockchainBackupUrl}
          runNodeRestoreBackupVerify={runNodeRestoreBackupVerify}
          nodeBusy={nodeBusy}
          nodeSettings={nodeSettings}
          nodeRestoreBackupVerifyLoading={nodeRestoreBackupVerifyLoading}
          configFileDisplayPath={configFileDisplayPath}
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
          getKoinosNodeBridge={getKoinosNodeBridge}
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
        <div className="node-panel-header is-compact">
          <div className="node-panel-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setNodeProfilesModalOpen(true)}
              disabled={!hasNodeControls}
            >
              {t('node.profilesTitle')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void runNodeAction('start')
              }}
              disabled={!hasNodeControls || nodeBusy}
            >
              {nodeActionLoading === 'start' ? t('common.starting') : t('node.startNode')}
            </button>
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
          </div>
        </div>

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

        <div className="node-services">
          {nodeServiceCount > 0 ? (
            <div className="node-services-table-wrap">
              <table className="node-services-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.port')}</th>
                    <th>{t('common.logs')}</th>
                    <th>{t('common.start')}</th>
                    <th>{t('common.restart')}</th>
                    <th>{t('common.stop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodeServices.map((service) => {
                    const capabilities = nodeServiceCapabilities.get(service.id)
                    if (!capabilities) return null

                    const running = capabilities.running
                    const statusTone =
                      service.state === 'conflict' ? 'is-conflict' : running ? 'is-running' : 'is-stopped'
                    const serviceTooltip = formatNodeServiceTooltip(service, capabilities, language)
                    return (
                      <tr
                        key={`${service.id}-${service.runtimeName}`}
                        className={service.state === 'conflict' ? 'is-stopped' : running ? 'is-running' : 'is-stopped'}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setNodeServiceContextMenu({
                            serviceId: service.id,
                            x: event.clientX,
                            y: event.clientY
                          })
                        }}
                      >
                        <td className="node-service-name-cell" title={serviceTooltip}>
                          <span className="mono">
                            {formatNodeServiceVersion(service, language) || service.name}
                            {service.nativePid ? ` (pid ${service.nativePid})` : ''}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`node-service-status ${statusTone}`}
                            title={service.status}
                          >
                            <span className="node-service-dot" aria-hidden="true" />
                            {service.state}
                          </span>
                        </td>
                        <td className="mono">{formatNodeServicePorts(service)}</td>
                        {/* TYPE and LAST ERROR columns removed — native-only mode */}
                        <td className="node-service-action-cell">
                          <button
                            type="button"
                            className="ghost-button node-service-inline-button"
                            onClick={() => openServiceLogsModal(service.id)}
                            disabled={!hasNodeControls || nodeBusy}
                          >
                            {t('common.logs')}
                          </button>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.startBlockedReason || t('node.startService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'start')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.startBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'start'
                                ? t('common.starting')
                                : t('common.start')}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.restartBlockedReason || t('node.restartService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'restart')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.restartBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'restart'
                                ? t('common.restarting')
                                : t('common.restart')}
                            </button>
                          </span>
                        </td>
                        <td className="node-service-action-cell">
                          <span
                            className="node-service-action-wrap"
                            title={capabilities.stopBlockedReason || t('node.stopService')}
                          >
                            <button
                              type="button"
                              className="ghost-button node-service-inline-button node-service-inline-button-danger"
                              onClick={() => {
                                void runNodeServiceAction(service.id, 'stop')
                              }}
                              disabled={!hasNodeControls || nodeBusy || capabilities.stopBlockedReason !== null}
                            >
                              {nodeServiceActionLoading?.serviceId === service.id &&
                              nodeServiceActionLoading.action === 'stop'
                                ? t('common.stopping')
                                : t('common.stop')}
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="node-empty">
              {nodeStatusLoading ? t('node.checkingServices') : t('node.noServices')}
            </p>
          )}
        </div>

        {nodeBackupProgress && (
          <div className="node-backup-progress" role="status" aria-live="polite">
            <div className="node-services-header">
              <h3>
                {nodeBackupProgress.action === 'restore-backup'
                  ? t('node.backupProgress.restore')
                  : t('node.backupProgress.verify')}
              </h3>
              <span>{nodeBackupProgress.progress}%</span>
            </div>
            <p className="node-backup-progress-text">{nodeBackupProgress.message}</p>
            <div className="node-backup-progress-bar" aria-hidden="true">
              <span
                className="node-backup-progress-fill"
                style={{ width: `${Math.max(2, nodeBackupProgress.progress)}%` }}
              />
            </div>
            <p className="node-backup-progress-meta mono">
              {t('node.backupPhaseMeta', {
                phase: nodeBackupProgress.phase,
                time: formatTime(nodeBackupProgress.updatedAt, locale)
              })}
            </p>
          </div>
        )}

        {nodeOutput && (
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
                      const matchesRunningState = sameStringList(preset.services, nodeRunningServiceIds)
                      return (
                        <article
                          key={preset.id}
                          className={`node-preset-card ${selected ? 'is-selected' : ''}`.trim()}
                          title={preset.description}
                        >
                          <span className="node-preset-label">{preset.label}</span>
                          <span className="node-preset-profiles mono">{formatPresetProfiles(preset, language)}</span>
                          <span className="node-preset-description">{preset.description}</span>
                          <span className="node-preset-services mono">{preset.services.join(', ') || t('common.none')}</span>
                          <span className={`node-preset-state ${matchesRunningState ? 'is-live' : 'is-pending'}`.trim()}>
                            {matchesRunningState ? t('node.profileStateMatch') : t('node.profileStatePending')}
                          </span>
                          <div className="node-preset-actions">
                            <button
                              type="button"
                              className="ghost-button node-preset-button"
                              onClick={() => applyNodePreset(preset)}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {selected ? t('common.selected') : t('node.useProfile')}
                            </button>
                            <button
                              type="button"
                              className="primary-button node-preset-button"
                              onClick={() => {
                                void reconcileNodePreset(preset)
                              }}
                              disabled={!hasNodeControls || nodeBusy}
                            >
                              {nodePresetActionLoading === preset.id ? t('common.applying') : t('common.apply')}
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
                  ? renderedNodeLogsOutput
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
          producerVaultExists={producerVaultExists}
          producerVaultUnlocked={producerVaultUnlocked}
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
          producerRegisterDisabled={producerRegisterDisabled}
          producerRegisterHintClass={producerRegisterHintClass}
          producerRegisterHintText={producerRegisterHintText}
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
          openWalletTab={() => setActiveTab('wallet')}
        />
      )}

      {activeTab === 'wallet' && (
        <WalletPanel
          t={t}
          hasWalletControls={hasWalletControls}
          walletOverview={walletOverview}
          walletLoading={walletLoading}
          walletActionLoading={walletActionLoading}
          walletError={walletError}
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
          walletResultData={walletResultData}
          walletResultTitle={walletResultTitle}
          walletResultText={walletResultText}
          walletActivityEntries={walletActivityEntries}
          activeWalletAccount={activeWalletAccount}
          activeWalletAccountId={activeWalletAccountId}
          activeWalletAddress={activeWalletAddress}
          activeWalletCanSign={activeWalletCanSign}
          setWalletActiveAccount={setWalletActiveAccount}
          createWalletDerivedAccount={createWalletDerivedAccount}
          importWalletWatchAccount={importWalletWatchAccount}
          renameWalletVaultAccount={renameWalletVaultAccount}
          removeWalletVaultAccount={removeWalletVaultAccount}
        />
      )}

      {activeTab === 'explorer' && (
        <ExplorerPanel
          t={t}
          effectiveExplorerRpcUrl={effectiveExplorerRpcUrl}
          settings={settings}
          language={language}
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
            setSelectedBlock(next)
          }}
          rpcUrl={effectiveExplorerRpcUrl}
        />
      )}

      </div>

      <AppFooter
        footerStatusClass={footerStatusClass}
        footerStatusText={footerStatusText}
        footerStatusMeta={footerStatusMeta}
        footerRpcUrl={footerRpcUrl}
        showChainSyncProgress={showChainSyncProgress}
        chainSyncPercent={chainSyncPercent}
        t={t}
        appVersion={appVersion}
      />
    </div>
  )
}
