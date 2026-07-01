import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTelenoStorage } from './teleno-storage'
import { deriveWalletAccountsFromSeed } from './wallet-accounts'

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

describe('teleno storage', () => {
  it('persists and reloads public rpc config', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-rpc-'))

    expect(storage.loadPublicRpcConfig().publicRpcUrls).toEqual([
      'https://api.koinos.io/',
      'https://api.koinosblocks.com/'
    ])

    const saveResult = storage.savePublicRpcConfig({
      publicRpcUrls: ['https://api.koinos.io', 'http://localhost:8080']
    })

    expect(saveResult.ok).toBe(true)
    expect(storage.loadPublicRpcConfig().publicRpcUrls).toEqual([
      'https://api.koinos.io/',
      'http://localhost:8080/'
    ])
  })

  it('persists local app preferences', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-prefs-'))

    const initial = storage.loadAppPreferences()
    expect(initial.ok).toBe(true)
    expect(typeof initial.preferences.keepRunningInMenuBar).toBe('boolean')

    const saved = storage.saveAppPreferences({ keepRunningInMenuBar: false })
    expect(saved.ok).toBe(true)
    expect(saved.filePath).toContain('app-preferences.v1.json')
    expect(saved.preferences).toEqual({ keepRunningInMenuBar: false })
    expect(storage.loadAppPreferences().preferences).toEqual({ keepRunningInMenuBar: false })
  })

  it('keeps public rpc config separate per network', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-rpc-network-'))

    const testnetSave = storage.savePublicRpcConfig({
      network: 'testnet',
      publicRpcUrls: ['https://testnet.koinosfoundation.org/jsonrpc']
    })
    expect(testnetSave.ok).toBe(true)
    expect(testnetSave.publicRpcUrls).toEqual(['https://testnet.koinosfoundation.org/jsonrpc'])
    expect(testnetSave.publicRpcUrlsByNetwork?.mainnet).toEqual([
      'https://api.koinos.io/',
      'https://api.koinosblocks.com/'
    ])
    expect(testnetSave.publicRpcUrlsByNetwork?.testnet).toEqual(['https://testnet.koinosfoundation.org/jsonrpc'])

    const mainnetSave = storage.savePublicRpcConfig({
      network: 'mainnet',
      publicRpcUrls: ['https://api.koinos.io', 'https://api.koinosblocks.com']
    })
    expect(mainnetSave.ok).toBe(true)

    const loaded = storage.loadPublicRpcConfig()
    expect(loaded.publicRpcUrlsByNetwork?.mainnet).toEqual([
      'https://api.koinos.io/',
      'https://api.koinosblocks.com/'
    ])
    expect(loaded.publicRpcUrlsByNetwork?.testnet).toEqual(['https://testnet.koinosfoundation.org/jsonrpc'])
  })

  it('persists local-only remote inventory and receipts', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-remote-'))
    const inventory = {
      version: 1,
      nodes: [{
        id: 'testnet-observer-a',
        network: 'testnet',
        hostRef: 'host-testnet-a',
        connectionRef: 'ssh-testnet-a',
        ports: {
          jsonrpcHostBind: '127.0.0.1:18122',
          p2pPublic: '28890',
          backupAdminListen: '127.0.0.1:18188'
        }
      }]
    }

    const saveResult = storage.saveRemoteInventory(inventory)
    expect(saveResult.ok).toBe(true)
    expect(saveResult.filePath).toContain('remote-nodes.inventory.v1.json')
    expect(storage.loadRemoteInventory().inventory).toMatchObject(inventory)

    const receiptResult = storage.appendRemoteReceipt({
      id: 'receipt-1',
      nodeId: 'testnet-observer-a',
      output: 'sanitized'
    })
    expect(receiptResult.ok).toBe(true)
    expect(storage.loadRemoteReceipts().receipts).toHaveLength(1)
  })

  it('rejects raw remote inventory targets and secret-looking values', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-remote-blocked-'))
    const rawTarget = storage.saveRemoteInventory({
      version: 1,
      nodes: [{
        id: 'unsafe',
        connectionRef: 'operator@192.0.2.10'
      }]
    })
    const secretValue = storage.saveRemoteInventory({
      version: 1,
      nodes: [{
        id: 'unsafe',
        connectionRef: 'ssh-safe',
        authRef: 'token=abc123'
      }]
    })

    expect(rawTarget.ok).toBe(false)
    expect(secretValue.ok).toBe(false)
  })

  it('persists, unlocks, closes and deletes a wallet', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-wallet-'))

    const walletFilePath = storage.saveWallet('KOIN_PRIVATE_WIF', '1WalletAddress', 'secret-password', {
      seedPhrase: 'seed words example',
      derivationPath: "m/44'/659'/0'/0/0"
    })

    expect(walletFilePath).toContain('producer-wallet.json')
    expect(storage.loadWalletFile()?.address).toBe('1WalletAddress')
    expect(storage.getUnlockedWallet()?.address).toBe('1WalletAddress')

    storage.closeWalletSession()
    expect(storage.getUnlockedWallet()).toBeNull()

    const unlocked = storage.unlockWalletSession('secret-password')
    expect(unlocked?.privateKey).toBe('KOIN_PRIVATE_WIF')
    expect(unlocked?.seedPhrase).toBe('seed words example')
    expect(storage.resolveWalletQueryAddress()).toBe('1WalletAddress')

    expect(storage.deleteWallet()).toBe(true)
    expect(storage.loadWalletFile()).toBeNull()
    expect(storage.getUnlockedWallet()).toBeNull()
  })

  it('persists and clears the producer profile', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-profile-'))

    const profilePath = storage.saveProducerProfile({
      network: 'mainnet',
      producerAddress: '1Producer',
      registrationSignerAccountId: '1Wallet',
      burnAccountId: '1Wallet',
      localPublicKey: 'LOCAL_KEY',
      localPublicKeyPath: '/tmp/public.key',
      registeredPublicKey: null,
      lastRegistrationTxId: null,
      updatedAt: new Date().toISOString()
    })

    expect(profilePath).toContain('producer-profile.v1.json')
    expect(storage.loadProducerProfile('mainnet')?.producerAddress).toBe('1Producer')
    expect(storage.clearProducerProfile('mainnet')).toBe(true)
    expect(storage.loadProducerProfile('mainnet')).toBeNull()
  })

  it('migrates a legacy single-account wallet file to vault v2', () => {
    const userDataPath = createTempDir('teleno-storage-legacy-')
    const storage = createTelenoStorage(userDataPath)
    const walletFilePath = storage.producerWalletFilePath()

    fs.mkdirSync(path.dirname(walletFilePath), { recursive: true })
    fs.writeFileSync(
      walletFilePath,
      JSON.stringify(
        {
          address: '1LegacyAddress',
          encryptedKey: {
            encrypted: 'deadbeef',
            salt: '00',
            iv: '11',
            authTag: '22'
          },
          encryptedSeedPhrase: null,
          seedDerivationPath: null,
          createdAt: '2026-03-10T00:00:00.000Z'
        },
        null,
        2
      )
    )

    const wallet = storage.loadWalletFile()
    expect(wallet?.version).toBe(2)
    expect(wallet?.activeAccountId).toBeTruthy()
    expect(wallet?.accounts).toHaveLength(1)
    expect(wallet?.accounts?.[0]).toMatchObject({
      address: '1LegacyAddress',
      kind: 'imported-wif'
    })

    const persisted = JSON.parse(fs.readFileSync(walletFilePath, 'utf8')) as { version?: number; accounts?: unknown[] }
    expect(persisted.version).toBe(2)
    expect(Array.isArray(persisted.accounts)).toBe(true)
    expect(persisted.accounts).toHaveLength(1)
  })

  it('manages multiple wallet accounts inside the same vault', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-accounts-'))
    const seedPhrase = 'test test test test test test test test test test test junk'
    const [firstAccount] = deriveWalletAccountsFromSeed(seedPhrase, 1)

    storage.saveWallet(firstAccount.privateKeyWif, firstAccount.address, 'secret-password', {
      seedPhrase,
      derivationPath: firstAccount.derivationPath
    })

    const secondDerived = storage.createDerivedWalletAccount('Account 2')
    expect(secondDerived).toMatchObject({
      name: 'Account 2',
      kind: 'derived',
      isActive: true
    })

    const watchOnly = storage.importWatchWalletAccount('1WatchOnlyAddress', 'Observer')
    expect(watchOnly).toMatchObject({
      name: 'Observer',
      kind: 'watch-only',
      isActive: true
    })

    const renamed = storage.renameWalletAccount(watchOnly?.id || '', 'Node Watcher')
    expect(renamed?.name).toBe('Node Watcher')

    const activeFirst = storage.setActiveWalletAccount(secondDerived?.id || '')
    expect(activeFirst?.id).toBe(secondDerived?.id)
    expect(storage.resolveWalletQueryAddress(undefined, secondDerived?.id)).toBe(secondDerived?.address || null)

    const accountsBeforeRemove = storage.listWalletAccounts()
    expect(accountsBeforeRemove).toHaveLength(3)
    expect(accountsBeforeRemove.find((account) => account.id === secondDerived?.id)?.isActive).toBe(true)

    const remaining = storage.removeWalletAccount(watchOnly?.id || '')
    expect(remaining).toHaveLength(2)
    expect(remaining?.some((account) => account.id === watchOnly?.id)).toBe(false)
    expect(storage.loadWalletFile()?.accounts).toHaveLength(2)
  })

  it('upgrades a matching watch-only account when its WIF is imported', () => {
    const storage = createTelenoStorage(createTempDir('teleno-storage-upgrade-watch-'))
    const seedPhrase = 'test test test test test test test test test test test junk'
    const [firstAccount, secondAccount] = deriveWalletAccountsFromSeed(seedPhrase, 2)

    storage.saveWallet(firstAccount.privateKeyWif, firstAccount.address, 'secret-password', {
      seedPhrase,
      derivationPath: firstAccount.derivationPath
    })

    const watchOnly = storage.importWatchWalletAccount(secondAccount.address, 'Producer address')
    expect(watchOnly).toMatchObject({
      address: secondAccount.address,
      kind: 'watch-only',
      hasPrivateKey: false,
      isActive: true
    })

    const upgraded = storage.importWalletAccount(secondAccount.privateKeyWif, 'secret-password', 'Producer address')
    expect(upgraded).toMatchObject({
      id: watchOnly?.id,
      address: secondAccount.address,
      kind: 'imported-wif',
      hasPrivateKey: true,
      isActive: true
    })

    const accounts = storage.listWalletAccounts()
    expect(accounts).toHaveLength(2)
    expect(accounts.filter((account) => account.address === secondAccount.address)).toHaveLength(1)
    expect(storage.getUnlockedWallet()?.activeAccountId).toBe(watchOnly?.id)
    expect(storage.getUnlockedWallet()?.privateKey).toBe(secondAccount.privateKeyWif)
  })
})
