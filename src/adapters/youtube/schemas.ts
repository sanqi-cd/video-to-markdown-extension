import { z } from 'zod'

/**
 * Minimal schema for the ytInitialPlayerResponse fields we need.
 * We deliberately do NOT parse full playerResponse; only videoDetails + captions.
 */
export const YouTubeBridgePayloadSchema = z.object({
  videoDetails: z.object({
    videoId: z.string().min(1),
    title: z.string(),
    author: z.string().optional(),
    lengthSeconds: z.string().optional(),
  }),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({
        captionTracks: z.array(
          z.object({
            baseUrl: z.string(),
            languageCode: z.string(),
            name: z.object({ simpleText: z.string() }),
            vssId: z.string(),
            kind: z.string().optional(),
          }),
        ),
      }),
    })
    .optional(),
})

export type YouTubePlayerResponse = z.infer<typeof YouTubeBridgePayloadSchema>

/**
 * JSON3 caption event schema — minimal, only what we use.
 */
export const CaptionEventSchema = z.object({
  tStartMs: z.number(),
  dDurationMs: z.number(),
  segs: z.array(z.object({ utf8: z.string() })),
})

export const CaptionTrackSchema = z.object({
  events: z.array(CaptionEventSchema),
})
