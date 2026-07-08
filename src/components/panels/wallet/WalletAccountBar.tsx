import { useState } from 'react'

type WalletAccountBarProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  hasWalletControls: boolean
  walletActionLoading: string | null
  accounts: TelenoWalletAccountSummary[]
  activeAccountId: string
  activeWalletCanSign: boolean
  canCreateDerivedAccount: boolean
  producerConfiguredAddress?: string | null
  activeView: 'tokens' | 'security'
  onSetActiveAccount: (accountId: string) => void
  onOpenCreateAccount: () => void
  onOpenImportWif: () => void
  onOpenRenameAccount: () => void
  onOpenRemoveAccount: () => void
  onOpenSend: () => void
  onOpenBurn: () => void
  onSetAsProducer: () => void
  onToggleTokens: () => void
  onToggleSecurity: () => void
}

export function WalletAccountBar(props: WalletAccountBarProps) {
  const {
    t,
    hasWalletControls,
    walletActionLoading,
    accounts,
    activeAccountId,
    activeWalletCanSign,
    canCreateDerivedAccount,
    producerConfiguredAddress,
    activeView,
    onSetActiveAccount,
    onOpenCreateAccount,
    onOpenImportWif,
    onOpenRenameAccount,
    onOpenRemoveAccount,
    onOpenSend,
    onOpenBurn,
    onSetAsProducer,
    onToggleTokens,
    onToggleSecurity
  } = props

  const isBusy = walletActionLoading !== null
  const [copied, setCopied] = useState(false)
  const activeAddress = accounts.find((a) => a.id === activeAccountId)?.address ?? ''
  const activeAccountIsProducer = Boolean(
    activeAddress &&
    producerConfiguredAddress &&
    activeAddress.toLowerCase() === `${producerConfiguredAddress}`.trim().toLowerCase()
  )
  const disabledTitle = (reason?: string) => reason || undefined
  const controlsDisabledReason = !hasWalletControls
    ? t('wallet.disabledTooltip.electronOnly')
    : isBusy
      ? t('wallet.disabledTooltip.busy')
      : ''
  const accountPickerTitle = disabledTitle(
    controlsDisabledReason || (accounts.length === 0 ? t('wallet.disabledTooltip.noActiveAccount') : '')
  )
  const setProducerTitle = disabledTitle(
    controlsDisabledReason || (!activeWalletCanSign ? t('wallet.watchOnlyCannotSign') : '')
  )
  const renameTitle = disabledTitle(
    controlsDisabledReason || (accounts.length === 0 ? t('wallet.disabledTooltip.noActiveAccount') : '')
  )
  const removeTitle = disabledTitle(
    controlsDisabledReason || (accounts.length <= 1 ? t('wallet.disabledTooltip.removeLastAccount') : '')
  )
  const createTitle = disabledTitle(
    controlsDisabledReason || (!canCreateDerivedAccount ? t('wallet.deriveAccountUnavailable') : '')
  )
  const importTitle = disabledTitle(controlsDisabledReason)

  const handleCopyAddress = () => {
    if (!activeAddress) return
    void navigator.clipboard.writeText(activeAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="wallet-account-bar">
      <div className="wallet-account-bar-main">
        <label className="wallet-account-picker">
          <span className="wallet-account-picker-label">{t('wallet.currentAccount')}</span>
          <select
            value={activeAccountId}
            onChange={(event) => onSetActiveAccount(event.target.value)}
            disabled={!hasWalletControls || isBusy || accounts.length === 0}
            title={accountPickerTitle}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.address}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost-button copy-address-button"
          onClick={handleCopyAddress}
          disabled={!activeAddress}
          title={!activeAddress ? t('wallet.disabledTooltip.noActiveAccount') : copied ? t('common.copied') : t('wallet.copyAddress')}
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        {activeAccountIsProducer ? (
          <span
            className="wallet-account-producer-badge"
            title={t('wallet.activeAccountIsProducerTitle')}
          >
            {t('wallet.activeAccountIsProducer')}
          </span>
        ) : (
          <button
            type="button"
            className="ghost-button"
            onClick={onSetAsProducer}
            disabled={!hasWalletControls || isBusy || !activeWalletCanSign}
            title={setProducerTitle}
          >
            {t('wallet.setAsProducerAction')}
          </button>
        )}
        <button
          type="button"
          className="ghost-button"
          onClick={onOpenRenameAccount}
          disabled={!hasWalletControls || isBusy || accounts.length === 0}
          title={renameTitle}
        >
          {t('wallet.renameAccountAction')}
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={onOpenRemoveAccount}
          disabled={!hasWalletControls || isBusy || accounts.length <= 1}
          title={removeTitle}
        >
          {t('wallet.removeAccountAction')}
        </button>
        <div className="wallet-account-bar-spacer" />
        <button
          type="button"
          className="ghost-button"
          onClick={onOpenCreateAccount}
          disabled={!hasWalletControls || isBusy || !canCreateDerivedAccount}
          title={createTitle}
        >
          {t('wallet.createDerivedAccountAction')}
        </button>
        <button type="button" className="ghost-button" onClick={onOpenImportWif} disabled={!hasWalletControls || isBusy} title={importTitle}>
          {t('wallet.importAccountAction')}
        </button>
      </div>
      <div className="wallet-account-bar-buttons">
        <button type="button" className={activeView === 'tokens' ? 'primary-button' : 'ghost-button'} onClick={onToggleTokens}>
          {t('wallet.tokensTab')}
        </button>
        <button type="button" className={activeView === 'security' ? 'primary-button' : 'ghost-button'} onClick={onToggleSecurity}>
          {t('wallet.securityTab')}
        </button>
      </div>
    </div>
  )
}
