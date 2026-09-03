import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { load, save } from './data/store.js'
import { formatDollars, makePortfolio } from './data/schema.js'
import {
  RuleError,
  addFloor as opsAddFloor,
  addPortfolio as opsAddPortfolio,
  addProperty as opsAddProperty,
  describePortfolio,
  addSideAnnex as opsAddSideAnnex,
  addUnit as opsAddUnit,
  clearPayment as opsClearPayment,
  cyclePayment as opsCyclePayment,
  patchProperty,
  patchUnit,
  removeFloor as opsRemoveFloor,
  removePortfolio as opsRemovePortfolio,
  removeProperty as opsRemoveProperty,
  removeUnit as opsRemoveUnit,
  renameFloor as opsRenameFloor,
  renamePortfolio as opsRenamePortfolio,
  setPayment as opsSetPayment,
  setUnitWidths as opsSetUnitWidths,
  sideAnnexCheck,
} from './data/ops.js'
import { buildFromTemplate } from './data/templates.js'
import { computeTotals } from './data/totals.js'
import { monthKey } from './lib/months.js'
import { ALL, displayedProperties, resolveSelection } from './lib/selection.js'
import {
  activePortfolio,
  portfolioSummaries,
  portfolioState,
  propertiesOf,
  resolvePortfolioId,
} from './lib/portfolios.js'
import Elevation from './components/Elevation.jsx'
import TitleBlock from './components/TitleBlock.jsx'
import UnitPanel from './components/UnitPanel.jsx'
import MonthView from './components/MonthView.jsx'
import RaiseRentsSheet, { applyChanges, describeRaise } from './components/RaiseRents.jsx'
import BackupSheet, { describeReport } from './components/Backup.jsx'
import PrintView from './components/PrintView.jsx'
import TemplatePicker from './components/TemplatePicker.jsx'
import BuildingPicker from './components/BuildingPicker.jsx'
import PortfolioBar from './components/PortfolioBar.jsx'
import SaveState from './components/SaveState.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import { Chip } from './components/controls.jsx'

// All components at module scope (see components/UnitBox.jsx for why).

