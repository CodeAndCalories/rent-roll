// The lease overview: days remaining counted from local midnight (a lease
// ending today reads 0, one that ended yesterday -1, and 30 / 90 land on
// their inclusive edges) — checked in this process and again in child
// processes west and east of UTC — and the rows grouped soonest first with
// the units that have no end date in their own group at the bottom.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { makeState } from '../src/data/schema.js'
import { buildFromTemplate } from '../src/data/templates.js'
import { patchUnit } from '../src/data/ops.js'
import {
  LEASE_GROUPS,
  QUARTER_DAYS,
  RENEW_WINDOW_DAYS,
  SOON_DAYS,
  daysUntil,
  describeDays,
  leaseFlag,
  leaseGroupFor,
  leaseGroups,
  leaseRows,
  leaseSummary,
  parseDay,
} from '../src/lib/leases.js'

test('days remaining count local midnights: today is 0, yesterday -1, and 30 / 90 sit on their edges', () => {
  // Saturday 7 March 2026, late evening. US clocks spring forward the next
  // morning, so the 30-day span crosses a 23-hour day.
  const today = new Date(2026, 2, 7, 23, 30)
  assert.equal(daysUntil('2026-03-07', today), 0, 'ends today')
  assert.equal(daysUntil('2026-03-06', today), -1, 'ended yesterday')
  assert.equal(daysUntil('2026-03-08', today), 1)
  assert.equal(daysUntil('2026-04-06', today), 30, 'exactly 30 days out, across the DST change')
  assert.equal(daysUntil('2026-04-07', today), 31)
  assert.equal(daysUntil('2026-06-05', today), 90, 'exactly 90 days out')
  assert.equal(daysUntil('2026-06-06', today), 91)

  // the time of day never matters
  const dawn = new Date(2026, 2, 7, 0, 5)
  for (const [ymd, days] of [
    ['2026-03-07', 0],
    ['2026-03-06', -1],
    ['2026-04-06', 30],
    ['2026-06-05', 90],
  ]) {
    assert.equal(daysUntil(ymd, dawn), days, `${ymd} at 00:05`)
  }

  // no date, or not a date, is null — never NaN, never 0
  assert.equal(daysUntil(null, today), null)
  assert.equal(daysUntil('', today), null)
  assert.equal(daysUntil('2026-3-7', today), null)
  assert.equal(daysUntil('2026-02-30', today), null, 'a rolled-over day is not a day anyone typed')
  assert.deepEqual(parseDay('2026-03-07'), { year: 2026, month: 3, day: 7 })
  assert.equal(parseDay('2026-13-01'), null)

  // the groups' edges are inclusive
  assert.equal(SOON_DAYS, 30)
  assert.equal(QUARTER_DAYS, 90)
  assert.equal(leaseGroupFor(-1), 'ended')
  assert.equal(leaseGroupFor(0), 'soon')
  assert.equal(leaseGroupFor(30), 'soon')
  assert.equal(leaseGroupFor(31), 'quarter')
  assert.equal(leaseGroupFor(90), 'quarter')
  assert.equal(leaseGroupFor(91), 'later')
  assert.equal(leaseGroupFor(null), 'none')
  assert.deepEqual(
    LEASE_GROUPS.map((g) => g.id),
    ['ended', 'soon', 'quarter', 'later', 'none'],
    'no date set is the last group',
  )

  assert.equal(describeDays(0), 'today')
  assert.equal(describeDays(1), '1 day left')
  assert.equal(describeDays(12), '12 days left')
  assert.equal(describeDays(-1), '1 day ago')
  assert.equal(describeDays(-3), '3 days ago')
  assert.equal(describeDays(null), 'no date')
})

test('the same edges west of UTC (Los Angeles) and east of it (Tokyo)', () => {
  const lib = new URL('../src/lib/leases.js', import.meta.url).href
  const run = (tz, [y, mo, d, h, min], ends) => {
    // TZ goes on before any Date exists in the child, so its clock is that zone's
    const script = [
      `process.env.TZ = ${JSON.stringify(tz)}`,
      `const { daysUntil } = await import(${JSON.stringify(lib)})`,
      `const today = new Date(${y}, ${mo - 1}, ${d}, ${h}, ${min})`,
      `const days = Object.fromEntries(${JSON.stringify(ends)}.map((e) => [e, daysUntil(e, today)]))`,
      `console.log(JSON.stringify({ days, utcDay: today.toISOString().slice(0, 10), offset: today.getTimezoneOffset() }))`,
    ].join('\n')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    return JSON.parse(out.trim())
  }

  // Los Angeles, 23:30 on 7 March: UTC is already 8 March, so a UTC-based
  // "today" would call a lease ending today ended yesterday
  const la = run('America/Los_Angeles', [2026, 3, 7, 23, 30], ['2026-03-07', '2026-03-06', '2026-04-06', '2026-06-05', '2026-06-06'])
  assert.equal(la.offset, 480, 'the child really is west of UTC')
  assert.equal(la.utcDay, '2026-03-08', 'UTC has moved on')
  assert.deepEqual(la.days, {
    '2026-03-07': 0,
    '2026-03-06': -1,
    '2026-04-06': 30,
    '2026-06-05': 90,
    '2026-06-06': 91,
  })

  // Tokyo, 00:10 on 8 March: UTC is still 7 March, so a UTC-based "today"
  // would give a lease ending today one more day
  const tokyo = run('Asia/Tokyo', [2026, 3, 8, 0, 10], ['2026-03-08', '2026-03-07', '2026-04-07', '2026-06-06'])
  assert.equal(tokyo.offset, -540, 'the child really is east of UTC')
  assert.equal(tokyo.utcDay, '2026-03-07', 'UTC is still yesterday')
  assert.deepEqual(tokyo.days, { '2026-03-08': 0, '2026-03-07': -1, '2026-04-07': 30, '2026-06-06': 90 })
})

