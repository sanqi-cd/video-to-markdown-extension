import { z } from 'zod'

export type BilibiliContextPayload = z.infer<typeof BilibiliContextSchema>

export const BilibiliContextSchema = z.object({
  bvid: z.string().min(1),
  aid: z.number().int().nonnegative(),
  cid: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  title: z.string(),
  author: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
})

export const BilibiliSubtitleListSchema = z.object({
  code: z.number(),
  data: z.object({
    bvid: z.string().optional(),
    aid: z.number().optional(),
    cid: z.number().optional(),
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

export const BilibiliViewSchema = z.object({
  code: z.number(),
  data: z.object({
    aid: z.number().int().nonnegative().optional(),
    desc: z.string().optional(),
    owner: z.object({
      mid: z.number().int().nonnegative(),
      name: z.string().optional(),
    }).optional(),
  }).optional(),
})

export const BilibiliReplySchema = z.object({
  code: z.number(),
  data: z.object({
    upper: z.object({
      mid: z.number().int().nonnegative(),
      top: z.object({
        mid: z.number().int().nonnegative(),
        content: z.object({
          message: z.string(),
        }),
      }).nullable().optional(),
    }).optional(),
  }).optional(),
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
