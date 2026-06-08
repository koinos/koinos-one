import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Signer } from 'koilib'

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
import { normalizeKoinosNetworkId, publicRpcUrlsForNetwork, type KoinosNetworkId } from './network-profiles'
import type {
  KnodelEncryptedSecret,
  KnodelEncryptedWallet,
  KnodelEncryptedWalletAccount,
  KnodelProducerProfile,
  KnodelUnlockedWallet,
  KnodelUnlockedWalletAccount,
  KnodelWalletAccountKind,
  KnodelWalletAccountSummary
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
  accountKind: KnodelWalletAccountKind | null
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

function accountSummary(account: KnodelEncryptedWalletAccount, activeAccountId: string | null): KnodelWalletAccountSummary {
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

function createWalletAccountId(kind: KnodelWalletAccountKind): string {
  return `acc_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function nextDefaultAccountName(accounts: KnodelEncryptedWalletAccount[], kind: KnodelWalletAccountKind): string {
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

function sanitizeWalletAccount(value: unknown): KnodelEncryptedWalletAccount | null {
  const parsed = value as Partial<KnodelEncryptedWalletAccount> | null
  const id = `${parsed?.id || ''}`.trim()
  const name = `${parsed?.name || ''}`.trim()
  const kind = `${parsed?.kind || ''}`.trim() as KnodelWalletAccountKind
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
      ? (parsed.encryptedKey as KnodelEncryptedSecret)
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

function normalizeWalletFilePayload(parsed: unknown): KnodelEncryptedWallet | null {
  const legacy = parsed as Partial<KnodelEncryptedWallet> | null
  const nowIso = new Date().toISOString()

  const accounts = Array.isArray(legacy?.accounts)
    ? legacy.accounts.map((account) => sanitizeWalletAccount(account)).filter((account): account is KnodelEncryptedWalletAccount => Boolean(account))
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
          ? (legacy.encryptedSeedPhrase as KnodelEncryptedSecret)
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
      ? (legacy.encryptedKey as KnodelEncryptedSecret)
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
  const legacyAccount: KnodelEncryptedWalletAccount = {
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
        ? (legacy.encryptedSeedPhrase as KnodelEncryptedSecret)
        : null,
    seedDerivationPath: derivationPath,
    activeAccountId: legacyAccount.id,
    accounts: [legacyAccount],
    createdAt,
    updatedAt: typeof legacy?.updatedAt === 'string' && legacy.updatedAt ? legacy.updatedAt : createdAt
  }
}

function findWalletAccount(wallet: KnodelEncryptedWallet | null, accountId?: string | null): KnodelEncryptedWalletAccount | null {
  if (!wallet?.accounts?.length) return null
  const requestedId = `${accountId || ''}`.trim()
  if (requestedId) {
    const exact = wallet.accounts.find((account) => account.id === requestedId)
    if (exact) return exact
  }
  const activeId = `${wallet.activeAccountId || ''}`.trim()
  return wallet.accounts.find((account) => account.id === activeId) || wallet.accounts[0] || null
}

function syncWalletCompatibilityFields(wallet: KnodelEncryptedWallet): KnodelEncryptedWallet {
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

function unlockedWalletFromFile(wallet: KnodelEncryptedWallet, password: string): KnodelUnlockedWallet {
  const seedPhrase = wallet.encryptedSeedPhrase ? decryptKnodelWalletSecret(wallet.encryptedSeedPhrase, password) : null
  const accounts: KnodelUnlockedWalletAccount[] = (wallet.accounts || []).map((account) => {
    let privateKey: string | null = null

    if (account.kind !== 'watch-only') {
      if (account.encryptedKey) {
        privateKey = decryptKnodelWalletSecret(account.encryptedKey, password)
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

export function createKnodelStorage(userDataPath: string) {
  let unlockedWallet: KnodelUnlockedWallet | null = null

  const producerWalletFilePath = () => secureStoragePath(userDataPath, KNODEL_PRODUCER_WALLET_FILE)
  const producerProfileFilePath = () => secureStoragePath(userDataPath, KNODEL_PRODUCER_PROFILE_FILE)
  const publicRpcsFilePath = () => configPath(userDataPath, KNODEL_PUBLIC_RPCS_FILE)

  const ensureSecureStorageDir = () => ensureDir(secureStoragePath(userDataPath), 0o700)
  const ensureConfigDir = () => ensureDir(configPath(userDataPath))

  const writeWalletFile = (wallet: KnodelEncryptedWallet): string => {
    ensureSecureStorageDir()
    const normalized = syncWalletCompatibilityFields(wallet)
    const filePath = producerWalletFilePath()
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

  const loadWalletFile = (): KnodelEncryptedWallet | null => {
    const walletFilePath = producerWalletFilePath()
    if (!fs.existsSync(walletFilePath)) return null

    try {
      const raw = fs.readFileSync(walletFilePath, 'utf8')
      const parsed = JSON.parse(raw)
      const normalized = normalizeWalletFilePayload(parsed)
      if (!normalized) return null

      if (normalized.version !== 2 || !Array.isArray((parsed as { accounts?: unknown }).accounts)) {
        writeWalletFile(normalized)
      }

      return normalized
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
    return unlockedWalletFromFile(wallet, password)
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
    const seedPhrase = `${options?.seedPhrase || ''}`.trim()
    const derivationPath = `${options?.derivationPath || ''}`.trim()
    const createdAt = new Date().toISOString()
    const firstAccount: KnodelEncryptedWalletAccount = {
      id: createWalletAccountId(seedPhrase ? 'derived' : 'imported-wif'),
      name: seedPhrase ? 'Account 1' : 'Imported Account 1',
      kind: seedPhrase ? 'derived' : 'imported-wif',
      address,
      createdAt,
      updatedAt: createdAt,
      derivationPath: derivationPath || (seedPhrase ? walletDerivationPath(0) : null),
      encryptedKey: encryptKnodelWalletSecret(privateKey, password)
    }
    const payload: KnodelEncryptedWallet = {
      version: 2,
      address,
      encryptedKey: firstAccount.encryptedKey,
      encryptedSeedPhrase: seedPhrase ? encryptKnodelWalletSecret(seedPhrase, password) : null,
      seedDerivationPath: firstAccount.derivationPath ?? null,
      activeAccountId: firstAccount.id,
      accounts: [firstAccount],
      createdAt,
      updatedAt: createdAt
    }
    const walletFilePath = writeWalletFile(payload)
    unlockedWallet = unlockedWalletFromFile(payload, password)
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

  const listWalletAccounts = (): KnodelWalletAccountSummary[] => {
    const wallet = loadWalletFile()
    return (wallet?.accounts || []).map((account) => accountSummary(account, wallet?.activeAccountId || null))
  }

  const resolveWalletQueryAddress = (address?: string, accountId?: string): string | null => {
    const explicit = `${address || ''}`.trim()
    if (explicit) return explicit
    const unlockedRequested = unlockedWallet?.accounts.find((account) => account.id === `${accountId || ''}`.trim())
    if (unlockedRequested?.address) return unlockedRequested.address
    if (accountId) {
      const storedRequested = findWalletAccount(loadWalletFile(), accountId)
      if (storedRequested?.address) return storedRequested.address
    }
    if (unlockedWallet?.address) return unlockedWallet.address
    const storedWallet = loadWalletFile()
    return findWalletAccount(storedWallet, storedWallet?.activeAccountId)?.address || storedWallet?.address?.trim() || null
  }

  const setActiveWalletAccount = (accountId: string): KnodelWalletAccountSummary | null => {
    const wallet = loadWalletFile()
    const account = findWalletAccount(wallet, accountId)
    if (!wallet || !account) return null
    wallet.activeAccountId = account.id
    writeWalletFile(wallet)
    if (unlockedWallet) {
      const unlockedAccount =
        unlockedWallet.accounts.find((entry) => entry.id === account.id) ||
        unlockedWallet.accounts[0] ||
        null
      unlockedWallet = {
        ...unlockedWallet,
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

  const createDerivedWalletAccount = (name?: string): KnodelWalletAccountSummary | null => {
    const wallet = loadWalletFile()
    if (!wallet?.accounts?.length || !wallet.encryptedSeedPhrase || !unlockedWallet?.seedPhrase) return null

    const nextDerivationIndex =
      wallet.accounts
        .filter((account) => account.kind === 'derived')
        .reduce((max, account) => Math.max(max, parseWalletDerivationIndex(account.derivationPath) ?? -1), -1) + 1
    const derivationPath = walletDerivationPath(nextDerivationIndex)
    const derived = deriveWalletAccountFromPath(unlockedWallet.seedPhrase, derivationPath)
    if (wallet.accounts.some((account) => account.address.toLowerCase() === derived.address.toLowerCase())) {
      return null
    }

    const createdAt = new Date().toISOString()
    const account: KnodelEncryptedWalletAccount = {
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
    writeWalletFile(wallet)

    if (unlockedWallet) {
      unlockedWallet.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: account.derivationPath ?? null,
        privateKey: derived.privateKeyWif,
        createdAt,
        updatedAt: createdAt
      })
      unlockedWallet.address = account.address
      unlockedWallet.privateKey = derived.privateKeyWif
      unlockedWallet.seedDerivationPath = account.derivationPath ?? null
      unlockedWallet.activeAccountId = account.id
      unlockedWallet.accountName = account.name
      unlockedWallet.accountKind = account.kind
    }

    return accountSummary(account, wallet.activeAccountId || null)
  }

  const importWalletAccount = (privateKey: string, password: string, name?: string): KnodelWalletAccountSummary | null => {
    const signer = Signer.fromWif(privateKey)
    const address = signer.getAddress()
    const existingWallet = loadWalletFile()
    if (!existingWallet) {
      saveWallet(privateKey, address, password)
      return listWalletAccounts()[0] || null
    }

    if (existingWallet.accounts?.some((account) => account.address.toLowerCase() === address.toLowerCase())) {
      return null
    }

    const createdAt = new Date().toISOString()
    const account: KnodelEncryptedWalletAccount = {
      id: createWalletAccountId('imported-wif'),
      name: sanitizeAccountName(name, nextDefaultAccountName(existingWallet.accounts || [], 'imported-wif')),
      kind: 'imported-wif',
      address,
      createdAt,
      updatedAt: createdAt,
      derivationPath: null,
      encryptedKey: encryptKnodelWalletSecret(privateKey, password)
    }

    existingWallet.accounts = [...(existingWallet.accounts || []), account]
    existingWallet.activeAccountId = account.id
    writeWalletFile(existingWallet)

    if (unlockedWallet) {
      unlockedWallet.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: null,
        privateKey,
        createdAt,
        updatedAt: createdAt
      })
      unlockedWallet.address = account.address
      unlockedWallet.privateKey = privateKey
      unlockedWallet.seedDerivationPath = null
      unlockedWallet.activeAccountId = account.id
      unlockedWallet.accountName = account.name
      unlockedWallet.accountKind = account.kind
    }

    return accountSummary(account, existingWallet.activeAccountId || null)
  }

  const importWatchWalletAccount = (address: string, name?: string): KnodelWalletAccountSummary | null => {
    const trimmedAddress = address.trim()
    if (!trimmedAddress) return null

    const existingWallet = loadWalletFile()
    if (!existingWallet) return null
    if (existingWallet.accounts?.some((account) => account.address.toLowerCase() === trimmedAddress.toLowerCase())) {
      return null
    }

    const createdAt = new Date().toISOString()
    const account: KnodelEncryptedWalletAccount = {
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
    writeWalletFile(existingWallet)

    if (unlockedWallet) {
      unlockedWallet.accounts.push({
        id: account.id,
        name: account.name,
        kind: account.kind,
        address: account.address,
        derivationPath: null,
        privateKey: null,
        createdAt,
        updatedAt: createdAt
      })
      unlockedWallet.address = account.address
      unlockedWallet.privateKey = null
      unlockedWallet.seedDerivationPath = null
      unlockedWallet.activeAccountId = account.id
      unlockedWallet.accountName = account.name
      unlockedWallet.accountKind = account.kind
    }

    return accountSummary(account, existingWallet.activeAccountId || null)
  }

  const renameWalletAccount = (accountId: string, name: string): KnodelWalletAccountSummary | null => {
    const wallet = loadWalletFile()
    const account = findWalletAccount(wallet, accountId)
    const trimmedName = name.trim()
    if (!wallet || !account || !trimmedName) return null
    account.name = trimmedName
    account.updatedAt = new Date().toISOString()
    writeWalletFile(wallet)

    if (unlockedWallet) {
      const unlockedAccount = unlockedWallet.accounts.find((entry) => entry.id === account.id)
      if (unlockedAccount) unlockedAccount.name = trimmedName
      if (unlockedWallet.activeAccountId === account.id) unlockedWallet.accountName = trimmedName
    }

    return accountSummary(account, wallet.activeAccountId || null)
  }

  const removeWalletAccount = (accountId: string): KnodelWalletAccountSummary[] | null => {
    const wallet = loadWalletFile()
    if (!wallet?.accounts?.length || wallet.accounts.length <= 1) return null
    const nextAccounts = wallet.accounts.filter((account) => account.id !== accountId)
    if (nextAccounts.length === wallet.accounts.length) return null

    wallet.accounts = nextAccounts
    if (!nextAccounts.some((account) => account.id === wallet.activeAccountId)) {
      wallet.activeAccountId = nextAccounts[0]?.id || null
    }
    writeWalletFile(wallet)

    if (unlockedWallet) {
      unlockedWallet.accounts = unlockedWallet.accounts.filter((account) => account.id !== accountId)
      const activeUnlocked =
        unlockedWallet.accounts.find((account) => account.id === wallet.activeAccountId) || unlockedWallet.accounts[0] || null
      unlockedWallet.address = activeUnlocked?.address || wallet.address
      unlockedWallet.privateKey = activeUnlocked?.privateKey ?? null
      unlockedWallet.seedDerivationPath = activeUnlocked?.derivationPath ?? null
      unlockedWallet.activeAccountId = activeUnlocked?.id || null
      unlockedWallet.accountName = activeUnlocked?.name || null
      unlockedWallet.accountKind = activeUnlocked?.kind || null
    }

    return wallet.accounts.map((account) => accountSummary(account, wallet.activeAccountId || null))
  }

  const loadWalletAccountSecrets = (accountId?: string): WalletAccountSecrets => {
    const wallet = loadWalletFile()
    const unlockedActiveAccountId = unlockedWallet?.activeAccountId || null
    const unlockedAccount =
      unlockedWallet?.accounts.find((account) => account.id === `${accountId || ''}`.trim()) ||
      unlockedWallet?.accounts.find((account) => account.id === unlockedActiveAccountId) ||
      unlockedWallet?.accounts[0] ||
      null

    return {
      walletAddress: wallet?.address || unlockedWallet?.address || null,
      accountId: unlockedAccount?.id || null,
      accountName: unlockedAccount?.name || null,
      accountKind: unlockedAccount?.kind || null,
      accountAddress: unlockedAccount?.address || null,
      privateKeyWif: unlockedAccount?.privateKey ?? null,
      derivationPath: unlockedAccount?.derivationPath ?? null,
      seedPhrase: unlockedWallet?.seedPhrase || null
    }
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
