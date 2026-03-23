import { formatDateTime } from '../../app/utils'

type BlockDetailDialogProps = {
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
  block: {
    height: number
    blockId: string
    previousId: string
    signer: string
    timestampMs: number
    transactionCount?: number
    transactionMerkleRoot?: string
  } | null
  onClose: () => void
}

export function BlockDetailDialog({ t, locale, block, onClose }: BlockDetailDialogProps) {
  if (!block) return null

  const blockDate = new Date(block.timestampMs)

  return (
    <div className="block-detail-overlay" onClick={onClose}>
      <div className="block-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="block-detail-header">
          <h2>Block #{block.height.toLocaleString(locale)}</h2>
          <button type="button" className="ghost-button block-detail-close" onClick={onClose}>✕</button>
        </div>

        <div className="block-detail-body">
          <table className="block-detail-table">
            <tbody>
              <tr>
                <td className="block-detail-label">{t('blockDetail.height')}</td>
                <td className="mono">{block.height.toLocaleString(locale)}</td>
              </tr>
              <tr>
                <td className="block-detail-label">{t('blockDetail.blockId')}</td>
                <td className="mono block-detail-hash">{block.blockId}</td>
              </tr>
              <tr>
                <td className="block-detail-label">{t('blockDetail.previousBlock')}</td>
                <td className="mono block-detail-hash">{block.previousId || t('common.na')}</td>
              </tr>
              <tr>
                <td className="block-detail-label">{t('blockDetail.producer')}</td>
                <td className="mono">{block.signer || t('common.na')}</td>
              </tr>
              <tr>
                <td className="block-detail-label">{t('blockDetail.timestamp')}</td>
                <td>{formatDateTime(block.timestampMs, locale, t('common.na'))}</td>
              </tr>
              <tr>
                <td className="block-detail-label">{t('blockDetail.dateUtc')}</td>
                <td className="mono">{blockDate.toISOString()}</td>
              </tr>
              {block.transactionCount !== undefined && (
                <tr>
                  <td className="block-detail-label">{t('blockDetail.transactions')}</td>
                  <td>{block.transactionCount}</td>
                </tr>
              )}
              {block.transactionMerkleRoot && (
                <tr>
                  <td className="block-detail-label">{t('blockDetail.merkleRoot')}</td>
                  <td className="mono block-detail-hash">{block.transactionMerkleRoot}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="block-detail-actions">
            <a
              className="ghost-button"
              href={`https://www.koinscan.io/blocks/${block.height}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('blockDetail.viewOnKoinscan')} ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
