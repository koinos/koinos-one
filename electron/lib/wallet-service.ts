import { Contract, Provider, Signer, Transaction } from 'koilib'
import { ethers } from 'ethers'

import {
  FREE_MANA_METER_ADDRESS,
  FREE_MANA_SHARER_ADDRESS
} from './constants'
import { contractsForNetwork, normalizeKoinosNetworkId, type KoinosNetworkId } from './network-profiles'
import type {
  TelenoEncryptedWallet,
  TelenoProducerProfile,
  TelenoUnlockedWalletAccount,
  TelenoUnlockedWallet,
  TelenoWalletAccountSummary,
  WalletAddressInput,
  WalletAccountMutationResult,
  WalletCreateDerivedAccountInput,
  WalletAddressQueryInput,
  WalletAddressResult,
  WalletBalanceResult,
  WalletBlockInput,
  WalletBlockOperation,
  WalletBlockResult,
  WalletBlockTransaction,
  WalletBurnInput,
  WalletBurnResult,
  WalletChainInfoResult,
  WalletCloseResult,
  WalletDeleteResult,
  WalletDerivedAccount,
  WalletDeriveFromSeedInput,
  WalletDeriveFromSeedResult,
  WalletGenerateResult,
  WalletImportAccountInput,
  WalletImportInput,
  WalletImportResult,
  WalletImportWatchAccountInput,
  WalletListAccountsInput,
  WalletListAccountsResult,
  WalletOverviewResult,
  WalletReadContractInput,
  WalletReadContractResult,
  WalletRemoveAccountInput,
  WalletRenameAccountInput,
  WalletRpcInput,
  WalletScalarResult,
  WalletSetActiveAccountInput,
  WalletSetActiveAccountResult,
  WalletSetProducerAccountInput,
  WalletSetProducerAccountResult,
  WalletShowSeedInput,
  WalletShowSeedResult,
  WalletTokenBalanceInput,
  WalletTokenBalanceResult,
  WalletTransferKoinInput,
  WalletTransferKoinResult,
  WalletTransferVhpInput,
  WalletTransferVhpResult,
  WalletUnlockInput,
  WalletUnlockResult
} from './main-types'
import { deriveWalletAccountsFromSeed, walletDerivationPath } from './wallet-accounts'

type WalletServiceDeps = {
  loadTelenoWalletFile: (network?: KoinosNetworkId) => TelenoEncryptedWallet | null
  telenoProducerWalletFilePath: (network?: KoinosNetworkId) => string
  currentUnlockedProducerWallet: (network?: KoinosNetworkId) => TelenoUnlockedWallet | null
  saveTelenoWallet: (
    privateKey: string,
    address: string,
    password: string,
    options?: { seedPhrase?: string; derivationPath?: string; network?: KoinosNetworkId }
  ) => string
  deleteTelenoWallet: (network?: KoinosNetworkId) => boolean
  closeTelenoWalletSession: (network?: KoinosNetworkId) => string | null
  unlockTelenoWalletSession: (password: string, network?: KoinosNetworkId) => TelenoUnlockedWallet | null
  listWalletAccounts: (network?: KoinosNetworkId) => TelenoWalletAccountSummary[]
  setActiveWalletAccount: (accountId: string, network?: KoinosNetworkId) => TelenoWalletAccountSummary | null
  createDerivedWalletAccount: (name?: string, network?: KoinosNetworkId) => TelenoWalletAccountSummary | null
  importAdditionalWalletAccount: (
    privateKey: string,
    password: string,
    name?: string,
    network?: KoinosNetworkId
  ) => TelenoWalletAccountSummary | null
  importWatchWalletAccount: (address: string, name?: string, network?: KoinosNetworkId) => TelenoWalletAccountSummary | null
  renameWalletAccount: (accountId: string, name: string, network?: KoinosNetworkId) => TelenoWalletAccountSummary | null
  removeWalletAccount: (accountId: string, network?: KoinosNetworkId) => TelenoWalletAccountSummary[] | null
  loadWalletAccountSecrets: (
    accountId?: string,
    network?: KoinosNetworkId
  ) => {
    walletAddress: string | null
    accountId: string | null
    accountName: string | null
    accountKind: TelenoWalletAccountSummary['kind'] | null
    accountAddress: string | null
    privateKeyWif: string | null
    derivationPath: string | null
    seedPhrase: string | null
  }
  resolveWalletRpcUrl: (input?: WalletRpcInput) => string
  resolveWalletQueryAddress: (address?: string, accountId?: string) => string | null
  parseWalletArgs: (value: WalletReadContractInput['args']) => Record<string, unknown>
  loadContractWithFetchedAbi: (provider: Provider, contractId: string) => Promise<Contract>
  formatWholeUnits: (value: bigint | string | number | null | undefined, decimals?: number) => string | null
  safeIsChecksumAddress: (value: string | null | undefined) => boolean
  loadProducerProfile: (network?: KoinosNetworkId) => TelenoProducerProfile | null
  updateConfigProducerAddress?: (address: string, input?: WalletRpcInput) => string | null
}

const PROTECTED_MAINNET_PRODUCER_ADDRESSES_ENV = 'KOINOS_ONE_PROTECTED_MAINNET_PRODUCER_ADDRESSES'

export { deriveWalletAccountsFromSeed, walletDerivationPath } from './wallet-accounts'

function protectedMainnetProducerAddresses(): Set<string> {
  const raw = process.env[PROTECTED_MAINNET_PRODUCER_ADDRESSES_ENV] || ''
  return new Set(raw.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))
}

function isProtectedMainnetProducerAddress(address: string): boolean {
  return protectedMainnetProducerAddresses().has(address)
}

function setWalletTransactionSponsor(
  transaction: Transaction,
  payer: string,
  payee: string,
  rcLimit: string
): void {
  if (!transaction.transaction.header) transaction.transaction.header = {}
  transaction.transaction.header.payer = payer
  transaction.transaction.header.payee = payee
  transaction.transaction.header.rc_limit = rcLimit

  if (
    transaction.transaction.header.chain_id &&
    transaction.transaction.header.nonce &&
    transaction.transaction.header.operation_merkle_root
  ) {
    transaction.transaction.id = Transaction.computeTransactionId(transaction.transaction.header)
  }

  transaction.transaction.signatures = []
}

