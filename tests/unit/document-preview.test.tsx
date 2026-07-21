import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentPreview } from '../../src/components/DocumentPreview'
import { MarkdownSourceView } from '../../src/components/MarkdownSourceView'
import { ResultView } from '../../src/components/ResultView'
import type { ProcessedDocument } from '../../src/core/task-events'

const highFidelityDocument: ProcessedDocument = {
  metadata: {
    platform: 'youtube',
    videoId: 'safe-preview',
    title: '安全预览',
    author: '测试作者',
    canonicalUrl: 'https://www.youtube.com/watch?v=safe-preview',
  },
  mode: 'high-fidelity',
  generatedAt: new Date('2026-07-16T10:00:00+08:00').getTime(),
  content: [{
    id: 'p1',
    startMs: 65_000,
    endMs: 70_000,
    text: '<img src=x onerror="alert(1)"> 只应该显示为文字',
  }],
}

describe('DocumentPreview', () => {
  it('directly renders validated domain text without injecting HTML', () => {
    const { container } = render(
      <DocumentPreview document={highFidelityDocument} includeTimestamps />,
    )

    expect(screen.getByRole('article', { name: '阅读预览' })).toBeVisible()
    expect(screen.getByText(/<img src=x/)).toBeVisible()
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '01:05' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=safe-preview&t=65s',
    )
  })

  it('renders refined sections from the domain object', () => {
    const document: ProcessedDocument = {
      ...highFidelityDocument,
      mode: 'refined',
      content: {
        overview: '整体概览',
        coreIdeas: ['观点一'],
        chapters: [{
          title: '第一章',
          body: '章节正文',
          sourceParagraphIds: ['p1'],
        }],
        importantFacts: [{ text: '事实一', sourceParagraphIds: ['p1'] }],
        conclusion: '最终结论',
      },
    }

    render(<DocumentPreview document={document} includeTimestamps={false} />)
    expect(screen.getByRole('heading', { name: '内容概览' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '第一章' })).toBeVisible()
    expect(screen.getByText('事实一')).toBeVisible()
    expect(screen.getByText('最终结论')).toBeVisible()
  })
})

describe('MarkdownSourceView', () => {
  it('is read-only, selectable and wraps without horizontal overflow', () => {
    render(<MarkdownSourceView markdown={'# 标题\n\n一段很长的 Markdown 源码'} />)
    const source = screen.getByLabelText('Markdown 源码')

    expect(source.tagName).toBe('PRE')
    expect(source).not.toHaveAttribute('contenteditable')
    expect(source).toHaveStyle({
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflowX: 'hidden',
    })
  })
})

describe('ResultView tabs', () => {
  it('opens in reading preview and switches to Markdown source', async () => {
    const user = userEvent.setup()
    render(
      <ResultView
        document={highFidelityDocument}
        includeTimestamps={false}
        chunkCount={2}
        elapsedMs={65_000}
        onCopy={async () => {}}
        onDownload={() => {}}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )

    expect(screen.getByRole('tab', { name: '阅读预览' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('article', { name: '阅读预览' })).toBeVisible()
    expect(screen.getByLabelText('生成结果摘要')).toHaveTextContent('2 个分块')
    expect(screen.getByLabelText('生成结果摘要')).toHaveTextContent('01:05')

    await user.click(screen.getByRole('tab', { name: 'Markdown 源码' }))
    expect(screen.getByRole('tabpanel').querySelector('pre.markdown-source')).toBeVisible()
    expect(screen.queryByRole('article', { name: '阅读预览' })).not.toBeInTheDocument()
  })
})
