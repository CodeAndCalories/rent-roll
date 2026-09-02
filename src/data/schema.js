// Rent Roll — data shapes, defaults, normalizers, and seed data.
//
// This file knows what the data LOOKS like. It does not touch storage.
// See store.js for load/save/migrate/import/export, ops.js for writes that
// enforce rules, templates.js for the building templates.
//
// Data model (recorded verbatim in CLAUDE.md):
//
//   State    { version, updatedAt, properties[] }
//   Property { id, name, address, shape, photo, photoSize, view, floors[], bills[] }
//     shape: 'gable' | 'flat' | 'mansard' | 'custom'
//     photo: null or a data-URL string (resized to <= 1200px wide before storing)
//     photoSize: null or { w, h } pixel size of the stored photo
//     view: 'drawing' | 'photo'            // which rendering the sheet shows
//     bills: building-level costs (taxes, insurance, water, mortgage)
//   Floor    { id, label, units[] }           // label like "3F", "2F", "Street"
//   Unit     { id, name, position,            // position: 'left' | 'right' | 'full' | 'side'
//              widthWeight,                   // share of its floor's width (default 1)
//              rent, status,                  // status: 'leased' | 'vacant' | 'renovating'
//              tenant, leaseStart, leaseEnd,
//              splittable, isSplit, splitRent, // any unit can be splittable
//              sideOf,                        // 'left' | 'right': side a 'side' unit hangs off (default 'left')
//              photoBox,                      // null or { x, y, w, h } as fractions (0-1) of the photo
//              bills[], tasks[], notes[] }
//   Bill     { id, label, amount, cadence, dueDay, paid } // cadence: 'monthly'|'yearly'|'once'
//   Task     { id, text, done, createdAt }
//   Note     { id, text, createdAt }
//
// Rules enforced on writes (see ops.js):
//   * position 'side' (a side annex) only on the bottom floor, one per floor
//   * splittable false forces isSplit false (splitRent is kept, not counted)
//
// Money: plain numbers in dollars. Round only at display with Math.round.
// Empty input means 0, never NaN. See toAmount() / formatDollars().
//
// Split units: when `isSplit` is true, `rent` is the first half's rent and
// `splitRent` is the second half's rent. When not split, `rent` is the whole
// unit and `splitRent` is ignored (but kept).

// v1: initial.
// v2: + property.photoSize, property.view, unit.sideOf (default 'right'),
//     unit.photoBox. Additive; filled by normalizeState, no migration step.
// v3: unit.sideOf default becomes 'left'. Additive only: a stored sideOf is
//     always kept; only units with none get the new default.
// v4: no field changes. The seed is now empty (buildings come from
//     templates.js) and the side-annex / splittable rules are enforced on
//     writes in ops.js. Existing stores load unchanged.
// v5: + unit.widthWeight (default 1): the units on a floor split its width in
//     proportion to their weights, so all-1s is the equal split every older
//     store already draws. Additive; filled by normalizeState, no migration
//     step. A stored weight is always kept.
export const SCHEMA_VERSION = 5

export const SHAPES = ['gable', 'flat', 'mansard', 'custom']
export const POSITIONS = ['left', 'right', 'full', 'side']
export const STATUSES = ['leased', 'vacant', 'renovating']
export const CADENCES = ['monthly', 'yearly', 'once']
export const VIEWS = ['drawing', 'photo']
export const SIDES = ['left', 'right']

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

export function newId(prefix = '') {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return prefix ? `${prefix}-${raw}` : raw
}

export function nowISO() {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

/** Coerce any input to a finite dollar amount. Empty / junk -> 0, never NaN. */
export function toAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value == null || typeof value === 'boolean') return 0
  const s = String(value).replace(/[$,\s_]/g, '')
  if (s === '' || s === '-' || s === '.' || s === '-.') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Coerce any input to a width weight: a positive finite number. Anything
 * else (missing, 0, negative, junk) means 1, the equal share. Never NaN.
 */
export function toWeight(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** Display-only rounding. Keeps stored values exact. */
export function formatDollars(amount) {
  const whole = Math.round(toAmount(amount)) || 0 // `|| 0` turns -0 into 0
  return `$${whole.toLocaleString('en-US')}`
}

// ---------------------------------------------------------------------------
// factories — every field present, sensible defaults, unknown fields kept
// ---------------------------------------------------------------------------

export function makeNote(fields = {}) {
  return {
    id: newId('note'),
    text: '',
    createdAt: nowISO(),
    ...fields,
  }
}

export function makeTask(fields = {}) {
  return {
    id: newId('task'),
    text: '',
    done: false,
    createdAt: nowISO(),
    ...fields,
  }
}

export function makeBill(fields = {}) {
  return {
    id: newId('bill'),
    label: '',
    amount: 0,
    cadence: 'monthly',
    dueDay: 1,
    paid: false,
    ...fields,
    // normalize after the spread so a caller can never hand us NaN
    amount: toAmount(fields.amount),
  }
}

export function makeUnit(fields = {}) {
  return {
    id: newId('unit'),
    name: '',
    position: 'full',
    widthWeight: 1, // share of the floor's width, relative to its neighbours
    rent: 0,
    status: 'vacant',
    tenant: '',
    leaseStart: null, // 'YYYY-MM-DD' or null
    leaseEnd: null, // 'YYYY-MM-DD' or null
    splittable: false,
    isSplit: false,
    splitRent: 0,
    sideOf: 'left',
    photoBox: null,
    bills: [],
    tasks: [],
    notes: [],
    ...fields,
    widthWeight: toWeight(fields.widthWeight),
    rent: toAmount(fields.rent),
    splitRent: toAmount(fields.splitRent),
    bills: asArray(fields.bills).map(makeBill),
    tasks: asArray(fields.tasks).map(makeTask),
    notes: asArray(fields.notes).map(makeNote),
  }
}

export function makeFloor(fields = {}) {
  return {
    id: newId('floor'),
    label: '',
    units: [],
    ...fields,
    units: asArray(fields.units).map(makeUnit),
  }
}

export function makeProperty(fields = {}) {
  return {
    id: newId('property'),
    name: '',
    address: '',
    shape: 'gable',
    photo: null,
    photoSize: null,
    view: 'drawing',
    floors: [],
    bills: [],
    ...fields,
    floors: asArray(fields.floors).map(makeFloor),
    bills: asArray(fields.bills).map(makeBill),
  }
}

export function makeState(fields = {}) {
  return {
    version: SCHEMA_VERSION,
    updatedAt: nowISO(),
    properties: [],
    ...fields,
    properties: asArray(fields.properties).map(makeProperty),
  }
}

/**
 * Fill in missing fields with defaults, recursively. Unknown fields survive.
 * Idempotent: normalizing twice gives the same result, except that items
 * missing an id get a fresh one the first time through.
 */
export function normalizeState(state) {
  return makeState(isObject(state) ? state : {})
}

// ---------------------------------------------------------------------------
// seed — an empty sheet. Buildings are created from templates.js.
// ---------------------------------------------------------------------------

export function seedData() {
  return makeState({ properties: [] })
}

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function asArray(v) {
  return Array.isArray(v) ? v.filter(isObject) : []
}
