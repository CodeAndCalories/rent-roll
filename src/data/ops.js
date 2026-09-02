// Rent Roll — write operations on the state, with the rules enforced HERE,
// not only in the UI. Every function returns a new state (never mutates the
// input) and throws RuleError when a write would break a rule, so a bad
// write is rejected rather than stored.
//
// Rules:
//   * A side annex (position 'side') may only be on the bottom floor of its
//     building, and a floor may have at most one.
//   * splittable false forces isSplit false. splitRent is kept (not counted).
//   * A building can be removed only when it has no units.
//
// Existing stores that already break a rule (older data) are never rejected
// for unrelated edits: a property patch is refused only if it ADDS a
// violation.

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

export function addProperty(state, property) {
  return { ...state, properties: [...state.properties, property] }
}

/** Remove a building. Rejected with RuleError while it still has units. */
export function removeProperty(state, propertyId) {
  const p = state.properties.find((x) => x.id === propertyId)
  if (!p) return state
  if (countUnits(p) > 0) {
    throw new RuleError(`${p.name || 'That building'} still has units. Remove them first.`, 'has-units')
  }
  return { ...state, properties: state.properties.filter((x) => x.id !== propertyId) }
}
