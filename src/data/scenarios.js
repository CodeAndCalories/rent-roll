// Rent Roll — scenarios: alternate versions of a portfolio to build, keep,
// and compare against reality. Pure functions, no DOM; the writes that
// involve a scenario are in ops.js (applyTo, addScenario, patchScenario,
// removeScenario).
//
// A scenario is a COPY, not an overlay. Forking copies the active
// portfolio's buildings whole — structure, floors, units, rents, statuses,
// widths, splits, building bills, unit bills — with fresh ids at every
// level, so no id in a scenario can ever name something in actual data.
// Nothing factual comes along (stripForScenario): no photos, no payment
// records, no tenants, no lease dates, no list items, no notes. From the
// fork on, the two are independent.

import { makeScenario, newId, stripForScenario, toAmount, toWeight } from './schema.js'
import { computeTotals } from './totals.js'
import { dayLabel } from '../lib/months.js'

/** How many scenarios one portfolio may hold, and why. */
export const SCENARIO_CAP = 6
export const SCENARIO_CAP_REASON =
  `${SCENARIO_CAP} per portfolio: a scenario is a whole copy of every building in it, ` +
  "and they all live in the browser's storage, which is small."

/** The scenarios of one portfolio, in stored order. */
export function scenariosOf(state, portfolioId) {
  return (state?.scenarios ?? []).filter((s) => s.portfolioId === portfolioId)
}

export function scenarioById(state, id) {
  return (state?.scenarios ?? []).find((s) => s.id === id) ?? null
}

/** A copy of one building for a scenario: fresh ids everywhere, nothing factual. */
export function cloneForScenario(property) {
  const p = stripForScenario(property)
  const reBill = (b) => ({ ...b, id: newId('bill') })
  return {
    ...p,
    id: newId('property'),
    bills: (p.bills ?? []).map(reBill),
    floors: p.floors.map((f) => ({
      ...f,
      id: newId('floor'),
      units: f.units.map((u) => ({ ...u, id: newId('unit'), bills: (u.bills ?? []).map(reBill) })),
    })),
  }
}

/**
 * The scenario to add: the portfolio's buildings as they are right now,
 * copied. Returns null for an unknown portfolio. The caller adds it with
 * ops.addScenario, which enforces the cap.
 */
export function forkScenario(state, portfolioId, { name = '', note = '' } = {}) {
  const buildings = actualBuildings(state, portfolioId)
  if (!buildings) return null
  return makeScenario({ portfolioId, name, note, properties: buildings.map(cloneForScenario) })
}

/** A portfolio's actual buildings in its order, or null for an unknown portfolio. */
export function actualBuildings(state, portfolioId) {
  const portfolio = (state?.portfolios ?? []).find((f) => f.id === portfolioId)
  if (!portfolio) return null
  const byId = new Map((state.properties ?? []).map((p) => [p.id, p]))
  return portfolio.propertyIds.map((id) => byId.get(id)).filter(Boolean)
}

/**
 * The state a scenario's writes see: the scenario's buildings where the
 * actual ones would be, one throwaway portfolio listing them, and no
 * scenarios at all. Every op in ops.js runs on this unchanged, and
 * applyTo takes back nothing but its `properties`.
 */
export function scenarioView(state, scenario) {
  return {
    ...state,
    properties: scenario.properties,
    portfolios: [
      { id: scenario.portfolioId, name: scenario.name, propertyIds: scenario.properties.map((p) => p.id) },
    ],
    scenarios: [],
  }
}

