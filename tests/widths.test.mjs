// Unit widths within a floor: weight normalization, the drag handle's
// arithmetic (the 15% floor, the pair keeping its own total, the reset), the
// side annex staying out of the split, and the ops write that commits it.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeState, makeUnit, toWeight } from '../src/data/schema.js'
import { buildFromTemplate } from '../src/data/templates.js'
import { setUnitWidths, patchUnit, addUnit } from '../src/data/ops.js'
import {
  MIN_SHARE,
  equalizePair,
  growOf,
  mainUnits,
  resizePair,
  sharesOf,
  weightOf,
} from '../src/lib/widths.js'

const unit = (id, fields = {}) => makeUnit({ id, name: id, ...fields })
const sum = (ns) => ns.reduce((a, b) => a + b, 0)
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)
const applyWeights = (units, weights) =>
  units.map((u) => (weights[u.id] != null ? { ...u, widthWeight: weights[u.id] } : u))

test('weights normalize to shares: missing, junk, and zero all mean an equal split', () => {
  assert.equal(toWeight(undefined), 1)
  assert.equal(toWeight(0), 1, 'a zero-width unit is not a thing')
  assert.equal(toWeight(-3), 1)
  assert.equal(toWeight(Number.NaN), 1)
  assert.equal(toWeight('2.5'), 2.5, 'a number from an imported file')
  assert.equal(toWeight(2.5), 2.5)
  assert.equal(weightOf({}), 1)
  assert.equal(weightOf(undefined), 1)

  // a floor written before v5 has no weights at all: equal shares, as drawn
  assert.deepEqual(sharesOf([unit('a'), unit('b')]), [0.5, 0.5])
  assert.deepEqual(growOf([unit('a'), unit('b')]), [1, 1], 'exactly what flex-1 did')
  assert.deepEqual(growOf([unit('a'), unit('b'), unit('c')]), [1, 1, 1])

  // and weights are relative, not absolute
  const three = [unit('a', { widthWeight: 3 }), unit('b')]
  assert.deepEqual(sharesOf(three), [0.75, 0.25])
  assert.deepEqual(sharesOf([unit('a', { widthWeight: 6 }), unit('b', { widthWeight: 2 })]), [0.75, 0.25])
  assert.deepEqual(growOf(three), [1.5, 0.5], 'grow sums to the unit count')

  // junk on one unit does not poison the floor
  const junk = sharesOf([unit('a', { widthWeight: 'x' }), unit('b', { widthWeight: 3 })])
  assert.deepEqual(junk, [0.25, 0.75])
  assert.ok(junk.every(Number.isFinite))

  assert.deepEqual(sharesOf([]), [])
  assert.deepEqual(sharesOf(null), [])
  assert.deepEqual(growOf([]), [])
  close(sum(sharesOf([unit('a', { widthWeight: 1.7 }), unit('b'), unit('c', { widthWeight: 0.4 })])), 1, 'shares sum to 1')
})

