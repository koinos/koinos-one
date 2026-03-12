import fs from 'node:fs'
import path from 'node:path'

import { KOINOS_GIT_CLONE_URL, LEGACY_DEFAULT_ENV_FILE } from './constants'
import type {
  KoinosNodeCloneRepoResult,
  KoinosNodeFileReadInput,
  KoinosNodeFileReadResult,
  KoinosNodeFileWriteInput,
  KoinosNodeFileWriteResult,
  KoinosNodeManagedFileKind,
  KoinosNodeSettings,
  KoinosNodeSettingsInput,
  KoinosNodeValidateBaseDirResult
} from './main-types'

type WorkspaceServiceDeps = {
  normalizeNodeSettings: (input?: KoinosNodeSettingsInput) => KoinosNodeSettings
  composeFilePath: (settings: KoinosNodeSettings) => string
  envFilePath: (settings: KoinosNodeSettings) => string
  configDirPath: (settings: KoinosNodeSettings) => string
  configExampleDirPath: (settings: KoinosNodeSettings) => string
  managedFilePath: (settings: KoinosNodeSettings, kind: KoinosNodeManagedFileKind) => string
  restoreWorkspaceParentPath: (baseDir: string) => string
  verifyWritableDirectory: (dirPath: string) => void
  runCommand: (
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
  ) => Promise<{ ok: boolean; code: number | null; output: string }>
}

