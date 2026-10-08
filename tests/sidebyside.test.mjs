// Side by side: actual (read only) beside an editable scenario. The first
// open with no scenario forks one by itself; the actual pane renders
// nothing that can write (no input, no button, no handle, no toggle); the
// delta bar is each side's own computeTotals subtracted; "Refresh from
// actual" replaces a scenario's content and keeps its id and name; the
// "actual changed since this fork" marker follows real edits and only real
// edits, its basis living on the scenario through backups and imports and
// moved there from the old side cache; and a whole editing session on the
// scenario side leaves every actual object identical by reference.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import './support/jsx.mjs'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { makeBill, makeState } from '../src/data/schema.js'
import { LEGACY_FORK_BASIS_KEY, STORAGE_KEY, adoptForkBases, importJSON, load, save, serialize } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  RuleError,
  addFloor,
  addProperty,
  addPropertyBill,
  addScenario,
  addSideAnnex,
  addUnit,
  applyTo,
  patchProperty,
  patchPropertyBill,
  patchScenario,
  patchUnit,
  refreshScenario,
  removeProperty,
  removePropertyBill,
  removeUnit,
  renameFloor,
  scenarioTarget,
  setBillLoan,
  setFloorUnitCount,
  setPayment,
  setUnitWidths,
} from '../src/data/ops.js'
import {
  DELTA_ROWS,
  SCENARIO_CAP,
  actualSignature,
  forkScenario,
  forkSignature,
  isStale,
  planSideBySide,
  scenarioById,
  splitDeltas,
  whatIfName,
} from '../src/data/scenarios.js'
import { computeTotals } from '../src/data/totals.js'
import { monthKey } from '../src/lib/months.js'

const { ActualPane, default: SplitView } = await import('../src/components/SplitView.jsx')
const { default: Elevation } = await import('../src/components/Elevation.jsx')
const { applyChanges, planRaise } = await import('../src/components/RaiseRents.jsx')

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

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w=='
const unitsOf = (properties) => properties.flatMap((p) => p.floors.flatMap((f) => f.units))
const noop = () => {}

/** A real-looking portfolio: rents, a split unit, an annex, bills with a loan, facts, a photo. */
function realSheet() {
  let state = makeState({
    properties: [buildFromTemplate('fourplex', 'Fairview'), buildFromTemplate('duplex-stacked', 'Next door')],
  })
  const [fv, nd] = state.properties
  const [a, b, c, d] = unitsOf([fv])
  state = patchUnit(state, a.id, { rent: 1450, status: 'leased', tenant: 'A. Tenant', leaseEnd: '2027-06-30' })
  state = patchUnit(state, b.id, { rent: 1300, status: 'leased', splittable: true, isSplit: true, splitRent: 650 })
  state = patchUnit(state, c.id, { rent: 1200, status: 'vacant', notes: [{ text: 'Painted' }] })
  state = patchUnit(state, d.id, { rent: 1250, status: 'leased' })
  state = setPayment(state, a.id, monthKey(), 'A', { status: 'unpaid' }) // puts a marker on the box
  state = addSideAnnex(state, fv.id, 'left')
  const annex = unitsOf([state.properties[0]]).find((u) => u.position === 'side')
  state = patchUnit(state, annex.id, { name: 'Storefront', rent: 1800, status: 'leased' })
  const bill = (p, label) => p.bills.find((x) => x.label === label).id
  state = patchPropertyBill(state, fv.id, bill(fv, 'Mortgage'), { amount: 2400 })
  state = patchPropertyBill(state, fv.id, bill(fv, 'Property taxes'), { amount: 7200 })
  state = setBillLoan(state, fv.id, bill(fv, 'Mortgage'), {
    originalPrincipal: 300000,
    annualRatePercent: 6.5,
    termMonths: 360,
    firstPaymentDate: '2026-01-01',
  })
  const [up, low] = unitsOf([nd])
  state = patchUnit(state, up.id, { rent: 1100, status: 'leased' })
  state = patchUnit(state, low.id, { rent: 1000, status: 'renovating' })
  state = patchProperty(state, nd.id, { photo: PHOTO, photoSize: { w: 1200, h: 800 }, view: 'photo' })
  return state
}

