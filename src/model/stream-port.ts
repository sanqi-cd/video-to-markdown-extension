import { z } from 'zod'
import { AppError, type PublicAppError } from '../errors/app-error'
import type { ModelConfig, ModelConfigStore } from './config-store'
import type { ModelProvider } from '../core/contracts'
import type { StreamingModelProvider } from './openai-provider'

export const MODEL_STREAM_PORT = 'model-stream-v1'

const ModelMessageSchema = z.object({
  role: z.enum(['system', 'user']),
  content: z.string(),
})

const ErrorCodeSchema = z.enum([
  'UNSUPPORTED_PAGE',
  'ACTIVE_TAB_UNAVAILABLE',
  'CONTENT_SCRIPT_UNAVAILABLE',
  'PAGE_CONTEXT_INVALID',
  'TAB_RELOAD_TIMEOUT',
  'NO_SUBTITLE',
  'SUBTITLE_EXTRACTION_FAILED',
  'INVALID_MODEL_CONFIG',
  'MODEL_AUTH_FAILED',
  'MODEL_RATE_LIMITED',
  'MODEL_CONTEXT_EXCEEDED',
  'MODEL_RESPONSE_INVALID',
  'NETWORK_FAILED',
  'TASK_CANCELLED',
])

const StreamCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('START'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
    messages: z.array(ModelMessageSchema).min(1),
  }),
  z.object({
    type: z.literal('CANCEL'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
  }),
])

const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('STARTED'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('CONNECTED'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('DELTA'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
    text: z.string(),
    receivedChars: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('DONE'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
    content: z.string(),
  }),
  z.object({
    type: z.literal('ERROR'),
    taskId: z.string().uuid(),
    requestId: z.string().uuid(),
    error: z.object({ code: ErrorCodeSchema, message: z.string() }),
  }),
])

export type StreamCommand = z.infer<typeof StreamCommandSchema>
export type StreamEvent = z.infer<typeof StreamEventSchema>

export function parseStreamCommand(input: unknown): StreamCommand {
  return StreamCommandSchema.parse(input)
}

export function parseStreamEvent(input: unknown): StreamEvent {
  return StreamEventSchema.parse(input)
}

type ListenerSet<T> = {
  addListener(listener: (value: T) => void): void
  removeListener?(listener: (value: T) => void): void
}

export type RuntimePortLike = {
  name: string
  sender?: { url?: string }
  onMessage: ListenerSet<unknown>
  onDisconnect: ListenerSet<RuntimePortLike>
  postMessage(message: unknown): void
  disconnect(): void
}

type StreamPortDeps = {
  configStore: ModelConfigStore
  isExtensionOrigin: (sender: { url?: string }) => boolean
  createProvider: (config: ModelConfig) => ModelProvider
}

type ActiveStream = {
  taskId: string
  controller: AbortController
}

function supportsStreaming(provider: ModelProvider): provider is StreamingModelProvider {
  return 'completeStream' in provider
    && typeof (provider as Partial<StreamingModelProvider>).completeStream === 'function'
}

function publicError(error: unknown, secrets: string[] = []): PublicAppError {
  if (error instanceof AppError) return error.toJSON(secrets)
  return new AppError(
    'NETWORK_FAILED',
    error instanceof Error ? error.message : '模型请求失败',
  ).toJSON(secrets)
}

export function createStreamPortHandler(deps: StreamPortDeps) {
  return function handlePort(port: RuntimePortLike): void {
    if (port.name !== MODEL_STREAM_PORT) return
    if (!deps.isExtensionOrigin(port.sender ?? {})) {
      port.disconnect()
      return
    }

    const active = new Map<string, ActiveStream>()
    let disconnected = false
    const post = (event: StreamEvent) => {
      if (!disconnected) port.postMessage(StreamEventSchema.parse(event))
    }

    const handleStart = async (
      command: Extract<StreamCommand, { type: 'START' }>,
    ) => {
      active.get(command.requestId)?.controller.abort()
      const controller = new AbortController()
      active.set(command.requestId, { taskId: command.taskId, controller })
      post({ type: 'STARTED', taskId: command.taskId, requestId: command.requestId })

      let config: ModelConfig | null = null
      try {
        config = await deps.configStore.get()
        if (!config) throw new AppError('INVALID_MODEL_CONFIG', '请先配置模型')
        const provider = deps.createProvider(config)
        const request = { messages: command.messages, responseFormat: 'json' as const }
        const response = supportsStreaming(provider)
          ? await provider.completeStream(request, {
              onConnected: () => post({
                type: 'CONNECTED',
                taskId: command.taskId,
                requestId: command.requestId,
              }),
              onDelta: (text, receivedChars) => post({
                type: 'DELTA',
                taskId: command.taskId,
                requestId: command.requestId,
                text,
                receivedChars,
              }),
            }, controller.signal)
          : await provider.complete(request, controller.signal)
        post({
          type: 'DONE',
          taskId: command.taskId,
          requestId: command.requestId,
          content: response.content,
        })
      } catch (error) {
        post({
          type: 'ERROR',
          taskId: command.taskId,
          requestId: command.requestId,
          error: publicError(error, config ? [config.apiKey] : []),
        })
      } finally {
        if (active.get(command.requestId)?.controller === controller) {
          active.delete(command.requestId)
        }
      }
    }

    const onMessage = (raw: unknown) => {
      let command: StreamCommand
      try {
        command = parseStreamCommand(raw)
      } catch {
        return
      }
      if (command.type === 'START') {
        void handleStart(command)
        return
      }
      const request = active.get(command.requestId)
      if (request?.taskId === command.taskId) request.controller.abort()
    }

    const onDisconnect = () => {
      disconnected = true
      for (const request of active.values()) request.controller.abort()
      active.clear()
      port.onMessage.removeListener?.(onMessage)
      port.onDisconnect.removeListener?.(onDisconnect)
    }

    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
  }
}
