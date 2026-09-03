// Rent Roll — persistence: load, save, migrate, importJSON, exportJSON.
//
// Storage rules (from CLAUDE.md):
//   * localStorage key 'rentroll:v1'. Every save writes the whole state
//     object with a schema version number.
//   * On load, an older version is migrated forward by ADDING missing fields
//     with defaults. Unknown fields are never dropped.
//   * Never wipe on a parse error: the raw string is kept in
//     'rentroll:backup' and the app starts fresh from seed.
//   * exportJSON() downloads a .json file. importJSON() merges by id and
//     never blind-replaces.
//
// This module only touches localStorage inside the functions below, so it is
// safe to import in environments without a DOM (tests, Node).

import {
  SCHEMA_VERSION,
  normalizeState,
  seedData,
  isObject,
  asArray,
  asIds,
  nowISO,
  withPortfolios,
} from './schema.js'

export const STORAGE_KEY = 'rentroll:v1'
export const BACKUP_KEY = 'rentroll:backup'

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

// MIGRATIONS[n] upgrades a state from schema version n to n+1.
//
// Rules for every entry:
//   * Additive and idempotent. Add fields with defaults. Never remove fields,
//     never wipe, never reorder units.
//   * A rename must copy old -> new and leave the old field in place.
//   * Filling missing fields with defaults already happens in
//     normalizeState(), so most schema bumps need NO entry here. Add one only
//     when data has to move or be recomputed.
const MIGRATIONS = {
  // 1: (state) => ({ ...state /* changes that take v1 to v2 */ }),
}

/**
 * Bring any stored/imported object up to the current schema.
 * Returns { state, from, warnings }. Never throws on shape problems; it
 * fills what it can and keeps everything it does not understand.
 */
export function migrate(input) {
  const warnings = []
  let state = isObject(input) ? input : {}
  const from = Number.isInteger(state.version) ? state.version : 0

  if (from > SCHEMA_VERSION) {
    warnings.push(
      `Data is schema v${from} but this app writes v${SCHEMA_VERSION}. ` +
        'Loaded as-is; unknown fields are kept.',
    )
  }

  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (typeof step === 'function') state = step(state)
  }

  state = normalizeState(state)
  state.version = SCHEMA_VERSION
  return { state, from, warnings }
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

/**
 * Read state from localStorage.
 * Returns { state, source, from, warnings } where source is one of:
 *   'storage'   parsed and migrated from 'rentroll:v1'
 *   'seed'      nothing stored yet (first run) or storage unavailable
 *   'recovered' stored string was unreadable; raw copy kept in
 *               'rentroll:backup', state is fresh seed
 */
export function load() {
  const result = { state: null, source: 'seed', from: null, warnings: [] }
  const ls = getStorage()

  if (!ls) {
    result.state = seedData()
    result.warnings.push('localStorage is unavailable. Nothing will persist.')
    return result
  }

  let raw = null
  try {
    raw = ls.getItem(STORAGE_KEY)
  } catch (err) {
    result.state = seedData()
    result.warnings.push(`Could not read localStorage: ${err?.message ?? err}`)
    return result
  }

  if (raw == null || raw === '') {
    result.state = seedData()
    return result
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }

  if (!isPlausibleState(parsed)) {
    const backupKey = stashBackup(ls, raw)
    result.state = seedData()
    result.source = 'recovered'
    result.warnings.push(
      `Stored data could not be read. The raw text was kept in ` +
        `localStorage['${backupKey}']. Started fresh from seed.`,
    )
    return result
  }

  const migrated = migrate(parsed)
  result.state = migrated.state
  result.source = 'storage'
  result.from = migrated.from
  result.warnings.push(...migrated.warnings)
  return result
}

function isPlausibleState(v) {
  return isObject(v) && Array.isArray(v.properties)
}

/**
 * Keep an unreadable raw string. If a backup already exists and differs,
 * it is moved to 'rentroll:backup:<timestamp>' first so nothing is lost.
 * Returns the key the new backup was written to.
 */
function stashBackup(ls, raw) {
  try {
    const existing = ls.getItem(BACKUP_KEY)
    if (existing != null && existing !== raw) {
      ls.setItem(`${BACKUP_KEY}:${nowISO()}`, existing)
    }
    ls.setItem(BACKUP_KEY, raw)
  } catch (err) {
    // Out of quota, most likely. Log loudly; the raw string is still in
    // 'rentroll:v1' until the next save.
    console.error('rentroll: could not write backup', err)
  }
  return BACKUP_KEY
}

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

