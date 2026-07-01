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
      locale="en-US"
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
      nodeBackupProgress={null}
      selectNetwork={vi.fn()}
      chooseDataFolder={vi.fn(async () => true)}
      saveSettings={vi.fn(async () => true)}
      checkPublicBootstrap={vi.fn(async () => ({ ok: false, output: rawPublicBootstrapFailure }))}
      restorePublicBootstrap={vi.fn(async () => true)}
      cancelRestorePublicBackup={vi.fn(async () => undefined)}
      startObserverNode={vi.fn(async () => true)}
      onQuitSetup={vi.fn()}
      onComplete={vi.fn()}
      {...overrides}
    />
  )
}

describe('FirstRunSetupModal', () => {
  it('renders the observer-only linear step questions', () => {
    expect(renderSetup({ initialStep: 'welcome' })).toContain('Welcome to Koinos One')
    expect(renderSetup({ initialStep: 'data' })).toContain('Select a folder to use for data storage.')
    expect(renderSetup({ initialStep: 'restore' })).toContain('Restore the recommended public backup if it is available?')
    expect(renderSetup({ initialStep: 'start' })).toContain('Start this node as an observer now?')
    expect(renderSetup({ initialStep: 'done', nodeRunning: true })).toContain('Observer is running. Continue to Koinos One?')
  })

  it('does not expose testnet selection in first-run setup', () => {
    const html = renderSetup({ initialStep: 'welcome' })

    expect(html).not.toContain('Which network should this observer follow?')
    expect(html).not.toContain('Testnet')
  })

  it('shows disk capacity guidance on the data folder step', () => {
    const html = renderSetup({ initialStep: 'data' })

    expect(html).toContain('Mainnet needs at least 100 GB free')
    expect(html).toContain('200 GB or more')
    expect(html).toContain('external SSD')
  })

  it('does not render wallet, funding, burn, registration, or signing prompts', () => {
    const html = [
      renderSetup({ initialStep: 'welcome' }),
      renderSetup({ initialStep: 'data' }),
      renderSetup({ initialStep: 'restore' }),
      renderSetup({ initialStep: 'start' }),
      renderSetup({ initialStep: 'done', nodeRunning: true })
    ].join('\n')

    expect(html).not.toContain('Set Producer')
    expect(html).not.toMatch(/wallet password/i)
    expect(html).not.toMatch(/seed phrase/i)
    expect(html).not.toMatch(/\bVHP\b/i)
    expect(html).not.toMatch(/\bburn\b/i)
    expect(html).not.toMatch(/\bregister/i)
    expect(html).not.toMatch(/\bsigning\b/i)
  })

  it('shows public backup 404s as plain observer guidance instead of raw errors', () => {
    const html = renderSetup({
      initialStep: 'restore',
      nodeError: rawPublicBootstrapFailure
    })

    expect(html).toContain('No public backup is available for this network right now.')
    expect(html).toContain('No public backup available')
    expect(html).toContain('Next')
    expect(html).not.toContain('first-run-setup-error')
    expect(html).not.toContain('Fatal:')
    expect(html).not.toContain('backup-progress')
    expect(html).not.toContain('HTTP 404')
    expect(html).not.toContain('address setup')
  })

  it('uses a single restore action when a public backup is available', () => {
    const html = renderSetup({
      initialStep: 'restore',
      publicBootstrapList: {
        ok: true,
        latestBackupId: '20260620T120000Z-public',
        source: 'public',
        snapshots: [{ backupId: '20260620T120000Z-public' }]
      }
    })

    expect(html).toContain('Public backup available')
    expect(html).toContain('20260620T120000Z-public')
    expect(html).toContain('Restore Public Backup')
    expect(html).toContain('Public Backup URL')
    expect(html).toContain('https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap')
    expect(html).not.toContain('Sync without bootstrap')
    expect(html).not.toContain('Restore public bootstrap')
  })

  it('shows one data folder value instead of saved and selected paths', () => {
    const html = renderSetup({
      initialStep: 'data',
      baseDir: '/tmp/old-koinos-one',
      draftBaseDir: '/tmp/new-koinos-one'
    })

    expect(html).toContain('Data folder')
    expect(html).toContain('/tmp/new-koinos-one')
    expect(html).toContain('This folder will be saved when you continue.')
    expect(html).not.toContain('Saved data folder')
    expect(html).not.toContain('Selected folder')
  })

  it('shows Previous on restore before the restore starts', () => {
    const html = renderSetup({
      initialStep: 'restore',
      publicBootstrapList: {
        ok: true,
        latestBackupId: '20260620T120000Z-public',
        source: 'public',
        snapshots: [{ backupId: '20260620T120000Z-public' }]
      }
    })

    expect(html).toContain('Previous')
  })

  it('hides Previous and renders shared restore progress while restore runs', () => {
    const html = renderSetup({
      initialStep: 'restore',
      publicBootstrapRestoreLoading: true,
      publicBootstrapList: {
        ok: true,
        latestBackupId: '20260620T120000Z-public',
        source: 'public',
        snapshots: [{ backupId: '20260620T120000Z-public' }]
      },
      nodeBackupProgress: {
        action: 'restore-backup',
        phase: 'download',
        progress: 42,
        displayProgress: 42,
        message: 'Downloading public backup objects',
        updatedAt: Date.UTC(2026, 5, 15),
        completedBytes: 1024 * 1024,
        totalBytes: 2 * 1024 * 1024,
        bytesPerSecond: 512 * 1024,
        etaSeconds: 2,
        completedBatches: null,
        totalBatches: null,
        phaseProgress: null,
        progressRangeStart: 25,
        progressRangeEnd: 60,
        sampleIntervalMs: 1000
      }
    })

    expect(html).toContain('node-backup-progress')
    expect(html).toContain('Downloading public backup objects')
    expect(html).toContain('42%')
    expect(html).toContain('Stop restore')
    expect(html).not.toContain('Previous')
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
