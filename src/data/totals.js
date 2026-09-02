// Rent Roll — totals math. Pure functions over the state, no DOM, so Node
// tests can import them directly. TitleBlock.jsx re-exports these.

import { toAmount } from './schema.js'

/** Monthly rent a unit brings in when leased (split-aware). */
export function unitMonthly(unit) {
  const rent = toAmount(unit.rent)
  return unit.splittable && unit.isSplit ? rent + toAmount(unit.splitRent) : rent
}

/** Rent of one rental: a split unit counts its larger half. Used for the bars. */
export function rentPerRental(unit) {
  const rent = toAmount(unit.rent)
  return unit.splittable && unit.isSplit ? Math.max(rent, toAmount(unit.splitRent)) : rent
}

/** A bill's monthly cost. 'once' bills are not recurring and count as 0. */
export function billMonthly(bill) {
  const amount = toAmount(bill.amount)
  if (bill.cadence === 'monthly') return amount
  if (bill.cadence === 'yearly') return amount / 12
  return 0
}

/**
 * Totals for the title block and the print view. Every number is finite.
 * Always call this with the WHOLE portfolio; the title block shows
 * portfolio totals regardless of which buildings are drawn.
 *   collected      monthly rent from units whose status is 'leased'
 *   potential      monthly rent if every unit were leased
 *   vacancy        potential - collected
 *   propertyBills  monthly cost of building-level bills
 *   unitBills      monthly cost of unit-level bills
 *   bills          propertyBills + unitBills
 *   net            collected - bills;  annualNet = net * 12
 *   maxRent        highest rentPerRental across all units (scale for bars)
 */
export function computeTotals(properties) {
  let collected = 0
  let potential = 0
  let propertyBills = 0
  let unitBills = 0
  let units = 0
  let leased = 0
  let billCount = 0
  let maxRent = 0

  const list = Array.isArray(properties) ? properties : []
  for (const p of list) {
    for (const b of p.bills ?? []) {
      propertyBills += billMonthly(b)
      billCount += 1
    }
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const m = unitMonthly(u)
        units += 1
        potential += m
        maxRent = Math.max(maxRent, rentPerRental(u))
        if (u.status === 'leased') {
          collected += m
          leased += 1
        }
        for (const b of u.bills ?? []) {
          unitBills += billMonthly(b)
          billCount += 1
        }
      }
    }
  }

  const bills = propertyBills + unitBills
  const net = collected - bills
  return {
    collected,
    annual: collected * 12,
    potential,
    vacancy: potential - collected,
    propertyBills,
    unitBills,
    bills,
    billCount,
    net,
    annualNet: net * 12,
    units,
    leased,
    maxRent,
    properties: list.length,
  }
}
