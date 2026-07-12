import { useCallback, useEffect, useRef, useState } from 'react'
import { PrepareView } from './PrepareView'
import { ProgressView } from './ProgressView'
import { ResultView, PartialResultView, ErrorView } from './ResultView'
import { ModelSettings } from './ModelSettings'
import { TaskOrchestrator } from '../../src/core/orchestrator'
import { YouTubeAdapter } from '../../src/adapters/youtube/adapter'
import { BilibiliAdapter } from '../../src/adapters/bilibili/adapter'
import { renderMarkdown, downloadMarkdown } from '../../src/markdown/render-markdown'
import type { TaskState, StartRequest } from '../../src/core/orchestrator'
import type { ModelConfig, ModelConfigStore } from '../../src/model/config-store'
import type { SubtitleAdapter, ModelProvider, ModelRequest, ModelResponse, VideoMetadata, SubtitleTrack } from '../../src/core/contracts'
import type { BridgePayload } from '../../src/adapters/shared/page-bridge'
import type { BilibiliContextPayload } from '../../src/adapters/bilibili/schemas'

// ── Config store ──
function createSidePanelConfigStore(): ModelConfigStore {
  const KEY = 'modelConfig'
  return {
    async get() {
      const result = await chrome.storage.local.get([KEY])
      return (result[KEY] as ModelConfig) ?? null
    },
    async set(config) {
      await chrome.storage.local.set({ [KEY]: config })
    },
    async clear() {
      await chrome.storage.local.remove([KEY])
    },
  }
}

// ── Provider that talks to background ──
function createBackgroundProvider(): ModelProvider {
  return {
    async testConnection() {
      const resp = await chrome.runtime.sendMessage({ type: 'MODEL_TEST_REQUEST' })
      if (!resp?.success) throw new Error(resp?.error ?? '连接测试失败')
    },
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const resp = await chrome.runtime.sendMessage({
        type: 'MODEL_COMPLETE_REQUEST',
        requestId: crypto.randomUUID(),
        messages: request.messages,
      })
      if (!resp?.success) throw new Error(resp?.error ?? '模型请求失败')
      return { content: resp.data.content as string }
    },
  }
}

// ── App ──

type AppPhase =
  | { tag: 'unconfigured' }
  | { tag: 'loading' }
  | { tag: 'no_video' }
  | { tag: 'ready'; metadata: VideoMetadata; tracks: SubtitleTrack[] }
  | { tag: 'task'; state: TaskState }

