import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from 'yaml'

import {
  blockchainBackupChecksumUrl,
  createBackupService,
  extractHeadInfoSummary,
  normalizeBlockchainBackupArchiveUrl,
  parseBlockchainBackupMetadataDirectories,
  parseBlockchainBackupSha256Checksum,
  restoreBlockedMessageFromOutput,
  writeNativeBackupConfig
} from './backup-service'
import { resolveMonolithBinaryPath, resolveTelenoConfigRoot } from './constants'
import type { TelenoNodeBackupSettings, TelenoNodeSettings } from './main-types'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleno-backup-service-'))
  tempDirs.push(dir)
  return dir
}

function backupSettings(overrides: Partial<TelenoNodeBackupSettings> = {}): TelenoNodeBackupSettings {
  return {
    localEnabled: true,
    localDirectory: '',
    workspace: '',
    localRetentionCount: 7,
    remoteEnabled: false,
    remoteDirectory: '',
    remoteRetentionCount: 14,
    remoteRetentionDays: 30,
    uploadTempSuffix: '.partial',
    sshHost: '',
    sshPort: 22,
    sshUser: '',
    sshAuth: 'private-key',
    sshPrivateKeyFile: '',
    sshPasswordFile: '',
    sshPassphraseFile: '',
    sshKnownHostsFile: '',
    sshStrictHostKeyChecking: true,
    sshConnectTimeoutSeconds: 15,
    scheduleEnabled: false,
    scheduleInterval: '6h',
    scheduleRunOnStartupIfMissed: true,
    scheduleJitterSeconds: 300,
    scheduleMinimumHeadProgress: 1,
    scheduleSkipIfSyncingFromGenesis: true,
    scheduleMaxConcurrentBackups: 1,
    adminEnabled: false,
    adminListen: '127.0.0.1:18088',
    adminTokenFile: '',
    adminJobs: 1,
    ...overrides
  }
}

