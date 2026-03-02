const hasValue = (name) => Boolean(process.env[name] && process.env[name].trim())

const hasAppleIdCredentials =
  hasValue('APPLE_ID') && hasValue('APPLE_APP_SPECIFIC_PASSWORD') && hasValue('APPLE_TEAM_ID')
const hasApiKeyCredentials =
  hasValue('APPLE_API_KEY') && hasValue('APPLE_API_KEY_ID') && hasValue('APPLE_API_ISSUER')
const hasKeychainProfile = hasValue('APPLE_KEYCHAIN_PROFILE')

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
