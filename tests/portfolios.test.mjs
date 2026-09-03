// The portfolio layer above buildings: a pre-v6 store gathered into one
// default portfolio with nothing lost, totals following the active
// portfolio, the last portfolio staying put, a building removal that names
// what it holds, and an export/import round trip across portfolios.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PORTFOLIO_NAME,
  SCHEMA_VERSION,
  makePortfolio,
  makeState,
  normalizeState,
} from '../src/data/schema.js'
import { STORAGE_KEY, importJSON, load, save, serialize } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  RuleError,
  addPortfolio,
  addProperty,
  describeContents,
  describePortfolio,
  patchUnit,
  portfolioOf,
  removePortfolio,
  removeProperty,
  renamePortfolio,
} from '../src/data/ops.js'
import { computeTotals } from '../src/data/totals.js'
import {
  activePortfolio,
  portfolioSummaries,
  propertiesOf,
  resolvePortfolioId,
} from '../src/lib/portfolios.js'

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

/** A building with one leased unit at `rent`, and some data on it. */
function building(name, rent) {
  const p = buildFromTemplate('duplex-stacked', name)
  p.floors[0].units[0].rent = rent
  p.floors[0].units[0].status = 'leased'
  p.floors[0].units[0].tenant = `${name} tenant`
  return p
}

/** A v5 store: buildings at the top level, no portfolios anywhere. */
function v5Store() {
  return {
    version: 5,
    updatedAt: '2026-09-01T12:00:00.000Z',
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
                bills: [{ id: 'ub1', label: 'Gas', amount: 60, cadence: 'monthly', dueDay: 15 }],
                tasks: [{ id: 't1', text: 'Fix faucet', done: false }],
                notes: [{ id: 'n1', text: 'Called about heat' }],
              },
              { id: 'u2', name: '3F Right', position: 'right', rent: 900, status: 'vacant' },
            ],
          },
        ],
      },
      { id: 'next-door', name: 'Next door', floors: [{ id: 'f1', label: '1F', units: [{ id: 'u3', rent: 800 }] }] },
    ],
  }
}

test('a pre-v6 store gathers into one default portfolio with nothing lost', () => {
  localStorage.removeItem(STORAGE_KEY)
  const stored = v5Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 5)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 8)
  assert.equal(r.warnings.length, 0)

  // one portfolio, named, holding every building that was already there
  assert.equal(r.state.portfolios.length, 1)
  const f = r.state.portfolios[0]
  assert.equal(f.name, DEFAULT_PORTFOLIO_NAME)
  assert.deepEqual(f.propertyIds, ['fairview', 'next-door'], 'in the order they were stored')
  assert.ok(f.id, 'the portfolio has an id')

  // the buildings did not move: same place, same values
  assert.equal(r.state.properties.length, 2)
  assert.equal(r.state.properties[0].id, 'fairview')
  const p = r.state.properties[0]
  assert.equal(p.photo, 'data:image/jpeg;base64,AAAA', 'photo')
  assert.deepEqual(p.photoSize, { w: 1200, h: 800 })
  assert.equal(p.view, 'photo')
  assert.equal(p.extra, 42, 'unknown field kept')
  assert.deepEqual(p.bills, stored.properties[0].bills)

  const u = p.floors[0].units[0]
  const su = stored.properties[0].floors[0].units[0]
  assert.equal(u.rent, 1450)
  assert.equal(u.tenant, 'A. Tenant')
  assert.equal(u.leaseEnd, '2026-12-31')
  assert.equal(u.widthWeight, 1.7, 'unit width kept')
  assert.deepEqual(u.photoBox, su.photoBox, 'box position')
  assert.equal(u.bills.length, 1, 'unit bill')
  assert.equal(u.bills[0].id, su.bills[0].id)
  assert.equal(u.bills[0].amount, 60)
  assert.equal(u.bills[0].label, 'Gas')
  assert.deepEqual(u.tasks[0].text, 'Fix faucet')
  assert.deepEqual(u.notes[0].text, 'Called about heat')
  assert.equal(u.mystery, 'keep me', 'unknown unit field kept')

  // and a save/reload keeps the portfolio it was given (no new id each load)
  assert.equal(save(r.state).ok, true)
  const again = load()
  assert.equal(again.state.portfolios.length, 1)
  assert.equal(again.state.portfolios[0].id, f.id)
  assert.deepEqual(again.state.portfolios[0].propertyIds, ['fairview', 'next-door'])
})

