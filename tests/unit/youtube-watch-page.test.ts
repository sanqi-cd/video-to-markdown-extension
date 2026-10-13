import { describe, expect, it } from 'vitest'
import {
  extractYtInitialPlayerResponse,
  fetchYouTubeBridgePayload,
} from '../../src/adapters/youtube/watch-page'
import playerResponse from '../fixtures/youtube/player-response.json'

describe('YouTube watch-page caption loader', () => {
  it('extracts ytInitialPlayerResponse from a watch-page script', () => {
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>`
    expect(extractYtInitialPlayerResponse(html)).toMatchObject({
      videoDetails: { videoId: 'test123' },
    })
  })

  it('loads caption tracks from the Innertube player API', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(playerResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const payload = await fetchYouTubeBridgePayload('test123', fetchImpl)
    expect(payload?.tracks).toHaveLength(3)
    expect(payload?.tracks[0]).toMatchObject({ vssId: '.en', languageCode: 'en' })
  })

  it('merges alternate caption URLs from the watch page and official player clients', async () => {
    const withSource = (source: string) => ({
      ...playerResponse,
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks.map(
            (track) => ({ ...track, baseUrl: `${track.baseUrl}&source=${source}` }),
          ),
        },
      },
    })
    const requests: Array<{ clientName?: string; clientVersion?: string }> = []
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString().includes('/watch')) {
        const html = `<script>ytcfg.set({"INNERTUBE_CLIENT_NAME":"WEB","INNERTUBE_CLIENT_VERSION":"2.20260820.01.00"});var ytInitialPlayerResponse = ${JSON.stringify(withSource('watch'))};</script>`
        return new Response(html, { status: 200 })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        context?: { client?: { clientName?: string; clientVersion?: string } }
      }
      const client = body.context?.client ?? {}
      requests.push(client)
      return new Response(JSON.stringify(withSource(
        client.clientVersion === '2.20260820.01.00' ? 'current-web' : String(client.clientName),
      )), { status: 200 })
    }

    const payload = await fetchYouTubeBridgePayload('test123', fetchImpl)

    expect(requests).toContainEqual({
      clientName: 'WEB',
      clientVersion: '2.20260820.01.00',
    })
    expect(payload?.tracks[0]?.alternateBaseUrls).toEqual(expect.arrayContaining([
      expect.stringContaining('source=current-web'),
      expect.stringContaining('source=ANDROID'),
    ]))
  })
})
