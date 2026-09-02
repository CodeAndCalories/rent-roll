import { formatDollars, toAmount } from '../data/schema.js'

// All components at module scope (see UnitBox.jsx for why).

/** Monthly rent a unit brings in when leased (split-aware). */
export function unitMonthly(unit) {
  const rent = toAmount(unit.rent)
  return unit.splittable && unit.isSplit ? rent + toAmount(unit.splitRent) : rent
}

/** A bill's monthly cost. 'once' bills are not recurring and count as 0. */
export function billMonthly(bill) {
  const amount = toAmount(bill.amount)
  if (bill.cadence === 'monthly') return amount
  if (bill.cadence === 'yearly') return amount / 12
  return 0
}

/**
 * Totals for the title block.
 *   collected  monthly rent from units whose status is 'leased'
 *   potential  monthly rent if every unit were leased
 *   vacancy    potential - collected
 *   bills      monthly cost of all property-level and unit-level bills
 *   net        collected - bills
 */
export function computeTotals(properties) {
  let collected = 0
  let potential = 0
  let bills = 0
  let units = 0
  let leased = 0

  for (const p of properties) {
    for (const b of p.bills ?? []) bills += billMonthly(b)
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const m = unitMonthly(u)
        units += 1
        potential += m
        if (u.status === 'leased') {
          collected += m
          leased += 1
        }
        for (const b of u.bills ?? []) bills += billMonthly(b)
      }
    }
  }

  return {
    collected,
    annual: collected * 12,
    potential,
    vacancy: potential - collected,
    bills,
    net: collected - bills,
    units,
    leased,
  }
}

/** The drafting title block: totals that update live as rents are typed. */
export default function TitleBlock({ totals: t, saveError }) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <footer className="sticky bottom-0 z-20 border-t-2 border-line bg-sheet/95 backdrop-blur">
      {/* 1px gaps over a line-coloured background draw the cell dividers */}
      <div className="grid grid-cols-2 gap-px bg-line/40 sm:grid-cols-4">
        <Cell label="Gross monthly" value={formatDollars(t.collected)} />
        <Cell label="Annual" value={formatDollars(t.annual)} />
        <Cell
          label="If fully leased"
          value={formatDollars(t.potential)}
          sub={t.vacancy > 0 ? `vacancy −${formatDollars(t.vacancy)}` : 'no vacancy'}
          tone={t.vacancy > 0 ? 'alert' : 'line'}
        />
        <Cell
          label="Net after bills"
          value={formatDollars(t.net)}
          sub={`bills ${formatDollars(t.bills)}/mo`}
          tone={t.net < 0 ? 'alert' : 'line'}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line/40 px-3 py-1.5 text-[9px] tracking-[0.2em] text-line/70 uppercase sm:px-4">
        <span className="font-display text-ink">Rent Roll</span>
        <span>Cleveland Heights</span>
        <span>
          {t.leased}/{t.units} leased
        </span>
        <span>Sheet A-1 · {today}</span>
        {saveError ? (
          <span className="text-alert normal-case tracking-normal">Not saved: {saveError}</span>
        ) : (
          <span>Saved locally</span>
        )}
      </div>
    </footer>
  )
}

const TONE = {
  line: 'text-line/70',
  alert: 'text-alert',
  amber: 'text-amber',
}

function Cell({ label, value, sub, tone = 'line' }) {
  return (
    <div className="bg-sheet/95 px-3 py-2 sm:px-4 sm:py-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className="mt-0.5 text-xl leading-tight text-ink tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className={`mt-0.5 text-[10px] tabular-nums ${TONE[tone] ?? TONE.line}`}>{sub}</div>}
    </div>
  )
}
