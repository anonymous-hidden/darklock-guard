import { defineConfig } from 'vite';

export default defineConfig({
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  
  server: {
    // Tauri expects a fixed port
    port: 1420,
    strictPort: true,
    // Allow access from Tauri
    host: true,
  },
  
  // Env variables starting with TAURI_ will be exposed
  envPrefix: ['VITE_', 'TAURI_'],
  
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    // Minify for production, don't for dev
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
