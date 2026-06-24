import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatTime } from '../../app/utils'
import type { NodeBackupProgressState } from '../../app/types'

type FirstRunSetupStep = 'data' | 'restore' | 'wallet' | 'producer' | 'start'
type PublicBootstrapCheckState = 'idle' | 'checking' | 'available' | 'unavailable'

type WalletDraft = {
  ok?: boolean
  output?: string
  address?: string | null
  privateKeyWif?: string | null
  seedPhrase?: string | null
  derivationPath?: string | null
}

type StartObserverResult = boolean | {
  ok: boolean
  output?: string | null
}

type FirstRunSetupModalProps = {
  t?: (key: string, values?: Record<string, string | number>) => string
  locale?: string
  initialStep?: FirstRunSetupStep
  network: string
  baseDir: string
  draftBaseDir: string
  settingsDirty: boolean
  formError: string | null
  nodeError: string | null
  walletError: string | null
  producerError: string | null
  publicBootstrapUrl: string
  publicBootstrapDescription: string
  publicBootstrapList: any
  publicBootstrapListLoading: boolean
  publicBootstrapRestoreLoading: boolean
  nodeBackupProgress?: NodeBackupProgressState | null
  nodeActionLoading: string | null
  nodeProducerActionLoading: string | null
  walletActionLoading: string | null
  walletAddress: string
  walletCanSign: boolean
  nodeRunning: boolean
  producerAddress: string
  producerLocalPublicKey: string
  producerRegisteredPublicKey: string
  producerSetupComplete: boolean
  producerRegisterDisabled: boolean
  producerRegisterHintText: string
  producerRegisterActionText: string
  syncStatusClass: string
  syncStatusText: string
  syncStatusMeta: string | null
  syncStatusProgressVisible: boolean
  syncStatusPercent: number | null
  chooseDataFolder: () => Promise<boolean>
  saveSettings: () => Promise<boolean>
  checkPublicBootstrap: () => Promise<any>
  restorePublicBootstrap: (backupId: string) => Promise<boolean>
  generateWalletDraft: () => Promise<WalletDraft>
  createWalletAccount: (password: string, confirmPassword: string, walletDraft?: WalletDraft | null) => Promise<boolean>
  useExistingProducerAddress: (address: string) => Promise<boolean>
  registerProducer: () => Promise<void>
  startObserverNode: () => Promise<StartObserverResult>
  onQuitSetup: () => void
  onComplete: () => void
}

function fallbackTranslate(key: string, values: Record<string, string | number> = {}) {
  const templates: Record<string, string> = {
    'common.na': 'N/A',
    'node.backupPhaseMeta': 'phase: {phase} · updated {time}',
    'node.backupTransferMeta': 'speed: {speed}/s · ETA {eta}',
    'node.backupSampleMeta': 'sample interval: {latency}',
    'node.backupLiveDownload': 'Live download',
    'node.backupLiveTransferMeta': '{speed}/s · ETA {eta} · {completed} / {total}',
    'node.backupLiveSpeedMeta': '{speed}/s · ETA {eta}',
    'node.backupWaitingTransferSample': 'Waiting for transfer sample...'
  }
  const template = templates[key] || key
  return template.replace(/\{(\w+)\}/g, (_match, name) => `${values[name] ?? ''}`)
}

