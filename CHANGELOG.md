# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

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

[0.2.0]: https://github.com/sanqi-cd/video-to-markdown-extension/releases/tag/v0.2.0
[0.1.0]: https://github.com/sanqi-cd/video-to-markdown-extension/releases/tag/v0.1.0
