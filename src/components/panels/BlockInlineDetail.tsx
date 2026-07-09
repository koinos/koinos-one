import { useEffect, useState } from 'react'
import { formatDateTime, fetchBlockDetail, formatKoinscanBlockUrl } from '../../app/utils'
import type { BlockDetail, TransactionDetail } from '../../app/types'
import type { AppLanguage } from '../../i18n'

type BlockInlineDetailProps = {
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
  language: AppLanguage
  rpcUrl: string
  koinscanUrl: string
  block: { height: number; blockId: string; previousId: string; signer: string; timestampMs: number }
}

type Tab = 'overview' | 'transactions' | 'raw'

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bid-section">
      <button type="button" className="bid-section-toggle" onClick={() => setOpen(!open)}>
        <span className="bid-arrow">{open ? '▼' : '▶'}</span> {title}
      </button>
      {open && <div className="bid-section-body">{children}</div>}
    </div>
  )
}

function Field({ label, value, mono = true }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="bid-field">
      <span className="bid-field-label">{label}</span>
      <span className={`bid-field-value ${mono ? 'mono' : ''}`}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </div>
  )
}

function formatOpType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function TxCard({ tx, index, total, t }: { tx: TransactionDetail; index: number; total: number; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false)
  const r = tx.receipt
  const reverted = r?.reverted
  const statusClass = reverted ? 'tx-reverted' : 'tx-success'

  return (
    <div className={`bid-tx-card ${statusClass}`}>
      <button type="button" className="bid-tx-header" onClick={() => setExpanded(!expanded)}>
        <span className="bid-tx-index">{t('blockDetail.tx')} {index + 1}/{total}</span>
        {r && <span className={`bid-tx-status ${statusClass}`}>{reverted ? '✗ Reverted' : '✓ OK'}</span>}
        {r && <span className="bid-tx-rc">RC {r.rcUsed.toLocaleString()} / {(tx.rcLimit || r.rcLimit).toLocaleString()}</span>}
        {tx.operations.length > 0 && <span className="bid-tx-ops">{tx.operations.length} op(s)</span>}
        {r && r.events.length > 0 && <span className="bid-tx-events">{r.events.length} event(s)</span>}
        <span className="bid-arrow">{expanded ? '▼' : '▶'}</span>
      </button>
      <div className="bid-tx-id mono">{tx.id}</div>

      {expanded && (
        <div className="bid-tx-expanded">
          <div className="bid-fields-grid">
            <Field label={t('blockDetail.payer')} value={tx.payer} />
            {tx.payee && tx.payee !== tx.payer && <Field label={t('blockDetail.payee')} value={tx.payee} />}
          </div>

          {tx.operations.length > 0 && (
            <Section title={`${t('blockDetail.operations')} (${tx.operations.length})`} defaultOpen>
              {tx.operations.map((op, i) => (
                <div key={i} className="bid-op">
                  <span className="bid-op-type">{formatOpType(op.type)}</span>
                  {op.contractId && <span className="mono bid-op-detail">{op.contractId}</span>}
                  {op.entryPoint > 0 && <span className="mono bid-op-detail">ep:0x{op.entryPoint.toString(16)}</span>}
                </div>
              ))}
            </Section>
          )}

          {r && r.events.length > 0 && (
            <Section title={`${t('blockDetail.events')} (${r.events.length})`}>
              {r.events.map((evt, i) => (
                <div key={i} className="bid-event">
                  <span className="bid-event-name">{evt.name || 'unnamed'}</span>
                  {evt.source && <span className="mono bid-event-source">{evt.source}</span>}
                  {evt.impacted.length > 0 && (
                    <div className="bid-event-impacted">
                      {evt.impacted.map((addr, j) => <span key={j} className="mono">{addr}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {r && (
            <Section title={t('blockDetail.resources')}>
              <div className="bid-fields-grid">
                <Field label={t('blockDetail.diskUsed')} value={`${r.diskStorageUsed.toLocaleString()} B`} mono={false} />
                <Field label={t('blockDetail.networkUsed')} value={`${r.networkBandwidthUsed.toLocaleString()} B`} mono={false} />
                <Field label={t('blockDetail.computeUsed')} value={`${r.computeBandwidthUsed.toLocaleString()} ticks`} mono={false} />
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

export function BlockInlineDetail({ t, locale, language, rpcUrl, koinscanUrl, block }: BlockInlineDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [detail, setDetail] = useState<BlockDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchBlockDetail(language, rpcUrl, block.blockId, controller.signal)
      .then(setDetail)
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [block.blockId, rpcUrl, language])

  const d = detail
  const txCount = d?.transactions.length ?? 0
  const blockDate = new Date(d?.timestampMs ?? block.timestampMs)

  const copyRawJson = () => {
    if (d?.raw) {
      navigator.clipboard.writeText(JSON.stringify(d.raw, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="bid-container">
      <div className="bid-tabs">
        <button type="button" className={`bid-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          {t('blockDetail.tabOverview')}
        </button>
        <button type="button" className={`bid-tab ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>
          {t('blockDetail.tabTransactions')} {!loading && `(${txCount})`}
        </button>
        <button type="button" className={`bid-tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => setActiveTab('raw')}>
          {t('blockDetail.tabRaw')}
        </button>

        <div className="bid-tab-actions">
          <a className="ghost-button bid-action-btn" href={formatKoinscanBlockUrl(koinscanUrl, d?.height ?? block.height)} target="_blank" rel="noopener noreferrer">
            Koinscan ↗
          </a>
          {d?.raw && (
            <button type="button" className="ghost-button bid-action-btn" onClick={copyRawJson}>
              {copied ? '✓' : t('blockDetail.copyJson')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner" style={{ margin: '8px 0' }}>{error}</div>}
      {loading && <div className="bid-loading">{t('common.loading')}</div>}

      {activeTab === 'overview' && (
        <div className="bid-overview">
          <div className="bid-fields-grid">
            <Field label={t('blockDetail.height')} value={d?.height ?? block.height} />
            <Field label={t('blockDetail.timestamp')} value={formatDateTime(d?.timestampMs ?? block.timestampMs, locale, 'N/A')} mono={false} />
            <Field label={t('blockDetail.dateUtc')} value={blockDate.toISOString()} />
            <Field label={t('blockDetail.transactions')} value={txCount} mono={false} />
            <Field label={t('blockDetail.blockEvents')} value={d?.blockEvents.length ?? 0} mono={false} />
          </div>

          <Field label={t('blockDetail.blockId')} value={d?.blockId ?? block.blockId} />
          <Field label={t('blockDetail.previousBlock')} value={d?.previousId ?? block.previousId} />
          <Field label={t('blockDetail.producer')} value={d?.signer ?? block.signer} />

          {d && (
            <>
              <Section title={t('blockDetail.sectionCrypto')}>
                <Field label={t('blockDetail.txMerkleRoot')} value={d.transactionMerkleRoot} />
                <Field label={t('blockDetail.stateMerkleRoot')} value={d.previousStateMerkleRoot} />
                <Field label={t('blockDetail.signature')} value={d.signature} />
              </Section>

              {d.approvedProposals.length > 0 && (
                <Section title={`${t('blockDetail.sectionGovernance')} (${d.approvedProposals.length})`}>
                  {d.approvedProposals.map((p, i) => <div key={i} className="mono bid-hash">{p}</div>)}
                </Section>
              )}

              {d.blockEvents.length > 0 && (
                <Section title={`${t('blockDetail.blockEvents')} (${d.blockEvents.length})`}>
                  {d.blockEvents.map((evt, i) => (
                    <div key={i} className="bid-event-row">
                      <span className="bid-event-name">{evt.name || t('common.na')}</span>
                      <span className="mono bid-event-source" title={evt.source}>{evt.source}</span>
                      {evt.impacted.length > 0 && (
                        <span className="bid-event-impacted mono" title={evt.impacted.join(', ')}>
                          {t('blockDetail.impacted', { count: evt.impacted.length })}
                        </span>
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="bid-transactions">
          {loading ? null : txCount === 0 ? (
            <p className="bid-empty">{t('blockDetail.noTransactions')}</p>
          ) : (
            d?.transactions.map((tx, i) => <TxCard key={tx.id || i} tx={tx} index={i} total={txCount} t={t} />)
          )}
        </div>
      )}

      {activeTab === 'raw' && (
        <div className="bid-raw">
          {d?.raw ? (
            <pre className="bid-json">{JSON.stringify(d.raw, null, 2)}</pre>
          ) : loading ? null : (
            <p className="bid-empty">{t('common.na')}</p>
          )}
        </div>
      )}
    </div>
  )
}
