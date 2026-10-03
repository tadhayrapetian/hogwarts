import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Hogwarts Mail Management System',
        short_name: 'Owl Post',
        description: 'Offline-first management system for personalised magical correspondence.',
        theme_color: '#5b1f1a',
        background_color: '#f4efe6',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,ico}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
