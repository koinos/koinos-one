type WalletLockedStateProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  walletOverview: TelenoWalletOverviewResult | null
  walletUnlockPassword: string
  setWalletUnlockPassword: (value: string) => void
  unlockWalletAccount: () => void
  hasWalletControls: boolean
  walletActionLoading: string | null
  showRecovery: boolean
  onImportWif: () => void
  onImportSeed: () => void
  onCreateWallet: () => void
  onDeleteWallet: () => void
}

export function WalletLockedState(props: WalletLockedStateProps) {
  const {
    t,
    walletOverview,
    walletUnlockPassword,
    setWalletUnlockPassword,
    unlockWalletAccount,
    hasWalletControls,
    walletActionLoading,
    showRecovery,
    onImportWif,
    onImportSeed,
    onCreateWallet,
    onDeleteWallet
  } = props

  const accountCount = walletOverview?.accountCount || 0
  const vaultSummary = walletOverview?.hasSeedPhrase
    ? t('wallet.lockedSeedBackedSummary', { count: accountCount })
    : t('wallet.lockedWifSummary', { count: accountCount })
  const isBusy = walletActionLoading !== null
  const disabledTitle = !hasWalletControls
    ? t('wallet.disabledTooltip.electronOnly')
    : isBusy
      ? t('wallet.disabledTooltip.busy')
      : undefined

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
          disabled={!hasWalletControls || isBusy}
          title={disabledTitle}
        >
          {walletActionLoading === 'wallet-unlock' ? t('common.loading') : t('wallet.unlockAction')}
        </button>
      </article>

      {showRecovery && (
        <article className="wallet-card wallet-card-recovery">
          <h3>{t('wallet.lockedRecoveryTitle')}</h3>
          <p>{t('wallet.lockedRecoveryDescription')}</p>
          <div className="wallet-inline-actions">
            <button type="button" className="ghost-button" onClick={onImportWif} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
              {t('wallet.importKeyAction')}
            </button>
            <button type="button" className="ghost-button" onClick={onImportSeed} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
              {t('wallet.importSeedAction')}
            </button>
            <button type="button" className="ghost-button" onClick={onCreateWallet} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
              {t('wallet.createAction')}
            </button>
          </div>
          <div className="node-warning wallet-recovery-warning" role="note">
            {t('wallet.lockedRecoveryDeleteWarning')}
          </div>
          <button type="button" className="danger-button wallet-recovery-delete" onClick={onDeleteWallet} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
            {t('wallet.deleteAction')}
          </button>
        </article>
      )}
    </div>
  )
}
