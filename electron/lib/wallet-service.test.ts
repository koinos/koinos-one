import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTelenoStorage } from './teleno-storage'
import { createWalletService, deriveWalletAccountsFromSeed, walletDerivationPath } from './wallet-service'

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

function createWalletTestService(options?: {
  updateConfigProducerAddress?: (address: string, input?: { network?: string; baseDir?: string }) => string | null
}) {
  const storage = createTelenoStorage(createTempDir('wallet-service-'))

  return {
    storage,
    service: createWalletService({
      loadTelenoWalletFile: (network) => storage.loadWalletFile(network),
      telenoProducerWalletFilePath: (network) => storage.producerWalletFilePath(network),
      currentUnlockedProducerWallet: (network) => storage.getUnlockedWallet(network),
      saveTelenoWallet: (privateKey, address, password, options) => storage.saveWallet(privateKey, address, password, options),
      deleteTelenoWallet: (network) => storage.deleteWallet(network),
      closeTelenoWalletSession: (network) => storage.closeWalletSession(network),
      unlockTelenoWalletSession: (password, network) => storage.unlockWalletSession(password, network),
      listWalletAccounts: (network) => storage.listWalletAccounts(network),
      setActiveWalletAccount: (accountId, network) => storage.setActiveWalletAccount(accountId, network),
      createDerivedWalletAccount: (name, network) => storage.createDerivedWalletAccount(name, network),
      importAdditionalWalletAccount: (privateKey, password, name, network) =>
        storage.importWalletAccount(privateKey, password, name, network),
      importWatchWalletAccount: (address, name, network) => storage.importWatchWalletAccount(address, name, network),
      renameWalletAccount: (accountId, name, network) => storage.renameWalletAccount(accountId, name, network),
      removeWalletAccount: (accountId, network) => storage.removeWalletAccount(accountId, network),
      loadWalletAccountSecrets: (accountId, network) => storage.loadWalletAccountSecrets(accountId, network),
      resolveWalletRpcUrl: () => 'http://127.0.0.1:8080/',
      resolveWalletQueryAddress: (address, accountId) => storage.resolveWalletQueryAddress(address, accountId),
      parseWalletArgs: (value) => (typeof value === 'string' ? JSON.parse(value) : value || {}),
      loadContractWithFetchedAbi: async () => {
        throw new Error('Not used in this test.')
      },
      formatWholeUnits: () => null,
      safeIsChecksumAddress: () => true,
      loadProducerProfile: () => null,
      updateConfigProducerAddress: options?.updateConfigProducerAddress
    })
  }
}

