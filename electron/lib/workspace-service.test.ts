import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspaceService } from './workspace-service'
import type { KoinosNodeSettings, KoinosNodeSettingsInput } from './main-types'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-workspace-service-'))
  tempDirs.push(dir)
  return dir
}

function normalizeNodeSettings(input?: KoinosNodeSettingsInput): KoinosNodeSettings {
  return {
    repoPath: input?.repoPath || '',
    baseDir: input?.baseDir || path.join(input?.repoPath || '', 'basedir'),
    profiles: input?.profiles || [],
    blockchainBackupUrl: input?.blockchainBackupUrl || 'https://example.com/backup.tar.gz'
  }
}

function createService() {
  return createWorkspaceService({
    normalizeNodeSettings,
    configDirPath: (settings: KoinosNodeSettings) => path.join(settings.repoPath, 'config'),
    configExampleDirPath: (settings: KoinosNodeSettings) => path.join(settings.repoPath, 'config-example'),
    managedFilePath: (settings: { repoPath: string }, _kind: string) =>
      path.join(settings.repoPath, 'config', 'config.yml'),
    restoreWorkspaceParentPath: (baseDir: string) => path.join(path.dirname(baseDir), '.restore'),
    verifyWritableDirectory: (dirPath: string) => {
      fs.mkdirSync(dirPath, { recursive: true })
      const probePath = path.join(dirPath, '.probe')
      fs.writeFileSync(probePath, 'ok')
      fs.rmSync(probePath, { force: true })
    },
    runCommand: async () => ({ ok: true, code: 0, output: '' })
  })
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('workspace-service', () => {
  it('copies runtime files into BASEDIR while preserving config.yml', () => {
    const repoPath = makeTempDir()
    const baseDir = path.join(repoPath, 'basedir')
    const configDir = path.join(repoPath, 'config')
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'config.yml'), 'new-config\n')
    fs.writeFileSync(path.join(configDir, 'genesis_data.json'), '{}\n')
    fs.writeFileSync(path.join(configDir, 'koinos_descriptors.pb'), 'pb\n')
    fs.writeFileSync(path.join(baseDir, 'config.yml'), 'existing-config\n')

    const service = createService()
    const output = service.ensureBaseDirKoinosRuntimeFiles(
      normalizeNodeSettings({
        repoPath,
        baseDir
      })
    )

    expect(output).toContain('Prepared BASEDIR runtime files:')
    expect(output).toContain('Preserved existing BASEDIR runtime files: config.yml')
    expect(fs.readFileSync(path.join(baseDir, 'config.yml'), 'utf8')).toBe('existing-config\n')
    expect(fs.readFileSync(path.join(baseDir, 'chain', 'genesis_data.json'), 'utf8')).toBe('{}\n')
    expect(fs.readFileSync(path.join(baseDir, 'jsonrpc', 'descriptors', 'koinos_descriptors.pb'), 'utf8')).toBe('pb\n')
  })
})
