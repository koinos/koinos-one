import fs from 'node:fs'
import path from 'node:path'

import {
  nativeCmakeConfigureArgs,
  nativeCmakeExecutable,
  nativeServiceBuildDefinitionMap,
  monolithBuildDefinition,
  type NativeBuildSystem,
  type NativeServiceBuildDefinition
} from './native-tooling'
import type {
  TelenoNodeNativeBuildCommandInput,
  TelenoNodeNativeBuildCommandResult,
  TelenoNodeNativeBuildsResult,
  TelenoNodeNativeBuildStatus,
  ManagedKoinosServiceDefinition,
  NativeBuildToolStatus
} from './main-types'

type NativeBuildServiceDeps = {
  telenoNodeSourceRoot: string
  managedServices: ManagedKoinosServiceDefinition[]
  runCommand: (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ) => Promise<{ ok: boolean; code: number | null; output: string }>
  applyKoinosDarwinHunterWorkaround: (repoPath: string, buildDir?: string) => Promise<string | null>
}

export function firstOutputLine(output: string, fallback: string): string {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || fallback
}

export function artifactUpdatedAt(artifactPath: string | null): number | null {
  if (!artifactPath || !fs.existsSync(artifactPath)) return null
  try {
    return fs.statSync(artifactPath).mtimeMs
  } catch {
    return null
  }
}

