import type {
  RemoteCommandPlan,
  RemoteFleetInventory,
  RemoteFleetRolloutPlan,
  RemoteFleetRolloutNodeStatus,
  RemoteFleetNode,
  RemoteNodeAction,
  RemoteNodeHealthState,
  RemotePlanPhase
} from './remote-nodes'

export type RemoteExecutionGateCode =
  | 'confirmation-required'
  | 'plan-blocked'
  | 'node-not-found'
  | 'prodnet-execution-blocked'
  | 'prodnet-artifact-trust-required'
  | 'prodnet-bootstrap-policy-required'
  | 'prodnet-dry-run-proof-required'
  | 'producer-unavailable'
  | 'unsafe-command'
  | 'unresolved-placeholder'

export type RemoteExecutionGateResult = {
  ok: boolean
  expectedConfirmation: string
  codes: RemoteExecutionGateCode[]
}

export type RemoteExecutionStopCriterion =
  | 'chain-id-mismatch'
  | 'producer-enabled'
  | 'public-jsonrpc-exposure'
  | 'public-admin-exposure'
  | 'disk-floor-violation'
  | 'restore-failure'
  | 'digest-mismatch'
  | 'state-merkle-mismatch'
  | 'rollback-evidence-missing'
  | 'cleanup-evidence-missing'
  | 'cleanup-state-unknown'
  | 'cleanup-protected-path'

export type RemoteHealthSnapshot = {
  state: RemoteNodeHealthState
  checkedAt: string
  summary: string
  stopCriteria: RemoteExecutionStopCriterion[]
}

export type RemoteExecutionStepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped'

export type RemoteExecutionStepSummary = {
  stepIndex: number
  stepCount: number
  phase: RemotePlanPhase | string
  status: RemoteExecutionStepStatus
  startedAt: string | null
  completedAt: string | null
  exitCode: number | null
  health: RemoteHealthSnapshot | null
  outputExcerpt: string
}

export type RemoteExecutionProgressEvent = RemoteExecutionStepSummary & {
  event: 'remote-execution-progress'
  planId: string
  nodeId: string
  network: string
  action: RemoteNodeAction | string
}

export type RemoteExecutionReceipt = {
  id: string
  planId?: string
  nodeId: string
  network: string
  action: RemoteNodeAction
  status: 'planned' | 'confirmed' | 'running' | 'succeeded' | 'failed' | 'blocked'
  startedAt: string
  completedAt: string
  planStepCount: number
  health: RemoteHealthSnapshot
  steps?: RemoteExecutionStepSummary[]
  output: string
}

export type RemoteFleetRolloutGateCode =
  | RemoteExecutionGateCode
  | 'fleet-confirmation-required'
  | 'fleet-empty'
  | 'fleet-single-node'
  | 'prodnet-batch-mutation-blocked'

export type RemoteFleetRolloutGateResult = {
  ok: boolean
  expectedConfirmation: string
  requiredPhrases: string[]
  codes: RemoteFleetRolloutGateCode[]
}

export type RemoteFleetRolloutNodeReceiptSummary = {
  nodeId: string
  label: string
  network: string
  status: RemoteFleetRolloutNodeStatus
  receiptId: string | null
  healthState: RemoteNodeHealthState | string
  summary: string
}

export type RemoteFleetRolloutReceipt = {
  id: string
  kind: 'fleet-rollout'
  rolloutId: string
  action: RemoteNodeAction
  status: 'succeeded' | 'failed' | 'blocked' | 'paused'
  startedAt: string
  completedAt: string
  selectedNodeIds: string[]
  nodeAliases: string[]
  nodeResults: RemoteFleetRolloutNodeReceiptSummary[]
  stopReason: string
  output: string
}

const EXECUTION_CONFIRMATION_PREFIX = 'EXECUTE'

function isReadOnlyRemoteAction(action: RemoteNodeAction): boolean {
  return action === 'status' || action === 'logs' || action === 'prodnet-observer-proof'
}

