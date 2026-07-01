import { describe, expect, it } from 'vitest'

import {
  resolveWalletBurnTargetAddress,
  resolveWalletSendTargetAddress,
  walletDefaultReceiverAddress
} from './wallet-actions'

const activeWalletAddress = '15N8CEwEfTqk1Uqqz8FfGerk2E6V5GNDox'
const otherAddress = '1KBvAsRzVcV8HfhQFwF8juXYr5G1vFXs6x'

describe('wallet action target defaults', () => {
  it('uses the active wallet as the default receiver account', () => {
    expect(walletDefaultReceiverAddress(` ${activeWalletAddress} `)).toBe(activeWalletAddress)
  })

  it('defaults Send to the active wallet when the receiver draft is empty', () => {
    expect(resolveWalletSendTargetAddress('', activeWalletAddress)).toBe(activeWalletAddress)
  })

  it('defaults Burn VHP allocation to the active wallet when the receiver draft is empty', () => {
    expect(resolveWalletBurnTargetAddress('', activeWalletAddress)).toBe(activeWalletAddress)
  })

  it('keeps an explicitly typed receiver address', () => {
    expect(resolveWalletSendTargetAddress(otherAddress, activeWalletAddress)).toBe(otherAddress)
    expect(resolveWalletBurnTargetAddress(otherAddress, activeWalletAddress)).toBe(otherAddress)
  })
})