/** Fork the way the Side by side control does: plan, then forkScenario + addScenario. */
function forkLikeTheControl(state, now = new Date(2026, 9, 7)) {
  const pid = state.portfolios[0].id
  const plan = planSideBySide(state, pid, now)
  const name = plan.action === 'fork' ? plan.name : plan.newFork.name
  const scenario = forkScenario(state, pid, { name })
  return { plan, scenario, state: addScenario(state, scenario) }
}

/** Every object in actual data a write could replace, in a fixed order. */
function actualRefs(state) {
  const out = [state.properties, state.portfolios]
  for (const f of state.portfolios) out.push(f, f.propertyIds)
  for (const p of state.properties) {
    out.push(p, p.floors, p.bills)
    for (const b of p.bills) out.push(b, b.loan ?? null)
    for (const fl of p.floors) {
      out.push(fl, fl.units)
      for (const u of fl.units) {
        out.push(u, u.payments, u.bills, u.tasks, u.notes, ...u.bills, ...u.tasks, ...u.notes, ...Object.values(u.payments))
      }
    }
  }
  return out
}

/** Tags and attributes that would let a pane take input or change anything. */
const INTERACTIVE = /<(input|button|select|textarea|a|label)\b|contenteditable|role="(button|separator|radio|tab|checkbox|switch)"|tabindex=/gi
const interactive = (html) => html.match(INTERACTIVE) ?? []

/** The markup of the <section> whose aria-label starts with `label`. */
function sectionOf(html, label) {
  const start = html.indexOf(`<section aria-label="${label}`)
  assert.notEqual(start, -1, `no section labelled ${label}`)
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length)
}

function renderSplit(state, scenario, extra = {}) {
  const actual = state.properties
  return renderToString(
    h(SplitView, {
      actual,
      portfolioName: 'Cleveland Heights',
      scenario,
      onRename: noop,
      onRefresh: noop,
      onExpenses: noop,
      editor: { onUnitChange: noop, onPropertyChange: noop, onOpenUnit: noop, structure: {} },
      ...extra,
    }),
  )
}

// ---------------------------------------------------------------------------

test('the first open with no scenario forks one by itself, "What-if <date>"; after that it asks', () => {
  const state = realSheet()
  const pid = state.portfolios[0].id
  const now = new Date(2026, 9, 7, 23, 50) // late evening: the local date, not UTC's
  assert.deepEqual(planSideBySide(state, pid, now), { action: 'fork', name: 'What-if Oct 7, 2026' })

  const first = forkLikeTheControl(state, now)
  assert.equal(first.plan.action, 'fork', 'no question asked the first time')
  const s1 = first.scenario
  assert.equal(s1.name, 'What-if Oct 7, 2026')
  assert.equal(s1.portfolioId, pid)
  assert.equal(first.state.scenarios.length, 1)
  assert.equal(s1.properties.length, 2, 'every building came along')
  assert.equal(forkSignature(s1.properties), actualSignature(state, pid), 'a copy of actual as it is')
  const actualIds = new Set(unitsOf(state.properties).map((u) => u.id))
  assert.ok(unitsOf(s1.properties).every((u) => !actualIds.has(u.id)), 'fresh ids')
  assert.ok(unitsOf(s1.properties).every((u) => u.tenant === '' && Object.keys(u.payments).length === 0), 'no facts')
  assert.equal(first.state.properties, state.properties, 'actual is the same object')

  // with a scenario there, it asks — "+ new fork" first, with a name that does not clash
  const plan = planSideBySide(first.state, pid, now)
  assert.equal(plan.action, 'pick')
  assert.equal(plan.newFork.name, 'What-if Oct 7, 2026 (2)')
  assert.equal(plan.newFork.ok, true)
  assert.deepEqual(plan.scenarios.map((s) => s.id), [s1.id])
  assert.equal(whatIfName(now, ['What-if Oct 7, 2026', 'What-if Oct 7, 2026 (2)']), 'What-if Oct 7, 2026 (3)')

  // at the cap the new fork is offered disabled, with the reason
  let full = first.state
  while (full.scenarios.length < SCENARIO_CAP) full = forkLikeTheControl(full, now).state
  const capped = planSideBySide(full, pid, now)
  assert.equal(capped.newFork.ok, false)
  assert.match(capped.newFork.reason, /per portfolio/)
})

