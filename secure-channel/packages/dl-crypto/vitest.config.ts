import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const sodiumCjs = resolve(__dirname, '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js');

export default defineConfig({
  test: {
    testTimeout: 30_000,
    server: {
      deps: {
        // Force vite-node to treat as CJS (avoiding broken ESM entry)
        inline: [/libsodium/],
      },
    },
  },
  resolve: {
    alias: [
      { find: 'libsodium-wrappers-sumo', replacement: sodiumCjs },
    ],
  },
});
