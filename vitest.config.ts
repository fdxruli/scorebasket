import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import 'jsdom';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pwa-virtual-mock',
      resolveId(id) {
        if (id === 'virtual:pwa-register') {
          return '\0' + id;
        }
      },
      load(id) {
        if (id === '\0virtual:pwa-register') {
          return 'export function registerSW() { return () => Promise.resolve(); }';
        }
      }
    }
  ],
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts']
  }
});
