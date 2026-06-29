import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RemoteNodesPanel } from './RemoteNodesPanel'

const translations: Record<string, string> = {
  'remote.panelAria': 'Remote node management',
  'remote.title': 'Remote Nodes',
  'remote.descriptionSimple': 'Plan observer-first remote installs and public bootstrap restores.',
  'remote.descriptionExpert': 'Plan remote observer operations, upgrades, diagnostics, rollback, and cleanup.',
  'remote.dryRunBadge': 'Dry-run by default',
  'remote.safetyObserverFirst': 'Observer-first',
  'remote.safetyNoProducer': 'Producer activation unavailable',
  'remote.safetyNoSecrets': 'No secret storage',
  'remote.inventoryTitle': 'Fleet inventory',
  'remote.inventoryDescription': 'Sanitized node records use host references and placeholders.',
  'remote.editorTitle': 'Node record',
  'remote.editorDescriptionSimple': 'Name the server and enter a local SSH alias.',
  'remote.editorDescription': 'Edit one local inventory record.',
  'remote.actionsTitleSimple': 'Observer actions',
  'remote.actionsTitleExpert': 'Command plans',
  'remote.actionsTitle': 'Command plans',
  'remote.actionsSimpleDescription': 'Simple mode shows only safe observer controls and keeps commands hidden.',
  'remote.actionsExpertDescription': 'Expert mode shows additional diagnostics and guarded host-mutation plans.',
  'remote.multiNodeReviewNote': 'Multi-node operations expand into per-node reviewed plans.',
  'remote.fieldId': 'Node ID',
  'remote.fieldLabel': 'Label',
  'remote.fieldNetwork': 'Network',
  'remote.fieldRole': 'Role',
  'remote.fieldHostRef': 'Host ref',
  'remote.fieldConnectionRef': 'Connection ref',
  'remote.fieldSshAlias': 'SSH alias',
  'remote.fieldBaseDir': 'BASEDIR',
  'remote.fieldSuggestedBaseDir': 'Suggested BASEDIR',
  'remote.fieldImage': 'Artifact image',
  'remote.fieldJsonRpcBind': 'JSON-RPC bind',
  'remote.fieldP2pPort': 'P2P port',
  'remote.fieldBackupAdminBind': 'Backup admin bind',
  'remote.fieldBootstrapUrl': 'Public bootstrap URL',
  'remote.network.testnet': 'Testnet',
  'remote.network.mainnet': 'Prodnet',
  'remote.network.custom': 'Custom',
  'remote.roleObserverOnly': 'Observer only',
  'remote.addNode': 'Add node',
  'remote.removeNode': 'Remove node',
  'remote.saveInventory': 'Save inventory',
  'remote.inventorySaved': 'Inventory saved locally.',
  'remote.inventorySaveFailed': 'Could not save local inventory.',
  'remote.inventorySaveBlocked': 'Fix inventory safety notices before saving.',
  'remote.persistenceUnavailable': 'Local Electron inventory persistence is unavailable in this runtime.',
  'remote.selectedNode': 'Selected node',
  'remote.selectedAction': 'Selected action',
  'remote.planState': 'Plan state',
  'remote.planReady': 'Reviewable plan ready ({steps} steps)',
  'remote.planBlocked': 'Blocked by safety gates ({steps} steps)',
  'remote.inventoryValid': 'Inventory safety checks passed for this plan.',
  'remote.stepReadOnly': 'read-only',
  'remote.stepHostMutation': 'host mutation',
  'remote.stepDestructive': 'destructive',
  'remote.action.install-observer': 'Install Observer Plan',
  'remote.action.restore-public-bootstrap': 'Restore Bootstrap Plan',
  'remote.action.start-observer': 'Start Observer Plan',
  'remote.action.status': 'Health Check Plan',
  'remote.action.logs': 'Collect Logs Plan',
  'remote.action.stop': 'Stop Node Plan',
  'remote.action.restart': 'Restart Node Plan',
  'remote.action.upgrade': 'Upgrade Plan',
  'remote.action.rollback': 'Rollback Plan',
  'remote.action.cleanup': 'Cleanup Plan',
  'remote.simpleAction.install-observer': 'Restore backup and start observer',
  'remote.simpleAction.status': 'Check health',
  'remote.simpleAction.logs': 'Show logs',
  'remote.simpleAction.stop': 'Stop observer',
  'remote.simpleAction.restart': 'Restart observer',
  'remote.health.unknown': 'Unknown',
  'remote.health.needs-server': 'Needs server',
  'remote.health.needs-space': 'Needs space',
  'remote.health.installing': 'Installing',
  'remote.health.restoring': 'Restoring',
  'remote.health.starting': 'Starting',
  'remote.health.syncing': 'Syncing',
  'remote.health.healthy': 'Healthy',
  'remote.health.degraded': 'Degraded',
  'remote.health.unsafe': 'Unsafe',
  'remote.health.stopped': 'Stopped',
  'remote.health.failed': 'Failed',
  'remote.phase.preflight': 'Host preflight',
  'remote.phase.artifact': 'Artifact check',
  'remote.phase.prepare': 'Prepare BASEDIR',
  'remote.phase.config': 'Observer config',
  'remote.phase.bootstrap': 'Public bootstrap',
  'remote.phase.runtime': 'Runtime control',
  'remote.phase.verify': 'Observer verification',
  'remote.phase.diagnostics': 'Diagnostics',
  'remote.phase.rollback': 'Rollback',
  'remote.phase.cleanup': 'Cleanup',
  'remote.phaseHelp.preflight': 'Checks server, disk, ports, runtime, and safety blockers before changing anything.',
  'remote.phaseHelp.artifact': 'Fetches or verifies the reviewed artifact and records image identity evidence.',
  'remote.phaseHelp.prepare': 'Creates only the selected observer BASEDIR and support folders.',
  'remote.phaseHelp.config': 'Writes observer-only config with loopback RPC, P2P peers, and producer disabled.',
  'remote.phaseHelp.bootstrap': 'Lists and restores the public bootstrap while preserving state on failure.',
  'remote.phaseHelp.runtime': 'Starts, stops, or restarts only the selected observer runtime.',
  'remote.phaseHelp.verify': 'Checks observer status, config, health signals, and stop criteria.',
  'remote.phaseHelp.diagnostics': 'Collects sanitized read-only diagnostics and logs.',
  'remote.phaseHelp.rollback': 'Review-only rollback planning; execution is future-gated.',
  'remote.phaseHelp.cleanup': 'Review-only cleanup planning; destructive cleanup is unavailable.',
  'remote.notice.dryRunOnly': 'Dry-run preview: commands are generated for review before any confirmed testnet execution.',
  'remote.notice.dryRunOnlySimple': 'Koinos One will ask for review before any confirmed testnet action.',
  'remote.notice.prodnetConfirmationRequired': 'Prodnet observer actions require explicit per-node confirmation before any future execution.',
  'remote.notice.rawHostRefBlocked': 'Use a sanitized host reference, not a raw SSH target, for {field}.',
  'remote.notice.jsonrpcPublicBlocked': 'JSON-RPC must bind to loopback for {field} {value}.',
  'remote.executionTitle': 'Confirmed execution',
  'remote.executionDescriptionTestnet': 'Execution is available only for this selected testnet observer after exact confirmation.',
  'remote.executionDescriptionProdnet': 'Prodnet execution is limited to read-only health and logs plans; mutating plans stay blocked.',
  'remote.confirmationPhrase': 'Required phrase',
  'remote.confirmationInput': 'Type the phrase',
  'remote.executeConfirmedPlan': 'Execute confirmed plan',
  'remote.executing': 'Executing...',
  'remote.executionGate.confirmation-required': 'Exact confirmation is required before execution.',
  'remote.executionGate.plan-blocked': 'The plan is blocked by inventory safety gates.',
  'remote.executionGate.node-not-found': 'The selected node could not be found.',
  'remote.executionGate.prodnet-execution-blocked': 'Prodnet execution is blocked except for read-only health and logs plans.',
  'remote.executionGate.producer-unavailable': 'Producer mode is unavailable and must remain disabled.',
  'remote.executionGate.unsafe-command': 'The command plan contains an unsafe command or exposure pattern.',
  'remote.executionGate.unresolved-placeholder': 'Fill in the remaining placeholder values before execution.',
  'remote.executionGate.cleanup-unavailable': 'Remote cleanup execution is unavailable.',
  'remote.executionGate.rollback-unavailable': 'Remote rollback execution is unavailable in this MVP.',
  'remote.simpleSummaryTitle': 'Safe observer setup',
  'remote.progressTitle': 'Operation phases',
  'remote.progressDescription': 'Koinos One runs these phases in order and writes one sanitized receipt at the end.',
  'remote.providerChecklistTitle': 'Server checklist',
  'remote.providerChecklistDescription': 'Use any Linux VPS or LAN server with a local SSH alias. Provider API tokens are not required.',
  'remote.providerChecklist.resources': 'Choose a Linux server with enough disk, CPU, RAM, and outbound HTTPS access.',
  'remote.providerChecklist.sshAlias': 'Create a local SSH alias and enter only that alias here.',
  'remote.providerChecklist.firewall': 'Keep JSON-RPC and admin APIs private; expose P2P only when intended.',
  'remote.providerChecklist.baseDir': 'Use the suggested BASEDIR unless you have a separate disk layout.',
  'remote.providerChecklist.noToken': 'Do not paste provider tokens, passwords, private keys, or raw server addresses.',
  'remote.receiptsTitle': 'Execution receipts',
  'remote.receiptsDescription': 'Receipts are local-only and sanitized before display.',
  'remote.receiptsEmpty': 'No remote execution receipts yet.',
  'remote.receipt.succeeded': 'succeeded',
  'remote.receipt.failed': 'failed',
  'remote.receipt.blocked': 'blocked',
  'remote.receipt.planned': 'planned',
  'remote.receipt.confirmed': 'confirmed',
  'remote.receipt.running': 'running'
}

