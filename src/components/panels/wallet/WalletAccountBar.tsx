type WalletAccountBarProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  walletActionLoading: string | null
  accounts: KnodelWalletAccountSummary[]
  activeAccountId: string
  activeAccount: KnodelWalletAccountSummary | null
  activeView: 'overview' | 'accounts' | 'security'
  onSetActiveAccount: (accountId: string) => void
  onOpenSend: () => void
  onToggleAccounts: () => void
  onToggleSecurity: () => void
}

export function WalletAccountBar(props: WalletAccountBarProps) {
  const {
    t,
    hasWalletControls,
    walletActionLoading,
    accounts,
    activeAccountId,
    activeAccount,
    activeView,
    onSetActiveAccount,
    onOpenSend,
    onToggleAccounts,
    onToggleSecurity
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
      </div>

      <div className="wallet-account-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onOpenSend}
          disabled={!hasWalletControls || isBusy || activeAccount?.kind === 'watch-only'}
        >
          {t('wallet.operationsAction')}
        </button>
        <button
          type="button"
          className={`wallet-header-toggle ${activeView === 'accounts' ? 'is-active' : ''}`}
          onClick={onToggleAccounts}
          disabled={!hasWalletControls || isBusy}
        >
          {t('wallet.accountsTitle')}
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
