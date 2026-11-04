import { defineConfig } from 'vite';

// The Android project (web/android) holds a full copy of the built game; keep the dev server's file watcher out of it,
// otherwise it holds those files open and `cap sync` cannot clear them on Windows.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { watch: { ignored: ['**/android/**', '**/dist/**', '**/dist_check/**'] } },
});
