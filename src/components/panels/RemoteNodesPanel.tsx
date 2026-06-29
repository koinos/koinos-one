import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultRemoteFleetInventory,
  generateRemoteCommandPlan,
  generateRemoteFleetRolloutPlan,
  importRemoteProviderMetadata,
  normalizeRemoteFleetInventory,
  recommendedRemoteBaseDir,
  validateRemoteFleetInventory,
  type RemoteCommandPlan,
  type RemoteFleetInventory,
  type RemoteFleetInventoryInput,
  type RemoteFleetNode,
  type RemoteFleetRolloutNodeStatus,
  type RemoteFleetRolloutPlan,
  type RemoteNodeAction,
  type RemoteNodeHealthState,
  type RemoteProviderImportIssue,
  type RemotePlanNotice,
  type RemotePlanPhase
} from '../../app/remote-nodes'
import {
  createRemoteFleetRolloutReceipt,
  createRemoteExecutionReceipt,
  remoteFleetRolloutConfirmationPhrase,
  remoteExecutionConfirmationPhrase,
  validateRemoteFleetRolloutGate,
  validateRemoteExecutionGate,
  type RemoteFleetRolloutReceipt,
  type RemoteExecutionProgressEvent,
  type RemoteExecutionReceipt,
  type RemoteExecutionStepStatus
} from '../../app/remote-node-execution'

type RemoteNodesPanelProps = {
  t: (key: string, values?: Record<string, string | number>) => string
  advancedMode?: boolean
  inventory?: RemoteFleetInventoryInput
}

const SIMPLE_ACTIONS: RemoteNodeAction[] = [
  'install-observer',
  'status',
  'logs',
  'stop',
  'restart'
]

const SIMPLE_READ_ONLY_ACTIONS: RemoteNodeAction[] = [
  'status',
  'logs'
]

const EXPERT_ACTIONS: RemoteNodeAction[] = [
  'prodnet-observer-proof',
  'install-observer',
  'restore-public-bootstrap',
  'start-observer',
  'status',
  'logs',
  'stop',
  'restart',
  'upgrade',
  'rollback',
  'cleanup'
]

function healthClass(health: RemoteNodeHealthState): string {
  if (health === 'healthy') return 'is-ok'
  if (health === 'installing' || health === 'restoring' || health === 'starting' || health === 'syncing') return 'is-waiting'
  if (health === 'unsafe' || health === 'failed') return 'is-error'
  if (health === 'degraded' || health === 'needs-server' || health === 'needs-space') return 'is-warn'
  return ''
}

function noticeText(
  t: RemoteNodesPanelProps['t'],
  notice: RemotePlanNotice,
  advancedMode = true
): string {
  if (!advancedMode && notice.code === 'dryRunOnly') return t('remote.notice.dryRunOnlySimple')
  return t(`remote.notice.${notice.code}`, {
    field: notice.field || '',
    value: notice.value || ''
  })
}

function phaseText(t: RemoteNodesPanelProps['t'], phase: RemotePlanPhase): string {
  return t(`remote.phase.${phase}`)
}

function phaseHelpText(t: RemoteNodesPanelProps['t'], phase: RemotePlanPhase): string {
  return t(`remote.phaseHelp.${phase}`)
}

function providerImportIssueText(
  t: RemoteNodesPanelProps['t'],
  issue: RemoteProviderImportIssue
): string {
  return t(`remote.providerImportIssue.${issue.code}`, {
    field: issue.field || '',
    value: issue.value || ''
  })
}

function stepStatusClass(status: RemoteExecutionStepStatus): string {
  if (status === 'succeeded') return 'is-ok'
  if (status === 'running') return 'is-waiting'
  if (status === 'failed') return 'is-error'
  if (status === 'blocked') return 'is-warn'
  if (status === 'skipped') return 'is-muted'
  return ''
}

function planSummary(t: RemoteNodesPanelProps['t'], plan: RemoteCommandPlan): string {
  return t(plan.blocked ? 'remote.planBlocked' : 'remote.planReady', {
    steps: plan.steps.length
  })
}

function actionLabel(t: RemoteNodesPanelProps['t'], action: RemoteNodeAction, advancedMode: boolean): string {
  const simpleKey = `remote.simpleAction.${action}`
  const translated = advancedMode ? simpleKey : t(simpleKey)
  return !advancedMode && translated !== simpleKey ? translated : t(`remote.action.${action}`)
}

function isDestructiveAction(action: RemoteNodeAction): boolean {
  return action === 'rollback' || action === 'cleanup'
}

function normalizeReceipt(value: unknown): RemoteExecutionReceipt | null {
  if (!value || typeof value !== 'object') return null
  const receipt = value as Partial<RemoteExecutionReceipt>
  if (!receipt.id || !receipt.nodeId || !receipt.action || !receipt.health) return null
  return receipt as RemoteExecutionReceipt
}

function normalizeFleetReceipt(value: unknown): RemoteFleetRolloutReceipt | null {
  if (!value || typeof value !== 'object') return null
  const receipt = value as Partial<RemoteFleetRolloutReceipt>
  if (receipt.kind !== 'fleet-rollout' || !receipt.id || !receipt.rolloutId || !receipt.action || !Array.isArray(receipt.nodeResults)) return null
  return receipt as RemoteFleetRolloutReceipt
}

function normalizeProgressEvent(value: unknown): RemoteExecutionProgressEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<RemoteExecutionProgressEvent>
  const status = event.status
  const validStatus = (
    status === 'queued' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'blocked' ||
    status === 'skipped'
  )
  if (
    event.event !== 'remote-execution-progress' ||
    !event.planId ||
    !event.nodeId ||
    !event.action ||
    typeof event.stepIndex !== 'number' ||
    typeof event.stepCount !== 'number' ||
    !event.phase ||
    !validStatus
  ) return null
  return {
    event: 'remote-execution-progress',
    planId: event.planId,
    nodeId: event.nodeId,
    network: `${event.network || ''}`,
    action: `${event.action || ''}`,
    stepIndex: event.stepIndex,
    stepCount: event.stepCount,
    phase: `${event.phase}`,
    status,
    startedAt: event.startedAt || null,
    completedAt: event.completedAt || null,
    exitCode: typeof event.exitCode === 'number' ? event.exitCode : null,
    health: event.health || null,
    outputExcerpt: `${event.outputExcerpt || ''}`
  }
}

function updateNode(
  inventory: RemoteFleetInventory,
  nodeId: string,
  updater: (node: RemoteFleetNode) => RemoteFleetNode
): RemoteFleetInventory {
  return {
    ...inventory,
    nodes: inventory.nodes.map((node) => node.id === nodeId ? updater(node) : node)
  }
}

