import React from 'react'
import { LOCAL_RPC_SOURCE } from '../../app/constants'
import { formatDateTime, formatExplorerRpcSourceKind, formatRelativeAge, formatRpcDisplayUrl, normalizeExplorerRpcSource, shortHash } from '../../app/utils'
import { BlockInlineDetail } from './BlockInlineDetail'

type ExplorerPanelProps = any

export function ExplorerPanel(props: ExplorerPanelProps) {
  const {
    t,
    effectiveExplorerRpcUrl,
    settings,
    language,
    head,
    locale,
    headBlockTimeText,
    lastUpdateText,
    isInitialLoading,
    setSettings,
    errorMessage,
    rows,
    freshBlockIds,
    nowMs,
    onBlockClick,
    selectedBlockId,
    rpcUrl
  } = props

  return (
      <>
      <section id="panel-explorer" className="overview-grid" aria-label={t('explorer.panelAria')} role="tabpanel" aria-labelledby="tab-explorer">
        <article className="stat-card">
          <span className="stat-label">{t('explorer.rpcLabel')}</span>
          <p className="stat-value mono" title={effectiveExplorerRpcUrl}>
            {effectiveExplorerRpcUrl}
          </p>
          <p className="stat-note">{formatExplorerRpcSourceKind(settings.rpcSource, language)}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.headLabel')}</span>
          <p className="stat-value">{head ? `#${head.height.toLocaleString(locale)}` : '...'}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.headTimeLabel')}</span>
          <p className="stat-value">{headBlockTimeText}</p>
        </article>
        <article className="stat-card">
          <span className="stat-label">{t('explorer.lastSyncLabel')}</span>
          <p className="stat-value">{lastUpdateText}</p>
        </article>
      </section>

      <main className="table-panel" aria-busy={isInitialLoading}>
        <div className="table-panel-header">
          <div></div>
          <div className="table-panel-tools">
            <label className="table-select">
              <span>{t('explorer.rpcSource')}</span>
              <select
                value={settings.rpcSource}
                onChange={(event) => {
                  const nextSource = normalizeExplorerRpcSource(event.target.value, settings.publicRpcUrls, settings.rpcSource)
                  setSettings((current: any) => ({ ...current, rpcSource: nextSource }))
                }}
              >
                <option value={LOCAL_RPC_SOURCE}>{t('rpc.mode.local')}</option>
                {settings.publicRpcUrls.map((rpcUrl: string) => (
                  <option key={rpcUrl} value={rpcUrl}>
                    {formatRpcDisplayUrl(rpcUrl)}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-meta">
              <span>{formatExplorerRpcSourceKind(settings.rpcSource, language)}</span>
              <span className="mono" title={effectiveExplorerRpcUrl}>
                {formatRpcDisplayUrl(effectiveExplorerRpcUrl)}
              </span>
              <span>{t('explorer.refreshMeta', { ms: settings.pollMs })}</span>
              <span>{t('explorer.rowsMeta', { count: settings.rowLimit })}</span>
            </div>
          </div>
        </div>

        {errorMessage && !props.localNodeNotRunning && (
          <div className="error-banner" role="alert">
            <strong>{t('explorer.rpcErrorBanner')}</strong> <span>{errorMessage}</span>
          </div>
        )}
        {props.localNodeNotRunning && (
          <div className="info-banner" role="status">
            <span>{t('status.startServicesToExplore')}</span>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('explorer.col.height')}</th>
                <th>{t('explorer.col.blockId')}</th>
                <th>{t('explorer.col.producer')}</th>
                <th>{t('explorer.col.age')}</th>
                <th>{t('explorer.col.timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => {
                const isSelected = selectedBlockId === row.blockId
                return (
                  <React.Fragment key={row.blockId}>
                    <tr
                      className={`explorer-row ${freshBlockIds.includes(row.blockId) ? 'is-fresh' : ''} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => onBlockClick?.(row)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="mono">#{row.height.toLocaleString(locale)}</td>
                      <td className="mono explorer-block-id" title={row.blockId}>
                        {row.blockId}
                      </td>
                      <td className="mono" title={row.signer || t('common.na')}>
                        {row.signer || t('common.na')}
                      </td>
                      <td>{formatRelativeAge(row.timestampMs, nowMs)}</td>
                      <td>{formatDateTime(row.timestampMs, locale, t('common.na'))}</td>
                    </tr>
                    {isSelected && (
                      <tr className="explorer-detail-row">
                        <td colSpan={5}>
                          <BlockInlineDetail
                            t={t}
                            locale={locale}
                            language={language}
                            rpcUrl={rpcUrl}
                            block={row}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}

              {!isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {t('explorer.noBlocks')}
                  </td>
                </tr>
              )}

              {isInitialLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {t('explorer.connectingBlocks')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
      </>
  )
}
