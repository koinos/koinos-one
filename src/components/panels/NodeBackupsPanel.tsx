import { formatBytes, formatDateTime, formatTime } from '../../app/utils'

type NodeBackupsPanelProps = any
type BackupSourceLabel = 'local' | 'remote' | 'public'

const TESTNET_PUBLIC_BOOTSTRAP_URL = 'https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap'

function parseBackupTimestampMs(snapshot: TelenoNodeNativeBackupSnapshot): number {
  const rawCreatedAt = snapshot.createdAt?.trim()
  const isoMs = rawCreatedAt ? Date.parse(rawCreatedAt) : Number.NaN
  if (Number.isFinite(isoMs)) return isoMs

  const compactTimestamp = rawCreatedAt || snapshot.backupId
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

function backupDefaultRepository(baseDir: string): string {
  return baseDir ? `${baseDir}/.teleno-native-backups/repository` : 'N/A'
}

function backupDefaultWorkspace(baseDir: string): string {
  return baseDir ? `${baseDir}/.teleno-native-backups/workspace` : 'N/A'
}

function backupSelectionValue(sourceLabel: BackupSourceLabel, backupId: string): string {
  return `${sourceLabel}:${backupId}`
}

function latestBackupSnapshot(snapshots: TelenoNodeNativeBackupSnapshot[], latestBackupId?: string): TelenoNodeNativeBackupSnapshot | null {
  if (latestBackupId) {
    const byId = snapshots.find((snapshot) => snapshot.backupId === latestBackupId)
    if (byId) return byId
  }
  return snapshots.find((snapshot) => snapshot.latest) ?? snapshots[0] ?? null
}

function spaceStatusClass(passes: boolean | null, loading = false): string {
  if (loading) return 'is-busy'
  if (passes === true) return 'is-ok'
  if (passes === false) return 'is-error'
  return ''
}

export function NodeBackupsPanel(props: NodeBackupsPanelProps) {
  const {
    t,
    locale,
    hasNodeControls,
    nodeBusy,
    settingsDirty,
    advancedMode = false,
    nodeSettings,
    draftNodeBackup,
    nodeStatus,
    nodePrimaryConfigPath,
    runCreateBackup,
    runCancelBackup,
    runNativeBackupList,
    runNativeBackupRestorePreflight,
    runRestoreNativeBackupSelected,
    runPurgeNativeBackup = () => {},
    nodeCreateBackupLoading,
    nodeNativeBackupListLoading,
    nodeNativeBackupLocalListLoading,
    nodeNativeBackupRemoteListLoading,
    nodeNativeBackupPublicListLoading,
    nodeNativeBackupLocalList,
    nodeNativeBackupRemoteList,
    nodeNativeBackupPublicList,
    nodeNativeBackupPreflightLoading,
    nodeNativeBackupPreflight,
    selectedNativeBackupId,
    setSelectedNativeBackupId,
    nodeRestoreNativeBackupLoading,
    nodeNativeBackupPurgeLoading = null,
    simpleRemoteBackupSaving,
    setSimpleRemoteBackupEnabled,
    dashboardPerformance,
    dashboardPerformanceLoading,
    formError,
    nodeBackupProgress
  } = props

  const backupSettings = nodeSettings.backup ?? {}
  const simpleBackupSettings = draftNodeBackup ?? backupSettings
  const activeBaseDir = nodeStatus?.baseDir || nodeSettings.baseDir || ''
  const localBackupSnapshots = nodeNativeBackupLocalList?.snapshots ?? []
  const remoteBackupSnapshots = nodeNativeBackupRemoteList?.snapshots ?? []
  const publicBackupSnapshots = nodeNativeBackupPublicList?.snapshots ?? []
  const latestLocalBackup = latestBackupSnapshot(localBackupSnapshots, nodeNativeBackupLocalList?.latestBackupId)
  const latestRemoteBackup = latestBackupSnapshot(remoteBackupSnapshots, nodeNativeBackupRemoteList?.latestBackupId)
  const latestPublicBackup = latestBackupSnapshot(publicBackupSnapshots, nodeNativeBackupPublicList?.latestBackupId)
  const localRepository = nodeNativeBackupLocalList?.repositoryDir ||
    nodeNativeBackupRemoteList?.repositoryDir ||
    backupSettings.localDirectory ||
    backupDefaultRepository(activeBaseDir)
  const workspace = nodeNativeBackupLocalList?.workspaceDir ||
    nodeNativeBackupRemoteList?.workspaceDir ||
    backupSettings.workspace ||
    backupDefaultWorkspace(activeBaseDir)
  const remoteTarget = backupSettings.remoteEnabled
    ? `${backupSettings.sshUser || '?'}@${backupSettings.sshHost || '?'}:${backupSettings.remoteDirectory || '?'}`
    : 'Disabled'
  const publicBootstrapTarget = nodeSettings.network === 'testnet' ? TESTNET_PUBLIC_BOOTSTRAP_URL : 'Disabled'
  const adminListen = backupSettings.adminEnabled ? backupSettings.adminListen || '127.0.0.1:18088' : 'Disabled'
  const formatBackupCreatedAt = (snapshot: TelenoNodeNativeBackupSnapshot) =>
    formatDateTime(parseBackupTimestampMs(snapshot), locale, 'N/A')
  const formatSpaceLine = (availableBytes: number | null | undefined, neededBytes: number | null | undefined) =>
    `Free ${formatBytes(availableBytes, locale)} · needed ${formatBytes(neededBytes, locale)}`
  const backupActionDisabled =
    !hasNodeControls ||
    nodeBusy ||
    settingsDirty ||
    nodeNativeBackupListLoading ||
    nodeNativeBackupPreflightLoading ||
    nodeRestoreNativeBackupLoading ||
    nodeNativeBackupPurgeLoading !== null
  const remoteBackupAllowed = simpleBackupSettings.remoteEnabled === true
  const publicBootstrapAllowed = nodeSettings.network === 'testnet'
  const localCreateNeededBytes = latestLocalBackup?.totalBytes || dashboardPerformance?.host.blockchainDataBytes || null
  const localCreateAvailableBytes = dashboardPerformance?.host.freeDiskBytes ?? null
  const localCreatePasses = localCreateAvailableBytes !== null && localCreateNeededBytes !== null
    ? localCreateAvailableBytes >= localCreateNeededBytes
    : null
  const remoteCreateNeededBytes = latestLocalBackup?.totalBytes || localCreateNeededBytes
  const remoteSpace = nodeNativeBackupRemoteList?.remoteSpace
  const remoteCreateAvailableBytes = remoteSpace?.ok ? remoteSpace.availableBytes : null
  const remoteCreatePasses = remoteSpace?.ok && remoteCreateNeededBytes !== null
    ? remoteSpace.availableBytes >= remoteCreateNeededBytes
    : null
  const remoteCreateLoading = nodeNativeBackupRemoteListLoading
  const renderNativeBackupSnapshots = (
    snapshots: TelenoNodeNativeBackupSnapshot[],
    sourceLabel: BackupSourceLabel,
    emptyMessage: string
  ) => (
    snapshots.length === 0 ? (
      <p className="settings-inline-help">{emptyMessage}</p>
    ) : (
      <div className="node-backup-snapshot-list">
        {snapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => {
          const backupSelection = backupSelectionValue(sourceLabel, snapshot.backupId)
          const isSelectedBackup = selectedNativeBackupId === backupSelection
          const isPurgingBackup = nodeNativeBackupPurgeLoading === backupSelection
          const preflightMatches = Boolean(
            isSelectedBackup &&
            nodeNativeBackupPreflight &&
            (nodeNativeBackupPreflight.backupId || snapshot.backupId) === snapshot.backupId
          )
          const snapshotClass = [
            'node-backup-snapshot',
            preflightMatches ? 'is-verified' : '',
            preflightMatches && nodeNativeBackupPreflight?.readyToRestore ? 'is-ok' : '',
            preflightMatches && nodeNativeBackupPreflight && !nodeNativeBackupPreflight.readyToRestore ? 'is-error' : ''
          ].filter(Boolean).join(' ')
          return (
            <article className={snapshotClass} key={`${sourceLabel}-${snapshot.backupId}`}>
              <div className="node-backup-snapshot-header">
                <div className="node-backup-snapshot-title">
                  <strong className="mono">{snapshot.backupId}</strong>
                  <span className="node-backup-source-pill">{sourceLabel}</span>
                </div>
                <div className="node-backup-snapshot-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    aria-label={`Verify ${sourceLabel} backup ${snapshot.backupId}`}
                    onClick={() => {
                      setSelectedNativeBackupId(backupSelection)
                      void runNativeBackupRestorePreflight(backupSelection)
                    }}
                    disabled={backupActionDisabled}
                  >
                    {isSelectedBackup && nodeNativeBackupPreflightLoading ? 'Verifying...' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    aria-label={`Restore ${sourceLabel} backup ${snapshot.backupId}`}
                    onClick={() => {
                      setSelectedNativeBackupId(backupSelection)
                      void runRestoreNativeBackupSelected(backupSelection)
                    }}
                    disabled={backupActionDisabled}
                    title={t('node.restoreNativeLatestHelp')}
                  >
                    {isSelectedBackup && nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : 'Restore'}
                  </button>
                  {sourceLabel !== 'public' && (
                    <button
                      type="button"
                      className="danger-button node-backup-purge-button"
                      aria-label={`Purge ${sourceLabel} backup ${snapshot.backupId}`}
                      onClick={() => { void runPurgeNativeBackup(backupSelection) }}
                      disabled={backupActionDisabled}
                    >
                      {isPurgingBackup ? 'Purging...' : 'Purge'}
                    </button>
                  )}
                </div>
              </div>
              {snapshot.latest && <p className="settings-inline-help">Latest {sourceLabel} backup</p>}
              <p title={snapshot.createdAt || snapshot.backupId}>
                Created {formatBackupCreatedAt(snapshot)} · {formatBytes(snapshot.totalBytes, locale)} · {snapshot.fileCount} files
              </p>
              {!preflightMatches && (
                <p>
                  Estimated restore free space: minimum {formatBytes(snapshot.restoreSpace.minimumTargetFreeBytes, locale)}, recommended {formatBytes(snapshot.restoreSpace.recommendedTargetFreeBytes, locale)}
                </p>
              )}
              {preflightMatches && nodeNativeBackupPreflight && (
                <div className="node-backup-verification">
                  <strong>{nodeNativeBackupPreflight.readyToRestore ? 'Verified: ready to restore' : 'Verified: not ready to restore'}</strong>
                  <p>
                    Backup {nodeNativeBackupPreflight.backupId || snapshot.backupId} · {nodeNativeBackupPreflight.fileCount} files · missing objects {nodeNativeBackupPreflight.missingObjectCount}
                  </p>
                  <p>
                    {nodeNativeBackupPreflight.spaceCheck.message || 'No disk-space message returned.'}
                  </p>
                  <p>
                    Available {formatBytes(nodeNativeBackupPreflight.spaceCheck.availableBytes, locale)} · minimum {formatBytes(nodeNativeBackupPreflight.restoreSpace.minimumTargetFreeBytes, locale)} · recommended {formatBytes(nodeNativeBackupPreflight.restoreSpace.recommendedTargetFreeBytes, locale)}
                  </p>
                </div>
              )}
            </article>
          )
        })}
      </div>
    )
  )
  const renderBackupProgress = () => (
    nodeBackupProgress ? (
      <div className="node-backup-progress" role="status" aria-live="polite">
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
    ) : null
  )
  const renderRemoteBackupToggle = () => (
    <label className="node-backup-simple-toggle">
      <input
        type="checkbox"
        checked={simpleBackupSettings.remoteEnabled === true}
        onChange={(event) => { void setSimpleRemoteBackupEnabled(event.target.checked) }}
        disabled={nodeBusy || simpleRemoteBackupSaving}
      />
      <span>Allow remote backup</span>
    </label>
  )

  if (!advancedMode) {
    const restoreSource: BackupSourceLabel = remoteBackupAllowed
      ? 'remote'
      : latestLocalBackup
        ? 'local'
        : publicBootstrapAllowed
          ? 'public'
          : 'local'
    const restoreSnapshot = restoreSource === 'remote'
      ? latestRemoteBackup
      : restoreSource === 'public'
        ? latestPublicBackup
        : latestLocalBackup
    const restorePreflightMatches = Boolean(
      restoreSnapshot &&
      nodeNativeBackupPreflight?.backupId === restoreSnapshot.backupId &&
      selectedNativeBackupId === backupSelectionValue(restoreSource, restoreSnapshot.backupId)
    )
    const restoreAvailableBytes = restorePreflightMatches ? nodeNativeBackupPreflight?.spaceCheck.availableBytes : null
    const restoreNeededBytes = restorePreflightMatches
      ? nodeNativeBackupPreflight?.restoreSpace.minimumTargetFreeBytes
      : restoreSnapshot?.restoreSpace.minimumTargetFreeBytes
    const restorePasses = restorePreflightMatches ? nodeNativeBackupPreflight?.spaceCheck.passesMinimum === true : null
    const restoreLoading = (restoreSource === 'remote'
      ? nodeNativeBackupRemoteListLoading
      : restoreSource === 'public'
        ? nodeNativeBackupPublicListLoading
        : nodeNativeBackupLocalListLoading) ||
      nodeNativeBackupPreflightLoading
    const restoreSelection = backupSelectionValue(restoreSource, restoreSnapshot?.backupId || 'latest')

    return (
      <div className="node-backups-panel node-backups-panel-simple">
        <div className="node-backup-simple-actions">
          <div className="node-backup-simple-action-card">
            <button
              type="button"
              className="primary-button node-backup-large-button"
              onClick={() => { void runCreateBackup() }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeCreateBackupLoading}
            >
              {nodeCreateBackupLoading ? t('node.creatingBackup') : 'Create Backup'}
            </button>
            <div className="node-backup-simple-space">
              <p className={`settings-inline-help ${spaceStatusClass(localCreatePasses, dashboardPerformanceLoading)}`.trim()}>
                Local backup: {localCreatePasses === true ? 'enough space' : localCreatePasses === false ? 'not enough space' : 'checking space'}.
              </p>
              <p className="settings-inline-help">
                {formatSpaceLine(localCreateAvailableBytes, localCreateNeededBytes)}
              </p>
              {remoteBackupAllowed && (
                <>
                  <p className={`settings-inline-help ${spaceStatusClass(remoteCreatePasses, remoteCreateLoading)}`.trim()}>
                    Remote backup: {remoteCreatePasses === true
                      ? 'enough space'
                      : remoteCreatePasses === false
                        ? 'not enough space'
                        : remoteCreateLoading
                          ? 'checking space'
                          : 'space check unavailable'}.
                  </p>
                  {remoteSpace?.ok ? (
                    <p className="settings-inline-help">
                      {formatSpaceLine(remoteCreateAvailableBytes, remoteCreateNeededBytes)}
                    </p>
                  ) : (
                    <p className="settings-inline-help">
                      {remoteSpace?.message || `Needed ${formatBytes(remoteCreateNeededBytes, locale)}`}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="node-backup-simple-action-card">
            <button
              type="button"
              className="primary-button node-backup-large-button"
              onClick={() => { void runRestoreNativeBackupSelected(restoreSelection) }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeRestoreNativeBackupLoading}
              title={t('node.restoreNativeLatestHelp')}
            >
              {nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : 'Restore Backup'}
            </button>
            <div className="node-backup-simple-space">
              {restoreSnapshot ? (
                <>
                  <p className="settings-inline-help">
                    Latest {restoreSource} backup size: {formatBytes(restoreSnapshot.totalBytes, locale)}
                  </p>
                  <p className={`settings-inline-help ${spaceStatusClass(restorePasses, restoreLoading)}`.trim()}>
                    Local restore space: {restorePasses === true ? 'enough space' : restorePasses === false ? 'not enough space' : 'checking space'}.
                  </p>
                  <p className="settings-inline-help">
                    {formatSpaceLine(restoreAvailableBytes, restoreNeededBytes)}
                  </p>
                </>
              ) : (
                <p className={`settings-inline-help ${restoreLoading ? 'is-busy' : ''}`.trim()}>
                  {restoreLoading ? `Checking latest ${restoreSource} backup...` : `No latest ${restoreSource} backup found yet.`}
                </p>
              )}
            </div>
          </div>
        </div>
        {renderRemoteBackupToggle()}
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {renderBackupProgress()}
      </div>
    )
  }

  return (
    <div className="node-backups-panel">
      <section className="node-backup-context">
        <div>
          <span>BASEDIR</span>
          <strong className="mono" title={activeBaseDir || 'N/A'}>{activeBaseDir || 'N/A'}</strong>
        </div>
        <div>
          <span>Config</span>
          <strong className="mono" title={nodePrimaryConfigPath}>{nodePrimaryConfigPath}</strong>
        </div>
        <div>
          <span>Local repository</span>
          <strong className="mono" title={localRepository}>{localRepository}</strong>
        </div>
        <div>
          <span>Workspace</span>
          <strong className="mono" title={workspace}>{workspace}</strong>
        </div>
        <div>
          <span>Remote SFTP</span>
          <strong className="mono" title={remoteTarget}>{remoteTarget}</strong>
        </div>
        <div>
          <span>Public bootstrap</span>
          <strong className="mono" title={publicBootstrapTarget}>{publicBootstrapTarget}</strong>
        </div>
        <div>
          <span>Admin API</span>
          <strong className="mono" title={adminListen}>{adminListen}</strong>
        </div>
      </section>

      {settingsDirty && (
        <p className="settings-inline-help is-busy">
          Save Settings before running backup commands; backup actions use the saved node configuration.
        </p>
      )}

      <div className="node-backup-advanced-create">
        <div className="node-backup-create-actions">
          <div className="node-backup-create-card">
            <button
              type="button"
              className="ghost-button node-backup-create-button"
              onClick={() => { void runCreateBackup({ localEnabled: true, remoteEnabled: false }) }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeCreateBackupLoading}
            >
              {nodeCreateBackupLoading ? t('node.creatingBackup') : 'Create Local Backup'}
            </button>
            <div className="node-backup-simple-space">
              <p className={`settings-inline-help ${spaceStatusClass(localCreatePasses, dashboardPerformanceLoading)}`.trim()}>
                Local backup: {localCreatePasses === true ? 'enough space' : localCreatePasses === false ? 'not enough space' : 'checking space'}.
              </p>
              <p className="settings-inline-help">
                {formatSpaceLine(localCreateAvailableBytes, localCreateNeededBytes)}
              </p>
            </div>
          </div>
          <div className="node-backup-create-card">
            <button
              type="button"
              className="ghost-button node-backup-create-button"
              onClick={() => { void runCreateBackup({ localEnabled: true, remoteEnabled: true }) }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeCreateBackupLoading}
            >
              {nodeCreateBackupLoading ? t('node.creatingBackup') : 'Create Remote Backup'}
            </button>
            <div className="node-backup-simple-space">
              <p className={`settings-inline-help ${spaceStatusClass(remoteCreatePasses, remoteCreateLoading)}`.trim()}>
                Remote backup: {remoteCreatePasses === true
                    ? 'enough space'
                    : remoteCreatePasses === false
                      ? 'not enough space'
                      : remoteCreateLoading
                        ? 'checking space'
                        : 'space check unavailable'}.
              </p>
              {remoteSpace?.ok ? (
                <p className="settings-inline-help">
                  {formatSpaceLine(remoteCreateAvailableBytes, remoteCreateNeededBytes)}
                </p>
              ) : (
                <p className="settings-inline-help">
                  {remoteSpace?.message || `Needed ${formatBytes(remoteCreateNeededBytes, locale)}`}
                </p>
              )}
            </div>
          </div>
        </div>
        {nodeCreateBackupLoading && (
          <button
            type="button"
            className="ghost-button danger-button node-backup-cancel-button"
            onClick={() => { void runCancelBackup() }}
          >
            {t('node.cancelBackup')}
          </button>
        )}
      </div>

      <div className="node-backup-list node-backup-inventory-grid" role="status" aria-live="polite">
        <section className="node-backup-inventory-panel">
          <div className="node-backup-inventory-panel-header">
            <h4>Local backups</h4>
            <button
              type="button"
              className="ghost-button node-backup-inventory-refresh-button"
              onClick={() => { void runNativeBackupList() }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeNativeBackupLocalListLoading}
            >
              {nodeNativeBackupLocalListLoading ? 'Refreshing local...' : 'Refresh local list'}
            </button>
          </div>
          <p className="settings-inline-help">Completed snapshots currently stored in this node's local native backup repository.</p>
          {nodeNativeBackupLocalList
            ? renderNativeBackupSnapshots(localBackupSnapshots, 'local', 'No completed local native snapshots were found.')
            : <p className="settings-inline-help">Refresh local list to inspect completed local snapshots.</p>}
        </section>

        <section className="node-backup-inventory-panel">
          <div className="node-backup-inventory-panel-header">
            <h4>Remote backups</h4>
            <button
              type="button"
              className="ghost-button node-backup-inventory-refresh-button"
              onClick={() => { void runNativeBackupList(true) }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || !backupSettings.remoteEnabled || nodeNativeBackupRemoteListLoading}
              title="Fetch remote snapshot metadata into the local native repository cache."
            >
              {nodeNativeBackupRemoteListLoading ? 'Refreshing remote...' : 'Refresh remote list'}
            </button>
          </div>
          <p className="settings-inline-help">Remote snapshot metadata fetched from the configured native libssh repository.</p>
          {!backupSettings.remoteEnabled ? (
            <p className="settings-inline-help">Enable remote SFTP backup in Settings to fetch remote metadata.</p>
          ) : nodeNativeBackupRemoteList ? (
            renderNativeBackupSnapshots(remoteBackupSnapshots, 'remote', 'No completed remote native snapshots were found.')
          ) : (
            <p className="settings-inline-help">Refresh remote list to fetch SFTP metadata into the local cache.</p>
          )}
        </section>

        <section className="node-backup-inventory-panel">
          <div className="node-backup-inventory-panel-header">
            <h4>Public bootstrap backups</h4>
            <button
              type="button"
              className="ghost-button node-backup-inventory-refresh-button"
              onClick={() => { void runNativeBackupList('public') }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || !publicBootstrapAllowed || nodeNativeBackupPublicListLoading}
              title="Fetch public read-only bootstrap snapshot metadata."
            >
              {nodeNativeBackupPublicListLoading ? 'Refreshing public...' : 'Refresh public list'}
            </button>
          </div>
          <p className="settings-inline-help">Read-only bootstrap snapshots for new testnet nodes. No SSH credentials are required.</p>
          {!publicBootstrapAllowed ? (
            <p className="settings-inline-help">Public bootstrap restore is currently enabled only for testnet.</p>
          ) : nodeNativeBackupPublicList ? (
            renderNativeBackupSnapshots(publicBackupSnapshots, 'public', 'No public bootstrap snapshots were found.')
          ) : (
            <p className="settings-inline-help">Refresh public list to inspect published bootstrap snapshots.</p>
          )}
        </section>
      </div>

      {renderBackupProgress()}
    </div>
  )
}
