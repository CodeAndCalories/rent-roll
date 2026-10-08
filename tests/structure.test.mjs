// Structural writes behind the Build handles on the drawing: adding a floor,
// adding a unit, hanging a side annex, the empty-unit and empty-floor guards,
// renaming, and the unit-count stepper (add or remove at the right in one
// go, never a unit that holds anything). Every one of these goes through
// ops.js, so the rules hold whatever the UI does. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeState } from '../src/data/schema.js'
import { load, save, STORAGE_KEY } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
  MAX_FLOOR_UNITS,
  RuleError,
  addFloor,
  addSideAnnex,
  addUnit,
  countUnits,
  isEmptyUnit,
  nextFloorLabel,
  patchUnit,
  removeFloor,
  removeUnit,
  renameFloor,
  setFloorUnitCount,
  setPayment,
  setUnitWidths,
  sideAnnexCheck,
} from '../src/data/ops.js'
import { drawnUnits } from '../src/lib/widths.js'

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

const one = (templateId, name = 'Test') =>
  makeState({ properties: [buildFromTemplate(templateId, name)] })
const prop = (state) => state.properties[0]
const positions = (floor) => floor.units.map((u) => u.position)

test('add floor: goes on top, labelled off the old top floor, with one unit', () => {
  const before = one('triplex', 'Stack') // 3F / 2F / 1F, top first
  const id = prop(before).id
  const after = addFloor(before, id)
  const floors = prop(after).floors

  assert.equal(floors.length, 4)
  assert.equal(floors[0].label, '4F', 'the new floor is on top and numbered from it')
  assert.equal(floors[0].units.length, 1)
  assert.equal(floors[0].units[0].name, '4F')
  assert.equal(floors[0].units[0].position, 'full')
  assert.equal(floors[0].units[0].rent, 0)
  assert.deepEqual(
    floors.slice(1).map((f) => f.id),
    prop(before).floors.map((f) => f.id),
    'the floors that were there keep their ids and order',
  )
  assert.equal(prop(before).floors.length, 3, 'the input state is untouched')

  // a second one keeps counting, and unnumbered labels fall back to a count
  assert.equal(prop(addFloor(after, id)).floors[0].label, '5F')
  assert.equal(nextFloorLabel([{ label: 'Street' }]), '2F')
  assert.equal(nextFloorLabel([]), '1F')

  // the label is read off the TOP floor, not counted: Basement / 1F / 2F
  // (top first: 2F, 1F, Basement) gets 3F, where a count would say 4F
  const cellar = [{ label: '2F' }, { label: '1F' }, { label: 'Basement' }]
  assert.equal(nextFloorLabel(cellar), '3F')
  const withBasement = makeState({
    properties: [{ id: 'B', name: 'Cellar', floors: cellar.map((f) => ({ ...f, units: [] })) }],
  })
  assert.equal(prop(addFloor(withBasement, 'B')).floors[0].label, '3F')

  // ids are fresh every time
  const a = addFloor(before, id)
  const b = addFloor(before, id)
  assert.notEqual(prop(a).floors[0].id, prop(b).floors[0].id)
  assert.notEqual(prop(a).floors[0].units[0].id, prop(b).floors[0].units[0].id)
})

test('add unit (the + tab): appends on the right, full -> left + right -> left, full, right', () => {
  let state = one('single', 'Solo') // one floor, one full unit
  const id = prop(state).id
  const floorId = prop(state).floors[0].id

  state = addUnit(state, id, floorId)
  assert.equal(countUnits(prop(state)), 2)
  assert.deepEqual(positions(prop(state).floors[0]), ['left', 'right'])
  assert.equal(prop(state).floors[0].units[1].name, '1F 2', 'named off the floor label')

  state = addUnit(state, id, floorId)
  assert.equal(countUnits(prop(state)), 3)
  assert.deepEqual(positions(prop(state).floors[0]), ['left', 'full', 'right'], 'the third is drawn on the right')
  assert.deepEqual(
    drawnUnits(prop(state).floors[0]).map((u) => u.name),
    ['Main', '1F 2', '1F 3'],
    'left to right in the order they were added',
  )

  // the + tab and the stepper agree, unit for unit
  const base = one('single', 'Same')
  const [bid, bfid] = [prop(base).id, prop(base).floors[0].id]
  const viaTab = addUnit(addUnit(addUnit(base, bid, bfid), bid, bfid), bid, bfid)
  const viaStepper = setFloorUnitCount(base, bid, bfid, 4)
  assert.equal(countUnits(prop(viaTab)), 4)
  assert.deepEqual(positions(prop(viaTab).floors[0]), ['left', 'full', 'full', 'right'])
  assert.deepEqual(positions(prop(viaTab).floors[0]), positions(prop(viaStepper).floors[0]))
  assert.deepEqual(drawnNames(prop(viaTab).floors[0]), drawnNames(prop(viaStepper).floors[0]))
  assert.deepEqual(drawnNames(prop(viaTab).floors[0]), ['Main', '1F 2', '1F 3', '1F 4'])

  // an unknown floor or property is a no-op, never a throw
  assert.equal(countUnits(prop(addUnit(state, id, 'nope'))), 3)
  assert.equal(addUnit(state, 'nope', floorId), state)
})

