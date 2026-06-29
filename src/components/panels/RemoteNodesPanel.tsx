import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultRemoteFleetInventory,
  generateRemoteCommandPlan,
  normalizeRemoteFleetInventory,
  recommendedRemoteBaseDir,
  validateRemoteFleetInventory,
  type RemoteCommandPlan,
  type RemoteFleetInventory,
  type RemoteFleetInventoryInput,
  type RemoteFleetNode,
  type RemoteNodeAction,
  type RemoteNodeHealthState,
  type RemotePlanNotice,
  type RemotePlanPhase
} from '../../app/remote-nodes'
import {
  createRemoteExecutionReceipt,
  remoteExecutionConfirmationPhrase,
  validateRemoteExecutionGate,
  type RemoteExecutionReceipt
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

function normalizeReceipt(value: unknown): RemoteExecutionReceipt | null {
  if (!value || typeof value !== 'object') return null
  const receipt = value as Partial<RemoteExecutionReceipt>
  if (!receipt.id || !receipt.nodeId || !receipt.action || !receipt.health) return null
  return receipt as RemoteExecutionReceipt
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
  const [receipts, setReceipts] = useState<RemoteExecutionReceipt[]>([])
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
  const executionGate = useMemo(
    () => plan ? validateRemoteExecutionGate(inventory, plan, confirmation) : null,
    [confirmation, inventory, plan]
  )
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
    setConfirmation('')
    setExecutionState('')
  }, [activeAction, selectedNodeId])

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
      setExecutionState(result.output || (result.ok ? t('remote.executionSucceeded') : t('remote.executionFailed')))
    } catch (error) {
      setExecutionState(error instanceof Error ? error.message : t('remote.executionFailed'))
    } finally {
      setExecuting(false)
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

              {!advancedMode && (
                <div className="remote-progress-list" aria-label={t('remote.progressTitle')}>
                  <div>
                    <strong>{t('remote.progressTitle')}</strong>
                    <p className="settings-inline-help">{t('remote.progressDescription')}</p>
                  </div>
                  <ol>
                    {plan.steps.map((step, index) => (
                      <li key={`${step.phase}-${index}`}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{phaseText(t, step.phase)}</strong>
                          <p>{phaseHelpText(t, step.phase)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="remote-execution-panel">
                <div>
                  <strong>{t('remote.executionTitle')}</strong>
                  <p className="settings-inline-help">
                    {selectedNode.network === 'testnet'
                      ? t('remote.executionDescriptionTestnet')
                      : t('remote.executionDescriptionProdnet')}
                  </p>
                </div>
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
                {executionState && <pre className="remote-output">{executionState}</pre>}
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
