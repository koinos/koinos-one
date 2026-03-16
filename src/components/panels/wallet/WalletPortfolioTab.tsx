type WalletPortfolioTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  walletBalance: KnodelWalletBalanceResult | null
}

export function WalletPortfolioTab(props: WalletPortfolioTabProps) {
  const { t, walletBalance } = props

  return (
    <div className="wallet-subpanel">
      <div className="wallet-card-grid">
        <article className="wallet-card wallet-portfolio-card">
          <div className="wallet-section-header">
            <div>
              <h3>{t('wallet.overviewTitle')}</h3>
              <p>{t('wallet.overviewDescription')}</p>
            </div>
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
        </article>
      </div>
    </div>
  )
}