function isDbPreservingDestructiveAction(action: RemoteNodeAction): boolean {
  return action === 'rollback' || action === 'cleanup'
}

function isProdnetObserverMutation(node: RemoteFleetNode, action: RemoteNodeAction): boolean {
  return node.network === 'mainnet' && (
    action === 'install-observer' ||
    action === 'restore-public-bootstrap' ||
    action === 'start-observer'
  )
}

function hasPinnedArtifactDigest(node: RemoteFleetNode): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(node.trust.artifactDigest) && node.runtime.image.includes(`@${node.trust.artifactDigest}`)
}

function hasProdnetBootstrapPolicy(node: RemoteFleetNode): boolean {
  return (
    node.trust.bootstrapPolicyId === 'prodnet-public-bootstrap-v1' &&
    node.backup.publicBootstrapUrl.includes('/backups/prodnet/teleno-bootstrap')
  )
}

function hasProdnetDryRunProof(node: RemoteFleetNode): boolean {
  return /^(remote|proof)-[A-Za-z0-9_-]+$/.test(node.trust.prodnetObserverProofRef)
}

function planStepsAreReadOnly(plan: RemoteCommandPlan): boolean {
  return plan.steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)
}

export function remoteExecutionConfirmationPhrase(node: RemoteFleetNode, action: RemoteNodeAction): string {
  const base = `${EXECUTION_CONFIRMATION_PREFIX} ${node.id} ${node.network} ${action}`
  if (isProdnetObserverMutation(node, action)) {
    return `${base} PROOF ${node.trust.prodnetObserverProofRef} ARTIFACT ${node.trust.artifactDigest} POLICY ${node.trust.bootstrapPolicyId} OBSERVER_ONLY`
  }
  if (node.network === 'mainnet' && action === 'prodnet-observer-proof') return `${base} OBSERVER_ONLY`
  return isDbPreservingDestructiveAction(action) ? `${base} PRESERVE_DB` : base
}

export function remoteFleetRolloutConfirmationPhrase(rollout: RemoteFleetRolloutPlan): string {
  const base = `${EXECUTION_CONFIRMATION_PREFIX} FLEET ${rollout.action} ${rollout.entries.length} NODES SEQUENTIAL`
  return isDbPreservingDestructiveAction(rollout.action) ? `${base} PRESERVE_DB` : base
}

function destructivePlanHasDbPreservationEvidence(plan: RemoteCommandPlan): boolean {
  const commandText = plan.steps.map((step) => step.command).join('\n')
  if (!commandText.includes('TELENO_DB_PRESERVED')) return false
  if (plan.action === 'rollback' && !commandText.includes('TELENO_ROLLBACK_EVIDENCE')) return false
  if (plan.action === 'cleanup' && !commandText.includes('TELENO_CLEANUP_CANDIDATE')) return false
  if (
    plan.action === 'cleanup' &&
    commandText.split('\n').some((line) => /\brm\s+-rf\b/i.test(line) && /(chain|blockchain|state|wallet|producer|config\.yml)/i.test(line))
  ) return false
  return true
}

function prodnetObserverPlanHasTrustEvidence(node: RemoteFleetNode, plan: RemoteCommandPlan): boolean {
  const commandText = plan.steps.map((step) => step.command).join('\n')
  return (
    hasPinnedArtifactDigest(node) &&
    hasProdnetBootstrapPolicy(node) &&
    hasProdnetDryRunProof(node) &&
    commandText.includes(`TELENO_PRODNET_PROOF_RECEIPT ${node.trust.prodnetObserverProofRef}`) &&
    commandText.includes(`TELENO_ARTIFACT_DIGEST_PINNED ${node.trust.artifactDigest}`) &&
    commandText.includes(`TELENO_BOOTSTRAP_POLICY ${node.trust.bootstrapPolicyId}`) &&
    commandText.includes('TELENO_PRODNET_OBSERVER_ONLY')
  )
}

