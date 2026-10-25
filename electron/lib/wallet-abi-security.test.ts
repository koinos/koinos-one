import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Contract, utils, type Abi } from 'koilib'
import { createCachedContractLoader } from './contract-loader'
import { resolveCoreContractAbi } from './core-contract-abis'
import { MAINNET_CONTRACTS } from './network-profiles'
import { createWalletService } from './wallet-service'

const servers: http.Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
})

const address = utils.bitcoinAddress(new Uint8Array(33).fill(41))
const contractId = utils.bitcoinAddress(new Uint8Array(33).fill(42))
const validAbi: Abi = {
  methods: {
    name: { argument: 'pkg.Empty', return: 'pkg.Text', entry_point: 1, read_only: true },
    symbol: { argument: 'pkg.Empty', return: 'pkg.Text', entry_point: 2, read_only: true },
    decimals: { argument: 'pkg.Empty', return: 'pkg.Number', entry_point: 3, read_only: true },
    balance_of: { argument: 'pkg.Owner', return: 'pkg.Amount', entry_point: 4, read_only: true }
  },
  koilib_types: { nested: { pkg: { nested: {
    Empty: { fields: {} },
    Owner: { fields: { owner: { type: 'bytes', id: 1, options: { '(koinos.btype)': 'ADDRESS' } } } },
    Text: { fields: { value: { type: 'string', id: 1 } } },
    Number: { fields: { value: { type: 'uint32', id: 1 } } },
    Amount: { fields: { value: { type: 'uint64', id: 1, options: { jstype: 'JS_STRING' } } } }
  } } } }
}

function makeService(url: string) {
  const loader = createCachedContractLoader((abi) => abi, (id) => resolveCoreContractAbi(id) as Abi | null)
  return createWalletService({
    resolveWalletRpcUrl: () => url,
    resolveWalletQueryAddress: (value) => value || address,
    parseWalletArgs: (value) => typeof value === 'string' ? JSON.parse(value) : value || {},
    formatWholeUnits: (value, decimals = 8) => utils.formatUnits(`${value ?? 0}`, decimals).replace(/\.0+$/, ''),
    loadContractWithFetchedAbi: loader
  } as Parameters<typeof createWalletService>[0])
}

async function mockRpc() {
  const metadata = new Map<string, Abi>([[contractId, validAbi]])
  const methods: string[] = []
  const server = http.createServer(async (request, response) => {
    try {
      let body = ''
      for await (const chunk of request) body += chunk
      const call = JSON.parse(body)
      methods.push(call.method)
      let result: unknown
      if (call.method === 'contract_meta_store.get_contract_meta') {
        const abi = metadata.get(call.params.contract_id)
        if (!abi) throw new Error('Core ABI must come from bundled data')
        result = { meta: { abi: JSON.stringify(abi) } }
      } else if (call.method === 'chain.get_account_rc') {
        result = { rc: '300000000' }
      } else if (call.method === 'chain.read_contract') {
        const id = call.params.contract_id
        const abi = id === contractId ? validAbi : resolveCoreContractAbi(id) as Abi
        const contract = new Contract({ id, abi })
        const [name, method] = Object.entries(abi.methods).find(([, method]) => method.entry_point === call.params.entry_point)!
        const value = name === 'name' ? 'Synthetic' : name === 'symbol' ? 'SYN' : name === 'decimals' ? 0 : id === MAINNET_CONTRACTS.koin ? '100000000' : id === MAINNET_CONTRACTS.vhp ? '200000000' : '7'
        const bytes = await contract.serializer!.serialize({ value }, method.return!, { bytesConversion: false })
        result = { result: utils.encodeBase64url(bytes) }
      } else throw new Error(`Unexpected RPC method: ${call.method}`)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: String(error) }))
    }
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { metadata, methods, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` }
}

describe('wallet read paths with loopback metadata', () => {
  it('reads core balances and VHP with local ABIs and no metadata fetch', async () => {
    const rpc = await mockRpc()
    const service = makeService(rpc.url)
    const balance = await service.walletBalance({ address, network: 'mainnet' })
    expect(balance).toMatchObject({ ok: true, koin: '1', vhp: '2', mana: '3' })
    expect(await service.walletVhp({ address, network: 'mainnet' })).toMatchObject({ ok: true, value: '2' })
    expect(rpc.methods).not.toContain('contract_meta_store.get_contract_meta')
  })

  it('rejects both invalid ABI paths before token/read execution and retries valid metadata', async () => {
    const rpc = await mockRpc()
    const service = makeService(rpc.url)
    const marker = globalThis as typeof globalThis & { __klbMarker?: number }
    marker.__klbMarker = 0
    const badName = 'M(){} , (globalThis["__klbMarker"] = 1), function N'
    const unsafe = [
      { methods: {}, koilib_types: { nested: { [badName]: { fields: {} } } } },
      { methods: {}, koilib_types: { nested: { Safe: { fields: { value: { type: 'bytes', id: 1, options: { default: ['0];globalThis["__klbMarker"]=1;//'] } } } } } } }
    ]
    for (const abi of unsafe) {
      rpc.metadata.set(contractId, abi as unknown as Abi)
      expect(await service.walletTokenBalance({ address, contractId })).toMatchObject({ ok: false, output: expect.stringMatching(/invalid ABI/) })
      expect(await service.walletReadContract({ contractId, method: 'balance_of', args: { owner: address } })).toMatchObject({ ok: false, output: expect.stringMatching(/invalid ABI/) })
      expect(marker.__klbMarker).toBe(0)
    }
    expect(rpc.methods).not.toContain('chain.read_contract')
    rpc.metadata.set(contractId, validAbi)
    expect(await service.walletTokenBalance({ address, contractId })).toMatchObject({ ok: true, tokenName: 'Synthetic', tokenSymbol: 'SYN', decimals: 0, balance: '7' })
    expect(await service.walletReadContract({ contractId, method: 'balance_of', args: { owner: address } })).toMatchObject({ ok: true, result: { value: '7' } })
  })
})
