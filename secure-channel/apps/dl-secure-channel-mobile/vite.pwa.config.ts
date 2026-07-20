import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite config for the PWA build.
 * Shares the same React source as the Electron app but uses
 * the PWA adapter (web APIs) instead of Capacitor native plugins.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    alias: {
      'libsodium-wrappers-sumo': path.resolve(
        __dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      ),
    },
  },
  root: path.resolve(__dirname),
  base: '/app/secure-channel/',
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    // Mobile Safari/WebView compatibility: avoid shipping esnext syntax
    // that can parse-fail on older devices and cause a black screen.
    target: 'es2019',
    outDir: path.resolve(__dirname, 'dist-pwa'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'pwa.html'),
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-sodium': ['libsodium-wrappers-sumo'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
    esbuildOptions: { target: 'esnext' },
  },
});
