import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

type RemoteExecutionAction =
  | 'install-observer'
  | 'restore-public-bootstrap'
  | 'start-observer'
  | 'status'
  | 'logs'
  | 'stop'
  | 'restart'
  | 'upgrade'
  | 'rollback'
  | 'cleanup'

type RemoteExecutionStep = {
  phase?: string
  command?: string
  hostMutation?: boolean
  chainMutation?: boolean
  destructive?: boolean
}

type RemoteExecutionNode = {
  id?: string
  network?: string
  role?: string
  connectionRef?: string
  producer?: {
    enabled?: boolean
  }
}

type RemoteExecutionPlan = {
  action?: RemoteExecutionAction
  nodeId?: string
  blocked?: boolean
  steps?: RemoteExecutionStep[]
}

export type RemoteExecutionRequest = {
  node?: RemoteExecutionNode
  plan?: RemoteExecutionPlan
  confirmation?: string
}

export type RemoteExecutionHealth = {
  state:
    | 'unknown'
    | 'needs-server'
    | 'needs-space'
    | 'installing'
    | 'restoring'
    | 'starting'
    | 'syncing'
    | 'healthy'
    | 'degraded'
    | 'unsafe'
    | 'stopped'
    | 'failed'
  checkedAt: string
  summary: string
  stopCriteria: string[]
}

export type RemoteExecutionStepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped'

export type RemoteExecutionStepSummary = {
  stepIndex: number
  stepCount: number
  phase: string
  status: RemoteExecutionStepStatus
  startedAt: string | null
  completedAt: string | null
  exitCode: number | null
  health: RemoteExecutionHealth | null
  outputExcerpt: string
}

export type RemoteExecutionProgressEvent = RemoteExecutionStepSummary & {
  event: 'remote-execution-progress'
  planId: string
  nodeId: string
  network: string
  action: string
}

export type RemoteExecutionReceipt = {
  id: string
  planId: string
  nodeId: string
  network: string
  action: string
  status: 'succeeded' | 'failed' | 'blocked'
  startedAt: string
  completedAt: string
  planStepCount: number
  health: RemoteExecutionHealth
  steps: RemoteExecutionStepSummary[]
  output: string
}

export type RemoteExecutionResult = {
  ok: boolean
  output: string
  receipt: RemoteExecutionReceipt
}

export type RemoteCommandOutputHandler = (chunk: string) => void
export type RemoteCommandRunner = (
  command: string,
  onOutput?: RemoteCommandOutputHandler
) => Promise<{ code: number; output: string }>
export type RemoteExecutionProgressHandler = (event: RemoteExecutionProgressEvent) => void

const MAX_OUTPUT_BYTES = 128 * 1024
const MAX_OUTPUT_EXCERPT_CHARS = 6000
const COMMAND_TIMEOUT_MS = 45 * 60 * 1000

export function remoteExecutionConfirmationPhrase(node: RemoteExecutionNode, action: string): string {
  const base = `EXECUTE ${node.id || ''} ${node.network || ''} ${action}`
  return action === 'rollback' || action === 'cleanup' ? `${base} PRESERVE_DB` : base
}

export function redactRemoteExecutionOutput(value: string): string {
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

function looksLikeRawSshTarget(value: string): boolean {
  return /@/.test(value) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value)
}

function isReadOnlyRemoteAction(action: string): boolean {
  return action === 'status' || action === 'logs'
}

function isDbPreservingDestructiveAction(action: string): boolean {
  return action === 'rollback' || action === 'cleanup'
}

function stepsAreReadOnly(steps: RemoteExecutionStep[]): boolean {
  return steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)
}

function destructivePlanHasDbPreservationEvidence(action: string, steps: RemoteExecutionStep[]): boolean {
  const commandText = steps.map((step) => `${step.command || ''}`).join('\n')
  if (!commandText.includes('TELENO_DB_PRESERVED')) return false
  if (action === 'rollback' && !commandText.includes('TELENO_ROLLBACK_EVIDENCE')) return false
  if (action === 'cleanup' && !commandText.includes('TELENO_CLEANUP_CANDIDATE')) return false
  if (
    action === 'cleanup' &&
    commandText.split('\n').some((line) => /\brm\s+-rf\b/i.test(line) && /(chain|blockchain|state|wallet|producer|config\.yml)/i.test(line))
  ) return false
  return true
}

