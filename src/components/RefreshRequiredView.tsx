import { EmptyState } from './ui/EmptyState'

export function RefreshRequiredView() {
  return (
    <EmptyState
      icon="↻"
      title="需要刷新视频页面"
      description="插件刚刚安装或更新，刷新后才能读取当前视频字幕。"
    >
      <p>刷新只会重新加载当前视频页，不会修改模型配置。</p>
    </EmptyState>
  )
}
