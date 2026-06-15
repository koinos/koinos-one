import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import {
  blockchainBackupChecksumUrl,
  extractHeadInfoSummary,
  normalizeBlockchainBackupArchiveUrl,
  parseBlockchainBackupMetadataDirectories,
  parseBlockchainBackupSha256Checksum,
  writeNativeBackupConfig
} from './backup-service'
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
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('backup-service helpers', () => {
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
    expect(fs.existsSync(repositoryDir)).toBe(true)
    expect(fs.existsSync(workspaceDir)).toBe(true)
  })
})
