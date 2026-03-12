import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_PUBLIC_RPC_URLS,
  KNODEL_CONFIG_DIR,
  KNODEL_ENCRYPTION_ALGORITHM,
  KNODEL_KEY_LENGTH,
  KNODEL_PBKDF2_ITERATIONS,
  KNODEL_PRODUCER_PROFILE_FILE,
  KNODEL_PRODUCER_WALLET_FILE,
  KNODEL_PUBLIC_RPCS_FILE,
  KNODEL_SECURE_STORAGE_DIR
} from './constants'
import { sanitizePublicRpcUrls } from './node-paths'

export type KnodelEncryptedSecret = {
  encrypted: string
  salt: string
  iv: string
  authTag: string
}

export type KnodelEncryptedWallet = {
  address: string
  encryptedKey: KnodelEncryptedSecret
  encryptedSeedPhrase?: KnodelEncryptedSecret | null
  seedDerivationPath?: string | null
  createdAt: string
}

export type KnodelUnlockedWallet = {
  address: string
  privateKey: string
  seedPhrase?: string | null
  seedDerivationPath?: string | null
}

export type KnodelProducerProfile = {
  producerAddress: string
  registrationSignerAccountId: string
  burnAccountId: string
  localPublicKey: string
  localPublicKeyPath: string
  registeredPublicKey?: string | null
  lastRegistrationTxId?: string | null
  updatedAt: string
}

export type PublicRpcConfigInput = {
  publicRpcUrls?: string[]
}

export type PublicRpcConfigResult = {
  ok: boolean
  output: string
  publicRpcUrls: string[]
}

function secureStoragePath(userDataPath: string, ...parts: string[]): string {
  return path.join(userDataPath, KNODEL_SECURE_STORAGE_DIR, ...parts)
}

function configPath(userDataPath: string, ...parts: string[]): string {
  return path.join(userDataPath, KNODEL_CONFIG_DIR, ...parts)
}

function ensureDir(dirPath: string, mode?: number): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode })
  }
}

