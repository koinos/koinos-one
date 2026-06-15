type ProducerTargetAddressInput = {
  walletAddress?: string | null
  draftedProducerAddress?: string | null
  configProducerAddress?: string | null
  useWalletAddress: boolean
}

export function resolveProducerTargetAddress(input: ProducerTargetAddressInput): string {
  const walletAddress = `${input.walletAddress || ''}`.trim()
  const draftedProducerAddress = `${input.draftedProducerAddress || ''}`.trim()
  const configProducerAddress = `${input.configProducerAddress || ''}`.trim()

  if (input.useWalletAddress) {
    return walletAddress || configProducerAddress
  }

  return draftedProducerAddress || configProducerAddress
}

type ProducerDisplayAddressInput = {
  configuredAddress?: string | null
  signingWalletAddress?: string | null
}

export function resolveProducerDisplayAddress(input: ProducerDisplayAddressInput): string {
  const configuredAddress = `${input.configuredAddress || ''}`.trim()
  const signingWalletAddress = `${input.signingWalletAddress || ''}`.trim()
  return configuredAddress || signingWalletAddress
}

type ConfiguredProducerAddressInput = {
  runtimeConfigAddress?: string | null
  overviewAddress?: string | null
  overviewAddressSource?: string | null
  profileAddress?: string | null
  fallbackAddress?: string | null
}

export function resolveConfiguredProducerAddress(input: ConfiguredProducerAddressInput): string {
  const runtimeConfigAddress = `${input.runtimeConfigAddress || ''}`.trim()
  const overviewAddress = `${input.overviewAddress || ''}`.trim()
  const profileAddress = `${input.profileAddress || ''}`.trim()
  const fallbackAddress = `${input.fallbackAddress || ''}`.trim()

  if (runtimeConfigAddress) return runtimeConfigAddress
  if (input.overviewAddressSource === 'config' && overviewAddress) return overviewAddress
  return profileAddress || overviewAddress || fallbackAddress
}

type RuntimeProducerIdentityInput = {
  configuredAddress?: string | null
  localPublicKey?: string | null
  registeredPublicKey?: string | null
}

type ProducerPublicKeyRegistrationInput = {
  localPublicKey?: string | null
  registeredPublicKey?: string | null
}

export type ProducerPublicKeyRegistrationState = 'unknown' | 'unregistered' | 'match' | 'mismatch'

export function hasRuntimeProducerIdentity(input: RuntimeProducerIdentityInput): boolean {
  return Boolean(
    `${input.configuredAddress || ''}`.trim() ||
    `${input.localPublicKey || ''}`.trim() ||
    `${input.registeredPublicKey || ''}`.trim()
  )
}

export function getProducerPublicKeyRegistrationState(
  input: ProducerPublicKeyRegistrationInput
): ProducerPublicKeyRegistrationState {
  const localPublicKey = `${input.localPublicKey || ''}`.trim()
  const registeredPublicKey = `${input.registeredPublicKey || ''}`.trim()

  if (!localPublicKey) return 'unknown'
  if (!registeredPublicKey) return 'unregistered'
  return registeredPublicKey === localPublicKey ? 'match' : 'mismatch'
}

export function isProducerSetupComplete(profile: TelenoNodeProducerProfileResult | null | undefined): boolean {
  return Boolean(profile?.ok && profile.profile?.producerAddress && profile.profile?.registrationSignerAccountId)
}

type ProducerSetupPreconditionInput = {
  walletExists: boolean
  walletUnlocked: boolean
  hasLocalPublicKey: boolean
  hasTargetAddress: boolean
  isWalletBalanceLoading: boolean
  hasEnoughMana: boolean | null
  useWalletAddress: boolean
  producerAdvancedMode: boolean
}

export function getProducerSetupBlockReason(input: ProducerSetupPreconditionInput): string | null {
  if (!input.walletExists) return 'wallet-missing'
  if (!input.walletUnlocked) return 'wallet-locked'
  if (!input.hasTargetAddress) return 'address-missing'
  if (!input.useWalletAddress && !input.producerAdvancedMode) return 'advanced-required'
  if (!input.hasLocalPublicKey) return 'local-key-missing'
  if (input.hasEnoughMana === false) return 'insufficient-mana'
  if (input.hasEnoughMana === null) return 'wallet-balance-loading'
  return null
}

function parsePositiveProducerVhp(logLine: string, pattern: RegExp): boolean {
  const match = logLine.match(pattern)
  if (!match) return false
  const value = Number.parseFloat(match[1] || '')
  return Number.isFinite(value) && value > 0
}

export function isProducerActivelyProducingFromLogs(output: string | null | undefined): boolean {
  if (!output) return false

  return output
    .split('\n')
    .some((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false

      return (
        parsePositiveProducerVhp(trimmed, /Estimated total VHP producing:\s*([0-9]+(?:\.[0-9]+)?)\s+VHP/i) ||
        parsePositiveProducerVhp(trimmed, /Producing with\s*([0-9]+(?:\.[0-9]+)?)\s+VHP/i)
      )
    })
}