describe('wallet-service helpers', () => {
  it('builds the expected derivation path', () => {
    expect(walletDerivationPath(0)).toBe("m/44'/659'/0'/0/0")
    expect(walletDerivationPath(1)).toBe("m/44'/659'/1'/0/0")
  })

  it('derives deterministic accounts from a seed phrase', () => {
    const accounts = deriveWalletAccountsFromSeed('test test test test test test test test test test test junk', 2)

    expect(accounts).toEqual([
      {
        index: 1,
        derivationPath: "m/44'/659'/0'/0/0",
        address: '1pVJaALjb2fqumng21HvvBy5Bjv7u3vNZ',
        privateKeyWif: 'L2QJx8FHPi1jBEun99vrtMp7MmsZuNX7KPHndbHJ1gZRRgziCgFe'
      },
      {
        index: 2,
        derivationPath: "m/44'/659'/1'/0/0",
        address: '1BY9XCXrqMeViAEVhYQPcGGSYPzrwyQkEM',
        privateKeyWif: 'Kwek5DC4oZeU7f97DM1Y1hDnUaVL49Z43r3RjA5SbYgUQVxqFjaz'
      }
    ])
  })

  it('manages accounts through the wallet service', async () => {
    const { service } = createWalletTestService()
    const seedPhrase = 'test test test test test test test test test test test junk'
    const [firstAccount, secondAccount] = deriveWalletAccountsFromSeed(seedPhrase, 2)

    const importResult = await service.walletImport({
      privateKey: firstAccount.privateKeyWif,
      password: 'secret-password',
      seedPhrase,
      derivationPath: firstAccount.derivationPath
    })
    expect(importResult.ok).toBe(true)

    const overview = await service.walletOverview()
    expect(overview.ok).toBe(true)
    expect(overview.accountCount).toBe(1)
    expect(overview.activeAccountName).toBe('Account 1')

    const created = await service.walletCreateDerivedAccount({ name: 'Account 2' })
    expect(created.ok).toBe(true)
    expect(created.activeAccountId).toBe(created.account?.id || null)
    expect(created.accounts).toHaveLength(2)

    const importedWatch = await service.walletImportWatchAccount({
      address: '1WatchOnlyAddress',
      name: 'Observer'
    })
    expect(importedWatch.ok).toBe(true)
    expect(importedWatch.account?.kind).toBe('watch-only')

    const listResult = await service.walletListAccounts()
    expect(listResult.accounts).toHaveLength(3)
    expect(listResult.accounts.find((account) => account.address === secondAccount.address)?.kind).toBe('derived')

    const activeResult = await service.walletSetActiveAccount({ accountId: created.account?.id || '' })
    expect(activeResult.ok).toBe(true)
    expect(activeResult.activeAccount?.address).toBe(secondAccount.address)

    const renameResult = await service.walletRenameAccount({
      accountId: importedWatch.account?.id || '',
      name: 'Node Watcher'
    })
    expect(renameResult.ok).toBe(true)
    expect(renameResult.account?.name).toBe('Node Watcher')

    const showSecrets = await service.walletShowSeed()
    expect(showSecrets.ok).toBe(true)
    expect(showSecrets.accountId).toBe(created.account?.id || null)
    expect(showSecrets.accountName).toBe('Account 2')
    expect(showSecrets.firstAccountAddress).toBe(secondAccount.address)
    expect(showSecrets.seedPhrase).toBe(seedPhrase)

    const removeResult = await service.walletRemoveAccount({ accountId: importedWatch.account?.id || '' })
    expect(removeResult.ok).toBe(true)
    expect(removeResult.accounts).toHaveLength(2)
  })

  it('syncs non-mainnet private-key wallet account changes to the runtime producer config', async () => {
    const updates: Array<{ address: string; network?: string; baseDir?: string }> = []
    const { service } = createWalletTestService({
      updateConfigProducerAddress: (address, input) => {
        updates.push({ address, network: input?.network, baseDir: input?.baseDir })
        return `${input?.baseDir || '/tmp/teleno'}/config.yml`
      }
    })
    const seedPhrase = 'test test test test test test test test test test test junk'
    const [firstAccount] = deriveWalletAccountsFromSeed(seedPhrase, 1)

    const importResult = await service.walletImport({
      privateKey: firstAccount.privateKeyWif,
      password: 'secret-password',
      seedPhrase,
      derivationPath: firstAccount.derivationPath,
      network: 'testnet',
      baseDir: '/tmp/testnet-basedir'
    })
    expect(importResult.ok).toBe(true)
    expect(importResult.output).toContain('/tmp/testnet-basedir/config.yml')
    expect(updates).toEqual([
      {
        address: firstAccount.address,
        network: 'testnet',
        baseDir: '/tmp/testnet-basedir'
      }
    ])

    const derived = await service.walletCreateDerivedAccount({
      name: 'Producer 2',
      network: 'testnet',
      baseDir: '/tmp/testnet-basedir'
    })
    expect(derived.ok).toBe(true)
    expect(updates.at(-1)).toMatchObject({
      address: derived.account?.address,
      network: 'testnet',
      baseDir: '/tmp/testnet-basedir'
    })

    const beforeMainnetImportCount = updates.length
    await service.walletImport({
      privateKey: firstAccount.privateKeyWif,
      password: 'secret-password',
      network: 'mainnet',
      baseDir: '/tmp/mainnet-basedir'
    })
    expect(updates).toHaveLength(beforeMainnetImportCount)
  })

  it('sets a selected private-key wallet account as runtime producer config', async () => {
    const updates: Array<{ address: string; network?: string; baseDir?: string }> = []
    const { service } = createWalletTestService({
      updateConfigProducerAddress: (address, input) => {
        updates.push({ address, network: input?.network, baseDir: input?.baseDir })
        return `${input?.baseDir || '/tmp/teleno'}/config.yml`
      }
    })
    const [firstAccount] = deriveWalletAccountsFromSeed('test test test test test test test test test test test junk', 1)

    const importResult = await service.walletImport({
      privateKey: firstAccount.privateKeyWif,
      password: 'secret-password',
      network: 'testnet',
      baseDir: '/tmp/testnet-basedir'
    })
    expect(importResult.ok).toBe(true)
    updates.length = 0

    const overview = await service.walletOverview({ network: 'testnet' })
    const setProducer = await service.walletSetProducerAccount({
      accountId: overview.activeAccountId || '',
      network: 'testnet',
      baseDir: '/tmp/testnet-basedir'
    })

    expect(setProducer.ok).toBe(true)
    expect(setProducer.configPath).toBe('/tmp/testnet-basedir/config.yml')
    expect(setProducer.activeAccount?.address).toBe(firstAccount.address)
    expect(setProducer.output).toContain('Set block_producer.producer')
    expect(updates).toEqual([
      {
        address: firstAccount.address,
        network: 'testnet',
        baseDir: '/tmp/testnet-basedir'
      }
    ])
  })

  it('does not write the protected funded mainnet producer address to runtime config', async () => {
    const protectedAddress = '14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb'
    const updateConfigProducerAddress = vi.fn(() => '/tmp/mainnet-basedir/config.yml')
    const service = createWalletService({
      loadTelenoWalletFile: () => ({
        address: protectedAddress,
        activeAccountId: 'acc_1'
      }),
      telenoProducerWalletFilePath: () => '/tmp/wallet.json',
      currentUnlockedProducerWallet: () => null,
      saveTelenoWallet: () => '/tmp/wallet.json',
      deleteTelenoWallet: () => false,
      closeTelenoWalletSession: () => null,
      unlockTelenoWalletSession: () => null,
      listWalletAccounts: () => [
        {
          id: 'acc_1',
          name: 'Account 1',
          kind: 'imported-wif',
          address: protectedAddress,
          derivationPath: null,
          createdAt: '2026-06-17T00:00:00.000Z',
          updatedAt: null,
          hasPrivateKey: true,
          isActive: true
        }
      ],
      setActiveWalletAccount: () => null,
      createDerivedWalletAccount: () => null,
      importAdditionalWalletAccount: () => null,
      importWatchWalletAccount: () => null,
      renameWalletAccount: () => null,
      removeWalletAccount: () => null,
      loadWalletAccountSecrets: () => ({
        walletAddress: null,
        accountId: null,
        accountName: null,
        accountKind: null,
        accountAddress: null,
        privateKeyWif: null,
        derivationPath: null,
        seedPhrase: null
      }),
      resolveWalletRpcUrl: () => 'http://127.0.0.1:8080/',
      resolveWalletQueryAddress: () => null,
      parseWalletArgs: () => ({}),
      loadContractWithFetchedAbi: async () => {
        throw new Error('Not used in this test.')
      },
      formatWholeUnits: () => null,
      safeIsChecksumAddress: () => true,
      loadProducerProfile: () => null,
      updateConfigProducerAddress
    })

    const result = await service.walletSetProducerAccount({
      accountId: 'acc_1',
      network: 'mainnet',
      baseDir: '/tmp/mainnet-basedir'
    })

    expect(result.ok).toBe(false)
    expect(result.output).toContain('protected by the project safety guardrail')
    expect(result.configPath).toBeNull()
    expect(updateConfigProducerAddress).not.toHaveBeenCalled()
  })
})
