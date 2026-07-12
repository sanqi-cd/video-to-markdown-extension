# Video to Markdown 浏览器插件开发实施计划

> **面向执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施本计划。所有步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 构建一个开源 Chrome 浏览器插件，提取 YouTube 和哔哩哔哩已有字幕，并以高保真或 AI 精炼模式生成中文 Markdown。

**架构：** WXT 提供 Manifest V3 插件外壳。各平台 Content Script 实现统一的 `SubtitleAdapter` 契约；Side Panel 管理前台任务生命周期；Service Worker 管理模型凭证和 OpenAI 兼容请求。字幕标准化、分块、校验与渲染均实现为纯函数，以便脱离 Chrome 和实时视频网站进行测试。

**技术栈：** WXT、React、TypeScript strict、pnpm、Zod、Vitest、Testing Library、Playwright、ESLint、Prettier

## 全局约束

- 使用 Manifest V3 和 `chrome.sidePanel`，最低支持 Chrome 114。
- 仅支持 YouTube 和哔哩哔哩已有字幕轨道。
- MVP 不下载视频或音频，也不执行语音识别。
- 最终文档仅包含中文，正文不保留英文原文。
- 通过用户提供的 API Key、HTTPS Base URL 和模型名称调用 OpenAI 兼容接口。
- API Key 仅保存到 `chrome.storage.local`，不得发送给 Content Script，也不得出现在日志、错误或导出内容中。
- 不建设产品账号、云端持久化、第三方笔记同步、Side Panel 关闭后的后台续跑，以及 Gemini/Claude 原生协议。
- 中文高保真模式使用确定性清洗，不调用模型改写中文字幕。
- 所有 Content Script 消息和模型响应均视为不可信输入，必须进行运行时校验。
- 使用 MIT License；生成产物、密钥、浏览器配置和本地可视化会话不得进入 Git。

---

## 文件与模块职责图

```text
entrypoints/
  background.ts                 特权消息路由与模型调用
  youtube.content.ts            isolated world 的 YouTube 桥接
  youtube-main.content.ts       MAIN world 的 YouTube 字幕发现
  bilibili.content.ts           isolated world 的哔哩哔哩桥接
  bilibili-main.content.ts      MAIN world 的哔哩哔哩元数据发现
  sidepanel/
    index.html                  WXT Side Panel 入口
    main.tsx                    React 启动文件
    App.tsx                     顶层状态渲染
src/
  adapters/
    shared/page-bridge.ts       经校验的 MAIN 到 isolated world 事件传输
    youtube/adapter.ts          YouTube 字幕轨道与条目适配器
    youtube/schemas.ts          YouTube 响应校验
    bilibili/adapter.ts         哔哩哔哩字幕轨道与条目适配器
    bilibili/schemas.ts         哔哩哔哩响应校验
  components/
    ModelSettings.tsx           BYOK 表单与连接测试
    PrepareView.tsx             视频、字幕轨道与模式选择
    ProgressView.tsx            进度与取消界面
    ResultView.tsx              预览、复制、下载与重试界面
  core/
    contracts.ts                领域类型与适配器/模型接口
    messages.ts                 运行时校验的扩展消息
    orchestrator.ts             前台任务状态机
  errors/app-error.ts           稳定错误码与密钥脱敏
  markdown/render-markdown.ts   Markdown 与时间戳生成
  model/
    config-store.ts             本地模型配置
    host-permissions.ts         精确来源的可选权限请求
    openai-provider.ts          OpenAI 兼容客户端
    retry.ts                    重试策略与退避
  processors/
    normalize.ts                确定性字幕条目清洗
    paragraphs.ts               字幕条目到自然段的分组
    chunk.ts                    基于上下文预算的分块
    high-fidelity.ts            中文清洗或英文翻译
    refined.ts                  map/reduce 精炼笔记
    schemas.ts                  模型输出校验
  prompts/
    high-fidelity.ts            带版本的翻译提示词
    refined.ts                  带版本的 map/reduce 提示词
  storage/preferences.ts        不含密钥的界面偏好
tests/
  fixtures/youtube/             脱敏后的 YouTube 样本
  fixtures/bilibili/            脱敏后的哔哩哔哩样本
  unit/                         纯模块单元测试
  integration/                  Chrome 消息与适配器集成测试
  e2e/                          打包插件冒烟测试
```

## 任务 1：插件外壳、工程工具链与 CI

**涉及文件：**
- 新建： `package.json`
- 新建： `pnpm-workspace.yaml`
- 新建： `tsconfig.json`
- 新建： `wxt.config.ts`
- 新建： `vitest.config.ts`
- 新建： `entrypoints/background.ts`
- 新建： `entrypoints/sidepanel/index.html`
- 新建： `entrypoints/sidepanel/main.tsx`
- 新建： `entrypoints/sidepanel/App.tsx`
- 新建： `.github/workflows/ci.yml`
- 新建： `tests/unit/app-shell.test.tsx`

**接口关系：**
- 输入依赖：无。
- 产出接口：可构建的 WXT MV3 插件、`sidepanel.html`、`background.ts`、React 测试环境，以及 `lint`、`typecheck`、`test`、`build` 四条 CI 命令。

- [ ] **步骤 1：初始化依赖并编写失败的插件外壳测试**

执行：

```bash
pnpm init
pnpm add react react-dom zod
pnpm add -D wxt @wxt-dev/module-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom eslint prettier playwright
```

创建 `tests/unit/app-shell.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../entrypoints/sidepanel/App'

describe('side panel shell', () => {
  it('shows the product name and configuration state', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Video to Markdown' })).toBeVisible()
    expect(screen.getByText('请先配置模型')).toBeVisible()
  })
})
```

