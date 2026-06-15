import { formatBytes, formatDateTime, formatTime } from '../../app/utils'

type NodeBackupsPanelProps = any

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

function backupSelectionValue(sourceLabel: 'local' | 'remote', backupId: string): string {
  return `${sourceLabel}:${backupId}`
}

export function NodeBackupsPanel(props: NodeBackupsPanelProps) {
  const {
    t,
    locale,
    hasNodeControls,
    nodeBusy,
    settingsDirty,
    nodeSettings,
    nodeStatus,
    nodePrimaryConfigPath,
    runCreateBackup,
    runCancelBackup,
    runNativeBackupList,
    runNativeBackupRestorePreflight,
    runRestoreNativeBackupSelected,
    nodeCreateBackupLoading,
    nodeNativeBackupListLoading,
    nodeNativeBackupLocalListLoading,
    nodeNativeBackupRemoteListLoading,
    nodeNativeBackupLocalList,
    nodeNativeBackupRemoteList,
    nodeNativeBackupPreflightLoading,
    nodeNativeBackupPreflight,
    selectedNativeBackupId,
    setSelectedNativeBackupId,
    nodeRestoreNativeBackupLoading,
    nodeBackupProgress
  } = props

  const backupSettings = nodeSettings.backup ?? {}
  const activeBaseDir = nodeStatus?.baseDir || nodeSettings.baseDir || ''
  const localBackupSnapshots = nodeNativeBackupLocalList?.snapshots ?? []
  const remoteBackupSnapshots = nodeNativeBackupRemoteList?.snapshots ?? []
  const nativeBackupSnapshots = [...remoteBackupSnapshots, ...localBackupSnapshots]
  const hasNativeBackupSnapshots = nativeBackupSnapshots.length > 0
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
  const adminListen = backupSettings.adminEnabled ? backupSettings.adminListen || '127.0.0.1:18088' : 'Disabled'
  const selectedBackupDisplayId = selectedNativeBackupId.replace(/^(local|remote):/, '')

  const formatBackupCreatedAt = (snapshot: TelenoNodeNativeBackupSnapshot) =>
    formatDateTime(parseBackupTimestampMs(snapshot), locale, 'N/A')
  const formatBackupSelectLabel = (snapshot: TelenoNodeNativeBackupSnapshot, sourceLabel: 'local' | 'remote') => {
    const latestLabel = snapshot.latest ? ` · ${sourceLabel} latest` : ''
    return `${formatBackupCreatedAt(snapshot)} · ${snapshot.backupId}${latestLabel}`
  }
  const renderNativeBackupSnapshots = (
    snapshots: TelenoNodeNativeBackupSnapshot[],
    sourceLabel: 'local' | 'remote',
    emptyMessage: string
  ) => (
    snapshots.length === 0 ? (
      <p className="settings-inline-help">{emptyMessage}</p>
    ) : (
      <div className="node-backup-snapshot-list">
        {snapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => (
          <article className="node-backup-snapshot" key={`${sourceLabel}-${snapshot.backupId}`}>
            <div className="node-backup-snapshot-title">
              <strong className="mono">{snapshot.backupId}</strong>
              <span className="node-backup-source-pill">{sourceLabel}</span>
            </div>
            {snapshot.latest && <p className="settings-inline-help">Latest {sourceLabel} backup</p>}
            <p title={snapshot.createdAt || snapshot.backupId}>
              Created {formatBackupCreatedAt(snapshot)} · {formatBytes(snapshot.totalBytes, locale)} · {snapshot.fileCount} files
            </p>
            <p>
              Restore free space: minimum {formatBytes(snapshot.restoreSpace.minimumTargetFreeBytes, locale)}, recommended {formatBytes(snapshot.restoreSpace.recommendedTargetFreeBytes, locale)}
            </p>
          </article>
        ))}
      </div>
    )
  )

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
          <span>Admin API</span>
          <strong className="mono" title={adminListen}>{adminListen}</strong>
        </div>
      </section>

      {settingsDirty && (
        <p className="settings-inline-help is-busy">
          Save Settings before running backup commands; backup actions use the saved node configuration.
        </p>
      )}

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
            disabled={!hasNodeControls || nodeBusy || settingsDirty}
          >
            {t('node.createBackup')}
          </button>
        )}
        <button
          type="button"
          className="ghost-button"
          onClick={() => { void runNativeBackupList() }}
          disabled={!hasNodeControls || nodeBusy || settingsDirty || nodeNativeBackupLocalListLoading}
        >
          {nodeNativeBackupLocalListLoading ? 'Refreshing local...' : 'Refresh local list'}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => { void runNativeBackupList(true) }}
          disabled={!hasNodeControls || nodeBusy || settingsDirty || !backupSettings.remoteEnabled || nodeNativeBackupRemoteListLoading}
          title="Fetch remote snapshot metadata into the local native repository cache."
        >
          {nodeNativeBackupRemoteListLoading ? 'Refreshing remote...' : 'Refresh remote list'}
        </button>
      </div>

      <div className="settings-actions settings-actions-inline">
        <label>
          Restore backup ID
          <select
            value={selectedNativeBackupId}
            onChange={(event) => setSelectedNativeBackupId(event.target.value)}
            disabled={!hasNodeControls || nodeBusy || settingsDirty || !hasNativeBackupSnapshots || nodeNativeBackupListLoading}
          >
            <option value="latest">Latest available</option>
            {remoteBackupSnapshots.length > 0 && (
              <optgroup label="Remote SFTP backups">
                {remoteBackupSnapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => (
                  <option key={`remote-option-${snapshot.backupId}`} value={backupSelectionValue('remote', snapshot.backupId)}>
                    {formatBackupSelectLabel(snapshot, 'remote')}
                  </option>
                ))}
              </optgroup>
            )}
            {localBackupSnapshots.length > 0 && (
              <optgroup label="Local backups">
                {localBackupSnapshots.map((snapshot: TelenoNodeNativeBackupSnapshot) => (
                  <option key={`local-option-${snapshot.backupId}`} value={backupSelectionValue('local', snapshot.backupId)}>
                    {formatBackupSelectLabel(snapshot, 'local')}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          type="button"
          className="ghost-button"
          onClick={() => { void runNativeBackupRestorePreflight() }}
          disabled={!hasNodeControls || nodeBusy || settingsDirty || !hasNativeBackupSnapshots || nodeNativeBackupListLoading}
        >
          {nodeNativeBackupPreflightLoading ? 'Verifying backup...' : 'Verify selected backup'}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => { void runRestoreNativeBackupSelected() }}
          disabled={!hasNodeControls || nodeBusy || settingsDirty || !hasNativeBackupSnapshots || nodeNativeBackupListLoading}
          title={t('node.restoreNativeLatestHelp')}
        >
          {nodeRestoreNativeBackupLoading ? t('node.restoringNativeLatest') : 'Restore Backup'}
        </button>
      </div>

      <div className="node-backup-list node-backup-inventory-grid" role="status" aria-live="polite">
        <section className="node-backup-inventory-panel">
          <div className="node-backup-inventory-panel-header">
            <h4>Local native backups</h4>
            {nodeNativeBackupLocalListLoading && <span>Refreshing...</span>}
          </div>
          <p className="settings-inline-help">Completed snapshots currently stored in this node's local native backup repository.</p>
          {nodeNativeBackupLocalList
            ? renderNativeBackupSnapshots(localBackupSnapshots, 'local', 'No completed local native snapshots were found.')
            : <p className="settings-inline-help">Refresh local list to inspect completed local snapshots.</p>}
        </section>

        <section className="node-backup-inventory-panel">
          <div className="node-backup-inventory-panel-header">
            <h4>Remote SFTP backups</h4>
            {nodeNativeBackupRemoteListLoading && <span>Fetching...</span>}
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
      </div>

      {nodeNativeBackupPreflight && (
        <div className={`node-backup-preflight ${nodeNativeBackupPreflight.readyToRestore ? 'is-ok' : 'is-error'}`}>
          <strong>{nodeNativeBackupPreflight.readyToRestore ? 'Selected backup is ready to restore' : 'Selected backup is not ready to restore'}</strong>
          <p className="settings-inline-help">
            Backup {nodeNativeBackupPreflight.backupId || selectedBackupDisplayId} · {nodeNativeBackupPreflight.fileCount} files · missing objects {nodeNativeBackupPreflight.missingObjectCount}
          </p>
          <p className="settings-inline-help">
            {nodeNativeBackupPreflight.spaceCheck.message || 'No disk-space message returned.'}
          </p>
          <p className="settings-inline-help">
            Available {formatBytes(nodeNativeBackupPreflight.spaceCheck.availableBytes, locale)} · minimum {formatBytes(nodeNativeBackupPreflight.restoreSpace.minimumTargetFreeBytes, locale)} · recommended {formatBytes(nodeNativeBackupPreflight.restoreSpace.recommendedTargetFreeBytes, locale)}
          </p>
        </div>
      )}

      {nodeBackupProgress && (
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
      )}
    </div>
  )
}
