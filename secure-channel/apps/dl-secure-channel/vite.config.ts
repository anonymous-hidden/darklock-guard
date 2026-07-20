import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { buildContentSecurityPolicy } from './electron/cspPolicy';

function electronDevelopmentCsp(): Plugin {
  return {
    name: 'electron-development-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(" \/>)/,
        `$1${buildContentSecurityPolicy(true)}$2`,
      );
    },
  };
}

/** Strip `crossorigin` attributes so scripts load correctly via file:// in Electron */
function electronCrossOriginFix(): Plugin {
  return {
    name: 'electron-crossorigin-fix',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), electronDevelopmentCsp(), electronCrossOriginFix()],
  base: './',
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'libsodium-wrappers-sumo': path.resolve(
        __dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      ),
    },
  },
  clearScreen: false,
  root: path.resolve(__dirname),
  server: {
    // Keep the Electron dev renderer on one loopback family. `localhost` can
    // flip between IPv4 and IPv6 while a VPN or Tailscale changes networks.
    host: '127.0.0.1',
    port: 1421,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
    proxy: {
      // Forward /api/ids/* → https://ids.darklock.net/*
      // This bypasses browser CORS restrictions in dev mode.
      '/api/ids': {
        target: 'https://ids.darklock.net',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/ids/, ''),
      },
      // Forward /api/rly/* → https://rly.darklock.net/*
      '/api/rly': {
        target: 'https://rly.darklock.net',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/rly/, ''),
      },
    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
    esbuildOptions: { target: 'esnext' },
  },
  build: {
    target: 'esnext',
    minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
});