function commandLooksUnsafe(command: string): boolean {
  const actionableLines = command
    .split('\n')
    .filter((line) => !/\b(grep|egrep|sed)\b|TELENO_STOP_CRITERIA/i.test(line))
    .filter((line) => !/^\s*listen:\s+0\.0\.0\.0:\d+\s*$/i.test(line))
    .join('\n')
  return (
    /<[^>\n]+>/.test(actionableLines) ||
    /\brm\s+-rf\s+\/\b/.test(actionableLines) ||
    /\b(mkfs|fdisk|dd\s+if=|shutdown|reboot)\b/i.test(actionableLines) ||
    /\bblock_producer\s*:\s*true\b/i.test(actionableLines) ||
    /(?:^|\s)-p\s+0\.0\.0\.0:\d+:\d+\b/.test(actionableLines) ||
    /\b0\.0\.0\.0\s*:\s*(8080|18080|18088)\b/.test(actionableLines) ||
    /\b(private[-_ ]?key|seed phrase|wallet\.json|producer[-_ ]?key)\b/i.test(actionableLines)
  )
}

function validateRemoteExecutionRequest(input?: RemoteExecutionRequest): string[] {
  const errors: string[] = []
  const node = input?.node
  const plan = input?.plan
  const action = plan?.action || ''
  const confirmation = `${input?.confirmation || ''}`.trim()
  const expectedConfirmation = node && action ? remoteExecutionConfirmationPhrase(node, action) : ''
  const connectionRef = `${node?.connectionRef || ''}`.trim()
  const steps = Array.isArray(plan?.steps) ? plan.steps : []

  if (!node?.id || !plan?.nodeId || node.id !== plan.nodeId) errors.push('Selected node and plan node do not match.')
  if (!action || plan?.action !== action) errors.push('Remote action is missing.')
  if (plan?.blocked) errors.push('The reviewed command plan is blocked by safety gates.')
  if (node?.network !== 'testnet' && (!isReadOnlyRemoteAction(action) || !stepsAreReadOnly(steps))) {
    errors.push('Confirmed prodnet/mainnet execution is available only for read-only status and logs plans.')
  }
  if (node?.role !== 'observer' || node?.producer?.enabled === true) errors.push('Remote execution requires an observer node with producer disabled.')
  if (isDbPreservingDestructiveAction(action) && !destructivePlanHasDbPreservationEvidence(action, steps)) {
    errors.push('Destructive rollback and cleanup plans must prove prior evidence and DB preservation before execution.')
  }
  if (!connectionRef || !/^[A-Za-z0-9_.-]+$/.test(connectionRef) || looksLikeRawSshTarget(connectionRef)) {
    errors.push('Connection reference must be a sanitized local SSH alias, not a raw target.')
  }
  if (!expectedConfirmation || confirmation !== expectedConfirmation) {
    errors.push(`Type "${expectedConfirmation}" to execute this one-node testnet plan.`)
  }
  if (steps.length === 0) errors.push('The command plan has no steps.')

  for (const step of steps) {
    const command = `${step.command || ''}`
    if (step.chainMutation) errors.push('Chain-mutating remote steps are not executable.')
    if (!command.startsWith(`ssh ${connectionRef} <<'TELENO_REMOTE'\n`)) {
      errors.push('Each executable step must be a generated SSH heredoc for the selected connection reference.')
    }
    if (/<[^>\n]+>/.test(command)) errors.push('The command plan contains unresolved placeholder values.')
    if (commandLooksUnsafe(command)) errors.push('The command plan contains an unsafe command or exposure pattern.')
  }

  return [...new Set(errors)]
}

