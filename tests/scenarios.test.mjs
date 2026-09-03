// Scenarios: a fork is an independent copy with fresh ids and nothing
// factual in it; a write aimed at a scenario leaves actual data the very
// same objects, and a write to actual leaves every scenario the same; a
// unit added inside a scenario never shows up in actual; the compare
// table is each source's own totals; deleting a portfolio takes its
// scenarios; the cap; and scenarios through save/load and export/import.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA_VERSION,
  makeBill,
  makeNote,
  makePortfolio,
  makeState,
  makeTask,
  normalizeState,
} from '../src/data/schema.js'
import { STORAGE_KEY, importJSON, load, migrate, save, serialize } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  ACTUAL,
  RuleError,
  addFloor,
  addPortfolio,
  addProperty,
  addScenario,
  addSideAnnex,
  addUnit,
  applyTo,
  countUnits,
  describePortfolio,
  describeScenario,
  locateUnit,
  moveProperty,
  patchProperty,
  patchScenario,
  patchUnit,
  removeProperty,
  removePortfolio,
  removeScenario,
  removeUnit,
  renamePortfolio,
  scenarioTarget,
  setPayment,
  setUnitWidths,
} from '../src/data/ops.js'
import { computeTotals } from '../src/data/totals.js'
import { propertiesOf } from '../src/lib/portfolios.js'
import {
  COMPARE_ROWS,
  SCENARIO_CAP,
  compareTable,
  countScenario,
  forkScenario,
  scenarioById,
  scenarioView,
  scenariosOf,
} from '../src/data/scenarios.js'

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

const unitsOf = (properties) => properties.flatMap((p) => p.floors).flatMap((f) => f.units)
const idsOf = (properties) =>
  new Set([
    ...properties.map((p) => p.id),
    ...properties.flatMap((p) => p.bills.map((b) => b.id)),
    ...properties.flatMap((p) => p.floors.map((f) => f.id)),
    ...unitsOf(properties).map((u) => u.id),
    ...unitsOf(properties).flatMap((u) => u.bills.map((b) => b.id)),
  ])
const actualJSON = (state) => JSON.stringify({ properties: state.properties, portfolios: state.portfolios })

/**
 * A portfolio worth copying: two buildings with rents, statuses, a width,
 * a split, building and unit bills, a roof — and the facts that must NOT
 * come along: a photo, payment records, tenants, lease dates, a list
 * item, a note.
 */
function realSheet() {
  let state = makeState({
    properties: [buildFromTemplate('fourplex', 'Corner'), buildFromTemplate('duplex-stacked', 'Next door')],
  })
  const [corner, next] = state.properties
  const [a, b, c, d] = unitsOf([corner])
  const [e] = unitsOf([next])
  state = patchUnit(state, a.id, {
    rent: 1200,
    status: 'leased',
    tenant: 'A. Tenant',
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    widthWeight: 1.6,
  })
  state = patchUnit(state, b.id, { rent: 900, splitRent: 700, splittable: true, isSplit: true, status: 'leased', tenant: 'B' })
  state = patchUnit(state, c.id, { rent: 800, status: 'vacant' })
  state = patchUnit(state, d.id, { rent: 1000, status: 'renovating' })
  state = patchUnit(state, e.id, { rent: 1500, status: 'leased', tenant: 'E' })
  state = patchUnit(state, a.id, (u) => ({
    bills: [...u.bills, makeBill({ label: 'Gas', amount: 60 })],
    tasks: [...u.tasks, makeTask({ text: 'Fix the door' })],
    notes: [...u.notes, makeNote({ text: 'Painted' })],
  }))
  state = patchProperty(state, corner.id, (p) => ({
    shape: 'mansard',
    photo: 'data:image/jpeg;base64,AAAA',
    photoSize: { w: 10, h: 5 },
    view: 'photo',
    bills: p.bills.map((bill, i) => (i === 0 ? { ...bill, amount: 2000 } : bill)),
  }))
  state = setPayment(state, a.id, '2026-08', 'A', { status: 'paid', note: 'cash' })
  state = setPayment(state, b.id, '2026-08', 'B', { status: 'late' })
  return state
}

