import { useCallback, useEffect, useRef, useState } from 'react'
import { PrepareView } from '../../src/components/PrepareView'
import { ProgressView } from '../../src/components/ProgressView'
import { ResultView, PartialResultView, ErrorView } from '../../src/components/ResultView'
import { ModelSettings } from '../../src/components/ModelSettings'
import { TaskOrchestrator } from '../../src/core/orchestrator'
import { YouTubeAdapter } from '../../src/adapters/youtube/adapter'
import { BilibiliAdapter } from '../../src/adapters/bilibili/adapter'
import { renderMarkdown, downloadMarkdown } from '../../src/markdown/render-markdown'
import type { TaskState, StartRequest } from '../../src/core/orchestrator'
import type { ModelConfig, ModelConfigStore } from '../../src/model/config-store'
import type { SubtitleAdapter, ModelProvider, ModelRequest, ModelResponse, VideoMetadata, SubtitleTrack } from '../../src/core/contracts'
import type { BridgePayload } from '../../src/adapters/shared/page-bridge'
import type { BilibiliContextPayload } from '../../src/adapters/bilibili/schemas'

// ── Simple in-memory config store (Side Panel has access to chrome.storage) ──
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

// ── Provider that talks to background for model calls ──
function createBackgroundProvider(): ModelProvider {
  return {
    async testConnection(signal?: AbortSignal) {
      const resp = await chrome.runtime.sendMessage({ type: 'MODEL_TEST_REQUEST' })
      if (!resp?.success) throw new Error(resp?.error ?? '连接测试失败')
    },
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
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

  // Preferences
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [mode, setMode] = useState<'high-fidelity' | 'refined'>('high-fidelity')
  const [includeTimestamps, setIncludeTimestamps] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState('zh')

  // Check config on mount, then load video context
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

  const loadVideoContext = async () => {
    setPhase({ tag: 'loading' })
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        setPhase({ tag: 'no_video' })
        return
      }
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'VIDEO_CONTEXT_REQUEST' })
      if (!resp?.success) {
        setPhase({ tag: 'no_video' })
        return
      }

      const data = resp.data as Record<string, unknown>
      // Determine platform from payload shape
      if ('tracks' in data) {
        // YouTube bridge payload
        const payload = data as BridgePayload
        const adapter = new YouTubeAdapter(payload)
        const metadata = await adapter.getVideoMetadata()
        const tracks = await adapter.getSubtitleTracks()
        adapterRef.current = adapter
        setSourceLanguage(tracks[0]?.language ?? 'zh')
        setSelectedTrackId(tracks[0]?.id ?? '')
        setPhase({ tag: 'ready', metadata, tracks })
      } else if ('bvid' in data) {
        // Bilibili bridge payload
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
  }

  const handleConfigured = useCallback((cfg: ModelConfig) => {
    setConfig(cfg)
    void loadVideoContext()
  }, [])

  const handleStart = useCallback(() => {
    const adapter = adapterRef.current
    if (!adapter || phase.tag !== 'ready') return

    const provider = createBackgroundProvider()
    const orchestrator = new TaskOrchestrator(adapter, provider)
    orchestratorRef.current = orchestrator

    orchestrator.onStateChange((state) => {
      setPhase({ tag: 'task', state })
    })

    setPhase({
      tag: 'task',
      state: orchestrator.getState(),
    })

    const request: StartRequest = {
      trackId: selectedTrackId,
      mode,
      sourceLanguage,
      includeTimestamps,
    }
    void orchestrator.start(request)
  }, [adapterRef, phase, selectedTrackId, mode, sourceLanguage, includeTimestamps])

  const handleCancel = useCallback(() => {
    orchestratorRef.current?.cancel()
  }, [])

  const handleCopy = useCallback(async () => {
    if (phase.tag === 'task' && phase.state.status === 'completed') {
      const md = renderMarkdown(phase.state.document, {
        includeTimestamps,
        generatedAt: new Date(),
      })
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
  switch (phase.tag) {
    case 'unconfigured':
      return (
        <main>
          <h1>Video to Markdown</h1>
          <ModelSettings
            onSave={async (cfg) => {
              await configStore.current.set(cfg)
              handleConfigured(cfg)
            }}
            onTest={async () => {}}
            onDelete={async () => {
              await configStore.current.clear()
              setConfig(null)
              setPhase({ tag: 'unconfigured' })
            }}
            savedConfig={config}
            isTesting={false}
            testError={null}
          />
        </main>
      )

    case 'loading':
      return (
        <main>
          <h1>Video to Markdown</h1>
          <p>正在读取视频信息…</p>
        </main>
      )

    case 'no_video':
      return (
        <main>
          <h1>Video to Markdown</h1>
          <p>请打开 YouTube 或哔哩哔哩视频页面</p>
        </main>
      )

    case 'ready':
      return (
        <main>
          <h1>Video to Markdown</h1>
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
        </main>
      )

    case 'task': {
      const { state } = phase
      return (
        <main>
          <h1>Video to Markdown</h1>
          {state.status === 'running' && (
            <ProgressView
              stage={state.stage}
              completed={state.completed}
              total={state.total}
              startedAt={state.startedAt}
              onCancel={handleCancel}
            />
          )}
          {state.status === 'completed' && (
            <ResultView
              document={state.document}
              markdown={renderMarkdown(state.document, {
                includeTimestamps,
                generatedAt: new Date(),
              })}
              onCopy={handleCopy}
              onDownload={handleDownload}
            />
          )}
          {state.status === 'partial' && (
            <PartialResultView
              failedCount={state.failedChunks.length}
              onRetry={handleStart}
            />
          )}
          {state.status === 'failed' && <ErrorView error={state.error} />}
          {state.status === 'cancelled' && <p>任务已取消</p>}
        </main>
      )
    }

    default:
      return (
        <main>
          <h1>Video to Markdown</h1>
          <p>请先配置模型</p>
        </main>
      )
  }
}