function commandLooksUnsafe(command: string): boolean {
  const actionableLines = command
    .split('\n')
    .filter((line) => !/\b(grep|egrep|sed)\b|TELENO_STOP_CRITERIA/i.test(line))
    .filter((line) => !/^\s*listen:\s+0\.0\.0\.0:\d+\s*$/i.test(line))
    .join('\n')
  return (
    /<[^>\n]+>/.test(actionableLines) ||
    /\bblock_producer\s*:\s*true\b/i.test(actionableLines) ||
    /(?:^|\s)-p\s+0\.0\.0\.0:\d+:\d+\b/.test(actionableLines) ||
    /\b0\.0\.0\.0\s*:\s*(8080|18080|18088)\b/.test(actionableLines) ||
    /\bbackup\.admin\..*0\.0\.0\.0\b/i.test(actionableLines) ||
    /\b(private[-_ ]?key|seed phrase|wallet\.json|producer[-_ ]?key)\b/i.test(actionableLines)
  )
}

export function validateRemoteExecutionGate(
  inventory: RemoteFleetInventory,
  plan: RemoteCommandPlan | null,
  confirmation: string
): RemoteExecutionGateResult {
  const node = plan ? inventory.nodes.find((candidate) => candidate.id === plan.nodeId) || null : null
  const expectedConfirmation = node && plan ? remoteExecutionConfirmationPhrase(node, plan.action) : ''
  const codes: RemoteExecutionGateCode[] = []

  if (!node || !plan) {
    codes.push('node-not-found')
  } else {
    if (plan.blocked) codes.push('plan-blocked')
    if (isProdnetObserverMutation(node, plan.action)) {
      if (!hasPinnedArtifactDigest(node)) codes.push('prodnet-artifact-trust-required')
      if (!hasProdnetBootstrapPolicy(node)) codes.push('prodnet-bootstrap-policy-required')
      if (!hasProdnetDryRunProof(node)) codes.push('prodnet-dry-run-proof-required')
      if (!prodnetObserverPlanHasTrustEvidence(node, plan)) codes.push('prodnet-execution-blocked')
    } else if (node.network !== 'testnet' && (!isReadOnlyRemoteAction(plan.action) || !planStepsAreReadOnly(plan))) {
      codes.push('prodnet-execution-blocked')
    }
    if (node.producer.enabled || node.role === 'producer') codes.push('producer-unavailable')
    if (confirmation.trim() !== expectedConfirmation) codes.push('confirmation-required')
    if (plan.steps.some((step) => /<[^>\n]+>/.test(step.command))) {
      codes.push('unresolved-placeholder')
    }
    if (
      plan.steps.some((step) => step.chainMutation || commandLooksUnsafe(step.command)) ||
      (isDbPreservingDestructiveAction(plan.action) && !destructivePlanHasDbPreservationEvidence(plan))
    ) {
      codes.push('unsafe-command')
    }
  }

  return {
    ok: codes.length === 0,
    expectedConfirmation,
    codes
  }
}

