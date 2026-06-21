import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { FirstRunSetupModal } from './FirstRunSetupModal'

const rawPublicBootstrapFailure = '{"attempt":1,"backup_id":"","completed_batches":0,"event":"backup-progress","file_count":1,"phase":"public-restore-metadata-latest","total_batches":1,"total_bytes":0} Fatal: failed to fetch public backup URL https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap/latest.json: HTTP 404'

function renderSetup(overrides: Partial<Parameters<typeof FirstRunSetupModal>[0]> = {}) {
  return renderToStaticMarkup(
    <FirstRunSetupModal
      network="Mainnet"
      baseDir="/tmp/koinos-one"
      draftBaseDir="/tmp/koinos-one"
      settingsDirty={false}
      formError={null}
      nodeError={null}
      walletError={null}
      producerError={null}
      publicBootstrapUrl="https://seed.koinosfoundation.org/backups/prodnet/teleno-bootstrap"
      publicBootstrapDescription="Official read-only prodnet bootstrap snapshots for new mainnet nodes."
      publicBootstrapList={{ ok: false, source: 'public', snapshots: [] }}
      publicBootstrapListLoading={false}
      publicBootstrapRestoreLoading={false}
      nodeActionLoading={null}
      nodeProducerActionLoading={null}
      walletActionLoading={null}
      walletAddress=""
      walletCanSign={false}
      nodeRunning={false}
      producerAddress=""
      producerLocalPublicKey=""
      producerRegisteredPublicKey=""
      producerSetupComplete={false}
      producerRegisterDisabled
      producerRegisterHintText="Create or unlock a signing wallet before registering the producer key."
      producerRegisterActionText="Register producer key"
      syncStatusClass="is-live"
      syncStatusText="Syncing chain"
      syncStatusMeta="Head 10 / 100 · 10%"
      syncStatusProgressVisible={true}
      syncStatusPercent={10}
      chooseDataFolder={vi.fn(async () => true)}
      saveSettings={vi.fn(async () => true)}
      checkPublicBootstrap={vi.fn(async () => ({ ok: false, output: rawPublicBootstrapFailure }))}
      restorePublicBootstrap={vi.fn(async () => true)}
      generateWalletDraft={vi.fn(async () => ({ ok: true, address: '1Test' }))}
      createWalletAccount={vi.fn(async () => true)}
      useExistingProducerAddress={vi.fn(async () => true)}
      registerProducer={vi.fn(async () => {})}
      startObserverNode={vi.fn(async () => true)}
      onQuitSetup={vi.fn()}
      onComplete={vi.fn()}
      {...overrides}
    />
  )
}

describe('FirstRunSetupModal', () => {
  it('shows public bootstrap 404s as plain setup guidance instead of raw errors', () => {
    const html = renderSetup({
      initialStep: 'restore',
      nodeError: rawPublicBootstrapFailure
    })

    expect(html).toContain('No public bootstrap is available for this network right now.')
    expect(html).toContain('No public bootstrap is available right now')
    expect(html).toContain('Continue to address setup')
    expect(html).not.toContain('first-run-setup-error')
    expect(html).not.toContain('Fatal:')
    expect(html).not.toContain('backup-progress')
    expect(html).not.toContain('HTTP 404')
    expect(html).not.toContain('Check availability')
  })

  it('checks public bootstrap availability automatically before showing restore choices', () => {
    const html = renderSetup({
      initialStep: 'restore'
    })

    expect(html).toContain('Checking for a public bootstrap')
    expect(html).toContain('This happens automatically.')
    expect(html).not.toContain('Check availability')
  })

  it('asks whether to restore or sync directly when a public bootstrap is available', () => {
    const html = renderSetup({
      initialStep: 'restore',
      publicBootstrapList: {
        ok: true,
        latestBackupId: '20260620T120000Z-public',
        source: 'public',
        snapshots: [{ backupId: '20260620T120000Z-public' }]
      }
    })

    expect(html).toContain('Public bootstrap is available')
    expect(html).toContain('20260620T120000Z-public')
    expect(html).toContain('Restore public bootstrap')
    expect(html).toContain('Sync without bootstrap')
    expect(html).not.toContain('Check availability')
  })

  it('does not carry restore errors into the address step', () => {
    const html = renderSetup({
      initialStep: 'wallet',
      nodeError: rawPublicBootstrapFailure
    })

    expect(html).toContain('Wallet password')
    expect(html).toContain('Confirm password')
    expect(html).not.toContain('Fatal:')
    expect(html).not.toContain('No public bootstrap is available')
  })

  it('allows an existing producer address without presenting it as watch-only wallet import', () => {
    const html = renderSetup({
      initialStep: 'wallet'
    })

    expect(html).toContain('Use an existing producer address')
    expect(html).toContain('Enter any existing producer address.')
    expect(html).toContain('Use this address')
    expect(html).not.toContain('watch-only')
  })

  it('keeps first-run setup self-contained without main-app navigation actions', () => {
    const html = renderSetup({
      initialStep: 'producer',
      walletAddress: '1ProducerAddress',
      producerAddress: '1ProducerAddress',
      producerLocalPublicKey: 'KOIN8PublicKey',
      producerRegisteredPublicKey: ''
    })

    expect(html).toContain('Close app')
    expect(html).toContain('Continue to node start')
    expect(html).not.toContain('Set up later')
    expect(html).not.toContain('Open Settings')
    expect(html).not.toContain('Open Wallet')
    expect(html).not.toContain('Open Producer')
    expect(html).not.toContain('Open Node')
    expect(html).not.toContain('Open advanced backups')
  })

  it('does not present the generated wallet address as a configured producer before registration', () => {
    const html = renderSetup({
      initialStep: 'producer',
      walletAddress: '1NewWalletAddress',
      producerAddress: ''
    })

    expect(html).toContain('Not configured yet')
    expect(html).toContain('1NewWalletAddress')
  })

  it('requires the observer start step before completing setup', () => {
    const html = renderSetup({
      initialStep: 'start',
      nodeRunning: false
    })

    expect(html).toContain('Start node as observer')
    expect(html).toContain('Complete setup')
    expect(html).toContain('Setup is not complete yet.')
    expect(html).toContain('disabled=""')
  })

  it('shows node synchronization status inside the final wizard step after observer start', () => {
    const html = renderSetup({
      initialStep: 'start',
      nodeRunning: true
    })

    expect(html).toContain('Syncing chain')
    expect(html).toContain('Head 10 / 100')
    expect(html).toContain('footer-status-progress-fill')
  })
})
