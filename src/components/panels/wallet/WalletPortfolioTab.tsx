type WalletPortfolioTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  walletBalance: KnodelWalletBalanceResult | null
  activeWalletCanSign: boolean
  onOpenSend: () => void
  onOpenBurn: () => void
}

export function WalletPortfolioTab(props: WalletPortfolioTabProps) {
  const { t, walletBalance, activeWalletCanSign, onOpenSend, onOpenBurn } = props

  return (
    <div className="wallet-subpanel">
      <div className="wallet-card-grid">
        <article className="wallet-card wallet-portfolio-card">
          <div className="wallet-section-header">
            <div></div>
          </div>

          <div className="wallet-token-table">
            <div className="wallet-token-table-row wallet-token-table-head">
              <span>{t('wallet.transferAsset')}</span>
              <span>{t('wallet.balanceAction')}</span>
            </div>
            <div className="wallet-token-table-row">
              <span>KOIN</span>
              <span>{walletBalance?.koin || t('common.na')}</span>
            </div>
            <div className="wallet-token-table-row">
              <span>VHP</span>
              <span>{walletBalance?.vhp || t('common.na')}</span>
            </div>
          </div>
          {!activeWalletCanSign && (
            <div className="node-warning" role="note">
              {t('wallet.watchOnlyCannotSign')}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
