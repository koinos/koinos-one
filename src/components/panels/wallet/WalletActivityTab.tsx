type WalletActivityEntry = {
  id: string
  title: string
  output: string
  at: number
  ok: boolean
  accountId: string | null
  accountName: string | null
  accountAddress: string | null
}

type WalletActivityTabProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  entries: WalletActivityEntry[]
  locale: string
  advancedMode?: boolean
}

export function WalletActivityTab(props: WalletActivityTabProps) {
  const { t, entries, locale, advancedMode = false } = props

  if (!entries.length) {
    return (
      <div className="wallet-subpanel">
        <article className="wallet-card">
          <h3>{t('wallet.activityTitle')}</h3>
          <p>{t('wallet.activityEmptyDescription')}</p>
        </article>
      </div>
    )
  }

  return (
    <div className="wallet-subpanel">
      <article className="wallet-card">
        <h3>{t('wallet.activityTitle')}</h3>
        <p>{t('wallet.activityDescription')}</p>
        <div className="wallet-activity-list">
          {entries.map((entry) => (
            <article key={entry.id} className="wallet-activity-item">
              <div className="wallet-activity-main">
                <strong>{entry.title}</strong>
                <span className={`wallet-activity-badge ${entry.ok ? 'is-ok' : 'is-error'}`}>
                  {entry.ok ? t('wallet.activityOk') : t('wallet.activityFailed')}
                </span>
              </div>
              <p className="wallet-activity-meta">
                {new Intl.DateTimeFormat(locale, {
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                }).format(entry.at)}
                {entry.accountName ? ` · ${entry.accountName}` : ''}
                {entry.accountAddress ? ` · ${entry.accountAddress}` : ''}
              </p>
              {advancedMode && <p className="wallet-activity-output">{entry.output}</p>}
            </article>
          ))}
        </div>
      </article>
    </div>
  )
}
