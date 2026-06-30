import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { NodeBackupsPanel } from './NodeBackupsPanel'

const translations: Record<string, string> = {
  'common.disabled': 'Disabled',
  'common.na': 'N/A',
  'node.cancelBackup': 'Cancel backup',
  'node.cancelBackupTooltip': 'Stops the current native backup command.',
  'node.cancelRestore': 'Stop restore',
  'node.cancelRestoreTooltip': 'Stops the current restore command.',
  'node.createBackup': 'Create Backup',
  'node.restoreBackupPrimary': 'Restore Backup',
  'node.backupChooseDataFolder': 'Choose data folder',
  'node.backupCheckBootstrap': 'Check Repository',
  'node.backupCheckingBootstrap': 'Checking repository...',
  'node.backupCheckRepositoryHelp': 'Checks the public backup repository for the latest backup metadata and updates the size, date, and local space estimate. It does not download or restore backup data.',
  'node.backupSimpleDescription': 'This is the normal way to get a node running quickly.',
  'node.backupSimpleDataFolder': 'Data folder',
  'node.backupSimpleBootstrapSource': 'Public Backup Repository',
  'node.backupSimpleRestoreMode': 'Restore mode',
  'node.backupSimpleObserverFirst': 'Observer first',
  'node.backupSourcePublic': 'standard public bootstrap',
  'node.backupSourceRemote': 'private remote',
  'node.backupSourceLocal': 'local',
  'node.backupSimpleLatestSize': 'Latest backup size: {size}',
  'node.backupSimpleLatestDate': 'Latest backup date: {date}',
  'node.backupSimpleRestoreSpace': 'Local restore space: {status}.',
  'node.backupSpaceEnough': 'enough space',
  'node.backupSpaceNotEnough': 'not enough space',
  'node.backupSpaceChecking': 'checking space',
  'node.backupSimpleCheckingLatest': 'Checking latest {source} backup...',
  'node.backupSimpleNoLatest': 'No latest {source} backup found yet.',
  'node.backupSimpleListError': 'Could not load latest {source} backup metadata.',
  'node.backupSimpleAdvancedHint': 'Additional backup management tools are available in Expert Mode.',
  'node.restoreNativeLatestHelp': 'Restore help',
  'node.restoringNativeLatest': 'Restoring native backup...',
  'node.backupProgress.restore': 'Restore Backup',
  'node.backupProgress.verify': 'Restore from backup',
  'node.backupProgress.create': 'Create Backup',
  'node.backupLiveDownload': 'Downloading',
  'node.backupLiveRestore': 'Restoring',
  'node.backupLiveUpload': 'Uploading',
  'node.backupLiveTransferMeta': '{completed} of {total} · {speed}/s · {eta} left',
  'node.backupLiveSpeedMeta': '{speed}/s · {eta} left',
  'node.backupPhaseMeta': 'Phase {phase} · {time}',
  'node.backupSampleMeta': 'sample {latency}'
}

