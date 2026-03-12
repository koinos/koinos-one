import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { artifactUpdatedAt, firstOutputLine } from './native-build-service'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knodel-native-build-service-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('native-build-service helpers', () => {
  it('returns the first non-empty output line', () => {
    expect(firstOutputLine('\n\n  first\nsecond\n', 'fallback')).toBe('first')
    expect(firstOutputLine('   \n', 'fallback')).toBe('fallback')
  })

  it('reads artifact modification timestamps only for existing files', () => {
    const dir = makeTempDir()
    const artifactPath = path.join(dir, 'artifact.bin')
    fs.writeFileSync(artifactPath, 'artifact')

    expect(artifactUpdatedAt(artifactPath)).toBeTypeOf('number')
    expect(artifactUpdatedAt(path.join(dir, 'missing.bin'))).toBeNull()
    expect(artifactUpdatedAt(null)).toBeNull()
  })
})
