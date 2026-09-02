import { formatDollars, toAmount } from '../data/schema.js'

// All components at module scope (see UnitBox.jsx for why).

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

/** The drafting title block: totals that update live as rents are typed. */
export default function TitleBlock({ totals: t, saveError }) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <footer className="sticky bottom-0 z-20 border-t-2 border-line bg-sheet/95 backdrop-blur">
      {/* 1px gaps over a line-coloured background draw the cell dividers */}
      <div className="grid grid-cols-2 gap-px bg-line/40 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Collected / mo" value={formatDollars(t.collected)} sub={`${t.leased}/${t.units} leased`} />
        <Cell label="Collected / yr" value={formatDollars(t.annual)} />
        <Cell
          label="If fully leased"
          value={formatDollars(t.potential)}
          sub={t.vacancy > 0 ? `vacancy −${formatDollars(t.vacancy)}` : 'no vacancy'}
          tone={t.vacancy > 0 ? 'alert' : 'line'}
        />
        <Cell
          label="Expenses / mo"
          value={formatDollars(t.bills)}
          sub={`bldg ${formatDollars(t.propertyBills)} · units ${formatDollars(t.unitBills)}`}
        />
        <Cell label="Net / mo" value={formatDollars(t.net)} tone={t.net < 0 ? 'alert' : 'line'} valueTone={t.net < 0 ? 'alert' : 'ink'} />
        <Cell label="Net / yr" value={formatDollars(t.annualNet)} valueTone={t.annualNet < 0 ? 'alert' : 'ink'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line/40 px-3 py-1.5 text-[9px] tracking-[0.2em] text-line/70 uppercase sm:px-4">
        <span className="font-display text-ink">Rent Roll</span>
        <span>Cleveland Heights</span>
        <span>
          {t.properties} {t.properties === 1 ? 'bldg' : 'bldgs'} · {t.units} units · {t.billCount} bills
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
const VALUE_TONE = {
  ink: 'text-ink',
  alert: 'text-alert',
}

function Cell({ label, value, sub, tone = 'line', valueTone = 'ink' }) {
  return (
    <div className="bg-sheet/95 px-3 py-2 sm:px-4 sm:py-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className={`mt-0.5 text-xl leading-tight tabular-nums sm:text-2xl ${VALUE_TONE[valueTone] ?? VALUE_TONE.ink}`}>
        {value}
      </div>
      {sub && <div className={`mt-0.5 truncate text-[10px] tabular-nums ${TONE[tone] ?? TONE.line}`}>{sub}</div>}
    </div>
  )
}
