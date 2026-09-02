// Rent Roll — how the units on one floor share its width.
//
// Every unit carries `widthWeight` (default 1). The main units on a floor
// split that floor in proportion to their weights, so a floor of all-1s is
// the equal split every store drew before v5. A side annex is NOT part of
// the split: it hangs off the mass at its own fixed width (SIDE_W in
// Building.jsx) and its weight is ignored.
//
// This module is pure arithmetic on units — no React, no DOM — so the drag
// handle's behaviour (proportions, the minimum share, the reset) is testable
// in node. The component only turns a pointer delta into a fraction and
// hands the result to ops.js.

import { toWeight } from '../data/schema.js'

/** A resize never leaves a unit narrower than this share of its floor. */
export const MIN_SHARE = 0.15

/** Weights are stored to this many decimals; the drag produces no more. */
const PRECISION = 4

/** Units in the mass (a 'side' annex is not one of them). */
export const isMainUnit = (u) => u?.position !== 'side'

/** The units that share a floor's width, in stored order. */
export function mainUnits(floor) {
  return (floor?.units ?? []).filter(isMainUnit)
}

/** One unit's weight: a positive finite number, 1 when it has none. */
export function weightOf(unit) {
  return toWeight(unit?.widthWeight)
}

/**
 * Each unit's share of the floor, in the order given. Always finite and
 * summing to 1 (an empty list gives []). Equal weights give equal shares.
 */
export function sharesOf(units) {
  const list = Array.isArray(units) ? units : []
  if (list.length === 0) return []
  const weights = list.map(weightOf)
  const total = weights.reduce((n, w) => n + w, 0)
  if (!(total > 0)) return list.map(() => 1 / list.length)
  return weights.map((w) => w / total)
}

/**
 * CSS flex-grow per unit: the shares scaled so they sum to the unit count.
 * Equal weights give 1 each, exactly what `flex-1` on every box did, and the
 * sum is never below 1 (where flexbox would leave part of the row unfilled).
 */
export function growOf(units) {
  const shares = sharesOf(units)
  return shares.map((s) => round(s * shares.length))
}

/**
 * Move the shared edge between units `index` and `index + 1` by `delta`, a
 * fraction of the floor's width. The pair's combined share never changes, so
 * no other unit on the floor moves, and the floor's total is untouched.
 *
 * Neither side drops below MIN_SHARE of the floor — or below half the pair,
 * when the pair itself holds less than twice that (a floor of many units),
 * where the two simply hold equal halves of what they have.
 *
 * Returns { [unitId]: weight } for the two units, or null when there is no
 * such pair.
 */
export function resizePair(units, index, delta) {
  const list = Array.isArray(units) ? units : []
  const a = list[index]
  const b = list[index + 1]
  if (!a || !b) return null

  const shares = sharesOf(list)
  const pair = shares[index] + shares[index + 1]
  const lo = Math.min(MIN_SHARE, pair / 2)
  const moved = shares[index] + (Number.isFinite(delta) ? delta : 0)
  const first = Math.min(Math.max(moved, lo), pair - lo)
  return pairWeights(a, b, first / pair)
}

/** The double-tap reset: the pair splits what it has evenly. */
export function equalizePair(units, index) {
  const list = Array.isArray(units) ? units : []
  const a = list[index]
  const b = list[index + 1]
  if (!a || !b) return null
  return pairWeights(a, b, 0.5)
}

/**
 * Weights for one pair given `fraction`, the first unit's share OF THE PAIR.
 * The pair keeps the weight it had between them, which is what leaves every
 * other unit on the floor exactly where it was.
 */
function pairWeights(a, b, fraction) {
  const total = weightOf(a) + weightOf(b)
  const first = round(total * fraction)
  return { [a.id]: first, [b.id]: round(total - first) }
}

function round(n) {
  const f = 10 ** PRECISION
  return Math.round(n * f) / f
}
