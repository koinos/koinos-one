type MicroservicesConfigPanelProps = {
  t: (key: string) => string
  hasNodeControls: boolean
  nodeSettings: any
}

export function MicroservicesConfigPanel({ t, hasNodeControls, nodeSettings }: MicroservicesConfigPanelProps) {
  if (!hasNodeControls) return null

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border-color, #333)', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>Microservices</h3>
      <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
        Native service configuration coming soon.
      </p>
    </div>
  )
}
