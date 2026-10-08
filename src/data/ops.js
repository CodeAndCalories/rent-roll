// Rent Roll — write operations on the state, with the rules enforced HERE,
// not only in the UI. Every function returns a new state (never mutates the
// input) and throws RuleError when a write would break a rule, so a bad
// write is rejected rather than stored.
//
// Rules:
//   * A side annex (position 'side') may only be on the bottom floor of its
//     building, and a floor may have at most one.
//   * splittable false forces isSplit false. splitRent is kept (not counted).
//   * A building can be removed only when it has no units, unless the
//     caller passes { force: true } — what the caption's confirm does once
//     it has named exactly what would go.
//   * There is always at least one portfolio, and a portfolio that holds
//     buildings only goes with { force: true } (which takes its buildings
//     with it).
//   * A unit can be removed only when it is empty (isEmptyUnit) — no rent,
//     tenant, bills, list items, notes, or payment records — a floor only
//     when it has no units.
//   * Width weights are positive numbers, and a side annex never carries
//     one: it has its own fixed width and is not part of a floor's split.
//   * Every write from the app names its TARGET — actual data, or one
//     scenario — and goes through applyTo. A scenario write is handed a
//     view of that scenario (scenarioView) and only the view's buildings
//     come back, into that scenario: state.properties, state.portfolios,
//     and every other scenario are the very same objects afterwards. That
//     is what makes a scenario write landing in actual data impossible
//     rather than unlikely. A scenario never holds photos, payments,
//     tenants, lease dates, list items, or notes (stripForScenario runs on
//     every write-back), and a portfolio holds at most SCENARIO_CAP of them.
//   * Payment records are written ONLY by setPayment / clearPayment /
//     cyclePayment, each one explicit user action on one month of one
//     rental. patchUnit ignores a `payments` field in its patch, so no
//     other write — a rent change, a rename, a split or unsplit, a raise, a
//     move between portfolios — can create, change, or drop a record. A
//     month with no record is untracked, which is not unpaid.
//   * At most one bill per building carries loan terms. Building bills are
//     written through addPropertyBill / patchPropertyBill /
//     removePropertyBill / setBillLoan, and patchProperty refuses any write
//     that would give a building a second loan bill. Only the terms are
//     stored; nothing derived from them is ever written.
//   * addUnit (the + tab) and setFloorUnitCount (the stepper) add and
//     remove main units at the right-hand end of a floor as drawn, and the
//     stepper never removes one that holds anything (isEmptyUnit): the
//     whole write is refused, naming that unit.
//
// Existing stores that already break a rule (older data) are never rejected
// for unrelated edits: a property patch is refused only if it ADDS a
// violation.

import {
  HALVES,
  PAYMENT_STATUSES,
  asLoan,
  isMonthKey,
  makeBill,
  makeFloor,
  makeLoan,
  makePayment,
  makeUnit,
  nowISO,
  paymentKey,
  stripForScenario,
  toAmount,
  toWeight,
  withPortfolios,
} from './schema.js'
import { countPayments, defaultAmountFor, nextPaymentStatus } from './payments.js'
import {
  SCENARIO_CAP,
  SCENARIO_CAP_REASON,
  actualBuildings,
  cloneForScenario,
  countScenario,
  scenarioView,
} from './scenarios.js'
import { loanBillCount, loanBillOf, withExtraStart } from './loans.js'
import { drawnUnits } from '../lib/widths.js'

export class RuleError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'RuleError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

/** Find a unit anywhere in the state, with its floor and property. */
export function locateUnit(state, unitId) {
  for (const property of state?.properties ?? []) {
    const floors = property.floors ?? []
    for (let fi = 0; fi < floors.length; fi++) {
      const floor = floors[fi]
      const unit = (floor.units ?? []).find((u) => u.id === unitId)
      if (unit) {
        return { property, floor, unit, floorIndex: fi, isBottomFloor: fi === floors.length - 1 }
      }
    }
  }
  return null
}

export function countUnits(property) {
  return (property?.floors ?? []).reduce((n, f) => n + (f.units?.length ?? 0), 0)
}

// ---------------------------------------------------------------------------
// side annex rule
// ---------------------------------------------------------------------------

/**
 * Can this unit become (or stay) a side annex?
 * Returns { ok: true } or { ok: false, code, reason }.
 */
export function sideAnnexCheck(state, unitId) {
  const hit = locateUnit(state, unitId)
  if (!hit) return { ok: false, code: 'missing', reason: 'Unit not found.' }
  if (hit.unit.position === 'side') return { ok: true }
  if (!hit.isBottomFloor) {
    return { ok: false, code: 'not-bottom', reason: 'A side annex hangs off the bottom floor only.' }
  }
  const other = hit.floor.units.find((u) => u.position === 'side' && u.id !== unitId)
  if (other) {
    return {
      ok: false,
      code: 'taken',
      reason: `${hit.floor.label || 'This floor'} already has a side annex (${other.name || 'unit'}).`,
    }
  }
  return { ok: true }
}