function nodeSettings(overrides: Partial<TelenoNodeSettings> = {}): TelenoNodeSettings {
  const repoPath = makeTempDir()
  const baseDir = path.join(repoPath, 'basedir')
  fs.mkdirSync(baseDir, { recursive: true })
  fs.writeFileSync(path.join(baseDir, 'config.yml'), 'chain:\n  verify-blocks: true\n')
  return {
    network: 'testnet',
    repoPath,
    baseDir,
    profiles: ['testnet_observer'],
    blockchainBackupUrl: 'https://example.com/backup.tar.gz',
    backup: backupSettings(),
    ...overrides
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('backup-service helpers', () => {
  it('turns stale restore partial staging errors into an actionable recovery message', () => {
    const output = [
      '{"event":"backup-progress","phase":"public-restore-objects"}',
      'Fatal: restore partial staging directory already exists: /tmp/koinos/.teleno-native-backups/restore-staging.partial'
    ].join('\n')

    const message = restoreBlockedMessageFromOutput(output, output)

    expect(message).toContain('A previous restore left partial staging data')
    expect(message).toContain('existing node database was not replaced')
    expect(message).toContain('click Restore Backup again')
    expect(message).toContain('clear only the stale partial restore staging directory')
    expect(message).not.toContain('{"event"')
  })

  it('normalizes valid backup archive urls and rejects invalid ones', () => {
    expect(normalizeBlockchainBackupArchiveUrl('https://example.com/backup.tar.gz')).toBe(
      'https://example.com/backup.tar.gz'
    )
    expect(() => normalizeBlockchainBackupArchiveUrl('ftp://example.com/backup.tar.gz')).toThrow(/http o https/)
    expect(() => normalizeBlockchainBackupArchiveUrl('https://example.com/backup.zip')).toThrow(/\.tar\.gz/)
  })

  it('parses checksum files and validates the referenced archive name', () => {
    const archiveUrl = 'https://example.com/releases/blockchain.tar.gz'
    const parsed = parseBlockchainBackupSha256Checksum(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  blockchain.tar.gz\n',
      archiveUrl
    )

    expect(parsed.checksum).toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(parsed.output).toContain(blockchainBackupChecksumUrl(archiveUrl))
    expect(() =>
      parseBlockchainBackupSha256Checksum(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  other.tar.gz\n',
        archiveUrl
      )
    ).toThrow(/referencia other.tar.gz/)
  })

  it('extracts included directories from backup metadata', () => {
    const raw = `Backup Metadata
---------------
Included Directories:
chain/   12 GB
block_store/   9 GB

Other Section:
foo
`

    expect(parseBlockchainBackupMetadataDirectories(raw)).toEqual(['chain', 'block_store'])
  })

  it('summarizes head info responses', () => {
    expect(
      extractHeadInfoSummary({
        head_topology: {
          height: '123',
          id: '0xabc'
        }
      })
    ).toEqual({
      ok: true,
      height: '123',
      headId: '0xabc',
      output: 'Verified local node head 123 (0xabc)'
    })

    expect(extractHeadInfoSummary({})).toEqual({
      ok: false,
      height: '',
      headId: '',
      output: 'chain.get_head_info no devolvio head_topology.id'
    })
  })

  it('writes UX backup settings into the native backup config', () => {
    const repositoryDir = path.join(makeTempDir(), 'repository')
    const workspaceDir = path.join(makeTempDir(), 'workspace')
    const settings = nodeSettings({
      backup: backupSettings({
        localDirectory: repositoryDir,
        workspace: workspaceDir,
        localRetentionCount: 3,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1',
        remoteRetentionCount: 9,
        remoteRetentionDays: 45,
        uploadTempSuffix: '.uploading',
        sshHost: 'testnet.koinosfoundation.org',
        sshPort: 2222,
        sshUser: 'teleno_backup',
        sshAuth: 'password-file',
        sshPasswordFile: '~/secrets/teleno-backup.pass',
        sshKnownHostsFile: '~/.ssh/known_hosts',
        sshStrictHostKeyChecking: false,
        scheduleEnabled: true,
        scheduleInterval: '12h',
        scheduleJitterSeconds: 120,
        scheduleMinimumHeadProgress: 5,
        adminEnabled: true,
        adminListen: '127.0.0.1:18089',
        adminTokenFile: '~/secrets/teleno-backup-admin.token',
        adminJobs: 2
      })
    })

    const result = writeNativeBackupConfig(settings)
    const doc = parseDocument(fs.readFileSync(result.configPath, 'utf8'))
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~'

    expect(doc.getIn(['backup', 'local', 'directory'])).toBe(repositoryDir)
    expect(doc.getIn(['backup', 'local', 'retention-count'])).toBe(3)
    expect(doc.getIn(['backup', 'ssh', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'ssh', 'host'])).toBe('testnet.koinosfoundation.org')
    expect(doc.getIn(['backup', 'ssh', 'port'])).toBe(2222)
    expect(doc.getIn(['backup', 'ssh', 'auth'])).toBe('password-file')
    expect(doc.getIn(['backup', 'ssh', 'password-file'])).toBe(path.join(homeDir, 'secrets/teleno-backup.pass'))
    expect(doc.getIn(['backup', 'ssh', 'known-hosts-file'])).toBe(path.join(homeDir, '.ssh/known_hosts'))
    expect(doc.getIn(['backup', 'ssh', 'strict-host-key-checking'])).toBe(false)
    expect(doc.getIn(['backup', 'remote', 'directory'])).toBe('/srv/teleno-backups/testnet/node-1')
    expect(doc.getIn(['backup', 'remote', 'retention-count'])).toBe(9)
    expect(doc.getIn(['backup', 'remote', 'retention-days'])).toBe(45)
    expect(doc.getIn(['backup', 'remote', 'upload-temp-suffix'])).toBe('.uploading')
    expect(doc.getIn(['backup', 'schedule', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'schedule', 'interval'])).toBe('12h')
    expect(doc.getIn(['backup', 'schedule', 'jitter-seconds'])).toBe(120)
    expect(doc.getIn(['backup', 'schedule', 'minimum-head-progress'])).toBe(5)
    expect(doc.getIn(['backup', 'admin', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'admin', 'listen'])).toBe('127.0.0.1:18089')
    expect(doc.getIn(['backup', 'admin', 'token-file'])).toBe(path.join(homeDir, 'secrets/teleno-backup-admin.token'))
    expect(doc.getIn(['backup', 'admin', 'jobs'])).toBe(2)
    expect(doc.getIn(['backup', 'public-restore', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'public-restore', 'base-url'])).toBe('https://testnet.koinosfoundation.org/backups/testnet/teleno-bootstrap')
    expect(doc.getIn(['backup', 'public-restore', 'network'])).toBe('testnet')
    expect(doc.getIn(['backup', 'public-restore', 'require-https'])).toBe(true)
    expect(doc.getIn(['backup', 'public-restore', 'signature-required'])).toBe(true)
    expect(doc.getIn(['backup', 'public-restore', 'signature-public-key-file'])).toBe(
      path.join(resolveTelenoConfigRoot(), 'public-bootstrap', 'testnet-ed25519.pub')
    )
    expect(fs.existsSync(repositoryDir)).toBe(true)
    expect(fs.existsSync(workspaceDir)).toBe(true)
  })

  it('enables the hardcoded prodnet public bootstrap in mainnet generated native backup configs', () => {
    const settings = nodeSettings({ network: 'mainnet' })
    const result = writeNativeBackupConfig(settings)
    const doc = parseDocument(fs.readFileSync(result.configPath, 'utf8'))

    expect(doc.getIn(['backup', 'public-restore', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'public-restore', 'base-url'])).toBe('https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap')
    expect(doc.getIn(['backup', 'public-restore', 'network'])).toBe('mainnet')
    expect(doc.getIn(['backup', 'public-restore', 'signature-required'])).toBe(false)
    expect(doc.getIn(['backup', 'public-restore', 'signature-public-key-file'])).toBe('')
  })

  it('enables the local staging repository when remote backups are enabled', () => {
    const settings = nodeSettings({
      backup: backupSettings({
        localEnabled: false,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/prodnet/teleno-dev/teleno-ux-mainnet'
      })
    })
    const result = writeNativeBackupConfig(settings)
    const doc = parseDocument(fs.readFileSync(result.configPath, 'utf8'))

    expect(doc.getIn(['backup', 'local', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'remote', 'enabled'])).toBe(true)
  })

  it('loads native backup settings from the generated config', async () => {
    const root = makeTempDir()
    const repositoryDir = path.join(root, 'repository')
    const workspaceDir = path.join(root, 'workspace')
    const passwordFile = path.join(root, 'backup.pass')
    const knownHostsFile = path.join(root, 'known_hosts')
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(passwordFile, 'secret\n')
    fs.writeFileSync(knownHostsFile, 'testnet.koinosfoundation.org ssh-ed25519 AAAA\n')

    const settings = nodeSettings({
      backup: backupSettings({
        localDirectory: repositoryDir,
        workspace: workspaceDir,
        localRetentionCount: 4,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1',
        remoteRetentionCount: 10,
        remoteRetentionDays: 60,
        uploadTempSuffix: '.incoming',
        sshHost: 'testnet.koinosfoundation.org',
        sshPort: 2200,
        sshUser: 'teleno_backup',
        sshAuth: 'password-file',
        sshPasswordFile: passwordFile,
        sshKnownHostsFile: knownHostsFile,
        sshStrictHostKeyChecking: false,
        sshConnectTimeoutSeconds: 25,
        scheduleEnabled: true,
        scheduleInterval: '8h',
        scheduleRunOnStartupIfMissed: false,
        scheduleJitterSeconds: 90,
        scheduleMinimumHeadProgress: 3,
        scheduleSkipIfSyncingFromGenesis: false,
        adminEnabled: true,
        adminListen: '127.0.0.1:18090',
        adminTokenFile: tokenFile,
        adminJobs: 3
      })
    })
    const written = writeNativeBackupConfig(settings)

    const service = createBackupService({
      normalizeNodeSettings: () => ({
        ...settings,
        backup: backupSettings()
      }),
      assertRepoReady: () => {},
      runCommand: async () => ({ ok: true, code: 0, output: '' })
    } as any)

    const result = await service.nativeBackupConfig(undefined)

    expect(result.ok).toBe(true)
    expect(result.configPath).toBe(written.configPath)
    expect(result.repositoryDir).toBe(repositoryDir)
    expect(result.workspaceDir).toBe(workspaceDir)
    expect(result.backup).toMatchObject({
      localEnabled: true,
      localDirectory: repositoryDir,
      workspace: workspaceDir,
      localRetentionCount: 4,
      remoteEnabled: true,
      remoteDirectory: '/srv/teleno-backups/testnet/node-1',
      remoteRetentionCount: 10,
      remoteRetentionDays: 60,
      uploadTempSuffix: '.incoming',
      sshHost: 'testnet.koinosfoundation.org',
      sshPort: 2200,
      sshUser: 'teleno_backup',
      sshAuth: 'password-file',
      sshPasswordFile: passwordFile,
      sshKnownHostsFile: knownHostsFile,
      sshStrictHostKeyChecking: false,
      sshConnectTimeoutSeconds: 25,
      scheduleEnabled: true,
      scheduleInterval: '8h',
      scheduleRunOnStartupIfMissed: false,
      scheduleJitterSeconds: 90,
      scheduleMinimumHeadProgress: 3,
      scheduleSkipIfSyncingFromGenesis: false,
      adminEnabled: true,
      adminListen: '127.0.0.1:18090',
      adminTokenFile: tokenFile,
      adminJobs: 3
    })
  })

  it('auto-generates a native backup admin token file when admin is enabled without a custom path', () => {
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminTokenFile: ''
      })
    })

    const result = writeNativeBackupConfig(settings)
    const doc = parseDocument(fs.readFileSync(result.configPath, 'utf8'))
    const tokenFile = path.join(settings.baseDir, '.teleno-native-backups', 'admin.token')
    const token = fs.readFileSync(tokenFile, 'utf8').trim()

    expect(doc.getIn(['backup', 'admin', 'enabled'])).toBe(true)
    expect(doc.getIn(['backup', 'admin', 'token-file'])).toBe(tokenFile)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('creates a running-node local backup through the native admin API when enabled', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile,
        remoteEnabled: false
      })
    })
    const sender = { send: vi.fn() }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        status: {
          operation_id: 'admin-op-1',
          state: 'succeeded',
          message: 'local backup complete',
          has_snapshot: true,
          snapshot: {
            backup_id: 'backup-1',
            total_bytes: 2048
          }
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      telenoNodeAction: async () => ({ ok: true, output: '' }),
      runCommand: async () => ({ ok: true, code: 0, output: '' })
    } as any)

    const result = await service.createLocalBackup(undefined, sender as any)

    expect(result.ok).toBe(true)
    expect(result.output).toContain('running-node admin API')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18088/admin/backup/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret-token' }),
        body: JSON.stringify({ remote: false })
      })
    )
  })

  it('reports a clear interrupted backup when running-node admin status disappears mid-operation', async () => {
    vi.useFakeTimers()
    try {
      const root = makeTempDir()
      const tokenFile = path.join(root, 'admin.token')
      fs.writeFileSync(tokenFile, 'secret-token\n')
      const settings = nodeSettings({
        backup: backupSettings({
          adminEnabled: true,
          adminListen: '127.0.0.1:18088',
          adminTokenFile: tokenFile,
          remoteEnabled: true
        })
      })
      const sender = { send: vi.fn() }
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/admin/backup/create')) {
          return {
            ok: true,
            text: async () => JSON.stringify({
              ok: true,
              status: {
                operation_id: 'admin-op-interrupted',
                state: 'running',
                phase: 'checkpoint',
                message: 'creating checkpoint'
              }
            })
          }
        }
        throw new TypeError('fetch failed')
      })
      vi.stubGlobal('fetch', fetchMock)

      const service = createBackupService({
        normalizeNodeSettings: () => settings,
        assertRepoReady: () => {},
        telenoNodeStatus: async () => ({
          services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
        }),
        telenoNodeAction: async () => ({ ok: true, output: '' }),
        runCommand: async () => ({ ok: true, code: 0, output: '' })
      } as any)

      const resultPromise = service.createLocalBackup(undefined, sender as any)
      await vi.advanceTimersByTimeAsync(1000)
      const result = await resultPromise

      expect(result.ok).toBe(false)
      expect(result.output).toContain('The running node stopped while the native backup was in progress.')
      expect(result.output).toContain('The backup did not complete')
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18088/admin/backup/status/admin-op-interrupted',
        expect.objectContaining({ method: 'GET' })
      )
      expect(sender.send).toHaveBeenCalledWith(
        'teleno:node:backup-progress:event',
        expect.objectContaining({
          action: 'create-backup',
          phase: 'error',
          progress: 70,
          message: expect.stringContaining('The running node stopped while the native backup was in progress.')
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains when running-node backup admin API is unreachable', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile,
        remoteEnabled: false
      })
    })
    const sender = { send: vi.fn() }
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      telenoNodeAction: async () => ({ ok: true, output: '' }),
      runCommand: async () => ({ ok: true, code: 0, output: '' })
    } as any)

    const result = await service.createLocalBackup(undefined, sender as any)

    expect(result.ok).toBe(false)
    expect(result.output).toContain('Backup admin API is not reachable at http://127.0.0.1:18088/admin/backup/create')
    expect(result.output).toContain('restart the node')
    expect(result.output).toContain('Underlying error: fetch failed')
    expect(sender.send).toHaveBeenCalledWith(
      'teleno:node:backup-progress:event',
      expect.objectContaining({
        action: 'create-backup',
        phase: 'error',
        progress: 0,
        message: expect.stringContaining('Backup admin API is not reachable')
      })
    )
  })

  it('does not launch an offline backup command while the node is already running without backup admin', async () => {
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: false,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/prodnet/teleno-dev/teleno-ux-mainnet',
        sshHost: 'seed.koinosfoundation.org',
        sshUser: 'teleno_backup'
      })
    })
    const sender = { send: vi.fn() }
    const runCommand = vi.fn(async () => ({ ok: true, code: 0, output: '' }))

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      telenoNodeAction: async () => ({ ok: true, output: '' }),
      runCommand
    } as any)

    const result = await service.createLocalBackup(undefined, sender as any)

    expect(result.ok).toBe(false)
    expect(result.output).toContain('Backup Admin is disabled')
    expect(runCommand).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith(
      'teleno:node:backup-progress:event',
      expect.objectContaining({
        action: 'create-backup',
        phase: 'error',
        message: expect.stringContaining('Backup Admin is disabled')
      })
    )
  })

  it('uses the running-node admin API for native backup lists when available', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1'
      })
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        source: 'remote_sftp',
        snapshots: {
          latest_backup_id: 'backup-remote-1',
          snapshot_count: 1,
          remote_space: {
            ok: true,
            available_bytes: 987654321,
            target_path: '/srv/teleno-backups/testnet/node-1',
            message: 'Remote backup directory has 987654321 bytes available'
          },
          snapshots: [{
            backup_id: 'backup-remote-1',
            latest: true,
            complete: true,
            total_bytes: 4096
          }]
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.nativeBackupList({ ...settings, remote: true } as any)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('remote')
    expect(result.latestBackupId).toBe('backup-remote-1')
    expect(result.remoteSpace).toEqual({
      ok: true,
      availableBytes: 987654321,
      targetPath: '/srv/teleno-backups/testnet/node-1',
      message: 'Remote backup directory has 987654321 bytes available'
    })
    expect(result.snapshots).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18088/admin/backup/snapshots/remote',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('uses the running-node admin API for public bootstrap backup lists when requested', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile
      })
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        source: 'public_http',
        snapshots: {
          latest_backup_id: 'public-backup-1',
          snapshot_count: 1,
          snapshots: [{
            backup_id: 'public-backup-1',
            latest: true,
            complete: true,
            total_bytes: 4096
          }]
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.nativeBackupList({ ...settings, public: true } as any)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('public')
    expect(result.latestBackupId).toBe('public-backup-1')
    expect(result.snapshots).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18088/admin/backup/public/snapshots',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('passes the hardcoded prodnet public bootstrap URL to the native CLI list command', async () => {
    const settings = nodeSettings({
      network: 'mainnet',
      profiles: ['mainnet_observer']
    })
    const binaryPath = resolveMonolithBinaryPath()
    const originalExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      const value = typeof filePath === 'string' ? filePath : filePath.toString()
      if (value === binaryPath) return true
      return originalExistsSync(filePath)
    })

    const runCommand = vi.fn(async () => ({
      ok: true,
      code: 0,
      output: [
        JSON.stringify({
          event: 'backup-progress',
          phase: 'public-restore-metadata-latest',
          backup_id: '',
          completed_batches: 0,
          total_batches: 1,
          attempt: 1
        }),
        JSON.stringify({
          event: 'backup-progress',
          phase: 'public-restore-metadata-snapshot',
          backup_id: 'prodnet-public-1',
          completed_batches: 1,
          total_batches: 3,
          attempt: 1
        }),
        JSON.stringify({
          latest_backup_id: 'prodnet-public-1',
          snapshot_count: 1,
          snapshots: [{ backup_id: 'prodnet-public-1', latest: true, complete: true }]
        }, null, 2)
      ].join('\n')
    }))
    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      runCommand
    } as any)

    const result = await service.nativeBackupList({ ...settings, public: true } as any)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('public')
    expect(result.latestBackupId).toBe('prodnet-public-1')
    expect(result.snapshots).toHaveLength(1)
    expect(runCommand).toHaveBeenCalledWith(
      binaryPath,
      expect.arrayContaining([
        '--backup-public-list',
        '--backup-public-url',
        'https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap',
        '--backup-json'
      ]),
      expect.objectContaining({ timeoutMs: 120_000 })
    )
  })

  it('falls back to the native CLI when remote admin list does not include space metadata', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1'
      })
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        source: 'remote_sftp',
        snapshots: {
          latest_backup_id: 'backup-remote-1',
          snapshot_count: 0,
          snapshots: []
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const binaryPath = resolveMonolithBinaryPath()
    const originalExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      const value = typeof filePath === 'string' ? filePath : filePath.toString()
      if (value === binaryPath) return true
      return originalExistsSync(filePath)
    })

    const runCommand = vi.fn(async () => ({
      ok: true,
      code: 0,
      output: JSON.stringify({
        latest_backup_id: '',
        snapshot_count: 0,
        remote_space: {
          ok: true,
          available_bytes: 555555,
          target_path: '/srv/teleno-backups/testnet/node-1',
          message: 'Remote backup directory has 555555 bytes available'
        },
        snapshots: []
      })
    }))
    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand
    } as any)

    const result = await service.nativeBackupList({ ...settings, remote: true } as any)

    expect(result.ok).toBe(true)
    expect(result.remoteSpace?.availableBytes).toBe(555555)
    expect(runCommand).toHaveBeenCalledWith(
      binaryPath,
      expect.arrayContaining(['--backup-list-remote', '--backup-json']),
      expect.objectContaining({ timeoutMs: 120_000 })
    )
  })

  it('uses the running-node admin API for native backup restore preflight when available', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile
      })
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        preflight: {
          backup_id: 'backup-1',
          ready_to_restore: true,
          snapshot_complete: true,
          file_count: 12,
          missing_object_count: 0,
          missing_object_bytes: 0,
          restore_space: {
            restored_database_bytes: 1024,
            runtime_files_bytes: 10,
            object_download_bytes: 0,
            minimum_target_free_bytes: 2048,
            recommended_target_free_bytes: 4096
          },
          space_check: {
            passes_minimum: true,
            below_recommended: false,
            available_bytes: 8192,
            target_path: settings.baseDir,
            message: 'ok'
          }
        }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.nativeBackupRestorePreflight({ ...settings, backupId: 'backup-1' } as any)

    expect(result.ok).toBe(true)
    expect(result.backupId).toBe('backup-1')
    expect(result.readyToRestore).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18088/admin/backup/restore/preflight',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ backup_id: 'backup-1' })
      })
    )
  })

  it('does not fetch SFTP data when restoring a selected local native backup through the admin API', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile,
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1'
      })
    })
    const routes: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      const route = new URL(url).pathname
      routes.push(route)
      if (route === '/admin/backup/restore/fetch') {
        throw new Error('local restore must not fetch remote backup data')
      }
      const payload = route === '/admin/backup/restore/preflight'
        ? {
            ok: true,
            preflight: {
              backup_id: 'backup-1',
              ready_to_restore: true,
              snapshot_complete: true,
              file_count: 12,
              missing_object_count: 0,
              missing_object_bytes: 0,
              restore_space: {
                restored_database_bytes: 1024,
                runtime_files_bytes: 10,
                object_download_bytes: 0,
                minimum_target_free_bytes: 2048,
                recommended_target_free_bytes: 4096
              },
              space_check: {
                passes_minimum: true,
                below_recommended: false,
                available_bytes: 8192,
                target_path: settings.baseDir,
                message: 'ok'
              }
            }
          }
        : { ok: true }
      return { ok: true, text: async () => JSON.stringify(payload) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.restoreNativeBackup({ ...settings, backupId: 'backup-1', backupSource: 'local' } as any, { send: vi.fn() } as any)

    expect(result.ok).toBe(true)
    expect(routes).toEqual([
      '/admin/backup/restore/preflight',
      '/admin/backup/restore/stage',
      '/admin/backup/restore/activate'
    ])
  })

  it('uses public bootstrap admin routes when restoring a public native backup', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile
      })
    })
    const routes: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      const route = new URL(url).pathname
      routes.push(route)
      const payload = route === '/admin/backup/public/fetch'
        ? {
            ok: true,
            status: {
              operation_id: 'public-op-1',
              state: 'succeeded',
              message: 'public fetch complete',
              has_public_restore_fetch: true,
              public_restore_fetch: {
                backup_id: 'public-backup-1',
                ready_to_stage: true
              }
            }
          }
        : route === '/admin/backup/public/preflight'
          ? {
              ok: true,
              preflight: {
                backup_id: 'public-backup-1',
                ready_to_restore: true,
                snapshot_complete: true,
                file_count: 12,
                missing_object_count: 0,
                missing_object_bytes: 0,
                restore_space: {
                  restored_database_bytes: 1024,
                  runtime_files_bytes: 10,
                  object_download_bytes: 0,
                  minimum_target_free_bytes: 2048,
                  recommended_target_free_bytes: 4096
                },
                space_check: {
                  passes_minimum: true,
                  below_recommended: false,
                  available_bytes: 8192,
                  target_path: settings.baseDir,
                  message: 'ok'
                }
              }
            }
          : { ok: true }
      return { ok: true, text: async () => JSON.stringify(payload) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.restoreNativeBackup(
      { ...settings, backupId: 'public-backup-1', backupSource: 'public' } as any,
      { send: vi.fn() } as any
    )

    expect(result.ok).toBe(true)
    expect(routes).toEqual([
      '/admin/backup/public/fetch',
      '/admin/backup/public/preflight',
      '/admin/backup/public/restore/stage',
      '/admin/backup/public/restore/activate'
    ])
  })

  it('explains running-node public restore when backup admin rejects the local token', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile
      })
    })
    const sender = { send: vi.fn() }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ ok: false, error: 'unauthorized' })
    })))

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.restoreNativeBackup(
      { ...settings, backupId: 'public-backup-1', backupSource: 'public' } as any,
      sender as any
    )

    expect(result.ok).toBe(false)
    expect(result.output).toContain("The running node rejected Koinos One's local Backup Admin token.")
    expect(result.output).toContain('Stop and start the node from Koinos One')
    expect(result.output).not.toContain('/admin/backup/public/fetch')
    expect(result.output).not.toContain('unauthorized')
    expect(sender.send).toHaveBeenCalledWith(
      'teleno:node:backup-progress:event',
      expect.objectContaining({
        action: 'restore-backup',
        phase: 'error',
        message: expect.stringContaining('local Backup Admin token')
      })
    )
  })

  it('continues running-node restore when long staging hits a headers timeout', async () => {
    const root = makeTempDir()
    const tokenFile = path.join(root, 'admin.token')
    fs.writeFileSync(tokenFile, 'secret-token\n')
    const settings = nodeSettings({
      backup: backupSettings({
        adminEnabled: true,
        adminListen: '127.0.0.1:18088',
        adminTokenFile: tokenFile
      })
    })
    const routes: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      const route = new URL(url).pathname
      routes.push(route)
      if (route === '/admin/backup/public/fetch') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            ok: true,
            status: {
              operation_id: 'public-op-1',
              state: 'succeeded',
              message: 'public fetch complete',
              has_public_restore_fetch: true,
              public_restore_fetch: {
                backup_id: 'public-backup-1',
                ready_to_stage: true
              }
            }
          })
        }
      }
      if (route === '/admin/backup/public/preflight') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            ok: true,
            preflight: {
              backup_id: 'public-backup-1',
              ready_to_restore: true,
              snapshot_complete: true,
              file_count: 12,
              missing_object_count: 0,
              missing_object_bytes: 0,
              restore_space: {
                restored_database_bytes: 1024,
                runtime_files_bytes: 10,
                object_download_bytes: 0,
                minimum_target_free_bytes: 2048,
                recommended_target_free_bytes: 4096
              },
              space_check: {
                passes_minimum: true,
                below_recommended: false,
                available_bytes: 8192,
                target_path: settings.baseDir,
                message: 'ok'
              }
            }
          })
        }
      }
      if (route === '/admin/backup/public/restore/stage') {
        const stagingDir = path.join(settings.baseDir, '.teleno-native-backups', 'restore-staging')
        fs.mkdirSync(stagingDir, { recursive: true })
        fs.writeFileSync(
          path.join(stagingDir, '.teleno-restore-stage.json'),
          JSON.stringify({
            format: 'teleno-native-restore-stage',
            version: 1,
            backup_id: 'public-backup-1',
            repository_dir: path.join(settings.baseDir, '.teleno-native-backups', 'repository'),
            target_basedir: settings.baseDir,
            staging_dir: stagingDir,
            restored_file_count: 12,
            restored_bytes: 1024,
            start_as_observer_first: true,
            skipped_optional_runtime_files: []
          })
        )
        fs.writeFileSync(path.join(stagingDir, 'RESTORE_STAGE_COMPLETE'), 'complete\n')
        const error = new TypeError('fetch failed') as Error & { cause?: Error }
        error.cause = new Error('Headers Timeout Error')
        throw error
      }
      return { ok: true, text: async () => JSON.stringify({ ok: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      telenoNodeStatus: async () => ({
        services: [{ managedByTeleno: true, state: 'running', status: 'running' }]
      }),
      runCommand: vi.fn()
    } as any)

    const result = await service.restoreNativeBackup(
      { ...settings, backupId: 'public-backup-1', backupSource: 'public' } as any,
      { send: vi.fn() } as any
    )

    expect(result.ok).toBe(true)
    expect(result.output).toContain('Native backup staged through running-node admin API')
    expect(routes).toEqual([
      '/admin/backup/public/fetch',
      '/admin/backup/public/preflight',
      '/admin/backup/public/restore/stage',
      '/admin/backup/public/restore/activate'
    ])
  })

  it('uses the remote native backup list command when requested', async () => {
    const settings = nodeSettings({
      backup: backupSettings({
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1',
        sshHost: 'testnet.koinosfoundation.org',
        sshUser: 'teleno_backup',
        sshAuth: 'password-file',
        sshPasswordFile: path.join(makeTempDir(), 'backup.pass')
      })
    })
    fs.writeFileSync(settings.backup!.sshPasswordFile!, 'secret\n')

    const binaryPath = resolveMonolithBinaryPath()
    const originalExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      const value = typeof filePath === 'string' ? filePath : filePath.toString()
      if (value === binaryPath) return true
      return originalExistsSync(filePath)
    })

    const runCommand = vi.fn(async () => ({
      ok: true,
      code: 0,
      output: JSON.stringify({
        latest_backup_id: 'backup-2',
        snapshot_count: 0,
        remote_space: {
          ok: true,
          available_bytes: 123456789,
          target_path: '/srv/teleno-backups/testnet/node-1',
          message: 'Remote backup directory has 123456789 bytes available'
        },
        snapshots: []
      })
    }))
    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      runCommand
    } as any)

    const result = await service.nativeBackupList({ ...settings, remote: true } as any)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('remote')
    expect(result.latestBackupId).toBe('backup-2')
    expect(result.remoteSpace).toEqual({
      ok: true,
      availableBytes: 123456789,
      targetPath: '/srv/teleno-backups/testnet/node-1',
      message: 'Remote backup directory has 123456789 bytes available'
    })
    expect(runCommand).toHaveBeenCalledWith(
      binaryPath,
      expect.arrayContaining(['--backup-list-remote', '--backup-json']),
      expect.objectContaining({ timeoutMs: 120_000 })
    )
  })

  it('uses the native backup delete command for confirmed purge', async () => {
    const settings = nodeSettings({
      backup: backupSettings({
        remoteEnabled: true,
        remoteDirectory: '/srv/teleno-backups/testnet/node-1',
        sshHost: 'testnet.koinosfoundation.org',
        sshUser: 'teleno_backup'
      })
    })

    const binaryPath = resolveMonolithBinaryPath()
    const originalExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      const value = typeof filePath === 'string' ? filePath : filePath.toString()
      if (value === binaryPath) return true
      return originalExistsSync(filePath)
    })

    const runCommand = vi.fn(async () => ({
      ok: true,
      code: 0,
      output: JSON.stringify({
        scope: 'remote',
        result_count: 1,
        results: [{ source: 'remote', backup_id: 'backup-remote-1', dry_run: false }]
      })
    }))
    const service = createBackupService({
      normalizeNodeSettings: () => settings,
      assertRepoReady: () => {},
      runCommand
    } as any)

    const result = await service.nativeBackupPurge({
      ...settings,
      backupId: 'backup-remote-1',
      backupSource: 'remote'
    } as any)

    expect(result.ok).toBe(true)
    expect(result.backupId).toBe('backup-remote-1')
    expect(result.source).toBe('remote')
    expect(runCommand).toHaveBeenCalledWith(
      binaryPath,
      expect.arrayContaining([
        '--backup-delete',
        '--backup-json',
        '--backup-id=backup-remote-1',
        '--backup-scope=remote',
        '--backup-delete-confirm=backup-remote-1'
      ]),
      expect.objectContaining({ timeoutMs: 10 * 60_000 })
    )
  })
})