test('the actual pane renders nothing that can write: zero inputs, buttons, handles, or toggles', () => {
  const state = realSheet()
  const { scenario, state: withScenario } = forkLikeTheControl(state)

  for (const collapsed of [false, true]) {
    const html = renderToString(h(ActualPane, { properties: state.properties, collapsed, rentScale: 1800 }))
    assert.deepEqual(interactive(html), [], `ActualPane collapsed=${collapsed}`)
    assert.match(html, /Collected \/ mo/, 'its own totals are there')
  }

  // drawn, read: rents as text, the split, the annex, the unpaid marker, and
  // the photo building as its drawing — still nothing to tap
  const drawn = renderToString(h(ActualPane, { properties: state.properties }))
  for (const text of ['$1,450', '$650', 'Storefront', 'unpaid', 'Fairview', 'Next door']) {
    assert.ok(drawn.includes(text), `shows ${text}`)
  }
  assert.ok(!drawn.includes(PHOTO), 'the photo building is drawn, not shown as a photo')

  // inside the composed view, the whole actual section — header included — is inert
  const html = renderSplit(withScenario, scenario)
  assert.deepEqual(interactive(sectionOf(html, 'Actual')), [])
  // while the scenario side is a full editor (so the check above can see inputs at all)
  const editable = interactive(sectionOf(html, 'Scenario'))
  assert.ok(editable.filter((t) => /<input/i.test(t)).length >= 8, `scenario side has rent inputs (${editable.length})`)
  assert.ok(editable.some((t) => /<button/i.test(t)), 'and buttons')

  // the same Elevation, read-only, is just as inert on its own
  assert.deepEqual(interactive(renderToString(h(Elevation, { properties: state.properties, readOnly: true, names: true }))), [])
})

test("the delta bar is each side's own totals, subtracted, amber better and alert worse", () => {
  const base = forkLikeTheControl(realSheet())
  let state = base.state
  const sid = base.scenario.id
  const write = (fn) => {
    state = applyTo(state, scenarioTarget(sid), fn)
  }

  // untouched: every delta is 0 and has no tone
  let rows = splitDeltas(state.properties, scenarioById(state, sid).properties)
  assert.deepEqual(rows.map((r) => r.id), DELTA_ROWS)
  assert.ok(rows.every((r) => r.delta === 0 && r.tone === null))

  // +100 rent on a leased unit, +50 a month of expenses, in the scenario
  const leased = unitsOf(scenarioById(state, sid).properties).find((u) => u.status === 'leased' && u.position !== 'side')
  write((s) => patchUnit(s, leased.id, (u) => ({ rent: u.rent + 100 })))
  const sp = () => scenarioById(state, sid).properties[0]
  write((s) => addPropertyBill(s, sp().id, makeBill({ label: 'Trash', amount: 50 })))

  const actualTotals = computeTotals(state.properties)
  const scenarioTotals = computeTotals(scenarioById(state, sid).properties)
  rows = splitDeltas(state.properties, scenarioById(state, sid).properties)
  for (const r of rows) {
    assert.equal(r.actual, actualTotals[r.id], `${r.id}: actual side's own figure`)
    assert.equal(r.scenario, scenarioTotals[r.id], `${r.id}: scenario side's own figure`)
    assert.equal(r.delta, scenarioTotals[r.id] - actualTotals[r.id], `${r.id}: scenario − actual`)
  }
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.deepEqual([by.collected.delta, by.collected.tone], [100, 'amber'], 'more rent is better')
  assert.deepEqual([by.bills.delta, by.bills.tone], [50, 'alert'], 'more expense is worse')
  assert.deepEqual([by.net.delta, by.net.tone], [50, 'amber'])
  assert.deepEqual([by.annualNet.delta, by.annualNet.tone], [600, 'amber'])

  // worse the other way round
  write((s) => patchUnit(s, leased.id, (u) => ({ rent: u.rent - 400 })))
  by.net = splitDeltas(state.properties, scenarioById(state, sid).properties).find((r) => r.id === 'net')
  assert.deepEqual([by.net.delta, by.net.tone], [-350, 'alert'])
})

