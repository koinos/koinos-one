import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { HeadSnapshot, NodeBackupProgressState, NodeBaseDirLocalCopyState } from '../../app/types'
import { formatBytes, formatDateTime, formatRelativeAge } from '../../app/utils'
import { NodeBackupProgressPanel } from './NodeBackupProgressPanel'

type FirstRunNetwork = 'mainnet' | 'testnet'
type FirstRunSetupStep = 'welcome' | 'data' | 'wallet' | 'restore' | 'start' | 'done'
type PublicBootstrapCheckState = 'idle' | 'checking' | 'available' | 'unavailable'

type StartObserverResult = boolean | {
  ok: boolean
  output?: string | null
}

type Translate = (key: string, values?: Record<string, string | number>) => string

type FirstRunSetupModalProps = {
  initialStep?: FirstRunSetupStep
  locale: string
  network: FirstRunNetwork
  baseDir: string
  draftBaseDir: string
  settingsDirty: boolean
  formError: string | null
  nodeError: string | null
  publicBootstrapUrl: string
  publicBootstrapList: any
  publicBootstrapListLoading: boolean
  publicBootstrapRestoreLoading: boolean
  baseDirLocalCopy?: NodeBaseDirLocalCopyState | null
  localChainHead?: HeadSnapshot | null
  nodeActionLoading: string | null
  nodeRunning: boolean
  syncStatusClass: string
  syncStatusText: string
  syncStatusMeta: string | null
  syncStatusProgressVisible: boolean
  syncStatusPercent: number | null
  nodeBackupProgress: NodeBackupProgressState | null
  walletSetupContent?: ReactNode
  walletReady?: boolean
  selectNetwork: (network: FirstRunNetwork) => void
  chooseDataFolder: () => Promise<boolean>
  saveSettings: () => Promise<boolean>
  checkPublicBootstrap: () => Promise<any>
  restorePublicBootstrap: (backupId: string) => Promise<boolean>
  cancelRestorePublicBackup: () => Promise<void>
  startObserverNode: () => Promise<StartObserverResult>
  onQuitSetup: () => void
  onComplete: () => void
  t: Translate
}

const SETUP_STEPS: Array<{ id: FirstRunSetupStep; labelKey: string; titleKey: string; helpKey: string }> = [
  {
    id: 'welcome',
    labelKey: 'firstRun.step.welcome.label',
    titleKey: 'firstRun.step.welcome.title',
    helpKey: 'firstRun.step.welcome.help'
  },
  {
    id: 'data',
    labelKey: 'firstRun.step.dataFolder.label',
    titleKey: 'firstRun.step.dataFolder.title',
    helpKey: 'firstRun.step.dataFolder.help'
  },
  {
    id: 'wallet',
    labelKey: 'firstRun.step.wallet.label',
    titleKey: 'firstRun.step.wallet.title',
    helpKey: 'firstRun.step.wallet.help'
  },
  {
    id: 'restore',
    labelKey: 'firstRun.step.restore.label',
    titleKey: 'firstRun.step.restore.title',
    helpKey: 'firstRun.step.restore.help'
  },
  {
    id: 'start',
    labelKey: 'firstRun.step.startObserver.label',
    titleKey: 'firstRun.step.startObserver.title',
    helpKey: 'firstRun.step.startObserver.help'
  },
  {
    id: 'done',
    labelKey: 'firstRun.step.done.label',
    titleKey: 'firstRun.step.done.title',
    helpKey: 'firstRun.step.done.help'
  }
]

function shortStatus(value: string, empty: string) {
  return value?.trim() ? value.trim() : empty
}

function publicBootstrapUnavailableMessage(t: Translate) {
  return t('firstRun.bootstrap.unavailableMessage')
}

function isPublicBootstrapUnavailableOutput(message: string) {
  const value = message.toLowerCase()
  return (
    value.includes('public backup url') ||
    value.includes('backup-public-url') ||
    value.includes('public bootstrap') ||
    value.includes('public-restore') ||
    value.includes('latest.json: http 404') ||
    value.includes('http 404')
  )
}

function friendlySetupError(message: string | null, step: FirstRunSetupStep, t: Translate) {
  if (!message) return null
  if (step === 'restore' && isPublicBootstrapUnavailableOutput(message)) {
    return publicBootstrapUnavailableMessage(t)
  }
  return message
}