- [ ] **步骤 2：运行外壳测试并确认因模块缺失而失败**

执行：`pnpm vitest run tests/unit/app-shell.test.tsx`

预期：测试失败，原因是 `entrypoints/sidepanel/App.tsx` 尚不存在。

- [ ] **步骤 3：添加最小可用的 WXT 与 React 外壳**

创建 `wxt.config.ts`：

```ts
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    manifest_version: 3,
    minimum_chrome_version: '114',
    name: 'Video to Markdown',
    description: 'Convert existing video subtitles into Chinese Markdown.',
    permissions: ['sidePanel', 'storage', 'downloads'],
    host_permissions: ['https://www.youtube.com/*', 'https://www.bilibili.com/*'],
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Open Video to Markdown' },
    side_panel: { default_path: 'sidepanel.html' },
  },
})
```

创建 `entrypoints/sidepanel/App.tsx`：

```tsx
export function App() {
  return (
    <main>
      <h1>Video to Markdown</h1>
      <p>请先配置模型</p>
    </main>
  )
}
```

创建 `entrypoints/sidepanel/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

创建 `entrypoints/background.ts`：

```ts
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})
```

将 Vitest 配置为 `environment: 'jsdom'`、`globals: true`，并加载 `@testing-library/jest-dom/vitest`。TypeScript 开启 `strict: true` 和 `noUncheckedIndexedAccess: true`，继承 `.wxt/tsconfig.json`。添加 `dev`、`build`、`zip`、`lint`、`typecheck` 和 `test` 脚本。

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

创建 `tsconfig.json`：

```json
{
  "extends": ".wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

设置以下准确的包脚本：

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "postinstall": "wxt prepare"
  }
}
```

- [ ] **步骤 4：验证插件外壳、类型检查和生产构建**

执行：

```bash
pnpm test -- tests/unit/app-shell.test.tsx
pnpm typecheck
pnpm build
```

预期：测试通过，类型检查退出码为 0；`.output/chrome-mv3/manifest.json` 声明最低 Chrome 114、Side Panel、storage、downloads，并且只包含两个视频网站的主机权限。

- [ ] **步骤 5：添加 CI 并提交**

创建 `.github/workflows/ci.yml`，在 Pull Request 和推送到 `main` 时依次执行 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json wxt.config.ts vitest.config.ts entrypoints tests/unit/app-shell.test.tsx .github/workflows/ci.yml
git commit -m "chore: scaffold WXT extension shell"
```

## 任务 2：领域契约、错误模型与消息校验

**涉及文件：**
- 新建： `src/core/contracts.ts`
- 新建： `src/core/messages.ts`
- 新建： `src/errors/app-error.ts`
- 新建： `tests/unit/contracts.test.ts`
- 新建： `tests/unit/app-error.test.ts`

**接口关系：**
- 输入依赖：任务 1 引入的 Zod。
- 产出接口：`VideoMetadata`、`SubtitleTrack`、`SubtitleCue`、`VideoDocument`、`SubtitleAdapter`、`ModelProvider`、`AppError`、`parseExtensionMessage`。

- [ ] **步骤 1：编写失败的契约与密钥脱敏测试**

```ts
import { describe, expect, it } from 'vitest'
import { parseExtensionMessage } from '../../src/core/messages'
import { AppError, redactSecrets } from '../../src/errors/app-error'

describe('runtime boundaries', () => {
  it('rejects an unknown extension message', () => {
    expect(() => parseExtensionMessage({ type: 'FETCH_ANY_URL', url: 'https://evil.test' })).toThrow()
  })

  it('redacts bearer tokens and configured secrets', () => {
    expect(redactSecrets('Bearer sk-secret failed', ['sk-secret'])).toBe('Bearer [REDACTED] failed')
  })

  it('exposes a stable error code without a secret cause', () => {
    const error = new AppError('MODEL_AUTH_FAILED', '认证失败', { cause: 'sk-secret' })
    expect(error.toJSON(['sk-secret'])).toEqual({ code: 'MODEL_AUTH_FAILED', message: '认证失败' })
  })
})
```

- [ ] **步骤 2：运行测试并确认因导出缺失而失败**

执行：`pnpm vitest run tests/unit/contracts.test.ts tests/unit/app-error.test.ts`

预期：测试失败，原因是领域模块尚不存在。

- [ ] **步骤 3：实现准确的领域与消息契约**

严格按照已确认的设计定义领域类型，并添加：

```ts
export type ModelMessage = {
  role: 'system' | 'user'
  content: string
}

export type ModelRequest = {
  messages: ModelMessage[]
  responseFormat: 'json'
}

export type ModelResponse = {
  content: string
}

export interface SubtitleAdapter {
  supports(url: URL): boolean
  getVideoMetadata(): Promise<VideoMetadata>
  getSubtitleTracks(): Promise<SubtitleTrack[]>
  getCues(track: SubtitleTrack): Promise<SubtitleCue[]>
}

export interface ModelProvider {
  testConnection(signal?: AbortSignal): Promise<void>
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>
}
```

使用 Zod 可辨识联合类型，只允许以下消息：

```ts
const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('VIDEO_CONTEXT_REQUEST') }),
  z.object({ type: z.literal('SUBTITLE_CUES_REQUEST'), trackId: z.string().min(1) }),
  z.object({ type: z.literal('MODEL_TEST_REQUEST') }),
  z.object({
    type: z.literal('MODEL_COMPLETE_REQUEST'),
    requestId: z.string().uuid(),
    messages: z.array(z.object({ role: z.enum(['system', 'user']), content: z.string() })),
  }),
  z.object({ type: z.literal('MODEL_CANCEL_REQUEST'), requestId: z.string().uuid() }),
])

export function parseExtensionMessage(input: unknown) {
  return ExtensionMessageSchema.parse(input)
}
```

