import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { load, save } from './data/store.js'
import { formatDollars } from './data/schema.js'
import {
  RuleError,
  addFloor as opsAddFloor,
  addProperty as opsAddProperty,
  addSideAnnex as opsAddSideAnnex,
  addUnit as opsAddUnit,
  patchProperty,
  patchUnit,
  removeFloor as opsRemoveFloor,
  removeProperty as opsRemoveProperty,
  removeUnit as opsRemoveUnit,
  renameFloor as opsRenameFloor,
  setUnitWidths as opsSetUnitWidths,
  sideAnnexCheck,
} from './data/ops.js'
import { buildFromTemplate } from './data/templates.js'
import { computeTotals } from './data/totals.js'
import { ALL, displayedProperties, resolveSelection } from './lib/selection.js'
import Elevation from './components/Elevation.jsx'
import TitleBlock from './components/TitleBlock.jsx'
import UnitPanel from './components/UnitPanel.jsx'
import RaiseRentsSheet, { applyChanges, describeRaise } from './components/RaiseRents.jsx'
import BackupSheet, { describeReport } from './components/Backup.jsx'
import PrintView from './components/PrintView.jsx'
import TemplatePicker from './components/TemplatePicker.jsx'
import BuildingPicker from './components/BuildingPicker.jsx'
import { Chip } from './components/controls.jsx'

// All components at module scope (see components/UnitBox.jsx for why).