export function createNativeBuildService(deps: NativeBuildServiceDeps) {
  async function detectNativeBuildToolStatuses(): Promise<Record<NativeBuildSystem, NativeBuildToolStatus>> {
    const cwd = process.cwd()
    const cmakeResult = await deps.runCommand(nativeCmakeExecutable(), ['--version'], { cwd })
    const clangResult = await deps.runCommand('clang', ['--version'], { cwd })
    const goResult = await deps.runCommand('go', ['version'], { cwd })
    const nodeResult = await deps.runCommand('node', ['--version'], { cwd })
    const yarnResult = await deps.runCommand('yarn', ['--version'], { cwd })

    const cmakeToolStatus =
      cmakeResult.ok && clangResult.ok
        ? { ok: true, note: null }
        : {
            ok: false,
            note: /xcode license/i.test(`${cmakeResult.output}\n${clangResult.output}`)
              ? 'Xcode CLI tools no estan listos: acepta antes la licencia de Xcode'
              : firstOutputLine(
                  `${cmakeResult.output}\n${clangResult.output}`,
                  'No se encontro un toolchain C/C++ valido para servicios CMake'
                )
          }

    const goToolStatus = goResult.ok
      ? { ok: true, note: null }
      : { ok: false, note: firstOutputLine(goResult.output, 'No se encontro Go para compilar servicios Go') }

    const yarnToolStatus =
      nodeResult.ok && yarnResult.ok
        ? { ok: true, note: null }
        : {
            ok: false,
            note: firstOutputLine(
              `${nodeResult.output}\n${yarnResult.output}`,
              'No se encontro Node/Yarn para compilar el servicio rest'
            )
          }

    return {
      cmake: cmakeToolStatus,
      go: goToolStatus,
      yarn: yarnToolStatus
    }
  }

  async function nativeBuildStatus(): Promise<TelenoNodeNativeBuildsResult> {
    const sourceRoot = deps.telenoNodeSourceRoot
    const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
    const toolStatuses = await detectNativeBuildToolStatuses()

    const services = deps.managedServices.map((service): TelenoNodeNativeBuildStatus => {
      const definition = definitions.get(service.id)
      if (!definition) {
        return {
          serviceId: service.id,
          serviceName: service.displayName,
          supported: false,
          buildSystem: null,
          repoPath: null,
          repoExists: false,
          artifactPath: null,
          artifactExists: false,
          artifactUpdatedAt: null,
          buildable: false,
          note: service.id === 'amqp' ? 'RabbitMQ no se compila desde /Users/pgarcgo/code/koinos_code' : 'Sin definicion de build nativa',
          buildCommands: []
        }
      }

      const repoExists = fs.existsSync(definition.repoPath)
      const artifactExists = fs.existsSync(definition.artifactPath)
      const toolStatus = toolStatuses[definition.buildSystem]

      return {
        serviceId: service.id,
        serviceName: service.displayName,
        supported: true,
        buildSystem: definition.buildSystem,
        repoPath: definition.repoPath,
        repoExists,
        artifactPath: definition.artifactPath,
        artifactExists,
        artifactUpdatedAt: artifactUpdatedAt(definition.artifactPath),
        buildable: repoExists && toolStatus.ok,
        note: !repoExists
          ? `Repo path not found: ${definition.repoPath}`
          : !toolStatus.ok
            ? toolStatus.note
            : artifactExists
              ? null
              : 'Aun no compilado',
        buildCommands: definition.buildCommands
      }
    })

    const builtCount = services.filter((service) => service.supported && service.artifactExists).length
    const supportedCount = services.filter((service) => service.supported).length

    return {
      ok: true,
      sourceRoot,
      services,
      output: `Native build workspace: ${sourceRoot} · ${builtCount}/${supportedCount} servicios con artefacto generado`
    }
  }

  async function buildNativeService(definition: NativeServiceBuildDefinition): Promise<{ ok: boolean; output: string }> {
    const toolStatuses = await detectNativeBuildToolStatuses()
    const toolStatus = toolStatuses[definition.buildSystem]

    if (!fs.existsSync(definition.repoPath)) {
      return {
        ok: false,
        output: `Repo path not found: ${definition.repoPath}`
      }
    }

    if (!toolStatus.ok) {
      return {
        ok: false,
        output: toolStatus.note || `Toolchain no disponible para ${definition.buildSystem}`
      }
    }

    if (definition.buildSystem === 'cmake') {
      const buildDir = definition.cmakeBuildDir ?? 'build'
      const configureArgs = definition.cmakeConfigureArgs ?? nativeCmakeConfigureArgs(buildDir)
      const buildArgs = definition.cmakeBuildArgs ?? ['--build', buildDir, '--config', 'Release', '--parallel']
      let configureResult = await deps.runCommand(nativeCmakeExecutable(), configureArgs, {
        cwd: definition.repoPath
      })
      if (!configureResult.ok) {
        let workaroundNote: string | null = null

        try {
          workaroundNote = await deps.applyKoinosDarwinHunterWorkaround(definition.repoPath, buildDir)
        } catch (error) {
          workaroundNote = `No se pudo aplicar el workaround Darwin/Hunter: ${
            error instanceof Error ? error.message : String(error)
          }`
        }

        if (!workaroundNote) {
          return {
            ok: false,
            output: [configureResult.output].filter(Boolean).join('\n')
          }
        }

        const retryConfigureResult = await deps.runCommand(nativeCmakeExecutable(), configureArgs, {
          cwd: definition.repoPath
        })

        configureResult = {
          ok: retryConfigureResult.ok,
          code: retryConfigureResult.code,
          output: [configureResult.output, workaroundNote, retryConfigureResult.output].filter(Boolean).join('\n')
        }

        if (!retryConfigureResult.ok) {
          return {
            ok: false,
            output: configureResult.output
          }
        }
      }

      const buildResult = await deps.runCommand(nativeCmakeExecutable(), buildArgs, {
        cwd: definition.repoPath
      })
      return {
        ok: buildResult.ok,
        output: [configureResult.output, buildResult.output].filter(Boolean).join('\n')
      }
    }

    if (definition.buildSystem === 'go') {
      fs.mkdirSync(path.dirname(definition.artifactPath), { recursive: true })
      const buildResult = await deps.runCommand('go', ['build', '-o', definition.artifactPath, '.'], {
        cwd: definition.repoPath
      })
      return {
        ok: buildResult.ok,
        output: buildResult.output
      }
    }

    if (definition.buildSystem === 'yarn') {
      const installResult = await deps.runCommand('yarn', ['install', '--frozen-lockfile'], {
        cwd: definition.repoPath
      })
      const buildResult = installResult.ok
        ? await deps.runCommand('yarn', ['build'], {
            cwd: definition.repoPath
          })
        : { ok: false, code: installResult.code, output: '' }
      return {
        ok: installResult.ok && buildResult.ok,
        output: [installResult.output, buildResult.output].filter(Boolean).join('\n')
      }
    }

    return {
      ok: false,
      output: `Build system no soportado: ${definition.buildSystem}`
    }
  }

  async function nativeBuildAll(): Promise<TelenoNodeNativeBuildCommandResult> {
    const sourceRoot = deps.telenoNodeSourceRoot
    const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
    const logs: string[] = []
    let ok = true

    for (const service of deps.managedServices) {
      const definition = definitions.get(service.id)
      if (!definition) {
        logs.push(`[${service.id}] omitido: sin build nativo definido`)
        continue
      }

      const result = await buildNativeService(definition)
      logs.push(`=== ${service.id} ===\n${result.output || '(sin salida)'}`)
      if (!result.ok) ok = false
    }

    const builds = await nativeBuildStatus()
    return {
      ok,
      action: 'build-all',
      serviceId: null,
      output: logs.join('\n\n'),
      builds
    }
  }

  async function nativeBuildServiceAction(input?: TelenoNodeNativeBuildCommandInput): Promise<TelenoNodeNativeBuildCommandResult> {
    const serviceId = input?.serviceId?.trim() || ''
    const sourceRoot = deps.telenoNodeSourceRoot
    const definitions = nativeServiceBuildDefinitionMap(sourceRoot)
    const definition = definitions.get(serviceId)

    if (!serviceId || !definition) {
      const builds = await nativeBuildStatus()
      return {
        ok: false,
        action: 'build-service',
        serviceId: serviceId || null,
        output: serviceId ? `No hay build nativo configurado para ${serviceId}` : 'Parametro serviceId invalido',
        builds
      }
    }

    const result = await buildNativeService(definition)
    const builds = await nativeBuildStatus()
    return {
      ok: result.ok,
      action: 'build-service',
      serviceId,
      output: result.output,
      builds
    }
  }

  async function monolithBuildStatus(): Promise<TelenoNodeNativeBuildsResult> {
    const sourceRoot = deps.telenoNodeSourceRoot
    const definition = monolithBuildDefinition(sourceRoot)
    const toolStatuses = await detectNativeBuildToolStatuses()
    const toolStatus = toolStatuses.cmake

    const repoExists = fs.existsSync(definition.repoPath)
    const artifactExists = fs.existsSync(definition.artifactPath)

    const service: TelenoNodeNativeBuildStatus = {
      serviceId: 'teleno-node',
      serviceName: 'Teleno Node',
      supported: true,
      buildSystem: 'cmake',
      repoPath: definition.repoPath,
      repoExists,
      artifactPath: definition.artifactPath,
      artifactExists,
      artifactUpdatedAt: artifactUpdatedAt(definition.artifactPath),
      buildable: repoExists && toolStatus.ok,
      note: !repoExists
        ? `Repo path not found: ${definition.repoPath}`
        : !toolStatus.ok
          ? toolStatus.note
          : artifactExists
            ? null
            : 'Aun no compilado',
      buildCommands: definition.buildCommands
    }

    return {
      ok: true,
      sourceRoot,
      services: [service],
      output: `Monolith build workspace: ${sourceRoot} · ${artifactExists ? 'compilado' : 'pendiente'}`
    }
  }

  async function monolithBuildAll(): Promise<TelenoNodeNativeBuildCommandResult> {
    const definition = monolithBuildDefinition(deps.telenoNodeSourceRoot)
    const result = await buildNativeService(definition)
    const builds = await monolithBuildStatus()

    return {
      ok: result.ok,
      action: 'build-all',
      serviceId: 'teleno-node',
      output: result.output,
      builds
    }
  }

  async function monolithBuildServiceAction(input?: TelenoNodeNativeBuildCommandInput): Promise<TelenoNodeNativeBuildCommandResult> {
    const serviceId = input?.serviceId?.trim() || 'teleno-node'

    if (serviceId !== 'teleno-node') {
      const builds = await monolithBuildStatus()
      return {
        ok: false,
        action: 'build-service',
        serviceId,
        output: `No hay build monolitico configurado para ${serviceId}`,
        builds
      }
    }

    const definition = monolithBuildDefinition(deps.telenoNodeSourceRoot)
    const result = await buildNativeService(definition)
    const builds = await monolithBuildStatus()
    return {
      ok: result.ok,
      action: 'build-service',
      serviceId,
      output: result.output,
      builds
    }
  }

  return {
    nativeBuildStatus,
    monolithBuildStatus,
    monolithBuildAll,
    monolithBuildServiceAction,
    nativeBuildAll,
    nativeBuildServiceAction
  }
}
