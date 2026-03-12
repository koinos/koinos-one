import { describe, expect, it } from 'vitest'

import { nativeServiceBuildDefinitionMap, nativeServiceBuildDefinitions, uniquePathValue } from './native-tooling'

describe('native tooling helpers', () => {
  it('builds a unique PATH-like value', () => {
    expect(uniquePathValue(['/usr/bin:/bin', '/bin:/opt/homebrew/bin', null, ''])).toBe('/usr/bin:/bin:/opt/homebrew/bin')
  })

  it('defines native build metadata for the managed services', () => {
    const definitions = nativeServiceBuildDefinitions('/tmp/koinos-source')
    expect(definitions.some((entry) => entry.serviceId === 'jsonrpc' && entry.buildSystem === 'go')).toBe(true)
    expect(definitions.some((entry) => entry.serviceId === 'rest' && entry.buildSystem === 'yarn')).toBe(true)

    const definitionMap = nativeServiceBuildDefinitionMap('/tmp/koinos-source')
    expect(definitionMap.get('block_producer')?.artifactPath).toContain('koinos-block-producer')
  })
})