function startObserverFailureMessage(t: Translate, output?: string | null) {
  const detail = `${output || ''}`.trim()
  if (!detail) return t('firstRun.error.startNoDetail')
  return t('firstRun.error.startWithDetail', { detail })
}

function networkLabel(t: Translate, network: FirstRunNetwork) {
  return network === 'testnet' ? t('firstRun.network.testnet') : t('firstRun.network.mainnet')
}

function positiveBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function latestPublicBackupSnapshot(publicBootstrapList: any, latestPublicBackupId: string) {
  const snapshots = Array.isArray(publicBootstrapList?.snapshots) ? publicBootstrapList.snapshots : []
  if (latestPublicBackupId) {
    const byId = snapshots.find((snapshot: any) => snapshot?.backupId === latestPublicBackupId)
    if (byId) return byId
  }
  return snapshots.find((snapshot: any) => snapshot?.latest) ?? snapshots[0] ?? null
}

function parseTimestampMs(rawValue?: string, fallbackValue?: string): number {
  const rawCreatedAt = rawValue?.trim()
  const isoMs = rawCreatedAt ? Date.parse(rawCreatedAt) : Number.NaN
  if (Number.isFinite(isoMs)) return isoMs

  const compactTimestamp = rawCreatedAt || fallbackValue || ''
  const match = compactTimestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  if (!match) return 0

  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10)
  )
}

function publicBackupTimestampMs(snapshot: any): number {
  if (!snapshot) return 0
  return parseTimestampMs(
    snapshot.sourceCreatedAt || snapshot.createdAt || snapshot.promotedAt,
    snapshot.backupId
  )
}

