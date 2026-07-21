import { z } from 'zod'

export const HighFidelityResponseSchema = z.object({
  paragraphs: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string(),
    }),
  ),
})

export const HighFidelityStreamItemSchema = z.object({
  type: z.literal('paragraph'),
  id: z.string().min(1),
  text: z.string(),
})

const SourceParagraphIdsSchema = z.array(z.string().min(1)).min(1)

export const RefinedMapResponseSchema = z.object({
  chapterCandidates: z.array(
    z.object({
      title: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  claims: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  facts: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  people: z.array(
    z.object({
      name: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  examples: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  conclusions: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
})

export const RefinedReduceResponseSchema = z.object({
  overview: z.string(),
  coreIdeas: z.array(z.string()),
  chapters: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  importantFacts: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: SourceParagraphIdsSchema,
    }),
  ),
  conclusion: z.string(),
})

export const RefinedReduceStreamItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('overview'), text: z.string() }),
  z.object({ type: z.literal('core_idea'), text: z.string() }),
  z.object({
    type: z.literal('chapter'),
    title: z.string(),
    body: z.string(),
    sourceParagraphIds: SourceParagraphIdsSchema,
  }),
  z.object({
    type: z.literal('fact'),
    text: z.string(),
    sourceParagraphIds: SourceParagraphIdsSchema,
  }),
  z.object({ type: z.literal('conclusion'), text: z.string() }),
])