test('every building is in exactly one portfolio, whatever the stored lists say', () => {
  // a building claimed twice, a dead id, and a building claimed by nobody
  const s = normalizeState({
    version: 6,
    properties: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    portfolios: [
      { id: 'p1', name: 'One', propertyIds: ['a', 'gone', 'b'] },
      { id: 'p2', name: 'Two', propertyIds: ['b'] },
    ],
  })
  assert.deepEqual(s.portfolios[0].propertyIds, ['a', 'b', 'c'], 'first claim wins, orphans adopted')
  assert.deepEqual(s.portfolios[1].propertyIds, [])
  assert.equal(portfolioOf(s, 'c').id, 'p1')
  assert.equal(s.properties.length, 3, 'no building was dropped')

  // an empty sheet still has a portfolio to draw on
  const empty = normalizeState({ version: 6, properties: [], portfolios: [] })
  assert.equal(empty.portfolios.length, 1)
  assert.equal(empty.portfolios[0].name, DEFAULT_PORTFOLIO_NAME)
})

test('switching portfolios changes what the totals cover', () => {
  let state = makeState({ properties: [building('A', 1000), building('B', 2000)] })
  const home = state.portfolios[0]
  const other = makePortfolio({ name: 'Out of state' })
  state = addPortfolio(state, other)
  state = addProperty(state, building('C', 5000), other.id)

  assert.deepEqual(
    portfolioSummaries(state).map((s) => [s.name, s.buildings, s.units]),
    [
      [DEFAULT_PORTFOLIO_NAME, 2, 4],
      ['Out of state', 1, 2],
    ],
  )

  const here = computeTotals(propertiesOf(state, home.id))
  const there = computeTotals(propertiesOf(state, other.id))
  assert.equal(here.collected, 3000, 'the active portfolio only')
  assert.equal(here.properties, 2)
  assert.equal(there.collected, 5000)
  assert.equal(there.properties, 1)
  assert.notEqual(here.collected, there.collected, 'switching changes the totals')
  assert.equal(computeTotals(state.properties).collected, 8000, 'the whole sheet is the sum of both')

  // resolving a selection: a known id stays, junk falls back to the first
  assert.equal(resolvePortfolioId(state, other.id), other.id)
  assert.equal(resolvePortfolioId(state, 'nope'), home.id)
  assert.equal(activePortfolio(state, other.id).name, 'Out of state')

  // renaming is just a name; nothing else moves
  const renamed = renamePortfolio(state, home.id, 'Cleveland Heights')
  assert.equal(activePortfolio(renamed, home.id).name, 'Cleveland Heights')
  assert.equal(computeTotals(propertiesOf(renamed, home.id)).collected, 3000)
  assert.equal(activePortfolio(state, home.id).name, DEFAULT_PORTFOLIO_NAME, 'input untouched')
})

test('the last portfolio cannot be removed; one with buildings needs a confirm', () => {
  let state = makeState({ properties: [building('A', 1000)] })
  const home = state.portfolios[0]

  assert.throws(() => removePortfolio(state, home.id), RuleError)
  assert.throws(() => removePortfolio(state, home.id), /always at least one portfolio/)
  assert.throws(() => removePortfolio(state, home.id, { force: true }), /always at least one portfolio/)

  const other = makePortfolio({ name: 'Future' })
  state = addPortfolio(state, other)
  assert.equal(state.portfolios.length, 2)

  // an empty one goes without ceremony
  const gone = removePortfolio(state, other.id)
  assert.equal(gone.portfolios.length, 1)
  assert.equal(gone.properties.length, 1, 'and takes no buildings with it')

  // one with buildings names what would go, and only goes when forced
  const d = describePortfolio(state, home.id)
  assert.equal(d.buildings, 1)
  assert.equal(d.units, 2)
  assert.match(d.text, /1 building/)
  assert.match(d.text, /2 units/)
  assert.match(d.text, /1 with rent/)
  assert.throws(() => removePortfolio(state, home.id), /holds 1 building/)
  assert.equal(state.properties.length, 1, 'the refused removal changed nothing')

  const forced = removePortfolio(state, home.id, { force: true })
  assert.equal(forced.portfolios.length, 1)
  assert.equal(forced.portfolios[0].id, other.id)
  assert.equal(forced.properties.length, 0, 'its buildings went with it')
  assert.equal(describePortfolio(state, other.id).text, 'It holds no buildings.')
})

