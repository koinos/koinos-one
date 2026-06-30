import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { WalletAccountBar } from './WalletAccountBar'

const messages: Record<string, string> = {
  'common.copied': 'Copied!',
  'wallet.copyAddress': 'Copy address',
  'wallet.currentAccount': 'Current account',
  'wallet.deriveAccountUnavailable': 'This vault has no stored seed phrase.',
  'wallet.disabledTooltip.busy': 'Disabled while Koinos One finishes the current wallet operation.',
  'wallet.disabledTooltip.electronOnly': 'Unavailable in this browser view.',
  'wallet.disabledTooltip.noActiveAccount': 'Disabled until a wallet account is selected.',
  'wallet.disabledTooltip.removeLastAccount': 'You cannot remove the only account in this wallet.',
  'wallet.importAccountAction': 'Import',
  'wallet.removeAccountAction': 'Remove',
  'wallet.renameAccountAction': 'Rename',
  'wallet.securityTab': 'Security',
  'wallet.setAsProducerAction': 'Set Producer',
  'wallet.tokensTab': 'Tokens',
  'wallet.watchOnlyCannotSign': 'This account only has its public address.'
}

function t(key: string): string {
  return messages[key] ?? key
}

function account(overrides: Partial<TelenoWalletAccountSummary> = {}): TelenoWalletAccountSummary {
  return {
    id: 'account-1',
    name: 'Account 1',
    address: '1Example',
    kind: 'watch-only',
    ...overrides
  }
}

describe('WalletAccountBar', () => {
  it('explains disabled account actions with titles', () => {
    const html = renderToStaticMarkup(
      <WalletAccountBar
        t={t}
        hasWalletControls
        walletActionLoading={null}
        accounts={[account()]}
        activeAccountId="account-1"
        activeWalletCanSign={false}
        canCreateDerivedAccount={false}
        activeView="tokens"
        onSetActiveAccount={vi.fn()}
        onOpenCreateAccount={vi.fn()}
        onOpenImportWif={vi.fn()}
        onOpenRenameAccount={vi.fn()}
        onOpenRemoveAccount={vi.fn()}
        onOpenSend={vi.fn()}
        onOpenBurn={vi.fn()}
        onSetAsProducer={vi.fn()}
        onToggleTokens={vi.fn()}
        onToggleSecurity={vi.fn()}
      />
    )

    expect(html).toContain('title="This account only has its public address."')
    expect(html).toContain('title="You cannot remove the only account in this wallet."')
    expect(html).toContain('title="This vault has no stored seed phrase."')
  })

  it('explains disabled wallet actions while busy', () => {
    const html = renderToStaticMarkup(
      <WalletAccountBar
        t={t}
        hasWalletControls
        walletActionLoading="wallet-import"
        accounts={[account({ kind: 'derived' })]}
        activeAccountId="account-1"
        activeWalletCanSign
        canCreateDerivedAccount
        activeView="tokens"
        onSetActiveAccount={vi.fn()}
        onOpenCreateAccount={vi.fn()}
        onOpenImportWif={vi.fn()}
        onOpenRenameAccount={vi.fn()}
        onOpenRemoveAccount={vi.fn()}
        onOpenSend={vi.fn()}
        onOpenBurn={vi.fn()}
        onSetAsProducer={vi.fn()}
        onToggleTokens={vi.fn()}
        onToggleSecurity={vi.fn()}
      />
    )

    expect(html).toContain('title="Disabled while Koinos One finishes the current wallet operation."')
  })
})
