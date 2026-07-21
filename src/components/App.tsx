import { useCallback, useEffect, useRef, useState } from 'react'
import { PrepareView } from './PrepareView'
import { GeneratingView } from './GeneratingView'
import { PartialResultView } from './PartialResultView'
import { ResultView, ErrorView } from './ResultView'
import { ModelSettings } from './ModelSettings'
import { ModelTestView } from './ModelTestView'
import { WelcomeView } from './WelcomeView'
import { RefreshRequiredView } from './RefreshRequiredView'
import { NoSubtitleView } from './NoSubtitleView'
import { TabSwitchConfirm } from './TabSwitchConfirm'
import { AppShell } from './layout/AppShell'
import { AppHeader } from './layout/AppHeader'
import { BottomActionBar } from './layout/BottomActionBar'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { TaskOrchestrator } from '../core/orchestrator'
import {
  requiresModel,
  selectAppPage,
  type AppRoute,
  type ModelTestState,
  type VideoContextState,
} from '../core/product-state'
import { YouTubeAdapter } from '../adapters/youtube/adapter'
import { BilibiliAdapter } from '../adapters/bilibili/adapter'
import {
  activeTabIdentity,
  getActiveTabSnapshot,
  reloadTabAndWait,
  shouldConfirmTabSwitch,
  type ActiveTabSnapshot,
} from '../browser/active-tab'
import { mapVideoContextError, requestVideoContext } from '../browser/video-context'
import { useActiveVideoTab } from '../hooks/use-active-video-tab'
import { downloadMarkdown } from '../markdown/render-markdown'
import { AppError, type PublicAppError } from '../errors/app-error'
import {
  createConfigStore,
  normalizeModelConfig,
  type ModelConfig,
  type ModelConfigStore,
} from '../model/config-store'
import { requestModelOrigin } from '../model/host-permissions'
import type { ProviderId } from '../model/provider-presets'
import { BackgroundModelClient } from '../model/background-client'
import { createPreferencesStore, type UserPreferences } from '../storage/preferences'
import type { TaskState, StartRequest } from '../core/orchestrator'
import type {
  SubtitleAdapter,
  ModelProvider,
} from '../core/contracts'
import {
  preferredSubtitleTrack,
  type OutputLanguage,
} from '../core/language'

function createBackgroundProvider(): ModelProvider {
  return new BackgroundModelClient()
}

async function loadYoutubeCaption(tabId: number, trackId: string): Promise<Response> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'YOUTUBE_CAPTION_FETCH_REQUEST',
    trackId,
  })
  if (!response?.success) {
    throw new AppError(
      'SUBTITLE_EXTRACTION_FAILED',
      response?.error ?? 'YouTube 字幕请求失败',
    )
  }
  return new Response(response.body as string, { status: response.status as number })
}

function publicModelError(error: unknown): PublicAppError {
  if (error instanceof AppError) return error.toJSON()
  return {
    code: 'NETWORK_FAILED',
    message: error instanceof Error ? error.message : '模型连接测试失败',
  }
}

