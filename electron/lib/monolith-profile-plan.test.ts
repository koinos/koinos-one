import { describe, expect, it } from 'vitest'

import {
  buildProfilePresets,
  monolithFeaturePlanForSettings,
  monolithProfilesMatch,
  presetToFeatureFlags
} from './monolith-profile-plan'
import type { TelenoNodeSettings } from './main-types'
import { normalizeBackupSettings } from './node-paths'

function settings(profiles: string[], network: TelenoNodeSettings['network'] = 'mainnet'): TelenoNodeSettings {
  return {
    network,
    repoPath: '/tmp/koinos',
    baseDir: '/tmp/koinos/basedir',
    profiles,
    blockchainBackupUrl: 'https://example.com/backup.tar.gz',
    backup: normalizeBackupSettings()
  }
}

describe('monolith profile plan', () => {
  it('maps the selected mainnet producer profile to block production features', () => {
    const plan = monolithFeaturePlanForSettings(settings(['block_producer']))

    expect(plan.preset?.id).toBe('profile:block_producer')
    expect(plan.featureFlags.block_producer).toBe(true)
    expect(plan.featureFlags.jsonrpc).toBe(true)
    expect(plan.featureFlags.contract_meta_store).toBe(true)
    expect(plan.featureFlags.grpc).toBe(false)
    expect(plan.configPatch?.set?.some((patch) => patch.path.join('.') === 'p2p.peer')).toBe(true)
  })

  it('maps the selected observer profile to observer-only features', () => {
    const plan = monolithFeaturePlanForSettings(settings(['mainnet_observer']))

    expect(plan.preset?.id).toBe('profile:mainnet_observer')
    expect(plan.featureFlags.block_producer).toBe(false)
    expect(plan.featureFlags.jsonrpc).toBe(true)
    expect(plan.featureFlags.contract_meta_store).toBe(false)
  })

  it('matches profiles regardless of order', () => {
    expect(monolithProfilesMatch(['jsonrpc', 'block_producer'], ['block_producer', 'jsonrpc'])).toBe(true)
    expect(monolithProfilesMatch(['mainnet_observer'], ['block_producer'])).toBe(false)
  })

  it('still derives feature flags for unknown custom profile strings', () => {
    expect(presetToFeatureFlags(['jsonrpc', 'account_history'])).toMatchObject({
      chain: true,
      p2p: true,
      jsonrpc: true,
      account_history: true,
      block_producer: false
    })
  })

  it('filters presets to the active network', () => {
    expect(buildProfilePresets(settings(['testnet_producer'], 'testnet')).map((preset) => preset.id)).toContain('profile:testnet_producer')
    expect(buildProfilePresets(settings(['testnet_producer'], 'mainnet')).map((preset) => preset.id)).not.toContain('profile:testnet_producer')
  })
})
