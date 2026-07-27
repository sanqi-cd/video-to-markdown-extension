import { z } from 'zod'

/**
 * JSON3 caption event schema — minimal, only what we use.
 */
export const CaptionEventSchema = z.object({
  tStartMs: z.number(),
  dDurationMs: z.number().optional().default(0),
  segs: z.array(z.object({ utf8: z.string() })).optional().default([]),
})

export const CaptionTrackSchema = z.object({
  events: z.array(CaptionEventSchema),
})
