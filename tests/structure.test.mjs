// Structural writes behind the Build handles on the drawing: adding a floor,
// adding a unit, hanging a side annex, the empty-unit and empty-floor guards,
// and renaming. Every one of these goes through ops.js, so the rules hold
// whatever the UI does. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeState } from '../src/data/schema.js'
import { load, save, STORAGE_KEY } from '../src/data/store.js'
import { buildFromTemplate } from '../src/data/templates.js'
import {
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
  sideAnnexCheck,
} from '../src/data/ops.js'

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

  // ids are fresh every time
  const a = addFloor(before, id)
  const b = addFloor(before, id)
  assert.notEqual(prop(a).floors[0].id, prop(b).floors[0].id)
  assert.notEqual(prop(a).floors[0].units[0].id, prop(b).floors[0].units[0].id)
})

test('add unit: the floor relays out full -> left + right, and keeps going', () => {
  let state = one('single', 'Solo') // one floor, one full unit
  const id = prop(state).id
  const floorId = prop(state).floors[0].id

  state = addUnit(state, id, floorId)
  assert.equal(countUnits(prop(state)), 2)
  assert.deepEqual(positions(prop(state).floors[0]), ['left', 'right'])
  assert.equal(prop(state).floors[0].units[1].name, '1F 2', 'named off the floor label')

  state = addUnit(state, id, floorId)
  assert.equal(countUnits(prop(state)), 3)
  assert.deepEqual(positions(prop(state).floors[0]), ['left', 'right', 'full'])

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