test('add annex: bottom floor only, one per building, and a bad add is rejected', () => {
  let state = one('duplex-stacked', 'Two up') // 2F / 1F
  const id = prop(state).id

  state = addSideAnnex(state, id, 'right')
  const bottom = prop(state).floors[1]
  const annex = bottom.units.find((u) => u.position === 'side')
  assert.ok(annex, 'the annex hangs off the bottom floor')
  assert.equal(annex.sideOf, 'right')
  assert.equal(bottom.units.length, 2)
  assert.deepEqual(positions(bottom), ['full', 'side'], 'the main unit still has the floor')
  assert.equal(prop(state).floors[0].units.every((u) => u.position !== 'side'), true)
  assert.equal(sideAnnexCheck(state, annex.id).ok, true)

  // a second annex on the same building is refused and changes nothing
  assert.throws(() => addSideAnnex(state, id), RuleError)
  assert.throws(() => addSideAnnex(state, id), /already has a side annex/)
  const upper = prop(state).floors[0].units[0]
  assert.throws(() => patchUnit(state, upper.id, { position: 'side' }), /bottom floor/)
  assert.equal(countUnits(prop(state)), 3, 'the refused writes left the building alone')

  // remove it and the building can have one again, defaulting to the left
  const cleared = removeUnit(state, annex.id)
  assert.equal(countUnits(prop(cleared)), 2)
  assert.equal(prop(addSideAnnex(cleared, id)).floors[1].units[1].sideOf, 'left')

  // no floors to hang it off
  const empty = makeState({ properties: [{ id: 'P', name: 'Nothing', floors: [] }] })
  assert.throws(() => addSideAnnex(empty, 'P'), /Add a floor/)
})

test('empty-unit guard: a unit holding anything cannot be removed', () => {
  const base = one('duplex-side', 'Pair') // one floor, left + right
  const id = prop(base).id
  const floorId = prop(base).floors[0].id
  const [left, right] = prop(base).floors[0].units

  const holds = [
    { rent: 1200 },
    { splitRent: 700 },
    { tenant: 'A. Tenant' },
    { bills: [{ label: 'Water', amount: 40 }] },
    { tasks: [{ text: 'Fix the door' }] },
    { notes: [{ text: 'Painted in June' }] },
  ]
  for (const patch of holds) {
    const dirty = patchUnit(base, left.id, patch)
    assert.equal(isEmptyUnit(dirty.properties[0].floors[0].units[0]), false, JSON.stringify(patch))
    assert.throws(() => removeUnit(dirty, left.id), RuleError, JSON.stringify(patch))
    assert.throws(() => removeUnit(dirty, left.id), /Clear it in the unit panel first/)
    assert.equal(countUnits(prop(dirty)), 2, 'the refused removal left both units in place')
  }

  // whitespace is not a tenant, and a zero rent is not a value
  assert.equal(isEmptyUnit(patchUnit(base, left.id, { tenant: '  ' }).properties[0].floors[0].units[0]), true)

  // an empty unit goes, and the survivor takes the whole floor
  const after = removeUnit(base, left.id)
  assert.equal(countUnits(prop(after)), 1)
  assert.deepEqual(positions(prop(after).floors[0]), ['full'])
  assert.equal(prop(after).floors[0].units[0].id, right.id)
  assert.equal(countUnits(prop(base)), 2, 'the input state is untouched')

  // an unknown unit is a no-op
  assert.equal(removeUnit(base, 'nope'), base)

  // a floor with units on it cannot go; once emptied it can
  assert.throws(() => removeFloor(after, id, floorId), RuleError)
  assert.throws(() => removeFloor(after, id, floorId), /still has units/)
  const bare = removeUnit(after, right.id)
  assert.equal(prop(removeFloor(bare, id, floorId)).floors.length, 0)
})

