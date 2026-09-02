// Registering the service worker, and noticing when a new build is waiting.
//
// Production only: in dev there is no sw.js and nothing here runs, so the
// dev server is never shadowed by a cache. Nothing in this file touches
// localStorage.

const listeners = new Set()
let waiting = null
let reloading = false

/** Tell me when a new build is installed and waiting. Returns an unsubscribe. */
export function onUpdateReady(fn) {
  listeners.add(fn)
  if (waiting) fn()
  return () => listeners.delete(fn)
}

/** The user said yes: let the waiting worker take over, then reload. */
export function applyUpdate() {
  if (!waiting) {
    window.location.reload()
    return
  }
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function announce(worker) {
  waiting = worker
  for (const fn of listeners) fn()
}

/**
 * Register /sw.js and watch for a newer one. Safe to call anywhere: it does
 * nothing in dev, on http where service workers are unavailable, or in a
 * browser without support.
 */
export function registerServiceWorker() {
  if (import.meta.env.DEV || !import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting)

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // installed + an existing controller means this is an update, not
          // the very first install
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announce(installing)
          }
        })
      })

      // the new worker took over: reload once so the page matches its build
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return
        reloading = true
        window.location.reload()
      })
    } catch (err) {
      // An unregistered worker only costs offline use; the app still runs.
      console.warn('rentroll: service worker not registered', err)
    }
  })
}