function t(key: string, values: Record<string, string | number> = {}): string {
  const template = translations[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`))
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
          network: 'mainnet',
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
        nodeNativeBackupPublicList={null}
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

    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('Choose data folder')
    expect(html).toContain('Check Repository')
    expect(html).toContain('It does not download or restore backup data.')
    expect(html).toContain('Restore Backup')
    expect(html).toContain('Public Backup Repository')
    expect(html).not.toContain('Data folder')
    expect(html).not.toContain('/tmp/teleno')
    expect(html).not.toContain('Restore mode')
    expect(html).not.toContain('Observer first')
    expect(html).not.toContain('This is the normal way to get a node running quickly.')
    expect(html).not.toContain('Additional backup management tools are available in Expert Mode.')
    expect(html).not.toContain('Create Backup')
    expect(html).not.toContain('Allow remote backup')
    expect(html).not.toContain('Local backup: enough space')
    expect(html).not.toContain('private SFTP')
    expect(html).not.toContain('admin controls')
    expect(html).not.toContain('Refresh local list')
    expect(html).not.toContain('Refresh remote list')
    expect(html).not.toContain('Local native backups')
    expect(html).not.toContain('Remote SFTP backups')
  })

  it('prefers the public bootstrap latest backup in simple mode when remote backup is allowed', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode={false}
        nodeSettings={{
          network: 'mainnet',
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
        nodeNativeBackupPublicList={{
          ok: true,
          source: 'public',
          latestBackupId: 'public-20260615T213234Z',
          snapshots: [snapshot('public-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={{
          ok: true,
          output: '',
          backupId: 'public-20260615T213234Z',
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
        selectedNativeBackupId="public:public-20260615T213234Z"
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

    expect(html).toContain('Latest backup size: 1 MB')
    expect(html).toContain('Latest backup date:')
    expect(html).toContain('Local restore space: enough space')
    expect(html).toContain('Free 8 MB')
    expect(html).toContain('needed 2 MB')
    expect(html).not.toContain('Remote backup: enough space')
  })

  it('restores the public bootstrap latest backup in simple mode when remote backup is allowed', () => {
    const runRestoreNativeBackupSelected = vi.fn()
    const tree = NodeBackupsPanel({
      t,
      locale: 'en-US',
      hasNodeControls: true,
      nodeBusy: false,
      settingsDirty: false,
      advancedMode: false,
      nodeSettings: {
        network: 'mainnet',
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
      nodeNativeBackupPublicList: {
        ok: true,
        source: 'public',
        latestBackupId: 'public-20260615T213234Z',
        snapshots: [snapshot('public-20260615T213234Z', true)]
      },
      nodeNativeBackupPreflightLoading: false,
      nodeNativeBackupPreflight: null,
      selectedNativeBackupId: 'latest',
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
    expect(restoreButton.props.disabled).toBe(false)
    restoreButton.props.onClick()
    expect(runRestoreNativeBackupSelected).toHaveBeenCalledWith('public:public-20260615T213234Z')
  })

  it('shows restore progress in simple mode', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode={false}
        nodeSettings={{
          network: 'mainnet',
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
        nodeNativeBackupPublicListLoading={false}
        nodeNativeBackupLocalList={null}
        nodeNativeBackupRemoteList={null}
        nodeNativeBackupPublicList={{
          ok: true,
          source: 'public',
          latestBackupId: 'public-20260615T213234Z',
          snapshots: [snapshot('public-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={null}
        selectedNativeBackupId="latest"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading
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
        nodeBackupProgress={{
          action: 'restore-backup',
          phase: 'download',
          progress: 42,
          displayProgress: 42,
          message: 'Downloading public bootstrap backup',
          updatedAt: Date.UTC(2026, 5, 15),
          completedBytes: 1024 * 1024,
          totalBytes: 2 * 1024 * 1024,
          bytesPerSecond: 512 * 1024,
          etaSeconds: 2,
          completedBatches: null,
          totalBatches: null,
          phaseProgress: null,
          progressRangeStart: 25,
          progressRangeEnd: 60,
          sampleIntervalMs: 1000
        }}
      />
    )

    expect(html).toContain('node-backup-progress')
    expect(html).toContain('Restore Backup')
    expect(html).toContain('42%')
    expect(html).toContain('Downloading public bootstrap backup')
    expect(html).toContain('Downloading')
    expect(html).toContain('Stop restore')
    expect(html).toContain('Stops the current restore command.')
  })

  it('labels staging progress as live restore in simple mode', () => {
    const html = renderToStaticMarkup(
      <NodeBackupsPanel
        t={t}
        locale="en-US"
        hasNodeControls
        nodeBusy={false}
        settingsDirty={false}
        advancedMode={false}
        nodeSettings={{
          network: 'mainnet',
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
        nodeNativeBackupPublicListLoading={false}
        nodeNativeBackupLocalList={null}
        nodeNativeBackupRemoteList={null}
        nodeNativeBackupPublicList={{
          ok: true,
          source: 'public',
          latestBackupId: 'public-20260615T213234Z',
          snapshots: [snapshot('public-20260615T213234Z', true)]
        }}
        nodeNativeBackupPreflightLoading={false}
        nodeNativeBackupPreflight={null}
        selectedNativeBackupId="latest"
        setSelectedNativeBackupId={vi.fn()}
        nodeRestoreNativeBackupLoading
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
        nodeBackupProgress={{
          action: 'restore-backup',
          phase: 'restore',
          progress: 72,
          displayProgress: 72,
          message: 'Staging restored database files',
          updatedAt: Date.UTC(2026, 5, 15),
          completedBytes: 1024 * 1024,
          totalBytes: 2 * 1024 * 1024,
          bytesPerSecond: 512 * 1024,
          etaSeconds: 2,
          completedBatches: 51,
          totalBatches: 102,
          phaseProgress: 0.5,
          progressRangeStart: 60,
          progressRangeEnd: 92,
          sampleIntervalMs: 1000
        }}
      />
    )

    expect(html).toContain('72%')
    expect(html).toContain('Staging restored database files')
    expect(html).toContain('Restoring')
    expect(html).not.toContain('Downloading')
  })
})
