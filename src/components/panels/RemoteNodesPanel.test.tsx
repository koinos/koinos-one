import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RemoteNodesPanel } from './RemoteNodesPanel'

const translations: Record<string, string> = {
  'remote.panelAria': 'Remote node management',
  'remote.title': 'Remote Nodes',
  'remote.descriptionSimple': 'Plan observer-first remote installs and public backup restores.',
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
  'remote.fieldBootstrapUrl': 'Public backup URL',
  'remote.fieldArtifactDigest': 'Artifact digest',
  'remote.fieldArtifactSignatureRef': 'Artifact signature ref',
  'remote.fieldBootstrapPolicyId': 'Public backup policy ID',
  'remote.fieldBootstrapPolicyDigest': 'Public backup policy digest',
  'remote.fieldProdnetProofRef': 'Prodnet proof receipt',
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
  'remote.action.prodnet-observer-proof': 'Prodnet Proof Plan',
  'remote.action.install-observer': 'Install Observer Plan',
  'remote.action.restore-public-bootstrap': 'Restore Public Backup Plan',
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
  'remote.phase.trust': 'Trust proof',
  'remote.phase.proof': 'Dry-run proof',
  'remote.phase.prepare': 'Prepare BASEDIR',
  'remote.phase.config': 'Observer config',
  'remote.phase.bootstrap': 'Public backup',
  'remote.phase.runtime': 'Runtime control',
  'remote.phase.verify': 'Observer verification',
  'remote.phase.diagnostics': 'Diagnostics',
  'remote.phase.preserve': 'Preserve DB',
  'remote.phase.receipt': 'Receipt',
  'remote.phase.rollback': 'Rollback',
  'remote.phase.cleanup': 'Cleanup',
  'remote.phaseHelp.preflight': 'Checks server, disk, ports, runtime, and safety blockers before changing anything.',
  'remote.phaseHelp.artifact': 'Fetches or verifies the reviewed artifact and records image identity evidence.',
  'remote.phaseHelp.trust': 'Verifies pinned artifact identity and reviewed public backup policy before prodnet mutation.',
  'remote.phaseHelp.proof': 'Records the dry-run proof receipt and observer-only review required before prodnet mutation.',
  'remote.phaseHelp.prepare': 'Creates only the selected observer BASEDIR and support folders.',
  'remote.phaseHelp.config': 'Writes observer-only config with loopback RPC, P2P peers, and producer disabled.',
  'remote.phaseHelp.bootstrap': 'Lists and restores the public backup while preserving state on failure.',
  'remote.phaseHelp.runtime': 'Starts, stops, or restarts only the selected observer runtime.',
  'remote.phaseHelp.verify': 'Checks observer status, config, health signals, and stop criteria.',
  'remote.phaseHelp.diagnostics': 'Collects sanitized read-only diagnostics and logs.',
  'remote.phaseHelp.preserve': 'Records DB preservation evidence before any runtime or cleanup mutation.',
  'remote.phaseHelp.receipt': 'Writes a sanitized receipt that confirms DB preservation and final status.',
  'remote.phaseHelp.rollback': 'Uses prior rollback evidence to restore the previous observer artifact and config without deleting DB state.',
  'remote.phaseHelp.cleanup': 'Lists and removes only non-state temporary files after receipt evidence and stop-criteria checks pass.',
  'remote.notice.dryRunOnly': 'Dry-run preview: commands are generated for review before any confirmed testnet execution.',
  'remote.notice.dryRunOnlySimple': 'Koinos One will ask for review before any confirmed testnet action.',
  'remote.notice.prodnetConfirmationRequired': 'Prodnet observer actions require explicit per-node confirmation before any future execution.',
  'remote.notice.prodnetArtifactTrustRequired': 'Prodnet observer execution requires an artifact image pinned to the matching sha256 digest for {field}.',
  'remote.notice.prodnetBootstrapPolicyRequired': 'Prodnet observer execution requires the reviewed prodnet public backup trust policy for {field}.',
  'remote.notice.prodnetDryRunProofRequired': 'Prodnet observer execution requires a successful dry-run proof receipt reference for {field}.',
  'remote.notice.prodnetBatchMutationBlocked': 'Prodnet observer mutation is one-node only and cannot run as a fleet rollout yet.',
  'remote.notice.rawHostRefBlocked': 'Use a sanitized host reference, not a raw SSH target, for {field}.',
  'remote.notice.jsonrpcPublicBlocked': 'JSON-RPC must bind to loopback for {field} {value}.',
  'remote.executionTitle': 'Confirmed execution',
  'remote.executionDescriptionTestnet': 'Execution is available only for this selected testnet observer after exact confirmation.',
  'remote.executionDescriptionProdnet': 'Prodnet execution is limited to read-only health and logs plans; mutating plans stay blocked.',
  'remote.destructiveTitle': 'Strong confirmation required',
  'remote.destructiveRollbackDescription': 'Rollback requires prior rollback evidence, preserves the existing DB, replaces only the observer runtime/config, and writes a sanitized receipt.',
  'remote.destructiveCleanupDescription': 'Cleanup requires prior receipt evidence, preserves chain/state DB paths, removes only non-state temporary files, and writes a sanitized receipt.',
  'remote.prodnetTrustTitle': 'Prodnet observer trust gates',
  'remote.prodnetTrustDescription': 'Prodnet mutation requires a pinned artifact digest, reviewed public backup policy, matching dry-run proof receipt, loopback RPC/admin, and observer-only confirmation.',
  'remote.prodnetTrustMissing': 'missing',
  'remote.confirmationPhrase': 'Required phrase',
  'remote.confirmationInput': 'Type the phrase',
  'remote.executeConfirmedPlan': 'Execute confirmed plan',
  'remote.executing': 'Executing...',
  'remote.executionGate.confirmation-required': 'Exact confirmation is required before execution.',
  'remote.executionGate.plan-blocked': 'The plan is blocked by inventory safety gates.',
  'remote.executionGate.node-not-found': 'The selected node could not be found.',
  'remote.executionGate.prodnet-execution-blocked': 'Prodnet execution is blocked except for read-only health and logs plans.',
  'remote.executionGate.prodnet-artifact-trust-required': 'Prodnet observer execution requires a pinned artifact digest matching the reviewed image.',
  'remote.executionGate.prodnet-bootstrap-policy-required': 'Prodnet observer execution requires the reviewed prodnet bootstrap trust policy.',
  'remote.executionGate.prodnet-dry-run-proof-required': 'Prodnet observer execution requires a successful dry-run proof receipt reference.',
  'remote.executionGate.producer-unavailable': 'Producer mode is unavailable and must remain disabled.',
  'remote.executionGate.unsafe-command': 'The command plan contains an unsafe command or exposure pattern.',
  'remote.executionGate.unresolved-placeholder': 'Fill in the remaining placeholder values before execution.',
  'remote.fleetTitle': 'Fleet rollout review',
  'remote.fleetDescription': 'Review one action across selected nodes. Koinos One executes exactly one node at a time and stops on the first unsafe result.',
  'remote.fleetNodeSelection': 'Select nodes for this rollout',
  'remote.fleetSelectedNodes': 'Selected nodes',
  'remote.fleetSelectedNodesValue': '{count} nodes',
  'remote.fleetExecutionMode': 'Execution mode',
  'remote.fleetSequentialOnly': 'Sequential only',
  'remote.fleetNodePlanSummary': '{steps} steps · {phases}',
  'remote.fleetNodeBlocked': 'This node is blocked by safety gates and cannot be part of a confirmed rollout.',
  'remote.fleetMoveUp': 'Up',
  'remote.fleetMoveDown': 'Down',
  'remote.fleetConfirmationPhrase': 'Fleet phrase',
  'remote.fleetPerNodeConfirmations': 'Per-node phrases',
  'remote.fleetConfirmationInput': 'Type the fleet phrase and every per-node phrase',
  'remote.fleetExecute': 'Execute sequential rollout',
  'remote.fleetExecuting': 'Executing rollout...',
  'remote.fleetCancel': 'Stop after current node',
  'remote.fleetCancelRequested': 'Stop requested',
  'remote.fleetCancelAfterCurrent': 'Koinos One will stop this rollout after the current node finishes.',
  'remote.fleetExecutionRunning': 'Running fleet rollout one node at a time.',
  'remote.fleetExecutionSucceeded': 'Fleet rollout completed.',
  'remote.fleetExecutionStopped': 'Fleet rollout stopped before all nodes completed.',
  'remote.fleetStoppedByUser': 'Rollout stopped by the operator after the current node.',
  'remote.fleetNodeMissing': 'Node {node} is no longer present in the local inventory.',
  'remote.fleetStoppedOnFailure': 'Rollout stopped because a node did not complete safely.',
  'remote.fleetGate.fleet-confirmation-required': 'Type the fleet phrase and every per-node phrase before execution.',
  'remote.fleetGate.fleet-empty': 'Select at least two nodes for a fleet rollout.',
  'remote.fleetGate.fleet-single-node': 'Fleet rollout requires at least two selected nodes. Use single-node execution for one node.',
  'remote.fleetGate.confirmation-required': 'Exact per-node confirmation is required before execution.',
  'remote.fleetGate.plan-blocked': 'At least one selected node plan is blocked by safety gates.',
  'remote.fleetGate.node-not-found': 'One selected node could not be found.',
  'remote.fleetGate.prodnet-execution-blocked': 'Prodnet execution is blocked except for read-only health and logs plans.',
  'remote.fleetGate.prodnet-artifact-trust-required': 'Prodnet observer execution requires a pinned artifact digest matching the reviewed image.',
  'remote.fleetGate.prodnet-bootstrap-policy-required': 'Prodnet observer execution requires the reviewed prodnet bootstrap trust policy.',
  'remote.fleetGate.prodnet-dry-run-proof-required': 'Prodnet observer execution requires a successful dry-run proof receipt reference.',
  'remote.fleetGate.prodnet-batch-mutation-blocked': 'Prodnet observer mutation is one-node only and cannot run as a fleet rollout yet.',
  'remote.fleetGate.producer-unavailable': 'Producer mode is unavailable and must remain disabled.',
  'remote.fleetGate.unsafe-command': 'At least one command plan contains an unsafe command or exposure pattern.',
  'remote.fleetGate.unresolved-placeholder': 'Fill in placeholder values before a fleet rollout.',
  'remote.fleetStatus.pending': 'pending',
  'remote.fleetStatus.reviewing': 'reviewing',
  'remote.fleetStatus.confirmed': 'confirmed',
  'remote.fleetStatus.running': 'running',
  'remote.fleetStatus.skipped': 'skipped',
  'remote.fleetStatus.failed': 'failed',
  'remote.fleetStatus.complete': 'complete',
  'remote.fleetReceiptTitle': 'Fleet {action} · {count} nodes',
  'remote.fleetReceipt.succeeded': 'succeeded',
  'remote.fleetReceipt.failed': 'failed',
  'remote.fleetReceipt.blocked': 'blocked',
  'remote.fleetReceipt.paused': 'paused',
  'remote.fleetReceiptNoStop': 'No rollout stop criteria were recorded.',
  'remote.simpleSummaryTitle': 'Safe observer setup',
  'remote.progressTitle': 'Operation phases',
  'remote.progressDescription': 'Koinos One streams each phase while the selected remote plan runs.',
  'remote.progressLiveDescription': 'Current step status: {status}.',
  'remote.progressHealth': 'Health: {health}',
  'remote.stepStatus.queued': 'queued',
  'remote.stepStatus.running': 'running',
  'remote.stepStatus.succeeded': 'succeeded',
  'remote.stepStatus.failed': 'failed',
  'remote.stepStatus.blocked': 'blocked',
  'remote.stepStatus.skipped': 'skipped',
  'remote.providerChecklistTitle': 'Server checklist',
  'remote.providerChecklistDescription': 'Use any Linux VPS or LAN server with a local SSH alias. Provider API tokens are not required.',
  'remote.providerChecklist.resources': 'Choose a Linux server with enough disk, CPU, RAM, and outbound HTTPS access.',
  'remote.providerChecklist.sshAlias': 'Create a local SSH alias and enter only that alias here.',
  'remote.providerChecklist.firewall': 'Keep JSON-RPC and admin APIs private; expose P2P only when intended.',
  'remote.providerChecklist.baseDir': 'Use the suggested BASEDIR unless you have a separate disk layout.',
  'remote.providerChecklist.noToken': 'Do not paste provider tokens, passwords, private keys, or raw server addresses.',
  'remote.providerImportTitle': 'Import server metadata',
  'remote.providerImportDescription': 'Paste sanitized read-only metadata from a VPS provider or CLI. Koinos One does not contact providers, create servers, or store provider credentials.',
  'remote.providerImportNetwork': 'Target network',
  'remote.providerImportInput': 'Sanitized provider metadata',
  'remote.providerImportPlaceholder': 'provider: example-vps\ninstance: server-a\nlabel: Testnet Observer A\nregion: eu-central\nos: Ubuntu 24 LTS\ncpu: 4 vCPU\nram: 16 GB\ndisk: 300 GB\nstate: running\npublicAddress: redacted\nprivateAddress: absent\nsshAlias: ssh-testnet-observer-a',
  'remote.providerImportReady': '{count} reviewed server records ready.',
  'remote.providerImportBlocked': 'Provider import is blocked until private values are removed.',
  'remote.providerImportAddReviewed': 'Add reviewed server',
  'remote.providerImportSaveReminder': 'Review imported records, then use Save inventory. Provider tokens and raw server addresses are never saved.',
  'remote.providerImportAdded': 'Added {count} reviewed server records to the local inventory. Save inventory when ready.',
  'remote.providerImportNodeSummary': '{network} · SSH alias {alias} · BASEDIR {basedir}',
  'remote.providerImportPreviewTitle': 'Redacted preview',
  'remote.providerImportPreviewEmpty': 'No preview available.',
  'remote.providerImportIssue.empty-input': 'Paste sanitized provider metadata before importing.',
  'remote.providerImportIssue.unsupported-format': 'Use sanitized JSON or key/value provider CLI output.',
  'remote.providerImportIssue.secret-blocked': 'Token-like or secret-looking values were found and redacted.',
  'remote.providerImportIssue.raw-address-blocked': 'Raw IP address values were found and redacted.',
  'remote.providerImportIssue.raw-host-blocked': 'Raw hostname values were found and redacted.',
  'remote.providerImportIssue.user-reference-blocked': 'Raw SSH user or login values were found and redacted.',
  'remote.providerImportIssue.private-path-blocked': 'Private local or remote paths were found and redacted.',
  'remote.providerImportIssue.duplicate-instance': 'This provider instance is already present or duplicated: {value}.',
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
    expect(html).toContain('Import server metadata')
    expect(html).toContain('Koinos One does not contact providers')
    expect(html).toContain('Add reviewed server')
    expect(html).not.toContain('--backup-public-restore')
    expect(html).not.toContain('block_producer: false')
    expect(html).not.toContain('commands are generated')
    expect(html).not.toContain('Redacted preview')
    expect(html).not.toContain('Node ID')
    expect(html).not.toContain('Host ref')
    expect(html).not.toContain('Restore Public Backup Plan')
    expect(html).not.toContain('Start Observer Plan')
    expect(html).not.toContain('Upgrade Plan')
    expect(html).not.toContain('Cleanup Plan')
    expect(html).not.toContain('Prodnet Proof Plan')
    expect(html).not.toContain('Prodnet observer trust gates')
    expect(html).not.toContain('Fleet rollout review')
    expect(html).not.toContain('Execute sequential rollout')
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
    expect(html).toContain('Public backup')
    expect(html).toContain('Observer verification')
    expect(html).not.toContain('--backup-public-restore')
  })

  it('renders expert actions while keeping plans dry-run only', () => {
    const html = renderToStaticMarkup(<RemoteNodesPanel t={t} advancedMode />)

    expect(html).toContain('Collect Logs Plan')
    expect(html).toContain('Prodnet Proof Plan')
    expect(html).toContain('Stop Node Plan')
    expect(html).toContain('Rollback Plan')
    expect(html).toContain('Cleanup Plan')
    expect(html).toContain('Multi-node operations expand into per-node reviewed plans.')
    expect(html).toContain('Fleet rollout review')
    expect(html).toContain('Sequential only')
    expect(html).toContain('Per-node phrases')
    expect(html).toContain('Execute sequential rollout')
    expect(html).toContain('Prodnet observer trust gates')
    expect(html).toContain('Artifact digest')
    expect(html).toContain('missing')
    expect(html).toContain('--backup-public-restore')
    expect(html).toContain('block_producer: false')
    expect(html).toContain('Dry-run preview: commands are generated for review')
  })

  it('renders an expert fleet review for multiple selected nodes without exposing it in simple mode', () => {
    const inventory = {
      version: 1 as const,
      nodes: [
        { id: 'testnet-a', label: 'Testnet A', network: 'testnet' as const, connectionRef: 'ssh-testnet-a' },
        { id: 'testnet-b', label: 'Testnet B', network: 'testnet' as const, connectionRef: 'ssh-testnet-b' }
      ]
    }
    const expertHtml = renderToStaticMarkup(<RemoteNodesPanel t={t} advancedMode inventory={inventory} />)
    const simpleHtml = renderToStaticMarkup(<RemoteNodesPanel t={t} advancedMode={false} inventory={inventory} />)

    expect(expertHtml).toContain('Fleet rollout review')
    expect(expertHtml).toContain('2 nodes')
    expect(expertHtml).toContain('Up')
    expect(expertHtml).toContain('Down')
    expect(expertHtml).toContain('EXECUTE FLEET install-observer 2 NODES SEQUENTIAL')
    expect(expertHtml).toContain('EXECUTE testnet-a testnet install-observer')
    expect(expertHtml).toContain('EXECUTE testnet-b testnet install-observer')
    expect(simpleHtml).not.toContain('Fleet rollout review')
    expect(simpleHtml).not.toContain('EXECUTE FLEET')
  })

  it('renders expert destructive actions without exposing them in simple mode', () => {
    const html = renderToStaticMarkup(
      <RemoteNodesPanel
        t={t}
        advancedMode
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

    expect(html).toContain('Rollback Plan')
    expect(html).toContain('Cleanup Plan')
    expect(html).not.toContain('Strong confirmation required')
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
