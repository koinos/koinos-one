import { describe, expect, it } from 'vitest'

import { isTelenoNodeBackupUtilityCommand } from './process-detection'

describe('process detection helpers', () => {
  it('treats public bootstrap restore as a backup utility command, not a node runtime', () => {
    expect(
      isTelenoNodeBackupUtilityCommand(
        '/app/teleno_node --basedir=/data/koinos --config=/data/config.yml --backup-public-restore --backup-json'
      )
    ).toBe(true)
  })

  it('does not classify normal node startup with a backup config file as a backup utility command', () => {
    expect(
      isTelenoNodeBackupUtilityCommand(
        '/app/teleno_node --basedir=/data/koinos --config=/data/.teleno-native-backups/teleno-native-backup-config.yml --log-level=info'
      )
    ).toBe(false)
  })
})
