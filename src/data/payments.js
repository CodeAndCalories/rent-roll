// Rent Roll — payment math. Pure functions over units and properties, no
// DOM, so the node tests import them directly. The WRITES live in ops.js
// (setPayment, clearPayment, cyclePayment); nothing here changes a state.
//
// Vocabulary:
//   rental    what pays one rent: the unit itself (half 'A'), or each half
//             of a split unit ('A' and 'B')
//   record    unit.payments[paymentKey(month, half)], when it exists
//   tracked   a month with a record. Untracked otherwise — and untracked is
//             NOT unpaid: it is a month nobody has said anything about, so
//             it draws grey, adds nothing to "outstanding", and never puts a
//             marker on the drawing.
//
// None of this touches the title block's totals: those stay rent from
// leases (totals.js). A month's expected / collected / outstanding are a
// separate set of numbers about money that actually moved.

import { paymentKey, parsePaymentKey, toAmount } from './schema.js'

/** Tap order in the month view: a first tap on an untracked month says "paid". */
export const PAYMENT_CYCLE = ['paid', 'partial', 'late', 'unpaid', 'waived']

/** The statuses that put a marker on the drawing. */
export const OWED_STATUSES = ['unpaid', 'late']

export function isSplitUnit(unit) {
  return Boolean(unit?.splittable && unit?.isSplit)
}

/** The halves paying rent right now: ['A'], or ['A', 'B'] while split. */
export function rentalsOf(unit) {
  return isSplitUnit(unit) ? ['A', 'B'] : ['A']
}

/**
 * What a new record's amount starts at: the rent stored for that half at
 * this moment. The record keeps its own copy from then on, so a later rent
 * change never rewrites it.
 */
export function defaultAmountFor(unit, half) {
  return toAmount(half === 'B' ? unit?.splitRent : unit?.rent)
}

/**
 * Rent the lease says to expect from a rental this month: leased units
 * only, and half B only while the unit is split. Zero otherwise.
 */
export function expectedFor(unit, half) {
  if (!unit || unit.status !== 'leased') return 0
  if (half === 'B' && !isSplitUnit(unit)) return 0
  return defaultAmountFor(unit, half)
}

/** The record for a month and half, or null when the month is untracked. */
export function paymentFor(unit, month, half = 'A') {
  return unit?.payments?.[paymentKey(month, half)] ?? null
}

/** How many payment records a unit holds, any month, either half. */
export function countPayments(unit) {
  return Object.keys(unit?.payments ?? {}).length
}

/**
 * Every record on a unit as { key, month, half, record }, newest month
 * first, half A before B. A key that cannot be read is kept, last, with
 * month null, so nothing stored is ever hidden by the parser.
 */
export function paymentEntries(unit) {
  const out = Object.entries(unit?.payments ?? {}).map(([key, record]) => {
    const parsed = parsePaymentKey(key)
    return { key, month: parsed?.month ?? null, half: parsed?.half ?? record?.half ?? 'A', record }
  })
  return out.sort((a, b) => {
    if (a.month === b.month) return a.half < b.half ? -1 : a.half > b.half ? 1 : 0
    if (a.month === null) return 1
    if (b.month === null) return -1
    return a.month < b.month ? 1 : -1
  })
}

/**
 * The halves worth a row for one month: the ones paying now, plus a half
 * that has a record for it — history from before an unsplit stays visible.
 */
export function halvesFor(unit, month) {
  const halves = rentalsOf(unit)
  if (!halves.includes('B') && paymentFor(unit, month, 'B')) return ['A', 'B']
  return halves
}

/**
 * A record is bare when it holds nothing but a status a tap could have
 * made: no note, no paid-on date, and the amount it started with. Only a
 * bare record may go back to untracked from the tap cycle; anything typed
 * into stays, and clearPayment in ops.js is the explicit way out.
 */
export function isBarePayment(unit, month, half) {
  const r = paymentFor(unit, month, half)
  if (!r) return false
  return !r.note && !r.paidOn && toAmount(r.amount) === defaultAmountFor(unit, half)
}

