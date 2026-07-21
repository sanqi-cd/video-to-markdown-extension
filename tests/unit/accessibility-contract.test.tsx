import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSettings } from '../../src/components/ModelSettings'
import { PrepareView } from '../../src/components/PrepareView'
import { ResultView } from '../../src/components/ResultView'
import { TabSwitchConfirm } from '../../src/components/TabSwitchConfirm'
import type { ProcessedDocument } from '../../src/core/task-events'

const document: ProcessedDocument = {
  metadata: {
    platform: 'youtube',
    videoId: 'accessible-video',
    title: '可访问性测试视频',
    canonicalUrl: 'https://www.youtube.com/watch?v=accessible-video',
  },
  mode: 'high-fidelity',
  generatedAt: new Date('2026-07-16T12:00:00+08:00').getTime(),
  content: [{ id: 'p1', startMs: 0, endMs: 1_000, text: '测试正文' }],
}

describe('interactive accessibility contract', () => {
  it('gives preparation and model settings controls accessible names', () => {
    const { rerender } = render(
      <PrepareView
        metadata={document.metadata}
        tracks={[{ id: 'zh', language: 'zh', label: '中文' }]}
        selectedTrackId="zh"
        trackSelection="auto"
        outputLanguage="zh"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackSelectionChange={() => {}}
        onOutputLanguageChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )

    expect(screen.getByRole('radio', { name: '中文' })).toBeChecked()
    expect(screen.getByText('字幕来源')).toBeVisible()
    expect(screen.getByRole('radio', { name: /高保真/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /AI 精炼/ })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: '保留时间戳' })).toBeVisible()

    rerender(
      <ModelSettings
        savedConfig={null}
        onSave={async () => {}}
        onSaveAndTest={async () => {}}
        onDelete={async () => {}}
      />,
    )
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('textbox', { name: 'Base URL' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '模型名称' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '流式模式' })).toBeVisible()
  })

  it('supports arrow-key tabs and roving tab focus', async () => {
    const user = userEvent.setup()
    renderResult()
    const previewTab = screen.getByRole('tab', { name: '阅读预览' })
    const sourceTab = screen.getByRole('tab', { name: 'Markdown 源码' })

    previewTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(sourceTab).toHaveFocus()
    expect(sourceTab).toHaveAttribute('aria-selected', 'true')
    expect(previewTab).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{Home}')
    expect(previewTab).toHaveFocus()
    expect(previewTab).toHaveAttribute('aria-selected', 'true')
  })

  it('moves focus inside the result menu and returns it on Escape', async () => {
    const user = userEvent.setup()
    renderResult()
    const trigger = screen.getByRole('button', { name: '更多结果操作' })

    await user.click(trigger)
    const regenerate = screen.getByRole('menuitem', { name: '按当前设置重新生成' })
    const back = screen.getByRole('menuitem', { name: '调整生成设置' })
    expect(regenerate).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(back).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the result menu when the user clicks outside it', async () => {
    const user = userEvent.setup()
    renderResult()

    await user.click(screen.getByRole('button', { name: '更多结果操作' }))
    expect(screen.getByRole('menu')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: '阅读预览' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('focuses the safe regeneration action and restores focus after cancelling', async () => {
    const user = userEvent.setup()
    renderResult()
    const trigger = screen.getByRole('button', { name: '更多结果操作' })

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: '按当前设置重新生成' }))
    const cancel = screen.getByRole('button', { name: '取消' })
    const confirm = screen.getByRole('button', { name: '确认重新生成' })
    expect(cancel).toHaveFocus()

    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('focuses and traps the safe action in the tab-switch dialog', async () => {
    const user = userEvent.setup()
    const onContinueCurrent = vi.fn()
    render(
      <TabSwitchConfirm
        nextTab={{
          tabId: 2,
          url: 'https://www.youtube.com/watch?v=next',
          video: { platform: 'youtube', videoId: 'next' },
        }}
        onContinueCurrent={onContinueCurrent}
        onStopAndSwitch={() => {}}
      />,
    )
    const safeAction = screen.getByRole('button', { name: '继续当前任务' })
    const switchAction = screen.getByRole('button', { name: '停止并加载新视频' })
    expect(safeAction).toHaveFocus()

    await user.tab({ shift: true })
    expect(switchAction).toHaveFocus()
    await user.tab()
    expect(safeAction).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onContinueCurrent).toHaveBeenCalledTimes(1)
  })
})

describe('responsive and motion CSS contract', () => {
  const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8')

  it('defines 320px two-column providers and a 520px wide desktop content cap', () => {
    expect(css).toMatch(/@media \(max-width: 359px\)[\s\S]*?\.provider-grid\s*{[\s\S]*?repeat\(2,/)
    expect(css).toMatch(/@media \(min-width: 600px\)[\s\S]*?\.app-shell__content > \*\s*{[\s\S]*?max-width: 520px/)
  })

  it('defines visible focus and reduced-motion fallbacks', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('--focus-ring')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toContain('scroll-behavior: auto !important')
  })
})

function renderResult() {
  return render(
    <ResultView
      document={document}
      includeTimestamps={false}
      chunkCount={1}
      elapsedMs={1_000}
      onCopy={async () => {}}
      onDownload={() => {}}
      onRegenerate={() => {}}
      onBackToPrepare={() => {}}
    />,
  )
}