const home = (state) => state.portfolios[0]

// ---------------------------------------------------------------------------

test('forking copies the portfolio whole, with fresh ids, and nothing factual comes along', () => {
  const state = realSheet()
  const actual = propertiesOf(state, home(state).id)
  const s = forkScenario(state, home(state).id, { name: 'Plan A', note: 'raise everything' })
  const next = addScenario(state, s)

  // actual data is the very same objects; the scenario sits beside it
  assert.equal(next.properties, state.properties)
  assert.equal(next.portfolios, state.portfolios)
  assert.equal(next.scenarios.length, 1)
  assert.equal(scenarioById(next, s.id), s)
  assert.equal(s.portfolioId, home(state).id)
  assert.equal(s.name, 'Plan A')
  assert.equal(s.note, 'raise everything')
  assert.ok(s.createdAt)
  assert.deepEqual(countScenario(s), { buildings: 2, units: 6 })
  assert.deepEqual(scenariosOf(next, home(state).id), [s])

  // whole: structure, rents, statuses, widths, splits, roof, bills
  assert.deepEqual(
    s.properties.map((p) => [p.name, p.shape, p.floors.length]),
    actual.map((p) => [p.name, p.shape, p.floors.length]),
  )
  const su = unitsOf(s.properties)
  const au = unitsOf(actual)
  assert.equal(su.length, 6)
  assert.deepEqual(
    su.map((u) => [u.name, u.position, u.rent, u.splitRent, u.splittable, u.isSplit, u.status, u.widthWeight, u.sideOf]),
    au.map((u) => [u.name, u.position, u.rent, u.splitRent, u.splittable, u.isSplit, u.status, u.widthWeight, u.sideOf]),
  )
  assert.deepEqual(
    s.properties[0].bills.map((b) => [b.label, b.amount]),
    actual[0].bills.map((b) => [b.label, b.amount]),
  )
  assert.deepEqual(su[0].bills.map((b) => [b.label, b.amount]), [['Gas', 60]])
  assert.deepEqual(computeTotals(s.properties), computeTotals(actual), 'the copy adds up to the same numbers')

  // fresh ids at every level: nothing in the scenario can name anything in actual
  const mine = idsOf(s.properties)
  const theirs = idsOf(actual)
  assert.ok(mine.size > 10)
  for (const id of mine) assert.equal(theirs.has(id), false, `${id} is not an actual id`)

  // nothing factual: no photo, no payments, no tenant, no lease dates, no list items, no notes
  for (const p of s.properties) {
    assert.equal(p.photo, null)
    assert.equal(p.photoSize, null)
    assert.equal(p.view, 'drawing')
  }
  for (const u of su) {
    assert.deepEqual(u.payments, {})
    assert.equal(u.tenant, '')
    assert.equal(u.leaseStart, null)
    assert.equal(u.leaseEnd, null)
    assert.deepEqual(u.tasks, [])
    assert.deepEqual(u.notes, [])
  }
  // while actual still has all of it
  assert.equal(actual[0].photo, 'data:image/jpeg;base64,AAAA')
  assert.equal(au[0].tenant, 'A. Tenant')
  assert.equal(Object.keys(au[0].payments).length, 1)
  assert.equal(au[0].notes.length, 1)

  // an unknown portfolio forks nothing
  assert.equal(forkScenario(state, 'nope', { name: 'x' }), null)
})

