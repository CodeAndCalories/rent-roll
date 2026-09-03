// Per-unit, per-month payment tracking: a v6 store migrating with nothing
// lost, untracked being distinct from unpaid, no write ever happening on
// its own, split halves tracking apart and surviving an unsplit, a record's
// amount outliving a rent change, month math at the year boundary in two
// timezones, the removal guards counting records, and payment history
// coming through save/load and export/import. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  SCHEMA_VERSION,
  isMonthKey,
  makePortfolio,
  makeState,
  normalizeState,
  parsePaymentKey,
  paymentKey,
} from '../src/data/schema.js'
import { STORAGE_KEY, importJSON, load, migrate, save, serialize } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  RuleError,
  addPortfolio,
  addSideAnnex,
  addUnit,
  clearPayment,
  cyclePayment,
  describeContents,
  describePortfolio,
  isEmptyUnit,
  moveProperty,
  patchUnit,
  removeProperty,
  removeUnit,
  renameFloor,
  setPayment,
  setSplittable,
  setUnitWidths,
  unitHoldings,
} from '../src/data/ops.js'
import { computeTotals } from '../src/data/totals.js'
import {
  countPayments,
  defaultAmountFor,
  expectedFor,
  halvesFor,
  isBarePayment,
  monthSummary,
  nextPaymentStatus,
  owedRentals,
  paymentEntries,
  paymentFor,
  paymentMarker,
  rentalMonth,
} from '../src/data/payments.js'
import {
  compareMonths,
  dayKey,
  lastMonths,
  monthKey,
  monthLabel,
  parseMonth,
  shiftMonth,
} from '../src/lib/months.js'

class FakeStorage {
  constructor() {
    this.m = new Map()
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null
  }
  setItem(k, v) {
    this.m.set(k, String(v))
  }
  removeItem(k) {
    this.m.delete(k)
  }
}
globalThis.localStorage = new FakeStorage()

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** A building with its first unit leased at `rent`. */
function building(name, rent) {
  const p = buildFromTemplate('duplex-stacked', name)
  p.floors[0].units[0].rent = rent
  p.floors[0].units[0].status = 'leased'
  p.floors[0].units[0].tenant = `${name} tenant`
  return p
}

const allUnits = (state) => state.properties.flatMap((p) => p.floors).flatMap((f) => f.units)
const unit = (state, id) => (id ? allUnits(state).find((u) => u.id === id) : allUnits(state)[0])

