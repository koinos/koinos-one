import { useEffect, useRef, useState } from 'react'

import { WalletAccountBar } from './wallet/WalletAccountBar'
import { WalletAccountsTab } from './wallet/WalletAccountsTab'
import { WalletEmptyState } from './wallet/WalletEmptyState'
import { WalletLockedState } from './wallet/WalletLockedState'
import { WalletPortfolioTab } from './wallet/WalletPortfolioTab'
import { WalletSecurityTab } from './wallet/WalletSecurityTab'
import { WalletSendModal } from './wallet/WalletSendModal'

type WalletPanelProps = any
type WalletSubtab = 'tokens' | 'security'

type WalletCreateDraft = {
  ok?: boolean
  output?: string
  address?: string | null
  privateKeyWif?: string | null
  seedPhrase?: string | null
  derivationPath?: string | null
}

type WalletSecretsResult = {
  accountId?: string | null
  accountName?: string | null
  accountKind?: TelenoWalletAccountKind | null
  firstAccountAddress?: string | null
  firstAccountPrivateKeyWif?: string | null
  firstAccountDerivationPath?: string | null
  seedPhrase?: string | null
}

export function WalletPanel(props: WalletPanelProps) {
  const {
    t,
    hasWalletControls,
    walletOverview,
    walletLoading,
    walletActionLoading,
    walletError,
    nativeTokenSymbol,
    walletBalance,
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
    advancedMode = false,
    walletResultData,
    walletResultTitle,
    walletResultText,
    activeWalletAccount,
    activeWalletAccountId,
    activeWalletAddress,
    activeWalletCanSign,
    setWalletActiveAccount,
    setWalletAccountAsProducer,
    createWalletDerivedAccount,
    importWalletWatchAccount,
    renameWalletVaultAccount,
    removeWalletVaultAccount
  } = props

  const [walletSubtab, setWalletSubtab] = useState<WalletSubtab>('tokens')
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [importSeedModalOpen, setImportSeedModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendModalMode, setSendModalMode] = useState<'send' | 'burn'>('send')
  const [createAccountModalOpen, setCreateAccountModalOpen] = useState(false)
  const [importWatchModalOpen, setImportWatchModalOpen] = useState(false)
  const [renameAccountModalOpen, setRenameAccountModalOpen] = useState(false)
  const [removeAccountModalOpen, setRemoveAccountModalOpen] = useState(false)
  const [unlockRecoveryVisible, setUnlockRecoveryVisible] = useState(false)
  const [showSeedLoading, setShowSeedLoading] = useState(false)
  const [showSeedError, setShowSeedError] = useState<string | null>(null)
  const [showSeedResult, setShowSeedResult] = useState<WalletSecretsResult | null>(null)
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
  const [walletImportAccountName, setWalletImportAccountName] = useState('')
  const [watchAccountName, setWatchAccountName] = useState('')
  const [watchAccountAddress, setWatchAccountAddress] = useState('')
  const [derivedAccountName, setDerivedAccountName] = useState('')
  const [renameAccountName, setRenameAccountName] = useState('')
  const [selectedAccountForEdit, setSelectedAccountForEdit] = useState<TelenoWalletAccountSummary | null>(null)

  const createDraftRequestIdRef = useRef(0)
  const showSeedRequestIdRef = useRef(0)
  const hasWallet = Boolean(walletOverview?.walletExists)
  const walletUnlocked = Boolean(walletOverview?.unlocked)
  const walletLocked = hasWallet && !walletUnlocked
  const importWifReplacesVault = !hasWallet || walletLocked
  const isBusy = walletLoading || walletActionLoading !== null
  const accounts = walletOverview?.accounts || []
  const showCreateModalError = createModalOpen && createAttempted && Boolean(walletError)
  const canCreateDerivedAccount = Boolean(walletOverview?.hasSeedPhrase && walletUnlocked)

  useEffect(() => {
    setShowSeedResult(null)
    setShowSeedError(null)
  }, [activeWalletAccountId])

  useEffect(() => {
    if (walletUnlocked) setUnlockRecoveryVisible(false)
  }, [walletUnlocked, walletOverview?.walletAddress])

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
    setWalletImportAccountName('')
    setImportPasswordConfirm('')
  }

  const closeImportSeedModal = () => {
    setImportSeedModalOpen(false)
    setWalletImportSeedPhrase('')
    setWalletImportSeedPassword('')
    setImportSeedPasswordConfirm('')
  }

  const closeCreateAccountModal = () => {
    setCreateAccountModalOpen(false)
    setDerivedAccountName('')
  }

  const closeImportWatchModal = () => {
    setImportWatchModalOpen(false)
    setWatchAccountName('')
    setWatchAccountAddress('')
  }

  const closeRenameAccountModal = () => {
    setRenameAccountModalOpen(false)
    setSelectedAccountForEdit(null)
    setRenameAccountName('')
  }

  const closeRemoveAccountModal = () => {
    setRemoveAccountModalOpen(false)
    setSelectedAccountForEdit(null)
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

  const revealWalletSecrets = () => {
    if (!showWalletSeed) {
      setShowSeedError(t('wallet.unableShowSeed'))
      return
    }

    const requestId = showSeedRequestIdRef.current + 1
    showSeedRequestIdRef.current = requestId
    setShowSeedLoading(true)
    setShowSeedError(null)

    void showWalletSeed()
      .then((result: WalletSecretsResult & { ok?: boolean; output?: string }) => {
        if (showSeedRequestIdRef.current !== requestId) return
        if (!result?.ok) {
          setShowSeedError(result?.output || t('wallet.unableShowSeed'))
          return
        }
        setShowSeedResult(result)
      })
      .catch((error: unknown) => {
        if (showSeedRequestIdRef.current !== requestId) return
        setShowSeedError(error instanceof Error ? error.message : t('wallet.unableShowSeed'))
      })
      .finally(() => {
        if (showSeedRequestIdRef.current === requestId) {
          setShowSeedLoading(false)
        }
      })
  }

  const openSendModal = (mode: 'send' | 'burn' = 'send') => {
    if (mode === 'burn' && !walletBurnTargetAddressDraft.trim() && activeWalletAddress) {
      setWalletBurnTargetAddressDraft(activeWalletAddress)
    }
    setSendModalMode(mode)
    setSendModalOpen(true)
  }

  const openRenameModalForAccount = (account: TelenoWalletAccountSummary) => {
    setSelectedAccountForEdit(account)
    setRenameAccountName(account.name)
    setRenameAccountModalOpen(true)
  }

  const openRemoveModalForAccount = (account: TelenoWalletAccountSummary) => {
    setSelectedAccountForEdit(account)
    setRemoveAccountModalOpen(true)
  }

  const toggleWalletView = (nextView: WalletSubtab) => {
    setWalletSubtab(nextView)
  }

  return (
    <section id="panel-wallet" className="wallet-panel" aria-label={t('wallet.panelAria')} role="tabpanel" aria-labelledby="tab-wallet">
      {!hasWalletControls && (
        <div className="node-warning" role="note">
          {t('node.electronOnlyWarning')}
        </div>
      )}

      {walletError &&
        !createModalOpen &&
        !importModalOpen &&
        !importSeedModalOpen &&
        !sendModalOpen &&
        !createAccountModalOpen &&
        !importWatchModalOpen &&
        !renameAccountModalOpen &&
        !removeAccountModalOpen &&
        !deleteModalOpen && (
        <div className="error-banner node-error-banner" role="alert">
          <span>{walletError}</span>
        </div>
      )}

      {!hasWallet ? (
        <WalletEmptyState
          t={t}
          hasWalletControls={hasWalletControls}
          isBusy={isBusy}
          onImportWif={() => setImportModalOpen(true)}
          onImportSeed={() => setImportSeedModalOpen(true)}
          onCreateWallet={openCreateModal}
        />
      ) : !walletUnlocked ? (
        <WalletLockedState
          t={t}
          walletOverview={walletOverview}
          walletUnlockPassword={walletUnlockPassword}
          setWalletUnlockPassword={setWalletUnlockPassword}
          unlockWalletAccount={() => {
            void Promise.resolve(unlockWalletAccount()).then((ok: boolean) => {
              setUnlockRecoveryVisible(!ok)
            })
          }}
          hasWalletControls={hasWalletControls}
          walletActionLoading={walletActionLoading}
          showRecovery={unlockRecoveryVisible}
          onImportWif={() => setImportModalOpen(true)}
          onImportSeed={() => setImportSeedModalOpen(true)}
          onCreateWallet={openCreateModal}
          onDeleteWallet={() => setDeleteModalOpen(true)}
        />
      ) : (
        <>
          <WalletAccountBar
            t={t}
            hasWalletControls={hasWalletControls}
            walletActionLoading={walletActionLoading}
            accounts={accounts}
            activeAccountId={activeWalletAccountId}
            activeWalletCanSign={activeWalletCanSign}
            canCreateDerivedAccount={canCreateDerivedAccount}
            onSetActiveAccount={(accountId: string) => {
              void setWalletActiveAccount(accountId)
            }}
            onOpenCreateAccount={() => setCreateAccountModalOpen(true)}
            onOpenImportWif={() => setImportModalOpen(true)}
            onOpenRenameAccount={() => {
              const active = accounts.find((a) => a.id === activeWalletAccountId)
              if (active) openRenameModalForAccount(active)
            }}
            onOpenRemoveAccount={() => {
              const active = accounts.find((a) => a.id === activeWalletAccountId)
              if (active) openRemoveModalForAccount(active)
            }}
            activeView={walletSubtab}
            onOpenSend={() => openSendModal('send')}
            onOpenBurn={() => openSendModal('burn')}
            onSetAsProducer={() => {
              void setWalletAccountAsProducer(activeWalletAccountId)
            }}
            onToggleTokens={() => toggleWalletView('tokens')}
            onToggleSecurity={() => toggleWalletView('security')}
          />

          {walletSubtab === 'tokens' && (
            <WalletPortfolioTab
              t={t}
              nativeTokenSymbol={nativeTokenSymbol}
              walletBalance={walletBalance}
              activeWalletCanSign={activeWalletCanSign}
              isBusy={walletActionLoading !== null}
              onOpenSend={() => openSendModal('send')}
              onOpenBurn={() => openSendModal('burn')}
              onOpenImportWif={() => setImportModalOpen(true)}
            />
          )}

          {walletSubtab === 'security' && (
            <WalletSecurityTab
              t={t}
              activeAccount={activeWalletAccount}
              hasWalletControls={hasWalletControls}
              walletActionLoading={walletActionLoading}
              loading={showSeedLoading}
              error={showSeedError}
              revealed={showSeedResult}
              onReveal={revealWalletSecrets}
              onCloseWallet={() => {
                void closeWalletAccount()
              }}
              onDeleteWallet={() => setDeleteModalOpen(true)}
            />
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
                <h3 id="wallet-import-key-title" className="log-modal-title">
                  {importWifReplacesVault ? t('wallet.importKeyTitle') : t('wallet.importAccountAction')}
                </h3>
                <p className="log-modal-meta">
                  {importWifReplacesVault ? t('wallet.importKeyDescription') : t('wallet.importAccountDescription')}
                </p>
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
              {walletLocked && (
                <div className="node-warning" role="note">
                  {t('wallet.lockedReplaceWarning')}
                </div>
              )}
              {!importWifReplacesVault && (
                <label>
                  {t('wallet.accountName')}
                  <input
                    type="text"
                    value={walletImportAccountName}
                    onChange={(event) => setWalletImportAccountName(event.target.value)}
                    autoComplete="off"
                  />
                </label>
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
                    void importWalletAccount(
                      walletImportPrivateKey,
                      walletImportPassword,
                      importPasswordConfirm,
                      walletImportAccountName
                    ).then((ok: boolean) => {
                      if (ok) closeImportModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-import' || walletActionLoading === 'wallet-import-account'
                    ? t('common.loading')
                    : importWifReplacesVault
                      ? t('wallet.importKeyAction')
                      : t('wallet.importAccountAction')}
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
              {walletLocked && (
                <div className="node-warning" role="note">
                  {t('wallet.lockedReplaceWarning')}
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
              {walletLocked && (
                <div className="node-warning" role="note">
                  {t('wallet.lockedReplaceWarning')}
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
                    <input className="wallet-create-password-input" type="text" value={createSeedAccount} readOnly />
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

      {createAccountModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeCreateAccountModal}>
          <section className="log-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-create-account-title" onClick={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-create-account-title" className="log-modal-title">{t('wallet.createDerivedAccountAction')}</h3>
                <p className="log-modal-meta">{t('wallet.createDerivedAccountDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeCreateAccountModal}>
                {t('common.close')}
              </button>
            </div>
            <div className="wallet-modal-body">
              {walletError && <div className="wallet-modal-alert" role="alert">{walletError}</div>}
              <label>
                {t('wallet.accountName')}
                <input
                  type="text"
                  value={derivedAccountName}
                  onChange={(event) => setDerivedAccountName(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeCreateAccountModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void createWalletDerivedAccount(derivedAccountName).then((ok: boolean) => {
                      if (ok) closeCreateAccountModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null || !canCreateDerivedAccount}
                >
                  {walletActionLoading === 'wallet-create-derived-account' ? t('common.loading') : t('wallet.createDerivedAccountAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {importWatchModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeImportWatchModal}>
          <section className="log-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-import-watch-title" onClick={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-import-watch-title" className="log-modal-title">{t('wallet.importWatchAction')}</h3>
                <p className="log-modal-meta">{t('wallet.importWatchDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeImportWatchModal}>
                {t('common.close')}
              </button>
            </div>
            <div className="wallet-modal-body">
              {walletError && <div className="wallet-modal-alert" role="alert">{walletError}</div>}
              <label>
                {t('wallet.accountName')}
                <input
                  type="text"
                  value={watchAccountName}
                  onChange={(event) => setWatchAccountName(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                {t('wallet.accountAddress')}
                <input
                  type="text"
                  value={watchAccountAddress}
                  onChange={(event) => setWatchAccountAddress(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeImportWatchModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void importWalletWatchAccount(watchAccountAddress, watchAccountName).then((ok: boolean) => {
                      if (ok) closeImportWatchModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-import-watch-account' ? t('common.loading') : t('wallet.importWatchAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {renameAccountModalOpen && selectedAccountForEdit && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeRenameAccountModal}>
          <section className="log-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-rename-account-title" onClick={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-rename-account-title" className="log-modal-title">{t('wallet.renameAccountAction')}</h3>
                <p className="log-modal-meta">{t('wallet.renameAccountDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeRenameAccountModal}>
                {t('common.close')}
              </button>
            </div>
            <div className="wallet-modal-body">
              {walletError && <div className="wallet-modal-alert" role="alert">{walletError}</div>}
              <label>
                {t('wallet.accountName')}
                <input type="text" value={renameAccountName} onChange={(event) => setRenameAccountName(event.target.value)} autoComplete="off" />
              </label>
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeRenameAccountModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void renameWalletVaultAccount(selectedAccountForEdit.id, renameAccountName).then((ok: boolean) => {
                      if (ok) closeRenameAccountModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-rename-account' ? t('common.loading') : t('wallet.renameAccountAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {removeAccountModalOpen && selectedAccountForEdit && (
        <div className="log-modal-backdrop" role="presentation" onClick={closeRemoveAccountModal}>
          <section className="log-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-remove-account-title" onClick={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h3 id="wallet-remove-account-title" className="log-modal-title">{t('wallet.removeAccountAction')}</h3>
                <p className="log-modal-meta">{t('wallet.removeAccountDescription', { name: selectedAccountForEdit.name })}</p>
              </div>
              <button type="button" className="ghost-button" onClick={closeRemoveAccountModal}>
                {t('common.close')}
              </button>
            </div>
            <div className="wallet-modal-body">
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={closeRemoveAccountModal}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    void removeWalletVaultAccount(selectedAccountForEdit.id).then((ok: boolean) => {
                      if (ok) closeRemoveAccountModal()
                    })
                  }}
                  disabled={!hasWalletControls || walletActionLoading !== null}
                >
                  {walletActionLoading === 'wallet-remove-account' ? t('common.loading') : t('wallet.removeAccountAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {deleteModalOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={() => setDeleteModalOpen(false)}>
          <section className="log-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-delete-title" onClick={(event) => event.stopPropagation()}>
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

      <WalletSendModal
        t={t}
        open={sendModalOpen}
        mode={sendModalMode}
        onClose={() => setSendModalOpen(false)}
        onSetMode={setSendModalMode}
        hasWalletControls={hasWalletControls}
        walletActionLoading={walletActionLoading}
        walletError={walletError}
        activeWalletCanSign={activeWalletCanSign}
        activeWalletAddress={activeWalletAddress}
        nativeTokenSymbol={nativeTokenSymbol}
        walletTransferAsset={walletTransferAsset}
        setWalletTransferAsset={setWalletTransferAsset}
        walletTransferAddressDraft={walletTransferAddressDraft}
        setWalletTransferAddressDraft={setWalletTransferAddressDraft}
        walletTransferAmountDraft={walletTransferAmountDraft}
        setWalletTransferAmountDraft={setWalletTransferAmountDraft}
        walletTransferDryRun={walletTransferDryRun}
        setWalletTransferDryRun={setWalletTransferDryRun}
        walletTransferUseFreeMana={walletTransferUseFreeMana}
        setWalletTransferUseFreeMana={setWalletTransferUseFreeMana}
        transferWalletToken={() => {
          void transferWalletToken()
        }}
        walletBurnTargetAddressDraft={walletBurnTargetAddressDraft}
        setWalletBurnTargetAddressDraft={setWalletBurnTargetAddressDraft}
        walletBurnPercentDraft={walletBurnPercentDraft}
        setWalletBurnPercentDraft={setWalletBurnPercentDraft}
        walletBurnAmountDraft={walletBurnAmountDraft}
        setWalletBurnAmountDraft={setWalletBurnAmountDraft}
        walletBurnDryRun={walletBurnDryRun}
        setWalletBurnDryRun={setWalletBurnDryRun}
        walletBurnUseFreeMana={walletBurnUseFreeMana}
        setWalletBurnUseFreeMana={setWalletBurnUseFreeMana}
        burnKoinToVhp={() => {
          void burnKoinToVhp()
        }}
      />

      {advancedMode && (walletResultData || walletLoading) && (!hasWallet || walletUnlocked) && (
        <div className="wallet-output">
          <div className="node-services-header">
            <h3>{walletResultTitle || t('wallet.outputTitle')}</h3>
          </div>
          <pre className="mono">{walletResultText || t('common.loading')}</pre>
        </div>
      )}
    </section>
  )
}
