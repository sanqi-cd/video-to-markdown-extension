# Video to Markdown

将 YouTube 和哔哩哔哩视频字幕转换为中文 Markdown 文档的 Chrome 浏览器插件。

## 功能

- **高保真模式**：保留字幕原始信息，进行清洗、断句和自然段恢复（中文字幕不调模型）
- **AI 精炼模式**：提取关键事实、观点和论证关系，生成结构化笔记
- **时间戳**：可选的时间戳链接，支持原视频定位
- **本地优先**：无需注册账号，自配 OpenAI 兼容 API Key

## 支持的平台

- YouTube（www.youtube.com）
- 哔哩哔哩（www.bilibili.com）

## 使用方式

1. 在 Chrome 中加载已解压的扩展（开发者模式）
2. 打开设置，填写 API Key、Base URL 和模型名称
3. 测试连接
4. 打开 YouTube 或 B 站视频页面，点击扩展图标打开侧边栏
5. 选择字幕轨道和处理模式，点击"开始生成"
6. 预览、复制或下载 Markdown

## 开发

```bash
pnpm install
pnpm dev       # 开发模式
pnpm build     # 生产构建
pnpm test      # 运行测试
pnpm typecheck # 类型检查
pnpm lint      # 代码检查
```

## 技术栈

- WXT（Manifest V3 扩展框架）
- React（Side Panel UI）
- TypeScript（strict）
- Zod（运行时校验）
- Vitest + Testing Library（单元/组件测试）
- Playwright（端到端测试）

## 权限

- `sidePanel`：显示侧边栏
- `storage`：本地存储配置
- `downloads`：导出 Markdown 文件
- YouTube 和 B 站的页面访问权限
- 用户配置模型来源的可选权限

## 隐私

本插件不上传任何数据到自有服务器。字幕内容通过用户配置的 API Key 发送至用户选择的模型服务商。详见 [PRIVACY.md](./PRIVACY.md)。

## 已知限制（MVP）

- 仅处理已有字幕的视频，不支持音频转写
- 仅支持 OpenAI 兼容协议的模型
- 关闭侧边栏后任务中止，不支持后台续跑
- 仅支持 Chrome 114 及以上版本

## 许可证

[MIT](./LICENSE)