test('editing a scenario leaves actual data the very same objects, and cannot reach portfolios or other scenarios', () => {
  let state = realSheet()
  const planA = forkScenario(state, home(state).id, { name: 'Plan A' })
  const planB = forkScenario(state, home(state).id, { name: 'Plan B' })
  state = addScenario(addScenario(state, planA), planB)
  const before = actualJSON(state)
  const properties = state.properties
  const portfolios = state.portfolios
  const target = scenarioTarget(planA.id)

  const p0 = () => scenarioById(state, planA.id).properties[0]
  const u0 = () => unitsOf([p0()])[0]
  const steps = [
    ['rent', (s) => patchUnit(s, u0().id, { rent: 9999 })],
    ['status', (s) => patchUnit(s, unitsOf([p0()])[2].id, { status: 'leased' })],
    ['roof', (s) => patchProperty(s, p0().id, { shape: 'flat' })],
    ['floor added', (s) => addFloor(s, p0().id)],
    ['unit added', (s) => addUnit(s, p0().id, p0().floors[1].id)],
    ['width', (s) => setUnitWidths(s, p0().id, p0().floors[1].id, { [unitsOf([p0()])[1].id]: 3 })],
    ['annex', (s) => addSideAnnex(s, p0().id, 'right')],
    ['unit bill', (s) => patchUnit(s, u0().id, (u) => ({ bills: [...u.bills, { label: 'Water', amount: 40 }] }))],
    ['building bill', (s) => patchProperty(s, p0().id, (p) => ({ bills: p.bills.map((b) => ({ ...b, amount: 1 })) }))],
    ['split', (s) => patchUnit(s, u0().id, { splittable: true, isSplit: true, splitRent: 500 })],
    ['unsplit', (s) => patchUnit(s, u0().id, { isSplit: false })],
    ['empty unit removed', (s) => removeUnit(s, p0().floors[1].units.at(-1).id)],
    ['building added', (s) => addProperty(s, buildFromTemplate('single', 'Extra'), planA.portfolioId)],
    ['building removed', (s) => removeProperty(s, scenarioById(state, planA.id).properties[1].id, { force: true })],
  ]
  for (const [what, fn] of steps) {
    state = applyTo(state, target, fn)
    assert.equal(state.properties, properties, `${what}: actual buildings untouched`)
    assert.equal(state.portfolios, portfolios, `${what}: portfolios untouched`)
    assert.equal(scenarioById(state, planB.id), planB, `${what}: the other scenario untouched`)
  }
  assert.equal(actualJSON(state), before, 'byte-identical after every edit')

  // and the scenario did change
  const edited = scenarioById(state, planA.id)
  assert.equal(edited.name, 'Plan A')
  assert.equal(edited.properties.length, 2, 'one removed, one added')
  assert.equal(edited.properties[1].name, 'Extra')
  assert.equal(p0().shape, 'flat')
  assert.equal(p0().floors.length, 3, 'a floor on top')
  assert.equal(p0().floors[0].label, '3F')
  assert.equal(unitsOf([p0()]).some((u) => u.rent === 9999), true)
  assert.equal(unitsOf([p0()]).some((u) => u.position === 'side'), true)
  assert.equal(p0().bills.every((b) => b.amount === 1), true)

  // a write aimed at a scenario that is gone is refused, never sent to actual
  let called = false
  assert.throws(
    () =>
      applyTo(state, scenarioTarget('nope'), (s) => {
        called = true
        return s
      }),
    RuleError,
  )
  assert.throws(() => applyTo(state, scenarioTarget('nope'), (s) => s), /no longer exists/)
  assert.equal(called, false, 'the write never ran')
  assert.throws(() => applyTo(state, { kind: 'elsewhere' }, (s) => s), /Unknown write target/)

  // ACTUAL is a plain pass-through; a no-op on a scenario is the same state
  const marker = { ...state, marker: true }
  assert.equal(applyTo(state, ACTUAL, () => marker), marker)
  assert.equal(applyTo(state, target, (s) => s), state)

  // a RuleError inside the write propagates and changes nothing
  const guarded = state
  assert.throws(() => applyTo(guarded, target, (s) => addSideAnnex(s, p0().id)), /already has a side annex/)
  assert.equal(actualJSON(guarded), before)
})

