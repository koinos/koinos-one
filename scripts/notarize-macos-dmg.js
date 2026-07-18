const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const dmgPath = path.join(ROOT, 'release', `KoinosOne-${packageJson.version}-${process.arch}.dmg`)

const hasValue = (name) => Boolean(process.env[name] && process.env[name].trim())

function fail(message, details = '') {
  console.error(message)
  if (details.trim()) console.error(details.trim())
  process.exit(1)
}

function authenticationArgs() {
  if (hasValue('APPLE_KEYCHAIN_PROFILE')) {
    const args = ['--keychain-profile', process.env.APPLE_KEYCHAIN_PROFILE]
    if (hasValue('APPLE_KEYCHAIN')) args.push('--keychain', process.env.APPLE_KEYCHAIN)
    return args
  }

  if (
    hasValue('APPLE_ID') &&
    hasValue('APPLE_APP_SPECIFIC_PASSWORD') &&
    hasValue('APPLE_TEAM_ID')
  ) {
    return [
      '--apple-id',
      process.env.APPLE_ID,
      '--password',
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      process.env.APPLE_TEAM_ID,
    ]
  }

  if (hasValue('APPLE_API_KEY') && hasValue('APPLE_API_KEY_ID') && hasValue('APPLE_API_ISSUER')) {
    return [
      '--key',
      process.env.APPLE_API_KEY,
      '--key-id',
      process.env.APPLE_API_KEY_ID,
      '--issuer',
      process.env.APPLE_API_ISSUER,
    ]
  }

  fail('Missing Apple notarization credentials for the DMG submission.')
}

function signingIdentity() {
  const identityResult = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })
  const identityOutput = `${identityResult.stdout || ''}\n${identityResult.stderr || ''}`

  if (identityResult.status !== 0) {
    fail('Could not inspect macOS code-signing identities.', identityResult.stderr)
  }

  const identities = [...identityOutput.matchAll(/"(Developer ID Application:[^"]+)"/g)].map(
    (match) => match[1],
  )
  const requestedIdentity = hasValue('CSC_NAME') ? process.env.CSC_NAME : ''
  const selectedIdentity = requestedIdentity
    ? identities.find((identity) => identity.includes(requestedIdentity))
    : identities[0]

  if (!selectedIdentity) {
    fail('Missing a matching Developer ID Application identity for DMG signing.')
  }

  return selectedIdentity
}

if (process.platform !== 'darwin') {
  fail('DMG notarization must run on macOS.')
}
if (!fs.existsSync(dmgPath)) {
  fail(`DMG not found: ${dmgPath}`)
}

const identity = signingIdentity()
console.log(`Signing DMG with ${identity}`)
const signResult = spawnSync(
  'codesign',
  ['--force', '--sign', identity, '--timestamp', dmgPath],
  {
    cwd: ROOT,
    encoding: 'utf8',
  },
)

if (signResult.status !== 0) {
  fail('Could not sign the DMG with Developer ID Application.', signResult.stderr)
}

console.log(`Submitting DMG to Apple notarization: ${dmgPath}`)
const submitResult = spawnSync(
  'xcrun',
  [
    'notarytool',
    'submit',
    dmgPath,
    ...authenticationArgs(),
    '--wait',
    '--output-format',
    'json',
  ],
  {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  },
)

if (submitResult.status !== 0) {
  fail('Apple rejected or failed the DMG notarization submission.', submitResult.stderr)
}

let submission
try {
  submission = JSON.parse(submitResult.stdout)
} catch {
  fail('Apple returned an unreadable notarization response.', submitResult.stdout)
}

if (submission.status !== 'Accepted') {
  fail(
    `DMG notarization was not accepted (status: ${submission.status || 'unknown'}).`,
    submission.id ? `Submission ID: ${submission.id}` : '',
  )
}

console.log(`DMG notarization accepted. Submission ID: ${submission.id}`)
const stapleResult = spawnSync('xcrun', ['stapler', 'staple', dmgPath], {
  cwd: ROOT,
  encoding: 'utf8',
})

if (stapleResult.status !== 0) {
  fail('Could not staple the notarization ticket to the DMG.', stapleResult.stderr)
}

console.log((stapleResult.stdout || '').trim())