/**
 * Write the whole state object, stamped with the schema version and time.
 * Returns { ok, bytes, state, error? }. Never throws.
 *
 * Refuses to write when:
 *   * `state` is not a plausible state object (guards against saving
 *     undefined/null over real data), or
 *   * `state` has zero properties while storage currently holds units,
 *     unless opts.allowEmpty is true. This is a cheap floor under the
 *     "never drop existing units" rule. Removing the last, unit-less
 *     building is allowed (an empty sheet is a valid state).
 */
export function save(state, opts = {}) {
  if (!isPlausibleState(state)) {
    return {
      ok: false,
      bytes: 0,
      error: new Error('save() refused: not a state object'),
    }
  }

  const ls = getStorage()
  if (!ls) {
    return { ok: false, bytes: 0, error: new Error('localStorage is unavailable') }
  }

  if (state.properties.length === 0 && !opts.allowEmpty) {
    let current = null
    try {
      current = ls.getItem(STORAGE_KEY)
    } catch {
      current = null
    }
    if (current && countStoredUnits(current) > 0) {
      return {
        ok: false,
        bytes: 0,
        error: new Error(
          'save() refused: new state has no properties but storage still holds units. ' +
            'Pass { allowEmpty: true } if this is intentional.',
        ),
      }
    }
  }

  const stamped = { ...state, version: SCHEMA_VERSION, updatedAt: nowISO() }
  const text = JSON.stringify(stamped)
  try {
    ls.setItem(STORAGE_KEY, text)
    return { ok: true, bytes: text.length, state: stamped }
  } catch (error) {
    // QuotaExceededError is the usual cause (large photo data URLs).
    return { ok: false, bytes: text.length, state: stamped, error }
  }
}

