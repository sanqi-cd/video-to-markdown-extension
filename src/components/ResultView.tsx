import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import type { ProcessedDocument } from '../core/orchestrator'
import type { PublicAppError } from '../errors/app-error'
import { renderMarkdown } from '../markdown/render-markdown'
import { Button } from './ui/Button'
import { StatusBadge } from './ui/StatusBadge'
import { DocumentPreview } from './DocumentPreview'
import { MarkdownSourceView } from './MarkdownSourceView'
import { ResultSummary } from './ResultSummary'

interface ResultViewProps {
  document: ProcessedDocument
  includeTimestamps: boolean
  chunkCount: number
  elapsedMs: number
  onCopy: (markdown: string) => Promise<void>
  onDownload: (filename: string, markdown: string) => void | Promise<void>
  onRegenerate: () => void
  onBackToPrepare: () => void
}

export function ResultView({
  document,
  includeTimestamps,
  chunkCount,
  elapsedMs,
  onCopy,
  onDownload,
  onRegenerate,
  onBackToPrepare,
}: ResultViewProps) {
  const [activeView, setActiveView] = useState<'preview' | 'source'>('preview')
  const [copied, setCopied] = useState(false)
  const [activeOperation, setActiveOperation] = useState<'copy' | 'download' | null>(null)
  const [operationFeedback, setOperationFeedback] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTabRef = useRef<HTMLButtonElement>(null)
  const sourceTabRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const markdown = useMemo(
    () => renderMarkdown(document, { includeTimestamps }),
    [document, includeTimestamps],
  )

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    if (menuOpen) menuItemRefs.current[0]?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return

    const closeMenuFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }

    globalThis.document.addEventListener('pointerdown', closeMenuFromOutside)
    return () => globalThis.document.removeEventListener('pointerdown', closeMenuFromOutside)
  }, [menuOpen])

  const handleCopy = async () => {
    setActiveOperation('copy')
    setOperationFeedback(null)
    try {
      await onCopy(markdown)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      setCopied(false)
      setOperationFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '复制失败，请手动选择 Markdown 源码复制',
      })
    } finally {
      setActiveOperation(null)
    }
  }

  const handleDownload = async () => {
    setActiveOperation('download')
    setOperationFeedback(null)
    try {
      await onDownload(document.metadata.title, markdown)
      setOperationFeedback({ tone: 'success', message: '下载任务已创建' })
    } catch (error) {
      setOperationFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '下载失败，请稍后重试',
      })
    } finally {
      setActiveOperation(null)
    }
  }

  const handleMenuAction = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  const selectView = (view: 'preview' | 'source', focus = false) => {
    setActiveView(view)
    if (focus) {
      const ref = view === 'preview' ? previewTabRef : sourceTabRef
      ref.current?.focus()
    }
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') selectView('preview', true)
    else if (event.key === 'End') selectView('source', true)
    else selectView(activeView === 'preview' ? 'source' : 'preview', true)
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setMenuOpen(false)
      menuTriggerRef.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = menuItemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null,
    )
    if (items.length === 0) return
    const currentIndex = items.findIndex((item) => item === globalThis.document.activeElement)
    let nextIndex: number
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
    else nextIndex = (currentIndex - 1 + items.length) % items.length
    items[nextIndex]?.focus()
  }

  return (
    <div className="result-view">
      <div className="result-view__heading">
        <div>
          <StatusBadge tone="success">生成完成</StatusBadge>
          <h2>Markdown 已生成</h2>
          <p>{document.metadata.title}</p>
        </div>
        <div ref={menuRef} className="result-menu">
          <Button
            ref={menuTriggerRef}
            iconOnly
            variant="text"
            className="result-menu__trigger"
            aria-label="更多结果操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </Button>
          {menuOpen && (
            <div
              className="result-menu__popover"
              role="menu"
              aria-label="结果操作菜单"
              onKeyDown={handleMenuKeyDown}
            >
              <button
                ref={(element) => { menuItemRefs.current[0] = element }}
                type="button"
                role="menuitem"
                onClick={() => handleMenuAction(() => setRegenerateConfirmOpen(true))}
              >
                <RefreshIcon />
                <span>按当前设置重新生成</span>
              </button>
              <button
                ref={(element) => { menuItemRefs.current[1] = element }}
                type="button"
                role="menuitem"
                onClick={() => handleMenuAction(onBackToPrepare)}
              >
                <SettingsIcon />
                <span>调整生成设置</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <ResultSummary document={document} chunkCount={chunkCount} elapsedMs={elapsedMs} />

      <div className="result-tabs" role="tablist" aria-label="结果查看方式">
        <button
          ref={previewTabRef}
          type="button"
          role="tab"
          id="result-preview-tab"
          aria-selected={activeView === 'preview'}
          aria-controls="result-preview-panel"
          tabIndex={activeView === 'preview' ? 0 : -1}
          onClick={() => selectView('preview')}
          onKeyDown={handleTabKeyDown}
        >
          阅读预览
        </button>
        <button
          ref={sourceTabRef}
          type="button"
          role="tab"
          id="result-source-tab"
          aria-selected={activeView === 'source'}
          aria-controls="result-source-panel"
          tabIndex={activeView === 'source' ? 0 : -1}
          onClick={() => selectView('source')}
          onKeyDown={handleTabKeyDown}
        >
          Markdown 源码
        </button>
      </div>

      <div
        id={activeView === 'preview' ? 'result-preview-panel' : 'result-source-panel'}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={activeView === 'preview' ? 'result-preview-tab' : 'result-source-tab'}
      >
        {activeView === 'preview'
          ? <DocumentPreview document={document} includeTimestamps={includeTimestamps} />
          : <MarkdownSourceView markdown={markdown} />}
      </div>

      <div className="result-action-dock" role="group" aria-label="结果导出操作">
        <div className="result-action-dock__inner">
          {operationFeedback && (
            <div
              role={operationFeedback.tone === 'error' ? 'alert' : 'status'}
              className={`result-action-dock__feedback ${operationFeedback.tone === 'error' ? 'error' : 'success'}`}
            >
              {operationFeedback.message}
            </div>
          )}
          <div className="result-view__actions">
            <Button
              variant="primary"
              fullWidth
              disabled={activeOperation !== null}
              onClick={() => void handleCopy()}
            >
              {activeOperation === 'copy'
                ? '复制中…'
                : copied ? '已复制 Markdown' : '复制 Markdown'}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              disabled={activeOperation !== null}
              onClick={() => void handleDownload()}
            >
              {activeOperation === 'download' ? '正在下载…' : '下载 .md'}
            </Button>
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{copied ? 'Markdown 已复制' : ''}</span>

      {regenerateConfirmOpen && (
        <RegenerateConfirm
          returnFocusRef={menuTriggerRef}
          onCancel={() => setRegenerateConfirmOpen(false)}
          onConfirm={() => {
            setRegenerateConfirmOpen(false)
            onRegenerate()
          }}
        />
      )}
    </div>
  )
}

function RegenerateConfirm({
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current
    cancelRef.current?.focus()
    return () => returnFocusTarget?.focus()
  }, [returnFocusRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const first = cancelRef.current
    const last = confirmRef.current
    if (!first || !last) return
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section
        className="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regenerate-title"
        aria-describedby="regenerate-description"
        onKeyDown={handleKeyDown}
      >
        <StatusBadge tone="warning">将再次调用模型</StatusBadge>
        <div className="confirm-sheet__copy">
          <h2 id="regenerate-title">按当前设置重新生成？</h2>
          <p id="regenerate-description">
            这会重新处理当前视频，并产生一次新的模型调用费用。
          </p>
        </div>
        <div className="confirm-sheet__actions confirm-sheet__actions--horizontal">
          <Button ref={cancelRef} variant="secondary" fullWidth onClick={onCancel}>
            取消
          </Button>
          <Button ref={confirmRef} variant="primary" fullWidth onClick={onConfirm}>
            确认重新生成
          </Button>
        </div>
      </section>
    </div>
  )
}

function MoreIcon() {
  return (
    <svg className="result-menu__icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="16" cy="10" r="1.4" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="result-menu__item-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.2 6.8A6 6 0 1 0 16 12" />
      <path d="M15.2 3.8v3h-3" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="result-menu__item-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 5.5h8" />
      <path d="M14.5 5.5h2" />
      <circle cx="13" cy="5.5" r="1.5" />
      <path d="M3.5 14.5h2" />
      <path d="M8.5 14.5h8" />
      <circle cx="7" cy="14.5" r="1.5" />
    </svg>
  )
}

interface ErrorViewProps {
  error: PublicAppError
}

export function ErrorView({ error }: ErrorViewProps) {
  return (
    <div role="alert" className="error-panel">
      <StatusBadge tone="error">操作失败</StatusBadge>
      <p className="error-panel__message">{error.message}</p>
    </div>
  )
}
