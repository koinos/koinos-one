import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  blockProducerPublicKeyFilePath,
  defaultBaseDirForNetwork,
  ensureKoinosBaseDir,
  managedFilePath,
  normalizeBackupSettings,
  normalizeNodeSettings,
  parsePersistedNodeSettings,
  sanitizePublicRpcUrls
} from './node-paths'

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dirPath)
  return dirPath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop()
    if (dirPath) fs.rmSync(dirPath, { recursive: true, force: true })
  }
})

describe('electron node paths', () => {
  it('normalizes the base dir to end with .koinos while preserving Teleno and legacy app basedirs', () => {
    expect(ensureKoinosBaseDir('~/node-data')).toMatch(/node-data[/\\]\.koinos$/)
    expect(ensureKoinosBaseDir('/tmp/example/.koinos')).toBe('/tmp/example/.koinos')
    expect(ensureKoinosBaseDir('/tmp/example/.teleno')).toBe('/tmp/example/.teleno')
    expect(ensureKoinosBaseDir('/tmp/example/.koinosgui')).toBe('/tmp/example/.koinosgui')
  })

  it('normalizes persisted node settings payloads', () => {
    expect(
      parsePersistedNodeSettings({
        repoPath: '/repo',
        baseDir: '~/node',
        network: 'testnet',
        profiles: 'block_producer,jsonrpc',
        blockchainBackupUrl: 'http://example.test/backup.tar.gz'
      })
    ).toEqual({
      network: 'testnet',
      repoPath: '/repo',
      baseDir: '~/node',
      profiles: ['block_producer', 'jsonrpc'],
      blockchainBackupUrl: 'http://example.test/backup.tar.gz',
      backup: undefined
    })
  })

  it('normalizes native backup settings', () => {
    expect(
      normalizeBackupSettings({
        localRetentionCount: '9' as unknown as number,
        remoteEnabled: true,
        remoteDirectory: ' /srv/teleno-backups/testnet/node-1 ',
        sshPort: '2222' as unknown as number,
        sshAuth: 'password-file',
        sshStrictHostKeyChecking: false,
        scheduleEnabled: true,
        scheduleInterval: '12h',
        adminJobs: 99
      })
    ).toMatchObject({
      localEnabled: true,
      localRetentionCount: 9,
      remoteEnabled: true,
      remoteDirectory: '/srv/teleno-backups/testnet/node-1',
      sshPort: 2222,
      sshAuth: 'password-file',
      sshStrictHostKeyChecking: false,
      scheduleEnabled: true,
      scheduleInterval: '12h',
      adminJobs: 16
    })
  })

  it('normalizes node settings with profiles', () => {
    const normalized = normalizeNodeSettings({
      repoPath: '~/repo',
      baseDir: '~/node',
      profiles: ['block_producer']
    })

    expect(normalized.repoPath).toMatch(/repo$/)
    expect(normalized.baseDir).toMatch(/node[/\\]\.koinos$/)
    expect(normalized.network).toBe('mainnet')
    expect(normalized.profiles).toEqual(['block_producer'])
    expect(normalized.backup.localEnabled).toBe(true)
    expect(normalized.backup.remoteEnabled).toBe(false)
  })

  it('infers testnet from persisted profiles when network is omitted', () => {
    const normalized = normalizeNodeSettings({
      repoPath: '~/repo',
      baseDir: '~/node',
      profiles: ['testnet_observer']
    })

    expect(normalized.network).toBe('testnet')
  })

  it('uses separate default base dirs per network when no base dir is provided', () => {
    expect(defaultBaseDirForNetwork('mainnet')).toMatch(/\.teleno$/)
    expect(defaultBaseDirForNetwork('testnet')).toMatch(/\.teleno[/\\]testnet[/\\]\.koinos$/)
    expect(normalizeNodeSettings({ network: 'testnet' }).baseDir).toMatch(/\.teleno[/\\]testnet[/\\]\.koinos$/)
  })

  it('preserves an existing exact node basedir layout instead of appending .koinos', () => {
    const baseDir = createTempDir('teleno-node-basedir-')
    fs.writeFileSync(path.join(baseDir, 'config.yml'), 'global:\n  log-level: info\n')

    expect(ensureKoinosBaseDir(baseDir)).toBe(baseDir)
  })

  it('selects an existing child basedir layout when the parent folder is entered', () => {
    const parentDir = createTempDir('teleno-node-parent-')
    const restoredBaseDir = path.join(parentDir, 'basedir')
    const guiDefaultDir = path.join(parentDir, '.koinos')
    fs.mkdirSync(path.join(restoredBaseDir, 'chain'), { recursive: true })
    fs.mkdirSync(guiDefaultDir, { recursive: true })
    fs.writeFileSync(path.join(restoredBaseDir, 'chain', 'genesis_data.json'), '{}')
    fs.writeFileSync(path.join(guiDefaultDir, 'config.yml'), 'global:\n  log-level: info\n')

    expect(ensureKoinosBaseDir(parentDir)).toBe(restoredBaseDir)
  })

  it('deduplicates and sanitizes public rpc urls', () => {
    expect(
      sanitizePublicRpcUrls([
        'https://api.koinos.io',
        ' https://api.koinos.io/ ',
        'http://localhost:8080',
        'ftp://invalid'
      ])
    ).toEqual(['https://api.koinos.io/', 'http://localhost:8080/'])
  })

  it('falls back to defaults when no valid public rpc urls remain', () => {
    expect(sanitizePublicRpcUrls(['ftp://invalid', '   '])).toEqual([
      'https://api.koinos.io/',
      'https://api.koinosblocks.com/'
    ])
  })

  it('builds managed file paths from the repo and base dir settings', () => {
    const repoPath = createTempDir('teleno-node-paths-')
    const settings = {
      repoPath,
      baseDir: path.join(repoPath, '.koinos')
    }

    expect(managedFilePath(settings, 'config')).toBe(path.join(repoPath, 'config', 'config.yml'))
    expect(blockProducerPublicKeyFilePath(settings)).toBe(path.join(repoPath, '.koinos', 'block_producer', 'public.key'))
  })
})
