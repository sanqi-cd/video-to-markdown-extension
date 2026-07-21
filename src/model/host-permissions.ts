import { normalizeBaseUrl } from './config-store'

export async function requestModelOrigin(
  baseUrl: string,
  request: (permissions: { origins: string[] }) => Promise<boolean>,
): Promise<boolean> {
  const origin = new URL(normalizeBaseUrl(baseUrl)).origin
  return request({ origins: [`${origin}/*`] })
}