export default function App() {
  const [loaded] = useState(() => load())
  const [state, setState] = useState(loaded.state)
  const [saveError, setSaveError] = useState(null)
  const [openUnitId, setOpenUnitId] = useState(null)
  const [panelTab, setPanelTab] = useState('payments') // which tab the panel opens on
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null) // 'raise' | 'backup' | 'template' | 'month' | null
  const [month, setMonth] = useState(() => monthKey()) // the month view's month, local
  const [printing, setPrinting] = useState(false)
  const [undo, setUndo] = useState(null) // { changes, label } from the last raise
  const [selected, setSelected] = useState(null) // building id | 'all' | null (= default)
  const [portfolioId, setPortfolioId] = useState(null) // active portfolio, UI state
  const [savedAt, setSavedAt] = useState(null) // timestamp of the last good write

  // Latest state for callbacks that need to read it outside a render
  // (photo upload does a trial save before committing).
  const stateRef = useRef(state)
  stateRef.current = state

  // The first write is the load itself: nothing to announce.
  const firstWrite = useRef(true)
  // Set by an explicit, confirmed removal. save() refuses to write an empty
  // sheet over a store that still holds units unless it is told the emptying
  // was deliberate; this is how it is told, for one write only.
  const emptyingOnPurpose = useRef(false)
  // The dialog to bring back when the unit panel closes: the month view
  // opens a unit's panel in its place and returns to the same month after.
  const returnTo = useRef(null)

  // Persist the whole state on every change. save() refuses unsafe writes
  // and reports failures (e.g. quota) instead of throwing. There is no save
  // button: this is the only way data is written.
  useEffect(() => {
    const r = save(state, { allowEmpty: emptyingOnPurpose.current })
    emptyingOnPurpose.current = false
    setSaveError(r.ok ? null : describeSaveError(r))
    if (firstWrite.current) {
      firstWrite.current = false
      return
    }
    setSavedAt(r.ok ? Date.now() : null)
  }, [state])

  // The "Saved" flash clears itself; a failure stays until a write succeeds.
  useEffect(() => {
    if (!savedAt) return undefined
    const t = setTimeout(() => setSavedAt(null), SAVED_FLASH_MS)
    return () => clearTimeout(t)
  }, [savedAt])

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
   * Payment records. These three are the only writers of unit.payments:
   * each is one explicit tap or edit on one month of one rental. Nothing
   * else in the app — not a rent change, a raise, a split, an import, a new
   * month — creates or changes a record.
   */
  const payments = useMemo(
    () => ({
      set: (unitId, m, half, patch) => guarded((s) => opsSetPayment(s, unitId, m, half, patch)),
      clear: (unitId, m, half) => guarded((s) => opsClearPayment(s, unitId, m, half)),
      cycle: (unitId, m, half) => guarded((s) => opsCyclePayment(s, unitId, m, half)),
    }),
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

  /** Create a building from a template, in the portfolio being shown. */
  const createProperty = useCallback(
    ({ templateId, name }) => {
      let property
      try {
        property = buildFromTemplate(templateId, name)
      } catch (err) {
        setNotice({ tone: 'alert', text: err?.message ?? String(err) })
        return
      }
      const into = resolvePortfolioId(stateRef.current, portfolioId)
      setState((s) => opsAddProperty(s, property, into))
      // keep a single-building view on the building just made
      const shown = propertiesOf(stateRef.current, into)
      setSelected((cur) => (resolveSelection(shown, cur) === ALL ? cur : property.id))
      setDialog(null)
      setNotice({ tone: 'line', text: `Added ${property.name}. Tap a unit to set its rent.` })
    },
    [portfolioId],
  )

  /**
   * Remove a building. `opts.force` comes from the caption's confirm, which
   * has already named exactly what the building holds; ops.js still decides
   * whether the write is allowed.
   */
  const removeProperty = useCallback(
    (propertyId, opts = {}) => {
      if (opts.force) emptyingOnPurpose.current = true
      guarded((s) => opsRemoveProperty(s, propertyId, opts))
      setSelected((cur) => (cur === propertyId ? null : cur))
    },
    [guarded],
  )

  /** Portfolios. The active one is UI state, like the building selection. */
  const addPortfolio = useCallback(() => {
    const portfolio = makePortfolio({ name: nextPortfolioName(stateRef.current.portfolios) })
    setState((s) => opsAddPortfolio(s, portfolio))
    setPortfolioId(portfolio.id)
    setSelected(null)
    setNotice({
      tone: 'line',
      text: `Added ${portfolio.name}. Tap its name to rename it; buildings you add now go in it.`,
    })
  }, [])

  const renamePortfolio = useCallback(
    (id, name) => guarded((s) => opsRenamePortfolio(s, id, name)),
    [guarded],
  )

  const removePortfolio = useCallback(
    (id) => {
      const d = describePortfolio(stateRef.current, id)
      emptyingOnPurpose.current = true
      guarded((s) => opsRemovePortfolio(s, id, { force: true }))
      setPortfolioId(null)
      setSelected(null)
      if (d.buildings > 0) {
        setNotice({ tone: 'alert', text: `Removed ${d.name || 'the portfolio'} · ${d.text}` })
      }
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

  /** A box tap: the panel on its usual first tab. */
  const openUnitPanel = useCallback((unitId) => {
    setPanelTab('payments')
    setOpenUnitId(unitId)
  }, [])

  /** A row tap in the month view: the panel on Payments, and back to the month after. */
  const openUnitFromMonth = useCallback((unitId) => {
    returnTo.current = 'month'
    setDialog(null)
    setPanelTab('payments')
    setOpenUnitId(unitId)
  }, [])

  const closePanel = useCallback(() => {
    setOpenUnitId(null)
    if (returnTo.current) {
      setDialog(returnTo.current)
      returnTo.current = null
    }
  }, [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const stopPrinting = useCallback(() => setPrinting(false), [])
  const openTemplatePicker = useCallback(() => setDialog('template'), [])

  const openUnit = openUnitId ? findUnit(state, openUnitId) : null
  // Everything on screen is scoped to the active portfolio; a backup is not.
  const activeId = resolvePortfolioId(state, portfolioId)
  const portfolio = activePortfolio(state, portfolioId)
  const portfolioName = portfolio?.name || 'Portfolio'
  const inPortfolio = propertiesOf(state, activeId)
  const totals = computeTotals(inPortfolio)
  const selection = resolveSelection(inPortfolio, selected)
  const displayed = displayedProperties(inPortfolio, selection)
  const showing = selection === ALL ? null : displayed[0]?.name || 'Building'

  if (printing) {
    return (
      <PrintView
        state={portfolioState(state, activeId)}
        portfolioName={portfolioName}
        onBack={stopPrinting}
      />
    )
  }

  return (
    <div className="bg-blueprint-grid flex min-h-dvh flex-col">
      <SheetHeader
        warnings={loaded.warnings}
        collected={totals.collected}
        portfolioName={portfolioName}
        savedAt={savedAt}
        saveError={saveError}
      />
      <UpdatePrompt />
      <PortfolioBar
        portfolios={portfolioSummaries(state)}
        activeId={activeId}
        removal={describePortfolio(state, activeId)}
        onSelect={(id) => {
          setPortfolioId(id)
          setSelected(null)
        }}
        onAdd={addPortfolio}
        onRename={renamePortfolio}
        onRemove={removePortfolio}
      />
      <Tools
        onRaise={() => setDialog('raise')}
        onUndo={undo ? undoRaise : null}
        undoLabel={undo?.label}
        onPayments={() => setDialog('month')}
        onPrint={() => setPrinting(true)}
        onBackup={() => setDialog('backup')}
      />
      <BuildingPicker properties={inPortfolio} selection={selection} onSelect={setSelected} />
      {notice && (
        <Notice notice={notice} onDismiss={() => setNotice(null)} onUndo={notice.undo && undo ? undoRaise : null} />
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-8">
        <Elevation
          properties={displayed}
          onUnitChange={updateUnit}
          onPropertyChange={updateProperty}
          onOpenUnit={openUnitPanel}
          onAddProperty={openTemplatePicker}
          onRemoveProperty={removeProperty}
          onSetPhoto={setPhoto}
          onNotice={setNotice}
          structure={structure}
          rentScale={totals.maxRent}
        />
      </div>

      <TitleBlock totals={totals} saveError={saveError} showing={showing} portfolioName={portfolioName} />

      {openUnit && (
        <UnitPanel
          key={openUnit.id}
          unit={openUnit}
          initialTab={panelTab}
          context={{ sideAnnex: sideAnnexCheck(state, openUnit.id) }}
          onChange={(patch) => updateUnit(openUnit.id, patch)}
          onPayment={(m, half, patch) => payments.set(openUnit.id, m, half, patch)}
          onUntrack={(m, half) => payments.clear(openUnit.id, m, half)}
          onClose={closePanel}
        />
      )}

      {dialog === 'month' && (
        <MonthView
          properties={inPortfolio}
          portfolioName={portfolioName}
          month={month}
          onMonth={setMonth}
          onCycle={payments.cycle}
          onOpenUnit={openUnitFromMonth}
          onClose={closeDialog}
        />
      )}
      {dialog === 'template' && <TemplatePicker onCreate={createProperty} onClose={closeDialog} />}
      {dialog === 'raise' && (
        <RaiseRentsSheet properties={inPortfolio} onApply={applyRaise} onClose={closeDialog} />
      )}
      {dialog === 'backup' && (
        <BackupSheet state={state} onImport={applyImport} onNotice={setNotice} onClose={closeDialog} />
      )}
    </div>
  )
}

function SheetHeader({ warnings, collected, portfolioName, savedAt, saveError }) {
  return (
    <header className="border-b border-line/40 pt-[env(safe-area-inset-top)]">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 sm:px-8">
        <h1 className="font-display shrink-0 text-base tracking-[0.3em] text-ink uppercase">Rent Roll</h1>
        <SaveState savedAt={savedAt} error={saveError} />
        {/* live readout for the portfolio on screen; stays above a phone keyboard */}
        <div className="ml-auto truncate text-[10px] tracking-[0.2em] text-line/70 uppercase">
          <span className="hidden sm:inline">{portfolioName} </span>
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

/** Sheet-level tools. 40px tall chips so they are easy to hit on a phone. */
function Tools({ onRaise, onUndo, undoLabel, onPayments, onPrint, onBackup }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/40 px-4 py-2 sm:px-8">
      {/* short labels on a phone so the chips stay on one line at 380px */}
      <Chip onClick={onPayments} title="Who has paid this month, across the portfolio">
        $ <span className="sm:hidden">Paid</span>
        <span className="hidden sm:inline">Payments</span>
      </Chip>
      <Chip onClick={onRaise} title="Model a rent increase across leased units">
        ↑ <span className="sm:hidden">Rents</span>
        <span className="hidden sm:inline">Raise rents</span>
      </Chip>
      {onUndo && (
        <Chip tone="alert" onClick={onUndo} title="Put the rents back">
          Undo {undoLabel}
        </Chip>
      )}
      <Chip onClick={onPrint} title="Clean table view to print or save as PDF">
        ⎙ <span className="sm:hidden">PDF</span>
        <span className="hidden sm:inline">Print / PDF</span>
      </Chip>
      <Chip onClick={onBackup} title="Export or import the JSON data">
        ⇅ <span className="hidden sm:inline">Backup</span>
        <span className="sm:hidden">Backup</span>
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
            className="min-h-11 border border-current px-2 text-[9px] tracking-[0.2em] uppercase sm:min-h-8"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2 -mr-2 flex h-11 w-11 items-center justify-center opacity-70 hover:opacity-100"
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

/** How long the "Saved" flash stays up. */
const SAVED_FLASH_MS = 2000

/** "Portfolio 2", "Portfolio 3", … — renamed in place from the bar. */
function nextPortfolioName(portfolios) {
  const n = (portfolios?.length ?? 0) + 1
  const taken = new Set((portfolios ?? []).map((f) => f.name))
  let name = `Portfolio ${n}`
  for (let i = n; taken.has(name); i++) name = `Portfolio ${i + 1}`
  return name
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
