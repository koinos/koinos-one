import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { NodeBackupsPanel } from './NodeBackupsPanel'

const translations: Record<string, string> = {
  'node.cancelBackup': 'Cancel backup',
  'node.createBackup': 'Create Backup',
  'node.restoreNativeLatestHelp': 'Restore help',
  'node.restoringNativeLatest': 'Restoring native backup...'
}

function t(key: string): string {
  return translations[key] ?? key
}

function snapshot(backupId: string, latest = false): TelenoNodeNativeBackupSnapshot {
  return {
    backupId,
    createdAt: '2026-06-15T21:32:34Z',
    latest,
    totalBytes: 1024 * 1024,
    fileCount: 6,
    restoreSpace: {
      minimumTargetFreeBytes: 2 * 1024 * 1024,
      recommendedTargetFreeBytes: 4 * 1024 * 1024
    }
  }
}

function textContent(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (node && typeof node === 'object') return textContent(node.props?.children)
  return ''
}

function findButtonByText(node: any, text: string): any {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button' && textContent(node.props?.children).includes(text)) return node

  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findButtonByText(child, text)
    if (match) return match
  }
  return null
}

describe('NodeBackupsPanel', () => {
  it('renders per-backup verify and restore actions for local, remote, and public snapshots', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode
        nodeSettings={{
          network: 'testnet',
          baseDir: '/tmp/teleno',
          backup: {
            remoteEnabled: true,
            localDirectory: '/tmp/teleno/backups',
            workspace: '/tmp/teleno/workspace',
            sshUser: 'backup',
            sshHost: 'example.invalid',
            remoteDirectory: '/srv/teleno-backups',
            adminEnabled: false
          }
        }}
        nodeStatus={{ baseDir: '/tmp/teleno' }}
        nodePrimaryConfigPath="/tmp/teleno/config.yml"
        runCreateBackup={vi.fn()}
        runCancelBackup={vi.fn()}
        runNativeBackupList={vi.fn()}
        runNativeBackupRestorePreflight={vi.fn()}
        runRestoreNativeBackupSelected={vi.fn()}
        nodeCreateBackupLoading={false}
        nodeNativeBackupListLoading={false}
        nodeNativeBackupLocalListLoading={false}
        nodeNativeBackupRemoteListLoading={false}
        nodeNativeBackupPublicListLoading={false}
        nodeNativeBackupLocalList={{
          ok: true,
          source: 'local',
          snapshots: [snapshot('local-20260615T213234Z', true)]
        }}
        nodeNativeBackupRemoteList={{
          ok: true,
          source: 'remote',
          snapshots: [snapshot('remote-20260615T213234Z', true)]
        }}
        nodeNativeBackupPublicList={{
          ok: true,
          source: 'public',
          snapshots: [snapshot('public-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={null}
        selectedNativeBackupId="local:local-20260615T213234Z"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading={false}
        nodeBackupProgress={null}
      />
    )

    expect(html.match(/>Verify<\/button>/g)).toHaveLength(3)
    expect(html.match(/>Restore<\/button>/g)).toHaveLength(3)
    expect(html.match(/>Purge<\/button>/g)).toHaveLength(2)
    expect(html).toContain('local-20260615T213234Z')
    expect(html).toContain('remote-20260615T213234Z')
    expect(html).toContain('public-20260615T213234Z')
    expect(html).not.toContain('Restore backup ID')
    expect(html).not.toContain('Verify selected backup')
    expect(html).not.toContain('Restore Backup')
  })

  it('renders separate advanced create buttons for local and remote backups', () => {
    const runCreateBackup = vi.fn()
    const tree = NodeBackupsPanel({
      t,
      locale: 'en-US',
      hasNodeControls: true,
      nodeBusy: false,
      settingsDirty: false,
      advancedMode: true,
      nodeSettings: {
        baseDir: '/tmp/teleno',
        backup: {
          remoteEnabled: true,
          localDirectory: '/tmp/teleno/backups',
          workspace: '/tmp/teleno/workspace',
          sshUser: 'backup',
          sshHost: 'example.invalid',
          remoteDirectory: '/srv/teleno-backups',
          adminEnabled: false
        }
      },
      draftNodeBackup: {
        remoteEnabled: true
      },
      nodeStatus: { baseDir: '/tmp/teleno' },
      nodePrimaryConfigPath: '/tmp/teleno/config.yml',
      runCreateBackup,
      runCancelBackup: vi.fn(),
      runNativeBackupList: vi.fn(),
      runNativeBackupRestorePreflight: vi.fn(),
      runRestoreNativeBackupSelected: vi.fn(),
      nodeCreateBackupLoading: false,
      nodeNativeBackupListLoading: false,
      nodeNativeBackupLocalListLoading: false,
      nodeNativeBackupRemoteListLoading: false,
      nodeNativeBackupLocalList: {
        ok: true,
        source: 'local',
        latestBackupId: 'local-20260615T213234Z',
        snapshots: [snapshot('local-20260615T213234Z', true)]
      },
      nodeNativeBackupRemoteList: {
        ok: true,
        source: 'remote',
        latestBackupId: 'remote-20260615T213234Z',
        remoteSpace: {
          ok: true,
          availableBytes: 8 * 1024 * 1024,
          targetPath: '/srv/teleno-backups',
          message: 'ok'
        },
        snapshots: [snapshot('remote-20260615T213234Z', true)]
      },
      nodeNativeBackupPreflightLoading: false,
      nodeNativeBackupPreflight: null,
      selectedNativeBackupId: 'local:local-20260615T213234Z',
      setSelectedNativeBackupId: vi.fn(),
      nodeRestoreNativeBackupLoading: false,
      simpleRemoteBackupSaving: false,
      setSimpleRemoteBackupEnabled: vi.fn(),
      dashboardPerformance: {
        host: {
          freeDiskBytes: 8 * 1024 * 1024,
          blockchainDataBytes: 4 * 1024 * 1024
        }
      },
      dashboardPerformanceLoading: false,
      formError: null,
      nodeBackupProgress: null
    })

    const localButton = findButtonByText(tree, 'Create Local Backup')
    const remoteButton = findButtonByText(tree, 'Create Remote Backup')
    expect(localButton).toBeTruthy()
    expect(remoteButton).toBeTruthy()

    localButton.props.onClick()
    remoteButton.props.onClick()

    expect(runCreateBackup).toHaveBeenNthCalledWith(1, { localEnabled: true, remoteEnabled: false })
    expect(runCreateBackup).toHaveBeenNthCalledWith(2, { localEnabled: true, remoteEnabled: true })
    expect(textContent(tree)).toContain('Local backup: enough space')
    expect(textContent(tree)).toContain('Remote backup: enough space')
    expect(textContent(tree)).not.toContain('Allow remote backup')
  })

  it('does not call a remote space check unavailable when only the backup size estimate is missing', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode
        nodeSettings={{
          baseDir: '/tmp/teleno',
          backup: {
            remoteEnabled: true,
            sshUser: 'backup',
            sshHost: 'example.invalid',
            remoteDirectory: '/srv/teleno-backups'
          }
        }}
        draftNodeBackup={{
          remoteEnabled: true
        }}
        nodeStatus={{ baseDir: '/tmp/teleno' }}
        nodePrimaryConfigPath="/tmp/teleno/config.yml"
        runCreateBackup={vi.fn()}
        runCancelBackup={vi.fn()}
        runNativeBackupList={vi.fn()}
        runNativeBackupRestorePreflight={vi.fn()}
        runRestoreNativeBackupSelected={vi.fn()}
        nodeCreateBackupLoading={false}
        nodeNativeBackupListLoading={false}
        nodeNativeBackupLocalListLoading={false}
        nodeNativeBackupRemoteListLoading={false}
        nodeNativeBackupLocalList={null}
        nodeNativeBackupRemoteList={{
          ok: true,
          source: 'remote',
          remoteSpace: {
            ok: true,
            availableBytes: 98.9 * 1024 * 1024 * 1024,
            targetPath: '/srv/teleno-backups',
            message: 'ok'
          },
          snapshots: []
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={null}
        selectedNativeBackupId="latest"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading={false}
        simpleRemoteBackupSaving={false}
        setSimpleRemoteBackupEnabled={vi.fn()}
        dashboardPerformance={null}
        dashboardPerformanceLoading={false}
        formError={null}
        nodeBackupProgress={null}
      />
    )

    expect(html).toContain('Remote backup: backup size estimate unavailable')
    expect(html).toContain('Free 98.9 GB')
    expect(html).toContain('needed not available')
    expect(html).not.toContain('Remote backup: space check unavailable')
    expect(html).not.toContain('needed N/A')
  })

  it('shows verified restore information inside the selected advanced backup card', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode
        nodeSettings={{
          baseDir: '/tmp/teleno',
          backup: {
            remoteEnabled: true
          }
        }}
        draftNodeBackup={{
          remoteEnabled: true
        }}
        nodeStatus={{ baseDir: '/tmp/teleno' }}
        nodePrimaryConfigPath="/tmp/teleno/config.yml"
        runCreateBackup={vi.fn()}
        runCancelBackup={vi.fn()}
        runNativeBackupList={vi.fn()}
        runNativeBackupRestorePreflight={vi.fn()}
        runRestoreNativeBackupSelected={vi.fn()}
        runPurgeNativeBackup={vi.fn()}
        nodeCreateBackupLoading={false}
        nodeNativeBackupListLoading={false}
        nodeNativeBackupLocalListLoading={false}
        nodeNativeBackupRemoteListLoading={false}
        nodeNativeBackupLocalList={{
          ok: true,
          source: 'local',
          latestBackupId: 'local-20260615T213234Z',
          snapshots: [snapshot('local-20260615T213234Z', true)]
        }}
        nodeNativeBackupRemoteList={{
          ok: true,
          source: 'remote',
          latestBackupId: 'remote-20260615T213234Z',
          snapshots: [snapshot('remote-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={{
          ok: true,
          output: '',
          backupId: 'remote-20260615T213234Z',
          readyToRestore: true,
          snapshotComplete: true,
          fileCount: 6,
          missingObjectCount: 0,
          missingObjectBytes: 0,
          restoreSpace: {
            restoredDatabaseBytes: 1024 * 1024,
            runtimeFilesBytes: 0,
            objectDownloadBytes: 0,
            minimumTargetFreeBytes: 2 * 1024 * 1024,
            recommendedTargetFreeBytes: 4 * 1024 * 1024
          },
          spaceCheck: {
            passesMinimum: true,
            belowRecommended: false,
            availableBytes: 8 * 1024 * 1024,
            targetPath: '/tmp/teleno',
            message: 'ok'
          }
        }}
        selectedNativeBackupId="remote:remote-20260615T213234Z"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading={false}
        nodeNativeBackupPurgeLoading={null}
        simpleRemoteBackupSaving={false}
        setSimpleRemoteBackupEnabled={vi.fn()}
        dashboardPerformance={null}
        dashboardPerformanceLoading={false}
        formError={null}
        nodeBackupProgress={null}
      />
    )

    expect(html).toContain('node-backup-snapshot is-verified is-ok')
    expect(html).toContain('Verified: ready to restore')
    expect(html).toContain('Available 8 MB')
    expect(html).not.toContain('Selected backup is ready to restore')
    expect(html).not.toContain('node-backup-preflight')
  })

  it('renders the simple backup controls in non-expert mode', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode={false}
        nodeSettings={{
          baseDir: '/tmp/teleno',
          backup: {
            remoteEnabled: false
          }
        }}
        draftNodeBackup={{
          remoteEnabled: false
        }}
        nodeStatus={{ baseDir: '/tmp/teleno' }}
        nodePrimaryConfigPath="/tmp/teleno/config.yml"
        runCreateBackup={vi.fn()}
        runCancelBackup={vi.fn()}
        runNativeBackupList={vi.fn()}
        runNativeBackupRestorePreflight={vi.fn()}
        runRestoreNativeBackupSelected={vi.fn()}
        nodeCreateBackupLoading={false}
        nodeNativeBackupListLoading={false}
        nodeNativeBackupLocalListLoading={false}
        nodeNativeBackupRemoteListLoading={false}
        nodeNativeBackupLocalList={null}
        nodeNativeBackupRemoteList={null}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={null}
        selectedNativeBackupId="latest"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading={false}
        simpleRemoteBackupSaving={false}
        setSimpleRemoteBackupEnabled={vi.fn()}
        dashboardPerformance={{
          host: {
            freeDiskBytes: 8 * 1024 * 1024,
            blockchainDataBytes: 4 * 1024 * 1024
          }
        }}
        dashboardPerformanceLoading={false}
        formError={null}
        nodeBackupProgress={null}
      />
    )

    expect(html.match(/<button/g)).toHaveLength(4)
    expect(html).toContain('Choose data folder')
    expect(html).toContain('Check bootstrap')
    expect(html).toContain('Create Backup')
    expect(html).toContain('Restore Backup')
    expect(html).toContain('Allow remote backup')
    expect(html).toContain('Local backup: enough space')
    expect(html).toContain('Free 8 MB')
    expect(html).toContain('needed 4 MB')
    expect(html).not.toContain('Refresh local list')
    expect(html).not.toContain('Refresh remote list')
    expect(html).not.toContain('Local native backups')
    expect(html).not.toContain('Remote SFTP backups')
  })

  it('uses the remote latest backup in simple mode when remote backup is allowed', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode={false}
        nodeSettings={{
          baseDir: '/tmp/teleno',
          backup: {
            remoteEnabled: true
          }
        }}
        draftNodeBackup={{
          remoteEnabled: true
        }}
        nodeStatus={{ baseDir: '/tmp/teleno' }}
        nodePrimaryConfigPath="/tmp/teleno/config.yml"
        runCreateBackup={vi.fn()}
        runCancelBackup={vi.fn()}
        runNativeBackupList={vi.fn()}
        runNativeBackupRestorePreflight={vi.fn()}
        runRestoreNativeBackupSelected={vi.fn()}
        nodeCreateBackupLoading={false}
        nodeNativeBackupListLoading={false}
        nodeNativeBackupLocalListLoading={false}
        nodeNativeBackupRemoteListLoading={false}
        nodeNativeBackupLocalList={{
          ok: true,
          source: 'local',
          latestBackupId: 'local-20260615T213234Z',
          snapshots: [snapshot('local-20260615T213234Z', true)]
        }}
        nodeNativeBackupRemoteList={{
          ok: true,
          source: 'remote',
          latestBackupId: 'remote-20260615T213234Z',
          remoteSpace: {
            ok: true,
            availableBytes: 8 * 1024 * 1024,
            targetPath: '/srv/teleno-backups',
            message: 'ok'
          },
          snapshots: [snapshot('remote-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={{
          ok: true,
          output: '',
          backupId: 'remote-20260615T213234Z',
          readyToRestore: true,
          snapshotComplete: true,
          fileCount: 6,
          missingObjectCount: 0,
          missingObjectBytes: 0,
          restoreSpace: {
            restoredDatabaseBytes: 1024 * 1024,
            runtimeFilesBytes: 0,
            objectDownloadBytes: 0,
            minimumTargetFreeBytes: 2 * 1024 * 1024,
            recommendedTargetFreeBytes: 4 * 1024 * 1024
          },
          spaceCheck: {
            passesMinimum: true,
            belowRecommended: false,
            availableBytes: 8 * 1024 * 1024,
            targetPath: '/tmp/teleno',
            message: 'ok'
          }
        }}
        selectedNativeBackupId="remote:remote-20260615T213234Z"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading={false}
        simpleRemoteBackupSaving={false}
        setSimpleRemoteBackupEnabled={vi.fn()}
        dashboardPerformance={{
          host: {
            freeDiskBytes: 8 * 1024 * 1024,
            blockchainDataBytes: 4 * 1024 * 1024
          }
        }}
        dashboardPerformanceLoading={false}
        formError={null}
        nodeBackupProgress={null}
      />
    )

    expect(html).toContain('Remote backup: enough space')
    expect(html).toContain('Free 8 MB')
    expect(html).toContain('Latest remote backup size: 1 MB')
    expect(html).toContain('Local restore space: enough space')
    expect(html).toContain('Free 8 MB')
    expect(html).toContain('needed 2 MB')
  })

  it('restores the remote latest backup in simple mode when remote backup is allowed', () => {
    const runRestoreNativeBackupSelected = vi.fn()
    const tree = NodeBackupsPanel({
      t,
      locale: 'en-US',
      hasNodeControls: true,
      nodeBusy: false,
      settingsDirty: false,
      advancedMode: false,
      nodeSettings: {
        baseDir: '/tmp/teleno',
        backup: {
          remoteEnabled: true
        }
      },
      draftNodeBackup: {
        remoteEnabled: true
      },
      nodeStatus: { baseDir: '/tmp/teleno' },
      nodePrimaryConfigPath: '/tmp/teleno/config.yml',
      runCreateBackup: vi.fn(),
      runCancelBackup: vi.fn(),
      runNativeBackupList: vi.fn(),
      runNativeBackupRestorePreflight: vi.fn(),
      runRestoreNativeBackupSelected,
      nodeCreateBackupLoading: false,
      nodeNativeBackupListLoading: false,
      nodeNativeBackupLocalListLoading: false,
      nodeNativeBackupRemoteListLoading: false,
      nodeNativeBackupLocalList: {
        ok: true,
        source: 'local',
        latestBackupId: 'local-20260615T213234Z',
        snapshots: [snapshot('local-20260615T213234Z', true)]
      },
      nodeNativeBackupRemoteList: {
        ok: true,
        source: 'remote',
        latestBackupId: 'remote-20260615T213234Z',
        remoteSpace: {
          ok: true,
          availableBytes: 8 * 1024 * 1024,
          targetPath: '/srv/teleno-backups',
          message: 'ok'
        },
        snapshots: [snapshot('remote-20260615T213234Z', true)]
      },
      nodeNativeBackupPreflightLoading: false,
      nodeNativeBackupPreflight: null,
      selectedNativeBackupId: 'remote:remote-20260615T213234Z',
      setSelectedNativeBackupId: vi.fn(),
      nodeRestoreNativeBackupLoading: false,
      simpleRemoteBackupSaving: false,
      setSimpleRemoteBackupEnabled: vi.fn(),
      dashboardPerformance: {
        host: {
          freeDiskBytes: 8 * 1024 * 1024,
          blockchainDataBytes: 4 * 1024 * 1024
        }
      },
      dashboardPerformanceLoading: false,
      formError: null,
      nodeBackupProgress: null
    })

    const restoreButton = findButtonByText(tree, 'Restore Backup')
    expect(restoreButton).toBeTruthy()
    restoreButton.props.onClick()
    expect(runRestoreNativeBackupSelected).toHaveBeenCalledWith('remote:remote-20260615T213234Z')
  })
})
