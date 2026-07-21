import { defineConfig } from 'wxt'
import react from '@vitejs/plugin-react'

export default defineConfig({
  vite: () => ({
    plugins: [react()],
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    minimum_chrome_version: '114',
    name: 'Video to Markdown',
    description: 'Convert existing video subtitles into Chinese Markdown.',
    permissions: ['sidePanel', 'storage', 'downloads'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
    ],
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Open Video to Markdown' },
    side_panel: { default_path: 'sidepanel.html' },
  },
})
