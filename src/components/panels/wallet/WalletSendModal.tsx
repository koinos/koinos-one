type WalletSendModalProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  open: boolean
  mode: 'send' | 'burn'
  onClose: () => void
  onSetMode: (mode: 'send' | 'burn') => void
  hasWalletControls: boolean
  walletActionLoading: string | null
  walletError: string | null
  activeWalletCanSign: boolean
  activeWalletAddress: string
  nativeTokenSymbol: string
  walletTransferAsset: 'koin' | 'vhp'
  setWalletTransferAsset: (value: 'koin' | 'vhp') => void
  walletTransferAddressDraft: string
  setWalletTransferAddressDraft: (value: string) => void
  walletTransferAmountDraft: string
  setWalletTransferAmountDraft: (value: string) => void
  walletTransferDryRun: boolean
  setWalletTransferDryRun: (value: boolean) => void
  walletTransferUseFreeMana: boolean
  setWalletTransferUseFreeMana: (value: boolean) => void
  transferWalletToken: () => void
  walletBurnTargetAddressDraft: string
  setWalletBurnTargetAddressDraft: (value: string) => void
  walletBurnPercentDraft: string
  setWalletBurnPercentDraft: (value: string) => void
  walletBurnAmountDraft: string
  setWalletBurnAmountDraft: (value: string) => void
  walletBurnDryRun: boolean
  setWalletBurnDryRun: (value: boolean) => void
  walletBurnUseFreeMana: boolean
  setWalletBurnUseFreeMana: (value: boolean) => void
  burnKoinToVhp: () => void
}

