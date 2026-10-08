// Scenarios carry the money that leaves, not just the money that comes in.
// A scenario is compared on NET, so it must hold the same expenses as
// actual: every building bill and every unit bill, with amounts, cadences,
// due days, and loan terms intact — on a fresh fork, after "Refresh from
// actual", after a write comes back through ops.applyTo's strip, and after
// a save and reload. Bills stay editable inside a scenario without touching
// actual, and the delta bar shows each side's own expense total.
//
// The older scenario tests say what a scenario must NOT hold; these also
// say what it MUST. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import './support/jsx.mjs'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { formatDollars, makeBill, makeState } from '../src/data/schema.js'
import { STORAGE_KEY, load, save } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  addPropertyBill,
  addScenario,
  applyTo,
  patchProperty,
  patchPropertyBill,
  patchUnit,
  refreshScenario,
  removePropertyBill,
  scenarioTarget,
  setBillLoan,
  setPayment,
} from '../src/data/ops.js'
import { forkScenario, scenarioById, splitDeltas } from '../src/data/scenarios.js'
import { computeTotals } from '../src/data/totals.js'

const { DeltaBar, PaneTotals } = await import('../src/components/SplitView.jsx')

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

/**
 * What a scenario leaves behind, field by field, spelled out so a change to
 * it has to be made here on purpose. What it must bring — building bills,
 * unit bills, loan terms, with amounts, cadences, and due days — is asserted
 * beside it in assertCarriesMoneyNotFacts.
 */
const EXCLUDED = {
  property: { photo: null, photoSize: null },
  unit: { tenant: '', leaseStart: null, leaseEnd: null, payments: {}, tasks: [], notes: [] },
}

const unitsOf = (properties) => properties.flatMap((p) => p.floors.flatMap((f) => f.units))
/** A bill as compared across a fork: everything but its id, which is fresh by design. */
const withoutId = ({ id, ...rest }) => rest
const buildingBills = (properties) => properties.map((p) => p.bills.map(withoutId))
const unitBills = (properties) => unitsOf(properties).map((u) => u.bills.map(withoutId))

/** Two buildings with mortgages of $2,957 and $2,200 (= $5,157/mo), loans, taxes, a unit bill, and facts. */
function mortgagedPortfolio() {
  let state = makeState({
    properties: [buildFromTemplate('fourplex', 'Fairview'), buildFromTemplate('duplex-stacked', 'Next door')],
  })
  const [fv, nd] = state.properties
  const bill = (p, label) => p.bills.find((b) => b.label === label).id
  state = patchPropertyBill(state, fv.id, bill(fv, 'Mortgage'), { amount: 2957, dueDay: 1 })
  state = setBillLoan(state, fv.id, bill(fv, 'Mortgage'), {
    originalPrincipal: 420000,
    annualRatePercent: 6.5,
    termMonths: 360,
    firstPaymentDate: '2024-03-01',
    extraMonthlyPrincipal: 150,
    extraStartDate: '2025-01-01',
  })
  state = patchPropertyBill(state, fv.id, bill(fv, 'Property taxes'), { amount: 7200, dueDay: 15 })
  state = patchPropertyBill(state, fv.id, bill(fv, 'Insurance'), { amount: 2400, paid: true })
  state = patchPropertyBill(state, nd.id, bill(nd, 'Mortgage'), { amount: 2200, dueDay: 5 })
  state = setBillLoan(state, nd.id, bill(nd, 'Mortgage'), {
    originalPrincipal: 300000,
    annualRatePercent: 6.1,
    termMonths: 360,
    firstPaymentDate: '2025-06-01',
  })
  state = addPropertyBill(state, nd.id, makeBill({ label: 'Roof', amount: 9000, cadence: 'once' }))
  // facts a scenario must leave behind, everywhere they can live
  const [a, b] = unitsOf(state.properties)
  state = patchUnit(state, a.id, (u) => ({
    rent: 1450,
    status: 'leased',
    tenant: 'A. Tenant',
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    bills: [...u.bills, makeBill({ label: 'Gas', amount: 60, dueDay: 20 })],
    tasks: [{ text: 'Fix faucet' }],
    notes: [{ text: 'Called about heat' }],
  }))
  state = patchUnit(state, b.id, { rent: 1300, status: 'leased', tenant: 'B. Tenant' })
  state = setPayment(state, a.id, '2026-09', 'A', { status: 'paid' })
  state = patchProperty(state, nd.id, { photo: PHOTO, photoSize: { w: 1200, h: 800 }, view: 'photo' })
  return state
}

