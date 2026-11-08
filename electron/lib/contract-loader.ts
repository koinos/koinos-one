import { Contract, type Provider } from 'koilib'

type FetchedAbi = NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>
type ContractAbiFallbackResolver = (contractId: string) => FetchedAbi | null | Promise<FetchedAbi | null>

export function createCachedContractLoader(
  normalizeAbi: (abi: FetchedAbi) => FetchedAbi,
  resolveFallbackAbi?: ContractAbiFallbackResolver
) {
  const abiCache = new Map<string, Promise<FetchedAbi>>()

  return async function loadContractWithFetchedAbi(provider: Provider, contractId: string): Promise<Contract> {
    const contract = new Contract({ id: contractId, provider })
    const cacheKey = `${JSON.stringify(provider.rpcNodes)}:${contractId}`

    let pendingAbi = abiCache.get(cacheKey)
    if (!pendingAbi) {
      pendingAbi = Promise.resolve()
        .then(async () => {
          // Core contracts use the ABI shipped with this app for the selected
          // network. Other contracts still fetch their ABI from the RPC.
          const localAbi = await resolveFallbackAbi?.(contractId)
          const abi = localAbi ?? await contract.fetchAbi()
          if (!abi) {
            throw new Error(`Could not load ABI for contract ${contractId}`)
          }
          const normalized = normalizeAbi(abi)
          // Validate before placing an untrusted ABI in the shared cache.
          new Contract({ id: contractId, provider, abi: normalized })
          return normalized
        })
        .catch((error) => {
          abiCache.delete(cacheKey)
          throw error
        })

      abiCache.set(cacheKey, pendingAbi)
    }

    const abi = await pendingAbi
    return new Contract({
      id: contractId,
      provider,
      abi: abi as typeof contract.abi
    })
  }
}
