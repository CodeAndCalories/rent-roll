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
//   * A unit can be removed only when it is empty (isEmptyUnit), a floor
//     only when it has no units.
//   * Width weights are positive numbers, and a side annex never carries
//     one: it has its own fixed width and is not part of a floor's split.
//
// Existing stores that already break a rule (older data) are never rejected
// for unrelated edits: a property patch is refused only if it ADDS a
// violation.

import { makeFloor, makeUnit, toAmount, toWeight, withPortfolios } from './schema.js'

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
 * Unknown unit id: state is returned unchanged.
 */
export function patchUnit(state, unitId, patch) {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  const partial = typeof patch === 'function' ? patch(hit.unit) : patch
  if (!partial || typeof partial !== 'object') return state

  const next = { ...hit.unit, ...partial }
  if (!next.splittable && next.isSplit) next.isSplit = false

  const wasSide = hit.unit.position === 'side'
  const isSide = next.position === 'side'
  if (isSide && !wasSide) {
    const check = sideAnnexCheck(state, unitId)
    if (!check.ok) throw new RuleError(check.reason, check.code)
  }

  return {
    ...state,
    properties: state.properties.map((p) => {
      if (p.id !== hit.property.id) return p
      return {
        ...p,
        floors: p.floors.map((f) => {
          if (f.id !== hit.floor.id) return f
          const updated = { ...f, units: f.units.map((u) => (u.id === unitId ? next : u)) }
          return isSide !== wasSide ? relayoutFloor(updated) : updated
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
  }

  const held = [
    counts.withRent && `${counts.withRent} with rent`,
    counts.tenants && `${counts.tenants} ${counts.tenants === 1 ? 'tenant' : 'tenants'}`,
    counts.bills && `${counts.bills} ${counts.bills === 1 ? 'bill' : 'bills'}`,
    counts.tasks && `${counts.tasks} list ${counts.tasks === 1 ? 'item' : 'items'}`,
    counts.notes && `${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}`,
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
  const buildings = properties.length

  const bits = [
    `${buildings} ${buildings === 1 ? 'building' : 'buildings'}`,
    units && `${units} ${units === 1 ? 'unit' : 'units'}`,
    withRent && `${withRent} with rent`,
  ].filter(Boolean)

  return {
    name: f?.name ?? '',
    buildings,
    units,
    withRent,
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
  return (
    toAmount(unit.rent) === 0 &&
    toAmount(unit.splitRent) === 0 &&
    !(unit.tenant && String(unit.tenant).trim()) &&
    !(unit.bills && unit.bills.length) &&
    !(unit.tasks && unit.tasks.length) &&
    !(unit.notes && unit.notes.length)
  )
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
 * holding rent, a tenant, bills, list items, or notes can never be dropped.
 */
export function removeUnit(state, unitId) {
  const hit = locateUnit(state, unitId)
  if (!hit) return state
  if (!isEmptyUnit(hit.unit)) {
    throw new RuleError(
      `${hit.unit.name || 'That unit'} has rent, a tenant, bills, list items, or notes. ` +
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
