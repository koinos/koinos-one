import { useState } from 'react'
import { formatDateTime, formatDecimalValue, shortHash } from '../../app/utils'

type ProducerPanelProps = any

export function ProducerPanel(props: ProducerPanelProps) {
  const {
    t,
    deleteNodeProducer,
    hasNodeControls,
    nodeProducerError,
    nodeProducerOverview,
    producerConfiguredAddress,
    producerRegisteredPublicKey,
    producerRecentBlocks,
    producerRecentBlocksError,
    producerBlocksWindowBlocks,
    producerRefreshSeconds,
    producerSetupComplete,
    signingWalletAddress,
    producerLocalPublicKey,
    producerVaultExists,
    producerVaultUnlocked,
    producerRegisterDisabled,
    producerRegisterHintClass,
    producerRegisterHintText,
    nodeProducerActionLoading,
    registerNodeProducer,
    openWalletTab,
    locale
  } = props

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const localPublicKey = producerLocalPublicKey || ''
  const vhpBalanceValue = nodeProducerOverview?.vhpBalance ? Number.parseFloat(nodeProducerOverview.vhpBalance) : null
  const showNoVhpNotice = vhpBalanceValue !== null && Number.isFinite(vhpBalanceValue) && vhpBalanceValue <= 0
  const canCreateProducer = !producerRegisterDisabled

  return (
    <section
      id="panel-producer"
      className={`producer-panel wallet-panel ${producerSetupComplete ? '' : 'producer-panel-no-header'}`.trim()}
      aria-label={t('producer.panelAria')}
      role="tabpanel"
      aria-labelledby="tab-producer"
    >
      {producerSetupComplete && (
        <div className="wallet-header">
          <div className="wallet-header-meta">
            <button
              type="button"
              className="danger-button"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={!hasNodeControls || nodeProducerActionLoading !== null}
            >
              {nodeProducerActionLoading === 'delete' ? t('common.loading') : t('producer.deleteAction')}
            </button>
          </div>
        </div>
      )}

      {!hasNodeControls && (
        <div className="node-warning" role="note">
          {t('node.electronOnlyWarning')}
        </div>
      )}

      {nodeProducerError && (
        <div className="error-banner node-error-banner" role="alert">
          <span>{nodeProducerError}</span>
        </div>
      )}

      {!producerSetupComplete ? (
        <section className="producer-minimal-card producer-config-launch">
          <div className="producer-details">
            <div className="producer-detail-row">
              <span>{t('producer.address')}</span>
              <span className="mono" title={signingWalletAddress || t('common.na')}>
                {signingWalletAddress || t('common.na')}
              </span>
            </div>
            <div className="producer-detail-row">
              <span>{t('producer.localPublicKey')}</span>
              <span className="mono" title={localPublicKey || t('common.na')}>
                {localPublicKey || t('common.na')}
              </span>
            </div>
            <div className="producer-detail-row">
              <span>{t('producer.registeredPublicKey')}</span>
              <span className="mono" title={producerRegisteredPublicKey || t('common.na')}>
                {producerRegisteredPublicKey || t('common.na')}
              </span>
            </div>
          </div>

          <div className="producer-actions">
            {signingWalletAddress ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void registerNodeProducer(signingWalletAddress)
                }}
                disabled={producerRegisterDisabled}
              >
                {nodeProducerActionLoading === 'register' ? t('producer.registering') : t('producer.createAction')}
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={openWalletTab}>
                {t('producer.openWalletAction')}
              </button>
            )}
            <span className={`settings-inline-help ${producerRegisterHintClass}`.trim()}>
              {producerRegisterHintText}
            </span>
          </div>
        </section>
      ) : (
        <>
          {producerRecentBlocksError && (
            <div className="error-banner node-error-banner" role="alert">
              <span>{producerRecentBlocksError}</span>
            </div>
          )}

          {showNoVhpNotice && (
            <div className="node-warning" role="note">
              {t('producer.noVhpNotice')}
            </div>
          )}

          <div className="producer-grid">
            <article className="stat-card">
              <span className="stat-label">{t('producer.address')}</span>
              <p className="stat-value mono producer-identity-value" title={producerConfiguredAddress || t('common.na')}>
                {producerConfiguredAddress || t('common.na')}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.localPublicKey')}</span>
              <p className="stat-value mono producer-identity-value" title={nodeProducerOverview?.localPublicKey || localPublicKey || t('common.na')}>
                {nodeProducerOverview?.localPublicKey || localPublicKey || t('common.na')}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.registeredPublicKey')}</span>
              <p className="stat-value mono producer-identity-value" title={producerRegisteredPublicKey || t('common.na')}>
                {producerRegisteredPublicKey || t('common.na')}
              </p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.vhpBalance')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.vhpBalance, locale, 2, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.koinBalance')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.koinBalance, locale, 2, t('common.na'))}</p>
            </article>
          </div>

          <section className="producer-minimal-card">
            <div className="node-services-header producer-header">
              <div>
                <h3>{t('producer.latestBlocksTitle')}</h3>
                <p className="producer-header-copy">
                  {t('producer.latestBlocksDescription', {
                    blocks: producerBlocksWindowBlocks,
                    seconds: producerRefreshSeconds
                  })}
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="producer-blocks-table">
                <thead>
                  <tr>
                    <th>{t('producer.blockHeight')}</th>
                    <th>{t('producer.blockId')}</th>
                    <th>{t('producer.blockProducedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {producerRecentBlocks.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={3}>
                        {t('producer.noProducedBlocks', { blocks: producerBlocksWindowBlocks })}
                      </td>
                    </tr>
                  ) : (
                    producerRecentBlocks.map((row: { height: number; blockId: string; timestampMs: number }) => (
                      <tr key={row.blockId}>
                        <td>{formatDecimalValue(row.height, locale, 0, t('common.na'))}</td>
                        <td className="mono" title={row.blockId}>{shortHash(row.blockId, 16, 12)}</td>
                        <td>{formatDateTime(row.timestampMs, locale, t('common.na'))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {deleteDialogOpen && (
        <div className="log-modal-backdrop" role="presentation" onClick={() => setDeleteDialogOpen(false)}>
          <section
            className="log-modal producer-config-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="producer-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="log-modal-header">
              <div>
                <h3 id="producer-delete-title" className="log-modal-title">{t('producer.deleteConfirmTitle')}</h3>
                <p className="log-modal-meta">{t('producer.deleteConfirmDescription')}</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setDeleteDialogOpen(false)}>
                {t('common.close')}
              </button>
            </div>

            <div className="producer-config-modal-body">
              <div className="wallet-modal-actions">
                <button type="button" className="ghost-button" onClick={() => setDeleteDialogOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    void deleteNodeProducer().then((ok: boolean) => {
                      if (ok) setDeleteDialogOpen(false)
                    })
                  }}
                  disabled={!hasNodeControls || nodeProducerActionLoading !== null}
                >
                  {nodeProducerActionLoading === 'delete' ? t('common.loading') : t('producer.deleteConfirmAction')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
