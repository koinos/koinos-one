type DocumentationPanelProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  manualSitePath?: string
}

const defaultManualSitePath = 'manual-site/index.html'

export function DocumentationPanel({ t, manualSitePath = defaultManualSitePath }: DocumentationPanelProps) {
  return (
    <section id="panel-documentation" className="documentation-panel" aria-label={t('docs.panelAria')} role="tabpanel" aria-labelledby="tab-documentation">
      <iframe
        key={manualSitePath}
        className="documentation-frame"
        src={manualSitePath}
        title={t('docs.title')}
      />
    </section>
  )
}
