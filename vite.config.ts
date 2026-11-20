import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { headersForEveryPath } from './scripts/siteHeaders.ts';
import { thirdPartyLicences } from './scripts/thirdPartyLicences.ts';

/**
 * Where the site's /api requests go while developing and previewing: the API
 * on this computer (`bun run api`, server/local.ts). Without it running, the
 * site has no accounts or gallery, as on a host without a database. The
 * request keeps the page's host, as on the hosted site, where the API is the
 * site: the API checks that changes come from its own pages, and tells
 * sign-in providers where to send people back.
 */
const api = { '/api': { target: process.env['BRICKBENCH_API'] ?? 'http://127.0.0.1:8788', changeOrigin: false } };

export default defineConfig({
  plugins: [react(), thirdPartyLicences()],
  server: {
    // thousands of generated library files: nothing there needs hot reloading
    watch: { ignored: ['**/public/ldraw*/**', '**/.ldraw-cache/**'] },
    proxy: api,
  },
  // the hosted site's headers, its security policy included: the browser tests in CI run against the build under them
  preview: {
    headers: headersForEveryPath(fileURLToPath(new URL('./public/_headers', import.meta.url))),
    proxy: api,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
