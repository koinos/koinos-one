import { Contract, type Provider } from 'koilib'

type FetchedAbi = NonNullable<Awaited<ReturnType<Contract['fetchAbi']>>>

export function createCachedContractLoader(normalizeAbi: (abi: FetchedAbi) => FetchedAbi) {
  const abiCache = new Map<string, Promise<FetchedAbi>>()

  return async function loadContractWithFetchedAbi(provider: Provider, contractId: string): Promise<Contract> {
    const contract = new Contract({ id: contractId, provider })

    let pendingAbi = abiCache.get(contractId)
    if (!pendingAbi) {
      pendingAbi = contract
        .fetchAbi()
        .then((abi) => {
          if (!abi) {
            throw new Error(`Could not load ABI for contract ${contractId}`)
          }
          return normalizeAbi(abi)
        })
        .catch((error) => {
          abiCache.delete(contractId)
          throw error
        })

      abiCache.set(contractId, pendingAbi)
    }

    const abi = await pendingAbi
    return new Contract({
      id: contractId,
      provider,
      abi: abi as typeof contract.abi
    })
  }
}
