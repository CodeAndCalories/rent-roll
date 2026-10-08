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
 * Monthly cost of a building's own bills. The building bills panel shows
 * this and computeTotals adds it up, so the two can never disagree.
 */
export function propertyBillsMonthly(property) {
  return (property?.bills ?? []).reduce((sum, b) => sum + billMonthly(b), 0)
}

/** Monthly cost of one unit's own bills (the unit panel's figure). */
export function unitBillsMonthly(unit) {
  return (unit?.bills ?? []).reduce((sum, b) => sum + billMonthly(b), 0)
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
    propertyBills += propertyBillsMonthly(p)
    billCount += (p.bills ?? []).length
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
        unitBills += unitBillsMonthly(u)
        billCount += (u.bills ?? []).length
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

/**
 * Every bill in some buildings (the active portfolio's), grouped for the
 * expenses summary: per building, its own bills, then each unit that has
 * bills. The sums are made with the same helpers in the same order as
 * computeTotals, so `propertyBills`, `unitBills`, and `total` are the very
 * numbers the title block shows — not merely close to them.
 */
export function expenseSummary(properties) {
  const buildings = []
  let propertyBills = 0
  let unitBills = 0

  for (const p of Array.isArray(properties) ? properties : []) {
    const own = propertyBillsMonthly(p)
    propertyBills += own
    const units = []
    let unitsMonthly = 0
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const monthly = unitBillsMonthly(u)
        unitBills += monthly
        if ((u.bills ?? []).length === 0) continue
        unitsMonthly += monthly
        units.push({
          unit: u,
          floor: f.label || '',
          monthly,
          bills: u.bills.map((b) => ({ bill: b, monthly: billMonthly(b) })),
        })
      }
    }
    buildings.push({
      property: p,
      monthly: own,
      bills: (p.bills ?? []).map((b) => ({ bill: b, monthly: billMonthly(b) })),
      units,
      unitsMonthly,
      total: own + unitsMonthly,
    })
  }

  return { buildings, propertyBills, unitBills, total: propertyBills + unitBills }
}
