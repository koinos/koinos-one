import { describe, expect, it } from 'vitest'
import {
  getProducerPublicKeyRegistrationState,
  getProducerSetupBlockReason,
  hasRuntimeProducerIdentity,
  isProducerActivelyProducingFromLogs,
  isProducerSetupComplete,
  resolveConfiguredProducerAddress,
  resolveProducerDisplayAddress,
  resolveProducerTargetAddress
} from './producer'

describe('producer setup helpers', () => {
  it('resolves producer address from wallet by default', () => {
    expect(resolveProducerTargetAddress({
      walletAddress: '1WalletAddr',
      draftedProducerAddress: '1Drafted',
      configProducerAddress: '1Config',
      useWalletAddress: true
    })).toBe('1WalletAddr')
  })

  it('resolves producer address from draft when using different address', () => {
    expect(resolveProducerTargetAddress({
      walletAddress: '1WalletAddr',
      draftedProducerAddress: '1Drafted',
      configProducerAddress: '1Config',
      useWalletAddress: false
    })).toBe('1Drafted')
  })

  it('falls back to config address when preferred source is missing', () => {
    expect(resolveProducerTargetAddress({
      walletAddress: '',
      draftedProducerAddress: '',
      configProducerAddress: '1Config',
      useWalletAddress: true
    })).toBe('1Config')
  })

  it('prefers the runtime configured address for producer display', () => {
    expect(resolveProducerDisplayAddress({
      configuredAddress: ' 1RuntimeProducer ',
      signingWalletAddress: '1WalletProducer'
    })).toBe('1RuntimeProducer')

    expect(resolveProducerDisplayAddress({
      configuredAddress: '',
      signingWalletAddress: ' 1WalletProducer '
    })).toBe('1WalletProducer')
  })

  it('prefers runtime config over stale producer profile data', () => {
    expect(resolveConfiguredProducerAddress({
      runtimeConfigAddress: '1RuntimeProducer',
      overviewAddress: '1RequestedProducer',
      overviewAddressSource: 'request',
      profileAddress: '1OldProfileProducer',
      fallbackAddress: '1WalletProducer'
    })).toBe('1RuntimeProducer')

    expect(resolveConfiguredProducerAddress({
      runtimeConfigAddress: '',
      overviewAddress: '1ConfigProducer',
      overviewAddressSource: 'config',
      profileAddress: '1OldProfileProducer',
      fallbackAddress: '1WalletProducer'
    })).toBe('1ConfigProducer')

    expect(resolveConfiguredProducerAddress({
      runtimeConfigAddress: '',
      overviewAddress: '1RequestedProducer',
      overviewAddressSource: 'request',
      profileAddress: '1OldProfileProducer',
      fallbackAddress: '1WalletProducer'
    })).toBe('1OldProfileProducer')
  })

  it('detects read-only runtime producer identity without a GUI wallet', () => {
    expect(hasRuntimeProducerIdentity({
      configuredAddress: '',
      localPublicKey: ' AjyProducerPublicKey ',
      registeredPublicKey: ''
    })).toBe(true)

    expect(hasRuntimeProducerIdentity({
      configuredAddress: '',
      localPublicKey: '',
      registeredPublicKey: ''
    })).toBe(false)
  })

  it('classifies producer public key registration state', () => {
    expect(getProducerPublicKeyRegistrationState({
      localPublicKey: '',
      registeredPublicKey: 'AjyRegistered'
    })).toBe('unknown')

    expect(getProducerPublicKeyRegistrationState({
      localPublicKey: 'AjyLocal',
      registeredPublicKey: ''
    })).toBe('unregistered')

    expect(getProducerPublicKeyRegistrationState({
      localPublicKey: ' AjyLocal ',
      registeredPublicKey: 'AjyLocal'
    })).toBe('match')

    expect(getProducerPublicKeyRegistrationState({
      localPublicKey: 'AjyLocal',
      registeredPublicKey: 'AjyOther'
    })).toBe('mismatch')
  })

  it('detects setup completion from profile data', () => {
    const profile = {
      ok: true,
      output: '',
      profileFilePath: '/tmp/profile.json',
      profile: {
        producerAddress: '1Producer',
        registrationSignerAccountId: '1Signer',
        burnAccountId: '1Signer',
        localPublicKey: 'KOINPUBKEY',
        localPublicKeyPath: '/tmp/public.key',
        registeredPublicKey: 'KOINPUBKEY',
        lastRegistrationTxId: null,
        updatedAt: '2026-03-05T00:00:00.000Z'
      }
    } satisfies TelenoNodeProducerProfileResult

    expect(isProducerSetupComplete(profile)).toBe(true)
    expect(isProducerSetupComplete(null)).toBe(false)
  })

  it('returns the first blocking reason for setup', () => {
    expect(getProducerSetupBlockReason({
      walletExists: false,
      walletUnlocked: false,
      hasLocalPublicKey: false,
      hasTargetAddress: false,
      isWalletBalanceLoading: false,
      hasEnoughMana: null,
      useWalletAddress: true,
      producerAdvancedMode: false
    })).toBe('wallet-missing')

    expect(getProducerSetupBlockReason({
      walletExists: true,
      walletUnlocked: true,
      hasLocalPublicKey: true,
      hasTargetAddress: true,
      isWalletBalanceLoading: false,
      hasEnoughMana: true,
      useWalletAddress: false,
      producerAdvancedMode: false
    })).toBe('advanced-required')

    expect(getProducerSetupBlockReason({
      walletExists: true,
      walletUnlocked: true,
      hasLocalPublicKey: true,
      hasTargetAddress: true,
      isWalletBalanceLoading: true,
      hasEnoughMana: null,
      useWalletAddress: false,
      producerAdvancedMode: true
    })).toBe('wallet-balance-loading')

    expect(getProducerSetupBlockReason({
      walletExists: true,
      walletUnlocked: true,
      hasLocalPublicKey: true,
      hasTargetAddress: true,
      isWalletBalanceLoading: true,
      hasEnoughMana: false,
      useWalletAddress: false,
      producerAdvancedMode: true
    })).toBe('insufficient-mana')

    expect(getProducerSetupBlockReason({
      walletExists: true,
      walletUnlocked: true,
      hasLocalPublicKey: true,
      hasTargetAddress: true,
      isWalletBalanceLoading: true,
      hasEnoughMana: true,
      useWalletAddress: false,
      producerAdvancedMode: true
    })).toBeNull()

    expect(getProducerSetupBlockReason({
      walletExists: true,
      walletUnlocked: true,
      hasLocalPublicKey: true,
      hasTargetAddress: true,
      isWalletBalanceLoading: false,
      hasEnoughMana: true,
      useWalletAddress: false,
      producerAdvancedMode: true
    })).toBeNull()
  })

  it('detects active producer output from block_producer logs', () => {
    const producingLogs = `
2026-03-10 21:56:06.161381 (block_producer.Koinos) [pob_producer.cpp:498] <info>: Estimated total VHP producing: 3881803.54527445 VHP
2026-03-10 21:56:06.163780 (block_producer.Koinos) [pob_producer.cpp:502] <info>: Producing with 95.00000000 VHP.
    `

    expect(isProducerActivelyProducingFromLogs(producingLogs)).toBe(true)
    expect(
      isProducerActivelyProducingFromLogs(
        '2026-03-10 21:56:06.163780 (block_producer.Koinos) [pob_producer.cpp:502] <info>: Producing with 0.00000000 VHP.'
      )
    ).toBe(false)
    expect(isProducerActivelyProducingFromLogs('')).toBe(false)
  })
})
