import { useEffect, useState } from 'react'
import { formatDateTime, fetchBlockDetail, formatKoinscanBlockUrl } from '../../app/utils'
import type { BlockDetail, TransactionDetail, OperationDetail } from '../../app/types'
import type { AppLanguage } from '../../i18n'

type BlockDetailDialogProps = {
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
  language: AppLanguage
  rpcUrl: string
  koinscanUrl: string
  block: {
    height: number
    blockId: string
    previousId: string
    signer: string
    timestampMs: number
  }
  onClose: () => void
}

type Tab = 'overview' | 'transactions' | 'raw'

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="block-detail-section">
      <button type="button" className="block-detail-section-toggle" onClick={() => setOpen(!open)}>
        <span className="block-detail-section-arrow">{open ? '▼' : '▶'}</span> {title}
      </button>
      {open && <div className="block-detail-section-body">{children}</div>}
    </div>
  )
}

function FieldRow({ label, value, mono = true }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <tr>
      <td className="block-detail-label">{label}</td>
      <td className={mono ? 'mono block-detail-hash' : ''}>{typeof value === 'number' ? value.toLocaleString() : value}</td>
    </tr>
  )
}

function formatOpType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function TransactionCard({ tx, index, total, t }: { tx: TransactionDetail; index: number; total: number; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false)
  const r = tx.receipt
  const statusClass = r?.reverted ? 'tx-reverted' : 'tx-success'
  const statusLabel = r?.reverted ? '✗ Reverted' : '✓ Success'

  return (
    <div className={`block-detail-tx-card ${statusClass}`}>
      <button type="button" className="block-detail-tx-header" onClick={() => setExpanded(!expanded)}>
        <div className="block-detail-tx-summary">
          <span className="block-detail-tx-index">{t('blockDetail.tx')} {index + 1} / {total}</span>
          {r && <span className={`block-detail-tx-status ${statusClass}`}>{statusLabel}</span>}
        </div>
        <span className="block-detail-section-arrow">{expanded ? '▼' : '▶'}</span>
      </button>

      <div className="block-detail-tx-id mono">{tx.id}</div>

      {r && (
        <div className="block-detail-tx-rc">
          RC: {r.rcUsed.toLocaleString()} / {(tx.rcLimit || r.rcLimit).toLocaleString()}
          {tx.operations.length > 0 && ` · ${tx.operations.length} op(s)`}
          {r.events.length > 0 && ` · ${r.events.length} event(s)`}
        </div>
      )}

      {expanded && (
        <div className="block-detail-tx-expanded">
          <table className="block-detail-table">
            <tbody>
              <FieldRow label={t('blockDetail.payer')} value={tx.payer} />
              {tx.payee && tx.payee !== tx.payer && <FieldRow label={t('blockDetail.payee')} value={tx.payee} />}
              <FieldRow label="Nonce" value={tx.nonce} />
            </tbody>
          </table>

          {tx.operations.length > 0 && (
            <CollapsibleSection title={`${t('blockDetail.operations')} (${tx.operations.length})`} defaultOpen>
              {tx.operations.map((op, i) => (
                <div key={i} className="block-detail-op">
                  <span className="block-detail-op-type">{formatOpType(op.type)}</span>
                  {op.contractId && <span className="mono block-detail-op-contract">{op.contractId}</span>}
                  {op.entryPoint > 0 && <span className="mono"> ep:0x{op.entryPoint.toString(16)}</span>}
                </div>
              ))}
            </CollapsibleSection>
          )}

          {r && r.events.length > 0 && (
            <CollapsibleSection title={`${t('blockDetail.events')} (${r.events.length})`}>
              {r.events.map((evt, i) => (
                <div key={i} className="block-detail-event">
                  <div className="block-detail-event-name">{evt.name || 'unnamed'}</div>
                  {evt.source && <div className="mono block-detail-event-source">{evt.source}</div>}
                  {evt.impacted.length > 0 && (
                    <div className="block-detail-event-impacted">
                      {evt.impacted.map((addr, j) => <span key={j} className="mono">{addr}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </CollapsibleSection>
          )}

          {r && (
            <CollapsibleSection title={t('blockDetail.resources')}>
              <table className="block-detail-table">
                <tbody>
                  <FieldRow label={t('blockDetail.rcUsed')} value={`${r.rcUsed.toLocaleString()} / ${(tx.rcLimit || r.rcLimit).toLocaleString()}`} mono={false} />
                  <FieldRow label={t('blockDetail.diskUsed')} value={`${r.diskStorageUsed.toLocaleString()} bytes`} mono={false} />
                  <FieldRow label={t('blockDetail.networkUsed')} value={`${r.networkBandwidthUsed.toLocaleString()} bytes`} mono={false} />
                  <FieldRow label={t('blockDetail.computeUsed')} value={`${r.computeBandwidthUsed.toLocaleString()} ticks`} mono={false} />
                </tbody>
              </table>
            </CollapsibleSection>
          )}

          {tx.signatures.length > 0 && (
            <CollapsibleSection title={`${t('blockDetail.signatures')} (${tx.signatures.length})`}>
              {tx.signatures.map((sig, i) => (
                <div key={i} className="mono block-detail-hash">{sig}</div>
              ))}
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  )
}

export function BlockDetailDialog({ t, locale, language, rpcUrl, koinscanUrl, block, onClose }: BlockDetailDialogProps) {
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const d = detail
  const blockDate = new Date(d?.timestampMs ?? block.timestampMs)
  const txCount = d?.transactions.length ?? 0

  const copyRawJson = () => {
    if (d?.raw) {
      navigator.clipboard.writeText(JSON.stringify(d.raw, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="block-detail-overlay" onClick={onClose}>
      <div className="block-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="block-detail-header">
          <h2>{t('blockDetail.title', { height: (d?.height ?? block.height).toLocaleString(locale) })}</h2>
          <button type="button" className="ghost-button block-detail-close" onClick={onClose}>✕</button>
        </div>

        <div className="block-detail-tabs">
          <button type="button" className={`block-detail-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            {t('blockDetail.tabOverview')}
          </button>
          <button type="button" className={`block-detail-tab ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>
            {t('blockDetail.tabTransactions')} {!loading && `(${txCount})`}
          </button>
          <button type="button" className={`block-detail-tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => setActiveTab('raw')}>
            {t('blockDetail.tabRaw')}
          </button>
        </div>

        <div className="block-detail-body">
          {error && <div className="error-banner">{error}</div>}
          {loading && <div className="block-detail-loading">{t('common.loading')}</div>}

          {activeTab === 'overview' && (
            <div className="block-detail-overview">
              <table className="block-detail-table">
                <tbody>
                  <FieldRow label={t('blockDetail.height')} value={d?.height ?? block.height} />
                  <FieldRow label={t('blockDetail.blockId')} value={d?.blockId ?? block.blockId} />
                  <FieldRow label={t('blockDetail.previousBlock')} value={d?.previousId ?? block.previousId} />
                  <FieldRow label={t('blockDetail.producer')} value={d?.signer ?? block.signer} />
                  <FieldRow label={t('blockDetail.timestamp')} value={formatDateTime(d?.timestampMs ?? block.timestampMs, locale, 'N/A')} mono={false} />
                  <FieldRow label={t('blockDetail.dateUtc')} value={blockDate.toISOString()} />
                  <FieldRow label={t('blockDetail.transactions')} value={txCount} mono={false} />
                </tbody>
              </table>

              {d && (
                <>
                  <CollapsibleSection title={t('blockDetail.sectionCrypto')}>
                    <table className="block-detail-table">
                      <tbody>
                        <FieldRow label={t('blockDetail.txMerkleRoot')} value={d.transactionMerkleRoot} />
                        <FieldRow label={t('blockDetail.stateMerkleRoot')} value={d.previousStateMerkleRoot} />
                        <FieldRow label={t('blockDetail.signature')} value={d.signature} />
                      </tbody>
                    </table>
                  </CollapsibleSection>

                  {d.approvedProposals.length > 0 && (
                    <CollapsibleSection title={`${t('blockDetail.sectionGovernance')} (${d.approvedProposals.length})`}>
                      {d.approvedProposals.map((p, i) => (
                        <div key={i} className="mono block-detail-hash">{p}</div>
                      ))}
                    </CollapsibleSection>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="block-detail-transactions">
              {loading ? null : txCount === 0 ? (
                <p className="block-detail-empty">{t('blockDetail.noTransactions')}</p>
              ) : (
                d?.transactions.map((tx, i) => (
                  <TransactionCard key={tx.id || i} tx={tx} index={i} total={txCount} t={t} />
                ))
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="block-detail-raw">
              {d?.raw ? (
                <pre className="block-detail-json">{JSON.stringify(d.raw, null, 2)}</pre>
              ) : loading ? null : (
                <p className="block-detail-empty">{t('common.na')}</p>
              )}
            </div>
          )}
        </div>

        <div className="block-detail-footer">
          <a
            className="ghost-button"
            href={formatKoinscanBlockUrl(koinscanUrl, d?.height ?? block.height)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('blockDetail.viewOnKoinscan')} ↗
          </a>
          {d?.raw && (
            <button type="button" className="ghost-button" onClick={copyRawJson}>
              {copied ? '✓ Copied' : t('blockDetail.copyJson')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
