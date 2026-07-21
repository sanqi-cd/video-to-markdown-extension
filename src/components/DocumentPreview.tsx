import type { ProcessedDocument } from '../core/task-events'
import type { Platform } from '../core/contracts'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'
import { timestampUrl } from '../markdown/render-markdown'

interface DocumentPreviewProps {
  document: ProcessedDocument
  includeTimestamps: boolean
}

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  bilibili: '哔哩哔哩',
}

const MODE_LABELS = {
  'high-fidelity': '高保真',
  refined: 'AI 精炼',
} as const

export function DocumentPreview({ document, includeTimestamps }: DocumentPreviewProps) {
  const { metadata } = document

  return (
    <article className="document-preview" aria-label="阅读预览">
      <header className="document-preview__header">
        <h2>{metadata.title}</h2>
        <p className="document-preview__metadata">
          <span>{PLATFORM_LABELS[metadata.platform]}</span>
          {metadata.author && <span>{metadata.author}</span>}
          <span>{MODE_LABELS[document.mode]}</span>
        </p>
      </header>
      {document.mode === 'high-fidelity'
        ? renderHighFidelity(document, includeTimestamps)
        : renderRefined(document)}
    </article>
  )
}

function renderHighFidelity(document: ProcessedDocument, includeTimestamps: boolean) {
  const content = document.content as TranslatedParagraph[]
  return (
    <div className="document-preview__body">
      {content.map((paragraph) => (
        <section
          className={`document-preview__paragraph${includeTimestamps ? ' document-preview__paragraph--timestamped' : ''}`}
          key={paragraph.id}
        >
          {includeTimestamps && (
            <a
              className="document-preview__timestamp"
              href={timestampUrl(
                document.metadata.platform,
                document.metadata.videoId,
                paragraph.startMs,
              )}
              target="_blank"
              rel="noreferrer"
            >
              {formatTimestamp(paragraph.startMs)}
            </a>
          )}
          <p>{paragraph.text}</p>
        </section>
      ))}
    </div>
  )
}

function renderRefined(document: ProcessedDocument) {
  const content = document.content as RefinedDocument
  const labels = document.outputLanguage === 'en'
    ? {
        overview: 'Overview',
        coreIdeas: 'Core Ideas',
        chapters: 'Chapter Notes',
        facts: 'Important Facts and Examples',
        conclusion: 'Conclusion and Takeaways',
      }
    : {
        overview: '内容概览',
        coreIdeas: '核心观点',
        chapters: '章节笔记',
        facts: '重要案例与数据',
        conclusion: '结论与启发',
      }
  return (
    <div className="document-preview__body">
      {content.overview && (
        <section className="document-preview__section">
          <h3>{labels.overview}</h3>
          <p>{content.overview}</p>
        </section>
      )}
      {content.coreIdeas.length > 0 && (
        <section className="document-preview__section">
          <h3>{labels.coreIdeas}</h3>
          <ul>{content.coreIdeas.map((idea, index) => (
            <li key={`${index}-${idea}`}>{idea}</li>
          ))}</ul>
        </section>
      )}
      {content.chapters.length > 0 && (
        <section className="document-preview__section">
          <h3>{labels.chapters}</h3>
          {content.chapters.map((chapter, index) => (
            <section className="document-preview__chapter" key={`${index}-${chapter.title}`}>
              <h4>{chapter.title}</h4>
              <p>{chapter.body}</p>
            </section>
          ))}
        </section>
      )}
      {content.importantFacts.length > 0 && (
        <section className="document-preview__section">
          <h3>{labels.facts}</h3>
          <ul>{content.importantFacts.map((fact, index) => (
            <li key={`${index}-${fact.text}`}>{fact.text}</li>
          ))}</ul>
        </section>
      )}
      {content.conclusion && (
        <section className="document-preview__section">
          <h3>{labels.conclusion}</h3>
          <p>{content.conclusion}</p>
        </section>
      )}
    </div>
  )
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}
