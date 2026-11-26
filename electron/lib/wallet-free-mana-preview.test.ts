import { beforeEach, describe, expect, it, vi } from 'vitest'

const trace = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; transaction?: { signatures: string[]; header: Record<string, string> }; broadcast?: boolean }>,
  meterRc: '1000000000'
}))

vi.mock('koilib', () => {
  class Provider {
    constructor(_urls: string[]) {}
    async getAccountRc(address: string) {
      trace.calls.push({ method: `getAccountRc:${address}` })
      return address === '1MqveNK3piSGPHGocsRUCVhpCPLgQA58K9' ? trace.meterRc : '1000000000'
    }
    async sendTransaction(transaction: { signatures?: string[]; header?: Record<string, string> }, broadcast?: boolean) {
      trace.calls.push({
        method: 'chain.submit_transaction',
        transaction: { signatures: [...(transaction.signatures || [])], header: { ...(transaction.header || {}) } },
        broadcast
      })
      return { transaction: { ...transaction, wait: async () => ({}) }, receipt: { rc_used: '1000000' } }
    }
  }

  class Signer {
    provider?: Provider
    static fromWif(_wif: string) { return new Signer() }
    getAddress() { return 'synthetic-account' }
    async signTransaction(transaction: { signatures?: string[] }) {
      trace.calls.push({ method: 'signTransaction' })
      transaction.signatures = ['synthetic-signature']
      return transaction
    }
    async sendTransaction(transaction: { signatures?: string[] }, options?: { broadcast?: boolean }) {
      if (!transaction.signatures?.length) await this.signTransaction(transaction)
      return this.provider!.sendTransaction(transaction, options?.broadcast)
    }
  }

  class Transaction {
    signer: Signer
    provider: Provider
    transaction: { id?: string; header: Record<string, string>; signatures: string[]; operations: unknown[] }
    constructor({ signer, provider, options }: { signer: Signer; provider: Provider; options: { payer?: string; payee?: string; rcLimit?: string } }) {
      this.signer = signer
      this.provider = provider
      this.transaction = { header: { payer: options.payer || 'synthetic-account', payee: options.payee || '', rc_limit: options.rcLimit || '' }, signatures: [], operations: [] }
    }
    static computeTransactionId(header: Record<string, string>) { return JSON.stringify(header) }
    async pushOperation(operation: unknown) { this.transaction.operations.push(operation) }
    async prepare() {
      this.transaction.header = { ...this.transaction.header, chain_id: 'synthetic-chain', nonce: '1', operation_merkle_root: 'synthetic-root' }
      this.transaction.id = Transaction.computeTransactionId(this.transaction.header)
    }
    async sign() { await this.signer.signTransaction(this.transaction) }
    async send(options?: { broadcast?: boolean }) {
      const sent = this.transaction.signatures.length
        ? await this.provider.sendTransaction(this.transaction, options?.broadcast)
        : await this.signer.sendTransaction(this.transaction, options)
      return sent.receipt
    }
    async wait() { return {} }
  }

  return { Provider, Signer, Transaction, Contract: class {} }
})

import { createWalletService } from './wallet-service'
import { contractsForNetwork } from './network-profiles'

function service() {
  const account = { id: 'synthetic-id', address: 'synthetic-account', privateKey: 'synthetic-wif' }
  const record = <T>(method: string, response: T) => async () => {
    trace.calls.push({ method })
    return response
  }
  const contracts = {
    koin: { functions: {
      balance_of: record('koin.balance_of', { result: { value: '1000000000' } }),
      allowance: record('koin.allowance', { result: { value: '1000000000' } }),
      transfer: record('koin.transfer:onlyOperation', { operation: { koin_transfer: {} } }),
      approve: record('koin.approve:onlyOperation', { operation: { koin_approve: {} } })
    } },
    vhp: { functions: {
      balance_of: record('vhp.balance_of', { result: { value: '1000000000' } }),
      transfer: record('vhp.transfer:onlyOperation', { operation: { vhp_transfer: {} } })
    } },
    pob: { functions: { burn: record('pob.burn:onlyOperation', { operation: { burn: {} } }) } }
  }
  const addresses = contractsForNetwork('mainnet')
  return createWalletService({
    loadTelenoWalletFile: () => ({ address: account.address }),
    currentUnlockedProducerWallet: () => ({ accounts: [account], activeAccountId: account.id }),
    resolveWalletRpcUrl: () => 'http://synthetic.invalid/',
    loadContractWithFetchedAbi: async (_provider: unknown, id: string) => {
      if (id === addresses.koin) return contracts.koin as never
      if (id === addresses.vhp) return contracts.vhp as never
      if (id === addresses.pob) return contracts.pob as never
      throw new Error(`Unexpected contract: ${id}`)
    },
    formatWholeUnits: (value: bigint | string | number | null | undefined) => `${value}`,
    safeIsChecksumAddress: () => true,
    loadProducerProfile: () => null
  } as unknown as Parameters<typeof createWalletService>[0])
}

const operations = [
  { name: 'KOIN transfer', run: (wallet: ReturnType<typeof service>, dryRun: boolean, useFreeMana: boolean) => wallet.walletTransferKoin({ amount: 1, toAddress: 'synthetic-recipient', dryRun, useFreeMana }) },
  { name: 'VHP transfer', run: (wallet: ReturnType<typeof service>, dryRun: boolean, useFreeMana: boolean) => wallet.walletTransferVhp({ amount: 1, toAddress: 'synthetic-recipient', dryRun, useFreeMana }) },
  { name: 'burn', run: (wallet: ReturnType<typeof service>, dryRun: boolean, useFreeMana: boolean) => wallet.walletBurn({ amount: 1, targetAddress: 'synthetic-recipient', useProducerBurnAccount: false, dryRun, useFreeMana }) }
]

beforeEach(() => { trace.calls.length = 0; trace.meterRc = '1000000000' })

describe('wallet preview signing boundary', () => {
  it.each(operations)('$name keeps normal and sponsored previews unsigned', async ({ run }) => {
    for (const useFreeMana of [false, true]) {
      trace.calls.length = 0
      const result = await run(service(), true, useFreeMana)
      expect(result.ok).toBe(true)
      expect(trace.calls.filter((call) => call.method === 'signTransaction')).toHaveLength(0)
      expect(trace.calls.filter((call) => call.method === 'chain.submit_transaction')).toHaveLength(0)
      if (useFreeMana) expect(result.txId).toBeNull()
    }
  })

  it.each(operations)('$name signs and sends only after the final action', async ({ run }) => {
    const result = await run(service(), false, true)
    expect(result.ok).toBe(true)
    expect(trace.calls.some((call) => call.method === 'signTransaction')).toBe(true)
    expect(trace.calls.some((call) => call.method === 'chain.submit_transaction' && call.broadcast !== false && call.transaction?.signatures.length)).toBe(true)
  })

  it('rejects an unavailable free-mana meter before signing or sending', async () => {
    trace.meterRc = '0'
    const result = await operations[0].run(service(), true, true)
    expect(result.ok).toBe(false)
    expect(trace.calls.some((call) => call.method === 'signTransaction' || call.method === 'chain.submit_transaction')).toBe(false)
  })
})
