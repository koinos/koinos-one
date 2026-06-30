import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { WalletLockedState } from './WalletLockedState'

const translations: Record<string, string> = {
  'common.loading': 'Loading...',
  'common.na': 'N/A',
  'wallet.createAction': 'Create',
  'wallet.currentAccount': 'Current account',
  'wallet.deleteAction': 'Delete wallet',
  'wallet.importKeyAction': 'Import with WIF',
  'wallet.importSeedAction': 'Import with seed',
  'wallet.lockedRecoveryDeleteWarning': 'Delete removes only the encrypted wallet stored on this computer.',
  'wallet.lockedRecoveryDescription': 'Import a WIF, import a seed, create a new wallet, or delete the stored vault.',
  'wallet.lockedRecoveryTitle': 'Cannot unlock?',
  'wallet.lockedSeedBackedSummary': '{count} accounts, seed-backed vault',
  'wallet.lockedWifSummary': '{count} accounts, WIF-backed vault',
  'wallet.password': 'Password',
  'wallet.unlockAction': 'Unlock',
  'wallet.unlockDescription': 'Unlock the encrypted wallet stored in Koinos One for the current app session.',
  'wallet.unlockTitle': 'Unlock'
}

function t(key: string, values: Record<string, string | number> = {}): string {
  const template = translations[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`))
}

function renderLockedState(showRecovery = false): string {
  return renderToStaticMarkup(
    <WalletLockedState
      t={t}
      walletOverview={{
        walletExists: true,
        walletAddress: '15N8CEwEfTqk1Uqqz8FfGerk2E6V5GNDox',
        accountCount: 1,
        hasSeedPhrase: true
      } as TelenoWalletOverviewResult}
      walletUnlockPassword=""
      setWalletUnlockPassword={vi.fn()}
      unlockWalletAccount={vi.fn()}
      hasWalletControls
      walletActionLoading={null}
      showRecovery={showRecovery}
      onImportWif={vi.fn()}
      onImportSeed={vi.fn()}
      onCreateWallet={vi.fn()}
      onDeleteWallet={vi.fn()}
    />
  )
}

describe('WalletLockedState', () => {
  it('hides recovery actions before the user fails to unlock', () => {
    const html = renderLockedState(false)

    expect(html).toContain('Unlock')
    expect(html).not.toContain('Cannot unlock?')
    expect(html).not.toContain('Import with WIF')
    expect(html).not.toContain('Delete wallet')
  })

  it('renders recovery actions after the wallet unlock fails', () => {
    const html = renderLockedState(true)

    expect(html).toContain('Unlock')
    expect(html).toContain('Cannot unlock?')
    expect(html).toContain('Import with WIF')
    expect(html).toContain('Import with seed')
    expect(html).toContain('Create')
    expect(html).toContain('Delete wallet')
  })
})
