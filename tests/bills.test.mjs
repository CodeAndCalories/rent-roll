// Building bills: the four bills every template seeds are the very bills the
// editor edits (never a parallel set), an edit persists through a save and a
// reload, the panel's monthly figure IS the title block's, the expenses
// summary adds up to exactly what the title block shows, one loan bill per
// building is enforced in ops.js, and a v8 store migrates to v9 with
// nothing lost. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, makeBill, makeState } from '../src/data/schema.js'
import { STORAGE_KEY, importJSON, load, migrate, save, serialize } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  RuleError,
  addPropertyBill,
  patchProperty,
  patchPropertyBill,
  patchUnit,
  removePropertyBill,
  setBillLoan,
} from '../src/data/ops.js'
import { billMonthly, computeTotals, expenseSummary, propertyBillsMonthly, unitBillsMonthly } from '../src/data/totals.js'
import { escrowOverlap, loanBillCount, loanBillOf, loanCheck } from '../src/data/loans.js'

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

const one = (templateId = 'duplex-stacked', name = 'Next door') =>
  makeState({ properties: [buildFromTemplate(templateId, name)] })
const prop = (state, i = 0) => state.properties[i]
const billNamed = (p, label) => p.bills.find((b) => b.label === label)

test('editing a seeded building bill edits that bill, and it persists through a save and reload', () => {
  localStorage.removeItem(STORAGE_KEY)
  let state = one()
  const p = prop(state)
  const seeded = p.bills.map((b) => b.id)
  assert.deepEqual(
    p.bills.map((b) => b.label),
    ['Mortgage', 'Property taxes', 'Insurance', 'Water'],
    'every template seeds these four',
  )
  const mortgage = billNamed(p, 'Mortgage')

  state = patchPropertyBill(state, p.id, mortgage.id, { amount: '2,400.50', dueDay: 5, paid: true })
  state = patchPropertyBill(state, p.id, billNamed(p, 'Property taxes').id, (b) => ({ amount: b.amount + 6000 }))

  const after = prop(state)
  assert.deepEqual(after.bills.map((b) => b.id), seeded, 'the same four bills, same ids, same order — no parallel set')
  assert.equal(billNamed(after, 'Mortgage').amount, 2400.5, 'typed text goes through toAmount')
  assert.equal(billNamed(after, 'Mortgage').dueDay, 5)
  assert.equal(billNamed(after, 'Mortgage').paid, true)
  assert.equal(billNamed(after, 'Property taxes').amount, 6000)
  assert.equal(billNamed(p, 'Mortgage').amount, 0, 'the input state is untouched')

  // junk never becomes NaN
  const junk = patchPropertyBill(state, p.id, mortgage.id, { amount: 'abc' })
  assert.equal(billNamed(prop(junk), 'Mortgage').amount, 0)

  // through storage
  assert.equal(save(state).ok, true)
  const back = load()
  assert.equal(back.source, 'storage')
  const reloaded = prop(back.state)
  assert.deepEqual(reloaded.bills.map((b) => b.id), seeded)
  assert.equal(billNamed(reloaded, 'Mortgage').amount, 2400.5)
  assert.equal(billNamed(reloaded, 'Property taxes').amount, 6000)
  assert.deepEqual(reloaded.bills, after.bills, 'every field of every bill comes back')

  // add and remove are building bills too
  const extra = makeBill({ label: 'Trash', amount: 35 })
  let more = addPropertyBill(state, p.id, extra)
  assert.equal(prop(more).bills.length, 5)
  assert.equal(prop(more).bills[4].id, extra.id, 'the caller knows the id')
  more = removePropertyBill(more, p.id, extra.id)
  assert.deepEqual(prop(more).bills.map((b) => b.id), seeded)
  assert.equal(removePropertyBill(more, p.id, 'nope'), more, 'an unknown bill is a no-op')
  assert.equal(patchPropertyBill(more, p.id, 'nope', { amount: 1 }), more)
  assert.equal(patchPropertyBill(more, 'nope', mortgage.id, { amount: 1 }), more)
})

