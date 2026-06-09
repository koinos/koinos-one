import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { coreContractAbiCandidatePaths, resolveCoreContractAbi } from './core-contract-abis'
import { TESTNET_CONTRACTS } from './network-profiles'

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath

function setResourcesPath(resourcesPath: string): void {
  Object.defineProperty(process, 'resourcesPath', {
    value: resourcesPath,
    configurable: true
  })
}

afterEach(() => {
  Object.defineProperty(process, 'resourcesPath', {
    value: originalResourcesPath,
    configurable: true
  })
})

describe('core contract ABI resolution', () => {
  it('looks for packaged ABIs in the Teleno resource bundle', () => {
    setResourcesPath('/Applications/Teleno.app/Contents/Resources')

    expect(coreContractAbiCandidatePaths('koin')).toContain(
      path.join('/Applications/Teleno.app/Contents/Resources', 'teleno', 'abis', 'koin.abi')
    )
  })

  it('keeps the legacy koinos resource ABI path as a fallback', () => {
    setResourcesPath('/Applications/Teleno.app/Contents/Resources')

    expect(coreContractAbiCandidatePaths('koin')).toContain(
      path.join('/Applications/Teleno.app/Contents/Resources', 'koinos', 'abis', 'koin.abi')
    )
  })

  it('resolves the testnet KOIN ABI from local fallback data', () => {
    const abi = resolveCoreContractAbi(TESTNET_CONTRACTS.koin) as { methods?: Record<string, unknown> } | null

    expect(abi?.methods).toHaveProperty('balance_of')
  })

  it('uses the live PoB consensus parameters entry point', () => {
    const abi = resolveCoreContractAbi(TESTNET_CONTRACTS.pob) as {
      methods?: Record<string, { entry_point?: number }>
    } | null

    expect(abi?.methods?.get_consensus_parameters?.entry_point).toBe(1607969807)
  })
})
