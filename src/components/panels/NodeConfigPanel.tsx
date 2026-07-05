import { useState, useEffect, useCallback, useRef } from 'react'
import { parseDocument, Document, YAMLMap } from 'yaml'
import {
  CONFIG_SECTIONS,
  CONFIG_SECTION_LABEL_KEYS,
  CONFIG_SECTION_DESC_KEYS,
  getFieldsForSection,
  extractConfigValues,
  findIgnoredLegacyConfigEntries,
  type KoinosConfigValues,
  type ConfigFieldMeta,
  type IgnoredLegacyConfigEntry,
  type ConfigSection
} from '../../app/koinos-config-schema'
import { getTelenoNodeBridge, toNodeApiSettings } from '../../app/utils'
import type { NodeManagerSettings } from '../../app/types'

type NodeConfigPanelProps = {
  t: (key: string) => string
  hasNodeControls: boolean
  nodeSettings: NodeManagerSettings
  advancedMode?: boolean
}

export function NodeConfigPanel({ t, hasNodeControls, nodeSettings, advancedMode = false }: NodeConfigPanelProps) {
  const [configDoc, setConfigDoc] = useState<Document | null>(null)
  const [draftValues, setDraftValues] = useState<KoinosConfigValues>({
    global: {}, block_producer: {}, chain: {}, jsonrpc: {}, grpc: {}, mempool: {}, p2p: {}
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedBanner, setSavedBanner] = useState(false)
  const [ignoredLegacyEntries, setIgnoredLegacyEntries] = useState<IgnoredLegacyConfigEntry[]>([])
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(CONFIG_SECTIONS.filter((s) => s !== 'global'))
  )
  const bannerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadConfig = useCallback(async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge) return
    setLoading(true)
    setError(null)
    try {
      const result = await bridge.fileRead({ ...toNodeApiSettings(nodeSettings), kind: 'config' })
      if (result.ok && result.content) {
        const doc = parseDocument(result.content)
        setConfigDoc(doc)
        const parsed = doc.toJSON() || {}
        setDraftValues(extractConfigValues(parsed))
        setIgnoredLegacyEntries(findIgnoredLegacyConfigEntries(parsed))
      } else {
        setConfigDoc(null)
        setDraftValues({ global: {}, block_producer: {}, chain: {}, jsonrpc: {}, grpc: {}, mempool: {}, p2p: {} })
        setIgnoredLegacyEntries([])
        if (!result.ok) setError(result.output || t('config.loadError'))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [nodeSettings, t])

  useEffect(() => {
    if (hasNodeControls) loadConfig()
  }, [hasNodeControls, loadConfig])

  useEffect(() => {
    return () => {
      if (bannerTimeout.current) clearTimeout(bannerTimeout.current)
    }
  }, [])

  const saveConfig = async () => {
    const bridge = getTelenoNodeBridge()
    if (!bridge) return
    setSaving(true)
    setError(null)
    try {
      if (advancedMode && shouldConfirmAdvancedSave(draftValues)) {
        const confirmed = window.confirm(t('config.advancedConfirm'))
        if (!confirmed) return
      }

      const doc = configDoc ? configDoc.clone() : new Document({})

      for (const section of CONFIG_SECTIONS) {
        const sectionValues = (draftValues[section] || {}) as Record<string, unknown>
        const hasValues = Object.entries(sectionValues).some(
          ([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
        )
        if (!hasValues) continue

        // Ensure the section exists as a block-style map (not inline flow)
        let sectionNode = doc.get(section)
        if (!sectionNode || !(sectionNode instanceof YAMLMap)) {
          const newMap = new YAMLMap()
          newMap.flow = false
          doc.set(doc.createNode(section), newMap)
          sectionNode = newMap
        }
        if (sectionNode instanceof YAMLMap) {
          sectionNode.flow = false
        }

        for (const [key, value] of Object.entries(sectionValues)) {
          if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
            doc.deleteIn([section, key])
          } else if (value === false) {
            // Explicitly write false booleans (don't skip them)
            doc.setIn([section, key], false)
          } else {
            doc.setIn([section, key], value)
            // Ensure the section stays block-style after setIn
            const updated = doc.get(section)
            if (updated instanceof YAMLMap) updated.flow = false
          }
        }
      }

      const content = doc.toString()
      const result = await bridge.fileWrite({
        ...toNodeApiSettings(nodeSettings),
        kind: 'config',
        content
      })

      if (result.ok) {
        setSavedBanner(true)
        if (bannerTimeout.current) clearTimeout(bannerTimeout.current)
        bannerTimeout.current = setTimeout(() => setSavedBanner(false), 10000)
        await loadConfig()
      } else {
        setError(result.output || t('config.saveError'))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const updateField = (section: ConfigSection, key: string, value: unknown) => {
    setDraftValues((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value }
    }))
  }

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  if (!hasNodeControls) return null

  const shouldShowField = (field: ConfigFieldMeta) => {
    if (field.hidden) return false
    if (field.advanced && !advancedMode) return false
    if (field.dangerous && !advancedMode) return false
    return true
  }

  const visibleFieldsForSection = (section: ConfigSection) =>
    getFieldsForSection(section).filter(shouldShowField)

  const globalValues = draftValues.global ?? {}
  const publicRpcBind =
    /(^|[/:])0\.0\.0\.0($|[:/])/.test(`${draftValues.jsonrpc?.listen ?? ''}`) ||
    /(^|[/:])0\.0\.0\.0($|[:/])/.test(`${draftValues.grpc?.listen ?? ''}`)
  const hasRpcAcl =
    (Array.isArray(globalValues.blacklist) && globalValues.blacklist.length > 0) ||
    (Array.isArray(globalValues.whitelist) && globalValues.whitelist.length > 0)

  const renderField = (field: ConfigFieldMeta) => {
    const sectionValues = (draftValues[field.section as ConfigSection] || {}) as Record<string, unknown>
    const value = sectionValues[field.key]

    switch (field.type) {
      case 'text':
        return (
          <label key={`${field.section}.${field.key}`} className={field.dangerous ? 'config-field-dangerous' : ''}>
            <span>{t(field.labelKey)}</span>
            <input
              type="text"
              value={(value as string) ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.section as ConfigSection, field.key, e.target.value || undefined)}
            />
            <span className="settings-inline-help">{t(field.helpKey)}</span>
          </label>
        )

      case 'number':
        return (
          <label key={`${field.section}.${field.key}`} className={field.dangerous ? 'config-field-dangerous' : ''}>
            <span>{t(field.labelKey)}</span>
            <input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value !== undefined ? String(value) : ''}
              placeholder={field.placeholder}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : undefined
                updateField(field.section as ConfigSection, field.key, v)
              }}
            />
            <span className="settings-inline-help">{t(field.helpKey)}</span>
          </label>
        )

      case 'boolean':
        return (
          <label key={`${field.section}.${field.key}`} className={`settings-toggle-row ${field.dangerous ? 'config-field-dangerous' : ''}`}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => updateField(field.section as ConfigSection, field.key, e.target.checked)}
            />
            <span>{t(field.labelKey)}</span>
            <span className="settings-inline-help">{t(field.helpKey)}</span>
          </label>
        )

      case 'select':
        return (
          <label key={`${field.section}.${field.key}`} className={field.dangerous ? 'config-field-dangerous' : ''}>
            <span>{t(field.labelKey)}</span>
            <select
              value={(value as string) ?? ''}
              onChange={(e) => updateField(field.section as ConfigSection, field.key, e.target.value || undefined)}
            >
              <option value="">{t('config.default')}</option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <span className="settings-inline-help">{t(field.helpKey)}</span>
          </label>
        )

      case 'string-array':
        return (
          <label key={`${field.section}.${field.key}`} className={field.dangerous ? 'config-field-dangerous' : ''}>
            <span>{t(field.labelKey)}</span>
            <textarea
              className="mono settings-textarea"
              rows={4}
              value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
              placeholder={field.placeholder}
              onChange={(e) => {
                const lines = e.target.value.split('\n').filter((l) => l.trim())
                updateField(field.section as ConfigSection, field.key, lines.length > 0 ? lines : undefined)
              }}
            />
            <span className="settings-inline-help">{t(field.helpKey)}</span>
          </label>
        )

      default:
        return null
    }
  }

  return (
    <div className="node-config-panel">
      <div className="settings-subheader">
        <h3>{t('config.title')}</h3>
        <p>{advancedMode ? t('config.subtitleAdvanced') : t('config.subtitleSimple')}</p>
      </div>

      {loading && <p className="settings-inline-help is-busy">{t('config.loading')}</p>}
      {error && <p className="form-error">{error}</p>}
      {savedBanner && (
        <div className="config-restart-banner">
          {t('config.restartBanner')}
        </div>
      )}

      {!advancedMode && (
        <div className="config-simple-banner">
          {t('config.simpleBanner')}
        </div>
      )}

      {advancedMode && ignoredLegacyEntries.length > 0 && (
        <div className="config-legacy-banner">
          <strong>{t('config.ignoredLegacyTitle')}</strong>
          <p>{t('config.ignoredLegacyDescription')}</p>
          <ul>
            {ignoredLegacyEntries.map((entry) => (
              <li key={entry.path}>
                <code>{entry.path}</code>
                <span>{t(entry.reasonKey)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {advancedMode && publicRpcBind && !hasRpcAcl && (
        <div className="config-legacy-banner">
          <strong>{t('config.publicRpcAclTitle')}</strong>
          <p>{t('config.publicRpcAclDescription')}</p>
        </div>
      )}

      {!loading &&
        CONFIG_SECTIONS.map((section) => {
          const fields = visibleFieldsForSection(section)
          if (fields.length === 0) return null
          const collapsed = collapsedSections.has(section)
          return (
            <div key={section} className="config-section">
              <div
                className="config-section-header"
                onClick={() => toggleSection(section)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleSection(section)}
              >
                <span className="collapse-indicator">{collapsed ? '\u25b6' : '\u25bc'}</span>
                <span className="config-section-title">{t(CONFIG_SECTION_LABEL_KEYS[section])}</span>
                <span className="config-section-desc">{t(CONFIG_SECTION_DESC_KEYS[section])}</span>
              </div>
              {!collapsed && (
                <div className="config-section-fields">
                  {fields.map(renderField)}
                </div>
              )}
            </div>
          )
        })}

      {!loading && (
        <div className="settings-actions">
          <button type="button" className="ghost-button" onClick={loadConfig} disabled={loading}>
            {t('config.reload')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={saveConfig}
            disabled={saving}
          >
            {saving ? t('config.saving') : t('config.save')}
          </button>
        </div>
      )}
    </div>
  )
}

function shouldConfirmAdvancedSave(values: KoinosConfigValues): boolean {
  const globalValues = values.global ?? {}
  const featureValues = values.features ?? {}
  const jsonrpcListen = `${values.jsonrpc?.listen ?? ''}`
  const grpcListen = `${values.grpc?.listen ?? ''}`

  if (globalValues.reset === true) return true
  for (const core of ['chain', 'mempool', 'block_store', 'p2p']) {
    if (featureValues[core] === false) return true
  }
  return /(^|[/:])0\.0\.0\.0($|[:/])/.test(jsonrpcListen) || /(^|[/:])0\.0\.0\.0($|[:/])/.test(grpcListen)
}
