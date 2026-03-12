import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createKnodelStorage } from './knodel-storage'

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
})
