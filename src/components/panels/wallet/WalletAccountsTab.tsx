type WalletAccountsTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  walletActionLoading: string | null
  accounts: KnodelWalletAccountSummary[]
  activeAccountId: string
  canCreateDerivedAccount: boolean
  onSetActiveAccount: (accountId: string) => void
  onOpenCreateAccount: () => void
  onOpenImportWif: () => void
  onOpenImportWatch: () => void
  onOpenRenameAccount: (account: KnodelWalletAccountSummary) => void
  onOpenRemoveAccount: (account: KnodelWalletAccountSummary) => void
}

function accountKindLabel(t: WalletAccountsTabProps['t'], kind: KnodelWalletAccountSummary['kind']): string {
  switch (kind) {
    case 'derived':
      return t('wallet.accountKindDerived')
    case 'imported-wif':
      return t('wallet.accountKindImported')
    case 'watch-only':
      return t('wallet.accountKindWatchOnly')
  }
}

export function WalletAccountsTab(props: WalletAccountsTabProps) {
  const {
    t,
    hasWalletControls,
    walletActionLoading,
    accounts,
    activeAccountId,
    canCreateDerivedAccount,
    onSetActiveAccount,
    onOpenCreateAccount,
    onOpenImportWif,
    onOpenImportWatch,
    onOpenRenameAccount,
    onOpenRemoveAccount
  } = props

  const isBusy = walletActionLoading !== null

  return (
    <div className="wallet-subpanel">
      <article className="wallet-card">
        <div className="wallet-section-header">
          <div>
            <h3>{t('wallet.accountsTitle')}</h3>
            <p>{t('wallet.accountsDescription')}</p>
          </div>
          <div className="wallet-inline-actions">
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
            <button type="button" className="ghost-button" onClick={onOpenImportWatch} disabled={!hasWalletControls || isBusy}>
              {t('wallet.importWatchAction')}
            </button>
          </div>
        </div>

        {!canCreateDerivedAccount && (
          <div className="node-warning" role="note">
            {t('wallet.deriveAccountUnavailable')}
          </div>
        )}

        <div className="wallet-accounts-list">
          {accounts.map((account) => (
            <article key={account.id} className={`wallet-account-row ${account.id === activeAccountId ? 'is-active' : ''}`}>
              <div className="wallet-account-row-main">
                <div className="wallet-account-row-header">
                  <strong>{account.name}</strong>
                  <span className="wallet-account-badge">{accountKindLabel(t, account.kind)}</span>
                  {account.id === activeAccountId && <span className="wallet-account-current">{t('wallet.accountActive')}</span>}
                </div>
                <p className="wallet-account-row-address mono">{account.address}</p>
                {account.derivationPath && <p className="wallet-account-row-path">{account.derivationPath}</p>}
              </div>
              <div className="wallet-account-row-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onSetActiveAccount(account.id)}
                  disabled={!hasWalletControls || isBusy || account.id === activeAccountId}
                >
                  {t('wallet.makeActiveAction')}
                </button>
                <button type="button" className="ghost-button" onClick={() => onOpenRenameAccount(account)} disabled={!hasWalletControls || isBusy}>
                  {t('wallet.renameAccountAction')}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => onOpenRemoveAccount(account)}
                  disabled={!hasWalletControls || isBusy || accounts.length <= 1}
                >
                  {t('wallet.removeAccountAction')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </article>
    </div>
  )
}
