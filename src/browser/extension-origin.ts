export type ExtensionSender = {
  url?: string
  id?: string
  origin?: string
}

type ExtensionRuntime = {
  id: string
  getURL: (path: string) => string
}

/**
 * Content scripts always include the page URL. Chrome Side Panel ports sometimes
 * omit `sender.url` (and even `sender.id`); treating those as untrusted immediately
 * disconnects the model stream.
 */
export function isTrustedExtensionSender(
  sender: ExtensionSender,
  runtime: ExtensionRuntime,
): boolean {
  const extensionUrl = runtime.getURL('')
  const extensionOrigin = extensionUrl.replace(/\/$/, '')
  if (sender.url) return sender.url.startsWith(extensionUrl)
  if (sender.origin) {
    return sender.origin === extensionOrigin || sender.origin.startsWith(extensionOrigin)
  }
  return true
}
