// Rent Roll — month arithmetic for payment tracking. No React, and no Date
// in storage: a month is the plain string 'YYYY-MM' and a day 'YYYY-MM-DD',
// both LOCAL. A payment marked at 00:30 on the 1st belongs to the new month
// wherever the user is. A UTC-derived key (toISOString().slice(0, 7)) would
// put anyone east of Greenwich in the previous month at that hour, and
// anyone west of it, marking on the evening of the 31st, in the next.

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const pad2 = (n) => String(n).padStart(2, '0')

/** The month a local date falls in, as 'YYYY-MM'. Defaults to now. */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

/** A local calendar day as 'YYYY-MM-DD'. Defaults to today. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** { year, month } (month 1-12) for a 'YYYY-MM' key, or null when it is not one. */
export function parseMonth(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

/** The key `delta` months away (negative goes back). Integer math, no Date. */
export function shiftMonth(key, delta) {
  const p = parseMonth(key)
  if (!p) return null
  const total = p.year * 12 + (p.month - 1) + Math.trunc(delta || 0)
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  return `${year}-${pad2(month)}`
}

/** `n` months ending at `from`, newest first. */
export function lastMonths(n, from = monthKey()) {
  const out = []
  for (let i = 0; i < n; i++) out.push(shiftMonth(from, -i))
  return out
}

/** Keys sort as strings, so ordering months is a plain comparison. */
export function compareMonths(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 'Sep 2026', or 'September 2026' with { long: true }. */
export function monthLabel(key, { long = false } = {}) {
  const p = parseMonth(key)
  if (!p) return String(key ?? '')
  return `${(long ? LONG : SHORT)[p.month - 1]} ${p.year}`
}
