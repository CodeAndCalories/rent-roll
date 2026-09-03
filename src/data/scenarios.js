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

import { makeScenario, newId, stripForScenario } from './schema.js'
import { computeTotals } from './totals.js'

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
  const portfolio = (state?.portfolios ?? []).find((f) => f.id === portfolioId)
  if (!portfolio) return null
  const byId = new Map((state.properties ?? []).map((p) => [p.id, p]))
  const properties = portfolio.propertyIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(cloneForScenario)
  return makeScenario({ portfolioId, name, note, properties })
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
