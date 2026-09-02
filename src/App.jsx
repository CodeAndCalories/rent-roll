import { useCallback, useEffect, useRef, useState } from 'react'
import { load, save } from './data/store.js'
import { formatDollars, makeFloor, makeProperty, makeUnit } from './data/schema.js'
import Elevation from './components/Elevation.jsx'
import TitleBlock, { computeTotals } from './components/TitleBlock.jsx'
import UnitPanel from './components/UnitPanel.jsx'

// All components at module scope (see components/UnitBox.jsx for why).

export default function App() {
  const [loaded] = useState(() => load())
  const [state, setState] = useState(loaded.state)
  const [saveError, setSaveError] = useState(null)
  const [openUnitId, setOpenUnitId] = useState(null)
  const [notice, setNotice] = useState(null)

  // Latest state for callbacks that need to read it outside a render
  // (photo upload does a trial save before committing).
  const stateRef = useRef(state)
  stateRef.current = state

  // Persist the whole state on every change. save() refuses unsafe writes
  // and reports failures (e.g. quota) instead of throwing.
  useEffect(() => {
    const r = save(state)
    setSaveError(r.ok ? null : describeSaveError(r))
  }, [state])

  const updateUnit = useCallback((unitId, patch) => {
    setState((s) => patchUnit(s, unitId, patch))
  }, [])

  const updateProperty = useCallback((propertyId, patch) => {
    setState((s) => patchProperty(s, propertyId, patch))
  }, [])

  const addProperty = useCallback(() => {
    setState((s) => ({ ...s, properties: [...s.properties, newProperty()] }))
  }, [])

  const removeProperty = useCallback((propertyId) => {
    const s = stateRef.current
    const p = s.properties.find((x) => x.id === propertyId)
    if (!p) return
    if (countUnits(p) > 0) {
      setNotice({ tone: 'alert', text: `${p.name || 'That building'} still has units. Remove them first.` })
      return
    }
    if (s.properties.length <= 1) {
      setNotice({ tone: 'alert', text: 'Keep at least one building on the sheet.' })
      return
    }
    setState((cur) => ({ ...cur, properties: cur.properties.filter((x) => x.id !== propertyId) }))
  }, [])

  /**
   * Store a resized photo. A trial save runs first so a quota failure is
   * reported immediately and the app never holds a photo it cannot persist.
   */
  const setPhoto = useCallback((propertyId, { dataUrl, w, h, bytes }) => {
    const patch = { photo: dataUrl, photoSize: { w, h }, view: 'photo' }
    const trial = save(patchProperty(stateRef.current, propertyId, patch))
    if (!trial.ok) {
      setNotice({ tone: 'alert', text: describePhotoFailure(trial, bytes) })
      return
    }
    setState((s) => patchProperty(s, propertyId, patch))
    setNotice({
      tone: 'line',
      text: `Photo saved at ${w}×${h}, ${kb(bytes)} KB. Whole data set is now ${kb(trial.bytes)} KB.`,
    })
  }, [])

  const closePanel = useCallback(() => setOpenUnitId(null), [])

  const openUnit = openUnitId ? findUnit(state, openUnitId) : null
  const totals = computeTotals(state.properties)

  return (
    <div className="bg-blueprint-grid flex min-h-dvh flex-col">
      <SheetHeader warnings={loaded.warnings} collected={totals.collected} />
      {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-8">
        <Elevation
          properties={state.properties}
          onUnitChange={updateUnit}
          onPropertyChange={updateProperty}
          onOpenUnit={setOpenUnitId}
          onAddProperty={addProperty}
          onRemoveProperty={removeProperty}
          onSetPhoto={setPhoto}
          onNotice={setNotice}
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

const NOTICE_TONE = {
  alert: 'border-alert/40 bg-alert/10 text-alert',
  amber: 'border-amber/40 bg-amber/10 text-amber',
  line: 'border-line/40 bg-line/10 text-ink',
}

function Notice({ notice, onDismiss }) {
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 border-b px-4 py-2 text-xs sm:px-8 ${NOTICE_TONE[notice.tone] ?? NOTICE_TONE.line}`}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-my-1 -mr-2 flex h-7 w-7 shrink-0 items-center justify-center opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
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

/** `patch` is a partial property, or a function (property) => partial. */
export function patchProperty(state, propertyId, patch) {
  return {
    ...state,
    properties: state.properties.map((p) => {
      if (p.id !== propertyId) return p
      const partial = typeof patch === 'function' ? patch(p) : patch
      return { ...p, ...partial }
    }),
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

function countUnits(property) {
  return property.floors.reduce((n, f) => n + f.units.length, 0)
}

/** A blank two-storey building to model from. */
export function newProperty() {
  return makeProperty({
    name: 'New building',
    shape: 'gable',
    floors: [
      makeFloor({ label: '2F', units: [makeUnit({ name: '2F', position: 'full' })] }),
      makeFloor({ label: '1F', units: [makeUnit({ name: '1F', position: 'full' })] }),
    ],
  })
}

// ---------------------------------------------------------------------------
// save failure messages
// ---------------------------------------------------------------------------

function isQuotaError(err) {
  if (!err) return false
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message ?? '')
  )
}

function describeSaveError(result) {
  if (isQuotaError(result.error)) {
    return `localStorage is full (data set is ${kb(result.bytes)} KB). Remove or shrink a photo.`
  }
  return result.error?.message ?? 'unknown error'
}

function describePhotoFailure(result, photoBytes) {
  if (isQuotaError(result.error)) {
    return (
      `Photo not saved: the browser's localStorage is full. This photo is ${kb(photoBytes)} KB ` +
      `and the whole data set would be ${kb(result.bytes)} KB; the limit is usually about 5,000 KB. ` +
      'Crop the screenshot tighter or remove another building’s photo.'
    )
  }
  return `Photo not saved: ${result.error?.message ?? 'unknown error'}.`
}

function kb(bytes) {
  return Math.round((bytes || 0) / 1024).toLocaleString('en-US')
}
