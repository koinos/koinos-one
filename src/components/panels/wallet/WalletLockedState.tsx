type WalletLockedStateProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  walletOverview: KnodelWalletOverviewResult | null
  walletUnlockPassword: string
  setWalletUnlockPassword: (value: string) => void
  unlockWalletAccount: () => void
  hasWalletControls: boolean
  walletActionLoading: string | null
}

export function WalletLockedState(props: WalletLockedStateProps) {
  const {
    t,
    walletOverview,
    walletUnlockPassword,
    setWalletUnlockPassword,
    unlockWalletAccount,
    hasWalletControls,
    walletActionLoading
  } = props

  const accountCount = walletOverview?.accountCount || 0
  const vaultSummary = walletOverview?.hasSeedPhrase
    ? t('wallet.lockedSeedBackedSummary', { count: accountCount })
    : t('wallet.lockedWifSummary', { count: accountCount })

  return (
    <div className="wallet-card-grid wallet-card-grid-locked">
      <article className="wallet-card wallet-card-unlock">
        <h3>{t('wallet.unlockTitle')}</h3>
        <p>{t('wallet.unlockDescription')}</p>
        <p className="wallet-lock-summary">{vaultSummary}</p>
        <div className="wallet-unlock-account">
          <span className="stat-label">{t('wallet.currentAccount')}</span>
          <p className="stat-value mono wallet-unlock-address" title={walletOverview?.walletAddress || t('common.na')}>
            {walletOverview?.walletAddress || t('common.na')}
          </p>
        </div>
        <label className="wallet-unlock-label">
          {t('wallet.password')}
          <input
            className="wallet-unlock-input"
            type="password"
            value={walletUnlockPassword}
            onChange={(event) => setWalletUnlockPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button
          type="button"
          className="primary-button wallet-unlock-button"
          onClick={unlockWalletAccount}
          disabled={!hasWalletControls || walletActionLoading !== null}
        >
          {walletActionLoading === 'wallet-unlock' ? t('common.loading') : t('wallet.unlockAction')}
        </button>
      </article>
    </div>
  )
}