export function App() {
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const configStore = useRef(createSidePanelConfigStore())
  const adapterRef = useRef<SubtitleAdapter | null>(null)
  const orchestratorRef = useRef<TaskOrchestrator | null>(null)
  const [phase, setPhase] = useState<AppPhase>({ tag: 'loading' })
  const [isTesting, setIsTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [mode, setMode] = useState<'high-fidelity' | 'refined'>('high-fidelity')
  const [includeTimestamps, setIncludeTimestamps] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState('zh')

  useEffect(() => {
    void (async () => {
      const cfg = await configStore.current.get()
      if (!cfg) {
        setPhase({ tag: 'unconfigured' })
        return
      }
      setConfig(cfg)
      await loadVideoContext()
    })()
  }, [])

  const loadVideoContext = useCallback(async () => {
    setPhase({ tag: 'loading' })
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) { setPhase({ tag: 'no_video' }); return }

      // Wait a moment for content scripts to inject
      await new Promise((r) => setTimeout(r, 300))

      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'VIDEO_CONTEXT_REQUEST' })
      if (!resp?.success) {
        // Check if we're on a supported domain
        const url = tab.url ?? ''
        if (url.includes('youtube.com/watch') || url.includes('bilibili.com/video')) {
          // On a video page but no context — content script may not have injected yet
          setPhase({ tag: 'no_video' })
        } else {
          setPhase({ tag: 'no_video' })
        }
        return
      }

      const data = resp.data as Record<string, unknown>
      if ('tracks' in data) {
        const payload = data as BridgePayload
        const adapter = new YouTubeAdapter(payload)
        const metadata = await adapter.getVideoMetadata()
        const tracks = await adapter.getSubtitleTracks()
        adapterRef.current = adapter
        setSourceLanguage(tracks[0]?.language ?? 'zh')
        setSelectedTrackId(tracks[0]?.id ?? '')
        setPhase({ tag: 'ready', metadata, tracks })
      } else if ('bvid' in data) {
        const payload = data as BilibiliContextPayload
        const adapter = new BilibiliAdapter(payload)
        const metadata = await adapter.getVideoMetadata()
        const tracks = await adapter.getSubtitleTracks()
        adapterRef.current = adapter
        setSourceLanguage(tracks[0]?.language ?? 'zh')
        setSelectedTrackId(tracks[0]?.id ?? '')
        setPhase({ tag: 'ready', metadata, tracks })
      } else {
        setPhase({ tag: 'no_video' })
      }
    } catch {
      setPhase({ tag: 'no_video' })
    }
  }, [])

  const handleSaveConfig = useCallback(async (cfg: ModelConfig) => {
    await configStore.current.set(cfg)
    setConfig(cfg)
    setPhase({ tag: 'loading' })
    // Small delay so content scripts have time on the switched tab
    await new Promise((r) => setTimeout(r, 500))
    void loadVideoContext()
  }, [loadVideoContext])

  const handleTestConnection = useCallback(async (cfg: ModelConfig) => {
    setIsTesting(true)
    setTestError(null)
    try {
      // Save first, then test so background has the config
      await configStore.current.set(cfg)
      // Use background provider to test
      const provider = createBackgroundProvider()
      await provider.testConnection()
      setTestError(null)
    } catch (e) {
      setTestError(e instanceof Error ? e.message : '测试失败')
    } finally {
      setIsTesting(false)
    }
  }, [])

  const handleDeleteConfig = useCallback(async () => {
    await configStore.current.clear()
    setConfig(null)
    setPhase({ tag: 'unconfigured' })
  }, [])

  const handleStart = useCallback(() => {
    const adapter = adapterRef.current
    if (!adapter || phase.tag !== 'ready') return

    const provider = createBackgroundProvider()
    const orchestrator = new TaskOrchestrator(adapter, provider)
    orchestratorRef.current = orchestrator

    orchestrator.onStateChange((state) => setPhase({ tag: 'task', state }))
    setPhase({ tag: 'task', state: orchestrator.getState() })

    const request: StartRequest = {
      trackId: selectedTrackId,
      mode,
      sourceLanguage,
      includeTimestamps,
    }
    void orchestrator.start(request)
  }, [adapterRef, phase, selectedTrackId, mode, sourceLanguage, includeTimestamps])

  const handleCancel = useCallback(() => orchestratorRef.current?.cancel(), [])

  const handleCopy = useCallback(async () => {
    if (phase.tag === 'task' && phase.state.status === 'completed') {
      const md = renderMarkdown(phase.state.document, { includeTimestamps, generatedAt: new Date() })
      await navigator.clipboard.writeText(md)
    }
  }, [phase, includeTimestamps])

  const handleDownload = useCallback(() => {
    if (phase.tag === 'task' && phase.state.status === 'completed') {
      const doc = phase.state.document
      const md = renderMarkdown(doc, { includeTimestamps, generatedAt: new Date() })
      downloadMarkdown(doc.metadata.title, md)
    }
  }, [phase, includeTimestamps])

  // ── Render ──
  return (
    <main className="app-container">
      <h1>Video to Markdown</h1>

      {phase.tag === 'unconfigured' && (
        <ModelSettings
          onSave={handleSaveConfig}
          onTest={handleTestConnection}
          onDelete={handleDeleteConfig}
          savedConfig={config}
          isTesting={isTesting}
          testError={testError}
        />
      )}

      {phase.tag === 'loading' && (
        <div className="status-box">
          <p>正在读取视频信息…</p>
        </div>
      )}

      {phase.tag === 'no_video' && (
        <div className="status-box">
          <p>请打开 YouTube 或哔哩哔哩视频页面</p>
          <p className="hint">打开视频后点击下方按钮重试</p>
          <button type="button" onClick={() => { void loadVideoContext() }}>
            刷新页面状态
          </button>
        </div>
      )}

      {phase.tag === 'ready' && (
        <PrepareView
          metadata={phase.metadata}
          tracks={phase.tracks}
          selectedTrackId={selectedTrackId}
          mode={mode}
          includeTimestamps={includeTimestamps}
          onTrackChange={setSelectedTrackId}
          onModeChange={setMode}
          onTimestampsChange={setIncludeTimestamps}
          onStart={handleStart}
        />
      )}

      {phase.tag === 'task' && (() => {
        const { state } = phase
        return (
          <>
            {state.status === 'running' && (
              <ProgressView stage={state.stage} completed={state.completed} total={state.total}
                startedAt={state.startedAt} onCancel={handleCancel} />
            )}
            {state.status === 'completed' && (
              <ResultView document={state.document}
                markdown={renderMarkdown(state.document, { includeTimestamps, generatedAt: new Date() })}
                onCopy={handleCopy} onDownload={handleDownload} />
            )}
            {state.status === 'partial' && (
              <PartialResultView failedCount={state.failedChunks.length} onRetry={handleStart} />
            )}
            {state.status === 'failed' && <ErrorView error={state.error} />}
            {state.status === 'cancelled' && (
              <div className="status-box"><p>任务已取消</p></div>
            )}
          </>
        )
      })()}
    </main>
  )
}
