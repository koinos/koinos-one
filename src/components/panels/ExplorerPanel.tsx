import React, { Suspense, lazy, useState } from 'react'

const Explorer3DView = lazy(() => import('./explorer3d/Explorer3DView'))
import { LOCAL_RPC_SOURCE } from '../../app/constants'
import { formatDateTime, formatRelativeAge, formatRpcDisplayUrl, normalizeExplorerRpcSource, shortHash } from '../../app/utils'
import { BlockInlineDetail } from './BlockInlineDetail'

type ExplorerPanelProps = any

export function ExplorerPanel(props: ExplorerPanelProps) {
	const {
	  t,
	  settings,
	  language,
    koinscanUrl,
    head,
    locale,
    headBlockTimeText,
    lastUpdateText,
    isInitialLoading,
    setSettings,
    errorMessage,
    rows,
    freshBlockIds,
    ownProducerAddress,
    nowMs,
    onBlockClick,
    selectedBlockId,
    rpcUrl
  } = props

  const [explorerView, setExplorerView] = useState<'list' | '3d'>('list')

  return (
      <>
        <div className="settings-tabs explorer-view-tabs" role="tablist" aria-label={t('explorer.viewTabsAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={explorerView === 'list'}
            className={`settings-tab-button ${explorerView === 'list' ? 'is-active' : ''}`}
            onClick={() => setExplorerView('list')}
          >
            {t('explorer.viewList')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={explorerView === '3d'}
            className={`settings-tab-button ${explorerView === '3d' ? 'is-active' : ''}`}
            onClick={() => setExplorerView('3d')}
          >
            {t('explorer.view3d')}
            <span className="explorer3d-badge-inline">{t('explorer3d.experimentalBadge')}</span>
          </button>
        </div>

        {explorerView === '3d' && (
          <Suspense
            fallback={
              <div className="explorer3d-fallback" role="status">
                {t('explorer3d.loading')}
              </div>
            }
          >
            <Explorer3DView t={t} language={language} rpcUrl={rpcUrl} rows={rows} />
          </Suspense>
        )}

        {explorerView === 'list' && (
        <>
	      <section id="panel-explorer" className="overview-grid" aria-label={t('explorer.panelAria')} role="tabpanel" aria-labelledby="tab-explorer">
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
          <div className="table-panel-tools-left">
            <label className="table-select explorer-rpc-source-select">
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
              <span>{t('explorer.rpcSource')}</span>
            </label>
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
                const isOwnProducer = Boolean(
                  ownProducerAddress &&
                  row.signer &&
                  `${row.signer}`.toLowerCase() === `${ownProducerAddress}`.trim().toLowerCase()
                )
                return (
                  <React.Fragment key={row.blockId}>
                    <tr
                      className={`explorer-row ${freshBlockIds.includes(row.blockId) ? 'is-fresh' : ''} ${isSelected ? 'is-selected' : ''} ${isOwnProducer ? 'is-own-producer' : ''}`}
                      onClick={() => onBlockClick?.(row)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="mono">#{row.height.toLocaleString(locale)}</td>
                      <td className="mono explorer-block-id" title={row.blockId}>
                        <span>{shortHash(row.blockId, 14, 10)}</span>
                      </td>
                      <td className="mono" title={row.signer || t('common.na')}>
                        {row.signer || t('common.na')}
                        {isOwnProducer && (
                          <span className="explorer-own-producer-badge" title={t('explorer.ownProducerBadgeTitle')}>
                            {t('explorer.ownProducerBadge')}
                          </span>
                        )}
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
                            koinscanUrl={koinscanUrl}
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
        )}
      </>
  )
}
