import type { BridgePayload } from './page-bridge'

const MIN_DURATION_RATIO = 0.6
const MIN_TITLE_SIMILARITY_WITHOUT_DURATION = 0.12
const MIN_TITLE_SIMILARITY_FOR_AUTO_SELECTION = 0.12
const MIN_SELECTION_SCORE_MARGIN = 8

export type YouTubeSourceCandidate = {
  videoId: string
  payload: BridgePayload
}

export function durationRatio(leftMs?: number, rightMs?: number): number | null {
  if (!leftMs || !rightMs || leftMs <= 0 || rightMs <= 0) return null
  return Math.min(leftMs, rightMs) / Math.max(leftMs, rightMs)
}

export function titleSimilarity(left: string, right: string): number {
  const source = tokenizeTitle(left)
  const target = tokenizeTitle(right)
  if (source.size === 0 || target.size === 0) return 0
  let overlap = 0
  for (const token of source) {
    if (target.has(token)) overlap += 1
  }
  return overlap / Math.max(source.size, target.size)
}

export function isPlausibleYouTubeSource(
  biliTitle: string,
  biliDurationMs: number | undefined,
  payload: BridgePayload,
): boolean {
  const ratio = durationRatio(biliDurationMs, payload.metadata.durationMs)
  const similarity = titleSimilarity(biliTitle, payload.metadata.title)
  if (ratio !== null && ratio < MIN_DURATION_RATIO) return false
  if (ratio === null && similarity < MIN_TITLE_SIMILARITY_WITHOUT_DURATION) return false
  return true
}

export function scoreYouTubeSource(
  biliTitle: string,
  biliDurationMs: number | undefined,
  payload: BridgePayload,
  sourceBoost = 0,
): number {
  const ratio = durationRatio(biliDurationMs, payload.metadata.durationMs) ?? 0
  const similarity = titleSimilarity(biliTitle, payload.metadata.title)
  return ratio * 100 + similarity * 50 + sourceBoost
}

export function selectMatchingYouTubeSource(
  biliTitle: string,
  biliDurationMs: number | undefined,
  candidates: YouTubeSourceCandidate[],
  boostedIds: Set<string> = new Set(),
): YouTubeSourceCandidate | null {
  const plausible = candidates.filter((candidate) => (
    isPlausibleYouTubeSource(biliTitle, biliDurationMs, candidate.payload)
  ))
  if (plausible.length === 0) return null
  const boosted = plausible.filter((candidate) => boostedIds.has(candidate.videoId))
  // Automatic selection needs evidence beyond a similar duration. A link explicitly
  // marked as the original source is strongest; otherwise require title overlap.
  const evidenced = boosted.length > 0
    ? boosted
    : plausible.filter((candidate) => (
      titleSimilarity(biliTitle, candidate.payload.metadata.title)
        >= MIN_TITLE_SIMILARITY_FOR_AUTO_SELECTION
    ))
  if (evidenced.length === 0) return null
  if (evidenced.length === 1) return evidenced[0]!

  const ranked = evidenced
    .map((candidate) => ({
      candidate,
      score: scoreYouTubeSource(
        biliTitle,
        biliDurationMs,
        candidate.payload,
        boostedIds.has(candidate.videoId) ? 20 : 0,
      ),
    }))
    .sort((left, right) => right.score - left.score)
  if (ranked[0]!.score - ranked[1]!.score < MIN_SELECTION_SCORE_MARGIN) return null
  return ranked[0]!.candidate
}

export function youtubeIdsBoostedBySourceContext(text: string, ids: string[]): Set<string> {
  const boosted = new Set<string>()
  for (const id of ids) {
    const index = text.indexOf(id)
    if (index < 0) continue
    const window = text.slice(Math.max(0, index - 48), index + id.length + 16)
    if (/原视[频頻]|source|original|搬运自|YouTube\s*原/i.test(window)) boosted.add(id)
  }
  return boosted
}

function tokenizeTitle(text: string): Set<string> {
  const stripped = text
    .toLowerCase()
    .replace(/【[^】]*】|\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ' ')
  const tokens = new Set<string>()
  for (const token of stripped.match(/[a-z][a-z0-9]+/g) ?? []) {
    if (token.length >= 3) tokens.add(token)
  }
  const cjk = stripped.replace(/[^\u4e00-\u9fff]/g, '')
  for (let index = 0; index < cjk.length - 1; index += 1) {
    tokens.add(cjk.slice(index, index + 2))
  }
  return tokens
}
