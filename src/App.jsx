import { useEffect, useState } from 'react'
import { load, save, STORAGE_KEY } from './data/store.js'

// TEMPORARY. Proves the data layer round-trips through localStorage:
// load() -> save() -> dump the state. The blueprint elevation replaces this
// in a later session.
export default function App() {
  const [loaded] = useState(() => load())
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    setSaved(save(loaded.state))
  }, [loaded])

  return (
    <main className="bg-blueprint-grid min-h-screen p-6">
      <h1 className="text-ink border-ink inline-block border px-4 py-2 text-xl uppercase tracking-[0.3em]">
        Rent Roll
      </h1>

      <section className="text-ink-dim mt-4 space-y-1 text-xs">
        <div>
          loaded from: <span className="text-paper">{loaded.source}</span>
          {loaded.from != null && (
            <span>
              {' '}
              (schema v{loaded.from} → v{loaded.state.version})
            </span>
          )}
        </div>
        <div>
          saved to {STORAGE_KEY}:{' '}
          <span className="text-paper">
            {saved == null
              ? '…'
              : saved.ok
                ? `ok, ${saved.bytes} bytes`
                : `FAILED: ${saved.error?.message}`}
          </span>
        </div>
        {loaded.warnings.map((w, i) => (
          <div key={i} className="text-amber-300">
            warning: {w}
          </div>
        ))}
      </section>

      <pre className="border-ink-dim/60 bg-sheet-deep/80 text-paper mt-4 overflow-x-auto rounded border p-4 text-[11px] leading-snug">
        {JSON.stringify(loaded.state, null, 2)}
      </pre>
    </main>
  )
}
