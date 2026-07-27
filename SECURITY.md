# 安全说明 / Security Policy

## 报告漏洞 / Reporting a Vulnerability

如果发现安全漏洞，请**不要**在公开 Issue 中披露。请通过以下方式私下报告：

1. 在仓库的 [Security 页面](https://github.com/sanqi-cd/video-to-markdown-extension/security/advisories/new)使用“Report a vulnerability”私下报告
2. 如果该功能尚未启用，请通过维护者 GitHub 个人资料中的私密联系方式报告

我们将在 48 小时内确认收到报告，并在修复后公开致谢。

## 安全注意事项

- **API Key**：请勿在 Issue、PR 或公开频道中粘贴 API Key。如果已泄露，请立即轮换密钥。
- **本地存储**：API Key 保存在 `chrome.storage.local` 并限制为扩展可信上下文，但浏览器本地存储不是硬件级安全存储。请勿在不受信任的设备上配置密钥。
- **最小暴露**：API Key 只由扩展设置页和 Service Worker 使用，不进入 Content Script、网页、Port 消息、日志、错误消息或导出文档。
- **HTTPS 与权限**：模型 Base URL 必须使用 HTTPS；插件在保存时只申请该来源对应的可选 Host Permission。
- **内容安全**：插件不使用 `eval`、`new Function` 或不安全 HTML 注入。字幕和模型结果只作为文本或经过 Zod 校验的结构化数据处理。
- **取消与清理**：用户取消、任务替换、Side Panel 关闭或 Port 断开时，相关模型请求会被中止并清理。
- **第三方服务**：发送给模型服务商的字幕受该服务商的安全与隐私条款约束。本项目无法控制第三方留存策略。

## 维护者发布检查

- 发布前运行 lint、应用/E2E 类型检查、全部 Vitest、WXT 构建、Playwright E2E、依赖审计和 ZIP 完整性检查。
- GitHub Release Tag 必须与 `package.json` 版本一致。
- 不提交 `.env`、构建产物、浏览器配置、真实 API Key 或测试报告。

## 支持版本

当前安全更新仅覆盖最新的 0.2.x 发布版本。旧版本不保证继续获得安全修复。