function stopCriteriaFromOutput(output: string): string[] {
  const criteria: string[] = []
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

function parseRemoteExecutionHealth(output: string, checkedAt = new Date().toISOString()): RemoteExecutionHealth {
  const sanitized = redactRemoteExecutionOutput(output)
  const lower = sanitized.toLowerCase()
  const failureProbe = lower
    .replace(/failed to connect to peer[^\n]*/g, '')
    .replace(/error=bad address/g, '')
    .replace(/connection reset by peer/g, '')
  const stopCriteria = stopCriteriaFromOutput(sanitized)
  const noSeedPeers = /teleno_health_signal no-seed-peers|started with 0 seed peers|p2p.*0 seed peer/i.test(sanitized)
  const noPeers = /teleno_health_signal no-peers|peer_count=0/i.test(sanitized)
  const noHeadProgress = /teleno_health_signal no-head-progress/i.test(sanitized)
  const headProgress = /teleno_health_signal head-progress|head advances|head progress/i.test(sanitized)
  let state: RemoteExecutionHealth['state'] = 'unknown'

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
  } else if (/teleno_node ready|healthy|running|up /.test(lower)) {
    state = /block_producer\s*:\s*false|observer/.test(lower) ? 'healthy' : 'degraded'
  } else if (sanitized.trim()) {
    state = 'degraded'
  }

  return {
    state,
    checkedAt,
    summary: stopCriteria.length > 0
      ? `Stop criteria detected: ${stopCriteria.join(', ')}`
      : noSeedPeers
        ? 'The observer is running without configured seed peers. Reconcile observer config and restart.'
        : noPeers
          ? 'The observer is running but has no connected peers yet. Check P2P reachability and seed peers.'
          : noHeadProgress
            ? 'The observer answered JSON-RPC but head did not advance in the sampled window.'
            : `Remote health state is ${state}.`,
    stopCriteria
  }
}

function outputExcerpt(output: string): string {
  const redacted = redactRemoteExecutionOutput(output)
  return redacted.length > MAX_OUTPUT_EXCERPT_CHARS
    ? redacted.slice(-MAX_OUTPUT_EXCERPT_CHARS)
    : redacted
}

function createStepSummaries(steps: RemoteExecutionStep[]): RemoteExecutionStepSummary[] {
  return steps.map((step, index) => ({
    stepIndex: index,
    stepCount: steps.length,
    phase: step.phase || 'remote',
    status: 'queued',
    startedAt: null,
    completedAt: null,
    exitCode: null,
    health: null,
    outputExcerpt: ''
  }))
}

function appendCappedOutput(current: string, chunk: string): string {
  const next = `${current}${chunk}`
  return next.length > MAX_OUTPUT_EXCERPT_CHARS * 2
    ? next.slice(-(MAX_OUTPUT_EXCERPT_CHARS * 2))
    : next
}

function createReceipt(input: {
  planId: string
  node?: RemoteExecutionNode
  action?: string
  status: RemoteExecutionReceipt['status']
  startedAt: string
  completedAt?: string
  planStepCount: number
  steps?: RemoteExecutionStepSummary[]
  output: string
}): RemoteExecutionReceipt {
  const completedAt = input.completedAt || new Date().toISOString()
  const output = redactRemoteExecutionOutput(input.output)
  return {
    id: `remote-${randomUUID()}`,
    planId: input.planId,
    nodeId: `${input.node?.id || ''}`,
    network: `${input.node?.network || ''}`,
    action: `${input.action || ''}`,
    status: input.status,
    startedAt: input.startedAt,
    completedAt,
    planStepCount: input.planStepCount,
    health: parseRemoteExecutionHealth(output, completedAt),
    steps: (input.steps || []).map((step) => ({
      ...step,
      outputExcerpt: outputExcerpt(step.outputExcerpt)
    })),
    output
  }
}

async function defaultRunner(command: string, onOutput?: RemoteCommandOutputHandler): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const chunks: Buffer[] = []
    let outputBytes = 0
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, COMMAND_TIMEOUT_MS)
    const collect = (chunk: Buffer) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return
      const remaining = MAX_OUTPUT_BYTES - outputBytes
      const clipped = chunk.subarray(0, remaining)
      chunks.push(clipped)
      outputBytes += Math.min(chunk.length, remaining)
      onOutput?.(clipped.toString('utf8'))
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: typeof code === 'number' ? code : 1,
        output: Buffer.concat(chunks).toString('utf8')
      })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        code: 1,
        output: error.message
      })
    })
  })
}

