import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'packages/core/src/**/*.test.ts', 'packages/editor/src/**/*.test.{ts,tsx}', 'packages/compiler/src/**/*.test.ts', 'packages/editing-engine/src/**/*.test.ts', '__tests__/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    server: {
      deps: {
        inline: ['maplibre-gl'],
      },
    },
  },
})
