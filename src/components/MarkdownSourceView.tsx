interface MarkdownSourceViewProps {
  markdown: string
}

export function MarkdownSourceView({ markdown }: MarkdownSourceViewProps) {
  return (
    <pre
      className="markdown-source"
      aria-label="Markdown 源码"
      tabIndex={0}
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflowX: 'hidden' }}
    >
      <code>{markdown}</code>
    </pre>
  )
}