test('renaming a unit or a floor survives a save and reload', () => {
  localStorage.removeItem(STORAGE_KEY)
  let state = one('duplex-stacked', 'Fairview')
  const id = prop(state).id
  const floor = prop(state).floors[1]
  const unit = floor.units[0]

  state = renameFloor(state, id, floor.id, 'Street')
  state = patchUnit(state, unit.id, { name: 'Storefront' })
  state = patchUnit(state, unit.id, { rent: 1450, status: 'leased' })
  assert.equal(save(state).ok, true)

  const reloaded = load()
  assert.equal(reloaded.source, 'storage')
  const back = reloaded.state.properties[0]
  assert.equal(back.floors[1].label, 'Street')
  assert.equal(back.floors[1].units[0].name, 'Storefront')
  assert.equal(back.floors[1].units[0].id, unit.id, 'renaming never re-ids a unit')
  assert.equal(back.floors[1].units[0].rent, 1450)
  assert.equal(back.floors[0].label, '2F', 'the other floor is untouched')

  // an empty label is stored as given, not dropped or defaulted
  const blanked = renameFloor(reloaded.state, id, floor.id, '   ')
  assert.equal(save(blanked).ok, true)
  assert.equal(load().state.properties[0].floors[1].label, '   ')
  assert.equal(load().state.properties[0].floors[1].units[0].name, 'Storefront')
})

// ---------------------------------------------------------------------------
// the unit-count stepper
// ---------------------------------------------------------------------------

const drawnNames = (floor) => drawnUnits(floor).map((u) => u.name)

test('stepper: a floor goes to 4 units in one write, new ones on the right', () => {
  const before = one('single', 'Solo') // 1F, one unit named "Main"
  const id = prop(before).id
  const floorId = prop(before).floors[0].id
  const first = prop(before).floors[0].units[0]

  const after = setFloorUnitCount(before, id, floorId, 4)
  const floor = prop(after).floors[0]
  assert.equal(floor.units.length, 4)
  assert.deepEqual(drawnNames(floor), ['Main', '1F 2', '1F 3', '1F 4'], 'left to right as drawn')
  assert.deepEqual(positions(floor), ['left', 'full', 'full', 'right'])
  assert.equal(drawnUnits(floor)[0].id, first.id, 'the unit that was there stays leftmost, same id')
  assert.equal(new Set(floor.units.map((u) => u.id)).size, 4, 'fresh ids')
  assert.ok(floor.units.slice(1).every((u) => isEmptyUnit(u) && u.status === 'vacant'), 'new units are blank')
  assert.equal(countUnits(prop(before)), 1, 'the input state is untouched')

  // the count it already has is the very same state; junk is refused
  assert.equal(setFloorUnitCount(after, id, floorId, 4), after)
  assert.throws(() => setFloorUnitCount(after, id, floorId, MAX_FLOOR_UNITS + 1), /0 to 12 units/)
  assert.throws(() => setFloorUnitCount(after, id, floorId, 2.5), RuleError)
  assert.throws(() => setFloorUnitCount(after, id, floorId, -1), RuleError)
  assert.equal(setFloorUnitCount(after, id, 'nope', 2), after, 'an unknown floor is a no-op')

  // a floor stored the old way (a third unit appended as 'full', so drawn
  // in the middle) keeps its look, and both + and the stepper add at the
  // right of what is drawn
  const legacy = makeState({
    properties: [
      {
        id: 'L',
        name: 'Legacy',
        floors: [
          {
            id: 'LF',
            label: '1F',
            units: [
              { id: 'u1', name: 'A', position: 'left' },
              { id: 'u2', name: 'B', position: 'right' },
              { id: 'u3', name: 'C', position: 'full' },
            ],
          },
        ],
      },
    ],
  })
  assert.deepEqual(drawnNames(prop(legacy).floors[0]), ['A', 'C', 'B'])
  assert.deepEqual(drawnNames(prop(addUnit(legacy, 'L', 'LF')).floors[0]), ['A', 'C', 'B', '1F 4'])
  let tabbed = one('single', 'Tabbed')
  const tid = prop(tabbed).id
  const tf = prop(tabbed).floors[0].id
  tabbed = addUnit(addUnit(tabbed, tid, tf), tid, tf)
  const drawnBefore = drawnUnits(prop(tabbed).floors[0]).map((u) => u.id)
  const grown = setFloorUnitCount(tabbed, tid, tf, 5)
  const drawnAfter = drawnUnits(prop(grown).floors[0]).map((u) => u.id)
  assert.deepEqual(drawnAfter.slice(0, 3), drawnBefore, 'nothing already there moves')
  assert.equal(drawnAfter.length, 5)
})

