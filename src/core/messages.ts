import { z } from 'zod'

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