/**
 * The status a tap moves this rental to, or null when the tap should take
 * the record away (untracked again). Untracked -> the first of the cycle;
 * past the end, a bare record goes, a record with anything typed in it
 * starts the cycle over.
 */
export function nextPaymentStatus(unit, month, half) {
  const r = paymentFor(unit, month, half)
  if (!r) return PAYMENT_CYCLE[0]
  const i = PAYMENT_CYCLE.indexOf(r.status)
  if (i === -1) return PAYMENT_CYCLE[0]
  if (i === PAYMENT_CYCLE.length - 1) return isBarePayment(unit, month, half) ? null : PAYMENT_CYCLE[0]
  return PAYMENT_CYCLE[i + 1]
}

/**
 * Rentals explicitly marked unpaid or late this month: [{ half, status }].
 * An untracked month never appears here — no guilt for months never
 * tracked.
 */
export function owedRentals(unit, month) {
  const out = []
  for (const half of ['A', 'B']) {
    const r = paymentFor(unit, month, half)
    if (r && OWED_STATUSES.includes(r.status)) out.push({ half, status: r.status })
  }
  return out
}

/**
 * The marker text for a unit box, or null: 'late' / 'unpaid', or per half
 * when the unit has two rentals: 'A late · B unpaid'.
 */
export function paymentMarker(unit, month) {
  const owed = owedRentals(unit, month)
  if (owed.length === 0) return null
  const split = halvesFor(unit, month).length > 1
  return owed.map((o) => (split ? `${o.half} ${o.status}` : o.status)).join(' · ')
}

/**
 * One rental's numbers for a month.
 *   expected     what was due: the record's amount, or the lease's rent
 *                when untracked (a partial is due at least the lease rent)
 *   collected    money that came in: paid and partial amounts
 *   outstanding  still owed: unpaid and late amounts, the rest of a partial
 *   waived       forgiven, so neither collected nor outstanding
 * Untracked contributes expected only, never outstanding.
 */
export function rentalMonth(unit, month, half) {
  const record = paymentFor(unit, month, half)
  const fromLease = expectedFor(unit, half)
  if (!record) {
    return { record: null, status: 'untracked', expected: fromLease, collected: 0, outstanding: 0, waived: 0 }
  }
  const amount = toAmount(record.amount)
  const base = { record, status: record.status }
  switch (record.status) {
    case 'paid':
      return { ...base, expected: amount, collected: amount, outstanding: 0, waived: 0 }
    case 'partial': {
      const expected = Math.max(amount, fromLease)
      return { ...base, expected, collected: amount, outstanding: expected - amount, waived: 0 }
    }
    case 'waived':
      return { ...base, expected: amount, collected: 0, outstanding: 0, waived: amount }
    default: // unpaid, late
      return { ...base, expected: amount, collected: 0, outstanding: amount, waived: 0 }
  }
}

/**
 * The whole month across some buildings (the active portfolio's): totals
 * plus one row per rental, in drawing order. Every number is finite.
 *   tracked      rows with a record
 *   untracked    rows without one that the lease expects rent from
 */
export function monthSummary(properties, month) {
  const rows = []
  for (const p of Array.isArray(properties) ? properties : []) {
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const halves = halvesFor(u, month)
        for (const half of halves) {
          rows.push({
            key: `${u.id}:${half}`,
            unitId: u.id,
            half,
            split: halves.length > 1,
            unit: u,
            unitName: u.name || 'Unit',
            propertyId: p.id,
            building: p.name || 'Building',
            floor: f.label || '',
            ...rentalMonth(u, month, half),
          })
        }
      }
    }
  }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0)
  return {
    month,
    expected: sum('expected'),
    collected: sum('collected'),
    outstanding: sum('outstanding'),
    waived: sum('waived'),
    tracked: rows.filter((r) => r.record).length,
    untracked: rows.filter((r) => !r.record && r.expected > 0).length,
    rows,
  }
}
