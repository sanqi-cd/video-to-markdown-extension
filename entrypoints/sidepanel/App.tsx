import { ProgressView } from '../../src/components/ProgressView'
import { ResultView, PartialResultView, ErrorView } from '../../src/components/ResultView'
import type { TaskState } from '../../src/core/orchestrator'

interface AppProps {
  initialState?: TaskState
}

export function App({ initialState }: AppProps) {
  const state = initialState ?? { status: 'idle' }

  return (
    <main>
      <h1>Video to Markdown</h1>
      {renderState(state)}
    </main>
  )
}

function renderState(state: TaskState) {
  switch (state.status) {
    case 'idle':
      return <p>请先配置模型</p>

    case 'running':
      return (
        <ProgressView
          stage={state.stage}
          completed={state.completed}
          total={state.total}
          startedAt={state.startedAt}
          onCancel={() => {}}
        />
      )

    case 'completed':
      return (
        <ResultView
          document={state.document}
          markdown=""
          onCopy={async () => {}}
          onDownload={() => {}}
        />
      )

    case 'partial':
      return (
        <PartialResultView
          failedCount={state.failedChunks.length}
          onRetry={() => {}}
        />
      )

    case 'failed':
      return <ErrorView error={state.error} />

    case 'cancelled':
      return <p>任务已取消</p>
  }
}
