// Portfolio behaviour: empty first run, templates, the side-annex and
// splittable rules in the data layer, building selection, and totals that
// stay portfolio-wide. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, makeState } from '../src/data/schema.js'
import { load, save, STORAGE_KEY } from '../src/data/store.js'
import { TEMPLATES, buildFromTemplate, getTemplate, templateSummary } from '../src/data/templates.js'
import {
  RuleError,
  countUnits,
  patchProperty,
  patchUnit,
  removeProperty,
  setSideAnnex,
  setSplittable,
  sideAnnexCheck,
} from '../src/data/ops.js'
import { computeTotals } from '../src/data/totals.js'
import {
  ALL,
  SIDE_BY_SIDE_MAX,
  defaultSelection,
  displayedProperties,
  resolveSelection,
} from '../src/lib/selection.js'

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

const unitsOf = (state) => state.properties.flatMap((p) => p.floors).flatMap((f) => f.units)

test('a fresh store starts with zero buildings and can be saved and reloaded', () => {
  localStorage.removeItem(STORAGE_KEY)
  const r = load()
  assert.equal(r.source, 'seed')
  assert.equal(r.state.properties.length, 0)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(save(r.state).ok, true, 'an empty sheet is a valid store')
  const again = load()
  assert.equal(again.source, 'storage')
  assert.equal(again.state.properties.length, 0)
})

test('every template builds the documented floors, units, and shape with fresh ids', () => {
  const expected = {
    single: [1, 1, 'gable'],
    'duplex-stacked': [2, 2, 'gable'],
    'duplex-side': [1, 2, 'gable'],
    triplex: [3, 3, 'flat'],
    fourplex: [2, 4, 'flat'],
    blank: [1, 1, 'flat'],
  }
  assert.deepEqual(
    TEMPLATES.map((t) => t.id),
    Object.keys(expected),
  )
  for (const t of TEMPLATES) {
    const [floors, units, shape] = expected[t.id]
    const s = templateSummary(t)
    assert.equal(s.floors, floors, `${t.id} floors`)
    assert.equal(s.units, units, `${t.id} units`)
    assert.equal(s.shape, shape, `${t.id} shape`)

    const p = buildFromTemplate(t.id, `Test ${t.name}`)
    assert.equal(p.name, `Test ${t.name}`)
    assert.equal(p.shape, shape)
    assert.equal(p.floors.length, floors)
    assert.equal(countUnits(p), units)
    assert.equal(p.bills.length, 4, 'standard building bills at 0')
    assert.ok(p.bills.every((b) => b.amount === 0))
    for (const f of p.floors) {
      assert.ok(f.id && f.label)
      for (const u of f.units) {
        assert.equal(u.rent, 0)
        assert.equal(u.status, 'vacant')
        assert.ok(u.id && u.name, 'named unit with id')
      }
    }
    const q = buildFromTemplate(t.id, 'again')
    assert.notEqual(p.id, q.id)
    assert.notEqual(p.floors[0].id, q.floors[0].id)
    assert.notEqual(p.floors[0].units[0].id, q.floors[0].units[0].id)
  }

  // the mixed-use building is gone: templates are common layouts only, and a
  // side annex is a per-unit toggle on the drawing, never shipped in one
  assert.equal(getTemplate('mixed-use'), null, 'the mixed-use template is removed')
  assert.ok(
    TEMPLATES.every((t) => !/mixed/i.test(t.id) && !/mixed/i.test(t.name)),
    'no mixed-use layout in the list',
  )
  assert.ok(
    TEMPLATES.every((t) => t.floors.every((f) => f.units.every((u) => u.position !== 'side'))),
    'no template ships a side annex',
  )
  assert.ok(
    TEMPLATES.every((t) => !templateSummary(t).annex),
    'and the picker never advertises one',
  )

  const four = buildFromTemplate('fourplex', 'Corner')
  assert.deepEqual(
    four.floors[0].units.map((u) => u.position),
    ['left', 'right'],
  )
  assert.throws(() => buildFromTemplate('nope', 'x'), /Unknown template/)
  assert.equal(buildFromTemplate('blank', '   ').name, 'Blank', 'blank name falls back to the template name')
})

test('side annex rule: bottom floor only, one per floor; a bad write is rejected', () => {
  // a fourplex whose bottom-floor rear unit has been turned into the annex
  const base = makeState({ properties: [buildFromTemplate('fourplex', 'Corner')] })
  let state = setSideAnnex(base, base.properties[0].floors[1].units[1].id, true)
  const p = state.properties[0]
  const upper = p.floors[0].units[0]
  const streetMain = p.floors[1].units[0]
  const storefront = p.floors[1].units[1]
  assert.deepEqual(
    p.floors[1].units.map((u) => u.position),
    ['full', 'side'],
    'the remaining main unit takes the whole floor',
  )

  // an upper-floor unit cannot become an annex
  assert.equal(sideAnnexCheck(state, upper.id).ok, false)
  assert.equal(sideAnnexCheck(state, upper.id).code, 'not-bottom')
  assert.throws(() => patchUnit(state, upper.id, { position: 'side' }), RuleError)
  assert.throws(() => setSideAnnex(state, upper.id, true), /bottom floor/)

  // the bottom floor already has one
  assert.equal(sideAnnexCheck(state, streetMain.id).code, 'taken')
  assert.throws(() => setSideAnnex(state, streetMain.id, true), /already has a side annex/)

  // unrelated writes to those units still work
  assert.equal(patchUnit(state, upper.id, { rent: 950 }).properties[0].floors[0].units[0].rent, 950)
  assert.equal(sideAnnexCheck(state, storefront.id).ok, true, 'the existing annex is fine as is')

  // turn it off: it becomes a main unit and the floor relays out to left / right
  state = setSideAnnex(state, storefront.id, false)
  let street = state.properties[0].floors[1]
  assert.deepEqual(
    street.units.map((u) => u.position),
    ['left', 'right'],
  )

  // now the other unit may become the annex; the remaining main unit becomes full
  assert.equal(sideAnnexCheck(state, streetMain.id).ok, true)
  state = setSideAnnex(state, streetMain.id, true)
  street = state.properties[0].floors[1]
  assert.deepEqual(
    street.units.map((u) => u.position),
    ['side', 'full'],
  )

  // a property patch that would add a violation is rejected; a harmless one is not
  assert.throws(() => patchProperty(state, p.id, (pp) => ({ floors: [...pp.floors].reverse() })), RuleError)
  assert.equal(patchProperty(state, p.id, { name: 'Renamed' }).properties[0].name, 'Renamed')

  // inputs were never mutated
  assert.equal(p.floors[1].units[1].position, 'side')
  assert.equal(p.floors[1].units[0].position, 'full')
})

