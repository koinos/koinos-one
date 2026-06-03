import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { monolithBuildDefinition, nativeServiceBuildDefinitionMap, nativeServiceBuildDefinitions, uniquePathValue } from './native-tooling'

const d = path.delimiter

describe('native tooling helpers', () => {
  it('builds a unique PATH-like value', () => {
    expect(uniquePathValue([`/usr/bin${d}/bin`, `/bin${d}/opt/homebrew/bin`, null, ''])).toBe(`/usr/bin${d}/bin${d}/opt/homebrew/bin`)
  })

  it('defines native build metadata for the managed services', () => {
    const definitions = nativeServiceBuildDefinitions('/tmp/koinos-source')
    expect(definitions.some((entry) => entry.serviceId === 'jsonrpc' && entry.buildSystem === 'go')).toBe(true)
    expect(definitions.some((entry) => entry.serviceId === 'rest' && entry.buildSystem === 'yarn')).toBe(true)

    const definitionMap = nativeServiceBuildDefinitionMap('/tmp/koinos-source')
    expect(definitionMap.get('block_producer')?.artifactPath).toContain('koinos-block-producer')
  })

  it('defines a reproducible libp2p-enabled monolith build', () => {
    const definition = monolithBuildDefinition('/tmp/koinos-source')
    const configureArgs = definition.cmakeConfigureArgs ?? []

    expect(definition.serviceId).toBe('koinos-node')
    expect(definition.artifactPath).toBe(path.join('/tmp/koinos-source', 'koinos-node', 'build', 'koinos_node'))
    expect(configureArgs).toContain('KOINOS_ENABLE_LIBP2P=ON')
    expect(configureArgs).toContain(`CMAKE_PROJECT_INCLUDE=${path.join('/tmp/koinos-source', 'koinos-node', 'cmake', 'cpp-libp2p-koinos-prelude.cmake')}`)
    expect(configureArgs).toContain(`CMAKE_RUNTIME_OUTPUT_DIRECTORY=${path.join('/tmp/koinos-source', 'koinos-node', 'build')}`)
    expect(definition.buildCommands.join('\n')).toContain('KOINOS_ENABLE_LIBP2P=ON')
  })
})
