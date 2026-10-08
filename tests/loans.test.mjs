// Loan terms on a building bill and the estimate they give: standard
// amortization against a known worked example (to the cent), the 0% edge,
// extra principal shortening the term, payments to date counted on LOCAL
// days — checked in a child process west of UTC, where a UTC "today" would
// already be the next month — and the typed amount set beside P+I as
// "escrow / other", never corrected. Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { makeBill, makeLoan } from '../src/data/schema.js'
import {
  LOAN_MAX_MONTHS,
  amortizedPayment,
  dueDateOf,
  escrowSplit,
  loanProblems,
  loanSummary,
  roundCents,
} from '../src/data/loans.js'

const cents = (n) => Math.round(n * 100)
const LOAN = makeLoan({ originalPrincipal: 300000, annualRatePercent: 6.5, termMonths: 360, firstPaymentDate: '2026-01-01' })

test('the worked example: 300,000 at 6.5% over 360 months is 1,896.20 a month', () => {
  assert.equal(roundCents(amortizedPayment(300000, 6.5, 360)), 1896.2)
  assert.equal(cents(roundCents(amortizedPayment(300000, 6.5, 360))), 189620, 'to the cent')

  // a couple more anyone can check against a lender's table
  assert.equal(roundCents(amortizedPayment(200000, 4, 360)), 954.83)
  assert.equal(roundCents(amortizedPayment(100000, 7.25, 180)), 912.86)

  const s = loanSummary(LOAN, new Date(2026, 0, 15))
  assert.equal(s.ok, true)
  assert.equal(s.payment, 1896.2)
  assert.equal(s.count, 360, 'the standard schedule runs exactly the term')
  assert.equal(s.payoffDate, '2055-12-01', 'the 360th payment')
  // 360 payments less the principal, give or take the cents each month rounds
  assert.ok(Math.abs(s.totalInterest - (1896.2 * 360 - 300000)) < 10, `${s.totalInterest}`)
  assert.equal(s.extra, null)

  // as of mid-January, one payment is behind us: its interest is 1,625.00 exactly
  assert.equal(s.made, 1)
  assert.equal(s.remaining, 359)
  assert.equal(s.interestToDate, 1625)
  assert.equal(cents(s.balance), 30000000 - (189620 - 162500))

  // before the first payment nothing is made; long after, it is all paid
  const before = loanSummary(LOAN, new Date(2025, 11, 31, 23, 59))
  assert.deepEqual([before.made, before.remaining, before.balance, before.interestToDate], [0, 360, 300000, 0])
  const after = loanSummary(LOAN, new Date(2060, 0, 1))
  assert.deepEqual([after.made, after.remaining, after.balance], [360, 0, 0])
  assert.equal(after.interestToDate, after.totalInterest)
})

test('zero interest: principal over the term, and the last payment settles the rounding', () => {
  // 100,000 / 360 = 277.777… -> 277.78; 359 of those leave 276.98
  const zero = makeLoan({ originalPrincipal: 100000, annualRatePercent: 0, termMonths: 360, firstPaymentDate: '2026-01-31' })
  assert.equal(amortizedPayment(100000, 0, 360), 100000 / 360, 'no division by zero')
  const s = loanSummary(zero, new Date(2026, 9, 7))
  assert.equal(s.ok, true)
  assert.equal(s.payment, 277.78)
  assert.equal(s.count, 360)
  assert.equal(s.totalInterest, 0)
  assert.equal(s.interestToDate, 0)
  // due on the 31st, held to the end of shorter months: Jan 31 … Sep 30 by 7 Oct
  assert.equal(s.made, 9)
  assert.equal(s.balance, roundCents(100000 - 9 * 277.78))
  const end = loanSummary(zero, new Date(2056, 0, 1))
  assert.equal(end.balance, 0)
  assert.equal(end.made, 360)

  // a payment that rounds DOWN still pays off on time, with the leftover cents in the last one
  const down = loanSummary(makeLoan({ originalPrincipal: 1000, termMonths: 3, firstPaymentDate: '2026-01-01' }), new Date(2027, 0, 1))
  assert.equal(down.payment, 333.33)
  assert.equal(down.count, 3)
  assert.equal(down.balance, 0)

  // and 0% with extra principal finishes early with nothing "saved"
  const extra = loanSummary({ ...zero, extraMonthlyPrincipal: 277.78 }, new Date(2026, 9, 7))
  assert.equal(extra.count, 180)
  assert.equal(extra.extra.monthsSaved, 180)
  assert.equal(extra.extra.interestSaved, 0)
})