function countStoredUnits(rawText) {
  try {
    const v = JSON.parse(rawText)
    if (!isPlausibleState(v)) return 0
    let n = 0
    for (const p of v.properties) {
      for (const f of (p && Array.isArray(p.floors) && p.floors) || []) {
        n += (f && Array.isArray(f.units) && f.units.length) || 0
      }
    }
    return n
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Pretty-printed JSON in exactly the shape that is stored. */
export function serialize(state) {
  return JSON.stringify({ ...state, version: SCHEMA_VERSION }, null, 2)
}

/**
 * Trigger a browser download of the state as a .json file.
 * Returns { ok, filename, bytes, text, error? }. In a non-DOM environment it
 * returns ok:false and the text so callers can still use it.
 */
export function exportJSON(state, filename = defaultExportFilename()) {
  const text = serialize(state)

  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return { ok: false, filename, bytes: text.length, text, error: new Error('no DOM') }
  }

  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  return { ok: true, filename, bytes: text.length, text }
}

function defaultExportFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `rent-roll-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

/**
 * Merge an exported file into the current state, by id.
 *
 * `input` may be a File/Blob, a JSON string, or an already-parsed object.
 * `currentState` is NOT mutated. Returns a Promise of
 *   { state, report, warnings }
 * where report counts added/updated/unchanged per entity type.
 *
 * Merge rules:
 *   * Entities are matched by id at every level (portfolio, property,
 *     floor, unit, bill, task, note, scenario and the buildings inside
 *     it), and payment records by their month key.
 *   * Matched: the incoming scalar fields win; nested lists are merged
 *     recursively. Fields the incoming item lacks are kept from the
 *     existing one.
 *   * Unmatched incoming entities are appended.
 *   * Existing entities missing from the file are KEPT. Nothing is ever
 *     removed by an import.
 *
 * Throws if the input is not valid JSON or not a recognizable export.
 */
export async function importJSON(input, currentState) {
  const parsed = await parseImportInput(input)
  const incomingRaw = coerceToStateShape(parsed)
  if (!incomingRaw) {
    throw new Error(
      'Import failed: file is not a Rent Roll export (expected an object with a "properties" array).',
    )
  }

  const incoming = migrate(incomingRaw)
  const base = migrate(currentState)
  const report = newReport()

  const properties = mergeById(
    base.state.properties,
    incoming.state.properties,
    (ex, inc) => mergeProperty(ex, inc, report),
    report.properties,
  )

  const portfolios = mergeById(
    base.state.portfolios,
    incoming.state.portfolios,
    mergePortfolio,
    report.portfolios,
  )

  // scenarios merge by id too, their buildings inside them; a scenario the
  // file does not mention is kept, like everything else
  const scenarios = mergeById(base.state.scenarios, incoming.state.scenarios, mergeScenario, report.scenarios)

  // withPortfolios keeps the invariants: an imported building that no
  // portfolio in the file claimed is adopted rather than left off the sheet.
  const state = withPortfolios({
    ...base.state,
    ...incoming.state,
    properties,
    portfolios,
    scenarios,
    version: SCHEMA_VERSION,
  })

  return {
    state,
    report,
    warnings: [...incoming.warnings, ...base.warnings],
  }
}

async function parseImportInput(input) {
  if (typeof input === 'string') return parseJSONOrThrow(input)
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return parseJSONOrThrow(await input.text())
  }
  return input
}

function parseJSONOrThrow(text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`Import failed: not valid JSON (${err?.message ?? err})`)
  }
}

/** Accept a full state object or a bare array of properties. */
function coerceToStateShape(v) {
  if (isPlausibleState(v)) return v
  if (Array.isArray(v)) return { properties: v }
  return null
}

function newReport() {
  const tally = () => ({ added: 0, updated: 0, unchanged: 0 })
  return {
    portfolios: tally(),
    properties: tally(),
    floors: tally(),
    units: tally(),
    bills: tally(),
    tasks: tally(),
    notes: tally(),
    payments: tally(),
    scenarios: tally(),
  }
}

function mergeById(existing, incoming, mergeItem, tally) {
  const out = asArray(existing).slice()
  for (const inc of asArray(incoming)) {
    const i = out.findIndex((x) => x.id === inc.id)
    if (i === -1) {
      out.push(inc)
      tally.added++
    } else {
      const merged = mergeItem(out[i], inc)
      if (JSON.stringify(merged) !== JSON.stringify(out[i])) tally.updated++
      else tally.unchanged++
      out[i] = merged
    }
  }
  return out
}

const mergeLeaf = (ex, inc) => ({ ...ex, ...inc })

/**
 * A matched portfolio takes the file's name and the union of both lists of
 * buildings — a building this sheet already had in it is never dropped
 * because the file did not mention it.
 */
function mergePortfolio(ex, inc) {
  const propertyIds = asIds([...(ex.propertyIds ?? []), ...(inc.propertyIds ?? [])])
  return { ...ex, ...inc, propertyIds }
}

/**
 * Payment records merge by key ('YYYY-MM' or 'YYYY-MM:B'): a matched month
 * takes the file's fields, a month only the file knows is added, and a
 * month only this sheet knows is kept. No record is ever dropped.
 */
function mergePayments(existing, incoming, tally) {
  const out = { ...(isObject(existing) ? existing : {}) }
  for (const [key, inc] of Object.entries(isObject(incoming) ? incoming : {})) {
    if (!isObject(inc)) continue
    if (!isObject(out[key])) {
      out[key] = inc
      tally.added++
    } else {
      const merged = { ...out[key], ...inc }
      if (JSON.stringify(merged) !== JSON.stringify(out[key])) tally.updated++
      else tally.unchanged++
      out[key] = merged
    }
  }
  return out
}

function mergeUnit(ex, inc, report) {
  return {
    ...ex,
    ...inc,
    payments: mergePayments(ex.payments, inc.payments, report.payments),
    bills: mergeById(ex.bills, inc.bills, mergeLeaf, report.bills),
    tasks: mergeById(ex.tasks, inc.tasks, mergeLeaf, report.tasks),
    notes: mergeById(ex.notes, inc.notes, mergeLeaf, report.notes),
  }
}

function mergeFloor(ex, inc, report) {
  return {
    ...ex,
    ...inc,
    units: mergeById(ex.units, inc.units, (a, b) => mergeUnit(a, b, report), report.units),
  }
}

function mergeProperty(ex, inc, report) {
  return {
    ...ex,
    ...inc,
    floors: mergeById(ex.floors, inc.floors, (a, b) => mergeFloor(a, b, report), report.floors),
    bills: mergeById(ex.bills, inc.bills, mergeLeaf, report.bills),
  }
}

/**
 * A matched scenario takes the file's name and note, and its buildings
 * merge by id inside it. Their counts go to a scratch report so the
 * notice's "buildings" and "units" stay about actual data.
 */
function mergeScenario(ex, inc) {
  const scratch = newReport()
  return {
    ...ex,
    ...inc,
    properties: mergeById(
      ex.properties,
      inc.properties,
      (a, b) => mergeProperty(a, b, scratch),
      scratch.properties,
    ),
  }
}

// ---------------------------------------------------------------------------
// storage access
// ---------------------------------------------------------------------------

function getStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    // Some browsers throw on access when storage is disabled.
  }
  return null
}
