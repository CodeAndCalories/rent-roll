import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { load, loadForkBases, save, saveForkBasis } from './data/store.js'
import { formatDollars, makeBill, makePortfolio } from './data/schema.js'
import {
  ACTUAL,
  RuleError,
  addFloor as opsAddFloor,
  addPortfolio as opsAddPortfolio,
  addProperty as opsAddProperty,
  addPropertyBill as opsAddPropertyBill,
  addScenario as opsAddScenario,
  applyTo,
  describePortfolio,
  describeScenario,
  addSideAnnex as opsAddSideAnnex,
  addUnit as opsAddUnit,
  clearPayment as opsClearPayment,
  cyclePayment as opsCyclePayment,
  patchProperty,
  patchPropertyBill as opsPatchPropertyBill,
  patchScenario as opsPatchScenario,
  patchUnit,
  refreshScenario as opsRefreshScenario,
  removeFloor as opsRemoveFloor,
  removePortfolio as opsRemovePortfolio,
  removeProperty as opsRemoveProperty,
  removePropertyBill as opsRemovePropertyBill,
  removeScenario as opsRemoveScenario,
  removeUnit as opsRemoveUnit,
  renameFloor as opsRenameFloor,
  renamePortfolio as opsRenamePortfolio,
  scenarioTarget,
  setBillLoan as opsSetBillLoan,
  setFloorUnitCount as opsSetFloorUnitCount,
  setPayment as opsSetPayment,
  setUnitWidths as opsSetUnitWidths,
  sideAnnexCheck,
} from './data/ops.js'
import { buildFromTemplate } from './data/templates.js'
import { computeTotals } from './data/totals.js'
import {
  actualSignature,
  compareTable,
  countScenario,
  forkScenario,
  isStale,
  planSideBySide,
  scenarioById,
  scenarioView,
  scenariosOf,
  splitDeltas,
} from './data/scenarios.js'
import { leaseSummary } from './lib/leases.js'
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
import LeaseView from './components/LeaseView.jsx'
import BuildingBills from './components/BuildingBills.jsx'
import ExpensesView from './components/ExpensesView.jsx'
import ScenarioBanner from './components/ScenarioBanner.jsx'
import ScenariosSheet from './components/ScenariosSheet.jsx'
import CompareView from './components/CompareView.jsx'
import SplitView, { DeltaBar, SideBySidePicker, SplitBar } from './components/SplitView.jsx'
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
  const [dialog, setDialog] = useState(null) // 'raise' | 'backup' | 'template' | 'month' | 'leases' | 'bills' | 'expenses' | null
  const [billsId, setBillsId] = useState(null) // the building whose bills sheet is open
  const [billsFocus, setBillsFocus] = useState(null) // the bill tapped in the expenses summary
  const [month, setMonth] = useState(() => monthKey()) // the month view's month, local
  const [printing, setPrinting] = useState(false)
  const [undo, setUndo] = useState(null) // { changes, label } from the last raise
  const [selected, setSelected] = useState(null) // building id | 'all' | null (= default)
  const [portfolioId, setPortfolioId] = useState(null) // active portfolio, UI state
  // Scenario mode: the scenario the sheet edits, or null for real data. UI
  // state only — a reload always comes back to real data.
  const [scenarioId, setScenarioId] = useState(null)
  // Side by side: actual (read only) beside the open scenario. UI state on
  // top of scenario mode — every write still aims at the scenario.
  const [split, setSplit] = useState(false)
  const [actualCollapsed, setActualCollapsed] = useState(false) // the actual pane shows totals only
  // What actual looked like at each fork, for "actual changed since" — a
  // cache beside the data (store.js FORK_BASIS_KEY), never part of it.
  const [bases, setBases] = useState(() => loadForkBases())
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
  // The dialog to bring back when the unit panel (or a building's bills)
  // closes: the month, lease, and expenses views open an editor in their
  // place and come back after.
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

  // Every write names its target: real data (ACTUAL) or the scenario the
  // sheet is in. ops.applyTo does the aiming — a scenario write is handed a
  // view of that scenario and only its buildings come back into it — so
  // nothing a component does while a scenario is open can reach real data.
  // The target follows scenarioId (set in render below), never a lookup: a
  // stale id is refused by applyTo rather than falling back to actual.
  // A RuleError from ops is shown as a notice and the state is kept.
  const targetRef = useRef(ACTUAL)
  const writeTo = useCallback((target, fn) => {
    setState((s) => {
      try {
        return applyTo(s, target, fn)
      } catch (err) {
        if (err instanceof RuleError) {
          queueMicrotask(() => setNotice({ tone: 'alert', text: err.message }))
          return s
        }
        throw err
      }
    })
  }, [])
  /** A write on what the sheet shows: the open scenario, else real data. */
  const write = useCallback((fn) => writeTo(targetRef.current, fn), [writeTo])
  /** A write about real data whatever the sheet shows: portfolios, and the scenarios themselves. */
  const writeActual = useCallback((fn) => writeTo(ACTUAL, fn), [writeTo])

  const updateUnit = useCallback((unitId, patch) => write((s) => patchUnit(s, unitId, patch)), [write])

  const updateProperty = useCallback(
    (propertyId, patch) => write((s) => patchProperty(s, propertyId, patch)),
    [write],
  )

  /**
   * Payment records. These three are the only writers of unit.payments:
   * each is one explicit tap or edit on one month of one rental. Nothing
   * else in the app — not a rent change, a raise, a split, an import, a new
   * month — creates or changes a record.
   */
  const payments = useMemo(
    () => ({
      set: (unitId, m, half, patch) => write((s) => opsSetPayment(s, unitId, m, half, patch)),
      clear: (unitId, m, half) => write((s) => opsClearPayment(s, unitId, m, half)),
      cycle: (unitId, m, half) => write((s) => opsCyclePayment(s, unitId, m, half)),
    }),
    [write],
  )

  /**
   * The Build handles on the drawing. Every one of these is an ops call, so a
   * write that breaks a rule (a second annex, a unit that still holds
   * something) is refused there and shown as a notice.
   */
  const structure = useMemo(
    () => ({
      addFloor: (propertyId) => write((s) => opsAddFloor(s, propertyId)),
      addUnit: (propertyId, floorId) => write((s) => opsAddUnit(s, propertyId, floorId)),
      addAnnex: (propertyId, side) => write((s) => opsAddSideAnnex(s, propertyId, side)),
      removeFloor: (propertyId, floorId) => write((s) => opsRemoveFloor(s, propertyId, floorId)),
      renameFloor: (propertyId, floorId, label) =>
        write((s) => opsRenameFloor(s, propertyId, floorId, label)),
      setWidths: (propertyId, floorId, weights) =>
        write((s) => opsSetUnitWidths(s, propertyId, floorId, weights)),
      // the stepper: a whole count in one write; refused (and named) when
      // it would remove a unit that holds anything
      setUnitCount: (propertyId, floorId, count) =>
        write((s) => opsSetFloorUnitCount(s, propertyId, floorId, count)),
      removeUnit: (unitId) =>
        write((s) => {
          const next = opsRemoveUnit(s, unitId) // throws when the unit holds anything
          queueMicrotask(() => setOpenUnitId((cur) => (cur === unitId ? null : cur)))
          return next
        }),
    }),
    [write],
  )

  /**
   * A building's own bills — the ones every template seeds, edited in place
   * — and the loan terms on one of them. ops.js holds the one-loan rule.
   */
  const bills = useMemo(
    () => ({
      patch: (propertyId, billId, patch) => write((s) => opsPatchPropertyBill(s, propertyId, billId, patch)),
      add: (propertyId) => {
        const bill = makeBill()
        write((s) => opsAddPropertyBill(s, propertyId, bill))
      },
      remove: (propertyId, billId) => write((s) => opsRemovePropertyBill(s, propertyId, billId)),
      loan: (propertyId, billId, terms) => write((s) => opsSetBillLoan(s, propertyId, billId, terms)),
    }),
    [write],
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
      write((s) => opsAddProperty(s, property, into))
      // keep a single-building view on the building just made
      const shown = scenarioId
        ? (scenarioById(stateRef.current, scenarioId)?.properties ?? [])
        : propertiesOf(stateRef.current, into)
      setSelected((cur) => (resolveSelection(shown, cur) === ALL ? cur : property.id))
      setDialog(null)
      setNotice({
        tone: 'line',
        text: scenarioId
          ? `Added ${property.name} to this scenario only. Tap a unit to set its rent.`
          : `Added ${property.name}. Tap a unit to set its rent.`,
      })
    },
    [portfolioId, scenarioId, write],
  )

  /**
   * Remove a building. `opts.force` comes from the caption's confirm, which
   * has already named exactly what the building holds; ops.js still decides
   * whether the write is allowed.
   */
  const removeProperty = useCallback(
    (propertyId, opts = {}) => {
      if (opts.force && targetRef.current.kind === 'actual') emptyingOnPurpose.current = true
      write((s) => opsRemoveProperty(s, propertyId, opts))
      setSelected((cur) => (cur === propertyId ? null : cur))
    },
    [write],
  )

  /** Portfolios. The active one is UI state, like the building selection. */
  const addPortfolio = useCallback(() => {
    const portfolio = makePortfolio({ name: nextPortfolioName(stateRef.current.portfolios) })
    writeActual((s) => opsAddPortfolio(s, portfolio))
    setPortfolioId(portfolio.id)
    setScenarioId(null)
    setSelected(null)
    setNotice({
      tone: 'line',
      text: `Added ${portfolio.name}. Tap its name to rename it; buildings you add now go in it.`,
    })
  }, [writeActual])

  const renamePortfolio = useCallback(
    (id, name) => writeActual((s) => opsRenamePortfolio(s, id, name)),
    [writeActual],
  )

  const removePortfolio = useCallback(
    (id) => {
      const d = describePortfolio(stateRef.current, id)
      emptyingOnPurpose.current = true
      writeActual((s) => opsRemovePortfolio(s, id, { force: true }))
      setPortfolioId(null)
      setScenarioId(null)
      setSelected(null)
      if (d.buildings > 0 || d.scenarios > 0) {
        setNotice({ tone: 'alert', text: `Removed ${d.name || 'the portfolio'} · ${d.text}` })
      }
    },
    [writeActual],
  )

  /**
   * Scenarios. A fork copies the active portfolio's buildings as they are
   * right now (forkScenario), then a trial save checks the browser has
   * room for it: a scenario is written whole or not at all. Managing
   * scenarios is a write about real data, so it goes through writeActual
   * whatever the sheet shows.
   */
  const createScenario = useCallback(
    (name, { split: intoSplit = false, auto = false } = {}) => {
      const s = stateRef.current
      const into = resolvePortfolioId(s, portfolioId)
      const scenario = forkScenario(s, into, { name })
      if (!scenario) return
      let next
      try {
        next = opsAddScenario(s, scenario)
      } catch (err) {
        if (err instanceof RuleError) {
          setNotice({ tone: 'alert', text: err.message })
          return
        }
        throw err
      }
      const trial = save(next)
      if (!trial.ok) {
        setNotice({ tone: 'alert', text: describeForkFailure(trial) })
        return
      }
      writeActual((cur) => opsAddScenario(cur, scenario))
      setBases(saveForkBasis(scenario.id, actualSignature(s, into), (next.scenarios ?? []).map((x) => x.id)))
      setScenarioId(scenario.id)
      if (intoSplit) setSplit(true) // a fork made while side by side stays side by side
      setSelected(null)
      setOpenUnitId(null)
      setUndo(null)
      setDialog(null)
      const c = countScenario(scenario)
      const from = activePortfolio(s, into)?.name || 'this portfolio'
      setNotice({
        tone: 'line',
        text: auto
          ? `No scenario yet, so "${scenario.name}" was forked from ${from} to compare: edit it on the scenario side; actual stays read only.`
          : `Forked "${scenario.name}" from ${from}: ` +
            `${c.buildings} ${c.buildings === 1 ? 'building' : 'buildings'}, ${c.units} ${c.units === 1 ? 'unit' : 'units'}, as of today. ` +
            'Nothing you change in it touches your real data.',
      })
    },
    [portfolioId, writeActual],
  )

  /**
   * The "Side by side" control. No scenario yet: fork one ("What-if
   * <date>") and open it beside actual, no questions. Otherwise ask which
   * goes on the scenario side, "+ new fork" first.
   */
  const openSideBySide = useCallback(() => {
    const s = stateRef.current
    const plan = planSideBySide(s, resolvePortfolioId(s, portfolioId), new Date())
    if (plan.action === 'fork') createScenario(plan.name, { split: true, auto: true })
    else setDialog('sidebyside')
  }, [portfolioId, createScenario])

  const newForkSideBySide = useCallback(() => {
    const s = stateRef.current
    const plan = planSideBySide(s, resolvePortfolioId(s, portfolioId), new Date())
    const name = plan.action === 'fork' ? plan.name : plan.newFork.ok ? plan.newFork.name : null
    if (name) createScenario(name, { split: true })
  }, [portfolioId, createScenario])

  const pickSideBySide = useCallback((id) => {
    setScenarioId(id)
    setSplit(true)
    setSelected(null)
    setOpenUnitId(null)
    setUndo(null)
    setDialog(null)
  }, [])

  /**
   * "Refresh from actual" (two taps on the scenario side): the scenario is
   * forked again from real data as it is now, keeping its id and name. A
   * trial save first, as for a fork: it is replaced whole or not at all.
   */
  const refreshFromActual = useCallback(
    (id) => {
      const s = stateRef.current
      const at = new Date().toISOString()
      let next
      try {
        next = opsRefreshScenario(s, id, { at })
      } catch (err) {
        if (err instanceof RuleError) {
          setNotice({ tone: 'alert', text: err.message })
          return
        }
        throw err
      }
      const trial = save(next)
      if (!trial.ok) {
        setNotice({ tone: 'alert', text: describeForkFailure(trial, 'the refreshed scenario') })
        return
      }
      writeActual((cur) => opsRefreshScenario(cur, id, { at }))
      const refreshed = scenarioById(next, id)
      setBases(saveForkBasis(id, actualSignature(s, refreshed.portfolioId), (next.scenarios ?? []).map((x) => x.id)))
      setOpenUnitId(null)
      setUndo(null)
      const c = countScenario(refreshed)
      setNotice({
        tone: 'line',
        text:
          `Refreshed "${refreshed.name || 'scenario'}" from your real data as it is today: ` +
          `${c.buildings} ${c.buildings === 1 ? 'building' : 'buildings'}, ${c.units} ${c.units === 1 ? 'unit' : 'units'}. ` +
          'The edits that were in it are gone.',
      })
    },
    [writeActual],
  )

  const enterScenario = useCallback((id) => {
    setScenarioId(id)
    setSelected(null)
    setOpenUnitId(null)
    setUndo(null)
    setDialog(null)
  }, [])

  const exitScenario = useCallback(() => {
    setScenarioId(null)
    setSelected(null)
    setOpenUnitId(null)
    setUndo(null)
  }, [])

  /** Leaving side by side goes back to real data. */
  const exitSplit = useCallback(() => {
    setSplit(false)
    exitScenario()
  }, [exitScenario])

  // Side by side only exists on top of an open scenario: whatever closes
  // the scenario (exit, a portfolio switch, a delete) closes it too.
  useEffect(() => {
    if (!scenarioId) setSplit(false)
  }, [scenarioId])

  const renameScenario = useCallback(
    (id, name) => writeActual((s) => opsPatchScenario(s, id, { name })),
    [writeActual],
  )

  const deleteScenario = useCallback(
    (id) => {
      const d = describeScenario(stateRef.current, id)
      writeActual((s) => opsRemoveScenario(s, id))
      if (scenarioId === id) exitScenario()
      setNotice({ tone: 'line', text: `Deleted scenario "${d.name}". Your real data was not touched.` })
    },
    [scenarioId, exitScenario, writeActual],
  )

  /**
   * Store a resized photo. A trial save runs first so a quota failure is
   * reported immediately and the app never holds a photo it cannot persist.
   */
  const setPhoto = useCallback((propertyId, { dataUrl, w, h, bytes }) => {
    if (targetRef.current.kind !== 'actual') {
      setNotice({ tone: 'alert', text: 'Photos are not part of a scenario. Exit the scenario to add one.' })
      return
    }
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

  /**
   * Apply a planned raise to what the sheet shows and remember how to undo
   * it. The undo record carries its target, and is dropped on a mode
   * switch, so it can never put a scenario's old rents onto real units.
   */
  const applyRaise = useCallback(
    ({ changes, mode, amount }) => {
      const target = targetRef.current
      const label = describeRaise(mode, amount)
      const delta = changes.reduce(
        (n, c) => n + (c.after.rent + c.after.splitRent - c.before.rent - c.before.splitRent),
        0,
      )
      writeTo(target, (s) => applyChanges(s, changes, 'after'))
      setUndo({ changes, label, target })
      setDialog(null)
      setNotice({
        tone: 'amber',
        undo: true,
        text:
          `Raised ${changes.length} leased ${changes.length === 1 ? 'rent' : 'rents'} ${label}: ` +
          `${delta >= 0 ? '+' : '−'}${formatDollars(Math.abs(delta))} / mo` +
          (target.kind === 'scenario' ? ' in this scenario only.' : '.'),
      })
    },
    [writeTo],
  )

  const undoRaise = () => {
    if (!undo) return
    writeTo(undo.target, (s) => applyChanges(s, undo.changes, 'before'))
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

  /** A row tap in a portfolio view (month, leases): the panel, and back to that view after. */
  const openUnitFromView = useCallback((unitId, view) => {
    returnTo.current = view
    setDialog(null)
    setPanelTab('payments')
    setOpenUnitId(unitId)
  }, [])
  const openUnitFromMonth = useCallback((unitId) => openUnitFromView(unitId, 'month'), [openUnitFromView])
  const openUnitFromLeases = useCallback((unitId) => openUnitFromView(unitId, 'leases'), [openUnitFromView])
  const openLeases = useCallback(() => setDialog('leases'), [])

  /** A building's bills, from its caption. */
  const openBills = useCallback((propertyId) => {
    setBillsId(propertyId)
    setBillsFocus(null)
    setDialog('bills')
  }, [])
  /** The expenses summary, from the title block; its lines open their editors and come back. */
  const openExpenses = useCallback(() => setDialog('expenses'), [])
  const openBillsFromExpenses = useCallback((propertyId, billId = null) => {
    returnTo.current = 'expenses'
    setBillsId(propertyId)
    setBillsFocus(billId)
    setDialog('bills')
  }, [])
  const openUnitBillsFromExpenses = useCallback((unitId) => {
    returnTo.current = 'expenses'
    setDialog(null)
    setPanelTab('bills')
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
  /** The bills sheet goes back to the expenses summary when it came from there. */
  const closeBills = useCallback(() => {
    setDialog(returnTo.current)
    returnTo.current = null
  }, [])

  // A scenario that went away under an open sheet (deleted from the
  // Scenarios sheet, replaced by an import) drops the sheet back to real
  // data. Until then its writes are refused, never redirected.
  useEffect(() => {
    if (scenarioId && !scenarioById(state, scenarioId)) {
      setScenarioId(null)
      setSelected(null)
      setOpenUnitId(null)
      setUndo(null)
      setNotice({ tone: 'alert', text: 'That scenario is gone. Back to your real data.' })
    }
  }, [scenarioId, state])
  const stopPrinting = useCallback(() => setPrinting(false), [])
  const openTemplatePicker = useCallback(() => setDialog('template'), [])

  // Everything on screen is scoped to the active portfolio; a backup is not.
  const activeId = resolvePortfolioId(state, portfolioId)
  const portfolio = activePortfolio(state, portfolioId)
  const portfolioName = portfolio?.name || 'Portfolio'
  const actualProperties = propertiesOf(state, activeId)
  const scenarios = scenariosOf(state, activeId)

  // Scenario mode: the sheet, the panel, the totals, the raise sheet, and
  // the print view all show the scenario's copy, and every write aims at
  // it. The target follows the id, never the lookup: if the scenario is
  // gone (deleted, or an import replaced it) writes are refused and the
  // effect below drops back to real data. Payments and leases are facts,
  // so they are hidden while a scenario is open.
  const scenario = scenarioId ? scenarioById(state, scenarioId) : null
  targetRef.current = scenarioId ? scenarioTarget(scenarioId) : ACTUAL
  const viewState = scenario ? scenarioView(state, scenario) : state
  const inPortfolio = scenario ? scenario.properties : actualProperties
  const sheetName = scenario ? `Scenario · ${scenario.name || 'unnamed'}` : portfolioName
  const openUnit = openUnitId ? findUnit(viewState, openUnitId) : null
  const billsProperty = dialog === 'bills' ? (viewState.properties.find((p) => p.id === billsId) ?? null) : null
  const totals = computeTotals(inPortfolio)
  const leases = scenario ? null : leaseSummary(actualProperties) // the header chip's count; hidden at zero
  const selection = resolveSelection(inPortfolio, selected)
  const displayed = displayedProperties(inPortfolio, selection)
  const showing = selection === ALL ? null : displayed[0]?.name || 'Building'
  const splitOn = split && Boolean(scenario)
  const stale = scenario ? isStale(state, scenario, bases[scenario.id]) : null
  const sideBySidePlan = dialog === 'sidebyside' ? planSideBySide(state, activeId) : null

  // The editor's handlers: the sheet, and the scenario side of side by side.
  // Every one of them writes through `write`, which aims at the open scenario.
  const editor = {
    onUnitChange: updateUnit,
    onPropertyChange: updateProperty,
    onOpenUnit: openUnitPanel,
    onAddProperty: openTemplatePicker,
    onRemoveProperty: removeProperty,
    onSetPhoto: setPhoto,
    onNotice: setNotice,
    onOpenBills: openBills,
    structure,
  }

  if (printing) {
    return (
      <PrintView
        state={scenario ? viewState : portfolioState(state, activeId)}
        portfolioName={sheetName}
        onBack={stopPrinting}
      />
    )
  }

  return (
    <div
      className="bg-blueprint-grid flex min-h-dvh flex-col"
      style={scenario ? SCENARIO_ACCENT : undefined}
      data-mode={scenario ? 'scenario' : 'actual'}
    >
      <SheetHeader
        warnings={loaded.warnings}
        collected={totals.collected}
        portfolioName={sheetName}
        savedAt={savedAt}
        saveError={saveError}
        leasesWithin90={leases ? leases.within90 : 0}
        onLeases={openLeases}
      />
      <UpdatePrompt />
      {splitOn && (
        <SplitBar
          collapsed={actualCollapsed}
          onToggleCollapsed={() => setActualCollapsed((c) => !c)}
          onSwitch={openSideBySide}
          onExit={exitSplit}
        />
      )}
      {scenario && !splitOn && (
        <ScenarioBanner
          scenario={scenario}
          portfolioName={portfolioName}
          onRename={(name) => renameScenario(scenario.id, name)}
          onExit={exitScenario}
          onCompare={() => setDialog('compare')}
          onManage={() => setDialog('scenarios')}
        />
      )}
      {!splitOn && (
        <PortfolioBar
          portfolios={portfolioSummaries(state)}
          activeId={activeId}
          removal={describePortfolio(state, activeId)}
          onSelect={(id) => {
            setPortfolioId(id)
            setScenarioId(null)
            setSelected(null)
          }}
          onAdd={addPortfolio}
          onRename={renamePortfolio}
          onRemove={removePortfolio}
        />
      )}
      <Tools
        onRaise={() => setDialog('raise')}
        onUndo={undo ? undoRaise : null}
        undoLabel={undo?.label}
        onPayments={() => setDialog('month')}
        onLeases={openLeases}
        onScenarios={() => setDialog('scenarios')}
        onCompare={scenarios.length > 0 ? () => setDialog('compare') : null}
        onSideBySide={openSideBySide}
        sideBySide={splitOn}
        scenario={Boolean(scenario)}
        onPrint={() => setPrinting(true)}
        onBackup={() => setDialog('backup')}
      />
      {!splitOn && <BuildingPicker properties={inPortfolio} selection={selection} onSelect={setSelected} />}
      {notice && (
        <Notice notice={notice} onDismiss={() => setNotice(null)} onUndo={notice.undo && undo ? undoRaise : null} />
      )}

      {splitOn ? (
        <SplitView
          actual={actualProperties}
          portfolioName={portfolioName}
          scenario={scenario}
          stale={stale}
          collapsed={actualCollapsed}
          onRename={(name) => renameScenario(scenario.id, name)}
          onRefresh={() => refreshFromActual(scenario.id)}
          onExpenses={openExpenses}
          editor={editor}
          rentScale={Math.max(computeTotals(actualProperties).maxRent, totals.maxRent)}
        />
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-8">
          <Elevation {...editor} properties={displayed} rentScale={totals.maxRent} photos={!scenario} />
        </div>
      )}

      {splitOn ? (
        <DeltaBar rows={splitDeltas(actualProperties, scenario.properties)} />
      ) : (
        <TitleBlock
          totals={totals}
          saveError={saveError}
          showing={showing}
          portfolioName={sheetName}
          onExpenses={openExpenses}
        />
      )}

      {openUnit && (
        <UnitPanel
          key={openUnit.id}
          unit={openUnit}
          initialTab={scenario ? 'bills' : panelTab}
          scenario={Boolean(scenario)}
          context={{ sideAnnex: sideAnnexCheck(viewState, openUnit.id) }}
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
      {dialog === 'scenarios' && (
        <ScenariosSheet
          scenarios={scenarios}
          portfolioName={portfolioName}
          currentId={scenarioId}
          describe={(id) => describeScenario(state, id)}
          onCreate={createScenario}
          onOpen={enterScenario}
          onRename={renameScenario}
          onDelete={deleteScenario}
          onCompare={() => setDialog('compare')}
          onClose={closeDialog}
        />
      )}
      {sideBySidePlan?.action === 'pick' && (
        <SideBySidePicker
          plan={sideBySidePlan}
          portfolioName={portfolioName}
          currentId={scenarioId}
          staleOf={(s) => isStale(state, s, bases[s.id])}
          onNewFork={newForkSideBySide}
          onPick={pickSideBySide}
          onClose={closeDialog}
        />
      )}
      {dialog === 'compare' && (
        <CompareView
          table={compareTable(actualProperties, scenarios)}
          portfolioName={portfolioName}
          onOpenScenarios={() => setDialog('scenarios')}
          onClose={closeDialog}
        />
      )}
      {dialog === 'leases' && (
        <LeaseView
          properties={inPortfolio}
          portfolioName={portfolioName}
          onOpenUnit={openUnitFromLeases}
          onClose={closeDialog}
        />
      )}
      {billsProperty && (
        <BuildingBills
          key={billsProperty.id}
          property={billsProperty}
          onBill={(billId, patch) => bills.patch(billsProperty.id, billId, patch)}
          onAdd={() => bills.add(billsProperty.id)}
          onRemove={(billId) => bills.remove(billsProperty.id, billId)}
          onLoan={(billId, terms) => bills.loan(billsProperty.id, billId, terms)}
          onClose={closeBills}
          focusBillId={billsFocus}
        />
      )}
      {dialog === 'expenses' && (
        <ExpensesView
          properties={inPortfolio}
          portfolioName={sheetName}
          onOpenBuilding={openBillsFromExpenses}
          onOpenUnit={openUnitBillsFromExpenses}
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

/**
 * The header. `leasesWithin90` puts an amber chip beside the title — the
 * count of leases ending today through 90 days out — that opens the Leases
 * view; at zero there is no chip at all.
 */
function SheetHeader({ warnings, collected, portfolioName, savedAt, saveError, leasesWithin90 = 0, onLeases }) {
  return (
    <header className="border-b border-line/40 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-8 sm:py-3">
        <h1 className="font-display shrink-0 text-base tracking-[0.3em] text-ink uppercase">Rent Roll</h1>
        <SaveState savedAt={savedAt} error={saveError} />
        {leasesWithin90 > 0 && (
          <Chip
            tone="amber"
            onClick={onLeases}
            title={`${leasesWithin90} ${leasesWithin90 === 1 ? 'lease ends' : 'leases end'} within 90 days · open the Leases view`}
            className="shrink-0"
          >
            ◷ {leasesWithin90}
            <span className="hidden sm:inline">{leasesWithin90 === 1 ? 'lease' : 'leases'} within 90d</span>
            <span className="sm:hidden">≤ 90d</span>
          </Chip>
        )}
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
function Tools({
  onRaise,
  onUndo,
  undoLabel,
  onPayments,
  onLeases,
  onScenarios,
  onCompare,
  onSideBySide,
  sideBySide = false,
  scenario = false,
  onPrint,
  onBackup,
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/40 px-4 py-2 sm:px-8">
      {/* short labels on a phone so the chips stay on one line at 380px.
          Payments and leases are facts, so they are hidden in a scenario. */}
      {!scenario && (
        <Chip onClick={onPayments} title="Who has paid this month, across the portfolio">
          $ <span className="sm:hidden">Paid</span>
          <span className="hidden sm:inline">Payments</span>
        </Chip>
      )}
      {!scenario && (
        <Chip onClick={onLeases} title="Every lease end date in the portfolio, soonest first">
          ◷ Leases
        </Chip>
      )}
      <Chip onClick={onScenarios} title="Alternate versions of this portfolio to build and compare">
        ◈ <span className="sm:hidden">What-if</span>
        <span className="hidden sm:inline">Scenarios</span>
      </Chip>
      {onCompare && (
        <Chip onClick={onCompare} title="Actual beside every scenario">
          ⇔ Compare
        </Chip>
      )}
      <Chip
        active={sideBySide}
        onClick={onSideBySide}
        title="Your real buildings beside an editable scenario, drawings and all"
      >
        ⧉ <span className="sm:hidden">Vs</span>
        <span className="hidden sm:inline">Side by side</span>
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

/**
 * Scenario mode's accent: the line work and text go violet by overriding
 * the theme variables on the app's root, so the grid, every border, and
 * every sheet read as "not reality" at a glance. Amber and alert stay.
 */
const SCENARIO_ACCENT = { '--color-line': '#b79cf2', '--color-ink': '#e7ddff' }

function describeForkFailure(result, what = 'another scenario') {
  if (isQuotaError(result.error)) {
    return (
      `Not enough storage for ${what}: the whole data set would be ${kb(result.bytes)} KB ` +
      'and the limit is usually about 5,000 KB. Delete a scenario or shrink a photo first. Nothing was written.'
    )
  }
  return `Scenario not saved: ${result.error?.message ?? 'unknown error'}. Nothing was written.`
}

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