test('extra principal shortens the term and saves interest', () => {
  const plain = loanSummary(LOAN, new Date(2026, 9, 7))
  const s = loanSummary({ ...LOAN, extraMonthlyPrincipal: 200 }, new Date(2026, 9, 7))
  assert.equal(s.ok, true)
  assert.equal(s.payment, 1896.2, 'P+I is the same; the extra goes on top')
  assert.ok(s.count < 360, `${s.count} payments`)
  assert.equal(s.extra.standardCount, 360)
  assert.equal(s.extra.monthsSaved, 360 - s.count)
  assert.equal(s.extra.standardPayoffDate, '2055-12-01')
  assert.equal(s.payoffDate, dueDateOf('2026-01-01', s.count - 1))
  assert.ok(s.payoffDate < s.extra.standardPayoffDate, 'paid off earlier')
  assert.ok(s.extra.interestSaved > 0)
  assert.equal(cents(s.extra.interestSaved), cents(plain.totalInterest) - cents(s.totalInterest))
  assert.equal(s.extra.monthly, 200)

  // more extra, shorter still
  const more = loanSummary({ ...LOAN, extraMonthlyPrincipal: 1000 }, new Date(2026, 9, 7))
  assert.ok(more.count < s.count)
  assert.ok(more.extra.interestSaved > s.extra.interestSaved)

  // the extra is assumed from the first payment, so the balance to date is lower too
  assert.equal(s.made, plain.made)
  assert.ok(s.balance < plain.balance)
  assert.equal(cents(plain.balance - s.balance) >= cents(200 * s.made), true)

  // an extra that pays it all in one go
  const lump = loanSummary({ ...LOAN, extraMonthlyPrincipal: 300000 }, new Date(2026, 9, 7))
  assert.equal(lump.count, 1)
  assert.equal(lump.payoffDate, '2026-01-01')
})

test('missing or impossible terms say what is missing, never NaN', () => {
  assert.deepEqual(loanProblems(makeLoan()), ['the original principal', 'the term in months'])
  const none = loanSummary(makeLoan())
  assert.equal(none.ok, false)
  assert.deepEqual(none.missing, ['the original principal', 'the term in months'])
  assert.deepEqual(loanProblems({ originalPrincipal: 1000, termMonths: 12, annualRatePercent: -1 }), ['a rate of 0% or more'])
  assert.deepEqual(loanProblems({ originalPrincipal: 1000, termMonths: LOAN_MAX_MONTHS + 1 }), ['a term of at most 1,200 months'])
  assert.equal(amortizedPayment('junk', 6.5, 360), 0)
  assert.equal(amortizedPayment(1000, 6.5, 0), 0)

  // no first payment date: the payment still shows, the dated figures are null
  const undated = loanSummary(makeLoan({ originalPrincipal: 300000, annualRatePercent: 6.5, termMonths: 360 }))
  assert.equal(undated.ok, true)
  assert.equal(undated.payment, 1896.2)
  assert.equal(undated.dated, false)
  assert.deepEqual([undated.made, undated.remaining, undated.balance, undated.payoffDate], [null, null, null, null])
  // a rolled-over day is not a date
  assert.equal(loanSummary({ ...LOAN, firstPaymentDate: '2026-02-30' }).dated, false)

  // due days keep the first payment's day, held to the month's end
  assert.equal(dueDateOf('2026-01-31', 1), '2026-02-28')
  assert.equal(dueDateOf('2024-01-31', 1), '2024-02-29', 'leap year')
  assert.equal(dueDateOf('2026-01-31', 2), '2026-03-31', 'and back to the 31st')
  assert.equal(dueDateOf('2026-11-15', 2), '2027-01-15', 'across a year')
  assert.equal(dueDateOf(null, 0), null)
})