/** What a scenario holds, for its list row and its delete confirm. */
export function countScenario(scenario) {
  const properties = scenario?.properties ?? []
  return {
    buildings: properties.length,
    units: properties.reduce((n, p) => n + (p.floors ?? []).reduce((m, f) => m + (f.units?.length ?? 0), 0), 0),
  }
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

/** The rows of the compare table, in order. `better` says which way a difference is good. */
export const COMPARE_ROWS = [
  { id: 'units', label: 'Units', kind: 'count', better: null },
  { id: 'collected', label: 'Collected / mo', kind: 'money', better: 'higher' },
  { id: 'potential', label: 'If fully leased', kind: 'money', better: 'higher' },
  { id: 'bills', label: 'Expenses / mo', kind: 'money', better: 'lower' },
  { id: 'net', label: 'Net / mo', kind: 'money', better: 'higher' },
  { id: 'annualNet', label: 'Net / yr', kind: 'money', better: 'higher' },
]

/**
 * Actual in the first column, one column per scenario beside it. Every cell
 * is that source's own computeTotals figure; a scenario cell also carries
 * its difference from actual and a tone: 'amber' when the difference is
 * better, 'alert' when worse, null when equal or when better has no
 * meaning (a unit count).
 */
export function compareTable(actualProperties, scenarios) {
  const columns = [
    { id: 'actual', name: 'Actual', actual: true, createdAt: null, totals: computeTotals(actualProperties) },
    ...(scenarios ?? []).map((s) => ({
      id: s.id,
      name: s.name || 'Scenario',
      actual: false,
      createdAt: s.createdAt,
      totals: computeTotals(s.properties),
    })),
  ]
  const base = columns[0].totals
  const rows = COMPARE_ROWS.map((r) => ({
    ...r,
    cells: columns.map((c) => {
      const value = c.totals[r.id]
      if (c.actual) return { value, delta: 0, tone: null }
      const delta = value - base[r.id]
      const same = Math.abs(delta) < 0.005
      const tone = same || !r.better ? null : (r.better === 'higher' ? delta > 0 : delta < 0) ? 'amber' : 'alert'
      return { value, delta: same ? 0 : delta, tone }
    }),
  }))
  return { columns, rows }
}

// ---------------------------------------------------------------------------
// side by side — actual on one side, a scenario on the other
// ---------------------------------------------------------------------------

/** The figures the split view's delta bar shows, in order. */
export const DELTA_ROWS = ['collected', 'bills', 'net', 'annualNet']

/**
 * The name an automatic fork gets: "What-if Oct 7, 2026", with " (2)",
 * " (3)"… when the portfolio already has one by that name.
 */
export function whatIfName(now = new Date(), taken = []) {
  const base = `What-if ${dayLabel(now)}`
  const names = new Set(taken)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} (${n})`)) n += 1
  return `${base} (${n})`
}

/**
 * What the "Side by side" control does for a portfolio. With no scenario
 * there is nothing to ask: fork one, named by whatIfName. Otherwise ask
 * which goes on the right, "+ new fork" first — refused, with the reason,
 * at the cap.
 *   { action: 'fork', name }
 *   { action: 'pick', newFork: { name, ok, reason }, scenarios }
 */
export function planSideBySide(state, portfolioId, now = new Date()) {
  const list = scenariosOf(state, portfolioId)
  const name = whatIfName(now, list.map((s) => s.name))
  if (list.length === 0) return { action: 'fork', name }
  const full = list.length >= SCENARIO_CAP
  return {
    action: 'pick',
    newFork: { name, ok: !full, reason: full ? SCENARIO_CAP_REASON : null },
    scenarios: list,
  }
}

/**
 * The delta bar: for each of DELTA_ROWS, both sides' own computeTotals
 * figure and scenario − actual, toned amber when better and alert when
 * worse. Built on compareTable, so it is the same arithmetic as Compare.
 */
export function splitDeltas(actualProperties, scenarioProperties) {
  const { rows } = compareTable(actualProperties, [{ id: 'right', properties: scenarioProperties }])
  return DELTA_ROWS.map((id) => {
    const row = rows.find((r) => r.id === id)
    const [a, s] = row.cells
    return { id, label: row.label, actual: a.value, scenario: s.value, delta: s.delta, tone: s.tone }
  })
}

// ---------------------------------------------------------------------------
// staleness — has actual changed since the fork?
//
// A signature is a short hash of exactly what a fork copies and a scenario
// can differ by: names, addresses, roofs, floors, units (position, width,
// rent, status, splits, side), and bills with any loan terms — no ids, and
// none of what a scenario never holds (photos, payments, tenants, lease
// dates, list items, notes) or what changes month to month (a bill's paid
// box). Taken from actual at the fork, it is compared with actual now; a
// scenario's own edits never enter into it. The fork's signature is kept
// beside the data (store.js, FORK_BASIS_KEY), never in it.
// ---------------------------------------------------------------------------

const projectLoan = (l) =>
  l && typeof l === 'object'
    ? [toAmount(l.originalPrincipal), toAmount(l.annualRatePercent), toAmount(l.termMonths), l.firstPaymentDate ?? null, toAmount(l.extraMonthlyPrincipal)]
    : null

const projectBill = (b) => [String(b.label ?? ''), toAmount(b.amount), b.cadence ?? '', b.dueDay ?? null, projectLoan(b.loan)]

const projectUnit = (u) => [
  String(u.name ?? ''),
  u.position ?? '',
  toWeight(u.widthWeight),
  toAmount(u.rent),
  u.status ?? '',
  Boolean(u.splittable),
  Boolean(u.isSplit),
  toAmount(u.splitRent),
  u.sideOf ?? '',
  (u.bills ?? []).map(projectBill),
]

const projectProperty = (p) => [
  String(p.name ?? ''),
  String(p.address ?? ''),
  p.shape ?? '',
  (p.floors ?? []).map((f) => [String(f.label ?? ''), (f.units ?? []).map(projectUnit)]),
  (p.bills ?? []).map(projectBill),
]

/**
 * The signature of some buildings: 8 hex digits (FNV-1a over the
 * projection). Equal for actual and a fresh fork of it, since the fork
 * differs only in ids and facts.
 */
export function forkSignature(properties) {
  const text = JSON.stringify((Array.isArray(properties) ? properties : []).map(projectProperty))
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The signature of a portfolio's actual buildings right now. */
export function actualSignature(state, portfolioId) {
  return forkSignature(actualBuildings(state, portfolioId) ?? [])
}

/**
 * Has actual changed since this scenario was forked (or refreshed)?
 * `basis` is the signature taken then. true / false, or null when there is
 * no basis to go by (a scenario from before this was kept, or one that
 * came in through an import) — then the marker stays quiet.
 */
export function isStale(state, scenario, basis) {
  if (!scenario || typeof basis !== 'string' || basis === '') return null
  return basis !== actualSignature(state, scenario.portfolioId)
}
