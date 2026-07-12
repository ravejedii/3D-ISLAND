import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths so the build works from any subpath (GitHub Pages)
  server: { port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
