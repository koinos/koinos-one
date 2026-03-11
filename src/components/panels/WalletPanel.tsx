import { useRef, useState } from 'react'

type WalletPanelProps = any
type WalletCreateDraft = {
  ok?: boolean
  output?: string
  address?: string | null
  privateKeyWif?: string | null
  seedPhrase?: string | null
  derivationPath?: string | null
}

export function WalletPanel(props: WalletPanelProps) {
  const {
    t,
    effectiveExplorerRpcUrl,
    hasWalletControls,
    walletOverview,
    walletLoading,
    walletActionLoading,
    walletError,
    walletBalance,
    walletBalanceError,
    walletImportPrivateKey,
    setWalletImportPrivateKey,
    walletImportPassword,
    setWalletImportPassword,
    walletImportSeedPhrase,
    setWalletImportSeedPhrase,
    walletImportSeedPassword,
    setWalletImportSeedPassword,
    importWalletAccount,
    importWalletFromSeed,
    createWalletAccount,
    generateWalletDraft,
    showWalletSeed,
    closeWalletAccount,
    deleteWalletAccount,
    walletUnlockPassword,
    setWalletUnlockPassword,
    unlockWalletAccount,
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
    burnKoinToVhp,
    walletResultData,
    walletResultTitle,
    walletResultText
  } = props

  const [importModalOpen, setImportModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [importSeedModalOpen, setImportSeedModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [showSeedModalOpen, setShowSeedModalOpen] = useState(false)
  const [showSeedModalLoading, setShowSeedModalLoading] = useState(false)
  const [showSeedModalError, setShowSeedModalError] = useState<string | null>(null)
  const [showSeedModalResult, setShowSeedModalResult] = useState<{
    firstAccountAddress: string | null
    firstAccountPrivateKeyWif: string | null
    firstAccountDerivationPath: string | null
    seedPhrase: string | null
  } | null>(null)
  const [createWalletDraft, setCreateWalletDraft] = useState<WalletCreateDraft | null>(null)
  const [createSeedPhrase, setCreateSeedPhrase] = useState('')
  const [createSeedAccount, setCreateSeedAccount] = useState('')
  const [createSeedLoading, setCreateSeedLoading] = useState(false)
  const [createSeedError, setCreateSeedError] = useState<string | null>(null)
  const [importPasswordConfirm, setImportPasswordConfirm] = useState('')
  const [importSeedPasswordConfirm, setImportSeedPasswordConfirm] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('')
  const [createAttempted, setCreateAttempted] = useState(false)
  const showSeedRequestIdRef = useRef(0)
  const createDraftRequestIdRef = useRef(0)
  const hasWallet = Boolean(walletOverview?.walletExists)
  const walletUnlocked = Boolean(walletOverview?.unlocked)
  const isBusy = walletLoading || walletActionLoading !== null
  const showWalletHeaderMeta = hasWallet && walletUnlocked
  const showCreateModalError = createModalOpen && createAttempted && Boolean(walletError)

  const closeCreateModal = () => {
    createDraftRequestIdRef.current += 1
    setCreateModalOpen(false)
    setCreateWalletDraft(null)
    setCreateSeedPhrase('')
    setCreateSeedAccount('')
    setCreateSeedLoading(false)
    setCreateSeedError(null)
    setCreatePassword('')
    setCreatePasswordConfirm('')
    setCreateAttempted(false)
  }

  const closeImportModal = () => {
    setImportModalOpen(false)
    setWalletImportPrivateKey('')
    setWalletImportPassword('')
    setImportPasswordConfirm('')
  }

  const closeImportSeedModal = () => {
    setImportSeedModalOpen(false)
    setWalletImportSeedPhrase('')
    setWalletImportSeedPassword('')
    setImportSeedPasswordConfirm('')
  }

  const openCreateModal = () => {
    setCreateModalOpen(true)
    setCreateWalletDraft(null)
    setCreateSeedPhrase('')
    setCreateSeedAccount('')
    setCreateSeedError(null)
    setCreatePassword('')
    setCreatePasswordConfirm('')
    setCreateAttempted(false)

    if (!generateWalletDraft) {
      setCreateSeedLoading(false)
      setCreateSeedError(t('wallet.unableCreate'))
      return
    }

    const requestId = createDraftRequestIdRef.current + 1
    createDraftRequestIdRef.current = requestId
    setCreateSeedLoading(true)

    void generateWalletDraft()
      .then((result: WalletCreateDraft) => {
        if (createDraftRequestIdRef.current !== requestId) return

        if (!result?.ok || !result.seedPhrase || !result.privateKeyWif) {
          setCreateSeedError(result?.output || t('wallet.unableCreate'))
          return
        }

        setCreateWalletDraft(result)
        setCreateSeedPhrase(result.seedPhrase)
        setCreateSeedAccount(result.address || '')
      })
      .catch((error: unknown) => {
        if (createDraftRequestIdRef.current !== requestId) return
        setCreateSeedError(error instanceof Error ? error.message : t('wallet.unableCreate'))
      })
      .finally(() => {
        if (createDraftRequestIdRef.current === requestId) {
          setCreateSeedLoading(false)
        }
      })
  }

  const closeShowSeedModal = () => {
    showSeedRequestIdRef.current += 1
    setShowSeedModalOpen(false)
    setShowSeedModalLoading(false)
    setShowSeedModalError(null)
    setShowSeedModalResult(null)
  }

  const openShowSeedModal = () => {
    setShowSeedModalOpen(true)
    setShowSeedModalResult(null)
    setShowSeedModalError(null)

    if (!showWalletSeed) {
      setShowSeedModalLoading(false)
      setShowSeedModalError(t('wallet.unableShowSeed'))
      return
    }

    const requestId = showSeedRequestIdRef.current + 1
    showSeedRequestIdRef.current = requestId
    setShowSeedModalLoading(true)

    void showWalletSeed()
      .then((result: {
        ok?: boolean
        output?: string
        firstAccountAddress?: string | null
        firstAccountPrivateKeyWif?: string | null
        firstAccountDerivationPath?: string | null
        seedPhrase?: string | null
      }) => {
        if (showSeedRequestIdRef.current !== requestId) return

        if (!result?.ok) {
          setShowSeedModalError(result?.output || t('wallet.unableShowSeed'))
          return
        }

        setShowSeedModalResult({
          firstAccountAddress: result.firstAccountAddress || null,
          firstAccountPrivateKeyWif: result.firstAccountPrivateKeyWif || null,
          firstAccountDerivationPath: result.firstAccountDerivationPath || null,
          seedPhrase: result.seedPhrase || null
        })
      })
      .catch((error: unknown) => {
        if (showSeedRequestIdRef.current !== requestId) return
        setShowSeedModalError(error instanceof Error ? error.message : t('wallet.unableShowSeed'))
      })
      .finally(() => {
        if (showSeedRequestIdRef.current === requestId) {
          setShowSeedModalLoading(false)
        }
      })
  }

  return (
    <section id="panel-wallet" className="wallet-panel" aria-label={t('wallet.panelAria')} role="tabpanel" aria-labelledby="tab-wallet">
      {showWalletHeaderMeta && (
        <div className="wallet-header">
          <div className="wallet-header-meta">
            {hasWallet && (
              <button
                type="button"
                className="ghost-button"
                onClick={openShowSeedModal}
                disabled={!hasWalletControls || walletActionLoading !== null || showSeedModalLoading}
              >
                {t('wallet.showSeedAction')}
              </button>
            )}
            {hasWallet && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void closeWalletAccount()
                }}
                disabled={!hasWalletControls || isBusy || !walletUnlocked}
              >
                {walletActionLoading === 'wallet-close' ? t('common.loading') : t('wallet.closeAction')}
              </button>
            )}
            {hasWallet && (
              <button
                type="button"
                className="danger-button"
                onClick={() => setDeleteModalOpen(true)}
                disabled={!hasWalletControls || isBusy}
              >
                {walletActionLoading === 'wallet-delete' ? t('common.loading') : t('wallet.deleteAction')}
              </button>
            )}
          </div>
        </div>
      )}

      {!hasWalletControls && (
        <div className="node-warning" role="note">
          {t('node.electronOnlyWarning')}
        </div>
      )}

      {walletError && !createModalOpen && (
        <div className="error-banner node-error-banner" role="alert">
          <span>{walletError}</span>
        </div>
      )}

      {!hasWallet ? (
        <section className="wallet-empty-state">
          <div>
            <h3>{t('wallet.emptyTitle')}</h3>
            <p>{t('wallet.emptyDescription')}</p>
          </div>
          <div className="wallet-empty-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setImportModalOpen(true)}
              disabled={!hasWalletControls || isBusy}
            >
              {t('wallet.importKeyAction')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setImportSeedModalOpen(true)}
              disabled={!hasWalletControls || isBusy}
            >
              {t('wallet.importSeedAction')}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={openCreateModal}
              disabled={!hasWalletControls || isBusy}
            >
              {t('wallet.createAction')}
            </button>
          </div>
        </section>
      ) : (
        <>
          {!walletUnlocked ? (
            <div className="wallet-card-grid wallet-card-grid-locked">
              <article className="wallet-card wallet-card-unlock">
                <h3>{t('wallet.unlockTitle')}</h3>
                <p>{t('wallet.unlockDescription')}</p>
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
                  onClick={() => {
                    void unlockWalletAccount()
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-unlock' ? t('common.loading') : t('wallet.unlockAction')}
                </button>
              </article>
            </div>
          ) : (
            <>
              <div className="wallet-overview-grid">
                <article className="stat-card">
                  <span className="stat-label">{t('wallet.currentAccount')}</span>
                  <p className="stat-value mono" title={walletOverview?.walletAddress || t('common.na')}>
                    {walletOverview?.walletAddress || t('common.na')}
                  </p>
                  <p className="stat-note">{t('wallet.accountUnlocked')}</p>
                </article>

                <article className="stat-card">
                  <span className="stat-label">{t('wallet.availableKoin')}</span>
                  <p className="stat-value">{walletBalance?.koin || t('common.na')}</p>
                  <p className="stat-note">KOIN</p>
                </article>

                <article className="stat-card">
                  <span className="stat-label">{t('wallet.availableVhp')}</span>
                  <p className="stat-value">{walletBalance?.vhp || t('common.na')}</p>
                  <p className="stat-note">VHP</p>
                </article>
              </div>

              {walletBalanceError && (
                <div className="node-warning" role="note">
                  {walletBalanceError}
                </div>
              )}

              <div className="wallet-card-grid">
                <article className="wallet-card">
                  <h3>{t('wallet.transferTitle')}</h3>
                  <p>{t('wallet.transferDescription')}</p>
                  <label>
                    {t('wallet.transferAsset')}
                    <select
                      value={walletTransferAsset}
                      onChange={(event) => setWalletTransferAsset(event.target.value)}
                    >
                      <option value="koin">{t('wallet.transferAssetKoin')}</option>
                      <option value="vhp">{t('wallet.transferAssetVhp')}</option>
                    </select>
                  </label>
                  <label>
                    {t('wallet.transferTargetAccount')}
                    <input
                      type="text"
                      value={walletTransferAddressDraft}
                      onChange={(event) => setWalletTransferAddressDraft(event.target.value)}
                      placeholder="14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb"
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
                  <label className="wallet-checkbox">
                    <input
                      type="checkbox"
                      checked={walletTransferDryRun}
                      onChange={(event) => setWalletTransferDryRun(event.target.checked)}
                    />
                    <span>{t('wallet.dryRun')}</span>
                  </label>
                  <label className="wallet-checkbox">
                    <input
                      type="checkbox"
                      checked={walletTransferUseFreeMana}
                      onChange={(event) => setWalletTransferUseFreeMana(event.target.checked)}
                    />
                    <span>{t('wallet.useFreeMana')}</span>
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void transferWalletToken()
                    }}
                    disabled={!hasWalletControls || walletActionLoading !== null}
                  >
                    {walletActionLoading === 'wallet-transfer-koin' || walletActionLoading === 'wallet-transfer-vhp'
                      ? t('common.loading')
                      : t('wallet.transferAction')}
                  </button>
                </article>

                <article className="wallet-card">
                  <h3>{t('wallet.burnTitle')}</h3>
                  <p>{t('wallet.burnProducerDescription')}</p>
                  <label>
                    {t('wallet.burnReceiverAccount')}
                    <input
                      type="text"
                      value={walletBurnTargetAddressDraft}
                      onChange={(event) => setWalletBurnTargetAddressDraft(event.target.value)}
                      placeholder={walletOverview?.walletAddress || '14MHW6TF8gw8EuMRLCJc2PQHLzZLKuwGqb'}
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
                  <label className="wallet-checkbox">
                    <input
                      type="checkbox"
                      checked={walletBurnDryRun}
                      onChange={(event) => setWalletBurnDryRun(event.target.checked)}
                    />
                    <span>{t('wallet.dryRun')}</span>
                  </label>
                  <label className="wallet-checkbox">
                    <input
                      type="checkbox"
                      checked={walletBurnUseFreeMana}
                      onChange={(event) => setWalletBurnUseFreeMana(event.target.checked)}
                    />
                    <span>{t('wallet.useFreeMana')}</span>
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void burnKoinToVhp()
                    }}
                    disabled={!hasWalletControls || walletActionLoading !== null}
                  >
                    {walletActionLoading === 'wallet-burn' ? t('common.loading') : t('wallet.burnAction')}
                  </button>
                </article>
              </div>
            </>
          )}
        </>
      )}

      {importModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeImportModal}>
          <section
            className="log-modal wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-import-key-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-import-key-title" className="log-modal-title">{t('wallet.importKeyTitle')}</h3>
                <p className="log-modal-meta">{t('wallet.importKeyDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeImportModal}>
                {t('common.close')}
              </button>
            </div>

            <div className="wallet-modal-body">
              {walletError && (
                <div className="wallet-modal-alert" role="alert">
                  {walletError}
                </div>
              )}
              <label>
                {t('wallet.privateKey')}
                <input
                  type="text"
                  value={walletImportPrivateKey}
                  onChange={(event) => setWalletImportPrivateKey(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label>
                {t('wallet.password')}
                <input
                  type="password"
                  value={walletImportPassword}
                  onChange={(event) => setWalletImportPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                {t('wallet.passwordConfirm')}
                <input
                  type="password"
                  value={importPasswordConfirm}
                  onChange={(event) => setImportPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeImportModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void importWalletAccount(walletImportPrivateKey, walletImportPassword, importPasswordConfirm).then((ok: boolean) => {
                      if (ok) closeImportModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-import' ? t('common.loading') : t('wallet.importKeyAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {importSeedModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeImportSeedModal}>
          <section
            className="log-modal wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-import-seed-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-import-seed-title" className="log-modal-title">{t('wallet.importSeedTitle')}</h3>
                <p className="log-modal-meta">{t('wallet.importSeedDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeImportSeedModal}>
                {t('common.close')}
              </button>
            </div>

            <div className="wallet-modal-body">
              {walletError && (
                <div className="wallet-modal-alert" role="alert">
                  {walletError}
                </div>
              )}
              <label>
                {t('wallet.seedPhrase')}
                <textarea
                  value={walletImportSeedPhrase}
                  onChange={(event) => setWalletImportSeedPhrase(event.target.value)}
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label>
                {t('wallet.password')}
                <input
                  type="password"
                  value={walletImportSeedPassword}
                  onChange={(event) => setWalletImportSeedPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                {t('wallet.passwordConfirm')}
                <input
                  type="password"
                  value={importSeedPasswordConfirm}
                  onChange={(event) => setImportSeedPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeImportSeedModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void importWalletFromSeed(walletImportSeedPhrase, walletImportSeedPassword, importSeedPasswordConfirm).then((ok: boolean) => {
                      if (ok) closeImportSeedModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-import-seed' ? t('common.loading') : t('wallet.importSeedAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {createModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeCreateModal}>
          <section
            className="log-modal wallet-modal wallet-modal-create"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-create-title" className="log-modal-title">{t('wallet.createTitle')}</h3>
                <p className="log-modal-meta">{t('wallet.createDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeCreateModal}>
                {t('common.close')}
              </button>
            </div>

            <div className="wallet-modal-body">
              {showCreateModalError && (
                <div className="wallet-modal-alert" role="alert">
                  {walletError}
                </div>
              )}
              {createSeedError && (
                <div className="wallet-modal-alert" role="alert">
                  {createSeedError}
                </div>
              )}
              <p className="wallet-modal-note">{t('wallet.createBackupNotice')}</p>
              {createSeedLoading ? (
                <p className="wallet-modal-note">{t('wallet.createPreparingSeed')}</p>
              ) : (
                <>
                  <label>
                    {t('wallet.seedPhrase')}
                    <textarea value={createSeedPhrase} readOnly rows={4} />
                  </label>
                  <label className="wallet-create-password-field">
                    {t('wallet.firstAccount')}
                    <input
                      className="wallet-create-password-input"
                      type="text"
                      value={createSeedAccount}
                      readOnly
                    />
                  </label>
                </>
              )}
              <label className="wallet-create-password-field">
                {t('wallet.password')}
                <input
                  className="wallet-create-password-input"
                  type="password"
                  value={createPassword}
                  onChange={(event) => setCreatePassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="wallet-create-password-field">
                {t('wallet.passwordConfirm')}
                <input
                  className="wallet-create-password-input"
                  type="password"
                  value={createPasswordConfirm}
                  onChange={(event) => setCreatePasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeCreateModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setCreateAttempted(true)
                    void createWalletAccount(createPassword, createPasswordConfirm, createWalletDraft).then((ok: boolean) => {
                      if (ok) closeCreateModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null || createSeedLoading || !createWalletDraft?.seedPhrase}
                >
                  {walletActionLoading === 'wallet-create' ? t('common.loading') : t('wallet.createAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {deleteModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={() => setDeleteModalOpen(false)}>
          <section
            className="log-modal wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-delete-title" className="log-modal-title">{t('wallet.deleteConfirmTitle')}</h3>
                <p className="log-modal-meta">{t('wallet.deleteConfirmDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setDeleteModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>

            <div className="wallet-modal-body">
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={() => setDeleteModalOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    void deleteWalletAccount().then((ok: boolean) => {
                      if (ok) setDeleteModalOpen(false)
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-delete' ? t('common.loading') : t('wallet.deleteConfirmAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {showSeedModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeShowSeedModal}>
          <section
            className="log-modal wallet-modal wallet-modal-seed"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-show-seed-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-show-seed-title" className="log-modal-title">{t('wallet.showSeedTitle')}</h3>
                <p className="log-modal-meta">{t('wallet.showSeedDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeShowSeedModal}>
                {t('common.close')}
              </button>
            </div>

            <div className="wallet-modal-body">
              {showSeedModalLoading && <p className="wallet-modal-note">{t('common.loading')}</p>}
              {!showSeedModalLoading && showSeedModalError && (
                <div className="wallet-modal-alert" role="alert">
                  {showSeedModalError}
                </div>
              )}
              {!showSeedModalLoading && !showSeedModalError && showSeedModalResult && (
                <>
                  <label>
                    {t('wallet.accountAddress')}
                    <input type="text" value={showSeedModalResult.firstAccountAddress || t('common.na')} readOnly />
                  </label>
                  <label>
                    {t('wallet.privateKey')}
                    <input type="text" value={showSeedModalResult.firstAccountPrivateKeyWif || t('common.na')} readOnly />
                  </label>
                  {showSeedModalResult.seedPhrase && (
                    <label>
                      {t('wallet.keyPath')}
                      <input type="text" value={showSeedModalResult.firstAccountDerivationPath || t('common.na')} readOnly />
                    </label>
                  )}
                  {showSeedModalResult.seedPhrase && (
                    <label>
                      {t('wallet.seedPhrase')}
                      <textarea value={showSeedModalResult.seedPhrase || ''} readOnly rows={4} />
                    </label>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {(walletResultData || walletLoading) && (!hasWallet || walletUnlocked) && (
        <div className="wallet-output">
          <div className="node-services-header">
            <h3>{walletResultTitle || t('wallet.outputTitle')}</h3>
            <span>{walletLoading ? t('common.loading') : effectiveExplorerRpcUrl}</span>
          </div>
          <pre className="mono">{walletResultText || t('common.loading')}</pre>
        </div>
      )}
    </section>
  )
}
