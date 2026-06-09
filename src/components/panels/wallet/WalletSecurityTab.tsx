type WalletSecretsResult = {
  accountId?: string | null
  accountName?: string | null
  accountKind?: TelenoWalletAccountKind | null
  firstAccountAddress?: string | null
  firstAccountPrivateKeyWif?: string | null
  firstAccountDerivationPath?: string | null
  seedPhrase?: string | null
}

type WalletSecurityTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  activeAccount: TelenoWalletAccountSummary | null
  hasWalletControls: boolean
  walletActionLoading: string | null
  loading: boolean
  error: string | null
  revealed: WalletSecretsResult | null
  onReveal: () => void
  onCloseWallet: () => void
  onDeleteWallet: () => void
}

export function WalletSecurityTab(props: WalletSecurityTabProps) {
  const {
    t,
    activeAccount,
    hasWalletControls,
    walletActionLoading,
    loading,
    error,
    revealed,
    onReveal,
    onCloseWallet,
    onDeleteWallet
  } = props

  const isWatchOnly = activeAccount?.kind === 'watch-only'
  const isBusy = walletActionLoading !== null

  return (
    <div className="wallet-subpanel">
      <div className="wallet-card-grid">
        <article className="wallet-card">
          <div className="wallet-section-header">
            <div>
              <h3>{t('wallet.showSeedTitle')}</h3>
              <p>{t('wallet.showSeedDescription')}</p>
            </div>
            <button type="button" className="ghost-button" onClick={onReveal} disabled={loading || isWatchOnly || !activeAccount}>
              {loading ? t('common.loading') : t('wallet.revealSecretsAction')}
            </button>
          </div>

          {!activeAccount && <p>{t('wallet.secretsNoAccount')}</p>}

          {isWatchOnly && (
            <div className="node-warning" role="note">
              {t('wallet.watchOnlyNoSecrets')}
            </div>
          )}

          {error && (
            <div className="wallet-modal-alert" role="alert">
              {error}
            </div>
          )}

          {revealed && !isWatchOnly && activeAccount && (
            <div className="wallet-secrets-grid">
              <label>
                {t('wallet.accountAddress')}
                <input type="text" value={revealed.firstAccountAddress || t('common.na')} readOnly />
              </label>
              <label>
                {t('wallet.privateKey')}
                <input type="text" value={revealed.firstAccountPrivateKeyWif || t('common.na')} readOnly />
              </label>
              {!!revealed.firstAccountDerivationPath && (
                <label>
                  {t('wallet.keyPath')}
                  <input type="text" value={revealed.firstAccountDerivationPath || t('common.na')} readOnly />
                </label>
              )}
              {!!revealed.seedPhrase && (
                <label>
                  {t('wallet.seedPhrase')}
                  <textarea value={revealed.seedPhrase} readOnly rows={4} />
                </label>
              )}
            </div>
          )}
        </article>

        <article className="wallet-card">
          <h3>{t('wallet.securityActionsTitle')}</h3>
          <p>{t('wallet.securityActionsDescription')}</p>
          <div className="wallet-inline-actions">
            <button type="button" className="ghost-button" onClick={onCloseWallet} disabled={!hasWalletControls || isBusy}>
              {walletActionLoading === 'wallet-close' ? t('common.loading') : t('wallet.closeAction')}
            </button>
            <button type="button" className="danger-button" onClick={onDeleteWallet} disabled={!hasWalletControls || isBusy}>
              {t('wallet.deleteAction')}
            </button>
          </div>
          <div className="node-warning" role="note">
            {t('wallet.deleteDescription')}
          </div>
        </article>
      </div>
    </div>
  )
}