export function WalletSendModal(props: WalletSendModalProps) {
  const {
    t,
    open,
    mode,
    onClose,
    onSetMode,
    hasWalletControls,
    walletActionLoading,
    walletError,
    activeWalletCanSign,
    activeWalletAddress,
    nativeTokenSymbol,
    walletTransferAsset,
    setWalletTransferAsset,
    walletTransferAddressDraft,
    setWalletTransferAddressDraft,
    walletTransferAmountDraft,
    setWalletTransferAmountDraft,
    walletTransferDryRun,
    setWalletTransferDryRun,
    walletTransferUseFreeMana,
    setWalletTransferUseFreeMana,
    transferWalletToken,
    walletBurnTargetAddressDraft,
    setWalletBurnTargetAddressDraft,
    walletBurnPercentDraft,
    setWalletBurnPercentDraft,
    walletBurnAmountDraft,
    setWalletBurnAmountDraft,
    walletBurnDryRun,
    setWalletBurnDryRun,
    walletBurnUseFreeMana,
    setWalletBurnUseFreeMana,
    burnKoinToVhp
  } = props

  if (!open) return null

  const isSend = mode === 'send'
  const isBusy = walletActionLoading !== null
  const submitDisabledTitle = !hasWalletControls
    ? t('wallet.disabledTooltip.electronOnly')
    : isBusy
      ? t('wallet.disabledTooltip.busy')
      : !activeWalletCanSign
        ? t('wallet.watchOnlyCannotSign')
        : undefined

  return (
    <div className="log-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="log-modal wallet-modal wallet-modal-send"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-send-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="log-modal-header">
          <div>
            <h3 id="wallet-send-modal-title" className="log-modal-title">
              {isSend ? t('wallet.transferTitle') : t('wallet.burnTitleForNetwork', { symbol: nativeTokenSymbol })}
            </h3>
            <p className="log-modal-meta">
              {isSend
                ? t('wallet.transferDescriptionForNetwork', { symbol: nativeTokenSymbol })
                : t('wallet.burnProducerDescriptionForNetwork', { symbol: nativeTokenSymbol })}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="wallet-modal-body">
          <div className="wallet-send-mode-tabs" role="tablist" aria-label={t('wallet.transferTitle')}>
            <button
              type="button"
              className={`wallet-send-mode-button ${isSend ? 'is-active' : ''}`}
              onClick={() => onSetMode('send')}
              role="tab"
              aria-selected={isSend}
            >
              {t('wallet.transferTitle')}
            </button>
            <button
              type="button"
              className={`wallet-send-mode-button ${!isSend ? 'is-active' : ''}`}
              onClick={() => onSetMode('burn')}
              role="tab"
              aria-selected={!isSend}
            >
              {t('wallet.burnTitleForNetwork', { symbol: nativeTokenSymbol })}
            </button>
          </div>

          {!activeWalletCanSign && (
            <div className="node-warning" role="note">
              {t('wallet.watchOnlyCannotSign')}
            </div>
          )}

          {walletError && (
            <div className="wallet-modal-alert" role="alert">
              {walletError}
            </div>
          )}

          {isSend ? (
            <>
              <label>
                {t('wallet.transferAsset')}
                <select value={walletTransferAsset} onChange={(event) => setWalletTransferAsset(event.target.value as 'koin' | 'vhp')}>
                  <option value="koin">{nativeTokenSymbol}</option>
                  <option value="vhp">{t('wallet.transferAssetVhp')}</option>
                </select>
              </label>
              <label>
                {t('wallet.transferTargetAccount')}
                <input
                  type="text"
                  value={walletTransferAddressDraft}
                  onChange={(event) => setWalletTransferAddressDraft(event.target.value)}
                  placeholder={t('wallet.addressPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label>
                {t('wallet.transferAmount')}
                <input
                  type="number"
                  min={0}
                  step="0.00000001"
                  value={walletTransferAmountDraft}
                  onChange={(event) => setWalletTransferAmountDraft(event.target.value)}
                />
              </label>
              <details className="wallet-send-advanced">
                <summary>{t('wallet.sendAdvancedAction')}</summary>
                <label className="wallet-checkbox">
                  <input type="checkbox" checked={walletTransferDryRun} onChange={(event) => setWalletTransferDryRun(event.target.checked)} />
                  <span>{t('wallet.dryRun')}</span>
                </label>
                <label className="wallet-checkbox">
                  <input type="checkbox" checked={walletTransferUseFreeMana} onChange={(event) => setWalletTransferUseFreeMana(event.target.checked)} />
                  <span>{t('wallet.useFreeMana')}</span>
                </label>
              </details>
            </>
          ) : (
            <>
              <label>
                {t('wallet.burnReceiverAccount')}
                <input
                  type="text"
                  value={walletBurnTargetAddressDraft}
                  onChange={(event) => setWalletBurnTargetAddressDraft(event.target.value)}
                  placeholder={activeWalletAddress || t('wallet.addressPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label>
                {t('wallet.burnPercent')}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={walletBurnPercentDraft}
                  onChange={(event) => {
                    setWalletBurnPercentDraft(event.target.value)
                    if (event.target.value.trim()) setWalletBurnAmountDraft('')
                  }}
                />
              </label>
              <label>
                {t('wallet.burnAmount')}
                <input
                  type="number"
                  min={0}
                  step="0.00000001"
                  value={walletBurnAmountDraft}
                  onChange={(event) => {
                    setWalletBurnAmountDraft(event.target.value)
                    if (event.target.value.trim()) setWalletBurnPercentDraft('')
                  }}
                />
              </label>
              <details className="wallet-send-advanced">
                <summary>{t('wallet.sendAdvancedAction')}</summary>
                <label className="wallet-checkbox">
                  <input type="checkbox" checked={walletBurnDryRun} onChange={(event) => setWalletBurnDryRun(event.target.checked)} />
                  <span>{t('wallet.dryRun')}</span>
                </label>
                <label className="wallet-checkbox">
                  <input type="checkbox" checked={walletBurnUseFreeMana} onChange={(event) => setWalletBurnUseFreeMana(event.target.checked)} />
                  <span>{t('wallet.useFreeMana')}</span>
                </label>
              </details>
            </>
          )}

          <div className="wallet-modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={isSend ? transferWalletToken : burnKoinToVhp}
              disabled={!hasWalletControls || isBusy || !activeWalletCanSign}
              title={submitDisabledTitle}
            >
              {isBusy ? t('common.loading') : isSend ? t('wallet.transferAction') : t('wallet.burnAction')}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
