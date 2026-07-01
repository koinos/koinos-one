export function walletDefaultReceiverAddress(activeWalletAddress: string): string {
  return activeWalletAddress.trim()
}

export function resolveWalletSendTargetAddress(addressDraft: string, activeWalletAddress: string): string {
  return addressDraft.trim() || walletDefaultReceiverAddress(activeWalletAddress)
}

export function resolveWalletBurnTargetAddress(addressDraft: string, activeWalletAddress: string): string | undefined {
  return addressDraft.trim() || walletDefaultReceiverAddress(activeWalletAddress) || undefined
}
