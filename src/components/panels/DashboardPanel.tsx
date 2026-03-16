import {
  formatBytes,
  formatCpuPercent,
  formatDateTime,
  formatDecimalValue,
  formatDurationSeconds,
  formatUsdValue,
  shortHash
} from '../../app/utils'

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
    dashboardPerformance,
    dashboardPerformanceLoading,
    dashboardPerformanceError,
    nodeProducerOverview,
    nodeProducerLoading,
    nodeProducerError
  } = props

  const producersRows = dashboardProducers?.rows ?? []
  const peersRows = dashboardPeers?.rows ?? []
  const performanceRows = dashboardPerformance?.rows ?? []
  const hostLoadAverage = dashboardPerformance?.host.loadAverage ?? []

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
        <button
          type="button"
          className={`wallet-subtab-button ${dashboardSubtab === 'performance' ? 'is-active' : ''}`.trim()}
          onClick={() => setDashboardSubtab('performance')}
        >
          {t('dashboard.subtab.performance')}
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
              <p className="stat-note">
                {t('producer.priceSource', { source: nodeProducerOverview?.priceSourceName || t('common.na') })}
              </p>
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

      {dashboardSubtab === 'performance' && (
        <div className="dashboard-subpanel">
          {dashboardPerformanceError && (
            <div className="error-banner node-error-banner" role="alert">
              <span>{dashboardPerformanceError}</span>
            </div>
          )}

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.knodelCpu')}</span>
              <p className="stat-value">{formatCpuPercent(dashboardPerformance?.totals.knodelCpuPercent, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.knodelRam')}</span>
              <p className="stat-value">{formatBytes(dashboardPerformance?.totals.knodelMemoryBytes, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.servicesCpu')}</span>
              <p className="stat-value">{formatCpuPercent(dashboardPerformance?.totals.servicesCpuPercent, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.servicesRam')}</span>
              <p className="stat-value">{formatBytes(dashboardPerformance?.totals.servicesMemoryBytes, locale, t('common.na'))}</p>
            </article>
          </div>

          <div className="overview-grid">
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.freeSystemRam')}</span>
              <p className="stat-value">{formatBytes(dashboardPerformance?.host.freeMemoryBytes, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.lastSample')}</span>
              <p className="stat-value">{formatDateTime(dashboardPerformance?.sampledAt ?? 0, locale, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.hostUptime')}</span>
              <p className="stat-value">{formatDurationSeconds(dashboardPerformance?.host.uptimeSeconds, t('common.na'))}</p>
            </article>
            <article className="stat-card">
              <span className="stat-label">{t('dashboard.performance.hostCpus')}</span>
              <p className="stat-value">{formatDecimalValue(dashboardPerformance?.host.cpuCount, locale, 0, t('common.na'))}</p>
            </article>
          </div>

          <section className="dashboard-card">
            <div className="node-services-header producer-header">
              <div>
                <h3>{t('dashboard.performanceTitle')}</h3>
                <p className="producer-header-copy">{t('dashboard.performanceDescription')}</p>
              </div>
            </div>

            <p className="dashboard-note">
              {t('dashboard.performanceHostSummary', {
                cpuCount: dashboardPerformance?.host.cpuCount ?? t('common.na'),
                load1: formatDecimalValue(hostLoadAverage[0], locale, 2, t('common.na')),
                load5: formatDecimalValue(hostLoadAverage[1], locale, 2, t('common.na')),
                load15: formatDecimalValue(hostLoadAverage[2], locale, 2, t('common.na')),
                uptime: formatDurationSeconds(dashboardPerformance?.host.uptimeSeconds, t('common.na'))
              })}
            </p>

            <div className="table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.col.name')}</th>
                    <th>{t('dashboard.col.kind')}</th>
                    <th>{t('dashboard.col.pid')}</th>
                    <th>{t('dashboard.col.cpuPercent')}</th>
                    <th>{t('dashboard.col.ram')}</th>
                    <th>{t('dashboard.col.virtual')}</th>
                    <th>{t('dashboard.col.uptime')}</th>
                    <th>{t('dashboard.col.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {performanceRows.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan={8}>
                        {dashboardPerformanceLoading ? t('common.loading') : t('dashboard.noPerformance')}
                      </td>
                    </tr>
                  ) : (
                    performanceRows.map((row: KnodelKoinosNodeDashboardPerformanceRow) => (
                      <tr key={row.id}>
                        <td className="mono" title={row.command || row.label}>{row.label}</td>
                        <td>{row.kind === 'knodel' ? t('dashboard.kind.knodel') : t('dashboard.kind.service')}</td>
                        <td>{formatDecimalValue(row.pid, locale, 0, t('common.na'))}</td>
                        <td>{formatCpuPercent(row.cpuPercent, locale, t('common.na'))}</td>
                        <td>{formatBytes(row.rssBytes, locale, t('common.na'))}</td>
                        <td>{formatBytes(row.virtualBytes, locale, t('common.na'))}</td>
                        <td>{formatDurationSeconds(row.uptimeSeconds, t('common.na'))}</td>
                        <td>{row.state || t('common.na')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="dashboard-note">{dashboardPerformance?.output || t('dashboard.noPerformance')}</p>
          </section>
        </div>
      )}
    </section>
  )
}