export default function App() {
  const [loaded] = useState(() => load())
  const [state, setState] = useState(loaded.state)
  const [saveError, setSaveError] = useState(null)
  const [openUnitId, setOpenUnitId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null) // 'raise' | 'backup' | 'template' | null
  const [printing, setPrinting] = useState(false)
  const [undo, setUndo] = useState(null) // { changes, label } from the last raise
  const [selected, setSelected] = useState(null) // building id | 'all' | null (= default)

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

  // Writes go through ops.js, which rejects rule breaks with RuleError.
  // Inside an updater we cannot set other state, so the notice is queued.
  const guarded = useCallback((fn) => {
    setState((s) => {
      try {
        return fn(s)
      } catch (err) {
        if (err instanceof RuleError) {
          queueMicrotask(() => setNotice({ tone: 'alert', text: err.message }))
          return s
        }
        throw err
      }
    })
  }, [])

  const updateUnit = useCallback((unitId, patch) => guarded((s) => patchUnit(s, unitId, patch)), [guarded])

  const updateProperty = useCallback(
    (propertyId, patch) => guarded((s) => patchProperty(s, propertyId, patch)),
    [guarded],
  )

  /**
   * The Build handles on the drawing. Every one of these is an ops call, so a
   * write that breaks a rule (a second annex, a unit that still holds
   * something) is refused there and shown as a notice.
   */
  const structure = useMemo(
    () => ({
      addFloor: (propertyId) => guarded((s) => opsAddFloor(s, propertyId)),
      addUnit: (propertyId, floorId) => guarded((s) => opsAddUnit(s, propertyId, floorId)),
      addAnnex: (propertyId, side) => guarded((s) => opsAddSideAnnex(s, propertyId, side)),
      removeFloor: (propertyId, floorId) => guarded((s) => opsRemoveFloor(s, propertyId, floorId)),
      renameFloor: (propertyId, floorId, label) =>
        guarded((s) => opsRenameFloor(s, propertyId, floorId, label)),
      setWidths: (propertyId, floorId, weights) =>
        guarded((s) => opsSetUnitWidths(s, propertyId, floorId, weights)),
      removeUnit: (unitId) =>
        guarded((s) => {
          const next = opsRemoveUnit(s, unitId) // throws when the unit holds anything
          queueMicrotask(() => setOpenUnitId((cur) => (cur === unitId ? null : cur)))
          return next
        }),
    }),
    [guarded],
  )

  /** Create a building from a template (the picker collects the choice). */
  const createProperty = useCallback(({ templateId, name }) => {
    let property
    try {
      property = buildFromTemplate(templateId, name)
    } catch (err) {
      setNotice({ tone: 'alert', text: err?.message ?? String(err) })
      return
    }
    setState((s) => opsAddProperty(s, property))
    // keep a single-building view on the building just made
    setSelected((cur) => (resolveSelection(stateRef.current.properties, cur) === ALL ? cur : property.id))
    setDialog(null)
    setNotice({ tone: 'line', text: `Added ${property.name}. Tap a unit to set its rent.` })
  }, [])

  const removeProperty = useCallback(
    (propertyId) => {
      guarded((s) => opsRemoveProperty(s, propertyId))
      setSelected((cur) => (cur === propertyId ? null : cur))
    },
    [guarded],
  )

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

  /** Apply a planned raise and remember how to undo it. */
  const applyRaise = useCallback(({ changes, mode, amount }) => {
    const before = computeTotals(stateRef.current.properties).collected
    const next = applyChanges(stateRef.current, changes, 'after')
    const after = computeTotals(next.properties).collected
    const label = describeRaise(mode, amount)
    setState((s) => applyChanges(s, changes, 'after'))
    setUndo({ changes, label })
    setDialog(null)
    setNotice({
      tone: 'amber',
      undo: true,
      text: `Raised ${changes.length} leased ${changes.length === 1 ? 'rent' : 'rents'} ${label}: ${formatDollars(before)} → ${formatDollars(after)} / mo.`,
    })
  }, [])

  const undoRaise = () => {
    if (!undo) return
    setState((s) => applyChanges(s, undo.changes, 'before'))
    setUndo(null)
    setNotice({
      tone: 'line',
      text: `Undid the ${undo.label} raise on ${undo.changes.length} ${undo.changes.length === 1 ? 'unit' : 'units'}. Any rent edited by hand since was left as is.`,
    })
  }

  const applyImport = useCallback((merged, report) => {
    setState(merged)
    setUndo(null)
    setNotice({ tone: 'line', text: `Imported: ${describeReport(report)}.` })
  }, [])

  const closePanel = useCallback(() => setOpenUnitId(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const stopPrinting = useCallback(() => setPrinting(false), [])
  const openTemplatePicker = useCallback(() => setDialog('template'), [])

  const openUnit = openUnitId ? findUnit(state, openUnitId) : null
  const totals = computeTotals(state.properties) // always the whole portfolio
  const selection = resolveSelection(state.properties, selected)
  const displayed = displayedProperties(state.properties, selection)
  const showing = selection === ALL ? null : displayed[0]?.name || 'Building'

  if (printing) {
    return <PrintView state={state} onBack={stopPrinting} />
  }

  return (
    <div className="bg-blueprint-grid flex min-h-dvh flex-col">
      <SheetHeader warnings={loaded.warnings} collected={totals.collected} />
      <Tools
        onRaise={() => setDialog('raise')}
        onUndo={undo ? undoRaise : null}
        undoLabel={undo?.label}
        onPrint={() => setPrinting(true)}
        onBackup={() => setDialog('backup')}
      />
      <BuildingPicker properties={state.properties} selection={selection} onSelect={setSelected} />
      {notice && (
        <Notice notice={notice} onDismiss={() => setNotice(null)} onUndo={notice.undo && undo ? undoRaise : null} />
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-8">
        <Elevation
          properties={displayed}
          onUnitChange={updateUnit}
          onPropertyChange={updateProperty}
          onOpenUnit={setOpenUnitId}
          onAddProperty={openTemplatePicker}
          onRemoveProperty={removeProperty}
          onSetPhoto={setPhoto}
          onNotice={setNotice}
          structure={structure}
          rentScale={totals.maxRent}
        />
      </div>

      <TitleBlock totals={totals} saveError={saveError} showing={showing} />

      {openUnit && (
        <UnitPanel
          key={openUnit.id}
          unit={openUnit}
          context={{ sideAnnex: sideAnnexCheck(state, openUnit.id) }}
          onChange={(patch) => updateUnit(openUnit.id, patch)}
          onClose={closePanel}
        />
      )}

      {dialog === 'template' && <TemplatePicker onCreate={createProperty} onClose={closeDialog} />}
      {dialog === 'raise' && (
        <RaiseRentsSheet properties={state.properties} onApply={applyRaise} onClose={closeDialog} />
      )}
      {dialog === 'backup' && (
        <BackupSheet state={state} onImport={applyImport} onNotice={setNotice} onClose={closeDialog} />
      )}
    </div>
  )
}

function SheetHeader({ warnings, collected }) {
  return (
    <header className="border-b border-line/40">
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-8">
        <h1 className="font-display text-base tracking-[0.3em] text-ink uppercase">Rent Roll</h1>
        {/* live portfolio readout that stays visible above a phone keyboard */}
        <div className="text-[10px] tracking-[0.2em] text-line/70 uppercase">
          Portfolio <span className="text-sm tracking-normal text-ink tabular-nums">{formatDollars(collected)}</span>{' '}
          / mo
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

/** Sheet-level tools. 40px tall chips so they are easy to hit on a phone. */
function Tools({ onRaise, onUndo, undoLabel, onPrint, onBackup }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/40 px-4 py-2 sm:px-8">
      <Chip onClick={onRaise} className="min-h-10" title="Model a rent increase across leased units">
        Raise rents
      </Chip>
      {onUndo && (
        <Chip tone="alert" onClick={onUndo} className="min-h-10" title="Put the rents back">
          Undo {undoLabel}
        </Chip>
      )}
      <Chip onClick={onPrint} className="min-h-10" title="Clean table view to print or save as PDF">
        Print / PDF
      </Chip>
      <Chip onClick={onBackup} className="min-h-10" title="Export or import the JSON data">
        Backup
      </Chip>
    </div>
  )
}

const NOTICE_TONE = {
  alert: 'border-alert/40 bg-alert/10 text-alert',
  amber: 'border-amber/40 bg-amber/10 text-amber',
  line: 'border-line/40 bg-line/10 text-ink',
}

function Notice({ notice, onDismiss, onUndo }) {
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 border-b px-4 py-2 text-xs sm:px-8 ${NOTICE_TONE[notice.tone] ?? NOTICE_TONE.line}`}
    >
      <span className="min-w-0 break-words">{notice.text}</span>
      <div className="flex shrink-0 items-center gap-1">
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="min-h-8 border border-current px-2 text-[9px] tracking-[0.2em] uppercase"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 -mr-2 flex h-8 w-8 items-center justify-center opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function findUnit(state, unitId) {
  for (const p of state.properties) {
    for (const f of p.floors) {
      const u = f.units.find((x) => x.id === unitId)
      if (u) return u
    }
  }
  return null
}

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
