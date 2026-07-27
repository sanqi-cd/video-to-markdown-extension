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
    description: 'Convert existing YouTube and Bilibili subtitles into Chinese or English Markdown.',
    permissions: ['sidePanel', 'storage', 'downloads'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
    ],
    optional_host_permissions: ['https://*/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'Open Video to Markdown',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
    side_panel: { default_path: 'sidepanel.html' },
  },
})
