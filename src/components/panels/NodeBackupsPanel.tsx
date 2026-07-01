import { formatBytes, formatDateTime } from '../../app/utils'
import {
  publicBootstrapDescriptionForNetwork,
  publicBootstrapUrlForNetwork
} from '../../app/public-bootstrap'
import { NodeBackupProgressPanel } from './NodeBackupProgressPanel'

type NodeBackupsPanelProps = any
type BackupSourceLabel = 'local' | 'remote' | 'public'

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

function parseBackupTimestampMs(snapshot: TelenoNodeNativeBackupSnapshot): number {
  return parseTimestampMs(snapshot.createdAt, snapshot.backupId)
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
    : t('common.disabled')
  const publicBootstrapUrl = publicBootstrapUrlForNetwork(nodeSettings.network)
  const publicBootstrapTarget = publicBootstrapUrl || t('common.disabled')
  const publicBootstrapDescription = publicBootstrapDescriptionForNetwork(nodeSettings.network)
  const adminListen = backupSettings.adminEnabled ? backupSettings.adminListen || '127.0.0.1:18088' : t('common.disabled')
  const formatBackupCreatedAt = (snapshot: TelenoNodeNativeBackupSnapshot) =>
    formatDateTime(parseBackupTimestampMs(snapshot), locale, 'N/A')
  const formatBackupTimestamp = (value?: string, fallback?: string) =>
    formatDateTime(parseTimestampMs(value, fallback), locale, 'N/A')
  const formatSpaceLine = (availableBytes: number | null | undefined, neededBytes: number | null | undefined) =>
    `Free ${formatBytes(availableBytes, locale)} · needed ${formatBytes(neededBytes, locale)}`
  const formatCreateSpaceLine = (availableBytes: number | null | undefined, neededBytes: number | null | undefined) => {
    const neededLabel = neededBytes !== null && neededBytes !== undefined
      ? formatBytes(neededBytes, locale)
      : dashboardPerformanceLoading
        ? 'estimating'
        : 'not available'
    return `Free ${formatBytes(availableBytes, locale)} · needed ${neededLabel}`
  }
  const backupActionDisabled =
    !hasNodeControls ||
    nodeBusy ||
    settingsDirty ||
    nodeNativeBackupListLoading ||
    nodeNativeBackupPreflightLoading ||
    nodeRestoreNativeBackupLoading ||
    nodeNativeBackupPurgeLoading !== null
  const remoteBackupAllowed = backupSettings.remoteEnabled === true
  const publicBootstrapAllowed = Boolean(publicBootstrapUrl)
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
  const localCreateStatus = localCreatePasses === true
    ? 'enough space'
    : localCreatePasses === false
      ? 'not enough space'
      : dashboardPerformanceLoading
        ? 'checking space'
        : 'backup size estimate unavailable'
  const remoteCreateStatus = remoteCreatePasses === true
    ? 'enough space'
    : remoteCreatePasses === false
      ? 'not enough space'
      : remoteCreateLoading
        ? 'checking space'
        : remoteSpace?.ok && remoteCreateNeededBytes === null
          ? dashboardPerformanceLoading
            ? 'checking backup size'
            : 'backup size estimate unavailable'
          : 'space check unavailable'
  const renderBackupProgress = () => (
    <NodeBackupProgressPanel
      t={t}
      locale={locale}
      nodeBackupProgress={nodeBackupProgress}
      hasNodeControls={hasNodeControls}
      onCancelBackup={runCancelBackup}
    />
  )
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
              {sourceLabel === 'public' && (
                <p title={snapshot.publicBaseUrl || undefined}>
                  Public {snapshot.network || 'network unknown'} · published {formatBackupTimestamp(snapshot.promotedAt, snapshot.createdAt)} · source {snapshot.sourceNodeVersion || snapshot.nodeVersion || 'version unknown'}
                  {snapshot.sourceHeadHeight > 0 ? ` · head ${snapshot.sourceHeadHeight}` : ''}
                  {snapshot.sourceLibHeight > 0 ? ` · LIB ${snapshot.sourceLibHeight}` : ''}
                </p>
              )}
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
  void draftNodeBackup
  void simpleRemoteBackupSaving
  void setSimpleRemoteBackupEnabled

  if (!advancedMode) {
    const restoreSource: BackupSourceLabel = publicBootstrapAllowed
      ? 'public'
      : latestLocalBackup
        ? 'local'
        : remoteBackupAllowed
          ? 'remote'
          : 'local'
    const restoreSnapshot = restoreSource === 'remote'
      ? latestRemoteBackup
      : restoreSource === 'public'
        ? latestPublicBackup
        : latestLocalBackup
    const restoreSourceName = restoreSource === 'public'
      ? t('node.backupSourcePublic')
      : restoreSource === 'remote'
        ? t('node.backupSourceRemote')
        : t('node.backupSourceLocal')
    const restoreList = restoreSource === 'remote'
      ? nodeNativeBackupRemoteList
      : restoreSource === 'public'
        ? nodeNativeBackupPublicList
        : nodeNativeBackupLocalList
    const restoreListError = restoreList && restoreList.ok === false
      ? restoreList.output || t('node.backupSimpleListError', { source: restoreSourceName })
      : ''
    const restorePreflightMatches = Boolean(
      restoreSnapshot &&
      nodeNativeBackupPreflight?.backupId === restoreSnapshot.backupId &&
      selectedNativeBackupId === backupSelectionValue(restoreSource, restoreSnapshot.backupId)
    )
    const estimatedAvailableBytes = dashboardPerformance?.host.freeDiskBytes ?? null
    const restoreNeededBytes = restorePreflightMatches
      ? nodeNativeBackupPreflight?.restoreSpace.minimumTargetFreeBytes
      : restoreSnapshot?.restoreSpace.minimumTargetFreeBytes
    const estimatedRestorePasses = estimatedAvailableBytes !== null && restoreNeededBytes !== null && restoreNeededBytes !== undefined
      ? estimatedAvailableBytes >= restoreNeededBytes
      : null
    const restoreAvailableBytes = restorePreflightMatches
      ? nodeNativeBackupPreflight?.spaceCheck.availableBytes
      : estimatedAvailableBytes
    const restorePasses = restorePreflightMatches
      ? nodeNativeBackupPreflight?.spaceCheck.passesMinimum === true
      : estimatedRestorePasses
    const restoreLoading = (restoreSource === 'remote'
      ? nodeNativeBackupRemoteListLoading
      : restoreSource === 'public'
        ? nodeNativeBackupPublicListLoading
        : nodeNativeBackupLocalListLoading) ||
      nodeNativeBackupPreflightLoading
    const restoreSelection = backupSelectionValue(restoreSource, restoreSnapshot?.backupId || 'latest')
    const restoreReady = restorePreflightMatches
      ? nodeNativeBackupPreflight?.readyToRestore === true
      : restorePasses !== false
    const simpleRestoreDisabled =
      !hasNodeControls ||
      nodeBusy ||
      settingsDirty ||
      nodeRestoreNativeBackupLoading ||
      restoreLoading ||
      !restoreSnapshot ||
      !restoreReady ||
      Boolean(restoreListError) ||
      (restoreSource === 'public' && !publicBootstrapAllowed)

    return (
      <div className="node-backups-panel node-backups-panel-simple">
        <section className="node-backup-bootstrap-guide">
          <div>
            <span>{t('node.backupSimpleBootstrapSource')}</span>
            <strong className="mono" title={publicBootstrapTarget}>{publicBootstrapTarget}</strong>
          </div>
          <div className="node-backup-bootstrap-guide-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (restoreSource === 'remote') {
                  void runNativeBackupList(true)
                } else if (restoreSource === 'public') {
                  void runNativeBackupList('public')
                } else {
                  void runNativeBackupList()
                }
              }}
              disabled={!hasNodeControls || settingsDirty || restoreLoading || nodeRestoreNativeBackupLoading || (restoreSource === 'public' && !publicBootstrapAllowed)}
              title={t('node.backupCheckRepositoryHelp')}
            >
              {restoreLoading ? t('node.backupCheckingBootstrap') : t('node.backupCheckBootstrap')}
            </button>
          </div>
        </section>
        <div className="node-backup-simple-actions">
          <div className="node-backup-simple-action-card">
            <button
              type="button"
              className="primary-button node-backup-large-button"
              onClick={() => { void runRestoreNativeBackupSelected(restoreSelection) }}
              disabled={simpleRestoreDisabled}
              title={t('node.restoreNativeLatestHelp')}
            >
              {nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : t('node.restoreBackupPrimary')}
            </button>
            <div className="node-backup-simple-space">
              {restoreListError ? (
                <p className="settings-inline-help is-error" role="alert">
                  {restoreListError}
                </p>
              ) : restoreSnapshot ? (
                <>
                  <p className="settings-inline-help">
                    {t('node.backupSimpleLatestSize', {
                      source: restoreSourceName,
                      size: formatBytes(restoreSnapshot.totalBytes, locale)
                    })}
                  </p>
                  <p className="settings-inline-help">
                    {t('node.backupSimpleLatestDate', {
                      date: formatBackupTimestamp(restoreSnapshot.createdAt, restoreSnapshot.backupId)
                    })}
                  </p>
                  <p className={`settings-inline-help ${spaceStatusClass(restorePasses, restoreLoading)}`.trim()}>
                    {t('node.backupSimpleRestoreSpace', {
                      status: restorePasses === true
                        ? t('node.backupSpaceEnough')
                        : restorePasses === false
                          ? t('node.backupSpaceNotEnough')
                          : t('node.backupSpaceChecking')
                    })}
                  </p>
                  <p className="settings-inline-help">
                    {formatSpaceLine(restoreAvailableBytes, restoreNeededBytes)}
                  </p>
                </>
              ) : (
                <p className={`settings-inline-help ${restoreLoading ? 'is-busy' : ''}`.trim()}>
                  {restoreLoading
                    ? t('node.backupSimpleCheckingLatest', { source: restoreSourceName })
                    : t('node.backupSimpleNoLatest', { source: restoreSourceName })}
                </p>
              )}
            </div>
          </div>
        </div>
        {renderBackupProgress()}
        {formError && <p className="form-error" role="alert">{formError}</p>}
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
          <span>Public backup</span>
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
                Local backup: {localCreateStatus}.
              </p>
              <p className="settings-inline-help">
                {formatCreateSpaceLine(localCreateAvailableBytes, localCreateNeededBytes)}
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
                Remote backup: {remoteCreateStatus}.
              </p>
              {remoteSpace?.ok ? (
                <p className="settings-inline-help">
                  {formatCreateSpaceLine(remoteCreateAvailableBytes, remoteCreateNeededBytes)}
                </p>
              ) : (
                <p className="settings-inline-help">
                  {remoteSpace?.message || `Needed ${formatBytes(remoteCreateNeededBytes, locale)}`}
                </p>
              )}
            </div>
          </div>
        </div>
        {nodeCreateBackupLoading && !nodeBackupProgress && (
          <button
            type="button"
            className="ghost-button danger-button node-backup-cancel-button"
            onClick={() => { void runCancelBackup() }}
            title={t('node.cancelBackupTooltip')}
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
            <h4>Public backup snapshots</h4>
            <button
              type="button"
              className="ghost-button node-backup-inventory-refresh-button"
              onClick={() => { void runNativeBackupList('public') }}
              disabled={!hasNodeControls || nodeBusy || settingsDirty || !publicBootstrapAllowed || nodeNativeBackupPublicListLoading}
              title="Fetch public read-only backup metadata."
            >
              {nodeNativeBackupPublicListLoading ? 'Refreshing public...' : 'Refresh public list'}
            </button>
          </div>
          <p className="settings-inline-help">{publicBootstrapDescription}</p>
          {!publicBootstrapAllowed ? (
            <p className="settings-inline-help">Public backup restore is not available for this network.</p>
          ) : nodeNativeBackupPublicList ? (
            renderNativeBackupSnapshots(publicBackupSnapshots, 'public', 'No public backup snapshots were found.')
          ) : (
            <p className="settings-inline-help">Refresh public list to inspect published public backups.</p>
          )}
        </section>
      </div>

      {renderBackupProgress()}
    </div>
  )
}
