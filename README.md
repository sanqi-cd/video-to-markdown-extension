# Video to Markdown

A Chrome browser extension that converts YouTube and Bilibili video subtitles into Chinese Markdown documents.

## Features

- **High-Fidelity Mode**: Preserves original subtitle information with cleaning, sentence segmentation, and paragraph recovery (no model calls for Chinese subtitles)
- **AI Refined Mode**: Extracts key facts, opinions, and arguments to generate structured notes
- **Timestamps**: Optional timestamp links for native video positioning
- **Local-First**: No account required, bring your own OpenAI-compatible API Key

## Supported Platforms

- YouTube (www.youtube.com)
- Bilibili (www.bilibili.com)

## Usage

1. Load the unpacked extension in Chrome (Developer Mode)
2. Open Settings, fill in API Key, Base URL, and Model name
3. Test connection
4. Open a YouTube or Bilibili video page, click the extension icon to open the Side Panel
5. Select subtitle track and processing mode, click "Start"
6. Preview, copy, or download the Markdown

## Development

```bash
pnpm install
pnpm dev       # Dev mode with HMR
pnpm build     # Production build
pnpm test      # Run tests
pnpm typecheck # Type check
pnpm lint      # Lint
```

## Tech Stack

- WXT (Manifest V3 extension framework)
- React (Side Panel UI)
- TypeScript (strict)
- Zod (runtime validation)
- Vitest + Testing Library (unit/component tests)
- Playwright (E2E tests)

## Permissions

- `sidePanel`: Display the side panel
- `storage`: Local configuration storage
- `downloads`: Export Markdown files
- Host permissions for YouTube and Bilibili
- Optional permission for user-configured model origin

## Privacy

This extension does NOT send any data to proprietary servers. Subtitle content is sent to the user's chosen model provider via their own API Key. See [PRIVACY.md](./PRIVACY.md).

## Known Limitations (MVP)

- Only processes videos with existing subtitles (no audio transcription)
- Only supports OpenAI-compatible API protocol
- Tasks abort when Side Panel is closed (no background processing)
- Chrome 114+ only

## License

[MIT](./LICENSE)
