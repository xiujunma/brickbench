import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { headersForEveryPath } from './scripts/siteHeaders.ts';
import { thirdPartyLicences } from './scripts/thirdPartyLicences.ts';

export default defineConfig({
  plugins: [react(), thirdPartyLicences()],
  server: {
    // thousands of generated library files: nothing there needs hot reloading
    watch: { ignored: ['**/public/ldraw*/**', '**/.ldraw-cache/**'] },
  },
  // the hosted site's headers, its security policy included: the browser tests in CI run against the build under them
  preview: {
    headers: headersForEveryPath(fileURLToPath(new URL('./public/_headers', import.meta.url))),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
