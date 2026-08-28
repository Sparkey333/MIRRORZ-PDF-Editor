import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build modes:
//   npm run build        -> dist/ (multi-file, for hosting)
//   npm run build:single -> dist-single/mirrorz-pdf-editor.html (one self-contained
//                           file that runs offline from a double-click, no server)
const single = process.env.MIRRORZ_SINGLE === '1';

export default defineConfig({
  base: './',
  // Classic (iife) workers run from blob: URLs even on file:// — module
  // workers do not — and the offline single-file build depends on that.
  worker: { format: 'iife' },
  build: {
    outDir: single ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    ...(single ? { assetsInlineLimit: 100000000 } : {}),
  },
  plugins: single ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
