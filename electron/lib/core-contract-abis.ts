import fs from 'node:fs'
import path from 'node:path'

import { MAINNET_CONTRACTS, TESTNET_CONTRACTS } from './network-profiles'

type CoreAbiName = 'koin' | 'vhp' | 'pob'

const CORE_CONTRACT_ABI_BY_ID = new Map<string, CoreAbiName>([
  [MAINNET_CONTRACTS.koin, 'koin'],
  [TESTNET_CONTRACTS.koin, 'koin'],
  [MAINNET_CONTRACTS.vhp, 'vhp'],
  [TESTNET_CONTRACTS.vhp, 'vhp'],
  [MAINNET_CONTRACTS.pob, 'pob'],
  [TESTNET_CONTRACTS.pob, 'pob']
])

const VENDOR_ABI_RELATIVE_PATHS: Record<CoreAbiName, string> = {
  koin: 'vendor/koinos/koinos-contracts-as/contracts/koin/abi/koin.abi',
  vhp: 'vendor/koinos/koinos-contracts-as/contracts/vhp/abi/vhp.abi',
  pob: 'vendor/koinos/koinos-contracts-as/contracts/pob/abi/pob.abi'
}

const RESOURCE_ABI_FILE_NAMES: Record<CoreAbiName, string> = {
  koin: 'koin.abi',
  vhp: 'vhp.abi',
  pob: 'pob.abi'
}

const TESTNET_COMPAT_POB_ABI = {
  methods: {
    burn: {
      argument: 'pob.burn_arguments',
      return: 'pob.burn_result',
      entry_point: 2241834181,
      description: 'Burn KOIN to receive VHP',
      read_only: false
    },
    register_public_key: {
      argument: 'pob.register_public_key_arguments',
      return: 'pob.register_public_key_result',
      entry_point: 1394158561,
      description: 'Register a block production public key to an address',
      read_only: false
    },
    get_public_key: {
      argument: 'pob.get_public_key_arguments',
      return: 'pob.get_public_key_result',
      entry_point: 2523090792,
      description: 'Get a block production public key by producer address',
      read_only: true
    },
    get_consensus_parameters: {
      argument: 'pob.get_consensus_parameters_arguments',
      return: 'pob.get_consensus_parameters_result',
      entry_point: 1607973903,
      description: 'Returns the PoB consensus parameters',
      read_only: true
    }
  },
  koilib_types: {
    nested: {
      pob: {
        nested: {
          burn_arguments: {
            fields: {
              token_amount: { type: 'uint64', id: 1, options: { jstype: 'JS_STRING' } },
              burn_address: { type: 'bytes', id: 2, options: { '(koinos.btype)': 'ADDRESS' } },
              vhp_address: { type: 'bytes', id: 3, options: { '(koinos.btype)': 'ADDRESS' } }
            }
          },
          burn_result: { fields: {} },
          register_public_key_arguments: {
            fields: {
              producer: { type: 'bytes', id: 1, options: { '(koinos.btype)': 'ADDRESS' } },
              public_key: { type: 'bytes', id: 2 }
            }
          },
          register_public_key_result: { fields: {} },
          get_public_key_arguments: {
            fields: {
              producer: { type: 'bytes', id: 1, options: { '(koinos.btype)': 'ADDRESS' } }
            }
          },
          get_public_key_result: {
            fields: {
              value: { type: 'bytes', id: 1 }
            }
          },
          get_consensus_parameters_arguments: { fields: {} },
          get_consensus_parameters_result: {
            fields: {
              value: { type: 'consensus_parameters', id: 1 }
            }
          },
          consensus_parameters: {
            fields: {
              target_annual_inflation_rate: { type: 'uint32', id: 1 },
              target_burn_percent: { type: 'uint32', id: 2 },
              target_block_interval: { type: 'uint32', id: 3 },
              quantum_length: { type: 'uint32', id: 4 }
            }
          }
        }
      }
    }
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

export function coreContractAbiCandidatePaths(abiName: CoreAbiName): string[] {
  const vendorRelativePath = VENDOR_ABI_RELATIVE_PATHS[abiName]
  const resourceFileName = RESOURCE_ABI_FILE_NAMES[abiName]
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''

  return uniquePaths([
    path.resolve(process.cwd(), vendorRelativePath),
    path.resolve(__dirname, '..', '..', vendorRelativePath),
    resourcesPath ? path.join(resourcesPath, 'koinos', 'abis', resourceFileName) : ''
  ])
}

export function resolveCoreContractAbi(contractId: string): unknown | null {
  const abiName = CORE_CONTRACT_ABI_BY_ID.get(contractId)
  if (!abiName) return null
  if (abiName === 'pob') return TESTNET_COMPAT_POB_ABI

  for (const candidatePath of coreContractAbiCandidatePaths(abiName)) {
    try {
      const raw = fs.readFileSync(candidatePath, 'utf8')
      return JSON.parse(raw) as unknown
    } catch {
      // Try the next dev or packaged resource location.
    }
  }

  return null
}
