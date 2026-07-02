import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  completeFirstRunSetupState,
  readFirstRunSetupStateFile,
  readOrMigrateFirstRunSetupState,
  resetFirstRunSetupState,
  type FirstRunInstallDescriptor
} from './first-run-setup'

function install(overrides: Partial<FirstRunInstallDescriptor> = {}): FirstRunInstallDescriptor {
  return {
    appName: 'KoinosOne',
    appVersion: '1.0.3',
    appPath: '/Applications/KoinosOne.app/Contents/MacOS/KoinosOne',
    packaged: true,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    ...overrides
  }
}

function tempStateFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'koinos-one-first-run-')), 'first-run-setup-state.v1.json')
}

describe('first-run setup state', () => {
  it('keeps completed setup valid across app updates and reinstall path changes', () => {
    const filePath = tempStateFile()
    const original = completeFirstRunSetupState({
      filePath,
      install: install(),
      setup: { completedFrom: 'observer-install-assistant' }
    })

    expect(original.completed).toBe(true)

    const updated = readFirstRunSetupStateFile({
      filePath,
      install: install({
        appVersion: '1.0.4',
        appPath: '/Applications/Koinos One.app/Contents/MacOS/Koinos One',
        mtimeMs: 2000
      })
    })

    expect(updated.completed).toBe(true)
    expect(updated.installChangedSinceCompletion).toBe(true)
  })

  it('migrates missing markers when existing local setup evidence is present', () => {
    const filePath = tempStateFile()
    const state = readOrMigrateFirstRunSetupState({
      filePath,
      install: install(),
      existingSetupEvidence: { detected: true, reason: 'wallet-mainnet' }
    })

    expect(state.completed).toBe(true)
    expect(state.source).toBe('migrated-existing-setup')
    expect(state.migrationReason).toBe('wallet-mainnet')

    const persisted = readFirstRunSetupStateFile({ filePath, install: install() })
    expect(persisted.completed).toBe(true)
    expect(persisted.setup).toMatchObject({
      completedFrom: 'existing-install-migration',
      migrationReason: 'wallet-mainnet'
    })
  })

  it('does not auto-migrate after an explicit reset', () => {
    const filePath = tempStateFile()
    completeFirstRunSetupState({ filePath, install: install(), setup: { completedFrom: 'test' } })
    const reset = resetFirstRunSetupState({ filePath, install: install() })
    expect(reset.completed).toBe(false)

    const state = readOrMigrateFirstRunSetupState({
      filePath,
      install: install(),
      existingSetupEvidence: { detected: true, reason: 'app-preferences' }
    })

    expect(state.completed).toBe(false)
    expect(state.source).toBe('file')
  })
})
