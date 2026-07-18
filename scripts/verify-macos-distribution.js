const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(ROOT, 'release')
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const productName = 'KoinosOne'
const arch = process.arch

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()

  if (output) console.log(output)
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`)
  }

  return output
}

if (process.platform !== 'darwin') {
  fail('macOS distribution verification must run on macOS.')
}

const appCandidates = [
  path.join(RELEASE_DIR, `mac-${arch}`, `${productName}.app`),
  path.join(RELEASE_DIR, 'mac-arm64', `${productName}.app`),
  path.join(RELEASE_DIR, 'mac', `${productName}.app`),
]
const appPath = appCandidates.find((candidate) => fs.existsSync(candidate))
const dmgPath = path.join(RELEASE_DIR, `${productName}-${packageJson.version}-${arch}.dmg`)

if (!appPath) {
  fail(`Packaged app not found. Checked: ${appCandidates.join(', ')}`)
}
if (!fs.existsSync(dmgPath)) {
  fail(`DMG not found: ${dmgPath}`)
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
const signatureDetails = run('codesign', ['--display', '--verbose=4', appPath])

if (!signatureDetails.includes('Authority=Developer ID Application:')) {
  fail('The app is not signed with a Developer ID Application certificate.')
}
if (signatureDetails.includes('Signature=adhoc') || signatureDetails.includes('TeamIdentifier=not set')) {
  fail('The app has an ad hoc or incomplete signing identity.')
}

run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
run('xcrun', ['stapler', 'validate', appPath])
run('hdiutil', ['verify', dmgPath])
run('xcrun', ['stapler', 'validate', dmgPath])
run('spctl', [
  '--assess',
  '--type',
  'open',
  '--context',
  'context:primary-signature',
  '--verbose=4',
  dmgPath,
])

console.log(`Signed and notarized macOS distribution verified: ${dmgPath}`)
