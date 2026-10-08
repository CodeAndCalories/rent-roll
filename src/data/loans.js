// Rent Roll — loan terms on a building bill, and the estimate they give.
// Pure functions, no DOM, so the node tests import them directly. The
// writes live in ops.js (setBillLoan, and the one-loan rule in
// patchProperty); nothing here changes a state.
//
// Only the TERMS are stored (schema.js, makeLoan). Every figure below — the
// monthly principal and interest, payments made and left, the balance, the
// interest paid, the payoff date, what extra principal saves — is computed
// for display and never written back. The bill's own `amount` stays what
// the user typed: a real payment often carries escrow, so a difference
// from the computed P+I is shown as "escrow / other", never corrected.
//
// This is a calculator, not a lender statement: standard amortization,
// interest charged monthly on the balance and rounded to the cent. The
// schedule runs in whole cents (integers), so a 30-year loan never drifts
// by a stray fraction. Dates are local calendar days ('YYYY-MM-DD'); "to
// date" means every scheduled payment due on or before today's LOCAL date.
//
// Extra principal is assumed to go in with every payment from the first,
// so the balance, the payments left, and the payoff date all follow the
// schedule WITH it; "interest saved" and "months saved" compare that with
// the same loan without it.

import { isObject, toAmount } from './schema.js'
import { billMonthly } from './totals.js'
import { parseDay } from '../lib/leases.js'
import { dayKey } from '../lib/months.js'

/** The longest term the calculator will run (100 years). */
export const LOAN_MAX_MONTHS = 1200

/** Labels that read as costs an escrow account often pays. */
const ESCROW_LIKE = /\btax|insur/i

const pad2 = (n) => String(n).padStart(2, '0')

/** True when a bill carries loan terms. */
export function hasLoan(bill) {
  return isObject(bill?.loan)
}

/** The building bill carrying the loan terms, or null. There is at most one. */
export function loanBillOf(property) {
  return (property?.bills ?? []).find(hasLoan) ?? null
}

/** How many of a building's bills carry loan terms (the rule allows one). */
export function loanBillCount(property) {
  return (property?.bills ?? []).filter(hasLoan).length
}

/**
 * Can this bill take loan terms? { ok: true } or { ok: false, reason } —
 * refused when another bill of the building already carries them.
 */
export function loanCheck(property, billId) {
  const other = (property?.bills ?? []).find((b) => hasLoan(b) && b.id !== billId)
  if (!other) return { ok: true }
  return {
    ok: false,
    code: 'one-loan',
    reason: `${property?.name || 'This building'} already has loan terms on "${other.label || 'a bill'}". One loan per building.`,
  }
}

/** Round to the cent, for display and for the payment a lender would bill. */
export function roundCents(n) {
  const v = Math.round(toAmount(n) * 100) / 100
  return v || 0 // -0 -> 0
}

/**
 * Standard amortized monthly principal + interest, unrounded:
 * P·r / (1 − (1 + r)^−n) with r the monthly rate, or P / n at 0%.
 * 0 when the terms cannot make a payment (no principal, no term, a
 * negative rate).
 */
export function amortizedPayment(principal, annualRatePercent, termMonths) {
  const P = toAmount(principal)
  const n = Math.trunc(toAmount(termMonths))
  const r = toAmount(annualRatePercent) / 100 / 12
  if (!(P > 0) || !(n >= 1) || r < 0) return 0
  if (r === 0) return P / n
  return (P * r) / (1 - Math.pow(1 + r, -n))
}

/**
 * The due day of payment `k` (0 for the first): the first payment's day of
 * month, k months on, held to the end of a shorter month (a loan first due
 * on the 31st is due 28 Feb). Local calendar arithmetic, no Date in it.
 * null when the first payment date is not a real day.
 */