export function validateRemoteFleetRolloutGate(
  inventory: RemoteFleetInventory,
  rollout: RemoteFleetRolloutPlan | null,
  confirmation: string
): RemoteFleetRolloutGateResult {
  const expectedConfirmation = rollout ? remoteFleetRolloutConfirmationPhrase(rollout) : ''
  const requiredPhrases = rollout
    ? [
        expectedConfirmation,
        ...rollout.entries.map((entry) => entry.confirmationPhrase)
      ]
    : []
  const codes: RemoteFleetRolloutGateCode[] = []
  const confirmationText = confirmation.trim()

  if (!rollout || rollout.entries.length === 0) {
    codes.push('fleet-empty')
  } else {
    if (rollout.entries.length < 2) codes.push('fleet-single-node')
    if (rollout.entries.some((entry) => {
      const node = inventory.nodes.find((candidate) => candidate.id === entry.nodeId)
      return node ? isProdnetObserverMutation(node, rollout.action) : false
    })) codes.push('prodnet-batch-mutation-blocked')
    if (rollout.blocked) codes.push('plan-blocked')
    if (requiredPhrases.some((phrase) => !confirmationText.includes(phrase))) {
      codes.push('fleet-confirmation-required')
    }

    for (const entry of rollout.entries) {
      const node = inventory.nodes.find((candidate) => candidate.id === entry.nodeId)
      const gate = validateRemoteExecutionGate(inventory, entry.plan, entry.confirmationPhrase)
      if (!node) codes.push('node-not-found')
      codes.push(...gate.codes.filter((code) => code !== 'confirmation-required'))
    }
  }

  return {
    ok: codes.length === 0,
    expectedConfirmation,
    requiredPhrases,
    codes: [...new Set(codes)]
  }
}

