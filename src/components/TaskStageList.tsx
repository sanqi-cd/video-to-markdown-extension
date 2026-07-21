import type { TaskMode, TaskStage } from '../core/task-events'

interface TaskStageListProps {
  mode: TaskMode
  currentStage: TaskStage
}

type StageItem = { stage: TaskStage; label: string }

const COMMON_STAGES: StageItem[] = [
  { stage: 'preparing', label: '读取视频' },
  { stage: 'building-paragraphs', label: '整理字幕' },
]

export function TaskStageList({ mode, currentStage }: TaskStageListProps) {
  const stages: StageItem[] = mode === 'refined'
    ? [
        ...COMMON_STAGES,
        { stage: 'processing-refined-map', label: '理解内容' },
        { stage: 'processing-refined-reduce', label: '精炼笔记' },
      ]
    : [
        ...COMMON_STAGES,
        { stage: 'processing-high-fidelity', label: '生成正文' },
      ]
  const currentIndex = Math.max(0, stages.findIndex((item) => item.stage === currentStage))

  return (
    <ol className="task-stage-list" aria-label="生成阶段">
      {stages.map((item, index) => {
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending'
        return (
          <li
            className={`task-stage-list__item task-stage-list__item--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
            key={item.stage}
          >
            <span className="task-stage-list__marker" aria-hidden="true">
              {state === 'complete' ? '✓' : index + 1}
            </span>
            <span>{item.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
