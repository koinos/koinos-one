type WalletAccountBarProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  walletActionLoading: string | null
  accounts: KnodelWalletAccountSummary[]
  activeAccountId: string
  activeWalletCanSign: boolean
  canCreateDerivedAccount: boolean
  onSetActiveAccount: (accountId: string) => void
  onOpenCreateAccount: () => void
  onOpenImportWif: () => void
  onOpenRenameAccount: () => void
  onOpenRemoveAccount: () => void
  onOpenSend: () => void
  onOpenBurn: () => void
  onSetAsProducer: () => void
}

export function WalletAccountBar(props: WalletAccountBarProps) {
  const {
    t,
    hasWalletControls,
    walletActionLoading,
    accounts,
    activeAccountId,
    activeWalletCanSign,
    canCreateDerivedAccount,
    onSetActiveAccount,
    onOpenCreateAccount,
    onOpenImportWif,
    onOpenRenameAccount,
    onOpenRemoveAccount,
    onOpenSend,
    onOpenBurn,
    onSetAsProducer
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
        <button type="button" className="ghost-button" onClick={onSetAsProducer} disabled={!hasWalletControls || isBusy || !activeWalletCanSign}>
          {t('wallet.setAsProducerAction')}
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
        <div className="wallet-account-bar-spacer" />
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
      </div>
      <div className="wallet-account-bar-buttons">
        <button type="button" className="primary-button" onClick={onOpenSend} disabled={!hasWalletControls || isBusy || !activeWalletCanSign}>
          Send
        </button>
        <button type="button" className="ghost-button" onClick={onOpenBurn} disabled={!hasWalletControls || isBusy || !activeWalletCanSign}>
          {t('wallet.burnAction')}
        </button>
      </div>
    </div>
  )
}
