import { formatDateTime, formatDecimalValue, formatUsdValue, shortHash } from '../../app/utils'

type DashboardPanelProps = any

export function DashboardPanel(props: DashboardPanelProps) {
  const {
    t,
    locale,
    hasNodeControls,
    dashboardSubtab,
    setDashboardSubtab,
    dashboardProducerWindowBlocks,
    dashboardProducers,
    dashboardProducersLoading,
    dashboardProducersError,
    dashboardPeers,
    dashboardPeersLoading,
    dashboardPeersError,
    nodeProducerOverview,
    nodeProducerLoading,
    nodeProducerError
  } = props

  const producersRows = dashboardProducers?.rows ?? []
  const peersRows = dashboardPeers?.rows ?? []

  return (
    <section id="panel-dashboard" className="dashboard-panel" aria-label={t('dashboard.panelAria')} role="tabpanel" aria-labelledby="tab-dashboard">
      {!hasNodeControls && (
        <div className="node-warning" role="note">
          {t('node.electronOnlyWarning')}
        </div>
      )}

      <div className="wallet-subtabs dashboard-subtabs" role="tablist" aria-label={t('dashboard.subtabsAria')}>
        <button
          type="button"
          className={`wallet-subtab-button ${dashboardSubtab === 'producers' ? 'is-active' : ''}`.trim()}
          onClick={() => setDashboardSubtab('producers')}
        >
          {t('dashboard.subtab.producers')}
        </button>
        <button
          type="button"
          className={`wallet-subtab-button ${dashboardSubtab === 'peers' ? 'is-active' : ''}`.trim()}
          onClick={() => setDashboardSubtab('peers')}
        >
          {t('dashboard.subtab.peers')}
        </button>
        <button
          type="button"
          className={`wallet-subtab-button ${dashboardSubtab === 'forecast' ? 'is-active' : ''}`.trim()}
          onClick={() => setDashboardSubtab('forecast')}
        >
          {t('dashboard.subtab.forecast')}
        </button>
      </div>

      {dashboardSubtab === 'producers' && (
        <div className="dashboard-subpanel">
          {dashboardProducersError && (
            <div className="error-banner node-error-banner" role="alert">
              <span>{dashboardProducersError}</span>
            </div>
          )}

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.windowBlocks')}</span>
              <p className="stat-value">{formatDecimalValue(dashboardProducerWindowBlocks, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.analyzedBlocks')}</span>
              <p className="stat-value">{formatDecimalValue(dashboardProducers?.analyzedBlocks, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.activeProducers')}</span>
              <p className="stat-value">{formatDecimalValue(producersRows.length, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.statsSource')}</span>
              <p className="stat-value mono">{dashboardProducers?.rpcUrl?.replace(/\/$/, '') || t('common.na')}</p>
            </article>
          </div>

          <section className="dashboard-card">
            <div className="node-services-header producer-header">
              <div>
                <h3>{t('dashboard.producersTitle')}</h3>
                <p className="producer-header-copy">{t('dashboard.producersDescription', { blocks: dashboardProducerWindowBlocks })}</p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.col.rank')}</th>
                    <th>{t('dashboard.col.producer')}</th>
                    <th>{t('dashboard.col.blocks')}</th>
                    <th>{t('dashboard.col.share')}</th>
                    <th>{t('dashboard.col.lastHeight')}</th>
                    <th>{t('dashboard.col.lastProduced')}</th>
                  </tr>
                </thead>
                <tbody>
                  {producersRows.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={6}>
                        {dashboardProducersLoading ? t('common.loading') : t('dashboard.noProducers')}
                      </td>
                    </tr>
                  ) : (
                    producersRows.map((row: KnodelKoinosNodeDashboardProducerRow, index: number) => (
                      <tr key={`${row.signer}-${row.lastBlockHeight}`}>
                        <td>{index + 1}</td>
                        <td className="mono" title={row.signer}>{shortHash(row.signer, 16, 12)}</td>
                        <td>{formatDecimalValue(row.blocks, locale, 0, t('common.na'))}</td>
                        <td>{formatDecimalValue(row.sharePercent, locale, 2, t('common.na'))}%</td>
                        <td>{formatDecimalValue(row.lastBlockHeight, locale, 0, t('common.na'))}</td>
                        <td>{formatDateTime(row.lastProducedBlockAt ?? 0, locale, t('common.na'))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="dashboard-note">{dashboardProducers?.output || t('dashboard.noProducers')}</p>
          </section>
        </div>
      )}

      {dashboardSubtab === 'peers' && (
        <div className="dashboard-subpanel">
          {dashboardPeersError && (
            <div className="error-banner node-error-banner" role="alert">
              <span>{dashboardPeersError}</span>
            </div>
          )}

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.connectedPeers')}</span>
              <p className="stat-value">{formatDecimalValue(peersRows.length, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.lastSnapshot')}</span>
              <p className="stat-value">{formatDateTime(dashboardPeers?.snapshotAt ?? 0, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.omittedPeers')}</span>
              <p className="stat-value">{formatDecimalValue(dashboardPeers?.omittedPeerCount, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.selfAddress')}</span>
              <p className="stat-value mono" title={dashboardPeers?.selfAddress || t('common.na')}>
                {dashboardPeers?.selfAddress ? shortHash(dashboardPeers.selfAddress, 18, 12) : t('common.na')}
              </p>
            </article>
          </div>

          <section className="dashboard-card">
            <div className="node-services-header producer-header">
              <div>
                <h3>{t('dashboard.peersTitle')}</h3>
                <p className="producer-header-copy">{t('dashboard.peersDescription')}</p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.col.address')}</th>
                    <th>{t('dashboard.col.host')}</th>
                    <th>{t('dashboard.col.port')}</th>
                    <th>{t('dashboard.col.peerId')}</th>
                  </tr>
                </thead>
                <tbody>
                  {peersRows.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={4}>
                        {dashboardPeersLoading ? t('common.loading') : t('dashboard.noPeers')}
                      </td>
                    </tr>
                  ) : (
                    peersRows.map((row: KnodelKoinosNodeDashboardPeerRow) => (
                      <tr key={row.address}>
                        <td className="mono" title={row.address}>{row.address}</td>
                        <td>{row.host || t('common.na')}</td>
                        <td>{formatDecimalValue(row.port, locale, 0, t('common.na'))}</td>
                        <td className="mono" title={row.peerId || t('common.na')}>
                          {row.peerId ? shortHash(row.peerId, 16, 10) : t('common.na')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="dashboard-note">{dashboardPeers?.output || t('dashboard.noPeers')}</p>
          </section>
        </div>
      )}

      {dashboardSubtab === 'forecast' && (
        <div className="dashboard-subpanel">
          {nodeProducerError && (
            <div className="error-banner node-error-banner" role="alert">
              <span>{nodeProducerError}</span>
            </div>
          )}

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedKoinDay')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.estimatedKoinPerDay, locale, 4, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.lastProducedAt')}</span>
              <p className="stat-value">{formatDateTime(nodeProducerOverview?.lastProducedBlockAt ?? 0, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedKoinMonth')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.estimatedKoinPerMonth, locale, 2, t('common.na'))}</p>
              <p className="stat-note">{t('producer.priceSource')}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.estimatedUsdMonth')}</span>
              <p className="stat-value">{formatUsdValue(nodeProducerOverview?.estimatedUsdPerMonth, locale, t('common.na'))}</p>
              <p className="stat-note">{t('producer.rpcSource', { rpcUrl: nodeProducerOverview?.rpcUrl?.replace(/\/$/, '') || t('common.na') })}</p>
            </article>
          </div>

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('producer.projectedBlocksMonth')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.projectedBlocksPerMonth, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.shareLast24h')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.shareLast24hPercent, locale, 2, t('common.na'))}%</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.producedLast24h')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.producedLast24h, locale, 0, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('producer.activeProducers')}</span>
              <p className="stat-value">{formatDecimalValue(nodeProducerOverview?.activeProducerCount, locale, 0, t('common.na'))}</p>
            </article>
          </div>

          <section className="dashboard-card">
            <div className="node-services-header producer-header">
              <div>
                <h3>{t('dashboard.forecastTitle')}</h3>
                <p className="producer-header-copy">{t('dashboard.forecastDescription')}</p>
              </div>
            </div>
            <p className="dashboard-note">{nodeProducerOverview?.output || t('dashboard.noForecast')}</p>
          </section>
        </div>
      )}
    </section>
  )
}