function isAutoBaseDir(node: RemoteFleetNode): boolean {
  return (
    !node.paths.baseDir ||
    node.paths.baseDir.includes('<') ||
    node.paths.baseDir.startsWith('</opt/teleno/') ||
    node.paths.baseDir === recommendedRemoteBaseDir(node.network, node.id)
  )
}

function nodeWithField(node: RemoteFleetNode, field: string, value: string): RemoteFleetNode {
  if (field === 'id') {
    const nextBaseDir = isAutoBaseDir(node) ? recommendedRemoteBaseDir(node.network, value) : node.paths.baseDir
    return {
      ...node,
      id: value,
      paths: {
        ...node.paths,
        baseDir: nextBaseDir,
        config: `${nextBaseDir}/config.yml`
      }
    }
  }
  if (field === 'label') return { ...node, label: value }
  if (field === 'network') {
    const network = value as RemoteFleetNode['network']
    const nextBaseDir = isAutoBaseDir(node) ? recommendedRemoteBaseDir(network, node.id) : node.paths.baseDir
    return {
      ...node,
      network,
      environment: value === 'mainnet' ? 'prodnet' : value,
      paths: {
        ...node.paths,
        baseDir: nextBaseDir,
        config: `${nextBaseDir}/config.yml`
      }
    }
  }
  if (field === 'hostRef') return { ...node, hostRef: value }
  if (field === 'connectionRef') return { ...node, connectionRef: value }
  if (field === 'runtime.image') return { ...node, runtime: { ...node.runtime, image: value } }
  if (field === 'paths.baseDir') return { ...node, paths: { ...node.paths, baseDir: value, config: `${value}/config.yml` } }
  if (field === 'ports.jsonrpcHostBind') return { ...node, ports: { ...node.ports, jsonrpcHostBind: value } }
  if (field === 'ports.p2pPublic') return { ...node, ports: { ...node.ports, p2pPublic: value } }
  if (field === 'ports.backupAdminListen') return { ...node, ports: { ...node.ports, backupAdminListen: value } }
  if (field === 'backup.publicBootstrapUrl') return { ...node, backup: { ...node.backup, publicBootstrapUrl: value } }
  if (field === 'trust.artifactDigest') return { ...node, trust: { ...node.trust, artifactDigest: value } }
  if (field === 'trust.artifactSignatureRef') return { ...node, trust: { ...node.trust, artifactSignatureRef: value } }
  if (field === 'trust.bootstrapPolicyId') return { ...node, trust: { ...node.trust, bootstrapPolicyId: value } }
  if (field === 'trust.bootstrapPolicyDigest') return { ...node, trust: { ...node.trust, bootstrapPolicyDigest: value } }
  if (field === 'trust.prodnetObserverProofRef') return { ...node, trust: { ...node.trust, prodnetObserverProofRef: value } }
  return node
}

