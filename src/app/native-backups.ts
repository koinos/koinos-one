import type { NodeBackupProgressState } from './types'

export type NativeBackupSelectionSource = 'local' | 'remote' | 'public' | 'auto'

export type NativeBackupSelection = {
  backupId: string
  source: NativeBackupSelectionSource
}

export type BackupProgressSample = {
  action: NodeBackupProgressState['action']
  phase: NodeBackupProgressState['phase']
  completedBytes: number | null
  bytesPerSecond: number | null
  sampledAt: number
}

export const TERMINAL_BACKUP_PHASES = new Set<TelenoNodeBackupProgressEvent['phase']>(['complete', 'cancelled', 'error'])

export function parseNativeBackupSelection(
  selection: string,
  localList?: TelenoNodeNativeBackupListResult | null,
  remoteList?: TelenoNodeNativeBackupListResult | null,
  publicList?: TelenoNodeNativeBackupListResult | null
): NativeBackupSelection {
  const value = selection.trim() || 'latest'
  const prefixed = value.match(/^(local|remote|public):(.+)$/)
  if (prefixed) {
    return {
      source: prefixed[1] as NativeBackupSelectionSource,
      backupId: prefixed[2]?.trim() || 'latest'
    }
  }

  if (value === 'latest') {
    if (localList?.latestBackupId) return { backupId: 'latest', source: 'local' }
    if (remoteList?.latestBackupId) return { backupId: 'latest', source: 'remote' }
    if (publicList?.latestBackupId) return { backupId: 'latest', source: 'public' }
    return { backupId: 'latest', source: 'auto' }
  }

  const localHasBackup = Boolean(localList?.snapshots.some((snapshot) => snapshot.backupId === value))
  const remoteHasBackup = Boolean(remoteList?.snapshots.some((snapshot) => snapshot.backupId === value))
  const publicHasBackup = Boolean(publicList?.snapshots.some((snapshot) => snapshot.backupId === value))
  if (localHasBackup) return { backupId: value, source: 'local' }
  if (remoteHasBackup) return { backupId: value, source: 'remote' }
  if (publicHasBackup) return { backupId: value, source: 'public' }
  return { backupId: value, source: 'auto' }
}

export function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function clampBackupProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
}

export function createBackupProgressState(
  action: NodeBackupProgressState['action'],
  phase: NodeBackupProgressState['phase'],
  progress: number,
  message: string,
  updatedAt = Date.now(),
  patch: Partial<NodeBackupProgressState> = {}
): NodeBackupProgressState {
  const normalizedProgress = clampBackupProgress(progress)
  return {
    action,
    phase,
    progress: normalizedProgress,
    displayProgress: clampBackupProgress(patch.displayProgress ?? normalizedProgress),
    message,
    updatedAt,
    completedBytes: patch.completedBytes ?? null,
    totalBytes: patch.totalBytes ?? null,
    bytesPerSecond: patch.bytesPerSecond ?? null,
    etaSeconds: patch.etaSeconds ?? null,
    completedBatches: patch.completedBatches ?? null,
    totalBatches: patch.totalBatches ?? null,
    phaseProgress: patch.phaseProgress ?? null,
    progressRangeStart: patch.progressRangeStart ?? null,
    progressRangeEnd: patch.progressRangeEnd ?? null,
    sampleIntervalMs: patch.sampleIntervalMs ?? null
  }
}