test('dragging an edge moves width between two units and leaves the rest alone', () => {
  const units = [unit('a'), unit('b'), unit('c')] // thirds
  const before = sharesOf(units)

  // drag the a|b edge 10% of the floor to the right
  const w = resizePair(units, 0, 0.1)
  assert.deepEqual(Object.keys(w).sort(), ['a', 'b'], 'only the pair is written')
  const after = sharesOf(applyWeights(units, w))
  close(after[0], before[0] + 0.1, 'a grew by the drag')
  close(after[1], before[1] - 0.1, 'b gave up exactly that')
  close(after[2], before[2], 'c never moved')
  close(sum(after), 1, 'the floor still adds up')
  close(after[0] + after[1], before[0] + before[1], 'the pair keeps its own total')

  // dragging left is the same in reverse
  const back = sharesOf(applyWeights(units, resizePair(units, 0, -0.1)))
  close(back[0], before[0] - 0.1)
  close(back[1], before[1] + 0.1)
  close(back[2], before[2])

  // the second handle moves b and c, not a
  const second = sharesOf(applyWeights(units, resizePair(units, 1, 0.08)))
  close(second[0], before[0], 'a is untouched by the b|c handle')
  close(second[1], before[1] + 0.08)
  close(second[2], before[2] - 0.08)

  // a drag on an unequal floor still only redistributes the pair
  const uneven = [unit('a', { widthWeight: 3 }), unit('b'), unit('c', { widthWeight: 2 })]
  const evenAfter = sharesOf(applyWeights(uneven, resizePair(uneven, 0, -0.2)))
  close(evenAfter[2], sharesOf(uneven)[2], 'the far unit holds its width')

  // no such pair
  assert.equal(resizePair(units, 2, 0.1), null, 'the last unit has no right-hand neighbour')
  assert.equal(resizePair(units, 9, 0.1), null)
  assert.equal(resizePair([unit('only')], 0, 0.1), null)
  assert.equal(resizePair(units, 0, Number.NaN) && sharesOf(applyWeights(units, resizePair(units, 0, Number.NaN)))[0], before[0], 'a junk delta moves nothing')
})

test('the 15% clamp: neither side of a handle can be dragged thinner', () => {
  assert.equal(MIN_SHARE, 0.15)

  // two units: dragging all the way left or right stops at 15 / 85
  const two = [unit('a'), unit('b')]
  const left = sharesOf(applyWeights(two, resizePair(two, 0, -5)))
  close(left[0], 0.15, 'a stops at the minimum')
  close(left[1], 0.85)
  const right = sharesOf(applyWeights(two, resizePair(two, 0, 5)))
  close(right[0], 0.85)
  close(right[1], 0.15, 'b stops at the minimum')

  // three units: the pair holds two thirds, and each side still stops at 15%
  const three = [unit('a'), unit('b'), unit('c')]
  const squeezed = sharesOf(applyWeights(three, resizePair(three, 0, -5)))
  close(squeezed[0], 0.15)
  close(squeezed[1], 2 / 3 - 0.15, 'b takes the rest of the pair')
  close(squeezed[2], 1 / 3, 'c is untouched')
  assert.ok(squeezed.every((s) => s >= MIN_SHARE - 1e-9), 'nothing is below the floor')

  // repeated hard drags never walk a unit below the minimum
  let walked = three
  for (let i = 0; i < 20; i++) walked = applyWeights(walked, resizePair(walked, 0, -1))
  assert.ok(sharesOf(walked).every((s) => s >= MIN_SHARE - 1e-9))

  // a pair with less than twice the minimum between them holds equal halves
  const dense = [unit('a'), unit('b'), unit('c'), unit('d'), unit('e'), unit('f'), unit('g')]
  const denseAfter = sharesOf(applyWeights(dense, resizePair(dense, 0, 5)))
  close(denseAfter[0], denseAfter[1], 'neither side of a thin pair can take from the other')
})

test('double-tap resets a pair to equal and leaves the floor alone', () => {
  const units = [unit('a', { widthWeight: 3 }), unit('b'), unit('c', { widthWeight: 2 })]
  const before = sharesOf(units)

  const reset = equalizePair(units, 0)
  const after = sharesOf(applyWeights(units, reset))
  close(after[0], after[1], 'the pair is even again')
  close(after[0] + after[1], before[0] + before[1], 'and still holds what it held')
  close(after[2], before[2], 'the third unit never moved')
  assert.equal(equalizePair(units, 2), null, 'no pair, no reset')
})

