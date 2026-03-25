type WalletAccountBarProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  walletActionLoading: string | null
  accounts: KnodelWalletAccountSummary[]
  activeAccountId: string
  activeView: 'tokens' | 'accounts' | 'security'
  canCreateDerivedAccount: boolean
  onSetActiveAccount: (accountId: string) => void
  onToggleTokens: () => void
  onToggleAccounts: () => void
  onToggleSecurity: () => void
  onOpenCreateAccount: () => void
  onOpenImportWif: () => void
  onOpenRenameAccount: () => void
  onOpenRemoveAccount: () => void
}

export function WalletAccountBar(props: WalletAccountBarProps) {
  const {
    t,
    hasWalletControls,
    walletActionLoading,
    accounts,
    activeAccountId,
    activeView,
    canCreateDerivedAccount,
    onSetActiveAccount,
    onToggleTokens,
    onToggleSecurity,
    onOpenCreateAccount,
    onOpenImportWif,
    onOpenRenameAccount,
    onOpenRemoveAccount
  } = props

  const isBusy = walletActionLoading !== null

  return (
    <div className="wallet-account-bar">
      <div className="wallet-account-bar-main">
        <label className="wallet-account-picker">
          <span className="wallet-account-picker-label">{t('wallet.currentAccount')}</span>
          <select
            value={activeAccountId}
            onChange={(event) => onSetActiveAccount(event.target.value)}
            disabled={!hasWalletControls || isBusy || accounts.length === 0}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.address}
              </option>
            ))}
          </select>
        </label>
        <div className="wallet-account-bar-buttons">
          <button
            type="button"
            className="ghost-button"
            onClick={onOpenCreateAccount}
            disabled={!hasWalletControls || isBusy || !canCreateDerivedAccount}
            title={!canCreateDerivedAccount ? t('wallet.deriveAccountUnavailable') : undefined}
          >
            {t('wallet.createDerivedAccountAction')}
          </button>
          <button type="button" className="ghost-button" onClick={onOpenImportWif} disabled={!hasWalletControls || isBusy}>
            {t('wallet.importAccountAction')}
          </button>
          <button type="button" className="ghost-button" onClick={onOpenRenameAccount} disabled={!hasWalletControls || isBusy}>
            {t('wallet.renameAccountAction')}
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={onOpenRemoveAccount}
            disabled={!hasWalletControls || isBusy || accounts.length <= 1}
          >
            {t('wallet.removeAccountAction')}
          </button>
        </div>
      </div>

      <div className="wallet-account-actions">
        <button
          type="button"
          className={`wallet-header-toggle ${activeView === 'tokens' ? 'is-active' : ''}`}
          onClick={onToggleTokens}
          disabled={!hasWalletControls || isBusy}
        >
          {t('wallet.tokensTitle')}
        </button>
        <button
          type="button"
          className={`wallet-header-toggle ${activeView === 'security' ? 'is-active' : ''}`}
          onClick={onToggleSecurity}
          disabled={!hasWalletControls || isBusy}
        >
          {t('wallet.securityTitle')}
        </button>
      </div>
    </div>
  )
}