export function redactRemoteOutput(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, '<redacted-private-key>')
    .replace(/\b(token[-_ ]?file|password[-_ ]?file|secret[-_ ]?file|private[-_ ]?key[-_ ]?file)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(password|passwd|passphrase|token|secret|seed|wif)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(private[-_ ]?key)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(hostname|host|server)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(could not resolve hostname)\s+[^\s:]+/gi, '$1 <host-redacted>')
    .replace(/\b(Linux|Darwin)\s+[A-Za-z0-9_.-]+\s+/g, '$1 <host-redacted> ')
    .replace(/\b([A-Za-z0-9._%+-]+)@((?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<ssh-target-redacted>')
    .replace(/(^|[\s"'=(])(?:~|\$HOME)\/[^\s"',;)]+/g, '$1<remote-path-redacted>')
    .replace(/(^|[\s"'=(])\/home\/[A-Za-z0-9_.-]+\/[^\s"',;)]+/g, '$1<remote-path-redacted>')
    .replace(/(^|[\s"'=(])\/Users\/[A-Za-z0-9_.-]+\/[^\s"',;)]+/g, '$1<local-path-redacted>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip-redacted>')
    .replace(/\b(?=(?:[a-f0-9]*:){3,}[a-f0-9:]*\b|[a-f0-9:]*::[a-f0-9:]*\b)(?:[a-f0-9]{1,4}:){1,7}:?(?:[a-f0-9]{1,4})?\b/gi, '<ip-redacted>')
    .replace(/(<ip-redacted>|localhost|\[::1\]|::1):\d{2,5}\b/g, '$1:<port-redacted>')
    .replace(/\b(port|p2p|json[-_ ]?rpc|admin[-_ ]?listen|listen)(\s*[:=]\s*)\d{2,5}\b/gi, '$1$2<port-redacted>')
    .replace(/\bport\s+\d{2,5}\b/gi, 'port <port-redacted>')
    .replace(/\/tcp\/\d{2,5}\b/g, '/tcp/<port-redacted>')
}

function stopCriteriaFromOutput(output: string): RemoteExecutionStopCriterion[] {
  const criteria: RemoteExecutionStopCriterion[] = []
  const lower = output.toLowerCase()
  if (/chain[_ -]?id mismatch/.test(lower)) criteria.push('chain-id-mismatch')
  if (/block_producer\s*:\s*true|producer enabled|producer unexpectedly enabled/.test(lower)) criteria.push('producer-enabled')
  if (/public json[-_ ]?rpc.*exposure|json[-_ ]?rpc.*public exposure|teleno_stop_criteria: public json-rpc/i.test(lower)) criteria.push('public-jsonrpc-exposure')
  if (/public admin.*exposure|backup admin.*public exposure|teleno_stop_criteria: public json-rpc\/admin/i.test(lower)) criteria.push('public-admin-exposure')
  if (/disk floor violation|not enough disk|no space left/.test(lower)) criteria.push('disk-floor-violation')
  if (/restore failed|public bootstrap restore failed/.test(lower)) criteria.push('restore-failure')
  if (/digest mismatch|sha256 mismatch|hash mismatch/.test(lower)) criteria.push('digest-mismatch')
  if (/state merkle mismatch|previous state merkle mismatch/.test(lower)) criteria.push('state-merkle-mismatch')
  if (/rollback evidence missing|rollback evidence invalid/.test(lower)) criteria.push('rollback-evidence-missing')
  if (/cleanup receipt evidence missing/.test(lower)) criteria.push('cleanup-evidence-missing')
  if (/cleanup state unknown/.test(lower)) criteria.push('cleanup-state-unknown')
  if (/cleanup attempted protected path/.test(lower)) criteria.push('cleanup-protected-path')
  return [...new Set(criteria)]
}

export function parseRemoteHealthOutput(output: string, checkedAt = new Date().toISOString()): RemoteHealthSnapshot {
  const redacted = redactRemoteOutput(output)
  const lower = redacted.toLowerCase()
  const failureProbe = lower
    .replace(/failed to connect to peer[^\n]*/g, '')
    .replace(/error=bad address/g, '')
    .replace(/connection reset by peer/g, '')
  const stopCriteria = stopCriteriaFromOutput(redacted)
  const noSeedPeers = /teleno_health_signal no-seed-peers|started with 0 seed peers|p2p.*0 seed peer/i.test(redacted)
  const noPeers = /teleno_health_signal no-peers|peer_count=0/i.test(redacted)
  const noHeadProgress = /teleno_health_signal no-head-progress/i.test(redacted)
  const headProgress = /teleno_health_signal head-progress|head advances|head progress/i.test(redacted)
  let state: RemoteNodeHealthState = 'unknown'

  if (stopCriteria.includes('disk-floor-violation')) {
    state = 'needs-space'
  } else if (stopCriteria.length > 0) {
    state = stopCriteria.some((criterion) =>
      criterion === 'producer-enabled' ||
      criterion === 'public-jsonrpc-exposure' ||
      criterion === 'public-admin-exposure'
    ) ? 'unsafe' : 'failed'
  } else if (/could not resolve hostname|permission denied|connection refused|no route to host|ssh:/i.test(lower)) {
    state = 'needs-server'
  } else if (/not enough disk|no space left|disk floor/i.test(lower)) {
    state = 'needs-space'
  } else if (/installing|docker pull|artifact/i.test(lower)) {
    state = 'installing'
  } else if (/restoring|backup-public-restore|public bootstrap restore/i.test(lower)) {
    state = 'restoring'
  } else if (/starting|docker start|systemctl start/i.test(lower)) {
    state = 'starting'
  } else if (headProgress || /syncing|head progress|head advances/i.test(lower)) {
    state = 'syncing'
  } else if (/no such container|inactive|stopped|not running/.test(lower)) {
    state = 'stopped'
  } else if (noSeedPeers || noPeers || noHeadProgress) {
    state = 'degraded'
  } else if (/failed|error|panic|segmentation fault/.test(failureProbe)) {
    state = 'failed'
  } else if (/teleno_prodnet_proof_ready|teleno_node ready|healthy|running|up /.test(lower)) {
    state = /block_producer\s*:\s*false|observer/.test(lower) ? 'healthy' : 'degraded'
  } else if (redacted.trim()) {
    state = 'degraded'
  }

  const summary = stopCriteria.length > 0
    ? `Stop criteria detected: ${stopCriteria.join(', ')}`
    : noSeedPeers
      ? 'The observer is running without configured seed peers. Reconcile observer config and restart.'
      : noPeers
        ? 'The observer is running but has no connected peers yet. Check P2P reachability and seed peers.'
        : noHeadProgress
          ? 'The observer answered JSON-RPC but head did not advance in the sampled window.'
          : state === 'healthy'
            ? 'Observer health checks passed.'
            : state === 'needs-server'
              ? 'Server connection is not ready. Check the SSH alias and try again.'
              : state === 'needs-space'
                ? 'The server does not have enough safe free disk space for this restore.'
                : state === 'unknown'
                  ? 'No remote health signal has been collected.'
                  : `Remote health state is ${state}.`

  return {
    state,
    checkedAt,
    summary,
    stopCriteria
  }
}

export function createRemoteExecutionReceipt(input: {
  node: RemoteFleetNode
  action: RemoteNodeAction
  status: RemoteExecutionReceipt['status']
  startedAt?: string
  completedAt?: string
  planStepCount: number
  steps?: RemoteExecutionStepSummary[]
  output: string
}): RemoteExecutionReceipt {
  const completedAt = input.completedAt || new Date().toISOString()
  const startedAt = input.startedAt || completedAt
  const safeOutput = redactRemoteOutput(input.output)
  return {
    id: `remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    nodeId: input.node.id,
    network: input.node.network,
    action: input.action,
    status: input.status,
    startedAt,
    completedAt,
    planStepCount: input.planStepCount,
    health: parseRemoteHealthOutput(safeOutput, completedAt),
    steps: input.steps?.map((step) => ({
      ...step,
      outputExcerpt: redactRemoteOutput(step.outputExcerpt)
    })),
    output: safeOutput
  }
}

function rolloutNodeStatusFromReceipt(receipt: RemoteExecutionReceipt | null): RemoteFleetRolloutNodeStatus {
  if (!receipt) return 'skipped'
  return receipt.status === 'succeeded' ? 'complete' : 'failed'
}

export function createRemoteFleetRolloutReceipt(input: {
  rollout: RemoteFleetRolloutPlan
  status?: RemoteFleetRolloutReceipt['status']
  startedAt?: string
  completedAt?: string
  nodeReceipts: RemoteExecutionReceipt[]
  skippedNodeIds?: string[]
  stopReason?: string
  output?: string
}): RemoteFleetRolloutReceipt {
  const completedAt = input.completedAt || new Date().toISOString()
  const startedAt = input.startedAt || completedAt
  const skipped = new Set(input.skippedNodeIds || [])
  const receiptByNode = new Map(input.nodeReceipts.map((receipt) => [receipt.nodeId, receipt]))
  const nodeResults = input.rollout.entries.map((entry) => {
    const receipt = receiptByNode.get(entry.nodeId) || null
    const status = skipped.has(entry.nodeId) ? 'skipped' : rolloutNodeStatusFromReceipt(receipt)
    return {
      nodeId: entry.nodeId,
      label: entry.label,
      network: entry.network,
      status,
      receiptId: receipt?.id || null,
      healthState: receipt?.health.state || 'unknown',
      summary: redactRemoteOutput(receipt?.health.summary || (status === 'skipped' ? 'Skipped because rollout stopped before this node.' : 'No node receipt was produced.'))
    }
  })
  const stopReason = redactRemoteOutput(input.stopReason || '')
  const status = input.status || (
    stopReason || nodeResults.some((result) => result.status === 'failed') ? 'failed' : 'succeeded'
  )
  const output = redactRemoteOutput(input.output || [
    `Fleet rollout ${status}.`,
    `Action: ${input.rollout.action}.`,
    `Nodes: ${input.rollout.entries.length}.`,
    stopReason ? `Stop reason: ${stopReason}.` : ''
  ].filter(Boolean).join('\n'))

  return {
    id: `fleet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    kind: 'fleet-rollout',
    rolloutId: `rollout-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${input.rollout.action}`,
    action: input.rollout.action,
    status,
    startedAt,
    completedAt,
    selectedNodeIds: input.rollout.entries.map((entry) => entry.nodeId),
    nodeAliases: input.rollout.entries.map((entry) => entry.label),
    nodeResults,
    stopReason,
    output
  }
}
