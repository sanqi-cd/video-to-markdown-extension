import { z } from 'zod'
import { AppError } from '../errors/app-error'
import type { ModelConfigStore } from '../model/config-store'

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

type RouterDependencies = {
  configStore: ModelConfigStore
  isExtensionOrigin: (sender: Sender) => boolean
}

/**
 * Public message types that content scripts can invoke without auth.
 */
const PUBLIC_MESSAGES = new Set(['VIDEO_CONTEXT_REQUEST', 'SUBTITLE_CUES_REQUEST'])

/**
 * Privileged messages that require an extension origin sender.
 */
const PRIVILEGED_MESSAGES = new Set([
  'MODEL_TEST_REQUEST',
  'MODEL_COMPLETE_REQUEST',
  'MODEL_CANCEL_REQUEST',
])

export function createMessageRouter(deps: RouterDependencies) {
  return async function routeMessage(
    raw: unknown,
    sender: Sender,
  ): Promise<unknown> {
    // Parse and validate the message
    let message: ExtensionMessage
    try {
      message = parseExtensionMessage(raw)
    } catch {
      throw new AppError('INVALID_MODEL_CONFIG', '无效的消息格式')
    }

    const isExtension = deps.isExtensionOrigin(sender)

    // Content scripts can only send public messages
    if (!isExtension && PRIVILEGED_MESSAGES.has(message.type)) {
      throw new AppError('INVALID_MODEL_CONFIG', '无权执行此操作')
    }

    // Route to handler
    switch (message.type) {
      case 'VIDEO_CONTEXT_REQUEST':
        // Handled by content script adapter — return placeholder
        return { platform: 'unknown' }

      case 'SUBTITLE_CUES_REQUEST':
        return { cues: [] }

      case 'MODEL_TEST_REQUEST':
      case 'MODEL_COMPLETE_REQUEST': {
        const config = await deps.configStore.get()
        if (!config) {
          throw new AppError('INVALID_MODEL_CONFIG', '请先配置模型')
        }
        return { ok: true }
      }

      case 'MODEL_CANCEL_REQUEST':
        return { cancelled: true }

      default:
        throw new AppError('INVALID_MODEL_CONFIG', '未知的消息类型')
    }
  }
}
