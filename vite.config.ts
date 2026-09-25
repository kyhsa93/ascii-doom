import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves this from a subdirectory, so every asset URL needs the
  // repository name in front of it. A page that works locally and 404s on
  // Pages is almost always this line.
  base: '/ascii-doom/',
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
