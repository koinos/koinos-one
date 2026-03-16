import { Signer } from 'koilib'
import { ethers } from 'ethers'

export type WalletDerivedAccountData = {
  index: number
  derivationPath: string
  address: string
  privateKeyWif: string
}

export type WalletDerivedAccountAtPath = {
  derivationPath: string
  address: string
  privateKeyWif: string
}

export function walletDerivationPath(index: number): string {
  return `m/44'/659'/${index}'/0/0`
}

export function deriveWalletAccountFromPath(seedPhrase: string, derivationPath: string): WalletDerivedAccountAtPath {
  const hdNode = ethers.utils.HDNode.fromMnemonic(seedPhrase)
  const derived = hdNode.derivePath(derivationPath)
  const signer = new Signer({ privateKey: derived.privateKey.slice(2) })

  return {
    derivationPath,
    address: signer.getAddress(),
    privateKeyWif: signer.getPrivateKey('wif')
  }
}

export function deriveWalletAccountsFromSeed(seedPhrase: string, numAccounts: number): WalletDerivedAccountData[] {
  const accounts: WalletDerivedAccountData[] = []

  for (let index = 0; index < numAccounts; index += 1) {
    const derivationPath = walletDerivationPath(index)
    const derived = deriveWalletAccountFromPath(seedPhrase, derivationPath)
    accounts.push({
      index: index + 1,
      derivationPath,
      address: derived.address,
      privateKeyWif: derived.privateKeyWif
    })
  }

  return accounts
}

export function parseWalletDerivationIndex(derivationPath?: string | null): number | null {
  const trimmed = `${derivationPath || ''}`.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^m\/44'\/659'\/(\d+)'\/0\/0$/)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}