/** A store exactly as the v6 app wrote it: every field present, no payments anywhere. */
function v6Store() {
  const unitFields = {
    widthWeight: 1,
    tenant: '',
    leaseStart: null,
    leaseEnd: null,
    splittable: false,
    isSplit: false,
    splitRent: 0,
    sideOf: 'left',
    photoBox: null,
    bills: [],
    tasks: [],
    notes: [],
  }
  return {
    version: 6,
    updatedAt: '2026-09-01T12:00:00.000Z',
    portfolios: [{ id: 'home', name: 'Cleveland Heights', propertyIds: ['fairview', 'next-door'] }],
    properties: [
      {
        id: 'fairview',
        name: '2107 Fairview',
        address: '2107 Fairview, Cleveland Heights, OH',
        shape: 'mansard',
        photo: 'data:image/jpeg;base64,AAAA',
        photoSize: { w: 1200, h: 800 },
        view: 'photo',
        extra: 42,
        bills: [{ id: 'b1', label: 'Mortgage', amount: 2000, cadence: 'monthly', dueDay: 1, paid: true }],
        floors: [
          {
            id: 'f3',
            label: '3F',
            units: [
              {
                ...unitFields,
                id: 'u1',
                name: '3F Left',
                position: 'left',
                widthWeight: 1.7,
                rent: 1450,
                status: 'leased',
                tenant: 'A. Tenant',
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                photoBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
                mystery: 'keep me',
                bills: [{ id: 'ub1', label: 'Gas', amount: 60, cadence: 'monthly', dueDay: 15, paid: false }],
                tasks: [{ id: 't1', text: 'Fix faucet', done: false, createdAt: '2026-08-01T00:00:00.000Z' }],
                notes: [{ id: 'n1', text: 'Called about heat', createdAt: '2026-08-02T00:00:00.000Z' }],
              },
              { ...unitFields, id: 'u2', name: '3F Right', position: 'right', rent: 900, status: 'vacant' },
            ],
          },
          {
            id: 'fs',
            label: 'Street',
            units: [
              {
                ...unitFields,
                id: 'ds',
                name: 'Double single',
                position: 'full',
                rent: 900,
                status: 'leased',
                tenant: 'B. Tenant',
                leaseStart: '2026-03-01',
                leaseEnd: '2027-02-28',
                splittable: true,
                isSplit: true,
                splitRent: 850,
                photoBox: { x: 0.2, y: 0.6, w: 0.5, h: 0.3 },
              },
              {
                ...unitFields,
                id: 'sf',
                name: 'Storefront',
                position: 'side',
                rent: 1200,
                status: 'renovating',
                sideOf: 'right',
                photoBox: { x: 0.84, y: 0.7, w: 0.14, h: 0.2 },
              },
            ],
          },
        ],
      },
      {
        id: 'next-door',
        name: 'Next door',
        address: '',
        shape: 'gable',
        photo: null,
        photoSize: null,
        view: 'drawing',
        bills: [],
        floors: [
          {
            id: 'nf1',
            label: '1F',
            units: [{ ...unitFields, id: 'u3', name: 'Lower', position: 'full', rent: 800, status: 'leased', tenant: 'C' }],
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// migration
// ---------------------------------------------------------------------------

test('a v6 store migrates to v7: an empty payments object on every unit, nothing else touched', () => {
  localStorage.removeItem(STORAGE_KEY)
  const stored = v6Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 6)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 8)
  assert.equal(r.warnings.length, 0)

  const units = allUnits(r.state)
  assert.equal(units.length, 5)
  for (const u of units) assert.deepEqual(u.payments, {}, `${u.id} starts untracked everywhere`)

  // take the one new field off and the rest is exactly what was stored:
  // rents, bills, notes, list items, photos, box positions, widths, the
  // annex, the split, the unknown fields
  const stripped = JSON.parse(JSON.stringify(r.state.properties))
  for (const u of stripped.flatMap((p) => p.floors).flatMap((f) => f.units)) delete u.payments
  assert.deepEqual(stripped, stored.properties)
  assert.deepEqual(r.state.portfolios, stored.portfolios, 'portfolio membership')

  // a save and reload keep it, and migrating twice is migrating once
  assert.equal(save(r.state).ok, true)
  assert.deepEqual(load().state.properties, r.state.properties)
  const once = migrate(v6Store()).state
  assert.deepEqual(migrate(once).state, once)
})

test('records keep unknown fields and unreadable keys; entries list newest first, A before B', () => {
  const s = normalizeState({
    version: 7,
    properties: [
      {
        id: 'p',
        floors: [
          {
            id: 'f',
            units: [
              {
                id: 'u',
                rent: 1,
                payments: {
                  '2026-08': { status: 'paid', amount: 1, extra: 'kept' },
                  '2026-09:B': { status: 'late', amount: 2 }, // half comes from the key
                  '2026-09': { status: 'paid', amount: 3, half: 'B' }, // the key wins over a wrong half
                  oops: { status: 'paid' }, // an unreadable key is kept, not hidden
                  '2026-07': 'junk', // not a record at all
                },
              },
            ],
          },
        ],
      },
    ],
  })
  const u = s.properties[0].floors[0].units[0]
  assert.equal(u.payments['2026-08'].extra, 'kept')
  assert.equal(u.payments['2026-09:B'].half, 'B')
  assert.equal(u.payments['2026-09'].half, 'A')
  assert.ok(u.payments.oops)
  assert.equal('2026-07' in u.payments, false)
  assert.deepEqual(
    paymentEntries(u).map((e) => e.key),
    ['2026-09', '2026-09:B', '2026-08', 'oops'],
  )
  assert.deepEqual(normalizeState(s), s, 'normalizing again changes nothing')

  // keys
  assert.equal(paymentKey('2026-09'), '2026-09')
  assert.equal(paymentKey('2026-09', 'A'), '2026-09')
  assert.equal(paymentKey('2026-09', 'B'), '2026-09:B')
  assert.deepEqual(parsePaymentKey('2026-09'), { month: '2026-09', half: 'A' })
  assert.deepEqual(parsePaymentKey('2026-09:B'), { month: '2026-09', half: 'B' })
  assert.equal(parsePaymentKey('2026-13'), null)
  assert.equal(parsePaymentKey('oops'), null)
})

// ---------------------------------------------------------------------------
// untracked vs unpaid
// ---------------------------------------------------------------------------

test('untracked is not unpaid: no record, no marker, nothing outstanding — and the title block never moves', () => {
  let state = makeState({ properties: [building('A', 1200)] })
  const id = unit(state).id
  const m = '2026-09'
  const titleBlock = computeTotals(state.properties)

  // nothing has been said about September
  let u = unit(state)
  assert.equal(paymentFor(u, m), null)
  assert.equal(paymentMarker(u, m), null)
  assert.deepEqual(owedRentals(u, m), [])
  let s = monthSummary(state.properties, m)
  let row = s.rows.find((r) => r.unitId === id)
  assert.equal(row.status, 'untracked')
  assert.equal(row.record, null)
  assert.equal(row.expected, 1200, 'the lease still says what to expect')
  assert.equal(row.outstanding, 0, 'but nothing is owed on a month nobody tracked')
  assert.equal(s.expected, 1200)
  assert.equal(s.outstanding, 0)
  assert.equal(s.tracked, 0)
  assert.equal(s.untracked, 1)
  assert.equal(s.rows.length, 2, 'the vacant unit has a row too')
  assert.equal(s.rows[1].expected, 0, 'a vacant unit expects nothing')

  // explicitly unpaid is a different thing
  state = setPayment(state, id, m, 'A', { status: 'unpaid' })
  u = unit(state)
  assert.deepEqual(paymentFor(u, m), { half: 'A', status: 'unpaid', amount: 1200, paidOn: null, note: '' })
  assert.equal(paymentMarker(u, m), 'unpaid')
  s = monthSummary(state.properties, m)
  row = s.rows.find((r) => r.unitId === id)
  assert.equal(row.status, 'unpaid')
  assert.equal(row.outstanding, 1200)
  assert.equal(row.collected, 0)
  assert.equal(s.tracked, 1)
  assert.equal(s.untracked, 0)
  assert.equal(s.outstanding, 1200)

  // late marks too; paid, partial, and waived do not
  state = setPayment(state, id, m, 'A', { status: 'late' })
  assert.equal(paymentMarker(unit(state), m), 'late')
  state = setPayment(state, id, m, 'A', { status: 'paid', paidOn: '2026-09-03' })
  assert.equal(paymentMarker(unit(state), m), null)
  assert.equal(monthSummary(state.properties, m).collected, 1200)
  state = setPayment(state, id, m, 'A', { status: 'partial', amount: 500 })
  assert.equal(paymentMarker(unit(state), m), null)
  s = monthSummary(state.properties, m)
  assert.equal(s.collected, 500)
  assert.equal(s.outstanding, 700, 'the rest of a partial is owed')
  assert.equal(s.expected, 1200)
  state = setPayment(state, id, m, 'A', { status: 'waived', amount: 1200 })
  assert.equal(paymentMarker(unit(state), m), null)
  s = monthSummary(state.properties, m)
  assert.equal(s.waived, 1200)
  assert.equal(s.outstanding, 0)
  assert.equal(s.collected, 0)

  // the neighbouring month never heard about any of it
  assert.equal(paymentFor(unit(state), '2026-08'), null)
  assert.equal(paymentMarker(unit(state), '2026-08'), null)
  assert.equal(countPayments(unit(state)), 1)

  // and none of it changed a number in the title block
  assert.deepEqual(computeTotals(state.properties), titleBlock)

  // a partial on a unit that has since gone vacant is owed nothing more
  const vacant = patchUnit(setPayment(state, id, m, 'A', { status: 'partial', amount: 500 }), id, { status: 'vacant' })
  const rm = rentalMonth(unit(vacant), m, 'A')
  assert.equal(rm.expected, 500)
  assert.equal(rm.outstanding, 0)
})

// ---------------------------------------------------------------------------
// no implicit writes
// ---------------------------------------------------------------------------

test('nothing but setPayment / clearPayment ever writes a record', () => {
  let state = makeState({ properties: [building('A', 1200)] })
  const id = unit(state).id
  const pid = state.properties[0].id
  const floorId = state.properties[0].floors[0].id
  state = setPayment(state, id, '2026-08', 'A', { status: 'paid', paidOn: '2026-08-03', note: 'cash' })
  state = setPayment(state, id, '2026-09', 'A', { status: 'late' })
  const before = unit(state).payments
  const snapshot = JSON.stringify(before)
  assert.equal(countPayments(unit(state)), 2)

  const steps = [
    ['rent change', (s) => patchUnit(s, id, { rent: 1500 })],
    ['rename', (s) => patchUnit(s, id, { name: 'Renamed' })],
    ['split', (s) => patchUnit(s, id, { splittable: true, isSplit: true, splitRent: 700 })],
    ['unsplit', (s) => patchUnit(s, id, { isSplit: false })],
    ['splittable off', (s) => setSplittable(s, id, false)],
    ['status', (s) => patchUnit(s, id, { status: 'vacant' })],
    ['tenant', (s) => patchUnit(s, id, { tenant: 'New tenant' })],
    ['floor rename', (s) => renameFloor(s, pid, floorId, 'Ground')],
    ['unit added beside it (relayout)', (s) => addUnit(s, pid, floorId)],
    ['width drag', (s) => setUnitWidths(s, pid, floorId, { [id]: 2 })],
    ['annex added', (s) => addSideAnnex(s, pid, 'right')],
    [
      'moved to another portfolio',
      (s) => {
        const away = makePortfolio({ id: 'away', name: 'Away' })
        const moved = moveProperty(addPortfolio(s, away), pid, 'away')
        assert.equal(moved.properties, s.properties, 'a move touches only the id lists')
        assert.deepEqual(moved.portfolios.map((f) => f.propertyIds), [[], [pid]])
        return moved
      },
    ],
    ['a patch that names payments: null', (s) => patchUnit(s, id, { payments: null })],
    ['a patch that names payments: {}', (s) => patchUnit(s, id, { payments: {} })],
    ['a patch that smuggles a record', (s) => patchUnit(s, id, { payments: { '2026-10': { status: 'paid' } } })],
    ['a function patch', (s) => patchUnit(s, id, (u) => ({ notes: [...u.notes, { text: 'hi' }], payments: {} }))],
  ]
  for (const [what, step] of steps) {
    state = step(state)
    assert.equal(unit(state, id).payments, before, `${what}: the very same payments object`)
  }
  assert.equal(JSON.stringify(unit(state, id).payments), snapshot)
  assert.equal(unit(state, id).rent, 1500, 'the other edits did land')
  assert.equal(unit(state, id).name, 'Renamed')

  // looking at a later month creates nothing (no rollover, no backfill)
  const later = monthSummary(state.properties, '2026-12')
  assert.equal(later.rows.find((r) => r.unitId === id).status, 'untracked')
  assert.equal(countPayments(unit(state, id)), 2)
  // a new unit starts with no records at all, whatever its rent
  for (const u of allUnits(state)) if (u.id !== id) assert.deepEqual(u.payments, {})

  // a move to an unknown portfolio is refused; to the same one, a no-op
  assert.throws(() => moveProperty(state, pid, 'nope'), RuleError)
  assert.equal(moveProperty(state, pid, 'away'), state)
})

// ---------------------------------------------------------------------------
// split halves
// ---------------------------------------------------------------------------

test('a split unit tracks each half apart, and unsplitting keeps both halves', () => {
  let state = makeState({ properties: [building('A', 1000)] })
  const id = unit(state).id
  const m = '2026-09'
  state = patchUnit(state, id, { splittable: true, isSplit: true, splitRent: 800 })
  assert.deepEqual(halvesFor(unit(state), m), ['A', 'B'])

  state = setPayment(state, id, m, 'A', { status: 'paid' })
  state = setPayment(state, id, m, 'B', { status: 'late' })
  let u = unit(state)
  assert.deepEqual(Object.keys(u.payments).sort(), ['2026-09', '2026-09:B'])
  assert.equal(paymentFor(u, m, 'A').amount, 1000, 'A defaults to the first rent')
  assert.equal(paymentFor(u, m, 'A').half, 'A')
  assert.equal(paymentFor(u, m, 'B').amount, 800, 'B defaults to the second rent')
  assert.equal(paymentFor(u, m, 'B').half, 'B')
  assert.equal(paymentMarker(u, m), 'B late')

  let s = monthSummary(state.properties, m)
  const rows = s.rows.filter((r) => r.unitId === id)
  assert.deepEqual(
    rows.map((r) => [r.key, r.half, r.status, r.split]),
    [
      [`${id}:A`, 'A', 'paid', true],
      [`${id}:B`, 'B', 'late', true],
    ],
  )
  assert.equal(s.expected, 1800)
  assert.equal(s.collected, 1000)
  assert.equal(s.outstanding, 800)

  // both late: the marker names both halves
  state = setPayment(state, id, m, 'A', { status: 'unpaid' })
  assert.equal(paymentMarker(unit(state), m), 'A unpaid · B late')

  // unsplit: the history of both halves stays, and B's month still shows
  state = patchUnit(state, id, { isSplit: false })
  u = unit(state)
  assert.equal(countPayments(u), 2, 'both halves kept')
  assert.equal(paymentFor(u, m, 'B').status, 'late')
  assert.deepEqual(halvesFor(u, m), ['A', 'B'], 'the month with B history still shows B')
  assert.deepEqual(halvesFor(u, '2026-10'), ['A'], 'a month without does not')
  assert.equal(expectedFor(u, 'B'), 0, 'nothing more is expected from B')
  assert.equal(defaultAmountFor(u, 'B'), 800, 'but the stored second rent is still there')
  s = monthSummary(state.properties, m)
  assert.equal(s.rows.filter((r) => r.unitId === id).length, 2)
  assert.equal(s.outstanding, 1800)
  assert.equal(paymentMarker(u, m), 'A unpaid · B late')
  assert.equal(monthSummary(state.properties, '2026-10').rows.filter((r) => r.unitId === id).length, 1)

  // splittable off entirely, then split again: it is all still there
  state = setSplittable(state, id, false)
  assert.equal(countPayments(unit(state)), 2)
  state = patchUnit(state, id, { splittable: true, isSplit: true })
  assert.equal(paymentFor(unit(state), m, 'B').status, 'late')
  assert.equal(paymentFor(unit(state), m, 'A').status, 'unpaid')
})

// ---------------------------------------------------------------------------
// amount history
// ---------------------------------------------------------------------------

test('a record keeps the rent it was marked at; a later rent change never rewrites it', () => {
  let state = makeState({ properties: [building('A', 1200)] })
  const id = unit(state).id

  state = setPayment(state, id, '2026-08', 'A', { status: 'paid' })
  assert.equal(paymentFor(unit(state), '2026-08').amount, 1200)
  state = patchUnit(state, id, { rent: 1300 })
  assert.equal(paymentFor(unit(state), '2026-08').amount, 1200, 'August is history')
  state = setPayment(state, id, '2026-09', 'A', { status: 'paid' })
  assert.equal(paymentFor(unit(state), '2026-09').amount, 1300, 'September takes the rent of its day')
  assert.equal(rentalMonth(unit(state), '2026-08', 'A').expected, 1200)
  assert.equal(rentalMonth(unit(state), '2026-09', 'A').expected, 1300)

  // an explicit amount wins, and a status change keeps it
  state = setPayment(state, id, '2026-10', 'A', { status: 'partial', amount: 500 })
  assert.equal(paymentFor(unit(state), '2026-10').amount, 500)
  const rm = rentalMonth(unit(state), '2026-10', 'A')
  assert.equal(rm.expected, 1300, 'a partial is due the lease rent')
  assert.equal(rm.outstanding, 800)
  state = setPayment(state, id, '2026-10', 'A', { status: 'paid' })
  assert.equal(paymentFor(unit(state), '2026-10').amount, 500, 'a status change keeps the amount')
  state = setPayment(state, id, '2026-10', 'A', { amount: undefined, note: 'n' })
  assert.equal(paymentFor(unit(state), '2026-10').amount, 500, 'an undefined field is not a zero')
  assert.equal(paymentFor(unit(state), '2026-10').note, 'n')

  // editing a month long past is allowed, no ceremony
  state = setPayment(state, id, '2024-01', 'A', { status: 'waived', note: 'move-in month' })
  assert.equal(paymentFor(unit(state), '2024-01').note, 'move-in month')

  // a write that changes nothing is the same state
  const same = setPayment(state, id, '2026-08', 'A', { status: 'paid' })
  assert.equal(same, state)
  assert.equal(setPayment(state, id, '2026-08', 'A', {}), state)

  // bad input is refused, and an unknown unit is a no-op
  assert.throws(() => setPayment(state, id, '2026-13', 'A', { status: 'paid' }), RuleError)
  assert.throws(() => setPayment(state, id, '2026-9', 'A', { status: 'paid' }), /not a month/)
  assert.throws(() => setPayment(state, id, '2026-09', 'C', { status: 'paid' }), /not a half/)
  assert.throws(() => setPayment(state, id, '2026-09', 'A', { status: 'maybe' }), /not a payment status/)
  assert.equal(setPayment(state, 'nope', '2026-09', 'A', { status: 'paid' }), state)
  assert.equal(countPayments(unit(state)), 4, 'none of the refused writes left anything behind')
})

test('the tap cycle: paid, partial, late, unpaid, waived, then untracked — unless something was typed', () => {
  let state = makeState({ properties: [building('A', 1200)] })
  const id = unit(state).id
  const m = '2026-09'

  assert.equal(nextPaymentStatus(unit(state), m, 'A'), 'paid', 'a first tap says paid')
  const seen = []
  for (let i = 0; i < 6; i++) {
    state = cyclePayment(state, id, m)
    seen.push(paymentFor(unit(state), m)?.status ?? null)
  }
  assert.deepEqual(seen, ['paid', 'partial', 'late', 'unpaid', 'waived', null])
  assert.equal(countPayments(unit(state)), 0, 'a record nothing was typed into goes back to untracked')

  // with a note the cycle wraps to paid, and the note stays
  state = setPayment(state, id, m, 'A', { status: 'waived', note: 'forgiven' })
  assert.equal(isBarePayment(unit(state), m, 'A'), false)
  state = cyclePayment(state, id, m)
  assert.equal(paymentFor(unit(state), m).status, 'paid')
  assert.equal(paymentFor(unit(state), m).note, 'forgiven')

  // an amount of its own counts as typed, so does a date
  state = setPayment(state, id, m, 'A', { status: 'waived', note: '', amount: 600 })
  assert.equal(isBarePayment(unit(state), m, 'A'), false)
  state = cyclePayment(state, id, m)
  assert.equal(paymentFor(unit(state), m).amount, 600)
  state = setPayment(state, id, m, 'A', { status: 'waived', amount: 1200, paidOn: '2026-09-02' })
  assert.equal(isBarePayment(unit(state), m, 'A'), false)
  state = setPayment(state, id, m, 'A', { paidOn: null })
  assert.equal(isBarePayment(unit(state), m, 'A'), true)

  // clearPayment is the explicit way out; on an untracked month it is a no-op
  state = clearPayment(state, id, m)
  assert.equal(countPayments(unit(state)), 0)
  assert.equal(clearPayment(state, id, m), state)
  assert.equal(cyclePayment(state, 'nope', m), state)
})

// ---------------------------------------------------------------------------
// month math
// ---------------------------------------------------------------------------

test('month math is local and integer: the year boundary, shifting, labels', () => {
  assert.equal(monthKey(new Date(2026, 0, 1, 0, 0, 1)), '2026-01')
  assert.equal(monthKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12')
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01')
  assert.equal(dayKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31')
  assert.match(monthKey(), /^\d{4}-\d{2}$/)

  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-03', -15), '2024-12')
  assert.equal(shiftMonth('2026-03', 22), '2028-01')
  assert.equal(shiftMonth('2026-03', 0), '2026-03')
  assert.equal(shiftMonth('junk', 1), null)
  assert.deepEqual(lastMonths(3, '2026-01'), ['2026-01', '2025-12', '2025-11'])
  assert.equal(lastMonths(12, '2026-09').length, 12)
  assert.equal(lastMonths(12, '2026-09').at(-1), '2025-10')

  assert.deepEqual(parseMonth('2026-09'), { year: 2026, month: 9 })
  assert.equal(parseMonth('2026-13'), null)
  assert.equal(parseMonth('2026-9'), null)
  assert.equal(parseMonth('2026-09-01'), null)
  assert.equal(isMonthKey('2026-09'), true)
  assert.equal(isMonthKey('2026-00'), false)
  assert.equal(isMonthKey('2026-09:B'), false)
  assert.equal(isMonthKey(202609), false)

  assert.equal(monthLabel('2026-09'), 'Sep 2026')
  assert.equal(monthLabel('2026-09', { long: true }), 'September 2026')
  assert.equal(monthLabel('junk'), 'junk')
  assert.equal(compareMonths('2025-12', '2026-01'), -1)
  assert.equal(compareMonths('2026-01', '2026-01'), 0)
  assert.deepEqual(['2026-02', '2025-12', '2026-01'].sort(compareMonths), ['2025-12', '2026-01', '2026-02'])
})

test('the month key never slips across a timezone: west of UTC on the 31st, east of UTC on the 1st', () => {
  const lib = new URL('../src/lib/months.js', import.meta.url).href
  const run = (tz, [y, mo, d, h, min]) => {
    // TZ goes on before any Date exists in the child, so the clock is that zone's
    const script = [
      `process.env.TZ = ${JSON.stringify(tz)}`,
      `const { monthKey, dayKey } = await import(${JSON.stringify(lib)})`,
      `const d = new Date(${y}, ${mo - 1}, ${d}, ${h}, ${min})`,
      `console.log(JSON.stringify({ local: monthKey(d), day: dayKey(d), utc: d.toISOString().slice(0, 7), offset: d.getTimezoneOffset() }))`,
    ].join('\n')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    return JSON.parse(out.trim())
  }

  // Los Angeles, 10pm on New Year's Eve: still December here, already January in UTC
  const la = run('America/Los_Angeles', [2026, 12, 31, 22, 0])
  assert.equal(la.offset, 480, 'the child really is west of UTC')
  assert.equal(la.local, '2026-12')
  assert.equal(la.day, '2026-12-31')
  assert.equal(la.utc, '2027-01', 'a UTC-derived key would already be wrong')

  // and half past midnight on the 1st is the new month, nowhere else
  const la1 = run('America/Los_Angeles', [2026, 1, 1, 0, 30])
  assert.equal(la1.local, '2026-01')
  assert.equal(la1.day, '2026-01-01')

  // Tokyo, half past midnight on the 1st: the new month here, the old one in UTC
  const tokyo = run('Asia/Tokyo', [2026, 9, 1, 0, 30])
  assert.equal(tokyo.offset, -540, 'the child really is east of UTC')
  assert.equal(tokyo.local, '2026-09')
  assert.equal(tokyo.day, '2026-09-01')
  assert.equal(tokyo.utc, '2026-08', 'a UTC-derived key would put the payment in August')
})

// ---------------------------------------------------------------------------
// removal guards
// ---------------------------------------------------------------------------

test('a unit holding payment records is not empty; the refusal names the count', () => {
  let state = makeState({ properties: [buildFromTemplate('duplex-side', 'Pair')] })
  const pid = state.properties[0].id
  const [left, right] = state.properties[0].floors[0].units
  assert.equal(isEmptyUnit(left), true)
  assert.deepEqual(unitHoldings(left), [])

  // rent is still 0, so the record is the only thing on the unit
  state = setPayment(state, left.id, '2026-09', 'A', { status: 'paid' })
  const l = unit(state, left.id)
  assert.equal(l.rent, 0)
  assert.equal(isEmptyUnit(l), false)
  assert.deepEqual(unitHoldings(l), ['1 payment record'])
  assert.throws(() => removeUnit(state, left.id), RuleError)
  assert.throws(() => removeUnit(state, left.id), /Left has 1 payment record\. Clear it in the unit panel first\./)

  state = setPayment(state, left.id, '2026-08', 'A', { status: 'late' })
  state = setPayment(state, left.id, '2026-07', 'A', { status: 'waived' })
  assert.throws(() => removeUnit(state, left.id), /has 3 payment records\./)
  assert.equal(state.properties[0].floors[0].units.length, 2, 'the refused removal changed nothing')

  // with rent on it too, both are named
  state = patchUnit(state, left.id, { rent: 900 })
  assert.throws(() => removeUnit(state, left.id), /has rent and 3 payment records\./)
  state = patchUnit(state, left.id, { tenant: 'T' })
  assert.throws(() => removeUnit(state, left.id), /has rent, a tenant, and 3 payment records\./)

  // removing the building or its portfolio names them as well
  const d = describeContents(state.properties[0])
  assert.equal(d.payments, 3)
  assert.equal(d.holdsData, true)
  assert.match(d.text, /3 payment records/)
  assert.throws(() => removeProperty(state, pid), RuleError)
  const dp = describePortfolio(state, state.portfolios[0].id)
  assert.equal(dp.payments, 3)
  assert.match(dp.text, /3 payment records/)

  // one record reads as one
  const one = makeState({ properties: [buildFromTemplate('single', 'Solo')] })
  const solo = setPayment(one, unit(one).id, '2026-09', 'A', { status: 'paid' })
  assert.match(describeContents(solo.properties[0]).text, /1 payment record\./)

  // cleared explicitly, the unit is empty again and may go; its neighbour always could
  state = patchUnit(state, left.id, { rent: 0, tenant: '' })
  for (const m of ['2026-07', '2026-08', '2026-09']) state = clearPayment(state, left.id, m)
  assert.equal(isEmptyUnit(unit(state, left.id)), true)
  assert.equal(removeUnit(state, left.id).properties[0].floors[0].units.length, 1)
  assert.equal(removeUnit(state, right.id).properties[0].floors[0].units.length, 1)
})

// ---------------------------------------------------------------------------
// round trips
// ---------------------------------------------------------------------------

test('payment history survives save/load and export/import, and an import never drops a record', async () => {
  localStorage.removeItem(STORAGE_KEY)
  let state = makeState({ properties: [building('A', 1000), building('B', 2000)] })
  const [a, b] = state.properties.map((p) => p.floors[0].units[0])
  state = patchUnit(state, a.id, { splittable: true, isSplit: true, splitRent: 800 })
  state = setPayment(state, a.id, '2026-07', 'A', { status: 'paid', paidOn: '2026-07-02', note: 'check #1' })
  state = setPayment(state, a.id, '2026-07', 'B', { status: 'partial', amount: 400, note: 'half' })
  state = setPayment(state, a.id, '2026-08', 'A', { status: 'late' })
  state = setPayment(state, b.id, '2026-08', 'A', { status: 'waived', note: 'repairs' })
  const history = (s) => Object.fromEntries(allUnits(s).map((u) => [u.id, u.payments]))
  const expected = history(state)
  assert.equal(Object.values(expected).reduce((n, p) => n + Object.keys(p).length, 0), 4)

  // storage
  assert.equal(save(state).ok, true)
  const back = load()
  assert.equal(back.from, SCHEMA_VERSION)
  assert.deepEqual(history(back.state), expected)
  assert.deepEqual(
    Object.keys(paymentFor(unit(back.state, a.id), '2026-07')).sort(),
    ['amount', 'half', 'note', 'paidOn', 'status'],
    'the stored record is exactly the documented shape',
  )

  // export, then import into an empty sheet
  const text = serialize(state)
  assert.equal(JSON.parse(text).version, SCHEMA_VERSION)
  const r1 = await importJSON(text, makeState({}))
  assert.deepEqual(history(r1.state), expected)
  assert.equal(r1.report.properties.added, 2, 'whole buildings arrive, records inside them')
  assert.equal(r1.report.payments.updated, 0)

  // import into itself: nothing changes
  const r2 = await importJSON(text, state)
  assert.deepEqual(history(r2.state), expected)
  assert.deepEqual(r2.report.payments, { added: 0, updated: 0, unchanged: 4 })

  // a file with one more month and one edited note, against a sheet that
  // has since tracked a month of its own: the union, nothing lost
  const file = JSON.parse(text)
  const fileA = file.properties[0].floors[0].units[0]
  fileA.payments['2026-09'] = { half: 'A', status: 'paid', amount: 1000, paidOn: null, note: '' }
  fileA.payments['2026-07'].note = 'check #1 (cleared)'
  const local = setPayment(state, a.id, '2026-10', 'A', { status: 'unpaid' })
  const r3 = await importJSON(file, local)
  const ua = unit(r3.state, a.id)
  assert.deepEqual(
    Object.keys(ua.payments).sort(),
    ['2026-07', '2026-07:B', '2026-08', '2026-09', '2026-10'],
  )
  assert.equal(paymentFor(ua, '2026-07').note, 'check #1 (cleared)', 'the file updated the note')
  assert.equal(paymentFor(ua, '2026-07').paidOn, '2026-07-02', 'and kept the date it did not mention')
  assert.equal(paymentFor(ua, '2026-07', 'B').amount, 400)
  assert.equal(paymentFor(ua, '2026-10').status, 'unpaid', 'the month only this sheet knew is kept')
  assert.equal(paymentFor(unit(r3.state, b.id), '2026-08').note, 'repairs')
  assert.equal(r3.report.payments.added, 1)
  assert.equal(r3.report.payments.updated, 1)
  assert.equal(r3.report.payments.unchanged, 3, "A's July B half, A's August, and B's August")
})
