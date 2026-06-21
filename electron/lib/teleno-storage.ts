import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Signer } from 'koilib'

import {
  DEFAULT_PUBLIC_RPC_URLS,
  TELENO_CONFIG_DIR,
  TELENO_ENCRYPTION_ALGORITHM,
  TELENO_KEY_LENGTH,
  TELENO_PBKDF2_ITERATIONS,
  TELENO_PRODUCER_PROFILE_FILE,
  TELENO_PRODUCER_WALLET_FILE,
  TELENO_PUBLIC_RPCS_FILE,
  TELENO_SECURE_STORAGE_DIR
} from './constants'
import { normalizeKoinosNetworkId, publicRpcUrlsForNetwork, type KoinosNetworkId } from './network-profiles'
import type {
  TelenoEncryptedSecret,
  TelenoEncryptedWallet,
  TelenoEncryptedWalletAccount,
  TelenoProducerProfile,
  TelenoUnlockedWallet,
  TelenoUnlockedWalletAccount,
  TelenoWalletAccountKind,
  TelenoWalletAccountSummary
} from './main-types'
import { sanitizePublicRpcUrls } from './node-paths'
import { deriveWalletAccountFromPath, parseWalletDerivationIndex, walletDerivationPath } from './wallet-accounts'

type PublicRpcConfigInput = {
  network?: KoinosNetworkId
  publicRpcUrls?: string[]
  publicRpcUrlsByNetwork?: Partial<Record<KoinosNetworkId, string[]>>
}

type PublicRpcConfigResult = {
  ok: boolean
  output: string
  network?: KoinosNetworkId
  publicRpcUrls: string[]
  publicRpcUrlsByNetwork?: Partial<Record<KoinosNetworkId, string[]>>
}

type WalletAccountSecrets = {
  walletAddress: string | null
  accountId: string | null
  accountName: string | null
  accountKind: TelenoWalletAccountKind | null
  accountAddress: string | null
  privateKeyWif: string | null
  derivationPath: string | null
  seedPhrase: string | null
}

type PublicRpcUrlsByNetwork = Record<KoinosNetworkId, string[]>

const PUBLIC_RPC_NETWORKS: KoinosNetworkId[] = ['mainnet', 'testnet', 'custom']

function defaultPublicRpcUrlsByNetwork(): PublicRpcUrlsByNetwork {
  return {
    mainnet: publicRpcUrlsForNetwork('mainnet'),
    testnet: publicRpcUrlsForNetwork('testnet'),
    custom: publicRpcUrlsForNetwork('custom')
  }
}

function sanitizePublicRpcUrlsForNetwork(value: unknown, network: KoinosNetworkId): string[] {
  return sanitizePublicRpcUrls(value, publicRpcUrlsForNetwork(network))
}

function inferLegacyPublicRpcNetwork(publicRpcUrls: string[]): KoinosNetworkId {
  const hasTestnetUrl = publicRpcUrls.some((url) => /testnet/i.test(url))
  const hasMainnetUrl = publicRpcUrls.some((url) => /api\.koinos\.io|api\.koinosblocks\.com/i.test(url))
  return hasTestnetUrl && !hasMainnetUrl ? 'testnet' : 'mainnet'
}

function normalizePublicRpcConfig(input?: PublicRpcConfigInput): {
  network: KoinosNetworkId
  publicRpcUrls: string[]
  publicRpcUrlsByNetwork: PublicRpcUrlsByNetwork
} {
  const network = normalizeKoinosNetworkId(input?.network)
  const publicRpcUrlsByNetwork = defaultPublicRpcUrlsByNetwork()
  const rawByNetwork = input?.publicRpcUrlsByNetwork

  if (rawByNetwork && typeof rawByNetwork === 'object') {
    for (const networkId of PUBLIC_RPC_NETWORKS) {
      if (Object.prototype.hasOwnProperty.call(rawByNetwork, networkId)) {
        publicRpcUrlsByNetwork[networkId] = sanitizePublicRpcUrlsForNetwork(rawByNetwork[networkId], networkId)
      }
    }
  }

  if (Array.isArray(input?.publicRpcUrls)) {
    const legacyPublicRpcUrls = sanitizePublicRpcUrls(input.publicRpcUrls, publicRpcUrlsForNetwork(network))
    const targetNetwork = rawByNetwork && typeof rawByNetwork === 'object' ? network : inferLegacyPublicRpcNetwork(legacyPublicRpcUrls)
    publicRpcUrlsByNetwork[targetNetwork] = legacyPublicRpcUrls
  }

  return {
    network,
    publicRpcUrls: publicRpcUrlsByNetwork[network],
    publicRpcUrlsByNetwork
  }
}

function secureStoragePath(userDataPath: string, ...parts: string[]): string {
  return path.join(userDataPath, TELENO_SECURE_STORAGE_DIR, ...parts)
}

