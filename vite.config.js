import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Emits dist/sw.js from src/sw.js with:
 *   __BUILD_ID__  a hash of this build's asset file names, which are
 *                 themselves content hashes — so the cache name changes when
 *                 (and only when) the build changes, and an old cache is
 *                 never reused for a new deploy
 *   __ASSETS__    the JS/CSS this build actually emitted, to precache
 *
 * Build only: the dev server never has a service worker to shadow it.
 */
function serviceWorker() {
  return {
    name: 'rentroll-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // the browser build only: an SSR build has no shell to cache
      if (this.environment?.name && this.environment.name !== 'client') return

      const assets = Object.keys(bundle)
        .filter((f) => /\.(js|css)$/.test(f))
        .map((f) => `./${f}`)
      const buildId = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 12)
      const source = readFileSync('src/sw.js', 'utf8')
        .replaceAll('__BUILD_ID__', buildId)
        .replaceAll('__ASSETS__', JSON.stringify(assets))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly if 5173 is taken instead of silently moving ports
    open: false,      // never auto-open a browser
  },
  preview: {
    port: 4173,
    strictPort: true,
    open: false,
  },
})
