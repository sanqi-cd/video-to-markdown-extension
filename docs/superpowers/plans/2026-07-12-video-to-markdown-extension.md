# Video to Markdown Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an open-source Chrome extension that extracts existing YouTube and Bilibili subtitles and produces Chinese Markdown in high-fidelity or AI-refined mode.

**Architecture:** WXT provides the Manifest V3 shell. Platform-specific content scripts expose a shared `SubtitleAdapter` contract, the Side Panel owns the foreground task lifecycle, and the Service Worker owns model credentials and OpenAI-compatible requests. Pure processors normalize, chunk, validate, and render data so they can be tested without Chrome or live video sites.

**Tech Stack:** WXT, React, TypeScript strict, pnpm, Zod, Vitest, Testing Library, Playwright, ESLint, Prettier

## Global Constraints

- Support Chrome 114 and later with Manifest V3 and `chrome.sidePanel`.
- Support existing subtitle tracks on YouTube and Bilibili only.
- Do not download video/audio or perform speech recognition in MVP.
- Final documents contain Chinese only; English source text is not retained in the body.
- Support OpenAI-compatible APIs through user-supplied API Key, HTTPS Base URL, and model name.
- Keep API Key in `chrome.storage.local`; never send it to Content Scripts or include it in logs, errors, or exports.
- Do not build accounts, cloud persistence, third-party note sync, background continuation after the Side Panel closes, or native Gemini/Claude protocols.
- Use deterministic cleanup for Chinese high-fidelity output; do not ask a model to rewrite Chinese subtitles.
- Treat every Content Script message and model response as untrusted input and validate it at runtime.
- Use MIT License and keep generated artifacts, secrets, browser profiles, and local visualization sessions out of Git.

---

## File and Module Map

```text
entrypoints/
  background.ts                 privileged message router and model calls
  youtube.content.ts            isolated-world YouTube bridge
  youtube-main.content.ts       MAIN-world YouTube caption discovery
  bilibili.content.ts           isolated-world Bilibili bridge
  bilibili-main.content.ts      MAIN-world Bilibili metadata discovery
  sidepanel/
    index.html                  WXT side panel entry
    main.tsx                    React bootstrap
    App.tsx                     top-level state rendering
src/
  adapters/
    shared/page-bridge.ts       validated MAIN-to-isolated-world event transport
    youtube/adapter.ts          YouTube track and cue adapter
    youtube/schemas.ts          YouTube response validation
    bilibili/adapter.ts         Bilibili track and cue adapter
    bilibili/schemas.ts         Bilibili response validation
  components/
    ModelSettings.tsx           BYOK form and connection test
    PrepareView.tsx             video, track, and mode selection
    ProgressView.tsx            progress and cancel UI
    ResultView.tsx              preview, copy, download, retry UI
  core/
    contracts.ts                domain types and adapter/provider interfaces
    messages.ts                 runtime-validated extension messages
    orchestrator.ts             foreground task state machine
  errors/app-error.ts           stable error codes and redaction
  markdown/render-markdown.ts   Markdown and timestamp generation
  model/
    config-store.ts             local model configuration
    host-permissions.ts         exact-origin optional permission requests
    openai-provider.ts          OpenAI-compatible client
    retry.ts                    retry policy and backoff
  processors/
    normalize.ts                deterministic cue cleanup
    paragraphs.ts               cue-to-paragraph grouping
    chunk.ts                    context-budget chunking
    high-fidelity.ts            Chinese cleanup or English translation
    refined.ts                  map/reduce refined notes
    schemas.ts                  model output validation
  prompts/
    high-fidelity.ts            versioned translation prompt
    refined.ts                  versioned map/reduce prompts
  storage/preferences.ts        non-secret UI preferences
tests/
  fixtures/youtube/             sanitized YouTube fixtures
  fixtures/bilibili/            sanitized Bilibili fixtures
  unit/                         pure module tests
  integration/                  Chrome-message and adapter tests
  e2e/                          packaged extension smoke tests
```