test('the side annex is not part of the split and never takes a weight', () => {
  const floor = {
    id: 'f1',
    label: 'Street',
    units: [unit('main'), unit('shop'), unit('annex', { position: 'side', widthWeight: 9 })],
  }
  assert.deepEqual(
    mainUnits(floor).map((u) => u.id),
    ['main', 'shop'],
    'the annex is not in the split',
  )
  assert.deepEqual(sharesOf(mainUnits(floor)), [0.5, 0.5], 'its weight changes nothing')

  // through the real state: an annex on the bottom floor of a duplex
  let state = makeState({ properties: [buildFromTemplate('duplex-side', 'Pair')] })
  const property = state.properties[0]
  const bottom = property.floors[0]
  const [a, b] = bottom.units
  state = patchUnit(state, b.id, { position: 'side' })
  const withAnnex = state.properties[0].floors[0]
  assert.equal(mainUnits(withAnnex).length, 1)
  assert.deepEqual(sharesOf(mainUnits(withAnnex)), [1], 'the one main unit has the whole floor')

  // an ops write aimed at the annex is ignored; the main unit still takes one
  const tried = setUnitWidths(state, property.id, bottom.id, { [b.id]: 4, [a.id]: 2 })
  const units = tried.properties[0].floors[0].units
  assert.equal(units.find((u) => u.id === b.id).widthWeight, 1, 'the annex keeps its own fixed width')
  assert.equal(units.find((u) => u.id === a.id).widthWeight, 2)
})

test('setUnitWidths writes only what it is given, and never anything else', () => {
  let state = makeState({ properties: [buildFromTemplate('duplex-side', 'Pair')] })
  const property = state.properties[0]
  const floor = property.floors[0]
  const [a, b] = floor.units
  state = patchUnit(state, a.id, { rent: 1200, tenant: 'A. Tenant', status: 'leased' })
  state = addUnit(state, property.id, floor.id) // three on the floor now

  const before = state.properties[0].floors[0].units
  const third = before[2]
  const next = setUnitWidths(state, property.id, floor.id, { [a.id]: 1.6, [b.id]: 0.4 })
  const after = next.properties[0].floors[0].units

  assert.equal(after[0].widthWeight, 1.6)
  assert.equal(after[1].widthWeight, 0.4)
  assert.equal(after[2].widthWeight, 1, 'a unit not named keeps what it had')
  assert.equal(after[0].rent, 1200, 'rent untouched')
  assert.equal(after[0].tenant, 'A. Tenant')
  assert.equal(after[0].status, 'leased')
  assert.equal(after[0].position, before[0].position, 'positions are not the same thing as widths')
  assert.equal(after[2].id, third.id)
  assert.equal(before[0].widthWeight, 1, 'the input state was not mutated')

  // junk falls back to the equal share; unknown ids and floors are no-ops
  const junk = setUnitWidths(state, property.id, floor.id, { [a.id]: -2, [b.id]: 'x' })
  assert.equal(junk.properties[0].floors[0].units[0].widthWeight, 1)
  assert.equal(junk.properties[0].floors[0].units[1].widthWeight, 1)
  assert.equal(setUnitWidths(state, property.id, 'nope', { [a.id]: 3 }), state)
  assert.equal(setUnitWidths(state, 'nope', floor.id, { [a.id]: 3 }), state)
  assert.equal(setUnitWidths(state, property.id, floor.id, null), state)
  assert.equal(
    setUnitWidths(state, property.id, floor.id, { 'not-here': 3 }).properties[0].floors[0].units[0].widthWeight,
    1,
  )

  // a drag committed through ops lands the same shares the math promised
  const dragged = resizePair(before, 0, 0.1)
  const committed = setUnitWidths(state, property.id, floor.id, dragged)
  const shares = sharesOf(mainUnits(committed.properties[0].floors[0]))
  close(shares[0], 1 / 3 + 0.1, 'what was dragged is what was stored')
  close(shares[1], 1 / 3 - 0.1)
  close(shares[2], 1 / 3, 'and the unit beyond the pair held still')
  close(sum(shares), 1)

  // the same drag pushed too far stops at the 15% floor instead
  const far = setUnitWidths(state, property.id, floor.id, resizePair(before, 0, 0.2))
  const clamped = sharesOf(mainUnits(far.properties[0].floors[0]))
  close(clamped[1], MIN_SHARE, 'the give-way unit stops at the minimum')
  close(clamped[0] + clamped[1], 2 / 3, 'the pair still holds exactly what it did')
})
