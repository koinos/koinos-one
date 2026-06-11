import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { monolithBuildDefinition, nativeServiceBuildDefinitionMap, nativeServiceBuildDefinitions, uniquePathValue } from './native-tooling'

const d = path.delimiter

describe('native tooling helpers', () => {
  it('builds a unique PATH-like value', () => {
    expect(uniquePathValue([`/usr/bin${d}/bin`, `/bin${d}/opt/homebrew/bin`, null, ''])).toBe(`/usr/bin${d}/bin${d}/opt/homebrew/bin`)
  })

  it('defines native build metadata for the managed services', () => {
    const definitions = nativeServiceBuildDefinitions('/tmp/teleno-node')
    expect(definitions).toHaveLength(1)
    expect(definitions[0]?.serviceId).toBe('teleno-node')
    expect(definitions[0]?.buildSystem).toBe('cmake')

    const definitionMap = nativeServiceBuildDefinitionMap('/tmp/teleno-node')
    expect([...definitionMap.keys()]).toEqual(['teleno-node'])
  })

  it('defines a reproducible libp2p-enabled monolith build', () => {
    const definition = monolithBuildDefinition('/tmp/teleno-node')
    const configureArgs = definition.cmakeConfigureArgs ?? []

    expect(definition.serviceId).toBe('teleno-node')
    expect(definition.artifactPath).toBe(path.join('/tmp/teleno-node', 'build', 'koinos_node'))
    expect(configureArgs).toContain('KOINOS_ENABLE_LIBP2P=ON')
    expect(configureArgs).toContain(`CMAKE_PROJECT_INCLUDE=${path.join('/tmp/teleno-node', 'cmake', 'cpp-libp2p-koinos-prelude.cmake')}`)
    expect(configureArgs).toContain(`CMAKE_RUNTIME_OUTPUT_DIRECTORY=${path.join('/tmp/teleno-node', 'build')}`)
    expect(definition.buildCommands.join('\n')).toContain('KOINOS_ENABLE_LIBP2P=ON')
  })
})