export function createRemoteNodeExecutionService(options: {
  runner?: RemoteCommandRunner
  onProgress?: RemoteExecutionProgressHandler
} = {}) {
  const runner = options.runner || defaultRunner
  const onProgress = options.onProgress

  async function executeRemoteCommandPlan(input?: RemoteExecutionRequest): Promise<RemoteExecutionResult> {
    const planId = `remote-plan-${randomUUID()}`
    const startedAt = new Date().toISOString()
    const steps = Array.isArray(input?.plan?.steps) ? input.plan.steps : []
    const action = input?.plan?.action || ''
    const stepSummaries = createStepSummaries(steps)
    const validationErrors = validateRemoteExecutionRequest(input)
    const emitStep = (summary: RemoteExecutionStepSummary) => {
      onProgress?.({
        event: 'remote-execution-progress',
        planId,
        nodeId: `${input?.node?.id || input?.plan?.nodeId || ''}`,
        network: `${input?.node?.network || ''}`,
        action,
        ...summary,
        outputExcerpt: outputExcerpt(summary.outputExcerpt)
      })
    }

    if (validationErrors.length > 0) {
      const output = validationErrors.join('\n')
      if (stepSummaries.length > 0) {
        const completedAt = new Date().toISOString()
        stepSummaries[0] = {
          ...stepSummaries[0],
          status: 'blocked',
          startedAt,
          completedAt,
          exitCode: null,
          health: parseRemoteExecutionHealth(output, completedAt),
          outputExcerpt: output
        }
        emitStep(stepSummaries[0])
        for (let index = 1; index < stepSummaries.length; index += 1) {
          stepSummaries[index] = {
            ...stepSummaries[index],
            status: 'skipped',
            completedAt,
            outputExcerpt: 'Skipped because the reviewed command plan was blocked before execution.'
          }
          emitStep(stepSummaries[index])
        }
      }
      const receipt = createReceipt({
        planId,
        node: input?.node,
        action,
        status: 'blocked',
        startedAt,
        completedAt: new Date().toISOString(),
        planStepCount: steps.length,
        steps: stepSummaries,
        output
      })
      return {
        ok: false,
        output,
        receipt
      }
    }

    const outputs: string[] = []
    let ok = true
    for (const summary of stepSummaries) emitStep(summary)

    for (const [index, step] of steps.entries()) {
      const stepStartedAt = new Date().toISOString()
      let liveOutput = ''
      stepSummaries[index] = {
        ...stepSummaries[index],
        status: 'running',
        startedAt: stepStartedAt,
        outputExcerpt: ''
      }
      emitStep(stepSummaries[index])

      const result = await runner(`${step.command || ''}`, (chunk) => {
        liveOutput = appendCappedOutput(liveOutput, chunk)
        const now = new Date().toISOString()
        stepSummaries[index] = {
          ...stepSummaries[index],
          status: 'running',
          health: parseRemoteExecutionHealth(liveOutput, now),
          outputExcerpt: liveOutput
        }
        emitStep(stepSummaries[index])
      })
      const completedAt = new Date().toISOString()
      const stepOutput = result.output || liveOutput
      const stopCriteria = stopCriteriaFromOutput(stepOutput)
      const failed = result.code !== 0 || stopCriteria.length > 0
      stepSummaries[index] = {
        ...stepSummaries[index],
        status: failed ? 'failed' : 'succeeded',
        completedAt,
        exitCode: result.code,
        health: parseRemoteExecutionHealth(stepOutput, completedAt),
        outputExcerpt: stepOutput
      }
      emitStep(stepSummaries[index])
      outputs.push(`STEP ${index + 1} ${step.phase || 'remote'} EXIT ${result.code}`)
      outputs.push(result.output)
      if (failed) {
        ok = false
        for (let skippedIndex = index + 1; skippedIndex < stepSummaries.length; skippedIndex += 1) {
          stepSummaries[skippedIndex] = {
            ...stepSummaries[skippedIndex],
            status: 'skipped',
            completedAt,
            outputExcerpt: `Skipped because ${step.phase || 'remote'} did not complete safely.`
          }
          emitStep(stepSummaries[skippedIndex])
        }
        break
      }
    }

    const output = redactRemoteExecutionOutput(outputs.join('\n').trim())
    const receipt = createReceipt({
      planId,
      node: input?.node,
      action,
      status: ok ? 'succeeded' : 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      planStepCount: steps.length,
      steps: stepSummaries,
      output
    })

    return {
      ok,
      output,
      receipt
    }
  }

  return {
    executeRemoteCommandPlan
  }
}