function decryptKnodelWalletSecret(secret: KnodelEncryptedSecret, password: string): string {
  const salt = Buffer.from(secret.salt, 'hex')
  const iv = Buffer.from(secret.iv, 'hex')
  const authTag = Buffer.from(secret.authTag, 'hex')
  const key = pbkdf2Sync(password, salt, KNODEL_PBKDF2_ITERATIONS, KNODEL_KEY_LENGTH, 'sha256')
  const decipher = createDecipheriv(KNODEL_ENCRYPTION_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(secret.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function encryptKnodelWalletSecret(value: string, password: string): KnodelEncryptedSecret {
  const salt = randomBytes(32)
  const iv = randomBytes(16)
  const key = pbkdf2Sync(password, salt, KNODEL_PBKDF2_ITERATIONS, KNODEL_KEY_LENGTH, 'sha256')
  const cipher = createCipheriv(KNODEL_ENCRYPTION_ALGORITHM, key, iv)
  let encrypted = cipher.update(value, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  }
}

export function createKnodelStorage(userDataPath: string) {
  let unlockedWallet: KnodelUnlockedWallet | null = null

  const producerWalletFilePath = () => secureStoragePath(userDataPath, KNODEL_PRODUCER_WALLET_FILE)
  const producerProfileFilePath = () => secureStoragePath(userDataPath, KNODEL_PRODUCER_PROFILE_FILE)
  const publicRpcsFilePath = () => configPath(userDataPath, KNODEL_PUBLIC_RPCS_FILE)

  const ensureSecureStorageDir = () => ensureDir(secureStoragePath(userDataPath), 0o700)
  const ensureConfigDir = () => ensureDir(configPath(userDataPath))

  const loadPublicRpcConfig = (): PublicRpcConfigResult => {
    const filePath = publicRpcsFilePath()
    if (!fs.existsSync(filePath)) {
      return {
        ok: true,
        output: `Using default public RPC list (${DEFAULT_PUBLIC_RPC_URLS.length} entries)`,
        publicRpcUrls: [...DEFAULT_PUBLIC_RPC_URLS]
      }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as PublicRpcConfigInput
      const publicRpcUrls = sanitizePublicRpcUrls(parsed.publicRpcUrls)
      return {
        ok: true,
        output: `Loaded ${publicRpcUrls.length} public RPC URLs from ${filePath}`,
        publicRpcUrls
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not read public RPC config',
        publicRpcUrls: [...DEFAULT_PUBLIC_RPC_URLS]
      }
    }
  }

  const savePublicRpcConfig = (input?: PublicRpcConfigInput): PublicRpcConfigResult => {
    try {
      const publicRpcUrls = sanitizePublicRpcUrls(input?.publicRpcUrls)
      ensureConfigDir()
      const filePath = publicRpcsFilePath()
      fs.writeFileSync(filePath, JSON.stringify({ publicRpcUrls }, null, 2))
      return {
        ok: true,
        output: `Saved ${publicRpcUrls.length} public RPC URLs to ${filePath}`,
        publicRpcUrls
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not save public RPC config',
        publicRpcUrls: [...DEFAULT_PUBLIC_RPC_URLS]
      }
    }
  }

  const loadWalletFile = (): KnodelEncryptedWallet | null => {
    const walletFilePath = producerWalletFilePath()
    if (!fs.existsSync(walletFilePath)) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(walletFilePath, 'utf8')) as KnodelEncryptedWallet
      if (typeof parsed?.address !== 'string' || !parsed.address.trim()) return null
      if (!parsed.encryptedKey) return null
      return parsed
    } catch {
      return null
    }
  }

  const loadProducerProfile = (): KnodelProducerProfile | null => {
    const profileFilePath = producerProfileFilePath()
    if (!fs.existsSync(profileFilePath)) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(profileFilePath, 'utf8')) as Partial<KnodelProducerProfile>
      const producerAddress = `${parsed?.producerAddress || ''}`.trim()
      const registrationSignerAccountId = `${parsed?.registrationSignerAccountId || ''}`.trim()
      const burnAccountId = `${parsed?.burnAccountId || ''}`.trim()
      const localPublicKey = `${parsed?.localPublicKey || ''}`.trim()
      const localPublicKeyPath = `${parsed?.localPublicKeyPath || ''}`.trim()
      if (!producerAddress || !registrationSignerAccountId || !burnAccountId || !localPublicKey || !localPublicKeyPath) {
        return null
      }
      return {
        producerAddress,
        registrationSignerAccountId,
        burnAccountId,
        localPublicKey,
        localPublicKeyPath,
        registeredPublicKey: typeof parsed?.registeredPublicKey === 'string' ? parsed.registeredPublicKey : null,
        lastRegistrationTxId: typeof parsed?.lastRegistrationTxId === 'string' ? parsed.lastRegistrationTxId : null,
        updatedAt: typeof parsed?.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString()
      }
    } catch {
      return null
    }
  }

  const saveProducerProfile = (profile: KnodelProducerProfile): string => {
    ensureSecureStorageDir()
    const filePath = producerProfileFilePath()
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tempPath, JSON.stringify(profile, null, 2), { mode: 0o600 })
      fs.renameSync(tempPath, filePath)
    } finally {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath)
        } catch {
          // best effort
        }
      }
    }
    return filePath
  }

  const clearProducerProfile = (): boolean => {
    const profileFilePath = producerProfileFilePath()
    if (!fs.existsSync(profileFilePath)) return false
    fs.unlinkSync(profileFilePath)
    return true
  }

  const loadWallet = (password: string): KnodelUnlockedWallet | null => {
    const wallet = loadWalletFile()
    if (!wallet) return null

    const privateKey = decryptKnodelWalletSecret(wallet.encryptedKey, password)
    const seedPhrase = wallet.encryptedSeedPhrase
      ? decryptKnodelWalletSecret(wallet.encryptedSeedPhrase, password)
      : null
    return {
      address: wallet.address,
      privateKey,
      seedPhrase,
      seedDerivationPath:
        typeof wallet.seedDerivationPath === 'string' && wallet.seedDerivationPath.trim()
          ? wallet.seedDerivationPath.trim()
          : null
    }
  }

  const unlockWalletSession = (password: string): KnodelUnlockedWallet | null => {
    const wallet = loadWallet(password)
    if (!wallet) return null
    unlockedWallet = wallet
    return wallet
  }

  const saveWallet = (
    privateKey: string,
    address: string,
    password: string,
    options?: {
      seedPhrase?: string
      derivationPath?: string
    }
  ): string => {
    ensureSecureStorageDir()
    const seedPhrase = `${options?.seedPhrase || ''}`.trim()
    const derivationPath = `${options?.derivationPath || ''}`.trim()
    const payload: KnodelEncryptedWallet = {
      address,
      encryptedKey: encryptKnodelWalletSecret(privateKey, password),
      encryptedSeedPhrase: seedPhrase ? encryptKnodelWalletSecret(seedPhrase, password) : null,
      seedDerivationPath: derivationPath || null,
      createdAt: new Date().toISOString()
    }
    const walletFilePath = producerWalletFilePath()
    fs.writeFileSync(walletFilePath, JSON.stringify(payload, null, 2), { mode: 0o600 })
    unlockedWallet = {
      address,
      privateKey,
      seedPhrase: seedPhrase || null,
      seedDerivationPath: derivationPath || null
    }
    return walletFilePath
  }

  const deleteWallet = (): boolean => {
    const walletFilePath = producerWalletFilePath()
    if (!fs.existsSync(walletFilePath)) return false
    fs.unlinkSync(walletFilePath)
    try {
      clearProducerProfile()
    } catch {
      // best effort
    }
    unlockedWallet = null
    return true
  }

  const closeWalletSession = (): string | null => {
    const walletAddress = unlockedWallet?.address || loadWalletFile()?.address || null
    unlockedWallet = null
    return walletAddress
  }

  const resolveWalletQueryAddress = (address?: string): string | null => {
    const explicit = `${address || ''}`.trim()
    if (explicit) return explicit
    if (unlockedWallet?.address) return unlockedWallet.address
    const storedWallet = loadWalletFile()
    return storedWallet?.address?.trim() || null
  }

  const getUnlockedWallet = () => unlockedWallet

  return {
    producerWalletFilePath,
    producerProfileFilePath,
    publicRpcsFilePath,
    loadPublicRpcConfig,
    savePublicRpcConfig,
    loadWalletFile,
    loadProducerProfile,
    saveProducerProfile,
    clearProducerProfile,
    loadWallet,
    unlockWalletSession,
    getUnlockedWallet,
    saveWallet,
    deleteWallet,
    closeWalletSession,
    resolveWalletQueryAddress
  }
}
