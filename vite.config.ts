import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              onwarn(warning, defaultHandler) {
                if (warning.message.includes('codeSplitting') || warning.message.includes('platform')) return
                defaultHandler(warning)
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              onwarn(warning, defaultHandler) {
                if (warning.message.includes('codeSplitting') || warning.message.includes('platform')) return
                defaultHandler(warning)
              },
            },
          },
        },
      },
    }),
  ],
})