## Task 1: Extension Shell, Toolchain, and CI

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/sidepanel/index.html`
- Create: `entrypoints/sidepanel/main.tsx`
- Create: `entrypoints/sidepanel/App.tsx`
- Create: `.github/workflows/ci.yml`
- Create: `tests/unit/app-shell.test.tsx`

**Interfaces:**
- Consumes: none.
- Produces: WXT MV3 build with `sidepanel.html`, `background.ts`, React test environment, and CI commands `lint`, `typecheck`, `test`, `build`.

- [ ] **Step 1: Initialize dependencies and write the failing shell test**

Run:

```bash
pnpm init
pnpm add react react-dom zod
pnpm add -D wxt @wxt-dev/module-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom eslint prettier playwright
```

Create `tests/unit/app-shell.test.tsx`:

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

- [ ] **Step 2: Run the shell test and verify the missing module failure**

Run: `pnpm vitest run tests/unit/app-shell.test.tsx`

Expected: FAIL because `entrypoints/sidepanel/App.tsx` does not exist.

- [ ] **Step 3: Add the minimal WXT and React shell**

Create `wxt.config.ts`:

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

Create `entrypoints/sidepanel/App.tsx`:

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

Create `entrypoints/sidepanel/main.tsx`:

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

Create `entrypoints/background.ts`:

```ts
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})
```

Configure Vitest with `environment: 'jsdom'`, `globals: true`, and `@testing-library/jest-dom/vitest`. Configure TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, and `.wxt/tsconfig.json` as the base. Add scripts for `dev`, `build`, `zip`, `lint`, `typecheck`, and `test`.

Create `vitest.config.ts`:

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

Create `tsconfig.json`:

```json
{
  "extends": ".wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Set these exact package scripts:

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

- [ ] **Step 4: Verify shell, types, and production build**

Run:

```bash
pnpm test -- tests/unit/app-shell.test.tsx
pnpm typecheck
pnpm build
```

Expected: test PASS, typecheck exits 0, and `.output/chrome-mv3/manifest.json` declares Chrome 114, Side Panel, storage, downloads, and only the two video-site host permissions.

- [ ] **Step 5: Add CI and commit**

Create `.github/workflows/ci.yml` to run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` on pull requests and pushes to `main`.

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json wxt.config.ts vitest.config.ts entrypoints tests/unit/app-shell.test.tsx .github/workflows/ci.yml
git commit -m "chore: scaffold WXT extension shell"
```

## Task 2: Domain Contracts, Errors, and Message Validation

**Files:**
- Create: `src/core/contracts.ts`
- Create: `src/core/messages.ts`
- Create: `src/errors/app-error.ts`
- Create: `tests/unit/contracts.test.ts`
- Create: `tests/unit/app-error.test.ts`

**Interfaces:**
- Consumes: Zod from Task 1.
- Produces: `VideoMetadata`, `SubtitleTrack`, `SubtitleCue`, `VideoDocument`, `SubtitleAdapter`, `ModelProvider`, `AppError`, `parseExtensionMessage`.

- [ ] **Step 1: Write failing contract and redaction tests**

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

- [ ] **Step 2: Run tests and verify missing exports**

Run: `pnpm vitest run tests/unit/contracts.test.ts tests/unit/app-error.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement exact domain and message contracts**

Define the domain types exactly as approved in the design. Add:

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

Define a Zod discriminated union for only these messages:

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

Implement the ten approved error codes, `AppError`, `redactSecrets`, and a `toJSON` method that returns only `code` and redacted `message`.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm vitest run tests/unit/contracts.test.ts tests/unit/app-error.test.ts && pnpm typecheck`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/contracts.ts src/core/messages.ts src/errors/app-error.ts tests/unit/contracts.test.ts tests/unit/app-error.test.ts
git commit -m "feat: define validated extension contracts"
```

## Task 3: Model Configuration, Storage, and Exact-Origin Permission

**Files:**
- Create: `src/model/config-store.ts`
- Create: `src/model/host-permissions.ts`
- Create: `src/components/ModelSettings.tsx`
- Create: `tests/unit/config-store.test.ts`
- Create: `tests/unit/host-permissions.test.ts`
- Create: `tests/unit/model-settings.test.tsx`

**Interfaces:**
- Consumes: `AppError` from Task 2.
- Produces: `ModelConfig`, `ModelConfigStore`, `normalizeBaseUrl`, `requestModelOrigin`, `ModelSettings`.

- [ ] **Step 1: Write failing validation and permission tests**

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

- [ ] **Step 2: Verify the focused tests fail**

Run: `pnpm vitest run tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement storage and permissions**

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

Implement `ModelConfigStore` with `get`, `set`, and `clear` over the single key `modelConfig`. Reject empty API Key/model and a context window below 4096. Implement `requestModelOrigin` by converting Base URL to `${origin}/*` and calling `chrome.permissions.request` through an injectable function. `ModelSettings` must mask the key, never render the stored value as ordinary text, and expose save, test, and delete callbacks.

- [ ] **Step 4: Verify storage, permission, and component behavior**

Run:

```bash
pnpm vitest run tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts tests/unit/model-settings.test.tsx
pnpm typecheck
```

Expected: validation, exact-origin request, masked key, save, test, and delete tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/config-store.ts src/model/host-permissions.ts src/components/ModelSettings.tsx tests/unit/config-store.test.ts tests/unit/host-permissions.test.ts tests/unit/model-settings.test.tsx
git commit -m "feat: add secure BYOK model settings"
```

## Task 4: OpenAI-Compatible Provider and Retry Policy

**Files:**
- Create: `src/model/openai-provider.ts`
- Create: `src/model/retry.ts`
- Create: `tests/unit/openai-provider.test.ts`
- Create: `tests/unit/retry.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`, `ModelConfig`, `AppError`.
- Produces: `OpenAICompatibleProvider`, `withRetry`, `RetryPolicy`.

- [ ] **Step 1: Write failing provider tests using an injected fetch**

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

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/unit/openai-provider.test.ts tests/unit/retry.test.ts`

Expected: FAIL because provider and retry modules are missing.

- [ ] **Step 3: Implement the provider and bounded retry**

The provider must POST to `${baseUrl}/chat/completions`, set `Authorization: Bearer ${apiKey}`, send `{ model, messages, temperature: 0 }`, validate `choices[0].message.content`, and never include request headers/body in thrown errors.

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

Use at most three attempts. Parse `Retry-After` when present and cap the delay. Abort immediately when `AbortSignal` is aborted.

- [ ] **Step 4: Verify provider, retry, and redaction**

Run: `pnpm vitest run tests/unit/openai-provider.test.ts tests/unit/retry.test.ts tests/unit/app-error.test.ts && pnpm typecheck`

Expected: success, status mapping, abort, retry cap, and secret-redaction cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/openai-provider.ts src/model/retry.ts tests/unit/openai-provider.test.ts tests/unit/retry.test.ts
git commit -m "feat: add OpenAI compatible model provider"
```

## Task 5: Deterministic Subtitle Normalization, Paragraphs, and Chunking

**Files:**
- Create: `src/processors/normalize.ts`
- Create: `src/processors/paragraphs.ts`
- Create: `src/processors/chunk.ts`
- Create: `tests/unit/normalize.test.ts`
- Create: `tests/unit/paragraphs.test.ts`
- Create: `tests/unit/chunk.test.ts`

**Interfaces:**
- Consumes: `SubtitleCue`.
- Produces: `normalizeCues(cues)`, `buildParagraphs(cues, options)`, `chunkParagraphs(paragraphs, budget)`.

- [ ] **Step 1: Write failing behavior tests**

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

- [ ] **Step 2: Verify tests fail before implementation**

Run: `pnpm vitest run tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts`

Expected: FAIL because processor functions are missing.

- [ ] **Step 3: Implement pure processors**

`normalizeCues` must decode entities, collapse whitespace, drop empty/exact duplicates, compute the longest suffix/prefix word overlap, and preserve timing/IDs. `buildParagraphs` must merge adjacent cues until punctuation, a gap above 1500 ms, or 600 Chinese characters. Each paragraph has a stable ID derived from its first/last cue IDs and retains `startMs`, `endMs`, and `cueIds`.

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

`chunkParagraphs` must reject a single paragraph larger than the budget with `MODEL_CONTEXT_EXCEEDED`, preserve order, and only add overlap for refined mode.

- [ ] **Step 4: Run focused tests and property invariants**

Run: `pnpm vitest run tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts && pnpm typecheck`

Expected: tests prove ordered cue coverage, stable IDs, no empty cues, no hard paragraph splits, and bounded chunk sizes.

- [ ] **Step 5: Commit**

```bash
git add src/processors/normalize.ts src/processors/paragraphs.ts src/processors/chunk.ts tests/unit/normalize.test.ts tests/unit/paragraphs.test.ts tests/unit/chunk.test.ts
git commit -m "feat: add deterministic subtitle pipeline"
```

## Task 6: High-Fidelity and AI-Refined Processors

**Files:**
- Create: `src/processors/schemas.ts`
- Create: `src/processors/high-fidelity.ts`
- Create: `src/processors/refined.ts`
- Create: `src/prompts/high-fidelity.ts`
- Create: `src/prompts/refined.ts`
- Create: `tests/unit/high-fidelity.test.ts`
- Create: `tests/unit/refined.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`, `SubtitleParagraph`, `ParagraphChunk`, `AppError`.
- Produces: `processHighFidelity`, `processRefined`, `TranslatedParagraph`, `RefinedDocument`.

- [ ] **Step 1: Write failing coverage and hallucination-boundary tests**

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

- [ ] **Step 2: Run and verify processor tests fail**

Run: `pnpm vitest run tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts`

Expected: FAIL because processor modules do not exist.

- [ ] **Step 3: Implement versioned prompts and validated outputs**

Use Zod schemas that require exact paragraph IDs for high-fidelity translation. Compare input/output ID sets and reject missing, duplicate, or unknown IDs. The Chinese path returns deterministic paragraphs directly.

For refined mode, define map output fields `chapterCandidates`, `claims`, `facts`, `people`, `examples`, and `conclusions`, each with source paragraph IDs. The reduce output fields are `overview`, `coreIdeas`, `chapters`, `importantFacts`, and `conclusion`. Every timestamp reference must be derived from a valid source paragraph ID.

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

Keep prompts in exported versioned constants such as `HIGH_FIDELITY_PROMPT_V1`; require JSON-only responses and explicitly forbid summarization or unsupported facts.

- [ ] **Step 4: Verify both processing modes**

Run: `pnpm vitest run tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts && pnpm typecheck`

Expected: Chinese bypass, English ID coverage, map/reduce provenance, abort, partial failure, and empty-section behavior PASS.

- [ ] **Step 5: Commit**

```bash
git add src/processors src/prompts tests/unit/high-fidelity.test.ts tests/unit/refined.test.ts
git commit -m "feat: add high fidelity and refined processors"
```

## Task 7: YouTube Adapter with Sanitized Fixtures

**Files:**
- Create: `entrypoints/youtube-main.content.ts`
- Create: `entrypoints/youtube.content.ts`
- Create: `src/adapters/shared/page-bridge.ts`
- Create: `src/adapters/youtube/schemas.ts`
- Create: `src/adapters/youtube/adapter.ts`
- Create: `tests/fixtures/youtube/player-response.json`
- Create: `tests/fixtures/youtube/captions.json3`
- Create: `tests/integration/youtube-adapter.test.ts`

**Interfaces:**
- Consumes: `SubtitleAdapter`, domain types, validated messages.
- Produces: `YouTubeAdapter`, `extractYouTubeBridgePayload(input: unknown): YouTubeBridgePayload`, sanitized page bridge payload `{ videoId, metadata, tracks }`.

- [ ] **Step 1: Add fixtures and write failing adapter tests**

Use hand-minimized fixtures containing one public synthetic video ID, two tracks, and three caption events. Do not copy cookies, authorization headers, visitor data, or unrelated player response fields.

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

- [ ] **Step 2: Verify adapter tests fail**

Run: `pnpm vitest run tests/integration/youtube-adapter.test.ts`

Expected: FAIL because `YouTubeAdapter` does not exist.

- [ ] **Step 3: Implement the validated YouTube bridge and adapter**

The MAIN-world entry reads only `ytInitialPlayerResponse.videoDetails` and `captions.playerCaptionsTracklistRenderer.captionTracks`, reduces them to the bridge schema, and dispatches a namespaced `CustomEvent`. The isolated-world entry validates the event detail before answering extension messages.

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

Validate that caption `baseUrl` uses HTTPS and an expected YouTube/Google video host before fetching. Append `fmt=json3`, parse only event timing and segment text, and map extraction failures to `SUBTITLE_EXTRACTION_FAILED`. The page cannot supply arbitrary fetch headers or methods.

- [ ] **Step 4: Verify fixtures, security checks, and build**

Run: `pnpm vitest run tests/integration/youtube-adapter.test.ts && pnpm build`

Expected: fixture mapping PASS, malicious caption URL rejection PASS, and WXT emits both YouTube content scripts.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/youtube-main.content.ts entrypoints/youtube.content.ts src/adapters/shared/page-bridge.ts src/adapters/youtube tests/fixtures/youtube tests/integration/youtube-adapter.test.ts
git commit -m "feat: extract existing YouTube captions"
```

## Task 8: Bilibili Adapter with Sanitized Fixtures

**Files:**
- Create: `entrypoints/bilibili-main.content.ts`
- Create: `entrypoints/bilibili.content.ts`
- Create: `src/adapters/bilibili/schemas.ts`
- Create: `src/adapters/bilibili/adapter.ts`
- Create: `tests/fixtures/bilibili/player-context.json`
- Create: `tests/fixtures/bilibili/player-subtitles.json`
- Create: `tests/fixtures/bilibili/subtitle-body.json`
- Create: `tests/integration/bilibili-adapter.test.ts`

**Interfaces:**
- Consumes: shared page bridge and domain contracts.
- Produces: `BilibiliAdapter`, `extractBilibiliBridgePayload(input: unknown): BilibiliBridgePayload`, sanitized bridge payload `{ bvid, aid, cid, title, author }`.

- [ ] **Step 1: Add minimized fixtures and failing mapping tests**

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

- [ ] **Step 2: Verify adapter test failure**

Run: `pnpm vitest run tests/integration/bilibili-adapter.test.ts`

Expected: FAIL because `BilibiliAdapter` does not exist.

- [ ] **Step 3: Implement Bilibili metadata, track, and cue mapping**

The MAIN-world entry reads only the current page identifiers and public metadata from Bilibili page state. The isolated adapter requests the current video's player subtitle metadata using the current `bvid/cid`, validates the response, and fetches only subtitle URLs returned for that same video.

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

Require HTTPS, allow only Bilibili-owned subtitle hosts returned by the validated response, send credentials only to the same Bilibili origin, and map missing subtitle arrays to `NO_SUBTITLE`.

- [ ] **Step 4: Verify fixtures and build**

Run: `pnpm vitest run tests/integration/bilibili-adapter.test.ts && pnpm build`

Expected: track/cue mapping, seconds conversion, missing subtitles, malformed responses, and hostile URL rejection PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/bilibili-main.content.ts entrypoints/bilibili.content.ts src/adapters/bilibili tests/fixtures/bilibili tests/integration/bilibili-adapter.test.ts
git commit -m "feat: extract existing Bilibili captions"
```

## Task 9: Service Worker Routing and Foreground Task Orchestrator

**Files:**
- Modify: `entrypoints/background.ts`
- Create: `src/core/orchestrator.ts`
- Create: `tests/integration/background-routing.test.ts`
- Create: `tests/unit/orchestrator.test.ts`

**Interfaces:**
- Consumes: validated messages, config store, provider, retry, adapters, processors.
- Produces: `createBackgroundRouter`, `TaskOrchestrator`, `TaskState`, `TaskEvent`.

- [ ] **Step 1: Write failing routing and state-machine tests**

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

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL because router and orchestrator are absent.

- [ ] **Step 3: Implement explicit routing and task states**

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

The background router must parse every message, inspect `sender.url`, allow model messages only from extension pages, create an `AbortController` per request UUID, and expose only sanitized errors. The orchestrator must fetch context/cues, normalize, paragraphize, process, render, and emit immutable state changes. `cancel()` aborts active requests. `retryFailed()` reuses successful chunks and schedules only failed IDs.

- [ ] **Step 4: Verify routing, cancellation, and partial recovery**

Run: `pnpm vitest run tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts && pnpm typecheck`

Expected: sender validation, cancellation, page-switch prompt event, partial result preservation, and single-chunk retry PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/background.ts src/core/orchestrator.ts tests/integration/background-routing.test.ts tests/unit/orchestrator.test.ts
git commit -m "feat: orchestrate foreground conversion tasks"
```

## Task 10: Markdown Renderer, Side Panel States, Copy, and Download

**Files:**
- Create: `src/markdown/render-markdown.ts`
- Create: `src/storage/preferences.ts`
- Create: `src/components/PrepareView.tsx`
- Create: `src/components/ProgressView.tsx`
- Create: `src/components/ResultView.tsx`
- Modify: `entrypoints/sidepanel/App.tsx`
- Create: `tests/unit/render-markdown.test.ts`
- Create: `tests/unit/sidepanel-flow.test.tsx`

**Interfaces:**
- Consumes: `TaskOrchestrator`, domain documents, `ModelSettings`.
- Produces: `renderMarkdown`, `timestampUrl`, complete prepare/running/partial/completed/error UI.

- [ ] **Step 1: Write failing renderer and UI flow tests**

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

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx`

Expected: FAIL because renderer and views do not exist.

- [ ] **Step 3: Implement safe Markdown and all approved UI states**

`renderMarkdown` must emit title, available metadata, source URL, mode, local ISO timestamp, and mode-specific sections. Escape Markdown control characters in platform metadata. Generate timestamps only from validated source paragraph IDs. Omit empty author/facts/examples sections.

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

Implement unconfigured, ready, running, partial, completed, and failed views. The running view displays stage, `completed/total`, percentage, elapsed time, and cancel. The partial view exposes retry and explicitly labeled partial export. The result view exposes preview, copy, download, and regenerate. Persist only subtitle-track preference, mode, and timestamp preference; do not persist generated documents in MVP.

- [ ] **Step 4: Verify UI, accessibility, and build**

Run:

```bash
pnpm vitest run tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx
pnpm typecheck
pnpm build
```

Expected: all state transitions and renderer cases PASS; buttons have accessible names; production build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/markdown src/storage src/components entrypoints/sidepanel/App.tsx tests/unit/render-markdown.test.ts tests/unit/sidepanel-flow.test.tsx
git commit -m "feat: complete side panel conversion flow"
```

## Task 11: Packaged Extension E2E, Privacy, and Open-Source Release Baseline

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/extension-smoke.spec.ts`
- Create: `tests/e2e/fixtures/video-page.html`
- Create: `README.md`
- Create: `README.zh-CN.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `PRIVACY.md`
- Create: `LICENSE`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/pull_request_template.md`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: packaged WXT extension and every previous task.
- Produces: `fixtureServer`, `installMockModelRoute`, `openExtensionSidePanel`, reproducible local verification, contributor documentation, privacy disclosure, and zipped release artifact.

- [ ] **Step 1: Write the failing packaged-extension smoke test**

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

- [ ] **Step 2: Build and verify the E2E test initially fails at missing harness helpers**

Run: `pnpm build && pnpm playwright test tests/e2e/extension-smoke.spec.ts`

Expected: FAIL because the fixture server and packaged-extension harness are not configured.

- [ ] **Step 3: Implement the deterministic E2E harness and documentation**

Configure persistent Chromium with `.output/chrome-mv3` loaded. Serve a local synthetic video page whose bridge payload matches the domain schema. Route model calls to a local deterministic response; no real API Key or live platform request is permitted in CI.

Define the E2E helpers with these exact contracts:

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

README files must document installation, developer mode loading, supported platforms, both modes, BYOK setup, permissions, privacy, known MVP limits, build/test commands, and the lack of audio transcription. `PRIVACY.md` must state exactly which subtitle text is sent to the user-selected model provider. `SECURITY.md` must provide private vulnerability reporting guidance and prohibit secrets in issues.

Use the standard MIT license text with year 2026. Configure release workflow to run the full CI suite and `pnpm zip`, then attach the generated Chrome ZIP for version tags.

- [ ] **Step 4: Run the complete release gate**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm playwright test
pnpm zip
git diff --check
```

Expected: every command exits 0; unit/integration/E2E tests report zero failures; `.output/*-chrome.zip` exists; no test performs a live model or video-platform request.

- [ ] **Step 5: Perform manual platform smoke tests and commit**

Load `.output/chrome-mv3` in a clean Chrome profile. Verify one public captioned YouTube video and one public captioned Bilibili video: metadata, track selection, high-fidelity generation, refined generation, timestamp links, cancel, copy, and download. Record only video URLs and pass/fail results in the release notes; do not commit captured subtitles.

```bash
git add playwright.config.ts tests/e2e README.md README.zh-CN.md CONTRIBUTING.md SECURITY.md PRIVACY.md LICENSE .github
git commit -m "docs: add release and open source baseline"
```

## Specification Coverage Matrix

| Specification area | Implemented by |
|---|---|
| Chrome MV3, Side Panel, toolchain, minimum Chrome 114 | Task 1 |
| Domain model, runtime validation, stable errors, redaction | Task 2 |
| BYOK storage, HTTPS validation, exact-origin permission | Task 3 |
| OpenAI-compatible calls, abort, rate limits, retry | Task 4 |
| Subtitle cleanup, rolling-caption overlap, paragraphs, chunking | Task 5 |
| Chinese deterministic path, English translation, refined map/reduce | Task 6 |
| YouTube existing-caption extraction | Task 7 |
| Bilibili existing-caption extraction | Task 8 |
| Foreground lifecycle, progress, cancel, partial result, retry | Task 9 |
| Chinese-only Markdown, timestamps, preview, copy, download, UI states | Task 10 |
| E2E, privacy, contributor docs, license, release archive | Task 11 |
| Excluded audio transcription, cloud accounts, Feishu, native Gemini/Claude | Global Constraints and README verification in Task 11 |

## Final Verification Checklist

- [ ] `git status --short` shows only intentional changes.
- [ ] `pnpm lint` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` reports zero failures.
- [ ] `pnpm build` produces a valid Chrome MV3 extension with minimum Chrome 114.
- [ ] `pnpm playwright test` completes without live external dependencies.
- [ ] `pnpm zip` creates the installable Chrome archive.
- [ ] The built manifest contains only approved permissions and optional HTTPS model origins.
- [ ] Secret-scanning tests prove an API Key cannot appear in messages, errors, logs, or Markdown.
- [ ] YouTube and Bilibili manual smoke tests pass on currently available public captioned videos.
- [ ] README and privacy documentation match actual data flow and limitations.
- [ ] Every task is committed separately with the specified commit boundary.
