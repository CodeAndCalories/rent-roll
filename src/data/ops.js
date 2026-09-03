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
//   * Payment records are written ONLY by setPayment / clearPayment /
//     cyclePayment, each one explicit user action on one month of one
//     rental. patchUnit ignores a `payments` field in its patch, so no
//     other write — a rent change, a rename, a split or unsplit, a raise, a
//     move between portfolios — can create, change, or drop a record. A
//     month with no record is untracked, which is not unpaid.
//
// Existing stores that already break a rule (older data) are never rejected
// for unrelated edits: a property patch is refused only if it ADDS a
// violation.

import {
  HALVES,
  PAYMENT_STATUSES,
  isMonthKey,
  makeFloor,
  makePayment,
  makeUnit,
  paymentKey,
  toAmount,
  toWeight,
  withPortfolios,
} from './schema.js'
import { countPayments, defaultAmountFor, nextPaymentStatus } from './payments.js'

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
 * before (so older data that already breaks the rule can still be edited).
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
  return { ...state, properties: state.properties.map((p) => (p.id === propertyId ? next : p)) }
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

  const bits = [
    `${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
    units && `${units} ${units === 1 ? 'unit' : 'units'}`,
    withRent && `${withRent} with rent`,
    payments && `${payments} payment ${payments === 1 ? 'record' : 'records'}`,
  ].filter(Boolean)

  return {
    name: f?.name ?? '',
    buildings,
    units,
    withRent,
    payments,
    empty: buildings === 0,
    short: `${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
    text: buildings === 0 ? 'It holds no buildings.' : `Takes ${bits.join(' · ')} with it.`,
  }
}

/**
 * Remove a portfolio. The last one can never go — an empty sheet still has
 * a portfolio to draw on. One that holds buildings needs { force: true },
 * and takes those buildings with it.
 */
export function removePortfolio(state, portfolioId, opts = {}) {
  const list = state.portfolios ?? []
  const f = list.find((x) => x.id === portfolioId)
  if (!f) return state
  if (list.length <= 1) {
    throw new RuleError('There is always at least one portfolio.', 'last-portfolio')
  }
  if (f.propertyIds.length > 0 && !opts.force) {
    const d = describePortfolio(state, portfolioId)
    throw new RuleError(
      `${f.name || 'That portfolio'} holds ${d.short}. Confirm the removal to take them with it.`,
      'has-buildings',
    )
  }
  const going = new Set(f.propertyIds)
  return withPortfolios({
    ...state,
    properties: state.properties.filter((p) => !going.has(p.id)),
    portfolios: list.filter((x) => x.id !== portfolioId),
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
  const m = /^(d+)F$/i.exec(String(top).trim())
  if (m) return `${Number(m[1]) + 1}F`
  return `${floors.length + 1}F`
}

/**
 * Append a unit to a floor. Main units are laid out by count (one -> full,
 * two -> left + right), so an arriving second unit moves the first one over.
 * Side units are never touched.
 */
export function addUnitTo(floor) {
  const units = floor.units ?? []
  const main = units.filter((u) => u.position !== 'side')
  const label = floor.label || 'Unit'
  const name = main.length === 0 ? label : `${label} ${main.length + 1}`
  return relayoutFloor({ ...floor, units: [...units, makeUnit({ name, position: 'full' })] })
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
