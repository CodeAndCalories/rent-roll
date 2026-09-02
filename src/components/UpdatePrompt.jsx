import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady } from '../lib/sw.js'

// All components at module scope (see UnitBox.jsx for why).

/**
 * "Update available — reload", shown only when a new build has installed and
 * is waiting. Nothing reloads on its own: a reload mid-edit would be rude,
 * and the data is already written on every change either way.
 *
 * In dev, and in a browser with no service worker, this never appears.
 */
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false)

  useEffect(() => onUpdateReady(() => setReady(true)), [])

  if (!ready) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/40 bg-amber/10 px-4 py-2 text-xs text-amber sm:px-8"
    >
      <span>Update available — a newer version of Rent Roll is ready.</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="inline-flex min-h-11 cursor-pointer items-center border border-amber px-3 text-[10px] tracking-[0.2em] uppercase hover:bg-amber hover:text-sheet"
      >
        Reload
      </button>
    </div>
  )
}
