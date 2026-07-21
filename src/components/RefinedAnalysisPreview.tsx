import type { RefinedAnalysisPreview as RefinedAnalysisPreviewData } from '../markdown/partial-document'

interface RefinedAnalysisPreviewProps {
  preview: RefinedAnalysisPreviewData
}

export function RefinedAnalysisPreview({ preview }: RefinedAnalysisPreviewProps) {
  const hasInsights = preview.chapterCandidates.length > 0
    || preview.claims.length > 0
    || preview.facts.length > 0
    || preview.people.length > 0
    || preview.examples.length > 0
    || preview.conclusions.length > 0

  return (
    <article className="live-document refined-analysis-preview" aria-label="已理解内容">
      <header className="refined-analysis-preview__header">
        <h3>阶段性理解结果</h3>
        <p>已完成 {preview.analyzedChunks} 个分块，完整结构仍在持续整理。</p>
      </header>

      {!hasInsights && (
        <p className="refined-analysis-preview__empty">
          当前分块已分析完成，暂未识别到需要单独列出的关键信息。
        </p>
      )}

      <PreviewList title="可能的内容结构" items={preview.chapterCandidates} />
      <PreviewList title="关键观点" items={preview.claims} />
      <PreviewList title="事实与数据" items={preview.facts} />
      <PreviewList title="案例" items={preview.examples} />
      <PreviewList title="初步结论" items={preview.conclusions} />

      {preview.people.length > 0 && (
        <section className="live-document__section">
          <h3>相关人物</h3>
          <p>{preview.people.join('、')}</p>
        </section>
      )}
    </article>
  )
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="live-document__section">
      <h3>{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  )
}
