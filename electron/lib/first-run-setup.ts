import fs from 'node:fs'
import path from 'node:path'

export const FIRST_RUN_SETUP_STATE_FILE = 'first-run-setup-state.v1.json'

export type FirstRunInstallDescriptor = {
  appName: string
  appVersion: string
  appPath: string
  packaged: boolean
  mtimeMs: number | null
  birthtimeMs: number | null
}

export type FirstRunExistingSetupEvidence = {
  detected: boolean
  reason: string
}

export type FirstRunSetupState = {
  ok: true
  completed: boolean
  filePath: string
  install: FirstRunInstallDescriptor
  completedAt: string | null
  setup: unknown | null
  source: 'file' | 'missing' | 'unreadable' | 'migrated-existing-setup' | 'reset'
  migrated: boolean
  migrationReason: string | null
  installChangedSinceCompletion: boolean
}

type StoredFirstRunSetupState = {
  completed?: boolean
  completedAt?: string
  install?: Partial<FirstRunInstallDescriptor>
  setup?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeStoredSetup(input: unknown): unknown | null {
  return isRecord(input) ? input : null
}

function installChanged(previous: Partial<FirstRunInstallDescriptor> | undefined, current: FirstRunInstallDescriptor): boolean {
  if (!previous) return false
  return (
    previous.appName !== undefined && previous.appName !== current.appName
  ) || (
    previous.appVersion !== undefined && previous.appVersion !== current.appVersion
  ) || (
    previous.appPath !== undefined && previous.appPath !== current.appPath
  )
}

function writeStateFile(filePath: string, payload: StoredFirstRunSetupState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  fs.renameSync(tempPath, filePath)
  fs.chmodSync(filePath, 0o600)
}

function completedState(
  filePath: string,
  install: FirstRunInstallDescriptor,
  raw: StoredFirstRunSetupState,
  source: FirstRunSetupState['source'],
  migrationReason: string | null = null
): FirstRunSetupState {
  return {
    ok: true,
    completed: true,
    filePath,
    install,
    completedAt: raw.completedAt || null,
    setup: sanitizeStoredSetup(raw.setup),
    source,
    migrated: source === 'migrated-existing-setup',
    migrationReason,
    installChangedSinceCompletion: installChanged(raw.install, install)
  }
}

function incompleteState(
  filePath: string,
  install: FirstRunInstallDescriptor,
  source: FirstRunSetupState['source'],
  setup: unknown | null = null
): FirstRunSetupState {
  return {
    ok: true,
    completed: false,
    filePath,
    install,
    completedAt: null,
    setup,
    source,
    migrated: false,
    migrationReason: null,
    installChangedSinceCompletion: false
  }
}

export function readFirstRunSetupStateFile(params: {
  filePath: string
  install: FirstRunInstallDescriptor
}): FirstRunSetupState {
  const { filePath, install } = params
  if (!fs.existsSync(filePath)) {
    return incompleteState(filePath, install, 'missing')
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredFirstRunSetupState
    if (raw.completed === true) {
      return completedState(filePath, install, raw, 'file')
    }
    return incompleteState(filePath, install, 'file', sanitizeStoredSetup(raw.setup))
  } catch {
    return incompleteState(filePath, install, 'unreadable')
  }
}

export function readOrMigrateFirstRunSetupState(params: {
  filePath: string
  install: FirstRunInstallDescriptor
  existingSetupEvidence?: FirstRunExistingSetupEvidence | null
}): FirstRunSetupState {
  const state = readFirstRunSetupStateFile(params)
  if (
    state.completed ||
    (state.source !== 'missing' && state.source !== 'unreadable') ||
    params.existingSetupEvidence?.detected !== true
  ) {
    return state
  }

  const payload: StoredFirstRunSetupState = {
    completed: true,
    completedAt: new Date().toISOString(),
    install: params.install,
    setup: {
      completedFrom: 'existing-install-migration',
      migrationReason: params.existingSetupEvidence.reason
    }
  }

  try {
    writeStateFile(params.filePath, payload)
  } catch {
    // If the marker cannot be written, still avoid treating a known existing
    // setup as a first install during this launch.
  }

  return completedState(
    params.filePath,
    params.install,
    payload,
    'migrated-existing-setup',
    params.existingSetupEvidence.reason
  )
}

export function completeFirstRunSetupState(params: {
  filePath: string
  install: FirstRunInstallDescriptor
  setup?: unknown
}): FirstRunSetupState {
  const payload: StoredFirstRunSetupState = {
    completed: true,
    completedAt: new Date().toISOString(),
    install: params.install,
    setup: sanitizeStoredSetup(params.setup)
  }
  writeStateFile(params.filePath, payload)
  return readFirstRunSetupStateFile(params)
}

export function resetFirstRunSetupState(params: {
  filePath: string
  install: FirstRunInstallDescriptor
}): FirstRunSetupState {
  const payload: StoredFirstRunSetupState = {
    completed: false,
    install: params.install,
    setup: {
      completedFrom: 'manual-reset'
    }
  }
  writeStateFile(params.filePath, payload)
  return incompleteState(params.filePath, params.install, 'reset', payload.setup)
}