test('refresh from actual replaces the content and keeps the id and the name', () => {
  const first = forkLikeTheControl(realSheet())
  const other = forkLikeTheControl(first.state) // a second scenario that must not move
  let state = patchScenario(other.state, first.scenario.id, { name: 'Raise the 3F', note: 'try it' })
  const sid = first.scenario.id
  const write = (fn) => {
    state = applyTo(state, scenarioTarget(sid), fn)
  }

  // edits in the scenario, then a real change in actual
  const su = unitsOf(scenarioById(state, sid).properties)[0]
  write((s) => patchUnit(s, su.id, { rent: 9999 }))
  write((s) => addFloor(s, scenarioById(state, sid).properties[0].id))
  const real = unitsOf(state.properties)[3]
  state = patchUnit(state, real.id, { rent: 1500 })
  const before = state
  const old = scenarioById(state, sid)

  state = refreshScenario(state, sid, { at: '2026-10-08T15:00:00.000Z' })
  const fresh = scenarioById(state, sid)
  assert.equal(fresh.id, sid, 'same id')
  assert.equal(fresh.name, 'Raise the 3F', 'same name')
  assert.equal(fresh.note, 'try it')
  assert.equal(fresh.portfolioId, old.portfolioId)
  assert.equal(fresh.createdAt, '2026-10-08T15:00:00.000Z', 'a snapshot from now')
  assert.equal(state.scenarios.findIndex((s) => s.id === sid), before.scenarios.findIndex((s) => s.id === sid), 'same place in the list')

  // the content is actual as it is now: the edits are gone, the real change is in
  assert.equal(forkSignature(fresh.properties), actualSignature(state, fresh.portfolioId))
  assert.ok(!unitsOf(fresh.properties).some((u) => u.rent === 9999), 'the scenario edit is gone')
  assert.equal(fresh.properties[0].floors.length, before.properties[0].floors.length, 'the added floor is gone')
  assert.ok(unitsOf(fresh.properties).some((u) => u.rent === 1500), 'the real change came in')
  const seen = new Set([...unitsOf(old.properties), ...unitsOf(state.properties)].map((u) => u.id))
  assert.ok(unitsOf(fresh.properties).every((u) => !seen.has(u.id)), 'fresh ids, naming nothing old or actual')
  assert.ok(unitsOf(fresh.properties).every((u) => u.tenant === '' && Object.keys(u.payments).length === 0 && u.notes.length === 0))

  // nothing else moved
  assert.equal(state.properties, before.properties)
  assert.equal(state.portfolios, before.portfolios)
  assert.equal(scenarioById(state, other.scenario.id), scenarioById(before, other.scenario.id))
  assert.throws(() => refreshScenario(state, 'gone'), RuleError)
})

test('the stale marker appears after a real edit — and only a real one', () => {
  const first = forkLikeTheControl(realSheet())
  let state = first.state
  const sid = first.scenario.id
  const pid = state.portfolios[0].id

  // the fork takes its basis from actual as it copied it, on the scenario
  assert.equal(scenarioById(state, sid).forkBasis, actualSignature(state, pid))
  const stale = () => isStale(state, scenarioById(state, sid))
  assert.equal(stale(), false)

  // editing the scenario never makes it stale
  const su = unitsOf(scenarioById(state, sid).properties)[0]
  state = applyTo(state, scenarioTarget(sid), (s) => patchUnit(s, su.id, { rent: 4321 }))
  assert.equal(scenarioById(state, sid).forkBasis, first.scenario.forkBasis, 'an edit keeps the basis')
  assert.equal(stale(), false)

  // facts a scenario never holds do not either: a payment, a tenant, a note, a bill's paid box
  const [a, b] = unitsOf(state.properties)
  state = setPayment(state, a.id, '2026-09', 'A', { status: 'paid' })
  state = patchUnit(state, b.id, { tenant: 'New tenant', leaseEnd: '2028-01-31', notes: [{ text: 'Keys' }] })
  const fv = state.properties[0]
  state = patchPropertyBill(state, fv.id, fv.bills[0].id, { paid: true })
  assert.equal(stale(), false)

  // a real change to what the scenario copied does
  state = patchUnit(state, a.id, { rent: 1475 })
  assert.equal(stale(), true)
  const marked = renderSplit(state, scenarioById(state, sid), { stale: stale() })
  assert.match(marked, /Actual has changed since this was forked/)
  assert.doesNotMatch(renderSplit(state, scenarioById(state, sid), { stale: false }), /Actual has changed/)

  // refreshing takes a new basis, and the marker goes
  state = refreshScenario(state, sid)
  assert.equal(scenarioById(state, sid).forkBasis, actualSignature(state, pid))
  assert.equal(stale(), false)

  // no basis (forked before bases were kept, never refreshed): unknown, and quiet
  const { forkBasis, ...without } = scenarioById(state, sid)
  assert.equal(typeof forkBasis, 'string')
  assert.equal(isStale(state, without), null)
  assert.equal(isStale(state, { ...without, forkBasis: null }), null)
  assert.doesNotMatch(renderSplit(state, without, { stale: isStale(state, without) }), /Actual has changed/)
})

