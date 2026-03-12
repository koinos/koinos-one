import fs from 'node:fs'

import { parse as parseYaml } from 'yaml'
import { Signer, utils } from 'koilib'

import { DEFAULT_BASEDIR } from './constants'
import {
  baseDirConfigFilePath,
  blockProducerPrivateKeyFilePath,
  blockProducerPublicKeyFilePath,
  ensureKoinosBaseDir,
  readTrimmedFile
} from './node-paths'

export type LocalProducerKeyResult = {
  publicKey: string | null
  publicKeyPath: string | null
  privateKeyPath: string | null
}

function derivePublicKeyFromPrivateKeyFile(settings: { baseDir: string }): string | null {
  const privateKeyWif = readTrimmedFile(blockProducerPrivateKeyFilePath(settings))
  if (!privateKeyWif) return null

  try {
    const signer = Signer.fromWif(privateKeyWif)
    const publicKeyBytes =
      signer.publicKey instanceof Uint8Array ? signer.publicKey : utils.toUint8Array(`${signer.publicKey}`)
    return utils.encodeBase64url(publicKeyBytes)
  } catch {
    return null
  }
}

function producerKeyLookupSettings(settings: { baseDir: string }): Array<{ baseDir: string }> {
  const candidateBaseDirs = Array.from(
    new Set([
      ensureKoinosBaseDir(settings.baseDir),
      ensureKoinosBaseDir(DEFAULT_BASEDIR)
    ])
  ).filter(Boolean)

  return candidateBaseDirs.map((baseDir) => ({ baseDir }))
}

export function resolveLocalProducerPublicKey(settings: { baseDir: string }): LocalProducerKeyResult {
  for (const candidateSettings of producerKeyLookupSettings(settings)) {
    const publicKeyPath = blockProducerPublicKeyFilePath(candidateSettings)
    const privateKeyPath = blockProducerPrivateKeyFilePath(candidateSettings)
    const direct = readTrimmedFile(publicKeyPath)
    if (direct) {
      return {
        publicKey: direct,
        publicKeyPath,
        privateKeyPath: fs.existsSync(privateKeyPath) ? privateKeyPath : null
      }
    }
  }

  for (const candidateSettings of producerKeyLookupSettings(settings)) {
    const publicKeyPath = blockProducerPublicKeyFilePath(candidateSettings)
    const privateKeyPath = blockProducerPrivateKeyFilePath(candidateSettings)
    const derived = derivePublicKeyFromPrivateKeyFile(candidateSettings)
    if (derived) {
      return {
        publicKey: derived,
        publicKeyPath: fs.existsSync(publicKeyPath) ? publicKeyPath : null,
        privateKeyPath: fs.existsSync(privateKeyPath) ? privateKeyPath : null
      }
    }
  }

  return {
    publicKey: null,
    publicKeyPath: null,
    privateKeyPath: null
  }
}

export function producerAddressFromRuntimeConfig(settings: { baseDir: string }): {
  producerAddress: string | null
  configHasProducer: boolean
  configFilePath: string
} {
  const filePath = baseDirConfigFilePath(settings)
  if (!fs.existsSync(filePath)) {
    return {
      producerAddress: null,
      configHasProducer: false,
      configFilePath: filePath
    }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = parseYaml(content) as {
      block_producer?: {
        producer?: string
      }
    }
    const producerAddress = `${parsed?.block_producer?.producer || ''}`.trim() || null
    return {
      producerAddress,
      configHasProducer: Boolean(producerAddress),
      configFilePath: filePath
    }
  } catch {
    return {
      producerAddress: null,
      configHasProducer: false,
      configFilePath: filePath
    }
  }
}
