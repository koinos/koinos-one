type WalletEmptyStateProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  isBusy: boolean
  onImportWif: () => void
  onImportSeed: () => void
  onCreateWallet: () => void
}

export function WalletEmptyState(props: WalletEmptyStateProps) {
  const { t, hasWalletControls, isBusy, onImportWif, onImportSeed, onCreateWallet } = props
  const disabledTitle = !hasWalletControls
    ? t('wallet.disabledTooltip.electronOnly')
    : isBusy
      ? t('wallet.disabledTooltip.busy')
      : undefined

  return (
    <section className="wallet-empty-state">
      <div>
        <h3>{t('wallet.emptyTitle')}</h3>
        <p>{t('wallet.emptyDescription')}</p>
      </div>
      <div className="wallet-empty-actions">
        <button type="button" className="ghost-button" onClick={onImportWif} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
          {t('wallet.importKeyAction')}
        </button>
        <button type="button" className="ghost-button" onClick={onImportSeed} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
          {t('wallet.importSeedAction')}
        </button>
        <button type="button" className="primary-button" onClick={onCreateWallet} disabled={!hasWalletControls || isBusy} title={disabledTitle}>
          {t('wallet.createAction')}
        </button>
      </div>
    </section>
  )
}