test("the panel's monthly equivalent is the title block's, to the last bit", () => {
  let state = makeState({
    properties: [buildFromTemplate('fourplex', 'Corner'), buildFromTemplate('duplex-side', 'Pair')],
  })
  const [a, b] = state.properties
  // awkward amounts: yearly thirds and decimals that do not sum cleanly in binary
  const amounts = { Mortgage: 2183.17, 'Property taxes': 7345.33, Insurance: 1999.99, Water: 0.1 }
  for (const p of [a, b]) {
    for (const bill of p.bills) {
      state = patchPropertyBill(state, p.id, bill.id, { amount: amounts[bill.label] + (p === b ? 0.2 : 0) })
    }
  }
  state = patchPropertyBill(state, a.id, billNamed(a, 'Water').id, { cadence: 'yearly' })
  state = addPropertyBill(state, b.id, makeBill({ label: 'Roof', amount: 9000, cadence: 'once' }))
  const unit = a.floors[0].units[0]
  state = patchUnit(state, unit.id, (u) => ({
    bills: [...u.bills, makeBill({ label: 'Gas', amount: 61.3 }), makeBill({ label: 'Permit', amount: 200.7, cadence: 'yearly' })],
  }))

  // one building: the panel's figure is the title block's building-bills figure
  for (const p of state.properties) {
    const panel = propertyBillsMonthly(p)
    assert.equal(panel, computeTotals([p]).propertyBills, `${p.name}: panel === title block`)
    assert.equal(panel, p.bills.reduce((n, x) => n + billMonthly(x), 0), 'and it is billMonthly summed')
  }
  // a once bill is not monthly, as before
  assert.equal(billMonthly(billNamed(prop(state, 1), 'Roof')), 0)

  // the portfolio: the expenses summary adds up to exactly what the title block shows
  const t = computeTotals(state.properties)
  const s = expenseSummary(state.properties)
  assert.equal(s.propertyBills, t.propertyBills)
  assert.equal(s.unitBills, t.unitBills)
  assert.equal(s.total, t.bills, 'summary total === title block expenses')
  assert.ok(t.bills > 0, 'expenses are no longer stuck at $0')
  assert.equal(t.net, t.collected - t.bills, 'net is still collected minus expenses')

  // grouped: every building with every bill, and only the units that have bills
  assert.deepEqual(s.buildings.map((g) => g.property.id), [a.id, b.id])
  assert.equal(s.buildings[0].bills.length, 4)
  assert.equal(s.buildings[1].bills.length, 5)
  assert.equal(s.buildings[0].units.length, 1)
  assert.equal(s.buildings[0].units[0].unit.id, unit.id)
  assert.equal(s.buildings[0].units[0].monthly, unitBillsMonthly(prop(state).floors[0].units[0]))
  assert.equal(s.buildings[0].units[0].bills.length, 2)
  assert.equal(s.buildings[1].units.length, 0)
  assert.equal(s.buildings[0].monthly, propertyBillsMonthly(prop(state)))

  // an empty sheet is all zeros, never NaN
  const empty = expenseSummary([])
  assert.deepEqual([empty.total, empty.propertyBills, empty.unitBills], [0, 0, 0])
  assert.equal(computeTotals([]).bills, 0)
})

test('one loan bill per building, enforced in ops whatever the route', () => {
  let state = makeState({
    properties: [buildFromTemplate('single', 'Solo'), buildFromTemplate('single', 'Other')],
  })
  const [p, q] = state.properties
  const mortgage = billNamed(p, 'Mortgage')
  const taxes = billNamed(p, 'Property taxes')

  assert.equal(loanCheck(p, mortgage.id).ok, true)
  state = setBillLoan(state, p.id, mortgage.id, { originalPrincipal: 300000, annualRatePercent: '6.5%', termMonths: 360 })
  const loan = billNamed(prop(state), 'Mortgage').loan
  assert.deepEqual(loan, {
    originalPrincipal: 300000,
    annualRatePercent: 6.5,
    termMonths: 360,
    firstPaymentDate: null,
    extraMonthlyPrincipal: 0,
  })
  assert.equal(loanBillOf(prop(state)).id, mortgage.id)

  // a second loan on the same building is refused, and nothing changes
  const check = loanCheck(prop(state), taxes.id)
  assert.equal(check.ok, false)
  assert.match(check.reason, /Mortgage/)
  assert.throws(() => setBillLoan(state, p.id, taxes.id, { originalPrincipal: 1 }), (e) => {
    assert.ok(e instanceof RuleError)
    assert.equal(e.code, 'one-loan')
    assert.match(e.message, /Solo already has loan terms on "Mortgage"/)
    return true
  })
  // ... by the bill patch, by a property patch, and by adding a bill that carries one
  assert.throws(() => patchPropertyBill(state, p.id, taxes.id, { loan: { originalPrincipal: 1 } }), RuleError)
  assert.throws(
    () => patchProperty(state, p.id, (x) => ({ bills: x.bills.map((b) => ({ ...b, loan: { termMonths: 1 } })) })),
    RuleError,
  )
  assert.throws(() => addPropertyBill(state, p.id, makeBill({ label: 'HELOC', loan: { originalPrincipal: 5 } })), RuleError)

  // the loan bill itself can still change its terms; partial terms merge
  state = setBillLoan(state, p.id, mortgage.id, { firstPaymentDate: '2026-01-01' })
  assert.equal(billNamed(prop(state), 'Mortgage').loan.originalPrincipal, 300000, 'earlier terms kept')
  assert.equal(billNamed(prop(state), 'Mortgage').loan.firstPaymentDate, '2026-01-01')
  // ... and another building has its own one
  state = setBillLoan(state, q.id, billNamed(q, 'Mortgage').id, { originalPrincipal: 90000 })
  assert.equal(loanBillCount(prop(state, 1)), 1)

  // taking the terms off frees the slot; the typed amount is never touched
  state = patchPropertyBill(state, p.id, mortgage.id, { amount: 2400 })
  state = setBillLoan(state, p.id, mortgage.id, null)
  assert.equal(billNamed(prop(state), 'Mortgage').loan, null)
  assert.equal(billNamed(prop(state), 'Mortgage').amount, 2400)
  assert.equal(loanBillOf(prop(state)), null)
  state = setBillLoan(state, p.id, taxes.id, { originalPrincipal: 1 })
  assert.equal(loanBillOf(prop(state)).id, taxes.id)

  // older data that already holds two loans can still be edited otherwise
  const legacy = makeState({
    properties: [
      {
        id: 'old',
        name: 'Old',
        bills: [
          { id: 'l1', label: 'First', amount: 1, loan: { originalPrincipal: 1 } },
          { id: 'l2', label: 'Second', amount: 1, loan: { originalPrincipal: 2 } },
        ],
      },
    ],
  })
  assert.equal(loanBillCount(prop(legacy)), 2, 'loaded as stored, never dropped')
  const renamed = patchPropertyBill(legacy, 'old', 'l1', { label: 'First lien' })
  assert.equal(prop(renamed).bills[0].label, 'First lien')
  assert.equal(prop(patchProperty(legacy, 'old', { name: 'Older' })).name, 'Older')
})