export function App() {
  const configStore = useRef<ModelConfigStore | null>(null)
  const preferencesStore = useRef<ReturnType<typeof createPreferencesStore> | null>(null)
  if (configStore.current === null) {
    configStore.current = createConfigStore(chrome.storage.local)
  }
  if (preferencesStore.current === null) {
    preferencesStore.current = createPreferencesStore(chrome.storage.local)
  }

  const [config, setConfig] = useState<ModelConfig | null>(null)
  const adapterRef = useRef<SubtitleAdapter | null>(null)
  const orchestratorRef = useRef<TaskOrchestrator | null>(null)
  const orchestratorUnsubscribeRef = useRef<(() => void) | null>(null)
  const currentTabRef = useRef<ActiveTabSnapshot | null>(null)
  const ignoredTabIdentityRef = useRef<string | null>(null)
  const contextLoadIdRef = useRef(0)
  const preferencesRef = useRef<UserPreferences>({
    selectedTrackId: null,
    mode: 'high-fidelity',
    includeTimestamps: false,
    outputLanguage: 'zh',
    lastProviderId: 'deepseek',
  })
  const returnRouteRef = useRef<AppRoute>('home')
  const [route, setRoute] = useState<AppRoute>('home')
  const [videoContext, setVideoContext] = useState<VideoContextState>({ status: 'loading' })
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [pendingTab, setPendingTab] = useState<ActiveTabSnapshot | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [modelTestState, setModelTestState] = useState<ModelTestState>({ status: 'idle' })
  const [modelTestConfig, setModelTestConfig] = useState<ModelConfig | null>(null)
  const [preferredProviderId, setPreferredProviderId] = useState<ProviderId>('deepseek')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [trackSelection, setTrackSelection] = useState<'auto' | string>('auto')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('zh')
  const [mode, setMode] = useState<'high-fidelity' | 'refined'>('high-fidelity')
  const [includeTimestamps, setIncludeTimestamps] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState('zh')

  const loadVideoContextForTab = useCallback(async (tab: ActiveTabSnapshot) => {
    const loadId = contextLoadIdRef.current + 1
    contextLoadIdRef.current = loadId
    currentTabRef.current = tab
    ignoredTabIdentityRef.current = null
    setPendingTab(null)
    setTaskState(null)
    setVideoContext({ status: 'loading' })
    adapterRef.current = null
    if (!tab.video) {
      setVideoContext({ status: 'unsupported' })
      return
    }

    let metadata
    try {
      const context = await requestVideoContext(tab)
      if (contextLoadIdRef.current !== loadId) return
      let adapter: SubtitleAdapter
      if (context.platform === 'youtube') {
        adapter = new YouTubeAdapter(
          context.data,
          globalThis.fetch.bind(globalThis),
          (trackId) => loadYoutubeCaption(tab.tabId, trackId),
        )
      } else {
        adapter = new BilibiliAdapter(context.data)
      }

      metadata = await adapter.getVideoMetadata()
      if (contextLoadIdRef.current !== loadId) return
      const tracks = await adapter.getSubtitleTracks()
      if (contextLoadIdRef.current !== loadId) return
      const manuallySelected = tracks.find(
        (track) => track.id === preferencesRef.current.selectedTrackId,
      )
      const selected = manuallySelected
        ?? preferredSubtitleTrack(tracks, preferencesRef.current.outputLanguage)
      adapterRef.current = adapter
      setSourceLanguage(selected?.language ?? 'zh')
      setSelectedTrackId(selected?.id ?? '')
      setTrackSelection(manuallySelected?.id ?? 'auto')
      setVideoContext({ status: 'ready', metadata, tracks })
    } catch (error) {
      if (contextLoadIdRef.current !== loadId) return
      setSelectedTrackId('')
      setTrackSelection('auto')
      setVideoContext(mapVideoContextError(error, { tabId: tab.tabId, metadata }))
    }
  }, [])

  const detectCurrentTab = useCallback(async () => {
    try {
      const tab = await getActiveTabSnapshot()
      await loadVideoContextForTab(tab)
    } catch (error) {
      setVideoContext(mapVideoContextError(error, { tabId: -1 }))
    }
  }, [loadVideoContextForTab])

  useEffect(() => {
    void (async () => {
      const [savedConfig, preferences] = await Promise.all([
        configStore.current!.get(),
        preferencesStore.current!.get(),
      ])
      preferencesRef.current = preferences
      setMode(preferences.mode)
      setIncludeTimestamps(preferences.includeTimestamps)
      setOutputLanguage(preferences.outputLanguage)
      setPreferredProviderId(preferences.lastProviderId)
      setConfig(savedConfig)
      setIsInitialized(true)
    })()
  }, [])

  useEffect(() => {
    return () => {
      orchestratorUnsubscribeRef.current?.()
      orchestratorRef.current?.cancel()
    }
  }, [])

  const handleActiveTabChange = useCallback((nextTab: ActiveTabSnapshot) => {
    const currentTab = currentTabRef.current
    const nextIdentity = activeTabIdentity(nextTab)
    if (currentTab && activeTabIdentity(currentTab) === nextIdentity) {
      ignoredTabIdentityRef.current = null
      setPendingTab(null)
      return
    }
    if (ignoredTabIdentityRef.current === nextIdentity) return

    const hasTask = taskState !== null
    if (shouldConfirmTabSwitch(currentTab, nextTab, hasTask)) {
      setPendingTab(nextTab)
      return
    }
    void loadVideoContextForTab(nextTab)
  }, [loadVideoContextForTab, taskState])

  const handleActiveTabError = useCallback((error: unknown) => {
    setVideoContext(mapVideoContextError(error, { tabId: -1 }))
  }, [])

  useActiveVideoTab({
    enabled: isInitialized,
    onChange: handleActiveTabChange,
    onError: handleActiveTabError,
  })

  const authorizeAndSave = useCallback(async (rawConfig: ModelConfig) => {
    const normalized = normalizeModelConfig(rawConfig)
    const permissionPromise = requestModelOrigin(
      normalized.baseUrl,
      (permissions) => chrome.permissions.request(permissions),
    )
    const granted = await permissionPromise
    if (!granted) {
      throw new AppError('INVALID_MODEL_CONFIG', '需要授权访问模型 API 域名才能继续')
    }
    await configStore.current!.set(normalized)
    setConfig(normalized)
    return normalized
  }, [])

  const handleSaveConfig = useCallback(async (rawConfig: ModelConfig) => {
    setSettingsError(null)
    try {
      await authorizeAndSave(rawConfig)
      setRoute(returnRouteRef.current)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '配置保存失败')
      throw error
    }
  }, [authorizeAndSave])

  const handleTestConnection = useCallback(async (rawConfig: ModelConfig) => {
    setSettingsError(null)
    let normalized: ModelConfig
    try {
      normalized = await authorizeAndSave(rawConfig)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '配置保存失败')
      throw error
    }

    const startedAt = Date.now()
    setModelTestConfig(normalized)
    setModelTestState({ status: 'testing', startedAt })
    setRoute('model-test')
    try {
      await createBackgroundProvider().testConnection()
      const latencyMs = Date.now() - startedAt
      const testedConfig: ModelConfig = {
        ...normalized,
        lastTest: { status: 'success', testedAt: Date.now(), latencyMs },
      }
      try {
        await configStore.current!.set(testedConfig)
        setConfig(testedConfig)
        setModelTestConfig(testedConfig)
        setModelTestState({ status: 'success', latencyMs })
      } catch (error) {
        setModelTestState({ status: 'failed', error: publicModelError(error) })
      }
    } catch (error) {
      const failedConfig: ModelConfig = {
        ...normalized,
        lastTest: { status: 'failed', testedAt: Date.now() },
      }
      setConfig(failedConfig)
      setModelTestConfig(failedConfig)
      setModelTestState({ status: 'failed', error: publicModelError(error) })
      try {
        await configStore.current!.set(failedConfig)
      } catch {
        // The normalized config was already saved before testing; keep the failure UI actionable.
      }
    }
  }, [authorizeAndSave])

  const handleDeleteConfig = useCallback(async () => {
    await configStore.current!.clear()
    setConfig(null)
    setModelTestConfig(null)
    setModelTestState({ status: 'idle' })
    setRoute(returnRouteRef.current)
  }, [])

  const openSettings = useCallback(() => {
    returnRouteRef.current = route === 'model-test' ? 'home' : route
    setSettingsError(null)
    setRoute('settings')
  }, [route])

  const closeSettings = useCallback(() => {
    setSettingsError(null)
    setRoute(returnRouteRef.current)
  }, [])

  const handleProviderChange = useCallback((providerId: ProviderId) => {
    setPreferredProviderId(providerId)
    preferencesRef.current.lastProviderId = providerId
    void preferencesStore.current!.set({ lastProviderId: providerId })
  }, [])

  const handleModelTestBack = useCallback(() => {
    setSettingsError(null)
    setRoute('settings')
  }, [])

  const handleModelTestContinue = useCallback(() => {
    setRoute(returnRouteRef.current)
  }, [])

  const handleTrackSelectionChange = useCallback((selection: 'auto' | string) => {
    if (videoContext.status !== 'ready') return
    const selected = selection === 'auto'
      ? preferredSubtitleTrack(videoContext.tracks, outputLanguage)
      : videoContext.tracks.find((track) => track.id === selection)
    if (!selected) return
    setTrackSelection(selection)
    setSelectedTrackId(selected.id)
    setSourceLanguage(selected.language)
    preferencesRef.current.selectedTrackId = selection === 'auto' ? null : selection
    void preferencesStore.current!.set({
      selectedTrackId: selection === 'auto' ? null : selection,
    })
  }, [outputLanguage, videoContext])

  const handleOutputLanguageChange = useCallback((language: OutputLanguage) => {
    setOutputLanguage(language)
    preferencesRef.current.outputLanguage = language
    void preferencesStore.current!.set({ outputLanguage: language })
    if (trackSelection === 'auto' && videoContext.status === 'ready') {
      const selected = preferredSubtitleTrack(videoContext.tracks, language)
      if (selected) {
        setSelectedTrackId(selected.id)
        setSourceLanguage(selected.language)
      }
    }
  }, [trackSelection, videoContext])

  const handleModeChange = useCallback((nextMode: 'high-fidelity' | 'refined') => {
    setMode(nextMode)
    preferencesRef.current.mode = nextMode
    void preferencesStore.current!.set({ mode: nextMode })
  }, [])

  const handleTimestampsChange = useCallback((enabled: boolean) => {
    setIncludeTimestamps(enabled)
    preferencesRef.current.includeTimestamps = enabled
    void preferencesStore.current!.set({ includeTimestamps: enabled })
  }, [])

  const handleStart = useCallback(() => {
    const adapter = adapterRef.current
    if (!adapter || videoContext.status !== 'ready') return
    if (requiresModel(mode, sourceLanguage, outputLanguage) && !config) {
      openSettings()
      return
    }

    const orchestrator = new TaskOrchestrator(adapter, createBackgroundProvider())
    orchestratorUnsubscribeRef.current?.()
    orchestratorRef.current = orchestrator
    orchestratorUnsubscribeRef.current = orchestrator.onStateChange(setTaskState)
    setTaskState(orchestrator.getState())

    const request: StartRequest = {
      trackId: selectedTrackId,
      mode,
      sourceLanguage,
      outputLanguage,
      includeTimestamps,
      maxInputChars: Math.max(
        4_000,
        Math.min(12_000, Math.floor((config?.contextWindow ?? 32_000) / 4)),
      ),
    }
    void orchestrator.start(request)
  }, [
    config,
    includeTimestamps,
    mode,
    openSettings,
    outputLanguage,
    selectedTrackId,
    sourceLanguage,
    videoContext,
  ])

  const handleCancel = useCallback(() => orchestratorRef.current?.cancel(), [])
  const handleRetry = useCallback(() => {
    void orchestratorRef.current?.retryFailed()
  }, [])

  const handleBackToPrepare = useCallback(() => {
    orchestratorUnsubscribeRef.current?.()
    orchestratorUnsubscribeRef.current = null
    orchestratorRef.current = null
    setTaskState(null)
  }, [])

  const handleCopy = useCallback(async (markdown: string) => {
    await navigator.clipboard.writeText(markdown)
  }, [])

  const handleDownload = useCallback((filename: string, markdown: string) => (
    downloadMarkdown(filename, markdown)
  ), [])

  const handleRefreshPage = useCallback(async () => {
    const currentTab = currentTabRef.current
    if (videoContext.status !== 'refresh-required' || !currentTab) {
      await detectCurrentTab()
      return
    }
    setVideoContext({ status: 'loading' })
    try {
      await reloadTabAndWait(videoContext.tabId)
      const refreshedTab = await getActiveTabSnapshot()
      await loadVideoContextForTab(refreshedTab)
    } catch (error) {
      setVideoContext(mapVideoContextError(error, { tabId: currentTab.tabId }))
    }
  }, [detectCurrentTab, loadVideoContextForTab, videoContext])

  const handleContinueCurrentTask = useCallback(() => {
    if (pendingTab) ignoredTabIdentityRef.current = activeTabIdentity(pendingTab)
    setPendingTab(null)
  }, [pendingTab])

  const handleStopAndSwitchTab = useCallback(() => {
    if (!pendingTab) return
    orchestratorUnsubscribeRef.current?.()
    orchestratorUnsubscribeRef.current = null
    orchestratorRef.current?.cancel()
    orchestratorRef.current = null
    setTaskState(null)
    ignoredTabIdentityRef.current = null
    const nextTab = pendingTab
    setPendingTab(null)
    void loadVideoContextForTab(nextTab)
  }, [loadVideoContextForTab, pendingTab])

  const hasPreservedContent = taskState?.completedChunks.some(
    (chunk) => chunk.content !== undefined,
  ) ?? false
  const page = selectAppPage(route, videoContext, taskState?.status, hasPreservedContent)
  const modelConnectionStatus = config === null
    ? 'missing'
    : config.lastTest?.status === 'success' ? 'connected' : 'configured'

  const footer = (() => {
    if (page === 'ready') {
      const needsModel = requiresModel(mode, sourceLanguage, outputLanguage) && !config
      return (
        <BottomActionBar hint={needsModel ? '此处理方式需要先配置模型' : undefined}>
          <Button
            variant="primary"
            fullWidth
            disabled={!selectedTrackId}
            onClick={handleStart}
          >
            {needsModel ? '配置模型并继续' : '开始生成'}
          </Button>
        </BottomActionBar>
      )
    }
    if (page === 'unsupported') {
      return (
        <BottomActionBar>
          <Button variant="secondary" fullWidth onClick={() => void detectCurrentTab()}>
            重新检测当前页面
          </Button>
        </BottomActionBar>
      )
    }
    if (page === 'refresh-required') {
      return (
        <BottomActionBar>
          <Button variant="primary" fullWidth onClick={() => void handleRefreshPage()}>
            刷新并重新检测
          </Button>
        </BottomActionBar>
      )
    }
    if (page === 'no-subtitle' || page === 'video-error') {
      return (
        <BottomActionBar>
          <Button variant="primary" fullWidth onClick={() => void detectCurrentTab()}>
            重新检测
          </Button>
        </BottomActionBar>
      )
    }
    if (page === 'generating') {
      return (
        <BottomActionBar hint="停止后会保留已经完成的内容">
          <Button variant="secondary" fullWidth onClick={handleCancel}>停止生成</Button>
        </BottomActionBar>
      )
    }
    if (page === 'task-error' || page === 'cancelled') {
      return (
        <BottomActionBar>
          <Button variant="primary" fullWidth onClick={() => void detectCurrentTab()}>
            返回生成设置
          </Button>
        </BottomActionBar>
      )
    }
    return undefined
  })()

  return (
    <>
    <AppShell
      header={(
        <AppHeader
          leading={route !== 'home'
            ? <Button
                iconOnly
                variant="text"
                aria-label="返回"
                onClick={route === 'model-test' ? handleModelTestBack : closeSettings}
              >←</Button>
            : undefined}
          action={route === 'home'
            ? <Button variant="text" onClick={openSettings}>模型设置</Button>
            : undefined}
        />
      )}
      footer={pendingTab ? undefined : footer}
    >
      {page === 'settings' && (
        <ModelSettings
          onSave={handleSaveConfig}
          onSaveAndTest={handleTestConnection}
          onDelete={handleDeleteConfig}
          onProviderChange={handleProviderChange}
          savedConfig={config}
          preferredProviderId={preferredProviderId}
          formError={settingsError}
        />
      )}

      {page === 'model-test' && modelTestConfig && (
        <ModelTestView
          state={modelTestState}
          providerId={modelTestConfig.providerId}
          baseUrl={modelTestConfig.baseUrl}
          onBackToSettings={handleModelTestBack}
          onContinue={handleModelTestContinue}
        />
      )}

      {page === 'loading' && (
        <EmptyState
          tone="loading"
          icon={<span className="loading-indicator" />}
          title="正在检测当前页面"
          description="正在读取视频信息和可用字幕…"
        />
      )}

      {page === 'unsupported' && (
        <WelcomeView />
      )}

      {page === 'refresh-required' && (
        <RefreshRequiredView />
      )}

      {page === 'no-subtitle' && videoContext.status === 'no-subtitle' && (
        <NoSubtitleView metadata={videoContext.metadata} />
      )}

      {page === 'video-error' && videoContext.status === 'failed' && (
        <div className="state-stack">
          <div className="section-heading">
            <h2>读取视频失败</h2>
            <p>没有修改当前设置，可以安全重试。</p>
          </div>
          <ErrorView error={videoContext.error} />
        </div>
      )}

      {page === 'ready' && videoContext.status === 'ready' && (
        <PrepareView
          metadata={videoContext.metadata}
          tracks={videoContext.tracks}
          selectedTrackId={selectedTrackId}
          trackSelection={trackSelection}
          outputLanguage={outputLanguage}
          mode={mode}
          includeTimestamps={includeTimestamps}
          onTrackSelectionChange={handleTrackSelectionChange}
          onOutputLanguageChange={handleOutputLanguageChange}
          onModeChange={handleModeChange}
          onTimestampsChange={handleTimestampsChange}
          onStart={handleStart}
          showAction={false}
          modelStatus={modelConnectionStatus}
        />
      )}

      {page === 'generating' && taskState?.status === 'running'
        && videoContext.status === 'ready' && (
        <GeneratingView
          snapshot={taskState}
          metadata={videoContext.metadata}
          outputLanguage={outputLanguage}
          onCancel={handleCancel}
        />
      )}

      {page === 'result' && taskState?.status === 'completed' && (
        <ResultView
          document={taskState.document}
          includeTimestamps={includeTimestamps}
          chunkCount={taskState.metrics.totalChunks}
          elapsedMs={taskState.document.generatedAt - (taskState.startedAt ?? taskState.document.generatedAt)}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onRegenerate={handleStart}
          onBackToPrepare={handleBackToPrepare}
        />
      )}

      {page === 'partial'
        && (taskState?.status === 'partial' || taskState?.status === 'cancelled')
        && videoContext.status === 'ready' && (
        <PartialResultView
          snapshot={taskState}
          metadata={videoContext.metadata}
          includeTimestamps={includeTimestamps}
          outputLanguage={outputLanguage}
          onRetry={taskState.status === 'partial' ? handleRetry : undefined}
          onExport={handleDownload}
          onBack={handleBackToPrepare}
        />
      )}

      {page === 'task-error' && taskState?.status === 'failed' && (
        <div className="state-stack">
          <div className="section-heading">
            <h2>生成没有完成</h2>
            <p>可以返回设置后重新尝试。</p>
          </div>
          <ErrorView error={taskState.error} />
        </div>
      )}

      {page === 'cancelled' && (
        <EmptyState
          title="生成已停止"
          description="你可以返回生成设置，调整选项后重新开始。"
        />
      )}
    </AppShell>
    {pendingTab && (
      <TabSwitchConfirm
        nextTab={pendingTab}
        onContinueCurrent={handleContinueCurrentTask}
        onStopAndSwitch={handleStopAndSwitchTab}
      />
    )}
    </>
  )
}