function t(key: string, values: Record<string, string | number> = {}): string {
  const template = translations[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`))
}

describe('RemoteNodesPanel', () => {
  it('renders prodnet simple mode as a read-only workflow without command output', () => {
    const html = renderToStaticMarkup(<RemoteNodesPanel t={t} advancedMode={false} />)

    expect(html).toContain('Remote Nodes')
    expect(html).toContain('Dry-run by default')
    expect(html).toContain('Observer actions')
    expect(html).toContain('Check health')
    expect(html).toContain('Show logs')
    expect(html).not.toContain('Restore backup and start observer')
    expect(html).not.toContain('Stop observer')
    expect(html).not.toContain('Restart observer')
    expect(html).toContain('Suggested BASEDIR')
    expect(html).toContain('Server checklist')
    expect(html).not.toContain('--backup-public-restore')
    expect(html).not.toContain('block_producer: false')
    expect(html).not.toContain('commands are generated')
    expect(html).not.toContain('Node ID')
    expect(html).not.toContain('Host ref')
    expect(html).not.toContain('Restore Bootstrap Plan')
    expect(html).not.toContain('Start Observer Plan')
    expect(html).not.toContain('Upgrade Plan')
    expect(html).not.toContain('Cleanup Plan')
  })

  it('renders testnet simple mode as a human observer workflow', () => {
    const html = renderToStaticMarkup(
      <RemoteNodesPanel
        t={t}
        advancedMode={false}
        inventory={{
          version: 1,
          nodes: [{
            id: 'testnet-simple-a',
            network: 'testnet',
            connectionRef: 'ssh-testnet-simple-a'
          }]
        }}
      />
    )

    expect(html).toContain('Restore backup and start observer')
    expect(html).toContain('Check health')
    expect(html).toContain('Show logs')
    expect(html).toContain('Stop observer')
    expect(html).toContain('Restart observer')
    expect(html).toContain('Operation phases')
    expect(html).toContain('Public bootstrap')
    expect(html).toContain('Observer verification')
    expect(html).not.toContain('--backup-public-restore')
  })

  it('renders expert actions while keeping plans dry-run only', () => {
    const html = renderToStaticMarkup(<RemoteNodesPanel t={t} advancedMode />)

    expect(html).toContain('Collect Logs Plan')
    expect(html).toContain('Stop Node Plan')
    expect(html).toContain('Rollback Plan')
    expect(html).toContain('Cleanup Plan')
    expect(html).toContain('Multi-node operations expand into per-node reviewed plans.')
    expect(html).toContain('--backup-public-restore')
    expect(html).toContain('block_producer: false')
    expect(html).toContain('Dry-run preview: commands are generated for review')
  })

  it('surfaces safety blockers for unsanitized inventory records', () => {
    const html = renderToStaticMarkup(
      <RemoteNodesPanel
        t={t}
        advancedMode
        inventory={{
          version: 1,
          nodes: [{
            id: 'unsafe-node',
            network: 'mainnet',
            hostRef: 'root@192.0.2.10',
            connectionRef: 'root@192.0.2.10',
            ports: {
              jsonrpcHostBind: '0.0.0.0:18080',
              p2pPublic: '18888',
              backupAdminListen: '127.0.0.1:18088'
            }
          }]
        }}
      />
    )

    expect(html).toContain('Blocked by safety gates')
    expect(html).toContain('Use a sanitized host reference')
    expect(html).toContain('JSON-RPC must bind to loopback')
  })
})
