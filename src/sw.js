// Rent Roll service worker — the app shell, offline, without ever serving a
// stale build.
//
// This file is the SOURCE. The build (see vite.config.js) writes it to
// dist/sw.js with the build id and this build's asset list filled in; it is
// never served from src/ and never registered in dev.
//
// Rules it lives by:
//   * The cache name carries the build id, which is a hash of this build's
//     asset names (which are content hashes). New build -> new cache.
//   * activate deletes every other Rent Roll cache, so an old build's files
//     cannot survive a deploy.
//   * A new worker does NOT take over on its own: it waits, the page shows
//     "Update available — reload", and only then does it skipWaiting.
//   * Documents are network-first, so a reload after a deploy always gets
//     the new index.html when the network is there; the cache is the
//     offline fallback.
//   * It NEVER touches localStorage. A service worker has no access to it,
//     no request here reads or writes it, and nothing is cached that could
//     stand in for it. The rent data lives only in the page's own storage.

const BUILD_ID = '__BUILD_ID__'
const CACHE = `rentroll-shell-${BUILD_ID}`
const ASSETS = __ASSETS__

// The shell: this build's hashed JS/CSS plus the fixed entry points.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  ...ASSETS,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // one at a time: a single 404 (a font, an icon) must not fail the install
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }))
          } catch {
            // skip what cannot be fetched; the fetch handler will try later
          }
        }),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('rentroll-shell-') && n !== CACHE).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

// The page asks for the update when the user says so, never before.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // fonts and anything else: untouched

  // Documents: network first, so a deploy is picked up on the next reload.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put('./index.html', fresh.clone())
          return fresh
        } catch {
          const cached = (await caches.match('./index.html')) ?? (await caches.match('./'))
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  // Everything else same-origin: cache first (asset names are content
  // hashed, so a cached one is never the wrong version), network otherwise.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE)
        cache.put(request, response.clone())
      }
      return response
    })(),
  )
})
