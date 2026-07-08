import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

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

export type CreateLocalProducerKeyResult = {
  ok: boolean
  created: boolean
  output: string
  publicKey: string | null
  publicKeyPath: string | null
  privateKeyPath: string | null
}

/**
 * Create the local producer key file without starting the node. Writes the
 * same WIF private-key file teleno_node would create on first producer start
 * (block_producer/private.key, owner-only permissions). Never overwrites an
 * existing key.
 */
export function createLocalProducerKeyFile(settings: { baseDir: string }): CreateLocalProducerKeyResult {
  const resolved = { baseDir: ensureKoinosBaseDir(settings.baseDir) }
  const privateKeyPath = blockProducerPrivateKeyFilePath(resolved)
  const publicKeyPath = blockProducerPublicKeyFilePath(resolved)

  const existing = resolveLocalProducerPublicKey(resolved)
  if (existing.publicKey) {
    return {
      ok: true,
      created: false,
      output: `A local producer key already exists at ${existing.privateKeyPath || existing.publicKeyPath}. It was not modified.`,
      publicKey: existing.publicKey,
      publicKeyPath: existing.publicKeyPath,
      privateKeyPath: existing.privateKeyPath
    }
  }

  try {
    const signer = new Signer({ privateKey: randomBytes(32).toString('hex') })
    const wif = signer.getPrivateKey('wif')
    const publicKeyBytes =
      signer.publicKey instanceof Uint8Array ? signer.publicKey : utils.toUint8Array(`${signer.publicKey}`)
    const publicKey = utils.encodeBase64url(publicKeyBytes)

    fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(privateKeyPath, `${wif}\n`, { encoding: 'utf8', mode: 0o600 })
    try { fs.chmodSync(privateKeyPath, 0o600) } catch { /* best effort */ }

    return {
      ok: true,
      created: true,
      output: `Created local producer key at ${privateKeyPath}. Register this public key when you want this installation to produce blocks.`,
      publicKey,
      publicKeyPath: fs.existsSync(publicKeyPath) ? publicKeyPath : null,
      privateKeyPath
    }
  } catch (error) {
    return {
      ok: false,
      created: false,
      output: error instanceof Error ? error.message : 'Could not create the local producer key.',
      publicKey: null,
      publicKeyPath: null,
      privateKeyPath: null
    }
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