test('the typed amount is kept and the difference from P+I is "escrow / other"', () => {
  const s = loanSummary(LOAN, new Date(2026, 9, 7))
  const bill = makeBill({ label: 'Mortgage', amount: 2400, loan: LOAN })
  const split = escrowSplit(bill, s)
  assert.equal(split.typed, 2400, 'what was typed')
  assert.equal(split.computed, 1896.2)
  assert.equal(split.difference, 503.8)
  assert.equal(split.differs, true)
  assert.equal(bill.amount, 2400, 'never corrected')

  // the same to the cent is no difference
  assert.equal(escrowSplit(makeBill({ amount: 1896.2, loan: LOAN }), s).differs, false)
  // a yearly bill is compared by its monthly equivalent
  assert.equal(escrowSplit(makeBill({ amount: 1896.2 * 12, cadence: 'yearly', loan: LOAN }), s).differs, false)
  // less than P+I is shown as it is, not fixed
  assert.equal(escrowSplit(makeBill({ amount: 1800, loan: LOAN }), s).difference, -96.2)
})

test('payments to date count LOCAL days: west of UTC the evening of the 30th is still September', () => {
  const lib = new URL('../src/data/loans.js', import.meta.url).href
  const run = (tz, [y, mo, d, h, min]) => {
    // TZ goes on before any Date exists in the child, so its clock is that zone's
    const script = [
      `process.env.TZ = ${JSON.stringify(tz)}`,
      `const { loanSummary } = await import(${JSON.stringify(lib)})`,
      `const today = new Date(${y}, ${mo - 1}, ${d}, ${h}, ${min})`,
      `const loan = { originalPrincipal: 300000, annualRatePercent: 6.5, termMonths: 360, firstPaymentDate: '2026-01-01', extraMonthlyPrincipal: 0 }`,
      `const s = loanSummary(loan, today)`,
      `console.log(JSON.stringify({ made: s.made, remaining: s.remaining, balance: s.balance, utcDay: today.toISOString().slice(0, 10), offset: today.getTimezoneOffset() }))`,
    ].join('\n')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    return JSON.parse(out.trim())
  }

  // Los Angeles, 23:30 on 30 September: UTC is already 1 October, so a
  // UTC-based "today" would count the October payment as made
  const eve = run('America/Los_Angeles', [2026, 9, 30, 23, 30])
  assert.equal(eve.offset, 420, 'the child really is west of UTC (PDT)')
  assert.equal(eve.utcDay, '2026-10-01', 'UTC has moved on')
  assert.equal(eve.made, 9, 'January through September')
  assert.equal(eve.remaining, 351)

  // half past midnight on 1 October, local: the October payment is due today and counts
  const dawn = run('America/Los_Angeles', [2026, 10, 1, 0, 30])
  assert.equal(dawn.made, 10)
  assert.equal(dawn.remaining, 350)
  assert.ok(dawn.balance < eve.balance)

  // the year boundary, in winter time: New Year's Eve 22:00 is still December
  const nye = run('America/Los_Angeles', [2026, 12, 31, 22, 0])
  assert.equal(nye.offset, 480)
  assert.equal(nye.utcDay, '2027-01-01')
  assert.equal(nye.made, 12)
  const jan = run('America/Los_Angeles', [2027, 1, 1, 0, 5])
  assert.equal(jan.made, 13)

  // and the same instant as LA's 23:30 reads the same in this process's own
  // local calendar logic: the count follows the local day, whatever it is
  const here = loanSummary(LOAN, new Date(2026, 8, 30, 23, 30))
  assert.equal(here.made, 9)
})
