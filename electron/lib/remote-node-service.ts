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

export type RemoteExecutionReceipt = {
  id: string
  nodeId: string
  network: string
  action: string
  status: 'succeeded' | 'failed' | 'blocked'
  startedAt: string
  completedAt: string
  planStepCount: number
  health: RemoteExecutionHealth
  output: string
}

export type RemoteExecutionResult = {
  ok: boolean
  output: string
  receipt: RemoteExecutionReceipt
}

export type RemoteCommandRunner = (command: string) => Promise<{ code: number; output: string }>

const MAX_OUTPUT_BYTES = 128 * 1024
const COMMAND_TIMEOUT_MS = 45 * 60 * 1000

export function remoteExecutionConfirmationPhrase(node: RemoteExecutionNode, action: string): string {
  return `EXECUTE ${node.id || ''} ${node.network || ''} ${action}`
}

export function redactRemoteExecutionOutput(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, '<redacted-private-key>')
    .replace(/\b(token[-_ ]?file|password[-_ ]?file|secret[-_ ]?file|private[-_ ]?key[-_ ]?file)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(password|passwd|passphrase|token|secret|seed|wif)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b(private[-_ ]?key)(\s*[:=]\s*)([^\s"',;]+)/gi, '$1$2<redacted>')
    .replace(/\b([A-Za-z0-9._%+-]+)@((?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<ssh-target-redacted>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip-redacted>')
    .replace(/(<ip-redacted>|localhost|\[::1\]|::1):\d{2,5}\b/g, '$1:<port-redacted>')
}

function looksLikeRawSshTarget(value: string): boolean {
  return /@/.test(value) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value)
}

function isReadOnlyRemoteAction(action: string): boolean {
  return action === 'status' || action === 'logs'
}

function stepsAreReadOnly(steps: RemoteExecutionStep[]): boolean {
  return steps.every((step) => !step.hostMutation && !step.chainMutation && !step.destructive)
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
  if (action === 'cleanup') errors.push('Remote cleanup execution is unavailable.')
  if (action === 'rollback') errors.push('Remote rollback execution is unavailable in this MVP.')
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

function createReceipt(input: {
  node?: RemoteExecutionNode
  action?: string
  status: RemoteExecutionReceipt['status']
  startedAt: string
  completedAt?: string
  planStepCount: number
  output: string
}): RemoteExecutionReceipt {
  const completedAt = input.completedAt || new Date().toISOString()
  const output = redactRemoteExecutionOutput(input.output)
  return {
    id: `remote-${randomUUID()}`,
    nodeId: `${input.node?.id || ''}`,
    network: `${input.node?.network || ''}`,
    action: `${input.action || ''}`,
    status: input.status,
    startedAt: input.startedAt,
    completedAt,
    planStepCount: input.planStepCount,
    health: parseRemoteExecutionHealth(output, completedAt),
    output
  }
}

async function defaultRunner(command: string): Promise<{ code: number; output: string }> {
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
      chunks.push(chunk.subarray(0, remaining))
      outputBytes += Math.min(chunk.length, remaining)
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

export function createRemoteNodeExecutionService(options: { runner?: RemoteCommandRunner } = {}) {
  const runner = options.runner || defaultRunner

  async function executeRemoteCommandPlan(input?: RemoteExecutionRequest): Promise<RemoteExecutionResult> {
    const startedAt = new Date().toISOString()
    const steps = Array.isArray(input?.plan?.steps) ? input.plan.steps : []
    const action = input?.plan?.action || ''
    const validationErrors = validateRemoteExecutionRequest(input)

    if (validationErrors.length > 0) {
      const output = validationErrors.join('\n')
      const receipt = createReceipt({
        node: input?.node,
        action,
        status: 'blocked',
        startedAt,
        completedAt: new Date().toISOString(),
        planStepCount: steps.length,
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
    for (const [index, step] of steps.entries()) {
      const result = await runner(`${step.command || ''}`)
      outputs.push(`STEP ${index + 1} ${step.phase || 'remote'} EXIT ${result.code}`)
      outputs.push(result.output)
      if (result.code !== 0 || stopCriteriaFromOutput(result.output).length > 0) {
        ok = false
        break
      }
    }

    const output = redactRemoteExecutionOutput(outputs.join('\n').trim())
    const receipt = createReceipt({
      node: input?.node,
      action,
      status: ok ? 'succeeded' : 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      planStepCount: steps.length,
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
