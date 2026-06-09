type WalletOverviewStripProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  walletBalance: TelenoWalletBalanceResult | null
  walletBalanceLoading: boolean
  walletBalanceError: string | null
  walletBalanceRefreshedAt: number | null
  locale: string
  nativeTokenSymbol: string
}

export function WalletOverviewStrip(props: WalletOverviewStripProps) {
  const { t, walletBalance, walletBalanceLoading, walletBalanceError, walletBalanceRefreshedAt, locale, nativeTokenSymbol } = props
  const lastRefresh = walletBalanceRefreshedAt
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(walletBalanceRefreshedAt)
    : t('common.na')

  return (
    <>
      <div className="wallet-overview-grid">
        <article className="stat-card">
          <span className="stat-label">{t('wallet.availableNativeToken', { symbol: nativeTokenSymbol })}</span>
          <p className="stat-value">{walletBalance?.koin || t('common.na')}</p>
          <p className="stat-note">{nativeTokenSymbol}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('wallet.availableVhp')}</span>
          <p className="stat-value">{walletBalance?.vhp || t('common.na')}</p>
          <p className="stat-note">VHP</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('wallet.availableMana')}</span>
          <p className="stat-value">{walletBalance?.mana || t('common.na')}</p>
          <p className="stat-note">RC</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('wallet.lastRefreshTitle')}</span>
          <p className="stat-value">{lastRefresh}</p>
          <p className="stat-note">{t('wallet.backgroundRefreshNote')}</p>
        </article>
      </div>

      {walletBalanceLoading && !walletBalance && (
        <div className="node-warning" role="note">
          {t('wallet.loadingBalances')}
        </div>
      )}

      {walletBalanceError && (
        <div className="node-warning" role="note">
          {walletBalanceError}
        </div>
      )}
    </>
  )
}