export function directoryHasEntries(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length > 0
}

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
  function assertRepoReady(settings: KoinosNodeSettings): void {
    if (!fs.existsSync(settings.repoPath)) {
      throw new Error(`Koinos repo path not found: ${settings.repoPath}`)
    }
    const composePath = deps.composeFilePath(settings)
    if (!fs.existsSync(composePath)) {
      throw new Error(`Compose file not found: ${composePath}`)
    }
    const envPath = deps.envFilePath(settings)
    if (!fs.existsSync(envPath)) {
      throw new Error(`Env file not found: ${envPath}`)
    }
  }

  function ensureKoinosConfigFiles(settings: KoinosNodeSettings): { configReady: boolean; output: string } {
    const configDir = deps.configDirPath(settings)
    const exampleDir = deps.configExampleDirPath(settings)

    if (!fs.existsSync(configDir)) {
      if (!fs.existsSync(exampleDir)) {
        throw new Error(`Missing config dir and config-example dir in ${settings.repoPath}`)
      }
      fs.cpSync(exampleDir, configDir, { recursive: true })
      return { configReady: true, output: `Created config/ from config-example (${exampleDir})` }
    }

    const required = ['config.yml', 'genesis_data.json', 'koinos_descriptors.pb', 'rabbitmq.conf']
    const copied: string[] = []
    for (const file of required) {
      const target = path.join(configDir, file)
      if (fs.existsSync(target)) continue
      const source = path.join(exampleDir, file)
      if (!fs.existsSync(source)) continue
      fs.copyFileSync(source, target)
      copied.push(file)
    }

    const output =
      copied.length > 0 ? `Completed config/ with missing files from config-example: ${copied.join(', ')}` : 'config/ ready'

    return { configReady: true, output }
  }

  function ensureKoinosRepoRenamedFiles(settings: KoinosNodeSettings): string {
    if (!fs.existsSync(settings.repoPath)) return ''

    const notes: string[] = []

    const configExampleDir = deps.configExampleDirPath(settings)
    const configDir = deps.configDirPath(settings)
    if (!fs.existsSync(configDir) && fs.existsSync(configExampleDir)) {
      fs.renameSync(configExampleDir, configDir)
      notes.push('Renamed config-example/ -> config/')
    }

    const envExamplePath = path.join(settings.repoPath, LEGACY_DEFAULT_ENV_FILE)
    const dotEnvPath = path.join(settings.repoPath, '.env')
    if (!fs.existsSync(dotEnvPath) && fs.existsSync(envExamplePath)) {
      fs.renameSync(envExamplePath, dotEnvPath)
      notes.push('Renamed env.example -> .env')
    }

    return notes.join('\n')
  }

  async function restoreKoinosRepoTemplatesForRefresh(settings: KoinosNodeSettings): Promise<string> {
    const repoPath = settings.repoPath
    if (!fs.existsSync(path.join(repoPath, '.git'))) return ''

    const pathsToRestore: string[] = []
    const configDir = deps.configDirPath(settings)
    const configExampleDir = deps.configExampleDirPath(settings)
    const dotEnvPath = path.join(repoPath, '.env')
    const envExamplePath = path.join(repoPath, LEGACY_DEFAULT_ENV_FILE)

    if (fs.existsSync(configDir) && !fs.existsSync(configExampleDir)) {
      pathsToRestore.push('config-example')
    }
    if (fs.existsSync(dotEnvPath) && !fs.existsSync(envExamplePath)) {
      pathsToRestore.push(LEGACY_DEFAULT_ENV_FILE)
    }

    if (!pathsToRestore.length) return ''

    const result = await deps.runCommand('git', ['-C', repoPath, 'checkout', '--', ...pathsToRestore], {
      cwd: repoPath
    })

    const restoredLabel = `Restored tracked templates before refresh: ${pathsToRestore.join(', ')}`
    return [restoredLabel, result.output].filter(Boolean).join('\n')
  }

  function ensureBaseDirKoinosRuntimeFiles(settings: KoinosNodeSettings): string {
    const cfgDir = deps.configDirPath(settings)
    const mappings = [
      {
        sourceName: 'config.yml',
        targetPath: path.join(settings.baseDir, 'config.yml'),
        preserveExisting: true
      },
      {
        sourceName: 'genesis_data.json',
        targetPath: path.join(settings.baseDir, 'chain', 'genesis_data.json'),
        preserveExisting: false
      },
      {
        sourceName: 'koinos_descriptors.pb',
        targetPath: path.join(settings.baseDir, 'jsonrpc', 'descriptors', 'koinos_descriptors.pb'),
        preserveExisting: false
      }
    ] as const

    const copied: string[] = []
    const preserved: string[] = []
    for (const { sourceName, targetPath, preserveExisting } of mappings) {
      const sourcePath = path.join(cfgDir, sourceName)
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Missing config source for runtime file: ${sourcePath}`)
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      if (preserveExisting && fs.existsSync(targetPath)) {
        preserved.push(path.relative(settings.baseDir, targetPath))
        continue
      }
      fs.copyFileSync(sourcePath, targetPath)
      copied.push(path.relative(settings.baseDir, targetPath))
    }

    const notes: string[] = []
    if (copied.length > 0) {
      notes.push(`Prepared BASEDIR runtime files: ${copied.join(', ')}`)
    }
    if (preserved.length > 0) {
      notes.push(`Preserved existing BASEDIR runtime files: ${preserved.join(', ')}`)
    }

    return notes.join('\n') || 'BASEDIR runtime files already present'
  }

  function validateNodeBaseDirAccess(input?: KoinosNodeSettingsInput): KoinosNodeValidateBaseDirResult {
    const settings = deps.normalizeNodeSettings(input)
    const restoreWorkspaceParent = deps.restoreWorkspaceParentPath(settings.baseDir)

    try {
      deps.verifyWritableDirectory(restoreWorkspaceParent)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Permission denied'
      return {
        ok: false,
        baseDir: settings.baseDir,
        restoreWorkspaceParent,
        writable: false,
        output: `No se puede escribir en el volumen seleccionado para el restore temporal (${restoreWorkspaceParent}): ${detail}`
      }
    }

    try {
      deps.verifyWritableDirectory(settings.baseDir)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Permission denied'
      return {
        ok: false,
        baseDir: settings.baseDir,
        restoreWorkspaceParent,
        writable: false,
        output: `No se puede escribir en BASEDIR (${settings.baseDir}): ${detail}`
      }
    }

    return {
      ok: true,
      baseDir: settings.baseDir,
      restoreWorkspaceParent,
      writable: true,
      output: `BASEDIR listo: ${settings.baseDir} · restore temporal en ${restoreWorkspaceParent}`
    }
  }

  async function cloneKoinosRepo(input?: KoinosNodeSettingsInput): Promise<KoinosNodeCloneRepoResult> {
    const settings = deps.normalizeNodeSettings(input)
    const repoPath = settings.repoPath

    if (!repoPath.trim()) {
      return {
        ok: false,
        repoPath,
        output: 'Koinos repo path no puede estar vacio'
      }
    }

    if (fs.existsSync(repoPath)) {
      const stat = fs.statSync(repoPath)
      if (!stat.isDirectory()) {
        return {
          ok: false,
          repoPath,
          output: `La ruta existe pero no es un directorio: ${repoPath}`
        }
      }

      if (fs.existsSync(path.join(repoPath, '.git'))) {
        const refreshSteps: string[] = []
        const restoreTemplatesResult = await restoreKoinosRepoTemplatesForRefresh(settings)
        if (restoreTemplatesResult) refreshSteps.push(restoreTemplatesResult)
        const fetchResult = await deps.runCommand('git', ['-C', repoPath, 'fetch', '--all', '--prune'], {
          cwd: repoPath
        })
        if (fetchResult.output) refreshSteps.push(fetchResult.output)
        if (!fetchResult.ok) {
          return {
            ok: false,
            repoPath,
            output: refreshSteps.join('\n')
          }
        }

        const pullResult = await deps.runCommand('git', ['-C', repoPath, 'pull', '--ff-only'], {
          cwd: repoPath
        })
        if (pullResult.output) refreshSteps.push(pullResult.output)
        const renameNotes = ensureKoinosRepoRenamedFiles(settings)
        if (renameNotes) refreshSteps.push(renameNotes)
        return {
          ok: pullResult.ok,
          repoPath,
          output:
            refreshSteps.join('\n').trim() ||
            (pullResult.ok
              ? `Refreshed Koinos repo in ${repoPath}`
              : `No se pudo refrescar el repo de Koinos en ${repoPath}`)
        }
      }

      const existingEntries = fs.readdirSync(repoPath)
      if (existingEntries.length > 0) {
        return {
          ok: false,
          repoPath,
          output: `La carpeta destino ya existe y no esta vacia: ${repoPath}`
        }
      }
    } else {
      fs.mkdirSync(path.dirname(repoPath), { recursive: true })
    }

    const result = await deps.runCommand('git', ['clone', KOINOS_GIT_CLONE_URL, repoPath], {
      cwd: path.dirname(repoPath)
    })

    const renameNotes = result.ok ? ensureKoinosRepoRenamedFiles(settings) : ''
    const output = [result.output, renameNotes]
      .filter(Boolean)
      .join('\n')
      .trim() || (result.ok ? `Cloned ${KOINOS_GIT_CLONE_URL} into ${repoPath}` : 'git clone failed')
    return {
      ok: result.ok,
      repoPath,
      output
    }
  }

  async function readKoinosManagedFile(input: KoinosNodeFileReadInput): Promise<KoinosNodeFileReadResult> {
    const settings = deps.normalizeNodeSettings(input)
    const kind = input.kind
    const filePath = deps.managedFilePath(settings, kind)

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return {
        ok: true,
        kind,
        filePath,
        content,
        output: `Loaded ${kind} file: ${filePath}`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `No se pudo leer ${kind} file`
      return {
        ok: false,
        kind,
        filePath,
        content: '',
        output: message
      }
    }
  }

  async function writeKoinosManagedFile(input: KoinosNodeFileWriteInput): Promise<KoinosNodeFileWriteResult> {
    const settings = deps.normalizeNodeSettings(input)
    const kind = input.kind
    const filePath = deps.managedFilePath(settings, kind)
    const content = input.content ?? ''

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf8')
      return {
        ok: true,
        kind,
        filePath,
        output: `Saved ${kind} file: ${filePath}`
      }
    } catch (error) {
      return {
        ok: false,
        kind,
        filePath,
        output: error instanceof Error ? error.message : `No se pudo guardar ${kind} file`
      }
    }
  }

  return {
    assertRepoReady,
    ensureKoinosConfigFiles,
    ensureKoinosRepoRenamedFiles,
    restoreKoinosRepoTemplatesForRefresh,
    ensureBaseDirKoinosRuntimeFiles,
    validateNodeBaseDirAccess,
    cloneKoinosRepo,
    readKoinosManagedFile,
    writeKoinosManagedFile
  }
}
