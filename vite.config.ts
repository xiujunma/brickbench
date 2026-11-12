import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // thousands of generated library files: nothing there needs hot reloading
    watch: { ignored: ['**/public/ldraw*/**', '**/.ldraw-cache/**'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
