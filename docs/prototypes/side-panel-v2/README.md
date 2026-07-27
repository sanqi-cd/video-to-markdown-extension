# Video to Markdown · Side Panel 2.0 原型

本目录保存 0.2.0 交互升级原型的静态导出图。Pencil 源文件由本地设计工作区维护，仓库保留可公开评审的 PNG 预览和实现说明。

设计基准为 380 × 760px Chrome Side Panel，覆盖首次使用、页面刷新、任务准备、模型配置、模型测试、实时生成、部分失败、完成结果和错误恢复。

## 画板清单

| 编号 | 状态 | 预览 |
| --- | --- | --- |
| Flow | 全局任务流程 | [flow-overview.png](./png/flow-overview.png) |
| P01 | 首次打开 / 不支持页面 | [P01-first-open.png](./png/P01-first-open.png) |
| P02 | 需要刷新页面 | [P02-refresh-required.png](./png/P02-refresh-required.png) |
| P03 | 视频准备 / 高保真 | [P03-ready-high-fidelity.png](./png/P03-ready-high-fidelity.png) |
| P04 | 视频准备 / AI 精炼未配置 | [P04-ready-ai-unconfigured.png](./png/P04-ready-ai-unconfigured.png) |
| P05 | 模型设置 | [P05-model-settings.png](./png/P05-model-settings.png) |
| P06 | 模型测试状态样式参考（实现时互斥） | [P06-model-test.png](./png/P06-model-test.png) |
| P07 | 生成中 / 等待首个响应 | [P07-generating-waiting.png](./png/P07-generating-waiting.png) |
| P08 | 生成中 / 增量内容 | [P08-generating-stream.png](./png/P08-generating-stream.png) |
| P09 | 部分完成 | [P09-partial.png](./png/P09-partial.png) |
| P10 | 完成 / 阅读预览 | [P10-result-preview.png](./png/P10-result-preview.png) |
| P11 | 完成 / Markdown 源码 | [P11-result-markdown.png](./png/P11-result-markdown.png) |
| P12 | 模型或网络错误 | [P12-error.png](./png/P12-error.png) |

## 关键交互决策

- 主流程为“识别当前视频 → 配置生成方式 → 可视化生成与导出”。
- 中文字幕高保真不强制配置模型；翻译和 AI 精炼按需引导配置。
- 页面脚本未加载时提供一键刷新，不统一归类为字幕错误。
- Level 1 分块增量展示是必须能力；Token 流式不可用时安全降级。
- 生成页区分“等待首段”和“已有增量正文”，持续展示连接、分块、字数与耗时。
- 结果默认展示阅读预览，Markdown 源码作为可切换视图。
- 每个页面最多保留一个最高权重的主操作。

## 实现基线补充

原型评审已确认可以进入开发，但静态画板不是生产界面的逐像素实现稿。进入实现时必须同时遵循以下补充约束：

- 在 P01、P02 之外补充可复用的“正在检测”和“视频无可用字幕”状态，不能把两者合并成字幕格式错误。
- P06 同时陈列测试中与成功仅用于展示视觉样式；真实界面的 `idle`、`testing`、`success`、`failed` 必须互斥。
- 任务运行中检测到活动标签页或视频发生变化时，弹出确认 Sheet，由用户选择继续当前任务或停止并加载新视频。
- 实现字号不直接照抄原型：正文不低于 13px，辅助文字不低于 12px，极少量代码或时间标签不低于 11px。
- 宽度小于 360px 时，模型服务商选择改为 2 × 2 网格；所有关键点击目标高度不低于 40px，页面不得横向滚动。

任务 0 的基线检查、问题映射和测试入口记录见：[Side Panel 2.0 原型评审](../../superpowers/reviews/2026-07-15-side-panel-2.0-prototype-review.md#56-任务-0-关闭记录)。

完整需求与验收标准见：

[产品与技术设计规格](../../superpowers/specs/2026-07-12-video-to-markdown-extension-design.md#20-side-panel-20-交互升级概述)

## 0.2.0 实现状态

P01–P12 已映射到生产 Side Panel 状态，代码实现同时纳入以下发布修正：

- 页面刷新后自动重新握手，SPA 视频切换时清理并校验视频上下文，避免复用旧字幕。
- 字幕结构合法但正文为空时停止任务，不生成空文档或调用无来源的 AI 总结。
- 精炼 Map/Reduce 与高保真翻译均校验来源段落 ID，只有完整合法的语义单元进入实时预览。
- 复制、下载、部分导出包含处理中、成功和失败反馈，极端标题具有安全文件名兜底。
- E2E 覆盖 320px、380px、600px 响应式、键盘交互、流式增量、部分失败和导出流程。

静态原型用于表达流程、层级和状态，不作为逐像素快照测试基准；生产实现以可访问性、真实内容长度和 Chrome Side Panel 响应式约束为准。