实现规格中确认的 10 个错误码、`AppError`、`redactSecrets`，以及仅返回 `code` 和脱敏后 `message` 的 `toJSON` 方法。

- [ ] **步骤 4：运行专项测试与完整类型检查**

执行：`pnpm vitest run tests/unit/contracts.test.ts tests/unit/app-error.test.ts && pnpm typecheck`

预期：全部测试通过，TypeScript 退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add src/core/contracts.ts src/core/messages.ts src/errors/app-error.ts tests/unit/contracts.test.ts tests/unit/app-error.test.ts
git commit -m "feat: define validated extension contracts"
```

## 任务 3：模型配置、本地存储与精确来源授权

**涉及文件：**
- 新建： `src/model/config-store.ts`
- 新建： `src/model/host-permissions.ts`
- 新建： `src/components/ModelSettings.tsx`
- 新建： `tests/unit/config-store.test.ts`
- 新建： `tests/unit/host-permissions.test.ts`
- 新建： `tests/unit/model-settings.test.tsx`

**接口关系：**
- 输入依赖：任务 2 的 `AppError`。
- 产出接口：`ModelConfig`、`ModelConfigStore`、`normalizeBaseUrl`、`requestModelOrigin`、`ModelSettings`。

- [ ] **步骤 1：编写失败的配置校验与权限测试**

```ts
import { describe, expect, it, vi } from 'vitest'
import { normalizeBaseUrl } from '../../src/model/config-store'
import { requestModelOrigin } from '../../src/model/host-permissions'

describe('model configuration', () => {
  it('normalizes an HTTPS base URL', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
  })

  it('rejects non-HTTPS remote endpoints', () => {
    expect(() => normalizeBaseUrl('http://api.example.com/v1')).toThrow('必须使用 HTTPS')
  })

  it('requests only the configured origin', async () => {
    const request = vi.fn().mockResolvedValue(true)
    await requestModelOrigin('https://api.example.com/v1', request)
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] })
  })
})
```

- [ ] **步骤 2：确认专项测试按预期失败**

执行：`pnpm vitest run tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts`

预期：测试失败，原因是相关模块尚不存在。

- [ ] **步骤 3：实现配置存储与来源授权**

```ts
export type ModelConfig = {
  apiKey: string
  baseUrl: string
  model: string
  contextWindow: number
}