function formatDurationMs(valueMs: number): string {
  const diffSec = Math.max(0, Math.floor(valueMs / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

export function FirstRunSetupModal(props: FirstRunSetupModalProps) {
  const {
    locale,
    network,
    baseDir,
    draftBaseDir,
    settingsDirty,
    formError,
    nodeError,
    publicBootstrapUrl,
    publicBootstrapList,
    publicBootstrapListLoading,
    publicBootstrapRestoreLoading,
    baseDirLocalCopy,
    localChainHead,
    nodeActionLoading,
    nodeRunning,
    syncStatusClass,
    syncStatusText,
    syncStatusMeta,
    syncStatusProgressVisible,
    syncStatusPercent,
    nodeBackupProgress,
    walletSetupContent,
    walletReady = false,
    selectNetwork,
    chooseDataFolder,
    saveSettings,
    checkPublicBootstrap,
    restorePublicBootstrap,
    cancelRestorePublicBackup,
    startObserverNode,
    onQuitSetup,
    onComplete,
    t,
    initialStep = 'welcome'
  } = props

  const [step, setStep] = useState<FirstRunSetupStep>(initialStep)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupNotice, setSetupNotice] = useState<string | null>(null)
  const [observerStarted, setObserverStarted] = useState(false)
  const [publicBootstrapCheckState, setPublicBootstrapCheckState] = useState<PublicBootstrapCheckState>('idle')
  const publicBootstrapCheckKeyRef = useRef('')

  const activeStepIndex = SETUP_STEPS.findIndex((entry) => entry.id === step)
  const activeStep = SETUP_STEPS[activeStepIndex] ?? SETUP_STEPS[0]
  const stepNumber = activeStepIndex + 1
  const progressPercent = Math.round((stepNumber / SETUP_STEPS.length) * 100)
  const latestPublicBackupId = publicBootstrapList?.latestBackupId || ''
  const latestPublicBackup = latestPublicBackupSnapshot(publicBootstrapList, latestPublicBackupId)
  const nowMs = Date.now()
  const localCopyDetected = Boolean(baseDirLocalCopy?.detected || localChainHead)
  const localCopyTimestamp = localChainHead?.timestampMs || baseDirLocalCopy?.newestModifiedMs || 0
  const latestPublicBackupTimestamp = publicBackupTimestampMs(latestPublicBackup)
  const localCopyEvidence = baseDirLocalCopy?.evidence?.length ? baseDirLocalCopy.evidence.join(', ') : t('firstRun.restore.localCopyEvidenceUnknown')
  const localCopyMeta = localChainHead
    ? t('firstRun.restore.localCopyLiveMeta', {
        height: localChainHead.height.toLocaleString(locale),
        time: formatDateTime(localChainHead.timestampMs, locale, t('common.na')),
        age: formatRelativeAge(localChainHead.timestampMs, nowMs)
      })
    : localCopyTimestamp > 0
      ? t('firstRun.restore.localCopyFileMeta', {
          time: formatDateTime(localCopyTimestamp, locale, t('common.na')),
          age: formatRelativeAge(localCopyTimestamp, nowMs),
          size: formatBytes(baseDirLocalCopy?.totalBytes, locale)
        })
      : t('firstRun.restore.localCopyUnknownMeta', { evidence: localCopyEvidence })
  const publicBackupHeadSuffix = latestPublicBackup?.sourceHeadHeight > 0
    ? t('firstRun.restore.publicBackupHeadSuffix', {
        height: Number(latestPublicBackup.sourceHeadHeight).toLocaleString(locale)
      })
    : ''
  const publicBackupMeta = latestPublicBackupTimestamp > 0
    ? t('firstRun.restore.publicBackupMeta', {
        time: formatDateTime(latestPublicBackupTimestamp, locale, t('common.na')),
        age: formatRelativeAge(latestPublicBackupTimestamp, nowMs),
        head: publicBackupHeadSuffix
      })
    : t('firstRun.restore.publicBackupUnknownMeta')
  const localCopyAgeComparison = localCopyTimestamp > 0 && latestPublicBackupTimestamp > 0
    ? latestPublicBackupTimestamp - localCopyTimestamp > 60000
      ? t('firstRun.restore.publicBackupNewer', {
          age: formatDurationMs(latestPublicBackupTimestamp - localCopyTimestamp)
        })
      : localCopyTimestamp - latestPublicBackupTimestamp > 60000
        ? t('firstRun.restore.localCopyNewer', {
            age: formatDurationMs(localCopyTimestamp - latestPublicBackupTimestamp)
          })
        : t('firstRun.restore.localCopySimilarAge')
    : t('firstRun.restore.localCopyUnknownComparison')
  const publicBackupSizeBytes = positiveBytes(latestPublicBackup?.totalBytes)
  const publicRestoreMinimumBytes = positiveBytes(latestPublicBackup?.restoreSpace?.minimumTargetFreeBytes)
  const publicRestoreRecommendedBytes = positiveBytes(latestPublicBackup?.restoreSpace?.recommendedTargetFreeBytes)
  const hasPublicRestoreEstimate = Boolean(publicBackupSizeBytes && publicRestoreMinimumBytes && publicRestoreRecommendedBytes)
  const visibleDataFolder = draftBaseDir?.trim() || baseDir?.trim()
  const dataFolderIsDraft = Boolean(draftBaseDir?.trim() && draftBaseDir.trim() !== baseDir.trim())
  const dataFolderReady = Boolean(baseDir?.trim()) && !settingsDirty
  const publicRestoreProgressActive = Boolean(
    nodeBackupProgress?.action === 'restore-backup' && !['error', 'cancelled', 'complete'].includes(nodeBackupProgress.phase)
  )
  const publicRestoreInProgress = Boolean(publicBootstrapRestoreLoading || publicRestoreProgressActive)
  const publicRestoreBusy = publicBootstrapListLoading || publicRestoreInProgress
  const publicRestoreReady = Boolean(latestPublicBackupId)
  const setupCanComplete = observerStarted || nodeRunning
  const showSyncStatus =
    (step === 'start' || step === 'done') && (nodeRunning || observerStarted || nodeActionLoading === 'start')
  const stepError =
    setupError ||
    (step === 'data' ? formError : null) ||
    (step === 'restore' || step === 'start' ? nodeError : null)
  const publicBootstrapUnavailable =
    step === 'restore' && stepError ? isPublicBootstrapUnavailableOutput(stepError) : false
  const bootstrapAvailabilityState: PublicBootstrapCheckState =
    publicRestoreReady
      ? 'available'
      : publicBootstrapUnavailable || publicBootstrapCheckState === 'unavailable' || !publicBootstrapUrl
        ? 'unavailable'
      : publicBootstrapListLoading ||
          publicBootstrapCheckState === 'checking' ||
          (step === 'restore' && publicBootstrapCheckState === 'idle' && Boolean(publicBootstrapUrl) && !settingsDirty)
        ? 'checking'
        : 'idle'
  const currentError = publicBootstrapUnavailable ? null : friendlySetupError(stepError, step, t)
  const currentNotice = setupNotice

  const restorePrimaryLabel = publicBootstrapRestoreLoading
    ? t('firstRun.status.bootstrapRestoring')
    : bootstrapAvailabilityState === 'available'
      ? t('firstRun.action.restorePublicBackup')
      : t('firstRun.action.next')
  const dataFolderDescription = hasPublicRestoreEstimate
    ? t('firstRun.dataFolder.descriptionWithEstimate', {
        backupSize: formatBytes(publicBackupSizeBytes, locale),
        minimumFree: formatBytes(publicRestoreMinimumBytes, locale),
        recommendedFree: formatBytes(publicRestoreRecommendedBytes, locale)
      })
    : publicBootstrapListLoading || publicBootstrapCheckState === 'checking'
      ? t('firstRun.dataFolder.descriptionCheckingEstimate')
      : t('firstRun.dataFolder.descriptionNoEstimate')

  useEffect(() => {
    if (step !== 'data' && step !== 'restore') return

    if (step === 'restore' && settingsDirty) {
      setPublicBootstrapCheckState('idle')
      return
    }

    if (!publicBootstrapUrl) {
      setPublicBootstrapCheckState('unavailable')
      setSetupError(null)
      setSetupNotice(null)
      return
    }

    if (latestPublicBackupId) {
      setPublicBootstrapCheckState('available')
      setSetupError(null)
      setSetupNotice(null)
      return
    }

    const checkKey = `${network}|${publicBootstrapUrl}`
    if (publicBootstrapCheckKeyRef.current === checkKey && publicBootstrapCheckState !== 'idle') return
    publicBootstrapCheckKeyRef.current = checkKey

    let cancelled = false
    setPublicBootstrapCheckState('checking')
    setSetupError(null)
    setSetupNotice(null)

    void checkPublicBootstrap()
      .then((result) => {
        if (cancelled) return
        if (result?.ok && result.latestBackupId) {
          setPublicBootstrapCheckState('available')
          return
        }
        setPublicBootstrapCheckState('unavailable')
      })
      .catch(() => {
        if (cancelled) return
        setPublicBootstrapCheckState('unavailable')
      })

    return () => {
      cancelled = true
    }
  }, [checkPublicBootstrap, latestPublicBackupId, network, publicBootstrapUrl, publicBootstrapCheckState, settingsDirty, step])

  const setSetupStep = (nextStep: FirstRunSetupStep) => {
    setSetupError(null)
    setSetupNotice(null)
    setStep(nextStep)
  }

  useEffect(() => {
    if (network !== 'mainnet') {
      selectNetwork('mainnet')
    }
  }, [network, selectNetwork])

  const handleWelcomeNext = () => {
    if (network !== 'mainnet') {
      selectNetwork('mainnet')
    }
    setSetupStep('data')
  }

  const handleChooseDataFolder = async () => {
    setSetupError(null)
    setSetupNotice(null)
    await chooseDataFolder()
  }

  const handleSaveSettings = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const ok = await saveSettings()
    if (ok) setSetupStep('wallet')
  }

  const handleContinueRestore = async () => {
    setSetupError(null)
    setSetupNotice(null)

    if (bootstrapAvailabilityState === 'checking' || publicRestoreBusy) return

    if (bootstrapAvailabilityState === 'available') {
      const backupId = latestPublicBackupId ? `public:${latestPublicBackupId}` : 'public:latest'
      const ok = await restorePublicBootstrap(backupId)
      if (ok) setSetupStep('start')
      return
    }

    setSetupNotice(publicBootstrapUnavailableMessage(t))
    setStep('start')
  }

  const handleSkipRestore = () => {
    setSetupError(null)
    setSetupNotice(t('firstRun.restore.skipNotice'))
    setStep('start')
  }

  const handleUseLocalCopy = () => {
    setSetupError(null)
    setSetupNotice(t('firstRun.restore.localCopyNotice'))
    setStep('start')
  }

  const handlePrevious = () => {
    if (step === 'data') {
      setSetupStep('welcome')
      return
    }
    if (step === 'wallet') {
      setSetupStep('data')
      return
    }
    if (step === 'restore' && !publicRestoreInProgress) {
      setSetupStep('wallet')
    }
  }

  const handleStartObserver = async () => {
    setSetupError(null)
    setSetupNotice(null)

    if (nodeRunning) {
      setObserverStarted(true)
      setSetupStep('done')
      return
    }

    const result = await startObserverNode()
    const ok = typeof result === 'boolean' ? result : result.ok
    if (ok) {
      setObserverStarted(true)
      setSetupStep('done')
      return
    }

    setSetupError(startObserverFailureMessage(t, typeof result === 'boolean' ? nodeError : result.output || nodeError))
  }

  const handleCompleteSetup = () => {
    setSetupError(null)
    setSetupNotice(null)
    if (!setupCanComplete) {
      setSetupError(t('firstRun.error.startRequired'))
      return
    }
    onComplete()
  }

  const currentNetworkLabel = networkLabel(t, 'mainnet')
  const showPrevious = step === 'data' || step === 'wallet' || (step === 'restore' && !publicRestoreInProgress)

  return (
    <div className="log-modal-backdrop first-run-setup-backdrop" role="presentation">
      <section
        className="log-modal first-run-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-setup-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="first-run-setup-header">
          <div>
            <p className="first-run-setup-kicker">
              {t('firstRun.progress', { current: stepNumber, total: SETUP_STEPS.length })}
            </p>
            <h3 id="first-run-setup-title" className="first-run-setup-title">
              {t(activeStep.titleKey)}
            </h3>
            <p className="first-run-setup-meta">
              {t(activeStep.helpKey)}
            </p>
          </div>
          <div className="first-run-setup-header-actions">
            <button type="button" className="ghost-button" onClick={onQuitSetup}>
              {t('firstRun.action.closeApp')}
            </button>
          </div>
        </header>

        <div className="first-run-setup-progress" aria-label={t('firstRun.progressAria')}>
          <div className="first-run-setup-progress-row">
            <strong>{t(activeStep.labelKey)}</strong>
            <span>{progressPercent}%</span>
          </div>
          <div className="first-run-setup-progress-bar" aria-hidden="true">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <ol className="first-run-setup-steps" role="list">
            {SETUP_STEPS.map((entry, index) => (
              <li
                key={entry.id}
                className={[
                  'first-run-setup-step',
                  entry.id === step ? 'is-active' : '',
                  index < activeStepIndex ? 'is-complete' : ''
                ].filter(Boolean).join(' ')}
                aria-current={entry.id === step ? 'step' : undefined}
              >
                <span className="first-run-setup-step-pill">
                  <span>{index + 1}</span>
                  <strong>{t(entry.labelKey)}</strong>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="first-run-setup-body">
          {currentError && (
            <div className="node-inline-error first-run-setup-error" role="alert">
              {currentError}
            </div>
          )}
          {currentNotice && (
            <div className="first-run-setup-notice" role="status">
              {currentNotice}
            </div>
          )}

          {step === 'welcome' && (
            <div className="first-run-setup-panel">
              <div className="first-run-welcome-copy">
                <h4>{t('firstRun.welcome.heading')}</h4>
                <p>{t('firstRun.welcome.description')}</p>
                <p>{t('firstRun.welcome.flow')}</p>
                <p>{t('firstRun.welcome.safety')}</p>
              </div>
              <div className="first-run-setup-actions">
                <button type="button" className="ghost-button" onClick={onComplete}>
                  {t('firstRun.action.skipSetup')}
                </button>
                <button type="button" className="primary-button" onClick={handleWelcomeNext}>
                  {t('firstRun.action.getStarted')}
                </button>
              </div>
            </div>
          )}

          {step === 'data' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.dataFolder.question')}</h4>
              <div className="first-run-setup-summary-grid first-run-single-path-grid">
                <div>
                  <span>{t('firstRun.summary.dataFolder')}</span>
                  <strong>{shortStatus(visibleDataFolder, t('firstRun.empty.notSet'))}</strong>
                  {dataFolderIsDraft && (
                    <em>{t('firstRun.dataFolder.unsaved')}</em>
                  )}
                </div>
              </div>

              <p className="conflict-modal-copy">
                {dataFolderDescription}
              </p>

              <div className="first-run-setup-actions">
                {showPrevious && (
                  <button type="button" className="ghost-button" onClick={handlePrevious}>
                    {t('firstRun.action.previous')}
                  </button>
                )}
                <button type="button" className="ghost-button" onClick={handleChooseDataFolder}>
                  {t('firstRun.action.chooseFolder')}
                </button>
                <button type="button" className="primary-button" onClick={handleSaveSettings} disabled={!draftBaseDir.trim()}>
                  {t('firstRun.action.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'wallet' && (
            <div className="first-run-setup-panel">
              {!walletReady && (
                <>
                  <h4>{t('firstRun.wallet.question')}</h4>
                  <p className="conflict-modal-copy">
                    {t('firstRun.wallet.description')}
                  </p>
                </>
              )}
              {walletSetupContent || (
                <div className="node-warning" role="note">
                  {t('firstRun.wallet.unavailable')}
                </div>
              )}

              <div className="first-run-setup-actions">
                {showPrevious && (
                  <button type="button" className="ghost-button" onClick={handlePrevious}>
                    {t('firstRun.action.previous')}
                  </button>
                )}
                <button type="button" className="primary-button" onClick={() => setSetupStep('restore')}>
                  {t('firstRun.action.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'restore' && (
            <div className="first-run-setup-panel">
              {!localCopyDetected && (
                <h4>{t('firstRun.restore.question')}</h4>
              )}
              <section className="first-run-restore-card" aria-live="polite">
                <div className="first-run-restore-meta first-run-restore-url">
                  <span>{t('firstRun.summary.publicBackupUrl')}</span>
                  <strong className="mono" title={publicBootstrapUrl}>
                    {shortStatus(publicBootstrapUrl, t('firstRun.empty.notSet'))}
                  </strong>
                </div>

                {nodeBackupProgress?.action === 'restore-backup' && (
                  <NodeBackupProgressPanel
                    t={t}
                    locale={locale}
                    nodeBackupProgress={nodeBackupProgress}
                    hasNodeControls={publicRestoreInProgress}
                    onCancelBackup={cancelRestorePublicBackup}
                  />
                )}

                {!publicRestoreInProgress && (
                  <>
                    {localCopyDetected && (
                      <div className="first-run-local-copy-card">
                        <div>
                          <h4>{t('firstRun.restore.localCopyTitle')}</h4>
                          <p>{t('firstRun.restore.localCopyDescription')}</p>
                        </div>
                        <div className="first-run-local-copy-grid">
                          <div className="first-run-restore-meta">
                            <span>{t('firstRun.restore.localCopyLabel')}</span>
                            <strong>{localCopyMeta}</strong>
                          </div>
                          <div className="first-run-restore-meta">
                            <span>{t('firstRun.restore.publicBackupLabel')}</span>
                            <strong>{publicBackupMeta}</strong>
                          </div>
                        </div>
                        <p className="first-run-local-copy-comparison">{localCopyAgeComparison}</p>
                      </div>
                    )}

                    {!localCopyDetected && (
                      <div className="first-run-restore-choice-grid">
                        <div>
                          {bootstrapAvailabilityState === 'checking' && (
                            <>
                              <h4>{t('firstRun.status.bootstrapChecking')}</h4>
                              <p>{t('firstRun.restore.checkingDescription', { network: currentNetworkLabel })}</p>
                              <div className="first-run-restore-status">
                                <span className="status-dot" aria-hidden="true" />
                                <strong>{publicBootstrapListLoading ? t('firstRun.status.bootstrapChecking') : t('firstRun.status.bootstrapPreparing')}</strong>
                              </div>
                            </>
                          )}

                          {bootstrapAvailabilityState === 'unavailable' && (
                            <>
                              <h4>{t('firstRun.status.bootstrapUnavailable')}</h4>
                              <p>{publicBootstrapUnavailableMessage(t)}</p>
                            </>
                          )}

                          {bootstrapAvailabilityState === 'available' && (
                            <>
                              <h4>{t('firstRun.status.bootstrapAvailable')}</h4>
                              <p>{t('firstRun.restore.availableDescription')}</p>
                              <div className="first-run-restore-meta">
                                <span>{t('firstRun.summary.latestSnapshot')}</span>
                                <strong>{shortStatus(latestPublicBackupId, t('firstRun.empty.notSet'))}</strong>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="first-run-seed-sync-card">
                          <h4>{t('firstRun.restore.seedSyncTitle')}</h4>
                          <p>{t('firstRun.restore.seedSyncDescription')}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              <div className="first-run-setup-actions">
                {showPrevious && (
                  <button type="button" className="ghost-button" onClick={handlePrevious}>
                    {t('firstRun.action.previous')}
                  </button>
                )}
                {!publicRestoreInProgress && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleSkipRestore}
                    disabled={publicRestoreBusy}
                  >
                    {t('firstRun.action.skipRestore')}
                  </button>
                )}
                {localCopyDetected && !publicRestoreInProgress && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleUseLocalCopy}
                    disabled={publicRestoreBusy}
                  >
                    {t('firstRun.action.useLocalCopy')}
                  </button>
                )}
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleContinueRestore}
                  disabled={bootstrapAvailabilityState === 'checking' || publicRestoreBusy}
                >
                  {restorePrimaryLabel}
                </button>
              </div>
            </div>
          )}

          {step === 'start' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.start.question')}</h4>
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>{t('firstRun.summary.startMode')}</span>
                  <strong>{setupCanComplete ? t('firstRun.status.observerReady') : t('firstRun.status.observerFirst')}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.dataFolder')}</span>
                  <strong>{shortStatus(baseDir, t('firstRun.empty.notSet'))}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.network')}</span>
                  <strong>{currentNetworkLabel}</strong>
                </div>
              </div>

              <p className="conflict-modal-copy">
                {t('firstRun.start.description')}
              </p>
              {!setupCanComplete && (
                <p className="settings-inline-help is-error">
                  {t('firstRun.start.required')}
                </p>
              )}
              {showSyncStatus && (
                <div className={`first-run-sync-status status-pill ${syncStatusClass}`.trim()} role="status" aria-live="polite">
                  <div className="footer-status-main">
                    <span className="status-dot" aria-hidden="true" />
                    <span className="footer-status-text">{syncStatusText}</span>
                  </div>
                  {syncStatusMeta && <span className="footer-status-meta mono">{syncStatusMeta}</span>}
                  {syncStatusProgressVisible && syncStatusPercent !== null && (
                    <div className="footer-status-progress" aria-hidden="true">
                      <span
                        className="footer-status-progress-fill"
                        style={{ width: `${Math.max(2, syncStatusPercent)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="first-run-setup-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleStartObserver}
                  disabled={!dataFolderReady || nodeActionLoading === 'start'}
                >
                  {nodeActionLoading === 'start' ? t('firstRun.status.observerStarting') : t('firstRun.action.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.done.question')}</h4>
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>{t('firstRun.summary.startMode')}</span>
                  <strong>{setupCanComplete ? t('firstRun.status.observerRunning') : t('firstRun.status.observerFirst')}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.dataFolder')}</span>
                  <strong>{shortStatus(baseDir, t('firstRun.empty.notSet'))}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.network')}</span>
                  <strong>{currentNetworkLabel}</strong>
                </div>
              </div>
              {showSyncStatus && (
                <div className={`first-run-sync-status status-pill ${syncStatusClass}`.trim()} role="status" aria-live="polite">
                  <div className="footer-status-main">
                    <span className="status-dot" aria-hidden="true" />
                    <span className="footer-status-text">{syncStatusText}</span>
                  </div>
                  {syncStatusMeta && <span className="footer-status-meta mono">{syncStatusMeta}</span>}
                  {syncStatusProgressVisible && syncStatusPercent !== null && (
                    <div className="footer-status-progress" aria-hidden="true">
                      <span
                        className="footer-status-progress-fill"
                        style={{ width: `${Math.max(2, syncStatusPercent)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="first-run-setup-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleCompleteSetup}
                  disabled={!setupCanComplete}
                >
                  {t('firstRun.action.finish')}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
