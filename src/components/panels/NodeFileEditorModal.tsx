import { formatTime } from '../../app/utils'

type NodeFileEditorModalProps = any

export function NodeFileEditorModal(props: NodeFileEditorModalProps) {
  const {
    t,
    nodeFileEditorOpen,
    setNodeFileEditorOpen,
    nodeFileEditorKind,
    nodeFileEditorPath,
    loadNodeManagedFile,
    hasNodeControls,
    nodeFileEditorLoading,
    nodeFileEditorSaving,
    saveNodeManagedFile,
    nodeFileEditorLastSavedAt,
    locale,
    nodeFileEditorError,
    nodeFileEditorContent,
    setNodeFileEditorContent
  } = props

  if (!nodeFileEditorOpen) return null

  return (
    <div
      className="file-editor-backdrop"
      role="presentation"
      onClick={() => setNodeFileEditorOpen(false)}
    >
          <section
            className="file-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-file-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="file-editor-header">
              <div>
                <p className="eyebrow">{t('fileEditor.eyebrow')}</p>
                <h3 id="node-file-editor-title" className="file-editor-title">
                  {nodeFileEditorKind === 'compose'
                    ? t('fileEditor.compose')
                    : nodeFileEditorKind === 'env'
                      ? t('fileEditor.env')
                      : t('fileEditor.config')}
                </h3>
                <p className="file-editor-path mono" title={nodeFileEditorPath}>
                  {nodeFileEditorPath || t('common.emptyPath')}
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setNodeFileEditorOpen(false)}
              >
                {t('common.close')}
              </button>
            </header>

            <div className="file-editor-toolbar">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void loadNodeManagedFile(nodeFileEditorKind)
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {nodeFileEditorLoading ? t('common.loading') : t('common.reload')}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void saveNodeManagedFile()
                }}
                disabled={!hasNodeControls || nodeFileEditorLoading || nodeFileEditorSaving}
              >
                {nodeFileEditorSaving ? t('common.saving') : t('common.save')}
              </button>
              <span className="file-editor-meta">
                {nodeFileEditorLastSavedAt
                  ? t('fileEditor.savedAt', { time: formatTime(nodeFileEditorLastSavedAt, locale) })
                  : nodeFileEditorLoading
                    ? t('fileEditor.loadingFile')
                    : ''}
              </span>
            </div>

            {nodeFileEditorError && (
              <div className="node-inline-error file-editor-error" role="alert">
                {nodeFileEditorError}
              </div>
            )}

            <textarea
              className="file-editor-textarea mono"
              value={nodeFileEditorContent}
              onChange={(event) => setNodeFileEditorContent(event.target.value)}
              spellCheck={false}
              disabled={nodeFileEditorLoading || nodeFileEditorSaving}
              aria-label={t('fileEditor.contentAria', { kind: nodeFileEditorKind })}
            />
          </section>
    </div>
  )
}
