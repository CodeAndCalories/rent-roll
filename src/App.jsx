import { useCallback, useEffect, useState } from 'react'
import { load, save } from './data/store.js'
import { formatDollars } from './data/schema.js'
import Elevation from './components/Elevation.jsx'
import TitleBlock, { computeTotals } from './components/TitleBlock.jsx'
import UnitPanel from './components/UnitPanel.jsx'

// All components at module scope (see components/UnitBox.jsx for why).

export default function App() {
  const [loaded] = useState(() => load())
  const [state, setState] = useState(loaded.state)
  const [saveError, setSaveError] = useState(null)
  const [openUnitId, setOpenUnitId] = useState(null)

  // Persist the whole state on every change. save() refuses unsafe writes
  // and reports failures (e.g. quota) instead of throwing.
  useEffect(() => {
    const r = save(state)
    setSaveError(r.ok ? null : (r.error?.message ?? 'unknown error'))
  }, [state])

  const updateUnit = useCallback((unitId, patch) => {
    setState((s) => patchUnit(s, unitId, patch))
  }, [])

  const updateProperty = useCallback((propertyId, patch) => {
    setState((s) => ({
      ...s,
      properties: s.properties.map((p) => (p.id === propertyId ? { ...p, ...patch } : p)),
    }))
  }, [])

  const closePanel = useCallback(() => setOpenUnitId(null), [])

  const openUnit = openUnitId ? findUnit(state, openUnitId) : null
  const totals = computeTotals(state.properties)

  return (
    <div className="bg-blueprint-grid flex min-h-dvh flex-col">
      <SheetHeader warnings={loaded.warnings} collected={totals.collected} />

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-8">
        <Elevation
          properties={state.properties}
          onUnitChange={updateUnit}
          onPropertyChange={updateProperty}
          onOpenUnit={setOpenUnitId}
        />
      </div>

      <TitleBlock totals={totals} saveError={saveError} />

      {openUnit && (
        <UnitPanel
          key={openUnit.id}
          unit={openUnit}
          onChange={(patch) => updateUnit(openUnit.id, patch)}
          onClose={closePanel}
        />
      )}
    </div>
  )
}

function SheetHeader({ warnings, collected }) {
  return (
    <header className="border-b border-line/40">
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-8">
        <h1 className="font-display text-base tracking-[0.3em] text-ink uppercase">Rent Roll</h1>
        {/* live readout that stays visible above a phone keyboard */}
        <div className="text-[10px] tracking-[0.2em] text-line/70 uppercase">
          <span className="text-sm tracking-normal text-ink tabular-nums">{formatDollars(collected)}</span> / mo
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="border-t border-alert/40 bg-alert/10 px-4 py-2 text-xs text-alert sm:px-8">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </header>
  )
}

// ---------------------------------------------------------------------------
// immutable state helpers
// ---------------------------------------------------------------------------

/** `patch` is a partial unit, or a function (unit) => partial unit. */
export function patchUnit(state, unitId, patch) {
  return {
    ...state,
    properties: state.properties.map((p) => ({
      ...p,
      floors: p.floors.map((f) => ({
        ...f,
        units: f.units.map((u) => {
          if (u.id !== unitId) return u
          const partial = typeof patch === 'function' ? patch(u) : patch
          return { ...u, ...partial }
        }),
      })),
    })),
  }
}

function findUnit(state, unitId) {
  for (const p of state.properties) {
    for (const f of p.floors) {
      const u = f.units.find((x) => x.id === unitId)
      if (u) return u
    }
  }
  return null
}