export function normalizeBaseUrl(input: string, allowLocalhost = import.meta.env.DEV): string {
  const url = new URL(input)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(allowLocalhost && local)) {
    throw new AppError('INVALID_MODEL_CONFIG', '远程模型地址必须使用 HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}
```

使用单一存储键 `modelConfig` 实现 `ModelConfigStore` 的 `get`、`set` 和 `clear`。拒绝空 API Key、空模型名称及小于 4096 的上下文窗口。`requestModelOrigin` 将 Base URL 转换为 `${origin}/*`，并通过可注入函数调用 `chrome.permissions.request`。`ModelSettings` 必须遮挡密钥，不得把已存储值作为普通文本渲染，并提供保存、测试和删除回调。

- [ ] **步骤 4：验证存储、来源授权和组件行为**

执行：

```bash
pnpm vitest run tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts tests/unit/model-settings.test.tsx
pnpm typecheck
```

预期：配置校验、精确来源授权、密钥遮挡、保存、连接测试和删除用例全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/model/config-store.ts src/model/host-permissions.ts src/components/ModelSettings.tsx tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts tests/unit/model-settings.test.tsx
git commit -m "feat: add secure BYOK model settings"
```

## 任务 4：OpenAI 兼容客户端与重试策略

**涉及文件：**
- 新建： `src/model/openai-provider.ts`
- 新建： `src/model/retry.ts`
- 新建： `tests/unit/openai-provider.test.ts`
- 新建： `tests/unit/retry.test.ts`

**接口关系：**
- 输入依赖：`ModelProvider`、`ModelConfig`、`AppError`。
- 产出接口：`OpenAICompatibleProvider`、`withRetry`、`RetryPolicy`。

- [ ] **步骤 1：使用可注入 fetch 编写失败的模型客户端测试**

```ts
it('posts chat completions without exposing the key in errors', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":true}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  const provider = new OpenAICompatibleProvider(config, fetcher)
  await expect(provider.complete(request)).resolves.toEqual({ content: '{"ok":true}' })
  expect(fetcher).toHaveBeenCalledWith('https://api.example.com/v1/chat/completions', expect.objectContaining({ method: 'POST' }))
})

it.each([[401, 'MODEL_AUTH_FAILED'], [429, 'MODEL_RATE_LIMITED'], [413, 'MODEL_CONTEXT_EXCEEDED']])(
  'maps HTTP %s to %s', async (status, code) => {
    const provider = new OpenAICompatibleProvider(config, vi.fn().mockResolvedValue(new Response('{}', { status })))
    await expect(provider.complete(request)).rejects.toMatchObject({ code })
  },
)
```

- [ ] **步骤 2：运行并确认测试失败**

执行：`pnpm vitest run tests/unit/openai-provider.test.ts tests/unit/retry.test.ts`

预期：测试失败，原因是模型客户端和重试模块尚不存在。

- [ ] **步骤 3：实现模型客户端和有上限的重试策略**

模型客户端必须向 `${baseUrl}/chat/completions` 发起 POST 请求，设置 `Authorization: Bearer ${apiKey}`，发送 `{ model, messages, temperature: 0 }`，校验 `choices[0].message.content`，并确保抛出的错误不包含请求头或请求体。

```ts
export type RetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const retryable = error instanceof AppError && ['MODEL_RATE_LIMITED', 'NETWORK_FAILED'].includes(error.code)
      if (!retryable || attempt === policy.maxAttempts) throw error
      await sleep(Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1)))
    }
  }
  throw new AppError('NETWORK_FAILED', '模型请求失败')
}
```

最多尝试 3 次；服务端提供 `Retry-After` 时应解析并限制最大等待时间；`AbortSignal` 取消后立即终止。

- [ ] **步骤 4：验证模型调用、重试与密钥脱敏**

执行：`pnpm vitest run tests/unit/openai-provider.test.ts tests/unit/retry.test.ts tests/unit/app-error.test.ts && pnpm typecheck`

预期：成功响应、状态码映射、取消、重试上限和密钥脱敏用例全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/model/openai-provider.ts src/model/retry.ts tests/unit/openai-provider.test.ts tests/unit/retry.test.ts
git commit -m "feat: add OpenAI compatible model provider"
```

## 任务 5：确定性字幕标准化、自然段恢复与分块

**涉及文件：**
- 新建： `src/processors/normalize.ts`
- 新建： `src/processors/paragraphs.ts`
- 新建： `src/processors/chunk.ts`
- 新建： `tests/unit/normalize.test.ts`
- 新建： `tests/unit/paragraphs.test.ts`
- 新建： `tests/unit/chunk.test.ts`

**接口关系：**
- 输入依赖：`SubtitleCue`。
- 产出接口：`normalizeCues(cues)`、`buildParagraphs(cues, options)`、`chunkParagraphs(paragraphs, budget)`。

- [ ] **步骤 1：编写失败的字幕处理行为测试**

```ts
it('removes rolling-caption overlap without losing new words', () => {
  const cues = [
    { id: '1', startMs: 0, endMs: 1000, text: 'Welcome to the show' },
    { id: '2', startMs: 900, endMs: 2000, text: 'to the show today we discuss agents' },
  ]
  expect(normalizeCues(cues).map((cue) => cue.text)).toEqual([
    'Welcome to the show',
    'today we discuss agents',
  ])
})

it('never splits a paragraph across chunks', () => {
  const chunks = chunkParagraphs(paragraphs, { maxInputChars: 80, overlapParagraphs: 1 })
  expect(chunks.flatMap((chunk) => chunk.paragraphs).every((paragraph) => paragraphs.includes(paragraph))).toBe(true)
})
```

- [ ] **步骤 2：确认测试在实现前失败**

执行：`pnpm vitest run tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts`

预期：测试失败，原因是字幕处理函数尚不存在。

- [ ] **步骤 3：实现无副作用的纯处理函数**

`normalizeCues` 必须解码实体、合并多余空白、移除空字幕和完全重复字幕、计算最长的后缀/前缀词语重叠，并保留时间和 ID。`buildParagraphs` 持续合并相邻字幕，直到出现结束标点、间隔超过 1500 毫秒，或达到 600 个中文字符。每个自然段使用首尾字幕 ID 生成稳定 ID，并保留 `startMs`、`endMs` 和 `cueIds`。

```ts
export type SubtitleParagraph = {
  id: string
  startMs: number
  endMs: number
  cueIds: string[]
  text: string
}

export type ParagraphChunk = {
  id: string
  paragraphs: SubtitleParagraph[]
  inputChars: number
}
```

`chunkParagraphs` 必须在单个自然段超过预算时抛出 `MODEL_CONTEXT_EXCEEDED`，保持原始顺序，并且只在 AI 精炼模式中增加重叠段落。

- [ ] **步骤 4：运行专项测试并验证处理不变量**

执行：`pnpm vitest run tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts && pnpm typecheck`

预期：测试证明字幕按序完整覆盖、ID 稳定、不产生空字幕、不硬切自然段，并且分块大小不超过预算。

- [ ] **步骤 5：提交**

```bash
git add src/processors/normalize.ts src/processors/paragraphs.ts src/processors/chunk.ts tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts
git commit -m "feat: add deterministic subtitle pipeline"
```

## 任务 6：高保真与 AI 精炼处理器

**涉及文件：**
- 新建： `src/processors/schemas.ts`
- 新建： `src/processors/high-fidelity.ts`
- 新建： `src/processors/refined.ts`
- 新建： `src/prompts/high-fidelity.ts`
- 新建： `src/prompts/refined.ts`
- 新建： `tests/unit/high-fidelity.test.ts`
- 新建： `tests/unit/refined.test.ts`

**接口关系：**
- 输入依赖：`ModelProvider`、`SubtitleParagraph`、`ParagraphChunk`、`AppError`。
- 产出接口：`processHighFidelity`、`processRefined`、`TranslatedParagraph`、`RefinedDocument`。

- [ ] **步骤 1：编写失败的段落覆盖与幻觉边界测试**

```ts
it('returns Chinese paragraphs unchanged without calling the model', async () => {
  const complete = vi.fn()
  const result = await processHighFidelity(chineseParagraphs, 'zh', { complete } as never)
  expect(result.map((item) => item.text)).toEqual(chineseParagraphs.map((item) => item.text))
  expect(complete).not.toHaveBeenCalled()
})

it('rejects translated output with a missing paragraph id', async () => {
  const provider = providerReturning({ paragraphs: [{ id: 'p1', text: '第一段' }] })
  await expect(processHighFidelity(twoEnglishParagraphs, 'en', provider)).rejects.toMatchObject({
    code: 'MODEL_RESPONSE_INVALID',
  })
})

it('omits an empty facts section instead of inventing content', async () => {
  const result = await processRefined(chunks, providerReturningValidMapsAndReduce())
  expect(result.importantFacts).toEqual([])
})
```

- [ ] **步骤 2：运行并确认处理器测试失败**

执行：`pnpm vitest run tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts`

预期：测试失败，原因是处理器模块尚不存在。

- [ ] **步骤 3：实现带版本的提示词与输出校验**

高保真翻译使用 Zod Schema 强制要求准确的自然段 ID；比较输入与输出 ID 集合，拒绝缺失、重复或未知 ID。中文字幕路径直接返回确定性清洗后的自然段。

AI 精炼模式的 map 阶段输出 `chapterCandidates`、`claims`、`facts`、`people`、`examples` 和 `conclusions`，每项都携带来源自然段 ID；reduce 阶段输出 `overview`、`coreIdeas`、`chapters`、`importantFacts` 和 `conclusion`。每个时间戳引用都必须来自有效的来源自然段 ID。

```ts
export type TranslatedParagraph = {
  id: string
  startMs: number
  endMs: number
  text: string
}

export type RefinedChapter = {
  title: string
  body: string
  sourceParagraphIds: string[]
}

export type RefinedDocument = {
  overview: string
  coreIdeas: string[]
  chapters: RefinedChapter[]
  importantFacts: Array<{ text: string; sourceParagraphIds: string[] }>
  conclusion: string
}

export type ProcessorProgress = {
  stage: 'translate' | 'map' | 'reduce'
  completedChunks: number
  totalChunks: number
}

export async function processHighFidelity(
  paragraphs: SubtitleParagraph[],
  sourceLanguage: string,
  provider: ModelProvider,
  onProgress?: (progress: ProcessorProgress) => void,
  signal?: AbortSignal,
): Promise<TranslatedParagraph[]> {
  if (sourceLanguage.startsWith('zh')) return paragraphs.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text }))
  return translateAndValidateAllChunks(paragraphs, provider, onProgress, signal)
}
```

提示词以 `HIGH_FIDELITY_PROMPT_V1` 这类带版本的常量导出；要求模型只返回 JSON，并明确禁止在高保真模式中总结或补充无字幕依据的事实。

- [ ] **步骤 4：验证两种处理模式**

执行：`pnpm vitest run tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts && pnpm typecheck`

预期：中文字幕直通、英文 ID 覆盖、map/reduce 来源追溯、取消、部分失败及空章节省略用例全部通过。

- [ ] **步骤 5：提交**

```bash
git add src/processors src/prompts tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts
git commit -m "feat: add high fidelity and refined processors"
```

## 任务 7：YouTube 字幕适配器与脱敏样本

**涉及文件：**
- 新建： `entrypoints/youtube-main.content.ts`
- 新建： `entrypoints/youtube.content.ts`
- 新建： `src/adapters/shared/page-bridge.ts`
- 新建： `src/adapters/youtube/schemas.ts`
- 新建： `src/adapters/youtube/adapter.ts`
- 新建： `tests/fixtures/youtube/player-response.json`
- 新建： `tests/fixtures/youtube/captions.json3`
- 新建： `tests/integration/youtube-adapter.test.ts`

**接口关系：**
- 输入依赖：`SubtitleAdapter`、领域类型和已校验消息。
- 产出接口：`YouTubeAdapter`、`extractYouTubeBridgePayload(input: unknown): YouTubeBridgePayload`，以及脱敏后的页面桥接数据 `{ videoId, metadata, tracks }`。

- [ ] **步骤 1：添加脱敏样本并编写失败的适配器测试**

手工构造最小样本，只包含一个公开的虚拟视频 ID、两个字幕轨道和三条字幕事件。不得复制 Cookie、授权请求头、访客数据或无关的播放器响应字段。

```ts
it('maps caption tracks and JSON3 events to domain objects', async () => {
  const adapter = new YouTubeAdapter(pagePayload, fixtureFetcher)
  expect(await adapter.getSubtitleTracks()).toEqual([
    { id: 'en', language: 'en', label: 'English', isAutoGenerated: false },
    { id: 'zh-Hans', language: 'zh-Hans', label: '中文（简体）', isAutoGenerated: false },
  ])
  expect((await adapter.getCues({ id: 'en' } as never))[0]).toEqual({
    id: 'yt-0', startMs: 1200, endMs: 2800, text: 'Welcome to the test.',
  })
})
```

- [ ] **步骤 2：确认适配器测试失败**

执行：`pnpm vitest run tests/integration/youtube-adapter.test.ts`

预期：测试失败，原因是 `YouTubeAdapter` 尚不存在。

- [ ] **步骤 3：实现经过校验的 YouTube 页面桥接与适配器**

MAIN world 入口仅读取 `ytInitialPlayerResponse.videoDetails` 和 `captions.playerCaptionsTracklistRenderer.captionTracks`，裁剪为桥接 Schema 后，通过带命名空间的 `CustomEvent` 发送。isolated world 入口必须先校验事件数据，再响应扩展消息。

```ts
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const response = (window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse
    window.dispatchEvent(new CustomEvent('video-to-md:youtube-context', {
      detail: extractYouTubeBridgePayload(response),
    }))
  },
})
```

请求前校验字幕 `baseUrl` 使用 HTTPS，并且属于预期的 YouTube/Google 视频域名。追加 `fmt=json3`，只解析事件时间与分段文本，将提取失败映射为 `SUBTITLE_EXTRACTION_FAILED`。页面不得提供任意请求头或请求方法。

- [ ] **步骤 4：验证样本、安全检查与构建**

执行：`pnpm vitest run tests/integration/youtube-adapter.test.ts && pnpm build`

预期：样本映射和恶意字幕 URL 拒绝测试通过，WXT 构建产物包含两个 YouTube Content Script。

- [ ] **步骤 5：提交**

```bash
git add entrypoints/youtube-main.content.ts entrypoints/youtube.content.ts src/adapters/shared/page-bridge.ts src/adapters/youtube tests/fixtures/youtube tests/integration/youtube-adapter.test.ts
git commit -m "feat: extract existing YouTube captions"
```

## 任务 8：哔哩哔哩字幕适配器与脱敏样本

**涉及文件：**
- 新建： `entrypoints/bilibili-main.content.ts`
- 新建： `entrypoints/bilibili.content.ts`
- 新建： `src/adapters/bilibili/schemas.ts`
- 新建： `src/adapters/bilibili/adapter.ts`
- 新建： `tests/fixtures/bilibili/player-context.json`
- 新建： `tests/fixtures/bilibili/player-subtitles.json`
- 新建： `tests/fixtures/bilibili/subtitle-body.json`
- 新建： `tests/integration/bilibili-adapter.test.ts`

**接口关系：**
- 输入依赖：共享页面桥接与领域契约。
- 产出接口：`BilibiliAdapter`、`extractBilibiliBridgePayload(input: unknown): BilibiliBridgePayload`，以及脱敏后的桥接数据 `{ bvid, aid, cid, title, author }`。

- [ ] **步骤 1：添加最小化样本并编写失败的映射测试**

```ts
it('maps Bilibili subtitle seconds to milliseconds', async () => {
  const adapter = new BilibiliAdapter(contextFixture, fixtureFetcher)
  const tracks = await adapter.getSubtitleTracks()
  expect(tracks[0]).toMatchObject({ id: 'zh-CN', language: 'zh-CN', label: '中文' })
  expect((await adapter.getCues(tracks[0]!))[0]).toEqual({
    id: 'bili-0', startMs: 1500, endMs: 3200, text: '欢迎来到测试视频。',
  })
})
```

- [ ] **步骤 2：确认适配器测试失败**

执行：`pnpm vitest run tests/integration/bilibili-adapter.test.ts`

预期：测试失败，原因是 `BilibiliAdapter` 尚不存在。

- [ ] **步骤 3：实现哔哩哔哩元数据、字幕轨道和字幕条目映射**

MAIN world 入口仅读取哔哩哔哩页面状态中的当前视频标识与公开元数据。isolated world 适配器使用当前 `bvid/cid` 请求该视频的播放器字幕元数据，校验响应后，只获取同一视频返回的字幕 URL。

```ts
const BilibiliCueSchema = z.object({
  from: z.number().nonnegative(),
  to: z.number().nonnegative(),
  content: z.string(),
})

function mapCue(cue: z.infer<typeof BilibiliCueSchema>, index: number): SubtitleCue {
  return {
    id: `bili-${index}`,
    startMs: Math.round(cue.from * 1000),
    endMs: Math.round(cue.to * 1000),
    text: cue.content,
  }
}
```

强制使用 HTTPS；只允许经过校验的响应中返回的哔哩哔哩字幕域名；凭证仅发送到同源哔哩哔哩地址；字幕数组缺失时映射为 `NO_SUBTITLE`。

- [ ] **步骤 4：验证样本与构建**

执行：`pnpm vitest run tests/integration/bilibili-adapter.test.ts && pnpm build`

预期：字幕轨道与条目映射、秒到毫秒转换、无字幕、异常响应和恶意 URL 拒绝用例全部通过。

- [ ] **步骤 5：提交**

```bash
git add entrypoints/bilibili-main.content.ts entrypoints/bilibili.content.ts src/adapters/bilibili tests/fixtures/bilibili tests/integration/bilibili-adapter.test.ts
git commit -m "feat: extract existing Bilibili captions"
```

## 任务 9：Service Worker 路由与前台任务编排器

**涉及文件：**
- 修改： `entrypoints/background.ts`
- 新建： `src/core/orchestrator.ts`
- 新建： `tests/integration/background-routing.test.ts`
- 新建： `tests/unit/orchestrator.test.ts`

**接口关系：**
- 输入依赖：已校验消息、配置存储、模型客户端、重试策略、平台适配器和内容处理器。
- 产出接口：`createBackgroundRouter`、`TaskOrchestrator`、`TaskState`、`TaskEvent`。

- [ ] **步骤 1：编写失败的路由与状态机测试**

```ts
it('never returns model configuration to a content-script sender', async () => {
  const router = createBackgroundRouter(dependencies)
  await expect(router({ type: 'MODEL_TEST_REQUEST' }, contentScriptSender)).rejects.toMatchObject({
    code: 'INVALID_MODEL_CONFIG',
  })
})

it('preserves successful chunks when one chunk fails', async () => {
  const orchestrator = new TaskOrchestrator(dependenciesWithSecondChunkFailure)
  const state = await orchestrator.start(request)
  expect(state.status).toBe('partial')
  expect(state.completedChunks).toHaveLength(1)
  expect(state.failedChunks).toHaveLength(1)
})
```

- [ ] **步骤 2：运行并确认测试失败**

执行：`pnpm vitest run tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts`

预期：测试失败，原因是路由器和编排器尚不存在。

- [ ] **步骤 3：实现显式消息路由与任务状态**

```ts
export type ProcessedChunk = {
  id: string
  content: unknown
}

export type FailedChunk = {
  id: string
  error: PublicAppError
}

export type PublicAppError = {
  code: ErrorCode
  message: string
}

export type ProcessedDocument = {
  metadata: VideoMetadata
  mode: 'high-fidelity' | 'refined'
  content: TranslatedParagraph[] | RefinedDocument
}

export type TaskState =
  | { status: 'idle' }
  | { status: 'running'; stage: string; completed: number; total: number; startedAt: number }
  | { status: 'partial'; completedChunks: ProcessedChunk[]; failedChunks: FailedChunk[] }
  | { status: 'completed'; document: ProcessedDocument }
  | { status: 'failed'; error: PublicAppError }
  | { status: 'cancelled'; completedChunks: ProcessedChunk[] }
```

后台路由器必须解析每条消息、检查 `sender.url`、只允许扩展页面发起模型请求、为每个请求 UUID 创建 `AbortController`，并且只暴露脱敏错误。编排器依次读取视频上下文和字幕、标准化、恢复自然段、处理、渲染，并发出不可变状态更新。`cancel()` 中止活动请求；`retryFailed()` 复用成功分块，只调度失败 ID。

- [ ] **步骤 4：验证消息路由、任务取消与部分结果恢复**

执行：`pnpm vitest run tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts && pnpm typecheck`

预期：发送者校验、任务取消、页面切换提示事件、部分结果保留和单分块重试用例全部通过。

- [ ] **步骤 5：提交**

```bash
git add entrypoints/background.ts src/core/orchestrator.ts tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts
git commit -m "feat: orchestrate foreground conversion tasks"
```

## 任务 10：Markdown 渲染、Side Panel 状态、复制与下载

**涉及文件：**
- 新建： `src/markdown/render-markdown.ts`
- 新建： `src/storage/preferences.ts`
- 新建： `src/components/PrepareView.tsx`
- 新建： `src/components/ProgressView.tsx`
- 新建： `src/components/ResultView.tsx`
- 修改： `entrypoints/sidepanel/App.tsx`
- 新建： `tests/unit/render-markdown.test.ts`
- 新建： `tests/unit/sidepanel-flow.test.tsx`

**接口关系：**
- 输入依赖：`TaskOrchestrator`、领域文档和 `ModelSettings`。
- 产出接口：`renderMarkdown`、`timestampUrl`，以及完整的准备中、运行中、部分完成、已完成和错误界面。

- [ ] **步骤 1：编写失败的渲染器与 UI 流程测试**

```ts
it('renders Chinese-only metadata and YouTube timestamps', () => {
  const markdown = renderMarkdown(highFidelityDocument, { includeTimestamps: true })
  expect(markdown).toContain('# AI 智能体如何工作')
  expect(markdown).toContain('[00:03:24](https://www.youtube.com/watch?v=video123&t=204s)')
  expect(markdown).not.toContain('How AI agents work')
})

it('shows retry for a partial task and download for a completed task', () => {
  const { rerender } = render(<App initialState={partialState} />)
  expect(screen.getByRole('button', { name: '重试失败部分' })).toBeVisible()
  rerender(<App initialState={completedState} />)
  expect(screen.getByRole('button', { name: '下载 .md' })).toBeVisible()
})
```

- [ ] **步骤 2：确认测试失败**

执行：`pnpm vitest run tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx`

预期：测试失败，原因是渲染器和界面组件尚不存在。

- [ ] **步骤 3：实现安全的 Markdown 与全部已确认界面状态**

`renderMarkdown` 必须输出标题、可用元数据、来源 URL、处理模式、本地 ISO 时间戳和模式专属章节。平台元数据中的 Markdown 控制字符必须转义；时间戳只能由已校验的来源自然段 ID 生成；作者、事实或案例为空时省略对应章节。

```ts
export type RenderOptions = {
  includeTimestamps: boolean
  generatedAt: Date
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  chrome.downloads.download({ url, filename: `${sanitizeFilename(filename)}.md`, saveAs: true }, () => {
    URL.revokeObjectURL(url)
  })
}
```

实现未配置、准备、运行中、部分完成、已完成和失败六种界面。运行中界面显示阶段、`completed/total`、百分比、已用时间和取消操作；部分完成界面提供重试，并明确标记“导出不完整结果”；结果界面提供预览、复制、下载和重新生成。只持久化字幕轨道偏好、处理模式和时间戳偏好；MVP 不持久化生成文档。

- [ ] **步骤 4：验证 UI、无障碍属性与生产构建**

执行：

```bash
pnpm vitest run tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx
pnpm typecheck
pnpm build
```

预期：所有状态转换和渲染器用例通过，按钮具备无障碍名称，生产构建退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add src/markdown src/storage src/components entrypoints/sidepanel/App.tsx tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx
git commit -m "feat: complete side panel conversion flow"
```

## 任务 11：插件端到端测试、隐私文档与开源发布基线

**涉及文件：**
- 新建： `playwright.config.ts`
- 新建： `tests/e2e/extension-smoke.spec.ts`
- 新建： `tests/e2e/fixtures/video-page.html`
- 新建： `README.md`
- 新建： `README.zh-CN.md`
- 新建： `CONTRIBUTING.md`
- 新建： `SECURITY.md`
- 新建： `PRIVACY.md`
- 新建： `LICENSE`
- 新建： `.github/ISSUE_TEMPLATE/bug_report.yml`
- 新建： `.github/pull_request_template.md`
- 新建： `.github/workflows/release.yml`

**接口关系：**
- 输入依赖：打包后的 WXT 插件及此前全部任务产物。
- 产出接口：`fixtureServer`、`installMockModelRoute`、`openExtensionSidePanel`、可复现的本地验证、贡献者文档、隐私声明和 ZIP 发布包。

- [ ] **步骤 1：编写失败的打包插件冒烟测试**

```ts
test('opens the side panel shell and completes a mocked subtitle conversion', async ({ context }) => {
  const page = await context.newPage()
  await page.goto(fixtureServer.url('/video-page.html'))
  await installMockModelRoute(page, validChineseCompletion)
  const sidePanel = await openExtensionSidePanel(context)
  await expect(sidePanel.getByRole('heading', { name: 'Video to Markdown' })).toBeVisible()
  await sidePanel.getByRole('button', { name: '开始生成' }).click()
  await expect(sidePanel.getByRole('button', { name: '下载 .md' })).toBeVisible()
})
```

- [ ] **步骤 2：构建并确认端到端测试因测试工具缺失而失败**

执行：`pnpm build && pnpm playwright test tests/e2e/extension-smoke.spec.ts`

预期：测试失败，原因是样本服务器和打包插件测试环境尚未配置。

- [ ] **步骤 3：实现确定性的端到端测试环境与项目文档**

启动持久化 Chromium 并加载 `.output/chrome-mv3`。提供一个本地虚拟视频页面，其桥接数据符合领域 Schema。模型请求统一路由到本地确定性响应；CI 中禁止使用真实 API Key 或访问实时视频平台。

使用以下准确契约定义端到端测试辅助函数：

```ts
type FixtureServer = {
  url(path: string): string
  close(): Promise<void>
}

declare const fixtureServer: FixtureServer

async function installMockModelRoute(page: Page, response: unknown): Promise<void> {
  await page.route('https://model.test/v1/chat/completions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
}

async function openExtensionSidePanel(context: BrowserContext): Promise<Page> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  return page
}
```

README 必须说明安装方式、开发者模式加载、支持的平台、两种处理模式、BYOK 配置、权限、隐私、MVP 已知限制、构建与测试命令，以及不支持音频转写。`PRIVACY.md` 必须准确说明哪些字幕文本会发送给用户选择的模型服务商；`SECURITY.md` 必须提供非公开漏洞报告方式，并禁止在 Issue 中粘贴密钥。

使用年份为 2026 的标准 MIT License 文本。Release 工作流运行完整 CI 和 `pnpm zip`，并在版本标签发布时附加生成的 Chrome ZIP。

- [ ] **步骤 4：运行完整发布门禁**

执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm playwright test
pnpm zip
git diff --check
```

预期：每条命令退出码为 0；单元、集成和端到端测试均为零失败；`.output/*-chrome.zip` 存在；所有测试都不访问真实模型或实时视频平台。

- [ ] **步骤 5：执行真实平台人工冒烟测试并提交**

在干净的 Chrome 配置中加载 `.output/chrome-mv3`。分别选择一个带公开字幕的 YouTube 视频和哔哩哔哩视频，验证元数据、字幕轨道选择、高保真生成、AI 精炼生成、时间戳链接、取消、复制和下载。发布记录中只记录视频 URL 与通过/失败结果，不提交抓取到的字幕。

```bash
git add playwright.config.ts tests/e2e README.md README.zh-CN.md CONTRIBUTING.md SECURITY.md PRIVACY.md LICENSE .github
git commit -m "docs: add release and open source baseline"
```

## 规格覆盖矩阵

| 规格范围 | 对应任务 |
|---|---|
| Chrome MV3、Side Panel、工具链、最低 Chrome 114 | 任务 1 |
| 领域模型、运行时校验、稳定错误码、密钥脱敏 | 任务 2 |
| BYOK 存储、HTTPS 校验、精确来源授权 | 任务 3 |
| OpenAI 兼容调用、取消、限速与重试 | 任务 4 |
| 字幕清洗、滚动字幕重叠、自然段恢复与分块 | 任务 5 |
| 中文字幕确定性路径、英文翻译、精炼 map/reduce | 任务 6 |
| YouTube 已有字幕提取 | 任务 7 |
| 哔哩哔哩已有字幕提取 | 任务 8 |
| 前台生命周期、进度、取消、部分结果与重试 | 任务 9 |
| 纯中文 Markdown、时间戳、预览、复制、下载和 UI 状态 | 任务 10 |
| 端到端测试、隐私、贡献文档、许可证与发布包 | 任务 11 |
| 排除音频转写、云账号、飞书和 Gemini/Claude 原生协议 | 全局约束及任务 11 的 README 验证 |

## 最终验证清单

- [ ] `git status --short` 只显示预期变更。
- [ ] `pnpm lint` 退出码为 0。
- [ ] `pnpm typecheck` 退出码为 0。
- [ ] `pnpm test` 报告零失败。
- [ ] `pnpm build` 生成最低支持 Chrome 114 的有效 MV3 插件。
- [ ] `pnpm playwright test` 在不依赖实时外部服务的情况下完成。
- [ ] `pnpm zip` 生成可安装的 Chrome 压缩包。
- [ ] 构建后的 Manifest 只包含已批准权限和可选 HTTPS 模型来源。
- [ ] 密钥扫描测试证明 API Key 不会出现在消息、错误、日志或 Markdown 中。
- [ ] YouTube 和哔哩哔哩人工冒烟测试在当前可用的公开字幕视频上通过。
- [ ] README 与隐私文档符合实际数据流和功能限制。
- [ ] 每个任务都按照指定提交边界单独提交。
