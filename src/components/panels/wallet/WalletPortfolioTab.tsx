type WalletPortfolioTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  nativeTokenSymbol: string
  walletBalance: TelenoWalletBalanceResult | null
  activeWalletCanSign: boolean
  isBusy: boolean
  onOpenSend: () => void
  onOpenBurn: () => void
  onOpenImportWif: () => void
}

export function WalletPortfolioTab(props: WalletPortfolioTabProps) {
  const { t, nativeTokenSymbol, walletBalance, activeWalletCanSign, isBusy, onOpenSend, onOpenBurn, onOpenImportWif } = props
  const signingActionTitle = isBusy
    ? t('wallet.disabledTooltip.busy')
    : !activeWalletCanSign
      ? t('wallet.watchOnlyCannotSign')
      : undefined

  return (
    <div className="wallet-subpanel">
      <article className="wallet-card wallet-portfolio-card">
        <div className="wallet-token-table">
          <div className="wallet-token-table-row wallet-token-table-head">
            <span>{t('wallet.transferAsset')}</span>
            <span>{t('wallet.balanceAction')}</span>
          </div>
          <div className="wallet-token-table-row">
            <span>{nativeTokenSymbol}</span>
            <span>{walletBalance?.koin || t('common.na')}</span>
          </div>
          <div className="wallet-token-table-row">
            <span>VHP</span>
            <span>{walletBalance?.vhp || t('common.na')}</span>
          </div>
        </div>
        <div className="wallet-portfolio-actions">
          <button type="button" className="primary-button" onClick={onOpenSend} disabled={isBusy || !activeWalletCanSign} title={signingActionTitle}>
            {t('wallet.transferAction')}
          </button>
          <button type="button" className="ghost-button" onClick={onOpenBurn} disabled={isBusy || !activeWalletCanSign} title={signingActionTitle}>
            {t('wallet.burnAction')}
          </button>
        </div>
        {!activeWalletCanSign && (
          <div className="node-warning" role="note">
            <span>{t('wallet.watchOnlyCannotSign')}</span>
            <button type="button" className="ghost-button" onClick={onOpenImportWif} disabled={isBusy} title={isBusy ? t('wallet.disabledTooltip.busy') : undefined}>
              {t('wallet.importSigningKeyAction')}
            </button>
          </div>
        )}
      </article>
    </div>
  )
}
