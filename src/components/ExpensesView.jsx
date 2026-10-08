import { formatDollars, toAmount } from '../data/schema.js'
import { expenseSummary } from '../data/totals.js'
import { escrowOverlap, hasLoan, loanBillOf } from '../data/loans.js'
import { EscrowNote } from './BuildingBills.jsx'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The expenses summary, opened from the title block's Expenses cell: every
// bill in the ACTIVE PORTFOLIO (or the scenario on screen), grouped by
// building — its own bills, then each unit that has bills — with the
// monthly equivalent of each and the total. The numbers come from
// expenseSummary, which adds up with the same helpers in the same order as
// computeTotals, so the total here is the title block's to the cent.
// Tapping a building bill opens that building's bills; tapping a unit bill
// opens the unit panel on Bills. Either comes back here when it closes.

/**
 * props
 *   properties      the portfolio's buildings (never the filtered view)
 *   portfolioName   for the caption
 *   onOpenBuilding  (propertyId, billId?) => void   the building bills sheet, on that bill
 *   onOpenUnit      (unitId) => void       the unit panel, on Bills
 *   onClose         () => void
 */
export default function ExpensesView({ properties, portfolioName, onOpenBuilding, onOpenUnit, onClose }) {
  const s = expenseSummary(properties)

  return (
    <Sheet title="Expenses" onClose={onClose} wide footer={<Chip onClick={onClose}>Close</Chip>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-px border border-line/40 bg-line/40">
          <Cell label="Expenses / mo" value={formatDollars(s.total)} />
          <Cell label="Buildings" value={formatDollars(s.propertyBills)} />
          <Cell label="Units" value={formatDollars(s.unitBills)} />
        </div>

        <p className="text-[10px] leading-relaxed text-line/60">
          {portfolioName} · monthly equivalents: yearly bills ÷ 12, one-time bills count nothing monthly. Tap a
          line to edit it.
        </p>

        {s.buildings.length === 0 && <p className="py-2 text-xs text-line/50">No buildings in this portfolio.</p>}

        {s.buildings.map((g) => (
          <BuildingGroup key={g.property.id} group={g} onOpenBuilding={onOpenBuilding} onOpenUnit={onOpenUnit} />
        ))}

        {s.buildings.length > 0 && (
          <div className="flex items-baseline justify-between border-t-2 border-line/60 pt-2">
            <span className="font-display text-[10px] tracking-[0.25em] text-ink uppercase">Total</span>
            <span className="text-lg text-ink tabular-nums">
              {formatDollars(s.total)}
              <span className="text-[10px] text-line/70"> / mo</span>
            </span>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function BuildingGroup({ group, onOpenBuilding, onOpenUnit }) {
  const p = group.property
  const loanBill = loanBillOf(p)
  const overlap = escrowOverlap(p)

  return (
    <section>
      <h3 className="font-display mb-1 flex items-baseline justify-between gap-2 text-[10px] tracking-[0.25em] text-line uppercase">
        <span className="truncate">{p.name || 'Building'}</span>
        <span className="font-mono tracking-normal text-ink tabular-nums">{formatDollars(group.total)} / mo</span>
      </h3>

      <ul className="divide-y divide-line/20 border-t border-line/40">
        {group.bills.length === 0 && (
          <li>
            <button
              type="button"
              onClick={() => onOpenBuilding(p.id)}
              className="flex min-h-11 w-full items-center text-left text-xs text-line/50 hover:text-amber"
            >
              No building bills · tap to add one
            </button>
          </li>
        )}
        {group.bills.map(({ bill, monthly }) => (
          <li key={bill.id}>
            <BillLine
              bill={bill}
              monthly={monthly}
              tag={hasLoan(bill) ? 'loan' : null}
              onClick={() => onOpenBuilding(p.id, bill.id)}
              title="Open this building's bills"
            />
          </li>
        ))}
      </ul>
      {loanBill && overlap.length > 0 && (
        <div className="mt-1">
          <EscrowNote loanBill={loanBill} overlap={overlap} />
        </div>
      )}

      {group.units.map((u) => (
        <div key={u.unit.id} className="mt-2">
          <div className="flex items-baseline justify-between gap-2 text-[9px] tracking-[0.2em] text-line/70 uppercase">
            <span className="truncate">
              {u.unit.name || 'Unit'}
              {u.floor && <span className="text-line/50"> · {u.floor}</span>}
            </span>
            <span className="font-mono tracking-normal tabular-nums">{formatDollars(u.monthly)} / mo</span>
          </div>
          <ul className="divide-y divide-line/20 border-t border-line/30">
            {u.bills.map(({ bill, monthly }) => (
              <li key={bill.id}>
                <BillLine bill={bill} monthly={monthly} onClick={() => onOpenUnit(u.unit.id)} title="Open this unit's bills" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function BillLine({ bill, monthly, tag, onClick, title }) {
  const amount = toAmount(bill.amount)
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex min-h-11 w-full items-center gap-3 py-1 text-left hover:text-amber"
    >
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm', amount === 0 ? 'text-line/50' : 'text-ink')}>
          {bill.label || 'Bill'}
          {tag && <span className="ml-1.5 text-[9px] tracking-widest text-amber uppercase">{tag}</span>}
        </span>
        <span className="block truncate text-[9px] tracking-widest text-line/60 uppercase">
          {amount === 0 ? 'not entered' : `${bill.cadence || '—'} · ${formatDollars(amount)}`}
        </span>
      </span>
      <span className={cx('shrink-0 text-right text-sm tabular-nums', monthly === 0 ? 'text-line/40' : 'text-ink')}>
        {formatDollars(monthly)}
        <span className="text-[9px] text-line/60"> / mo</span>
      </span>
    </button>
  )
}

function Cell({ label, value }) {
  return (
    <div className="bg-sheet px-2 py-2 sm:px-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className="mt-0.5 text-lg leading-tight text-ink tabular-nums">{value}</div>
    </div>
  )
}