/** Number of side-annex rule breaks in a property (0 when it is clean). */
export function sideAnnexViolations(property) {
  const floors = property?.floors ?? []
  let n = 0
  floors.forEach((f, fi) => {
    const sides = (f.units ?? []).filter((u) => u.position === 'side').length
    if (sides > 1) n += sides - 1
    if (sides > 0 && fi !== floors.length - 1) n += sides
  })
  return n
}

/**
 * Main units on a floor are laid out by order: one -> full, two -> left and
 * right. Side units are untouched. Returns the same floor object when nothing
 * changes.
 */
export function relayoutFloor(floor) {
  const main = (floor.units ?? []).filter((u) => u.position !== 'side')
  let map = null
  if (main.length === 1) map = { [main[0].id]: 'full' }
  if (main.length === 2) map = { [main[0].id]: 'left', [main[1].id]: 'right' }
  if (!map) return floor
  let changed = false
  const units = floor.units.map((u) => {
    const pos = map[u.id]
    if (!pos || u.position === pos) return u
    changed = true
    return { ...u, position: pos }
  })
  return changed ? { ...floor, units } : floor
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

/**
 * Patch one unit. `patch` is a partial unit or (unit) => partial.
 *   * splittable: false  -> isSplit is forced false
 *   * position: 'side'   -> rejected with RuleError unless sideAnnexCheck ok
 *   * toggling side annex on/off relays out the floor's main units
 *   * a `payments` field in the patch is IGNORED: records are written only
 *     by setPayment / clearPayment, so nothing else can touch them
 * Unknown unit id: state is returned unchanged.
 */
export function patchUnit(state, unitId, patch) {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  const partial = typeof patch === 'function' ? patch(hit.unit) : patch
  if (!partial || typeof partial !== 'object') return state

  const fields = { ...partial }
  delete fields.payments // never rides along; see setPayment / clearPayment
  const next = { ...hit.unit, ...fields }
  if (!next.splittable && next.isSplit) next.isSplit = false

  const wasSide = hit.unit.position === 'side'
  const isSide = next.position === 'side'
  if (isSide && !wasSide) {
    const check = sideAnnexCheck(state, unitId)
    if (!check.ok) throw new RuleError(check.reason, check.code)
  }

  return replaceUnit(state, hit, next, isSide !== wasSide)
}

/** Put `next` where hit.unit is; relayout the floor when asked (annex toggled). */
function replaceUnit(state, hit, next, relayout = false) {
  return {
    ...state,
    properties: state.properties.map((p) => {
      if (p.id !== hit.property.id) return p
      return {
        ...p,
        floors: p.floors.map((f) => {
          if (f.id !== hit.floor.id) return f
          const updated = { ...f, units: f.units.map((u) => (u.id === hit.unit.id ? next : u)) }
          return relayout ? relayoutFloor(updated) : updated
        }),
      }
    }),
  }
}

/** Convenience: mark or unmark a unit as the floor's side annex. */
export function setSideAnnex(state, unitId, on) {
  return patchUnit(state, unitId, { position: on ? 'side' : 'full' })
}

/** Convenience: mark or unmark a unit as splittable (off also un-splits). */
export function setSplittable(state, unitId, on) {
  return patchUnit(state, unitId, on ? { splittable: true } : { splittable: false, isSplit: false })
}

// ---------------------------------------------------------------------------
// payments — the only writers of unit.payments
//
// A month with no record is untracked, which is not unpaid. Nothing here
// runs on its own: no backfill, no "paid because rent is set", nothing on a
// month rollover. Each function is one explicit user action on one month
// of one rental (the unit, or half 'A' / 'B' of a split unit).
// ---------------------------------------------------------------------------

/**
 * Create or change the record for one month of one rental. `patch` may
 * carry status, amount, paidOn, note. A new record's amount starts at the
 * rent stored for that half right now (defaultAmountFor) and is its own
 * from then on: a later rent change never rewrites it. A write that
 * changes nothing returns the very same state. Rejected with RuleError for
 * a bad month, half, or status; an unknown unit leaves the state unchanged.
 */
export function setPayment(state, unitId, month, half = 'A', patch = {}) {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  if (!isMonthKey(month)) throw new RuleError(`"${month}" is not a month (YYYY-MM).`, 'bad-month')
  if (!HALVES.includes(half)) throw new RuleError(`"${half}" is not a half (A or B).`, 'bad-half')
  if (!patch || typeof patch !== 'object') return state
  if (patch.status !== undefined && !PAYMENT_STATUSES.includes(patch.status)) {
    throw new RuleError(`"${patch.status}" is not a payment status.`, 'bad-status')
  }

  const key = paymentKey(month, half)
  const existing = hit.unit.payments?.[key] ?? null
  const fields = {}
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) fields[k] = v
  const record = makePayment({
    ...(existing ?? { amount: defaultAmountFor(hit.unit, half) }),
    ...fields,
    half,
  })
  if (existing && sameRecord(existing, record)) return state

  const payments = { ...(hit.unit.payments ?? {}), [key]: record }
  return replaceUnit(state, hit, { ...hit.unit, payments })
}

