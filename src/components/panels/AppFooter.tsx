type AppFooterProps = any

export function AppFooter(props: AppFooterProps) {
  const {
    footerStatusClass,
    footerStatusText,
    footerStatusMeta,
    footerRpcUrl,
    showChainSyncProgress,
    chainSyncPercent,
    t,
    appVersion,
    openVersionChangelog
  } = props

  return (
      <footer className="app-footer">
        <div className={`status-pill footer-status ${footerStatusClass}`.trim()} role="status" aria-live="polite">
          <div className="footer-status-main">
            <span className="status-dot" aria-hidden="true" />
            <span className="footer-status-text">{footerStatusText}</span>
          </div>
          {footerStatusMeta && <span className="footer-status-meta mono">{footerStatusMeta}</span>}
          {showChainSyncProgress && chainSyncPercent !== null && (
            <div className="footer-status-progress" aria-hidden="true">
              <span
                className="footer-status-progress-fill"
                style={{ width: `${Math.max(2, chainSyncPercent)}%` }}
              />
            </div>
          )}
        </div>
        <div className="app-footer-right">
          {footerRpcUrl && (
            <span className="status-pill is-idle footer-rpc-badge" title={footerRpcUrl}>
              <span className="status-dot" aria-hidden="true" />
              <span>{footerRpcUrl}</span>
            </span>
          )}
          <button
            type="button"
            className="app-version-badge"
            title={t('app.versionChangelogTitle', { version: appVersion })}
            onClick={() => openVersionChangelog?.()}
          >
            <span className="mono">v{appVersion}</span>
          </button>
        </div>
      </footer>
  )
}