function formatDurationCompact(seconds: number | null | undefined, emptyLabel: string): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return emptyLabel
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`
  const days = hours / 24
  return `${days >= 10 ? days.toFixed(0) : days.toFixed(1)}d`
}

const SETUP_STEPS: Array<{ id: FirstRunSetupStep; label: string; title: string; help: string }> = [
  {
    id: 'data',
    label: 'Folder',
    title: 'Choose where the node data will live',
    help: 'Pick a folder with enough disk space. Koinos One will put the unified blockchain database there.'
  },
  {
    id: 'restore',
    label: 'Restore',
    title: 'Choose how to bootstrap the node',
    help: 'Use the public snapshot when one is available, or sync directly from decentralized peers without a backup.'
  },
  {
    id: 'wallet',
    label: 'Address',
    title: 'Create or choose your producer address',
    help: 'Use a new local wallet or add an existing address. You can import keys later if this app must sign.'
  },
  {
    id: 'producer',
    label: 'Key',
    title: 'Prepare producer key registration',
    help: 'Registration and VHP/KOIN actions happen on-chain, so they stay behind explicit review screens.'
  },
  {
    id: 'start',
    label: 'Start',
    title: 'Start the node safely',
    help: 'The first launch starts as an observer. Enable production only after restore and producer setup are healthy.'
  }
]

function shortStatus(value: string, empty = 'Not set') {
  return value?.trim() ? value.trim() : empty
}

function publicBootstrapUnavailableMessage() {
  return 'No public bootstrap is available for this network right now. You can continue without it; the node will sync from decentralized peers, but the first sync can take several days.'
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

function friendlySetupError(message: string | null, step: FirstRunSetupStep) {
  if (!message) return null
  if (step === 'restore' && isPublicBootstrapUnavailableOutput(message)) {
    return publicBootstrapUnavailableMessage()
  }
  return message
}

function firstRunProducerHint(message: string) {
  return message
    .replace('Import or create a wallet in the Wallet tab before creating the producer.', 'Create a wallet in the Address step, or continue as an observer and import signing keys after setup.')
    .replace('Unlock the wallet in the Wallet tab before creating the producer.', 'Unlocking existing signing keys can be done after setup. You can continue as an observer now.')
    .replace('Importa o crea una wallet en la pestana Wallet antes de crear el producer.', 'Crea una wallet en el paso Address, o continua como observador e importa las claves despues.')
    .replace('Desbloquea la wallet en la pestana Wallet antes de crear el producer.', 'Puedes desbloquear claves existentes despues del setup. Ahora puedes continuar como observador.')
}

function startObserverFailureMessage(output?: string | null) {
  const detail = `${output || ''}`.trim()
  if (!detail) {
    return 'The node did not start. Koinos One could not get a detailed reason from the node launcher.'
  }
  return `The node did not start.\n${detail}`
}

export function FirstRunSetupModal(props: FirstRunSetupModalProps) {
  const {
    t = fallbackTranslate,
    locale = 'en-US',
    network,
    baseDir,
    draftBaseDir,
    settingsDirty,
    formError,
    nodeError,
    walletError,
    producerError,
    publicBootstrapUrl,
    publicBootstrapDescription,
    publicBootstrapList,
    publicBootstrapListLoading,
    publicBootstrapRestoreLoading,
    nodeBackupProgress,
    nodeActionLoading,
    nodeProducerActionLoading,
    walletActionLoading,
    walletAddress,
    walletCanSign,
    nodeRunning,
    producerAddress,
    producerLocalPublicKey,
    producerRegisteredPublicKey,
    producerSetupComplete,
    producerRegisterDisabled,
    producerRegisterHintText,
    producerRegisterActionText,
    syncStatusClass,
    syncStatusText,
    syncStatusMeta,
    syncStatusProgressVisible,
    syncStatusPercent,
    chooseDataFolder,
    saveSettings,
    checkPublicBootstrap,
    restorePublicBootstrap,
    generateWalletDraft,
    createWalletAccount,
    useExistingProducerAddress,
    registerProducer,
    startObserverNode,
    onQuitSetup,
    onComplete,
    initialStep = 'data'
  } = props

  const [step, setStep] = useState<FirstRunSetupStep>(initialStep)
  const [walletDraft, setWalletDraft] = useState<WalletDraft | null>(null)
  const [walletDraftLoading, setWalletDraftLoading] = useState(false)
  const [walletPassword, setWalletPassword] = useState('')
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('')
  const [existingAddress, setExistingAddress] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupNotice, setSetupNotice] = useState<string | null>(null)
  const [observerStarted, setObserverStarted] = useState(false)
  const [publicBootstrapCheckState, setPublicBootstrapCheckState] = useState<PublicBootstrapCheckState>('idle')
  const publicBootstrapCheckKeyRef = useRef('')

  const activeStepIndex = SETUP_STEPS.findIndex((entry) => entry.id === step)
  const activeStep = SETUP_STEPS[activeStepIndex] ?? SETUP_STEPS[0]
  const stepNumber = activeStepIndex + 1
  const progressPercent = Math.round((stepNumber / SETUP_STEPS.length) * 100)
  const restoreProgressActive = Boolean(
    step === 'restore' &&
    (publicBootstrapRestoreLoading || nodeBackupProgress?.action === 'restore-backup')
  )
  const restoreProgressPercent = nodeBackupProgress
    ? Math.max(0, Math.min(100, nodeBackupProgress.displayProgress ?? nodeBackupProgress.progress))
    : 0
  const visibleProgressPercent = restoreProgressActive ? restoreProgressPercent : progressPercent
  const visibleProgressLabel = new Intl.NumberFormat(locale, {
    maximumFractionDigits: restoreProgressActive && visibleProgressPercent > 0 && visibleProgressPercent < 99 ? 1 : 0
  }).format(visibleProgressPercent)
  const restoreTransferSampleFresh = !nodeBackupProgress?.sampleIntervalMs || nodeBackupProgress.sampleIntervalMs <= 10_000
  const restoreTransferSpeed = nodeBackupProgress?.bytesPerSecond && nodeBackupProgress.bytesPerSecond > 0 && restoreTransferSampleFresh
    ? formatBytes(nodeBackupProgress.bytesPerSecond, locale)
    : ''
  const restoreEta = nodeBackupProgress?.etaSeconds !== null && nodeBackupProgress?.etaSeconds !== undefined
    ? formatDurationCompact(nodeBackupProgress.etaSeconds, t('common.na'))
    : ''
  const restoreSampleInterval = nodeBackupProgress?.sampleIntervalMs && nodeBackupProgress.sampleIntervalMs > 0
    ? formatDurationCompact(nodeBackupProgress.sampleIntervalMs / 1000, t('common.na'))
    : ''
  const restoreCompletedSize = nodeBackupProgress?.completedBytes && nodeBackupProgress.completedBytes > 0
    ? formatBytes(nodeBackupProgress.completedBytes, locale)
    : ''
  const restoreTotalSize = nodeBackupProgress?.totalBytes && nodeBackupProgress.totalBytes > 0
    ? formatBytes(nodeBackupProgress.totalBytes, locale)
    : ''
  const restoreLiveTransferDetail = restoreTransferSpeed
    ? restoreCompletedSize && restoreTotalSize
      ? t('node.backupLiveTransferMeta', {
          speed: restoreTransferSpeed,
          eta: restoreEta || t('common.na'),
          completed: restoreCompletedSize,
          total: restoreTotalSize
        })
      : t('node.backupLiveSpeedMeta', {
          speed: restoreTransferSpeed,
          eta: restoreEta || t('common.na')
        })
    : t('node.backupWaitingTransferSample')
  const restoreLiveTransferVisible = Boolean(
    restoreProgressActive &&
    nodeBackupProgress &&
    nodeBackupProgress.phase !== 'error' &&
    nodeBackupProgress.phase !== 'complete'
  )
  const latestPublicBackupId = publicBootstrapList?.latestBackupId || ''
  const dataFolderReady = Boolean(baseDir?.trim()) && !settingsDirty
  const publicRestoreBusy = publicBootstrapListLoading || publicBootstrapRestoreLoading
  const walletBusy = walletDraftLoading || walletActionLoading !== null
  const publicRestoreReady = Boolean(latestPublicBackupId)
  const setupCanComplete = observerStarted || nodeRunning
  const showSyncStatus = step === 'start' && (nodeRunning || observerStarted || nodeActionLoading === 'start')
  const producerRegisterHint = firstRunProducerHint(producerRegisterHintText)
  const stepError =
    setupError ||
    (step === 'data' ? formError : null) ||
    (step === 'restore' || step === 'start' ? nodeError : null) ||
    (step === 'wallet' ? walletError : null) ||
    (step === 'producer' ? producerError : null)
  const publicBootstrapUnavailable =
    step === 'restore' && stepError ? isPublicBootstrapUnavailableOutput(stepError) : false
  const restoreAvailabilityState: PublicBootstrapCheckState =
    publicRestoreReady
      ? 'available'
      : publicBootstrapUnavailable || publicBootstrapCheckState === 'unavailable' || !publicBootstrapUrl
        ? 'unavailable'
      : publicBootstrapListLoading ||
          publicBootstrapCheckState === 'checking' ||
          (step === 'restore' && publicBootstrapCheckState === 'idle' && Boolean(publicBootstrapUrl) && !settingsDirty)
        ? 'checking'
        : 'idle'
  const currentError = publicBootstrapUnavailable ? null : friendlySetupError(stepError, step)
  const currentNotice = step === 'restore'
    ? null
    : setupNotice || (publicBootstrapUnavailable ? publicBootstrapUnavailableMessage() : null)

  useEffect(() => {
    if (step !== 'restore') return

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
  }, [baseDir, latestPublicBackupId, network, publicBootstrapUrl, settingsDirty, step]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSetupStep = (nextStep: FirstRunSetupStep) => {
    setSetupError(null)
    setSetupNotice(null)
    setStep(nextStep)
  }

  const goNext = () => {
    const next = SETUP_STEPS[Math.min(activeStepIndex + 1, SETUP_STEPS.length - 1)]
    setSetupStep(next.id)
  }

  const handleChooseDataFolder = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const ok = await chooseDataFolder()
    if (ok) setStep('data')
  }

  const handleSaveSettings = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const ok = await saveSettings()
    if (ok) setSetupStep('restore')
  }

  const handleRestorePublicBootstrap = async () => {
    setSetupError(null)
    setSetupNotice(null)
    if (!publicRestoreReady) {
      setSetupNotice(publicBootstrapUnavailableMessage())
      return
    }
    const backupId = latestPublicBackupId ? `public:${latestPublicBackupId}` : 'public:latest'
    const ok = await restorePublicBootstrap(backupId)
    if (ok) setSetupStep('wallet')
  }

  const handleGenerateWallet = async () => {
    setSetupError(null)
    setSetupNotice(null)
    setWalletDraftLoading(true)
    try {
      const result = await generateWalletDraft()
      setWalletDraft(result)
      if (!result?.ok) {
        setSetupError(result?.output || 'Unable to generate a producer address.')
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Unable to generate a producer address.')
    } finally {
      setWalletDraftLoading(false)
    }
  }

  const handleCreateWallet = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const ok = await createWalletAccount(walletPassword, walletPasswordConfirm, walletDraft)
    if (ok) {
      setWalletPassword('')
      setWalletPasswordConfirm('')
      setSetupStep('producer')
    }
  }

  const handleUseExistingAddress = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const address = existingAddress.trim()
    if (!address) {
      setSetupError('Enter the producer address to continue.')
      return
    }
    const ok = await useExistingProducerAddress(address)
    if (ok) setSetupStep('producer')
  }

  const handleStartObserver = async () => {
    setSetupError(null)
    setSetupNotice(null)
    const result = await startObserverNode()
    const ok = typeof result === 'boolean' ? result : result.ok
    if (ok) {
      setObserverStarted(true)
      setSetupStep('start')
      return
    }

    setSetupError(startObserverFailureMessage(typeof result === 'boolean' ? nodeError : result.output || nodeError))
  }

  const handleRegisterProducer = async () => {
    setSetupError(null)
    setSetupNotice(null)
    await registerProducer()
  }

  const handleCompleteSetup = () => {
    setSetupError(null)
    setSetupNotice(null)
    if (!setupCanComplete) {
      setSetupError('Start the node as an observer before completing setup.')
      return
    }
    onComplete()
  }

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
              Step {stepNumber} of {SETUP_STEPS.length}
            </p>
            <h3 id="first-run-setup-title" className="first-run-setup-title">
              {activeStep.title}
            </h3>
            <p className="first-run-setup-meta">
              {activeStep.help}
            </p>
          </div>
          <div className="first-run-setup-header-actions">
            <button type="button" className="ghost-button" onClick={onQuitSetup}>
              Close app
            </button>
          </div>
        </header>

        <div className="first-run-setup-progress" aria-label="Setup progress">
          <div className="first-run-setup-progress-row">
            <strong>{activeStep.label}</strong>
            <span>{visibleProgressLabel}%</span>
          </div>
          <div className="first-run-setup-progress-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(2, visibleProgressPercent)}%` }} />
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
              >
                <button type="button" onClick={() => setSetupStep(entry.id)}>
                  <span>{index + 1}</span>
                  <strong>{entry.label}</strong>
                </button>
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

          {step === 'data' && (
            <div className="first-run-setup-panel">
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>Network</span>
                  <strong>{network}</strong>
                </div>
                <div>
                  <span>Saved data folder</span>
                  <strong>{shortStatus(baseDir)}</strong>
                </div>
                <div>
                  <span>Selected folder</span>
                  <strong>{shortStatus(draftBaseDir)}</strong>
                </div>
              </div>

              <p className="conflict-modal-copy">
                This folder will hold the unified blockchain database, native backup repository, wallet metadata,
                and node runtime files. Choose it before restoring a bootstrap snapshot.
              </p>

              <div className="first-run-setup-actions">
                <button type="button" className="ghost-button" onClick={handleChooseDataFolder}>
                  Choose data folder
                </button>
                <button type="button" className="primary-button" onClick={handleSaveSettings} disabled={!draftBaseDir.trim()}>
                  Save folder and continue
                </button>
              </div>
            </div>
          )}

          {step === 'restore' && (
            <div className="first-run-setup-panel">
              {restoreAvailabilityState === 'checking' && (
                <section className="first-run-restore-card" aria-live="polite">
                  <h4>Checking for a public bootstrap</h4>
                  <p>
                    Koinos One is checking whether an official public bootstrap is available for {network}. This
                    happens automatically.
                  </p>
                  <div className="first-run-restore-status">
                    <span className="status-dot" aria-hidden="true" />
                    <strong>{publicBootstrapListLoading ? 'Checking availability...' : 'Preparing check...'}</strong>
                  </div>
                </section>
              )}

              {restoreAvailabilityState === 'unavailable' && (
                <section className="first-run-restore-card">
                  <h4>No public bootstrap is available right now</h4>
                  <p>{publicBootstrapUnavailableMessage()}</p>
                  <div className="first-run-setup-actions">
                    <button type="button" className="primary-button" onClick={() => setSetupStep('wallet')}>
                      Continue to address setup
                    </button>
                  </div>
                </section>
              )}

              {restoreAvailabilityState === 'available' && (
                <section className="first-run-restore-card">
                  <h4>Public bootstrap is available</h4>
                  <p>
                    {publicBootstrapDescription} Restoring it is the fastest way to start. You can also skip it and
                    sync directly from decentralized peers, but the first sync can take several days.
                  </p>
                  <div className="first-run-restore-meta">
                    <span>Latest snapshot</span>
                    <strong>{shortStatus(latestPublicBackupId)}</strong>
                  </div>
                  {restoreProgressActive && nodeBackupProgress && (
                    <div className="first-run-restore-progress" role="status" aria-live="polite">
                      {nodeBackupProgress.message && (
                        <p className="settings-inline-help">{nodeBackupProgress.message}</p>
                      )}
                      {restoreLiveTransferVisible && (
                        <p className="first-run-restore-live">
                          <span className="first-run-restore-live-dot" aria-hidden="true" />
                          <span>{t('node.backupLiveDownload')}</span>
                          <strong>{restoreLiveTransferDetail}</strong>
                        </p>
                      )}
                      <p className="first-run-restore-progress-meta mono">
                        {[
                          t('node.backupPhaseMeta', {
                            phase: nodeBackupProgress.phase,
                            time: formatTime(nodeBackupProgress.updatedAt, locale)
                          }),
                          restoreSampleInterval
                            ? t('node.backupSampleMeta', { latency: restoreSampleInterval })
                            : ''
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  )}
                  <div className="first-run-setup-actions">
                    <button type="button" className="ghost-button" onClick={() => setSetupStep('wallet')} disabled={publicRestoreBusy}>
                      Sync without bootstrap
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleRestorePublicBootstrap}
                      disabled={publicRestoreBusy || settingsDirty || !publicRestoreReady}
                    >
                      {publicBootstrapRestoreLoading ? 'Restoring bootstrap...' : 'Restore public bootstrap'}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}

          {step === 'wallet' && (
            <div className="first-run-setup-panel first-run-wallet-panel">
              <div className="first-run-setup-split">
                <div className="first-run-setup-box">
                  <h4>Create a new producer address</h4>
                  <p className="settings-inline-help">
                    Generate a new address and encrypted local wallet. Write down the seed phrase before creating
                    the wallet.
                  </p>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleGenerateWallet}
                    disabled={walletBusy}
                  >
                    {walletDraftLoading ? 'Generating...' : 'Generate address'}
                  </button>
                  {walletDraft?.ok && (
                    <div className="first-run-seed-box">
                      <span>Generated address</span>
                      <strong>{walletDraft.address}</strong>
                      <span>Seed phrase</span>
                      <code>{walletDraft.seedPhrase}</code>
                      {walletDraft.derivationPath && (
                        <>
                          <span>Derivation path</span>
                          <strong>{walletDraft.derivationPath}</strong>
                        </>
                      )}
                    </div>
                  )}
                  <div className="first-run-setup-form-grid">
                    <label className="node-field">
                      <span>Wallet password</span>
                      <input
                        type="password"
                        value={walletPassword}
                        onChange={(event) => setWalletPassword(event.target.value)}
                      />
                    </label>
                    <label className="node-field">
                      <span>Confirm password</span>
                      <input
                        type="password"
                        value={walletPasswordConfirm}
                        onChange={(event) => setWalletPasswordConfirm(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleCreateWallet}
                    disabled={walletBusy || !walletDraft?.ok || !walletPassword || !walletPasswordConfirm}
                  >
                    Create encrypted wallet
                  </button>
                </div>

                <div className="first-run-setup-box">
                  <h4>Use an existing producer address</h4>
                  <p className="settings-inline-help">
                    Enter any existing producer address. You can finish the first launch as an observer, then import
                    signing keys after setup if this app needs to register or sign for that address.
                  </p>
                  <label className="node-field">
                    <span>Existing producer address</span>
                    <input value={existingAddress} onChange={(event) => setExistingAddress(event.target.value)} />
                  </label>
                  <div className="first-run-setup-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={handleUseExistingAddress}
                      disabled={walletBusy || !existingAddress.trim()}
                    >
                      Use this address
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'producer' && (
            <div className="first-run-setup-panel">
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>Producer address</span>
                  <strong>{shortStatus(producerAddress, 'Not configured yet')}</strong>
                </div>
                <div>
                  <span>Wallet address</span>
                  <strong>{shortStatus(walletAddress)}</strong>
                </div>
                <div>
                  <span>Signing key</span>
                  <strong>{walletCanSign ? 'Ready' : 'Not imported yet'}</strong>
                </div>
                <div>
                  <span>Local producer public key</span>
                  <strong>{shortStatus(producerLocalPublicKey)}</strong>
                </div>
                <div>
                  <span>Registered producer key</span>
                  <strong>{shortStatus(producerRegisteredPublicKey)}</strong>
                </div>
              </div>

              <p className="conflict-modal-copy">
                Producer-key registration is optional during first launch. If the wallet has enough mana and the local
                producer key is ready, you can register it here. VHP transfers and KOIN burns are funding actions and
                can be done after the node has started as an observer.
              </p>
              <p className={`settings-inline-help ${producerRegisterDisabled && !producerSetupComplete ? 'is-error' : ''}`.trim()}>
                {producerSetupComplete
                  ? 'Producer key setup is complete.'
                  : producerRegisterHint}
              </p>

              <div className="first-run-setup-actions">
                {!producerSetupComplete && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleRegisterProducer}
                    disabled={producerRegisterDisabled}
                  >
                    {nodeProducerActionLoading === 'register' ? 'Registering...' : producerRegisterActionText}
                  </button>
                )}
                <button type="button" className="ghost-button" onClick={goNext}>
                  Continue to node start
                </button>
              </div>
            </div>
          )}

          {step === 'start' && (
            <div className="first-run-setup-panel">
              <div className="first-run-setup-summary-grid">
                <div>
                  <span>Start mode</span>
                  <strong>{setupCanComplete ? 'Observer ready' : 'Observer first'}</strong>
                </div>
                <div>
                  <span>Data folder</span>
                  <strong>{shortStatus(baseDir)}</strong>
                </div>
                <div>
                  <span>Network</span>
                  <strong>{network}</strong>
                </div>
              </div>

              <p className="conflict-modal-copy">
                The first launch starts the restored node as an observer. Enable block production only after the
                restored database is healthy, the producer address is funded, and the producer public key is
                registered.
              </p>
              {!setupCanComplete && (
                <p className="settings-inline-help is-error">
                  Setup is not complete yet. Start the node as an observer before entering the main app.
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
                  {nodeActionLoading === 'start' ? 'Starting observer...' : 'Start node as observer'}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleCompleteSetup}
                  disabled={!setupCanComplete}
                >
                  Complete setup
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
