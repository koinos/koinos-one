import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { normalizeConnectHost, parseListenEndpoint, resolveRuntimeListenPorts } from './runtime-listen'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleno-runtime-listen-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('runtime listen parsing', () => {
  it('parses multiaddr and host-port listen endpoints', () => {
    expect(parseListenEndpoint('/ip4/0.0.0.0/tcp/18888', '/tcp/8888', '0.0.0.0')).toMatchObject({
      host: '0.0.0.0',
      port: 18888
    })
    expect(parseListenEndpoint('127.0.0.1:18122', '127.0.0.1:8080', '127.0.0.1')).toMatchObject({
      host: '127.0.0.1',
      port: 18122
    })
    expect(normalizeConnectHost('0.0.0.0')).toBe('127.0.0.1')
  })

  it('reads configured jsonrpc and p2p listen ports from basedir config', () => {
    const baseDir = tempDir()
    fs.writeFileSync(
      path.join(baseDir, 'config.yml'),
      [
        'jsonrpc:',
        '  listen: 127.0.0.1:18122',
        'p2p:',
        '  listen: /ip4/0.0.0.0/tcp/18888',
        ''
      ].join('\n')
    )

    const ports = resolveRuntimeListenPorts({ baseDir, network: 'testnet' })

    expect(ports.jsonrpc.port).toBe(18122)
    expect(ports.p2p.port).toBe(18888)
  })
})
