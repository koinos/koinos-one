import type { NodeBackupProgressState } from '../../app/types'
import { formatBytes, formatTime } from '../../app/utils'

type Translate = (key: string, values?: Record<string, string | number>) => string

type NodeBackupProgressPanelProps = {
  t: Translate
  locale: string
  nodeBackupProgress: NodeBackupProgressState | null
  hasNodeControls?: boolean
  onCancelBackup?: () => void | Promise<void>
}

const TERMINAL_BACKUP_PHASES = new Set(['error', 'cancelled', 'complete'])

function formatDurationCompact(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return 'N/A'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`
  const days = hours / 24
  return `${days >= 10 ? days.toFixed(0) : days.toFixed(1)}d`
}

export function NodeBackupProgressPanel(props: NodeBackupProgressPanelProps) {
  const {
    t,
    locale,
    nodeBackupProgress,
    hasNodeControls = false,
    onCancelBackup
  } = props

  if (!nodeBackupProgress) return null

  const backupProgressPercent = Math.max(
    0,
    Math.min(100, nodeBackupProgress.displayProgress ?? nodeBackupProgress.progress)
  )
  const backupProgressPercentLabel = new Intl.NumberFormat(locale, {
    maximumFractionDigits: backupProgressPercent >= 99 || backupProgressPercent <= 0 ? 0 : 1
  }).format(backupProgressPercent)
  const backupTransferSampleFresh = !nodeBackupProgress.sampleIntervalMs || nodeBackupProgress.sampleIntervalMs <= 10_000
  const backupTransferSpeed = nodeBackupProgress.bytesPerSecond && nodeBackupProgress.bytesPerSecond > 0 && backupTransferSampleFresh
    ? formatBytes(nodeBackupProgress.bytesPerSecond, locale)
    : ''
  const backupEta = nodeBackupProgress.etaSeconds !== null && nodeBackupProgress.etaSeconds !== undefined
    ? formatDurationCompact(nodeBackupProgress.etaSeconds)
    : ''
  const backupSampleInterval = nodeBackupProgress.sampleIntervalMs && nodeBackupProgress.sampleIntervalMs > 0
    ? formatDurationCompact(nodeBackupProgress.sampleIntervalMs / 1000)
    : ''
  const backupCompletedSize = nodeBackupProgress.completedBytes && nodeBackupProgress.completedBytes > 0
    ? formatBytes(nodeBackupProgress.completedBytes, locale)
    : ''
  const backupTotalSize = nodeBackupProgress.totalBytes && nodeBackupProgress.totalBytes > 0
    ? formatBytes(nodeBackupProgress.totalBytes, locale)
    : ''
  const backupLiveTransferDetail = backupTransferSpeed
    ? backupCompletedSize && backupTotalSize
      ? t('node.backupLiveTransferMeta', {
          speed: backupTransferSpeed,
          eta: backupEta || 'N/A',
          completed: backupCompletedSize,
          total: backupTotalSize
        })
      : t('node.backupLiveSpeedMeta', {
          speed: backupTransferSpeed,
          eta: backupEta || 'N/A'
        })
    : t('node.backupWaitingTransferSample')
  const backupLiveTransferLabel = nodeBackupProgress.phase === 'restore'
    ? t('node.backupLiveRestore')
    : nodeBackupProgress.phase === 'upload'
      ? t('node.backupLiveUpload')
      : t('node.backupLiveDownload')
  const backupLiveTransferVisible = !TERMINAL_BACKUP_PHASES.has(nodeBackupProgress.phase)
  const backupProgressCancelable = Boolean(
    hasNodeControls &&
    onCancelBackup &&
    !TERMINAL_BACKUP_PHASES.has(nodeBackupProgress.phase) &&
    (nodeBackupProgress.action === 'create-backup' || nodeBackupProgress.action === 'restore-backup')
  )
  const backupCancelLabel = nodeBackupProgress.action === 'restore-backup'
    ? t('node.cancelRestore')
    : t('node.cancelBackup')
  const backupCancelTitle = nodeBackupProgress.action === 'restore-backup'
    ? t('node.cancelRestoreTooltip')
    : t('node.cancelBackupTooltip')

  return (
    <div className="node-backup-progress" role="status" aria-live="polite">
      <div className="node-services-header">
        <h3>
          {nodeBackupProgress.action === 'create-backup'
            ? t('node.backupProgress.create')
            : nodeBackupProgress.action === 'restore-backup'
              ? t('node.backupProgress.restore')
              : t('node.backupProgress.verify')}
        </h3>
        <div className="node-backup-progress-header-actions">
          <span>{backupProgressPercentLabel}%</span>
          {backupProgressCancelable && (
            <button
              type="button"
              className="ghost-button danger-button node-backup-cancel-button"
              onClick={() => { void onCancelBackup() }}
              title={backupCancelTitle}
            >
              {backupCancelLabel}
            </button>
          )}
        </div>
      </div>
      <p className="node-backup-progress-text">{nodeBackupProgress.message}</p>
      <div className="node-backup-progress-bar" aria-hidden="true">
        <span
          className="node-backup-progress-fill"
          style={{ width: `${Math.max(2, backupProgressPercent)}%` }}
        />
      </div>
      {backupLiveTransferVisible && (
        <p className="node-backup-progress-live">
          <span className="first-run-restore-live-dot" aria-hidden="true" />
          <span>{backupLiveTransferLabel}</span>
          <strong>{backupLiveTransferDetail}</strong>
        </p>
      )}
      <p className="node-backup-progress-meta mono">
        {[
          t('node.backupPhaseMeta', {
            phase: nodeBackupProgress.phase,
            time: formatTime(nodeBackupProgress.updatedAt, locale)
          }),
          backupSampleInterval
            ? t('node.backupSampleMeta', { latency: backupSampleInterval })
            : ''
        ].filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}
