import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  blockProducerPublicKeyFilePath,
  ensureKoinosBaseDir,
  managedFilePath,
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
  it('normalizes the base dir to end with .koinos while preserving .koinosgui', () => {
    expect(ensureKoinosBaseDir('~/node-data')).toMatch(/node-data[/\\]\.koinos$/)
    expect(ensureKoinosBaseDir('/tmp/example/.koinos')).toBe('/tmp/example/.koinos')
    expect(ensureKoinosBaseDir('/tmp/example/.koinosgui')).toBe('/tmp/example/.koinosgui')
  })

  it('normalizes persisted node settings payloads', () => {
    expect(
      parsePersistedNodeSettings({
        repoPath: '/repo',
        baseDir: '~/node',
        profiles: 'block_producer,jsonrpc',
        blockchainBackupUrl: 'http://example.test/backup.tar.gz'
      })
    ).toEqual({
      repoPath: '/repo',
      baseDir: '~/node',
      profiles: ['block_producer', 'jsonrpc'],
      blockchainBackupUrl: 'http://example.test/backup.tar.gz'
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
    expect(normalized.profiles).toEqual(['block_producer'])
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
    const repoPath = createTempDir('knodel-node-paths-')
    const settings = {
      repoPath,
      baseDir: path.join(repoPath, '.koinos')
    }

    expect(managedFilePath(settings, 'config')).toBe(path.join(repoPath, 'config', 'config.yml'))
    expect(blockProducerPublicKeyFilePath(settings)).toBe(path.join(repoPath, '.koinos', 'block_producer', 'public.key'))
  })
})
