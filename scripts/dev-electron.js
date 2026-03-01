const fs = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')

const electronBinary = require('electron')

const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' }
delete env.ELECTRON_RUN_AS_NODE

const projectRoot = path.join(__dirname, '..')
const watchedFiles = [path.join(projectRoot, 'dist-electron', 'main.js'), path.join(projectRoot, 'dist-electron', 'preload.js')]

let child = null
let restarting = false
let shutdownRequested = false
let restartTimer = null

function spawnElectron() {
  child = spawn(electronBinary, ['.'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit'
  })

  child.on('exit', (code, signal) => {
    const expectedChild = child
    child = null

    if (restarting) {
      restarting = false
      spawnElectron()
      return
    }

    if (shutdownRequested) {
      process.exit(code ?? 0)
      return
    }

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    if (expectedChild) {
      process.exit(code ?? 0)
    }
  })

  child.on('error', (error) => {
    console.error(error.message)
    process.exit(1)
  })
}

function restartElectron() {
  if (shutdownRequested) return
  if (!child) {
    spawnElectron()
    return
  }

  if (restarting) return
  restarting = true

  try {
    child.kill('SIGTERM')
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

for (const watchedFile of watchedFiles) {
  fs.watchFile(
    watchedFile,
    { interval: 250 },
    (current, previous) => {
      if (current.mtimeMs === 0 || current.mtimeMs === previous.mtimeMs) return
      clearTimeout(restartTimer)
      restartTimer = setTimeout(() => {
        restartElectron()
      }, 150)
    }
  )
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdownRequested = true
    clearTimeout(restartTimer)
    for (const watchedFile of watchedFiles) {
      fs.unwatchFile(watchedFile)
    }

    if (!child) {
      process.exit(0)
      return
    }

    try {
      child.kill(signal)
    } catch {
      process.exit(0)
    }
  })
}

spawnElectron()