function configPath(userDataPath: string, ...parts: string[]): string {
  return path.join(userDataPath, TELENO_CONFIG_DIR, ...parts)
}

function ensureDir(dirPath: string, mode?: number): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode })
  }
}

function decryptTelenoWalletSecret(secret: TelenoEncryptedSecret, password: string): string {
  const salt = Buffer.from(secret.salt, 'hex')
  const iv = Buffer.from(secret.iv, 'hex')
  const authTag = Buffer.from(secret.authTag, 'hex')
  const key = pbkdf2Sync(password, salt, TELENO_PBKDF2_ITERATIONS, TELENO_KEY_LENGTH, 'sha256')
  const decipher = createDecipheriv(TELENO_ENCRYPTION_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(secret.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function encryptTelenoWalletSecret(value: string, password: string): TelenoEncryptedSecret {
  const salt = randomBytes(32)
  const iv = randomBytes(16)
  const key = pbkdf2Sync(password, salt, TELENO_PBKDF2_ITERATIONS, TELENO_KEY_LENGTH, 'sha256')
  const cipher = createCipheriv(TELENO_ENCRYPTION_ALGORITHM, key, iv)
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

function accountSummary(account: TelenoEncryptedWalletAccount, activeAccountId: string | null): TelenoWalletAccountSummary {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    address: account.address,
    derivationPath: account.derivationPath?.trim() || null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt || null,
    hasPrivateKey: account.kind !== 'watch-only',
    isActive: activeAccountId === account.id
  }
}

function sanitizeAccountName(name: string | undefined, fallback: string): string {
  const trimmed = `${name || ''}`.trim()
  return trimmed || fallback
}

function createWalletAccountId(kind: TelenoWalletAccountKind): string {
  return `acc_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function nextDefaultAccountName(accounts: TelenoEncryptedWalletAccount[], kind: TelenoWalletAccountKind): string {
  if (kind === 'derived') {
    const maxIndex = accounts
      .filter((account) => account.kind === 'derived')
      .reduce((max, account) => Math.max(max, parseWalletDerivationIndex(account.derivationPath) ?? -1), -1)
    return `Account ${maxIndex + 2}`
  }

  if (kind === 'watch-only') {
    const count = accounts.filter((account) => account.kind === 'watch-only').length + 1
    return `Watch Account ${count}`
  }

  const count = accounts.filter((account) => account.kind === 'imported-wif').length + 1
  return `Imported Account ${count}`
}

function sanitizeWalletAccount(value: unknown): TelenoEncryptedWalletAccount | null {
  const parsed = value as Partial<TelenoEncryptedWalletAccount> | null
  const id = `${parsed?.id || ''}`.trim()
  const name = `${parsed?.name || ''}`.trim()
  const kind = `${parsed?.kind || ''}`.trim() as TelenoWalletAccountKind
  const address = `${parsed?.address || ''}`.trim()
  if (!id || !name || !address || !['derived', 'imported-wif', 'watch-only'].includes(kind)) {
    return null
  }

  const createdAt = typeof parsed?.createdAt === 'string' && parsed.createdAt ? parsed.createdAt : new Date().toISOString()
  const updatedAt = typeof parsed?.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : createdAt
  const derivationPath =
    typeof parsed?.derivationPath === 'string' && parsed.derivationPath.trim() ? parsed.derivationPath.trim() : null
  const encryptedKey =
    parsed?.encryptedKey && typeof parsed.encryptedKey === 'object'
      ? (parsed.encryptedKey as TelenoEncryptedSecret)
      : null

  return {
    id,
    name,
    kind,
    address,
    createdAt,
    updatedAt,
    derivationPath,
    encryptedKey
  }
}

function normalizeWalletFilePayload(parsed: unknown): TelenoEncryptedWallet | null {
  const legacy = parsed as Partial<TelenoEncryptedWallet> | null
  const nowIso = new Date().toISOString()

  const accounts = Array.isArray(legacy?.accounts)
    ? legacy.accounts.map((account) => sanitizeWalletAccount(account)).filter((account): account is TelenoEncryptedWalletAccount => Boolean(account))
    : []

  if (accounts.length > 0) {
    const activeAccountId = `${legacy?.activeAccountId || ''}`.trim() || accounts[0].id
    const activeAccount = accounts.find((account) => account.id === activeAccountId) || accounts[0]

    return {
      version: 2,
      address: activeAccount.address,
      encryptedKey: activeAccount.encryptedKey ?? null,
      encryptedSeedPhrase:
        legacy?.encryptedSeedPhrase && typeof legacy.encryptedSeedPhrase === 'object'
          ? (legacy.encryptedSeedPhrase as TelenoEncryptedSecret)
          : null,
      seedDerivationPath: activeAccount.derivationPath ?? null,
      activeAccountId: activeAccount.id,
      accounts,
      createdAt: typeof legacy?.createdAt === 'string' && legacy.createdAt ? legacy.createdAt : nowIso,
      updatedAt: typeof legacy?.updatedAt === 'string' && legacy.updatedAt ? legacy.updatedAt : nowIso
    }
  }

  const address = `${legacy?.address || ''}`.trim()
  const encryptedKey =
    legacy?.encryptedKey && typeof legacy.encryptedKey === 'object'
      ? (legacy.encryptedKey as TelenoEncryptedSecret)
      : null

  if (!address || !encryptedKey) return null

  const hasSeedPhrase = Boolean(legacy?.encryptedSeedPhrase)
  const derivationPath =
    typeof legacy?.seedDerivationPath === 'string' && legacy.seedDerivationPath.trim()
      ? legacy.seedDerivationPath.trim()
      : hasSeedPhrase
        ? walletDerivationPath(0)
        : null
  const createdAt = typeof legacy?.createdAt === 'string' && legacy.createdAt ? legacy.createdAt : nowIso
  const legacyAccount: TelenoEncryptedWalletAccount = {
    id: createWalletAccountId(hasSeedPhrase ? 'derived' : 'imported-wif'),
    name: hasSeedPhrase ? 'Account 1' : 'Imported Account 1',
    kind: hasSeedPhrase ? 'derived' : 'imported-wif',
    address,
    createdAt,
    updatedAt: createdAt,
    derivationPath,
    encryptedKey
  }

  return {
    version: 2,
    address,
    encryptedKey,
    encryptedSeedPhrase:
      legacy?.encryptedSeedPhrase && typeof legacy.encryptedSeedPhrase === 'object'
        ? (legacy.encryptedSeedPhrase as TelenoEncryptedSecret)
        : null,
    seedDerivationPath: derivationPath,
    activeAccountId: legacyAccount.id,
    accounts: [legacyAccount],
    createdAt,
    updatedAt: typeof legacy?.updatedAt === 'string' && legacy.updatedAt ? legacy.updatedAt : createdAt
  }
}

function findWalletAccount(wallet: TelenoEncryptedWallet | null, accountId?: string | null): TelenoEncryptedWalletAccount | null {
  if (!wallet?.accounts?.length) return null
  const requestedId = `${accountId || ''}`.trim()
  if (requestedId) {
    const exact = wallet.accounts.find((account) => account.id === requestedId)
    if (exact) return exact
  }
  const activeId = `${wallet.activeAccountId || ''}`.trim()
  return wallet.accounts.find((account) => account.id === activeId) || wallet.accounts[0] || null
}

function syncWalletCompatibilityFields(wallet: TelenoEncryptedWallet): TelenoEncryptedWallet {
  const activeAccount = findWalletAccount(wallet, wallet.activeAccountId)
  const nextUpdatedAt = new Date().toISOString()
  return {
    ...wallet,
    version: 2,
    address: activeAccount?.address || wallet.address,
    encryptedKey: activeAccount?.encryptedKey ?? null,
    seedDerivationPath: activeAccount?.derivationPath ?? null,
    activeAccountId: activeAccount?.id || null,
    createdAt: wallet.createdAt || nextUpdatedAt,
    updatedAt: nextUpdatedAt,
    accounts: [...(wallet.accounts || [])]
  }
}

function unlockedWalletFromFile(wallet: TelenoEncryptedWallet, password: string): TelenoUnlockedWallet {
  const seedPhrase = wallet.encryptedSeedPhrase ? decryptTelenoWalletSecret(wallet.encryptedSeedPhrase, password) : null
  const accounts: TelenoUnlockedWalletAccount[] = (wallet.accounts || []).map((account) => {
    let privateKey: string | null = null

    if (account.kind !== 'watch-only') {
      if (account.encryptedKey) {
        privateKey = decryptTelenoWalletSecret(account.encryptedKey, password)
      } else if (seedPhrase && account.derivationPath) {
        privateKey = deriveWalletAccountFromPath(seedPhrase, account.derivationPath).privateKeyWif
      }
    }

    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      address: account.address,
      derivationPath: account.derivationPath ?? null,
      privateKey,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt || null
    }
  })

  const activeAccount =
    accounts.find((account) => account.id === wallet.activeAccountId) ||
    accounts.find((account) => account.address === wallet.address) ||
    accounts[0] ||
    null

  return {
    address: activeAccount?.address || wallet.address,
    privateKey: activeAccount?.privateKey ?? null,
    seedPhrase,
    seedDerivationPath: activeAccount?.derivationPath ?? wallet.seedDerivationPath ?? null,
    activeAccountId: activeAccount?.id || null,
    accountName: activeAccount?.name || null,
    accountKind: activeAccount?.kind || null,
    accounts
  }
}

export function createTelenoStorage(userDataPath: string) {
  let unlockedWallet: TelenoUnlockedWallet | null = null
  let unlockedWalletNetwork: KoinosNetworkId | null = null

  const scopedSecureStoragePath = (network?: KoinosNetworkId) => {
    if (!network) return secureStoragePath(userDataPath)
    return secureStoragePath(userDataPath, normalizeKoinosNetworkId(network))
  }

  const producerWalletFilePath = (network?: KoinosNetworkId) =>
    path.join(scopedSecureStoragePath(network), TELENO_PRODUCER_WALLET_FILE)
  const producerProfileFilePath = (network?: KoinosNetworkId) =>
    path.join(scopedSecureStoragePath(network), TELENO_PRODUCER_PROFILE_FILE)
  const publicRpcsFilePath = () => configPath(userDataPath, TELENO_PUBLIC_RPCS_FILE)

  const ensureSecureStorageDir = (network?: KoinosNetworkId) => ensureDir(scopedSecureStoragePath(network), 0o700)
  const ensureConfigDir = () => ensureDir(configPath(userDataPath))

  const requestedWalletNetwork = (network?: KoinosNetworkId): KoinosNetworkId | null =>
    network ? normalizeKoinosNetworkId(network) : null

  const getUnlockedWalletForNetwork = (network?: KoinosNetworkId): TelenoUnlockedWallet | null => {
    const requestedNetwork = requestedWalletNetwork(network)
    if (!requestedNetwork) return unlockedWallet
    if (unlockedWalletNetwork !== requestedNetwork) return null
    return unlockedWallet
  }

  const writeWalletFile = (wallet: TelenoEncryptedWallet, network?: KoinosNetworkId): string => {
    ensureSecureStorageDir(network)
    const normalized = syncWalletCompatibilityFields(wallet)
    const filePath = producerWalletFilePath(network)
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`

    try {
      fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 })
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

  const loadPublicRpcConfig = (): PublicRpcConfigResult => {
    const filePath = publicRpcsFilePath()
    if (!fs.existsSync(filePath)) {
      const defaults = normalizePublicRpcConfig()
      return {
        ok: true,
        output: `Using default public RPC list (${DEFAULT_PUBLIC_RPC_URLS.length} entries)`,
        network: defaults.network,
        publicRpcUrls: defaults.publicRpcUrls,
        publicRpcUrlsByNetwork: defaults.publicRpcUrlsByNetwork
      }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as PublicRpcConfigInput
      const normalized = normalizePublicRpcConfig(parsed)
      return {
        ok: true,
        output: `Loaded ${normalized.publicRpcUrls.length} public RPC URLs from ${filePath}`,
        network: normalized.network,
        publicRpcUrls: normalized.publicRpcUrls,
        publicRpcUrlsByNetwork: normalized.publicRpcUrlsByNetwork
      }
    } catch (error) {
      const defaults = normalizePublicRpcConfig()
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not read public RPC config',
        network: defaults.network,
        publicRpcUrls: defaults.publicRpcUrls,
        publicRpcUrlsByNetwork: defaults.publicRpcUrlsByNetwork
      }
    }
  }

  const savePublicRpcConfig = (input?: PublicRpcConfigInput): PublicRpcConfigResult => {
    try {
      ensureConfigDir()
      const filePath = publicRpcsFilePath()
      const existing = fs.existsSync(filePath) ? loadPublicRpcConfig() : normalizePublicRpcConfig()
      const publicRpcUrlsByNetwork = {
        ...defaultPublicRpcUrlsByNetwork(),
        ...normalizePublicRpcConfig(existing).publicRpcUrlsByNetwork
      }
      const network = normalizeKoinosNetworkId(input?.network ?? existing.network)

      if (input?.publicRpcUrlsByNetwork && typeof input.publicRpcUrlsByNetwork === 'object') {
        for (const networkId of PUBLIC_RPC_NETWORKS) {
          if (Object.prototype.hasOwnProperty.call(input.publicRpcUrlsByNetwork, networkId)) {
            publicRpcUrlsByNetwork[networkId] = sanitizePublicRpcUrlsForNetwork(
              input.publicRpcUrlsByNetwork[networkId],
              networkId
            )
          }
        }
      }

      if (Array.isArray(input?.publicRpcUrls)) {
        publicRpcUrlsByNetwork[network] = sanitizePublicRpcUrlsForNetwork(input.publicRpcUrls, network)
      }

      const publicRpcUrls = publicRpcUrlsByNetwork[network]
      fs.writeFileSync(filePath, JSON.stringify({ network, publicRpcUrls, publicRpcUrlsByNetwork }, null, 2))
      return {
        ok: true,
        output: `Saved ${publicRpcUrls.length} public RPC URLs to ${filePath}`,
        network,
        publicRpcUrls,
        publicRpcUrlsByNetwork
      }
    } catch (error) {
      const defaults = normalizePublicRpcConfig()
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not save public RPC config',
        network: defaults.network,
        publicRpcUrls: defaults.publicRpcUrls,
        publicRpcUrlsByNetwork: defaults.publicRpcUrlsByNetwork
      }
    }
  }

  const loadWalletFile = (network?: KoinosNetworkId): TelenoEncryptedWallet | null => {
    const walletFilePath = producerWalletFilePath(network)
    if (!fs.existsSync(walletFilePath)) return null

    try {
      const raw = fs.readFileSync(walletFilePath, 'utf8')
      const parsed = JSON.parse(raw)
      const normalized = normalizeWalletFilePayload(parsed)
      if (!normalized) return null

      if (normalized.version !== 2 || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        writeWalletFile(normalized, network)
      }

      return normalized
    } catch {
      return null
    }
  }

  const loadProducerProfile = (network?: KoinosNetworkId): TelenoProducerProfile | null => {
    const requestedNetwork = requestedWalletNetwork(network)
    const profileFilePath = producerProfileFilePath(network)
    if (!fs.existsSync(profileFilePath)) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(profileFilePath, 'utf8')) as Partial<TelenoProducerProfile>
      const profileNetwork = normalizeKoinosNetworkId(parsed?.network)
      if (requestedNetwork && profileNetwork !== requestedNetwork) return null
      const producerAddress = `${parsed?.producerAddress || ''}`.trim()
      const registrationSignerAccountId = `${parsed?.registrationSignerAccountId || ''}`.trim()
      const burnAccountId = `${parsed?.burnAccountId || ''}`.trim()
      const localPublicKey = `${parsed?.localPublicKey || ''}`.trim()
      const localPublicKeyPath = `${parsed?.localPublicKeyPath || ''}`.trim()
      if (!producerAddress || !registrationSignerAccountId || !burnAccountId || !localPublicKey || !localPublicKeyPath) {
        return null
      }
      return {
        network: requestedNetwork ?? profileNetwork,
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

  const saveProducerProfile = (profile: TelenoProducerProfile, network?: KoinosNetworkId): string => {
    const requestedNetwork = requestedWalletNetwork(network) ?? normalizeKoinosNetworkId(profile.network)
    ensureSecureStorageDir(requestedNetwork)
    const filePath = producerProfileFilePath(requestedNetwork)
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(tempPath, JSON.stringify({ ...profile, network: requestedNetwork }, null, 2), { mode: 0o600 })
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

  const clearProducerProfile = (network?: KoinosNetworkId): boolean => {
    const profileFilePath = producerProfileFilePath(network)
    if (!fs.existsSync(profileFilePath)) return false
    fs.unlinkSync(profileFilePath)
    return true
  }

  const loadWallet = (password: string, network?: KoinosNetworkId): TelenoUnlockedWallet | null => {
    const wallet = loadWalletFile(network)
    if (!wallet) return null
    return unlockedWalletFromFile(wallet, password)
  }

  const unlockWalletSession = (password: string, network?: KoinosNetworkId): TelenoUnlockedWallet | null => {
    const requestedNetwork = requestedWalletNetwork(network)
    const wallet = loadWallet(password, requestedNetwork ?? undefined)
    if (!wallet) return null
    unlockedWallet = wallet
    unlockedWalletNetwork = requestedNetwork
    return wallet
  }

  const saveWallet = (
    privateKey: string,
    address: string,
    password: string,
    options?: {
      seedPhrase?: string
      derivationPath?: string
      network?: KoinosNetworkId
    }
  ): string => {
    const requestedNetwork = requestedWalletNetwork(options?.network)
    const seedPhrase = `${options?.seedPhrase || ''}`.trim()
    const derivationPath = `${options?.derivationPath || ''}`.trim()
    const createdAt = new Date().toISOString()
    const firstAccount: TelenoEncryptedWalletAccount = {
      id: createWalletAccountId(seedPhrase ? 'derived' : 'imported-wif'),
      name: seedPhrase ? 'Account 1' : 'Imported Account 1',
      kind: seedPhrase ? 'derived' : 'imported-wif',
      address,
      createdAt,
      updatedAt: createdAt,
      derivationPath: derivationPath || (seedPhrase ? walletDerivationPath(0) : null),
      encryptedKey: encryptTelenoWalletSecret(privateKey, password)
    }
    const payload: TelenoEncryptedWallet = {
      version: 2,
      address,
      encryptedKey: firstAccount.encryptedKey,
      encryptedSeedPhrase: seedPhrase ? encryptTelenoWalletSecret(seedPhrase, password) : null,
      seedDerivationPath: firstAccount.derivationPath ?? null,
      activeAccountId: firstAccount.id,
      accounts: [firstAccount],
      createdAt,
      updatedAt: createdAt
    }
    const walletFilePath = writeWalletFile(payload, requestedNetwork ?? undefined)
    unlockedWallet = unlockedWalletFromFile(payload, password)
    unlockedWalletNetwork = requestedNetwork
    return walletFilePath
  }

  const deleteWallet = (network?: KoinosNetworkId): boolean => {
    const requestedNetwork = requestedWalletNetwork(network)
    const walletFilePath = producerWalletFilePath(requestedNetwork ?? undefined)
    if (!fs.existsSync(walletFilePath)) return false
    fs.unlinkSync(walletFilePath)
    try {
      clearProducerProfile(requestedNetwork ?? undefined)
    } catch {
      // best effort
    }
    if (!requestedNetwork || unlockedWalletNetwork === requestedNetwork) {
      unlockedWallet = null
      unlockedWalletNetwork = null
    }
    return true
  }

  const closeWalletSession = (network?: KoinosNetworkId): string | null => {
    const requestedNetwork = requestedWalletNetwork(network)
    const scopedUnlockedWallet = getUnlockedWalletForNetwork(requestedNetwork ?? undefined)
    const walletAddress = scopedUnlockedWallet?.address || loadWalletFile(requestedNetwork ?? undefined)?.address || null
    if (!requestedNetwork || unlockedWalletNetwork === requestedNetwork) {
      unlockedWallet = null
      unlockedWalletNetwork = null
    }
    return walletAddress
  }

  const listWalletAccounts = (network?: KoinosNetworkId): TelenoWalletAccountSummary[] => {
    const wallet = loadWalletFile(network)
    return (wallet?.accounts || []).map((account) => accountSummary(account, wallet?.activeAccountId || null))
  }

  const resolveWalletQueryAddress = (address?: string, accountId?: string, network?: KoinosNetworkId): string | null => {
    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    const explicit = `${address || ''}`.trim()
    if (explicit) return explicit
    const unlockedRequested = scopedUnlockedWallet?.accounts.find((account) => account.id === `${accountId || ''}`.trim())
    if (unlockedRequested?.address) return unlockedRequested.address
    if (accountId) {
      const storedRequested = findWalletAccount(loadWalletFile(network), accountId)
      if (storedRequested?.address) return storedRequested.address
    }
    if (scopedUnlockedWallet?.address) return scopedUnlockedWallet.address
    const storedWallet = loadWalletFile(network)
    return findWalletAccount(storedWallet, storedWallet?.activeAccountId)?.address || storedWallet?.address?.trim() || null
  }

  const setActiveWalletAccount = (accountId: string, network?: KoinosNetworkId): TelenoWalletAccountSummary | null => {
    const wallet = loadWalletFile(network)
    const account = findWalletAccount(wallet, accountId)
    if (!wallet || !account) return null
    wallet.activeAccountId = account.id
    writeWalletFile(wallet, network)
    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWallet) {
      const unlockedAccount =
        scopedUnlockedWallet.accounts.find((entry) => entry.id === account.id) ||
        scopedUnlockedWallet.accounts[0] ||
        null
      unlockedWallet = {
        ...scopedUnlockedWallet,
        address: unlockedAccount?.address || wallet.address,
        privateKey: unlockedAccount?.privateKey ?? null,
        seedDerivationPath: unlockedAccount?.derivationPath ?? null,
        activeAccountId: unlockedAccount?.id || null,
        accountName: unlockedAccount?.name || null,
        accountKind: unlockedAccount?.kind || null
      }
    }
    return accountSummary(account, account.id)
  }

  const createDerivedWalletAccount = (name?: string, network?: KoinosNetworkId): TelenoWalletAccountSummary | null => {
    const wallet = loadWalletFile(network)
    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (!wallet?.accounts?.length || !wallet.encryptedSeedPhrase || !scopedUnlockedWallet?.seedPhrase) return null

    const nextDerivationIndex =
      wallet.accounts
        .filter((account) => account.kind === 'derived')
        .reduce((max, account) => Math.max(max, parseWalletDerivationIndex(account.derivationPath) ?? -1), -1) + 1
    const derivationPath = walletDerivationPath(nextDerivationIndex)
    const derived = deriveWalletAccountFromPath(scopedUnlockedWallet.seedPhrase, derivationPath)
    if (wallet.accounts.some((account) => account.address.toLowerCase() === derived.address.toLowerCase())) {
      return null
    }

    const createdAt = new Date().toISOString()
    const account: TelenoEncryptedWalletAccount = {
      id: createWalletAccountId('derived'),
      name: sanitizeAccountName(name, nextDefaultAccountName(wallet.accounts, 'derived')),
      kind: 'derived',
      address: derived.address,
      createdAt,
      updatedAt: createdAt,
      derivationPath,
      encryptedKey: null
    }

    wallet.accounts.push(account)
    wallet.activeAccountId = account.id
    writeWalletFile(wallet, network)

    const scopedUnlockedWalletAfterWrite = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWalletAfterWrite) {
      scopedUnlockedWalletAfterWrite.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: account.derivationPath ?? null,
        privateKey: derived.privateKeyWif,
        createdAt,
        updatedAt: createdAt
      })
      scopedUnlockedWalletAfterWrite.address = account.address
      scopedUnlockedWalletAfterWrite.privateKey = derived.privateKeyWif
      scopedUnlockedWalletAfterWrite.seedDerivationPath = account.derivationPath ?? null
      scopedUnlockedWalletAfterWrite.activeAccountId = account.id
      scopedUnlockedWalletAfterWrite.accountName = account.name
      scopedUnlockedWalletAfterWrite.accountKind = account.kind
    }

    return accountSummary(account, wallet.activeAccountId || null)
  }

  const importWalletAccount = (
    privateKey: string,
    password: string,
    name?: string,
    network?: KoinosNetworkId
  ): TelenoWalletAccountSummary | null => {
    const signer = Signer.fromWif(privateKey)
    const address = signer.getAddress()
    const existingWallet = loadWalletFile(network)
    if (!existingWallet) {
      saveWallet(privateKey, address, password, { network })
      return listWalletAccounts(network)[0] || null
    }

    const existingAccounts = existingWallet.accounts || []
    const existingIndex = existingAccounts.findIndex((account) => account.address.toLowerCase() === address.toLowerCase())
    if (existingIndex >= 0) {
      const existingAccount = existingAccounts[existingIndex]
      if (existingAccount.kind !== 'watch-only') return null

      const updatedAt = new Date().toISOString()
      const upgradedAccount: TelenoEncryptedWalletAccount = {
        ...existingAccount,
        name: sanitizeAccountName(name, existingAccount.name),
        kind: 'imported-wif',
        updatedAt,
        derivationPath: null,
        encryptedKey: encryptTelenoWalletSecret(privateKey, password)
      }

      existingWallet.accounts = [...existingAccounts]
      existingWallet.accounts[existingIndex] = upgradedAccount
      existingWallet.activeAccountId = upgradedAccount.id
      writeWalletFile(existingWallet, network)

      const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
      if (scopedUnlockedWallet) {
        const unlockedAccount: TelenoUnlockedWalletAccount = {
          id: upgradedAccount.id,
          name: upgradedAccount.name,
          kind: upgradedAccount.kind,
          address: upgradedAccount.address,
          derivationPath: null,
          privateKey,
          createdAt: upgradedAccount.createdAt,
          updatedAt
        }
        const unlockedIndex = scopedUnlockedWallet.accounts.findIndex(
          (account) => account.id === upgradedAccount.id || account.address.toLowerCase() === address.toLowerCase()
        )
        if (unlockedIndex >= 0) {
          scopedUnlockedWallet.accounts[unlockedIndex] = unlockedAccount
        } else {
          scopedUnlockedWallet.accounts.push(unlockedAccount)
        }
        scopedUnlockedWallet.address = upgradedAccount.address
        scopedUnlockedWallet.privateKey = privateKey
        scopedUnlockedWallet.seedDerivationPath = null
        scopedUnlockedWallet.activeAccountId = upgradedAccount.id
        scopedUnlockedWallet.accountName = upgradedAccount.name
        scopedUnlockedWallet.accountKind = upgradedAccount.kind
      }

      return accountSummary(upgradedAccount, existingWallet.activeAccountId || null)
    }

    const createdAt = new Date().toISOString()
    const account: TelenoEncryptedWalletAccount = {
      id: createWalletAccountId('imported-wif'),
      name: sanitizeAccountName(name, nextDefaultAccountName(existingWallet.accounts || [], 'imported-wif')),
      kind: 'imported-wif',
      address,
      createdAt,
      updatedAt: createdAt,
      derivationPath: null,
      encryptedKey: encryptTelenoWalletSecret(privateKey, password)
    }

    existingWallet.accounts = [...(existingWallet.accounts || []), account]
    existingWallet.activeAccountId = account.id
    writeWalletFile(existingWallet, network)

    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWallet) {
      scopedUnlockedWallet.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: null,
        privateKey,
        createdAt,
        updatedAt: createdAt
      })
      scopedUnlockedWallet.address = account.address
      scopedUnlockedWallet.privateKey = privateKey
      scopedUnlockedWallet.seedDerivationPath = null
      scopedUnlockedWallet.activeAccountId = account.id
      scopedUnlockedWallet.accountName = account.name
      scopedUnlockedWallet.accountKind = account.kind
    }

    return accountSummary(account, existingWallet.activeAccountId || null)
  }

  const importWatchWalletAccount = (
    address: string,
    name?: string,
    network?: KoinosNetworkId
  ): TelenoWalletAccountSummary | null => {
    const trimmedAddress = address.trim()
    if (!trimmedAddress) return null

    const existingWallet = loadWalletFile(network)
    if (!existingWallet) return null
    if (existingWallet.accounts?.some((account) => account.address.toLowerCase() === trimmedAddress.toLowerCase())) {
      return null
    }

    const createdAt = new Date().toISOString()
    const account: TelenoEncryptedWalletAccount = {
      id: createWalletAccountId('watch-only'),
      name: sanitizeAccountName(name, nextDefaultAccountName(existingWallet.accounts || [], 'watch-only')),
      kind: 'watch-only',
      address: trimmedAddress,
      createdAt,
      updatedAt: createdAt,
      derivationPath: null,
      encryptedKey: null
    }

    existingWallet.accounts = [...(existingWallet.accounts || []), account]
    existingWallet.activeAccountId = account.id
    writeWalletFile(existingWallet, network)

    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWallet) {
      scopedUnlockedWallet.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: null,
        privateKey: null,
        createdAt,
        updatedAt: createdAt
      })
      scopedUnlockedWallet.address = account.address
      scopedUnlockedWallet.privateKey = null
      scopedUnlockedWallet.seedDerivationPath = null
      scopedUnlockedWallet.activeAccountId = account.id
      scopedUnlockedWallet.accountName = account.name
      scopedUnlockedWallet.accountKind = account.kind
    }

    return accountSummary(account, existingWallet.activeAccountId || null)
  }

  const renameWalletAccount = (
    accountId: string,
    name: string,
    network?: KoinosNetworkId
  ): TelenoWalletAccountSummary | null => {
    const wallet = loadWalletFile(network)
    const account = findWalletAccount(wallet, accountId)
    const trimmedName = name.trim()
    if (!wallet || !account || !trimmedName) return null
    account.name = trimmedName
    account.updatedAt = new Date().toISOString()
    writeWalletFile(wallet, network)

    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWallet) {
      const unlockedAccount = scopedUnlockedWallet.accounts.find((entry) => entry.id === account.id)
      if (unlockedAccount) unlockedAccount.name = trimmedName
      if (scopedUnlockedWallet.activeAccountId === account.id) scopedUnlockedWallet.accountName = trimmedName
    }

    return accountSummary(account, wallet.activeAccountId || null)
  }

  const removeWalletAccount = (accountId: string, network?: KoinosNetworkId): TelenoWalletAccountSummary[] | null => {
    const wallet = loadWalletFile(network)
    if (!wallet?.accounts?.length || wallet.accounts.length <= 1) return null
    const nextAccounts = wallet.accounts.filter((account) => account.id !== accountId)
    if (nextAccounts.length === wallet.accounts.length) return null

    wallet.accounts = nextAccounts
    if (!nextAccounts.some((account) => account.id === wallet.activeAccountId)) {
      wallet.activeAccountId = nextAccounts[0]?.id || null
    }
    writeWalletFile(wallet, network)

    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    if (scopedUnlockedWallet) {
      scopedUnlockedWallet.accounts = scopedUnlockedWallet.accounts.filter((account) => account.id !== accountId)
      const activeUnlocked =
        scopedUnlockedWallet.accounts.find((account) => account.id === wallet.activeAccountId) || scopedUnlockedWallet.accounts[0] || null
      scopedUnlockedWallet.address = activeUnlocked?.address || wallet.address
      scopedUnlockedWallet.privateKey = activeUnlocked?.privateKey ?? null
      scopedUnlockedWallet.seedDerivationPath = activeUnlocked?.derivationPath ?? null
      scopedUnlockedWallet.activeAccountId = activeUnlocked?.id || null
      scopedUnlockedWallet.accountName = activeUnlocked?.name || null
      scopedUnlockedWallet.accountKind = activeUnlocked?.kind || null
    }

    return wallet.accounts.map((account) => accountSummary(account, wallet.activeAccountId || null))
  }

  const loadWalletAccountSecrets = (accountId?: string, network?: KoinosNetworkId): WalletAccountSecrets => {
    const wallet = loadWalletFile(network)
    const scopedUnlockedWallet = getUnlockedWalletForNetwork(network)
    const unlockedActiveAccountId = scopedUnlockedWallet?.activeAccountId || null
    const unlockedAccount =
      scopedUnlockedWallet?.accounts.find((account) => account.id === `${accountId || ''}`.trim()) ||
      scopedUnlockedWallet?.accounts.find((account) => account.id === unlockedActiveAccountId) ||
      scopedUnlockedWallet?.accounts[0] ||
      null

    return {
      walletAddress: wallet?.address || scopedUnlockedWallet?.address || null,
      accountId: unlockedAccount?.id || null,
      accountName: unlockedAccount?.name || null,
      accountKind: unlockedAccount?.kind || null,
      accountAddress: unlockedAccount?.address || null,
      privateKeyWif: unlockedAccount?.privateKey ?? null,
      derivationPath: unlockedAccount?.derivationPath ?? null,
      seedPhrase: scopedUnlockedWallet?.seedPhrase || null
    }
  }

  const getUnlockedWallet = (network?: KoinosNetworkId) => getUnlockedWalletForNetwork(network)

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
    listWalletAccounts,
    setActiveWalletAccount,
    createDerivedWalletAccount,
    importWalletAccount,
    importWatchWalletAccount,
    renameWalletAccount,
    removeWalletAccount,
    loadWalletAccountSecrets,
    resolveWalletQueryAddress
  }
}
