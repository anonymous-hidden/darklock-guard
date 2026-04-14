import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve('src/main/preload.js')
      }
    }
  },
  renderer: {
    root: path.resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: path.resolve('src/renderer/index.html')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.mjs'
    }
  }
})

