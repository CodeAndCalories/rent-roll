// Rent Roll — data shapes, defaults, normalizers, and seed data.
//
// This file knows what the data LOOKS like. It does not touch storage.
// See store.js for load/save/migrate/import/export.
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
//              rent, status,                  // status: 'leased' | 'vacant' | 'renovating'
//              tenant, leaseStart, leaseEnd,
//              splittable, isSplit, splitRent, // for the double single
//              sideOf,                        // 'left' | 'right': side a 'side' unit hangs off (default 'left')
//              photoBox,                      // null or { x, y, w, h } as fractions (0-1) of the photo
//              bills[], tasks[], notes[] }
//   Bill     { id, label, amount, cadence, dueDay, paid } // cadence: 'monthly'|'yearly'|'once'
//   Task     { id, text, done, createdAt }
//   Note     { id, text, createdAt }
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
export const SCHEMA_VERSION = 3

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
// seed — the real buildings, rents left at 0
// ---------------------------------------------------------------------------

/** Building-level cost lines every property starts with (amounts blank). */
function buildingBills(prefix) {
  return [
    { id: `${prefix}-bill-mortgage`, label: 'Mortgage', amount: 0, cadence: 'monthly', dueDay: 1 },
    { id: `${prefix}-bill-taxes`, label: 'Property taxes', amount: 0, cadence: 'yearly', dueDay: 1 },
    { id: `${prefix}-bill-insurance`, label: 'Insurance', amount: 0, cadence: 'yearly', dueDay: 1 },
    { id: `${prefix}-bill-water`, label: 'Water', amount: 0, cadence: 'monthly', dueDay: 1 },
  ]
}

export function seedData() {
  return makeState({
    properties: [
      {
        id: 'fairview',
        name: '2107 Fairview',
        address: '2107 Fairview, Cleveland Heights, OH',
        shape: 'gable',
        photo: null,
        bills: buildingBills('fairview'),
        floors: [
          {
            id: 'fairview-3f',
            label: '3F',
            units: [
              { id: 'fairview-3f-left', name: '3F Left', position: 'left' },
              { id: 'fairview-3f-right', name: '3F Right', position: 'right' },
            ],
          },
          {
            id: 'fairview-2f',
            label: '2F',
            units: [
              { id: 'fairview-2f-left', name: '2F Left', position: 'left' },
              { id: 'fairview-2f-right', name: '2F Right', position: 'right' },
            ],
          },
          {
            id: 'fairview-street',
            label: 'Street',
            units: [
              {
                id: 'fairview-double-single',
                name: 'Double single',
                position: 'full',
                splittable: true,
              },
              { id: 'fairview-storefront', name: 'Storefront', position: 'side' },
            ],
          },
        ],
      },
      {
        id: 'duplex',
        name: 'Duplex',
        address: '',
        shape: 'gable',
        photo: null,
        bills: buildingBills('duplex'),
        floors: [
          {
            id: 'duplex-2f',
            label: '2F',
            units: [{ id: 'duplex-upper', name: 'Upper', position: 'full' }],
          },
          {
            id: 'duplex-1f',
            label: '1F',
            units: [{ id: 'duplex-lower', name: 'Lower', position: 'full' }],
          },
        ],
      },
    ],
  })
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