test('editing actual data leaves a scenario the very same object', () => {
  let state = realSheet()
  const plan = forkScenario(state, home(state).id, { name: 'Plan' })
  state = addScenario(state, plan)
  const before = JSON.stringify(plan)
  const [corner, next] = state.properties
  const a = unitsOf([corner])[0]

  const away = makePortfolio({ id: 'away', name: 'Away' })
  const steps = [
    ['rent', (s) => patchUnit(s, a.id, { rent: 1300 })],
    ['unit added', (s) => addUnit(s, corner.id, corner.floors[0].id)],
    ['floor added', (s) => addFloor(s, corner.id)],
    ['photo', (s) => patchProperty(s, corner.id, { photo: 'data:image/jpeg;base64,CCCC' })],
    ['payment', (s) => setPayment(s, a.id, '2026-09', 'A', { status: 'unpaid' })],
    ['tenant', (s) => patchUnit(s, a.id, { tenant: 'New', leaseEnd: '2027-06-30' })],
    ['building removed', (s) => removeProperty(s, next.id, { force: true })],
    ['portfolio renamed', (s) => renamePortfolio(s, home(s).id, 'Cleveland Heights')],
    ['portfolio added', (s) => addPortfolio(s, away)],
    ['building moved', (s) => moveProperty(s, corner.id, 'away')],
  ]
  for (const [what, fn] of steps) {
    state = applyTo(state, ACTUAL, fn)
    assert.equal(scenarioById(state, plan.id), plan, `${what}: the scenario is the same object`)
  }
  assert.equal(JSON.stringify(scenarioById(state, plan.id)), before, 'byte-identical')
  assert.equal(scenarioById(state, plan.id).portfolioId, home(state).id, 'it still belongs to its portfolio')
  assert.equal(unitsOf(plan.properties)[0].rent, 1200, 'the snapshot rent, not the new one')
})

test('payments and photos never enter a scenario, even through a write aimed at it', () => {
  let state = realSheet()
  const plan = forkScenario(state, home(state).id, { name: 'Plan' })
  state = addScenario(state, plan)
  const target = scenarioTarget(plan.id)
  const sp = plan.properties[0]
  const su = unitsOf([sp])[0]
  const before = actualJSON(state)

  state = applyTo(state, target, (s) => setPayment(s, su.id, '2026-09', 'A', { status: 'paid', note: 'x' }))
  state = applyTo(state, target, (s) => patchProperty(s, sp.id, { photo: 'data:image/jpeg;base64,BBBB', photoSize: { w: 1, h: 1 }, view: 'photo' }))
  state = applyTo(state, target, (s) => patchUnit(s, su.id, { tenant: 'Ghost', leaseStart: '2027-01-01', leaseEnd: '2027-12-31' }))
  state = applyTo(state, target, (s) =>
    patchUnit(s, su.id, (u) => ({ tasks: [...u.tasks, { text: 'no' }], notes: [...u.notes, { text: 'no' }] })),
  )

  const after = scenarioById(state, plan.id)
  const p = after.properties[0]
  const u = unitsOf([p])[0]
  assert.deepEqual(u.payments, {}, 'no record was stored')
  assert.equal(p.photo, null)
  assert.equal(p.photoSize, null)
  assert.equal(p.view, 'drawing')
  assert.equal(u.tenant, '')
  assert.equal(u.leaseStart, null)
  assert.equal(u.leaseEnd, null)
  assert.deepEqual(u.tasks, [])
  assert.deepEqual(u.notes, [])
  assert.equal(actualJSON(state), before, 'and none of it went to actual either')
  assert.equal(Object.keys(unitsOf(state.properties)[0].payments).length, 1, "actual's own record is still its own")

  // a hand-edited file that puts facts inside a scenario loses them on load
  const dirty = JSON.parse(serialize(state))
  dirty.scenarios[0].properties[0].photo = 'data:image/jpeg;base64,DDDD'
  dirty.scenarios[0].properties[0].floors[0].units[0].payments = { '2026-01': { status: 'paid', amount: 5 } }
  dirty.scenarios[0].properties[0].floors[0].units[0].tenant = 'Smuggled'
  const clean = normalizeState(dirty)
  assert.equal(clean.scenarios[0].properties[0].photo, null)
  assert.deepEqual(unitsOf(clean.scenarios[0].properties)[0].payments, {})
  assert.equal(unitsOf(clean.scenarios[0].properties)[0].tenant, '')
  assert.equal(unitsOf(clean.properties)[0].tenant, 'A. Tenant', 'actual keeps its facts')
})

