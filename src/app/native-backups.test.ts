import { describe, expect, it } from 'vitest'
import {
  clampBackupProgress,
  createBackupProgressState,
  numericOrNull,
  parseNativeBackupSelection
} from './native-backups'

function backupList(ids: string[], latestBackupId = ''): TelenoNodeNativeBackupListResult {
  return {
    ok: true,
    output: '',
    latestBackupId,
    snapshots: ids.map((backupId) => ({ backupId }) as TelenoNodeNativeBackupSnapshot)
  }
}

describe('parseNativeBackupSelection', () => {
  it('honors an explicit source prefix', () => {
    expect(parseNativeBackupSelection('remote:backup-2')).toEqual({
      backupId: 'backup-2',
      source: 'remote'
    })
  })

  it('chooses the first available latest backup source', () => {
    expect(parseNativeBackupSelection(
      'latest',
      backupList(['local-1'], 'local-1'),
      backupList(['remote-1'], 'remote-1'),
      backupList(['public-1'], 'public-1')
    )).toEqual({ backupId: 'latest', source: 'local' })

    expect(parseNativeBackupSelection(
      '',
      backupList([]),
      backupList(['remote-1'], 'remote-1'),
      backupList(['public-1'], 'public-1')
    )).toEqual({ backupId: 'latest', source: 'remote' })
  })

  it('infers a source for exact backup ids', () => {
    expect(parseNativeBackupSelection(
      'backup-public',
      backupList(['backup-local']),
      backupList(['backup-remote']),
      backupList(['backup-public'])
    )).toEqual({ backupId: 'backup-public', source: 'public' })
  })

  it('falls back to auto when no list contains the backup', () => {
    expect(parseNativeBackupSelection('backup-missing', backupList([]))).toEqual({
      backupId: 'backup-missing',
      source: 'auto'
    })
  })
})

describe('backup progress helpers', () => {
  it('keeps only finite numeric values', () => {
    expect(numericOrNull(12)).toBe(12)
    expect(numericOrNull(Number.NaN)).toBeNull()
    expect(numericOrNull('12')).toBeNull()
  })

  it('clamps progress to the display range', () => {
    expect(clampBackupProgress(-10)).toBe(0)
    expect(clampBackupProgress(55)).toBe(55)
    expect(clampBackupProgress(180)).toBe(100)
    expect(clampBackupProgress(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('normalizes progress state defaults and patched fields', () => {
    expect(createBackupProgressState('create-backup', 'upload', 150, 'Uploading', 123, {
      completedBytes: 50,
      totalBytes: 100,
      displayProgress: 80
    })).toMatchObject({
      action: 'create-backup',
      phase: 'upload',
      progress: 100,
      displayProgress: 80,
      message: 'Uploading',
      updatedAt: 123,
      completedBytes: 50,
      totalBytes: 100,
      bytesPerSecond: null
    })
  })
})
