export const MAINNET_LEGACY_BACKUP_URL = 'https://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'

const FORMER_MAINNET_LEGACY_BACKUP_URL = 'http://seed.koinosfoundation.org/backups/koinos_blockchain_backup.tar.gz'

const validationMessages = {
  empty: 'Enter the direct HTTPS URL of a signed legacy backup in Settings > Backup.',
  https: 'In Settings > Backup, use the final HTTPS backup URL without credentials, a query, or a fragment.',
  tar: 'In Settings > Backup, use the direct HTTPS URL of the signed .tar.gz archive.'
} as const

export class LegacyBackupUrlError extends Error {
  constructor(readonly reason: keyof typeof validationMessages) {
    super(validationMessages[reason])
  }
}

export function legacyBackupUrlForNetwork(raw: string | undefined, network: string): string {
  const value = raw ?? ''
  if (value === FORMER_MAINNET_LEGACY_BACKUP_URL || !value.trim()) {
    return network === 'mainnet' ? MAINNET_LEGACY_BACKUP_URL : ''
  }
  return value
}

export function normalizeBlockchainBackupArchiveUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new LegacyBackupUrlError('empty')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new LegacyBackupUrlError('https')
  }
  const normalized = parsed.toString()
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || normalized.includes('?') || normalized.includes('#')) {
    throw new LegacyBackupUrlError('https')
  }
  if (!parsed.pathname.endsWith('.tar.gz')) throw new LegacyBackupUrlError('tar')
  return normalized
}