test('a unit added inside a scenario never appears in actual', () => {
  let state = realSheet()
  const plan = forkScenario(state, home(state).id, { name: 'Plan' })
  state = addScenario(state, plan)
  const actualUnits = countUnits(state.properties[0])
  const sp = () => scenarioById(state, plan.id).properties[0]

  state = applyTo(state, scenarioTarget(plan.id), (s) => addUnit(s, sp().id, sp().floors[0].id))
  assert.equal(countUnits(sp()), 5, 'the scenario building grew')
  assert.equal(countUnits(state.properties[0]), actualUnits, 'the actual building did not')
  const added = sp().floors[0].units.at(-1)
  assert.equal(locateUnit(state, added.id), null, 'and actual cannot even find the new unit')
  assert.ok(locateUnit(scenarioView(state, scenarioById(state, plan.id)), added.id), 'the scenario can')

  // its id is a scenario id: aimed at actual by mistake it lands nowhere
  const stray = applyTo(state, ACTUAL, (s) => patchUnit(s, added.id, { rent: 123 }))
  assert.equal(stray, state)
})

test("the compare table is each source's own totals, with better in amber and worse in alert", () => {
  let state = realSheet()
  const raise = forkScenario(state, home(state).id, { name: 'Raise' })
  const bigger = forkScenario(state, home(state).id, { name: 'Bigger' })
  state = addScenario(addScenario(state, raise), bigger)
  // Raise: every leased rent up, and a fatter mortgage
  state = applyTo(state, scenarioTarget(raise.id), (s) => {
    let v = s
    for (const u of unitsOf(v.properties)) if (u.status === 'leased') v = patchUnit(v, u.id, { rent: u.rent + 100 })
    return patchProperty(v, v.properties[0].id, (p) => ({ bills: p.bills.map((b, i) => (i === 0 ? { ...b, amount: 3000 } : b)) }))
  })
  // Bigger: one more vacant unit, nothing else
  state = applyTo(state, scenarioTarget(bigger.id), (s) => addUnit(s, s.properties[1].id, s.properties[1].floors[0].id))

  const actual = propertiesOf(state, home(state).id)
  const scenarios = scenariosOf(state, home(state).id)
  const t = compareTable(actual, scenarios)

  assert.deepEqual(
    t.columns.map((c) => [c.id, c.name, c.actual]),
    [
      ['actual', 'Actual', true],
      [raise.id, 'Raise', false],
      [bigger.id, 'Bigger', false],
    ],
  )
  assert.deepEqual(t.columns[0].totals, computeTotals(actual))
  assert.deepEqual(t.columns[1].totals, computeTotals(scenarios[0].properties))
  assert.deepEqual(t.columns[2].totals, computeTotals(scenarios[1].properties))
  assert.deepEqual(
    t.rows.map((r) => r.id),
    COMPARE_ROWS.map((r) => r.id),
  )
  assert.deepEqual(
    t.rows.map((r) => r.id),
    ['units', 'collected', 'potential', 'bills', 'net', 'annualNet'],
  )
  for (const row of t.rows) {
    row.cells.forEach((cell, i) => {
      assert.equal(cell.value, t.columns[i].totals[row.id], `${row.id} in ${t.columns[i].name} is that source's own figure`)
    })
    assert.equal(row.cells[0].delta, 0)
    assert.equal(row.cells[0].tone, null)
  }

  const cell = (rowId, col) => t.rows.find((r) => r.id === rowId).cells[col]
  // Raise: three leased units, +100 each
  assert.equal(cell('collected', 1).delta, 300)
  assert.equal(cell('collected', 1).tone, 'amber')
  assert.equal(cell('potential', 1).delta, 300)
  assert.equal(cell('bills', 1).delta, 1000)
  assert.equal(cell('bills', 1).tone, 'alert', 'more expense is worse')
  assert.equal(cell('net', 1).delta, -700)
  assert.equal(cell('net', 1).tone, 'alert')
  assert.equal(cell('annualNet', 1).delta, -8400)
  assert.equal(cell('units', 1).delta, 0)
  assert.equal(cell('units', 1).tone, null)
  // Bigger: one more unit, no money moved
  assert.equal(cell('units', 2).delta, 1)
  assert.equal(cell('units', 2).tone, null, 'a unit count is neither better nor worse')
  assert.equal(cell('collected', 2).delta, 0)
  assert.equal(cell('collected', 2).tone, null)
  assert.equal(cell('net', 2).delta, 0)

  // no scenarios: just the actual column
  assert.equal(compareTable(actual, []).columns.length, 1)
})