export function dueDateOf(firstPaymentDate, k) {
  const p = parseDay(firstPaymentDate)
  if (!p || !Number.isInteger(k) || k < 0) return null
  const total = p.year * 12 + (p.month - 1) + k
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  const day = Math.min(p.day, daysInMonth(year, month))
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function daysInMonth(year, month) {
  // day 0 of the next month is the last day of this one
  return new Date(year, month, 0).getDate()
}

/**
 * Run the schedule in whole cents. Each month: interest is the balance
 * times the monthly rate, rounded to the cent; the payment less that
 * interest, plus any extra, goes to principal. The last payment settles
 * whatever is left — earlier with extra, and at the term's final payment
 * in any case, so rounding the payment to the cent never leaves a few
 * cents owing. Returns { rows, interest } (cents), or null when the
 * payment cannot cover the interest.
 */
function runSchedule(principalCents, r, paymentCents, extraCents, termMonths) {
  let balance = principalCents
  let interestTotal = 0
  const rows = []
  for (let k = 0; balance > 0 && k < termMonths; k++) {
    const interest = Math.round(balance * r)
    let principal = paymentCents - interest + extraCents
    if (principal <= 0) return null
    if (principal >= balance || k === termMonths - 1) principal = balance
    balance -= principal
    interestTotal += interest
    rows.push({ interest, principal, balance })
  }
  return balance === 0 ? { rows, interest: interestTotal } : null
}

/** What a loan is missing before it can be estimated: [] when it is ready. */
export function loanProblems(loan) {
  const problems = []
  if (!(toAmount(loan?.originalPrincipal) > 0)) problems.push('the original principal')
  const n = Math.trunc(toAmount(loan?.termMonths))
  if (!(n >= 1)) problems.push('the term in months')
  else if (n > LOAN_MAX_MONTHS) problems.push(`a term of at most ${LOAN_MAX_MONTHS.toLocaleString('en-US')} months`)
  if (toAmount(loan?.annualRatePercent) < 0) problems.push('a rate of 0% or more')
  if (toAmount(loan?.extraMonthlyPrincipal) < 0) problems.push('extra principal of $0 or more')
  return problems
}

/**
 * The estimate for one loan, as of `today` (local). Every figure is a
 * finite number in dollars (or a 'YYYY-MM-DD' day), never stored.
 *
 *   ok              false while terms are missing; `missing` names them
 *   payment         monthly principal + interest, to the cent
 *   termMonths      the term as typed
 *   count           payments in the schedule (fewer than the term with extra)
 *   totalInterest   interest over the whole schedule
 *   dated           whether firstPaymentDate is a real day; the figures
 *                   below are null without one
 *   made            payments due on or before today (local), at most count
 *   remaining       count − made
 *   balance         principal still owed after those payments
 *   interestToDate  interest in those payments
 *   payoffDate      the last payment's due day
 *   extra           null without extra principal, else { monthly,
 *                   standardCount, standardPayoffDate, monthsSaved,
 *                   interestSaved }: the same loan without the extra,
 *                   and what the extra changes
 */
export function loanSummary(loan, today = new Date()) {
  const missing = loanProblems(loan)
  if (missing.length > 0) return { ok: false, missing }

  const principalCents = Math.round(toAmount(loan.originalPrincipal) * 100)
  const termMonths = Math.trunc(toAmount(loan.termMonths))
  const r = toAmount(loan.annualRatePercent) / 100 / 12
  const payment = roundCents(amortizedPayment(loan.originalPrincipal, loan.annualRatePercent, termMonths))
  const paymentCents = Math.round(payment * 100)
  const extraCents = Math.round(toAmount(loan.extraMonthlyPrincipal) * 100)

  const standard = runSchedule(principalCents, r, paymentCents, 0, termMonths)
  const schedule = extraCents > 0 ? runSchedule(principalCents, r, paymentCents, extraCents, termMonths) : standard
  if (!standard || !schedule) return { ok: false, missing: ['terms that pay the loan down'] }

  const first = loan.firstPaymentDate
  const dated = parseDay(first) != null
  const count = schedule.rows.length

  let made = null
  let balance = null
  let interestToDate = null
  if (dated) {
    const todayKey = dayKey(today)
    made = 0
    let owed = principalCents
    let interest = 0
    // due days only ever move forward, so the first one past today ends it;
    // 'YYYY-MM-DD' strings compare in calendar order
    for (let k = 0; k < count && dueDateOf(first, k) <= todayKey; k++) {
      made += 1
      interest += schedule.rows[k].interest
      owed = schedule.rows[k].balance
    }
    balance = owed / 100
    interestToDate = interest / 100
  }

  return {
    ok: true,
    missing: [],
    payment,
    termMonths,
    count,
    totalInterest: schedule.interest / 100,
    dated,
    made,
    remaining: dated ? count - made : null,
    balance,
    interestToDate,
    payoffDate: dated ? dueDateOf(first, count - 1) : null,
    extra:
      extraCents > 0
        ? {
            monthly: extraCents / 100,
            standardCount: standard.rows.length,
            standardPayoffDate: dated ? dueDateOf(first, standard.rows.length - 1) : null,
            monthsSaved: standard.rows.length - count,
            interestSaved: (standard.interest - schedule.interest) / 100,
          }
        : null,
  }
}

/**
 * The bill's own monthly amount set beside the computed P+I. The amount is
 * what the user typed and stays that way; a difference is labelled
 * "escrow / other" rather than corrected. `differs` is false within a cent.
 */
export function escrowSplit(bill, summary) {
  const typed = billMonthly(bill)
  const computed = summary?.ok ? summary.payment : 0
  const difference = roundCents(typed - computed)
  return { typed, computed, difference, differs: Math.abs(difference) >= 0.01 }
}

/**
 * Other bills of a building with a loan that escrow often pays already —
 * property taxes, insurance — with an amount entered. Empty without a loan
 * bill. The UI shows a quiet note; nothing is blocked or changed.
 */
export function escrowOverlap(property) {
  const loanBill = loanBillOf(property)
  if (!loanBill) return []
  return (property.bills ?? []).filter(
    (b) => b.id !== loanBill.id && ESCROW_LIKE.test(String(b.label ?? '')) && toAmount(b.amount) > 0,
  )
}