test('stepper: down from the right, and never a unit that holds anything', () => {
  let state = one('single', 'Solo')
  const id = prop(state).id
  const floorId = prop(state).floors[0].id
  state = setFloorUnitCount(state, id, floorId, 4)
  const [a, b, c, d] = drawnUnits(prop(state).floors[0])

  // widths ride with their units
  state = setUnitWidths(state, id, floorId, { [a.id]: 1.4, [b.id]: 0.6 })

  // empty units on the right go; the survivors keep their order and widths
  const two = setFloorUnitCount(state, id, floorId, 2)
  const kept = drawnUnits(prop(two).floors[0])
  assert.deepEqual(kept.map((u) => u.id), [a.id, b.id], 'removed from the right')
  assert.deepEqual(positions(prop(two).floors[0]), ['left', 'right'])
  assert.deepEqual(kept.map((u) => u.widthWeight), [1.4, 0.6])

  // anything at all on a unit in the way stops the whole write, and says why
  const holds = [
    ['rent', { rent: 950 }],
    ['a tenant', { tenant: 'B. Tenant' }],
    ['1 note', { notes: [{ text: 'Keys with the super' }] }],
    ['1 list item', { tasks: [{ text: 'Paint' }] }],
    ['1 bill', { bills: [{ label: 'Gas', amount: 30 }] }],
  ]
  for (const [what, patch] of holds) {
    const dirty = patchUnit(state, c.id, patch)
    assert.throws(
      () => setFloorUnitCount(dirty, id, floorId, 1),
      (e) => {
        assert.ok(e instanceof RuleError, what)
        assert.equal(e.code, 'not-empty')
        assert.ok(e.message.includes(`1F 3 has ${what}`), e.message)
        assert.match(e.message, /can go down to 3 units at the least/)
        return true
      },
    )
    // the empty unit to its right can still go on its own
    assert.equal(countUnits(prop(setFloorUnitCount(dirty, id, floorId, 3))), 3)
  }

  // a payment record counts too, even with no rent on the unit
  const paid = setPayment(state, d.id, '2026-09', 'A', { status: 'paid' })
  assert.throws(() => setFloorUnitCount(paid, id, floorId, 3), /1F 4 has 1 payment record/)
  assert.throws(() => setFloorUnitCount(paid, id, floorId, 0), RuleError)
  assert.equal(countUnits(prop(paid)), 4, 'a refused write changes nothing')

  // all empty: the floor can go to zero, and a floor with nothing can then be removed
  const none = setFloorUnitCount(state, id, floorId, 0)
  assert.equal(prop(none).floors[0].units.length, 0)
  assert.equal(prop(removeFloor(none, id, floorId)).floors.length, 0)
})

test('stepper: the side annex is not counted and never touched', () => {
  let state = one('single', 'Shop')
  const id = prop(state).id
  const floorId = prop(state).floors[0].id
  state = addSideAnnex(state, id, 'left')
  const annex = prop(state).floors[0].units.find((u) => u.position === 'side')
  state = patchUnit(state, annex.id, { rent: 1800, tenant: 'Storefront Co' })

  state = setFloorUnitCount(state, id, floorId, 3)
  let floor = prop(state).floors[0]
  assert.equal(floor.units.length, 4, 'three main units plus the annex')
  assert.equal(drawnUnits(floor).length, 3)
  assert.equal(floor.units[1].id, annex.id, 'the annex keeps its slot')

  // the annex holds data, but it is not in the count, so going down is fine
  state = setFloorUnitCount(state, id, floorId, 1)
  floor = prop(state).floors[0]
  assert.deepEqual(positions(floor), ['full', 'side'])
  assert.equal(floor.units[1].rent, 1800)
  assert.equal(sideAnnexCheck(state, annex.id).ok, true)
})
