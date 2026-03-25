import { useEffect, useState } from 'react'
import { normalizeAppLanguage } from '../../i18n'
import { normalizeNodeBaseDirInput } from '../../app/utils'
import { MicroservicesConfigPanel } from './MicroservicesConfigPanel'

type BackupInfo = { ok: boolean; lastModified: string | null; sizeBytes: number | null }
type SettingsPanelProps = any

type SettingsTab = 'general' | 'explorer' | 'dashboard' | 'backup' | 'microservices'

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
    draftNodeBlockchainBackupUrl,
    setDraftNodeBlockchainBackupUrl,
    runNodeRestoreBackupVerify,
    nodeBusy,
    nodeSettings,
    nodeRestoreBackupVerifyLoading,
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
    getKoinosNodeBridge
  } = props

  const locale = language?.startsWith('es') ? 'es' : 'en'
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [backupInfoLoading, setBackupInfoLoading] = useState(false)

  useEffect(() => {
    const url = nodeSettings?.blockchainBackupUrl || draftNodeBlockchainBackupUrl
    if (!url || !url.startsWith('http')) return
    setBackupInfoLoading(true)
    const bridge = getKoinosNodeBridge?.()
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
    { id: 'microservices', label: t('settings.tabMicroservices') }
  ]

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
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form className="settings-form" onSubmit={applySettings} style={activeTab === 'microservices' ? { display: 'none' } : undefined}>

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
                    const normalized = normalizeNodeBaseDirInput(event.target.value)
                    setDraftNodeBaseDir(normalized)
                    void validateDraftNodeBaseDir(normalized).then((result: any) => {
                      if (!result.ok) {
                        setFormError(result.output || t('settings.baseDirNotUsable', { baseDir: normalized }))
                      } else {
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
              <button type="submit" className="primary-button">
                {t('settings.saveReconnect')}
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
              <button type="submit" className="primary-button">
                {t('settings.saveReconnect')}
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
              <button type="submit" className="primary-button">
                {t('settings.saveReconnect')}
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
              <span className="settings-inline-help">
                {t('node.restoreVerifyRequiresJsonrpc')}
              </span>
            </div>

            <div className="settings-actions">
              <button type="submit" className="primary-button">
                {t('settings.saveReconnect')}
              </button>
            </div>
          </>
        )}
      </form>

      {/* ─── Microservices ─── */}
      {activeTab === 'microservices' && hasNodeControls && (
        <MicroservicesConfigPanel
          t={t}
          hasNodeControls={hasNodeControls}
          nodeSettings={nodeSettings}
        />
      )}

      {activeTab === 'microservices' && !hasNodeControls && (
        <div className="settings-form">
          <p className="settings-inline-help">{t('settings.microservicesNotAvailable')}</p>
        </div>
      )}
    </section>
  )
}