/** Fork the way the app does (forkScenario, then addScenario). */
function fork(state) {
  const scenario = forkScenario(state, state.portfolios[0].id, { name: 'Refi' })
  return { state: addScenario(state, scenario), id: scenario.id }
}

/** Every inclusion and exclusion, asserted together, for one scenario against its source. */
function assertCarriesMoneyNotFacts(source, scenario, where) {
  // MUST be there: building bills and unit bills, deep-equal but for ids
  assert.deepEqual(buildingBills(scenario.properties), buildingBills(source), `${where}: building bills`)
  assert.deepEqual(unitBills(scenario.properties), unitBills(source), `${where}: unit bills`)
  const loans = scenario.properties.flatMap((p) => p.bills.filter((b) => b.loan))
  assert.equal(loans.length, 2, `${where}: both loans`)
  assert.equal(loans[0].loan.extraStartDate, '2025-01-01', `${where}: loan terms whole`)
  // and so the same expenses, to the cent
  const s = computeTotals(scenario.properties)
  const a = computeTotals(source)
  assert.equal(s.bills, a.bills, `${where}: expense total`)
  assert.equal(s.propertyBills, a.propertyBills, `${where}: building expenses`)
  assert.equal(s.unitBills, a.unitBills, `${where}: unit expenses`)
  assert.ok(s.bills > 5157, `${where}: the mortgages are in it (${s.bills})`)

  // must NOT be there: photos, tenants, lease dates, payments, list items, notes
  for (const p of scenario.properties) {
    for (const [k, v] of Object.entries(EXCLUDED.property)) assert.deepEqual(p[k], v, `${where}: ${p.name} ${k}`)
    assert.equal(p.view, 'drawing')
  }
  for (const u of unitsOf(scenario.properties)) {
    for (const [k, v] of Object.entries(EXCLUDED.unit)) assert.deepEqual(u[k], v, `${where}: ${u.name} ${k}`)
  }
}

// ---------------------------------------------------------------------------

test('a fresh fork carries every building bill and unit bill, loans included, and the same expenses', () => {
  localStorage.removeItem(STORAGE_KEY)
  const actual = mortgagedPortfolio()
  assert.equal(computeTotals(actual.properties).propertyBills, 2957 + 2200 + 7200 / 12 + 2400 / 12)
  const { state, id } = fork(actual)
  assertCarriesMoneyNotFacts(state.properties, scenarioById(state, id), 'fork')

  // and through storage, where every scenario is normalized on the way in
  assert.equal(save(state).ok, true)
  const back = load().state
  assertCarriesMoneyNotFacts(back.properties, scenarioById(back, id), 'fork, saved and reloaded')
})

test('refresh from actual brings the bills over again, as they are now', () => {
  let { state, id } = fork(mortgagedPortfolio())
  // make the two differ: a refinance in the scenario, a tax change in actual
  const sp = scenarioById(state, id).properties[0]
  state = applyTo(state, scenarioTarget(id), (s) => patchPropertyBill(s, sp.id, sp.bills[0].id, { amount: 2400 }))
  state = applyTo(state, scenarioTarget(id), (s) => removePropertyBill(s, sp.id, sp.bills[1].id))
  const fv = state.properties[0]
  state = patchPropertyBill(state, fv.id, fv.bills[1].id, { amount: 8400 })
  assert.notEqual(computeTotals(scenarioById(state, id).properties).bills, computeTotals(state.properties).bills)

  state = refreshScenario(state, id)
  assertCarriesMoneyNotFacts(state.properties, scenarioById(state, id), 'refresh')
  assert.equal(scenarioById(state, id).properties[0].bills[1].amount, 8400, 'actual as it is now')

  localStorage.removeItem(STORAGE_KEY)
  assert.equal(save(state).ok, true)
  const back = load().state
  assertCarriesMoneyNotFacts(back.properties, scenarioById(back, id), 'refresh, saved and reloaded')
})

test('a write coming back through the applyTo strip keeps the bills and drops only facts', () => {
  let { state, id } = fork(mortgagedPortfolio())
  const su = unitsOf(scenarioById(state, id).properties)[1]
  // an ordinary edit, and attempts to put facts into the scenario
  state = applyTo(state, scenarioTarget(id), (s) => patchUnit(s, su.id, { rent: 1600, tenant: 'Ghost', leaseEnd: '2030-01-01' }))
  state = applyTo(state, scenarioTarget(id), (s) => setPayment(s, su.id, '2026-10', 'A', { status: 'paid' }))
  state = applyTo(state, scenarioTarget(id), (s) =>
    patchProperty(s, s.properties[1].id, { photo: PHOTO, photoSize: { w: 1, h: 1 }, view: 'photo' }),
  )
  assertCarriesMoneyNotFacts(state.properties, scenarioById(state, id), 'after applyTo writes')
})

