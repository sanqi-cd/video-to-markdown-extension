# 安全说明 / Security Policy

## 报告漏洞 / Reporting a Vulnerability

如果发现安全漏洞，请**不要**在公开 Issue 中披露。请通过以下方式私下报告：

1. 发送邮件至项目维护者（参见 GitHub 个人资料）
2. 或使用 GitHub 的[私下漏洞报告](https://github.com/hardycha/video-to-markdown-extension/security/advisories/new)功能

我们将在 48 小时内确认收到报告，并在修复后公开致谢。

## 安全注意事项

- **API Key**：请勿在 Issue、PR 或公开频道中粘贴 API Key。如果已泄露，请立即轮换密钥。
- **本地存储**：浏览器本地存储不是硬件级安全存储。请勿在不受信任的设备上配置 API Key。
- **HTTPS**：插件强制要求模型 API 使用 HTTPS。开发模式下允许 localhost。
- **内容安全**：插件不使用 `eval`，不将模型返回内容作为 HTML 注入页面。

## 支持版本

当前仅支持最新的发布版本。旧版本不提供安全更新。
