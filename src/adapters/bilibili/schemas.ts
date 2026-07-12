import { z } from 'zod'

export type BilibiliContextPayload = z.infer<typeof BilibiliContextSchema>

export const BilibiliContextSchema = z.object({
  bvid: z.string().min(1),
  aid: z.number().int().nonnegative(),
  cid: z.number().int().nonnegative(),
  title: z.string(),
  author: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
})

export const BilibiliSubtitleListSchema = z.object({
  code: z.number(),
  data: z.object({
    subtitle: z
      .object({
        subtitles: z.array(
          z.object({
            id: z.number(),
            lan: z.string(),
            lan_doc: z.string(),
            subtitle_url: z.string(),
            ai_status: z.number().optional(),
          }),
        ),
      })
      .optional(),
  }),
})

export const BilibiliSubtitleBodySchema = z.object({
  body: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      content: z.string(),
    }),
  ),
})