test('older data that already breaks the annex rule can still be edited', () => {
  const legacy = makeState({
    properties: [
      {
        id: 'L',
        name: 'Legacy',
        floors: [
          { id: 'f2', label: '2F', units: [{ id: 'a', name: 'A', position: 'side' }] },
          { id: 'f1', label: '1F', units: [{ id: 'b', name: 'B' }] },
        ],
      },
    ],
  })
  assert.equal(patchProperty(legacy, 'L', { address: 'x' }).properties[0].address, 'x')
  assert.equal(patchUnit(legacy, 'a', { rent: 100 }).properties[0].floors[0].units[0].rent, 100)
})

test('splittable off clears isSplit and keeps splitRent; isSplit needs splittable', () => {
  let state = makeState({ properties: [buildFromTemplate('single', 'Solo')] })
  const id = unitsOf(state)[0].id

  state = setSplittable(state, id, true)
  state = patchUnit(state, id, { isSplit: true, rent: 900, splitRent: 850 })
  assert.equal(unitsOf(state)[0].isSplit, true)
  assert.equal(computeTotals(state.properties).potential, 1750)

  state = setSplittable(state, id, false)
  const u = unitsOf(state)[0]
  assert.equal(u.splittable, false)
  assert.equal(u.isSplit, false, 'forced off')
  assert.equal(u.splitRent, 850, 'second rent kept, just not counted')
  assert.equal(computeTotals(state.properties).potential, 900)

  // the plain patch form is enforced the same way
  state = patchUnit(state, id, { splittable: true, isSplit: true })
  assert.equal(unitsOf(state)[0].isSplit, true)
  state = patchUnit(state, id, { splittable: false })
  assert.equal(unitsOf(state)[0].isSplit, false)

  // isSplit on a unit that is not splittable is dropped
  state = patchUnit(state, id, { isSplit: true })
  assert.equal(unitsOf(state)[0].isSplit, false)
})

test('totals stay portfolio-wide while a single building is displayed', () => {
  const props = ['A', 'B', 'C', 'D', 'E'].map((n, i) => {
    const p = buildFromTemplate('duplex-stacked', n)
    p.floors[0].units[0].rent = 1000 + i * 100
    p.floors[0].units[0].status = 'leased'
    return p
  })
  assert.equal(SIDE_BY_SIDE_MAX, 3)
  assert.equal(defaultSelection(props), props[0].id, 'more than 3 buildings -> one at a time')
  assert.equal(defaultSelection(props.slice(0, 3)), ALL, '3 or fewer -> side by side')
  assert.equal(defaultSelection([]), ALL)

  const selection = resolveSelection(props, null)
  const displayed = displayedProperties(props, selection)
  assert.equal(displayed.length, 1)
  assert.equal(displayed[0].id, props[0].id)

  const all = computeTotals(props)
  const one = computeTotals(displayed)
  assert.equal(all.collected, 1000 + 1100 + 1200 + 1300 + 1400)
  assert.equal(all.properties, 5)
  assert.equal(all.units, 10)
  assert.equal(one.collected, 1000)
  assert.notEqual(all.collected, one.collected, 'the title block must be fed the whole portfolio')

  assert.equal(resolveSelection(props, ALL), ALL, 'an explicit All is honoured even with many buildings')
  assert.equal(resolveSelection(props, props[3].id), props[3].id)
  assert.equal(resolveSelection(props, 'gone'), props[0].id, 'a removed building falls back')
  assert.deepEqual(displayedProperties(props, ALL), props)
  assert.deepEqual(displayedProperties([], ALL), [])
})

test('removing buildings: refused with units, allowed when empty, the last one can go', () => {
  let state = makeState({ properties: [buildFromTemplate('single', 'A')] })
  const id = state.properties[0].id
  assert.throws(() => removeProperty(state, id), RuleError)
  assert.equal(save(state).ok, true)

  const emptied = patchProperty(state, id, { floors: [] })
  const gone = removeProperty(emptied, id)
  assert.equal(gone.properties.length, 0)

  // storage still holds a unit -> an empty sheet is refused
  assert.equal(save(gone).ok, false)
  // once the stored building has no units, the empty sheet may be written
  assert.equal(save(emptied).ok, true)
  assert.equal(save(gone).ok, true)
  assert.equal(load().state.properties.length, 0)
})