test('bills are editable inside a scenario, and editing them never touches actual', () => {
  let { state, id } = fork(mortgagedPortfolio())
  const before = state
  const actualBills = state.properties.flatMap((p) => [p.bills, ...p.bills, ...p.bills.map((b) => b.loan ?? null)])
  const actualUnitBills = unitsOf(state.properties).flatMap((u) => [u.bills, ...u.bills])
  const write = (fn) => {
    state = applyTo(state, scenarioTarget(id), fn)
  }
  const props = () => scenarioById(state, id).properties
  const mortgage = (p) => p.bills.find((b) => b.label === 'Mortgage')

  // a refinance: new rate, new term, a new payment; a tax change; a new bill; one gone; a unit bill
  write((s) => setBillLoan(s, props()[0].id, mortgage(props()[0]).id, { annualRatePercent: 5.25, termMonths: 300 }))
  write((s) => patchPropertyBill(s, props()[0].id, mortgage(props()[0]).id, { amount: 2610 }))
  write((s) => patchPropertyBill(s, props()[0].id, props()[0].bills[1].id, { amount: 7800, cadence: 'yearly' }))
  write((s) => addPropertyBill(s, props()[1].id, makeBill({ label: 'HOA', amount: 120 })))
  write((s) => removePropertyBill(s, props()[1].id, props()[1].bills.find((b) => b.label === 'Roof').id))
  const su = unitsOf(props())[0]
  write((s) => patchUnit(s, su.id, (u) => ({ bills: u.bills.map((b) => ({ ...b, amount: 75 })) })))

  // the scenario changed…
  const m = mortgage(props()[0])
  assert.deepEqual([m.amount, m.loan.annualRatePercent, m.loan.termMonths], [2610, 5.25, 300])
  assert.equal(props()[1].bills.some((b) => b.label === 'HOA'), true)
  assert.equal(props()[1].bills.some((b) => b.label === 'Roof'), false)
  assert.equal(unitsOf(props())[0].bills[0].amount, 75)

  // …and actual is the very same objects
  assert.equal(state.properties, before.properties)
  assert.equal(state.portfolios, before.portfolios)
  const nowBills = state.properties.flatMap((p) => [p.bills, ...p.bills, ...p.bills.map((b) => b.loan ?? null)])
  const nowUnitBills = unitsOf(state.properties).flatMap((u) => [u.bills, ...u.bills])
  nowBills.forEach((ref, i) => assert.equal(ref, actualBills[i], `actual building bill object #${i}`))
  nowUnitBills.forEach((ref, i) => assert.equal(ref, actualUnitBills[i], `actual unit bill object #${i}`))
  assert.equal(mortgage(state.properties[0]).amount, 2957)
  assert.equal(mortgage(state.properties[0]).loan.annualRatePercent, 6.5)
})

test("the delta bar shows the scenario's own expense total, like for like", () => {
  let { state, id } = fork(mortgagedPortfolio())

  // untouched: identical expenses, a zero delta — not "thousands better"
  let rows = splitDeltas(state.properties, scenarioById(state, id).properties)
  const bills = () => rows.find((r) => r.id === 'bills')
  const net = () => rows.find((r) => r.id === 'net')
  assert.equal(bills().scenario, computeTotals(scenarioById(state, id).properties).bills)
  assert.equal(bills().actual, computeTotals(state.properties).bills)
  assert.equal(bills().delta, 0)
  assert.equal(net().delta, 0)

  // a refinance that saves $347 a month shows as exactly that
  const p = scenarioById(state, id).properties[0]
  state = applyTo(state, scenarioTarget(id), (s) =>
    patchPropertyBill(s, p.id, p.bills.find((b) => b.label === 'Mortgage').id, { amount: 2610 }),
  )
  rows = splitDeltas(state.properties, scenarioById(state, id).properties)
  const own = computeTotals(scenarioById(state, id).properties).bills
  assert.equal(bills().scenario, own)
  assert.equal(bills().delta, -347)
  assert.equal(bills().tone, 'amber')
  assert.equal(net().delta, 347)

  // and what is rendered: the scenario pane's Expenses and the bar's "actual → scenario"
  const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const pane = text(renderToString(h(PaneTotals, { totals: computeTotals(scenarioById(state, id).properties) })))
  assert.ok(pane.includes(`Expenses / mo ${formatDollars(own)}`), pane)
  const bar = text(renderToString(h(DeltaBar, { rows })))
  assert.ok(bar.includes(`${formatDollars(bills().actual)} → ${formatDollars(own)}`), bar)
  assert.ok(bar.includes('Δ Expenses / mo −$347'), bar)
})