test('the basis rides with the scenario through a save, a reload, and a backup', async () => {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_FORK_BASIS_KEY)
  const first = forkLikeTheControl(realSheet())
  let state = first.state
  const sid = first.scenario.id
  const basis = scenarioById(state, sid).forkBasis
  assert.match(basis, /^[0-9a-f]{8}$/)

  assert.equal(save(state).ok, true)
  assert.equal(scenarioById(load().state, sid).forkBasis, basis, 'in rentroll:v1 itself')
  assert.equal(localStorage.getItem(LEGACY_FORK_BASIS_KEY), null, 'and nothing beside it')

  // a backup restored into a fresh sheet still knows when actual moves on
  const restored = (await importJSON(serialize(state), makeState({ properties: [] }))).state
  assert.equal(scenarioById(restored, sid).forkBasis, basis)
  assert.equal(isStale(restored, scenarioById(restored, sid)), false)
  const changed = patchUnit(restored, unitsOf(restored.properties)[0].id, { rent: 1 })
  assert.equal(isStale(changed, scenarioById(changed, sid)), true)

  // an older backup without bases never wipes the one this sheet has
  const old = JSON.parse(serialize(state))
  delete old.scenarios[0].forkBasis
  const merged = (await importJSON(JSON.stringify(old), state)).state
  assert.equal(scenarioById(merged, sid).forkBasis, basis)
})

test('bases in the old rentroll:fork-basis cache move into their scenarios, then the key goes', () => {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_FORK_BASIS_KEY)
  // a v9 store with two scenarios and no bases on them, as the last version wrote it
  const one = forkLikeTheControl(realSheet())
  const two = forkLikeTheControl(one.state)
  const stored = JSON.parse(serialize(two.state))
  stored.version = 9
  for (const sc of stored.scenarios) delete sc.forkBasis
  const [s1, s2] = stored.scenarios
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  // the cache knew the first one only (the second came in by import, say), plus a deleted one
  const cached = one.scenario.forkBasis
  localStorage.setItem(LEGACY_FORK_BASIS_KEY, JSON.stringify({ [s1.id]: cached, gone: 'deadbeef' }))

  const r = load()
  assert.equal(scenarioById(r.state, s1.id).forkBasis, cached, 'adopted from the cache')
  assert.equal('forkBasis' in scenarioById(r.state, s2.id), false, 'not invented: no marker until refreshed')
  assert.equal(isStale(r.state, scenarioById(r.state, s2.id)), null)
  assert.deepEqual(scenarioById(r.state, s1.id).properties, s1.properties, 'nothing else about it changed')
  assert.equal(localStorage.getItem(LEGACY_FORK_BASIS_KEY) !== null, true, 'load never deletes anything')

  // a write that does not hold the adopted basis leaves the old key alone…
  assert.equal(save({ ...r.state, scenarios: stored.scenarios }).ok, true)
  assert.notEqual(localStorage.getItem(LEGACY_FORK_BASIS_KEY), null)
  // …and the first good write that does retires it
  assert.equal(save(r.state).ok, true)
  assert.equal(localStorage.getItem(LEGACY_FORK_BASIS_KEY), null)
  assert.equal(scenarioById(load().state, s1.id).forkBasis, cached, 'and the basis is in the data now')

  // adopting never overwrites a scenario's own basis
  const own = { ...stored, scenarios: [{ ...s1, forkBasis: '0000aaaa' }] }
  assert.equal(adoptForkBases(own, { [s1.id]: cached }).scenarios[0].forkBasis, '0000aaaa')
  assert.equal(adoptForkBases(own, {}), own, 'nothing to adopt: the very same state')
})