test('a loan bill with separate taxes or insurance gets a note, never a block', () => {
  let state = one('single', 'Solo')
  const p = prop(state)
  assert.deepEqual(escrowOverlap(p), [], 'no loan, no note')

  state = setBillLoan(state, p.id, billNamed(p, 'Mortgage').id, { originalPrincipal: 200000, termMonths: 360 })
  assert.deepEqual(escrowOverlap(prop(state)), [], 'taxes and insurance at $0 cannot be counted twice')

  state = patchPropertyBill(state, p.id, billNamed(p, 'Property taxes').id, { amount: 6000 })
  state = patchPropertyBill(state, p.id, billNamed(p, 'Insurance').id, { amount: 1500 })
  state = patchPropertyBill(state, p.id, billNamed(p, 'Water').id, { amount: 80 })
  assert.deepEqual(
    escrowOverlap(prop(state)).map((b) => b.label),
    ['Property taxes', 'Insurance'],
    'water is not an escrow item',
  )
  // nothing is blocked: both still count in the totals as typed
  assert.equal(computeTotals(state.properties).propertyBills, 6000 / 12 + 1500 / 12 + 80)
})

/** A store exactly as the v8 app wrote it: every kind of data, plus unknown fields. */
function v8Store() {
  return {
    version: 8,
    updatedAt: '2026-10-01T12:00:00.000Z',
    portfolios: [{ id: 'pf', name: 'Cleveland Heights', propertyIds: ['fairview', 'next-door'] }],
    scenarios: [
      {
        id: 'sc',
        portfolioId: 'pf',
        name: 'Refi',
        note: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        properties: [
          {
            id: 'sc-p',
            name: 'Copy',
            address: '',
            shape: 'flat',
            photo: null,
            photoSize: null,
            view: 'drawing',
            floors: [],
            bills: [{ id: 'sc-b', label: 'Mortgage', amount: 1800, cadence: 'monthly', dueDay: 1, paid: false }],
          },
        ],
      },
    ],
    properties: [
      {
        id: 'fairview',
        name: '2107 Fairview',
        address: '2107 Fairview, Cleveland Heights, OH',
        shape: 'mansard',
        photo: null,
        photoSize: null,
        view: 'drawing',
        extra: 42,
        bills: [
          { id: 'fv-mortgage', label: 'Mortgage', amount: 2400, cadence: 'monthly', dueDay: 1, paid: true },
          { id: 'fv-taxes', label: 'Property taxes', amount: 7200, cadence: 'yearly', dueDay: 1, paid: false, memo: 'keep' },
          { id: 'fv-ins', label: 'Insurance', amount: 0, cadence: 'yearly', dueDay: 1, paid: false },
        ],
        floors: [
          {
            id: 'fv-3f',
            label: '3F',
            units: [
              {
                id: 'fv-3f-left',
                name: '3F Left',
                position: 'left',
                widthWeight: 1.3,
                rent: 1450,
                status: 'leased',
                tenant: 'A. Tenant',
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                splittable: false,
                isSplit: false,
                splitRent: 0,
                sideOf: 'left',
                photoBox: null,
                payments: { '2026-09': { half: 'A', status: 'paid', amount: 1450, paidOn: '2026-09-02', note: '' } },
                bills: [{ id: 'gas', label: 'Gas', amount: 60, cadence: 'monthly', dueDay: 15, paid: false }],
                tasks: [{ id: 't1', text: 'Fix faucet', done: false, createdAt: '2026-08-01T00:00:00.000Z' }],
                notes: [{ id: 'n1', text: 'Called about heat', createdAt: '2026-08-02T00:00:00.000Z' }],
                mystery: 'keep me',
              },
              {
                id: 'fv-3f-right',
                name: '3F Right',
                position: 'right',
                widthWeight: 0.7,
                rent: 900,
                status: 'vacant',
                tenant: '',
                leaseStart: null,
                leaseEnd: null,
                splittable: false,
                isSplit: false,
                splitRent: 0,
                sideOf: 'left',
                photoBox: null,
                payments: {},
                bills: [],
                tasks: [],
                notes: [],
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
        floors: [],
      },
    ],
  }
}

test('a v8 store migrates to v9 with nothing lost, and no bill gains a loan it never had', () => {
  localStorage.removeItem(STORAGE_KEY)
  const stored = v8Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 8)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 10)
  assert.equal(r.warnings.length, 0)

  // every building, floor, unit, bill, record, and unknown field, byte for byte
  assert.deepEqual(r.state.properties, stored.properties)
  assert.deepEqual(r.state.portfolios, stored.portfolios)
  assert.deepEqual(r.state.scenarios, stored.scenarios)
  const bills = r.state.properties.flatMap((p) => [...p.bills, ...p.floors.flatMap((f) => f.units.flatMap((u) => u.bills))])
  assert.equal(bills.length, 4)
  assert.ok(bills.every((b) => !('loan' in b)), 'loan stays absent: no terms were ever typed')
  assert.equal(r.state.properties[0].bills[1].memo, 'keep', 'unknown bill field kept')

  // the totals read exactly as before
  assert.equal(computeTotals(r.state.properties).propertyBills, 2400 + 7200 / 12)

  // idempotent, and a save + reload is identical
  const once = migrate(stored).state
  assert.deepEqual(migrate(once).state, once)
  assert.equal(save(r.state).ok, true)
  assert.deepEqual(load().state.properties, r.state.properties)
})

test('loan terms survive a save, a reload, and an export / import; unknown fields kept, junk normalized', async () => {
  localStorage.removeItem(STORAGE_KEY)
  const stored = v8Store()
  stored.version = 9
  stored.properties[0].bills[0].loan = {
    originalPrincipal: '300,000',
    annualRatePercent: '6.5%',
    termMonths: '360',
    firstPaymentDate: '2026-01-01',
    extraMonthlyPrincipal: 200,
    lender: 'keep me', // unknown field
  }
  stored.properties[0].bills[2].loan = 'junk' // not terms: normalized to none
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  const [mortgage, taxes, insurance] = r.state.properties[0].bills
  assert.deepEqual(mortgage.loan, {
    originalPrincipal: 300000,
    annualRatePercent: 6.5,
    termMonths: 360,
    firstPaymentDate: '2026-01-01',
    extraMonthlyPrincipal: 200,
    lender: 'keep me',
  })
  assert.equal(mortgage.amount, 2400, 'the typed amount is never rewritten by the terms')
  assert.equal('loan' in taxes, false)
  assert.equal(insurance.loan, null)
  assert.equal(Object.keys(mortgage.loan).length, 6, 'nothing derived is stored on the loan')

  assert.equal(save(r.state).ok, true)
  assert.deepEqual(load().state.properties[0].bills[0].loan, mortgage.loan)

  // export, then import into a sheet that never had it
  const text = serialize(r.state)
  const empty = makeState({ properties: [] })
  const merged = await importJSON(text, empty)
  assert.deepEqual(merged.state.properties[0].bills[0].loan, mortgage.loan)
  // and into a sheet that has the same bill without terms: the file's terms land
  const bare = makeState(v8Store())
  const into = await importJSON(text, bare)
  assert.deepEqual(into.state.properties[0].bills[0].loan, mortgage.loan)
  assert.equal(into.state.properties[0].bills.length, 3, 'nothing removed')
})
