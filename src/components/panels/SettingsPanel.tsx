import { useEffect, useState } from 'react'
import { normalizeAppLanguage } from '../../i18n'
import { formatTime } from '../../app/utils'
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
    runNodeRestoreBackupVerify,
    runCreateBackup,
    runCancelBackup,
    runRestoreLocalBackup,
    nodeBusy,
    nodeSettings,
    nodeRestoreBackupVerifyLoading,
    nodeCreateBackupLoading,
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
                disabled={!hasNodeControls || nodeBusy}
                title={`${nodeSettings.blockchainBackupUrl}\n${t('node.restoreVerifyRequiresJsonrpc')}`}
              >
                {nodeRestoreBackupVerifyLoading ? t('node.restoringVerify') : t('node.restoreVerify')}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runRestoreLocalBackup() }}
                disabled={!hasNodeControls || nodeBusy}
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
              <p>Crea un snapshot local de chain/ y block_store/. Los servicios se paran automaticamente para garantizar consistencia.</p>
            </div>

            <div className="settings-actions settings-actions-inline">
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
                  disabled={!hasNodeControls || nodeBusy}
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
