import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { producerAddressFromRuntimeConfig, resolveLocalProducerPublicKey } from './producer-keys'

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

describe('producer key helpers', () => {
  it('reads the local public key directly from the block_producer dir', () => {
    const baseDir = path.join(createTempDir('knodel-producer-keys-'), '.koinos')
    const producerDir = path.join(baseDir, 'block_producer')
    fs.mkdirSync(producerDir, { recursive: true })
    fs.writeFileSync(path.join(producerDir, 'public.key'), 'LOCAL_PUBLIC_KEY')
    fs.writeFileSync(path.join(producerDir, 'private.key'), 'PRIVATE_WIF')

    expect(resolveLocalProducerPublicKey({ baseDir })).toEqual({
      publicKey: 'LOCAL_PUBLIC_KEY',
      publicKeyPath: path.join(producerDir, 'public.key'),
      privateKeyPath: path.join(producerDir, 'private.key')
    })
  })

  it('extracts the producer address from runtime config', () => {
    const baseDir = path.join(createTempDir('knodel-producer-config-'), '.koinos')
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(
      path.join(baseDir, 'config.yml'),
      ['block_producer:', '  producer: 1ProducerAddress'].join('\n')
    )

    expect(producerAddressFromRuntimeConfig({ baseDir })).toEqual({
      producerAddress: '1ProducerAddress',
      configHasProducer: true,
      configFilePath: path.join(baseDir, 'config.yml')
    })
  })

  it('returns an empty producer config state when the file is missing', () => {
    const baseDir = path.join(createTempDir('knodel-producer-config-empty-'), '.koinos')
    fs.mkdirSync(baseDir, { recursive: true })

    expect(producerAddressFromRuntimeConfig({ baseDir })).toEqual({
      producerAddress: null,
      configHasProducer: false,
      configFilePath: path.join(baseDir, 'config.yml')
    })
  })
})
