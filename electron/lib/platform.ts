import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export type Platform = 'darwin' | 'win32' | 'linux'

export function currentPlatform(): Platform {
  return process.platform as Platform
}

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isDarwin(): boolean {
  return process.platform === 'darwin'
}

export function isAppleSilicon(): boolean {
  return isDarwin() && os.arch() === 'arm64'
}

export function executableExtension(): string {
  return isWindows() ? '.exe' : ''
}

export function findExecutableInPath(command: string): string | null {
  const extensions = isWindows() ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathDirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map(d => d.trim())
    .filter(Boolean)

  // On Mac, also check Homebrew paths
  if (isDarwin()) {
    const homebrewPrefix = '/opt/homebrew'
    if (fs.existsSync(homebrewPrefix)) {
      pathDirs.unshift(path.join(homebrewPrefix, 'bin'), path.join(homebrewPrefix, 'sbin'))
    }
  }

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

export function homebrewPrefix(): string | null {
  if (!isDarwin()) return null
  const prefix = '/opt/homebrew'
  return fs.existsSync(prefix) ? prefix : null
}
