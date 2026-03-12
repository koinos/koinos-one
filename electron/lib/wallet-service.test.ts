import { describe, expect, it } from 'vitest'

import { deriveWalletAccountsFromSeed, walletDerivationPath } from './wallet-service'

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
})