/** Take one month's record away — untracked again. A month with none is a no-op. */
export function clearPayment(state, unitId, month, half = 'A') {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  const key = paymentKey(month, half)
  const payments = hit.unit.payments ?? {}
  if (!Object.prototype.hasOwnProperty.call(payments, key)) return state
  const rest = { ...payments }
  delete rest[key]
  return replaceUnit(state, hit, { ...hit.unit, payments: rest })
}

/**
 * The tap in the month view: untracked -> paid -> partial -> late ->
 * unpaid -> waived, then back to untracked for a record nothing was typed
 * into, or round to paid for one with a note, a date, or an amount of its
 * own (nextPaymentStatus). A tap never drops anything that was typed.
 */
export function cyclePayment(state, unitId, month, half = 'A') {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  const next = nextPaymentStatus(hit.unit, month, half)
  if (next === null) return clearPayment(state, unitId, month, half)
  return setPayment(state, unitId, month, half, { status: next })
}

/** Same fields, same values (records hold only primitives). */
function sameRecord(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

/**
 * Patch one property. `patch` is a partial property or (property) => partial.
 * Rejected with RuleError if the result has MORE side-annex violations than
 * before, or more loan bills beyond the one allowed (so older data that
 * already breaks a rule can still be edited).
 */
export function patchProperty(state, propertyId, patch) {
  const current = state.properties.find((p) => p.id === propertyId)
  if (!current) return state
  const partial = typeof patch === 'function' ? patch(current) : patch
  if (!partial || typeof partial !== 'object') return state
  const next = { ...current, ...partial }
  if (sideAnnexViolations(next) > sideAnnexViolations(current)) {
    throw new RuleError(
      'A side annex hangs off the bottom floor only, and a floor can have just one.',
      'annex-rule',
    )
  }
  if (loanViolations(next) > loanViolations(current)) {
    const holder = loanBillOf(current)
    throw new RuleError(
      holder
        ? `${current.name || 'This building'} already has loan terms on "${holder.label || 'a bill'}". One loan per building.`
        : 'A building can carry loan terms on one bill only.',
      'one-loan',
    )
  }
  return { ...state, properties: state.properties.map((p) => (p.id === propertyId ? next : p)) }
}

/** Loan bills beyond the one a building may have (0 when it is clean). */
function loanViolations(property) {
  return Math.max(0, loanBillCount(property) - 1)
}

// ---------------------------------------------------------------------------
// building bills — taxes, insurance, water, the mortgage
//
// These edit property.bills in place: the four every template seeds are the
// very bills the editor shows, never a parallel set. All of them go through
// patchProperty, so the one-loan rule holds whatever the caller does.
// ---------------------------------------------------------------------------

/** Append a building bill (made with makeBill by the caller, or a blank one). */
export function addPropertyBill(state, propertyId, bill = makeBill()) {
  return patchProperty(state, propertyId, (p) => ({ bills: [...(p.bills ?? []), makeBill(bill)] }))
}

/**
 * Patch one building bill. `patch` is a partial bill or (bill) => partial.
 * An amount is coerced with toAmount (never NaN); a `loan` field is
 * normalized (null takes the terms off). An unknown bill or building leaves
 * the state unchanged. A second loan bill is refused with RuleError.
 */
export function patchPropertyBill(state, propertyId, billId, patch) {
  return patchProperty(state, propertyId, (p) => {
    const bills = p.bills ?? []
    const current = bills.find((b) => b.id === billId)
    if (!current) return null
    const partial = typeof patch === 'function' ? patch(current) : patch
    if (!partial || typeof partial !== 'object') return null
    const next = { ...current, ...partial }
    if ('amount' in partial) next.amount = toAmount(partial.amount)
    if ('loan' in partial) next.loan = asLoan(partial.loan)
    return { bills: bills.map((b) => (b.id === billId ? next : b)) }
  })
}

/** Remove one building bill. The two-tap confirm is the UI's; an unknown id is a no-op. */
export function removePropertyBill(state, propertyId, billId) {
  const property = state.properties.find((p) => p.id === propertyId)
  if (!(property?.bills ?? []).some((b) => b.id === billId)) return state
  return patchProperty(state, propertyId, (p) => ({ bills: (p.bills ?? []).filter((b) => b.id !== billId) }))
}

/**
 * Put loan terms on a building bill, change some of them, or take them off.
 * `terms` is a partial Loan merged over what the bill has, or null to remove
 * the terms. Only the terms are stored. Extra principal entered where there
 * was none starts with the next payment due after `today` unless `terms`
 * names a start date (withExtraStart); a loan that already had extra with
 * no start date keeps it from the first payment. Refused with RuleError
 * when another bill of the building already carries a loan.
 */
export function setBillLoan(state, propertyId, billId, terms, { today = new Date() } = {}) {
  return patchPropertyBill(state, propertyId, billId, (b) => {
    if (terms === null) return { loan: null }
    const merged = { ...(b.loan ?? {}), ...(terms ?? {}) }
    return { loan: makeLoan(withExtraStart(b.loan, terms, merged, today)) }
  })
}

/** Add a building, into `portfolioId` or else the first portfolio. */
export function addProperty(state, property, portfolioId) {
  const list = state.portfolios ?? []
  const target = list.find((f) => f.id === portfolioId) ?? list[0]
  return withPortfolios({
    ...state,
    properties: [...state.properties, property],
    portfolios: list.map((f) =>
      target && f.id === target.id ? { ...f, propertyIds: [...f.propertyIds, property.id] } : f,
    ),
  })
}

/**
 * Remove a building, and its id from the portfolio holding it.
 *
 * Refused with RuleError while it still has units, unless { force: true }:
 * the caption arms that only after naming what the building holds
 * (describeContents), so an explicit removal is possible but never a slip.
 */
export function removeProperty(state, propertyId, opts = {}) {
  const p = state.properties.find((x) => x.id === propertyId)
  if (!p) return state
  if (countUnits(p) > 0 && !opts.force) {
    throw new RuleError(
      `${p.name || 'That building'} still has units. Confirm the removal, or empty it first.`,
      'has-units',
    )
  }
  // withPortfolios drops ids that name no building, so the lists follow
  return withPortfolios({ ...state, properties: state.properties.filter((x) => x.id !== propertyId) })
}

/**
 * What a building holds, for a confirm that names exactly what would be
 * lost. Building bills at 0 are not counted: every template starts with
 * four of them and they are not data the user typed.
 */
export function describeContents(property) {
  const units = (property?.floors ?? []).flatMap((f) => f.units ?? [])
  const counts = {
    units: units.length,
    withRent: units.filter((u) => toAmount(u.rent) + toAmount(u.splitRent) > 0).length,
    tenants: units.filter((u) => u.tenant && String(u.tenant).trim()).length,
    bills:
      units.reduce((n, u) => n + (u.bills?.length ?? 0), 0) +
      (property?.bills ?? []).filter((b) => toAmount(b.amount) > 0).length,
    tasks: units.reduce((n, u) => n + (u.tasks?.length ?? 0), 0),
    notes: units.reduce((n, u) => n + (u.notes?.length ?? 0), 0),
    payments: units.reduce((n, u) => n + countPayments(u), 0),
  }

  const held = [
    counts.withRent && `${counts.withRent} with rent`,
    counts.tenants && `${counts.tenants} ${counts.tenants === 1 ? 'tenant' : 'tenants'}`,
    counts.bills && `${counts.bills} ${counts.bills === 1 ? 'bill' : 'bills'}`,
    counts.tasks && `${counts.tasks} list ${counts.tasks === 1 ? 'item' : 'items'}`,
    counts.notes && `${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}`,
    counts.payments && `${counts.payments} payment ${counts.payments === 1 ? 'record' : 'records'}`,
  ].filter(Boolean)

  const short = `${counts.units} ${counts.units === 1 ? 'unit' : 'units'}`
  return {
    ...counts,
    empty: counts.units === 0,
    holdsData: held.length > 0,
    short,
    text:
      counts.units === 0
        ? 'No units on it.'
        : held.length === 0
          ? `${short}, none with rent, tenants, bills, list items or notes.`
          : `${short} · ${held.join(' · ')}.`,
  }
}

// ---------------------------------------------------------------------------
// targets — every write from the app says where it lands
// ---------------------------------------------------------------------------

/** The write target for real data. */
export const ACTUAL = Object.freeze({ kind: 'actual' })

/** The write target for one scenario. */
export function scenarioTarget(scenarioId) {
  return Object.freeze({ kind: 'scenario', id: scenarioId })
}

/**
 * Run a write `fn(state) => state` against its target.
 *
 * ACTUAL: `fn` gets the state and its result is the new state.
 *
 * A scenario: `fn` gets scenarioView(state, scenario) — the scenario's
 * buildings where actual ones would be, one throwaway portfolio, no
 * scenarios — and NOTHING but the view's `properties` comes back, stripped
 * of anything factual, into that scenario. `state.properties`,
 * `state.portfolios`, and every other scenario are the very same objects
 * afterwards. A scenario that no longer exists is refused with RuleError,
 * never quietly written to actual. A RuleError thrown by `fn` propagates.
 */
export function applyTo(state, target, fn) {
  if (!target || target.kind === 'actual') return fn(state)
  if (target.kind !== 'scenario') throw new RuleError('Unknown write target.', 'bad-target')
  const scenario = (state.scenarios ?? []).find((s) => s.id === target.id)
  if (!scenario) {
    throw new RuleError('That scenario no longer exists. Exit scenario mode and try again.', 'no-scenario')
  }
  const view = scenarioView(state, scenario)
  const next = fn(view)
  if (!next || next === view) return state
  const properties = (Array.isArray(next.properties) ? next.properties : []).map(stripForScenario)
  return {
    ...state,
    scenarios: state.scenarios.map((s) => (s.id === scenario.id ? { ...s, properties } : s)),
  }
}

// ---------------------------------------------------------------------------
// scenarios — made by forkScenario (scenarios.js), added and managed here
// ---------------------------------------------------------------------------

/**
 * Add a scenario. Refused with RuleError when its portfolio does not exist
 * or already holds SCENARIO_CAP scenarios — the message says why there is
 * a cap. The caller checks storage first (a trial save), so a fork is
 * never half-written.
 */
export function addScenario(state, scenario) {
  if (!scenario || typeof scenario !== 'object' || !scenario.id) return state
  if (!(state.portfolios ?? []).some((f) => f.id === scenario.portfolioId)) {
    throw new RuleError('That portfolio does not exist.', 'no-portfolio')
  }
  const held = (state.scenarios ?? []).filter((s) => s.portfolioId === scenario.portfolioId).length
  if (held >= SCENARIO_CAP) {
    throw new RuleError(
      `No room for another scenario — ${SCENARIO_CAP_REASON} Delete one you are done with first.`,
      'scenario-cap',
    )
  }
  return { ...state, scenarios: [...(state.scenarios ?? []), scenario] }
}

/**
 * "Refresh from actual": re-fork a scenario from its portfolio's buildings
 * as they are now. The scenario keeps its id, name, note, and portfolio;
 * its buildings are replaced by fresh copies (new ids, nothing factual) and
 * `createdAt` becomes `at`, since it is now a snapshot from then. Every
 * edit made in it is gone — the UI's two-tap confirm says so. Actual
 * buildings, portfolios, and every other scenario are the very same
 * objects afterwards. An unknown scenario is refused with RuleError.
 */
export function refreshScenario(state, scenarioId, { at = nowISO() } = {}) {
  const list = state.scenarios ?? []
  const scenario = list.find((s) => s.id === scenarioId)
  if (!scenario) {
    throw new RuleError('That scenario no longer exists. Exit scenario mode and try again.', 'no-scenario')
  }
  const buildings = actualBuildings(state, scenario.portfolioId)
  if (!buildings) throw new RuleError('That scenario’s portfolio no longer exists.', 'no-portfolio')
  const refreshed = { ...scenario, createdAt: at, properties: buildings.map(cloneForScenario) }
  return { ...state, scenarios: list.map((s) => (s.id === scenarioId ? refreshed : s)) }
}

/** Rename a scenario or change its note. Only those two fields; never its buildings. */
export function patchScenario(state, scenarioId, patch) {
  if (!patch || typeof patch !== 'object') return state
  const fields = {}
  if (patch.name !== undefined) fields.name = String(patch.name ?? '')
  if (patch.note !== undefined) fields.note = String(patch.note ?? '')
  if (Object.keys(fields).length === 0) return state
  return {
    ...state,
    scenarios: (state.scenarios ?? []).map((s) => (s.id === scenarioId ? { ...s, ...fields } : s)),
  }
}

/** Remove a scenario. The two-tap confirm is the UI's; an unknown id is a no-op. */
export function removeScenario(state, scenarioId) {
  const list = state.scenarios ?? []
  if (!list.some((s) => s.id === scenarioId)) return state
  return { ...state, scenarios: list.filter((s) => s.id !== scenarioId) }
}

/** What a scenario holds, for the confirm that names it. */
export function describeScenario(state, scenarioId) {
  const s = (state.scenarios ?? []).find((x) => x.id === scenarioId)
  const { buildings, units } = countScenario(s)
  const name = s?.name || 'Scenario'
  return {
    name,
    buildings,
    units,
    text: `Deletes "${name}" — ${buildings} ${buildings === 1 ? 'building' : 'buildings'} · ${units} ${units === 1 ? 'unit' : 'units'} in it. Your real data is not affected.`,
  }
}

// ---------------------------------------------------------------------------
// portfolios
// ---------------------------------------------------------------------------

/** The portfolio a building belongs to (there is always exactly one). */
export function portfolioOf(state, propertyId) {
  return (state.portfolios ?? []).find((f) => f.propertyIds.includes(propertyId)) ?? null
}

/** Add a portfolio. The caller makes it (makePortfolio) so it knows the id. */
export function addPortfolio(state, portfolio) {
  return withPortfolios({ ...state, portfolios: [...(state.portfolios ?? []), portfolio] })
}

export function renamePortfolio(state, portfolioId, name) {
  return withPortfolios({
    ...state,
    portfolios: (state.portfolios ?? []).map((f) =>
      f.id === portfolioId ? { ...f, name: String(name ?? '') } : f,
    ),
  })
}

/**
 * Move a building to another portfolio. Only the id lists change: the
 * building, its units, and every payment record on them are the very same
 * objects afterwards. Rejected with RuleError for an unknown portfolio; an
 * unknown building, or one already there, leaves the state unchanged.
 */
export function moveProperty(state, propertyId, portfolioId) {
  if (!state.properties.some((p) => p.id === propertyId)) return state
  const list = state.portfolios ?? []
  const target = list.find((f) => f.id === portfolioId)
  if (!target) throw new RuleError('That portfolio does not exist.', 'no-portfolio')
  if (target.propertyIds.includes(propertyId)) return state
  return withPortfolios({
    ...state,
    portfolios: list.map((f) => {
      const propertyIds = f.propertyIds.filter((id) => id !== propertyId)
      return { ...f, propertyIds: f.id === target.id ? [...propertyIds, propertyId] : propertyIds }
    }),
  })
}

/**
 * What a portfolio holds, for its removal confirm: its buildings and their
 * contents rolled up.
 */
export function describePortfolio(state, portfolioId) {
  const f = (state.portfolios ?? []).find((x) => x.id === portfolioId)
  const properties = (f?.propertyIds ?? [])
    .map((id) => state.properties.find((p) => p.id === id))
    .filter(Boolean)
  const parts = properties.map(describeContents)
  const units = parts.reduce((n, d) => n + d.units, 0)
  const withRent = parts.reduce((n, d) => n + d.withRent, 0)
  const payments = parts.reduce((n, d) => n + d.payments, 0)
  const buildings = properties.length
  const scenarios = (state.scenarios ?? []).filter((s) => s.portfolioId === portfolioId).length

  const bits = [
    `${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
    units && `${units} ${units === 1 ? 'unit' : 'units'}`,
    withRent && `${withRent} with rent`,
    payments && `${payments} payment ${payments === 1 ? 'record' : 'records'}`,
    scenarios && `${scenarios} ${scenarios === 1 ? 'scenario' : 'scenarios'}`,
  ].filter(Boolean)

  return {
    name: f?.name ?? '',
    buildings,
    units,
    withRent,
    payments,
    scenarios,
    empty: buildings === 0 && scenarios === 0,
    short: `${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
    text:
      buildings === 0 && scenarios === 0
        ? 'It holds no buildings.'
        : `Takes ${bits.join(' · ')} with it.`,
  }
}

/**
 * Remove a portfolio. The last one can never go — an empty sheet still has
 * a portfolio to draw on. One that holds buildings or scenarios needs
 * { force: true }, and takes those buildings and every scenario of it
 * with it (describePortfolio names how many).
 */
export function removePortfolio(state, portfolioId, opts = {}) {
  const list = state.portfolios ?? []
  const f = list.find((x) => x.id === portfolioId)
  if (!f) return state
  if (list.length <= 1) {
    throw new RuleError('There is always at least one portfolio.', 'last-portfolio')
  }
  const d = describePortfolio(state, portfolioId)
  if ((f.propertyIds.length > 0 || d.scenarios > 0) && !opts.force) {
    throw new RuleError(
      `${f.name || 'That portfolio'} holds ${d.short}${d.scenarios ? ` and ${d.scenarios} ${d.scenarios === 1 ? 'scenario' : 'scenarios'}` : ''}. Confirm the removal to take them with it.`,
      'has-buildings',
    )
  }
  const going = new Set(f.propertyIds)
  return withPortfolios({
    ...state,
    properties: state.properties.filter((p) => !going.has(p.id)),
    portfolios: list.filter((x) => x.id !== portfolioId),
    scenarios: (state.scenarios ?? []).filter((s) => s.portfolioId !== portfolioId),
  })
}

// ---------------------------------------------------------------------------
// structure — the Build handles on the drawing write through here
//
// Every structural change goes through patchProperty, so the side-annex rule
// is re-checked on the result and a bad write leaves the state alone.
// ---------------------------------------------------------------------------

const floorsOf = (property) => (Array.isArray(property?.floors) ? property.floors : [])

/** True when nothing of value is stored on the unit, so it may be removed. */
export function isEmptyUnit(unit) {
  if (!unit) return false
  return unitHoldings(unit).length === 0
}

/**
 * What a unit holds, as short phrases for a message: 'rent', 'a second
 * rent', 'a tenant', '2 bills', '1 list item', '3 notes', '4 payment
 * records'. Empty for a unit that may be removed.
 */
export function unitHoldings(unit) {
  const n = (count, one, many) => (count === 1 ? `1 ${one}` : `${count} ${many}`)
  const held = []
  if (toAmount(unit?.rent) !== 0) held.push('rent')
  if (toAmount(unit?.splitRent) !== 0) held.push('a second rent')
  if (unit?.tenant && String(unit.tenant).trim()) held.push('a tenant')
  if (unit?.bills?.length) held.push(n(unit.bills.length, 'bill', 'bills'))
  if (unit?.tasks?.length) held.push(n(unit.tasks.length, 'list item', 'list items'))
  if (unit?.notes?.length) held.push(n(unit.notes.length, 'note', 'notes'))
  const payments = countPayments(unit)
  if (payments) held.push(n(payments, 'payment record', 'payment records'))
  return held
}

/** 'a', 'a and b', 'a, b, and c'. */
function listOf(items) {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** "3F" on top -> "4F"; otherwise count + "F". */
export function nextFloorLabel(floors) {
  const top = floors[0]?.label ?? ''
  const m = /^(\d+)F$/i.exec(String(top).trim())
  if (m) return `${Number(m[1]) + 1}F`
  return `${floors.length + 1}F`
}

/**
 * Append a unit at the RIGHT-hand end of a floor as drawn — the + tab, and
 * what the stepper does one at a time. Nothing to its left moves; the
 * positions are laid out so the drawing reads them back in that order
 * (one -> full, two -> left + right, more -> left, full…, right). Side
 * units are never touched.
 */
export function addUnitTo(floor) {
  const drawn = drawnUnits(floor)
  return withMains(floor, [...drawn, newUnitFor(floor, drawn.length)])
}

/** A blank unit for main slot `index` of a floor, named off its label: "2F", "2F 2", … */
function newUnitFor(floor, index) {
  const label = floor.label || 'Unit'
  return makeUnit({ name: index === 0 ? label : `${label} ${index + 1}`, position: 'full' })
}

/**
 * The floor with its main units replaced by `mains`, given in drawn order:
 * positions laid out (layoutInOrder) and put back into the main slots in
 * that order, extra ones appended; an annex keeps its place. A floor whose
 * units come out the same is returned as is.
 */
function withMains(floor, mains) {
  const placed = layoutInOrder(mains)
  let k = 0
  const units = []
  for (const u of floor.units ?? []) {
    if (u.position === 'side') units.push(u)
    else if (k < placed.length) units.push(placed[k++])
  }
  while (k < placed.length) units.push(placed[k++])
  const same = units.length === (floor.units ?? []).length && units.every((u, i) => u === floor.units[i])
  return same ? floor : { ...floor, units }
}

/** Most main units the stepper will put on one floor. */
export const MAX_FLOOR_UNITS = 12

/**
 * Positions for main units in the order they should be drawn: one is
 * 'full', two are 'left' + 'right', more are 'left', 'full'…, 'right' —
 * which the drawing's sort (drawnUnits) reads back in this same order. A
 * unit already in place stays the same object.
 */
function layoutInOrder(units) {
  const n = units.length
  return units.map((u, i) => {
    const position = n === 1 ? 'full' : i === 0 ? 'left' : i === n - 1 ? 'right' : 'full'
    return u.position === position ? u : { ...u, position }
  })
}

/**
 * Set how many main units a floor has, in one write — the Build stepper.
 * Units come and go at the RIGHT-hand end of the floor as it is drawn
 * (drawnUnits): new ones are blank and named off the floor label, and
 * nothing to their left moves. A side annex is not counted and never
 * touched.
 *
 * Refused with RuleError, and the state left alone, when the count is not
 * a whole number from 0 to MAX_FLOOR_UNITS, or when going down would take a
 * unit that holds anything (isEmptyUnit): the message names the unit, what
 * it holds, and the lowest count the floor can go to. A count the floor
 * already has returns the very same state.
 */
export function setFloorUnitCount(state, propertyId, floorId, count) {
  const property = state.properties.find((p) => p.id === propertyId)
  const floor = property ? floorsOf(property).find((f) => f.id === floorId) : null
  if (!floor) return state
  const n = typeof count === 'number' ? count : Number(count)
  if (!Number.isInteger(n) || n < 0 || n > MAX_FLOOR_UNITS) {
    throw new RuleError(`A floor takes 0 to ${MAX_FLOOR_UNITS} units.`, 'bad-count')
  }

  const drawn = drawnUnits(floor)
  if (n === drawn.length) return state

  let mains
  if (n > drawn.length) {
    mains = [...drawn]
    for (let i = drawn.length; i < n; i++) mains.push(newUnitFor(floor, i))
  } else {
    // from the right: the first unit holding anything is where it stops
    for (let i = drawn.length - 1; i >= n; i--) {
      const u = drawn[i]
      if (isEmptyUnit(u)) continue
      throw new RuleError(
        `${u.name || 'A unit'} has ${listOf(unitHoldings(u))}, so ${floor.label || 'this floor'} can go ` +
          `down to ${i + 1} ${i + 1 === 1 ? 'unit' : 'units'} at the least. Clear it in the unit panel first.`,
        'not-empty',
      )
    }
    mains = drawn.slice(0, n)
  }

  const next = withMains(floor, mains)
  return patchProperty(state, propertyId, (p) => ({
    floors: floorsOf(p).map((f) => (f.id === floorId ? next : f)),
  }))
}

/** Remove one unit from a floor by id; the remaining main units relay out. */
export function removeUnitFrom(floor, unitId) {
  return relayoutFloor({ ...floor, units: (floor.units ?? []).filter((u) => u.id !== unitId) })
}

/** Add a floor on top of the building, with one unit on it. */
export function addFloor(state, propertyId) {
  return patchProperty(state, propertyId, (p) => {
    const floors = floorsOf(p)
    const label = nextFloorLabel(floors)
    return {
      floors: [makeFloor({ label, units: [makeUnit({ name: label, position: 'full' })] }), ...floors],
    }
  })
}

/** Add a unit to one floor. An unknown floor leaves the state unchanged. */
export function addUnit(state, propertyId, floorId) {
  return patchProperty(state, propertyId, (p) => ({
    floors: floorsOf(p).map((f) => (f.id === floorId ? addUnitTo(f) : f)),
  }))
}

/**
 * Hang a side annex off the bottom floor. Rejected with RuleError when the
 * building has no floors, or when that floor already has one.
 */
export function addSideAnnex(state, propertyId, side = 'left') {
  return patchProperty(state, propertyId, (p) => {
    const floors = floorsOf(p)
    const bottom = floors[floors.length - 1]
    if (!bottom) throw new RuleError('Add a floor before a side annex.', 'no-floor')
    if ((bottom.units ?? []).some((u) => u.position === 'side')) {
      throw new RuleError(
        `${bottom.label || 'The bottom floor'} already has a side annex.`,
        'taken',
      )
    }
    const unit = makeUnit({
      name: 'Annex',
      position: 'side',
      sideOf: side === 'right' ? 'right' : 'left',
    })
    return {
      floors: floors.map((f) => (f.id === bottom.id ? { ...f, units: [...(f.units ?? []), unit] } : f)),
    }
  })
}

/**
 * Remove a unit. Rejected with RuleError unless the unit is empty, so a unit
 * holding rent, a tenant, bills, list items, notes, or payment records can
 * never be dropped; the message names exactly what it holds.
 */
export function removeUnit(state, unitId) {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  if (!isEmptyUnit(hit.unit)) {
    throw new RuleError(
      `${hit.unit.name || 'That unit'} has ${listOf(unitHoldings(hit.unit))}. ` +
        'Clear it in the unit panel first.',
      'not-empty',
    )
  }
  return patchProperty(state, hit.property.id, (p) => ({
    floors: floorsOf(p).map((f) => (f.id === hit.floor.id ? removeUnitFrom(f, unitId) : f)),
  }))
}

/** Remove a floor. Rejected with RuleError while it still has units. */
export function removeFloor(state, propertyId, floorId) {
  const property = state.properties.find((p) => p.id === propertyId)
  if (!property) return state
  const floor = floorsOf(property).find((f) => f.id === floorId)
  if (!floor) return state
  if ((floor.units ?? []).length > 0) {
    throw new RuleError(`${floor.label || 'That floor'} still has units. Remove them first.`, 'has-units')
  }
  return patchProperty(state, propertyId, (p) => ({
    floors: floorsOf(p).filter((f) => f.id !== floorId),
  }))
}

/**
 * Set width weights on the units of one floor — where the drag handle
 * between two units commits. `weights` is { [unitId]: number }; a unit the
 * object does not name keeps the weight it has, so a drag only ever writes
 * the pair it moved. A weight that is not a positive number falls back to 1,
 * and one aimed at a side annex is ignored: the annex has its own fixed
 * width and never takes part in the split.
 *
 * A write that changes no weight returns the very same state, so a drag that
 * ends where it began costs nothing.
 */
export function setUnitWidths(state, propertyId, floorId, weights) {
  if (!weights || typeof weights !== 'object') return state
  const property = state.properties.find((p) => p.id === propertyId)
  const floor = property ? floorsOf(property).find((f) => f.id === floorId) : null
  if (!floor) return state

  let changed = false
  const units = (floor.units ?? []).map((u) => {
    if (u.position === 'side') return u
    if (!Object.prototype.hasOwnProperty.call(weights, u.id)) return u
    const widthWeight = toWeight(weights[u.id])
    if (widthWeight === toWeight(u.widthWeight)) return u
    changed = true
    return { ...u, widthWeight }
  })
  if (!changed) return state

  return patchProperty(state, propertyId, (p) => ({
    floors: floorsOf(p).map((f) => (f.id === floorId ? { ...f, units } : f)),
  }))
}

/** Rename a floor (the label on its level marker). */
export function renameFloor(state, propertyId, floorId, label) {
  return patchProperty(state, propertyId, (p) => ({
    floors: floorsOf(p).map((f) => (f.id === floorId ? { ...f, label: String(label ?? '') } : f)),
  }))
}
