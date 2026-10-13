# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added

- B站无字幕视频支持由用户主动捕获当前标签页音频，分段调用自定义 OpenAI 兼容语音转写服务。
- 新增独立转写配置、实时录制/转写进度、停止并保留已识别内容，以及转写字幕接入现有 Markdown 流程。
- B站无字幕视频支持手动关联完整的 YouTube 原视频链接，并读取原视频已有字幕。
- B站无字幕视频支持自动查找当前 UP 主在简介、置顶评论和 B 站 Opus 中提供的文本型文稿。
- 发布者文稿支持作者身份校验、访问受限提示、内容完整性校验和无时间轴模式。

### Fixed

- B站多 P 视频按分 P 和 CID 隔离字幕上下文，避免读取其他分 P 字幕。
- 增加字幕完整性检查和 YouTube 视频 ID 校验，阻止残缺内容或其他视频内容被误判为生成成功。
- 自动匹配多个 YouTube 候选时要求明确来源标记或标题证据，候选不明确时不再静默选择。
- 直接转录时，单段转写遇到网络错误、超时、限流或服务端错误会自动重试（最多 3 次，遵循 `Retry-After`），不再因一次抖动终止整个任务。
- 转写进度只传递新增字幕，长视频转写期间的消息体不再随时长增长。
- 后台服务重启后仍能在转写失败时停止对应标签页的播放，并自动清理残留的任务记录。

## [0.2.1] - 2026-07-28

### Fixed

- 修复 Markdown 生成时间测试依赖本机时区的问题，保证 UTC 和不同时区的 CI 环境得到一致验证结果。

### Changed

- 更新 React、React DOM、Playwright、Vite React 插件和 Prettier 等维护依赖。
- 将 GitHub Actions 更新到 Node 24 运行时版本，消除旧运行时弃用警告。

### Security

- 为 `main` 启用分支保护、必需 CI、禁止强制推送和删除。
- 启用 Dependabot 漏洞告警、安全更新、Secret Scanning 和 Push Protection。

## [0.2.0] - 2026-07-27

### Added

- 全新的 Chrome Side Panel 2.0 工作流。
- 中文与英文最终文档语言选择。
- 高保真和 AI 精炼两种处理模式。
- SSE 流式响应、分块增量预览和模型不支持流式时的安全降级。
- 分块重试、部分结果保留和失败分块单独重试。
- 阅读预览、Markdown 源码、复制和下载。
- YouTube 与哔哩哔哩已有字幕适配。
- 模型配置测试和按来源申请可选 Host Permission。

### Fixed

- 实时预览新增内容时保持阅读位置稳定，由用户主动选择是否跟随最新内容。
- 移除页面 MAIN world 脚本中的动态代码依赖，兼容 YouTube Trusted Types 安全策略。

### Security

- API Key 访问范围限制为扩展可信上下文。
- 模型 Base URL 强制使用 HTTPS，并只申请对应来源权限。
- CI 覆盖 lint、类型检查、测试覆盖率、构建、依赖审计和扩展 E2E。

## [0.1.0] - 2026-07-12

### Added

- Chrome 扩展基础框架。
- YouTube 与哔哩哔哩字幕提取 MVP。
- 高保真和 AI 精炼的初始实现。

[0.2.1]: https://github.com/sanqi-cd/video-to-markdown-extension/releases/tag/v0.2.1
[0.2.0]: https://github.com/sanqi-cd/video-to-markdown-extension/releases/tag/v0.2.0
[0.1.0]: https://github.com/sanqi-cd/video-to-markdown-extension/releases/tag/v0.1.0
