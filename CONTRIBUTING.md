# 贡献指南 / Contributing

感谢你的参与！

## 开发环境

- Node.js 22+
- pnpm 9+
- Chrome 114+

## 设置

```bash
git clone https://github.com/hardycha/video-to-markdown-extension.git
cd video-to-markdown-extension
pnpm install
```

## 开发流程

1. Fork 本仓库并创建功能分支
2. 运行 `pnpm dev` 启动开发模式
3. 在 `chrome://extensions` 加载 `.output/chrome-mv3` 目录
4. 编写代码和测试（遵循 TDD）
5. 运行 `pnpm lint && pnpm typecheck && pnpm test`
6. 提交 PR

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` 修复
- `refactor:` 重构
- `docs:` 文档
- `test:` 测试
- `chore:` 工程配置

## 测试

```bash
pnpm test              # 单元测试与集成测试
pnpm playwright test   # 端到端测试（需要先 pnpm build）
```

目标覆盖率：80%+

## Issue 与 PR

- 提交 Bug Report 时请包含复现步骤和浏览器版本
- 提交 PR 前请确保 CI 全部通过
- 大型改动请先开 Issue 讨论

## 许可证

贡献即同意代码以 [MIT](./LICENSE) 许可证发布。
