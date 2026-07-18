const { spawnSync } = require('node:child_process')

const hasValue = (name) => Boolean(process.env[name] && process.env[name].trim())

const hasAppleIdCredentials =
  hasValue('APPLE_ID') && hasValue('APPLE_APP_SPECIFIC_PASSWORD') && hasValue('APPLE_TEAM_ID')
const hasApiKeyCredentials =
  hasValue('APPLE_API_KEY') && hasValue('APPLE_API_KEY_ID') && hasValue('APPLE_API_ISSUER')
const hasKeychainProfile = hasValue('APPLE_KEYCHAIN_PROFILE')
const hasImportedSigningCertificate = hasValue('CSC_LINK')

if (process.platform !== 'darwin') {
  console.error('Signed and notarized macOS packages must be built on macOS.')
  process.exit(1)
}

if (!hasImportedSigningCertificate) {
  const identityResult = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })
  const identityOutput = `${identityResult.stdout || ''}\n${identityResult.stderr || ''}`

  if (identityResult.status !== 0 || !identityOutput.includes('Developer ID Application:')) {
    console.error('Missing a Developer ID Application signing identity.')
    console.error('Install the distribution certificate or provide CSC_LINK and CSC_KEY_PASSWORD.')
    process.exit(1)
  }

  console.log('Developer ID Application signing identity detected.')
} else {
  console.log('Imported macOS signing certificate detected through CSC_LINK.')
}

if (hasAppleIdCredentials || hasApiKeyCredentials || hasKeychainProfile) {
  console.log('Notarization credentials detected.')
  process.exit(0)
}

console.error('Missing notarization credentials.')
console.error('Provide one of the following before running a notarized macOS build:')
console.error('- APPLE_KEYCHAIN_PROFILE (recommended, optionally with APPLE_KEYCHAIN)')
console.error('- APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID')
console.error('- APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER')
process.exit(1)