test('deleting a portfolio takes its scenarios with it, and the confirm says how many', () => {
  let state = realSheet()
  const away = makePortfolio({ id: 'away', name: 'Away' })
  state = addPortfolio(state, away)
  state = addProperty(state, buildFromTemplate('single', 'Far'), 'away')
  const h = home(state).id
  state = addScenario(state, forkScenario(state, h, { name: 'One' }))
  state = addScenario(state, forkScenario(state, h, { name: 'Two' }))
  const far = forkScenario(state, 'away', { name: 'Far plan' })
  state = addScenario(state, far)
  assert.equal(state.scenarios.length, 3)

  const d = describePortfolio(state, h)
  assert.equal(d.scenarios, 2)
  assert.match(d.text, /2 scenarios/)
  assert.equal(describePortfolio(state, 'away').scenarios, 1)
  assert.match(describePortfolio(state, 'away').text, /1 scenario\b/)
  assert.throws(() => removePortfolio(state, h), /and 2 scenarios/)
  assert.equal(state.scenarios.length, 3, 'the refused removal changed nothing')

  const gone = removePortfolio(state, h, { force: true })
  assert.deepEqual(
    gone.scenarios.map((s) => s.name),
    ['Far plan'],
  )
  assert.equal(gone.scenarios[0], far, 'the other portfolio’s scenario is the same object')
  assert.equal(gone.portfolios.length, 1)

  // a portfolio with no buildings but a scenario still asks first
  let bare = makeState({ properties: [] })
  bare = addPortfolio(bare, makePortfolio({ id: 'p2', name: 'Two' }))
  bare = addScenario(bare, forkScenario(bare, 'p2', { name: 'Empty plan' }))
  assert.throws(() => removePortfolio(bare, 'p2'), RuleError)
  assert.match(describePortfolio(bare, 'p2').text, /1 scenario/)
  assert.equal(removePortfolio(bare, 'p2', { force: true }).scenarios.length, 0)
})

