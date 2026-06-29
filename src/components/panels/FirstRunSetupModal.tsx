import { useEffect, useRef, useState } from 'react'

type FirstRunNetwork = 'mainnet' | 'testnet'
type FirstRunSetupStep = 'network' | 'data' | 'bootstrap' | 'start' | 'done'
type PublicBootstrapCheckState = 'idle' | 'checking' | 'available' | 'unavailable'

type StartObserverResult = boolean | {
  ok: boolean
  output?: string | null
}

type Translate = (key: string, values?: Record<string, string | number>) => string

type FirstRunSetupModalProps = {
  initialStep?: FirstRunSetupStep
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
  nodeActionLoading: string | null
  nodeRunning: boolean
  syncStatusClass: string
  syncStatusText: string
  syncStatusMeta: string | null
  syncStatusProgressVisible: boolean
  syncStatusPercent: number | null
  selectNetwork: (network: FirstRunNetwork) => void
  chooseDataFolder: () => Promise<boolean>
  saveSettings: () => Promise<boolean>
  checkPublicBootstrap: () => Promise<any>
  restorePublicBootstrap: (backupId: string) => Promise<boolean>
  startObserverNode: () => Promise<StartObserverResult>
  onQuitSetup: () => void
  onComplete: () => void
  t: Translate
}

