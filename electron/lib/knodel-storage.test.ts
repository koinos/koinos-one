import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createKnodelStorage } from './knodel-storage'
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

describe('knodel storage', () => {
  it('persists and reloads public rpc config', () => {
    const storage = createKnodelStorage(createTempDir('knodel-storage-rpc-'))

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

  it('persists, unlocks, closes and deletes a wallet', () => {
    const storage = createKnodelStorage(createTempDir('knodel-storage-wallet-'))

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
    const storage = createKnodelStorage(createTempDir('knodel-storage-profile-'))

    const profilePath = storage.saveProducerProfile({
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
    expect(storage.loadProducerProfile()?.producerAddress).toBe('1Producer')
    expect(storage.clearProducerProfile()).toBe(true)
    expect(storage.loadProducerProfile()).toBeNull()
  })

  it('migrates a legacy single-account wallet file to vault v2', () => {
    const userDataPath = createTempDir('knodel-storage-legacy-')
    const storage = createKnodelStorage(userDataPath)
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
    const storage = createKnodelStorage(createTempDir('knodel-storage-accounts-'))
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
})