export function RemoteNodesPanel(props: RemoteNodesPanelProps) {
  const {
    t,
    advancedMode = false,
    inventory: inventoryInput
  } = props
  const [inventory, setInventory] = useState(() => normalizeRemoteFleetInventory(inventoryInput || defaultRemoteFleetInventory()))
  const [saveState, setSaveState] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [executionState, setExecutionState] = useState('')
  const [executing, setExecuting] = useState(false)
  const [batchConfirmation, setBatchConfirmation] = useState('')
  const [batchExecutionState, setBatchExecutionState] = useState('')
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchCancelRequested, setBatchCancelRequested] = useState(false)
  const batchCancelRequestedRef = useRef(false)
  const [batchSelectedNodeIds, setBatchSelectedNodeIds] = useState<string[]>([])
  const [batchNodeStatuses, setBatchNodeStatuses] = useState<Record<string, RemoteFleetRolloutNodeStatus>>({})
  const [receipts, setReceipts] = useState<RemoteExecutionReceipt[]>([])
  const [fleetReceipts, setFleetReceipts] = useState<RemoteFleetRolloutReceipt[]>([])
  const [providerImportInput, setProviderImportInput] = useState('')
  const [providerImportNetwork, setProviderImportNetwork] = useState<RemoteFleetNode['network']>('testnet')
  const [providerImportState, setProviderImportState] = useState('')
  const [progressEvents, setProgressEvents] = useState<RemoteExecutionProgressEvent[]>([])
  const [activeProgressPlanId, setActiveProgressPlanId] = useState('')
  const receiptAutoSelectionDone = useRef(false)
  const inventoryNotices = useMemo(() => validateRemoteFleetInventory(inventory), [inventory])
  const [selectedNodeId, setSelectedNodeId] = useState(() => inventory.nodes[0]?.id || '')
  const [selectedAction, setSelectedAction] = useState<RemoteNodeAction>('install-observer')
  const selectedNode = inventory.nodes.find((node) => node.id === selectedNodeId) || inventory.nodes[0] || null
  const availableActions = useMemo(() => {
    if (advancedMode) return EXPERT_ACTIONS
    return selectedNode?.network === 'testnet' ? SIMPLE_ACTIONS : SIMPLE_READ_ONLY_ACTIONS
  }, [advancedMode, selectedNode?.network])
  const activeAction = availableActions.includes(selectedAction) ? selectedAction : availableActions[0] || 'status'
  const plan = useMemo(
    () => selectedNode ? generateRemoteCommandPlan(inventory, selectedNode.id, activeAction) : null,
    [activeAction, inventory, selectedNode]
  )
  const providerImportResult = useMemo(
    () => providerImportInput.trim()
      ? importRemoteProviderMetadata(providerImportInput, {
        network: providerImportNetwork,
        existingInventory: inventory
      })
      : null,
    [inventory, providerImportInput, providerImportNetwork]
  )
  const rolloutPlan = useMemo<RemoteFleetRolloutPlan | null>(
    () => advancedMode ? generateRemoteFleetRolloutPlan(inventory, batchSelectedNodeIds, activeAction) : null,
    [activeAction, advancedMode, batchSelectedNodeIds, inventory]
  )
  const executionGate = useMemo(
    () => plan ? validateRemoteExecutionGate(inventory, plan, confirmation) : null,
    [confirmation, inventory, plan]
  )
  const rolloutGate = useMemo(
    () => rolloutPlan ? validateRemoteFleetRolloutGate(inventory, rolloutPlan, batchConfirmation) : null,
    [batchConfirmation, inventory, rolloutPlan]
  )
  const visibleProgressEvents = useMemo(() => {
    const matchingEvents = progressEvents.filter((event) =>
      event.nodeId === selectedNode?.id &&
      event.action === activeAction
    )
    const planId = activeProgressPlanId && matchingEvents.some((event) => event.planId === activeProgressPlanId)
      ? activeProgressPlanId
      : matchingEvents.length > 0
        ? matchingEvents[matchingEvents.length - 1].planId
        : ''
    return planId ? matchingEvents.filter((event) => event.planId === planId) : []
  }, [activeAction, activeProgressPlanId, progressEvents, selectedNode?.id])
  const progressByStep = useMemo(() => {
    const map = new Map<number, RemoteExecutionProgressEvent>()
    for (const event of visibleProgressEvents) map.set(event.stepIndex, event)
    return map
  }, [visibleProgressEvents])
  const remoteBridge = typeof window !== 'undefined' ? window.teleno?.remoteNodes : undefined

  useEffect(() => {
    if (inventoryInput) {
      setInventory(normalizeRemoteFleetInventory(inventoryInput))
      return
    }
    let cancelled = false
    void remoteBridge?.loadInventory()
      .then((result) => {
        if (cancelled || !result?.ok) return
        setInventory(normalizeRemoteFleetInventory(result.inventory as RemoteFleetInventoryInput))
        setSaveState(result.output || '')
      })
      .catch(() => {
        if (!cancelled) setSaveState(t('remote.persistenceUnavailable'))
      })
    void remoteBridge?.loadReceipts()
      .then((result) => {
        if (cancelled || !result?.ok) return
        setReceipts((result.receipts || []).map(normalizeReceipt).filter(Boolean) as RemoteExecutionReceipt[])
        setFleetReceipts((result.receipts || []).map(normalizeFleetReceipt).filter(Boolean) as RemoteFleetRolloutReceipt[])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [inventoryInput, remoteBridge, t])

  useEffect(() => {
    if (inventory.nodes.some((node) => node.id === selectedNodeId)) return
    setSelectedNodeId(inventory.nodes[0]?.id || '')
  }, [inventory.nodes, selectedNodeId])

  useEffect(() => {
    if (availableActions.includes(selectedAction)) return
    setSelectedAction(availableActions[0] || 'status')
  }, [availableActions, selectedAction])

  useEffect(() => {
    if (inventoryInput || receiptAutoSelectionDone.current) return
    const latestReceipt = receipts[receipts.length - 1]
    if (!latestReceipt || !inventory.nodes.some((node) => node.id === latestReceipt.nodeId)) return
    setSelectedNodeId((current) => {
      const defaultNodeId = inventory.nodes[0]?.id || ''
      return !current || current === defaultNodeId ? latestReceipt.nodeId : current
    })
    receiptAutoSelectionDone.current = true
  }, [inventory.nodes, inventoryInput, receipts])

  useEffect(() => {
    if (!remoteBridge?.onExecutionProgressEvent) return undefined
    return remoteBridge.onExecutionProgressEvent((value) => {
      const event = normalizeProgressEvent(value)
      if (!event) return
      setActiveProgressPlanId(event.planId)
      setProgressEvents((current) => {
        const withoutCurrentStep = current.filter((candidate) =>
          candidate.planId !== event.planId || candidate.stepIndex !== event.stepIndex
        )
        return [...withoutCurrentStep, event].slice(-200)
      })
    })
  }, [remoteBridge])

  useEffect(() => {
    if (!advancedMode) return
    setBatchSelectedNodeIds((current) => {
      const existing = current.filter((nodeId) => inventory.nodes.some((node) => node.id === nodeId))
      const preferred = inventory.nodes.filter((node) => node.network === 'testnet').map((node) => node.id)
      if (existing.length >= 2 || (existing.length > 0 && preferred.length < 2)) return existing
      return preferred.length > 0 ? preferred : inventory.nodes.map((node) => node.id)
    })
  }, [advancedMode, inventory.nodes])

  useEffect(() => {
    setConfirmation('')
    setExecutionState('')
  }, [activeAction, selectedNodeId])

  useEffect(() => {
    setBatchConfirmation('')
    setBatchExecutionState('')
    setBatchNodeStatuses({})
  }, [activeAction, batchSelectedNodeIds.join('|')])

  function setSelectedField(field: string, value: string) {
    if (!selectedNode) return
    setInventory((current) => normalizeRemoteFleetInventory(updateNode(current, selectedNode.id, (node) => nodeWithField(node, field, value))))
    if (field === 'id') setSelectedNodeId(value)
  }

  async function saveInventory() {
    const notices = validateRemoteFleetInventory(inventory)
    if (notices.length > 0) {
      setSaveState(t('remote.inventorySaveBlocked'))
      return
    }
    if (!remoteBridge?.saveInventory) {
      setSaveState(t('remote.persistenceUnavailable'))
      return
    }
    const result = await remoteBridge.saveInventory(inventory)
    setSaveState(result.output || (result.ok ? t('remote.inventorySaved') : t('remote.inventorySaveFailed')))
  }

  function addNode() {
    const nextIndex = inventory.nodes.length + 1
    const nextId = `testnet-observer-${nextIndex}`
    const baseDir = recommendedRemoteBaseDir('testnet', nextId)
    const nextInventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        ...inventory.nodes,
        {
          id: nextId,
          label: `Testnet Observer ${nextIndex}`,
          network: 'testnet',
          role: 'observer',
          hostRef: `host-${nextId}`,
          connectionRef: `ssh-${nextId}`,
          paths: {
            baseDir,
            config: `${baseDir}/config.yml`
          }
        }
      ]
    })
    setInventory(nextInventory)
    setSelectedNodeId(nextId)
  }

  function removeSelectedNode() {
    if (!selectedNode || inventory.nodes.length <= 1) return
    const nextNodes = inventory.nodes.filter((node) => node.id !== selectedNode.id)
    setInventory(normalizeRemoteFleetInventory({ version: 1, nodes: nextNodes }))
    setSelectedNodeId(nextNodes[0]?.id || '')
  }

  function addProviderImportedNodes() {
    if (!providerImportResult?.ok || providerImportResult.nodes.length === 0) {
      setProviderImportState(t('remote.providerImportBlocked'))
      return
    }
    const nextInventory = normalizeRemoteFleetInventory({
      version: 1,
      nodes: [
        ...inventory.nodes,
        ...providerImportResult.nodes
      ]
    })
    setInventory(nextInventory)
    setSelectedNodeId(providerImportResult.nodes[0].id)
    setProviderImportState(t('remote.providerImportAdded', { count: providerImportResult.nodes.length }))
    setProviderImportInput('')
  }

  async function executePlan() {
    if (!selectedNode || !plan || !executionGate) return
    if (!executionGate.ok) {
      const output = executionGate.codes.map((code) => t(`remote.executionGate.${code}`)).join('\n')
      const receipt = createRemoteExecutionReceipt({
        node: selectedNode,
        action: plan.action,
        status: 'blocked',
        planStepCount: plan.steps.length,
        output
      })
      setReceipts((current) => [...current, receipt].slice(-50))
      setExecutionState(output)
      return
    }
    if (!remoteBridge?.executePlan) {
      setExecutionState(t('remote.executorUnavailable'))
      return
    }

    setExecuting(true)
    setExecutionState(t('remote.executionRunning'))
    setProgressEvents([])
    setActiveProgressPlanId('')
    try {
      const result = await remoteBridge.executePlan({
        node: selectedNode,
        plan,
        confirmation
      })
      const receipt = normalizeReceipt(result.receipt)
      if (receipt) {
        setReceipts((current) => [...current, receipt].slice(-50))
        setInventory((current) => updateNode(current, receipt.nodeId, (node) => ({
          ...node,
          status: {
            ...node.status,
            health: receipt.health.state,
            lastCheck: receipt.completedAt
          }
        })))
      }
      setExecutionState(advancedMode
        ? result.output || (result.ok ? t('remote.executionSucceeded') : t('remote.executionFailed'))
        : result.ok ? t('remote.executionSucceeded') : t('remote.executionFailed')
      )
    } catch (error) {
      setExecutionState(advancedMode && error instanceof Error ? error.message : t('remote.executionFailed'))
    } finally {
      setExecuting(false)
    }
  }

  function toggleBatchNode(nodeId: string) {
    setBatchSelectedNodeIds((current) =>
      current.includes(nodeId)
        ? current.filter((candidate) => candidate !== nodeId)
        : [...current, nodeId]
    )
  }

  function setBatchStatus(nodeId: string, status: RemoteFleetRolloutNodeStatus) {
    setBatchNodeStatuses((current) => ({ ...current, [nodeId]: status }))
  }

  function moveBatchNode(nodeId: string, direction: -1 | 1) {
    setBatchSelectedNodeIds((current) => {
      const index = current.indexOf(nodeId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  async function executeBatchRollout() {
    if (!rolloutPlan || !rolloutGate) return
    if (!rolloutGate.ok) {
      const output = rolloutGate.codes.map((code) => t(`remote.fleetGate.${code}`)).join('\n')
      const fleetReceipt = createRemoteFleetRolloutReceipt({
        rollout: rolloutPlan,
        status: 'blocked',
        nodeReceipts: [],
        skippedNodeIds: rolloutPlan.entries.map((entry) => entry.nodeId),
        stopReason: output,
        output
      })
      setFleetReceipts((current) => [...current, fleetReceipt].slice(-20))
      setBatchExecutionState(output)
      if (remoteBridge?.appendReceipt) await remoteBridge.appendReceipt(fleetReceipt).catch(() => undefined)
      return
    }
    if (!remoteBridge?.executePlan) {
      setBatchExecutionState(t('remote.executorUnavailable'))
      return
    }

    const startedAt = new Date().toISOString()
    const nodeReceipts: RemoteExecutionReceipt[] = []
    const skippedNodeIds: string[] = []
    let stopReason = ''
    batchCancelRequestedRef.current = false
    setBatchCancelRequested(false)
    setBatchExecuting(true)
    setBatchExecutionState(t('remote.fleetExecutionRunning'))
    setBatchNodeStatuses(Object.fromEntries(
      rolloutPlan.entries.map((entry) => [entry.nodeId, 'confirmed' as RemoteFleetRolloutNodeStatus])
    ) as Record<string, RemoteFleetRolloutNodeStatus>)

    try {
      for (const [index, entry] of rolloutPlan.entries.entries()) {
        if (batchCancelRequestedRef.current) {
          stopReason = t('remote.fleetStoppedByUser')
          skippedNodeIds.push(...rolloutPlan.entries.slice(index).map((candidate) => candidate.nodeId))
          for (const skipped of skippedNodeIds) setBatchStatus(skipped, 'skipped')
          break
        }
        const node = inventory.nodes.find((candidate) => candidate.id === entry.nodeId)
        if (!node) {
          stopReason = t('remote.fleetNodeMissing', { node: entry.nodeId })
          skippedNodeIds.push(entry.nodeId, ...rolloutPlan.entries.slice(index + 1).map((candidate) => candidate.nodeId))
          setBatchStatus(entry.nodeId, 'failed')
          break
        }
        setSelectedNodeId(node.id)
        setBatchStatus(node.id, 'running')
        const result = await remoteBridge.executePlan({
          node,
          plan: entry.plan,
          confirmation: entry.confirmationPhrase
        })
        const receipt = normalizeReceipt(result.receipt)
        if (receipt) {
          nodeReceipts.push(receipt)
          setReceipts((current) => [...current, receipt].slice(-50))
          setInventory((current) => updateNode(current, receipt.nodeId, (candidate) => ({
            ...candidate,
            status: {
              ...candidate.status,
              health: receipt.health.state,
              lastCheck: receipt.completedAt
            }
          })))
        }
        const failed = !result.ok || !receipt || receipt.status !== 'succeeded'
        setBatchStatus(node.id, failed ? 'failed' : 'complete')
        if (failed) {
          stopReason = receipt?.health.summary || result.output || t('remote.fleetStoppedOnFailure')
          skippedNodeIds.push(...rolloutPlan.entries.slice(index + 1).map((candidate) => candidate.nodeId))
          for (const skipped of skippedNodeIds) setBatchStatus(skipped, 'skipped')
          break
        }
      }
    } catch (error) {
      stopReason = advancedMode && error instanceof Error ? error.message : t('remote.fleetStoppedOnFailure')
    } finally {
      const fleetReceipt = createRemoteFleetRolloutReceipt({
        rollout: rolloutPlan,
        startedAt,
        completedAt: new Date().toISOString(),
        nodeReceipts,
        skippedNodeIds,
        stopReason
      })
      setFleetReceipts((current) => [...current, fleetReceipt].slice(-20))
      if (remoteBridge?.appendReceipt) await remoteBridge.appendReceipt(fleetReceipt).catch(() => undefined)
      setBatchExecutionState(stopReason ? t('remote.fleetExecutionStopped') : t('remote.fleetExecutionSucceeded'))
      setBatchExecuting(false)
      setBatchCancelRequested(false)
      batchCancelRequestedRef.current = false
    }
  }

  return (
    <section
      id="panel-remote"
      className="remote-panel"
      aria-label={t('remote.panelAria')}
      role="tabpanel"
      aria-labelledby="tab-remote"
    >
      <div className="remote-panel-header">
        <div>
          <h2>{t('remote.title')}</h2>
          <p>{advancedMode ? t('remote.descriptionExpert') : t('remote.descriptionSimple')}</p>
        </div>
        <span className="status-pill is-waiting">{t('remote.dryRunBadge')}</span>
      </div>

      <div className="remote-safety-strip" role="note">
        <span>{t('remote.safetyObserverFirst')}</span>
        <span>{t('remote.safetyNoProducer')}</span>
        <span>{t('remote.safetyNoSecrets')}</span>
      </div>

      <div className="remote-layout">
        <section className="remote-node-list" aria-label={t('remote.inventoryTitle')}>
          <div className="node-services-header">
            <div>
              <h3>{t('remote.inventoryTitle')}</h3>
              <p className="settings-inline-help">{t('remote.inventoryDescription')}</p>
            </div>
          </div>

          <div className="remote-node-cards">
            {inventory.nodes.map((node) => {
              const selected = selectedNode?.id === node.id
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`remote-node-card ${selected ? 'is-selected' : ''}`.trim()}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span className="remote-node-card-title">{node.label}</span>
                  {advancedMode && <span className="remote-node-card-meta mono">{node.id}</span>}
                  <span className="remote-node-card-grid">
                    <span>{t('remote.fieldNetwork')}</span>
                    <strong>{node.network}</strong>
                    <span>{t('remote.fieldRole')}</span>
                    <strong>{node.role}</strong>
                    {advancedMode && (
                      <>
                        <span>{t('remote.fieldHostRef')}</span>
                        <strong className="mono">{node.hostRef}</strong>
                      </>
                    )}
                    <span>{t('remote.fieldBaseDir')}</span>
                    <strong className="mono">{node.paths.baseDir}</strong>
                  </span>
                  <span className={`remote-node-health ${healthClass(node.status.health)}`.trim()}>
                    {t(`remote.health.${node.status.health}`)}
                  </span>
                </button>
              )
            })}
          </div>

          {selectedNode && (
            <div className="remote-editor settings-form">
              <div className="node-services-header">
                <div>
                  <h3>{t('remote.editorTitle')}</h3>
                  <p className="settings-inline-help">
                    {advancedMode ? t('remote.editorDescription') : t('remote.editorDescriptionSimple')}
                  </p>
                </div>
              </div>
              {advancedMode && (
                <label>
                  <span>{t('remote.fieldId')}</span>
                  <input value={selectedNode.id} onChange={(event) => setSelectedField('id', event.target.value)} />
                </label>
              )}
              <label>
                <span>{t('remote.fieldLabel')}</span>
                <input value={selectedNode.label} onChange={(event) => setSelectedField('label', event.target.value)} />
              </label>
              <label>
                <span>{t('remote.fieldNetwork')}</span>
                <select value={selectedNode.network} onChange={(event) => setSelectedField('network', event.target.value)}>
                  <option value="testnet">{t('remote.network.testnet')}</option>
                  <option value="mainnet">{t('remote.network.mainnet')}</option>
                  <option value="custom">{t('remote.network.custom')}</option>
                </select>
              </label>
              <label>
                <span>{advancedMode ? t('remote.fieldConnectionRef') : t('remote.fieldSshAlias')}</span>
                <input value={selectedNode.connectionRef} onChange={(event) => setSelectedField('connectionRef', event.target.value)} />
              </label>
              <label>
                <span>{advancedMode ? t('remote.fieldBaseDir') : t('remote.fieldSuggestedBaseDir')}</span>
                <input
                  value={selectedNode.paths.baseDir}
                  readOnly={!advancedMode}
                  onChange={(event) => setSelectedField('paths.baseDir', event.target.value)}
                />
              </label>
              {advancedMode && (
                <>
                  <label>
                    <span>{t('remote.fieldRole')}</span>
                    <input value={t('remote.roleObserverOnly')} readOnly />
                  </label>
                  <label>
                    <span>{t('remote.fieldHostRef')}</span>
                    <input value={selectedNode.hostRef} onChange={(event) => setSelectedField('hostRef', event.target.value)} />
                  </label>
                  <label>
                    <span>{t('remote.fieldImage')}</span>
                    <input value={selectedNode.runtime.image} onChange={(event) => setSelectedField('runtime.image', event.target.value)} />
                  </label>
                  <label>
                    <span>{t('remote.fieldJsonRpcBind')}</span>
                    <input value={selectedNode.ports.jsonrpcHostBind} onChange={(event) => setSelectedField('ports.jsonrpcHostBind', event.target.value)} />
                  </label>
                  <label>
                    <span>{t('remote.fieldP2pPort')}</span>
                    <input value={selectedNode.ports.p2pPublic} onChange={(event) => setSelectedField('ports.p2pPublic', event.target.value)} />
                  </label>
                  <label>
                    <span>{t('remote.fieldBackupAdminBind')}</span>
                    <input value={selectedNode.ports.backupAdminListen} onChange={(event) => setSelectedField('ports.backupAdminListen', event.target.value)} />
                  </label>
                  <label>
                    <span>{t('remote.fieldBootstrapUrl')}</span>
                    <input value={selectedNode.backup.publicBootstrapUrl} onChange={(event) => setSelectedField('backup.publicBootstrapUrl', event.target.value)} />
                  </label>
                  {selectedNode.network === 'mainnet' && (
                    <>
                      <label>
                        <span>{t('remote.fieldArtifactDigest')}</span>
                        <input value={selectedNode.trust.artifactDigest} onChange={(event) => setSelectedField('trust.artifactDigest', event.target.value)} />
                      </label>
                      <label>
                        <span>{t('remote.fieldArtifactSignatureRef')}</span>
                        <input value={selectedNode.trust.artifactSignatureRef} onChange={(event) => setSelectedField('trust.artifactSignatureRef', event.target.value)} />
                      </label>
                      <label>
                        <span>{t('remote.fieldBootstrapPolicyId')}</span>
                        <input value={selectedNode.trust.bootstrapPolicyId} onChange={(event) => setSelectedField('trust.bootstrapPolicyId', event.target.value)} />
                      </label>
                      <label>
                        <span>{t('remote.fieldBootstrapPolicyDigest')}</span>
                        <input value={selectedNode.trust.bootstrapPolicyDigest} onChange={(event) => setSelectedField('trust.bootstrapPolicyDigest', event.target.value)} />
                      </label>
                      <label>
                        <span>{t('remote.fieldProdnetProofRef')}</span>
                        <input value={selectedNode.trust.prodnetObserverProofRef} onChange={(event) => setSelectedField('trust.prodnetObserverProofRef', event.target.value)} />
                      </label>
                    </>
                  )}
                </>
              )}
              <div className="remote-editor-actions">
                <button type="button" className="ghost-button" onClick={addNode}>{t('remote.addNode')}</button>
                <button type="button" className="ghost-button" onClick={removeSelectedNode} disabled={inventory.nodes.length <= 1}>
                  {t('remote.removeNode')}
                </button>
                <button type="button" className="primary-button" onClick={() => void saveInventory()}>{t('remote.saveInventory')}</button>
              </div>
              {saveState && <p className="settings-inline-help">{saveState}</p>}
            </div>
          )}

          <section className="remote-provider-checklist" aria-label={t('remote.providerChecklistTitle')}>
            <div className="node-services-header">
              <div>
                <h3>{t('remote.providerChecklistTitle')}</h3>
                <p className="settings-inline-help">{t('remote.providerChecklistDescription')}</p>
              </div>
            </div>
            <ul>
              <li>{t('remote.providerChecklist.resources')}</li>
              <li>{t('remote.providerChecklist.sshAlias')}</li>
              <li>{t('remote.providerChecklist.firewall')}</li>
              <li>{t('remote.providerChecklist.baseDir')}</li>
              <li>{t('remote.providerChecklist.noToken')}</li>
            </ul>
          </section>

          <section className="remote-provider-import" aria-label={t('remote.providerImportTitle')}>
            <div className="node-services-header">
              <div>
                <h3>{t('remote.providerImportTitle')}</h3>
                <p className="settings-inline-help">{t('remote.providerImportDescription')}</p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                <span>{t('remote.providerImportNetwork')}</span>
                <select
                  value={providerImportNetwork}
                  onChange={(event) => setProviderImportNetwork(event.target.value as RemoteFleetNode['network'])}
                >
                  <option value="testnet">{t('remote.network.testnet')}</option>
                  <option value="mainnet">{t('remote.network.mainnet')}</option>
                  <option value="custom">{t('remote.network.custom')}</option>
                </select>
              </label>
              <label>
                <span>{t('remote.providerImportInput')}</span>
                <textarea
                  value={providerImportInput}
                  onChange={(event) => {
                    setProviderImportInput(event.target.value)
                    setProviderImportState('')
                  }}
                  placeholder={t('remote.providerImportPlaceholder')}
                  rows={8}
                />
              </label>
            </div>
            {providerImportResult && (
              <div className="remote-provider-import-review">
                <p className={`settings-inline-help ${providerImportResult.ok ? 'is-ok' : 'is-error'}`.trim()}>
                  {providerImportResult.ok
                    ? t('remote.providerImportReady', { count: providerImportResult.nodes.length })
                    : t('remote.providerImportBlocked')}
                </p>
                {providerImportResult.issues.length > 0 && (
                  <div className="remote-notice-list">
                    {providerImportResult.issues.map((issue, index) => (
                      <p key={`${issue.code}-${index}`} className="settings-inline-help is-error">
                        {providerImportIssueText(t, issue)}
                      </p>
                    ))}
                  </div>
                )}
                {providerImportResult.nodes.length > 0 && (
                  <ol className="remote-provider-import-nodes">
                    {providerImportResult.nodes.map((node) => (
                      <li key={node.id}>
                        <strong>{node.label}</strong>
                        <span>{t('remote.providerImportNodeSummary', {
                          network: t(`remote.network.${node.network}`),
                          alias: node.connectionRef,
                          basedir: node.paths.baseDir
                        })}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {advancedMode && (
                  <div className="remote-provider-import-preview">
                    <strong>{t('remote.providerImportPreviewTitle')}</strong>
                    <pre>{providerImportResult.redactedPreview || t('remote.providerImportPreviewEmpty')}</pre>
                  </div>
                )}
              </div>
            )}
            <div className="remote-editor-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={addProviderImportedNodes}
                disabled={!providerImportResult?.ok}
              >
                {t('remote.providerImportAddReviewed')}
              </button>
            </div>
            <p className="settings-inline-help">{t('remote.providerImportSaveReminder')}</p>
            {providerImportState && <p className="settings-inline-help is-ok">{providerImportState}</p>}
          </section>
        </section>

        <section className="remote-plan-panel">
          <div className="node-services-header">
            <div>
              <h3>{advancedMode ? t('remote.actionsTitleExpert') : t('remote.actionsTitleSimple')}</h3>
              <p className="settings-inline-help">
                {advancedMode ? t('remote.actionsExpertDescription') : t('remote.actionsSimpleDescription')}
              </p>
              {advancedMode && <p className="settings-inline-help">{t('remote.multiNodeReviewNote')}</p>}
            </div>
          </div>

          <div className="remote-action-grid">
            {availableActions.map((action) => (
              <button
                key={action}
                type="button"
                className={`ghost-button ${activeAction === action ? 'is-active' : ''}`.trim()}
                onClick={() => setSelectedAction(action)}
              >
                {actionLabel(t, action, advancedMode)}
              </button>
            ))}
          </div>

          {advancedMode && rolloutPlan && (
            <section className="remote-fleet-rollout" aria-label={t('remote.fleetTitle')}>
              <div className="node-services-header">
                <div>
                  <h3>{t('remote.fleetTitle')}</h3>
                  <p className="settings-inline-help">{t('remote.fleetDescription')}</p>
                </div>
              </div>
              <div className="remote-fleet-node-picker" role="group" aria-label={t('remote.fleetNodeSelection')}>
                {inventory.nodes.map((node) => (
                  <label key={node.id}>
                    <input
                      type="checkbox"
                      checked={batchSelectedNodeIds.includes(node.id)}
                      onChange={() => toggleBatchNode(node.id)}
                      disabled={batchExecuting}
                    />
                    <span>{node.label}</span>
                    <em>{node.network}</em>
                  </label>
                ))}
              </div>
              <div className="remote-plan-summary">
                <div>
                  <span>{t('remote.selectedAction')}</span>
                  <strong>{actionLabel(t, rolloutPlan.action, true)}</strong>
                </div>
                <div>
                  <span>{t('remote.fleetSelectedNodes')}</span>
                  <strong>{t('remote.fleetSelectedNodesValue', { count: rolloutPlan.entries.length })}</strong>
                </div>
                <div>
                  <span>{t('remote.fleetExecutionMode')}</span>
                  <strong>{t('remote.fleetSequentialOnly')}</strong>
                </div>
              </div>
              <ol className="remote-fleet-review-list">
                {rolloutPlan.entries.map((entry, index) => {
                  const status = batchNodeStatuses[entry.nodeId] || entry.status
                  const phases = entry.plan.steps.map((step) => phaseText(t, step.phase)).join(' / ')
                  const visibleNotices = entry.notices.filter((notice) => notice.code !== 'dryRunOnly').slice(0, 3)
                  return (
                    <li key={entry.nodeId} className={stepStatusClass(status === 'complete' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : status === 'running' ? 'running' : 'queued')}>
                      <span>{index + 1}</span>
                      <div>
                        <div className="remote-progress-step-title">
                          <strong>{entry.label}</strong>
                          <em>{t(`remote.fleetStatus.${status}`)}</em>
                        </div>
                        <div className="remote-fleet-order-controls">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => moveBatchNode(entry.nodeId, -1)}
                            disabled={batchExecuting || index === 0}
                          >
                            {t('remote.fleetMoveUp')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => moveBatchNode(entry.nodeId, 1)}
                            disabled={batchExecuting || index === rolloutPlan.entries.length - 1}
                          >
                            {t('remote.fleetMoveDown')}
                          </button>
                        </div>
                        <p>{t('remote.fleetNodePlanSummary', { steps: entry.stepCount, phases })}</p>
                        {entry.blocked && <p className="settings-inline-help is-error">{t('remote.fleetNodeBlocked')}</p>}
                        {visibleNotices.map((notice, noticeIndex) => (
                          <p key={`${entry.nodeId}-${notice.code}-${noticeIndex}`} className="settings-inline-help">
                            {noticeText(t, notice, true)}
                          </p>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className="remote-confirmation-box">
                <span>{t('remote.fleetConfirmationPhrase')}</span>
                <code>{remoteFleetRolloutConfirmationPhrase(rolloutPlan)}</code>
              </div>
              <div className="remote-fleet-required-phrases">
                <strong>{t('remote.fleetPerNodeConfirmations')}</strong>
                {rolloutGate?.requiredPhrases.slice(1).map((phrase) => <code key={phrase}>{phrase}</code>)}
              </div>
              <label className="remote-confirmation-input">
                <span>{t('remote.fleetConfirmationInput')}</span>
                <textarea
                  value={batchConfirmation}
                  onChange={(event) => setBatchConfirmation(event.target.value)}
                  disabled={batchExecuting}
                  rows={Math.min(6, Math.max(3, (rolloutGate?.requiredPhrases.length || 1) + 1))}
                />
              </label>
              {rolloutGate && !rolloutGate.ok && (
                <div className="remote-notice-list">
                  {rolloutGate.codes.map((code) => (
                    <p key={code} className="settings-inline-help is-error">
                      {t(`remote.fleetGate.${code}`)}
                    </p>
                  ))}
                </div>
              )}
              <div className="remote-editor-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void executeBatchRollout()}
                  disabled={batchExecuting || !rolloutGate?.ok}
                >
                  {batchExecuting ? t('remote.fleetExecuting') : t('remote.fleetExecute')}
                </button>
                {batchExecuting && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      batchCancelRequestedRef.current = true
                      setBatchCancelRequested(true)
                      setBatchExecutionState(t('remote.fleetCancelAfterCurrent'))
                    }}
                  >
                    {batchCancelRequested ? t('remote.fleetCancelRequested') : t('remote.fleetCancel')}
                  </button>
                )}
              </div>
              {batchExecutionState && (
                advancedMode
                  ? <pre className="remote-output">{batchExecutionState}</pre>
                  : <p className="settings-inline-help">{batchExecutionState}</p>
              )}
            </section>
          )}

          {selectedNode && plan && (
            <div className="remote-plan">
              {!advancedMode && (
                <div className="remote-human-summary">
                  <strong>{t('remote.simpleSummaryTitle')}</strong>
                  <dl>
                    <div>
                      <dt>{t('remote.fieldSuggestedBaseDir')}</dt>
                      <dd className="mono">{selectedNode.paths.baseDir}</dd>
                    </div>
                    <div>
                      <dt>{t('remote.fieldJsonRpcBind')}</dt>
                      <dd className="mono">{selectedNode.ports.jsonrpcHostBind}</dd>
                    </div>
                    <div>
                      <dt>{t('remote.fieldP2pPort')}</dt>
                      <dd className="mono">{selectedNode.ports.p2pPublic}</dd>
                    </div>
                    <div>
                      <dt>{t('remote.fieldBootstrapUrl')}</dt>
                      <dd>{selectedNode.backup.publicBootstrapUrl}</dd>
                    </div>
                  </dl>
                </div>
              )}
              <div className="remote-plan-summary">
                <div>
                  <span>{t('remote.selectedNode')}</span>
                  <strong>{selectedNode.label}</strong>
                </div>
                <div>
                  <span>{t('remote.selectedAction')}</span>
                  <strong>{actionLabel(t, plan.action, advancedMode)}</strong>
                </div>
                <div>
                  <span>{t('remote.planState')}</span>
                  <strong className={plan.blocked ? 'is-error' : 'is-ok'}>
                    {planSummary(t, plan)}
                  </strong>
                </div>
              </div>

              <div className="remote-notice-list">
                {plan.notices.map((notice, index) => (
                  <p
                    key={`${notice.code}-${notice.field || ''}-${index}`}
                    className={`settings-inline-help ${plan.blocked ? 'is-error' : ''}`.trim()}
                  >
                    {noticeText(t, notice, advancedMode)}
                  </p>
                ))}
                {inventoryNotices.length === 0 && (
                  <p className="settings-inline-help is-ok">{t('remote.inventoryValid')}</p>
                )}
              </div>

              <div className="remote-progress-list" aria-label={t('remote.progressTitle')}>
                <div>
                  <strong>{t('remote.progressTitle')}</strong>
                  <p className="settings-inline-help">{t('remote.progressDescription')}</p>
                </div>
                <ol>
                  {plan.steps.map((step, index) => {
                    const progress = progressByStep.get(index)
                    const status = progress?.status || 'queued'
                    const healthState = progress?.health?.state
                    return (
                      <li
                        key={`${step.phase}-${index}`}
                        className={stepStatusClass(status)}
                        data-progress-status={status}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <div className="remote-progress-step-title">
                            <strong>{phaseText(t, step.phase)}</strong>
                            <em>{t(`remote.stepStatus.${status}`)}</em>
                          </div>
                          <p>
                            {progress
                              ? t('remote.progressLiveDescription', { status: t(`remote.stepStatus.${status}`) })
                              : phaseHelpText(t, step.phase)}
                          </p>
                          {healthState && (
                            <p>{t('remote.progressHealth', { health: t(`remote.health.${healthState}`) })}</p>
                          )}
                          {advancedMode && progress?.outputExcerpt && (
                            <pre className="remote-progress-output">{progress.outputExcerpt}</pre>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <div className="remote-execution-panel">
                <div>
                  <strong>{t('remote.executionTitle')}</strong>
                  <p className="settings-inline-help">
                    {selectedNode.network === 'testnet'
                      ? t('remote.executionDescriptionTestnet')
                      : t('remote.executionDescriptionProdnet')}
                  </p>
                </div>
                {advancedMode && isDestructiveAction(plan.action) && (
                  <div className="remote-destructive-warning" role="alert">
                    <strong>{t('remote.destructiveTitle')}</strong>
                    <p>{plan.action === 'rollback' ? t('remote.destructiveRollbackDescription') : t('remote.destructiveCleanupDescription')}</p>
                  </div>
                )}
                {advancedMode && selectedNode.network === 'mainnet' && (
                  <div className="remote-prodnet-trust-panel">
                    <strong>{t('remote.prodnetTrustTitle')}</strong>
                    <dl>
                      <div>
                        <dt>{t('remote.fieldArtifactDigest')}</dt>
                        <dd className="mono">{selectedNode.trust.artifactDigest || t('remote.prodnetTrustMissing')}</dd>
                      </div>
                      <div>
                        <dt>{t('remote.fieldBootstrapPolicyId')}</dt>
                        <dd className="mono">{selectedNode.trust.bootstrapPolicyId || t('remote.prodnetTrustMissing')}</dd>
                      </div>
                      <div>
                        <dt>{t('remote.fieldProdnetProofRef')}</dt>
                        <dd className="mono">{selectedNode.trust.prodnetObserverProofRef || t('remote.prodnetTrustMissing')}</dd>
                      </div>
                    </dl>
                    <p>{t('remote.prodnetTrustDescription')}</p>
                  </div>
                )}
                <div className="remote-confirmation-box">
                  <span>{t('remote.confirmationPhrase')}</span>
                  <code>{remoteExecutionConfirmationPhrase(selectedNode, plan.action)}</code>
                </div>
                <label className="remote-confirmation-input">
                  <span>{t('remote.confirmationInput')}</span>
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </label>
                {executionGate && !executionGate.ok && (
                  <div className="remote-notice-list">
                    {executionGate.codes.map((code) => (
                      <p key={code} className="settings-inline-help is-error">
                        {t(`remote.executionGate.${code}`)}
                      </p>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void executePlan()}
                  disabled={executing || !executionGate?.ok}
                >
                  {executing ? t('remote.executing') : t('remote.executeConfirmedPlan')}
                </button>
                {executionState && (
                  advancedMode
                    ? <pre className="remote-output">{executionState}</pre>
                    : <p className="settings-inline-help">{executionState}</p>
                )}
              </div>

              {advancedMode && (
                <div className="remote-command-list">
                  {plan.steps.map((step, index) => (
                    <article className="remote-command-step" key={`${step.phase}-${index}`}>
                      <div className="remote-command-step-header">
                        <strong>{index + 1}. {phaseText(t, step.phase)}</strong>
                        <span>
                          {step.destructive
                            ? t('remote.stepDestructive')
                            : step.hostMutation
                              ? t('remote.stepHostMutation')
                              : t('remote.stepReadOnly')}
                        </span>
                      </div>
                      <pre>{step.command}</pre>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="remote-receipts-panel">
            <div className="node-services-header">
              <div>
                <h3>{t('remote.receiptsTitle')}</h3>
                <p className="settings-inline-help">{t('remote.receiptsDescription')}</p>
              </div>
            </div>
            {advancedMode && fleetReceipts.length > 0 && (
              <div className="remote-fleet-receipt-list">
                {fleetReceipts.slice(-3).reverse().map((receipt) => (
                  <article className="remote-receipt" key={receipt.id}>
                    <div className="remote-command-step-header">
                      <strong>{t('remote.fleetReceiptTitle', { action: actionLabel(t, receipt.action, true), count: receipt.selectedNodeIds.length })}</strong>
                      <span className={receipt.status === 'succeeded' ? 'is-ok' : receipt.status === 'blocked' ? 'is-warn' : 'is-error'}>
                        {t(`remote.fleetReceipt.${receipt.status}`)}
                      </span>
                    </div>
                    <p className="settings-inline-help">{receipt.completedAt} · {receipt.stopReason || t('remote.fleetReceiptNoStop')}</p>
                    <ol className="remote-receipt-steps">
                      {receipt.nodeResults.map((nodeResult, index) => (
                        <li key={`${receipt.id}-${nodeResult.nodeId}`} className={stepStatusClass(nodeResult.status === 'complete' ? 'succeeded' : nodeResult.status === 'failed' ? 'failed' : nodeResult.status === 'skipped' ? 'skipped' : 'queued')}>
                          <span>{index + 1}</span>
                          <strong>{nodeResult.label}</strong>
                          <em>{t(`remote.fleetStatus.${nodeResult.status}`)}</em>
                        </li>
                      ))}
                    </ol>
                    {receipt.output && <pre className="remote-output">{receipt.output}</pre>}
                  </article>
                ))}
              </div>
            )}
            {receipts.length === 0 ? (
              <p className="settings-inline-help">{t('remote.receiptsEmpty')}</p>
            ) : (
              <div className="remote-receipt-list">
                {receipts.slice(-5).reverse().map((receipt) => (
                  <article className="remote-receipt" key={receipt.id}>
                    <div className="remote-command-step-header">
                      <strong>{receipt.nodeId} · {receipt.action}</strong>
                      <span className={receipt.status === 'succeeded' ? 'is-ok' : receipt.status === 'blocked' ? 'is-warn' : 'is-error'}>
                        {t(`remote.receipt.${receipt.status}`)}
                      </span>
                    </div>
                    <p className="settings-inline-help">{receipt.completedAt} · {t(`remote.health.${receipt.health.state}`)}</p>
                    <p className="settings-inline-help">{receipt.health.summary}</p>
                    {advancedMode && receipt.steps?.length ? (
                      <ol className="remote-receipt-steps">
                        {receipt.steps.map((step) => (
                          <li key={`${receipt.id}-${step.stepIndex}`} className={stepStatusClass(step.status)}>
                            <span>{step.stepIndex + 1}</span>
                            <strong>{t(`remote.phase.${step.phase}`)}</strong>
                            <em>{t(`remote.stepStatus.${step.status}`)}</em>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {advancedMode && receipt.output && <pre className="remote-output">{receipt.output}</pre>}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