async function prepareWalletTransactionWithFreeMana(params: {
  signer: Signer
  provider: Provider
  walletAddress: string
  operations: Array<Record<string, unknown>>
}): Promise<{ transaction: Transaction; payerAddress: string }> {
  const { signer, provider, walletAddress, operations } = params
  const manaMeterRcRaw = await provider.getAccountRc(FREE_MANA_METER_ADDRESS)
  const manaMeterRc = manaMeterRcRaw ? BigInt(manaMeterRcRaw) : BigInt(0)
  if (manaMeterRc <= BigInt(0)) {
    throw new Error('Free mana is currently unavailable.')
  }

  const initialRcLimit = ((manaMeterRc * BigInt(9)) / BigInt(10)).toString()
  const transaction = new Transaction({
    signer,
    provider,
    options: {
      payer: FREE_MANA_SHARER_ADDRESS,
      payee: walletAddress,
      rcLimit: initialRcLimit
    }
  })

  for (const operation of operations) {
    await transaction.pushOperation(operation)
  }

  setWalletTransactionSponsor(transaction, FREE_MANA_METER_ADDRESS, walletAddress, initialRcLimit)
  await transaction.prepare()
  await transaction.sign()

  const phase1Receipt = await transaction.send({ broadcast: false })
  const phase1RcUsed = phase1Receipt?.rc_used ? BigInt(`${phase1Receipt.rc_used}`) : BigInt(0)
  if (phase1RcUsed <= BigInt(0)) {
    throw new Error('Free mana dry run failed to estimate RC usage.')
  }

  let sponsoredRcLimit = ((phase1RcUsed * BigInt(110)) + BigInt(99)) / BigInt(100)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      setWalletTransactionSponsor(transaction, FREE_MANA_SHARER_ADDRESS, walletAddress, sponsoredRcLimit.toString())
      await transaction.sign()
      await transaction.send({ broadcast: false })
      return {
        transaction,
        payerAddress: FREE_MANA_SHARER_ADDRESS
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error || ''}`
      if (attempt >= 4 || !/insufficient rc/i.test(message)) {
        throw error
      }
      sponsoredRcLimit += BigInt(100_000_000)
    }
  }

  throw new Error('Free mana transaction could not be prepared.')
}

function activeWalletSummary(
  wallet: TelenoEncryptedWallet | null,
  accounts: TelenoWalletAccountSummary[]
): TelenoWalletAccountSummary | null {
  const activeId = `${wallet?.activeAccountId || ''}`.trim()
  return accounts.find((account) => account.id === activeId) || accounts[0] || null
}

function resolveUnlockedWalletAccount(
  wallet: TelenoUnlockedWallet,
  requestedAccountId?: string | null
): TelenoUnlockedWalletAccount | null {
  const accountId = `${requestedAccountId || ''}`.trim()
  if (accountId) {
    const exact = wallet.accounts.find((account) => account.id === accountId)
    if (exact) return exact
  }

  const activeAccountId = `${wallet.activeAccountId || ''}`.trim()
  return wallet.accounts.find((account) => account.id === activeAccountId) || wallet.accounts[0] || null
}

function walletNetwork(input?: WalletRpcInput): KoinosNetworkId {
  return normalizeKoinosNetworkId(input?.network)
}

export function createWalletService(deps: WalletServiceDeps) {
  function syncNonMainnetProducerRuntimeConfig(
    address: string,
    input: WalletRpcInput | undefined,
    accountHasPrivateKey: boolean
  ): string | null {
    const trimmedAddress = address.trim()
    const network = walletNetwork(input)
    if (network === 'mainnet') return null
    if (!accountHasPrivateKey || !trimmedAddress || !deps.updateConfigProducerAddress) return null
    if (!deps.safeIsChecksumAddress(trimmedAddress)) return null

    try {
      return deps.updateConfigProducerAddress(trimmedAddress, input) || null
    } catch {
      return null
    }
  }

  function appendProducerConfigSyncNote(output: string, configPath: string | null): string {
    return configPath
      ? `${output}\nUpdated runtime producer config: ${configPath}\nRestart the node for a running block producer to use this address.`
      : output
  }

  async function walletOverview(input?: WalletRpcInput): Promise<WalletOverviewResult> {
    const network = walletNetwork(input)
    const wallet = deps.loadTelenoWalletFile(network)
    const accounts = deps.listWalletAccounts(network)
    const activeAccount = activeWalletSummary(wallet, accounts)
    return {
      ok: true,
      output: wallet ? `Wallet vault stored for ${wallet.address}` : 'No wallet stored in Koinos One yet.',
      rpcUrl: deps.resolveWalletRpcUrl(input),
      walletFilePath: deps.telenoProducerWalletFilePath(network),
      walletExists: Boolean(wallet),
      walletAddress: wallet?.address || null,
      walletCreatedAt: wallet?.createdAt || null,
      activeAccountId: activeAccount?.id || null,
      activeAccountName: activeAccount?.name || null,
      activeAccountKind: activeAccount?.kind || null,
      accountCount: accounts.length,
      accounts,
      unlocked: Boolean(wallet && deps.currentUnlockedProducerWallet(network)?.activeAccountId),
      hasSeedPhrase: Boolean(wallet?.encryptedSeedPhrase)
    }
  }

  async function walletGenerate(): Promise<WalletGenerateResult> {
    try {
      const generatedWallet = ethers.Wallet.createRandom()
      const seedPhrase = `${generatedWallet.mnemonic?.phrase || ''}`.trim()
      if (!seedPhrase) throw new Error('Could not generate a seed phrase.')
      const firstAccount = deriveWalletAccountsFromSeed(seedPhrase, 1)[0]
      if (!firstAccount) throw new Error('Could not derive the first wallet account from the generated seed.')
      return {
        ok: true,
        output: 'Generated a new seed phrase. Write it down before creating the wallet.',
        address: firstAccount.address,
        privateKeyWif: firstAccount.privateKeyWif,
        seedPhrase,
        derivationPath: firstAccount.derivationPath
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not generate wallet',
        address: null,
        privateKeyWif: null,
        seedPhrase: null,
        derivationPath: null
      }
    }
  }

  async function walletImport(input?: WalletImportInput): Promise<WalletImportResult> {
    const network = walletNetwork(input)
    try {
      const privateKey = `${input?.privateKey || ''}`.trim()
      const password = `${input?.password || ''}`
      const seedPhrase = `${input?.seedPhrase || ''}`.trim()
      const derivationPath = `${input?.derivationPath || ''}`.trim()
      if (!privateKey) throw new Error('Private key is required.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters long.')
      const signer = Signer.fromWif(privateKey)
      const address = signer.getAddress()
      const walletFilePath = deps.saveTelenoWallet(privateKey, address, password, {
        seedPhrase: seedPhrase || undefined,
        derivationPath: derivationPath || undefined,
        network
      })

      const producerConfigPath = syncNonMainnetProducerRuntimeConfig(address, input, true)

      return {
        ok: true,
        output: appendProducerConfigSyncNote(`Producer account imported for ${address}.`, producerConfigPath),
        address,
        walletFilePath,
        unlocked: true
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not import producer account',
        address: null,
        walletFilePath: deps.telenoProducerWalletFilePath(network),
        unlocked: false
      }
    }
  }

  async function walletListAccounts(input?: WalletListAccountsInput): Promise<WalletListAccountsResult> {
    const network = walletNetwork(input)
    const wallet = deps.loadTelenoWalletFile(network)
    const accounts = deps.listWalletAccounts(network)
    return {
      ok: true,
      output: wallet ? `Loaded ${accounts.length} wallet account(s).` : 'No wallet stored in Koinos One yet.',
      walletAddress: wallet?.address || null,
      activeAccountId: wallet?.activeAccountId || null,
      accounts
    }
  }

  async function walletSetActiveAccount(input?: WalletSetActiveAccountInput): Promise<WalletSetActiveAccountResult> {
    const network = walletNetwork(input)
    try {
      const accountId = `${input?.accountId || ''}`.trim()
      if (!accountId) throw new Error('Account id is required.')
      const account = deps.setActiveWalletAccount(accountId, network)
      const wallet = deps.loadTelenoWalletFile(network)
      if (!account || !wallet) throw new Error('Could not set the active wallet account.')
      const producerConfigPath = syncNonMainnetProducerRuntimeConfig(account.address, input, account.hasPrivateKey)
      return {
        ok: true,
        output: appendProducerConfigSyncNote(`Active wallet account set to ${account.name}.`, producerConfigPath),
        walletAddress: wallet.address,
        activeAccountId: account.id,
        activeAccount: account
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not set active wallet account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        activeAccount: null
      }
    }
  }

  async function walletSetProducerAccount(
    input?: WalletSetProducerAccountInput
  ): Promise<WalletSetProducerAccountResult> {
    const network = walletNetwork(input)
    try {
      const accountId = `${input?.accountId || ''}`.trim()
      if (!accountId) throw new Error('Account id is required.')

      const wallet = deps.loadTelenoWalletFile(network)
      const accounts = deps.listWalletAccounts(network)
      const account = accounts.find((entry) => entry.id === accountId) || null
      if (!wallet || !account) throw new Error('Could not find the selected wallet account.')
      if (!account.hasPrivateKey) throw new Error('Only an account with a private key can be used as producer.')

      const address = account.address.trim()
      if (!deps.safeIsChecksumAddress(address)) throw new Error('Invalid producer address format.')
      if (network === 'mainnet' && isProtectedMainnetProducerAddress(address)) {
        throw new Error(
          'This mainnet producer address is protected by local safety configuration and was not written to runtime config.'
        )
      }
      if (!deps.updateConfigProducerAddress) throw new Error('Producer config update is not available.')

      const configPath = deps.updateConfigProducerAddress(address, input)
      if (!configPath) throw new Error('Could not update runtime producer config.')

      return {
        ok: true,
        output: [
          `Set block_producer.producer = ${address}.`,
          `Updated runtime producer config: ${configPath}`,
          'Restart the node for a running block producer to use this address.'
        ].join('\n'),
        walletAddress: wallet.address,
        activeAccountId: account.id,
        activeAccount: account,
        configPath
      }
    } catch (error) {
      const wallet = deps.loadTelenoWalletFile(network)
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not set wallet account as producer',
        walletAddress: wallet?.address ?? null,
        activeAccountId: wallet?.activeAccountId ?? null,
        activeAccount: null,
        configPath: null
      }
    }
  }

  async function walletCreateDerivedAccount(input?: WalletCreateDerivedAccountInput): Promise<WalletAccountMutationResult> {
    const network = walletNetwork(input)
    try {
      const wallet = deps.loadTelenoWalletFile(network)
      if (!wallet) throw new Error('No wallet stored in Koinos One yet.')
      if (!deps.currentUnlockedProducerWallet(network)?.seedPhrase) {
        throw new Error('Unlock a seed-backed wallet first to derive another account.')
      }
      const account = deps.createDerivedWalletAccount(input?.name, network)
      if (!account) throw new Error('Could not create a derived wallet account.')
      const producerConfigPath = syncNonMainnetProducerRuntimeConfig(account.address, input, account.hasPrivateKey)
      return {
        ok: true,
        output: appendProducerConfigSyncNote(`Created derived wallet account ${account.name}.`, producerConfigPath),
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: account.id,
        account,
        accounts: deps.listWalletAccounts(network)
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not create a derived wallet account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: null,
        accounts: deps.listWalletAccounts(network)
      }
    }
  }

  async function walletImportAccount(input?: WalletImportAccountInput): Promise<WalletAccountMutationResult> {
    const network = walletNetwork(input)
    try {
      const wallet = deps.loadTelenoWalletFile(network)
      if (!wallet) throw new Error('No wallet stored in Koinos One yet.')
      const privateKey = `${input?.privateKey || ''}`.trim()
      const password = `${input?.password || ''}`
      if (!privateKey) throw new Error('Private key is required.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters long.')
      const account = deps.importAdditionalWalletAccount(privateKey, password, input?.name, network)
      if (!account) throw new Error('Could not import the wallet account.')
      const producerConfigPath = syncNonMainnetProducerRuntimeConfig(account.address, input, account.hasPrivateKey)
      return {
        ok: true,
        output: appendProducerConfigSyncNote(`Imported wallet account ${account.name}.`, producerConfigPath),
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: account.id,
        account,
        accounts: deps.listWalletAccounts(network)
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not import the wallet account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: null,
        accounts: deps.listWalletAccounts(network)
      }
    }
  }

  async function walletImportWatchAccount(input?: WalletImportWatchAccountInput): Promise<WalletAccountMutationResult> {
    const network = walletNetwork(input)
    try {
      const wallet = deps.loadTelenoWalletFile(network)
      if (!wallet) throw new Error('No wallet stored in Koinos One yet.')
      const address = `${input?.address || ''}`.trim()
      if (!address) throw new Error('Address is required.')
      const account = deps.importWatchWalletAccount(address, input?.name, network)
      if (!account) throw new Error('Could not import the watch-only account.')
      return {
        ok: true,
        output: `Imported watch-only account ${account.name}.`,
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: account.id,
        account,
        accounts: deps.listWalletAccounts(network)
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not import the watch-only account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: null,
        accounts: deps.listWalletAccounts(network)
      }
    }
  }

  async function walletRenameAccount(input?: WalletRenameAccountInput): Promise<WalletAccountMutationResult> {
    const network = walletNetwork(input)
    try {
      const accountId = `${input?.accountId || ''}`.trim()
      const name = `${input?.name || ''}`.trim()
      if (!accountId) throw new Error('Account id is required.')
      if (!name) throw new Error('Account name is required.')
      const account = deps.renameWalletAccount(accountId, name, network)
      if (!account) throw new Error('Could not rename the wallet account.')
      return {
        ok: true,
        output: `Renamed wallet account to ${account.name}.`,
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account,
        accounts: deps.listWalletAccounts(network)
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not rename the wallet account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: null,
        accounts: deps.listWalletAccounts(network)
      }
    }
  }

  async function walletRemoveAccount(input?: WalletRemoveAccountInput): Promise<WalletAccountMutationResult> {
    const network = walletNetwork(input)
    try {
      const accountId = `${input?.accountId || ''}`.trim()
      if (!accountId) throw new Error('Account id is required.')
      const accounts = deps.removeWalletAccount(accountId, network)
      if (!accounts) throw new Error('Could not remove the wallet account.')
      return {
        ok: true,
        output: 'Wallet account removed.',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: activeWalletSummary(deps.loadTelenoWalletFile(network), accounts),
        accounts
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not remove the wallet account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        activeAccountId: deps.loadTelenoWalletFile(network)?.activeAccountId ?? null,
        account: null,
        accounts: deps.listWalletAccounts(network)
      }
    }
  }

  async function walletShowSeed(input?: WalletShowSeedInput): Promise<WalletShowSeedResult> {
    const network = walletNetwork(input)
    try {
      const walletFile = deps.loadTelenoWalletFile(network)
      if (!walletFile) {
        return {
          ok: false,
          output: 'No producer account stored in Koinos One yet.',
          walletAddress: null,
          accountId: null,
          accountName: null,
          accountKind: null,
          firstAccountAddress: null,
          firstAccountPrivateKeyWif: null,
          firstAccountDerivationPath: null,
          seedPhrase: null
        }
      }

      const unlockedWallet = deps.currentUnlockedProducerWallet(network)
      if (!unlockedWallet || unlockedWallet.address !== walletFile.address) {
        return {
          ok: false,
          output: 'Unlock the wallet first to show the stored secrets.',
          walletAddress: walletFile.address,
          accountId: walletFile.activeAccountId || null,
          accountName: null,
          accountKind: null,
          firstAccountAddress: null,
          firstAccountPrivateKeyWif: null,
          firstAccountDerivationPath: null,
          seedPhrase: null
        }
      }

      const secrets = deps.loadWalletAccountSecrets(input?.accountId, network)
      const seedPhrase = secrets.seedPhrase?.trim() || null
      if (!seedPhrase) {
        return {
          ok: true,
          output: `Stored WIF loaded for ${secrets.accountAddress || walletFile.address}.`,
          walletAddress: walletFile.address,
          accountId: secrets.accountId,
          accountName: secrets.accountName,
          accountKind: secrets.accountKind,
          firstAccountAddress: secrets.accountAddress,
          firstAccountPrivateKeyWif: secrets.privateKeyWif,
          firstAccountDerivationPath: secrets.derivationPath,
          seedPhrase: null
        }
      }

      return {
        ok: true,
        output: `Stored secrets loaded for ${secrets.accountAddress || walletFile.address}.`,
        walletAddress: walletFile.address,
        accountId: secrets.accountId,
        accountName: secrets.accountName,
        accountKind: secrets.accountKind,
        firstAccountAddress: secrets.accountAddress,
        firstAccountPrivateKeyWif: secrets.privateKeyWif,
        firstAccountDerivationPath: secrets.derivationPath,
        seedPhrase
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not load stored wallet secrets',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        accountId: null,
        accountName: null,
        accountKind: null,
        firstAccountAddress: null,
        firstAccountPrivateKeyWif: null,
        firstAccountDerivationPath: null,
        seedPhrase: null
      }
    }
  }

  async function walletDelete(input?: WalletRpcInput): Promise<WalletDeleteResult> {
    const network = walletNetwork(input)
    try {
      const deleted = deps.deleteTelenoWallet(network)
      return {
        ok: deleted,
        output: deleted ? 'Producer account deleted.' : 'No producer account stored.',
        walletFilePath: deps.telenoProducerWalletFilePath(network)
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not delete producer account',
        walletFilePath: deps.telenoProducerWalletFilePath(network)
      }
    }
  }

  async function walletClose(input?: WalletRpcInput): Promise<WalletCloseResult> {
    const network = walletNetwork(input)
    try {
      const walletFile = deps.loadTelenoWalletFile(network)
      if (!walletFile) {
        return {
          ok: false,
          output: 'No producer account stored in Koinos One yet.',
          walletAddress: null,
          unlocked: false
        }
      }

      const walletAddress = deps.closeTelenoWalletSession(network)
      return {
        ok: true,
        output: `Producer account closed for this Koinos One session: ${walletAddress || walletFile.address}.`,
        walletAddress: walletAddress || walletFile.address,
        unlocked: false
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not close producer account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        unlocked: false
      }
    }
  }

  async function walletUnlock(input?: WalletUnlockInput): Promise<WalletUnlockResult> {
    const network = walletNetwork(input)
    try {
      const walletFile = deps.loadTelenoWalletFile(network)
      if (!walletFile) {
        return {
          ok: false,
          output: 'No producer account stored in Koinos One yet.',
          walletAddress: null,
          unlocked: false
        }
      }

      const password = `${input?.password || ''}`
      if (!password) {
        return {
          ok: false,
          output: 'Password is required to unlock the producer account.',
          walletAddress: walletFile.address,
          unlocked: false
        }
      }

      const wallet = deps.unlockTelenoWalletSession(password, network)
      if (!wallet) {
        return {
          ok: false,
          output: 'Could not unlock the producer account.',
          walletAddress: walletFile.address,
          unlocked: false
        }
      }

      return {
        ok: true,
        output: `Producer account unlocked for this Koinos One session: ${wallet.address}.`,
        walletAddress: wallet.address,
        unlocked: true
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not unlock producer account',
        walletAddress: deps.loadTelenoWalletFile(network)?.address ?? null,
        unlocked: false
      }
    }
  }

  async function walletAddressFromWif(input?: WalletAddressInput): Promise<WalletAddressResult> {
    try {
      const privateKey = `${input?.privateKey || ''}`.trim()
      if (!privateKey) throw new Error('Private key is required.')
      const signer = Signer.fromWif(privateKey)
      return {
        ok: true,
        output: 'Address derived successfully.',
        address: signer.getAddress()
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not derive address',
        address: null
      }
    }
  }

  async function walletDeriveFromSeed(input?: WalletDeriveFromSeedInput): Promise<WalletDeriveFromSeedResult> {
    try {
      const seedPhrase = `${input?.seedPhrase || ''}`.trim()
      const numAccounts = Number.isFinite(input?.numAccounts) ? Number(input?.numAccounts) : 2
      if (!seedPhrase) throw new Error('Seed phrase is required.')
      if (!Number.isInteger(numAccounts) || numAccounts < 1 || numAccounts > 100) {
        throw new Error('Number of accounts must be between 1 and 100.')
      }
      const accounts = deriveWalletAccountsFromSeed(seedPhrase, numAccounts)
      return {
        ok: true,
        output: `Derived ${accounts.length} accounts from the seed phrase.`,
        accounts
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not derive accounts',
        accounts: []
      }
    }
  }

  async function walletChainInfo(input?: WalletRpcInput): Promise<WalletChainInfoResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    try {
      const provider = new Provider([rpcUrl])
      const headInfo = await provider.getHeadInfo()
      return {
        ok: true,
        output: `Chain head at ${headInfo.head_topology?.height ?? 'n/a'}.`,
        rpcUrl,
        headHeight: Number.parseInt(`${headInfo.head_topology?.height ?? ''}`, 10) || null,
        headBlockId: `${headInfo.head_topology?.id || ''}` || null,
        lastIrreversibleBlock: Number.parseInt(`${headInfo.last_irreversible_block ?? ''}`, 10) || null,
        headBlockTime: Number.parseInt(`${headInfo.head_block_time ?? ''}`, 10) || null
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not load chain info',
        rpcUrl,
        headHeight: null,
        headBlockId: null,
        lastIrreversibleBlock: null,
        headBlockTime: null
      }
    }
  }

  async function walletBlock(input?: WalletBlockInput): Promise<WalletBlockResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const heightOrId = `${input?.heightOrId || ''}`.trim()
    const full = Boolean(input?.full)
    const emptyResult = (output: string): WalletBlockResult => ({
      ok: false,
      output,
      rpcUrl,
      blockHeight: null,
      blockId: null,
      previous: null,
      timestamp: null,
      signer: null,
      transactionCount: 0,
      diskStorageUsed: null,
      networkBandwidthUsed: null,
      computeBandwidthUsed: null,
      transactions: []
    })
    if (!heightOrId) return emptyResult('Height or block ID is required.')

    try {
      const provider = new Provider([rpcUrl])
      let blockItem: Record<string, unknown> | null = null

      if (/^\d+$/.test(heightOrId)) {
        const headInfo = await provider.getHeadInfo()
        const response = await provider.call<{ block_items?: Array<Record<string, unknown>> }>('block_store.get_blocks_by_height', {
          head_block_id: headInfo.head_topology?.id,
          ancestor_start_height: Number.parseInt(heightOrId, 10),
          num_blocks: 1,
          return_block: true,
          return_receipt: true
        })
        blockItem = Array.isArray(response?.block_items) && response.block_items.length ? response.block_items[0] : null
      } else {
        const response = await provider.call<{ block_items?: Array<Record<string, unknown>> }>('block_store.get_blocks_by_id', {
          block_ids: [heightOrId],
          return_block: true,
          return_receipt: true
        })
        blockItem = Array.isArray(response?.block_items) && response.block_items.length ? response.block_items[0] : null
      }

      if (!blockItem) return emptyResult('Block not found.')

      const block = (blockItem.block as Record<string, unknown> | undefined) || {}
      const header = (block.header as Record<string, unknown> | undefined) || {}
      const receipt = (blockItem.receipt as Record<string, unknown> | undefined) || {}
      const rawTransactions = Array.isArray(block.transactions) ? block.transactions : []
      const transactions: WalletBlockTransaction[] = rawTransactions.map((transaction) => {
        const typedTransaction = (transaction as Record<string, unknown>) || {}
        const operations = Array.isArray(typedTransaction.operations) ? typedTransaction.operations : []
        return {
          id: `${typedTransaction.id || ''}` || null,
          payer: `${(typedTransaction.header as Record<string, unknown> | undefined)?.payer || ''}` || null,
          operationCount: operations.length,
          operations: full
            ? operations.map((operation) => {
                const typedOperation = (operation as Record<string, unknown>) || {}
                const callContract = (typedOperation.call_contract as Record<string, unknown> | undefined) || null
                if (callContract) {
                  return {
                    kind: 'call_contract',
                    contractId: `${callContract.contract_id || ''}` || null,
                    entryPoint: callContract.entry_point === undefined ? null : `${callContract.entry_point}`
                  } satisfies WalletBlockOperation
                }
                if (typedOperation.upload_contract) {
                  return {
                    kind: 'upload_contract',
                    contractId: null,
                    entryPoint: null
                  } satisfies WalletBlockOperation
                }
                return {
                  kind: 'unknown',
                  contractId: null,
                  entryPoint: null
                } satisfies WalletBlockOperation
              })
            : []
        }
      })

      return {
        ok: true,
        output: `Loaded block ${blockItem.block_height ?? heightOrId}.`,
        rpcUrl,
        blockHeight: Number.parseInt(`${blockItem.block_height ?? ''}`, 10) || null,
        blockId: `${blockItem.block_id || ''}` || null,
        previous: `${header.previous || ''}` || null,
        timestamp: Number.parseInt(`${header.timestamp ?? ''}`, 10) || null,
        signer: `${header.signer || ''}` || null,
        transactionCount: transactions.length,
        diskStorageUsed: Number.parseInt(`${receipt.disk_storage_used ?? ''}`, 10) || null,
        networkBandwidthUsed: Number.parseInt(`${receipt.network_bandwidth_used ?? ''}`, 10) || null,
        computeBandwidthUsed: Number.parseInt(`${receipt.compute_bandwidth_used ?? ''}`, 10) || null,
        transactions
      }
    } catch (error) {
      return emptyResult(error instanceof Error ? error.message : 'Could not load block')
    }
  }

  async function walletBalance(input?: WalletAddressQueryInput): Promise<WalletBalanceResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contracts = contractsForNetwork(input?.network ?? 'mainnet')
    const address = deps.resolveWalletQueryAddress(input?.address, input?.accountId)
    const empty = (output: string): WalletBalanceResult => ({
      ok: false,
      output,
      rpcUrl,
      address,
      koin: null,
      vhp: null,
      mana: null
    })
    if (!address) return empty('No address provided and no default account configured.')
    try {
      const provider = new Provider([rpcUrl])
      const [koin, vhp] = await Promise.all([
        deps.loadContractWithFetchedAbi(provider, contracts.koin),
        deps.loadContractWithFetchedAbi(provider, contracts.vhp)
      ])
      const [{ result: koinResult }, { result: vhpResult }, rc] = await Promise.all([
        koin.functions.balance_of({ owner: address }),
        vhp.functions.balance_of({ owner: address }),
        provider.getAccountRc(address)
      ])
      return {
        ok: true,
        output: `Balances loaded for ${address}.`,
        rpcUrl,
        address,
        koin: deps.formatWholeUnits(koinResult?.value) || '0',
        vhp: deps.formatWholeUnits(vhpResult?.value) || '0',
        mana: deps.formatWholeUnits(rc) || '0'
      }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load balances')
    }
  }

  async function walletVhp(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contracts = contractsForNetwork(input?.network ?? 'mainnet')
    const address = deps.resolveWalletQueryAddress(input?.address, input?.accountId)
    const empty = (output: string): WalletScalarResult => ({ ok: false, output, rpcUrl, address, value: null, unit: 'VHP' })
    if (!address) return empty('Address is required.')
    try {
      const provider = new Provider([rpcUrl])
      const vhp = await deps.loadContractWithFetchedAbi(provider, contracts.vhp)
      const { result } = await vhp.functions.balance_of({ owner: address })
      return { ok: true, output: `VHP loaded for ${address}.`, rpcUrl, address, value: deps.formatWholeUnits(result?.value) || '0', unit: 'VHP' }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load VHP balance')
    }
  }

  async function walletNonce(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const address = deps.resolveWalletQueryAddress(input?.address, input?.accountId)
    const empty = (output: string): WalletScalarResult => ({ ok: false, output, rpcUrl, address, value: null, unit: 'nonce' })
    if (!address) return empty('Address is required.')
    try {
      const provider = new Provider([rpcUrl])
      const nonce = await provider.getNonce(address)
      return { ok: true, output: `Nonce loaded for ${address}.`, rpcUrl, address, value: `${nonce}`, unit: 'nonce' }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load nonce')
    }
  }

  async function walletRc(input?: WalletAddressQueryInput): Promise<WalletScalarResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const address = deps.resolveWalletQueryAddress(input?.address, input?.accountId)
    const empty = (output: string): WalletScalarResult => ({ ok: false, output, rpcUrl, address, value: null, unit: 'mana' })
    if (!address) return empty('Address is required.')
    try {
      const provider = new Provider([rpcUrl])
      const rc = await provider.getAccountRc(address)
      return { ok: true, output: `Resource credits loaded for ${address}.`, rpcUrl, address, value: deps.formatWholeUnits(rc) || '0', unit: 'mana' }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load resource credits')
    }
  }

  async function walletTokenBalance(input?: WalletTokenBalanceInput): Promise<WalletTokenBalanceResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contractId = `${input?.contractId || ''}`.trim() || null
    const address = deps.resolveWalletQueryAddress(input?.address, input?.accountId)
    const empty = (output: string): WalletTokenBalanceResult => ({
      ok: false,
      output,
      rpcUrl,
      contractId,
      address,
      tokenName: null,
      tokenSymbol: null,
      decimals: null,
      balance: null
    })
    if (!contractId || !address) return empty('Contract ID and address are required.')
    try {
      const provider = new Provider([rpcUrl])
      const contract = await deps.loadContractWithFetchedAbi(provider, contractId)
      const [nameResult, symbolResult, decimalsResult, balanceResult] = await Promise.all([
        contract.functions.name ? contract.functions.name({}) : { result: { value: 'Unknown' } },
        contract.functions.symbol ? contract.functions.symbol({}) : { result: { value: '???' } },
        contract.functions.decimals ? contract.functions.decimals({}) : { result: { value: 8 } },
        contract.functions.balance_of({ owner: address })
      ])
      const decimals = Number.parseInt(`${decimalsResult.result?.value ?? '8'}`, 10)
      return {
        ok: true,
        output: `Token balance loaded for ${address}.`,
        rpcUrl,
        contractId,
        address,
        tokenName: `${nameResult.result?.value || 'Unknown'}`,
        tokenSymbol: `${symbolResult.result?.value || '???'}`,
        decimals: Number.isFinite(decimals) ? decimals : 8,
        balance: deps.formatWholeUnits(balanceResult.result?.value, Number.isFinite(decimals) ? decimals : 8) || '0'
      }
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Could not load token balance')
    }
  }

  async function walletReadContract(input?: WalletReadContractInput): Promise<WalletReadContractResult> {
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contractId = `${input?.contractId || ''}`.trim() || null
    const method = `${input?.method || ''}`.trim() || null
    let args: Record<string, unknown> = {}
    try {
      args = deps.parseWalletArgs(input?.args)
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Invalid JSON arguments',
        rpcUrl,
        contractId,
        method,
        args: {},
        result: undefined
      }
    }
    if (!contractId || !method) {
      return {
        ok: false,
        output: 'Contract ID and method are required.',
        rpcUrl,
        contractId,
        method,
        args,
        result: undefined
      }
    }
    try {
      const provider = new Provider([rpcUrl])
      const contract = await deps.loadContractWithFetchedAbi(provider, contractId)
      const handler = contract.functions[method]
      if (typeof handler !== 'function') throw new Error(`Method ${method} was not found in the contract ABI.`)
      const { result } = await handler(args)
      return {
        ok: true,
        output: `Contract method ${method} executed successfully.`,
        rpcUrl,
        contractId,
        method,
        args,
        result
      }
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : 'Could not read contract method',
        rpcUrl,
        contractId,
        method,
        args,
        result: undefined
      }
    }
  }

  async function walletBurn(input?: WalletBurnInput): Promise<WalletBurnResult> {
    const network = walletNetwork(input)
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contracts = contractsForNetwork(network)
    const dryRun = Boolean(input?.dryRun)
    const useFreeMana = Boolean(input?.useFreeMana)
    const requestedAccountId = `${input?.accountId || ''}`.trim()
    const useProducerBurnAccount = input?.useProducerBurnAccount !== false
    const producerProfile = deps.loadProducerProfile(network)
    const requestedTargetAddress = `${input?.targetAddress || ''}`.trim()
    const fail = (output: string): WalletBurnResult => ({
      ok: false,
      output,
      rpcUrl,
      dryRun,
      walletAddress: null,
      targetAddress: null,
      burnAmountKoin: null,
      remainingKoin: null,
      previousKoin: null,
      previousVhp: null,
      newKoin: null,
      newVhp: null,
      usedFreeMana: useFreeMana,
      payer: null,
      txId: null
    })

    const walletFile = deps.loadTelenoWalletFile(network)
    if (!walletFile) return fail('No producer account stored in Koinos One yet.')

    const hasPercent = typeof input?.percent === 'number' && Number.isFinite(input.percent)
    const hasAmount = typeof input?.amount === 'number' && Number.isFinite(input.amount)
    if (!hasPercent && !hasAmount) return fail('Provide either a percent or an amount to burn.')
    if (hasPercent && hasAmount) return fail('Percent and amount are mutually exclusive.')

    try {
      const password = `${input?.password || ''}`
      const wallet = deps.currentUnlockedProducerWallet(network) || (password ? deps.unlockTelenoWalletSession(password, network) : null)
      if (!wallet) return fail('Producer account is locked. Unlock it in the Producer tab.')
      const signingAccount = resolveUnlockedWalletAccount(wallet, requestedAccountId)
      if (!signingAccount) return fail('Selected wallet account is not unlocked in this Koinos One session.')
      if (!signingAccount.privateKey) return fail('Selected wallet account is watch-only and cannot sign transactions.')
      if (useProducerBurnAccount) {
        if (!producerProfile?.burnAccountId) return fail('No producer burn account is configured yet.')
        const producerBurnRef = producerProfile.burnAccountId.toLowerCase()
        if (producerBurnRef !== signingAccount.id.toLowerCase() && producerBurnRef !== signingAccount.address.toLowerCase()) {
          return fail('Unlocked wallet does not match the configured producer burn account.')
        }
      }
      const targetAddress = requestedTargetAddress || signingAccount.address
      if (!deps.safeIsChecksumAddress(targetAddress)) {
        return fail('Invalid target address for VHP allocation.')
      }
      const provider = new Provider([rpcUrl])
      const signer = Signer.fromWif(signingAccount.privateKey)
      signer.provider = provider

      const [koin, vhp, pob] = await Promise.all([
        deps.loadContractWithFetchedAbi(provider, contracts.koin),
        deps.loadContractWithFetchedAbi(provider, contracts.vhp),
        deps.loadContractWithFetchedAbi(provider, contracts.pob)
      ])
      koin.signer = signer
      pob.signer = signer

      const [{ result: koinBalanceResult }, { result: oldVhpResult }, manaRaw] = await Promise.all([
        koin.functions.balance_of({ owner: signingAccount.address }),
        vhp.functions.balance_of({ owner: signingAccount.address }),
        provider.getAccountRc(signingAccount.address)
      ])

      const currentBalance = BigInt(koinBalanceResult?.value || '0')
      if (currentBalance <= BigInt(0)) return fail('No KOIN balance available to burn.')

      const percent = hasPercent ? Number(input?.percent) : null
      const amount = hasAmount ? Number(input?.amount) : null
      if (percent !== null && (percent <= 0 || percent > 100)) return fail('Percent must be between 0 and 100.')
      if (amount !== null && amount <= 0) return fail('Amount must be greater than zero.')

      const burnAmount =
        amount !== null
          ? BigInt(Math.floor(amount * 1e8))
          : (currentBalance * BigInt(Math.floor((percent || 0) * 100))) / BigInt(10000)

      if (burnAmount <= BigInt(0)) return fail('Computed burn amount is zero.')
      if (burnAmount > currentBalance) return fail('Insufficient KOIN balance for that burn amount.')

      const remainingAmount = currentBalance - burnAmount
      const manaValue = manaRaw ? BigInt(manaRaw) : BigInt(0)
      if (!useFreeMana && manaValue < BigInt(50_000_000)) return fail('Insufficient mana to execute burn transaction.')

      let currentAllowance = BigInt(0)
      try {
        const { result: allowanceResult } = await koin.functions.allowance({
          owner: signingAccount.address,
          spender: contracts.pob
        })
        currentAllowance = BigInt(allowanceResult?.value || '0')
      } catch {
        currentAllowance = BigInt(0)
      }

      const operations: Array<Record<string, unknown>> = []
      if (currentAllowance < burnAmount) {
        const { operation: approveOp } = await koin.functions.approve(
          {
            owner: signingAccount.address,
            spender: contracts.pob,
            value: burnAmount.toString()
          },
          { onlyOperation: true }
        )
        operations.push(approveOp)
      }

      const { operation: burnOp } = await pob.functions.burn(
        {
          token_amount: burnAmount.toString(),
          burn_address: signingAccount.address,
          vhp_address: targetAddress
        },
        { onlyOperation: true }
      )
      operations.push(burnOp)

      const freeManaPrepared = useFreeMana
        ? await prepareWalletTransactionWithFreeMana({
            signer,
            provider,
            walletAddress: signingAccount.address,
            operations
          })
        : null
      const transaction =
        freeManaPrepared?.transaction ||
        new Transaction({
          signer,
          provider,
          options: {
            rcLimit: ((manaValue * BigInt(10)) / BigInt(100)).toString()
          }
        })
      const payerAddress = freeManaPrepared?.payerAddress || signingAccount.address

      if (!freeManaPrepared) {
        for (const operation of operations) {
          await transaction.pushOperation(operation)
        }
        await transaction.prepare()
      }

      if (dryRun) {
        return {
          ok: true,
          output: useFreeMana
            ? `Dry run prepared ${operations.length} operation(s) for burn using free mana.`
            : `Dry run prepared ${operations.length} operation(s) for burn.`,
          rpcUrl,
          dryRun: true,
          walletAddress: signingAccount.address,
          targetAddress,
          burnAmountKoin: deps.formatWholeUnits(burnAmount),
          remainingKoin: deps.formatWholeUnits(remainingAmount),
          previousKoin: deps.formatWholeUnits(currentBalance),
          previousVhp: deps.formatWholeUnits(oldVhpResult?.value) || '0',
          newKoin: null,
          newVhp: null,
          usedFreeMana: useFreeMana,
          payer: payerAddress,
          txId: transaction.transaction.id || null
        }
      }

      transaction.transaction.signatures = []
      await transaction.sign()
      await transaction.send()
      try {
        await transaction.wait('byTransactionId', 60_000)
      } catch {
        // best effort
      }

      const [{ result: newKoinResult }, { result: newVhpResult }] = await Promise.all([
        koin.functions.balance_of({ owner: signingAccount.address }),
        vhp.functions.balance_of({ owner: signingAccount.address })
      ])

      return {
        ok: true,
        output: useFreeMana
          ? `Burn transaction submitted from ${signingAccount.address} into VHP for ${targetAddress} using free mana.`
          : `Burn transaction submitted from ${signingAccount.address} into VHP for ${targetAddress}.`,
        rpcUrl,
        dryRun: false,
        walletAddress: signingAccount.address,
        targetAddress,
        burnAmountKoin: deps.formatWholeUnits(burnAmount),
        remainingKoin: deps.formatWholeUnits(remainingAmount),
        previousKoin: deps.formatWholeUnits(currentBalance),
        previousVhp: deps.formatWholeUnits(oldVhpResult?.value) || '0',
        newKoin: deps.formatWholeUnits(newKoinResult?.value) || '0',
        newVhp: deps.formatWholeUnits(newVhpResult?.value) || '0',
        usedFreeMana: useFreeMana,
        payer: payerAddress,
        txId: transaction.transaction.id || null
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Could not burn KOIN')
    }
  }

  async function walletTransferVhp(input?: WalletTransferVhpInput): Promise<WalletTransferVhpResult> {
    const network = walletNetwork(input)
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contracts = contractsForNetwork(network)
    const dryRun = Boolean(input?.dryRun)
    const useFreeMana = Boolean(input?.useFreeMana)
    const toAddress = `${input?.toAddress || ''}`.trim()
    const requestedAccountId = `${input?.accountId || ''}`.trim()
    const fail = (output: string): WalletTransferVhpResult => ({
      ok: false,
      output,
      rpcUrl,
      dryRun,
      fromAddress: null,
      toAddress: toAddress || null,
      amountVhp: null,
      usedFreeMana: useFreeMana,
      payer: null,
      txId: null
    })

    if (!deps.safeIsChecksumAddress(toAddress)) return fail('A valid target address is required.')
    const amount = typeof input?.amount === 'number' && Number.isFinite(input.amount) ? Number(input.amount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) return fail('Transfer amount must be greater than zero.')

    const walletFile = deps.loadTelenoWalletFile(network)
    if (!walletFile) return fail('No producer account stored in Koinos One yet.')

    try {
      const password = `${input?.password || ''}`
      const wallet = deps.currentUnlockedProducerWallet(network) || (password ? deps.unlockTelenoWalletSession(password, network) : null)
      if (!wallet) return fail('Producer account is locked. Unlock it in the Wallet tab.')
      const signingAccount = resolveUnlockedWalletAccount(wallet, requestedAccountId)
      if (!signingAccount) return fail('Selected wallet account is not unlocked in this Koinos One session.')
      if (!signingAccount.privateKey) return fail('Selected wallet account is watch-only and cannot sign transactions.')

      const provider = new Provider([rpcUrl])
      const signer = Signer.fromWif(signingAccount.privateKey)
      signer.provider = provider
      const vhp = await deps.loadContractWithFetchedAbi(provider, contracts.vhp)
      vhp.signer = signer

      const transferAmount = BigInt(Math.floor(amount * 1e8))
      if (transferAmount <= BigInt(0)) return fail('Transfer amount is too small.')

      const [{ result: vhpBalance }, manaRaw] = await Promise.all([
        vhp.functions.balance_of({ owner: signingAccount.address }),
        provider.getAccountRc(signingAccount.address)
      ])
      const currentVhpBalance = BigInt(`${vhpBalance?.value || '0'}`)
      if (transferAmount > currentVhpBalance) return fail('Insufficient VHP balance for transfer.')
      const manaValue = manaRaw ? BigInt(manaRaw) : BigInt(0)
      if (!useFreeMana && manaValue < BigInt(50_000_000)) return fail('Insufficient mana to execute VHP transfer.')

      const { operation } = await vhp.functions.transfer(
        {
          from: signingAccount.address,
          to: toAddress,
          value: transferAmount.toString()
        },
        { onlyOperation: true }
      )

      const freeManaPrepared = useFreeMana
        ? await prepareWalletTransactionWithFreeMana({
            signer,
            provider,
            walletAddress: signingAccount.address,
            operations: [operation]
          })
        : null
      const transaction =
        freeManaPrepared?.transaction ||
        new Transaction({
          signer,
          provider,
          options: {
            rcLimit: ((manaValue * BigInt(10)) / BigInt(100)).toString()
          }
        })
      const payerAddress = freeManaPrepared?.payerAddress || signingAccount.address

      if (!freeManaPrepared) {
        await transaction.pushOperation(operation)
        await transaction.prepare()
      }

      if (dryRun) {
        return {
          ok: true,
          output: useFreeMana
            ? 'Dry run prepared VHP transfer operation using free mana.'
            : 'Dry run prepared VHP transfer operation.',
          rpcUrl,
          dryRun: true,
          fromAddress: signingAccount.address,
          toAddress,
          amountVhp: deps.formatWholeUnits(transferAmount),
          usedFreeMana: useFreeMana,
          payer: payerAddress,
          txId: transaction.transaction.id || null
        }
      }

      transaction.transaction.signatures = []
      await transaction.sign()
      await transaction.send()
      try {
        await transaction.wait('byTransactionId', 60_000)
      } catch {
        // best effort
      }

      return {
        ok: true,
        output: useFreeMana
          ? `VHP transfer submitted from ${signingAccount.address} to ${toAddress} using free mana.`
          : `VHP transfer submitted from ${signingAccount.address} to ${toAddress}.`,
        rpcUrl,
        dryRun: false,
        fromAddress: signingAccount.address,
        toAddress,
        amountVhp: deps.formatWholeUnits(transferAmount),
        usedFreeMana: useFreeMana,
        payer: payerAddress,
        txId: transaction.transaction.id || null
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Could not transfer VHP')
    }
  }

  async function walletTransferKoin(input?: WalletTransferKoinInput): Promise<WalletTransferKoinResult> {
    const network = walletNetwork(input)
    const rpcUrl = deps.resolveWalletRpcUrl(input)
    const contracts = contractsForNetwork(network)
    const dryRun = Boolean(input?.dryRun)
    const useFreeMana = Boolean(input?.useFreeMana)
    const toAddress = `${input?.toAddress || ''}`.trim()
    const requestedAccountId = `${input?.accountId || ''}`.trim()
    const fail = (output: string): WalletTransferKoinResult => ({
      ok: false,
      output,
      rpcUrl,
      dryRun,
      fromAddress: null,
      toAddress: toAddress || null,
      amountKoin: null,
      usedFreeMana: useFreeMana,
      payer: null,
      txId: null
    })

    if (!deps.safeIsChecksumAddress(toAddress)) return fail('A valid target address is required.')
    const amount = typeof input?.amount === 'number' && Number.isFinite(input.amount) ? Number(input.amount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) return fail('Transfer amount must be greater than zero.')

    const walletFile = deps.loadTelenoWalletFile(network)
    if (!walletFile) return fail('No producer account stored in Koinos One yet.')

    try {
      const password = `${input?.password || ''}`
      const wallet = deps.currentUnlockedProducerWallet(network) || (password ? deps.unlockTelenoWalletSession(password, network) : null)
      if (!wallet) return fail('Producer account is locked. Unlock it in the Wallet tab.')
      const signingAccount = resolveUnlockedWalletAccount(wallet, requestedAccountId)
      if (!signingAccount) return fail('Selected wallet account is not unlocked in this Koinos One session.')
      if (!signingAccount.privateKey) return fail('Selected wallet account is watch-only and cannot sign transactions.')

      const provider = new Provider([rpcUrl])
      const signer = Signer.fromWif(signingAccount.privateKey)
      signer.provider = provider
      const koin = await deps.loadContractWithFetchedAbi(provider, contracts.koin)
      koin.signer = signer

      const transferAmount = BigInt(Math.floor(amount * 1e8))
      if (transferAmount <= BigInt(0)) return fail('Transfer amount is too small.')

      const [{ result: koinBalance }, manaRaw] = await Promise.all([
        koin.functions.balance_of({ owner: signingAccount.address }),
        provider.getAccountRc(signingAccount.address)
      ])
      const currentKoinBalance = BigInt(`${koinBalance?.value || '0'}`)
      if (transferAmount > currentKoinBalance) return fail('Insufficient KOIN balance for transfer.')
      const manaValue = manaRaw ? BigInt(manaRaw) : BigInt(0)
      if (transferAmount > manaValue) {
        return fail('The KOIN contract requires mana greater than or equal to the transfer amount.')
      }
      if (!useFreeMana && manaValue < BigInt(50_000_000)) return fail('Insufficient mana to execute KOIN transfer.')

      const { operation } = await koin.functions.transfer(
        {
          from: signingAccount.address,
          to: toAddress,
          value: transferAmount.toString()
        },
        { onlyOperation: true }
      )

      const freeManaPrepared = useFreeMana
        ? await prepareWalletTransactionWithFreeMana({
            signer,
            provider,
            walletAddress: signingAccount.address,
            operations: [operation]
          })
        : null
      const transaction =
        freeManaPrepared?.transaction ||
        new Transaction({
          signer,
          provider,
          options: {
            rcLimit: ((manaValue * BigInt(10)) / BigInt(100)).toString()
          }
        })
      const payerAddress = freeManaPrepared?.payerAddress || signingAccount.address

      if (!freeManaPrepared) {
        await transaction.pushOperation(operation)
        await transaction.prepare()
      }

      if (dryRun) {
        return {
          ok: true,
          output: useFreeMana
            ? 'Dry run prepared KOIN transfer operation using free mana.'
            : 'Dry run prepared KOIN transfer operation.',
          rpcUrl,
          dryRun: true,
          fromAddress: signingAccount.address,
          toAddress,
          amountKoin: deps.formatWholeUnits(transferAmount),
          usedFreeMana: useFreeMana,
          payer: payerAddress,
          txId: transaction.transaction.id || null
        }
      }

      transaction.transaction.signatures = []
      await transaction.sign()
      await transaction.send()
      try {
        await transaction.wait('byTransactionId', 60_000)
      } catch {
        // best effort
      }

      return {
        ok: true,
        output: useFreeMana
          ? `KOIN transfer submitted from ${signingAccount.address} to ${toAddress} using free mana.`
          : `KOIN transfer submitted from ${signingAccount.address} to ${toAddress}.`,
        rpcUrl,
        dryRun: false,
        fromAddress: signingAccount.address,
        toAddress,
        amountKoin: deps.formatWholeUnits(transferAmount),
        usedFreeMana: useFreeMana,
        payer: payerAddress,
        txId: transaction.transaction.id || null
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Could not transfer KOIN')
    }
  }

  return {
    walletOverview,
    walletGenerate,
    walletImport,
    walletListAccounts,
    walletSetActiveAccount,
    walletSetProducerAccount,
    walletCreateDerivedAccount,
    walletImportAccount,
    walletImportWatchAccount,
    walletRenameAccount,
    walletRemoveAccount,
    walletShowSeed,
    walletDelete,
    walletClose,
    walletUnlock,
    walletAddressFromWif,
    walletDeriveFromSeed,
    walletChainInfo,
    walletBlock,
    walletBalance,
    walletVhp,
    walletNonce,
    walletRc,
    walletTokenBalance,
    walletReadContract,
    walletBurn,
    walletTransferVhp,
    walletTransferKoin
  }
}
