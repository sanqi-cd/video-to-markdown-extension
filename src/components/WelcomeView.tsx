import { EmptyState } from './ui/EmptyState'

export function WelcomeView() {
  return (
    <EmptyState
      icon="▶"
      title="打开一个视频开始"
      description="支持 YouTube 和哔哩哔哩已有字幕的视频。"
    >
      <p>打开视频后回到这里，插件会自动识别字幕。</p>
    </EmptyState>
  )
}
