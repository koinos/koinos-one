import { afterEach, describe, expect, it, vi } from 'vitest'
import { Contract, utils, type Provider } from 'koilib'

import { createCachedContractLoader } from './contract-loader'

const FAKE_ABI = { methods: {} } as unknown as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
const FAKE_ABI_WITH_TYPES = {
  methods: {},
  types: {}
} as unknown as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
const CONTRACT_ID = utils.encodeBase58(new Uint8Array(20))
const PROVIDER_A = { rpcNodes: ['http://127.0.0.1:31501/'] } as Provider
const PROVIDER_B = { rpcNodes: ['http://127.0.0.1:31502/'] } as Provider

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createCachedContractLoader', () => {
  it('caches ABI fetches by contract id', async () => {
    const fetchAbi = vi.spyOn(Contract.prototype, 'fetchAbi').mockResolvedValue(FAKE_ABI)
    vi.spyOn(Contract.prototype, 'updateFunctionsFromAbi').mockImplementation(() => false)
    const normalizeAbi = vi.fn((abi: typeof FAKE_ABI) => abi)
    const loadContract = createCachedContractLoader(normalizeAbi)

    await Promise.all([
      loadContract(PROVIDER_A, CONTRACT_ID),
      loadContract(PROVIDER_A, CONTRACT_ID)
    ])

    expect(fetchAbi).toHaveBeenCalledTimes(1)
    expect(normalizeAbi).toHaveBeenCalledTimes(1)
  })

  it('clears failed cache entries so retries can succeed', async () => {
    const fetchAbi = vi
      .spyOn(Contract.prototype, 'fetchAbi')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(FAKE_ABI)
    vi.spyOn(Contract.prototype, 'updateFunctionsFromAbi').mockImplementation(() => false)
    const loadContract = createCachedContractLoader((abi) => abi)

    await expect(loadContract(PROVIDER_A, CONTRACT_ID)).rejects.toThrow('boom')
    await expect(loadContract(PROVIDER_A, CONTRACT_ID)).resolves.toBeInstanceOf(Contract)

    expect(fetchAbi).toHaveBeenCalledTimes(2)
  })

  it('returns hydrated contracts with serializer state restored from cached ABI', async () => {
    vi.spyOn(Contract.prototype, 'fetchAbi').mockResolvedValue(FAKE_ABI_WITH_TYPES)
    const loadContract = createCachedContractLoader((abi) => abi)

    const contract = await loadContract(PROVIDER_A, CONTRACT_ID)

    expect(contract.abi).toEqual(FAKE_ABI_WITH_TYPES)
    expect(contract.serializer).toBeTruthy()
  })

  it('uses a local fallback ABI when the contract does not expose one', async () => {
    const fetchAbi = vi
      .spyOn(Contract.prototype, 'fetchAbi')
      .mockResolvedValue(null as unknown as Awaited<ReturnType<Contract['fetchAbi']>>)
    vi.spyOn(Contract.prototype, 'updateFunctionsFromAbi').mockImplementation(() => false)
    const resolveFallbackAbi = vi.fn(() => FAKE_ABI_WITH_TYPES)
    const normalizeAbi = vi.fn((abi: typeof FAKE_ABI_WITH_TYPES) => abi)
    const loadContract = createCachedContractLoader(normalizeAbi, resolveFallbackAbi)

    const contract = await loadContract(PROVIDER_A, CONTRACT_ID)

    expect(contract.abi).toEqual(FAKE_ABI_WITH_TYPES)
    expect(fetchAbi).not.toHaveBeenCalled()
    expect(resolveFallbackAbi).toHaveBeenCalledWith(CONTRACT_ID)
    expect(normalizeAbi).toHaveBeenCalledWith(FAKE_ABI_WITH_TYPES)
  })

  it('separates cached ABI by RPC URL', async () => {
    const fetchAbi = vi.spyOn(Contract.prototype, 'fetchAbi').mockResolvedValue(FAKE_ABI)
    const loadContract = createCachedContractLoader((abi) => abi)

    await loadContract(PROVIDER_A, CONTRACT_ID)
    await loadContract(PROVIDER_B, CONTRACT_ID)
    expect(fetchAbi).toHaveBeenCalledTimes(2)
  })

  it('does not cache an invalid ABI and rejects before generated code runs', async () => {
    const marker = globalThis as typeof globalThis & { __klbMarker?: number }
    marker.__klbMarker = 0
    const invalid = {
      methods: {},
      koilib_types: {
        nested: {
          Safe: {
            fields: {
              value: { type: 'bytes', id: 1, options: { default: ['0];globalThis["__klbMarker"]=1;//'] } }
            }
          }
        }
      }
    } as unknown as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
    const fetchAbi = vi.spyOn(Contract.prototype, 'fetchAbi')
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(FAKE_ABI)
    const loadContract = createCachedContractLoader((abi) => abi)

    await expect(loadContract(PROVIDER_A, CONTRACT_ID)).rejects.toThrow(/invalid ABI/)
    expect(marker.__klbMarker).toBe(0)
    await expect(loadContract(PROVIDER_A, CONTRACT_ID)).resolves.toBeInstanceOf(Contract)
    expect(fetchAbi).toHaveBeenCalledTimes(2)
  })
})