const SETUP_STEPS: Array<{ id: FirstRunSetupStep; labelKey: string; titleKey: string; helpKey: string }> = [
  {
    id: 'network',
    labelKey: 'firstRun.step.network.label',
    titleKey: 'firstRun.step.network.title',
    helpKey: 'firstRun.step.network.help'
  },
  {
    id: 'data',
    labelKey: 'firstRun.step.dataFolder.label',
    titleKey: 'firstRun.step.dataFolder.title',
    helpKey: 'firstRun.step.dataFolder.help'
  },
  {
    id: 'bootstrap',
    labelKey: 'firstRun.step.bootstrap.label',
    titleKey: 'firstRun.step.bootstrap.title',
    helpKey: 'firstRun.step.bootstrap.help'
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
  if (step === 'bootstrap' && isPublicBootstrapUnavailableOutput(message)) {
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

export function FirstRunSetupModal(props: FirstRunSetupModalProps) {
  const {
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
    nodeActionLoading,
    nodeRunning,
    syncStatusClass,
    syncStatusText,
    syncStatusMeta,
    syncStatusProgressVisible,
    syncStatusPercent,
    selectNetwork,
    chooseDataFolder,
    saveSettings,
    checkPublicBootstrap,
    restorePublicBootstrap,
    startObserverNode,
    onQuitSetup,
    onComplete,
    t,
    initialStep = 'network'
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
  const dataFolderReady = Boolean(baseDir?.trim()) && !settingsDirty
  const publicRestoreBusy = publicBootstrapListLoading || publicBootstrapRestoreLoading
  const publicRestoreReady = Boolean(latestPublicBackupId)
  const setupCanComplete = observerStarted || nodeRunning
  const showSyncStatus =
    (step === 'start' || step === 'done') && (nodeRunning || observerStarted || nodeActionLoading === 'start')
  const stepError =
    setupError ||
    (step === 'data' ? formError : null) ||
    (step === 'bootstrap' || step === 'start' ? nodeError : null)
  const publicBootstrapUnavailable =
    step === 'bootstrap' && stepError ? isPublicBootstrapUnavailableOutput(stepError) : false
  const bootstrapAvailabilityState: PublicBootstrapCheckState =
    publicRestoreReady
      ? 'available'
      : publicBootstrapUnavailable || publicBootstrapCheckState === 'unavailable' || !publicBootstrapUrl
        ? 'unavailable'
      : publicBootstrapListLoading ||
          publicBootstrapCheckState === 'checking' ||
          (step === 'bootstrap' && publicBootstrapCheckState === 'idle' && Boolean(publicBootstrapUrl) && !settingsDirty)
        ? 'checking'
        : 'idle'
  const currentError = publicBootstrapUnavailable ? null : friendlySetupError(stepError, step, t)
  const currentNotice = setupNotice

  useEffect(() => {
    if (step !== 'bootstrap') return

    if (settingsDirty) {
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

    const checkKey = `${network}|${baseDir}|${publicBootstrapUrl}`
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
  }, [baseDir, checkPublicBootstrap, latestPublicBackupId, network, publicBootstrapUrl, publicBootstrapCheckState, settingsDirty, step])

  const setSetupStep = (nextStep: FirstRunSetupStep) => {
    setSetupError(null)
    setSetupNotice(null)
    setStep(nextStep)
  }

  const handleNetworkNext = () => {
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
    if (ok) setSetupStep('bootstrap')
  }

  const handleContinueBootstrap = async () => {
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
    setSetupStep('start')
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

  const currentNetworkLabel = networkLabel(t, network)

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

          {step === 'network' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.network.question')}</h4>
              <div className="first-run-choice-grid" role="radiogroup" aria-label={t('firstRun.network.question')}>
                <label className={`first-run-choice-card ${network === 'mainnet' ? 'is-selected' : ''}`.trim()}>
                  <span className="first-run-radio-row">
                    <input
                      type="radio"
                      name="first-run-network"
                      checked={network === 'mainnet'}
                      onChange={() => selectNetwork('mainnet')}
                    />
                    <strong>{t('firstRun.network.mainnet')}</strong>
                  </span>
                  <p>{t('firstRun.network.mainnetHelp')}</p>
                </label>
                <label className={`first-run-choice-card ${network === 'testnet' ? 'is-selected' : ''}`.trim()}>
                  <span className="first-run-radio-row">
                    <input
                      type="radio"
                      name="first-run-network"
                      checked={network === 'testnet'}
                      onChange={() => selectNetwork('testnet')}
                    />
                    <strong>{t('firstRun.network.testnet')}</strong>
                  </span>
                  <p>{t('firstRun.network.testnetHelp')}</p>
                </label>
              </div>
              <div className="first-run-setup-actions">
                <button type="button" className="primary-button" onClick={handleNetworkNext}>
                  {t('firstRun.action.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'data' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.dataFolder.question')}</h4>
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>{t('firstRun.summary.network')}</span>
                  <strong>{currentNetworkLabel}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.savedDataFolder')}</span>
                  <strong>{shortStatus(baseDir, t('firstRun.empty.notSet'))}</strong>
                </div>
                <div>
                  <span>{t('firstRun.summary.selectedDataFolder')}</span>
                  <strong>{shortStatus(draftBaseDir, t('firstRun.empty.notSet'))}</strong>
                </div>
              </div>

              <p className="conflict-modal-copy">
                {t('firstRun.dataFolder.description')}
              </p>

              <div className="first-run-setup-actions">
                <button type="button" className="ghost-button" onClick={handleChooseDataFolder}>
                  {t('firstRun.action.chooseFolder')}
                </button>
                <button type="button" className="primary-button" onClick={handleSaveSettings} disabled={!draftBaseDir.trim()}>
                  {t('firstRun.action.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'bootstrap' && (
            <div className="first-run-setup-panel">
              <h4>{t('firstRun.bootstrap.question')}</h4>
              <section className="first-run-restore-card" aria-live="polite">
                {bootstrapAvailabilityState === 'checking' && (
                  <>
                    <h4>{t('firstRun.status.bootstrapChecking')}</h4>
                    <p>{t('firstRun.bootstrap.checkingDescription', { network: currentNetworkLabel })}</p>
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
                    <p>{t('firstRun.bootstrap.availableDescription')}</p>
                    <div className="first-run-restore-meta">
                      <span>{t('firstRun.summary.latestSnapshot')}</span>
                      <strong>{shortStatus(latestPublicBackupId, t('firstRun.empty.notSet'))}</strong>
                    </div>
                  </>
                )}
              </section>

              <div className="first-run-setup-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleContinueBootstrap}
                  disabled={bootstrapAvailabilityState === 'checking' || publicRestoreBusy}
                >
                  {publicBootstrapRestoreLoading ? t('firstRun.status.bootstrapRestoring') : t('firstRun.action.next')}
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
