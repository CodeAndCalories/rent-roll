import { Component } from 'react'
import { exportJSON, load } from '../data/store.js'

// All components at module scope (see UnitBox.jsx for why).
//
// Last line of defence against a blank screen: if anything in the tree
// throws while rendering, show what happened and offer a reload and a
// backup download. localStorage is untouched by a render error.

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('rentroll: render error', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <Crash error={this.state.error} />
  }
}

function Crash({ error }) {
  const message = error?.message || String(error) || 'unknown error'
  const backup = () => {
    const r = exportJSON(load().state)
    if (!r.ok) window.alert(`Backup failed: ${r.error?.message ?? 'unknown error'}`)
  }
  return (
    <main className="bg-blueprint-grid flex min-h-dvh flex-col items-center justify-center p-6 font-mono text-ink">
      <div className="w-full max-w-md border-2 border-alert bg-sheet p-5">
        <h1 className="font-display text-sm tracking-[0.3em] text-alert uppercase">Something broke</h1>
        <p className="mt-2 text-xs text-ink">
          The screen could not be drawn. Your data is still saved in this browser and was not changed by
          this error.
        </p>
        <pre className="mt-3 overflow-x-auto border border-line/30 p-2 text-[10px] break-words whitespace-pre-wrap text-line">
          {message}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 border border-amber bg-amber px-3 text-[10px] tracking-[0.2em] text-sheet uppercase"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={backup}
            className="min-h-11 border border-line/50 px-3 text-[10px] tracking-[0.2em] text-line uppercase hover:border-amber hover:text-amber"
          >
            Download backup
          </button>
        </div>
      </div>
    </main>
  )
}