test('a full editing session on the scenario side leaves actual identical by reference', () => {
  const first = forkLikeTheControl(realSheet())
  const second = forkLikeTheControl(first.state)
  let state = second.state
  const sid = first.scenario.id
  const before = state
  const refs = actualRefs(state)
  const json = JSON.stringify({ properties: state.properties, portfolios: state.portfolios })
  const untouched = scenarioById(state, second.scenario.id)

  // App's `write` while side by side: every handler aims at the scenario
  const target = scenarioTarget(sid)
  const write = (fn) => {
    try {
      state = applyTo(state, target, fn)
    } catch (err) {
      if (!(err instanceof RuleError)) throw err // App shows a RuleError as a notice; state kept
    }
  }
  const props = () => scenarioById(state, sid).properties
  const units = () => unitsOf(props())
  const bill = (p, label) => p.bills.find((b) => b.label === label)

  // the boxes: rent, status, name, a split, facts that must not stick
  write((s) => patchUnit(s, units()[0].id, { rent: 1600, status: 'leased', name: 'Penthouse' }))
  write((s) => patchUnit(s, units()[2].id, { splittable: true }))
  write((s) => patchUnit(s, units()[2].id, { isSplit: true, splitRent: 700 }))
  write((s) => patchUnit(s, units()[3].id, { tenant: 'Ghost', leaseEnd: '2027-01-01', notes: [{ text: 'no' }] }))
  write((s) => patchUnit(s, units()[3].id, (u) => ({ bills: [...u.bills, makeBill({ label: 'Gas', amount: 40 })] })))
  write((s) => setPayment(s, units()[0].id, monthKey(), 'A', { status: 'paid' }))

  // Build: floors, the stepper, widths, labels, units in and out, an annex
  write((s) => addFloor(s, props()[0].id))
  write((s) => setFloorUnitCount(s, props()[0].id, props()[0].floors[0].id, 3))
  const top = () => props()[0].floors[0]
  write((s) => setUnitWidths(s, props()[0].id, top().id, { [top().units[0].id]: 1.6, [top().units[1].id]: 0.4 }))
  write((s) => renameFloor(s, props()[0].id, top().id, 'Roof deck'))
  write((s) => addUnit(s, props()[1].id, props()[1].floors[0].id))
  write((s) => removeUnit(s, props()[1].floors[0].units.at(-1).id))
  write((s) => addSideAnnex(s, props()[1].id, 'right'))
  write((s) => setFloorUnitCount(s, props()[0].id, props()[0].floors[1].id, 0)) // refused: the units hold rent
  write((s) => patchProperty(s, props()[0].id, { name: 'Fairview, what-if', shape: 'gable', address: 'same' }))

  // bills and the loan
  write((s) => patchPropertyBill(s, props()[0].id, bill(props()[0], 'Mortgage').id, { amount: 2550 }))
  write((s) => setBillLoan(s, props()[0].id, bill(props()[0], 'Mortgage').id, { annualRatePercent: 5.25 }))
  write((s) => addPropertyBill(s, props()[0].id, makeBill({ label: 'Trash', amount: 30 })))
  write((s) => removePropertyBill(s, props()[0].id, bill(props()[0], 'Water').id))

  // a raise, a new building, a removed one, a rename of the scenario itself
  write((s) => applyChanges(s, planRaise(s.properties, { mode: 'percent', amount: 3 }), 'after'))
  write((s) => addProperty(s, buildFromTemplate('triplex', 'New build'), s.portfolios[0].id))
  write((s) => removeProperty(s, props()[1].id, { force: true }))
  state = patchScenario(state, sid, { name: 'Edited all over' })

  // the scenario really changed…
  const edited = scenarioById(state, sid)
  assert.notEqual(edited, scenarioById(before, sid))
  assert.equal(edited.name, 'Edited all over')
  assert.deepEqual(edited.properties.map((p) => p.name), ['Fairview, what-if', 'New build'])
  assert.equal(edited.properties[0].floors[0].label, 'Roof deck')
  assert.ok(unitsOf(edited.properties).every((u) => u.tenant === '' && Object.keys(u.payments).length === 0 && u.notes.length === 0))
  assert.equal(bill(edited.properties[0], 'Mortgage').loan.annualRatePercent, 5.25)

  // …and actual is the very same objects, every one of them
  assert.equal(state.properties, before.properties)
  assert.equal(state.portfolios, before.portfolios)
  const after = actualRefs(state)
  assert.equal(after.length, refs.length)
  after.forEach((ref, i) => assert.equal(ref, refs[i], `actual object #${i} replaced`))
  assert.equal(JSON.stringify({ properties: state.properties, portfolios: state.portfolios }), json)
  assert.equal(scenarioById(state, second.scenario.id), untouched, 'the other scenario too')
})
