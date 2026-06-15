import { useEffect, useState } from 'react'
import { normalizeAppLanguage } from '../../i18n'
import { formatBytes, formatTime } from '../../app/utils'
import { KOINOS_NETWORK_OPTIONS, normalizeKoinosNetworkId } from '../../app/network'
import { NodeConfigPanel } from './MicroservicesConfigPanel'
type BackupInfo = { ok: boolean; lastModified: string | null; sizeBytes: number | null }
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
    draftPublicRpcUrls,
    setDraftPublicRpcUrls,
    draftPollMs,
    setDraftPollMs,
    draftRowLimit,
    setDraftRowLimit,
    draftDashboardProducerWindowBlocks,
    setDraftDashboardProducerWindowBlocks,
    draftDashboardRefreshSeconds,
    setDraftDashboardRefreshSeconds,
    hasNodeControls,
    openNodeFileEditor,
    nodeFileEditorLoading,
    nodeFileEditorSaving,
    draftNodeNetwork,
    setDraftNodeNetwork,
    draftNodeBlockchainBackupUrl,
    setDraftNodeBlockchainBackupUrl,
    draftNodeBackup,
    setDraftNodeBackup,
    runNodeRestoreBackupVerify,
    runCreateBackup,
    runCancelBackup,
    runRestoreLocalBackup,
    runNativeBackupDryRun,
    runNativeBackupList,
    runNativeBackupRestorePreflight,
    runRestoreNativeBackupSelected,
    runRestoreNativeBackupLatest,
    nodeBusy,
    nodeSettings,
    nodeRestoreBackupVerifyLoading,
    nodeCreateBackupLoading,
    nodeNativeBackupDryRunLoading,
    nodeNativeBackupListLoading,
    nodeNativeBackupList,
    nodeNativeBackupPreflightLoading,
    nodeNativeBackupPreflight,
    selectedNativeBackupId,
    setSelectedNativeBackupId,
    nodeRestoreNativeBackupLoading,
    nodeBackupProgress,
    configFileDisplayPath,
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
    getTelenoNodeBridge,
    nodeComponents
  } = props

  const locale = language?.startsWith('es') ? 'es' : 'en'
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [backupInfoLoading, setBackupInfoLoading] = useState(false)
  const saveSettingsButtonClass = `primary-button settings-save-button ${settingsDirty ? 'is-dirty' : ''}`.trim()
  const updateBackup = (patch: Record<string, unknown>) => {
    setDraftNodeBackup((current: any) => ({ ...current, ...patch }))
  }
  const nativeBackupSnapshots = nodeNativeBackupList?.snapshots ?? []

  useEffect(() => {
    const url = nodeSettings?.blockchainBackupUrl || draftNodeBlockchainBackupUrl
    if (!url || !url.startsWith('http')) return
    setBackupInfoLoading(true)
    const bridge = getTelenoNodeBridge?.()
    if (!bridge?.backupInfo) { setBackupInfoLoading(false); return }
    bridge.backupInfo(url)
      .then((info: BackupInfo) => setBackupInfo(info))
      .catch(() => setBackupInfo(null))
      .finally(() => setBackupInfoLoading(false))
  }, [nodeSettings?.blockchainBackupUrl]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <div className="settings-subheader">
              <h3>{t('settings.interfaceTitle')}</h3>
              <p>{t('settings.interfaceDescription')}</p>
            </div>
            <label>
              {t('settings.language')}
              <select style={{ maxWidth: '200px' }} value={language} onChange={(event) => setLanguage(normalizeAppLanguage(event.target.value))}>
                <option value="en">{t('language.english')}</option>
                <option value="es">{t('language.spanish')}</option>
              </select>
            </label>

            <div className="settings-subheader">
              <h3>{t('settings.nodeModeTitle')}</h3>
              <p>{t('settings.nodeModeDescription')}</p>
            </div>
            <div>
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={settings.nodeAdvancedMode}
                  onChange={(event) => {
                    setSettings((current: any) => ({ ...current, nodeAdvancedMode: event.target.checked }))
                  }}
                />
                <span>{t('settings.nodeAdvancedMode')}</span>
              </label>
              <span className="settings-inline-help">
                {settings.nodeAdvancedMode ? t('settings.nodeAdvancedHelpOn') : t('settings.nodeAdvancedHelpOff')}
              </span>
            </div>

            <div className="settings-subheader">
              <h3>{t('settings.producerModeTitle')}</h3>
              <p>{t('settings.producerModeDescription')}</p>
            </div>
            <div>
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={settings.producerAdvancedMode}
                  onChange={(event) => {
                    setSettings((current: any) => ({ ...current, producerAdvancedMode: event.target.checked }))
                  }}
                />
                <span>{t('settings.producerAdvancedMode')}</span>
              </label>
              <span className="settings-inline-help">
                {settings.producerAdvancedMode ? t('settings.producerAdvancedHelpOn') : t('settings.producerAdvancedHelpOff')}
              </span>
            </div>

            <label>
              Network
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

            {formError && <p className="form-error">{formError}</p>}

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

            <div className="settings-row">
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
        {activeTab === 'backup' && (
          <>
            <div className="settings-subheader">
              <h3>{t('settings.blockchainBackupTitle')}</h3>
              <p>{t('settings.blockchainBackupDescription')}</p>
            </div>

            <div className="settings-backup-row">
              <label style={{ flex: 1 }}>
                {t('settings.backupUrl')}
                <input
                  type="url"
                  value={draftNodeBlockchainBackupUrl}
                  onChange={(event) => setDraftNodeBlockchainBackupUrl(event.target.value)}
                  placeholder="http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz"
                  spellCheck={false}
                  autoComplete="off"
                  style={{ maxWidth: 480, fontSize: '0.8em' }}
                />
              </label>
              <div className="settings-backup-info">
                {backupInfo?.lastModified
                  ? <span className="settings-inline-help" title={backupInfo.lastModified}>
                      {t('settings.backupDate')}: {new Date(backupInfo.lastModified).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {backupInfo.sizeBytes ? ` · ${(backupInfo.sizeBytes / (1024 ** 3)).toFixed(1)} GB` : ''}
                    </span>
                  : backupInfoLoading
                    ? <span className="settings-inline-help">{t('common.loading')}</span>
                    : null
                }
              </div>
            </div>

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void runNodeRestoreBackupVerify()
                }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty}
                title={`${nodeSettings.blockchainBackupUrl}\n${t('node.restoreVerifyRequiresJsonrpc')}`}
              >
                {nodeRestoreBackupVerifyLoading ? t('node.restoringVerify') : t('node.restoreVerify')}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runRestoreNativeBackupLatest() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty}
                title={t('node.restoreNativeLatestHelp')}
              >
                {nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : t('node.restoreNativeLatest')}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runRestoreLocalBackup() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty}
                title="Restaurar desde un archivo .tar.gz local"
              >
                {nodeBusy ? 'Restaurando...' : 'Restore from local file'}
              </button>
              <span className="settings-inline-help">
                {t('node.restoreVerifyRequiresJsonrpc')}
              </span>
            </div>

            <div className="settings-subheader" style={{ marginTop: '1.5rem' }}>
              <h3>{t('node.createBackup')}</h3>
              <p>{t('node.nativeBackupDescription')}</p>
            </div>

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
                <span className="settings-inline-help">Leave empty to use the BASEDIR-scoped native repository.</span>
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
                <span className="settings-inline-help">Used for checkpoint and restore staging work.</span>
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
                  placeholder="testnet.koinosfoundation.org"
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

            <div className="settings-row">
              <label>
                Auth
                <select
                  value={draftNodeBackup.sshAuth}
                  onChange={(event) => updateBackup({ sshAuth: event.target.value })}
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled}
                >
                  <option value="private-key">Private key</option>
                  <option value="password-file">Password file</option>
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
                Password file
                <input
                  type="text"
                  value={draftNodeBackup.sshPasswordFile}
                  onChange={(event) => updateBackup({ sshPasswordFile: event.target.value })}
                  placeholder="0600 password file"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={nodeBusy || !draftNodeBackup.remoteEnabled || draftNodeBackup.sshAuth !== 'password-file'}
                />
              </label>
            </div>

            <div className="settings-row">
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

            <div className="settings-subheader" style={{ marginTop: '1.5rem' }}>
              <h3>Available native backups</h3>
              <p>Refresh local snapshots or fetch remote metadata into the local cache, then restore latest or a selected backup ID.</p>
            </div>

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runNativeBackupList() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty}
              >
                {nodeNativeBackupListLoading ? 'Refreshing backups...' : 'Refresh local list'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runNativeBackupList(true) }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty || !draftNodeBackup.remoteEnabled}
                title="Fetch remote snapshot metadata into the local native repository cache."
              >
                {nodeNativeBackupListLoading ? 'Refreshing backups...' : 'Refresh remote list'}
              </button>
              <label>
                Backup ID
                <select
                  value={selectedNativeBackupId}
                  onChange={(event) => setSelectedNativeBackupId(event.target.value)}
                  disabled={!hasNodeControls || nodeBusy || settingsDirty || nativeBackupSnapshots.length === 0}
                >
                  <option value="latest">Latest</option>
                  {nativeBackupSnapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => (
                    <option key={snapshot.backupId} value={snapshot.backupId}>
                      {snapshot.latest ? `${snapshot.backupId} (latest)` : snapshot.backupId}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runNativeBackupRestorePreflight() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty || nativeBackupSnapshots.length === 0}
              >
                {nodeNativeBackupPreflightLoading ? 'Verifying backup...' : 'Verify selected backup'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runRestoreNativeBackupSelected() }}
                disabled={!hasNodeControls || nodeBusy || settingsDirty || nativeBackupSnapshots.length === 0}
                title={t('node.restoreNativeLatestHelp')}
              >
                {nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : 'Restore selected native backup'}
              </button>
            </div>

            {nodeNativeBackupList && (
              <div className="node-backup-list" role="status" aria-live="polite">
                {nativeBackupSnapshots.length === 0 ? (
                  <p className="settings-inline-help">No completed native snapshots were found in the local repository.</p>
                ) : (
                  <div className="node-backup-snapshot-list">
                    {nativeBackupSnapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => (
                      <article className="node-backup-snapshot" key={snapshot.backupId}>
                        <div>
                          <strong className="mono">{snapshot.backupId}</strong>
                          {snapshot.latest && <span className="settings-inline-help"> latest</span>}
                        </div>
                        <p>
                          Created {snapshot.createdAt || 'N/A'} · {formatBytes(snapshot.totalBytes, locale)} · {snapshot.fileCount} files
                        </p>
                        <p>
                          Restore free space: minimum {formatBytes(snapshot.restoreSpace.minimumTargetFreeBytes, locale)}, recommended {formatBytes(snapshot.restoreSpace.recommendedTargetFreeBytes, locale)}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {nodeNativeBackupPreflight && (
              <div className={`node-backup-preflight ${nodeNativeBackupPreflight.readyToRestore ? 'is-ok' : 'is-error'}`}>
                <strong>{nodeNativeBackupPreflight.readyToRestore ? 'Selected backup is ready to restore' : 'Selected backup is not ready to restore'}</strong>
                <p className="settings-inline-help">
                  Backup {nodeNativeBackupPreflight.backupId || selectedNativeBackupId} · {nodeNativeBackupPreflight.fileCount} files · missing objects {nodeNativeBackupPreflight.missingObjectCount}
                </p>
                <p className="settings-inline-help">
                  {nodeNativeBackupPreflight.spaceCheck.message || 'No disk-space message returned.'}
                </p>
                <p className="settings-inline-help">
                  Available {formatBytes(nodeNativeBackupPreflight.spaceCheck.availableBytes, locale)} · minimum {formatBytes(nodeNativeBackupPreflight.restoreSpace.minimumTargetFreeBytes, locale)} · recommended {formatBytes(nodeNativeBackupPreflight.restoreSpace.recommendedTargetFreeBytes, locale)}
                </p>
              </div>
            )}

            <div className="settings-actions settings-actions-inline">
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runNativeBackupDryRun() }}
                disabled={!hasNodeControls || nodeBusy}
              >
                {nodeNativeBackupDryRunLoading ? t('node.nativeBackupDryRunLoading') : t('node.nativeBackupDryRun')}
              </button>
              {nodeCreateBackupLoading ? (
                <button
                  type="button"
                  className="ghost-button danger-button"
                  onClick={() => { void runCancelBackup() }}
                >
                  {t('node.cancelBackup')}
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => { void runCreateBackup() }}
                  disabled={!hasNodeControls || nodeBusy || settingsDirty}
                >
                  {t('node.createBackup')}
                </button>
              )}
            </div>

            {nodeBackupProgress && (
              <div className="node-backup-progress" role="status" aria-live="polite" style={{ marginTop: '1rem' }}>
                <div className="node-services-header">
                  <h3>
                    {nodeBackupProgress.action === 'create-backup'
                      ? t('node.backupProgress.create')
                      : nodeBackupProgress.action === 'restore-backup'
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
          components={nodeComponents}
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
