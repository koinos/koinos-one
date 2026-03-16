import { afterEach, describe, expect, it, vi } from 'vitest'
import { Contract, type Provider } from 'koilib'

import { createCachedContractLoader } from './contract-loader'

const FAKE_ABI = { methods: {} } as unknown as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
const FAKE_ABI_WITH_TYPES = {
  methods: {},
  types: {}
} as unknown as NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>

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
      loadContract({} as Provider, '15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL'),
      loadContract({} as Provider, '15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL')
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

    await expect(loadContract({} as Provider, '15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL')).rejects.toThrow('boom')
    await expect(loadContract({} as Provider, '15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL')).resolves.toBeInstanceOf(Contract)

    expect(fetchAbi).toHaveBeenCalledTimes(2)
  })

  it('returns hydrated contracts with serializer state restored from cached ABI', async () => {
    vi.spyOn(Contract.prototype, 'fetchAbi').mockResolvedValue(FAKE_ABI_WITH_TYPES)
    const loadContract = createCachedContractLoader((abi) => abi)

    const contract = await loadContract({} as Provider, '15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL')

    expect(contract.abi).toEqual(FAKE_ABI_WITH_TYPES)
    expect(contract.serializer).toBeTruthy()
  })
})