test('the overview: soonest first, grouped, and units without a date in their own group at the bottom', () => {
  const today = new Date(2026, 2, 7, 12)
  let state = makeState({ properties: [buildFromTemplate('fourplex', 'Corner'), buildFromTemplate('fourplex', 'Annex')] })
  const [corner, annex] = state.properties
  const units = (p) => p.floors.flatMap((f) => f.units)
  const [a1, a2, a3, a4] = units(corner)
  const [b1, b2, b3, b4] = units(annex)

  state = patchUnit(state, a1.id, { status: 'leased', tenant: 'Ended T', leaseEnd: '2026-03-06' }) // -1
  state = patchUnit(state, a2.id, { status: 'leased', tenant: 'Today T', leaseEnd: '2026-03-07' }) // 0
  state = patchUnit(state, a3.id, { status: 'leased', leaseEnd: '2026-04-06' }) // 30
  state = patchUnit(state, a4.id, { status: 'leased', leaseEnd: '2026-04-07' }) // 31
  state = patchUnit(state, b1.id, { status: 'leased', leaseEnd: '2026-06-05' }) // 90
  state = patchUnit(state, b2.id, { status: 'leased', leaseEnd: '2026-06-06' }) // 91
  state = patchUnit(state, b3.id, { status: 'vacant' }) // no date, no lease
  state = patchUnit(state, b4.id, { status: 'leased', tenant: 'Forgot', leaseEnd: null }) // no date, but leased

  const rows = leaseRows(state.properties, today)
  assert.deepEqual(
    rows.map((r) => [r.unitId, r.days, r.group]),
    [
      [a1.id, -1, 'ended'],
      [a2.id, 0, 'soon'],
      [a3.id, 30, 'soon'],
      [a4.id, 31, 'quarter'],
      [b1.id, 90, 'quarter'],
      [b2.id, 91, 'later'],
      [b4.id, null, 'none'],
      [b3.id, null, 'none'],
    ],
    'soonest first, then the undated rows with the leased one before the vacant one',
  )

  const row = rows[0]
  assert.equal(row.unitName, '2F Front')
  assert.equal(row.building, 'Corner')
  assert.equal(row.floor, '2F')
  assert.equal(row.tenant, 'Ended T')
  assert.equal(row.leaseEnd, '2026-03-06')
  assert.equal(row.status, 'leased')
  assert.equal(rows[6].leaseEnd, null)
  assert.equal(rows[6].tenant, 'Forgot')
  assert.equal(rows[7].status, 'vacant', 'the vacant unit is listed too — visible, not hidden')

  const groups = leaseGroups(state.properties, today)
  assert.deepEqual(
    groups.map((g) => [g.id, g.rows.length]),
    [
      ['ended', 1],
      ['soon', 2],
      ['quarter', 2],
      ['later', 1],
      ['none', 2],
    ],
  )
  assert.equal(groups[groups.length - 1].id, 'none', 'no date set is at the bottom')
  assert.equal(groups[groups.length - 1].label, 'No date set')

  const s = leaseSummary(state.properties, today)
  assert.equal(s.within90, 4, 'today, 30, 31, and 90 — not -1, not 91')
  assert.equal(s.ended, 1)
  assert.equal(s.soon, 2)
  assert.equal(s.quarter, 2)
  assert.equal(s.later, 1)
  assert.equal(s.noDate, 2)
  assert.equal(s.total, 8)

  // ties keep drawing order; an empty portfolio counts nothing, so the chip hides
  const tie = patchUnit(state, b2.id, { leaseEnd: '2026-04-06' })
  const tied = leaseRows(tie.properties, today).filter((r) => r.days === 30)
  assert.deepEqual(
    tied.map((r) => r.unitId),
    [a3.id, b2.id],
  )
  assert.deepEqual(leaseSummary([], today), { total: 0, ended: 0, soon: 0, quarter: 0, within90: 0, later: 0, noDate: 0 })
  assert.equal(leaseGroups([], today).every((g) => g.rows.length === 0), true)

  // the unit panel's flag moved here and did not change
  assert.equal(RENEW_WINDOW_DAYS, 60)
  assert.deepEqual(leaseFlag('2026-03-07', today), { tone: 'amber', text: 'renews today' })
  assert.deepEqual(leaseFlag('2026-05-06', today), { tone: 'amber', text: 'renews soon · 60d' })
  assert.equal(leaseFlag('2026-05-07', today), null)
  assert.deepEqual(leaseFlag('2026-03-06', today), { tone: 'alert', text: 'ended 1d ago' })
  assert.equal(leaseFlag(null, today), null)
})
