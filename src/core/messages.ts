import { z } from 'zod'
import { AppError } from '../errors/app-error'
import type { ModelConfigStore } from '../model/config-store'
import type { ModelProvider } from './contracts'

const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('VIDEO_CONTEXT_REQUEST') }),
  z.object({ type: z.literal('SUBTITLE_CUES_REQUEST'), trackId: z.string().min(1) }),
  z.object({ type: z.literal('MODEL_TEST_REQUEST') }),
  z.object({
    type: z.literal('MODEL_COMPLETE_REQUEST'),
    requestId: z.string().uuid(),
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user']),
        content: z.string(),
      }),
    ),
  }),
  z.object({ type: z.literal('MODEL_CANCEL_REQUEST'), requestId: z.string().uuid() }),
])

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>

export function parseExtensionMessage(input: unknown): ExtensionMessage {
  return ExtensionMessageSchema.parse(input)
}

// --- Message Router ---

type Sender = { url?: string }

const PRIVILEGED = new Set([
  'MODEL_TEST_REQUEST',
  'MODEL_COMPLETE_REQUEST',
  'MODEL_CANCEL_REQUEST',
])

type RouterDeps = {
  configStore: ModelConfigStore
  isExtensionOrigin: (sender: Sender) => boolean
  createProvider?: (config: NonNullable<Awaited<ReturnType<ModelConfigStore['get']>>>) => ModelProvider
  getActiveRequestIds?: () => Set<string>
  cancelRequest?: (id: string) => void
}

export function createMessageRouter(deps: RouterDeps) {
  return async function routeMessage(
    raw: unknown,
    sender: Sender,
  ): Promise<unknown> {
    let message: ExtensionMessage
    try {
      message = parseExtensionMessage(raw)
    } catch {
      throw new AppError('INVALID_MODEL_CONFIG', '无效的消息格式')
    }

    if (!deps.isExtensionOrigin(sender) && PRIVILEGED.has(message.type)) {
      throw new AppError('INVALID_MODEL_CONFIG', '无权执行此操作')
    }

    switch (message.type) {
      case 'VIDEO_CONTEXT_REQUEST':
      case 'SUBTITLE_CUES_REQUEST':
        return { forwarded: true }

      case 'MODEL_TEST_REQUEST': {
        const config = await deps.configStore.get()
        if (!config) throw new AppError('INVALID_MODEL_CONFIG', '请先配置模型')
        if (!deps.createProvider) throw new AppError('INVALID_MODEL_CONFIG', '模型服务未就绪')
        const provider = deps.createProvider(config)
        await provider.testConnection()
        return { ok: true }
      }

      case 'MODEL_COMPLETE_REQUEST': {
        const config = await deps.configStore.get()
        if (!config) throw new AppError('INVALID_MODEL_CONFIG', '请先配置模型')
        if (!deps.createProvider) throw new AppError('INVALID_MODEL_CONFIG', '模型服务未就绪')
        const provider = deps.createProvider(config)
        const response = await provider.complete(
          { messages: message.messages, responseFormat: 'json' },
        )
        return { content: response.content }
      }

      case 'MODEL_CANCEL_REQUEST':
        deps.cancelRequest?.(message.requestId)
        return { cancelled: true }

      default:
        throw new AppError('INVALID_MODEL_CONFIG', '未知消息类型')
    }
  }
}