test('removing a building names exactly what it holds', () => {
  let state = makeState({ properties: [buildFromTemplate('fourplex', 'Corner')] })
  const property = state.properties[0]
  const [a, b] = property.floors[0].units

  // an untouched building holds nothing worth naming: the template's four
  // building bills are all at 0
  const fresh = describeContents(state.properties[0])
  assert.equal(fresh.units, 4)
  assert.equal(fresh.holdsData, false)
  assert.match(fresh.text, /4 units, none with rent, tenants, bills, list items or notes\./)
  assert.throws(() => removeProperty(state, property.id), RuleError, 'still refused by default')

  state = patchUnit(state, a.id, { rent: 1200, tenant: 'A. Tenant', status: 'leased' })
  state = patchUnit(state, b.id, { splitRent: 700, splittable: true, isSplit: true })
  state = patchUnit(state, a.id, (u) => ({ notes: [...u.notes, { text: 'Painted' }] }))
  state = patchUnit(state, b.id, (u) => ({ tasks: [...u.tasks, { text: 'Fix door' }] }))
  state = patchUnit(state, a.id, (u) => ({ bills: [...u.bills, { label: 'Gas', amount: 60 }] }))

  const d = describeContents(state.properties[0])
  assert.equal(d.units, 4)
  assert.equal(d.withRent, 2, 'a split unit with only a second rent counts')
  assert.equal(d.tenants, 1)
  assert.equal(d.bills, 1)
  assert.equal(d.tasks, 1)
  assert.equal(d.notes, 1)
  assert.equal(d.holdsData, true)
  assert.equal(d.short, '4 units')
  assert.equal(d.text, '4 units · 2 with rent · 1 tenant · 1 bill · 1 list item · 1 note.')

  // it takes an explicit, forced removal — and then the portfolio drops it
  assert.throws(() => removeProperty(state, property.id), /Confirm the removal/)
  assert.equal(state.properties.length, 1)
  const removed = removeProperty(state, property.id, { force: true })
  assert.equal(removed.properties.length, 0)
  assert.deepEqual(removed.portfolios[0].propertyIds, [], 'the id left the portfolio')
  assert.equal(removed.portfolios.length, 1, 'the portfolio itself stays')

  // an empty building still goes with no force at all
  const emptyBuilding = makeState({ properties: [{ id: 'E', name: 'Empty', floors: [] }] })
  assert.equal(removeProperty(emptyBuilding, 'E').properties.length, 0)
})

test('export writes every portfolio and import merges them by id', async () => {
  // two portfolios here, and a file that knows one of them plus a new one
  let mine = makeState({ properties: [building('A', 1000)] })
  const home = mine.portfolios[0]
  const away = makePortfolio({ id: 'away', name: 'Out of state' })
  mine = addPortfolio(mine, away)
  mine = addProperty(mine, building('B', 2000), away.id)

  const text = serialize(mine)
  const written = JSON.parse(text)
  assert.equal(written.portfolios.length, 2, 'the export carries every portfolio')
  assert.deepEqual(
    written.portfolios.map((f) => f.name),
    [DEFAULT_PORTFOLIO_NAME, 'Out of state'],
  )
  assert.equal(written.properties.length, 2, 'and every building, not just the active one')

  // a file with: a rent change in an existing portfolio's building, the same
  // portfolio renamed, and a third portfolio with a building of its own
  const file = JSON.parse(text)
  file.properties[0].floors[0].units[0].rent = 1111
  file.portfolios[1].name = 'Away'
  const extra = building('C', 3000)
  file.properties.push(extra)
  file.portfolios.push({ id: 'third', name: 'Third', propertyIds: [extra.id] })

  const { state, report } = await importJSON(file, mine)

  assert.equal(state.portfolios.length, 3, 'the new portfolio arrived')
  assert.equal(state.properties.length, 3)
  assert.equal(report.portfolios.added, 1)
  assert.equal(report.portfolios.updated, 1, 'the rename')
  assert.equal(report.properties.updated, 1)
  assert.equal(report.properties.added, 1)

  assert.equal(activePortfolio(state, away.id).name, 'Away', 'the file renamed it')
  assert.equal(computeTotals(propertiesOf(state, home.id)).collected, 1111, 'rent merged')
  assert.equal(computeTotals(propertiesOf(state, 'third')).collected, 3000)
  assert.equal(computeTotals(state.properties).collected, 1111 + 2000 + 3000)

  // nothing is ever removed by an import: a portfolio the file never mentions
  // keeps its buildings, and a round trip through JSON is stable
  const solo = makeState({ properties: [building('Z', 400)] })
  const { state: merged } = await importJSON(JSON.parse(serialize(mine)), solo)
  assert.equal(merged.properties.length, 3, 'its own building plus both from the file')
  assert.equal(merged.portfolios.length, 3)
  assert.equal(computeTotals(merged.properties).collected, 400 + 1000 + 2000)
  for (const p of merged.properties) {
    assert.ok(portfolioOf(merged, p.id), `${p.name} is in a portfolio`)
  }
})
