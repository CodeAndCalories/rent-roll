// Rent Roll — lease-end arithmetic and the lease overview. No React, so the
// node tests import it directly; the unit panel's "renews soon" flag and the
// Leases view both read from here.
//
// Every date is a local calendar day, 'YYYY-MM-DD'. "Days remaining" is the
// number of local midnights between today and the lease end, so a lease
// ending today reads 0 wherever the user is. A UTC-based "today" would read
// -1 late in the evening west of Greenwich, and +1 just after midnight east
// of it; a plain millisecond difference would drift by an hour across a DST
// change. Neither happens here: both ends are built at local midnight and
// the difference is rounded to whole days.

/** The unit panel's amber "renews soon" window, inclusive. */
export const RENEW_WINDOW_DAYS = 60
/** The overview's "within 30 days" and "within 90 days" edges, inclusive. */
export const SOON_DAYS = 30
export const QUARTER_DAYS = 90

/**
 * The overview's groups, in the order they are shown. A unit with no end
 * date is not hidden: it goes in its own group at the bottom, since a
 * missing date is the thing worth noticing.
 */
export const LEASE_GROUPS = [
  { id: 'ended', label: 'Ended', tone: 'alert' },
  { id: 'soon', label: `Within ${SOON_DAYS} days`, tone: 'amber' },
  { id: 'quarter', label: `Within ${QUARTER_DAYS} days`, tone: 'line' },
  { id: 'later', label: 'Later', tone: 'muted' },
  { id: 'none', label: 'No date set', tone: 'amber' },
]

/** { year, month, day } for a real 'YYYY-MM-DD' day, or null. */
export function parseDay(ymd) {
  if (typeof ymd !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(year, month - 1, day)
  // a rolled-over date (Feb 30 -> Mar 2) is not a day anyone typed
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return { year, month, day }
}

/**
 * Whole local days from today's midnight to the day `ymd` names. 0 for
 * today, negative once past, null when there is no readable date.
 */
export function daysUntil(ymd, today = new Date()) {
  const p = parseDay(ymd)
  if (!p) return null
  const target = new Date(p.year, p.month - 1, p.day)
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target - base) / 86400000)
}

/** Which overview group a number of days belongs to. */
export function leaseGroupFor(days) {
  if (days == null) return 'none'
  if (days < 0) return 'ended'
  if (days <= SOON_DAYS) return 'soon'
  if (days <= QUARTER_DAYS) return 'quarter'
  return 'later'
}

/**
 * The unit panel's lease-end flag. Within RENEW_WINDOW_DAYS (inclusive) ->
 * amber "renews soon"; already past -> alert "ended"; otherwise null.
 */
export function leaseFlag(leaseEnd, today = new Date()) {
  const days = daysUntil(leaseEnd, today)
  if (days == null) return null
  if (days < 0) return { tone: 'alert', text: `ended ${-days}d ago` }
  if (days <= RENEW_WINDOW_DAYS) {
    return { tone: 'amber', text: days === 0 ? 'renews today' : `renews soon · ${days}d` }
  }
  return null
}

/** 'today', '12 days left', '1 day ago' — the word under the number. */
export function describeDays(days) {
  if (days == null) return 'no date'
  if (days === 0) return 'today'
  const n = Math.abs(days)
  const unit = n === 1 ? 'day' : 'days'
  return days > 0 ? `${n} ${unit} left` : `${n} ${unit} ago`
}

/**
 * One row per unit across some buildings (the active portfolio's), soonest
 * first: dated rows by days remaining, ties in drawing order, then the
 * rows with no end date — leased ones first, since those are the gaps —
 * in drawing order.
 */
export function leaseRows(properties, today = new Date()) {
  const rows = []
  for (const p of Array.isArray(properties) ? properties : []) {
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const days = daysUntil(u.leaseEnd, today)
        rows.push({
          key: u.id,
          unitId: u.id,
          unitName: u.name || 'Unit',
          propertyId: p.id,
          building: p.name || 'Building',
          floor: f.label || '',
          tenant: (u.tenant && String(u.tenant).trim()) || '',
          status: u.status,
          leaseStart: u.leaseStart ?? null,
          leaseEnd: days == null ? null : u.leaseEnd,
          days,
          group: leaseGroupFor(days),
        })
      }
    }
  }
  const dated = rows.filter((r) => r.days != null)
  const undated = rows.filter((r) => r.days == null)
  // Array.prototype.sort is stable, so equal days keep drawing order
  dated.sort((a, b) => a.days - b.days)
  undated.sort((a, b) => Number(b.status === 'leased') - Number(a.status === 'leased'))
  return [...dated, ...undated]
}

/** LEASE_GROUPS with their rows filled in, every group present, in order. */
export function leaseGroups(properties, today = new Date()) {
  const rows = leaseRows(properties, today)
  return LEASE_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.id) }))
}

/**
 * Counts for the header chip and the view's top line. `within90` is every
 * lease ending today through QUARTER_DAYS out, inclusive — what the chip
 * shows, and hides when zero. Ended leases are counted apart.
 */
export function leaseSummary(properties, today = new Date()) {
  const rows = leaseRows(properties, today)
  const count = (id) => rows.filter((r) => r.group === id).length
  const soon = count('soon')
  const quarter = count('quarter')
  return {
    total: rows.length,
    ended: count('ended'),
    soon,
    quarter,
    within90: soon + quarter,
    later: count('later'),
    noDate: count('none'),
  }
}
