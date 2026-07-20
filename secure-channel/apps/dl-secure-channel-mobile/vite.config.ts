import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite config for the Capacitor (mobile) build.
 * Shares the same source as the Electron app but injects
 * the mobile platform adapter before the app entry point.
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
  build: {
    // Keep syntax broadly compatible with mobile WebViews.
    target: 'es2019',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
    esbuildOptions: { target: 'esnext' },
  },
});
