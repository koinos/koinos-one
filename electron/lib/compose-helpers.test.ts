import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatComposePresetLabel,
  normalizeComposeDependsOn,
  normalizeComposePortDefinition,
  normalizeComposeProfiles,
  parsePortNumber,
  readComposeServiceDefinitions,
  resolveComposeEnvTemplate
} from './compose-helpers'

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

describe('compose helpers', () => {
  it('normalizes compose profile and dependency declarations', () => {
    expect(normalizeComposeProfiles([' block_producer ', 'jsonrpc'])).toEqual(['block_producer', 'jsonrpc'])
    expect(normalizeComposeProfiles('jsonrpc')).toEqual(['jsonrpc'])
    expect(normalizeComposeDependsOn({ chain: {}, mempool: {} })).toEqual(['chain', 'mempool'])
  })

  it('resolves compose env templates with fallbacks', () => {
    expect(resolveComposeEnvTemplate('${BASEDIR}/chain', { BASEDIR: '/tmp/node/.koinos' })).toBe('/tmp/node/.koinos/chain')
    expect(resolveComposeEnvTemplate('${MISSING:-fallback}', {})).toBe('fallback')
  })

  it('parses string and object port definitions', () => {
    expect(parsePortNumber('8080')).toBe(8080)
    expect(
      normalizeComposePortDefinition('127.0.0.1:${JSONRPC_PORT:-8080}:8080/tcp', {
        JSONRPC_PORT: '18080'
      })
    ).toEqual({
      host: '127.0.0.1',
      publishedPort: 18080,
      targetPort: 8080,
      protocol: 'tcp',
      label: '127.0.0.1:18080->8080/tcp'
    })

    expect(
      normalizeComposePortDefinition(
        {
          host_ip: '0.0.0.0',
          published: '8545',
          target: '8545',
          protocol: 'tcp'
        },
        {}
      )
    ).toEqual({
      host: '0.0.0.0',
      publishedPort: 8545,
      targetPort: 8545,
      protocol: 'tcp',
      label: '0.0.0.0:8545->8545/tcp'
    })
  })

  it('reads compose service definitions with env expansion', () => {
    const repoPath = createTempDir('knodel-compose-helpers-')
    fs.writeFileSync(path.join(repoPath, '.env'), 'JSONRPC_PORT=8088\n')
    fs.writeFileSync(
      path.join(repoPath, 'docker-compose.yml'),
      [
        'services:',
        '  jsonrpc:',
        '    profiles: [jsonrpc]',
        '    depends_on: [chain]',
        '    image: "koinos/jsonrpc:${JSONRPC_PORT}"',
        '    ports:',
        '      - "127.0.0.1:${JSONRPC_PORT}:8080/tcp"'
      ].join('\n')
    )

    const definitions = readComposeServiceDefinitions({
      repoPath,
      composeFile: 'docker-compose.yml',
      envFile: '.env',
      baseDir: path.join(repoPath, '.koinos'),
      profiles: ['jsonrpc']
    })

    expect(definitions.get('jsonrpc')).toEqual({
      profiles: ['jsonrpc'],
      dependsOn: ['chain'],
      ports: [
        {
          host: '127.0.0.1',
          publishedPort: 8088,
          targetPort: 8080,
          protocol: 'tcp',
          label: '127.0.0.1:8088->8080/tcp'
        }
      ],
      image: 'koinos/jsonrpc:8088'
    })
  })

  it('formats compose preset labels for display', () => {
    expect(formatComposePresetLabel('block_producer')).toBe('Block Producer')
    expect(formatComposePresetLabel('contract-meta-store')).toBe('Contract Meta Store')
  })
})
