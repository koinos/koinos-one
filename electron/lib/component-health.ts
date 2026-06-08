import { MONOLITH_CORE_COMPONENTS, MONOLITH_OPTIONAL_COMPONENTS } from './constants'
import type { ComponentHealth } from './main-types'

export type MonolithComponentHealthState = 'running' | 'passive' | 'waiting' | 'disabled' | 'stopped'

const MONOLITH_PASSIVE_COMPONENTS = new Set<string>([
  'mempool',
  'transaction_store',
  'contract_meta_store',
  'account_history'
])

export function deriveMonolithComponentHealth(input: {
  output: string
  isRunning: boolean
  featureFlags?: Record<string, boolean> | null
  disabledFeatures?: Iterable<string>
}): ComponentHealth[] {
  const disabledFeatures = new Set(input.disabledFeatures ?? [])

  return [...MONOLITH_CORE_COMPONENTS, ...MONOLITH_OPTIONAL_COMPONENTS].map((name) => {
    const enabled = input.featureFlags && name in input.featureFlags
      ? input.featureFlags[name]
      : !disabledFeatures.has(name)

    if (!enabled) {
      return {
        name,
        enabled,
        healthy: false,
        state: 'disabled',
        details: 'Disabled'
      }
    }

    if (!input.isRunning) {
      return {
        name,
        enabled,
        healthy: false,
        state: 'stopped',
        details: 'Stopped'
      }
    }

    const hasRuntimeOutput = input.output.includes(`[${name}]`)
    if (hasRuntimeOutput) {
      return {
        name,
        enabled,
        healthy: true,
        state: 'running',
        details: 'Running'
      }
    }

    if (MONOLITH_PASSIVE_COMPONENTS.has(name)) {
      return {
        name,
        enabled,
        healthy: true,
        state: 'passive',
        details: 'Enabled'
      }
    }

    return {
      name,
      enabled,
      healthy: false,
      state: 'waiting',
      details: 'Waiting...'
    }
  })
}