test('the cap: six per portfolio, and the seventh is refused with the reason', () => {
  let state = realSheet()
  const h = home(state).id
  for (let i = 1; i <= SCENARIO_CAP; i++) state = addScenario(state, forkScenario(state, h, { name: `S${i}` }))
  assert.equal(SCENARIO_CAP, 6)
  assert.equal(scenariosOf(state, h).length, 6)

  const seventh = forkScenario(state, h, { name: 'S7' })
  assert.throws(() => addScenario(state, seventh), RuleError)
  assert.throws(() => addScenario(state, seventh), /6 per portfolio/)
  assert.throws(() => addScenario(state, seventh), /browser's storage/)
  assert.equal(scenariosOf(state, h).length, 6, 'nothing was added')

  // another portfolio has its own six
  state = addPortfolio(state, makePortfolio({ id: 'away', name: 'Away' }))
  state = addScenario(state, forkScenario(state, 'away', { name: 'Elsewhere' }))
  assert.equal(state.scenarios.length, 7)
  assert.throws(() => addScenario(state, { ...seventh, portfolioId: 'nope' }), /does not exist/)
  assert.equal(addScenario(state, null), state)

  // rename and note are the only fields a patch can touch; delete names what goes
  const s1 = scenariosOf(state, h)[0]
  const renamed = patchScenario(state, s1.id, { name: 'Renamed', note: 'why', properties: [] })
  const r1 = scenarioById(renamed, s1.id)
  assert.equal(r1.name, 'Renamed')
  assert.equal(r1.note, 'why')
  assert.equal(r1.properties, s1.properties, 'a patch never touches the buildings')
  assert.equal(patchScenario(state, s1.id, {}), state)
  const d = describeScenario(renamed, s1.id)
  assert.equal(d.name, 'Renamed')
  assert.equal(d.buildings, 2)
  assert.equal(d.units, 6)
  assert.match(d.text, /"Renamed" — 2 buildings · 6 units/)
  assert.match(d.text, /real data is not affected/)
  const fewer = removeScenario(renamed, s1.id)
  assert.equal(scenariosOf(fewer, h).length, 5)
  assert.equal(fewer.properties, state.properties, 'deleting a scenario never touches actual')
  assert.equal(removeScenario(fewer, 'nope'), fewer)
  assert.equal(addScenario(fewer, seventh).scenarios.length, 7, 'room again once one is gone')
})

test('scenarios survive save/load and export/import, and an import never removes one', async () => {
  localStorage.removeItem(STORAGE_KEY)
  let state = realSheet()
  const h = home(state).id
  const planA = forkScenario(state, h, { name: 'Plan A', note: 'keep' })
  const planB = forkScenario(state, h, { name: 'Plan B' })
  state = addScenario(addScenario(state, planA), planB)
  state = applyTo(state, scenarioTarget(planA.id), (s) => patchUnit(s, unitsOf(s.properties)[0].id, { rent: 4321 }))

  // storage
  assert.equal(save(state).ok, true)
  const back = load()
  assert.equal(back.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 8)
  assert.deepEqual(back.state.scenarios, state.scenarios)
  assert.equal(unitsOf(back.state.scenarios[0].properties)[0].rent, 4321)

  // export, then import into an empty sheet
  const text = serialize(state)
  assert.equal(JSON.parse(text).scenarios.length, 2, 'the export carries the scenarios')
  const r1 = await importJSON(text, makeState({}))
  assert.deepEqual(r1.state.scenarios, state.scenarios)
  assert.equal(r1.report.scenarios.added, 2)

  // into itself: nothing changes
  const r2 = await importJSON(text, state)
  assert.deepEqual(r2.state.scenarios, state.scenarios)
  assert.deepEqual(r2.report.scenarios, { added: 0, updated: 0, unchanged: 2 })

  // a file with Plan A renamed and a rent changed inside it, plus a third
  // scenario; the sheet meanwhile has a fourth the file never saw
  const file = JSON.parse(text)
  file.scenarios[0].name = 'Plan A (final)'
  file.scenarios[0].properties[0].floors[0].units[0].rent = 5555
  file.scenarios.push({ ...JSON.parse(JSON.stringify(planB)), id: 'from-file', name: 'Plan C' })
  const local = addScenario(state, forkScenario(state, h, { name: 'Plan D' }))
  const r3 = await importJSON(file, local)
  assert.deepEqual(
    r3.state.scenarios.map((s) => s.name).sort(),
    ['Plan A (final)', 'Plan B', 'Plan C', 'Plan D'],
  )
  assert.equal(unitsOf(scenarioById(r3.state, planA.id).properties)[0].rent, 5555, 'the file’s rent merged in')
  assert.equal(scenarioById(r3.state, planA.id).note, 'keep', 'a field the file did not change is kept')
  assert.equal(r3.report.scenarios.added, 1)
  assert.equal(r3.report.scenarios.updated, 1)
  assert.equal(r3.report.scenarios.unchanged, 1)
  assert.equal(r3.report.properties.added, 0, 'scenario buildings do not count as buildings')
  assert.equal(r3.state.properties.length, 2)
  for (const s of r3.state.scenarios) assert.equal(s.portfolioId, h)
})

test('a v7 store loads with an empty scenarios list and nothing else changed', () => {
  localStorage.removeItem(STORAGE_KEY)
  const stored = JSON.parse(serialize(realSheet()))
  stored.version = 7
  delete stored.scenarios
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.from, 7)
  assert.equal(r.state.version, 8)
  assert.equal(r.warnings.length, 0)
  assert.deepEqual(r.state.scenarios, [])
  assert.deepEqual(r.state.properties, stored.properties)
  assert.deepEqual(r.state.portfolios, stored.portfolios)
  const once = migrate(stored).state
  assert.deepEqual(migrate(once).state, once, 'idempotent')
})
