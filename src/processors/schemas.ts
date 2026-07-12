import { z } from 'zod'

export const HighFidelityResponseSchema = z.object({
  paragraphs: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string(),
    }),
  ),
})

export const RefinedMapResponseSchema = z.object({
  chapterCandidates: z.array(
    z.object({
      title: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  claims: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  facts: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  people: z.array(
    z.object({
      name: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  examples: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  conclusions: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: z.array(z.string()),
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
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  importantFacts: z.array(
    z.object({
      text: z.string(),
      sourceParagraphIds: z.array(z.string()),
    }),
  ),
  conclusion: z.string(),
})
