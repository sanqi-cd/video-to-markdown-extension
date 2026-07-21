import type { ProcessedDocument } from '../core/task-events'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'

interface ResultSummaryProps {
  document: ProcessedDocument
  chunkCount: number
  elapsedMs: number
}

const MODE_LABELS = {
  'high-fidelity': '高保真',
  refined: 'AI 精炼',
} as const

export function ResultSummary({ document, chunkCount, elapsedMs }: ResultSummaryProps) {
  return (
    <p className="result-summary" aria-label="生成结果摘要">
      <span>{MODE_LABELS[document.mode]}</span>
      <span>{chunkCount} 个分块</span>
      <span>{documentCharacterCount(document).toLocaleString('zh-CN')} 字</span>
      <span>{formatElapsed(elapsedMs)}</span>
    </p>
  )
}

export function documentCharacterCount(document: ProcessedDocument): number {
  const texts = document.mode === 'high-fidelity'
    ? (document.content as TranslatedParagraph[]).map((paragraph) => paragraph.text)
    : refinedTexts(document.content as RefinedDocument)
  return [...texts.join('')].filter((character) => !/\s/u.test(character)).length
}

function refinedTexts(content: RefinedDocument): string[] {
  return [
    content.overview,
    ...content.coreIdeas,
    ...content.chapters.flatMap((chapter) => [chapter.title, chapter.body]),
    ...content.importantFacts.map((fact) => fact.text),
    content.conclusion,
  ]
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}
