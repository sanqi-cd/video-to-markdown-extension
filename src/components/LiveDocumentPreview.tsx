import type { ProcessedDocument } from '../core/task-events'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'

interface LiveDocumentPreviewProps {
  document: ProcessedDocument
}

export function LiveDocumentPreview({ document }: LiveDocumentPreviewProps) {
  if (document.mode === 'high-fidelity') {
    return (
      <article className="live-document" aria-label="已生成内容">
        {(document.content as TranslatedParagraph[]).map((paragraph) => (
          <section className="live-document__paragraph" key={paragraph.id}>
            <span className="live-document__timestamp">{formatTimestamp(paragraph.startMs)}</span>
            <p>{paragraph.text}</p>
          </section>
        ))}
      </article>
    )
  }

  const content = document.content as RefinedDocument
  const labels = document.outputLanguage === 'en'
    ? {
        overview: 'Overview',
        coreIdeas: 'Core Ideas',
        facts: 'Important Facts and Examples',
        conclusion: 'Conclusion and Takeaways',
      }
    : {
        overview: '内容概览',
        coreIdeas: '核心观点',
        facts: '重要案例与数据',
        conclusion: '结论与启发',
      }
  return (
    <article className="live-document" aria-label="已生成内容">
      {content.overview && (
        <section className="live-document__section">
          <h3>{labels.overview}</h3>
          <p>{content.overview}</p>
        </section>
      )}
      {content.coreIdeas.length > 0 && (
        <section className="live-document__section">
          <h3>{labels.coreIdeas}</h3>
          <ul>{content.coreIdeas.map((idea) => <li key={idea}>{idea}</li>)}</ul>
        </section>
      )}
      {content.chapters.map((chapter, index) => (
        <section className="live-document__section" key={`${chapter.title}-${index}`}>
          <h3>{chapter.title}</h3>
          <p>{chapter.body}</p>
        </section>
      ))}
      {content.importantFacts.length > 0 && (
        <section className="live-document__section">
          <h3>{labels.facts}</h3>
          <ul>{content.importantFacts.map((fact, index) => (
            <li key={`${fact.text}-${index}`}>{fact.text}</li>
          ))}</ul>
        </section>
      )}
      {content.conclusion && (
        <section className="live-document__section">
          <h3>{labels.conclusion}</h3>
          <p>{content.conclusion}</p>
        </section>
      )}
    </article>
  )
}

function formatTimestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
