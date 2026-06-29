import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { translate } from '../../i18n'
import { FirstRunSetupModal } from './FirstRunSetupModal'

const rawPublicBootstrapFailure = '{"attempt":1,"backup_id":"","completed_batches":0,"event":"backup-progress","file_count":1,"phase":"public-restore-metadata-latest","total_batches":1,"total_bytes":0} Fatal: failed to fetch public backup URL https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap/latest.json: HTTP 404'
const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values)

function renderSetup(overrides: Partial<Parameters<typeof FirstRunSetupModal>[0]> = {}) {
  return renderToStaticMarkup(
    <FirstRunSetupModal
      t={t}
      network="mainnet"
      baseDir="/tmp/koinos-one"
      draftBaseDir="/tmp/koinos-one"
      settingsDirty={false}
      formError={null}
      nodeError={null}
      publicBootstrapUrl="https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap"
      publicBootstrapList={{ ok: false, source: 'public', snapshots: [] }}
      publicBootstrapListLoading={false}
      publicBootstrapRestoreLoading={false}
      nodeActionLoading={null}
      nodeRunning={false}
      syncStatusClass="is-live"
      syncStatusText="Syncing chain"
      syncStatusMeta="Head 10 / 100 - 10%"
      syncStatusProgressVisible={true}
      syncStatusPercent={10}
      selectNetwork={vi.fn()}
      chooseDataFolder={vi.fn(async () => true)}
      saveSettings={vi.fn(async () => true)}
      checkPublicBootstrap={vi.fn(async () => ({ ok: false, output: rawPublicBootstrapFailure }))}
      restorePublicBootstrap={vi.fn(async () => true)}
      startObserverNode={vi.fn(async () => true)}
      onQuitSetup={vi.fn()}
      onComplete={vi.fn()}
      {...overrides}
    />
  )
}

describe('FirstRunSetupModal', () => {
  it('renders the observer-only linear step questions', () => {
    expect(renderSetup({ initialStep: 'network' })).toContain('Which network should this observer follow?')
    expect(renderSetup({ initialStep: 'data' })).toContain('Use this folder for node data?')
    expect(renderSetup({ initialStep: 'bootstrap' })).toContain('Use the recommended public bootstrap if it is available?')
    expect(renderSetup({ initialStep: 'start' })).toContain('Start this node as an observer now?')
    expect(renderSetup({ initialStep: 'done', nodeRunning: true })).toContain('Observer is running. Continue to Koinos One?')
  })

  it('does not render producer, wallet, funding, burn, registration, or signing prompts', () => {
    const html = [
      renderSetup({ initialStep: 'network' }),
      renderSetup({ initialStep: 'data' }),
      renderSetup({ initialStep: 'bootstrap' }),
      renderSetup({ initialStep: 'start' }),
      renderSetup({ initialStep: 'done', nodeRunning: true })
    ].join('\n')

    expect(html).not.toMatch(/producer/i)
    expect(html).not.toMatch(/wallet password/i)
    expect(html).not.toMatch(/seed phrase/i)
    expect(html).not.toMatch(/\bVHP\b/i)
    expect(html).not.toMatch(/\bburn\b/i)
    expect(html).not.toMatch(/\bregister/i)
    expect(html).not.toMatch(/\bsigning\b/i)
  })

  it('shows public bootstrap 404s as plain observer guidance instead of raw errors', () => {
    const html = renderSetup({
      initialStep: 'bootstrap',
      nodeError: rawPublicBootstrapFailure
    })

    expect(html).toContain('No public bootstrap is available for this network right now.')
    expect(html).toContain('No public bootstrap available')
    expect(html).toContain('Next')
    expect(html).not.toContain('first-run-setup-error')
    expect(html).not.toContain('Fatal:')
    expect(html).not.toContain('backup-progress')
    expect(html).not.toContain('HTTP 404')
    expect(html).not.toContain('address setup')
  })

  it('uses a single next action when a public bootstrap is available', () => {
    const html = renderSetup({
      initialStep: 'bootstrap',
      publicBootstrapList: {
        ok: true,
        latestBackupId: '20260620T120000Z-public',
        source: 'public',
        snapshots: [{ backupId: '20260620T120000Z-public' }]
      }
    })

    expect(html).toContain('Public bootstrap available')
    expect(html).toContain('20260620T120000Z-public')
    expect(html).toContain('Next')
    expect(html).not.toContain('Sync without bootstrap')
    expect(html).not.toContain('Restore public bootstrap')
  })

  it('keeps progress display non-clickable', () => {
    const html = renderSetup({ initialStep: 'start' })

    expect(html).toContain('first-run-setup-step-pill')
    expect(html).not.toContain('first-run-setup-step\"><button')
  })

  it('requires observer start before completing setup', () => {
    const html = renderSetup({
      initialStep: 'done',
      nodeRunning: false
    })

    expect(html).toContain('Finish')
    expect(html).toContain('Observer first')
    expect(html).toContain('disabled=""')
  })

  it('shows node synchronization status in the final wizard step after observer start', () => {
    const html = renderSetup({
      initialStep: 'done',
      nodeRunning: true
    })

    expect(html).toContain('Syncing chain')
    expect(html).toContain('Head 10 / 100')
    expect(html).toContain('footer-status-progress-fill')
  })
})
