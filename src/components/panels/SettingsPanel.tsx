import { useEffect, useState } from 'react'
import { normalizeAppLanguage } from '../../i18n'
import { KOINOS_NETWORK_OPTIONS, normalizeKoinosNetworkId } from '../../app/network'
import { remoteBackupDefaults, syncLocalBackupPathsToBaseDir } from '../../app/utils'
import { NodeConfigPanel } from './NodeConfigPanel'
type SettingsPanelProps = any

type SettingsTab = 'general' | 'explorer' | 'dashboard' | 'backup' | 'node'

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    t,
    applySettings,
    language,
    setLanguage,
    settings,
    setSettings,
    appPreferences = { keepRunningInMenuBar: false },
    setAppPreferences = () => {},
    draftPublicRpcUrls,
    setDraftPublicRpcUrls,
    draftKoinscanUrl,
    setDraftKoinscanUrl,
    draftPollMs,
    setDraftPollMs,
    draftRowLimit,
    setDraftRowLimit,
    draftDashboardProducerWindowBlocks,
    setDraftDashboardProducerWindowBlocks,
    draftDashboardRefreshSeconds,
    setDraftDashboardRefreshSeconds,
    hasNodeControls,
    draftNodeNetwork,
    setDraftNodeNetwork,
    draftNodeBackup,
    setDraftNodeBackup,
    draftNodeBackupPassword = '',
    setDraftNodeBackupPassword = () => {},
    runNativeBackupDryRun,
    nodeBusy,
    nodeSettings,
    nodeNativeBackupDryRunLoading,
    draftNodeBaseDir,
    setDraftNodeBaseDir,
    setNodeBaseDirValidation,
    validateDraftNodeBaseDir,
    setFormError,
    pickNodeBaseDir,
    nodeBaseDirPickerLoading,
    nodeBaseDirValidationLoading,
    nodeBaseDirValidation,
    formError,
    resetDefaults,
    settingsDirty,
    onBlockedSettingsNavigation,
    onRunFirstRunSetup,
    appBuildInfo
  } = props

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const saveSettingsButtonClass = `primary-button settings-save-button ${settingsDirty ? 'is-dirty' : ''}`.trim()
  const updateBackup = (patch: Record<string, unknown>) => {
    setFormError(null)
    setDraftNodeBackup((current: any) => ({ ...current, ...patch }))
  }
  const updateBackupPassword = (value: string) => {
    setFormError(null)
    setDraftNodeBackupPassword(value)
  }
  const renderFormError = () => (
    formError ? <p className="form-error" role="alert">{formError}</p> : null
  )
  const advancedMode = settings.nodeAdvancedMode || settings.producerAdvancedMode
  const setAdvancedMode = (enabled: boolean) => {
    setSettings((current: any) => ({
      ...current,
      nodeAdvancedMode: enabled,
      producerAdvancedMode: enabled
    }))
  }

  useEffect(() => {
    if (!draftNodeBackup.remoteEnabled) return
    const defaults = remoteBackupDefaults(draftNodeNetwork)
    const needsDefaults = Boolean(
      (!draftNodeBackup.sshAuth && 'private-key') ||
      (!draftNodeBackup.sshHost && defaults.sshHost) ||
      (!draftNodeBackup.sshUser && defaults.sshUser) ||
      (!draftNodeBackup.remoteDirectory && defaults.remoteDirectory) ||
      (!draftNodeBackup.sshPrivateKeyFile && defaults.sshPrivateKeyFile) ||
      (!draftNodeBackup.sshKnownHostsFile && defaults.sshKnownHostsFile)
    )
    if (!needsDefaults) return

    setDraftNodeBackup((current: any) => {
      if (!current.remoteEnabled) return current
      const next = {
        ...current,
        sshAuth: current.sshAuth || 'private-key',
        sshHost: current.sshHost || defaults.sshHost || '',
        sshUser: current.sshUser || defaults.sshUser || '',
        remoteDirectory: current.remoteDirectory || defaults.remoteDirectory || '',
        sshPrivateKeyFile: current.sshPrivateKeyFile || defaults.sshPrivateKeyFile || '',
        sshKnownHostsFile: current.sshKnownHostsFile || defaults.sshKnownHostsFile || ''
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
  }, [
    draftNodeBackup.remoteEnabled,
    draftNodeBackup.sshHost,
    draftNodeBackup.sshUser,
    draftNodeBackup.remoteDirectory,
    draftNodeBackup.sshPrivateKeyFile,
    draftNodeBackup.sshKnownHostsFile,
    draftNodeNetwork,
    setDraftNodeBackup
  ])

  useEffect(() => {
    setDraftNodeBackup((current: any) => {
      const next = syncLocalBackupPathsToBaseDir(current, draftNodeBaseDir)
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
  }, [draftNodeBaseDir, setDraftNodeBackup])

  useEffect(() => {
    if (settings.nodeAdvancedMode === settings.producerAdvancedMode) return
    const enabled = settings.nodeAdvancedMode || settings.producerAdvancedMode
    setAdvancedMode(enabled)
  }, [settings.nodeAdvancedMode, settings.producerAdvancedMode])

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: t('settings.tabGeneral') },
    { id: 'explorer', label: t('settings.tabExplorer') },
    { id: 'dashboard', label: t('settings.tabDashboard') },
    { id: 'backup', label: t('settings.tabBackup') },
    { id: 'node', label: t('settings.tabNode') }
  ]
  const requestSettingsTab = (tab: SettingsTab) => {
    if (tab === activeTab) return
    if (settingsDirty) {
      onBlockedSettingsNavigation?.()
      return
    }
    setFormError(null)
    setActiveTab(tab)
  }

  const buildInfoValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return t('common.na')
    return String(value)
  }
  const buildGitRevision = appBuildInfo?.gitShortCommit || t('common.na')
  const buildGitRevisionTitle = appBuildInfo?.gitCommit || buildGitRevision
  const buildSourceState = appBuildInfo?.gitDirty === true
    ? t('settings.buildInfoSourceDirty')
    : appBuildInfo?.gitDirty === false
      ? t('settings.buildInfoSourceClean')
      : t('common.na')
  const nativeNodeFullHash = appBuildInfo?.nativeNode?.sha256 || ''
  const nativeNodeHash = appBuildInfo?.nativeNode?.shortSha256 || nativeNodeFullHash
  const nativeNodeHashTitle = [
    appBuildInfo?.nativeNode?.versionOutput,
    nativeNodeFullHash ? `sha256:${nativeNodeFullHash}` : ''
  ].filter(Boolean).join('\n') || nativeNodeHash || t('common.na')
  const nativeNodeVersion = appBuildInfo?.nativeNode?.buildVersion || appBuildInfo?.nativeNode?.semanticVersion || ''
  const nativeNodeLabel = [
    buildInfoValue(appBuildInfo?.nativeNode?.binaryName),
    nativeNodeVersion,
    nativeNodeHash ? `sha256:${nativeNodeHash}` : ''
  ].filter(Boolean).join(' · ')

  return (
    <section
      id="panel-settings"
      className="settings-panel"
      aria-label={t('settings.panelAria')}
      role="tabpanel"
      aria-labelledby="tab-settings"
    >
      <div className="settings-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-tab-button ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => requestSettingsTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form className="settings-form" onSubmit={applySettings} style={activeTab === 'node' ? { display: 'none' } : undefined}>

        {/* ─── General ─── */}
        {activeTab === 'general' && (
          <>
            <div>
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={advancedMode}
                  onChange={(event) => {
                    setAdvancedMode(event.target.checked)
                  }}
                />
                <span>{t('settings.advancedMode')}</span>
              </label>
              <span className="settings-inline-help">
                {advancedMode ? t('settings.advancedModeHelpOn') : t('settings.advancedModeHelpOff')}
              </span>
            </div>

            <div>
              <label className="settings-toggle-row" title={t('settings.menuBarHelp')}>
                <input
                  type="checkbox"
                  checked={appPreferences.keepRunningInMenuBar === true}
                  onChange={(event) => {
                    setAppPreferences((current: any) => ({
                      ...current,
                      keepRunningInMenuBar: event.target.checked
                    }))
                  }}
                />
                <span>{t('settings.menuBarMode')}</span>
              </label>
              <span className="settings-inline-help">
                {t('settings.menuBarHelp')}
              </span>
            </div>

            <div className="settings-assistant-row">
              <div>
                <strong>{t('settings.firstRunAssistantTitle')}</strong>
                <span className="settings-inline-help">
                  {t('settings.firstRunAssistantDescription')}
                </span>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onRunFirstRunSetup?.()}
                disabled={settingsDirty}
                title={settingsDirty ? t('settings.firstRunAssistantUnsavedTooltip') : t('settings.firstRunAssistantTooltip')}
              >
                {t('settings.firstRunAssistantRun')}
              </button>
            </div>

            <label>
              {t('settings.baseDataDir')}
              <div className="settings-input-with-button">
                <input
                  type="text"
                  value={draftNodeBaseDir}
                  onChange={(event) => {
                    setDraftNodeBaseDir(event.target.value)
                    setNodeBaseDirValidation(null)
                  }}
                  onBlur={(event) => {
                    const input = event.target.value.trim()
                    void validateDraftNodeBaseDir(input).then((result: any) => {
                      if (!result.ok) {
                        setFormError(result.output || t('settings.baseDirNotUsable', { baseDir: input }))
                      } else {
                        setDraftNodeBaseDir(result.baseDir)
                        setFormError(null)
                      }
                    })
                  }}
                  placeholder="~/.koinos"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="ghost-button settings-inline-button"
                  onClick={() => {
                    void pickNodeBaseDir()
                  }}
                  disabled={!hasNodeControls || nodeBusy}
                >
                  {nodeBaseDirPickerLoading ? t('common.opening') : t('common.browse')}
                </button>
              </div>
              <span
                className={`settings-inline-help ${
                  nodeBaseDirValidationLoading
                    ? 'is-busy'
                    : nodeBaseDirValidation
                      ? nodeBaseDirValidation.ok
                        ? 'is-ok'
                        : 'is-error'
                      : ''
                }`.trim()}
              >
                {nodeBaseDirValidationLoading
                  ? t('settings.baseDirChecking')
                  : nodeBaseDirValidation?.message || t('settings.baseDirHelp')}
              </span>
            </label>

            <label>
              {t('settings.language')}
              <select style={{ maxWidth: '200px' }} value={language} onChange={(event) => setLanguage(normalizeAppLanguage(event.target.value))}>
                <option value="en">{t('language.english')}</option>
                <option value="es">{t('language.spanish')}</option>
              </select>
            </label>

            <label>
              {t('settings.network')}
              <select
                style={{ maxWidth: '260px' }}
                value={draftNodeNetwork}
                onChange={(event) => {
                  setDraftNodeNetwork(normalizeKoinosNetworkId(event.target.value))
                }}
                disabled={nodeBusy}
              >
                {KOINOS_NETWORK_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <span className="settings-inline-help">
                {KOINOS_NETWORK_OPTIONS.find((option) => option.id === draftNodeNetwork)?.description || ''}
              </span>
            </label>

            <div className="settings-subheader">
              <h3>{t('settings.buildInfoTitle')}</h3>
              <p>{t('settings.buildInfoDescription')}</p>
            </div>
            <div className="settings-build-info-grid">
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoProductVersion')}</span>
                <strong className="settings-build-info-value mono">{buildInfoValue(appBuildInfo?.productVersion)}</strong>
              </div>
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoReleaseChannel')}</span>
                <strong className="settings-build-info-value mono">{buildInfoValue(appBuildInfo?.releaseChannel)}</strong>
              </div>
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoBuiltAt')}</span>
                <strong className="settings-build-info-value mono">{buildInfoValue(appBuildInfo?.buildTimestamp)}</strong>
              </div>
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoGitRevision')}</span>
                <strong className="settings-build-info-value mono" title={buildGitRevisionTitle}>{buildGitRevision}</strong>
              </div>
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoGitBranch')}</span>
                <strong className="settings-build-info-value mono">{buildInfoValue(appBuildInfo?.gitBranch)}</strong>
              </div>
              <div className="settings-build-info-item">
                <span className="settings-build-info-label">{t('settings.buildInfoSourceState')}</span>
                <strong className="settings-build-info-value">{buildSourceState}</strong>
              </div>
              <div className="settings-build-info-item settings-build-info-item-wide">
                <span className="settings-build-info-label">{t('settings.buildInfoNativeNode')}</span>
                <strong className="settings-build-info-value mono" title={nativeNodeHashTitle}>{nativeNodeLabel}</strong>
              </div>
            </div>

            {renderFormError()}

            <div className="settings-actions">
              <button type="button" className="ghost-button" onClick={resetDefaults}>
                {t('settings.reset')}
              </button>
              <button type="submit" className={saveSettingsButtonClass} disabled={!settingsDirty}>
                {t('settings.saveSettings')}
              </button>
            </div>
          </>
        )}

        {/* ─── Explorer ─── */}
        {activeTab === 'explorer' && (
          <>
            <div className="settings-subheader">
              <h3>{t('settings.explorerTitle')}</h3>
              <p>{t('settings.explorerDescription')}</p>
            </div>
            <label>
              {t('settings.publicRpcUrls')}
              <textarea
                className="settings-textarea mono"
                value={draftPublicRpcUrls}
                onChange={(event) => setDraftPublicRpcUrls(event.target.value)}
                placeholder={`https://api.koinos.io\nhttps://api.koinosblocks.com`}
                rows={4}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="settings-inline-help">{t('settings.publicRpcUrlsHelp')}</span>
            </label>

            <label>
              {t('settings.koinscanUrl')}
              <input
                type="text"
                value={draftKoinscanUrl}
                onChange={(event) => setDraftKoinscanUrl(event.target.value)}
                placeholder="koinscan.com"
                autoComplete="off"
              />
              <span className="settings-inline-help">{t('settings.koinscanUrlHelp')}</span>
            </label>

            <div className="settings-row settings-row-3">
              <label>
                {t('settings.refreshMs')}
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={500}
                  value={draftPollMs}
                  onChange={(event) => setDraftPollMs(event.target.value)}
                />
              </label>
              <label>
                {t('settings.rows')}
                <input
                  type="number"
                  min={5}
                  max={50}
                  step={1}
                  value={draftRowLimit}
                  onChange={(event) => setDraftRowLimit(event.target.value)}
                />
              </label>
            </div>

            {renderFormError()}

            <div className="settings-actions">
              <button type="button" className="ghost-button" onClick={resetDefaults}>
                {t('settings.reset')}
              </button>
              <button type="submit" className={saveSettingsButtonClass} disabled={!settingsDirty}>
                {t('settings.saveSettings')}
              </button>
            </div>
          </>
        )}

        {/* ─── Dashboard ─── */}
        {activeTab === 'dashboard' && (
          <>
            <div className="settings-subheader">
              <h3>{t('settings.dashboardTitle')}</h3>
              <p>{t('settings.dashboardDescription')}</p>
            </div>

            <div className="settings-row">
              <label>
                {t('settings.dashboardProducerWindowBlocks')}
                <input
                  type="number"
                  min={20}
                  max={5000}
                  step={10}
                  value={draftDashboardProducerWindowBlocks}
                  onChange={(event) => setDraftDashboardProducerWindowBlocks(event.target.value)}
                />
                <span className="settings-inline-help">{t('settings.dashboardProducerWindowBlocksHelp')}</span>
              </label>
              <label>
                {t('settings.dashboardRefreshSeconds')}
                <input
                  type="number"
                  min={2}
                  max={60}
                  step={1}
                  value={draftDashboardRefreshSeconds}
                  onChange={(event) => setDraftDashboardRefreshSeconds(event.target.value)}
                />
                <span className="settings-inline-help">{t('settings.dashboardRefreshSecondsHelp')}</span>
              </label>
            </div>

            {renderFormError()}

            <div className="settings-actions">
              <button type="button" className="ghost-button" onClick={resetDefaults}>
                {t('settings.reset')}
              </button>
              <button type="submit" className={saveSettingsButtonClass} disabled={!settingsDirty}>
                {t('settings.saveSettings')}
              </button>
            </div>
          </>
        )}

        {/* ─── Backup ─── */}
        {activeTab === 'backup' && !advancedMode && (
          <>
            <div className="settings-subheader">
              <h3>{t('settings.backupSimpleTitle')}</h3>
              <p>{t('settings.backupSimpleDescription')}</p>
            </div>
            <p className="settings-inline-help">
              {t('settings.backupSimpleRestoreHint')}
            </p>
            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setAdvancedMode(true)}
                disabled={nodeBusy}
              >
                {t('settings.backupShowExpertControls')}
              </button>
            </div>
          </>
        )}

        {activeTab === 'backup' && advancedMode && (
          <>
            <div className="settings-subheader">
              <h3>{t('settings.backupExpertTitle')}</h3>
              <p>{t('settings.backupExpertDescription')}</p>
            </div>

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runNativeBackupDryRun() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty}
                title={settingsDirty ? t('node.nativeBackupDryRunDisabledTooltip') : t('node.nativeBackupDryRunTooltip')}
              >
                {nodeNativeBackupDryRunLoading ? t('node.nativeBackupDryRunLoading') : t('node.nativeBackupDryRun')}
              </button>
            </div>
            {settingsDirty && (
              <p className="settings-inline-help is-busy">
                {t('node.nativeBackupDryRunSaveFirst')}
              </p>
            )}

            <div className="settings-row">
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={draftNodeBackup.localEnabled}
                  onChange={(event) => updateBackup({ localEnabled: event.target.checked })}
                  disabled={nodeBusy}
                />
                <span>Enable local backup repository</span>
              </label>
            </div>
            <div className="settings-row">
              <label>
                Local repository
                <input
                  type="text"
                  value={draftNodeBackup.localDirectory}
                  onChange={(event) => updateBackup({ localDirectory: event.target.value })}
                  placeholder="Default: BASEDIR/.teleno-native-backups/repository"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.localEnabled}
                />
                <span className="settings-inline-help">{t('settings.backupLocalRepositoryHelp')}</span>
              </label>
              <label>
                Workspace
                <input
                  type="text"
                  value={draftNodeBackup.workspace}
                  onChange={(event) => updateBackup({ workspace: event.target.value })}
                  placeholder="Default: BASEDIR/.teleno-native-backups/workspace"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.localEnabled}
                />
                <span className="settings-inline-help">{t('settings.backupWorkspaceHelp')}</span>
              </label>
            </div>
            <div className="settings-row">
              <label>
                Local retention
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draftNodeBackup.localRetentionCount}
                  onChange={(event) => updateBackup({ localRetentionCount: Number.parseInt(event.target.value, 10) || 1 })}
                  disabled={nodeBusy || !draftNodeBackup.localEnabled}
                />
              </label>
            </div>

            <div className="settings-subheader" style={{ marginTop: '1.5rem' }}>
              <h3>Remote SFTP backup</h3>
              <p>Configure the native libssh repository used by backup create, restore fetch, and scheduled backups.</p>
            </div>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.remoteEnabled}
                onChange={(event) => updateBackup({ remoteEnabled: event.target.checked })}
                disabled={nodeBusy}
              />
              <span>Enable remote SFTP backup</span>
            </label>

            <div className="settings-row">
              <label>
                SSH host
                <input
                  type="text"
                  value={draftNodeBackup.sshHost}
                  onChange={(event) => updateBackup({ sshHost: event.target.value })}
                  placeholder={remoteBackupDefaults(draftNodeNetwork).sshHost}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={draftNodeBackup.sshPort}
                  onChange={(event) => updateBackup({ sshPort: Number.parseInt(event.target.value, 10) || 22 })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                SSH user
                <input
                  type="text"
                  value={draftNodeBackup.sshUser}
                  onChange={(event) => updateBackup({ sshUser: event.target.value })}
                  placeholder="teleno_backup"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
            </div>

            <div className="settings-row settings-row-3">
              <label>
                Auth
                <select
                  value={draftNodeBackup.sshAuth}
                  onChange={(event) => updateBackup({ sshAuth: event.target.value })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                >
                  <option value="private-key">Private key</option>
                  <option value="password-file">Password</option>
                  <option value="env-password">Environment password</option>
                </select>
              </label>
              <label>
                Private key file
                <input
                  type="text"
                  value={draftNodeBackup.sshPrivateKeyFile}
                  onChange={(event) => updateBackup({ sshPrivateKeyFile: event.target.value })}
                  placeholder="~/.ssh/id_ed25519"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled || draftNodeBackup.sshAuth !== 'private-key'}
                />
              </label>
              <label>
                SSH password
                <input
                  type="password"
                  value={draftNodeBackupPassword}
                  onChange={(event) => updateBackupPassword(event.target.value)}
                  placeholder={draftNodeBackup.sshPasswordFile ? 'Leave blank to keep saved password' : 'Password'}
                  autoComplete="new-password"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled || draftNodeBackup.sshAuth !== 'password-file'}
                />
              </label>
            </div>

            <div className="settings-row settings-row-3">
              <label>
                Password file
                <input
                  type="text"
                  value={draftNodeBackup.sshPasswordFile}
                  onChange={(event) => updateBackup({ sshPasswordFile: event.target.value })}
                  placeholder="Auto-created when password is saved"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled || draftNodeBackup.sshAuth !== 'password-file'}
                />
              </label>
              <label>
                Key passphrase file
                <input
                  type="text"
                  value={draftNodeBackup.sshPassphraseFile}
                  onChange={(event) => updateBackup({ sshPassphraseFile: event.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                Known hosts file
                <input
                  type="text"
                  value={draftNodeBackup.sshKnownHostsFile}
                  onChange={(event) => updateBackup({ sshKnownHostsFile: event.target.value })}
                  placeholder="~/.ssh/known_hosts"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                Connect timeout
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={draftNodeBackup.sshConnectTimeoutSeconds}
                  onChange={(event) => updateBackup({ sshConnectTimeoutSeconds: Number.parseInt(event.target.value, 10) || 15 })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
            </div>

            <label>
              Remote directory
              <input
                type="text"
                value={draftNodeBackup.remoteDirectory}
                onChange={(event) => updateBackup({ remoteDirectory: event.target.value })}
                placeholder="/srv/teleno-backups/testnet/node-1"
                spellCheck={false}
                autoComplete="off"
                disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
              />
              <span className="settings-inline-help">Must be an absolute path on the remote server.</span>
            </label>

            <div className="settings-row">
              <label>
                Remote retention count
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draftNodeBackup.remoteRetentionCount}
                  onChange={(event) => updateBackup({ remoteRetentionCount: Number.parseInt(event.target.value, 10) || 1 })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                Remote retention days
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={draftNodeBackup.remoteRetentionDays}
                  onChange={(event) => updateBackup({ remoteRetentionDays: Number.parseInt(event.target.value, 10) || 1 })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
              <label>
                Upload temp suffix
                <input
                  type="text"
                  value={draftNodeBackup.uploadTempSuffix}
                  onChange={(event) => updateBackup({ uploadTempSuffix: event.target.value })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                />
              </label>
            </div>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.sshStrictHostKeyChecking}
                onChange={(event) => updateBackup({ sshStrictHostKeyChecking: event.target.checked })}
                disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
              />
              <span>Strict host-key checking</span>
            </label>

            <div className="settings-subheader" style={{ marginTop: '1.5rem' }}>
              <h3>Automatic backups</h3>
              <p>Schedule native hot backups inside teleno_node.</p>
            </div>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.scheduleEnabled}
                onChange={(event) => updateBackup({ scheduleEnabled: event.target.checked })}
                disabled={nodeBusy}
              />
              <span>Enable automatic backups</span>
            </label>

            <div className="settings-row">
              <label>
                Interval
                <input
                  type="text"
                  value={draftNodeBackup.scheduleInterval}
                  onChange={(event) => updateBackup({ scheduleInterval: event.target.value })}
                  placeholder="6h"
                  disabled={nodeBusy || !draftNodeBackup.scheduleEnabled}
                />
              </label>
              <label>
                Jitter seconds
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={draftNodeBackup.scheduleJitterSeconds}
                  onChange={(event) => updateBackup({ scheduleJitterSeconds: Number.parseInt(event.target.value, 10) || 0 })}
                  disabled={nodeBusy || !draftNodeBackup.scheduleEnabled}
                />
              </label>
              <label>
                Minimum head progress
                <input
                  type="number"
                  min={0}
                  value={draftNodeBackup.scheduleMinimumHeadProgress}
                  onChange={(event) => updateBackup({ scheduleMinimumHeadProgress: Number.parseInt(event.target.value, 10) || 0 })}
                  disabled={nodeBusy || !draftNodeBackup.scheduleEnabled}
                />
              </label>
            </div>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.scheduleRunOnStartupIfMissed}
                onChange={(event) => updateBackup({ scheduleRunOnStartupIfMissed: event.target.checked })}
                disabled={nodeBusy || !draftNodeBackup.scheduleEnabled}
              />
              <span>Run once after startup if missed</span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.scheduleSkipIfSyncingFromGenesis}
                onChange={(event) => updateBackup({ scheduleSkipIfSyncingFromGenesis: event.target.checked })}
                disabled={nodeBusy || !draftNodeBackup.scheduleEnabled}
              />
              <span>Skip while still at genesis</span>
            </label>

            <div className="settings-subheader" style={{ marginTop: '1.5rem' }}>
              <h3>Native backup admin</h3>
              <p>Optional local-only API for running-node backup status and control.</p>
            </div>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draftNodeBackup.adminEnabled}
                onChange={(event) => updateBackup({ adminEnabled: event.target.checked })}
                disabled={nodeBusy}
              />
              <span>Enable local backup admin API</span>
            </label>

            <div className="settings-row">
              <label>
                Admin listen
                <input
                  type="text"
                  value={draftNodeBackup.adminListen}
                  onChange={(event) => updateBackup({ adminListen: event.target.value })}
                  disabled={nodeBusy || !draftNodeBackup.adminEnabled}
                />
              </label>
              <label>
                Token file
                <input
                  type="text"
                  value={draftNodeBackup.adminTokenFile}
                  onChange={(event) => updateBackup({ adminTokenFile: event.target.value })}
                  placeholder="Auto-generated if empty"
                  disabled={nodeBusy || !draftNodeBackup.adminEnabled}
                />
                <span className="settings-inline-help">{t('settings.backupAdminTokenFileHelp')}</span>
              </label>
              <label>
                Jobs
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={draftNodeBackup.adminJobs}
                  onChange={(event) => updateBackup({ adminJobs: Number.parseInt(event.target.value, 10) || 1 })}
                  disabled={nodeBusy || !draftNodeBackup.adminEnabled}
                />
              </label>
            </div>

            {renderFormError()}

            <div className="settings-actions">
              <button type="submit" className={saveSettingsButtonClass} disabled={!settingsDirty}>
                {t('settings.saveSettings')}
              </button>
            </div>
          </>
        )}
      </form>

      {/* ─── Node Config ─── */}
      {activeTab === 'node' && hasNodeControls && (
        <NodeConfigPanel
          t={t}
          hasNodeControls={hasNodeControls}
          nodeSettings={nodeSettings}
          advancedMode={settings.nodeAdvancedMode}
        />
      )}

      {activeTab === 'node' && !hasNodeControls && (
        <div className="settings-form">
          <p className="settings-inline-help">{t('settings.nodeNotAvailable')}</p>
        </div>
      )}
    </section>
  )
}
